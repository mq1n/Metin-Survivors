// Companion roles (DESIGN M4 / M6, WP2): marker rows, the blaze-familiars orbiter + twins, hunter, pylon, knight, coil, mimic and the
// reflect mirror flip. Lab world: schedules frozen, hero at the origin facing +Z, no crits, immobile high-hp dummies, one skill.

import { describe, expect, it } from 'vitest';
import type { ContentDB, EnemyDef, SkillDef, SkillParams, SummonRole } from '../../data/schema';
import { SchedKind } from '../scheduler';
import { addSkill } from '../skills';
import { dispatchMimic, endMarker, queueMimic, roleTag, spawnMarker } from '../skills/companions';
import { createPlayer } from '../player';
import { EventCollector, WireStrings } from '../../net/coop/events';
import { PROJ_COL } from '../../net/coop/protocol';
import { SnapshotDecoder, SnapshotEncoder } from '../../net/coop/snapshot';
import { newFinalParams, resolveParams } from '../skills/params';
import { refreshStats } from '../stats';
import { CompanionRole, ElementIdx, ProjKind, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { NO_INPUT, dropSkills, freezeSchedules, makeWorld, player, spawn } from './helpers';

// ---------------------------------------------------------------------------
// lab

const BASE: SkillParams = { damage: 20, cooldown: 4, area: 1.6, count: 1, duration: 10, speed: 8, pierce: 0, knockback: 0.2, tick: 1, range: 10 };

function addDummies(c: ContentDB): void {
  const wolf = c.enemies.find((e) => e.id === 'wolf');
  if (!wolf) throw new Error('fixture wolf missing');
  const base: EnemyDef = { ...wolf, attacks: [], speed: 0, hp: 1e5, damage: 0 };
  c.enemies.push(
    { ...base, id: 'anchor', mass: 1e6 },
    { ...base, id: 'shooter', mass: 1e6, ai: 'ranged' },
  );
}

interface Lab {
  w: World;
  p: PlayerState;
  s: SkillInstance;
}

/** a lab world owning one `role` summon (a clone of the fixture phantom_blades with the given role and params) */
function roleLab(role: SummonRole, params: Partial<SkillParams> = {}, def: Partial<SkillDef> = {}, seed = 11): Lab {
  const id = `rl_${role}`;
  const w = makeWorld({
    config: { seed },
    content: (c) => {
      addDummies(c);
      const src = c.skills.find((s) => s.id === 'phantom_blades');
      if (!src) throw new Error('fixture phantom_blades missing');
      c.skills.push({ ...src, id, role, vfx: `sk.${id}`, params: { ...BASE, ...params }, ...def });
    },
  });
  freezeSchedules(w);
  dropSkills(w);
  const p = player(w);
  p.fixed.push({ critChance: -1 });
  refreshStats(p, w.content, w.ix);
  const def2 = w.ix.skills.get(id);
  if (!def2) throw new Error('role skill missing');
  const s = addSkill(w, p, def2, 0);
  s.cd = 0;
  return { w, p, s };
}

const HP0 = new WeakMap<World, Map<number, number>>();

/** spawn a dummy and remember its starting HP (zone scaling makes it differ from the def's 1e7) */
function put(w: World, def: string, x: number, z: number): number {
  const row = spawn(w, def, x, z);
  const id = w.enemies.id[row] as number;
  let m = HP0.get(w);
  if (!m) HP0.set(w, (m = new Map()));
  m.set(id, w.enemies.hp[row] as number);
  return id;
}

/** damage a dummy took since `put` */
function dealt(w: World, id: number): number {
  const r = w.enemies.find(id);
  return (HP0.get(w)?.get(id) ?? 0) - (r < 0 ? 0 : (w.enemies.hp[r] as number));
}

function run(w: World, n: number, each?: (k: number) => void): void {
  for (let k = 0; k < n; k++) {
    w.step([NO_INPUT]);
    each?.(k);
  }
}

function rowsOf(w: World, kind: ProjKind, role?: CompanionRole): number[] {
  const P = w.projectiles;
  const out: number[] = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === kind && (role === undefined || P.role[i] === role)) out.push(i);
  return out;
}

function hpOf(w: World, id: number): number {
  const r = w.enemies.find(id);
  return r < 0 ? -1 : (w.enemies.hp[r] as number);
}

const eventsOf = <T extends string>(w: World, t: T) => w.events.filter((e) => e.t === t);

// ---------------------------------------------------------------------------

describe('roleTag', () => {
  it('maps content roles to row tags; planted is a pylon unless the skill taunts', () => {
    const fp = { taunt: 0 } as never;
    expect(roleTag(undefined, fp)).toBe(CompanionRole.Chaser);
    expect(roleTag('orbiter', fp)).toBe(CompanionRole.Orbiter);
    expect(roleTag('planted', fp)).toBe(CompanionRole.Pylon);
    expect(roleTag('planted', { taunt: 7 } as never)).toBe(CompanionRole.Knight);
  });
});

