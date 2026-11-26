// Soak core: plays ONE complete run headlessly on the REAL content with the REAL terrain of the zone and checks stability
// detectors on every tick / second. Pure and import-safe (no CLI): `soak.ts` is the CLI (matrix, worker pool, report),
// `soak.test.ts` keeps the tool alive in vitest. See tools/qa/README.md ("soak.ts").
//
//   runCase(content, spec) -> RunRow        one run; never throws (a throw in the sim becomes a violation)
//   buildSelftestSpecs / FAULTS             fault injection that proves every detector fires
//   aggregate(rows) / analyzeMemory(...)    cross-run results (leaks, determinism pairs, coverage)
//
// The bot is the one of the sim tests (sim/__tests__/bot.ts) wrapped with a card policy (first / last / random, plus the
// odd reroll / banish / skip) and an unstuck wiggle (a player would steer out of a corner; the bot has no path finding).

import type { ClassId, ContentDB, Difficulty, DoctrineKey, EmpireId, Sex, StatMods } from '../data/schema';
import { doctrineId } from '../meta/content';
import { CAP, DT, ENEMY_SOFT_CAP } from '../sim/constants';
import { killEnemy } from '../sim/combat';
import { spawnBoss } from '../sim/bosses';
import { spawnEnemy } from '../sim/enemies';
import { Rng } from '../sim/rng';
import { clampRunOptions, runOptionsTable, type MetaBonuses, type RunOptions, type RunResult } from '../sim/run';
import { EnemyFlag, EnemyState, type PlayerInput } from '../sim/stores';
import type { ModalRequest, WorldEnv } from '../sim/types';
import { createWorld, type World } from '../sim/world';
import { createTerrainField, type TerrainField } from '../world/terrainField';
import { botInput } from '../sim/__tests__/bot';
import { findNonFinite } from '../sim/__tests__/helpers';

// ---------------------------------------------------------------------------------------------------------------------
// types

/** `veteran` = god stats plus the talent-milestone ultimates of the case's doctrine (the 30 ultimates are granted only through the talent tree, so no card policy reaches them) */
export type StatsPreset = 'god' | 'veteran' | 'seasoned' | 'plain';
export type CardMode = 'first' | 'last' | 'random';
export type EnvMode = 'game' | 'full';
/** basic = the sim-test bot as is; chase = it also walks up to a boss it has not been wearing down (a ranged boss keeps its distance) */
export type BotMode = 'basic' | 'chase';
export type FaultName =
  | 'throw'
  | 'nan'
  | 'overcap'
  | 'stuck'
  | 'modal'
  | 'outside'
  | 'blockedSpawn'
  | 'noEnd'
  | 'nondeterm'
  | 'slowTick'
  | 'noiseTick'
  | 'zombie'
  | 'stuckEnemy'
  // added by the soak review (2026-10-27): faults the first detectors missed
  | 'throwRare'
  | 'nanOnce'
  | 'nanEvent'
  | 'nanHud'
  | 'thinWallSpawn'
  | 'pocket'
  | 'modalFlood'
  | 'hotNoise'
  | 'p99Creep'
  | 'bossStall';

/**
 * meta stat bonuses: god reaches every final (realContent.test.ts GOD), seasoned is the autoplayer.test.ts hero, plain tests defeat.
 * god / veteran damage 3 -> 4 (OF-01 fix round): a pact-aware card picker (below) still plays a build that holds its skills at G2 until
 * the pact passive is owned, and the god hero must kill the final boss inside the soak's no-end window with it.
 */
export const STATS: Record<StatsPreset, StatMods> = {
  god: { maxHpPct: 8, armor: 150, regen: 10, damage: 4 },
  veteran: { maxHpPct: 8, armor: 150, regen: 10, damage: 4 },
  seasoned: { maxHpPct: 4, armor: 80, regen: 6, damage: 0.6 },
  plain: {},
};

/** the run's MetaBonuses of a case: the preset's stats, and for `veteran` the ultimates of every milestone of the doctrine's talent tree */
export function metaFor(content: ContentDB, spec: { stats: StatsPreset; classId: ClassId; doctrine: DoctrineKey }): MetaBonuses {
  const meta: MetaBonuses = { stats: STATS[spec.stats] };
  if (spec.stats !== 'veteran') return meta;
  const tree = content.talents.find((t) => t.id === doctrineId(spec.classId, spec.doctrine));
  const extra = (tree?.milestones ?? []).map((m) => m.skill).filter((id): id is string => id !== undefined && content.skills.some((k) => k.id === id));
  if (extra.length > 0) meta.extraSkills = extra;
  return meta;
}

export interface CaseSpec {
  /** stable label: zone/class/doctrine/difficulty/s<seed>/<stats>[/opts] */
  id: string;
  /** matrix group (main / plain / options / determinism / selftest) */
  group: string;
  zone: string;
  classId: ClassId;
  doctrine: DoctrineKey;
  difficulty: Difficulty;
  seed: number;
  sex: Sex;
  empire: EmpireId;
  stats: StatsPreset;
  runOptionsMax: boolean;
  /** sim seconds (unpaused play) after which a run that has not ended is a `no-end` violation */
  seconds: number;
  cards: CardMode;
  env: EnvMode;
  bot: BotMode;
  /** seconds of each boss model's `spawn` clip, from the asset manifest (the game's WorldEnv.bossModel) */
  bossSpawn: Record<string, number>;
  /** a victory is required (god stats); other presets may end in defeat */
  expectVictory: boolean;
  /** record a state hash every 10 s of sim (determinism pairs) */
  checkpoints: boolean;
  /** determinism twin of this case id (same spec, compared by state hash) */
  twinOf?: string;
  /** selftest fault injection */
  fault?: FaultName;
  /** wall-clock ms after which the run is aborted with `wall-timeout` */
  wallLimitMs: number;
  /** perf thresholds (ms per tick) */
  p99LimitMs: number;
  maxTickLimitMs: number;
}

export interface Violation {
  kind: string;
  detail: string;
  tick?: number;
  simTime?: number;
}

export type Outcome = 'victory' | 'defeat' | 'timeout' | 'crash' | 'aborted';

export interface TickStats {
  mean: number;
  p50: number;
  p99: number;
  max: number;
  slowestTick: number;
  slowestSimTime: number;
}

export interface MemSample {
  rssMB: number;
  heapMB: number;
}

export interface RunRow {
  id: string;
  group: string;
  zone: string;
  classId: string;
  doctrine: string;
  difficulty: string;
  seed: number;
  sex: string;
  empire: string;
  stats: StatsPreset;
  runOptionsMax: boolean;
  cards: CardMode;
  env: EnvMode;
  bot?: BotMode;
  twinOf?: string;
  outcome: Outcome;
  simSeconds: number;
  wallMs: number;
  ticks: number;
  max: { alive: number; enemyRows: number; projectiles: number; pickups: number; zones: number; telegraphs: number; eventsPerTick: number; modalQueue: number };
  tickMs: TickStats;
  eventsPerSec: number;
  eventsSaturatedTicks: number;
  level: number;
  kills: number;
  chests: number;
  /** boss ids killed, in order (RunResult) */
  bossesKilled: string[];
  seen: {
    bossSpawns: Record<string, number>;
    bossDeaths: Record<string, number>;
    metinWarns: Record<string, number>;
    metinBreaks: Record<string, number>;
    greatMetinBroken: boolean;
    modals: Record<string, number>;
    skills: string[];
    passives: string[];
  };
  stuck: { wiggles: number; maxStillSec: number; maxStillNearSec: number };
  spawns: number;
  /** spawns whose point is non-walkable (and so are its 4 neighbours 0.05 m away: Float32 rounding only); a creature there cannot move */
  blockedSpawns: number;
  /** the same with the creature criterion (`DEEP`, 0.3 m): the number the first harness version reported */
  blockedSpawnsDeep?: number;
  /** non-walkable spawns by source (band / pack / swarm / boss / summon / elite) with the first example of each */
  blockedBySource: Record<string, { count: number; example: string }>;
  /** most modal requests answered inside any 30 s of sim */
  modalPeak30s?: number;
  /** smallest radius (m, round the centroid) of the hero's 1 Hz positions over any 60 s window of play */
  heroMinSpread60s?: number;
  /** HUD snapshots (World.hud, 10 Hz like app/run.ts) taken and checked */
  hudChecks?: number;
  /** ticks on which a store was full (the next allocation of that kind was dropped) */
  storeFullTicks?: { enemies: number; projectiles: number; pickups: number; zones: number; telegraphs: number };
  enemiesBlockedMax: number;
  aliveDriftMax: number;
  /** rows with hp <= 0 that are not dying (an enemy killed during its own strike comes back as a zombie): max at one scan */
  zombieRowsMax: number;
  /** enemy ids that stood on non-walkable ground for >= 3 scans in a row (6 s) */
  stuckInBlocked: number;
  stuckInBlockedExample: string;
  /** ids with more than one enemyDeath event */
  doubleDeaths: number;
  /** final boss hp fraction at the end / 120 s before the end (null: no final boss) */
  finalBossHp: { now: number; before: number } | null;
  heroStartWalkable: boolean;
  mem?: { before: MemSample; after: MemSample };
  worker?: number;
  stateHash: string;
  checkpoints?: string[];
  violations: Violation[];
  /** how many times each violation kind happened (violations[] keeps the first three of each kind) */
  violationCounts: Record<string, number>;
  /** non-failing observations: machine noise, re-run results */
  notes: string[];
  repro: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** cyrb53-style 53-bit hash over numbers (bit patterns of doubles) */
export class StateHash {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;
  num(v: number): void {
    f64[0] = v;
    this.mix(u32[0] as number);
    this.mix(u32[1] as number);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.mix(s.charCodeAt(i));
  }
  private mix(x: number): void {
    this.h1 = Math.imul(this.h1 ^ x, 2654435761);
    this.h2 = Math.imul(this.h2 ^ x, 1597334677);
  }
  digest(): string {
    let a = this.h1;
    let b = this.h2;
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(16).padStart(14, '0');
  }
}

/** hash of the gameplay-relevant final state (not wall time, not object identity) */
export function hashWorld(w: World): string {
  const h = new StateHash();
  h.num(w.time);
  h.num(w.tick);
  h.num(w.corruption);
  h.num(w.over ? 1 : 0);
  h.num(w.victory ? 1 : 0);
  const t = w.tally;
  for (const v of [t.kills, t.elitesKilled, t.metinsBroken, t.metinsAwakened, t.chestsOpened, t.damageDealt, t.damageTaken]) h.num(v);
  for (const id of t.bossesKilled) h.str(id);
  for (const p of w.players) for (const v of [p.x, p.z, p.hp, p.hpMax, p.level, p.xp, p.yeop, p.shards, p.kills, p.shield]) h.num(v);
  for (const s of w.players[0]?.skills ?? []) {
    h.str(s.def.id);
    h.num(s.rank);
  }
  const e = w.enemies;
  h.num(e.count);
  for (let i = 0; i < e.count; i++) {
    h.num(e.x[i] as number);
    h.num(e.z[i] as number);
    h.num(e.hp[i] as number);
  }
  h.num(w.projectiles.count);
  h.num(w.pickups.count);
  h.num(w.zones.count);
  for (const r of [w.rng.spawn, w.rng.combat, w.rng.cards, w.rng.loot, w.rng.metin, w.rng.boss, w.rng.ai]) {
    const s = r.getState();
    h.num(s.s0);
    h.num(s.s1);
    h.num(s.s2);
    h.num(s.s3);
  }
  return h.digest();
}

function checkpointHash(w: World): string {
  const h = new StateHash();
  h.num(w.tick);
  h.num(w.tally.kills);
  h.num(w.tally.damageDealt);
  h.num(w.enemies.count);
  for (const p of w.players) {
    h.num(p.x);
    h.num(p.z);
    h.num(p.hp);
    h.num(p.level);
  }
  const s = w.rng.combat.getState();
  h.num(s.s0 ^ s.s1 ^ s.s2 ^ s.s3);
  return h.digest();
}

function pctl(sorted: Float64Array, n: number, q: number): number {
  if (n === 0) return 0;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))] as number;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function reproCommand(s: CaseSpec): string {
  const parts = [
    'bun apps/game/src/dev/soak.ts',
    `--zones ${s.zone}`,
    `--classes ${s.classId}`,
    `--doctrines ${s.doctrine}`,
    `--difficulty ${s.difficulty}`,
    `--seedList ${s.seed}`,
    `--stats ${s.stats}`,
    `--cards ${s.cards}`,
    `--seconds ${s.seconds}`,
    '--jobs 1',
  ];
  if (s.runOptionsMax) parts.push('--runOptions max');
  if (s.env !== 'game') parts.push(`--env ${s.env}`);
  if (s.bot !== 'chase') parts.push(`--bot ${s.bot}`);
  return parts.join(' ');
}

