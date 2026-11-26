// Regression tests for the runtime defects the QA soak found (SOAK-1, -2, -3, -7):
//  - an enemy / boss killed by hero thorns inside its own strike stays dead (one death, one kill, spawner.alive consistent)
//  - bosses never end a charge / teleport on blocked ground; summons, metin elites and the ring-spawn fallback never place a
//    creature on blocked ground
//  - a full pickup store merges xp / gold instead of dropping it; a full telegraph store yields a warning decal to a hit

import { describe, expect, it } from 'vitest';
import type { BossDef, BossPattern, BossPatternKind, MetinDef, ZoneDef } from '../../data/schema';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { spawnBoss } from '../bosses';
import { applyStatus, knockEnemy } from '../combat';
import { CAP, DT } from '../constants';
import type { SimEvent, SimEventType } from '../events';
import { spawnPickup } from '../pickups';
import { ringPosition, spawnable, type Pos } from '../spawner';
import { refreshStats } from '../stats';
import { EnemyFlag, EnemyState, PickupKind, StatusIdx, TelegraphAct, TelegraphShape } from '../stores';
import { addTelegraph } from '../telegraph';
import { MetinPhase, type BossState, type MetinState, type WorldEnv } from '../types';
import { createWorld, type World } from '../world';
import { dropSkills, freezeSchedules, makeWorld, NO_INPUT, player, spawn } from './helpers';

type EventOf<T extends SimEventType> = Extract<SimEvent, { t: T }>;

/** step n ticks; returns copies of the events of the given types */
function watch<T extends SimEventType>(w: World, ticks: number, types: readonly T[]): EventOf<T>[] {
  const out: EventOf<T>[] = [];
  for (let i = 0; i < ticks; i++) {
    w.step([NO_INPUT]);
    for (const e of w.events) if ((types as readonly string[]).includes(e.t)) out.push({ ...e } as EventOf<T>);
  }
  return out;
}

/** live creature rows (metin rows excluded: they are not counted by spawner.alive) */
function liveCreatures(w: World): number {
  let n = 0;
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) if (e.state[i] !== EnemyState.Dying && ((e.flags[i] as number) & EnemyFlag.Metin) === 0) n++;
  return n;
}

// ---------------------------------------------------------------------------
// SOAK-1: killed by thorns during its own strike

/** immobile near-immortal hero with thorns, schedules frozen */
function thornsArena(thorns = 1): World {
  const w = makeWorld({ config: { seed: 21 } });
  freezeSchedules(w);
  dropSkills(w);
  const p = player(w);
  p.fixed.push({ maxHp: 1e6, critChance: -1, thorns });
  refreshStats(p, w.content, w.ix);
  p.hp = p.hpMax;
  return w;
}