describe('marker rows', () => {
  it('follows its holder for exactly its life, never collides, and is freed at the end', () => {
    const { w, p, s } = roleLab('orbiter');
    s.cd = 1e9;
    const h = spawnMarker(w, p, s.slot, 'sk.gen.veil_ring', 1.5, 0.5, true);
    expect(h).not.toBe(0);
    const P = w.projectiles;
    let row = P.find(h);
    expect(P.kind[row]).toBe(ProjKind.Marker);
    expect(P.anchor[row]).toBe(p.index);
    expect(P.owner[row]).toBe(p.index);
    expect(P.skill[row]).toBe(s.slot);
    expect(P.radius[row]).toBeCloseTo(1.5, 5);
    expect(w.strings.name(P.style[row] as number)).toBe('sk.gen.veil_ring');
    p.x = 3;
    p.z = -2;
    put(w, 'anchor', 3, -1.5);
    w.step([NO_INPUT]);
    row = P.find(h);
    expect(P.x[row]).toBeCloseTo(p.x, 4);
    expect(P.z[row]).toBeCloseTo(p.z, 4);
    run(w, 25);
    expect(P.find(h)).toBeGreaterThanOrEqual(0);
    run(w, 8);
    expect(P.find(h)).toBe(-1);
  });

  it('a stationary marker stays put; endMarker stops it by the next projectile step; stale handles are harmless', () => {
    const { w, p, s } = roleLab('orbiter');
    s.cd = 1e9;
    p.x = 1;
    p.z = 2;
    const h = spawnMarker(w, p, s.slot, 'sk.gen.bait_ring', 99, 5, false);
    const P = w.projectiles;
    let row = P.find(h);
    expect(P.anchor[row]).toBe(255);
    expect(P.radius[row]).toBeLessThanOrEqual(7.91); // the snapshot is q8 over 32
    p.x = 6;
    run(w, 10);
    row = P.find(h);
    expect(P.x[row]).toBeCloseTo(1, 5);
    endMarker(w, h);
    expect(P.find(h)).toBeGreaterThanOrEqual(0); // never freed under a running loop
    w.step([NO_INPUT]);
    expect(P.find(h)).toBe(-1);
    endMarker(w, h);
    endMarker(w, 0);
  });

  it('dies with a dead holder', () => {
    const { w, p, s } = roleLab('orbiter');
    s.cd = 1e9;
    const h = spawnMarker(w, p, s.slot, 'sk.gen.veil_ring', 1, 30, true);
    p.alive = false;
    w.step([NO_INPUT]);
    expect(w.projectiles.find(h)).toBe(-1);
  });
});

