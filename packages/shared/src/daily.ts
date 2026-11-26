// @ms/shared/daily — the Daily Challenge spec (DLY-01). Pure and environment-neutral: the game client builds the day's run
// from it and the Worker recomputes it to validate a submission, so both sides MUST get the same answer for the same day.
//
// A day is the UTC day number (`dayIndex`). `dailySpec(day)` is a fixed integer hash of that number: no Math.random, no
// clock, no content tables. Keep it stable: changing a draw index, the salt or the mixer re-rolls every day (the pinned
// specs in workers/api/test/shared.test.ts catch that).

import {
  CLASS_IDS,
  DOCTRINE_KEYS,
  EMPIRE_IDS,
  RUN_OPTION_KEYS,
  ZONE_IDS,
  type ClassId,
  type DoctrineKey,
  type EmpireId,
  type RunOptionKey,
  type RunOptionsDto,
  type RunSubmission,
  type ZoneId,
} from './api';

export const DAY_MS = 86_400_000;

/** UTC day number of a timestamp (ms since the epoch). */
export function dayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS);
}
/** First millisecond (UTC) of a day number. */
export function dayStartMs(day: number): number {
  return day * DAY_MS;
}

/** Each slider of a daily is one of these multipliers (all on the game's 0.25 slider grid). */
export const DAILY_RUN_OPTION_STEPS = [1, 1.25, 1.5] as const;
/** Largest reward multiplier of the daily's sliders. */
export const DAILY_REWARD_MAX = 1.5;
/** balance.json `runOptions.<key>.rewardWeight`; workers/api/test/shared.test.ts fails when they drift apart. */
export const DAILY_REWARD_WEIGHTS: Readonly<Record<RunOptionKey, number>> = { density: 0.25, health: 0.2, damage: 0.3, speed: 0.2 };

/** Reward multiplier of a set of sliders: 1 + sum(weight * (value - 1)), as the game's runOptionsReward without its cap. */
export function dailyReward(o: RunOptionsDto): number {
  let sum = 1;
  for (const k of RUN_OPTION_KEYS) sum += DAILY_REWARD_WEIGHTS[k] * (o[k] - 1);
  return sum;
}

export interface DailySpec {
  /** UTC day number the spec belongs to. */
  day: number;
  zone: ZoneId;
  classId: ClassId;
  doctrine: DoctrineKey;
  empire: EmpireId;
  difficulty: 'normal';
  runOptions: RunOptionsDto;
  /** Run seed, 0..2^32-1. */
  seed: number;
}

const SALT = 0x4d53_4459; // "MSDY"

/** lowbias32: a fixed 32-bit integer mixer. */
function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The k-th independent 32-bit draw of a day. */
function draw(day: number, k: number): number {
  return mix32((mix32((day ^ SALT) | 0) + Math.imul(k + 1, 0x9e3779b1)) | 0);
}

function pick<T>(list: readonly T[], day: number, k: number): T {
  return list[draw(day, k) % list.length] as T;
}

/**
 * The members of `valid` (canonical order) that appear in `list`; an empty result means "all of them". The order of `list`
 * never matters: the pick below indexes this result, so two callers that name the same ids in a different order must still
 * get the same day.
 */
function only<T extends string>(valid: readonly T[], list: readonly string[]): readonly T[] {
  const kept = valid.filter((v) => list.includes(v));
  return kept.length > 0 ? kept : valid;
}

/**
 * The challenge of a UTC day. A spec that a run will be SUBMITTED with must come from the defaults: `dailySpec(day)`, no
 * lists. The Worker validates every submission against `dailySpec(day)` built from the canonical `ZONE_IDS` / `CLASS_IDS`,
 * so a client that narrows the lists (to what a profile has unlocked, say) gets a different zone or class on most days and
 * its run is refused with `daily_mismatch`. Locked content is a settlement concern of the client (the Daily's own limits),
 * never a reason to pass a smaller list here.
 *
 * `zones` / `classes` exist for tooling and tests that need a restricted draw: the result is the same whatever order the ids
 * are listed in (only the members of the canonical lists count, in canonical order), unknown ids are dropped, and an empty
 * result falls back to the canonical list. Everything else (doctrine, empire, Run Options, seed) never depends on the lists.
 */
