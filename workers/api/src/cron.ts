import { dayIndex } from '@ms/shared';
import { weekIndex } from './boards';
import { sweepRateCounters } from './limits';
import { sweepOrphanSaves } from './saves';
import type { ApiEnv } from './env';

/**
 * Runs that no leaderboard row points at (flagged, rejected, superseded personal bests) are kept this long for
 * operators — abuse review, idempotent resubmits (the client queue gives up after 13 days) — then deleted (data
 * minimisation). Best runs stay as long as their board row.
 */
export const RUN_RETENTION_MS = 90 * 86_400_000;
/** Upper bound of rows one housekeeping pass deletes (keeps the cron invocation short; the rest goes next day). */
const RUN_SWEEP_BATCH = 5000;

/**
 * Daily Challenge boards ('d<day>') are kept this many days after their day: a run is accepted for today and yesterday only,
 * so today, yesterday and the day before are all a board can ever be asked for.
 */
export const DAILY_BOARD_KEEP_DAYS = 2;

/** Daily housekeeping (wrangler.toml `[triggers] crons`). */
export async function housekeeping(
  env: ApiEnv,
  now = Date.now(),
): Promise<{ counters: number; codes: number; boards: number; dailyBoards: number; runs: number; orphanSaves: number }> {
  const counters = await sweepRateCounters(env.DB, now);
  const codes = (await env.DB.prepare('DELETE FROM transfer_codes WHERE expires_at < ?1').bind(now).run()).meta.changes ?? 0;
  // Keep the current and the previous week; older weekly rows are dead weight.
  const keepFrom = weekIndex(now) - 1;
  const boards = (
    await env.DB
      .prepare(`DELETE FROM bests WHERE substr(period, 1, 1) = 'w' AND CAST(substr(period, 2) AS INTEGER) < ?1`)
      .bind(keepFrom)
      .run()
  ).meta.changes ?? 0;
  // Day boards ('d<UTC day number>', DLY-01): keep today and the two days before it.
  const dailyBoards = (
    await env.DB
      .prepare(`DELETE FROM bests WHERE substr(period, 1, 1) = 'd' AND CAST(substr(period, 2) AS INTEGER) < ?1`)
      .bind(dayIndex(now) - DAILY_BOARD_KEEP_DAYS)
      .run()
  ).meta.changes ?? 0;
  const runs = (
    await env.DB
      .prepare(
        `DELETE FROM runs WHERE id IN (
           SELECT id FROM runs
            WHERE status IN ('ok', 'flagged', 'rejected') AND created_at < ?1 AND id NOT IN (SELECT run_id FROM bests)
            LIMIT ?2)`,
      )
      .bind(now - RUN_RETENTION_MS, RUN_SWEEP_BATCH)
      .run()
  ).meta.changes ?? 0;
  // cloud-save blobs whose player is gone (safety net of the erasure: see saves.ts); a failed R2 listing must not fail the rest
  const orphanSaves = await sweepOrphanSaves(env, now).catch((e: unknown) => {
    console.error('orphan save sweep', e instanceof Error ? e.message : String(e));
    return 0;
  });
  return { counters, codes, boards, dailyBoards, runs, orphanSaves };
}
