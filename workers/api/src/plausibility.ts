import {
  RUN_DURATION_SLACK_SEC,
  RUN_LENGTH_SEC,
  type Difficulty,
  type RunStats,
  type RunSubmission,
  type ZoneId,
} from '@ms/shared';
/**
 * Server-side run plausibility. Runs are client-simulated, so we keep the public leaderboard free of impossible
 * numbers while never rejecting an honest run:
 *   • HARD limits are beyond what the game can produce even for the most extreme legal setup → HTTP 422 (status rejected).
 *   • SOFT limits sit ~20–25 % above measured maxima → run accepted but flagged (stored, never ranked).
 *
 * Calibrated across all four zones, all five classes, solo & 4-player co-op, normal & hard, with Run Options up to ×3:
 *   kills/min: normal ≤ 1,624 · hard ≤ 2,295 · hero level ≤ 18 + 12/min · yeop/kill ≤ 15..93 · metins ≤ ⌊t/60⌋+1.
 */
/** Hard ceiling on yeop income per kill (drops × reward multipliers × yeop gain); soft = hard × softFactor. */
export const ZONE_LIMITS: Record<ZoneId, { yeopPerKill: number }> = {
  yeonmu: { yeopPerKill: 60 },
  suryeon: { yeopPerKill: 120 },
  seori: { yeopPerKill: 220 },
  daeryeol: { yeopPerKill: 400 },
};

export const DIFFICULTY_LIMITS: Record<Difficulty, { killsPerMin: number; elitesPerMin: number; reward: number }> = {
  // hard ceiling on kills/elites per minute averaged over the run (soft = × softFactor: normal 2,030 kills / 126 elites · hard 2,800 kills / 182 elites)
  normal: { killsPerMin: 2_900, elitesPerMin: 180, reward: 1 },
  // PLAN §3.6: hard = count ×1.25, rewards ×1.5 (Run Options stack on top, see the calibration note)
  hard: { killsPerMin: 4_000, elitesPerMin: 260, reward: 1.5 },
};

export const PLAUSIBILITY = {
  /** soft limit = hard limit × this factor (kills / elites / yeop) */
  softFactor: 0.7,
  killsBase: 40,
  elitesBase: 20,
  yeopBase: 1500,
  yeopPerMetin: 6000,
  yeopPerBoss: 30_000,
  /** one boss slot every 3 minutes (+ the final) */
  bossEverySec: 180,
  bossSlack: 2,
  /** Metin drops start at 1:00 and recur every ≥ 45 s; allow double that rate plus the Great Metin */
  metinFirstSec: 30,
  metinEverySec: 30,
  metinSlack: 2,
  /** hero level ≤ levelBase + levelPerMin × minutes (hard); soft uses the second pair (talent start levels included) */
  levelBase: 40,
  levelPerMin: 18,
  softLevelBase: 25,
  softLevelPerMin: 13,
  /** a victory needs the timeline to reach the final boss (15:00) */
  victoryMinDurationSec: 840,
  /** runs longer than this are stored but not ranked (stalling the enraged final boss); validation caps at 2 h */
  longRunSec: RUN_LENGTH_SEC + RUN_DURATION_SLACK_SEC,
  /** client clock allowed ahead of the server clock */
  futureSkewMs: 5 * 60_000,
  /** queued (offline) runs older than this are refused */
  maxAgeMs: 14 * 86_400_000,
  /** two runs of the same player may overlap by at most this long (clock skew / auto-save slop) */
  overlapToleranceMs: 15_000,
} as const;

/** The numeric envelope a run is checked against (exported for tests and the calibration script). */
export interface Envelope {
  killsHard: number;
  killsSoft: number;
  elitesHard: number;
  elitesSoft: number;
  levelHard: number;
  levelSoft: number;
  yeopHard: number;
  yeopSoft: number;
  metinsHard: number;
  metinsSoft: number;
  bossesHard: number;
}

