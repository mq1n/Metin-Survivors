// Enemy AI: every archetype (chase / ranged / charger / swarm / tank / skirmisher) and every AttackKind
// (melee / ranged / charge / leap / explode / aura / breath) with a lone enemy and an immobile, near-immortal hero.

import { describe, expect, it } from 'vitest';
import type { ContentDB } from '../../data/schema';
import { applyStatus, hurtPlayer, knockEnemy } from '../combat';
import { DT, PLAYER_RADIUS } from '../constants';
import type { SimEvent, SimEventType } from '../events';
import type { RunConfig } from '../run';
import { refreshStats } from '../stats';
import { EnemyFlag, EnemyState, ProjKind, StatusBit, StatusIdx, TelegraphAct, TelegraphShape, type PlayerInput } from '../stores';
import type { World } from '../world';
import { NO_INPUT, dropSkills, freezeSchedules, giveSkill, makeWorld, player, spawn, typeOf } from './helpers';

// ---------------------------------------------------------------------------
// lab helpers

interface ArenaOpts {
  seed?: number;
  config?: Partial<RunConfig>;
  content?: (c: ContentDB) => void;
}

/** world with an unkillable idle hero at the origin (no skills), schedules frozen */
function arena(opts: ArenaOpts = {}): World {
  const w = makeWorld({ config: { seed: opts.seed ?? 21, ...opts.config }, ...(opts.content ? { content: opts.content } : {}) });
  freezeSchedules(w);
  dropSkills(w);
  const p = player(w);
  p.fixed.push({ maxHp: 1e6, critChance: -1 });
  refreshStats(p, w.content, w.ix);
  p.hp = p.hpMax;
  return w;
}

interface Rec {
  tick: number;
  time: number;
  ev: SimEvent;
}
interface Tagged<T extends SimEventType> {
  tick: number;
  time: number;
  ev: Extract<SimEvent, { t: T }>;
}

/** step n ticks recording copies of every event; `each` runs after every step */
function run(w: World, ticks: number, input: PlayerInput = NO_INPUT, each?: (k: number) => void): Rec[] {
  const out: Rec[] = [];
  for (let k = 0; k < ticks; k++) {
    w.step([input]);
    if (w.modals.length > 0) throw new Error('unexpected modal');
    for (const e of w.events) out.push({ tick: w.tick, time: w.time, ev: { ...e } });
    each?.(k);
  }
  return out;
}

/** typed filter of recorded events (the cast: Extract<…> of a runtime-checked discriminant) */
function of<T extends SimEventType>(recs: readonly Rec[], t: T): Tagged<T>[] {
  return recs.filter((r) => r.ev.t === t) as unknown as Tagged<T>[];
}

const eid = (w: World, row: number): number => w.enemies.id[row] as number;
const put = (w: World, def: string, x: number, z: number, opts: Parameters<typeof spawn>[4] = {}): number => eid(w, spawn(w, def, x, z, opts));

function rowOf(w: World, id: number): number {
  const r = w.enemies.find(id);
  if (r < 0) throw new Error('enemy is gone');
  return r;
}
function posOf(w: World, id: number): { x: number; z: number } {
  const r = rowOf(w, id);
  return { x: w.enemies.x[r] as number, z: w.enemies.z[r] as number };
}
function stateOf(w: World, id: number): number {
  const r = w.enemies.find(id);
  return r < 0 ? -1 : (w.enemies.state[r] as number);
}
function distToHero(w: World, id: number): number {
  const q = posOf(w, id);
  const p = player(w);
  return Math.hypot(q.x - p.x, q.z - p.z);
}

/** raw damage of attack `a` of enemy `id` (def × time/difficulty scaling × attack mul × corruption) */
function rawHit(w: World, id: number, a = 0): number {
  const e = w.enemies;
  const row = rowOf(w, id);
  const def = w.typeDefs[e.type[row] as number]!;
  const atk = def.attacks[a]!;
  return def.damage * (e.dmgMul[row] as number) * atk.damageMul * (1 + 0.42 * (e.corrupted[row] as number));
}

/** damage the hero actually loses from a raw hit: element resist, armor, min 1 */
function felt(w: World, raw: number, element = 0): number {
  const s = player(w).stats;
  return Math.max(1, raw * (1 - (s.resist[element] as number)) * (1 - s.armor / (s.armor + w.balance.armorK)));
}

/** step until `pred`; returns ticks stepped or -1 */
function until(w: World, pred: () => boolean, max: number): number {
  for (let k = 1; k <= max; k++) {
    w.step([NO_INPUT]);
    if (w.modals.length > 0) throw new Error('unexpected modal');
    if (pred()) return k;
  }
  return -1;
}

/** an enemyAttack event was emitted this tick for `id` */
const attackedNow = (w: World, id: number): boolean => w.events.some((e) => e.t === 'enemyAttack' && e.enemy === id);

/** make attack `a` of the enemy ready now and park every other attack */
function onlyAttack(w: World, id: number, a: number): void {
  const row = rowOf(w, id);
  for (let k = 0; k < 3; k++) w.enemies.atkReady[row * 3 + k] = k === a ? 0 : 1e9;
}

const KIND = { melee: 0, ranged: 1, charge: 2, leap: 3, explode: 4, aura: 5, breath: 6 } as const;

// ---------------------------------------------------------------------------
// chase