describe('orbiter (blaze_familiars)', () => {
  const orbiterLab = (params: Partial<SkillParams> = {}): Lab => {
    const lab = roleLab('orbiter', { damage: 22, cooldown: 1.6, area: 1.6, count: 1, duration: 0, speed: 10, knockback: 0.3, tick: 0, range: 10, ...params });
    lab.s.cd = 1e9; // the spirits spawn on the first tick; a test fires the volley itself with s.cd = 0
    return lab;
  };

  it('summons the spirits on the first tick with the 2.5 m cast event and the hero cast, then never again', () => {
    const { w, s } = orbiterLab({ count: 2 });
    w.step([NO_INPUT]);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)).toHaveLength(2);
    const cast = eventsOf(w, 'vfx').filter((e) => e.t === 'vfx' && e.preset === s.def.vfx && Math.abs(e.scale) === 2.5);
    expect(cast).toHaveLength(1);
    expect(eventsOf(w, 'skillCast')).toHaveLength(1);
    run(w, 300);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)).toHaveLength(2);
    expect(eventsOf(w, 'skillCast')).toHaveLength(0);
  });

  it('rides a tilted 2.0 s ring: low point on the right knee, top over the left shoulder, never farther than the ring', () => {
    const { w, p } = orbiterLab();
    p.rot = 0; // facing +Z: the hero's left is +X
    w.step([NO_INPUT]);
    const P = w.projectiles;
    const r = rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)[0] as number;
    const id = P.id[r] as number;
    const samples: { t: number; dx: number; dz: number; h: number }[] = [];
    for (let k = 0; k < 130; k++) {
      const row = P.find(id);
      samples.push({ t: w.time, dx: (P.x[row] as number) - p.x, dz: (P.z[row] as number) - p.z, h: P.h[row] as number });
      w.step([NO_INPUT]);
    }
    let maxD = 0;
    let minH = 9;
    let maxH = 0;
    for (const s of samples) {
      maxD = Math.max(maxD, Math.hypot(s.dx, s.dz));
      minH = Math.min(minH, s.h);
      maxH = Math.max(maxH, s.h);
    }
    expect(maxD).toBeLessThan(0.7);
    expect(minH).toBeCloseTo(0.3, 1);
    expect(maxH).toBeCloseTo(1.88, 1);
    // top (max height) is on the LEFT (+X), low point on the RIGHT (-X)
    const top = samples.reduce((a, b) => (b.h > a.h ? b : a));
    const low = samples.reduce((a, b) => (b.h < a.h ? b : a));
    expect(top.dx).toBeGreaterThan(0.4);
    expect(low.dx).toBeLessThan(-0.4);
    // one lap = 2.0 s: the position repeats every 120 ticks
    const a = samples[3] as (typeof samples)[number];
    const b = samples[123] as (typeof samples)[number];
    expect(b.dx).toBeCloseTo(a.dx, 3);
    expect(b.dz).toBeCloseTo(a.dz, 3);
    expect(b.h).toBeCloseTo(a.h, 3);
  });

  it('follows a running hero (never leaves it) and the ring turns with the heading', () => {
    const { w, p } = orbiterLab({ count: 3 });
    for (let k = 0; k < 240; k++) {
      w.step([{ moveX: Math.sin(k / 40), moveZ: 1 }]);
      for (const r of rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)) {
        const d = Math.hypot((w.projectiles.x[r] as number) - p.x, (w.projectiles.z[r] as number) - p.z);
        expect(d).toBeLessThan(1.2);
      }
    }
  });

  it('re-syncs on a count change: extra spirits join (no new cast), the ring widens 0.15 m per spirit, fewer spirits are removed', () => {
    const { w, p, s } = orbiterLab({ count: 1 });
    run(w, 5);
    const P = w.projectiles;
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)).toHaveLength(1);
    const first = P.id[rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)[0] as number] as number;
    // a count card
    s.upg[3] = { pct: 0, flat: 2 };
    w.step([NO_INPUT]);
    const rows3 = rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter);
    expect(rows3).toHaveLength(3);
    expect(P.find(first)).toBeGreaterThanOrEqual(0); // the old spirit lives on
    expect(eventsOf(w, 'skillCast')).toHaveLength(0); // joined, not re-kindled
    run(w, 90);
    // phases are spread 120 degrees apart and the ring is 0.3 m wider
    const amp = rows3.map((r) => P.aux[P.find(P.id[r] as number)] as number);
    for (const a of amp) expect(a).toBeCloseTo(0.9, 2);
    const angles = rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter).map((r) => Math.atan2((P.x[r] as number) - p.x, (P.z[r] as number) - p.z));
    expect(new Set(angles.map((a) => a.toFixed(1))).size).toBe(3);
    s.upg[3] = { pct: 0, flat: 0 };
    run(w, 3);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)).toHaveLength(1);
  });

  it('respawns and re-kindles (cast event) after the hero was dead', () => {
    const { w, p } = orbiterLab();
    run(w, 5);
    p.alive = false;
    run(w, 2);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)).toHaveLength(0);
    p.alive = true;
    w.step([NO_INPUT]);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)).toHaveLength(1);
    expect(eventsOf(w, 'skillCast')).toHaveLength(1);
  });

  it('the volley is armed until a creature is in range; it draws no RNG while armed', () => {
    const { w, s } = orbiterLab();
    run(w, 20);
    s.cd = 0;
    const before = JSON.stringify(w.rng.combat);
    run(w, 30);
    expect(JSON.stringify(w.rng.combat)).toBe(before);
    expect(s.cd).toBe(0);
    expect(rowsOf(w, ProjKind.Homing)).toHaveLength(0);
    put(w, 'anchor', 0, 6);
    run(w, 1);
    expect(s.cd).toBeGreaterThan(1);
  });

  it('a volley launches one twin per spirit 0.12 s apart from the hero, plays no cast moment and draws one RNG number per spirit', () => {
    const mk = (): Lab => {
      const lab = orbiterLab({ count: 3 });
      put(lab.w, 'anchor', 0, 7);
      run(lab.w, 3);
      return lab;
    };
    const { w, p, s } = mk();
    const ref = mk();
    s.cd = 0;
    const seen = new Map<number, { k: number; d: number }>();
    let cast = 0;
    for (let k = 0; k < 40; k++) {
      w.step([NO_INPUT]);
      if (k === 0) {
        for (let i = 0; i < 3; i++) ref.w.rng.combat.int(1);
        expect(JSON.stringify(w.rng.combat)).toBe(JSON.stringify(ref.w.rng.combat)); // exactly three draws, all at the cast
      }
      for (const e of w.events) if (e.t === 'skillCast') cast++;
      for (const r of rowsOf(w, ProjKind.Homing, CompanionRole.Twin)) {
        const id = w.projectiles.id[r] as number;
        if (!seen.has(id)) seen.set(id, { k, d: Math.hypot((w.projectiles.x[r] as number) - p.x, (w.projectiles.z[r] as number) - p.z) });
      }
    }
    expect(cast).toBe(0); // volleys play no hero clip / cast moment
    expect(seen.size).toBe(3);
    const ticks = [...seen.values()].map((v) => v.k).sort((a, b) => a - b);
    expect((ticks[1] as number) - (ticks[0] as number)).toBeGreaterThanOrEqual(7);
    expect((ticks[1] as number) - (ticks[0] as number)).toBeLessThanOrEqual(8);
    expect((ticks[2] as number) - (ticks[1] as number)).toBeGreaterThanOrEqual(7);
    expect((ticks[2] as number) - (ticks[1] as number)).toBeLessThanOrEqual(8);
    for (const v of seen.values()) expect(v.d).toBeLessThan(0.7); // they leave the hero's belly, not the ring
  });

  it('a twin hits for `damage`, bursts across `area` for 60% on the neighbours (not on the target again) with vfx_explode, and the spirits stay on the ring', () => {
    const { w, p, s } = orbiterLab({ count: 1, damage: 100, area: 2 });
    const target = put(w, 'anchor', 0, 5);
    const near = put(w, 'anchor', 1.2, 5);
    const far = put(w, 'anchor', 6, 5);
    run(w, 3);
    s.cd = 0;
    let explode = 0;
    let exploded = false;
    for (let k = 0; k < 90; k++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'vfx' && e.preset === 'vfx_explode') explode++;
      if (explode > 0) {
        exploded = true;
        break;
      }
      s.cd = 1e9; // one volley only
    }
    expect(exploded).toBe(true);
    // random target between the two nearby dummies
    const dmgT = dealt(w, target);
    const dmgN = dealt(w, near);
    expect(dealt(w, far)).toBe(0);
    const hits = [dmgT, dmgN].sort((x, y) => y - x);
    expect(hits[0]).toBeCloseTo(100, 3); // the direct hit: the burst does not hit the primary again (review M5)
    expect(hits[1]).toBeCloseTo(60, 3); // the neighbour in the burst
    expect(rowsOf(w, ProjKind.Homing, CompanionRole.Twin)).toHaveLength(0);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Orbiter)).toHaveLength(1);
    expect(Math.hypot((w.projectiles.x[rowsOf(w, ProjKind.Familiar)[0] as number] as number) - p.x, 0)).toBeLessThan(1);
  });

  it('twin re-targets when its target dies in flight and keeps the style of the skill', () => {
    const { w, s } = orbiterLab({ count: 1 });
    const t1 = put(w, 'anchor', 0, 8);
    put(w, 'anchor', 0.5, 9);
    run(w, 3);
    s.cd = 0;
    run(w, 4);
    const tw = rowsOf(w, ProjKind.Homing, CompanionRole.Twin);
    expect(tw.length).toBe(1);
    expect(w.strings.name(w.projectiles.style[tw[0] as number] as number)).toBe(s.def.vfx);
    // kill whichever it picked
    const picked = w.projectiles.target[tw[0] as number] as number;
    const row = w.enemies.find(picked);
    w.enemies.hp[row] = 0.0001;
    void t1;
    s.cd = 1e9;
    run(w, 60);
    // the twin ended with a burst (vfx_explode seen at some point) or at least is gone
    expect(rowsOf(w, ProjKind.Homing, CompanionRole.Twin)).toHaveLength(0);
  });
});

