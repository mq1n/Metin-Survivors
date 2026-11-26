import { Hono } from 'hono';
import { computeScore, dailyMismatch, parseRunSubmission, type RunResponse, type RunStatus, type RunSubmission } from '@ms/shared';
import { requirePlayer } from '../auth';
import { ALL_CLASSES, dayPeriodKey, modeOf, periodKey, standingStatement, type StandingRow } from '../boards';
import { ApiException, readJson, type AppEnv } from '../http';
import { clientSubject, enforce, RULES } from '../limits';
import { assessRun, PLAUSIBILITY, versionAllowed } from '../plausibility';

export const runs = new Hono<AppEnv>();

interface RunRow {
  id: number;
  zone: RunSubmission['zone'];
  difficulty: RunSubmission['difficulty'];
  class_id: RunSubmission['classId'];
  coop: number;
  score: number;
  status: RunStatus | 'rejected';
  flags: string;
}

function splitFlags(flags: string): string[] {
  return flags === '' ? [] : flags.split(',');
}

function rejectedError(reasons: string[]): ApiException {
  return new ApiException(422, 'implausible_run', 'Run rejected as implausible', { reasons });
}

/**
 * Ranks of a run's player after the run has been stored (null entries when unranked). `daily` = the day number the
 * submission carried: such a run ranks on that day's board only, so only `dayRank` / `best` / `bestScore` are filled.
 */
async function buildResponse(
  db: D1Database,
  playerId: string,
  run: RunRow,
  opts: { duplicate: boolean; improved: boolean; daily?: number | undefined },
  now: number,
): Promise<RunResponse> {
  const flags = splitFlags(run.flags);
  const response: RunResponse = {
    id: run.id,
    score: run.score,
    status: run.status === 'flagged' ? 'flagged' : 'ok',
    mode: modeOf(run.coop),
    flags,
    duplicate: opts.duplicate,
    best: false,
    bestScore: null,
    rank: null,
    weekRank: null,
    classRank: null,
  };
  // a daily answers with `dayRank` whatever its status: null when it is not on the board (flagged)
  if (opts.daily !== undefined) response.dayRank = null;
  if (run.status !== 'ok') return response;
  const mode = modeOf(run.coop);
  if (opts.daily !== undefined) {
    const [day] = await db.batch<StandingRow>([
      standingStatement(db, mode, dayPeriodKey(opts.daily), run.zone, run.difficulty, ALL_CLASSES, playerId),
    ]);
    const d = day?.results[0];
    response.dayRank = d?.rank ?? null;
    response.bestScore = d?.score ?? null;
    response.best = opts.improved;
    return response;
  }
  const [all, week, cls] = await db.batch<StandingRow>([
    standingStatement(db, mode, 'all', run.zone, run.difficulty, ALL_CLASSES, playerId),
    standingStatement(db, mode, periodKey('week', now), run.zone, run.difficulty, ALL_CLASSES, playerId),
    standingStatement(db, mode, 'all', run.zone, run.difficulty, run.class_id, playerId),
  ]);
  const a = all?.results[0];
  response.rank = a?.rank ?? null;
  response.bestScore = a?.score ?? null;
  response.best = opts.improved;
  response.weekRank = week?.results[0]?.rank ?? null;
  response.classRank = cls?.results[0]?.rank ?? null;
  return response;
}

