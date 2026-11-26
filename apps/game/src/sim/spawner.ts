// Spawner: band-driven enemy flow (rate ramps between bands, maxAlive, packs with leader, elites every N s,
// off-screen ring spawning) and scheduled boss arrivals.

import type { SpawnEntry, TimeBand } from '../data/schema';
import { DT, ENEMY_SOFT_CAP, SPAWN_RING_MAX, SPAWN_RING_MIN, Surface } from './constants';
import { bandIndexAt, spawnEnemy } from './enemies';
import { EnemyState, type PlayerState } from './stores';
import type { World } from './world';
import { spawnBoss } from './bosses';

export interface SpawnerState {
  /** live (non-dying) creature rows, bosses included, metins excluded */
  alive: number;
  /** fractional enemies owed */
  acc: number;
  /** seconds until the next elite */
  eliteT: number;
  /** index of the next scheduled boss in zone.bosses (sorted by `at`) */
  nextBoss: number;
  /** bands and boss schedule sorted by time (copies; the ContentDB is never mutated) */
  bands: TimeBand[];
  bosses: { at: number; boss: string }[];
}

export function createSpawner(w: World): SpawnerState {
  return {
    alive: 0,
    acc: 0.5,
    eliteT: 40,
    nextBoss: 0,
    bands: [...w.zone.bands].sort((a, b) => a.from - b.from),
    bosses: [...w.zone.bosses].sort((a, b) => a.at - b.at),
  };
}

export function bandAt(bands: readonly TimeBand[], t: number): { band: TimeBand; next: TimeBand | undefined; f: number } {
  const idx = bandIndexAt(bands, t);
  const band = bands[idx] as TimeBand;
  const next = bands[idx + 1];
  const span = Math.max(1, band.to - band.from);
  const f = Math.min(1, Math.max(0, (t - band.from) / span));
  return { band, next, f };
}

/** ramped spawn rate (enemies/s) and max-alive at time `t`, before difficulty/corruption multipliers */
export function rampAt(bands: readonly TimeBand[], t: number): { rate: number; maxAlive: number } {
  const { band, next, f } = bandAt(bands, t);
  if (!next) return { rate: band.rate, maxAlive: band.maxAlive };
  return { rate: band.rate + (next.rate - band.rate) * f, maxAlive: band.maxAlive + (next.maxAlive - band.maxAlive) * f };
}

export interface Pos {
  x: number;
  z: number;
}

/** can an enemy / metin stand here? (inside the walkable terrain, not on lava or deep water) */
export function spawnable(w: World, x: number, z: number): boolean {
  const env = w.env;
  if (env.walkable && !env.walkable(x, z)) return false;
  if (env.surfaceAt) {
    const s = env.surfaceAt(x, z);
    if (s === Surface.Lava || s === Surface.Deep) return false;
  }
  return true;
}

/** random position on the ring around (cx, cz), kept inside the arena and on spawnable ground */
export function ringPosition(w: World, cx: number, cz: number, rMin: number, rMax: number, out: Pos): Pos {
  const rng = w.rng.spawn;
  const limit = w.arenaRadius - 1.5;
  for (let attempt = 0; attempt < 18; attempt++) {
    const wide = attempt >= 10;
    const a = rng.angle();
    const r = wide ? rng.range(rMin * 0.55, rMax * 1.5) : rng.range(rMin, rMax);
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    if (Math.hypot(x, z) <= limit && spawnable(w, x, z)) {
      out.x = x;
      out.z = z;
      return out;
    }
  }
  // 18 random tries all failed (hero at the arena edge, a pocket of cliffs): a deterministic sweep of rings around the hero,
  // starting towards the arena centre, finds the nearest spawnable point
  if (sweepSpawnable(w, cx, cz, rMin, rMax, out)) return out;
  // truly pathological terrain: put it on the arena side facing the hero, as far inside as the ring allows
  const d = Math.hypot(cx, cz) || 1;
  const r = Math.min(limit, d + rMin);
  out.x = (cx / d) * r;
  out.z = (cz / d) * r;
  return out;
}