describe('chase (wolf)', () => {
  it('runs straight at the hero at its (varied) base speed, facing it', () => {
    const w = arena();
    const id = put(w, 'wolf', 0, 15);
    const row = rowOf(w, id);
    const base = w.enemies.baseSpeed[row] as number;
    expect(base).toBeGreaterThan(3.4 * 0.93);
    expect(base).toBeLessThan(3.4 * 1.07);
    run(w, 60);
    const q = posOf(w, id);
    expect(15 - q.z).toBeGreaterThan(base * 0.97);
    expect(15 - q.z).toBeLessThan(base * 1.03);
    expect(Math.abs(q.x)).toBeLessThan(1e-3);
    expect(w.enemies.speed[rowOf(w, id)]).toBeCloseTo(base, 5);
    expect(Math.cos(w.enemies.rot[rowOf(w, id)] as number)).toBeLessThan(-0.99); // facing -Z (towards the hero)
    expect(w.enemies.state[rowOf(w, id)]).toBe(EnemyState.Move);
  });

  it('closes to striking distance, stops there and never walks into the hero', () => {
    const w = arena();
    const id = put(w, 'wolf', 12, 0);
    let minD = Infinity;
    run(w, 60 * 9, NO_INPUT, () => {
      minD = Math.min(minD, distToHero(w, id));
    });
    const d = distToHero(w, id);
    // melee range 1.1 + body 0.55 + hero 0.55 = 2.2; hold distance 1.93
    expect(d).toBeGreaterThan(1.7);
    expect(d).toBeLessThan(2.3);
    expect(minD).toBeGreaterThan(1.7);
  });

  it('chasers pack without stacking: separation pushes overlapping enemies apart', () => {
    const w = arena();
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push(put(w, 'wolf', 20 + (i % 4) * 0.08, (Math.floor(i / 4) - 1) * 0.08));
    run(w, 120);
    let minPair = Infinity;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = posOf(w, ids[i]!);
        const b = posOf(w, ids[j]!);
        minPair = Math.min(minPair, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    // bodies are 0.55 m radius: after separating, centres are ≳ 0.92 × 1.1 apart
    expect(minPair).toBeGreaterThan(0.8);
    for (const id of ids) expect(Number.isFinite(posOf(w, id).x)).toBe(true);
  });

  it('two enemies spawned on the very same point are split deterministically', () => {
    const w = arena();
    const a = put(w, 'wolf', 30, 0);
    const b = put(w, 'wolf', 30, 0);
    run(w, 40);
    const pa = posOf(w, a);
    const pb = posOf(w, b);
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// melee

describe('melee attack (wolf)', () => {
  /** wolf 2 m from the hero; returns the id after the tick its attack started */
  function wolfAtWindup(w: World, dist = 2.0): number {
    const id = put(w, 'wolf', 0, dist);
    expect(until(w, () => attackedNow(w, id), 120)).toBeGreaterThan(0);
    return id;
  }

  it('winds up for 0.3 s (telegraphed by an enemyAttack event), then the hit lands', () => {
    const w = arena();
    const id = put(w, 'wolf', 0, 2.0);
    const recs: Rec[] = [];
    let startTick = -1;
    let iframesAtHit = NaN;
    for (let k = 0; k < 120; k++) {
      recs.push(...run(w, 1));
      if (startTick < 0 && attackedNow(w, id)) {
        startTick = w.tick;
        expect(stateOf(w, id)).toBe(EnemyState.Windup);
        expect(w.enemies.aiT[rowOf(w, id)]).toBeCloseTo(0.3, 5);
      }
      if (w.events.some((e) => e.t === 'playerHit')) iframesAtHit = player(w).iframes;
      if (startTick > 0 && w.tick > startTick + 30) break;
    }
    const attack = of(recs, 'enemyAttack')[0]!;
    expect(attack.ev.kind).toBe(KIND.melee);
    expect(attack.ev.enemy).toBe(id);
    expect(attack.ev.type).toBe(typeOf(w, 'wolf'));
    // direction points at the hero
    expect(Math.hypot(attack.ev.dirX, attack.ev.dirZ)).toBeCloseTo(1, 5);
    expect(attack.ev.dirZ).toBeLessThan(-0.99);
    expect(attack.tick).toBe(startTick);
    const hit = of(recs, 'playerHit');
    expect(hit.length).toBe(1);
    const delay = hit[0]!.tick - startTick;
    expect(delay).toBeGreaterThanOrEqual(18);
    expect(delay).toBeLessThanOrEqual(19);
    expect(hit[0]!.ev.result).toBe(0);
    expect(hit[0]!.ev.amount).toBeCloseTo(felt(w, 6 * 1.0), 4); // wolf damage 6, dmgMul 1 at t≈0
    expect(hit[0]!.ev.element).toBe(0);
    expect(hit[0]!.ev.srcX).toBeCloseTo(posOf(w, id).x, 1);
    expect(hit[0]!.ev.hp).toBeCloseTo(player(w).hp, 3);
    expect(iframesAtHit).toBeCloseTo(0.55, 5); // PLAYER_IFRAMES after a melee hit
    expect(stateOf(w, id)).toBe(EnemyState.Recover);
  });

  it('no damage if the hero left the strike range during the windup', () => {
    const w = arena();
    const id = wolfAtWindup(w);
    const hp = player(w).hp;
    player(w).x = 10; // far outside 1.1 × 1.35 + 0.35 + bodies
    const recs = run(w, 40);
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(player(w).hp).toBe(hp);
    // the swing still ran its course: the wolf recovered and is chasing again
    expect([EnemyState.Recover, EnemyState.Move]).toContain(stateOf(w, id));
  });

  it('the strike has a little slack (a hero that keeps walking still gets hit) but not unlimited', () => {
    // reach = 1.1 × 1.35 + 0.35 = 1.835, plus the wolf body and the hero body ≈ 2.94 m from the wolf (at z = 2)
    const within = arena();
    wolfAtWindup(within);
    player(within).z = -0.8; // 2.8 m from the wolf
    expect(of(run(within, 40), 'playerHit').length).toBe(1);
    const outside = arena();
    wolfAtWindup(outside);
    player(outside).z = -1.2; // 3.2 m from the wolf
    expect(of(run(outside, 40), 'playerHit').length).toBe(0);
  });

  it('attacks repeat no faster than windup + cooldown (0.9–1.1 s) and every swing at point-blank range lands', () => {
    const w = arena();
    const id = put(w, 'wolf', 0, 1.8);
    const recs = run(w, 60 * 12);
    const attacks = of(recs, 'enemyAttack').filter((r) => r.ev.enemy === id);
    expect(attacks.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < attacks.length; i++) {
      const gap = attacks[i]!.time - attacks[i - 1]!.time;
      expect(gap).toBeGreaterThanOrEqual(0.3 + 0.9 - 2 * DT);
      expect(gap).toBeLessThanOrEqual(0.3 + 1.1 + 0.4 + 0.4);
    }
    expect(of(recs, 'playerHit').length).toBe(attacks.length - (stateOf(w, id) === EnemyState.Windup ? 1 : 0));
  });

  it('damage = def.damage × attack.damageMul × time scaling × difficulty, then armor', () => {
    const w = arena();
    w.time = 600; // 10 min → +90% damage
    const id = put(w, 'alpha_wolf', 0, 2.2); // damage 12, melee ×1.2
    expect(w.enemies.dmgMul[rowOf(w, id)]).toBeCloseTo(1 + 0.09 * 10, 5);
    expect(until(w, () => w.events.some((e) => e.t === 'playerHit'), 200)).toBeGreaterThan(0);
    const hit = w.events.find((e) => e.t === 'playerHit');
    expect(hit && hit.t === 'playerHit' ? hit.amount : NaN).toBeCloseTo(felt(w, 12 * 1.2 * 1.9), 4);

    const hard = arena({ config: { difficulty: 'hard' } });
    const hid = put(hard, 'wolf', 0, 2.0);
    expect(hard.enemies.dmgMul[rowOf(hard, hid)]).toBeCloseTo(1.4, 5);
    expect(hard.enemies.hp[rowOf(hard, hid)]).toBeCloseTo(20 * 1.6, 3);
    expect(until(hard, () => hard.events.some((e) => e.t === 'playerHit'), 200)).toBeGreaterThan(0);
    const hhit = hard.events.find((e) => e.t === 'playerHit');
    expect(hhit && hhit.t === 'playerHit' ? hhit.amount : NaN).toBeCloseTo(felt(hard, 6 * 1.4), 4);
  });

  it('armor, elemental resist, shield and i-frames mitigate as documented', () => {
    const plain = arena();
    put(plain, 'wolf', 0, 2.0);
    expect(until(plain, () => plain.events.some((e) => e.t === 'playerHit'), 200)).toBeGreaterThan(0);
    const raw = 6;
    const hit = plain.events.find((e) => e.t === 'playerHit');
    expect(hit && hit.t === 'playerHit' ? hit.amount : NaN).toBeCloseTo(raw * (1 - 8 / 108), 4);

    const armored = arena();
    const p = player(armored);
    p.fixed.push({ armor: 92 }); // 100 armor → 50% reduction
    refreshStats(p, armored.content, armored.ix);
    put(armored, 'wolf', 0, 2.0);
    expect(until(armored, () => armored.events.some((e) => e.t === 'playerHit'), 200)).toBeGreaterThan(0);
    const ahit = armored.events.find((e) => e.t === 'playerHit');
    expect(ahit && ahit.t === 'playerHit' ? ahit.amount : NaN).toBeCloseTo(raw * 0.5, 4);

    // i-frames swallow a hit completely
    const iframes = arena();
    put(iframes, 'wolf', 0, 2.0);
    player(iframes).iframes = 100;
    const recs = run(iframes, 200);
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(of(recs, 'enemyAttack').length).toBeGreaterThan(0);
    expect(hurtPlayer(iframes, 0, 99, 0, 0, 0, 0)).toBe(false);

    // elemental resist applies to the attack's element (spitter bolt: poison)
    const resist = arena();
    const rp = player(resist);
    rp.fixed.push({ resist: { poison: 0.5 } });
    refreshStats(rp, resist.content, resist.ix);
    const spitter = put(resist, 'spitter', 0, 7);
    onlyAttack(resist, spitter, 0);
    const rrecs = run(resist, 60 * 3);
    const rhit = of(rrecs, 'playerHit')[0]!;
    expect(rhit.ev.element).toBe(5);
    expect(rhit.ev.amount).toBeCloseTo(5 * 0.5 * (1 - 8 / 108), 4);

    // a shield absorbs first: the hit is reported as absorbed and hp is untouched
    const shielded = arena();
    const sp = player(shielded);
    sp.trinkets[2] = { id: 'shield', rank: 3 }; // 3 × 12 = 36 points of barrier
    refreshStats(sp, shielded.content, shielded.ix);
    expect(sp.stats.shieldMax).toBe(36);
    sp.shield = 36;
    put(shielded, 'wolf', 0, 2.0);
    let shieldAtHit = NaN;
    const srecs = run(shielded, 120, NO_INPUT, () => {
      if (Number.isNaN(shieldAtHit) && shielded.events.some((e) => e.t === 'playerHit')) shieldAtHit = sp.shield;
    });
    const shit = of(srecs, 'playerHit')[0]!;
    expect(shit.ev.result).toBe(2);
    expect(shit.ev.amount).toBeCloseTo(0, 6); // everything was absorbed by the barrier
    expect(sp.hp).toBe(sp.hpMax);
    expect(shieldAtHit).toBeCloseTo(36 - 6 * (1 - 8 / 108), 3);
  });
});

// ---------------------------------------------------------------------------
// ranged

describe('ranged (spitter)', () => {
  it('stops at ~range, keeps its preferred distance and keeps firing', () => {
    const w = arena();
    const id = put(w, 'spitter', 0, 16);
    const dists: number[] = [];
    const recs = run(w, 60 * 14, NO_INPUT, () => dists.push(distToHero(w, id)));
    const arrived = dists.findIndex((d) => d < 9.3);
    expect(arrived).toBeGreaterThan(0);
    const after = dists.slice(arrived);
    expect(Math.min(...after)).toBeGreaterThan(5.5);
    expect(Math.max(...after)).toBeLessThan(9.4);
    expect(of(recs, 'enemyAttack').filter((r) => r.ev.kind === KIND.ranged).length).toBeGreaterThanOrEqual(3);
    expect(player(w).hp).toBeLessThan(player(w).hpMax); // the bolts do reach the hero
  });

  it('backs off when the hero is closer than ~4.5 m, then stops retreating', () => {
    const w = arena();
    const id = put(w, 'spitter', 0, 3);
    onlyAttack(w, id, 99); // every attack parked, so only the movement is observed
    const dists: number[] = [];
    run(w, 90, NO_INPUT, () => dists.push(distToHero(w, id)));
    for (let i = 1; i < 30; i++) expect(dists[i]!).toBeGreaterThan(dists[i - 1]!); // steadily away
    expect(dists[29]! - 3).toBeGreaterThan(0.85 * 2.4 * 0.5 * 0.94); // at 85% of its 2.4 m/s
    expect(dists[89]!).toBeGreaterThan(4.4);
    expect(dists[89]!).toBeLessThan(4.9); // retreat ends at range × 0.75 − 2.2 = 4.55 m
    expect(stateOf(w, id)).toBe(EnemyState.Move);
  });

  it('strafes around the hero at its preferred distance (0.55 × speed)', () => {
    const w = arena();
    const id = put(w, 'spitter', 7, 0);
    onlyAttack(w, id, 99);
    const a0 = Math.atan2(posOf(w, id).x, posOf(w, id).z);
    const dists: number[] = [];
    run(w, 60 * 6, NO_INPUT, () => dists.push(distToHero(w, id)));
    const q = posOf(w, id);
    const a1 = Math.atan2(q.x, q.z);
    let turned = Math.abs(a1 - a0);
    if (turned > Math.PI) turned = 2 * Math.PI - turned;
    expect(turned).toBeGreaterThan(0.8);
    for (const d of dists) {
      expect(d).toBeGreaterThan(6.5);
      expect(d).toBeLessThan(7.5);
    }
  });

  it('fires a hostile bolt after the 0.5 s windup: speed 8, radius 0.3, aimed at the hero, element from its race', () => {
    const w = arena();
    const id = put(w, 'spitter', 0, 8);
    const recs: Rec[] = [];
    let attackTick = -1;
    let fireTick = -1;
    for (let k = 0; k < 150; k++) {
      recs.push(...run(w, 1));
      if (attackTick < 0 && attackedNow(w, id)) attackTick = w.tick;
      if (attackTick > 0 && fireTick < 0 && w.projectiles.count > 0) {
        fireTick = w.tick;
        break;
      }
    }
    expect(attackTick).toBeGreaterThan(0);
    expect(fireTick - attackTick).toBeGreaterThanOrEqual(30);
    expect(fireTick - attackTick).toBeLessThanOrEqual(31);
    expect(of(recs, 'enemyAttack')[0]!.ev.kind).toBe(KIND.ranged);
    const P = w.projectiles;
    expect(P.count).toBe(1);
    expect(P.kind[0]).toBe(ProjKind.Hostile);
    expect(P.hostile[0]).toBe(1);
    expect(P.skill[0]).toBe(255);
    expect(Math.hypot(P.vx[0] as number, P.vz[0] as number)).toBeCloseTo(8, 4);
    expect(P.radius[0]).toBeCloseTo(0.3, 5);
    expect(P.damage[0]).toBeCloseTo(5, 4);
    expect(P.element[0]).toBe(5); // insect → poison
    expect(P.lifeMax[0]).toBeCloseTo((9 + 6) / 8, 5);
    // heading: from the spitter to where the hero stands
    const q = posOf(w, id);
    expect(P.vz[0] as number).toBeLessThan(0);
    expect(Math.abs(P.vx[0] as number)).toBeLessThan(8 * Math.abs(q.x) / 8 + 0.2);
    expect(w.strings.name(P.style[0] as number)).toBe('vfx_spit_glob');
  });

  it('the bolt hurts a hero that stays put (once, then it is consumed)', () => {
    const w = arena();
    const id = put(w, 'spitter', 0, 8);
    onlyAttack(w, id, 0);
    const recs = run(w, 60 * 4);
    const hits = of(recs, 'playerHit');
    expect(hits.length).toBe(1);
    expect(hits[0]!.ev.amount).toBeCloseTo(felt(w, 5, 5), 4);
    expect(hits[0]!.ev.element).toBe(5);
    expect(w.projectiles.count).toBeLessThanOrEqual(1); // at most the next one (cooldown 2.2 s)
    expect(id).not.toBe(0);
  });

  it('a hero that steps out of the way is missed; the bolt flies on and expires after (range + 6) / speed', () => {
    const w = arena();
    const id = put(w, 'spitter', 0, 8);
    onlyAttack(w, id, 0);
    expect(until(w, () => w.projectiles.count > 0, 120)).toBeGreaterThan(0);
    expect(id).not.toBe(0);
    const P = w.projectiles;
    const life = P.lifeMax[0] as number;
    const spawnX = P.x[0] as number;
    const spawnZ = P.z[0] as number;
    // sidestep out of the 0.3 + 0.55 m corridor
    player(w).x = 3;
    let far = 0;
    const recs: Rec[] = [];
    let ticks = 0;
    while (w.projectiles.count > 0 && ticks < 200) {
      far = Math.max(far, Math.hypot((w.projectiles.x[0] as number) - spawnX, (w.projectiles.z[0] as number) - spawnZ));
      recs.push(...run(w, 1));
      ticks++;
    }
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(ticks * DT).toBeGreaterThan(life - 0.1);
    expect(ticks * DT).toBeLessThan(life + 0.05);
    expect(far).toBeGreaterThan(8 * life - 1);
    expect(spawnZ).toBeLessThan(8);
  });

  it('i-frames let a bolt pass straight through the hero without consuming it', () => {
    const w = arena();
    const id = put(w, 'spitter', 0, 8);
    onlyAttack(w, id, 0);
    expect(until(w, () => w.projectiles.count > 0, 120)).toBeGreaterThan(0);
    expect(id).not.toBe(0);
    player(w).iframes = 100;
    const hp = player(w).hp;
    let sawPast = false;
    const recs = run(w, 90, NO_INPUT, () => {
      if (w.projectiles.count > 0 && (w.projectiles.z[0] as number) < -2) sawPast = true;
    });
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(player(w).hp).toBe(hp);
    expect(sawPast).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// charger

describe('charger (boar)', () => {
  it('telegraphs a line, winds up 0.8 s, dashes ~1.25 × range + 1 along the locked direction, hits once, recovers', () => {
    const w = arena();
    const id = put(w, 'boar_charger', 0, 14);
    let startTick = -1;
    let dashStart = -1;
    let dashEnd = -1;
    let recoverEnd = -1;
    let startPos = { x: 0, z: 0 };
    let dashFrom = { x: 0, z: 0 };
    let prev = EnemyState.Move as number;
    const recs = run(w, 60 * 5, NO_INPUT, () => {
      const st = stateOf(w, id);
      if (startTick < 0 && attackedNow(w, id)) {
        startTick = w.tick;
        startPos = posOf(w, id);
      }
      if (st === EnemyState.Dash && prev !== EnemyState.Dash) {
        dashStart = w.tick;
        dashFrom = posOf(w, id);
      }
      if (prev === EnemyState.Dash && st !== EnemyState.Dash && dashEnd < 0) dashEnd = w.tick;
      if (prev === EnemyState.Recover && st === EnemyState.Move && recoverEnd < 0 && dashEnd > 0) recoverEnd = w.tick;
      prev = st;
    });
    expect(startTick).toBeGreaterThan(0);
    // started charging from just inside its range of 8 m
    expect(Math.hypot(startPos.x, startPos.z)).toBeLessThanOrEqual(8.0);
    expect(Math.hypot(startPos.x, startPos.z)).toBeGreaterThan(7.2);
    const attack = of(recs, 'enemyAttack')[0]!;
    expect(attack.ev.kind).toBe(KIND.charge);
    // the telegraph: a Line (length 8 × 1.25 + 1, width = area) that follows the boar
    const tele = of(recs, 'telegraph')[0]!;
    expect(tele.ev.shape).toBe(TelegraphShape.Line);
    expect(tele.ev.c).toBeCloseTo(11, 4); // length
    expect(tele.ev.b).toBeCloseTo(1.6, 4); // width
    expect(tele.ev.dur).toBeCloseTo(0.8, 5);
    expect(tele.ev.source).toBe(0);
    expect(Math.abs(Math.abs(tele.ev.rot) - Math.PI)).toBeLessThan(0.05); // pointing at -Z (the hero)
    // wind-up lasts 0.8 s (48 ticks) with the boar standing still
    expect(dashStart - startTick).toBeGreaterThanOrEqual(48);
    expect(dashStart - startTick).toBeLessThanOrEqual(50);
    expect(Math.hypot(dashFrom.x - startPos.x, dashFrom.z - startPos.z)).toBeLessThan(0.3);
    // dash: len / dashSpeed seconds, covering len metres
    const row = rowOf(w, id);
    const dashSpeed = Math.max(9, (w.enemies.baseSpeed[row] as number) * 3.4);
    expect((dashEnd - dashStart) * DT).toBeGreaterThan(11 / dashSpeed - 2 * DT);
    expect((dashEnd - dashStart) * DT).toBeLessThan(11 / dashSpeed + 2 * DT);
    // one contact hit, with the attack's damage multiplier (×1.6) and melee i-frames
    const hits = of(recs, 'playerHit');
    expect(hits.length).toBe(1);
    expect(hits[0]!.ev.amount).toBeCloseTo(felt(w, 9 * 1.6), 4);
    expect(hits[0]!.tick).toBeGreaterThan(dashStart);
    expect(hits[0]!.tick).toBeLessThan(dashEnd);
    // recovery (0.7 s) and the cooldown keep it from charging again right away
    expect(recoverEnd - dashEnd).toBeGreaterThanOrEqual(41);
    expect(recoverEnd - dashEnd).toBeLessThanOrEqual(43);
  });

  it('the dash direction is locked at the wind-up: sidestepping makes it miss completely', () => {
    const w = arena();
    const id = put(w, 'boar_charger', 0, 14);
    expect(until(w, () => attackedNow(w, id), 400)).toBeGreaterThan(0);
    const from = posOf(w, id);
    const dirZ = -1;
    player(w).x = 6; // out of the 1.6 m lane
    const recs = run(w, 60 * 2);
    expect(of(recs, 'playerHit').length).toBe(0);
    const q = posOf(w, id);
    // the boar ran its full line on the old bearing (never turning toward the new position)
    expect(Math.abs(q.x - from.x)).toBeLessThan(0.5);
    expect(Math.abs(q.z - (from.z + dirZ * 11))).toBeLessThan(2.5);
    expect(player(w).x).toBe(6);
  });

  it('charges again only after its cooldown (4 s × 0.9–1.1, armed when the dash ends)', () => {
    const w = arena();
    const id = put(w, 'boar_charger', 0, 12);
    let prev: number = EnemyState.Move;
    let dashEnd = -1;
    let readyIn = NaN;
    let kite = true;
    const recs = run(w, 60 * 16, NO_INPUT, () => {
      const st = stateOf(w, id);
      if (dashEnd < 0 && prev === EnemyState.Dash && st !== EnemyState.Dash) {
        dashEnd = w.time;
        readyIn = (w.enemies.atkReady[rowOf(w, id) * 3] as number) - w.time;
      }
      if (attackedNow(w, id) && dashEnd > 0) kite = false;
      // after the first dash the hero keeps 7 m away from the boar (a charge needs 2.5–8 m, and the boar would
      // otherwise walk up to its standing distance while the cooldown runs)
      if (dashEnd > 0 && kite) {
        player(w).x = posOf(w, id).x;
        player(w).z = posOf(w, id).z + 7;
      }
      prev = st;
    });
    expect(dashEnd).toBeGreaterThan(0);
    expect(readyIn).toBeGreaterThanOrEqual(4 * 0.9 - 2 * DT);
    expect(readyIn).toBeLessThanOrEqual(4 * 1.1 + 2 * DT);
    const attacks = of(recs, 'enemyAttack').filter((r) => r.ev.enemy === id);
    expect(attacks.length).toBeGreaterThanOrEqual(2);
    // the second charge starts as soon as the cooldown is over, not before
    expect(attacks[1]!.time - dashEnd).toBeGreaterThanOrEqual(readyIn - 2 * DT);
    expect(attacks[1]!.time - dashEnd).toBeLessThanOrEqual(readyIn + 0.7 + 0.2);
  });
});

// ---------------------------------------------------------------------------
// tank

describe('tank (bear)', () => {
  it('is slow: it covers base speed (≈ 2.1 m/s) while a wolf covers ≈ 3.4', () => {
    const w = arena();
    const bear = put(w, 'bear', 0, 20);
    const wolf = put(w, 'wolf', 20, 0);
    run(w, 60);
    const b = 20 - posOf(w, bear).z;
    const wv = 20 - posOf(w, wolf).x;
    expect(b).toBeCloseTo(w.enemies.baseSpeed[rowOf(w, bear)] as number, 1);
    expect(b).toBeGreaterThan(1.9);
    expect(b).toBeLessThan(2.3);
    expect(wv).toBeGreaterThan(b * 1.4);
  });

  it('knockback is impulse / mass metres: heavier enemies are shoved proportionally less (bosses 12%)', () => {
    const w = arena();
    const probes = [
      ['jackal', 0.6],
      ['wolf', 1],
      ['bear', 3],
      ['elder_bear', 6],
    ] as const;
    const ids = probes.map(([def], i) => put(w, def, 30, -30 + i * 20, { speedMul: 0 }));
    for (const id of ids) knockEnemy(w, rowOf(w, id), 2, 20, posOf(w, id).z, false);
    const before = ids.map((id) => posOf(w, id));
    run(w, 120);
    ids.forEach((id, i) => {
      const q = posOf(w, id);
      const moved = Math.hypot(q.x - before[i]!.x, q.z - before[i]!.z);
      const mass = probes[i]![1];
      // total travel of a decaying impulse ≈ 1.077 × impulse / mass (and it moves straight away from the source)
      expect(moved).toBeGreaterThan((2 / mass) * 1.0);
      expect(moved).toBeLessThan((2 / mass) * 1.15);
      expect(q.x - before[i]!.x).toBeGreaterThan(moved * 0.99);
    });
    // boss flag: ×0.12
    const boss = put(w, 'wolf', -30, 30, { speedMul: 0 });
    const b0 = posOf(w, boss);
    knockEnemy(w, rowOf(w, boss), 6, -40, 30, true);
    run(w, 120);
    expect(Math.hypot(posOf(w, boss).x - b0.x, posOf(w, boss).z - b0.z)).toBeCloseTo(6 * 0.12 * 1.077, 1);
  });

  it('large impulses are clamped to 42 m/s (≈ 5 m of travel at most)', () => {
    const w = arena();
    const id = put(w, 'jackal', 30, 0, { speedMul: 0 });
    const x0 = posOf(w, id).x;
    knockEnemy(w, rowOf(w, id), 50, 0, 0, false);
    run(w, 120);
    expect(posOf(w, id).x - x0).toBeLessThan(5.2);
    expect(posOf(w, id).x - x0).toBeGreaterThan(4.8);
  });

  it('leaps at the hero: Circle telegraph on the hero, 0.9 s windup, flight, landing AoE hits once for ×1.3', () => {
    const w = arena();
    const id = put(w, 'bear', 0, 5);
    onlyAttack(w, id, 1); // the melee swing is parked, the leap is ready
    const recs: Rec[] = [];
    let start = -1;
    let leapStart = -1;
    let leapEnd = -1;
    let prev: number = EnemyState.Move;
    recs.push(
      ...run(w, 60 * 4, NO_INPUT, () => {
        const st = stateOf(w, id);
        if (start < 0 && attackedNow(w, id)) start = w.tick;
        if (st === EnemyState.Leap && prev !== EnemyState.Leap) leapStart = w.tick;
        if (prev === EnemyState.Leap && st !== EnemyState.Leap && leapEnd < 0) leapEnd = w.tick;
        prev = st;
      }),
    );
    const attack = of(recs, 'enemyAttack')[0]!;
    expect(attack.ev.kind).toBe(KIND.leap);
    expect(start).toBe(2 - 1); // the leap is chosen on the first AI tick (tick 1)
    const tele = of(recs, 'telegraph')[0]!;
    expect(tele.ev.shape).toBe(TelegraphShape.Circle);
    expect(tele.ev.a).toBeCloseTo(2.4, 5); // radius = attack.area
    expect(tele.ev.dur).toBeCloseTo(0.9, 5);
    expect(tele.ev.x).toBeCloseTo(0, 3); // on the hero
    expect(tele.ev.z).toBeCloseTo(0, 3);
    // windup 0.9 s, then flight = distance / 8 m/s (≥ 0.35 s)
    expect(leapStart - start).toBeGreaterThanOrEqual(54);
    expect(leapStart - start).toBeLessThanOrEqual(56);
    expect((leapEnd - leapStart) * DT).toBeGreaterThan(0.55);
    expect((leapEnd - leapStart) * DT).toBeLessThan(0.7);
    // the landing: AoE on the hero → one hit with damage 14 × 1.3
    const hits = of(recs, 'playerHit');
    expect(hits.length).toBe(1);
    expect(hits[0]!.tick).toBe(leapEnd);
    expect(hits[0]!.ev.amount).toBeCloseTo(felt(w, 14 * 1.3), 4);
    const slam = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_slam');
    expect(slam.length).toBe(1);
    expect(slam[0]!.ev.scale).toBeCloseTo(2.4, 5);
    expect(of(recs, 'shake').length).toBeGreaterThan(0);
    // the bear ended up where the telegraph was
    expect(distToHero(w, id)).toBeLessThan(1.5);
  });

  it('a hero that leaves the marked circle is not hurt by the slam', () => {
    const w = arena();
    const id = put(w, 'bear', 0, 5);
    onlyAttack(w, id, 1);
    expect(until(w, () => attackedNow(w, id), 10)).toBeGreaterThan(0);
    player(w).x = 6; // landing circle r 2.4 + hero 0.55 around (0,0)
    const recs = run(w, 60 * 3);
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_slam').length).toBe(1);
  });

  it('melee swing: 0.7 s windup, damage ×1.0 within reach 1.6', () => {
    const w = arena();
    const id = put(w, 'bear', 0, 2.5);
    onlyAttack(w, id, 0);
    let start = -1;
    const recs = run(w, 90, NO_INPUT, () => {
      if (start < 0 && attackedNow(w, id)) start = w.tick;
    });
    const hit = of(recs, 'playerHit')[0]!;
    expect(hit.tick - start).toBeGreaterThanOrEqual(42);
    expect(hit.tick - start).toBeLessThanOrEqual(43);
    expect(hit.ev.amount).toBeCloseTo(felt(w, 14), 4);
    expect(of(recs, 'enemyAttack')[0]!.ev.kind).toBe(KIND.melee);
  });
});

// ---------------------------------------------------------------------------
// swarm

describe('swarm (jackal)', () => {
  it('weaves from side to side on its way in while a chaser walks the straight line', () => {
    const w = arena();
    const jackal = put(w, 'jackal', 0, 28);
    const wolf = put(w, 'wolf', 28, 0);
    let jx = 0;
    let signChanges = 0;
    let lastSign = 0;
    let wolfDev = 0;
    let jackalArrived = -1;
    let wolfArrived = -1;
    run(w, 60 * 7, NO_INPUT, (k) => {
      if (jackalArrived < 0 && distToHero(w, jackal) < 4) jackalArrived = k;
      if (wolfArrived < 0 && distToHero(w, wolf) < 4) wolfArrived = k;
      if (jackalArrived >= 0) return;
      const j = posOf(w, jackal);
      jx = Math.max(jx, Math.abs(j.x));
      const s = Math.sign(j.x);
      if (s !== 0 && lastSign !== 0 && s !== lastSign) signChanges++;
      if (s !== 0) lastSign = s;
      wolfDev = Math.max(wolfDev, Math.abs(posOf(w, wolf).z));
    });
    expect(jx).toBeGreaterThan(0.3);
    expect(signChanges).toBeGreaterThanOrEqual(1);
    expect(wolfDev).toBeLessThan(1e-3);
    // faster than the chaser (4.6 vs 3.4 m/s) in spite of the weaving
    expect(jackalArrived).toBeGreaterThan(0);
    expect(wolfArrived === -1 || jackalArrived < wolfArrived).toBe(true);
  });

  it('bites with a 0.2 s windup', () => {
    const w = arena();
    const id = put(w, 'jackal', 0, 1.8);
    let start = -1;
    const recs = run(w, 120, NO_INPUT, () => {
      if (start < 0 && attackedNow(w, id)) start = w.tick;
    });
    const hit = of(recs, 'playerHit')[0]!;
    expect(hit.tick - start).toBeGreaterThanOrEqual(12);
    expect(hit.tick - start).toBeLessThanOrEqual(13);
    expect(hit.ev.amount).toBeCloseTo(felt(w, 3), 4);
  });
});

// ---------------------------------------------------------------------------
// skirmisher

describe('skirmisher (fox)', () => {
  /** attack from `dist` away with the swing ready; returns how much farther the fox stands 1.1 s after its swing ended */
  function retreatAfterSwing(dist: number): { gained: number; endDist: number } {
    const w = arena();
    const fox = put(w, 'fox', 0, dist);
    onlyAttack(w, fox, 0);
    let endTick = -1;
    let endDist = 0;
    let after = 0;
    run(w, 60 * 3, NO_INPUT, () => {
      if (endTick < 0 && stateOf(w, fox) === EnemyState.Recover) {
        endTick = w.tick;
        endDist = distToHero(w, fox);
      }
      if (endTick > 0 && w.tick === endTick + 66) after = distToHero(w, fox); // 1.1 s after the swing ended
    });
    expect(endTick).toBeGreaterThan(0);
    return { gained: after - endDist, endDist };
  }

  it('hits, then retreats (≈ 1–2 s, backing away at 1.15× speed) after a swing from its attack range', () => {
    // 2.0 m is a touch inside its 2.05 m strike range but beyond its 1.8 m standing distance
    const { gained } = retreatAfterSwing(2.0);
    expect(gained).toBeGreaterThan(1.8);
  });

  it('retreats after a point-blank swing too (it must not freeze in its hold distance while retreating)', () => {
    const { gained } = retreatAfterSwing(1.7);
    expect(gained).toBeGreaterThan(1.8);
  });

  it('comes back for more: repeated hit-and-run cycles, each swing landing', () => {
    const w = arena();
    const fox = put(w, 'fox', 0, 3);
    const recs = run(w, 60 * 12);
    const attacks = of(recs, 'enemyAttack').filter((r) => r.ev.enemy === fox);
    expect(attacks.length).toBeGreaterThanOrEqual(3);
    expect(of(recs, 'playerHit').length).toBeGreaterThanOrEqual(2);
    // spacing: swing (0.25) + recover (0.4) + retreat (1.1–1.9) + the way back
    for (let i = 1; i < attacks.length; i++) expect(attacks[i]!.time - attacks[i - 1]!.time).toBeGreaterThan(1.3);
  });

  it('a plain chaser stays in the hero’s face after the same attack', () => {
    const w = arena();
    const wolf = put(w, 'wolf', 0, 1.9);
    let endTick = -1;
    let after = 0;
    run(w, 60 * 5, NO_INPUT, () => {
      if (endTick < 0 && stateOf(w, wolf) === EnemyState.Recover) endTick = w.tick;
      if (endTick > 0 && w.tick === endTick + 66) after = distToHero(w, wolf);
    });
    expect(endTick).toBeGreaterThan(0);
    expect(after).toBeLessThan(2.4);
  });
});

// ---------------------------------------------------------------------------
// explode

describe('explode (bomb imp)', () => {
  it('telegraphs a circle, then blows up after 0.8 s: damage ×3 inside the area, the imp dies (no killer)', () => {
    const w = arena();
    const id = put(w, 'bomb_imp', 0, 2.0);
    onlyAttack(w, id, 0);
    const alive0 = w.spawner.alive;
    expect(alive0).toBe(1);
    let start = -1;
    const recs = run(w, 120, NO_INPUT, () => {
      if (start < 0 && attackedNow(w, id)) start = w.tick;
    });
    expect(start).toBe(1);
    const attack = of(recs, 'enemyAttack')[0]!;
    expect(attack.ev.kind).toBe(KIND.explode);
    const tele = of(recs, 'telegraph')[0]!;
    expect(tele.ev.shape).toBe(TelegraphShape.Circle);
    expect(tele.ev.a).toBeCloseTo(3, 5);
    expect(tele.ev.dur).toBeCloseTo(0.8, 5);
    const death = of(recs, 'enemyDeath');
    expect(death.length).toBe(1);
    expect(death[0]!.ev.id).toBe(id);
    expect(death[0]!.ev.killer).toBe(-1);
    expect(death[0]!.tick - start).toBeGreaterThanOrEqual(48);
    expect(death[0]!.tick - start).toBeLessThanOrEqual(49);
    const hits = of(recs, 'playerHit');
    expect(hits.length).toBe(1);
    expect(hits[0]!.tick).toBe(death[0]!.tick);
    expect(hits[0]!.ev.amount).toBeCloseTo(felt(w, 6 * 3, 4), 4); // devil → dark
    expect(hits[0]!.ev.element).toBe(4);
    const boom = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_explode');
    expect(boom.length).toBe(1);
    expect(boom[0]!.ev.scale).toBeCloseTo(3, 5);
    // the row is gone at the end of the tick and the bookkeeping is consistent
    expect(w.enemies.find(id)).toBe(-1);
    expect(w.spawner.alive).toBe(alive0 - 1);
  });

  it('a hero outside the blast radius (3 m + body) is not hurt, but the imp still goes off', () => {
    const w = arena();
    const id = put(w, 'bomb_imp', 0, 2.0);
    onlyAttack(w, id, 0);
    expect(until(w, () => attackedNow(w, id), 5)).toBeGreaterThan(0);
    player(w).x = 6;
    const recs = run(w, 80);
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(of(recs, 'enemyDeath').length).toBe(1);
    expect(w.enemies.find(id)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// aura

describe('aura (plague rat)', () => {
  it('hurts the hero every 0.8 s while within range + bodies, with no windup state at all', () => {
    const w = arena();
    const id = put(w, 'plague_rat', 0, 2.8); // aura range 2.2 + rat 0.45 + hero 0.55 = 3.2
    let sawWindup = false;
    let iframesAtFirstHit = NaN;
    const recs = run(w, 60 * 6, NO_INPUT, () => {
      if (stateOf(w, id) === EnemyState.Windup) sawWindup = true;
      if (Number.isNaN(iframesAtFirstHit) && w.events.some((e) => e.t === 'playerHit')) iframesAtFirstHit = player(w).iframes;
    });
    expect(sawWindup).toBe(false);
    expect(iframesAtFirstHit).toBeCloseTo(0.25, 5); // a hazard-type tick only grants 0.25 s of i-frames
    expect(sawWindup).toBe(false);
    const hits = of(recs, 'playerHit');
    expect(hits.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.time - hits[i - 1]!.time).toBeCloseTo(0.8, 1);
    for (const h of hits) {
      expect(h.ev.amount).toBeCloseTo(felt(w, 5 * 0.4), 4);
      expect(h.ev.element).toBe(0);
    }
    // each pulse comes with an enemyAttack(aura) event on the very same tick
    const attacks = of(recs, 'enemyAttack').filter((r) => r.ev.kind === KIND.aura);
    expect(attacks.length).toBe(hits.length);
    attacks.forEach((a, i) => expect(a.tick).toBe(hits[i]!.tick));
    // and it kept walking in meanwhile (chase archetype): held at ≈ 1.75 m
    expect(distToHero(w, id)).toBeLessThan(2.1);
  });

  it('does nothing outside its range and starts at once when the hero walks in', () => {
    const w = arena();
    const id = put(w, 'plague_rat', 0, 6, { speedMul: 0 });
    const far = run(w, 60 * 3);
    expect(of(far, 'playerHit').length).toBe(0);
    expect(of(far, 'enemyAttack').length).toBe(0);
    expect(id).not.toBe(0);
    player(w).z = 3.5; // now 2.5 m away
    const near = run(w, 3);
    expect(of(near, 'playerHit').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// breath

describe('breath (ember lizard)', () => {
  /** lizard 5 m north, breath ready; returns the id once the windup began */
  function lizardAtWindup(w: World): number {
    const id = put(w, 'ember_lizard', 0, 5);
    onlyAttack(w, id, 0);
    expect(until(w, () => attackedNow(w, id), 10)).toBeGreaterThan(0);
    return id;
  }

  it('telegraphs a cone (length = range, full angle = 2·atan(area/range)), burns the hero inside it after 0.8 s', () => {
    const w = arena();
    const id = put(w, 'ember_lizard', 0, 5);
    onlyAttack(w, id, 0);
    let start = -1;
    const recs = run(w, 90, NO_INPUT, () => {
      if (start < 0 && attackedNow(w, id)) start = w.tick;
    });
    const attack = of(recs, 'enemyAttack')[0]!;
    expect(attack.ev.kind).toBe(KIND.breath);
    const tele = of(recs, 'telegraph')[0]!;
    expect(tele.ev.shape).toBe(TelegraphShape.Cone);
    expect(tele.ev.a).toBeCloseTo(6, 5);
    expect(tele.ev.b).toBeCloseTo(2 * Math.atan2(2.5, 6), 4);
    expect(tele.ev.dur).toBeCloseTo(0.8, 5);
    const hits = of(recs, 'playerHit');
    expect(hits.length).toBe(1);
    expect(hits[0]!.tick - start).toBeGreaterThanOrEqual(48);
    expect(hits[0]!.tick - start).toBeLessThanOrEqual(49);
    expect(hits[0]!.ev.amount).toBeCloseTo(felt(w, 8 * 1.2, 1), 4);
    expect(hits[0]!.ev.element).toBe(1); // fire race → fire element
    const vfx = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_breath');
    expect(vfx.length).toBe(1);
    expect(vfx[0]!.ev.scale).toBeCloseTo(6, 5);
  });

  it('only the hero inside the cone is hit: lateral 1.5 m yes, lateral 3.5 m no, behind the lizard no', () => {
    const inside = arena();
    lizardAtWindup(inside);
    player(inside).x = 1.5; // 16° off the locked axis
    expect(of(run(inside, 60), 'playerHit').length).toBe(1);

    const outside = arena();
    lizardAtWindup(outside);
    player(outside).x = 3.5; // 35° off the axis, beyond half-angle 22.8° + body slack
    expect(of(run(outside, 60), 'playerHit').length).toBe(0);

    const behind = arena();
    lizardAtWindup(behind);
    player(behind).z = 9; // behind the lizard (it faces -Z)
    expect(of(run(behind, 60), 'playerHit').length).toBe(0);

    const tooFar = arena();
    lizardAtWindup(tooFar);
    player(tooFar).z = -2.5; // 7.5 m on the axis > 6 + hero body 0.55
    expect(of(run(tooFar, 60), 'playerHit').length).toBe(0);
  });

  it('keeps its distance like a ranged unit (preferred 0.75 × range = 4.5 m)', () => {
    const w = arena();
    const id = put(w, 'ember_lizard', 0, 9);
    const dists: number[] = [];
    run(w, 60 * 10, NO_INPUT, () => dists.push(distToHero(w, id)));
    const arrived = dists.findIndex((d) => d < 6.2);
    expect(arrived).toBeGreaterThan(0);
    expect(Math.min(...dists.slice(arrived))).toBeGreaterThan(3.5);
    expect(Math.max(...dists.slice(arrived))).toBeLessThan(6.6);
  });
});

// ---------------------------------------------------------------------------
// every attack kind announces itself

describe('enemyAttack events', () => {
  const CASES: { id: string; kind: number; atk: number; at: [number, number] }[] = [
    { id: 'wolf', kind: KIND.melee, atk: 0, at: [0, 2.0] },
    { id: 'spitter', kind: KIND.ranged, atk: 0, at: [0, 7] },
    { id: 'boar_charger', kind: KIND.charge, atk: 0, at: [0, 6] },
    { id: 'bear', kind: KIND.leap, atk: 1, at: [0, 5] },
    { id: 'bomb_imp', kind: KIND.explode, atk: 0, at: [0, 2] },
    { id: 'plague_rat', kind: KIND.aura, atk: 0, at: [0, 2.5] },
    { id: 'ember_lizard', kind: KIND.breath, atk: 0, at: [0, 5] },
  ];
  it.each(CASES)('$id fires kind $kind with its position and a unit direction at the hero', ({ id, kind, atk, at }) => {
    const w = arena();
    const e = put(w, id, at[0], at[1]);
    onlyAttack(w, e, atk);
    expect(until(w, () => attackedNow(w, e), 20)).toBeGreaterThan(0);
    const ev = w.events.find((x) => x.t === 'enemyAttack' && x.enemy === e);
    expect(ev && ev.t === 'enemyAttack').toBe(true);
    if (!ev || ev.t !== 'enemyAttack') return;
    expect(ev.kind).toBe(kind);
    expect(ev.type).toBe(typeOf(w, id));
    const q = posOf(w, e);
    expect(Math.hypot(ev.x - q.x, ev.z - q.z)).toBeLessThan(0.3);
    expect(Math.hypot(ev.dirX, ev.dirZ)).toBeCloseTo(1, 4);
    // direction = from the enemy to the hero
    const toHero = Math.hypot(q.x, q.z);
    expect(ev.dirX).toBeCloseTo(-q.x / toHero, 2);
    expect(ev.dirZ).toBeCloseTo(-q.z / toHero, 2);
  });
});

// ---------------------------------------------------------------------------
// crowd control and statuses

describe('statuses on enemies', () => {
  const CC = [
    ['stun', StatusIdx.Stun, StatusBit.Stun],
    ['freeze', StatusIdx.Freeze, StatusBit.Freeze],
  ] as const;

  it.each(CC)('%s during a windup cancels the attack: no damage, and the enemy is out of action for the duration', (_name, kind, bit) => {
    const w = arena();
    const id = put(w, 'wolf', 0, 2.0);
    expect(until(w, () => attackedNow(w, id), 120)).toBeGreaterThan(0);
    expect(stateOf(w, id)).toBe(EnemyState.Windup);
    applyStatus(w, rowOf(w, id), kind, 1.0, 1, -1, false);
    expect((w.enemies.status[rowOf(w, id)]! & bit) !== 0).toBe(true);
    const p0 = posOf(w, id);
    const hp = player(w).hp;
    const recs: Rec[] = [];
    for (let k = 0; k < 55; k++) {
      recs.push(...run(w, 1));
      expect(stateOf(w, id)).toBe(EnemyState.Stunned);
    }
    // the swing would have landed after 18 ticks: nothing happened
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(player(w).hp).toBe(hp);
    expect(posOf(w, id).z).toBeCloseTo(p0.z, 4);
    expect(of(recs, 'enemyAttack').length).toBe(0);
    // afterwards it is back in the fight (and attacks anew)
    const rest = run(w, 60 * 3);
    expect(of(rest, 'enemyAttack').length).toBeGreaterThan(0);
    expect(of(rest, 'playerHit').length).toBeGreaterThan(0);
  });

  it('a stunned charger stops dead mid-dash and deals no contact damage', () => {
    const w = arena();
    const id = put(w, 'boar_charger', 0, 14);
    expect(until(w, () => stateOf(w, id) === EnemyState.Dash, 400)).toBeGreaterThan(0);
    run(w, 5);
    applyStatus(w, rowOf(w, id), StatusIdx.Stun, 2.0, 1, -1, false);
    run(w, 1);
    const frozenAt = posOf(w, id);
    expect(stateOf(w, id)).toBe(EnemyState.Stunned);
    const recs = run(w, 60);
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(posOf(w, id).z).toBeCloseTo(frozenAt.z, 4);
  });

  it('a stunned bomb imp does not detonate while stunned', () => {
    const w = arena();
    const id = put(w, 'bomb_imp', 0, 2.0);
    onlyAttack(w, id, 0);
    run(w, 5);
    applyStatus(w, rowOf(w, id), StatusIdx.Stun, 1.2, 1, -1, false);
    const recs = run(w, 66); // longer than its 0.8 s fuse
    expect(of(recs, 'enemyDeath').length).toBe(0);
    expect(of(recs, 'playerHit').length).toBe(0);
    expect(w.enemies.find(id)).toBeGreaterThanOrEqual(0);
  });

  it('slow scales movement speed by (1 − power), capped at −80%, and wears off', () => {
    const w = arena();
    const a = put(w, 'wolf', 0, 30);
    const b = put(w, 'wolf', 30, 0);
    const c = put(w, 'wolf', -30, 0);
    const base = (id: number): number => w.enemies.baseSpeed[rowOf(w, id)] as number;
    applyStatus(w, rowOf(w, a), StatusIdx.Slow, 3, 0.5, -1, false);
    applyStatus(w, rowOf(w, b), StatusIdx.Slow, 3, 0.95, -1, false);
    const a0 = posOf(w, a);
    const b0 = posOf(w, b);
    const c0 = posOf(w, c);
    run(w, 60);
    expect(w.enemies.speed[rowOf(w, a)]).toBeCloseTo(base(a) * 0.5, 4);
    expect(w.enemies.speed[rowOf(w, b)]).toBeCloseTo(base(b) * 0.2, 4); // power capped at 0.8
    expect(a0.z - posOf(w, a).z).toBeCloseTo(base(a) * 0.5, 1);
    expect(b0.x - posOf(w, b).x).toBeCloseTo(base(b) * 0.2, 1);
    expect(posOf(w, c).x - c0.x).toBeCloseTo(base(c), 1); // unslowed reference
    // the slow expires after its duration: full speed again
    run(w, 60 * 3);
    expect(w.enemies.status[rowOf(w, a)]).toBe(0);
    run(w, 2);
    expect(w.enemies.speed[rowOf(w, a)]).toBeCloseTo(base(a), 4);
  });

  it('stun and freeze wear off by themselves and the enemy resumes chasing', () => {
    const w = arena();
    const id = put(w, 'wolf', 0, 15);
    applyStatus(w, rowOf(w, id), StatusIdx.Freeze, 0.5, 1, -1, false);
    run(w, 20);
    expect(stateOf(w, id)).toBe(EnemyState.Stunned);
    expect(posOf(w, id).z).toBeCloseTo(15, 3);
    run(w, 30);
    run(w, 30);
    expect(stateOf(w, id)).toBe(EnemyState.Move);
    expect(posOf(w, id).z).toBeLessThan(15 - 0.5);
  });
});

// ---------------------------------------------------------------------------
// corruption, spawn-in, arena

describe('corrupted enemies', () => {
  /** the metin system re-derives corruption every few ticks, so pin the level before every tick */
  function pinCorruption(w: World, id: number, level: number): () => void {
    return () => {
      const r = w.enemies.find(id);
      if (r >= 0) w.enemies.corrupted[r] = level;
    };
  }

  it('move faster (×(1 + 0.42·c)) than clean ones', () => {
    const w = arena();
    const clean = put(w, 'wolf', 0, 30);
    const dirty = put(w, 'wolf', 30, 0);
    const row = rowOf(w, dirty);
    w.enemies.baseSpeed[rowOf(w, clean)] = w.enemies.baseSpeed[row] as number; // same variance for a fair comparison
    const pin = pinCorruption(w, dirty, 0.5);
    pin();
    run(w, 60, NO_INPUT, pin);
    const c = 30 - posOf(w, clean).z;
    const d = 30 - posOf(w, dirty).x;
    expect(d / c).toBeCloseTo(1.21, 2);
    expect(w.enemies.speed[rowOf(w, dirty)]).toBeCloseTo((w.enemies.baseSpeed[rowOf(w, dirty)] as number) * 1.21, 4);
    expect(w.enemies.speed[rowOf(w, clean)]).toBeCloseTo(w.enemies.baseSpeed[rowOf(w, clean)] as number, 4);
  });

  it('hit harder (×(1 + 0.42·c))', () => {
    const hit = arena();
    const h = put(hit, 'wolf', 0, 2.0);
    const pin = pinCorruption(hit, h, 1);
    pin();
    const recs = run(hit, 200, NO_INPUT, pin);
    const first = of(recs, 'playerHit')[0]!;
    expect(first.ev.amount).toBeCloseTo(felt(hit, 6 * 1.42), 4);
  });
});

describe('spawn-in animation', () => {
  it('a spawning enemy is inert for SPAWN_TIME (0.45 s): no movement, no attack, no damage, then it starts to act', () => {
    const w = arena();
    const id = eid(w, spawn(w, 'wolf', 0, 1.6, { spawnTime: 0.45 }));
    expect(stateOf(w, id)).toBe(EnemyState.Spawn);
    const p0 = posOf(w, id);
    const recs: Rec[] = [];
    for (let k = 0; k < 26; k++) {
      recs.push(...run(w, 1));
      expect(stateOf(w, id)).toBe(EnemyState.Spawn);
      expect(posOf(w, id)).toEqual(p0);
    }
    expect(of(recs, 'enemyAttack').length).toBe(0);
    expect(of(recs, 'playerHit').length).toBe(0);
    recs.push(...run(w, 3));
    expect(stateOf(w, id)).not.toBe(EnemyState.Spawn);
    // 0.45 s of spawn + the staggered first-attack delay (≥ 0.4 s from spawn) + 0.3 s windup
    const later = run(w, 120);
    expect(of(later, 'playerHit').length).toBeGreaterThan(0);
    expect(of(later, 'playerHit')[0]!.time).toBeGreaterThan(0.45 + 0.3 - 0.1);
  });

  it('is untargetable while spawning (constants.ts: "harmless/untargetable"): skills neither aim at it nor damage it', () => {
    const w = arena();
    const arc = giveSkill(w, 'sword_arc'); // would normally swing at tick ~16, well inside the 0.45 s spawn-in
    const id = eid(w, spawn(w, 'wolf', 0, 2.0, { spawnTime: 0.45 }));
    const hp0 = w.enemies.hp[rowOf(w, id)] as number;
    const recs: Rec[] = [];
    for (let k = 0; k < 26; k++) {
      recs.push(...run(w, 1));
      expect(stateOf(w, id)).toBe(EnemyState.Spawn);
    }
    expect(of(recs, 'damage').length).toBe(0);
    expect(of(recs, 'skillCast').filter((r) => r.ev.skill === arc.slot).length).toBe(0);
    expect(w.enemies.hp[rowOf(w, id)]).toBe(hp0);
    // once it has finished spawning it is a normal target again
    const later = run(w, 60);
    expect(of(later, 'damage').length).toBeGreaterThan(0);
  });
});

describe('arena bounds and relocation', () => {
  it('enemies are kept inside the arena (radius − 0.5), even when knocked outward', () => {
    const w = arena();
    player(w).x = 140;
    const id = put(w, 'wolf', 146, 0, { speedMul: 0 });
    knockEnemy(w, rowOf(w, id), 60, 100, 0, false);
    let maxR = 0;
    run(w, 90, NO_INPUT, () => {
      const q = posOf(w, id);
      maxR = Math.max(maxR, Math.hypot(q.x, q.z));
    });
    expect(maxR).toBeLessThanOrEqual(w.arenaRadius - 0.5 + 1e-3);
    expect(maxR).toBeGreaterThan(w.arenaRadius - 1.5); // it really did hit the wall
    expect(Math.hypot(posOf(w, id).x, posOf(w, id).z)).toBeCloseTo(w.arenaRadius - 0.5, 2);
  });

  it('a skirmisher retreating toward the wall runs into it and is stopped there', () => {
    const w = arena();
    player(w).x = 146;
    const fox = put(w, 'fox', 148, 0); // 2 m from the hero, 1.5 m from the wall
    onlyAttack(w, fox, 0);
    let maxR = 0;
    run(w, 60 * 4, NO_INPUT, () => {
      const q = posOf(w, fox);
      maxR = Math.max(maxR, Math.hypot(q.x, q.z));
    });
    expect(maxR).toBeLessThanOrEqual(w.arenaRadius - 0.5 + 1e-3);
    expect(maxR).toBeGreaterThan(w.arenaRadius - 0.6); // it really reached the wall
  });

  it('enemies farther than 58 m from every hero are moved back onto the 31–38 m spawn ring', () => {
    const w = arena();
    const id = put(w, 'wolf', 100, 0, { speedMul: 0 });
    run(w, 25);
    const d = distToHero(w, id);
    expect(d).toBeGreaterThan(30.9);
    expect(d).toBeLessThan(38.1);
    // within range they are left alone
    const near = put(w, 'wolf', 50, 0, { speedMul: 0 });
    const n0 = posOf(w, near);
    run(w, 60);
    expect(posOf(w, near)).toEqual(n0);
  });

  it('bosses and pinned enemies are never relocated', () => {
    const w = arena();
    const pinned = put(w, 'wolf', 100, 0, { speedMul: 0, flags: EnemyFlag.Pinned });
    run(w, 60);
    expect(posOf(w, pinned).x).toBeCloseTo(100, 3);
  });
});

// ---------------------------------------------------------------------------
// targeting

describe('target selection', () => {
  const coop: Partial<RunConfig> = {
    coop: [{ classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } }],
  };

  it('with several heroes each enemy goes for the nearest one and re-targets when things change', () => {
    const w = arena({ config: coop });
    for (const p of w.players) {
      p.fixed.push({ maxHp: 1e6 });
      refreshStats(p, w.content, w.ix);
    }
    const [p0, p1] = w.players as [typeof w.players[number], typeof w.players[number]];
    p0.x = -30;
    p0.z = 0;
    p1.x = 30;
    p1.z = 0;
    const id = put(w, 'wolf', 20, 0, { speedMul: 1 });
    const startX = posOf(w, id).x;
    run(w, 40, NO_INPUT);
    expect(posOf(w, id).x).toBeGreaterThan(startX); // toward hero 1 at +30
    // hero 1 teleports away: the wolf re-targets (within 20 ticks) and turns around
    p1.x = 100;
    run(w, 25);
    const mid = posOf(w, id).x;
    run(w, 40);
    expect(posOf(w, id).x).toBeLessThan(mid);
  });

  it('a dead hero is dropped from targeting at once; with everybody dead enemies idle', () => {
    const w = arena({ config: coop });
    const [p0, p1] = w.players as [typeof w.players[number], typeof w.players[number]];
    p0.x = -30;
    p0.z = 0;
    p1.x = 30;
    p1.z = 0;
    const id = put(w, 'wolf', 20, 0);
    run(w, 5);
    p1.alive = false;
    const mid = posOf(w, id).x;
    run(w, 40);
    expect(posOf(w, id).x).toBeLessThan(mid); // now heading for hero 0 at -30
    p0.alive = false;
    const idle = posOf(w, id);
    run(w, 30);
    expect(posOf(w, id)).toEqual(idle);
  });
});

describe('sanity', () => {
  it('a mixed crowd running for 20 s stays finite, inside the arena and deterministic', () => {
    const build = (): World => {
      const w = arena({ seed: 77 });
      const types = ['wolf', 'spitter', 'boar_charger', 'jackal', 'bear', 'fox', 'bomb_imp', 'plague_rat', 'ember_lizard'];
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        spawn(w, types[i % types.length]!, Math.sin(a) * (14 + (i % 5)), Math.cos(a) * (14 + (i % 5)));
      }
      w.players[0]!.xpNext = 1e12;
      return w;
    };
    const a = build();
    const b = build();
    for (let k = 0; k < 1200; k++) {
      a.step([NO_INPUT]);
      b.step([NO_INPUT]);
    }
    const dig = (w: World): string => {
      let h = 0;
      for (let i = 0; i < w.enemies.count; i++) h += (w.enemies.x[i] as number) * 1.7 + (w.enemies.z[i] as number) * 3.3;
      return `${w.enemies.count}|${w.tally.kills}|${player(w).hp.toFixed(3)}|${h.toFixed(3)}`;
    };
    expect(dig(a)).toBe(dig(b));
    for (let i = 0; i < a.enemies.count; i++) {
      expect(Number.isFinite(a.enemies.x[i] as number)).toBe(true);
      expect(Math.hypot(a.enemies.x[i] as number, a.enemies.z[i] as number)).toBeLessThanOrEqual(a.arenaRadius);
    }
    expect(PLAYER_RADIUS).toBeGreaterThan(0);
    expect(TelegraphAct.Visual).toBe(0);
  });
});