/** a point inside the arena that is not walkable (selftest), or null */
function findBlockedPoint(field: TerrainField, nearX = 0, nearZ = 0): { x: number; z: number } | null {
  for (let r = 6; r < 90; r += 2) {
    for (let a = 0; a < 6.28; a += 0.1) {
      const x = nearX + Math.sin(a) * r;
      const z = nearZ + Math.cos(a) * r;
      if (Math.hypot(x, z) < field.arenaRadius - 6 && !field.walkable(x, z) && !field.walkable(x + 0.6, z) && !field.walkable(x - 0.6, z) && !field.walkable(x, z + 0.6) && !field.walkable(x, z - 0.6)) return { x, z };
    }
  }
  return null;
}

/**
 * where a player would steer when wedged: the direction (of 16) along which the ground stays walkable the longest (marched in 0.25 m
 * steps up to 5 m). `reach` < 1 m means the hero is enclosed.
 */
function escapeHeading(walkable: (x: number, z: number) => boolean, x: number, z: number, skip: number): { dir: number; reach: number } {
  let best = -1;
  let bestReach = -1;
  for (let k = 0; k < 16; k++) {
    const dir = (((k + skip) % 16) * Math.PI) / 8;
    let reach = 0;
    while (reach < 5 && walkable(x + Math.sin(dir) * (reach + 0.25), z + Math.cos(dir) * (reach + 0.25))) reach += 0.25;
    if (reach > bestReach + 1e-9) {
      bestReach = reach;
      best = dir;
    }
  }
  return { dir: best, reach: bestReach };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function sumValues(r: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(r)) s += v;
  return s;
}

/** event fields that are positions, directions or amounts: Infinity is as wrong there as NaN */
const FINITE_EVENT_KEYS = new Set(['x', 'z', 'dirX', 'dirZ', 'tx', 'tz', 'srcX', 'srcZ', 'amount', 'hp', 'value', 'scale', 'rot', 'a', 'b', 'c', 'radius', 'hpFrac', 'vol', 'level']);

/** first numeric field of an event that is NaN (or not finite where it must be), else null */
function badEventField(e: Record<string, unknown>): string | null {
  for (const k in e) {
    const v = e[k];
    if (typeof v !== 'number') continue;
    if (Number.isNaN(v) || (!Number.isFinite(v) && FINITE_EVENT_KEYS.has(k))) return `${k} = ${v}`;
  }
  return null;
}

/** first non-finite number of a HUD snapshot (or a cooldown / metin hp fraction outside 0..1), else null */
function badHud(h: Record<string, unknown>): string | null {
  const walk = (v: unknown, path: string, depth: number): string | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
    if (depth > 3 || !isRecord(v)) return null;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const bad = walk(v[i], `${path}[${i}]`, depth + 1);
        if (bad) return bad;
      }
      return null;
    }
    for (const [k, x] of Object.entries(v)) {
      const bad = walk(x, path === '' ? k : `${path}.${k}`, depth + 1);
      if (bad) return bad;
    }
    return null;
  };
  const bad = walk(h, '', 0);
  if (bad) return bad;
  const inUnit = (v: unknown): boolean => typeof v !== 'number' || (v >= -1e-6 && v <= 1 + 1e-6);
  const skills = Array.isArray(h.skills) ? (h.skills as Record<string, unknown>[]) : [];
  for (const s of skills) if (!inUnit(s.cooldown)) return `skills[${String(s.id)}].cooldown = ${String(s.cooldown)} (outside 0..1)`;
  const metins = Array.isArray(h.metins) ? (h.metins as Record<string, unknown>[]) : [];
  for (const m of metins) if (!inUnit(m.hpFrac)) return `metins[${String(m.id)}].hpFrac = ${String(m.hpFrac)} (outside 0..1)`;
  return null;
}

/** first NaN in boss / metin / player / skill state (plain objects; content defs skipped), else null */
function nanInState(w: World): string | null {
  const walk = (v: unknown, path: string, depth: number): string | null => {
    if (typeof v === 'number') return Number.isNaN(v) ? `${path} = NaN` : null;
    if (depth > 2 || !isRecord(v) || ArrayBuffer.isView(v)) return null;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 64; i++) {
        const bad = walk(v[i], `${path}[${i}]`, depth + 1);
        if (bad) return bad;
      }
      return null;
    }
    for (const k of Object.keys(v)) {
      if (k === 'def' || k === 'stats') continue;
      const bad = walk(v[k], `${path}.${k}`, depth + 1);
      if (bad) return bad;
    }
    return null;
  };
  for (let i = 0; i < w.bosses.length; i++) {
    const bad = walk(w.bosses[i], `boss[${i}]`, 0);
    if (bad) return bad;
  }
  for (let i = 0; i < w.metins.length; i++) {
    const bad = walk(w.metins[i], `metin[${i}]`, 0);
    if (bad) return bad;
  }
  for (const p of w.players) {
    const bad = walk(p, `player${p.index}`, 1) ?? walk(p.skills, `player${p.index}.skills`, 0);
    if (bad) return bad;
  }
  return null;
}

/**
 * walkable ground reachable from (x, z) through 0.25 m cells inside a 24 m box: `open` when the fill reaches the box edge, else the hero
 * stands in an ENCLOSED pocket of `areaM2`.
 */
function reachableArea(walkable: (x: number, z: number) => boolean, x: number, z: number): { open: boolean; areaM2: number } {
  const C = 0.25;
  const H = 48;
  const N = 2 * H + 1;
  const seen = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  let qh = 0;
  let qt = 0;
  const start = H * N + H;
  seen[start] = 1;
  queue[qt++] = start;
  let open = false;
  while (qh < qt) {
    const c = queue[qh++] as number;
    const ci = c % N;
    const cj = (c - ci) / N;
    if (ci === 0 || cj === 0 || ci === N - 1 || cj === N - 1) open = true;
    const nb = [ci > 0 ? c - 1 : -1, ci < N - 1 ? c + 1 : -1, cj > 0 ? c - N : -1, cj < N - 1 ? c + N : -1];
    for (const n of nb) {
      if (n < 0 || seen[n]) continue;
      const ni = n % N;
      const nj = (n - ni) / N;
      if (!walkable(x + (ni - H) * C, z + (nj - H) * C)) continue;
      seen[n] = 1;
      queue[qt++] = n;
    }
  }
  return { open, areaM2: Math.round(qt * C * C) };
}

/** selftest: a point 0.1 m inside a blocker edge (blocked for a creature and for SPAWN_TOL, walkable for the DEEP test), or null */
function findEdgePoint(
  raw: (x: number, z: number) => boolean,
  deep: (x: number, z: number) => boolean,
  spawnOk: (x: number, z: number) => boolean,
  x0: number,
  z0: number,
): { x: number; z: number } | null {
  for (let k = 0; k < 64; k++) {
    const a = (k * Math.PI) / 32;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    for (let d = 0.5; d < 60; d += 0.05) {
      if (raw(x0 + sx * d, z0 + sz * d)) continue;
      const qx = x0 + sx * (d + 0.1);
      const qz = z0 + sz * (d + 0.1);
      if (!spawnOk(qx, qz) && deep(qx, qz)) return { x: qx, z: qz };
      break;
    }
  }
  return null;
}

/** every number in a RunResult must be finite and non-negative where it is a counter */
function badResultField(r: RunResult): string | null {
  const walk = (v: unknown, path: string): string | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const bad = walk(v[i], `${path}[${i}]`);
        if (bad) return bad;
      }
      return null;
    }
    if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) {
        const bad = walk(x, `${path}.${k}`);
        if (bad) return bad;
      }
    }
    return null;
  };
  const bad = walk(r, 'result');
  if (bad) return bad;
  for (const k of ['kills', 'level', 'yeop', 'shards', 'damageDealt', 'damageTaken', 'metinsBroken', 'chestsOpened', 'time'] as const) {
    if (r[k] < 0) return `result.${k} = ${r[k]} < 0`;
  }
  if (r.level < 1) return `result.level = ${r.level}`;
  if (r.players.length < 1) return 'result.players is empty';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// the run

const CHECK_EVERY = 30; // ticks: non-finite, walkable, stuck, drift (>= once per sim second)
const SCAN_EVERY = 120; // ticks: enemies in blocked ground / alive counter drift
const STILL_LIMIT = 30; // s: hero stays inside 0.5 m
const WIGGLE_AFTER = 3; // s of standing still before the bot steers out
const NEAR = 12; // m: "enemies are near"
/**
 * "inside blocked ground" means DEEP inside: the point and its four neighbours 0.3 m away are all non-walkable. A creature that pressed
 * against a wall or a tree ends exactly on the blocker's edge (the Float32 store rounds it a hair inside), which is not a placement defect.
 */
const DEEP = 0.3;
/**
 * a SPAWN is a placement the sim chose, so its point must be walkable: only Float32 rounding (1e-5 m) is forgiven. The creature criterion
 * (DEEP, 0.3 m) hid spawns inside thin walls, small trunks and near blocker edges, and ai.ts reverts every step that starts and ends in
 * blocked ground, so such a creature never moves.
 */