/** rings tried (m) by the last-resort sweep of `ringPosition`, outer ring first so a spawn stays out of sight when it can */
function sweepRadii(rMin: number, rMax: number): number[] {
  return [rMin, (rMin + rMax) / 2, rMax, rMax * 1.5, rMin * 0.75, rMin * 0.5, rMin * 0.3, 6, 3];
}

function sweepSpawnable(w: World, cx: number, cz: number, rMin: number, rMax: number, out: Pos): boolean {
  const limit = w.arenaRadius - 1.5;
  const base = Math.atan2(-cx, -cz); // from the hero towards the arena centre
  const STEPS = 16;
  for (const r of sweepRadii(rMin, rMax)) {
    for (let k = 0; k < STEPS; k++) {
      const a = base + (k / STEPS) * 6.283185307179586;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      if (Math.hypot(x, z) <= limit && spawnable(w, x, z)) {
        out.x = x;
        out.z = z;
        return true;
      }
    }
  }
  return false;
}

/**
 * A spawnable point around (cx, cz) at distance rMin..rMax (rMax <= rMin = exactly rMin) and angle from `rng`, inside the arena: up to
 * `tries` random picks (the first draws exactly what a single unchecked pick drew), the later ones closer in. false = none fits, the
 * caller skips that spawn (a creature placed on blocked ground never moves: the AI reverts every step that ends there).
 */
export function pickSpawnable(w: World, rng: { angle(): number; next(): number }, cx: number, cz: number, rMin: number, rMax: number, out: Pos, tries = 8): boolean {
  const limit = w.arenaRadius - 0.5;
  for (let attempt = 0; attempt < tries; attempt++) {
    const a = rng.angle();
    let r = rMax > rMin ? rMin + rng.next() * (rMax - rMin) : rMin;
    if (attempt >= tries >> 1) r *= 0.55;
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    if (Math.hypot(x, z) <= limit && spawnable(w, x, z)) {
      out.x = x;
      out.z = z;
      return true;
    }
  }
  return false;
}

/**
 * Take a living creature row out of the fight WITHOUT a kill: the row dies like any other (the render dissolves it from the
 * 'enemyDeath' event, `killer` -1 = environment / despawn) but it is no kill: no kill counter, no loot, no xp, no on-kill trigger.
 * False when the row is already dying. FEEL-02's app/__tests__/hitStop.test.ts imports it.
 *
 * The event carries the row's own elite tier, which the render and the audio read as "a pack leader / champion fell": a camera shake,
 * the boss-sized death smoke, a full-volume roar. `quiet` (the Champion Hunt's burrow: a creature that leaves is not a death) reports
 * tier 0 instead, so the row dissolves like an ordinary creature and nothing heavy plays; the row itself keeps its tier.
 */
export function despawnEnemy(w: World, row: number, quiet = false): boolean {
  const e = w.enemies;
  if (row < 0 || row >= e.count || e.state[row] === EnemyState.Dying) return false;
  e.state[row] = EnemyState.Dying;
  e.stateT[row] = 0;
  e.hp[row] = 0;
  w.bus.enemyDeath(e.id[row] as number, e.type[row] as number, e.x[row] as number, e.z[row] as number, e.rot[row] as number, e.scale[row] as number, quiet ? 0 : (e.eliteTier[row] as number), -1, -1, false);
  w.spawner.alive--;
  return true;
}

/** tries of the random ring search of `placeWalkable`; the last third look closer in */
const PLACE_TRIES = 24;
/** step (m) of the fallback walk towards the hero */
const PLACE_STEP = 0.5;

/**
 * A walkable point for a run-event spawn (RS-02a; qa SOAK-3: a creature or a shrine on blocked ground is stuck or unreachable).
 * `(cx, cz)` is the anchor, usually a hero. Ring search: up to PLACE_TRIES random points at distance rMin..rMax (the last third
 * rMin/2..rMax) inside the arena, the first one `spawnable` wins. When none fits (a hero at the arena edge, next to deep water or
 * lava, inside a blocker cluster) the first candidate is pulled inside the arena and walked towards the anchor in half-metre steps
 * until it stands on walkable ground; the anchor itself is the last step (the hero stands there, so the arena test does not apply).
 * So the result can be closer than rMin, never farther than rMax (+ the clamp into the arena). All draws are `w.rng.spawn`.
 * Fills `out` and returns true; false (out = the anchor) only when even the anchor is not walkable ground.
 */
