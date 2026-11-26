// Enemy row creation and end-of-tick removal.

import { AFFIX_KINDS, type AffixKind, type EnemyDef, type TimeBand } from '../data/schema';
import { AffixId, AnimClip, EnemyFlag, EnemyState, LOOT_XP_ONLY } from './stores';
import { ENEMY_SOFT_CAP, SPAWN_TIME } from './constants';
import { placeWalkable, type Pos } from './spawner';
import type { World } from './world';

/** Metin rows carry this type id; the metin def index is in `ref`. Render must skip them in the crowd. */
export const METIN_ROW_TYPE = 0xffff;
/** `ref` value of rows that are not a boss/metin */
export const NO_REF = 0xffff;

export interface SpawnOpts {
  /** 0 normal, 1 elite, 2 champion, 3 boss */
  tier?: number;
  /** event source: 0 band, 1 pack, 2 metin swarm, 3 boss/final, 4 summon, 5 elite */
  source?: number;
  hpMul?: number;
  dmgMul?: number;
  scaleMul?: number;
  speedMul?: number;
  flags?: number;
  /** seconds of spawn-in animation (default SPAWN_TIME; 0 = instant) */
  spawnTime?: number;
  lootTier?: number;
  /**
   * elite affix (AffixId). Absent = a tier-1 elite rolls one from data/content/affixes.json (`rollAffix`: nothing while affixes are
   * disabled or the band is before `fromBand`, and no random draw then); any other tier never rolls. A number forces that affix (0 = plain)
   * and draws nothing: the caller decides (tests, the Elite Storm trial, boss affixes).
   */
  affix?: number;
}

const TIER_SCALE = [1, 1.22, 1.12, 1];

/** index of the band running at sim time `t` (the last band whose `from` is <= t; the same rule as spawner.bandAt) */
export function bandIndexAt(bands: readonly TimeBand[], t: number): number {
  let idx = 0;
  for (let i = 0; i < bands.length; i++) {
    if ((bands[i] as TimeBand).from <= t) idx = i;
  }
  return idx;
}

/** the AffixId of a content affix kind (swift 1 .. splitting 4) */
export function affixIdOf(kind: AffixKind): number {
  return AFFIX_KINDS.indexOf(kind) + 1;
}

/** the content affix kind of an AffixId; undefined for 0 (none) and for ids this build does not know */
export function affixKindOf(id: number): AffixKind | undefined {
  return AFFIX_KINDS[id - 1];
}

const affixWeights: number[] = AFFIX_KINDS.map(() => 0);

/**
 * Roll the affix of a tier-1 elite spawned now (EL-01): one draw of `w.rng.spawn` (`weighted` over affixes.json weights in AFFIX_KINDS
 * order). AffixId.None, with NO draw, while affixes are disabled (default content: every run keeps its hashes) or while the run is in a
 * band before `fromBand` (band 0 stays plain when fromBand is 1). `fromBand` defaults to affixes.json; a caller with its own first band
 * (the Elite Storm trial rolls from band 0) passes it and hands the result to `SpawnOpts.affix`.
 */
export function rollAffix(w: World, fromBand: number = w.ix.affixes.fromBand): number {
  const cfg = w.ix.affixes;
  if (!cfg.enabled || bandIndexAt(w.spawner.bands, w.time) < fromBand) return AffixId.None;
  for (let i = 0; i < AFFIX_KINDS.length; i++) affixWeights[i] = cfg.weights[AFFIX_KINDS[i] as AffixKind];
  const i = w.rng.spawn.weighted(affixWeights);
  return i < 0 ? AffixId.None : i + 1;
}

/**
 * Create an enemy row of def `typeIdx` at (x,z). Returns the row or -1 when the store is full.
 * Hp/damage are scaled by run time and difficulty here.
 */