const SPAWN_TOL = 0.05;
/** hero confinement: every 60 1 Hz samples (60 s of play) inside this radius round their centroid while nothing else explains it */
const CONFINE_WINDOW = 60;
const CONFINE_RADIUS = 2.5;
/** enemies within NEAR that make a confinement on open ground a bot artefact (a note), see the hero-confined check */
const CONFINE_CROWD = 40;
/** modal flood: more answered requests than this inside 30 s of sim (the busiest of 280 real runs answered 36: Run Options max) */
const MODAL_FLOOD_30S = 90;
const MAX_VIOLATIONS = 40;
/** per-tick wall times of a run, kept until runCase has decided about a re-run (never serialized) */
const tickTimes = new WeakMap<RunRow, Float64Array>();
/** SpawnOpts.source (sim/enemies.ts) */
const SPAWN_SOURCES = ['band', 'pack', 'swarm', 'boss', 'summon', 'elite'];

export function bareRow(spec: CaseSpec): RunRow {
  return {
    id: spec.id,
    group: spec.group,
    zone: spec.zone,
    classId: spec.classId,
    doctrine: spec.doctrine,
    difficulty: spec.difficulty,
    seed: spec.seed,
    sex: spec.sex,
    empire: spec.empire,
    stats: spec.stats,
    runOptionsMax: spec.runOptionsMax,
    cards: spec.cards,
    env: spec.env,
    bot: spec.bot,
    twinOf: spec.twinOf,
    outcome: 'crash',
    simSeconds: 0,
    wallMs: 0,
    ticks: 0,
    max: { alive: 0, enemyRows: 0, projectiles: 0, pickups: 0, zones: 0, telegraphs: 0, eventsPerTick: 0, modalQueue: 0 },
    tickMs: { mean: 0, p50: 0, p99: 0, max: 0, slowestTick: 0, slowestSimTime: 0 },
    eventsPerSec: 0,
    eventsSaturatedTicks: 0,
    level: 0,
    kills: 0,
    chests: 0,
    bossesKilled: [],
    seen: { bossSpawns: {}, bossDeaths: {}, metinWarns: {}, metinBreaks: {}, greatMetinBroken: false, modals: {}, skills: [], passives: [] },
    stuck: { wiggles: 0, maxStillSec: 0, maxStillNearSec: 0 },
    spawns: 0,
    blockedSpawns: 0,
    blockedBySource: {},
    enemiesBlockedMax: 0,
    aliveDriftMax: 0,
    zombieRowsMax: 0,
    stuckInBlocked: 0,
    stuckInBlockedExample: '',
    doubleDeaths: 0,
    finalBossHp: null,
    heroStartWalkable: true,
    stateHash: '',
    violations: [],
    violationCounts: {},
    notes: [],
    repro: reproCommand(spec),
  };
}

/** optional observers for ad-hoc diagnosis (tools, tests); never needed by the matrix */
export interface RunHooks {
  /** after every step (do not mutate the world) */
  afterStep?: (w: World) => void;
  /** once the run has stopped, before the verdict */
  onEnd?: (w: World) => void;
}

/**
 * One run, plus the noise check for tick-time violations: a sim tick that took > the limit is re-measured by running the same
 * deterministic case again; when the slow tick does not come back at the same tick the machine was busy (the numbers are kept in
 * `notes`, the violation is dropped). A spike that repeats at the same tick is a real hot spot and stays a violation.
 */
export function runCase(content: ContentDB, spec: CaseSpec, hooks: RunHooks = {}): RunRow {
  const row = runCaseOnce(content, spec, hooks);
  const perf = row.violations.filter((v) => v.kind === 'perf-spike' || v.kind === 'perf-p99');
  const perfFaults: (FaultName | undefined)[] = [undefined, 'slowTick', 'noiseTick', 'hotNoise', 'p99Creep'];
  const canRerun = !spec.id.endsWith('#rerun') && perfFaults.includes(spec.fault);
  const ticksA = tickTimes.get(row);
  tickTimes.delete(row);
  if (perf.length === 0 || !canRerun) return row;
  const again = runCaseOnce(content, { ...spec, id: `${spec.id}#rerun`, checkpoints: false }, {});
  const ticksB = tickTimes.get(again);
  tickTimes.delete(again);
  // the run is deterministic, so a real hot spot comes back at the SAME tick. Every tick of the first run over the limit is looked up in
  // the re-run (+-1 tick); half the limit counts as back (the re-run may land on a quieter moment of the machine). Comparing only the two
  // slowest ticks called a real hot spot noise whenever a bigger one-off stall sat elsewhere in either run.
  let spikeBack = false;
  let spikeBackAt = -1;
  if (ticksA && ticksB) {
    for (let i = 0; i < ticksA.length && !spikeBack; i++) {
      if ((ticksA[i] as number) <= spec.maxTickLimitMs) continue;
      for (let j = Math.max(0, i - 1); j <= Math.min(ticksB.length - 1, i + 1); j++) {
        if ((ticksB[j] as number) > spec.maxTickLimitMs * 0.5) {
          spikeBack = true;
          spikeBackAt = i + 1;
        }
      }
    }
  } else spikeBack = again.tickMs.max > spec.maxTickLimitMs && Math.abs(again.tickMs.slowestTick - row.tickMs.slowestTick) <= 1;
  if (spikeBack && spikeBackAt > 0) row.notes.push(`tick ${spikeBackAt} was over ${spec.maxTickLimitMs} ms on the first run and over half of it on the re-run: a repeatable hot spot`);
  const p99Back = again.tickMs.p99 > spec.p99LimitMs;
  const keep = new Set<string>();
  if (spikeBack) keep.add('perf-spike');
  if (p99Back) keep.add('perf-p99');
  const dropped = perf.filter((v) => !keep.has(v.kind));
  row.violations = row.violations.filter((v) => !dropped.includes(v));
  for (const v of dropped) {
    delete row.violationCounts[v.kind];
    row.notes.push(`machine noise, not a finding: ${v.detail}; the same deterministic case re-run alone: max tick ${again.tickMs.max} ms at tick ${again.tickMs.slowestTick} (first run ${row.tickMs.max} ms at tick ${row.tickMs.slowestTick}), p99 ${again.tickMs.p99} ms`);
  }
  for (const v of perf.filter((x) => keep.has(x.kind))) row.notes.push(`reproduced on a re-run (max tick ${again.tickMs.max} ms at tick ${again.tickMs.slowestTick}): ${v.kind}`);
  return row;
}

