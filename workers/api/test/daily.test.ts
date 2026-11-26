// DLY-01: Daily Challenge on the server — POST /runs `daily` validation against dailySpec(), the day board in `bests`
// (period 'd<day>', class '*'), GET /leaderboard?period=day. Pure spec/guard tests live in shared.test.ts; the cron prune is in
// api.test.ts. Time is faked (Date only) so the UTC midnight edges are exact.
import { env } from 'cloudflare:workers';
import {
  CLASS_IDS,
  DAY_MS,
  EMPIRE_IDS,
  ZONE_IDS,
  dailySpec,
  dayIndex,
  type ApiErrorBody,
  type LeaderboardResponse,
  type RunOptionsDto,
  type RunResponse,
  type RunSubmission,
} from '@ms/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, json, register, runBody, submit, type TestPlayer } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

const withKills = (kills: number) => ({ kills, elites: 0, bosses: 0, metins: 0, level: 10, yeop: 0 });

/** Freezes Date at `ms` (timers stay real: the Workers pool needs them) and returns `ms`. */
function clock(ms: number): number {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ms);
  return ms;
}

/** First day (from a fixed origin) whose spec satisfies `pred`: the specs are deterministic, so is the test. */
function findDay(pred: (s: ReturnType<typeof dailySpec>) => boolean, from = 20_000): number {
  for (let d = from; d < from + 4000; d++) if (pred(dailySpec(d))) return d;
  throw new Error('no day matches');
}

/** A submission that follows the spec of `day` to the letter; `over` perturbs it. */
function dailyBody(day: number, over: Partial<RunSubmission> = {}): RunSubmission {
  const s = dailySpec(day);
  return runBody({
    zone: s.zone,
    classId: s.classId,
    doctrine: s.doctrine,
    empire: s.empire,
    difficulty: s.difficulty,
    seed: s.seed,
    runOptions: { ...s.runOptions },
    daily: day,
    ...over,
  });
}

async function errorOf(res: Response): Promise<ApiErrorBody['error']> {
  const body = (await res.json()) as ApiErrorBody;
  expect(body.error).toBeDefined();
  return body.error;
}

const board = async (query: string, token?: string): Promise<LeaderboardResponse> => {
  const res = await call(`/leaderboard?${query}`, token ? { token } : {});
  expect(res.status).toBe(200);
  return json<LeaderboardResponse>(res);
};