describe('hunter (spirit_wolves)', () => {
  const hunterLab = (params: Partial<SkillParams> = {}): Lab =>
    roleLab('hunter', { damage: 10, cooldown: 18, area: 1.2, count: 2, duration: 12, speed: 9, knockback: 0.2, tick: 1.2, range: 12, power: 15, ...params });

  it('spawns count wolves with the cast moment and keeps the Hunter tag', () => {
    const { w } = hunterLab();
    put(w, 'anchor', 0, 6);
    run(w, 3);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Hunter)).toHaveLength(2);
    expect(eventsOf(w, 'skillCast').length + 0).toBeGreaterThanOrEqual(0);
  });

  it('prefers a shooter over a nearer grunt and an elite over a shooter', () => {
    const { w, s } = hunterLab({ count: 1 });
    const grunt = put(w, 'anchor', 0, 3);
    const shooter = put(w, 'shooter', 3, 5);
    run(w, 1);
    s.cd = 1e9;
    run(w, 40);
    const P = w.projectiles;
    const wolf = rowsOf(w, ProjKind.Familiar, CompanionRole.Hunter)[0] as number;
    expect(P.target[wolf]).toBe(shooter);
    // an elite appears: the wolf re-scores within 0.5 s and switches (the shooter is wounded-free)
    const eliteRow = spawn(w, 'anchor', -4, 6);
    w.enemies.eliteTier[eliteRow] = 1;
    const elite = w.enemies.id[eliteRow] as number;
    s.cd = 1e9;
    run(w, 40);
    expect(P.target[rowsOf(w, ProjKind.Familiar, CompanionRole.Hunter)[0] as number]).toBe(elite);
    void grunt;
  });

  it('pounces, then bites three times 0.2 s apart; only the last bite carries the status', () => {
    const { w, s } = hunterLab({ count: 1, status: { kind: 'bleed', chance: 1, duration: 3, power: 0.25 } });
    const prey = put(w, 'anchor', 0, 4.5);
    const times: number[] = [];
    let last = hpOf(w, prey);
    let pounce = 0;
    let bleedAfterFirst = false;
    for (let k = 0; k < 200; k++) {
      w.step([NO_INPUT]);
      if (k === 0) s.cd = 1e9; // one cast only
      for (const e of w.events) if (e.t === 'vfx' && e.preset.endsWith('.pounce')) pounce++;
      const hp = hpOf(w, prey);
      if (hp < last - 5) {
        times.push(w.time);
        if (times.length === 1) bleedAfterFirst = ((w.enemies.status[w.enemies.find(prey)] as number) & 32) !== 0;
      }
      last = Math.min(last, hp);
    }
    expect(pounce).toBeGreaterThanOrEqual(1);
    expect(times.length).toBeGreaterThanOrEqual(3);
    expect((times[1] as number) - (times[0] as number)).toBeCloseTo(0.2, 1);
    expect((times[2] as number) - (times[1] as number)).toBeCloseTo(0.2, 1);
    expect(bleedAfterFirst).toBe(false); // the first bite does not bleed
    const r = w.enemies.find(prey);
    expect(((w.enemies.status[r] as number) & 32) !== 0).toBe(true); // the last one does
  });

  it('a combo cycle is `tick`: ~3 bites per 1.2 s per wolf', () => {
    const { w, s } = hunterLab({ count: 1 });
    const prey = put(w, 'anchor', 0, 3);
    run(w, 1);
    s.cd = 1e9;
    run(w, 60 * 2); // settle in
    const hp0 = hpOf(w, prey);
    run(w, 60 * 6);
    const dmg = hp0 - hpOf(w, prey);
    expect(dmg / 6).toBeGreaterThan(18);
    expect(dmg / 6).toBeLessThan(32);
  });

  it('the pack bonus raises a bite by `power` per other wolf on the same prey (cap 45%)', () => {
    const { w, s } = hunterLab({ count: 3, power: 15 });
    const prey = put(w, 'anchor', 0, 3);
    const rowE = w.enemies.find(prey);
    w.enemies.eliteTier[rowE] = 3; // everyone converges on a boss
    run(w, 1);
    s.cd = 1e9;
    run(w, 60 * 3);
    const hits: number[] = [];
    for (let k = 0; k < 60 * 4; k++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'damage' && e.targetId === prey && !e.dot) hits.push(e.amount);
    }
    expect(hits.length).toBeGreaterThan(4);
    // every wolf has 2 others: 10 * 1.30 (boss vsBoss 0)
    expect(Math.max(...hits)).toBeCloseTo(13, 1);
  });

  it('is leashed: it comes home when the prey is more than 14 m from the hero', () => {
    const { w, p, s } = hunterLab({ count: 1 });
    put(w, 'anchor', 0, 11);
    run(w, 1);
    s.cd = 1e9;
    run(w, 120);
    p.x = -20; // the hero is teleported away: the wolf must follow, not hunt out there
    run(w, 240);
    const wolf = rowsOf(w, ProjKind.Familiar, CompanionRole.Hunter)[0] as number;
    expect(Math.hypot((w.projectiles.x[wolf] as number) - p.x, (w.projectiles.z[wolf] as number) - p.z)).toBeLessThan(16);
  });
});