function runCaseOnce(content: ContentDB, spec: CaseSpec, hooks: RunHooks): RunRow {
  const wall0 = performance.now();
  const row = bareRow(spec);
  const violations = row.violations;
  const counts = new Map<string, number>();
  const violate = (kind: string, detail: string, w?: World): void => {
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    row.violationCounts[kind] = n;
    // each kind is recorded a few times (first occurrences carry the information), the rest is counted in `violationCounts`. The FIRST
    // occurrence of a kind is always kept, also past MAX_VIOLATIONS: a late kind (a throw, no-end, god-defeat) must never vanish from the
    // per-kind report because earlier kinds filled the list.
    if ((n <= 3 && violations.length < MAX_VIOLATIONS) || n === 1) violations.push({ kind, detail, tick: w?.tick, simTime: w ? r2(w.time) : undefined });
  };

  const zone = content.zones.find((z) => z.id === spec.zone);
  const cls = content.classes.find((c) => c.id === spec.classId);
  if (spec.checkpoints) row.checkpoints = [];
  if (!zone || !cls) {
    violate('bad-case', `unknown zone '${spec.zone}' or class '${spec.classId}'`);
    row.wallMs = Math.round(performance.now() - wall0);
    return row;
  }

  let w: World | null = null;
  try {
    // ---- world: real terrain (walls, cliffs, liquids, arena radius) + the manifest boss clip durations, like app/run.ts ----
    const field = createTerrainField(zone.biome, spec.seed);
    const bossSpawn = spec.bossSpawn;
    const env: WorldEnv = {
      ...field.env,
      bossModel: (id: string) => ({ spawn: bossSpawn[id] ?? 0, breath: false }),
    };
    if (spec.env === 'full') {
      env.moveCircle = (x0, z0, x1, z1, r, out) => field.moveCircle(x0, z0, x1, z1, r, out);
      env.surfaceAt = (x, z) => field.surfaceAt(x, z);
    }
    const table = runOptionsTable(content.balance);
    const runOptions: Partial<RunOptions> | undefined = spec.runOptionsMax
      ? { density: table.density.max, health: table.health.max, damage: table.damage.max, speed: table.speed.max }
      : undefined;
    w = createWorld(
      { zone: spec.zone, difficulty: spec.difficulty, classId: spec.classId, doctrine: spec.doctrine, sex: spec.sex, empire: spec.empire, seed: spec.seed, meta: metaFor(content, spec), runOptions },
      content,
      undefined,
      env,
    );
    playLoop(w, field, spec, row, violate, hooks);
  } catch (err) {
    row.outcome = 'crash';
    violate('throw', describeError(err), w ?? undefined);
  }
  row.wallMs = Math.round(performance.now() - wall0);
  // the world is evaluated whatever happened (a throw leaves it in its last state)
  if (w) {
    try {
      finish(content, spec, w, row, violate);
    } catch (err) {
      violate('harness-error', `finish: ${describeError(err)}`, w);
    }
  }
  return row;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(0, 9).join('\n')}`;
  return String(err);
}

type Violate = (kind: string, detail: string, w?: World) => void;

export interface CardPolicy {
  pick(m: ModalRequest): number;
  /** 0 = pick, 1 = reroll, 2 = banish, 3 = skip */
  extra(m: ModalRequest, p: World['players'][number]): number;
}

/**
 * how much a sensible player wants a card: an awakening first, then a passive that moves a skill toward its awakening pact
 * (`card.pact.awakens`), then a new skill (a real player fills the 6 active slots in the first minute and a half). 0 = no preference.
 */
export function cardWish(c: ModalRequest['cards'][number]): number {
  if (c.awakening) return 3;
  if ((c.pact?.awakens?.length ?? 0) > 0) return 2;
  return c.kind === 'newSkill' ? 1 : 0;
}

/**
 * The soak's card picker. The first / last / random mode only decides among cards the player has no wish between: a naive picker
 * never pursues an awakening pact (skills would stay at G2 for the whole run, slot bars never fill) and no longer plays like a hero
 * the roguelite rules were balanced for - so the awakening / pact / new-skill wishes (cardWish) come first. No rng is drawn for them.
 */
export function makeCardPolicy(mode: CardMode, seed: number): CardPolicy {
  const rng = new Rng((seed ^ 0x5eed5eed) >>> 0);
  return {
    pick(m) {
      const n = m.cards.length;
      if (n <= 1) return 0;
      let best = 0;
      for (const c of m.cards) best = Math.max(best, cardWish(c));
      if (best > 0) return m.cards.findIndex((c) => cardWish(c) === best);
      if (mode === 'first') return 0;
      if (mode === 'last') return n - 1;
      return rng.int(n);
    },
    extra(m, p) {
      // exercise the other answers now and then (only the random policy; a rolled value is consumed either way)
      const roll = rng.next();
      if (mode !== 'random') return 0;
      if (m.kind === 'levelUp' && roll < 0.1 && p.rerolls > 0) return 1;
      if (m.kind === 'levelUp' && roll > 0.1 && roll < 0.16 && p.banishes > 0 && m.cards.length > 1) return 2;
      if ((m.kind === 'levelUp' || m.kind === 'essence') && roll > 0.16 && roll < 0.21 && p.skips > 0) return 3;
      return 0;
    },
  };
}

/** answer every non-final modal; false when one cannot be answered (the run would softlock) */
function drain(w: World, policy: CardPolicy, seenModals: Record<string, number>, row: RunRow, violate: Violate): boolean {
  let guard = 0;
  while (w.modals.length > 0) {
    const m = w.modals[0] as ModalRequest;
    if (m.kind === 'runEnd') return true;
    if (w.modals.length > row.max.modalQueue) row.max.modalQueue = w.modals.length;
    if (++guard > 400) {
      violate('modal-undrained', `400 answers did not empty the queue; first modal ${m.kind} level ${m.level}`, w);
      return false;
    }
    seenModals[m.kind] = (seenModals[m.kind] ?? 0) + 1;
    const p = w.players[m.player] ?? w.players[0];
    if (!p) return false;
    const before = w.modals.length;
    const extra = policy.extra(m, p);
    let ok = false;
    if (extra === 1) ok = w.reroll(m.player);
    else if (extra === 2) ok = w.banish(m.cards.length > 1 ? 1 : 0, m.player);
    else if (extra === 3) ok = w.skip(m.player);
    if (extra === 1 || extra === 2) continue; // the modal is still open: answer it with a card next round
    if (extra === 3 && ok) continue;
    ok = w.chooseCard(policy.pick(m), m.player);
    if (!ok) ok = w.chooseCard(0, m.player);
    if (!ok) ok = w.skip(m.player);
    if (!ok || w.modals.length >= before) {
      // a pending request nothing can answer: the game would be frozen on this modal
      violate('modal-undrained', `modal '${m.kind}' (player ${m.player}, level ${m.level}, ${m.cards.length} cards, source '${m.source}') cannot be answered by chooseCard / skip`, w);
      return false;
    }
  }
  return true;
}

function playLoop(w: World, field: TerrainField, spec: CaseSpec, row: RunRow, violate: Violate, hooks: RunHooks): void {
  const zone = w.zone;
  const hero = w.players[0];
  if (!hero) throw new Error('world has no player');
  const walkableRaw = w.env.walkable ?? ((): boolean => true);
  // true unless the point is deep inside blocked ground (see DEEP)
  const walkable = (x: number, z: number): boolean => walkableRaw(x, z) || walkableRaw(x + DEEP, z) || walkableRaw(x - DEEP, z) || walkableRaw(x, z + DEEP) || walkableRaw(x, z - DEEP);
  // spawns: the point itself (Float32 rounding forgiven), see SPAWN_TOL
  const spawnWalkable = (x: number, z: number): boolean =>
    walkableRaw(x, z) || walkableRaw(x + SPAWN_TOL, z) || walkableRaw(x - SPAWN_TOL, z) || walkableRaw(x, z + SPAWN_TOL) || walkableRaw(x, z - SPAWN_TOL);
  row.heroStartWalkable = walkable(hero.x, hero.z);
  if (!row.heroStartWalkable) violate('hero-outside-walkable', `the hero starts at (${hero.x.toFixed(1)}, ${hero.z.toFixed(1)}) on non-walkable ground`, w);

  const maxTicks = Math.ceil(spec.seconds * 60) + 4000; // the sim clock decides; the tick cap only guards a clock that stalls
  const tickMs = new Float64Array(maxTicks + 8);
  let nTicks = 0;
  const policy = makeCardPolicy(spec.cards, spec.seed);
  const seen = row.seen;

  // bot state
  let anchorX = hero.x;
  let anchorZ = hero.z;
  let anchorT = 0;
  let wiggleUntil = -1;
  let wiggleDir = 0;
  let stuckReported = 0;
  let enclosed = false;
  let nearAtAnchor = 0;

  // fault state
  const fault = spec.fault;
  const faultTick = 120;
  let blocked: { x: number; z: number } | null = null;
  let stuckFaultId = 0;
  let pinX = 0;
  let pinZ = 0;
  let evCount = 0;
  const wallStart = performance.now();
  let aliveDriftBad = 0;
  let nonWalkSeconds = 0;
  let chaseUntil = -1;
  let chaseRef: { t: number; frac: number } | null = null;
  const deadIds = new Set<number>();
  let blockedRun = new Map<number, number>();
  const bossHist: { t: number; frac: number }[] = [];
  // review additions: modal flood window, hero confinement window, HUD checks, transient-fault state
  const modalTimes: number[] = [];
  let modalHead = 0;
  let modalFloodReported = false;
  row.modalPeak30s = 0;
  row.blockedSpawnsDeep = 0;
  row.hudChecks = 0;
  const confX: number[] = [];
  const confZ: number[] = [];
  let confReports = 0;
  let nanRestore: { row: number; x: number } | null = null;
  let stallBoss = -1;
  const fullTicks = { enemies: 0, projectiles: 0, pickups: 0, zones: 0, telegraphs: 0 };
  row.storeFullTicks = fullTicks;

  while (w.time < spec.seconds && nTicks < maxTicks && !w.over) {
    if (nanRestore) {
      // nanOnce: the injected NaN lives for exactly one tick (a transient the 30-tick scan cannot see)
      w.enemies.x[nanRestore.row] = nanRestore.x;
      nanRestore = null;
    }
    // ---- modals ----
    const answered0 = sumValues(seen.modals);
    if (!drain(w, policy, seen.modals, row, violate)) {
      row.outcome = 'aborted';
      break;
    }
    // modal flood: a request that keeps coming back is a softlock for a player even when every single one can be answered
    for (let k = sumValues(seen.modals) - answered0; k > 0; k--) modalTimes.push(w.time);
    while (modalHead < modalTimes.length && (modalTimes[modalHead] as number) < w.time - 30) modalHead++;
    const inWindow = modalTimes.length - modalHead;
    if (inWindow > row.modalPeak30s) row.modalPeak30s = inWindow;
    if (inWindow > MODAL_FLOOD_30S && !modalFloodReported) {
      modalFloodReported = true;
      violate('modal-flood', `${inWindow} modal requests answered within 30 s of sim (limit ${MODAL_FLOOD_30S}; ${JSON.stringify(seen.modals)} so far)`, w);
    }
    if (modalHead > 4096) {
      modalTimes.splice(0, modalHead);
      modalHead = 0;
    }

    // ---- fault injection (selftest only) ----
    if (fault && w.tick === faultTick) {
      switch (fault) {
        case 'throw':
          w.hash.rebuild = (): void => {
            throw new Error('selftest: injected error inside a step');
          };
          break;
        case 'nan':
          hero.x = Number.NaN;
          break;
        case 'overcap': {
          const ti = 0;
          for (let i = 0; i < ENEMY_SOFT_CAP + 180; i++) spawnEnemy(w, ti, hero.x + 20 + (i % 7), hero.z + 20 + (i % 11), { spawnTime: 0 });
          break;
        }
        case 'stuck':
          pinX = hero.x;
          pinZ = hero.z;
          break;
        case 'modal':
          w.modals.push({
            id: w.nextModalId++,
            kind: 'levelUp',
            player: 0,
            cards: [],
            canReroll: false,
            canBanish: false,
            canSkip: false,
            rerolls: 0,
            banishes: 0,
            skips: 0,
            level: 99,
            source: '',
            free: false,
            awakened: false,
            waited: 0,
            result: null,
          });
          break;
        case 'outside': {
          blocked = findBlockedPoint(field, hero.x, hero.z);
          if (blocked) {
            hero.x = blocked.x;
            hero.z = blocked.z;
          }
          break;
        }
        case 'blockedSpawn':
          // injected after the step below (World.step clears the event list when it starts)
          break;
        case 'nondeterm':
          w.rng.combat.setState({ s0: (Math.random() * 4294967296) | 0, s1: 1, s2: 2, s3: 3 });
          break;
        case 'slowTick': {
          const rebuild = w.hash.rebuild.bind(w.hash);
          w.hash.rebuild = (...a: Parameters<typeof rebuild>): void => {
            const t0 = performance.now();
            while (performance.now() - t0 < 320) {
              /* spin: one slow tick */
            }
            w.hash.rebuild = rebuild;
            rebuild(...a);
          };
          break;
        }
        case 'noiseTick':
          // a one-off slow tick that a second run does not have (the re-run's id ends with #rerun): machine noise
          if (!spec.id.endsWith('#rerun')) {
            const rebuild = w.hash.rebuild.bind(w.hash);
            w.hash.rebuild = (...a: Parameters<typeof rebuild>): void => {
              const t0 = performance.now();
              while (performance.now() - t0 < 320) {
                /* spin */
              }
              w.hash.rebuild = rebuild;
              rebuild(...a);
            };
          }
          break;
        case 'zombie': {
          // an enemy killed and then put back into a live state in the same tick (what a kill during its own strike does)
          const zr = spawnEnemy(w, 0, hero.x + 9, hero.z + 9, { spawnTime: 0 });
          if (zr >= 0) {
            killEnemy(w, zr, 0, -1, false);
            w.enemies.state[zr] = EnemyState.Recover;
          }
          break;
        }
        case 'stuckEnemy':
          // pinned + invulnerable + immobile: the hero cannot clear it and the AI cannot walk it out
          blocked = findBlockedPoint(field, hero.x, hero.z);
          if (blocked) {
            const r = spawnEnemy(w, 0, blocked.x, blocked.z, { spawnTime: 0, speedMul: 0, flags: EnemyFlag.Invuln | EnemyFlag.Pinned });
            if (r >= 0) stuckFaultId = w.enemies.id[r] as number;
          }
          break;
        case 'noEnd':
          break;
        case 'throwRare': {
          // one throw on one rare tick deep into the run (not the tick the fault is armed on)
          const rebuild = w.hash.rebuild.bind(w.hash);
          w.hash.rebuild = (...a: Parameters<typeof rebuild>): void => {
            if (w.tick === 4321) throw new Error('selftest: injected error on tick 4321 only');
            rebuild(...a);
          };
          break;
        }
        case 'nanHud':
          // a NaN only the HUD shows (the XP bar): findNonFinite does not look at xpNext
          hero.xpNext = Number.NaN;
          break;
        case 'pocket':
        case 'bossStall':
          pinX = hero.x;
          pinZ = hero.z;
          if (fault === 'bossStall') {
            const b = spawnBoss(w, zone.final.boss, true);
            stallBoss = b ? b.enemy : -1;
          }
          break;
        case 'hotNoise':
        case 'p99Creep': {
          const rebuild = w.hash.rebuild.bind(w.hash);
          const spin = (ms: number): void => {
            const t0 = performance.now();
            while (performance.now() - t0 < ms) {
              /* spin */
            }
          };
          const firstRun = !spec.id.endsWith('#rerun');
          w.hash.rebuild = (...a: Parameters<typeof rebuild>): void => {
            if (fault === 'hotNoise') {
              if (w.tick === 200) spin(300); // a real hot spot: both runs
              if (w.tick === 700 && firstRun) spin(700); // a bigger one-off stall of the machine: first run only
            } else if (w.tick % 40 === 0) spin(16); // 2.5 % of the ticks cost 16 ms: p99 = 16 ms
            rebuild(...a);
          };
          break;
        }
      }
    }
    if (fault === 'modalFlood' && w.tick >= faultTick && w.tick % 15 === 0 && hero.pendingLevels < 1) hero.pendingLevels = 1;
    if (fault === 'stuck' && w.tick >= faultTick) {
      hero.x = pinX;
      hero.z = pinZ;
    }

    // ---- input: the sim-test bot, with the unstuck wiggle ----
    let input: PlayerInput = botInput(w, w.tick);
    if (spec.bot === 'chase' && w.tick % 60 === 0 && w.bosses.length > 0) {
      // every second: has the boss lost at least 1% hp in the last 20 s? if not, walk up to it for 10 s
      const tb = w.bosses.find((b) => b.final) ?? (w.bosses[0] as (typeof w.bosses)[number]);
      const tr = w.enemies.find(tb.enemy);
      if (tr >= 0) {
        const frac = (w.enemies.hp[tr] as number) / Math.max(1e-9, w.enemies.hpMax[tr] as number);
        if (!chaseRef || chaseRef.t > w.time || w.time - chaseRef.t >= 20) {
          if (chaseRef && chaseRef.t <= w.time && chaseRef.frac - frac < 0.01 && tb.age > 6) chaseUntil = w.time + 10;
          chaseRef = { t: w.time, frac };
        }
      }
    }
    if (w.time < chaseUntil && w.bosses.length > 0) {
      const tb = w.bosses.find((b) => b.final) ?? (w.bosses[0] as (typeof w.bosses)[number]);
      const tr = w.enemies.find(tb.enemy);
      if (tr >= 0) {
        const dx = (w.enemies.x[tr] as number) - hero.x;
        const dz = (w.enemies.z[tr] as number) - hero.z;
        const d = Math.hypot(dx, dz) || 1;
        // straight at it; once on top of it, slide sideways so the hero is not a standing target
        input = d > 2.2 ? { moveX: dx / d, moveZ: dz / d } : { moveX: -dz / d, moveZ: dx / d };
      }
    }
    if (w.time < wiggleUntil) input = { moveX: Math.sin(wiggleDir), moveZ: Math.cos(wiggleDir) };

    // ---- step ----
    const t0 = performance.now();
    w.step([input]);
    const dtMs = performance.now() - t0;
    tickMs[nTicks++] = dtMs;
    if (fault === 'stuck' && w.tick >= faultTick) {
      hero.x = pinX;
      hero.z = pinZ;
    }
    // the injected defect is "the hero stays outside walkable ground": the game's hero movement now pushes a hero out of a blocker (SOAK-4
    // moveCircle + the pocket escape), so the injection holds it there like the stuck pin, otherwise there is nothing for the detector to see
    // same for the injected stuck creature: the AI now nudges a creature out of blocked ground (placeOnGround), so the fault holds it in place
    if (fault === 'stuckEnemy' && blocked && stuckFaultId !== 0 && w.tick >= faultTick) {
      const r = w.enemies.find(stuckFaultId);
      if (r >= 0) {
        w.enemies.x[r] = blocked.x;
        w.enemies.z[r] = blocked.z;
      }
    }
    if (fault === 'outside' && blocked && w.tick >= faultTick) {
      hero.x = blocked.x;
      hero.z = blocked.z;
    }
    if (fault === 'blockedSpawn' && w.tick === faultTick + 1) {
      blocked = findBlockedPoint(field, hero.x, hero.z);
      if (blocked) spawnEnemy(w, 0, blocked.x, blocked.z, { spawnTime: 0 });
    }
    if (fault && w.tick === faultTick + 1) {
      if (fault === 'thinWallSpawn') {
        // a spawn 0.1 m inside a blocker edge: blocked for the creature (it can never step out), walkable for the 0.3 m DEEP test
        const p = findEdgePoint(walkableRaw, walkable, spawnWalkable, hero.x, hero.z);
        if (p) spawnEnemy(w, 0, p.x, p.z, { spawnTime: 0 });
      } else if (fault === 'nanOnce' && w.enemies.count > 0) {
        nanRestore = { row: 0, x: w.enemies.x[0] as number };
        w.enemies.x[0] = Number.NaN;
      } else if (fault === 'nanEvent') {
        w.bus.vfx('vfx_selftest', Number.NaN, hero.z, 0, 1, 1, 0.5);
      }
    }
    if ((fault === 'pocket' || fault === 'bossStall') && w.tick >= faultTick) {
      if (fault === 'pocket') {
        // the hero can walk, but only inside a 1.5 m pocket (a ring of blockers): it moves, so the 0.5 m anchor never fires
        const dx = hero.x - pinX;
        const dz = hero.z - pinZ;
        const d = Math.hypot(dx, dz);
        if (d > 1.5) {
          hero.x = pinX + (dx / d) * 1.5;
          hero.z = pinZ + (dz / d) * 1.5;
        }
      } else {
        // the final boss cannot lose hp: the run can never end
        const br = w.enemies.find(stallBoss);
        if (br >= 0) w.enemies.hp[br] = w.enemies.hpMax[br] as number;
      }
    }

    hooks.afterStep?.(w);

    // ---- events of this tick ----
    const evs = w.events;
    const nEv = evs.length;
    evCount += nEv;
    if (nEv > row.max.eventsPerTick) row.max.eventsPerTick = nEv;
    if (w.bus.full) row.eventsSaturatedTicks++;
    for (let i = 0; i < nEv; i++) {
      const e = evs[i];
      if (!e) continue;
      // every number an event carries reaches the renderer / audio / damage numbers: NaN never, Infinity never on a position,
      // direction or amount (the 30-tick store scan never saw events at all)
      const badField = badEventField(e as unknown as Record<string, unknown>);
      if (badField) violate('non-finite-event', `event '${e.t}' field ${badField} at t=${w.time.toFixed(2)}`, w);
      switch (e.t) {
        case 'enemySpawn':
          row.spawns++;
          if (!walkable(e.x, e.z)) row.blockedSpawnsDeep = (row.blockedSpawnsDeep ?? 0) + 1;
          if (!spawnWalkable(e.x, e.z)) {
            row.blockedSpawns++;
            const name = SPAWN_SOURCES[e.source] ?? `source${e.source}`;
            const b = (row.blockedBySource[name] ??= { count: 0, example: '' });
            b.count++;
            if (b.example === '') b.example = `${w.typeDefs[e.type]?.id ?? e.type} tier ${e.tier} at (${e.x.toFixed(1)}, ${e.z.toFixed(1)}) r=${Math.hypot(e.x, e.z).toFixed(0)}/${w.arenaRadius.toFixed(0)} t=${w.time.toFixed(1)}`;
          }
          break;
        case 'enemyDeath':
          if (deadIds.has(e.id)) {
            row.doubleDeaths++;
            violate('double-death', `enemy id ${e.id} (${w.typeDefs[e.type]?.id ?? e.type}, tier ${e.tier}) died twice (second enemyDeath at t=${w.time.toFixed(2)}): kills, loot, xp and spawner.alive count it twice`, w);
          } else deadIds.add(e.id);
          break;
        case 'bossSpawn':
          seen.bossSpawns[e.bossId] = (seen.bossSpawns[e.bossId] ?? 0) + 1;
          break;
        case 'bossDeath':
          seen.bossDeaths[e.bossId] = (seen.bossDeaths[e.bossId] ?? 0) + 1;
          break;
        case 'metinWarn':
          seen.metinWarns[e.def] = (seen.metinWarns[e.def] ?? 0) + 1;
          break;
        case 'metinBreak':
          seen.metinBreaks[e.def] = (seen.metinBreaks[e.def] ?? 0) + 1;
          if (e.great) seen.greatMetinBroken = true;
          break;
        default:
          break;
      }
    }

    // ---- per-tick caps ----
    // a store can never hold more rows than CAP (alloc returns -1), so `max > CAP` can never fire: what matters is a store that is FULL,
    // because then the next spawn / telegraph / pickup is dropped without a trace
    if (w.enemies.count >= CAP.enemies) fullTicks.enemies++;
    if (w.projectiles.count >= CAP.projectiles) fullTicks.projectiles++;
    if (w.pickups.count >= CAP.pickups) fullTicks.pickups++;
    if (w.zones.count >= CAP.zones) fullTicks.zones++;
    if (w.telegraphs.count >= CAP.telegraphs) fullTicks.telegraphs++;
    const alive = w.spawner.alive;
    if (alive > row.max.alive) row.max.alive = alive;
    if (w.enemies.count > row.max.enemyRows) row.max.enemyRows = w.enemies.count;
    if (w.projectiles.count > row.max.projectiles) row.max.projectiles = w.projectiles.count;
    if (w.pickups.count > row.max.pickups) row.max.pickups = w.pickups.count;
    if (w.zones.count > row.max.zones) row.max.zones = w.zones.count;
    if (w.telegraphs.count > row.max.telegraphs) row.max.telegraphs = w.telegraphs.count;

    // a row with hp <= 0 that is not dying (killed, then put back into a live state): every tick, it is cheap.
    // The same pass sums every position / hp: a non-finite sum is a NaN or Infinity that exists on THIS tick (the full findNonFinite
    // scan runs every CHECK_EVERY ticks only, so a value that is NaN for less than half a second used to pass unseen).
    {
      const ee = w.enemies;
      let zombies = 0;
      let fin = hero.x + hero.z + hero.hp + hero.hpMax + hero.xp;
      for (let i = 0; i < ee.count; i++) {
        fin += (ee.x[i] as number) + (ee.z[i] as number) + (ee.hp[i] as number);
        if ((ee.hp[i] as number) <= 0 && ee.state[i] !== EnemyState.Dying && ((ee.flags[i] as number) & EnemyFlag.Metin) === 0) zombies++;
      }
      const pr = w.projectiles;
      for (let i = 0; i < pr.count; i++) fin += (pr.x[i] as number) + (pr.z[i] as number) + (pr.damage[i] as number);
      const pk = w.pickups;
      for (let i = 0; i < pk.count; i++) fin += (pk.x[i] as number) + (pk.z[i] as number) + (pk.value[i] as number);
      if (zombies > row.zombieRowsMax) row.zombieRowsMax = zombies;
      if (!Number.isFinite(fin)) {
        violate('non-finite', `${findNonFinite(w) ?? 'a position / hp / value sum'} on tick ${w.tick} (per-tick check)`, w);
        row.outcome = 'aborted';
        break;
      }
    }

    // ---- the HUD snapshot the game builds 10 times a second (app/run.ts pushHud -> World.hud): it must not throw and its numbers must be
    // finite (a NaN there is a broken bar / ring / timer on screen); it reads state no store scan covers (xpNext, cooldowns, metin hp, dps)
    if (w.tick % 6 === 0) {
      const h = w.hud(0);
      row.hudChecks = (row.hudChecks ?? 0) + 1;
      const bad = badHud(h as unknown as Record<string, unknown>);
      if (bad) violate('hud-invalid', `HUD snapshot: ${bad} at t=${w.time.toFixed(2)}`, w);
    }

    // ---- once per CHECK_EVERY ticks ----
    if (w.tick % CHECK_EVERY === 0) {
      const bad = findNonFinite(w);
      if (bad) {
        violate('non-finite', bad, w);
        row.outcome = 'aborted';
        break;
      }
      if (!Number.isFinite(w.time) || !Number.isFinite(w.corruption) || !Number.isFinite(w.darkness)) {
        violate('non-finite', `world scalar: time ${w.time} corruption ${w.corruption} darkness ${w.darkness}`, w);
        row.outcome = 'aborted';
        break;
      }
      if (hero.alive && hero.hp > hero.hpMax * 1.001 + 1) violate('hp-over-max', `hero hp ${hero.hp.toFixed(1)} > hpMax ${hero.hpMax.toFixed(1)}`, w);
      if (alive < 0) violate('alive-negative', `spawner.alive = ${alive}`, w);

      // hero on non-walkable ground (two consecutive seconds: a one-tick knock into a corner is not a finding)
      if (hero.alive && !walkable(hero.x, hero.z)) {
        nonWalkSeconds++;
        if (nonWalkSeconds === 4) violate('hero-outside-walkable', `hero at (${hero.x.toFixed(2)}, ${hero.z.toFixed(2)}) is not on walkable ground for 2 s`, w);
      } else nonWalkSeconds = 0;

      // hero stuck: inside 0.5 m of an anchor for STILL_LIMIT s (the bot steers out after WIGGLE_AFTER s)
      if (w.endTimer >= 0 || !hero.alive) {
        anchorX = hero.x;
        anchorZ = hero.z;
        anchorT = w.time;
      } else if (Math.hypot(hero.x - anchorX, hero.z - anchorZ) >= 0.5) {
        anchorX = hero.x;
        anchorZ = hero.z;
        anchorT = w.time;
        nearAtAnchor = 0;
      } else {
        const still = w.time - anchorT;
        const near = countNear(w, hero.x, hero.z, NEAR);
        if (near > nearAtAnchor) nearAtAnchor = near;
        if (still > row.stuck.maxStillSec) row.stuck.maxStillSec = r2(still);
        if (near > 0 && still > row.stuck.maxStillNearSec) row.stuck.maxStillNearSec = r2(still);
        if (still >= WIGGLE_AFTER && w.time >= wiggleUntil) {
          // steer along the longest free run (skipping the headings that already failed this episode); when even that is shorter
          // than a metre the hero is enclosed, which is reported with the stuck violation
          const esc = escapeHeading(walkable, hero.x, hero.z, (row.stuck.wiggles * 5) % 16);
          wiggleDir = esc.dir;
          enclosed = esc.reach < 1;
          wiggleUntil = w.time + 2;
          row.stuck.wiggles++;
        }
        if (still >= STILL_LIMIT && stuckReported < 3) {
          stuckReported++;
          violate('hero-stuck', `hero within 0.5 m of (${anchorX.toFixed(1)}, ${anchorZ.toFixed(1)}) for ${still.toFixed(0)} s of sim, ${near} enemies within ${NEAR} m, ${row.stuck.wiggles} escape headings tried, ${enclosed ? 'ENCLOSED: no free run of 1 m in any of 16 directions' : 'a free run exists'}`, w);
          anchorT = w.time; // report again after another STILL_LIMIT
        }
      }

      // NaN in state no store scan covers: boss pattern state, metins, skill instances (a NaN cooldown silences a skill for good)
      {
        const nanAt = nanInState(w);
        if (nanAt) violate('non-finite', `${nanAt} (state scan)`, w);
      }

      // hero confinement: 60 s of play inside a 2.5 m radius. The 0.5 m anchor above never fires for a hero that can move but cannot
      // leave a small pocket (a ring of props / cliffs): the bot keeps moving inside it. Chasing a boss (the bot circles it at 2 m) and
      // the end of the run are not play and restart the window.
      if (w.tick % 60 === 0) {
        if (!hero.alive || w.endTimer >= 0 || w.time < chaseUntil) {
          confX.length = 0;
          confZ.length = 0;
        } else {
          confX.push(hero.x);
          confZ.push(hero.z);
          if (confX.length > CONFINE_WINDOW) {
            confX.shift();
            confZ.shift();
          }
          if (confX.length === CONFINE_WINDOW) {
            let cx = 0;
            let cz = 0;
            for (let k = 0; k < CONFINE_WINDOW; k++) {
              cx += confX[k] as number;
              cz += confZ[k] as number;
            }
            cx /= CONFINE_WINDOW;
            cz /= CONFINE_WINDOW;
            let spread = 0;
            for (let k = 0; k < CONFINE_WINDOW; k++) spread = Math.max(spread, Math.hypot((confX[k] as number) - cx, (confZ[k] as number) - cz));
            if (row.heroMinSpread60s === undefined || spread < row.heroMinSpread60s) row.heroMinSpread60s = r2(spread);
            if (spread < CONFINE_RADIUS && confReports < 3) {
              confReports++;
              const pocket = reachableArea(walkableRaw, hero.x, hero.z);
              const near = countNear(w, hero.x, hero.z, NEAR);
              const what = `hero stayed within ${spread.toFixed(2)} m of (${cx.toFixed(1)}, ${cz.toFixed(1)}) for ${CONFINE_WINDOW} s of play; walkable ground reachable from it: ${pocket.open ? `open (> ${pocket.areaM2} m2 inside a 24 m box)` : `ENCLOSED pocket of ${pocket.areaM2} m2`}; ${near} enemies within ${NEAR} m`;
              // creatures never body-block the hero (player.ts moves it against terrain only): on open ground inside a crowd the bot's
              // repulsion from every side cancels out, which a player would not do. An enclosed pocket, or no crowd to explain it, is a finding.
              if (pocket.open && near >= CONFINE_CROWD) row.notes.push(`bot held in a crowd, not a terrain trap: ${what}`);
              else violate('hero-confined', what, w);
              confX.length = 0;
              confZ.length = 0;
            }
          }
        }
      }

      if (w.tick % 600 === 0) {
        const fb = w.bosses.find((b) => b.final);
        const fr = fb ? w.enemies.find(fb.enemy) : -1;
        if (fr >= 0) bossHist.push({ t: w.time, frac: (w.enemies.hp[fr] as number) / Math.max(1e-9, w.enemies.hpMax[fr] as number) });
      }

      // events per second sanity is aggregated at the end; checkpoints for the determinism pairs
      if (spec.checkpoints && w.tick % 600 === 0) row.checkpoints?.push(checkpointHash(w));
    }

    // ---- every SCAN_EVERY ticks: enemies in blocked ground, alive counter vs rows ----
    if (w.tick % SCAN_EVERY === 0) {
      const e = w.enemies;
      let inBlocked = 0;
      let actual = 0;
      const nextRun = new Map<number, number>();
      for (let i = 0; i < e.count; i++) {
        const fl = e.flags[i] as number;
        if ((fl & EnemyFlag.Metin) !== 0) continue;
        if (e.state[i] === EnemyState.Dying) continue;
        actual++;
        const ex = e.x[i] as number;
        const ez = e.z[i] as number;
        if (!walkable(ex, ez)) {
          inBlocked++;
          const id = e.id[i] as number;
          const n = (blockedRun.get(id) ?? 0) + 1;
          nextRun.set(id, n);
          if (n === 3) {
            const isBoss = (fl & EnemyFlag.Boss) !== 0;
            const desc = `${w.typeDefs[e.type[i] as number]?.id ?? e.type[i]} tier ${e.eliteTier[i]} at (${ex.toFixed(1)}, ${ez.toFixed(1)}) r=${Math.hypot(ex, ez).toFixed(0)}/${w.arenaRadius.toFixed(0)} hero ${Math.hypot(ex - hero.x, ez - hero.z).toFixed(0)} m away, t=${w.time.toFixed(0)}`;
            if (isBoss) violate('boss-stuck-in-blocked', `boss ${desc}`, w);
            else {
              row.stuckInBlocked++;
              if (row.stuckInBlockedExample === '') row.stuckInBlockedExample = desc;
            }
          }
        }
      }
      blockedRun = nextRun;
      if (inBlocked > row.enemiesBlockedMax) row.enemiesBlockedMax = inBlocked;
      const drift = Math.abs(w.spawner.alive - actual);
      if (drift > row.aliveDriftMax) row.aliveDriftMax = drift;
      aliveDriftBad = drift > 5 ? aliveDriftBad + 1 : 0;
      if (aliveDriftBad === 3) violate('alive-drift', `spawner.alive = ${w.spawner.alive} but ${actual} live creature rows (3 scans in a row)`, w);
    }

    // ---- wall-clock guard ----
    if (nTicks % 600 === 0 && performance.now() - wallStart > spec.wallLimitMs) {
      violate('wall-timeout', `run exceeded ${spec.wallLimitMs} ms of wall time at sim ${w.time.toFixed(0)} s`, w);
      row.outcome = 'aborted';
      break;
    }
  }

  // modals queued on the tick that ended the run (a chest next to the run end): the UI shows them first, so they are answered
  if (row.outcome !== 'aborted') drain(w, policy, seen.modals, row, violate);
  hooks.onEnd?.(w);
  tickTimes.set(row, tickMs.subarray(0, nTicks));

  // ---- summary of the loop ----
  row.ticks = nTicks;
  row.simSeconds = r2(w.time);
  if (nTicks > 0) {
    let sum = 0;
    let max = 0;
    let maxAt = 0;
    for (let i = 0; i < nTicks; i++) {
      const v = tickMs[i] as number;
      sum += v;
      if (v > max) {
        max = v;
        maxAt = i;
      }
    }
    const sorted = tickMs.slice(0, nTicks).sort();
    row.tickMs = { mean: r2(sum / nTicks), p50: r2(pctl(sorted, nTicks, 0.5)), p99: r2(pctl(sorted, nTicks, 0.99)), max: r2(max), slowestTick: maxAt + 1, slowestSimTime: r2((maxAt + 1) * DT) };
  }
  if (bossHist.length > 0) {
    const now = bossHist[bossHist.length - 1] as { t: number; frac: number };
    const old = [...bossHist].reverse().find((b) => b.t <= now.t - 120) ?? (bossHist[0] as { t: number; frac: number });
    row.finalBossHp = { now: r2(now.frac), before: r2(old.frac) };
  }
  row.eventsPerSec = w.time > 0 ? Math.round(evCount / w.time) : 0;
  if (row.outcome === 'crash') row.outcome = w.over ? (w.result?.victory ? 'victory' : 'defeat') : 'timeout';
}

function countNear(w: World, x: number, z: number, r: number): number {
  const e = w.enemies;
  const r2v = r * r;
  let n = 0;
  for (let i = 0; i < e.count; i++) {
    if (((e.flags[i] as number) & EnemyFlag.Metin) !== 0) continue;
    if (e.state[i] === EnemyState.Dying) continue;
    const dx = (e.x[i] as number) - x;
    const dz = (e.z[i] as number) - z;
    if (dx * dx + dz * dz <= r2v) n++;
  }
  return n;
}

/** end-of-run evaluation: outcome, result sanity, caps, schedule coverage, perf */
function finish(content: ContentDB, spec: CaseSpec, w: World, row: RunRow, violate: Violate): void {
  const zone = w.zone;
  const hero = w.players[0];
  if (row.outcome === 'crash' || row.outcome === 'aborted') {
    /* keep */
  } else row.outcome = w.over ? (w.result?.victory ? 'victory' : 'defeat') : 'timeout';
  row.stateHash = hashWorld(w);
  const res = w.result;
  if (hero) {
    row.level = hero.level;
    row.kills = hero.kills;
    row.seen.skills = hero.skills.map((s) => s.def.id);
    row.seen.passives = hero.passives.map((p) => p.id);
  }
  row.chests = w.tally.chestsOpened;
  row.bossesKilled = [...w.tally.bossesKilled];

  // modals still pending that are not the run end
  const pending = w.modals.filter((m) => m.kind !== 'runEnd');
  if (pending.length > 0 && row.outcome !== 'aborted' && row.outcome !== 'crash') violate('modal-undrained', `${pending.length} modal request(s) pending at the end (first '${pending[0]?.kind}')`, w);

  // caps (the rows themselves can never exceed the arrays; alive can drift past the soft cap)
  if (row.max.enemyRows > CAP.enemies) violate('cap-enemies', `enemy rows ${row.max.enemyRows} > CAP ${CAP.enemies}`, w);
  if (row.max.projectiles > CAP.projectiles) violate('cap-projectiles', `${row.max.projectiles} > CAP ${CAP.projectiles}`, w);
  if (row.max.pickups > CAP.pickups) violate('cap-pickups', `${row.max.pickups} > CAP ${CAP.pickups}`, w);
  if (row.max.zones > CAP.zones) violate('cap-zones', `${row.max.zones} > CAP ${CAP.zones}`, w);
  if (row.max.telegraphs > CAP.telegraphs) violate('cap-telegraphs', `${row.max.telegraphs} > CAP ${CAP.telegraphs}`, w);
  // a FULL store drops what comes next (a telegraph: a boss hit without its warning; a pickup: xp / gold lost; a creature: a missing summon).
  // Every Run Option at max is a stress setting where saturation is expected: a note there, a violation in a normal run.
  for (const [name, n] of Object.entries(row.storeFullTicks ?? {})) {
    if (n <= 0) continue;
    const cap = (CAP as Record<string, number>)[name];
    const what = `the ${name} store was full (${cap} rows) on ${n} tick(s): what the sim tried to add then was dropped`;
    if (spec.runOptionsMax) row.notes.push(`Run Options max: ${what}`);
    else violate(`store-full-${name}`, what, w);
  }
  // alive: the soft cap is enforced by the spawner; scheduled escorts / forced spawns may use the rest of the rows (<= 640 by ESCORT_ALIVE_LIMIT)
  if (row.max.alive > ENEMY_SOFT_CAP + 60 && !spec.runOptionsMax) violate('cap-alive', `max alive ${row.max.alive} > ENEMY_SOFT_CAP ${ENEMY_SOFT_CAP} + 60`, w);
  if (row.max.alive > CAP.enemies) violate('cap-alive', `max alive ${row.max.alive} > CAP.enemies ${CAP.enemies}`, w);

  // perf and events
  if (row.tickMs.p99 > spec.p99LimitMs) violate('perf-p99', `tick p99 ${row.tickMs.p99} ms > ${spec.p99LimitMs} ms (mean ${row.tickMs.mean}, max ${row.tickMs.max})`, w);
  if (row.tickMs.max > spec.maxTickLimitMs) violate('perf-spike', `slowest tick ${row.tickMs.max} ms at sim ${row.tickMs.slowestSimTime} s (tick ${row.tickMs.slowestTick}) > ${spec.maxTickLimitMs} ms`, w);
  if (row.ticks > 0 && row.eventsSaturatedTicks / row.ticks > 0.005) violate('events-saturated', `${row.eventsSaturatedTicks} of ${row.ticks} ticks hit the event ceiling (low-priority events were dropped)`, w);
  if (row.eventsPerSec > 60000) violate('events-flood', `${row.eventsPerSec} events per sim second`, w);

  // spawns inside blocked ground
  for (const [name, b] of Object.entries(row.blockedBySource)) {
    violate(`spawn-blocked-${name}`, `${b.count} of ${row.spawns} spawns (${name}) were on non-walkable ground; first: ${b.example}`, w);
  }

  if (row.zombieRowsMax > 0) violate('zombie-enemy', `${row.zombieRowsMax} live row(s) with hp <= 0 that are not dying (killed, then put back into a live state): they are killed a second time later (double kill count, loot, xp, spawner.alive)`, w);
  if (row.stuckInBlocked > 0) violate('enemy-stuck-in-blocked', `${row.stuckInBlocked} creature(s) stood on non-walkable ground for 3 scans in a row (6 s); first: ${row.stuckInBlockedExample}`, w);

  // outcome
  if (row.outcome === 'timeout') {
    const fb = row.finalBossHp;
    violate('no-end', `the run did not end within ${spec.seconds} s of sim (t=${w.time.toFixed(1)}, bosses alive ${w.bosses.length}, hero hp ${hero?.hp.toFixed(0)}/${hero?.hpMax.toFixed(0)}, great metin ${w.metinSys.greatId ? 'landed' : 'not landed'}, final boss ${w.metinSys.finalBossSpawned ? 'spawned' : 'not spawned'}${fb ? `, final boss hp ${(fb.now * 100).toFixed(1)}% (${(fb.before * 100).toFixed(1)}% 120 s earlier)` : ''})`, w);
    if (fb && hero?.alive && fb.before - fb.now < 0.005) violate('boss-stalled', `final boss hp stayed at ${(fb.now * 100).toFixed(1)}% for 120 s with the hero alive (hp ${hero.hp.toFixed(0)}/${hero.hpMax.toFixed(0)})`, w);
  }
  if (row.outcome === 'defeat' && spec.expectVictory) {
    violate('god-defeat', `the ${spec.stats} hero lost at t=${res?.time.toFixed(0)} (level ${res?.level}, kills ${res?.kills}, bosses killed ${res?.bossesKilled.join(',') || 'none'}, metins broken ${res?.metinsBroken})`, w);
  }
  if (row.outcome === 'victory') {
    if (!w.tally.bossesKilled.includes(zone.final.boss)) violate('victory-without-final-boss', `victory but '${zone.final.boss}' is not in bossesKilled [${w.tally.bossesKilled.join(',')}]`, w);
    if (!row.seen.greatMetinBroken) violate('victory-without-great-metin', `victory but no great metin break event (expected ${zone.final.greatMetin})`, w);
    if (!w.metinSys.finalStarted) violate('victory-without-final', 'victory but the final never started', w);
  }

  // scheduled bosses / metins: spawned (and, on a victory, killed)
  const T = w.time;
  const expectSpawn = new Map<string, number>();
  for (const b of zone.bosses) if (T >= b.at + 8) expectSpawn.set(b.boss, (expectSpawn.get(b.boss) ?? 0) + 1);
  for (const [id, n] of expectSpawn) {
    const got = row.seen.bossSpawns[id] ?? 0;
    if (got < n) violate('boss-not-spawned', `scheduled boss '${id}' x${n} due before t=${T.toFixed(0)}, spawned ${got}`, w);
  }
  if (row.outcome === 'victory') {
    // the final boss's death collapses the field but leaves other bosses standing (EnemyFlag.Boss rows are skipped), so a scheduled
    // boss that is still alive at the victory is an observation, not a defect
    for (const [id, n] of expectSpawn) {
      const died = row.seen.bossDeaths[id] ?? 0;
      if (died < n) row.notes.push(`victory while scheduled boss '${id}' x${n} was alive (${died} died)`);
    }
  }
  if (T >= zone.final.at + 10) {
    const finalSpawned = row.seen.bossSpawns[zone.final.boss] ?? 0;
    if (finalSpawned < 1 && row.outcome !== 'defeat') violate('final-boss-not-spawned', `final boss '${zone.final.boss}' never spawned by t=${T.toFixed(0)}`, w);
    if (!row.seen.metinWarns[zone.final.greatMetin] && row.outcome !== 'defeat') violate('great-metin-not-fallen', `great metin '${zone.final.greatMetin}' never warned by t=${T.toFixed(0)}`, w);
  }
  const metinWarns = Object.values(row.seen.metinWarns).reduce((a, b) => a + b, 0);
  if (T >= zone.metins.firstAt + 20 && metinWarns < 1) violate('metin-not-spawned', `no metin fell by t=${T.toFixed(0)} (firstAt ${zone.metins.firstAt})`, w);
  if (row.outcome === 'victory') {
    const broken = Object.entries(row.seen.metinBreaks).filter(([id]) => id !== zone.final.greatMetin).reduce((a, [, b]) => a + b, 0);
    // the bot fights a living boss before it walks to a metin, so a boss-heavy zone can end without one: an observation, not a defect
    if (broken < 1) row.notes.push('bot: victory without breaking an ordinary metin (it was busy with bosses)');
  }
  for (const id of Object.keys(row.seen.metinWarns)) {
    if (id !== zone.final.greatMetin && !zone.metins.types.includes(id)) violate('metin-foreign', `metin '${id}' fell but is not one of the zone's types`, w);
  }

  // the ABANDON path (pause -> abandon: app/app.ts records world.buildResult(false) for a run that is not over) on every run that did
  // not end: the result the meta progression stores must be as sane as a finished one (read-only; the state hash is already taken)
  if (!w.over) {
    try {
      const ab = w.buildResult(false);
      const bad = badResultField(ab);
      if (bad) violate('abandon-result-invalid', `buildResult(false) at t=${w.time.toFixed(1)}: ${bad}`, w);
      if (ab.victory || ab.zone !== spec.zone || ab.classId !== spec.classId || ab.seed !== spec.seed) violate('abandon-result-invalid', `buildResult(false) is for ${ab.zone}/${ab.classId}/${ab.seed}, victory ${ab.victory}`, w);
    } catch (err) {
      violate('abandon-result-invalid', `buildResult(false) threw: ${describeError(err)}`, w);
    }
  }

  // result sanity
  if (w.over) {
    if (!res) violate('result-missing', 'the run is over but world.result is null', w);
    else {
      const bad = badResultField(res);
      if (bad) violate('result-invalid', bad, w);
      if (res.zone !== spec.zone || res.classId !== spec.classId || res.seed !== spec.seed) violate('result-mismatch', `result is for ${res.zone}/${res.classId}/${res.seed}`, w);
      if (!w.modals.some((m) => m.kind === 'runEnd')) violate('result-no-runend-modal', 'run over without a runEnd modal', w);
      if (spec.runOptionsMax) {
        const want = clampRunOptions({ density: 99, health: 99, damage: 99, speed: 99 }, runOptionsTable(content.balance));
        if (JSON.stringify(res.runOptions) !== JSON.stringify(want)) violate('result-options', `runOptions ${JSON.stringify(res.runOptions)} != clamped max ${JSON.stringify(want)}`, w);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// cross-run analysis

export interface MemSeries {
  worker: number;
  /** heap / rss after each run (MB), in run order */
  heapMB: number[];
  rssMB: number[];
}

export interface MemVerdict {
  worker: number;
  runs: number;
  heapStartMB: number;
  heapEndMB: number;
  heapSlopeMBPerRun: number;
  rssStartMB: number;
  rssEndMB: number;
  rssSlopeMBPerRun: number;
  leak: boolean;
  note: string;
}

/** least-squares slope of ys against 0..n-1 */
export function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * ((ys[i] as number) - my);
    den += (i - mx) * (i - mx);
  }
  return den === 0 ? 0 : num / den;
}

/**
 * A leak: after a forced GC the heap keeps growing run after run. The first 2 runs are warm-up (JIT, content caches). Flags
 * heap growth > 25 MB over the remaining runs with a slope > 1.5 MB/run (or rss growth > 200 MB with a slope > 8 MB/run).
 */
/** Theil-Sen slope (median of the pairwise slopes): one GC-timing outlier (a +7 MB sample) does not move it */
export function robustSlope(ys: number[]): number {
  const s: number[] = [];
  for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) s.push(((ys[j] as number) - (ys[i] as number)) / (j - i));
  if (s.length === 0) return 0;
  s.sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function median(ys: number[]): number {
  if (ys.length === 0) return 0;
  const s = ys.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** growth = median of the last third minus median of the first third */
function robustGrowth(ys: number[]): number {
  if (ys.length < 3) return ys.length > 1 ? (ys[ys.length - 1] as number) - (ys[0] as number) : 0;
  const k = Math.max(1, Math.floor(ys.length / 3));
  return median(ys.slice(ys.length - k)) - median(ys.slice(0, k));
}

export function analyzeMemory(series: MemSeries): MemVerdict {
  const warm = 3;
  const h = series.heapMB.slice(warm);
  const r = series.rssMB.slice(warm);
  const heapSlope = robustSlope(h);
  const rssSlope = robustSlope(r);
  const heapGrow = robustGrowth(h);
  const rssGrow = robustGrowth(r);
  // the worker heap after a forced GC is ~10-17 MB; the first thresholds (heap +25 MB and > 1.5 MB per run) let a 1 MB-per-run leak
  // (a retained world or field every run) through for 25 runs. Real series (36 workers, 12-59 runs each, review 2026-10-27): robust slope
  // <= 0.33 MB/run (short series still warming up), growth <= 4.5 MB; a 1 MB/run leak shows ~13 MB growth over 20 runs.
  const leakHeap = h.length >= 6 && heapGrow > 8 && heapSlope > 0.45;
  const leakRss = r.length >= 6 && rssGrow > 120 && rssSlope > 4;
  return {
    worker: series.worker,
    runs: series.heapMB.length,
    heapStartMB: r2(h[0] ?? series.heapMB[0] ?? 0),
    heapEndMB: r2(h[h.length - 1] ?? series.heapMB[series.heapMB.length - 1] ?? 0),
    heapSlopeMBPerRun: r2(heapSlope),
    rssStartMB: r2(r[0] ?? series.rssMB[0] ?? 0),
    rssEndMB: r2(r[r.length - 1] ?? series.rssMB[series.rssMB.length - 1] ?? 0),
    rssSlopeMBPerRun: r2(rssSlope),
    leak: leakHeap || leakRss,
    note: leakHeap ? `heap grew ${r2(heapGrow)} MB (slope ${r2(heapSlope)} MB/run)` : leakRss ? `rss grew ${r2(rssGrow)} MB (slope ${r2(rssSlope)} MB/run)` : '',
  };
}

export interface DeterminismVerdict {
  id: string;
  twin: string;
  equal: boolean;
  hashA: string;
  hashB: string;
  firstDivergenceS: number | null;
}

/** compare every case that has a twin with its twin (same spec re-run) */
export function compareDeterminism(rows: RunRow[]): DeterminismVerdict[] {
  const byId = new Map<string, RunRow>();
  for (const r of rows) byId.set(r.id, r);
  const out: DeterminismVerdict[] = [];
  for (const r of rows) {
    if (!r.twinOf) continue;
    const a = byId.get(r.twinOf);
    if (!a) continue;
    const equal = a.stateHash === r.stateHash && a.stateHash !== '';
    let first: number | null = null;
    if (!equal && a.checkpoints && r.checkpoints) {
      const n = Math.min(a.checkpoints.length, r.checkpoints.length);
      for (let i = 0; i < n; i++) {
        if (a.checkpoints[i] !== r.checkpoints[i]) {
          first = (i + 1) * 10;
          break;
        }
      }
    }
    out.push({ id: a.id, twin: r.id, equal, hashA: a.stateHash, hashB: r.stateHash, firstDivergenceS: first });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// selftest

/**
 * default per-run tick p99 limit (ms). The first harness used 33 ms; the worst real p99 over 1100 runs on a 96-99 % busy machine was
 * 6.7 ms (every Run Option at max), so 33 ms let a 5x regression through. A p99 violation is re-run like a spike (noise is dropped).
 */
export const P99_DEFAULT_MS = 12;

export const FAULTS: { fault: FaultName; expect: string[]; seconds: number; note: string; p99LimitMs?: number }[] = [
  { fault: 'throw', expect: ['throw'], seconds: 20, note: 'error thrown inside World.step' },
  { fault: 'nan', expect: ['non-finite'], seconds: 20, note: 'NaN hero position' },
  { fault: 'overcap', expect: ['cap-alive', 'store-full-enemies'], seconds: 20, note: `${ENEMY_SOFT_CAP + 180} enemies force-spawned (cap ${ENEMY_SOFT_CAP}; the store holds ${CAP.enemies}, the rest is dropped)` },
  { fault: 'stuck', expect: ['hero-stuck'], seconds: 50, note: 'hero pinned in place for 45 s of sim' },
  { fault: 'modal', expect: ['modal-undrained'], seconds: 20, note: 'a level-up request with no cards' },
  { fault: 'outside', expect: ['hero-outside-walkable'], seconds: 20, note: 'hero teleported into non-walkable ground' },
  { fault: 'blockedSpawn', expect: ['spawn-blocked-band'], seconds: 20, note: 'an enemy spawned in non-walkable ground' },
  { fault: 'noEnd', expect: ['no-end'], seconds: 20, note: 'a run that cannot end inside its time limit' },
  { fault: 'slowTick', expect: ['perf-spike'], seconds: 20, note: 'a 320 ms tick that repeats on the re-run (a real hot spot)' },
  { fault: 'noiseTick', expect: ['!perf-spike', 'note:machine noise'], seconds: 20, note: 'a 320 ms tick that does NOT repeat on the re-run (machine noise: no violation, a note)' },
  { fault: 'zombie', expect: ['zombie-enemy'], seconds: 20, note: 'an enemy killed and put back into a live state' },
  { fault: 'stuckEnemy', expect: ['enemy-stuck-in-blocked'], seconds: 20, note: 'an enemy standing in non-walkable ground for 6 s' },
  { fault: 'nondeterm', expect: ['__determinism__'], seconds: 20, note: 'Math.random folded into the combat rng (checked by the twin comparison)' },
  // review faults (2026-10-27): each one passed the first harness version silently
  { fault: 'throwRare', expect: ['throw'], seconds: 80, note: 'a throw on one rare tick (4321) only' },
  { fault: 'nanOnce', expect: ['non-finite'], seconds: 20, note: 'an enemy x is NaN for exactly one tick (121; the store scan runs every 30 ticks)' },
  { fault: 'nanEvent', expect: ['non-finite-event'], seconds: 20, note: 'a vfx event with a NaN position (events were never checked)' },
  { fault: 'nanHud', expect: ['hud-invalid'], seconds: 20, note: 'NaN xpNext: only the HUD shows it (findNonFinite does not read it)' },
  { fault: 'thinWallSpawn', expect: ['spawn-blocked-band'], seconds: 20, note: 'an enemy spawned 0.1 m inside a blocker edge (walkable for the 0.3 m DEEP test)' },
  { fault: 'pocket', expect: ['hero-confined'], seconds: 100, note: 'the hero can move but never leaves a 1.5 m pocket (the 0.5 m stuck anchor keeps resetting)' },
  { fault: 'modalFlood', expect: ['modal-flood'], seconds: 45, note: 'a level-up request re-opens every 15 ticks (4 per second)' },
  { fault: 'hotNoise', expect: ['perf-spike'], seconds: 20, note: 'a repeatable 300 ms hot spot (tick 200) next to a bigger one-off 700 ms stall (tick 700, first run only)' },
  { fault: 'p99Creep', expect: ['perf-p99'], seconds: 20, p99LimitMs: P99_DEFAULT_MS, note: `2.5 % of the ticks cost 16 ms (p99 16 ms; the first default limit was 33 ms, now ${P99_DEFAULT_MS})` },
  { fault: 'bossStall', expect: ['boss-stalled', 'no-end'], seconds: 160, note: 'the final boss is spawned at t=2 s and cannot lose hp (the stall detector had no fault)' },
];

export interface SelftestLine {
  fault: string;
  note: string;
  expected: string[];
  got: string[];
  detected: boolean;
}

/** run every fault on a short real run; each must be flagged by its detector */
export function runSelftest(content: ContentDB, base: CaseSpec): SelftestLine[] {
  const lines: SelftestLine[] = [];
  for (const f of FAULTS) {
    const spec: CaseSpec = { ...base, id: `selftest/${f.fault}`, group: 'selftest', seconds: f.seconds, fault: f.fault, expectVictory: false, checkpoints: true, p99LimitMs: f.p99LimitMs ?? 1000, maxTickLimitMs: 250 };
    if (f.fault === 'nondeterm') {
      const a = runCase(content, spec);
      const b = runCase(content, { ...spec, id: `selftest/${f.fault}#2`, twinOf: spec.id });
      const det = compareDeterminism([a, b]);
      const got = det.some((d) => !d.equal) ? ['__determinism__'] : [];
      lines.push({ fault: f.fault, note: f.note, expected: f.expect, got, detected: got.length > 0 });
      continue;
    }
    const row = runCase(content, spec);
    const got = [...new Set(row.violations.map((v) => v.kind))];
    for (const n of row.notes) if (n.startsWith('machine noise')) got.push('note:machine noise');
    // '!kind' = the kind must be absent
    const detected = f.expect.every((k) => (k.startsWith('!') ? !got.includes(k.slice(1)) : got.includes(k)));
    lines.push({ fault: f.fault, note: f.note, expected: f.expect, got, detected });
  }
  // the leak detector works on a series of runs: a synthetic series that grows 4 MB per run must be flagged, a flat one must not
  const growing = analyzeMemory({ worker: 0, heapMB: Array.from({ length: 12 }, (_, i) => 120 + i * 4), rssMB: Array.from({ length: 12 }, (_, i) => 400 + i * 4) });
  const flat = analyzeMemory({ worker: 0, heapMB: Array.from({ length: 12 }, (_, i) => 120 + (i % 3) * 0.5), rssMB: Array.from({ length: 12 }, (_, i) => 400 + (i % 2)) });
  lines.push({ fault: 'leak', note: 'synthetic: heap +4 MB per run over 12 runs (and a flat series must stay quiet)', expected: ['leak'], got: growing.leak && !flat.leak ? ['leak'] : [], detected: growing.leak && !flat.leak });
  return lines;
}
