import { Hono } from 'hono';
import { DAILY_PERIOD, dailySpec, dayIndex, parseLeaderboardQuery, type LeaderboardEntry, type LeaderboardResponse } from '@ms/shared';
import { optionalPlayer } from '../auth';
import { ALL_CLASSES, periodKey, standingStatement, toEntry, weekIndex, weekStartMs, type BestRow, type StandingRow } from '../boards';
import { ApiException, type AppEnv } from '../http';

export const leaderboard = new Hono<AppEnv>();

/** Shared-cache policy of the anonymous (caller-independent) board: fresh for 30 s, served stale for 60 s more while it refreshes. */
export const LEADERBOARD_PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=60';

interface CachedBoard {
  rows: BestRow[];
  total: number;
}

function edgeCache(): Cache | null {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
    return c ?? null;
  } catch {
    return null;
  }
}

// GET /leaderboard?zone&difficulty&class&period=all|week|day&limit   (day = today's Daily Challenge board, UTC; its rows carry class '*' only,
// so the day board has no class split: class=all and class=<today's spec class> are the same board, any other class is empty)
leaderboard.get('/', async (c) => {
  const parsed = parseLeaderboardQuery({ get: (name) => c.req.query(name) ?? null });
  if (!parsed.ok) throw new ApiException(400, 'validation', `Invalid ${parsed.field}`, { field: parsed.field, reason: parsed.reason });
  const q = parsed.value;
  const caller = await optionalPlayer(c);
  const now = Date.now();
  const period = periodKey(q.period, now);
  // Day board (DLY-01): every row is stored under the all-classes key, and the day is played in one class (dailySpec). The
  // client sends its class tab with every period chip, so the spec class must answer like 'all'; any other class has no run.
  const onDayBoard = q.period === DAILY_PERIOD;
  const classKey = onDayBoard || q.class === 'all' ? ALL_CLASSES : q.class;
  const noRuns = onDayBoard && q.class !== 'all' && q.class !== dailySpec(dayIndex(now)).classId;
  const db = c.env.DB;

  // Shared-board Cloudflare Edge Cache (keeps D1 reads minimal under traffic spikes; enabled via LEADERBOARD_EDGE_CACHE_SEC in wrangler.toml).
  const cacheSec = Math.max(0, Math.floor(Number(c.env.LEADERBOARD_EDGE_CACHE_SEC ?? 0)));
  const cache = !noRuns && cacheSec > 0 ? edgeCache() : null;
  const cacheReq = cache
    ? new Request(`https://lb-cache.internal/${encodeURIComponent(q.mode)}/${encodeURIComponent(period)}/${encodeURIComponent(q.zone)}/${encodeURIComponent(q.difficulty)}/${encodeURIComponent(classKey)}/${q.limit}`)
    : null;

  let cachedBoard: CachedBoard | null = null;
  if (cache && cacheReq) {
    try {
      const hit = await cache.match(cacheReq);
      if (hit) cachedBoard = (await hit.json()) as CachedBoard;
    } catch {
      cachedBoard = null;
    }
  }

  let boardRows: BestRow[] = [];
  let total = 0;
  let mine: StandingRow | undefined;

  if (noRuns) {
    // a class that cannot be on the day board has nothing to ask D1 for
  } else if (cachedBoard) {
    boardRows = cachedBoard.rows;
    total = cachedBoard.total;
    if (caller) {
      const res = await standingStatement(db, q.mode, period, q.zone, q.difficulty, classKey, caller.id).first<StandingRow>();
      mine = res ?? undefined;
    }
  } else {
    const statements = [
      db
        .prepare(
          `SELECT b.player_id, p.name, b.score, b.run_class, b.party, b.victory, b.level, b.kills, b.duration_ms, b.achieved_at
             FROM bests b JOIN players p ON p.id = b.player_id
            WHERE b.mode = ?1 AND b.period = ?2 AND b.zone = ?3 AND b.difficulty = ?4 AND b.class_id = ?5
            ORDER BY b.score DESC, b.achieved_at ASC, b.player_id ASC LIMIT ?6`,
        )
        .bind(q.mode, period, q.zone, q.difficulty, classKey, q.limit),
      db
        .prepare('SELECT COUNT(*) AS total FROM bests WHERE mode = ?1 AND period = ?2 AND zone = ?3 AND difficulty = ?4 AND class_id = ?5')
        .bind(q.mode, period, q.zone, q.difficulty, classKey),
    ];
    if (caller) statements.push(standingStatement(db, q.mode, period, q.zone, q.difficulty, classKey, caller.id));
    const results = await db.batch<BestRow | { total: number } | StandingRow>(statements);
    const [rows, count, standing] = results;
    boardRows = (rows?.results ?? []) as BestRow[];
    total = (count?.results[0] as { total: number } | undefined)?.total ?? 0;
    mine = standing?.results[0] as StandingRow | undefined;

    if (cache && cacheReq) {
      const payload: CachedBoard = { rows: boardRows, total };
      const put = cache.put(
        cacheReq,
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheSec}` },
        }),
      ).catch(() => undefined);
      try {
        c.executionCtx.waitUntil(put);
      } catch {
        void put;
      }
    }
  }

  const entries = boardRows.map((row, i) => toEntry(row, i + 1, caller?.id ?? null));
  let you: LeaderboardEntry | null = null;
  if (mine) you = toEntry(mine, mine.rank, caller?.id ?? null);

  const body: LeaderboardResponse = {
    mode: q.mode,
    zone: q.zone,
    difficulty: q.difficulty,
    class: q.class,
    period: q.period,
    weekStart: q.period === 'week' ? weekStartMs(weekIndex(now)) : null,
    ...(q.period === DAILY_PERIOD ? { day: dayIndex(now) } : {}),
    limit: q.limit,
    total,
    entries,
    you,
  };
  // Caching. The body depends on the caller in two places: `you` (their own row + rank) and `entries[].you`. A request
  // that carries credentials therefore stays `private, no-store` (their own rank must be fresh right after a run, and
  // never reach a shared cache). A fully anonymous request gets the same body for everybody, so browsers and
  // intermediaries may reuse it briefly; `Vary: Authorization` keeps that copy from answering a later request that does
  // carry credentials (the player registers while the anonymous copy is still fresh). Errors (400 …) keep the default
  // `no-store` of the edge middleware.
  const personal = caller !== null || c.req.raw.headers.has('authorization') || c.req.raw.headers.has('sec-websocket-protocol');
  if (personal) c.header('Cache-Control', 'private, no-store');
  else {
    c.header('Cache-Control', LEADERBOARD_PUBLIC_CACHE);
    c.header('Vary', 'Authorization');
  }
  return c.json(body);
});