export function placeWalkable(w: World, cx: number, cz: number, rMin: number, rMax: number, out: Pos): boolean {
  const rng = w.rng.spawn;
  const limit = w.arenaRadius - 1.5;
  const lo = Math.max(0, Math.min(rMin, rMax));
  const hi = Math.max(lo, rMin, rMax);
  let fx = cx;
  let fz = cz;
  for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
    const a = rng.angle();
    const r = attempt < (PLACE_TRIES * 2) / 3 ? rng.range(lo, hi) : rng.range(lo * 0.5, hi);
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    if (attempt === 0) {
      fx = x;
      fz = z;
    }
    if (Math.hypot(x, z) <= limit && spawnable(w, x, z)) {
      out.x = x;
      out.z = z;
      return true;
    }
  }
  const d0 = Math.hypot(fx, fz);
  if (d0 > limit) {
    fx *= limit / d0;
    fz *= limit / d0;
  }
  const dist = Math.hypot(cx - fx, cz - fz);
  const steps = Math.ceil(dist / PLACE_STEP);
  for (let k = 0; k < steps; k++) {
    const f = k / steps;
    const x = fx + (cx - fx) * f;
    const z = fz + (cz - fz) * f;
    if (Math.hypot(x, z) <= limit && spawnable(w, x, z)) {
      out.x = x;
      out.z = z;
      return true;
    }
  }
  out.x = cx;
  out.z = cz;
  return spawnable(w, cx, cz);
}

// ---- run-event spawns (RS-03 Champion Hunt) ---------------------------------------------------------------------------

/**
 * The elite pool of the band running at sim time `t`. A band without elites (before the first elite band) falls back to the nearest
 * band that has a pool, the earlier ones first; [] only when the zone has no elite anywhere.
 */
export function bandElitePool(w: World, t: number = w.time): readonly string[] {
  const bands = w.spawner.bands;
  const idx = bandIndexAt(bands, t);
  for (let d = 0; d < bands.length; d++) {
    for (const i of d === 0 ? [idx] : [idx - d, idx + d]) {
      const pool = bands[i]?.elites?.pool;
      if (pool !== undefined && pool.length > 0) return pool;
    }
  }
  return [];
}

/** Type index of one band elite (one draw of `w.rng.spawn`); -1 when the zone has none. */
export function pickBandElite(w: World): number {
  const pool = bandElitePool(w);
  if (pool.length === 0) return -1;
  return w.ix.typeIndex.get(w.rng.spawn.pick(pool)) ?? -1;
}

/** Type index of an ordinary creature of the band running now, weighted like the spawner's own pick (one draw of `w.rng.spawn`); -1 when the band has none. */
export function pickBandCreature(w: World): number {
  const entry = pickEntry(w, bandAt(w.spawner.bands, w.time).band);
  return entry === undefined ? -1 : (w.ix.typeIndex.get(entry.enemy) ?? -1);
}

const pos: Pos = { x: 0, z: 0 };

function pickEntry(w: World, band: TimeBand): SpawnEntry | undefined {
  const weights = band.spawns.map((s) => s.weight);
  const i = w.rng.spawn.weighted(weights);
  return i < 0 ? undefined : band.spawns[i];
}

/** spawn a pack/single for `entry` centred at (cx,cz); returns enemies created */
function spawnEntry(w: World, entry: SpawnEntry, cx: number, cz: number): number {
  const rng = w.rng.spawn;
  const ix = w.ix;
  let made = 0;
  const g = entry.group;
  // the centre comes from ringPosition, which only fails on terrain with no spawnable point around the hero at all: skip then
  if (!spawnable(w, cx, cz)) return 0;
  if (!g) {
    const t = ix.typeIndex.get(entry.enemy);
    if (t !== undefined && spawnEnemy(w, t, cx, cz, { source: 0 }) >= 0) made++;
    return made;
  }
  const size = rng.intRange(g.size[0], g.size[1]);
  if (g.leader) {
    const lt = ix.typeIndex.get(g.leader);
    if (lt !== undefined && spawnEnemy(w, lt, cx, cz, { tier: 2, hpMul: 2.2, dmgMul: 1.15, source: 1 }) >= 0) made++;
  }
  for (let i = 0; i < size; i++) {
    const id = g.members.length > 0 ? rng.pick(g.members) : entry.enemy;
    const t = ix.typeIndex.get(id);
    if (t === undefined) continue;
    let placed = false;
    for (let attempt = 0; attempt < 4 && !placed; attempt++) {
      const a = rng.angle();
      const r = 1 + rng.next() * 2.5;
      const mx = cx + Math.sin(a) * r;
      const mz = cz + Math.cos(a) * r;
      if (!spawnable(w, mx, mz)) continue;
      placed = true;
      if (spawnEnemy(w, t, mx, mz, { source: 1 }) >= 0) made++;
    }
  }
  return made;
}