describe('SOAK-1: a creature killed by thorns inside its own strike stays dead', () => {
  it('melee: one enemyDeath, one kill, spawner.alive matches the live rows', () => {
    const w = thornsArena();
    const row = spawn(w, 'wolf', 0, 2.0);
    const id = w.enemies.id[row] as number;
    w.enemies.hp[row] = 1;
    const deaths: EventOf<'enemyDeath'>[] = [];
    for (let k = 0; k < 240; k++) {
      deaths.push(...watch(w, 1, ['enemyDeath']));
      if (k === 100) {
        // far past the strike: the row must be gone, not parked as a zombie with hp 0
        expect(w.enemies.find(id)).toBe(-1);
      }
    }
    expect(deaths.filter((d) => d.id === id).length).toBe(1);
    expect(w.tally.kills).toBe(1);
    expect(w.spawner.alive).toBe(liveCreatures(w));
    expect(w.spawner.alive).toBeGreaterThanOrEqual(0);
  });

  it('leap landing: the same tick that kills the leaper does not revive it', () => {
    const w = thornsArena();
    // bear: melee + leap. Put it into a leap that lands this tick on top of the hero
    const row = spawn(w, 'bear', 0, 0.5);
    const id = w.enemies.id[row] as number;
    const e = w.enemies;
    e.hp[row] = 1;
    e.state[row] = EnemyState.Leap;
    e.stateT[row] = 0;
    e.aiT[row] = DT * 0.5;
    e.atk[row] = 1; // the leap
    e.vx[row] = 0;
    e.vz[row] = 0;
    const deaths = watch(w, 120, ['enemyDeath']);
    expect(deaths.filter((d) => d.id === id).length).toBe(1);
    expect(w.enemies.find(id)).toBe(-1);
    expect(w.tally.kills).toBe(1);
    expect(w.spawner.alive).toBe(liveCreatures(w));
  });

  it('boss charge: a boss killed by thorns on the last step of its dash is not revived by the pattern state machine', () => {
    const w = bossWorld('charge', {});
    const p = player(w);
    p.fixed.push({ thorns: 50 });
    refreshStats(p, w.content, w.ix);
    p.hp = p.hpMax = 1e6;
    place(w, 0, -40); // far off the line: the dash will not hit anything until we move the hero
    const { b, row } = startBoss(w, 'charge', 0, 14);
    const bossId = b.enemy;
    const length = 14;
    // run until the next dash step is the one that completes the dash
    let guard = 0;
    while (!(b.c === 1 && b.b === 0 && length - b.a > 1e-3 && length - b.a <= 20 * DT + 1e-6)) {
      w.step([NO_INPUT]);
      expect(++guard).toBeLessThan(6 * 60);
    }
    // the hero steps into the boss on that very tick and the boss is nearly dead
    place(w, w.enemies.x[row] as number, w.enemies.z[row] as number);
    w.enemies.hp[row] = 1;
    const deaths: EventOf<'enemyDeath'>[] = [];
    for (let i = 0; i < 6 * 60; i++) deaths.push(...watch(w, 1, ['enemyDeath']));
    expect(deaths.filter((d) => d.id === bossId).length).toBe(1);
    expect(w.enemies.find(bossId)).toBe(-1);
    expect(w.spawner.alive).toBe(liveCreatures(w));
    expect(w.tally.bossesKilled.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// boss helpers (fixture bosses)

const HORYEONG = 'boss_horyeong';
const ORK = 'boss_ork_chief';

function only(kind: BossPatternKind, params: Record<string, number> = {}): (d: BossDef) => void {
  return (d) => {
    const base = d.patterns.find((p) => p.kind === kind);
    if (!base) throw new Error(`boss ${d.id} has no '${kind}' pattern`);
    const pat: BossPattern = { ...base, cooldown: 1e6, params: { ...base.params, ...params } };
    d.patterns = [pat];
    d.phases = [{ hpPct: 1, patterns: [pat.id] }];
    d.attacks = [];
    d.enrageAfter = 1e9;
  };
}

function bossFor(kind: BossPatternKind): string {
  return kind === 'nova' || kind === 'teleport' || kind === 'breath' || kind === 'enrage' ? ORK : HORYEONG;
}

/** quiet world with the boss def forced to `kind` only; the hero is unkillable and has no skills */
function bossWorld(kind: BossPatternKind, params: Record<string, number>, env?: WorldEnv, seed = 21): World {
  const content = cloneContent();
  for (const b of content.bosses) if (b.id === bossFor(kind)) only(kind, params)(b);
  const w = createWorld(fixtureConfig({ seed }), content, undefined, env);
  freezeSchedules(w);
  w.metinSys.finalStarted = true;
  for (const p of w.players) {
    p.skills.length = 0;
    p.hp = 1e6;
    p.hpMax = 1e6;
  }
  return w;
}

function place(w: World, x: number, z: number): void {
  const p = player(w);
  p.x = x;
  p.z = z;
  p.px = x;
  p.pz = z;
  p.kvx = 0;
  p.kvz = 0;
  p.vx = 0;
  p.vz = 0;
}

function startBoss(w: World, kind: BossPatternKind, x: number, z: number): { b: BossState; row: number } {
  const b = spawnBoss(w, bossFor(kind), false, x, z);
  if (!b) throw new Error('boss did not spawn');
  b.gap = 0;
  b.ready.fill(0);
  return { b, row: w.enemies.find(b.enemy) };
}

// ---------------------------------------------------------------------------
// SOAK-2: bosses never end a charge / teleport on blocked ground

describe('SOAK-2: bosses stay on walkable ground', () => {
  it('a charge stops at the first step that would end on blocked ground', () => {
    // everything with z < 6 is blocked; the boss charges from z = 18 along -Z (length 14: it would end at z = 4)
    const env: WorldEnv = { walkable: (_x, z) => z >= 6 };
    const w = bossWorld('charge', {}, env);
    place(w, 0, 8);
    const { b, row } = startBoss(w, 'charge', 0, 18);
    let minZ = Infinity;
    for (let i = 0; i < 5 * 60; i++) {
      w.step([NO_INPUT]);
      const r = w.enemies.find(b.enemy);
      if (r >= 0) minZ = Math.min(minZ, w.enemies.z[r] as number);
    }
    expect(row).toBeGreaterThanOrEqual(0);
    expect(minZ).toBeGreaterThanOrEqual(6 - 1e-6);
    // it did dash (it ended well past its start point towards the wall)
    expect(minZ).toBeLessThan(8);
  });

  it('a teleport lands on walkable ground (half the ring around the hero is blocked)', () => {
    let blocked = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const env: WorldEnv = { walkable: (x) => x >= 0 };
      const w = bossWorld('teleport', { range: 6, radius: 2 }, env, seed);
      place(w, 0, 0);
      const { b, row } = startBoss(w, 'teleport', 0, 25);
      let landed = false;
      for (let i = 0; i < 4 * 60 && !landed; i++) {
        w.step([NO_INPUT]);
        if (b.c === 1) landed = true;
      }
      expect(landed).toBe(true);
      const x = w.enemies.x[row] as number;
      const z = w.enemies.z[row] as number;
      if (!env.walkable!(x, z)) blocked++;
    }
    expect(blocked).toBe(0);
  });

  it('a teleport with no ground around the hero stays where it is', () => {
    // a disc of radius 9 around the hero is blocked: every landing try fails
    const env: WorldEnv = { walkable: (x, z) => Math.hypot(x, z) > 9 };
    const w = bossWorld('teleport', { range: 6, radius: 2 }, env);
    place(w, 0, 0);
    const { b, row } = startBoss(w, 'teleport', 0, 25);
    for (let i = 0; i < 4 * 60 && b.c === 0; i++) w.step([NO_INPUT]);
    expect(b.c).toBe(1);
    expect(w.enemies.x[row]).toBeCloseTo(0, 3);
    expect(w.enemies.z[row]).toBeCloseTo(25, 3);
  });

  it('a boss that ends a pattern on blocked ground is moved to the nearest walkable point', () => {
    // a planted pattern (slam) never moves the boss: forced into a blocked disc it would stay there for good
    const env: WorldEnv = { walkable: (x, z) => Math.hypot(x - 20, z) > 4 };
    const w = bossWorld('slam', {}, env);
    place(w, 0, 0);
    const { b, row } = startBoss(w, 'slam', 20, 0);
    expect(env.walkable!(w.enemies.x[row] as number, w.enemies.z[row] as number)).toBe(false);
    for (let i = 0; i < 8 * 60; i++) w.step([NO_INPUT]);
    const r = w.enemies.find(b.enemy);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(env.walkable!(w.enemies.x[r] as number, w.enemies.z[r] as number)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SOAK-3: spawns on blocked ground

describe('SOAK-3: spawns stay on walkable ground', () => {
  it('boss summons are placed on walkable ground (or skipped)', () => {
    let spawned = 0;
    for (let seed = 1; seed <= 10; seed++) {
      // only a 2 m wide strip through the boss is walkable
      const env: WorldEnv = { walkable: (_x, z) => Math.abs(z - 20) < 1 };
      const w = bossWorld('summon', { count: 8 }, env, seed);
      place(w, 0, 20);
      startBoss(w, 'summon', 0, 20);
      const sp = watch(w, 5 * 60, ['enemySpawn']).filter((e) => e.source === 4);
      for (const e of sp) {
        expect(env.walkable!(e.x, e.z), `seed ${seed}: summon at (${e.x.toFixed(1)}, ${e.z.toFixed(1)})`).toBe(true);
        spawned++;
      }
    }
    expect(spawned).toBeGreaterThan(0);
  });

  it('metin elites (the awakening escort and summonElite) are placed on walkable ground (or skipped)', () => {
    let spawned = 0;
    for (let seed = 1; seed <= 8; seed++) {
      let stone: MetinState | null = null;
      const env: WorldEnv = { walkable: (_x, z) => stone === null || z >= stone.z };
      const content = cloneContent();
      const zone = content.zones[0] as ZoneDef;
      zone.metins.types = ['metin_lament'];
      zone.metins.interval = [1e6, 1e6];
      for (const d of content.metins as MetinDef[]) {
        d.swarm = { enemies: ['wolf'], every: 1e9, count: 3 };
        d.modifier = 'summonElite';
        d.modParams = { radius: 13, every: 5 };
        d.awakenAfter = 1e6;
      }
      const w = createWorld(fixtureConfig({ seed }), content, undefined, env);
      freezeSchedules(w);
      w.metinSys.finalStarted = false;
      w.metinSys.nextFallAt = 0;
      for (const p of w.players) {
        p.skills.length = 0;
        p.hp = p.hpMax = 1e6;
      }
      w.step([NO_INPUT]);
      const m = w.metins[0] as MetinState;
      for (let i = 0; i < 400 && m.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
      stone = m;
      const sp = watch(w, 12 * 60, ['enemySpawn']).filter((e) => e.source === 5);
      for (const e of sp) {
        expect(e.z, `seed ${seed}: elite at z ${e.z.toFixed(1)} vs stone z ${m.z.toFixed(1)}`).toBeGreaterThanOrEqual(m.z - 1e-6);
        spawned++;
      }
    }
    expect(spawned).toBeGreaterThan(0);
  });

  it('ringPosition finds a spawnable point when the random tries fail (small walkable pocket)', () => {
    // only a 6 m disc 33 m east of the hero is walkable
    const env: WorldEnv = { walkable: (x, z) => Math.hypot(x - 33, z) < 6 };
    const out: Pos = { x: 0, z: 0 };
    for (let seed = 1; seed <= 25; seed++) {
      const w = makeWorld({ config: { seed }, env });
      ringPosition(w, 0, 0, 31, 38, out);
      expect(spawnable(w, out.x, out.z), `seed ${seed}: ring position (${out.x.toFixed(1)}, ${out.z.toFixed(1)})`).toBe(true);
    }
  });

  it('every enemySpawn of a whole run on a mostly blocked map is on walkable ground', () => {
    const env: WorldEnv = { walkable: (x, z) => Math.hypot(x - 33, z) < 6 };
    const w = makeWorld({ config: { seed: 5 }, env });
    w.metinSys.nextFallAt = 1e9;
    w.metinSys.finalStarted = true;
    w.spawner.nextBoss = w.spawner.bosses.length;
    const p = player(w);
    p.hp = p.hpMax = 1e9;
    p.skills.length = 0;
    const spawns = watch(w, 90 * 60, ['enemySpawn']);
    expect(spawns.length).toBeGreaterThan(5);
    for (const e of spawns) expect(env.walkable!(e.x, e.z), `spawn at (${e.x.toFixed(1)}, ${e.z.toFixed(1)}) source ${e.source}`).toBe(true);
  });
});

describe('SOAK-3: a knocked-back creature is never left inside blocked ground', () => {
  it('a stunned creature (its branch skipped the terrain check) stops at the cliff edge', () => {
    // everything with x >= 6 is blocked; the wolf is stunned next to the edge and hit hard towards it
    const env: WorldEnv = { walkable: (x) => x < 6 };
    const w = makeWorld({ config: { seed: 3 }, env });
    freezeSchedules(w);
    dropSkills(w);
    player(w).x = -30;
    const row = spawn(w, 'wolf', 5, 0);
    const id = w.enemies.id[row] as number;
    applyStatus(w, row, StatusIdx.Stun, 3, 1, -1, false);
    knockEnemy(w, row, 400, 0, 0, false);
    let maxX = -Infinity;
    for (let i = 0; i < 90; i++) {
      w.step([NO_INPUT]);
      const r = w.enemies.find(id);
      if (r >= 0) maxX = Math.max(maxX, w.enemies.x[r] as number);
    }
    expect(maxX).toBeLessThan(6);
    expect(maxX).toBeGreaterThan(4.9);
  });

  it('a creature with no target alive (the idle branch) is held on walkable ground too', () => {
    const env: WorldEnv = { walkable: (x) => x < 6 };
    const w = makeWorld({ config: { seed: 3 }, env });
    freezeSchedules(w);
    dropSkills(w);
    const row = spawn(w, 'wolf', 5, 0);
    const id = w.enemies.id[row] as number;
    player(w).alive = false;
    knockEnemy(w, row, 400, 0, 0, false);
    let maxX = -Infinity;
    for (let i = 0; i < 90; i++) {
      w.step([NO_INPUT]);
      const r = w.enemies.find(id);
      if (r >= 0) maxX = Math.max(maxX, w.enemies.x[r] as number);
    }
    expect(maxX).toBeLessThan(6);
  });
});

// ---------------------------------------------------------------------------
// SOAK-7: hard caps

describe('SOAK-7: full stores lose neither gold / xp nor a damaging telegraph', () => {
  it('a full pickup store merges gold into the nearest coin instead of dropping it', () => {
    const w = makeWorld();
    const P = w.pickups;
    let total = 0;
    for (let i = 0; i < CAP.pickups; i++) {
      const r = spawnPickup(w, PickupKind.Yeop, i, 0, 5, 0, 0);
      expect(r).toBeGreaterThanOrEqual(0);
      total += 5;
    }
    expect(P.count).toBe(CAP.pickups);
    // 40 more coins arrive while the store is full
    for (let k = 0; k < 40; k++) {
      expect(spawnPickup(w, PickupKind.Yeop, 3 + k, 0.5, 7, 0, 0)).toBe(-1);
      total += 7;
    }
    let sum = 0;
    for (let i = 0; i < P.count; i++) if (P.kind[i] === PickupKind.Yeop) sum += P.value[i] as number;
    expect(P.count).toBe(CAP.pickups);
    expect(sum).toBe(total);
  });

  it('a full pickup store merges xp (metin bursts) the same way; a potion is simply dropped', () => {
    const w = makeWorld();
    const P = w.pickups;
    for (let i = 0; i < CAP.pickups; i++) spawnPickup(w, PickupKind.Xp, i, 0, 2, 0, 0);
    let before = 0;
    for (let i = 0; i < P.count; i++) before += P.value[i] as number;
    expect(spawnPickup(w, PickupKind.Xp, 10, 0, 9, 3, 0)).toBe(-1);
    expect(spawnPickup(w, PickupKind.Heal, 10, 0, 0.25, 0, 0)).toBe(-1);
    let after = 0;
    for (let i = 0; i < P.count; i++) after += P.value[i] as number;
    expect(after).toBe(before + 9);
  });

  const tele = (act: TelegraphAct, x: number) => ({ shape: TelegraphShape.Circle, x, z: 0, radius: 2, dur: 5, owner: 1, act, damage: act === TelegraphAct.Visual ? 0 : 10 });

  it('a full telegraph store evicts the oldest warning decal for a damaging telegraph', () => {
    const w = makeWorld();
    const T = w.telegraphs;
    for (let i = 0; i < CAP.telegraphs; i++) expect(addTelegraph(w, tele(TelegraphAct.Visual, i))).toBeGreaterThanOrEqual(0);
    expect(T.count).toBe(CAP.telegraphs);
    // age row 7 so it is the oldest
    T.t[7] = 3;
    const r = addTelegraph(w, tele(TelegraphAct.Impact, 999));
    expect(r).toBe(7);
    expect(T.count).toBe(CAP.telegraphs);
    expect(T.act[r]).toBe(TelegraphAct.Impact);
    expect(T.x[r]).toBe(999);
    expect(T.damage[r]).toBe(10);
    expect(T.t[r]).toBe(0);
    // a decal never evicts anything
    expect(addTelegraph(w, tele(TelegraphAct.Visual, 1234))).toBe(-1);
  });

  it('a store full of damaging telegraphs still drops the next one (nothing to evict)', () => {
    const w = makeWorld();
    for (let i = 0; i < CAP.telegraphs; i++) addTelegraph(w, tele(TelegraphAct.Impact, i));
    expect(addTelegraph(w, tele(TelegraphAct.Impact, 500))).toBe(-1);
    expect(w.telegraphs.count).toBe(CAP.telegraphs);
  });
});