const countRows = async (table: 'runs' | 'bests', p: TestPlayer): Promise<number> =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE player_id = ?1`).bind(p.playerId).first<{ n: number }>())?.n ?? -1;

describe('POST /runs with a daily', () => {
  it('accepts a run that follows today\'s spec and ranks it on the day board only', async () => {
    const now = clock(Date.UTC(2026, 9, 30, 12));
    const day = dayIndex(now);
    const spec = dailySpec(day);
    const p = await register();
    const res = await submit(p, dailyBody(day, { stats: withKills(300) }));
    expect(res.status).toBe(201);
    const body = await json<RunResponse>(res);
    expect(body).toMatchObject({ status: 'ok', mode: 'solo', duplicate: false, best: true, dayRank: 1, rank: null, weekRank: null, classRank: null });
    expect(body.bestScore).toBe(body.score);

    // exactly one board row: period d<day>, all-classes key, solo
    const rows = await env.DB.prepare('SELECT mode, period, class_id, zone, difficulty, run_class FROM bests WHERE player_id = ?1').bind(p.playerId).all();
    expect(rows.results).toEqual([{ mode: 'solo', period: `d${day}`, class_id: '*', zone: spec.zone, difficulty: 'normal', run_class: spec.classId }]);

    // GET /leaderboard?period=day serves today's board for the spec zone
    const lb = await board(`zone=${spec.zone}&period=day`, p.token);
    expect(lb).toMatchObject({ period: 'day', day, weekStart: null, total: 1 });
    expect(lb.entries).toHaveLength(1);
    expect(lb.entries[0]).toMatchObject({ rank: 1, score: body.score, classId: spec.classId, you: true });
    expect(lb.you).toMatchObject({ rank: 1, you: true });

    // the all-time and weekly boards do not see it
    for (const period of ['all', 'week']) {
      const other = await board(`zone=${spec.zone}&period=${period}`, p.token);
      expect(other.you, period).toBeNull();
      expect(other.entries.some((e) => e.you), period).toBe(false);
    }
    // ... and the day board of any other zone is empty
    const elsewhere = ZONE_IDS.find((z) => z !== spec.zone);
    expect(await board(`zone=${elsewhere}&period=day`, p.token)).toMatchObject({ total: 0, entries: [], you: null });
    // the daily row is stored under the class key '*', yet the Leaderboard sends its class tab with every period: the class of
    // today's spec is the whole day board (entries, total, you), any other class has no run on it
    const bySpecClass = await board(`zone=${spec.zone}&period=day&class=${spec.classId}`, p.token);
    expect(bySpecClass).toMatchObject({ class: spec.classId, total: 1, you: { rank: 1, you: true } });
    expect({ ...bySpecClass, class: lb.class }).toEqual(lb);
    expect(await board(`zone=${spec.zone}&period=day&class=${spec.classId}`)).toMatchObject({ total: 1, entries: [{ rank: 1, you: false }], you: null });
    for (const other of CLASS_IDS.filter((c) => c !== spec.classId)) {
      expect(await board(`zone=${spec.zone}&period=day&class=${other}`, p.token), other).toMatchObject({ class: other, total: 0, entries: [], you: null });
    }
  });

  it('ranks players by score on the day board, keeps each player\'s best, reports the transitions', async () => {
    const now = clock(Date.UTC(2026, 9, 31, 12));
    const day = dayIndex(now);
    const spec = dailySpec(day);
    const [a, b, c] = [await register(), await register(), await register()];
    const ra = await json<RunResponse>(await submit(a, dailyBody(day, { stats: withKills(100) })));
    const rb = await json<RunResponse>(await submit(b, dailyBody(day, { stats: withKills(500) })));
    const rc = await json<RunResponse>(await submit(c, dailyBody(day, { stats: withKills(300) })));
    expect([ra.dayRank, rb.dayRank, rc.dayRank]).toEqual([1, 1, 2]);

    const lb = await board(`zone=${spec.zone}&period=day`, a.token);
    expect(lb.entries.map((e) => [e.rank, e.score])).toEqual([
      [1, rb.score],
      [2, rc.score],
      [3, ra.score],
    ]);
    expect(lb).toMatchObject({ total: 3 });
    expect(lb.you).toMatchObject({ rank: 3, score: ra.score, you: true });

    // a worse second run keeps the best; a better one replaces it and moves the player up
    const worse = await json<RunResponse>(await submit(a, dailyBody(day, { stats: withKills(50), endedAt: now - 1_000_000 })));
    expect(worse).toMatchObject({ best: false, dayRank: 3, bestScore: ra.score });
    const better = await json<RunResponse>(await submit(a, dailyBody(day, { stats: withKills(900), endedAt: now - 2_000_000 })));
    expect(better).toMatchObject({ best: true, dayRank: 1, bestScore: better.score });
    expect(await countRows('bests', a)).toBe(1);
  });

  it('refuses every field that departs from the spec (400 daily_mismatch) and stores nothing', async () => {
    // a day whose Run Options are all above 1, so each one can be made "easier"
    const day = findDay((s) => Object.values(s.runOptions).every((v) => v > 1));
    clock(day * DAY_MS + 12 * 3_600_000);
    const s = dailySpec(day);
    const other = <T>(list: readonly T[], v: T): T => list.find((x) => x !== v) as T;
    const opts = (over: Partial<RunOptionsDto>): RunOptionsDto => ({ ...s.runOptions, ...over });

    const variants: [string, Partial<RunSubmission>][] = [
      ['zone', { zone: other(ZONE_IDS, s.zone) }],
      ['classId', { classId: other(CLASS_IDS, s.classId) }],
      ['doctrine', { doctrine: s.doctrine === 'a' ? 'b' : 'a' }],
      ['empire', { empire: other(EMPIRE_IDS, s.empire) }],
      ['difficulty', { difficulty: 'hard' }],
      ['seed', { seed: (s.seed + 1) % 2 ** 32 }],
      ['coop', { coop: 2 }],
      ['runOptions', { runOptions: undefined }],
      // easier than the spec, one slider at a time and all at once
      ['runOptions.density', { runOptions: opts({ density: 1 }) }],
      ['runOptions.health', { runOptions: opts({ health: 1 }) }],
      ['runOptions.damage', { runOptions: opts({ damage: 1 }) }],
      ['runOptions.speed', { runOptions: opts({ speed: 1 }) }],
      ['runOptions.density', { runOptions: { density: 1, health: 1, damage: 1, speed: 1 } }],
      // harder or off-grid is not the spec either
      ['runOptions.health', { runOptions: opts({ health: 3 }) }],
      ['runOptions.damage', { runOptions: opts({ damage: s.runOptions.damage + 0.01 }) }],
    ];
    for (const [field, over] of variants) {
      const p = await register();
      const body = dailyBody(day, over);
      const res = await submit(p, body);
      expect(res.status, `${field} ${JSON.stringify(over)}`).toBe(400);
      const err = await errorOf(res);
      expect(err.code, field).toBe('daily_mismatch');
      expect(err.details, field).toMatchObject({ field });
      expect(await countRows('runs', p), field).toBe(0);
      expect(await countRows('bests', p), field).toBe(0);
    }
    // the matching run is fine
    const ok = await register();
    expect((await submit(ok, dailyBody(day))).status).toBe(201);
  });

  it('accepts today and yesterday (UTC), refuses older and future days, at the midnight edge', async () => {
    const day = 20_500;
    const submitDaily = async (d: number, over: Partial<RunSubmission> = {}) => submit(await register(), dailyBody(d, over));

    // 00:00:01 UTC on `day`: yesterday is still open, the day before is not
    clock(day * DAY_MS + 1000);
    expect((await submitDaily(day)).status).toBe(201);
    const yesterday = await submitDaily(day - 1);
    expect(yesterday.status).toBe(201);
    const y = await json<RunResponse>(yesterday);
    expect(y).toMatchObject({ status: 'ok', dayRank: 1 });
    for (const d of [day - 2, day - 3, day - 30, day + 1]) {
      const res = await submitDaily(d);
      expect(res.status, String(d)).toBe(400);
      expect(await errorOf(res), String(d)).toMatchObject({ code: 'daily_mismatch', details: { field: 'daily', reason: 'out_of_window' } });
    }
    // yesterday's run sits on yesterday's board: today's period=day board (the same zone) does not list it
    const ySpec = dailySpec(day - 1);
    const rows = await env.DB.prepare('SELECT period FROM bests WHERE run_id = ?1').bind(y.id).all<{ period: string }>();
    expect(rows.results.map((r) => r.period)).toEqual([`d${day - 1}`]);
    if (ySpec.zone !== dailySpec(day).zone) expect((await board(`zone=${ySpec.zone}&period=day`)).entries).toEqual([]);

    // 23:59:59 UTC on `day`: still the same day
    clock((day + 1) * DAY_MS - 1000);
    expect((await submitDaily(day)).status).toBe(201);
    expect((await submitDaily(day - 1)).status).toBe(201);
    expect((await submitDaily(day - 2)).status).toBe(400);
    // one second later it is `day + 1`: `day - 1` closed, `day` is yesterday
    clock((day + 1) * DAY_MS + 1000);
    expect((await submitDaily(day + 1)).status).toBe(201);
    expect((await submitDaily(day)).status).toBe(201);
    expect((await submitDaily(day - 1)).status).toBe(400);
  });

  it('is idempotent on runId even after the window has closed', async () => {
    const day = 20_600;
    const now = clock(day * DAY_MS + 3_600_000);
    const p = await register();
    const run = dailyBody(day, { stats: withKills(250), endedAt: now - 1000 });
    const first = await json<RunResponse>(await submit(p, run));
    expect(first).toMatchObject({ dayRank: 1, duplicate: false });
    // two days later the daily is gone, but the stored result is what a retry gets
    clock(now + 2 * DAY_MS);
    const again = await submit(p, run);
    expect(again.status).toBe(200);
    expect(await json<RunResponse>(again)).toMatchObject({ id: first.id, score: first.score, duplicate: true, best: false, dayRank: 1 });
    expect(await countRows('runs', p)).toBe(1);
    // a NEW run for the closed day is refused
    expect((await submit(p, dailyBody(day, { endedAt: now - 2_000_000 }))).status).toBe(400);
  });

  it('keeps flagged and rejected dailies off the day board', async () => {
    const day = 20_700;
    clock(day * DAY_MS + 3_600_000);
    const spec = dailySpec(day);
    // soft outlier: stored, flagged, never ranked
    const f = await register();
    const flagged = await json<RunResponse>(await submit(f, dailyBody(day, { stats: { kills: 25_000, elites: 10, bosses: 2, metins: 6, level: 40, yeop: 20_000 } })));
    expect(flagged).toMatchObject({ status: 'flagged', rank: null });
    expect(flagged.flags).toContain('kills_rate_high');
    // a daily always answers with dayRank (RunResponse.dayRank): null when it is not on the board
    expect('dayRank' in flagged).toBe(true);
    expect(flagged.dayRank).toBeNull();
    expect(flagged).toMatchObject({ best: false, bestScore: null, weekRank: null, classRank: null });
    expect(await countRows('bests', f)).toBe(0);
    // hard violation: 422, stored for audit
    const r = await register();
    const rejected = await submit(r, dailyBody(day, { stats: { kills: 900_000, elites: 0, bosses: 0, metins: 0, level: 3000, yeop: 1_900_000_000 } }));
    expect(rejected.status).toBe(422);
    expect(await countRows('bests', r)).toBe(0);
    expect((await board(`zone=${spec.zone}&period=day`)).total).toBe(0);
  });

  it('answers a retry of a flagged daily with dayRank null too, and a flagged ordinary run without the key', async () => {
    const day = 20_710;
    const now = clock(day * DAY_MS + 3_600_000);
    const stats = { kills: 25_000, elites: 10, bosses: 2, metins: 6, level: 40, yeop: 20_000 };
    const p = await register();
    const run = dailyBody(day, { stats, endedAt: now - 1000 });
    expect((await json<RunResponse>(await submit(p, run))).status).toBe('flagged');
    const again = await submit(p, run);
    expect(again.status).toBe(200);
    const replay = await json<RunResponse>(again);
    expect(replay).toMatchObject({ status: 'flagged', duplicate: true });
    expect('dayRank' in replay).toBe(true);
    expect(replay.dayRank).toBeNull();
    // the same flagged run without `daily` is an ordinary submission: no dayRank key at all
    const q = await register();
    const plain = await json<RunResponse>(await submit(q, dailyBody(day, { daily: undefined, stats, endedAt: now - 1000 })));
    expect(plain.status).toBe('flagged');
    expect('dayRank' in plain).toBe(false);
  });

  it('leaves normal runs exactly as they were: all-time + weekly rows, no day row, extra fields ignored', async () => {
    const now = clock(Date.UTC(2026, 9, 30, 12));
    const day = dayIndex(now);
    const p = await register();
    // same loadout as the daily, but no `daily` field: an ordinary run (runOptions are accepted and not stored)
    const res = await submit(p, dailyBody(day, { daily: undefined, stats: withKills(200) }));
    expect(res.status).toBe(201);
    const body = await json<RunResponse>(res);
    expect(body).toMatchObject({ status: 'ok', best: true, rank: 1, weekRank: 1, classRank: 1 });
    expect('dayRank' in body).toBe(false);
    const rows = await env.DB.prepare('SELECT period, class_id FROM bests WHERE player_id = ?1 ORDER BY period, class_id').bind(p.playerId).all<{ period: string; class_id: string }>();
    expect(rows.results.some((r) => r.period.startsWith('d'))).toBe(false);
    expect(rows.results).toHaveLength(4);
    expect((await board(`zone=${dailySpec(day).zone}&period=day`, p.token)).you).toBeNull();
  });

  it('validates the shape of daily and runOptions before the spec is consulted', async () => {
    clock(Date.UTC(2026, 9, 30, 12));
    const p = await register();
    const bad: [string, unknown, string][] = [
      ['daily', -1, 'daily'],
      ['daily', 1.5, 'daily'],
      ['daily', '20000', 'daily'],
      ['daily', null, 'daily'],
      ['daily', 2_000_000, 'daily'],
      ['runOptions', 'x', 'runOptions'],
      ['runOptions', null, 'runOptions'],
      ['runOptions', [1, 1, 1, 1], 'runOptions'],
      ['runOptions', { density: 1 }, 'runOptions.health'],
      ['runOptions', { density: 1, health: 1, damage: 1, speed: 0.5 }, 'runOptions.speed'],
      ['runOptions', { density: 1, health: 3.5, damage: 1, speed: 1 }, 'runOptions.health'],
      ['runOptions', { density: Number.NaN, health: 1, damage: 1, speed: 1 }, 'runOptions.density'],
      ['runOptions', { density: '1', health: 1, damage: 1, speed: 1 }, 'runOptions.density'],
    ];
    for (const [key, value, field] of bad) {
      const res = await submit(p, { ...runBody(), [key]: value } as RunSubmission);
      expect(res.status, `${key}=${JSON.stringify(value)}`).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('validation');
      expect(err.details).toMatchObject({ field });
    }
    expect(await countRows('runs', p)).toBe(0);
  });
});

describe('GET /leaderboard?period=day', () => {
  it('serves today\'s board, switches at UTC midnight, and keeps the other periods unchanged', async () => {
    const day = 20_800;
    const now = clock(day * DAY_MS + 23 * 3_600_000);
    const spec = dailySpec(day);
    const p = await register();
    const run = await json<RunResponse>(await submit(p, dailyBody(day, { stats: withKills(400), endedAt: now - 1000 })));
    expect(run.dayRank).toBe(1);
    expect((await board(`zone=${spec.zone}&period=day`, p.token)).you?.rank).toBe(1);
    // after midnight the same call is the NEW day's (empty) board; the run now lives on yesterday's board only
    clock((day + 1) * DAY_MS + 60_000);
    const next = await board(`zone=${spec.zone}&period=day`, p.token);
    expect(next).toMatchObject({ day: day + 1, total: 0, you: null, entries: [] });
    // still stored, ready for the 2-day prune
    const left = await env.DB.prepare('SELECT period FROM bests WHERE player_id = ?1').bind(p.playerId).all<{ period: string }>();
    expect(left.results.map((r) => r.period)).toEqual([`d${day}`]);
  });

  it('answers the class tab with the spec class of the current day, across UTC midnight', async () => {
    // a day whose class differs from the next day's, so the tab has to follow the clock
    const day = findDay((s) => s.classId !== dailySpec(s.day + 1).classId, 20_900);
    const now = clock(day * DAY_MS + 23 * 3_600_000);
    const spec = dailySpec(day);
    const p = await register();
    await submit(p, dailyBody(day, { stats: withKills(400), endedAt: now - 1000 }));
    const all = await board(`zone=${spec.zone}&period=day`, p.token);
    expect(all).toMatchObject({ day, total: 1, you: { rank: 1 } });
    expect({ ...(await board(`zone=${spec.zone}&period=day&class=${spec.classId}`, p.token)), class: 'all' }).toEqual(all);

    // after midnight the board is the new day's, and so is the class it answers to
    const later = clock((day + 1) * DAY_MS + 60_000);
    const next = dailySpec(day + 1);
    const q = await register();
    await submit(q, dailyBody(day + 1, { stats: withKills(200), endedAt: later - 1000 }));
    const nextAll = await board(`zone=${next.zone}&period=day`, q.token);
    expect(nextAll).toMatchObject({ day: day + 1, total: 1, you: { rank: 1 } });
    expect({ ...(await board(`zone=${next.zone}&period=day&class=${next.classId}`, q.token)), class: 'all' }).toEqual(nextAll);
    // yesterday's class is no longer today's board
    expect(await board(`zone=${next.zone}&period=day&class=${spec.classId}`, q.token)).toMatchObject({ day: day + 1, total: 0, entries: [], you: null });
  });

  it('validates the period parameter', async () => {
    for (const q of ['zone=yeonmu&period=days', 'zone=yeonmu&period=Day', 'zone=yeonmu&period=']) {
      const res = await call(`/leaderboard?${q}`);
      expect(res.status, q).toBe(400);
      expect((await errorOf(res)).details).toMatchObject({ field: 'period' });
    }
    const res = await call('/leaderboard?zone=yeonmu&period=day');
    expect(res.status).toBe(200);
    expect(await json<LeaderboardResponse>(res)).toMatchObject({ period: 'day', weekStart: null, total: 0 });
  });
});