export function dailySpec(day: number, zones: readonly ZoneId[] = ZONE_IDS, classes: readonly ClassId[] = CLASS_IDS): DailySpec {
  const runOptions = {} as RunOptionsDto;
  RUN_OPTION_KEYS.forEach((key, i) => {
    runOptions[key] = pick(DAILY_RUN_OPTION_STEPS, day, 4 + i);
  });
  // The total reward stays <= DAILY_REWARD_MAX by construction: all combinations of the steps above peak at 1.475 with the
  // game's weights, so this only trims if a weight is ever raised (heaviest contributor first, deterministic).
  while (dailyReward(runOptions) > DAILY_REWARD_MAX + 1e-9) {
    let worst: RunOptionKey = 'density';
    let worstShare = -1;
    for (const k of RUN_OPTION_KEYS) {
      const share = DAILY_REWARD_WEIGHTS[k] * (runOptions[k] - 1);
      if (share > worstShare) [worst, worstShare] = [k, share];
    }
    runOptions[worst] = runOptions[worst] === 1.5 ? 1.25 : 1;
  }
  return {
    day,
    zone: pick(only(ZONE_IDS, zones), day, 0),
    classId: pick(only(CLASS_IDS, classes), day, 1),
    doctrine: pick(DOCTRINE_KEYS, day, 2),
    empire: pick(EMPIRE_IDS, day, 3),
    difficulty: 'normal',
    runOptions,
    seed: draw(day, 8),
  };
}

/** Why a submission does not match its daily: the offending field and a short reason code. */
export interface DailyMismatch {
  field: string;
  reason: 'solo_only' | 'out_of_window' | 'missing' | 'differs';
}

export type DailyCheckInput = Pick<RunSubmission, 'daily' | 'coop' | 'zone' | 'classId' | 'doctrine' | 'empire' | 'difficulty' | 'seed' | 'runOptions'>;

/**
 * Checks a submission against its daily at wall-clock `now` (ms): solo, the day is today or yesterday (UTC), and zone,
 * class, doctrine, empire, difficulty, seed and every Run Option equal `dailySpec(daily)`. Null for a run without `daily`.
 * Pure: the Worker maps a result to HTTP 400 `daily_mismatch`; a client can pre-check before it submits.
 */
export function dailyMismatch(run: DailyCheckInput, now: number): DailyMismatch | null {
  if (run.daily === undefined) return null;
  if (run.coop !== undefined) return { field: 'coop', reason: 'solo_only' };
  const today = dayIndex(now);
  if (run.daily !== today && run.daily !== today - 1) return { field: 'daily', reason: 'out_of_window' };
  const spec = dailySpec(run.daily);
  if (run.zone !== spec.zone) return { field: 'zone', reason: 'differs' };
  if (run.classId !== spec.classId) return { field: 'classId', reason: 'differs' };
  if (run.doctrine === undefined) return { field: 'doctrine', reason: 'missing' };
  if (run.doctrine !== spec.doctrine) return { field: 'doctrine', reason: 'differs' };
  if (run.empire === undefined) return { field: 'empire', reason: 'missing' };
  if (run.empire !== spec.empire) return { field: 'empire', reason: 'differs' };
  if (run.difficulty !== spec.difficulty) return { field: 'difficulty', reason: 'differs' };
  if (run.seed !== spec.seed) return { field: 'seed', reason: 'differs' };
  if (run.runOptions === undefined) return { field: 'runOptions', reason: 'missing' };
  for (const k of RUN_OPTION_KEYS) if (run.runOptions[k] !== spec.runOptions[k]) return { field: `runOptions.${k}`, reason: 'differs' };
  return null;
}