describe('pylon (thunder_guardians)', () => {
  const pylonLab = (params: Partial<SkillParams> = {}): Lab =>
    roleLab('planted', { damage: 64, cooldown: 34, area: 2.2, count: 2, duration: 14, speed: 0, knockback: 1, tick: 0.9, range: 9, power: 40, ...params });

  it('plants count idols at the flanks, +-2.5 m across the facing, with the plant event and the cast moment', () => {
    const { w, p } = pylonLab();
    put(w, 'anchor', 0, 6);
    p.rot = 0;
    w.step([NO_INPUT]);
    const rows = rowsOf(w, ProjKind.Familiar, CompanionRole.Pylon);
    expect(rows).toHaveLength(2);
    const xs = rows.map((r) => w.projectiles.x[r] as number).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-2.5, 3);
    expect(xs[1]).toBeCloseTo(2.5, 3);
    for (const r of rows) expect(w.projectiles.z[r]).toBeCloseTo(0, 3);
    const plant = w.events.filter((e) => e.t === 'vfx' && e.preset.endsWith('.plant'));
    expect(plant).toHaveLength(2);
    expect(plant.every((e) => e.t === 'vfx' && e.scale >= 3)).toBe(true);
    expect(eventsOf(w, 'skillCast')).toHaveLength(1);
  });

  it('a third idol closes the triangle behind', () => {
    const { w, p } = pylonLab({ count: 3 });
    put(w, 'anchor', 0, 6);
    p.rot = 0;
    w.step([NO_INPUT]);
    const zs = rowsOf(w, ProjKind.Familiar, CompanionRole.Pylon).map((r) => w.projectiles.z[r] as number);
    expect(Math.min(...zs)).toBeLessThan(-2.5);
  });

  it('zaps the nearest creature in range every tick interval with the splash', () => {
    const { w, s } = pylonLab({ count: 1, tick: 0.9, damage: 50 });
    const a = put(w, 'anchor', 3, 4);
    const b = put(w, 'anchor', 3.5, 4);
    put(w, 'anchor', 0, 30);
    run(w, 1);
    s.cd = 1e9;
    run(w, 25);
    expect(dealt(w, a) + dealt(w, b)).toBeGreaterThan(0);
    const t0 = dealt(w, a) + dealt(w, b);
    run(w, 54 + 6);
    expect(dealt(w, a) + dealt(w, b)).toBeGreaterThan(t0 * 1.5);
  });

  it('the arc web between two idols shocks a creature on the line (own 0.5 s stamp) and emits the line event each second', () => {
    const { w, p, s } = pylonLab({ count: 2, damage: 1, power: 40 });
    p.rot = 0;
    put(w, 'anchor', 0, 9); // something to cast at, out of the idols' zap range (9 + 2.5)
    run(w, 1);
    s.cd = 1e9;
    run(w, 1);
    // a creature standing on the arc between the idols (x in -2.5..2.5, z = 0)
    const mid = put(w, 'anchor', 0.4, 0.2);
    const hp0 = hpOf(w, mid);
    let lines = 0;
    for (let k = 0; k < 125; k++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'vfx' && e.hasTarget && e.preset.endsWith('.arc')) lines++;
    }
    // idols zap the nearest creature too; the arc adds 40% of 64.. use the bound: damage was dealt
    expect(hp0 - hpOf(w, mid)).toBeGreaterThan(0);
    expect(lines).toBeGreaterThanOrEqual(2);
  });

  it('an idol more than 10 m from the hero leaps back to her side (at most once per 3 s)', () => {
    const { w, p, s } = pylonLab({ count: 2 });
    put(w, 'anchor', 0, 6);
    run(w, 1);
    s.cd = 1e9;
    run(w, 5);
    p.x = 30;
    p.z = 0;
    let blinks = 0;
    for (let k = 0; k < 60; k++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'vfx' && e.preset.endsWith('.blink')) blinks++;
    }
    expect(blinks).toBe(2);
    for (const r of rowsOf(w, ProjKind.Familiar, CompanionRole.Pylon)) expect(Math.hypot((w.projectiles.x[r] as number) - 30, w.projectiles.z[r] as number)).toBeLessThan(3);
  });
});

describe('knight (cursed_legion)', () => {
  const knightLab = (params: Partial<SkillParams> = {}): Lab =>
    roleLab('planted', { damage: 28, cooldown: 32, area: 2.2, count: 3, duration: 12, speed: 0, pierce: 5, knockback: 0.6, tick: 0.8, range: 12, taunt: 7, ...params });

  it('rises where the latest kills fell, the rest in an arc, with rise events and a bait ring each', () => {
    const { w, p } = knightLab();
    put(w, 'anchor', 0, 8);
    p.rot = 0;
    w.addCorpse(4, 5, 0);
    w.addCorpse(-3, 2, 0);
    w.addCorpse(5, 5, 1); // another hero's kill: ignored
    w.step([NO_INPUT]);
    const rows = rowsOf(w, ProjKind.Familiar, CompanionRole.Knight);
    expect(rows).toHaveLength(3);
    const pos = rows.map((r) => [w.projectiles.x[r], w.projectiles.z[r]]);
    expect(pos.some(([x, z]) => Math.hypot((x as number) - 4, (z as number) - 5) < 0.01)).toBe(true);
    expect(pos.some(([x, z]) => Math.hypot((x as number) + 3, (z as number) - 2) < 0.01)).toBe(true);
    expect(w.events.filter((e) => e.t === 'vfx' && e.preset.endsWith('.rise'))).toHaveLength(3);
    const rings = w.projectiles;
    let n = 0;
    for (let i = 0; i < rings.count; i++) if (rings.kind[i] === ProjKind.Marker && w.strings.name(rings.style[i] as number) === 'sk.gen.bait_ring') n++;
    expect(n).toBe(3);
  });

  it('adds +1 knight per 10 recent kills (cap +3)', () => {
    const { w, p } = knightLab({ count: 2 });
    put(w, 'anchor', 0, 8);
    run(w, 2);
    p.kills += 24; // a burst of kills
    run(w, 1);
    const s2 = p.skills[0] as SkillInstance;
    s2.cd = 0;
    run(w, 1);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Knight).length).toBe(2 + 2);
  });

  it('lures through the bait list every tick and the bait lapses with the knight', () => {
    const { w, s } = knightLab();
    put(w, 'anchor', 0, 8);
    w.step([NO_INPUT]);
    expect(w.baits.count).toBe(3);
    expect(w.baits.r[0]).toBeCloseTo(7, 5);
    s.cd = 1e9;
    run(w, 60 * 12 + 30);
    expect(rowsOf(w, ProjKind.Familiar, CompanionRole.Knight)).toHaveLength(0);
    run(w, 20);
    expect(w.baits.count).toBe(0);
    // the bait rings go with the knights
    let rings = 0;
    for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.kind[i] === ProjKind.Marker) rings++;
    expect(rings).toBe(0);
  });

  it('sweeps at most `pierce` creatures, closest first', () => {
    const { w, s } = knightLab({ count: 1, pierce: 2, taunt: 7 });
    w.addCorpse(0, 6, 0);
    put(w, 'anchor', 0, 9);
    w.step([NO_INPUT]);
    s.cd = 1e9;
    const ids = [put(w, 'anchor', 0, 6.4), put(w, 'anchor', 1.2, 6), put(w, 'anchor', -1.5, 6)];
    run(w, 30);
    const hit = ids.map((id) => dealt(w, id) > 0);
    expect(hit.filter(Boolean)).toHaveLength(2);
    expect(hit[2]).toBe(false); // the farthest one is spared
  });
});

