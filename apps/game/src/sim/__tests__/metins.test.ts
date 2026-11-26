// Metin lifecycle: schedule → warning telegraph → impact → standing (modifier aura, swarm, corruption) → awakening →
// break (essence / yeop / xp / shards / chest) → shatter removal, plus the corruption meter.

import { describe, expect, it } from 'vitest';
import type { MetinDef, ZoneDef } from '../../data/schema';
import { RARITIES } from '../../data/schema';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { hitEnemy, newHitCtx } from '../combat';
import { PLAYER_RADIUS } from '../constants';
import { METIN_ROW_TYPE } from '../enemies';
import type { SimEvent, SimEventType } from '../events';
import { xpToNext } from '../progress';
import type { CoopPlayerInit, RunConfig } from '../run';
import { EnemyFlag, EnemyState, PickupKind, TelegraphAct, TelegraphShape, ZoneKind, type PlayerState } from '../stores';
import { MetinPhase, type MetinState, type WorldEnv } from '../types';
import { createWorld, type World } from '../world';
import { collect, drainModals, NO_INPUT, player, runTicks, spawn } from './helpers';

const SORROW = 'metin_lament';
const GREED = 'metin_avarice';
const HOSTILE_ZONE_TEAM = 1;
const DT = 1 / 60;
const COOP_HERO: CoopPlayerInit = { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } };

// ---------------------------------------------------------------------------
// helpers

interface Setup {
  seed?: number;
  /** zone.metins.types (default: sorrow only) */
  types?: string[];
  /** per-metin-def tweaks applied to the private content clone */
  def?: Record<string, (d: MetinDef) => void>;
  zone?: (z: ZoneDef) => void;
  config?: Partial<RunConfig>;
  env?: WorldEnv;
  /** keep the fixture's periodic swarm (otherwise swarms are disabled) */
  swarm?: boolean;
  /** keep zone.metins.firstAt / interval (otherwise the first stone falls on tick 1 and the next one never) */
  schedule?: boolean;
  /** keep the heroes' starting skills (otherwise they have none, so nothing damages the stone by accident) */
  keepSkills?: boolean;
}

/** quiet world: spawner + bosses off, no hero skills, metin schedule under test control */
function metinWorld(o: Setup = {}): World {
  const content = cloneContent();
  const zone = content.zones[0] as ZoneDef;
  zone.metins.types = o.types ?? [SORROW];
  if (!o.schedule) zone.metins.interval = [1e6, 1e6];
  o.zone?.(zone);
  for (const d of content.metins) {
    if (!o.swarm) d.swarm.every = 1e9;
    o.def?.[d.id]?.(d);
  }
  const w = createWorld(fixtureConfig({ seed: o.seed ?? 7, ...o.config }), content, undefined, o.env);
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  if (!o.keepSkills) for (const p of w.players) p.skills.length = 0;
  if (!o.schedule) w.metinSys.nextFallAt = 0;
  return w;
}

/** hero that cannot die (damage is measured through events / hp deltas) */
function tough(p: PlayerState): void {
  p.hp = 1e6;
  p.hpMax = 1e6;
}

function place(w: World, x: number, z: number, pi = 0): void {
  const p = player(w, pi);
  p.x = x;
  p.z = z;
  p.px = x;
  p.pz = z;
  p.kvx = 0;
  p.kvz = 0;
  p.vx = 0;
  p.vz = 0;
  p.iframes = 0;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function near(actual: number, expected: number, rel = 0.01): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(Math.abs(expected) * rel);
}

type EventOf<T extends SimEventType> = Extract<SimEvent, { t: T }>;

/** step until an event of `type` is emitted; returns a copy and the number of ticks stepped */
function untilEvent<T extends SimEventType>(w: World, type: T, max: number): { ev: EventOf<T>; ticks: number } {
  for (let i = 1; i <= max; i++) {
    w.step([NO_INPUT]);
    for (const e of w.events) if (e.t === type) return { ev: { ...e } as EventOf<T>, ticks: i };
  }
  throw new Error(`no '${type}' event within ${max} ticks (t=${w.time.toFixed(2)})`);
}

/** drop the first stone (schedule at 0) and run until it lands; returns it */
function landMetin(w: World): MetinState {
  runTicks(w, 1);
  const m = w.metins[0] as MetinState;
  expect(m.phase).toBe(MetinPhase.Falling);
  for (let i = 0; i < 400 && m.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
  expect(m.phase).toBe(MetinPhase.Alive);
  return m;
}

function metinRow(w: World, m: MetinState): number {
  return w.enemies.find(m.enemy);
}

/** run until the stone's drop animation is over and it can be hit */
function ripen(w: World, m: MetinState): void {
  for (let i = 0; i < 120; i++) {
    const row = metinRow(w, m);
    if (row >= 0 && ((w.enemies.flags[row] as number) & EnemyFlag.Invuln) === 0) return;
    w.step([NO_INPUT]);
  }
  throw new Error('metin never became vulnerable');
}

/** one huge, crit-free hit on the stone by player `killer` (direct call: events stay in w.events until the next step) */
function smash(w: World, m: MetinState, killer = 0): number {
  const row = metinRow(w, m);
  const c = newHitCtx();
  c.player = killer;
  c.noCrit = true;
  return hitEnemy(w, row, 1e9, c);
}

/** park every creature (not the metin hit-rows) so the AI cannot move it */
function freezeCreatures(w: World): void {
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) {
    if (((e.flags[i] as number) & EnemyFlag.Metin) !== 0) continue;
    e.state[i] = EnemyState.Recover;
    e.aiT[i] = 1e9;
  }
}

function mitigation(w: World, p: PlayerState, element: number): number {
  return (1 - (p.stats.resist[element] as number)) * (1 - p.stats.armor / (p.stats.armor + w.balance.armorK));
}

/** per-tick enemySpawn events of one source: returns [tickIndex (1-based), count, copies of events] per tick with spawns */
function spawnBatches(w: World, ticks: number, source: number, tier?: number): { tick: number; events: EventOf<'enemySpawn'>[] }[] {
  const out: { tick: number; events: EventOf<'enemySpawn'>[] }[] = [];
  for (let i = 1; i <= ticks; i++) {
    w.step([NO_INPUT]);
    const evs: EventOf<'enemySpawn'>[] = [];
    for (const e of w.events) if (e.t === 'enemySpawn' && e.source === source && (tier === undefined || e.tier === tier)) evs.push({ ...e });
    if (evs.length > 0) out.push({ tick: i, events: evs });
  }
  return out;
}

/** all pickups of `kind` currently on the field: [handle, value, x, z] */
function pickupsOf(w: World, kind: PickupKind): { id: number; value: number; x: number; z: number; tier: number }[] {
  const P = w.pickups;
  const out: { id: number; value: number; x: number; z: number; tier: number }[] = [];
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] === kind) out.push({ id: P.id[i] as number, value: P.value[i] as number, x: P.x[i] as number, z: P.z[i] as number, tier: P.tier[i] as number });
  }
  return out;
}

interface Sighting {
  value: number;
  x: number;
  z: number;
  tick: number;
  /** w.corruption at the end of the tick the pickup first appeared */
  corruption: number;
}

/** step n ticks, remembering every pickup of `kind` seen at the end of a tick (first sighting wins) */
function trackPickups(w: World, kind: PickupKind, ticks: number): Map<number, Sighting> {
  const seen = new Map<number, Sighting>();
  for (let i = 1; i <= ticks; i++) {
    w.step([NO_INPUT]);
    for (const p of pickupsOf(w, kind)) if (!seen.has(p.id)) seen.set(p.id, { value: p.value, x: p.x, z: p.z, tick: i, corruption: w.corruption });
  }
  return seen;
}

function hostileZones(w: World, src: number): number[] {
  const rows: number[] = [];
  for (let i = 0; i < w.zones.count; i++) if (w.zones.team[i] === HOSTILE_ZONE_TEAM && w.zones.src[i] === src) rows.push(i);
  return rows;
}

function liveStones(w: World): MetinState[] {
  return w.metins.filter((m) => !m.great && m.phase !== MetinPhase.Broken);
}

function awakenNow(w: World, m: MetinState): void {
  for (let i = 0; i < 3000 && m.phase === MetinPhase.Alive; i++) w.step([NO_INPUT]);
  expect(m.phase).toBe(MetinPhase.Awakened);
}

// ---------------------------------------------------------------------------