export function spawnEnemy(w: World, typeIdx: number, x: number, z: number, opts: SpawnOpts = {}): number {
  const def = w.typeDefs[typeIdx];
  if (!def) return -1;
  const e = w.enemies;
  const row = e.alloc();
  if (row < 0) return -1;
  const tier = opts.tier ?? 0;
  const rng = w.rng.spawn;
  const variance = 0.94 + rng.next() * 0.12;
  const scale = def.scale * (TIER_SCALE[tier] ?? 1) * (opts.scaleMul ?? 1) * variance;
  e.type[row] = typeIdx;
  e.x[row] = x;
  e.z[row] = z;
  e.px[row] = x;
  e.pz[row] = z;
  const np = w.nearestPlayer(x, z);
  const target = np < 0 ? 0 : np;
  const tp = w.players[target];
  const rot = tp ? Math.atan2(tp.x - x, tp.z - z) : 0;
  e.rot[row] = rot;
  e.prot[row] = rot;
  const hp = def.hp * w.hpScale() * (opts.hpMul ?? 1);
  e.hp[row] = hp;
  e.hpMax[row] = hp;
  e.radius[row] = def.radius * (scale / def.scale);
  e.scale[row] = scale;
  const speed = def.speed * (opts.speedMul ?? 1) * w.options.speed * (0.94 + rng.next() * 0.12);
  e.baseSpeed[row] = speed;
  e.speed[row] = speed;
  e.dmgMul[row] = w.dmgScale() * (opts.dmgMul ?? 1);
  const spawnTime = opts.spawnTime ?? SPAWN_TIME;
  e.state[row] = spawnTime > 0 ? EnemyState.Spawn : EnemyState.Move;
  e.stateT[row] = 0;
  e.aiT[row] = spawnTime;
  e.animClip[row] = spawnTime > 0 ? AnimClip.Spawn : AnimClip.Run;
  e.eliteTier[row] = tier;
  e.flags[row] = (opts.flags ?? 0) | (tier === 1 ? EnemyFlag.Elite : 0) | (tier === 3 ? EnemyFlag.Boss : 0);
  e.target[row] = target;
  e.ref[row] = NO_REF;
  e.lastHitter[row] = target;
  e.lootTier[row] = opts.lootTier ?? tier;
  e.aiA[row] = rng.next() * 6.2832; // phase for weaving / strafing
  e.aiB[row] = rng.next() < 0.5 ? -1 : 1;
  // stagger first attacks so packs do not swing in lockstep
  for (let a = 0; a < def.attacks.length && a < 3; a++) e.atkReady[row * 3 + a] = w.time + 0.4 + rng.next() * 0.8;
  // last draw of the row, so every draw above is the same with affixes on or off
  e.affix[row] = opts.affix ?? (tier === 1 ? rollAffix(w) : AffixId.None);
  w.bus.enemySpawn(e.id[row] as number, typeIdx, x, z, tier, opts.source ?? 0);
  w.spawner.alive++;
  return row;
}

// ---------------------------------------------------------------------------
// Splitting affix (EL-02)

/** a copy stands this far (m) from where the elite fell: outside the corpse, inside a hero's reach */
const SPLIT_RING_MIN = 0.8;
const SPLIT_RING_MAX = 1.8;
/** a copy is a small creature (scale and body radius of the plain creature x this) */
const SPLIT_SCALE = 0.8;
/** seconds of spawn animation: a copy stands up before it can strike */
const SPLIT_SPAWN_TIME = 0.35;
/** EnemySpawnEvent.source 4 = summon (5 = elite, which the hint system reads: a copy must not count as one) */
const SPLIT_SOURCE = 4;
const splitPos: Pos = { x: 0, z: 0 };

/**
 * A splitting elite (row `row`, already Dying) leaves `copies` tier-0 creatures of its own type behind, each with `hp` of the elite's
 * max HP, XP only (LOOT_XP_ONLY, combat.killEnemy). Every copy stands on ground `placeWalkable` accepts (inside the arena, not in a
 * blocker, deep water or lava; none when even the corpse's own spot is not walkable) and rolls no affix. No copies at the soft
 * enemy cap, so a crowd never starves the store of the rows a boss or a metin needs. Draws only from `w.rng.spawn`. Returns the
 * number of copies made.
 */
