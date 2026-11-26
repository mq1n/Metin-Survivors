import { DAILY_PERIOD, DAY_MS, dayIndex } from '@ms/shared';
import type { BoardPeriod, ClassId, Difficulty, LeaderboardEntry, LeaderboardMode, ZoneId } from '@ms/shared';

/** Week windows are UTC, Monday-based: week 0 is the one containing 1970-01-01 (a Thursday). */
export function weekIndex(ms: number): number {
  return Math.floor((Math.floor(ms / DAY_MS) + 3) / 7);
}
export function weekStartMs(index: number): number {
  return (index * 7 - 3) * DAY_MS;
}

/** `bests.period` of the Daily Challenge board of a UTC day number (DLY-01): 'd<day>', class key '*'. */
export function dayPeriodKey(day: number): string {
  return `d${day}`;
}

/** `bests.period` value for a leaderboard period at time `ms`: 'all', 'w<week>' or (period 'day') 'd<today>'. */
export function periodKey(period: BoardPeriod, ms: number): string {
  if (period === 'all') return 'all';
  return period === DAILY_PERIOD ? dayPeriodKey(dayIndex(ms)) : `w${weekIndex(ms)}`;
}

export const ALL_CLASSES = '*';

/** Board of a run: any party of 2+ ranks on the co-op boards. */
export function modeOf(party: number | undefined): LeaderboardMode {
  return party !== undefined && party >= 2 ? 'coop' : 'solo';
}

export interface BestRow {
  player_id: string;
  name: string;
  score: number;
  run_class: ClassId;
  party: number;
  victory: number;
  level: number;
  kills: number;
  duration_ms: number;
  achieved_at: number;
}

export function toEntry(row: BestRow, rank: number, callerId: string | null): LeaderboardEntry {
  return {
    rank,
    name: row.name,
    score: row.score,
    classId: row.run_class,
    party: row.party,
    victory: row.victory === 1,
    level: row.level,
    kills: row.kills,
    duration: row.duration_ms / 1000,
    achievedAt: row.achieved_at,
    you: callerId !== null && row.player_id === callerId,
  };
}

export type StandingRow = BestRow & { rank: number };

/**
 * One player's row in a category plus its rank (1 + players strictly ahead: score desc, earlier achievement,
 * player id). Yields no row when the player is unranked there.
 */
export function standingStatement(
  db: D1Database,
  mode: LeaderboardMode,
  period: string,
  zone: ZoneId,
  difficulty: Difficulty,
  classKey: string,
  playerId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT me.player_id, p.name, me.score, me.run_class, me.party, me.victory, me.level, me.kills, me.duration_ms, me.achieved_at,
              (SELECT COUNT(*) FROM bests b
                WHERE b.mode = me.mode AND b.period = me.period AND b.zone = me.zone AND b.difficulty = me.difficulty AND b.class_id = me.class_id
                  AND (b.score > me.score OR (b.score = me.score AND (b.achieved_at < me.achieved_at
                       OR (b.achieved_at = me.achieved_at AND b.player_id < me.player_id))))) + 1 AS rank
         FROM bests me JOIN players p ON p.id = me.player_id
        WHERE me.mode = ?1 AND me.period = ?2 AND me.zone = ?3 AND me.difficulty = ?4 AND me.class_id = ?5 AND me.player_id = ?6`,
    )
    .bind(mode, period, zone, difficulty, classKey, playerId);
}