describe('metin scheduling and warning', () => {
  it('the first stone falls at zone.metins.firstAt (and not before)', () => {
    const w = metinWorld({ schedule: true });
    const firstAt = w.zone.metins.firstAt;
    expect(w.metinSys.nextFallAt).toBe(firstAt);
    // PC-01: Yeonmu's first stone is no longer pinned to 60 s (the value is zone data); it stays a whole-second time inside the first minute
    expect(Number.isInteger(firstAt) && firstAt >= 30 && firstAt <= 60).toBe(true);
    // nothing earlier
    runTicks(w, (firstAt - 1) * 60);
    expect(w.metins.length).toBe(0);
    const { ev } = untilEvent(w, 'metinWarn', 3 * 60);
    expect(Math.abs(w.time - firstAt)).toBeLessThanOrEqual(2 * DT);
    expect(ev.great).toBe(false);
    expect(ev.dur).toBeCloseTo(2.6, 5);
    expect(w.zone.metins.types).toContain(ev.def);
  });

  it('firstAt is read from the zone (not hard-coded)', () => {
    const w = metinWorld({ schedule: true, zone: (z) => (z.metins.firstAt = 12) });
    runTicks(w, 11 * 60);
    expect(w.metins.length).toBe(0);
    untilEvent(w, 'metinWarn', 2 * 60);
    expect(Math.abs(w.time - 12)).toBeLessThanOrEqual(2 * DT);
  });

  it('the warning is 12–25 m from the hero, for any seed', () => {
    for (let seed = 1; seed <= 16; seed++) {
      const w = metinWorld({ seed });
      const [ev] = collect(w, 1, ['metinWarn']);
      expect(ev, `seed ${seed}`).toBeDefined();
      const d = dist(ev!.x, ev!.z, 0, 0);
      expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(d, `seed ${seed}`).toBeLessThanOrEqual(25 + 1e-6);
      expect(Math.hypot(ev!.x, ev!.z)).toBeLessThan(w.arenaRadius);
    }
  });

  it('the warning is measured from the hero position, not the origin', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const w = metinWorld({ seed });
      place(w, 80, -60);
      const [ev] = collect(w, 1, ['metinWarn']);
      const d = dist(ev!.x, ev!.z, 80, -60);
      expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(d, `seed ${seed}`).toBeLessThanOrEqual(25 + 1e-6);
    }
  });

  it('stones always land inside the arena, even for a hero hugging the arena edge', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const w = metinWorld({ seed });
      place(w, 0, w.arenaRadius - 2);
      const [ev] = collect(w, 1, ['metinWarn']);
      expect(Math.hypot(ev!.x, ev!.z), `seed ${seed}`).toBeLessThan(w.arenaRadius);
    }
    // custom arena radius from WorldEnv
    for (let seed = 1; seed <= 12; seed++) {
      const w = metinWorld({ seed, env: { arenaRadius: 40 } });
      place(w, 20, 0);
      const [ev] = collect(w, 1, ['metinWarn']);
      expect(Math.hypot(ev!.x, ev!.z), `seed ${seed}`).toBeLessThan(40);
    }
  });

  it('stones avoid unwalkable ground (env.walkable)', () => {
    const walkable = (x: number, _z: number): boolean => x >= 10;
    for (let seed = 1; seed <= 12; seed++) {
      const w = metinWorld({ seed, env: { walkable } });
      place(w, 35, 0);
      const [ev] = collect(w, 1, ['metinWarn']);
      expect(walkable(ev!.x, ev!.z), `seed ${seed}: ${ev!.x.toFixed(1)}`).toBe(true);
    }
  });

  it('writes a Circle telegraph row owned by the metin (owner 2) and emits the telegraph event', () => {
    const w = metinWorld();
    w.step([NO_INPUT]);
    const warn = w.events.find((e) => e.t === 'metinWarn') as EventOf<'metinWarn'>;
    const tele = w.events.find((e) => e.t === 'telegraph') as EventOf<'telegraph'>;
    expect(warn).toBeDefined();
    expect(tele).toBeDefined();
    expect(tele.shape).toBe(TelegraphShape.Circle);
    expect(tele.source).toBe(2);
    expect(tele.dur).toBeCloseTo(2.6, 5);
    expect(tele.x).toBeCloseTo(warn.x, 5);
    expect(tele.z).toBeCloseTo(warn.z, 5);

    const T = w.telegraphs;
    expect(T.count).toBe(1);
    expect(T.shape[0]).toBe(TelegraphShape.Circle);
    expect(T.owner[0]).toBe(2);
    expect(T.act[0]).toBe(TelegraphAct.MetinImpact);
    expect(T.radius[0]).toBeCloseTo(4.2, 5);
    expect(T.dur[0]).toBeCloseTo(2.6, 5);
    expect(T.x[0]).toBeCloseTo(warn.x, 4);
    expect(T.z[0]).toBeCloseTo(warn.z, 4);
    expect(T.damage[0]).toBeGreaterThan(0);
    expect(T.knock[0]).toBeGreaterThan(0);

    const m = w.metins[0] as MetinState;
    expect(m.id).toBe(warn.metin);
    expect(T.aux[0]).toBe(m.id);
    expect(w.telegraphs.find(m.tele)).toBe(0);
    expect(m.phase).toBe(MetinPhase.Falling);
    expect(m.warnLeft).toBeGreaterThan(2.5);
    // no stone row yet: the telegraph is all that exists
    expect(w.enemies.count).toBe(0);
    runTicks(w, 60);
    expect(m.warnLeft).toBeCloseTo(2.6 - 61 * DT, 1);
    expect(T.progress[0]).toBeGreaterThan(0.3);
  });

  it('impacts ~2.6 s after the warning: metinImpact event, telegraph consumed, stone becomes Alive', () => {
    const w = metinWorld();
    const [warn] = collect(w, 1, ['metinWarn']);
    const m = w.metins[0] as MetinState;
    const { ev, ticks } = untilEvent(w, 'metinImpact', 400);
    expect(ticks + 1).toBeGreaterThanOrEqual(Math.round(2.6 * 60) - 2);
    expect(ticks + 1).toBeLessThanOrEqual(Math.round(2.6 * 60) + 2);
    expect(ev.metin).toBe(m.id);
    expect(ev.def).toBe(warn!.def);
    expect(ev.x).toBeCloseTo(warn!.x, 5);
    expect(ev.z).toBeCloseTo(warn!.z, 5);
    expect(ev.radius).toBeCloseTo(4.2, 5);
    expect(ev.great).toBe(false);
    expect(m.phase).toBe(MetinPhase.Alive);
    expect(w.telegraphs.count).toBe(0);
  });
});