export function spawnSplitCopies(w: World, row: number): number {
  const e = w.enemies;
  const p = w.ix.affixes.params.splitting;
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  const type = e.type[row] as number;
  const hp = (e.hpMax[row] as number) * p.hp;
  let made = 0;
  for (let k = 0; k < p.copies; k++) {
    if (w.spawner.alive >= ENEMY_SOFT_CAP) break;
    if (!placeWalkable(w, x, z, SPLIT_RING_MIN, SPLIT_RING_MAX, splitPos)) break;
    const r = spawnEnemy(w, type, splitPos.x, splitPos.z, {
      tier: 0,
      affix: AffixId.None,
      scaleMul: SPLIT_SCALE,
      spawnTime: SPLIT_SPAWN_TIME,
      lootTier: LOOT_XP_ONLY,
      source: SPLIT_SOURCE,
    });
    if (r < 0) break;
    e.hp[r] = hp;
    e.hpMax[r] = hp;
    made++;
  }
  return made;
}

/** remove rows killed this tick (state Dying); iterates backwards so swap-remove is safe */
export function sweepDead(w: World): void {
  const e = w.enemies;
  for (let i = e.count - 1; i >= 0; i--) {
    if (e.state[i] === EnemyState.Dying) e.free(i);
  }
}

const PROTECTED_FLAGS = EnemyFlag.Boss | EnemyFlag.Elite | EnemyFlag.Leader | EnemyFlag.Metin | EnemyFlag.Pinned;

/**
 * Reclaim one enemy row for a progression-critical spawn (boss or Metin hit-row) when the store is full.
 * Prefers already-dying rows, otherwise evicts the ordinary non-elite, non-boss enemy farthest from living players.
 * Rebuilds the spatial hash if a row was freed. Returns true when a slot is now free.
 */
export function evictLowPriorityEnemy(w: World): boolean {
  const e = w.enemies;
  if (e.count < e.capacity) return true;

  // 1. Reclaim a row already waiting for end-of-tick sweep (spawner.alive was already decremented when it died).
  let dying = -1;
  for (let i = 0; i < e.count; i++) {
    if (e.state[i] !== EnemyState.Dying) continue;
    dying = i;
    if (((e.flags[i] as number) & (EnemyFlag.Boss | EnemyFlag.Metin)) === 0) break;
  }
  if (dying >= 0) {
    e.free(dying);
    w.hash.rebuild(e);
    return true;
  }

  // 2. Evict the ordinary enemy farthest from every living player.
  let victim = -1;
  let bestD2 = -1;
  const players = w.players;
  for (let i = 0; i < e.count; i++) {
    if ((e.eliteTier[i] as number) !== 0) continue;
    if (((e.flags[i] as number) & PROTECTED_FLAGS) !== 0) continue;
    const x = e.x[i] as number;
    const z = e.z[i] as number;
    let minD2 = Infinity;
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi];
      if (!p || !p.alive) continue;
      const dx = p.x - x;
      const dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) minD2 = d2;
    }
    if (minD2 === Infinity) {
      const p0 = players[0];
      const dx = p0 ? p0.x - x : x;
      const dz = p0 ? p0.z - z : z;
      minD2 = dx * dx + dz * dz;
    }
    if (minD2 > bestD2) {
      bestD2 = minD2;
      victim = i;
    }
  }
  if (victim < 0) return false;
  e.free(victim);
  if (w.spawner.alive > 0) w.spawner.alive--;
  w.hash.rebuild(e);
  return true;
}

export function enemyDefOf(w: World, row: number): EnemyDef | undefined {
  return w.typeDefs[w.enemies.type[row] as number];
}