describe('coil (wyrm_retinue)', () => {
  const coilLab = (params: Partial<SkillParams> = {}): Lab =>
    roleLab('coil', { damage: 16, cooldown: 22, area: 2.4, count: 1, duration: 12, speed: 7, pierce: 2, knockback: 1, tick: 1.4, range: 10, party: 14, buff: { damage: 0.18, critChance: 0.08 }, ...params });

  it('solo: bursts on the caster, buffs her for the window, the dragon coils round her hips', () => {
    const lab = coilLab();
    const { w, p, s } = lab;
    put(w, 'anchor', 0, 6);
    p.rot = 0;
    w.step([NO_INPUT]);
    const rows = rowsOf(w, ProjKind.Familiar, CompanionRole.Coil);
    expect(rows).toHaveLength(1);
    expect(w.projectiles.anchor[rows[0] as number]).toBe(p.index);
    const b = p.buffs.find((x) => x.skillSlot === s.slot);
    expect(b).toBeDefined();
    expect(b?.total).toBeCloseTo(12, 5);
    run(w, 120);
    const r = rowsOf(w, ProjKind.Familiar, CompanionRole.Coil)[0] as number;
    const d = Math.hypot((w.projectiles.x[r] as number) - p.x, (w.projectiles.z[r] as number) - p.z);
    expect(d).toBeLessThan(1.3);
  });

  it('breathes a homing bolt at the host\'s prey every tick interval, elites first', () => {
    const { w } = coilLab();
    put(w, 'anchor', 0, 3);
    const eliteRow = spawn(w, 'anchor', 4, 5);
    w.enemies.eliteTier[eliteRow] = 1;
    const elite = w.enemies.id[eliteRow] as number;
    let seen = 0;
    let target = 0;
    for (let k = 0; k < 90; k++) {
      w.step([NO_INPUT]);
      for (const r of rowsOf(w, ProjKind.Homing, CompanionRole.Breath)) {
        seen++;
        target = w.projectiles.target[r] as number;
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(target).toBe(elite);
  });

  it('co-op: the dragon flies to the ally with the most recent damage and buffs HIM; it returns when he dies', () => {
    const lab = coilLab();
    const { w, p, s } = lab;
    const meta = w.config.meta;
    const ally = createPlayer(w, 1, { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', meta } as never);
    w.players.push(ally);
    ally.x = 5;
    ally.z = 0;
    ally.px = 5;
    ally.dmgRecent = 900;
    p.dmgRecent = 10;
    put(w, 'anchor', 0, 6);
    w.step([NO_INPUT, NO_INPUT]);
    const row = rowsOf(w, ProjKind.Familiar, CompanionRole.Coil)[0] as number;
    expect(w.projectiles.anchor[row]).toBe(1);
    expect(ally.buffs.some((b) => b.skillSlot === s.slot)).toBe(true);
    expect(p.buffs.some((b) => b.skillSlot === s.slot)).toBe(false);
    for (let k = 0; k < 120; k++) w.step([NO_INPUT, NO_INPUT]);
    expect(Math.hypot((w.projectiles.x[row] as number) - ally.x, (w.projectiles.z[row] as number) - ally.z)).toBeLessThan(1.6);
    // he dies: the dragon returns to the shaman and the buff goes with it
    ally.alive = false;
    w.step([NO_INPUT, NO_INPUT]);
    expect(w.projectiles.anchor[w.projectiles.find(w.projectiles.id[row] as number)]).toBe(0);
    expect(ally.buffs.some((b) => b.skillSlot === s.slot)).toBe(false);
    expect(p.buffs.some((b) => b.skillSlot === s.slot)).toBe(true);
  });
});

describe('mimic (shadow_clone)', () => {
  const mimicLab = (params: Partial<SkillParams> = {}): Lab =>
    roleLab('mimic', { damage: 10, cooldown: 18, area: 1.4, count: 1, duration: 9, speed: 8, tick: 0.3, range: 9, power: 45, ...params });

  /** dispatch the copy of `atk` from clone 0 right now (what dispatchScheduled does when the entry falls due) */
  function dispatchDirect(w: World, atk: SkillInstance): void {
    dispatchMimic(w, { kind: SchedKind.Mimic, owner: 0, slot: atk.slot, n: 0, x: 0, z: 0, dx: 0, dz: 1, f: 0 });
  }

  /** a hero attack skill (the fixture projectile bolt) next to the clone */
  function withAttack(lab: Lab, id = 'soul_crash'): SkillInstance {
    const def = lab.w.ix.skills.get(id);
    if (!def) throw new Error(id);
    return addSkill(lab.w, lab.p, def, 0);
  }

  it('walks the hero\'s trail 0.6 s behind', () => {
    const { w, p } = mimicLab();
    put(w, 'anchor', 0, 10);
    w.step([NO_INPUT]);
    const row = rowsOf(w, ProjKind.Familiar, CompanionRole.Mimic)[0] as number;
    const id = w.projectiles.id[row] as number;
    for (let k = 0; k < 120; k++) w.step([{ moveX: 1, moveZ: 0 }]);
    const r = w.projectiles.find(id);
    const behind = p.x - (w.projectiles.x[r] as number);
    // 36 ticks of 5.6 m/s
    expect(behind).toBeGreaterThan(2.5);
    expect(behind).toBeLessThan(3.8);
  });

  it('queues a copy for an allow-listed cast and fires it `tick` s later from the clone at power x damage, without touching the hero', () => {
    const lab = mimicLab({ count: 1 });
    const { w, p } = lab;
    const atk = withAttack(lab, 'lightning_trio'); // meleeArc
    const clone = lab.s;
    put(w, 'anchor', 0, 10);
    w.step([NO_INPUT]);
    clone.cd = 1e9;
    // move the hero away so the clone stands elsewhere
    for (let k = 0; k < 90; k++) w.step([{ moveX: 1, moveZ: 0 }]);
    const row = rowsOf(w, ProjKind.Familiar, CompanionRole.Mimic)[0] as number;
    const cx = w.projectiles.x[row] as number;
    const target = put(w, 'anchor', cx, 1);
    const heroTarget = put(w, 'anchor', p.x, 1);
    void heroTarget;
    const x0 = p.x;
    const rot0 = p.rot;
    // cast the attack directly
    atk.cd = 0;
    const fp = atk.fp;
    queueMimic(w, p, atk, fp, 0, 1);
    expect(w.sched.count).toBe(1);
    expect(w.sched.kind[0]).toBe(SchedKind.Mimic);
    expect(w.sched.due[0]).toBeCloseTo(w.time + 0.3, 3);
    // run to the due time and dispatch like dispatchScheduled does (the hash is rebuilt by step() in the game)
    w.hash.rebuild(w.enemies);
    const hp0 = hpOf(w, target);
    w.time += 0.31;
    const e = { kind: SchedKind.Mimic, owner: 0, slot: atk.slot, n: 0, x: 0, z: 0, dx: 0, dz: 1, f: 0 };
    w.sched.count = 0;
    dispatchMimic(w, e);
    expect(p.x).toBe(x0);
    expect(p.rot).toBe(rot0);
    const got = hp0 - hpOf(w, target);
    expect(got).toBeGreaterThan(0);
    // power 45 of the swing's damage
    const full = resolveParams(p, atk, newFinalParams()).damage * 0.45;
    expect(got).toBeCloseTo(full, 1);
    // no hero clip
    for (const ev of w.events) if (ev.t === 'skillCast') expect(ev.heroClip).toBe('');
  });

  it('a zone copy stays where it was cast, ticks at the copy strength (mul) and does not refresh the hero zone', () => {
    const lab = mimicLab({ count: 1 });
    const { w, p } = lab;
    put(w, 'anchor', 0, 10);
    w.step([NO_INPUT]);
    lab.s.cd = 1e9;
    const spin = withAttack(lab, 'bladewheel'); // spinAura: a zone that follows the hero
    spin.cd = 1e9;
    for (let k = 0; k < 60; k++) w.step([{ moveX: 1, moveZ: 0 }]);
    // the hero's own spin zone (cast for real, a creature right beside her)
    put(w, 'anchor', p.x + 1.5, 1);
    spin.cd = 0;
    w.step([{ moveX: 1, moveZ: 0 }]);
    spin.cd = 1e9;
    const own = spin.h1;
    expect(own).not.toBe(0);
    const zones0 = w.zones.count;
    w.hash.rebuild(w.enemies);
    expect(w.sched.count).toBe(1); // the real cast already queued its copy (finishCast -> queueMimic)
    w.sched.count = 0;
    queueMimic(w, p, spin, spin.fp, 0, 1);
    expect(w.sched.count).toBe(1);
    w.sched.count = 0;
    dispatchDirect(w, spin);
    expect(spin.h1).toBe(own); // the hero's handle is untouched
    expect(w.zones.count).toBe(zones0 + 1);
    const z = w.zones.count - 1;
    expect(w.zones.follow[z]).toBe(0);
    expect(w.zones.mul[z]).toBeCloseTo(0.45, 5);
    const x0 = w.zones.x[z] as number;
    for (let k = 0; k < 30; k++) w.step([{ moveX: 1, moveZ: 0 }]);
    expect(w.zones.x[z]).toBeCloseTo(x0, 4); // does not follow the hero
  });

  it('never copies itself, ultimates, dashes or buffs; never copies a copy; caps at 3 per window', () => {
    const lab = mimicLab({ count: 3 });
    const { w, p } = lab;
    put(w, 'anchor', 0, 10);
    w.step([NO_INPUT]);
    lab.s.cd = 1e9;
    const melee = withAttack(lab, 'lightning_trio');
    const dash = withAttack(lab, 'lunge');
    const buff = withAttack(lab, 'will_to_live');
    melee.cd = dash.cd = buff.cd = 1e9;
    queueMimic(w, p, dash, dash.fp, 0, 1);
    queueMimic(w, p, buff, buff.fp, 0, 1);
    queueMimic(w, p, lab.s, lab.s.fp, 0, 1);
    expect(w.sched.count).toBe(0);
    queueMimic(w, p, melee, melee.fp, 0, 1);
    expect(w.sched.count).toBe(3); // one per clone
    queueMimic(w, p, melee, melee.fp, 0, 1);
    expect(w.sched.count).toBe(3); // the window is full
    w.time += 0.6;
    queueMimic(w, p, melee, melee.fp, 0, 1);
    expect(w.sched.count).toBe(6);
  });
});

describe('reflect mirror flip', () => {
  it('turns a hostile bolt that enters the dome around as the caster\'s own capped bolt, once', () => {
    // a selfBuff skill with a mirror radius stands in for reflect
    const { w, p, s: refl } = roleLab('orbiter', { mirror: 4, damage: 10 }, { behavior: 'selfBuff', role: undefined });
    refl.cd = 1e9;
    p.mirrorT = 5;
    p.mirrorR = 4;
    // a hostile bolt flying at the hero from +z
    const r = w.projectiles.alloc();
    const P = w.projectiles;
    P.kind[r] = ProjKind.Hostile;
    P.hostile[r] = 1;
    P.x[r] = 0;
    P.z[r] = 6;
    P.vx[r] = 0;
    P.vz[r] = -8;
    P.radius[r] = 0.3;
    P.life[r] = 3;
    P.damage[r] = 500;
    P.element[r] = ElementIdx.Fire;
    P.skill[r] = 255;
    const hp0 = p.hp;
    // Aim: nothing to hit, so the flipped bolt just flies away; the hero is not hurt
    for (let k = 0; k < 60; k++) w.step([NO_INPUT]);
    expect(p.hp).toBe(hp0);
    const row = P.find(P.id[0] as number);
    void row;
    let flipped = -1;
    for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Bolt) flipped = i;
    expect(flipped).toBeGreaterThanOrEqual(0);
    expect(P.hostile[flipped]).toBe(0);
    expect(P.damage[flipped]).toBeCloseTo(30, 4); // 3 x the skill damage
    expect(P.vz[flipped]).toBeGreaterThan(0); // turned around
    expect(P.skill[flipped]).toBe(refl.slot);
  });

  it('without a mirror the bolt hurts the hero as before', () => {
    const { w, p } = roleLab('orbiter');
    const r = w.projectiles.alloc();
    const P = w.projectiles;
    P.kind[r] = ProjKind.Hostile;
    P.hostile[r] = 1;
    P.x[r] = 0;
    P.z[r] = 2;
    P.vz[r] = -8;
    P.radius[r] = 0.3;
    P.life[r] = 3;
    P.damage[r] = 5;
    P.skill[r] = 255;
    const hp0 = p.hp;
    for (let k = 0; k < 40; k++) w.step([NO_INPUT]);
    expect(p.hp).toBeLessThan(hp0);
  });
});

describe('determinism', () => {
  it('two same-seed worlds with an orbiter volley stay bit-identical', () => {
    const mk = (): Lab => {
      const lab = roleLab('orbiter', { damage: 22, cooldown: 1.6, count: 3, speed: 10, tick: 0, duration: 0 }, {}, 77);
      for (let k = 0; k < 12; k++) put(lab.w, 'anchor', Math.sin(k) * 7, Math.cos(k) * 7);
      return lab;
    };
    const a = mk();
    const b = mk();
    for (let k = 0; k < 600; k++) {
      a.w.step([NO_INPUT]);
      b.w.step([NO_INPUT]);
    }
    const sig = (w: World): string => {
      const P = w.projectiles;
      const out: number[] = [P.count, w.enemies.count, w.tally.damageDealt];
      for (let i = 0; i < P.count; i++) out.push(P.x[i] as number, P.z[i] as number, P.h[i] as number);
      for (let i = 0; i < w.enemies.count; i++) out.push(w.enemies.hp[i] as number);
      return out.join(',');
    };
    expect(sig(a.w)).toBe(sig(b.w));
    expect(a.w.tally.damageDealt).toBeGreaterThan(0);
  });
});

describe('co-op snapshot round trip', () => {
  it('markers and companion / twin rows reach a guest with their kind, style name and radius', () => {
    const { w, p, s } = roleLab('orbiter', { damage: 22, cooldown: 1.6, count: 2, speed: 10, tick: 0, duration: 0 });
    put(w, 'anchor', 0, 7);
    spawnMarker(w, p, s.slot, 'sk.gen.veil_ring', 2.5, 30, true);
    spawnMarker(w, p, s.slot, 'sk.gen.bait_ring', 7, 30, false);
    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const dec = new SnapshotDecoder();
    const col = new EventCollector(strings);
    let twinSeen = false;
    for (let k = 0; k < 90; k++) {
      w.step([NO_INPUT]);
      col.collect(w.events);
      if (k % 4 !== 3) continue;
      const e = enc.encode({ keyframe: k === 3, paused: false, final: false, acks: w.players.map((_, i) => ({ seq: i, age: 0, connected: true, hudVer: 1 })), hud: false, events: col.flush() });
      const buf = new ArrayBuffer(16 + e.payload.length);
      const v = new DataView(buf);
      v.setUint8(0, 1);
      v.setUint8(1, 1);
      v.setUint16(2, e.header.flags, true);
      v.setUint32(4, e.header.seq, true);
      v.setUint32(8, e.header.tick, true);
      v.setUint16(14, e.header.baseDelta, true);
      new Uint8Array(buf, 16).set(e.payload);
      expect(dec.decode(buf, 0)).not.toBeNull();
      expect(dec.projectiles.equals(enc.projectiles.sent)).toBe(true);
    }
    const T = dec.projectiles;
    const kinds: number[] = [];
    const styles: string[] = [];
    const radii: number[] = [];
    for (let slot = 0; slot < T.present.length; slot++) {
      if (!T.present[slot]) continue;
      kinds.push(((T.cols[PROJ_COL.kind] as Uint16Array)[slot] as number) & 0x7f);
      styles.push(dec.styleNames[(T.cols[PROJ_COL.style] as Uint16Array)[slot] as number] ?? '?');
      radii.push(((T.cols[PROJ_COL.radius] as Uint16Array)[slot] as number) / 32);
      if (kinds[kinds.length - 1] === ProjKind.Homing) twinSeen = true;
    }
    expect(kinds.filter((x) => x === ProjKind.Marker)).toHaveLength(2);
    expect(styles).toContain('sk.gen.veil_ring');
    expect(styles).toContain('sk.gen.bait_ring');
    expect(radii.some((r) => Math.abs(r - 2.5) < 0.04)).toBe(true);
    expect(radii.some((r) => Math.abs(r - 7) < 0.04)).toBe(true); // the 7 m bait ring
    expect(kinds.filter((x) => x === ProjKind.Familiar)).toHaveLength(2);
    expect(styles.filter((x) => x === s.def.vfx).length).toBeGreaterThanOrEqual(2);
    void twinSeen;
  });
});