describe('metin impact', () => {
  /** world with the stone about to land; the hero is put `d` m from the landing point first */
  function approachWithHero(d: number, seed = 7): { w: World; m: MetinState; hp0: number } {
    const w = metinWorld({ seed });
    runTicks(w, 1);
    const m = w.metins[0] as MetinState;
    place(w, m.x + d, m.z);
    return { w, m, hp0: player(w).hp };
  }

  it('hurts and shoves a hero inside the impact radius', () => {
    const { w, m } = approachWithHero(3);
    const p = player(w);
    const { ticks } = untilEvent(w, 'metinImpact', 400);
    expect(ticks).toBeGreaterThan(100);
    // the hit is part of the same tick as the impact
    const hit = w.events.find((e) => e.t === 'playerHit') as EventOf<'playerHit'>;
    expect(hit).toBeDefined();
    expect(hit.player).toBe(0);
    expect(hit.result).toBe(0);
    const expected = 24 * w.dmgScale() * mitigation(w, p, 1);
    near(hit.amount, expected, 0.01);
    near(p.hp, p.hpMax - hit.amount, 1e-3);
    expect(hit.srcX).toBeCloseTo(m.x, 3);
    expect(hit.srcZ).toBeCloseTo(m.z, 3);
    // pushed away from the stone: hero travels ≈ impulse (6.5 m) once the shove has decayed
    const before = dist(p.x, p.z, m.x, m.z);
    runTicks(w, 90);
    const after = dist(p.x, p.z, m.x, m.z);
    expect(after - before).toBeGreaterThan(5);
    expect(after - before).toBeLessThan(8);
    expect(p.iframes).toBeLessThanOrEqual(0.55);
  });

  it('the impact boundary is radius + hero body radius', () => {
    const inside = approachWithHero(4.2 + PLAYER_RADIUS - 0.1);
    untilEvent(inside.w, 'metinImpact', 400);
    expect(inside.w.events.some((e) => e.t === 'playerHit')).toBe(true);

    const outside = approachWithHero(4.2 + PLAYER_RADIUS + 0.2);
    untilEvent(outside.w, 'metinImpact', 400);
    expect(outside.w.events.some((e) => e.t === 'playerHit')).toBe(false);
    runTicks(outside.w, 60);
    const p = player(outside.w);
    expect(p.hp).toBe(outside.hp0);
    expect(dist(p.x, p.z, outside.m.x, outside.m.z)).toBeCloseTo(4.2 + PLAYER_RADIUS + 0.2, 2);
  });

  it('a hero outside is neither hurt nor shoved', () => {
    const { w, m, hp0 } = approachWithHero(10);
    const p = player(w);
    runTicks(w, 170);
    expect(m.phase).toBe(MetinPhase.Alive);
    expect(p.hp).toBe(hp0);
    expect(p.kvx).toBe(0);
    expect(p.kvz).toBe(0);
    expect(dist(p.x, p.z, m.x, m.z)).toBeCloseTo(10, 3);
  });

  it('only living heroes are hit (co-op: the fallen one is skipped)', () => {
    const w = metinWorld({ config: { coop: [COOP_HERO] } });
    runTicks(w, 1);
    const m = w.metins[0] as MetinState;
    place(w, m.x + 2, m.z, 0);
    place(w, m.x - 2, m.z, 1);
    const fallen = player(w, 1);
    fallen.alive = false;
    fallen.hp = 0;
    untilEvent(w, 'metinImpact', 400);
    const hits = w.events.filter((e) => e.t === 'playerHit') as EventOf<'playerHit'>[];
    expect(hits.map((h) => h.player)).toEqual([0]);
    expect(fallen.hp).toBe(0);
    expect(fallen.kvx).toBe(0);
  });

  it('shoves enemies in the radius away, scaled by their mass; those outside stay put', () => {
    const w = metinWorld();
    runTicks(w, 1);
    const m = w.metins[0] as MetinState;
    place(w, m.x + 30, m.z);
    const bodies = [
      { row: spawn(w, 'wolf', m.x + 2.5, m.z), x0: m.x + 2.5, z0: m.z, id: 0 },
      { row: spawn(w, 'elder_bear', m.x - 2.8, m.z), x0: m.x - 2.8, z0: m.z, id: 0 },
      { row: spawn(w, 'wolf', m.x, m.z + 6.5), x0: m.x, z0: m.z + 6.5, id: 0 },
    ];
    freezeCreatures(w);
    for (const b of bodies) b.id = w.enemies.id[b.row] as number;
    untilEvent(w, 'metinImpact', 400);
    runTicks(w, 60);
    const shoved = bodies.map((b) => {
      const r = w.enemies.find(b.id);
      const x = w.enemies.x[r] as number;
      const z = w.enemies.z[r] as number;
      return { moved: dist(x, z, b.x0, b.z0), fromStone: dist(x, z, m.x, m.z) };
    });
    const wolf = shoved[0]!;
    const bear = shoved[1]!;
    const far = shoved[2]!;
    expect(wolf.moved).toBeGreaterThan(5); // mass 1: impulse 6.5 × 1.2 ≈ 7.8 × 1.08 m
    expect(wolf.fromStone).toBeGreaterThan(2.5 + 5); // radially outwards
    expect(bear.moved).toBeGreaterThan(0.5); // mass 6: heavy, barely moves
    expect(bear.moved).toBeLessThan(wolf.moved / 3);
    expect(far.moved).toBeLessThan(0.01); // outside the impact circle
  });

  it('creates the hit-row: Metin|Invuln|Pinned, Static state, hp from the def, scaled by the stone model', () => {
    const w = metinWorld();
    const m = landMetin(w);
    const e = w.enemies;
    const row = metinRow(w, m);
    expect(row).toBeGreaterThanOrEqual(0);
    const flags = e.flags[row] as number;
    expect(flags & EnemyFlag.Metin).toBe(EnemyFlag.Metin);
    expect(flags & EnemyFlag.Invuln).toBe(EnemyFlag.Invuln);
    expect(flags & EnemyFlag.Pinned).toBe(EnemyFlag.Pinned);
    expect(e.type[row]).toBe(METIN_ROW_TYPE);
    expect(e.ref[row]).toBe(m.type);
    expect(w.metinDefs[e.ref[row] as number]?.id).toBe(SORROW);
    expect(e.state[row]).toBe(EnemyState.Static);
    expect(e.x[row]).toBeCloseTo(m.x, 4);
    expect(e.z[row]).toBeCloseTo(m.z, 4);
    expect(e.radius[row]).toBeCloseTo(m.radius, 5);
    expect(e.hp[row]).toBe(e.hpMax[row]);
    expect(m.hp).toBeCloseTo(m.hpMax, 2);
    expect(m.hpFrac).toBeCloseTo(1, 5);
    // not a creature: does not count against the spawner
    expect(w.aliveEnemies()).toBe(0);
  });

  it('is invulnerable during the 0.9 s drop animation, then vulnerable', () => {
    const w = metinWorld();
    const m = landMetin(w);
    const row = metinRow(w, m);
    const hp = w.enemies.hp[row] as number;
    const c = newHitCtx();
    c.player = 0;
    c.noCrit = true;
    // 0.5 s in: untouchable
    runTicks(w, 30);
    expect(((w.enemies.flags[row] as number) & EnemyFlag.Invuln) !== 0).toBe(true);
    expect(hitEnemy(w, row, 100, c)).toBe(0);
    expect(w.enemies.hp[row]).toBe(hp);
    runTicks(w, 20); // 50 ticks since landing (+1 of the landing tick)
    expect(((w.enemies.flags[row] as number) & EnemyFlag.Invuln) !== 0).toBe(true);
    // after 0.9 s it can be hit
    runTicks(w, 8);
    expect(((w.enemies.flags[row] as number) & EnemyFlag.Invuln) !== 0).toBe(false);
    expect(hitEnemy(w, row, 100, c)).toBe(100);
    expect(w.enemies.hp[row]).toBeCloseTo(hp - 100, 3);
    runTicks(w, 1);
    expect(m.hp).toBeCloseTo(hp - 100, 3);
    expect(m.hpFrac).toBeCloseTo((hp - 100) / hp, 5);
    // still a Metin row: never Pinned away, state stays Static
    expect(w.enemies.state[row]).toBe(EnemyState.Static);
  });

  it('hp scales with run time and difficulty: def.hp × (1 + enemyHpPerMin × min) × hard.hp', () => {
    const def = cloneContent().metins.find((d) => d.id === SORROW) as MetinDef;
    const cases: { difficulty: 'normal' | 'hard'; time: number }[] = [
      { difficulty: 'normal', time: 0 },
      { difficulty: 'normal', time: 600 },
      { difficulty: 'hard', time: 0 },
      { difficulty: 'hard', time: 600 },
    ];
    for (const c of cases) {
      const w = metinWorld({ config: { difficulty: c.difficulty } });
      w.time = c.time;
      const m = landMetin(w);
      const row = metinRow(w, m);
      const bal = w.balance;
      const hardMul = c.difficulty === 'hard' ? bal.hard.hp : 1;
      const expected = def.hp * (1 + bal.enemyHpPerMin * (w.time / 60)) * hardMul;
      near(w.enemies.hpMax[row] as number, expected, 1e-4);
      near(w.enemies.hp[row] as number, expected, 1e-4);
      near(m.hpMax, expected, 1e-4);
    }
  });

  it('never more than 3 stones live; a 4th waits until one is broken', () => {
    const w = metinWorld({ schedule: true, zone: (z) => ((z.metins.firstAt = 0), (z.metins.interval = [2, 2])) });
    w.metinSys.nextFallAt = 0;
    const warns = collect(w, 21 * 60, ['metinWarn']);
    expect(warns.length).toBe(3);
    expect(liveStones(w).length).toBe(3);
    // a falling stone counts as live, and live stones keep a distance of at least 10 m
    const stones = liveStones(w);
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        expect(dist((stones[i] as MetinState).x, (stones[i] as MetinState).z, (stones[j] as MetinState).x, (stones[j] as MetinState).z)).toBeGreaterThanOrEqual(10);
      }
    }
    // break one → the schedule retries within 5 s and a new stone falls
    tough(player(w));
    const first = stones[0] as MetinState;
    ripen(w, first);
    smash(w, first);
    drainModals(w);
    expect(liveStones(w).length).toBe(2);
    const after = collect(w, 6 * 60, ['metinWarn']);
    expect(after.length).toBe(1);
    expect(liveStones(w).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe('metin modifiers', () => {
  const tweak = (mod: MetinDef['modifier'], params: Record<string, number>, extra?: (d: MetinDef) => void) => ({
    [SORROW]: (d: MetinDef) => {
      d.modifier = mod;
      d.modParams = params;
      extra?.(d);
    },
  });

  describe('slowAura (fixture metin_lament)', () => {
    it('slows the hero inside the aura radius only, by modParams.slow', () => {
      const w = metinWorld();
      const m = landMetin(w);
      const p = player(w);
      expect(m.auraRadius).toBe(13);
      place(w, m.x + 8, m.z);
      runTicks(w, 2);
      expect(p.slowMul).toBeCloseTo(0.75, 5);
      place(w, m.x + 12.8, m.z);
      runTicks(w, 2);
      expect(p.slowMul).toBeCloseTo(0.75, 5);
      place(w, m.x + 13.3, m.z);
      runTicks(w, 2);
      expect(p.slowMul).toBe(1);
      place(w, m.x + 40, m.z);
      runTicks(w, 2);
      expect(p.slowMul).toBe(1);
    });

    it('really reduces movement speed (and the hero glows corrupted inside the aura only)', () => {
      const w = metinWorld();
      const m = landMetin(w);
      const p = player(w);
      place(w, m.x + 1, m.z);
      runTicks(w, 90, { moveX: 1, moveZ: 0 });
      near(p.speed, p.stats.moveSpeed * 0.75, 0.01);
      expect(p.corrupted).toBeGreaterThan(0.5);
      place(w, m.x + 30, m.z);
      runTicks(w, 90, { moveX: 1, moveZ: 0 });
      near(p.speed, p.stats.moveSpeed, 0.001);
      expect(p.corrupted).toBe(0);
    });

    it('caps the slow at 60 % and scales with awakening (×1.5 strength, ×1.3 radius)', () => {
      const w = metinWorld({ def: tweak('slowAura', { radius: 13, slow: 0.9 }) });
      const m = landMetin(w);
      place(w, m.x + 5, m.z);
      runTicks(w, 2);
      expect(player(w).slowMul).toBeCloseTo(0.4, 5);

      const w2 = metinWorld({ def: tweak('slowAura', { radius: 13, slow: 0.25 }, (d) => (d.awakenAfter = 3)) });
      const m2 = landMetin(w2);
      place(w2, m2.x + 15, m2.z); // outside 13, inside 16.9
      runTicks(w2, 2);
      expect(player(w2).slowMul).toBe(1);
      awakenNow(w2, m2);
      place(w2, m2.x + 15, m2.z);
      runTicks(w2, 2);
      expect(player(w2).slowMul).toBeCloseTo(1 - 0.25 * 1.5, 5);
      place(w2, m2.x + 17.2, m2.z);
      runTicks(w2, 2);
      expect(player(w2).slowMul).toBe(1);
    });
  });

  describe('extraSwarm', () => {
    const swarmDef = (mod: MetinDef['modifier'], params: Record<string, number>) =>
      tweak(mod, params, (d) => {
        d.swarm = { enemies: ['wolf'], every: 3, count: 5 };
        d.awakenAfter = 1e6;
      });

    it('spawns count × swarmMul per wave, versus count for a plain stone', () => {
      const plain = metinWorld({ swarm: true, def: swarmDef('slowAura', { radius: 13 }) });
      landMetin(plain);
      tough(player(plain));
      const plainBatches = spawnBatches(plain, 4 * 60, 2);
      expect(plainBatches.length).toBe(1);
      expect(plainBatches[0]!.events.length).toBe(5);

      const big = metinWorld({ swarm: true, def: swarmDef('extraSwarm', { radius: 13, swarmMul: 2 }) });
      landMetin(big);
      tough(player(big));
      const bigBatches = spawnBatches(big, 4 * 60, 2);
      expect(bigBatches.length).toBe(1);
      expect(bigBatches[0]!.events.length).toBe(10);

      // default multiplier is 1.6
      const dflt = metinWorld({ swarm: true, def: swarmDef('extraSwarm', { radius: 13 }) });
      landMetin(dflt);
      tough(player(dflt));
      const dBatches = spawnBatches(dflt, 4 * 60, 2);
      expect(dBatches[0]!.events.length).toBe(8);
    });

    it('awakened stones swarm 30 % bigger and 30 % more often', () => {
      const w = metinWorld({ swarm: true, def: tweak('extraSwarm', { radius: 13, swarmMul: 2 }, (d) => {
        d.swarm = { enemies: ['wolf'], every: 10, count: 5 };
        d.awakenAfter = 3;
      }) });
      const m = landMetin(w);
      tough(player(w));
      const batches = spawnBatches(w, 15 * 60, 2);
      // awakened at 3 s: waves at swarmT ≥ 7 s and then every 7 s → 7 s and 14 s after landing
      expect(m.phase).toBe(MetinPhase.Awakened);
      expect(batches.length).toBe(2);
      expect(batches[0]!.events.length).toBe(Math.round(Math.round(5 * 2) * 1.3));
      expect(batches[1]!.events.length).toBe(13);
      expect(Math.abs(batches[0]!.tick - 7 * 60)).toBeLessThanOrEqual(3);
      expect(Math.abs(batches[1]!.tick - batches[0]!.tick - 7 * 60)).toBeLessThanOrEqual(2);
    });
  });

  describe('summonElite', () => {
    const eliteDef = tweak('summonElite', { radius: 13, every: 5 }, (d) => {
      d.swarm = { enemies: ['wolf'], every: 1e9, count: 3 };
      d.awakenAfter = 1e6;
    });

    it('summons a tier-1 elite every modParams.every seconds', () => {
      const w = metinWorld({ def: eliteDef });
      const m = landMetin(w);
      tough(player(w));
      const batches = spawnBatches(w, 11 * 60, 5, 1);
      expect(batches.length).toBe(2);
      expect(Math.abs(batches[0]!.tick - 5 * 60)).toBeLessThanOrEqual(2);
      expect(Math.abs(batches[1]!.tick - batches[0]!.tick - 5 * 60)).toBeLessThanOrEqual(2);
      const ev = batches[0]!.events[0] as EventOf<'enemySpawn'>;
      expect(batches[0]!.events.length).toBe(1);
      expect(ev.tier).toBe(1);
      expect(w.typeDefs[ev.type]?.id).toBe('wolf');
      expect(dist(ev.x, ev.z, m.x, m.z)).toBeCloseTo(5, 4);
    });

    it('the elite is a real elite: Elite flag, ×3 hp, ×1.3 damage', () => {
      const w = metinWorld({ def: eliteDef });
      landMetin(w);
      tough(player(w));
      const batches = spawnBatches(w, 5 * 60 + 5, 5, 1);
      expect(batches.length).toBe(1);
      const ev = batches[0]!.events[0] as EventOf<'enemySpawn'>;
      const row = w.enemies.find(ev.enemy);
      expect(row).toBeGreaterThanOrEqual(0);
      expect((w.enemies.flags[row] as number) & EnemyFlag.Elite).toBe(EnemyFlag.Elite);
      expect(w.enemies.eliteTier[row]).toBe(1);
      const wolfHp = w.ix.enemies.get('wolf')!.hp;
      near(w.enemies.hpMax[row] as number, wolfHp * w.hpScale() * 3, 0.01);
      near(w.enemies.dmgMul[row] as number, w.dmgScale() * 1.3, 0.01);
    });

    it('non-summoner stones summon no elites while unawakened', () => {
      const w = metinWorld({ def: tweak('slowAura', { radius: 13 }, (d) => (d.awakenAfter = 1e6)) });
      landMetin(w);
      tough(player(w));
      expect(spawnBatches(w, 60 * 60, 5).length).toBe(0);
    });

    it('awakened summoners are 40 % faster (every × 0.6)', () => {
      const w = metinWorld({ def: tweak('summonElite', { radius: 13, every: 10 }, (d) => {
        d.swarm = { enemies: ['wolf'], every: 1e9, count: 3 };
        d.awakenAfter = 2;
      }) });
      const m = landMetin(w);
      tough(player(w));
      // landing → 2 s: awakens (2 escort elites); eliteT keeps counting → next summon at eliteT ≥ 6 s
      const batches = spawnBatches(w, 14 * 60, 5, 1);
      expect(m.phase).toBe(MetinPhase.Awakened);
      expect(batches[0]!.events.length).toBe(2); // the awakening escort
      expect(Math.abs(batches[0]!.tick - 2 * 60)).toBeLessThanOrEqual(3);
      expect(batches.length).toBe(3);
      expect(Math.abs(batches[1]!.tick - 6 * 60)).toBeLessThanOrEqual(3);
      expect(Math.abs(batches[2]!.tick - batches[1]!.tick - 6 * 60)).toBeLessThanOrEqual(2);
    });
  });

  describe('yeopRain (fixture metin_avarice)', () => {
    it('drops a yeop pickup near the hero every 2.5 s (default) worth 14', () => {
      const w = metinWorld({ types: [GREED] });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 20, m.z); // outside every aura, nothing else interferes
      const seen = trackPickups(w, PickupKind.Yeop, 9 * 60);
      expect(seen.size).toBe(3); // 2.5, 5.0, 7.5 s
      const ticks = [...seen.values()].map((s) => s.tick);
      expect(Math.abs((ticks[0] as number) - 2.5 * 60)).toBeLessThanOrEqual(2);
      expect(Math.abs((ticks[1] as number) - 5 * 60)).toBeLessThanOrEqual(2);
      const p = player(w);
      for (const s of seen.values()) {
        expect(s.value).toBe(Math.round(14 * (1 + 0.5 * s.corruption)));
        const d = dist(s.x, s.z, p.x, p.z);
        expect(d).toBeGreaterThanOrEqual(1.5);
        expect(d).toBeLessThanOrEqual(8.5);
      }
    });

    it('honours modParams.every / value and the awakening power (×1.5)', () => {
      const w = metinWorld({ def: tweak('yeopRain', { radius: 12, every: 2, value: 20 }, (d) => (d.awakenAfter = 7)) });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 20, m.z);
      const seen = trackPickups(w, PickupKind.Yeop, 13 * 60);
      expect(m.phase).toBe(MetinPhase.Awakened);
      const sightings = [...seen.values()];
      // rain at 2, 4, 6 s unawakened (20 each); awakened at 7 s: rain at 8, 10, 12 s with power 1.5
      expect(sightings.length).toBe(6);
      sightings.forEach((s, i) => {
        const power = i < 3 ? 1 : 1.5;
        expect(s.value).toBe(Math.round(20 * (1 + 0.5 * s.corruption) * power));
      });
      expect((sightings[3] as Sighting).value).toBeGreaterThanOrEqual(30);
    });

    it('other modifiers drop no rain', () => {
      const w = metinWorld();
      landMetin(w);
      tough(player(w));
      const seen = trackPickups(w, PickupKind.Yeop, 10 * 60);
      expect(seen.size).toBe(0);
    });
  });

  describe('darkness', () => {
    const dark = tweak('darkness', { radius: 13, strength: 0.6 }, (d) => (d.awakenAfter = 1e6));

    it('raises world.darkness towards strength inside the aura, 45 % within 1.8× radius, 0 beyond', () => {
      const w = metinWorld({ def: dark });
      expect(w.darkness).toBe(0);
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 6, m.z);
      runTicks(w, 5 * 60);
      near(w.darkness, 0.6, 0.02);

      place(w, m.x + 13 * 1.4, m.z); // between aura and 1.8 × aura
      runTicks(w, 5 * 60);
      near(w.darkness, 0.6 * 0.45, 0.03);

      place(w, m.x + 13 * 2.5, m.z);
      runTicks(w, 6 * 60);
      expect(w.darkness).toBeLessThan(0.01);
    });

    it('ramps smoothly (not a step) and fades after the stone breaks', () => {
      const w = metinWorld({ def: dark });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 6, m.z);
      runTicks(w, 10);
      expect(w.darkness).toBeGreaterThan(0);
      expect(w.darkness).toBeLessThan(0.3);
      runTicks(w, 5 * 60);
      expect(w.darkness).toBeGreaterThan(0.55);
      ripen(w, m);
      smash(w, m);
      drainModals(w);
      runTicks(w, 6 * 60);
      expect(w.darkness).toBeLessThan(0.01);
    });

    it('other modifiers leave the screen bright', () => {
      const w = metinWorld();
      const m = landMetin(w);
      place(w, m.x + 4, m.z);
      runTicks(w, 3 * 60);
      expect(w.darkness).toBe(0);
    });

    it('awakening strengthens it (×1.5 strength, ×1.3 radius)', () => {
      const w = metinWorld({ def: tweak('darkness', { radius: 13, strength: 0.4 }, (d) => (d.awakenAfter = 2)) });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 6, m.z);
      runTicks(w, 8 * 60);
      expect(m.phase).toBe(MetinPhase.Awakened);
      near(w.darkness, 0.6, 0.02);
    });
  });

  describe('flicker', () => {
    const flick = tweak('flicker', { radius: 13 }, (d) => (d.awakenAfter = 1e6));

    it('phases enemies inside the aura in and out (Phased flag, untargetable), never those outside', () => {
      const w = metinWorld({ def: flick });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 40, m.z + 40);
      const inside: number[] = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        inside.push(w.enemies.id[spawn(w, 'wolf', m.x + Math.sin(a) * 6, m.z + Math.cos(a) * 6)] as number);
      }
      const outside: number[] = [];
      for (let i = 0; i < 6; i++) outside.push(w.enemies.id[spawn(w, 'wolf', m.x - 30 + i, m.z - 30)] as number);
      freezeCreatures(w);
      runTicks(w, 20);
      let phasedSamples = 0;
      let samples = 0;
      let mixedTicks = 0;
      let hitChecked = false;
      for (let t = 0; t < 200; t++) {
        w.step([NO_INPUT]);
        let nPhased = 0;
        for (const id of inside) {
          const r = w.enemies.find(id);
          const ph = (((w.enemies.flags[r] as number) & EnemyFlag.Phased) !== 0);
          samples++;
          if (ph) {
            nPhased++;
            phasedSamples++;
            if (!hitChecked) {
              hitChecked = true;
              const c = newHitCtx();
              c.player = 0;
              c.noCrit = true;
              const hp = w.enemies.hp[r] as number;
              expect(hitEnemy(w, r, 5, c)).toBe(0);
              expect(w.enemies.hp[r]).toBe(hp);
            }
          }
        }
        if (nPhased > 0 && nPhased < inside.length) mixedTicks++;
        for (const id of outside) {
          const r = w.enemies.find(id);
          expect((w.enemies.flags[r] as number) & EnemyFlag.Phased).toBe(0);
        }
      }
      const frac = phasedSamples / samples;
      expect(hitChecked).toBe(true);
      expect(frac).toBeGreaterThan(0.12);
      expect(frac).toBeLessThan(0.42);
      expect(mixedTicks).toBeGreaterThan(20);
    });

    it('non-flicker stones never phase anyone, and phasing stops when the flicker stone breaks', () => {
      const plain = metinWorld();
      const m0 = landMetin(plain);
      tough(player(plain));
      for (let i = 0; i < 12; i++) spawn(plain, 'wolf', m0.x + 3 + i * 0.5, m0.z);
      freezeCreatures(plain);
      for (let t = 0; t < 120; t++) {
        plain.step([NO_INPUT]);
        for (let r = 0; r < plain.enemies.count; r++) expect((plain.enemies.flags[r] as number) & EnemyFlag.Phased).toBe(0);
      }

      const w = metinWorld({ def: flick });
      const m = landMetin(w);
      tough(player(w));
      for (let i = 0; i < 12; i++) spawn(w, 'wolf', m.x + 3 + i * 0.5, m.z);
      freezeCreatures(w);
      runTicks(w, 120);
      ripen(w, m);
      smash(w, m);
      drainModals(w);
      runTicks(w, 12); // every row gets a pass within 6 ticks
      for (let r = 0; r < w.enemies.count; r++) {
        expect((w.enemies.flags[r] as number) & EnemyFlag.Phased).toBe(0);
        expect(w.enemies.corrupted[r]).toBe(0);
      }
    });
  });

  describe('fireRing', () => {
    const ring = tweak('fireRing', { radius: 13, ringRadius: 6, blob: 1.1, damage: 12 }, (d) => (d.awakenAfter = 1e6));

    it('creates a hostile fire-ring zone on impact, with the metin as source', () => {
      const w = metinWorld({ def: ring });
      const m = landMetin(w);
      const rows = hostileZones(w, m.id);
      expect(rows.length).toBe(1);
      const r = rows[0] as number;
      const Z = w.zones;
      expect(Z.kind[r]).toBe(ZoneKind.FireRing);
      expect(Z.team[r]).toBe(1);
      expect(Z.x[r]).toBeCloseTo(m.x, 4);
      expect(Z.z[r]).toBeCloseTo(m.z, 4);
      expect(Z.radius[r]).toBeCloseTo(6, 5);
      expect(Z.length[r]).toBeCloseTo(1.1, 5);
      expect(Z.tick[r]).toBeCloseTo(0.4, 5);
      expect(Z.element[r]).toBe(1);
      near(Z.damage[r] as number, 12 * w.dmgScale(), 0.001);
      expect(Z.dur[r]).toBeGreaterThan(1e6);
    });

    it('burns a hero standing on the ring, not one inside it or outside it', () => {
      const w = metinWorld({ def: ring });
      const m = landMetin(w);
      const p = player(w);
      tough(p);
      // on the ring
      place(w, m.x + 6, m.z);
      const hits = collect(w, 4 * 60, ['playerHit']);
      expect(hits.length).toBeGreaterThanOrEqual(2);
      for (const h of hits) {
        expect(h.element).toBe(1);
        near(h.amount, 12 * w.dmgScale() * mitigation(w, p, 1), 0.02);
      }
      // hits are spaced by the zone tick (0.4 s) at the earliest
      // in the middle of the ring (distance 2 < 6 − blob − hero)
      place(w, m.x + 2, m.z);
      expect(collect(w, 5 * 60, ['playerHit']).length).toBe(0);
      // outside the ring
      place(w, m.x + 6 + 1.1 + PLAYER_RADIUS + 1.5, m.z);
      expect(collect(w, 5 * 60, ['playerHit']).length).toBe(0);
    });

    it('is freed when the stone breaks', () => {
      const w = metinWorld({ def: ring });
      const m = landMetin(w);
      expect(hostileZones(w, m.id).length).toBe(1);
      ripen(w, m);
      smash(w, m);
      expect(hostileZones(w, m.id).length).toBe(0);
      drainModals(w);
      runTicks(w, 120);
      expect(w.zones.count).toBe(0);
    });

    it('awakening widens the ring ×1.25 and hits ×1.5 harder at the next 5 s refresh; damage tracks run time', () => {
      const w = metinWorld({ def: tweak('fireRing', { radius: 13, ringRadius: 6, blob: 1.1, damage: 12 }, (d) => (d.awakenAfter = 3)) });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 40, m.z);
      const r = hostileZones(w, m.id)[0] as number;
      const base = w.zones.damage[r] as number;
      runTicks(w, 4 * 60); // awakened, refresh at 5 s not reached yet
      expect(m.phase).toBe(MetinPhase.Awakened);
      expect(w.zones.radius[r]).toBeCloseTo(6, 5);
      runTicks(w, 1.5 * 60); // modT = 5.5 s
      expect(w.zones.radius[r]).toBeCloseTo(7.5, 5);
      near(w.zones.damage[r] as number, 12 * w.dmgScale() * 1.5, 0.001);
      expect(w.zones.damage[r]).toBeGreaterThan(base * 1.4);
    });
  });

  describe('poisonField', () => {
    const field = tweak('poisonField', { radius: 13, patches: 3, patchRadius: 3.2, damage: 8 }, (d) => (d.awakenAfter = 1e6));

    it('lays modParams.patches poison patches 3–6 m from the stone', () => {
      const w = metinWorld({ def: field });
      const m = landMetin(w);
      const rows = hostileZones(w, m.id);
      expect(rows.length).toBe(3);
      for (const r of rows) {
        const Z = w.zones;
        expect(Z.kind[r]).toBe(ZoneKind.Circle);
        expect(Z.team[r]).toBe(1);
        expect(Z.element[r]).toBe(5);
        expect(Z.radius[r]).toBeCloseTo(3.2, 5);
        expect(Z.tick[r]).toBeCloseTo(0.5, 5);
        expect(Z.aux[r]).toBeCloseTo(0.2, 5);
        near(Z.damage[r] as number, 8 * w.dmgScale(), 0.001);
        const d = dist(Z.x[r] as number, Z.z[r] as number, m.x, m.z);
        expect(d).toBeGreaterThanOrEqual(3 - 1e-3);
        expect(d).toBeLessThanOrEqual(6 + 1e-3);
      }
      const many = metinWorld({ def: tweak('poisonField', { radius: 13, patches: 5 }) });
      const m5 = landMetin(many);
      expect(hostileZones(many, m5.id).length).toBe(5);
    });

    it('poisons and slows (−20 %) a hero in a patch, every 0.5 s; nothing outside', () => {
      const w = metinWorld({ def: field });
      const m = landMetin(w);
      const p = player(w);
      tough(p);
      const r = hostileZones(w, m.id)[0] as number;
      place(w, w.zones.x[r] as number, w.zones.z[r] as number);
      const hits = collect(w, 3 * 60, ['playerHit']);
      expect(hits.length).toBeGreaterThanOrEqual(5);
      expect(hits.length).toBeLessThanOrEqual(7);
      for (const h of hits) {
        expect(h.element).toBe(5);
        near(h.amount, 8 * w.dmgScale() * mitigation(w, p, 5), 0.02);
      }
      expect(p.slowMul).toBeCloseTo(0.8, 5);
      place(w, m.x + 13, m.z);
      expect(collect(w, 3 * 60, ['playerHit']).length).toBe(0);
      expect(p.slowMul).toBe(1);
    });

    it('patches are freed when the stone breaks', () => {
      const w = metinWorld({ def: field });
      const m = landMetin(w);
      ripen(w, m);
      smash(w, m);
      expect(hostileZones(w, m.id).length).toBe(0);
    });
  });

  describe('damageAura (modifier)', () => {
    const aura = tweak('damageAura', { radius: 13, dps: 6 }, (d) => (d.awakenAfter = 1e6));

    it('hurts the hero inside the aura every 0.5 s for dps × 0.5 (dark element), never outside', () => {
      const w = metinWorld({ def: aura });
      const m = landMetin(w);
      const p = player(w);
      tough(p);
      place(w, m.x + 9, m.z);
      const hits = collect(w, 4.75 * 60, ['playerHit']);
      expect(hits.length).toBe(9);
      for (const h of hits) {
        expect(h.element).toBe(4);
        near(h.amount, 6 * 0.5 * w.dmgScale() * mitigation(w, p, 4), 0.02);
      }
      place(w, m.x + 13.5, m.z);
      expect(collect(w, 5 * 60, ['playerHit']).length).toBe(0);
    });

    it('awakening: ×1.5 damage and ×1.3 radius', () => {
      const w = metinWorld({
        def: tweak('damageAura', { radius: 13, dps: 6 }, (d) => {
          d.awakenAfter = 2;
          d.swarm = { enemies: [], every: 1e9, count: 0 }; // no escort elites to muddy the hit list
        }),
      });
      const m = landMetin(w);
      const p = player(w);
      tough(p);
      place(w, m.x + 40, m.z);
      awakenNow(w, m);
      place(w, m.x + 15.5, m.z); // outside 13, inside 16.9
      const hits = collect(w, 2.75 * 60, ['playerHit']);
      expect(hits.length).toBeGreaterThanOrEqual(5);
      expect(hits.length).toBeLessThanOrEqual(6);
      for (const h of hits) {
        expect(h.element).toBe(4);
        near(h.amount, 6 * 0.5 * 1.5 * w.dmgScale() * mitigation(w, p, 4), 0.02);
      }
    });
  });
});

