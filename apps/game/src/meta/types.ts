// Meta layer shared types: SaveData (ARCHITECTURE §9) and the small result/RNG contracts used by every module.
// Everything under src/meta is framework-free (no DOM, no Preact) except storage.ts / sync.ts which touch browser APIs
// through injectable adapters, so the whole layer is unit-testable in node.

import type { ClassId, ContentDB, Difficulty, DoctrineId, GearSlot } from '../data/schema';
import type { SettingsData } from '../engine/settings';

/** Bump when the persisted shape changes and add a step to `MIGRATIONS` (migrations.ts). */
export const SAVE_VERSION = 1;

export const CLASS_IDS: readonly ClassId[] = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'];

/** The slice of ContentDB the meta layer reads. `ContentDB` is assignable to it. */
export type MetaContent = Pick<ContentDB, 'classes' | 'zones' | 'gear' | 'talents' | 'empires' | 'story' | 'balance'>;

/** Deterministic-RNG injection point: `next()` returns a float in [0, 1). sim/rng.ts `Rng` satisfies it. */
export interface MetaRng {
  next(): number;
}

export interface ProfileInfo {
  /** local profile id (uuid-like); NOT the cloud playerId */
  id: string;
  name: string;
  /** ms since epoch */
  created: number;
  /** ms since epoch of the last mutation (drives "newest wins" displays) */
  updated: number;
}

/** Per-class persistent state. */
export interface ClassSave {
  /** talent XP; talent points are derived from it (talents.ts) */
  xp: number;
  /** doctrine id -> node id -> points */
  talents: Partial<Record<DoctrineId, Record<string, number>>>;
  /** equipped gear id per slot */
  gear: Partial<Record<GearSlot, string>>;
  /** every gear piece ever obtained for this class (ids, acquisition order) */
  collection: string[];
  /** blacksmith level (+N, 1..9) per owned gear id; absent = +0 */
  plus: Record<string, number>;
  /** consecutive gear-drop opportunities without a NEW piece (see drops.ts) */
  pity: number;
}

export interface Unlocks {
  /** unlocked zone ids */
  zones: string[];
  /** zone ids whose hard mode is unlocked */
  hard: string[];
  /** unlocked codex entry ids (StoryDef.codex[].id) */
  codex: string[];
}

export interface ZoneStats {
  runs: number;
  clears: number;
  bestScore: number;
  /** fastest victory, seconds (0 = none yet) */
  bestTime: number;
  bestLevel: number;
}

export interface ClassStats {
  runs: number;
  wins: number;
  bestScore: number;
}

export interface BlacksmithStats {
  attempts: number;
  successes: number;
  yeopSpent: number;
  shardsSpent: number;
}

export interface SaveStats {
  runs: number;
  wins: number;
  deaths: number;
  kills: number;
  elites: number;
  bosses: number;
  metins: number;
  /** total seconds played in runs */
  playTime: number;
  yeopEarned: number;
  shardsEarned: number;
  bestScore: number;
  bestLevel: number;
  /** zone id -> difficulty -> stats */
  zones: Record<string, Partial<Record<Difficulty, ZoneStats>>>;
  classes: Record<ClassId, ClassStats>;
  /** boss id -> times killed (bestiary) */
  bossKills: Record<string, number>;
  /** metin def id -> stones broken (codex / bestiary) */
  metinKinds: Record<string, number>;
  gearFound: number;
  blacksmith: BlacksmithStats;
}

export interface Bank {
  yeop: number;
  shards: number;
}

export interface SaveData {
  version: number;
  profile: ProfileInfo;
  classes: Record<ClassId, ClassSave>;
  bank: Bank;
  unlocks: Unlocks;
  stats: SaveStats;
  /** Engine's SettingsData (device preferences). Cloud adoption keeps the local device's settings. */
  settings: SettingsData;
}

// ---------------------------------------------------------------------------
// Results

/** Every mutating meta operation returns `{ ok: true, save, ... }` (a NEW SaveData) or `{ ok: false, reason }`. */
export interface Fail<R extends string> {
  ok: false;
  reason: R;
}

export function fail<R extends string>(reason: R): Fail<R> {
  return { ok: false, reason };
}