/** the hero a spawn event is centred on: the only living hero, or a random living one in co-op */
function spawnAnchor(w: World): PlayerState {
  let alive = 0;
  for (const p of w.players) if (p.alive) alive++;
  let k = alive > 1 ? w.rng.spawn.int(alive) : 0;
  for (const p of w.players) {
    if (p.alive && k-- === 0) return p;
  }
  return w.players[0] as PlayerState;
}

export function updateSpawner(w: World): void {
  const sp = w.spawner;
  const zone = w.zone;
  const t = w.time;
  const finalActive = t >= zone.final.at;
  // scheduled bosses
  while (sp.nextBoss < sp.bosses.length && t >= (sp.bosses[sp.nextBoss] as { at: number }).at) {
    const entry = sp.bosses[sp.nextBoss] as { at: number; boss: string };
    if (!w.ix.bosses.has(entry.boss)) {
      sp.nextBoss++;
      continue;
    }
    if (spawnBoss(w, entry.boss, false) === null) break;
    sp.nextBoss++;
  }
  if (w.allDead()) return;

  const { rate, maxAlive } = rampAt(sp.bands, t);
  // while the final boss lives the fight is the content: ordinary spawns thin out so the hero can actually reach it
  const bossFight = finalActive && w.bosses.some((b) => b.final);
  const mult = w.diff.count * (1 + 0.6 * w.corruption) * (finalActive ? 0.55 : 1) * (bossFight ? 0.45 : 1);
  const cap = Math.min(ENEMY_SOFT_CAP, Math.round(maxAlive * w.diff.count * (1 + 0.15 * w.corruption) * (bossFight ? 0.6 : 1)));
  sp.acc += rate * mult * DT;
  const band = bandAt(sp.bands, t).band;
  let guard = 12;
  while (sp.acc >= 1 && sp.alive < cap && guard-- > 0) {
    const entry = pickEntry(w, band);
    if (!entry) {
      sp.acc = 0;
      break;
    }
    const tp = spawnAnchor(w);
    ringPosition(w, tp.x, tp.z, SPAWN_RING_MIN, SPAWN_RING_MAX, pos);
    const made = spawnEntry(w, entry, pos.x, pos.z);
    sp.acc -= Math.max(1, made);
  }
  if (sp.acc > 3) sp.acc = 3;

  // elites. The countdown runs at 1 / mods.eliteEvery, so the interval is `every` x eliteEvery (hard muls, events) and an event
  // factor (Golden Hour) takes effect on the countdown already running, not only after the next elite
  sp.eliteT -= DT / w.mods.eliteEvery;
  if (sp.eliteT <= 0) {
    const elites = band.elites;
    if (elites && elites.pool.length > 0 && sp.alive < ENEMY_SOFT_CAP + 20) {
      const id = w.rng.spawn.pick(elites.pool);
      const ti = w.ix.typeIndex.get(id);
      if (ti !== undefined) {
        const tp = spawnAnchor(w);
        ringPosition(w, tp.x, tp.z, SPAWN_RING_MIN, SPAWN_RING_MAX, pos);
        // a tier-1 elite rolls its affix inside spawnEnemy (affixes.json; no affix and no draw while disabled)
        if (spawnable(w, pos.x, pos.z)) spawnEnemy(w, ti, pos.x, pos.z, { tier: 1, hpMul: 3, dmgMul: 1.3, source: 5 });
      }
      sp.eliteT = elites.every / (1 + 0.3 * w.corruption);
    } else {
      sp.eliteT = 5;
    }
  }
}