// ---------------------------------------------------------------------------

describe('corruption of enemies near a standing stone', () => {
  it('marks enemies in the aura corrupted (0.6; 1.0 once awakened), +42 % × level speed, none outside', () => {
    const w = metinWorld({ def: { [SORROW]: (d) => (d.awakenAfter = 3) } });
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 40, m.z + 10);
    const inside = spawn(w, 'wolf', m.x + 5, m.z);
    const mid = spawn(w, 'wolf', m.x + 15, m.z); // outside 13, inside 16.9
    const outside = spawn(w, 'wolf', m.x - 25, m.z - 25);
    const ids = [inside, mid, outside].map((r) => w.enemies.id[r] as number);
    freezeCreatures(w);
    runTicks(w, 8);
    const E = w.enemies;
    const row = (i: number): number => E.find(ids[i] as number);
    expect(E.corrupted[row(0)]).toBeCloseTo(0.6, 5);
    expect(E.corrupted[row(1)]).toBe(0);
    expect(E.corrupted[row(2)]).toBe(0);
    near(E.speed[row(0)] as number, (E.baseSpeed[row(0)] as number) * (1 + 0.42 * 0.6), 1e-4);
    expect(E.speed[row(2)]).toBeCloseTo(E.baseSpeed[row(2)] as number, 5);

    awakenNow(w, m);
    runTicks(w, 8);
    expect(E.corrupted[row(0)]).toBeCloseTo(1, 5);
    expect(E.corrupted[row(1)]).toBeCloseTo(1, 5);
    expect(E.corrupted[row(2)]).toBe(0);
    near(E.speed[row(1)] as number, (E.baseSpeed[row(1)] as number) * 1.42, 1e-4);
  });

  it('corrupted enemies hit 42 % × level harder', () => {
    const firstHit = (heroDistance: number): number => {
      const w = metinWorld({ seed: 11 });
      const m = landMetin(w);
      const p = player(w);
      tough(p);
      place(w, m.x + heroDistance, m.z);
      spawn(w, 'wolf', m.x + heroDistance + 0.8, m.z);
      for (let i = 0; i < 400; i++) {
        w.step([NO_INPUT]);
        for (const e of w.events) if (e.t === 'playerHit' && e.element === 0) return e.amount;
      }
      throw new Error('wolf never hit');
    };
    const calm = firstHit(30);
    const corrupted = firstHit(4);
    near(corrupted / calm, 1 + 0.42 * 0.6, 0.01);
  });

  it('corruption is lifted once the stone breaks', () => {
    const w = metinWorld();
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 40, m.z);
    const wolf = spawn(w, 'wolf', m.x + 4, m.z);
    const id = w.enemies.id[wolf] as number;
    freezeCreatures(w);
    runTicks(w, 8);
    expect(w.enemies.corrupted[w.enemies.find(id)]).toBeCloseTo(0.6, 5);
    ripen(w, m);
    smash(w, m);
    drainModals(w);
    runTicks(w, 8);
    expect(w.enemies.corrupted[w.enemies.find(id)]).toBe(0);
  });

  it('falling stones do not corrupt anyone yet', () => {
    const w = metinWorld();
    runTicks(w, 1);
    const m = w.metins[0] as MetinState;
    tough(player(w));
    place(w, m.x + 40, m.z);
    const wolf = spawn(w, 'wolf', m.x + 8, m.z);
    const id = w.enemies.id[wolf] as number;
    freezeCreatures(w);
    runTicks(w, 60); // still falling
    expect(m.phase).toBe(MetinPhase.Falling);
    expect(w.enemies.corrupted[w.enemies.find(id)]).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('periodic swarm', () => {
  it('summons def.swarm.count enemies of the swarm roster every def.swarm.every seconds (fixture metin_lament: 7 / 9 s)', () => {
    const w = metinWorld({ swarm: true });
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 20, m.z);
    const roster = ['wolf', 'jackal'];
    const batches = spawnBatches(w, 28 * 60, 2);
    expect(batches.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const b = batches[i]!;
      expect(b.events.length).toBe(7);
      expect(Math.abs(b.tick - (i + 1) * 9 * 60)).toBeLessThanOrEqual(3 + i);
      for (const ev of b.events) {
        expect(ev.tier).toBe(0);
        expect(roster).toContain(w.typeDefs[ev.type]!.id);
        const d = dist(ev.x, ev.z, m.x, m.z);
        expect(d).toBeGreaterThanOrEqual(4.5 - 1e-3);
        expect(d).toBeLessThanOrEqual(8.5 + 1e-3);
      }
    }
  });

  it('swarm members arrive with a short spawn-in animation and count as live enemies', () => {
    const w = metinWorld({ swarm: true });
    landMetin(w);
    tough(player(w));
    const batch = spawnBatches(w, 9 * 60 + 3, 2);
    expect(batch.length).toBe(1);
    const row = w.enemies.find(batch[0]!.events[0]!.enemy);
    expect(w.aliveEnemies()).toBe(7);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(w.enemies.state[row]).toBe(EnemyState.Spawn);
    expect(w.enemies.aiT[row]).toBeCloseTo(0.7, 5);
  });

  it('does not swarm while the stone is still falling', () => {
    const w = metinWorld({ swarm: true, def: { [SORROW]: (d) => (d.swarm.every = 0.5) } });
    runTicks(w, 1);
    expect(spawnBatches(w, 2 * 60, 2).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('awakening', () => {
  it('awakens awakenAfter seconds after landing (fixture: 45 s): event, phase, tally, corruption bump, 2 escort elites', () => {
    const w = metinWorld();
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 40, m.z);
    expect(w.zone.metins.firstAt).toBeGreaterThan(0);
    expect(m.def.awakenAfter).toBe(45);
    // run to just before the awakening
    runTicks(w, 44 * 60);
    expect(m.phase).toBe(MetinPhase.Alive);
    expect(w.tally.metinsAwakened).toBe(0);
    const c0 = w.corruption;
    // tick-by-tick until the event
    let found: EventOf<'metinAwaken'> | undefined;
    let ticks = 0;
    const escorts: EventOf<'enemySpawn'>[] = [];
    for (; ticks < 200 && !found; ticks++) {
      w.step([NO_INPUT]);
      for (const e of w.events) {
        if (e.t === 'metinAwaken') found = { ...e };
        if (e.t === 'enemySpawn' && e.source === 5) escorts.push({ ...e });
      }
    }
    expect(found).toBeDefined();
    expect(Math.abs(44 * 60 + ticks - 45 * 60 - 1)).toBeLessThanOrEqual(2);
    expect(found!.metin).toBe(m.id);
    expect(found!.def).toBe(SORROW);
    expect(found!.x).toBeCloseTo(m.x, 5);
    expect(found!.z).toBeCloseTo(m.z, 5);
    expect(m.phase).toBe(MetinPhase.Awakened);
    expect(m.phaseT).toBeLessThan(0.05);
    expect(w.tally.metinsAwakened).toBe(1);
    // corruption: +0.08 on top of the normal 0.006/s drift
    const drift = 0.006 * ticks * DT;
    near(w.corruption - c0, 0.08 + drift, 0.05);
    // two elite escorts burst out of the stone
    expect(escorts.length).toBe(2);
    for (const ev of escorts) {
      expect(ev.tier).toBe(1);
      expect(dist(ev.x, ev.z, m.x, m.z)).toBeCloseTo(5, 4);
    }
    // it does not awaken twice
    expect(collect(w, 5 * 60, ['metinAwaken']).length).toBe(0);
    expect(w.tally.metinsAwakened).toBe(1);
    // an awakened stone appears in the run result
    expect(w.buildResult(false).metinsAwakened).toBe(1);
  });

  it('awakened non-summoner stones add an elite every 20 s', () => {
    const w = metinWorld({ def: { [SORROW]: (d) => (d.awakenAfter = 4) } });
    landMetin(w);
    tough(player(w));
    const batches = spawnBatches(w, 4 * 60 + 41 * 60, 5, 1);
    // 2 escorts at 4 s, then one every 20 s: at 24 s and 44 s
    expect(batches.map((b) => b.events.length)).toEqual([2, 1, 1]);
    expect(Math.abs(batches[1]!.tick - 24 * 60)).toBeLessThanOrEqual(3);
    expect(Math.abs(batches[2]!.tick - 44 * 60)).toBeLessThanOrEqual(3);
  });

  it('corruption meter climbs 2.5× faster while a stone is awakened (0.015 vs 0.006 per second)', () => {
    const w = metinWorld({ def: { [SORROW]: (d) => (d.awakenAfter = 2) } });
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 40, m.z);
    awakenNow(w, m);
    const c0 = w.corruption;
    runTicks(w, 10 * 60);
    near(w.corruption - c0, 0.15, 0.02);
  });
});

// ---------------------------------------------------------------------------

describe('breaking a stone', () => {
  /** break a freshly landed, ripe stone; returns what the kill emitted (before any further step) */
  function breakStone(w: World, m: MetinState, killer = 0): { events: SimEvent[] } {
    ripen(w, m);
    w.bus.clear();
    smash(w, m, killer);
    return { events: w.events.map((e) => ({ ...e }) as SimEvent) };
  }

  it('heroes can break a stone with their own skills (end to end)', () => {
    const w = metinWorld({ keepSkills: true });
    const m = landMetin(w);
    const p = player(w);
    tough(p);
    expect(p.skills.length).toBeGreaterThan(0);
    place(w, m.x + 1.5, m.z);
    let broke: EventOf<'metinBreak'> | undefined;
    for (let i = 0; i < 60 * 60 && !broke; i++) {
      w.step([NO_INPUT]);
      const ev = w.events.find((e) => e.t === 'metinBreak');
      if (ev) broke = { ...ev } as EventOf<'metinBreak'>;
    }
    expect(broke).toBeDefined();
    expect(broke!.metin).toBe(m.id);
    expect(m.phase).toBe(MetinPhase.Broken);
    expect(w.tally.metinsBroken).toBe(1);
    expect(w.modals.some((md) => md.kind === 'essence')).toBe(true);
    expect(w.tally.damageDealt).toBeGreaterThanOrEqual(m.hpMax - 1);
  });

  it('emits metinBreak + the stone row dies; tally and run result count it', () => {
    const w = metinWorld();
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 30, m.z);
    const handle = m.enemy;
    const { events } = breakStone(w, m);
    const br = events.filter((e) => e.t === 'metinBreak') as EventOf<'metinBreak'>[];
    expect(br.length).toBe(1);
    expect(br[0]!.metin).toBe(m.id);
    expect(br[0]!.def).toBe(SORROW);
    expect(br[0]!.great).toBe(false);
    expect(br[0]!.awakened).toBe(false);
    expect(br[0]!.x).toBeCloseTo(m.x, 5);
    const death = events.filter((e) => e.t === 'enemyDeath') as EventOf<'enemyDeath'>[];
    expect(death.length).toBe(1);
    expect(death[0]!.id).toBe(handle);
    expect(death[0]!.type).toBe(METIN_ROW_TYPE);
    expect(death[0]!.killer).toBe(0);
    expect(m.phase).toBe(MetinPhase.Broken);
    expect(m.enemy).toBe(0);
    expect(m.hp).toBe(0);
    expect(w.tally.metinsBroken).toBe(1);
    expect(w.tally.metinIds).toEqual([SORROW]);
    // a stone is not a kill
    expect(w.tally.kills).toBe(0);
    expect(w.aliveEnemies()).toBe(0);
    drainModals(w);
    runTicks(w, 1);
    expect(w.enemies.find(handle)).toBe(-1);
    const res = w.buildResult(false);
    expect(res.metinsBroken).toBe(1);
    expect(res.metinTypesBroken).toEqual([SORROW]);
  });

  it('opens one essence modal with 3 stone/trinket cards (uncommon or better), plus shards', () => {
    const w = metinWorld();
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 30, m.z);
    const p = player(w);
    breakStone(w, m);
    expect(w.modals.length).toBe(1);
    const modal = w.modals[0]!;
    expect(modal.kind).toBe('essence');
    expect(modal.player).toBe(0);
    expect(modal.source).toBe(SORROW);
    expect(modal.awakened).toBe(false);
    expect(modal.cards.length).toBe(3);
    for (const c of modal.cards) {
      expect(['stone', 'stoneUp', 'trinket', 'trinketUp']).toContain(c.kind);
      expect(RARITIES.indexOf(c.rarity)).toBeGreaterThanOrEqual(1);
    }
    expect(p.shards).toBe(2);
    // the sim is frozen until the essence is chosen
    const t0 = w.time;
    runTicks(w, 30);
    expect(w.time).toBe(t0);
    expect(w.chooseCard(0)).toBe(true);
    expect(w.modals.length).toBe(0);
    runTicks(w, 30);
    expect(w.time).toBeGreaterThan(t0);
    // the picked item is equipped
    const first = modal.cards[0]!;
    if (first.kind === 'stone' || first.kind === 'stoneUp') expect(p.stones[first.slot]?.id).toBe(first.id);
    else expect(p.trinkets[first.slot]?.id).toBe(first.id);
  });

  it('rewards.essence controls the number of essence offers (+1 when awakened, with a rare+ floor); shards ×1.5', () => {
    const run = (essence: number, awakened: boolean) => {
      const w = metinWorld({ def: { [SORROW]: (d) => { d.rewards.essence = essence; d.rewards.shards = 4; d.awakenAfter = awakened ? 2 : 1e6; } } });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 30, m.z);
      if (awakened) awakenNow(w, m);
      const { events } = breakStone(w, m);
      return { w, events };
    };
    const none = run(0, false);
    expect(none.w.modals.length).toBe(0);
    expect(player(none.w).shards).toBe(4);

    const two = run(2, false);
    expect(two.w.modals.length).toBe(2);
    for (const md of two.w.modals) expect(md.kind).toBe('essence');
    expect(player(two.w).shards).toBe(4);

    const awake = run(1, true);
    expect(awake.w.modals.length).toBe(2);
    for (const md of awake.w.modals) {
      expect(md.kind).toBe('essence');
      expect(md.awakened).toBe(true);
      expect(md.cards.length).toBe(3);
      for (const c of md.cards) expect(RARITIES.indexOf(c.rarity)).toBeGreaterThanOrEqual(2);
    }
    expect(player(awake.w).shards).toBe(6);
    expect((awake.events.find((e) => e.t === 'metinBreak') as EventOf<'metinBreak'>).awakened).toBe(true);
    expect(awake.w.buildResult(false).metinsAwakened).toBe(1);
  });

  it('showers yeop: 14–22 coins whose total is within the (boosted) reward range', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = metinWorld({ seed });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 30, m.z);
      breakStone(w, m);
      const coins = pickupsOf(w, PickupKind.Yeop);
      expect(coins.length).toBeGreaterThanOrEqual(14);
      expect(coins.length).toBeLessThanOrEqual(22);
      const total = coins.reduce((s, c) => s + c.value, 0);
      const [lo, hi] = m.def.rewards.yeop;
      const boost = 1 + 0.5 * w.corruption; // corruption read after the −0.06 break relief; stays tiny
      expect(total, `seed ${seed}`).toBeGreaterThanOrEqual(lo - coins.length / 2);
      expect(total, `seed ${seed}`).toBeLessThanOrEqual((hi + 1) * boost + coins.length / 2 + 1);
      for (const c of coins) {
        expect(dist(c.x, c.z, m.x, m.z)).toBeLessThan(8);
      }
    }
  });

  it('a Greed stone (yeopRain) pays double yeop on break', () => {
    const sorrow = metinWorld({ seed: 3 });
    const greed = metinWorld({ seed: 3, types: [GREED], def: { [GREED]: (d) => (d.rewards.yeop = [100, 100]) } });
    const mS = landMetin(sorrow);
    const mG = landMetin(greed);
    for (const [w, m] of [[sorrow, mS], [greed, mG]] as const) {
      tough(player(w));
      place(w, m.x + 30, m.z);
    }
    // keep the rain out of the count: only coins from the shower exist right after the break
    breakStone(sorrow, mS);
    breakStone(greed, mG);
    const coins = pickupsOf(greed, PickupKind.Yeop);
    const total = coins.reduce((s, c) => s + c.value, 0);
    // def yeop 100 × yeopMul 2 × boost (corruption ≈ 0 → ×1.0…1.03)
    expect(total).toBeGreaterThan(200 - coins.length / 2 - 1);
    expect(total).toBeLessThan(200 * 1.03 + coins.length / 2 + 15 * 2.1); // + the few rain coins that dropped while it stood
  });

  it('showers 8 xp gems worth 45 % of the killer\'s level-up requirement', () => {
    const w = metinWorld();
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 30, m.z);
    const gems0 = w.xpGems;
    ripen(w, m);
    const boost = 1 * w.diff.reward * (1 + 0.5 * w.corruption);
    smash(w, m);
    const gems = pickupsOf(w, PickupKind.Xp);
    expect(gems.length).toBe(8);
    expect(w.xpGems - gems0).toBe(8);
    const total = gems.reduce((s, g) => s + g.value, 0);
    near(total, xpToNext(w, 1) * 0.45 * boost, 1e-4);
    for (const g of gems) expect(dist(g.x, g.z, m.x, m.z)).toBeLessThan(5);
  });

  it('awakened stones pay ×1.5 xp; the burst follows the killer\'s level (co-op)', () => {
    const w = metinWorld({
      def: { [SORROW]: (d) => (d.awakenAfter = 2) },
      config: { coop: [{ classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } }] },
    });
    const m = landMetin(w);
    for (const p of w.players) tough(p);
    place(w, m.x + 30, m.z, 0);
    place(w, m.x + 31, m.z, 1);
    awakenNow(w, m);
    const hero = player(w, 1);
    hero.level = 7;
    hero.xpNext = xpToNext(w, 7);
    ripen(w, m);
    const boost = 1.5 * w.diff.reward * (1 + 0.5 * w.corruption);
    smash(w, m, 1);
    const total = pickupsOf(w, PickupKind.Xp).reduce((s, g) => s + g.value, 0);
    near(total, xpToNext(w, 7) * 0.45 * boost, 1e-4);
  });

  it('chest chance: rewards.chestChance 1 always drops a free chest at the stone, 0 never, 0.5 sometimes', () => {
    const chests = (chance: number, seed: number): { id: number; value: number; x: number; z: number; tier: number }[] => {
      const w = metinWorld({ seed, def: { [SORROW]: (d) => (d.rewards.chestChance = chance) } });
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 30, m.z);
      breakStone(w, m);
      return pickupsOf(w, PickupKind.Chest);
    };
    for (const seed of [1, 2, 3]) {
      const one = chests(1, seed);
      expect(one.length).toBe(1);
      expect(one[0]!.tier).toBe(1); // free (metin) chest
      expect(chests(0, seed).length).toBe(0);
    }
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) n += chests(0.5, seed).length;
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(30);
  });

  it('a metin chest is free to open', () => {
    const w = metinWorld({ def: { [SORROW]: (d) => (d.rewards.chestChance = 1) } });
    const m = landMetin(w);
    const p = player(w);
    tough(p);
    place(w, m.x + 30, m.z);
    breakStone(w, m);
    drainModals(w);
    expect(p.yeop).toBe(0);
    // walk onto the chest
    const chest = pickupsOf(w, PickupKind.Chest)[0]!;
    place(w, chest.x, chest.z);
    runTicks(w, 3);
    // the chest settles near the stone; walk to wherever it is now
    for (let i = 0; i < 120 && w.modals.length === 0; i++) {
      const c = pickupsOf(w, PickupKind.Chest)[0];
      if (c) place(w, c.x, c.z);
      w.step([NO_INPUT]);
    }
    expect(w.modals.length).toBe(1);
    expect(w.modals[0]!.kind).toBe('chest');
    expect(p.chestsOpened).toBe(0);
    expect(p.yeop).toBeGreaterThanOrEqual(0);
    expect(w.tally.chestsOpened).toBe(1);
  });

  it('removes the stone from world.metins after the 2.2 s shatter animation', () => {
    const w = metinWorld();
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 30, m.z);
    breakStone(w, m);
    drainModals(w);
    runTicks(w, 2 * 60);
    expect(w.metins).toContain(m);
    expect(m.phase).toBe(MetinPhase.Broken);
    runTicks(w, 0.3 * 60);
    expect(w.metins).not.toContain(m);
    expect(w.metins.length).toBe(0);
  });

  it('breaking lowers the corruption meter by 0.06', () => {
    const w = metinWorld();
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 30, m.z);
    ripen(w, m);
    w.corruption = 0.5;
    smash(w, m);
    near(w.corruption, 0.44, 1e-6);
    w.corruption = 0.02;
    const w2 = metinWorld();
    const m2 = landMetin(w2);
    ripen(w2, m2);
    w2.corruption = 0.02;
    smash(w2, m2);
    expect(w2.corruption).toBe(0);
  });

  it('every living hero gets the essence and shards; a dead hero gets none', () => {
    const coop = { classId: 'warrior' as const, doctrine: 'a' as const, sex: 'f' as const, empire: 'chowon' as const, meta: { stats: {} } };
    const both = metinWorld({ config: { coop: [coop] } });
    const mB = landMetin(both);
    for (const p of both.players) tough(p);
    place(both, mB.x + 30, mB.z, 0);
    place(both, mB.x + 31, mB.z, 1);
    breakStone(both, mB);
    expect(both.modals.map((m) => m.player).sort()).toEqual([0, 1]);
    expect(player(both, 0).shards).toBe(2);
    expect(player(both, 1).shards).toBe(2);

    const one = metinWorld({ config: { coop: [coop] } });
    const mO = landMetin(one);
    for (const p of one.players) tough(p);
    place(one, mO.x + 30, mO.z, 0);
    player(one, 1).alive = false;
    breakStone(one, mO);
    expect(one.modals.map((m) => m.player)).toEqual([0]);
    expect(player(one, 0).shards).toBe(2);
    expect(player(one, 1).shards).toBe(0);
  });

  it('tally.metinTypesBroken lists every broken stone type in order', () => {
    const w = metinWorld({ types: [SORROW] });
    tough(player(w));
    const a = landMetin(w);
    place(w, a.x + 30, a.z);
    breakStone(w, a);
    drainModals(w);
    // the next stone is a Greed stone
    w.zone.metins.types[0] = GREED;
    w.metinSys.nextFallAt = w.time;
    runTicks(w, 1);
    const b = w.metins.find((m) => m.phase === MetinPhase.Falling) as MetinState;
    expect(b.def.id).toBe(GREED);
    for (let i = 0; i < 400 && b.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
    breakStone(w, b);
    drainModals(w);
    expect(w.tally.metinsBroken).toBe(2);
    const res = w.buildResult(false);
    expect(res.metinsBroken).toBe(2);
    expect(res.metinTypesBroken).toEqual([SORROW, GREED]);
  });
});