// POST /runs
runs.post('/', async (c) => {
  const player = await requirePlayer(c);
  const now = Date.now();
  await enforce(c.env, RULES.runPlayer, `p:${player.id}`, now);
  await enforce(c.env, RULES.runIp, await clientSubject(c), now);

  const parsed = parseRunSubmission(await readJson(c, 4096));
  if (!parsed.ok) throw new ApiException(400, 'validation', `Invalid ${parsed.field}`, { field: parsed.field, reason: parsed.reason });
  const run = parsed.value;

  if (!versionAllowed(c.env.ALLOWED_CLIENT_VERSIONS, run.clientVersion)) {
    throw new ApiException(426, 'client_outdated', 'This client version is no longer supported, please reload the game');
  }

  const db = c.env.DB;
  // Idempotency: a resubmitted runId returns the stored outcome.
  const existing = await db
    .prepare('SELECT id, zone, difficulty, class_id, coop, score, status, flags FROM runs WHERE player_id = ?1 AND client_run_id = ?2')
    .bind(player.id, run.runId)
    .first<RunRow>();
  if (existing) {
    if (existing.status === 'rejected') throw rejectedError(splitFlags(existing.flags));
    return c.json(await buildResponse(db, player.id, existing, { duplicate: true, improved: false, daily: run.daily }, now));
  }

  // Daily Challenge (DLY-01): checked after the idempotency lookup, so a retry of a stored daily still gets its answer once the
  // window has closed. Nothing is stored for a mismatch: it is a contract error of the client, not a plausibility verdict.
  const mismatch = dailyMismatch(run, now);
  if (mismatch) {
    throw new ApiException(400, 'daily_mismatch', 'The run does not follow the daily challenge', { field: mismatch.field, reason: mismatch.reason });
  }

  const assessment = assessRun(run, now);
  const startedAt = Math.round(run.endedAt - run.duration * 1000);
  if (assessment.reject.length === 0) {
    const tol = PLAUSIBILITY.overlapToleranceMs;
    const overlap = await db
      .prepare(
        `SELECT 1 AS hit FROM runs WHERE player_id = ?1 AND status != 'rejected' AND ended_at > ?2 AND started_at < ?3 LIMIT 1`,
      )
      .bind(player.id, startedAt + tol, run.endedAt - tol)
      .first();
    if (overlap) assessment.flag.push('overlap');
  }

  const score = computeScore(run.stats, { victory: run.victory, duration: run.duration, difficulty: run.difficulty });
  // `score_mismatch` is recorded for operators only: the server score is authoritative, status is unaffected.
  const info = run.score !== undefined && run.score !== score ? ['score_mismatch'] : [];
  const rejected = assessment.reject.length > 0;
  const status: RunStatus | 'rejected' = rejected ? 'rejected' : assessment.flag.length > 0 ? 'flagged' : 'ok';
  const flags = (rejected ? assessment.reject : [...assessment.flag, ...info]).join(',');

  const insert = db
    .prepare(
      `INSERT INTO runs (player_id, client_run_id, zone, difficulty, class_id, doctrine, empire, sex, seed, victory,
         duration_ms, started_at, ended_at, created_at, kills, elites, bosses, metins, level, yeop, score, claimed_score,
         status, flags, client_version, coop)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)
       ON CONFLICT (player_id, client_run_id) DO NOTHING`,
    )
    .bind(
      player.id, run.runId, run.zone, run.difficulty, run.classId, run.doctrine ?? null, run.empire ?? null, run.sex ?? null,
      run.seed, run.victory ? 1 : 0, Math.round(run.duration * 1000), startedAt, run.endedAt, now, run.stats.kills,
      run.stats.elites, run.stats.bosses, run.stats.metins, run.stats.level, run.stats.yeop, score, run.score ?? null,
      status, flags, run.clientVersion, run.coop ?? 1,
    );

  const stmts: D1PreparedStatement[] = [insert];
  if (status === 'ok') {
    const mode = modeOf(run.coop);
    // A daily ranks on its day board only (period d<day>, all-classes key); every other run on all-time + this week, with
    // and without its class filter. The first statement after the insert is the "personal best" probe either way.
    const slots: [string, string][] =
      run.daily !== undefined
        ? [[dayPeriodKey(run.daily), ALL_CLASSES]]
        : ['all', periodKey('week', now)].flatMap((period): [string, string][] => [[period, ALL_CLASSES], [period, run.classId]]);
    for (const [period, classKey] of slots) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO bests (mode, period, zone, difficulty, class_id, player_id, score, run_id, run_class, party, victory,
               level, kills, duration_ms, achieved_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, r.id, ?9, ?10, ?11, ?12, ?13, ?14, ?15
             FROM runs r
             WHERE r.player_id = ?6 AND r.client_run_id = ?8 AND r.status = 'ok' AND r.score = ?7
             ON CONFLICT (mode, period, zone, difficulty, class_id, player_id) DO UPDATE SET
               score = excluded.score, run_id = excluded.run_id, run_class = excluded.run_class, party = excluded.party,
               victory = excluded.victory, level = excluded.level, kills = excluded.kills, duration_ms = excluded.duration_ms,
               achieved_at = excluded.achieved_at
             WHERE excluded.score > bests.score`,
          )
          .bind(
            mode, period, run.zone, run.difficulty, classKey, player.id, score, run.runId, run.classId, run.coop ?? 1,
            run.victory ? 1 : 0, run.stats.level, run.stats.kills, Math.round(run.duration * 1000), now,
          ),
      );
    }
  }
  stmts.push(db.prepare('UPDATE players SET last_seen_at = ?1 WHERE id = ?2').bind(now, player.id));
  const results = await db.batch(stmts);

  const inserted = (results[0]?.meta.changes ?? 0) > 0;
  const stored = await db
    .prepare('SELECT id, zone, difficulty, class_id, coop, score, status, flags FROM runs WHERE player_id = ?1 AND client_run_id = ?2')
    .bind(player.id, run.runId)
    .first<RunRow>();
  if (!stored) throw new ApiException(500, 'internal', 'Run was not stored');
  if (stored.status === 'rejected') throw rejectedError(splitFlags(stored.flags));
  // results[1] is the (all, '*') upsert (a daily: the (d<day>, '*') one): it only changes a row when the score is a new personal best.
  const improved = inserted && status === 'ok' && (results[1]?.meta.changes ?? 0) > 0;
  const body = await buildResponse(db, player.id, stored, { duplicate: !inserted, improved, daily: run.daily }, now);
  return c.json(body, inserted ? 201 : 200);
});