export function envelope(run: Pick<RunSubmission, 'zone' | 'difficulty' | 'duration'>, stats: RunStats): Envelope {
  const P = PLAUSIBILITY;
  const zone = ZONE_LIMITS[run.zone];
  const diff = DIFFICULTY_LIMITS[run.difficulty];
  const duration = Math.max(0, run.duration);
  const minutes = duration / 60;
  const killsHard = Math.ceil(diff.killsPerMin * minutes) + P.killsBase;
  const elitesHard = Math.ceil(diff.elitesPerMin * minutes) + P.elitesBase;
  const yeopHard = (stats.kills * zone.yeopPerKill + stats.metins * P.yeopPerMetin + stats.bosses * P.yeopPerBoss + P.yeopBase) * diff.reward;
  return {
    killsHard,
    killsSoft: Math.ceil(killsHard * P.softFactor),
    elitesHard,
    elitesSoft: Math.ceil(elitesHard * P.softFactor),
    levelHard: P.levelBase + P.levelPerMin * minutes,
    levelSoft: P.softLevelBase + P.softLevelPerMin * minutes,
    yeopHard,
    yeopSoft: yeopHard * P.softFactor,
    metinsHard: Math.floor(Math.max(0, duration - P.metinFirstSec) / P.metinEverySec) + P.metinSlack,
    metinsSoft: Math.floor(duration / 60) + P.metinSlack,
    bossesHard: Math.floor(duration / P.bossEverySec) + P.bossSlack,
  };
}

export interface Assessment {
  /** hard violations → reject */
  reject: string[];
  /** soft outliers → flag (stored, unranked) */
  flag: string[];
}

/** Pure assessment of everything checkable without the database (overlap is checked by the caller). */
export function assessRun(run: RunSubmission, now: number): Assessment {
  const P = PLAUSIBILITY;
  const reject: string[] = [];
  const flag: string[] = [];
  const { stats, duration } = run;
  const env = envelope(run, stats);
  const coop = run.coop !== undefined && run.coop >= 2;

  if (duration > P.longRunSec) flag.push('duration_long');
  if (run.endedAt > now + P.futureSkewMs) reject.push('future_timestamp');
  if (run.endedAt < now - P.maxAgeMs) reject.push('stale_run');

  if (run.victory) {
    if (duration < P.victoryMinDurationSec) reject.push('victory_too_short');
    if (stats.bosses < 1) reject.push('victory_without_boss');
  }
  // Co-op runs report their OWN kills next to the party-shared elites/bosses, so only solo runs can be checked here.
  if (!coop && stats.elites + stats.bosses > stats.kills) reject.push('elites_exceed_kills');

  if (stats.kills > env.killsHard) reject.push('kills_rate');
  else if (stats.kills > env.killsSoft) flag.push('kills_rate_high');

  if (stats.elites > env.elitesHard) reject.push('elites_rate');
  else if (stats.elites > env.elitesSoft) flag.push('elites_rate_high');

  if (stats.bosses > env.bossesHard) reject.push('bosses_count');

  if (stats.metins > env.metinsHard) reject.push('metins_count');
  else if (stats.metins > env.metinsSoft) flag.push('metins_high');

  if (stats.level > env.levelHard) reject.push('level_rate');
  else if (stats.level > env.levelSoft) flag.push('level_rate_high');

  if (stats.yeop > env.yeopHard) reject.push('yeop_rate');
  else if (stats.yeop > env.yeopSoft) flag.push('yeop_rate_high');

  return { reject, flag };
}

/** Client-version allow-list: comma separated exact versions or `prefix*` wildcards (e.g. `1.*`, `1.2.*`). */
export function versionAllowed(allowList: string | undefined, version: string): boolean {
  const list = (allowList ?? '1.*').split(',').map((s) => s.trim()).filter(Boolean);
  for (const entry of list) {
    if (entry === '*' || entry === version) return true;
    if (entry.endsWith('*') && version.startsWith(entry.slice(0, -1))) return true;
  }
  return false;
}