// ---------------------------------------------------------------------------

describe('corruption meter', () => {
  it('starts at 0, rises 0.006/s while a stone stands and tracks maxCorruption', () => {
    const w = metinWorld();
    expect(w.corruption).toBe(0);
    const m = landMetin(w);
    tough(player(w));
    place(w, m.x + 40, m.z);
    const c0 = w.corruption;
    runTicks(w, 10 * 60);
    near(w.corruption - c0, 0.06, 0.03);
    expect(w.maxCorruption).toBeCloseTo(w.corruption, 8);
    expect(w.buildResult(false).maxCorruption).toBeCloseTo(w.corruption, 8);
    // the maximum is remembered after the meter falls again
    const peak = w.corruption;
    ripen(w, m);
    smash(w, m);
    drainModals(w);
    runTicks(w, 20 * 60);
    expect(w.corruption).toBeLessThan(peak);
    expect(w.maxCorruption).toBeCloseTo(peak, 3);
    expect(w.buildResult(false).maxCorruption).toBeCloseTo(w.maxCorruption, 8);
  });

  it('adds up per standing stone (3 stones → 0.018/s)', () => {
    const w = metinWorld({ schedule: true, zone: (z) => ((z.metins.firstAt = 0), (z.metins.interval = [1, 1])) });
    w.metinSys.nextFallAt = 0;
    tough(player(w));
    runTicks(w, 3 * 60 + 200);
    expect(w.metins.length).toBe(3);
    for (const m of w.metins) expect(m.phase).toBe(MetinPhase.Alive);
    const t = w.corruption;
    runTicks(w, 10 * 60);
    near(w.corruption - t, 0.18, 0.03);
  });

  it('falls 0.004/s when nothing stands, never below 0, never above 1', () => {
    const w = metinWorld({ schedule: true });
    w.corruption = 0.5;
    runTicks(w, 10 * 60);
    near(w.corruption, 0.5 - 0.04, 1e-3);
    w.corruption = 0.01;
    runTicks(w, 5 * 60);
    expect(w.corruption).toBe(0);
    w.corruption = 5;
    runTicks(w, 1);
    expect(w.corruption).toBeLessThanOrEqual(1);
    expect(w.corruption).toBeGreaterThan(0.99);
  });

  it('raises the spawn rate (×(1 + 0.6 c)) and the alive cap (×(1 + 0.15 c))', () => {
    const rate = (corruption: number): number => {
      const w = makeRateWorld(corruption, (z) => {
        z.bands = [{ from: 0, to: 1000, rate: 2, maxAlive: 1000, spawns: [{ enemy: 'wolf', weight: 1 }] }];
      });
      let n = 0;
      for (let i = 0; i < 20 * 60; i++) {
        w.step([NO_INPUT]);
        for (const e of w.events) if (e.t === 'enemySpawn') n++;
      }
      return n;
    };
    const calm = rate(0);
    const hot = rate(1);
    expect(calm).toBeGreaterThanOrEqual(39);
    expect(calm).toBeLessThanOrEqual(42);
    expect(hot / calm).toBeGreaterThan(1.45);
    expect(hot / calm).toBeLessThan(1.7);

    const cap = (corruption: number): number => {
      const w = makeRateWorld(corruption, (z) => {
        z.bands = [{ from: 0, to: 1000, rate: 30, maxAlive: 30, spawns: [{ enemy: 'wolf', weight: 1 }] }];
      });
      runTicks(w, 10 * 60);
      return w.spawner.alive;
    };
    expect(cap(0)).toBe(30);
    const hotCap = cap(1);
    expect(hotCap).toBeGreaterThanOrEqual(34);
    expect(hotCap).toBeLessThanOrEqual(35);
  });

  it('raises enemy loot (×(1 + 0.5 c)) and the metin shower', () => {
    const xpOfKill = (corruption: number): number => {
      const w = makeRateWorld(corruption);
      const row = spawn(w, 'wolf', 5, 5);
      const c = newHitCtx();
      c.player = 0;
      c.noCrit = true;
      hitEnemy(w, row, 1e9, c);
      const gem = pickupsOf(w, PickupKind.Xp)[0]!;
      return gem.value;
    };
    const base = xpOfKill(0);
    expect(base).toBeCloseTo(1, 5);
    expect(xpOfKill(1)).toBeCloseTo(1.5, 5);
    expect(xpOfKill(0.4)).toBeCloseTo(1.2, 5);

    const burst = (corruption: number): number => {
      const w = metinWorld();
      const m = landMetin(w);
      tough(player(w));
      place(w, m.x + 30, m.z);
      ripen(w, m);
      w.corruption = corruption;
      smash(w, m);
      return pickupsOf(w, PickupKind.Xp).reduce((s, g) => s + g.value, 0);
    };
    near(burst(1) / burst(0), 1.5, 1e-4);
    near(burst(0.4) / burst(0), 1.2, 1e-4);
  });

  it('shortens the interval between falls by up to 30 %', () => {
    const next = (corruption: number): number => {
      const w = metinWorld({ schedule: true, zone: (z) => ((z.metins.firstAt = 1), (z.metins.interval = [60, 60])) });
      w.corruption = corruption;
      untilEvent(w, 'metinWarn', 3 * 60);
      return w.metinSys.nextFallAt - w.time;
    };
    near(next(0), 60, 0.002);
    near(next(1), 42, 0.002);
    near(next(0.5), 51, 0.003);
  });
});

/** a world with the normal spawner, bosses/metins off, and a fixed corruption level */
function makeRateWorld(corruption: number, zone?: (z: ZoneDef) => void): World {
  const content = cloneContent();
  zone?.(content.zones[0] as ZoneDef);
  const w = createWorld(fixtureConfig({ seed: 5 }), content);
  w.spawner.nextBoss = w.spawner.bosses.length;
  w.spawner.eliteT = 1e9;
  w.metinSys.nextFallAt = 1e9;
  w.metinSys.finalStarted = true;
  for (const p of w.players) {
    p.skills.length = 0;
    tough(p);
    p.iframes = 1e9;
  }
  w.corruption = corruption;
  return w;
}
