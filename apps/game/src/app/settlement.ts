// Shared idempotent run settlement (SIM-02): commits a finished, abandoned, or crash-recovered run to MetaService
// at most once per run identity and caches the outcome so App lifecycle hooks and UI results views share one truth.
import type { EmpireId, Sex } from '../data/schema';
import type { MetaService, SettleOutcome } from '../meta/service';
import type { RunResult } from '../sim/run';
import { clearRunMarker } from './runMarker';

export type Settlement = SettleOutcome;

const cache = new Map<string, Settlement>();

export function runKey(r: RunResult): string {
  return `${r.seed}:${r.zone}:${r.classId}:${r.doctrine}:${r.difficulty}:${Math.round(r.time * 10)}:${r.kills}`;
}

/** True when the run reached a natural end (victory or full party defeat) rather than abandon/crash. */
export function isFinishedRun(r: Pick<RunResult, 'victory' | 'time' | 'players'>): boolean {
  if (r.victory) return true;
  if (r.players.length > 0) return !r.players.some((p) => p.alive);
  return r.time >= 60;
}

export interface SettleRunOptions {
  empire: EmpireId;
  sex: Sex;
  /** override leaderboard submission (default: true only for finished runs, never for abandon/crash) */
  submit?: boolean;
  /** trigger immediate durable persistence flush after commit (default: false) */
  flush?: boolean;
}

/**
 * Settles `result` into `meta` at most once per run key and clears the interrupted-run marker only after commit
 * succeeds. Returns the cached `Settlement` on repeat calls, or `null` (preserving the run marker) on failure.
 */
export function settleRunOnce(meta: MetaService | null, result: RunResult, opts: SettleRunOptions): Settlement | null {
  const key = runKey(result);
  const hit = cache.get(key);
  if (hit) return hit;
  if (!meta) return null;
  try {
    const submit = opts.submit ?? isFinishedRun(result);
    const outcome = meta.settle(result, { empire: opts.empire, sex: opts.sex, submit });
    if (opts.flush) void meta.flush().catch((err) => console.error('[app] settle flush failed', err));
    clearRunMarker();
    if (cache.size > 8) cache.clear();
    cache.set(key, outcome);
    return outcome;
  } catch (err) {
    console.error('[app] settle failed', err);
    return null;
  }
}

export function getCachedSettlement(result: RunResult): Settlement | null {
  return cache.get(runKey(result)) ?? null;
}

export function clearSettlements(): void {
  cache.clear();
}
