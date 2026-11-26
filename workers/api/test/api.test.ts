import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import {
  CODE_ALPHABET,
  SAVE_MAX_BYTES,
  computeScore,
  type ApiErrorBody,
  type CoopCreateResponse,
  type LeaderboardResponse,
  type RegisterResponse,
  type RunResponse,
  type SaveMeta,
  type TransferClaimResponse,
  type TransferCreateResponse,
} from '@ms/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { sha256Hex } from '../src/crypto';
import { housekeeping, RUN_RETENTION_MS } from '../src/cron';
import { originAllowed } from '../src/http';
import { ipKey, ipSubject, RULES } from '../src/limits';
import { sweepOrphanSaves } from '../src/saves';
import { BASE, call, freshIp, json, register, runBody, submit, uid } from './helpers';

async function errorOf(res: Response): Promise<ApiErrorBody['error']> {
  const body = (await res.json()) as ApiErrorBody;
  expect(body.error).toBeDefined();
  return body.error;
}

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The per-minute rate rules use fixed windows (limits.ts RATE_SQL): a burst that straddles a minute boundary is counted in two
 * windows and may never reach the limit (the "rate-limits uploads per player" test went red once, at 08:57:00). A test that
 * needs one burst inside one window waits out a boundary that is closer than `needMs`.
 */
async function insideOneMinute(needMs = 4000): Promise<void> {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 100));
}

describe('edge: errors, headers, CORS', () => {
  it('serves /health with request id and security headers', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: 'metin-survivors-api', db: true, blobs: true, clientIp: true });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers unknown routes with a structured 404', async () => {
    const res = await call('/nope');
    expect(res.status).toBe(404);
    const err = await errorOf(res);
    expect(err.code).toBe('not_found');
    expect(err.requestId).toBeTruthy();
  });

  it('applies the production origin allow-list (wrangler.toml) to every request', async () => {
    const allowed = ['https://metin-survivors.pages.dev', 'https://abc123.metin-survivors.pages.dev', 'https://master.metin-survivors.pages.dev'];
    for (const origin of allowed) {
      const res = await call('/health', { headers: { origin } });
      expect(res.status, origin).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('access-control-expose-headers')).toContain('ETag');
    }
    const denied = [
      'https://evil.example',
      'https://metin-survivors.pages.dev.evil.com',
      'http://metin-survivors.pages.dev',
      'https://a.b.metin-survivors.pages.dev',
      // localhost is a dev-only origin (`bun run --cwd workers/api dev` adds it), never allowed in production
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'null',
    ];
    for (const origin of denied) {
      const res = await call('/health', { headers: { origin } });
      expect(res.status, origin).toBe(403);
      expect((await errorOf(res)).code).toBe('origin_not_allowed');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    // non-browser callers (and same-origin GETs through the Pages proxy) send no Origin
    expect((await call('/health')).status).toBe(200);
  });

  it('matches exact, one-label wildcard and any-port dev origins', () => {
    const dev = { ALLOWED_ORIGINS: 'https://metin-survivors.pages.dev, https://*.metin-survivors.pages.dev, http://localhost:*, http://127.0.0.1:*' } as typeof env;
    for (const origin of ['http://localhost:5173', 'http://localhost:5180', 'http://127.0.0.1:18788', 'https://x1.metin-survivors.pages.dev']) {
      expect(originAllowed(dev, origin), origin).toBe(true);
    }
    for (const origin of ['https://localhost:5173', 'http://localhost', 'http://localhost:99999', 'http://localhost:51x', 'http://localhost.evil.com:80', 'http://evil.localhost:5173', 'http://127.0.0.2:5173']) {
      expect(originAllowed(dev, origin), origin).toBe(false);
    }
  });

  it('handles CORS preflight', async () => {
    const origin = 'https://metin-survivors.pages.dev';
    const res = await call('/save', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,if-match' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('access-control-allow-headers')).toMatch(/If-Match/i);
    const denied = await call('/save', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(denied.status).toBe(403);
  });

  it('never leaks internals on unexpected failures', async () => {
    const broken = {
      ...env,
      RL_IP: undefined,
      DB: {
        prepare() {
          throw new Error('SECRET INTERNAL: connection string leaked at /srv/app/db.ts:42');
        },
        batch() {
          throw new Error('SECRET INTERNAL');
        },
      },
    } as unknown as typeof env;
    const res = await worker.fetch(new Request(`${BASE}/players`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: '{}' }), broken, createExecutionContext());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/SECRET|\.ts:|\bat \w+/);
    const err = (JSON.parse(text) as ApiErrorBody).error;
    expect(err.code).toBe('internal');
    expect(err.requestId).toBeTruthy();
  });

  it('applies the edge rate-limit bindings (per IP and per player)', async () => {
    const deny = { limit: async () => ({ success: false }) };
    const ipDenied = await worker.fetch(new Request(`${BASE}/health`), { ...env, RL_IP: deny } as unknown as typeof env, createExecutionContext());
    expect(ipDenied.status).toBe(429);
    expect((await errorOf(ipDenied)).code).toBe('rate_limited');
    expect(ipDenied.headers.get('retry-after')).toBeTruthy();

    const p = await register();
    const playerDenied = await worker.fetch(
      new Request(`${BASE}/save`, { headers: { authorization: `Bearer ${p.token}`, 'cf-connecting-ip': p.ip } }),
      { ...env, RL_PLAYER: deny } as unknown as typeof env,
      createExecutionContext(),
    );
    expect(playerDenied.status).toBe(429);
  });

  it('has the rate-limit bindings configured', () => {
    expect(env.RL_IP).toBeDefined();
    expect(env.RL_PLAYER).toBeDefined();
  });
});

describe('players & auth', () => {
  it('registers a player and stores only the secret hash', async () => {
    const res = await call('/players', { json: { name: 'Çağatay' } });
    expect(res.status).toBe(201);
    const body = await json<RegisterResponse>(res);
    expect(body.name).toBe('Çağatay');
    expect(body.playerId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const rows = await env.DB.prepare('SELECT secret_hash FROM credentials WHERE player_id = ?1').bind(body.playerId).all<{ secret_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.secret_hash).toBe(await sha256Hex(body.secret));
    expect(JSON.stringify(rows.results)).not.toContain(body.secret);
  });

  it('assigns a default name when none is given', async () => {
    const res = await call('/players', { json: {} });
    expect(res.status).toBe(201);
    const registered = await json<RegisterResponse>(res);
    expect(registered.name).toMatch(/^Kahraman\d{4}$/);
    const empty = await call('/players', { method: 'POST' });
    expect(empty.status).toBe(201);
  });

  it('validates registration input', async () => {
    for (const name of ['ab', 'x'.repeat(17), 'bad<name>', 'two  spaces', 12]) {
      const res = await call('/players', { json: { name } });
      expect(res.status, String(name)).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('validation');
      expect(err.details).toMatchObject({ field: 'name' });
    }
    expect((await call('/players', { body: 'not json', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await call('/players', { body: '{"name":"abcd"}', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await call('/players', { json: { name: 'abcd', pad: 'x'.repeat(2000) } })).status).toBe(413);
  });

  it('rejects profane and reserved names', async () => {
    for (const name of ['siktir', 'S1kt1r', 'fuck', 'admin']) {
      const res = await call('/players', { json: { name } });
      expect(res.status, name).toBe(422);
      expect((await errorOf(res)).code).toBe('name_rejected');
    }
  });

  it('authenticates with Bearer <playerId>.<secret> and fails closed otherwise', async () => {
    const p = await register();
    expect((await call('/save', { token: p.token, ip: p.ip })).status).toBe(204); // authenticated, just no save yet (not an error)

    const other = await register();
    const attempts: (string | undefined)[] = [
      undefined,
      'garbage',
      `${p.playerId}.${'x'.repeat(32)}`, // wrong secret
      `${p.playerId}.${other.secret}`, // another player's secret
      `${'z'.repeat(16)}.${p.secret}`, // unknown player
      `${p.playerId}`,
    ];
    const bodies: string[] = [];
    for (const token of attempts) {
      const res = await call('/save', token === undefined ? {} : { token });
      expect(res.status, String(token)).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      bodies.push((await errorOf(res)).code);
    }
    expect(new Set(bodies)).toEqual(new Set(['unauthorized']));
  });

  it('blocks banned players', async () => {
    const p = await register();
    await env.DB.prepare('UPDATE players SET banned = 1 WHERE id = ?1').bind(p.playerId).run();
    const res = await call('/save', { token: p.token });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('banned');
  });

  it('renames with the same moderation rules', async () => {
    const p = await register();
    const ok = await call('/players/me', { method: 'PATCH', token: p.token, json: { name: 'Yeni İsim' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ playerId: p.playerId, name: 'Yeni İsim' });
    expect((await call('/players/me', { method: 'PATCH', token: p.token, json: { name: 'amk' } })).status).toBe(422);
    expect((await call('/players/me', { method: 'PATCH', token: p.token, json: { name: 'x' } })).status).toBe(400);
    expect((await call('/players/me', { method: 'PATCH', json: { name: 'Fine Name' } })).status).toBe(401);
    const row = await env.DB.prepare('SELECT name FROM players WHERE id = ?1').bind(p.playerId).first<{ name: string }>();
    expect(row?.name).toBe('Yeni İsim');
  });

  it('rate-limits registration per IP', async () => {
    const ip = freshIp();
    const hourly = RULES.register[0]?.limit ?? 0;
    expect(hourly).toBeGreaterThanOrEqual(20); // shared CGNAT / internet-café addresses must not lock players out
    for (let i = 0; i < hourly; i++) {
      const res = await call('/players', { ip, json: { name: `Limit${i}abc` } });
      expect(res.status).toBe(201);
    }
    const res = await call('/players', { ip, json: { name: 'Limitzzabc' } });
    expect(res.status).toBe(429);
    const err = await errorOf(res);
    expect(err.code).toBe('rate_limited');
    expect(err.details?.retryAfterSec).toBeGreaterThan(0);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // another IP is unaffected
    expect((await call('/players', { json: { name: 'Other abc' } })).status).toBe(201);
  });

  it('treats an IPv6 /64 as one client for rate limiting', async () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0DB8:0001:0002:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    const hourly = RULES.register[0]?.limit ?? 0;
    const statuses: number[] = [];
    for (let i = 0; i < hourly + 2; i++) {
      const ip = `2001:db8:77:88:${(i + 1).toString(16)}::${i + 5}`;
      statuses.push((await call('/players', { ip, json: { name: `Sixer${i}abc` } })).status);
    }
    expect(statuses).toEqual([...new Array<number>(hourly).fill(201), 429, 429]);
  });

  it('keys the IP hashes of the rate counters with IP_HASH_SECRET when it is set', async () => {
    const plain = await ipSubject('203.0.113.9');
    expect(plain).toBe(`ip:${(await sha256Hex('ip|203.0.113.9')).slice(0, 24)}`);
    const keyed = await ipSubject('203.0.113.9', 'test-secret');
    expect(keyed).toMatch(/^ip:[0-9a-f]{24}$/);
    expect(keyed).not.toBe(plain);
    expect(await ipSubject('203.0.113.9', 'test-secret')).toBe(keyed);
    expect(await ipSubject('203.0.113.9', 'other-secret')).not.toBe(keyed);
    // the /64 collapse still applies under the key
    expect(await ipSubject('2001:db8:1:2::5', 'test-secret')).toBe(await ipSubject('2001:db8:1:2:ffff::9', 'test-secret'));
  });

  it('rate-limits renames per player', async () => {
    const p = await register();
    for (let i = 0; i < 5; i++) {
      expect((await call('/players/me', { method: 'PATCH', token: p.token, json: { name: `Name${i}abc` } })).status).toBe(200);
    }
    expect((await call('/players/me', { method: 'PATCH', token: p.token, json: { name: 'Name9abc' } })).status).toBe(429);
  });

  it('erases a player on request: save blob, credentials, runs, board rows, transfer codes', async () => {
    const p = await register('Erase Me');
    const run = runBody({ zone: 'seori' });
    expect((await submit(p, run)).status).toBe(201);
    const put = await call('/save', { method: 'PUT', token: p.token, body: '{"version":1}', headers: { 'content-type': 'application/json', 'if-match': '0' } });
    expect(put.status).toBe(200);
    expect((await call('/transfer', { method: 'POST', token: p.token })).status).toBe(201);
    expect((await call('/players/me', { method: 'PATCH', token: p.token, json: { name: 'Erase Me 2' } })).status).toBe(200);
    expect((await env.BLOBS.list({ prefix: `saves/${p.playerId}.` })).objects.length).toBeGreaterThan(0);
    // the per-player rate counters (<rule>:p:<id>) exist before the erasure …
    const playerCounters = async (): Promise<number> =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM rate_counters WHERE instr(key, ?1) > 0`).bind(`:p:${p.playerId}`).first<{ n: number }>())?.n ?? -1;
    expect(await playerCounters()).toBeGreaterThanOrEqual(4);
    const ipCounters = async (): Promise<number> => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'register_h:ip:%'`).first<{ n: number }>())?.n ?? -1;
    const ipBefore = await ipCounters();
    expect(ipBefore).toBeGreaterThan(0);

    expect((await call('/players/me', { method: 'DELETE' })).status).toBe(401);
    const del = await call('/players/me', { method: 'DELETE', token: p.token });
    expect(del.status).toBe(204);
    expect(del.headers.get('cache-control')).toBe('no-store');

    expect((await env.BLOBS.list({ prefix: `saves/${p.playerId}.` })).objects).toHaveLength(0);
    // … and are gone afterwards; the hashed-IP counters are shared abuse state and stay (they expire by themselves)
    expect(await playerCounters()).toBe(0);
    expect(await ipCounters()).toBe(ipBefore);
    // a second erase with the dead credentials is a plain 401 (the client treats it as "already erased")
    const again = await call('/players/me', { method: 'DELETE', token: p.token });
    expect(again.status).toBe(401);
    expect((await errorOf(again)).code).toBe('unauthorized');
    for (const [table, column] of [['players', 'id'], ['credentials', 'player_id'], ['runs', 'player_id'], ['bests', 'player_id'], ['transfer_codes', 'player_id']] as const) {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?1`).bind(p.playerId).first<{ n: number }>();
      expect(n?.n, table).toBe(0);
    }
    // the old credential is dead; the board no longer lists the player
    expect((await call('/save', { token: p.token })).status).toBe(401);
    const lb = (await (await call('/leaderboard?zone=seori')).json()) as LeaderboardResponse;
    expect(lb.entries.some((e) => e.name === 'Erase Me')).toBe(false);
    // preflight allows the method for cross-origin clients
    const pre = await call('/players/me', { method: 'OPTIONS', headers: { origin: 'https://metin-survivors.pages.dev', 'access-control-request-method': 'DELETE' } });
    expect(pre.headers.get('access-control-allow-methods')).toContain('DELETE');
  });
});

describe('POST /runs', () => {
  it('accepts a plausible run and recomputes the score server-side', async () => {
    const p = await register();
    const run = runBody({ score: 999_999_999 });
    const res = await submit(p, run);
    expect(res.status).toBe(201);
    const body = (await res.json()) as RunResponse;
    const expected = computeScore(run.stats, { victory: run.victory, duration: run.duration, difficulty: run.difficulty });
    expect(body.score).toBe(expected);
    expect(body).toMatchObject({ status: 'ok', duplicate: false, best: true, bestScore: expected, rank: 1, weekRank: 1, classRank: 1 });
    expect(body.flags).toEqual(['score_mismatch']);
    const row = await env.DB.prepare('SELECT score, claimed_score, status FROM runs WHERE id = ?1').bind(body.id).first();
    expect(row).toEqual({ score: expected, claimed_score: 999_999_999, status: 'ok' });
  });

  it('is idempotent on runId', async () => {
    const p = await register();
    const run = runBody();
    const first = (await (await submit(p, run)).json()) as RunResponse;
    const again = await submit(p, run);
    expect(again.status).toBe(200);
    const body = (await again.json()) as RunResponse;
    expect(body).toMatchObject({ id: first.id, score: first.score, duplicate: true, best: false });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE player_id = ?1').bind(p.playerId).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('requires auth, a valid body and an allowed client version', async () => {
    const p = await register();
    expect((await call('/runs', { json: runBody() })).status).toBe(401);
    const bad = await submit(p, runBody({ zone: 'atlantis' as never }));
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).details).toMatchObject({ field: 'zone' });
    const old = await submit(p, runBody({ clientVersion: '0.9.0' }));
    expect(old.status).toBe(426);
    expect((await errorOf(old)).code).toBe('client_outdated');
    expect((await call('/runs', { token: p.token, json: { ...runBody(), pad: 'x'.repeat(5000) } })).status).toBe(413);
  });

  it('rejects implausible runs (422), stores them for audit and keeps them off the board', async () => {
    const p = await register();
    const cheat = runBody({ stats: { kills: 900_000, elites: 0, bosses: 0, metins: 0, level: 3000, yeop: 1_900_000_000 } });
    const res = await submit(p, cheat);
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.code).toBe('implausible_run');
    expect(err.details?.reasons).toEqual(expect.arrayContaining(['kills_rate', 'level_rate', 'yeop_rate']));
    const row = await env.DB.prepare('SELECT status, flags FROM runs WHERE player_id = ?1').bind(p.playerId).first<{ status: string; flags: string }>();
    expect(row?.status).toBe('rejected');
    expect(row?.flags).toContain('kills_rate');
    // resubmitting the same runId stays rejected, nothing ranked
    expect((await submit(p, cheat)).status).toBe(422);
    const bests = await env.DB.prepare('SELECT COUNT(*) AS n FROM bests WHERE player_id = ?1').bind(p.playerId).first<{ n: number }>();
    expect(bests?.n).toBe(0);
  });

  it('keeps stalled long runs off the board (flagged, never rejected) and rejects bad timestamps', async () => {
    const p = await register();
    // honest Run Options victories end as late as ~1,350 s: accepted and ranked
    const slow = await submit(p, runBody({ duration: 1300, victory: true, stats: { kills: 9000, elites: 300, bosses: 5, metins: 12, level: 60, yeop: 30_000 } }));
    expect(slow.status).toBe(201);
    expect(((await slow.json()) as RunResponse).status).toBe('ok');
    const long = await submit(p, runBody({ duration: 1600, endedAt: Date.now() - 4_000_000 }));
    expect(long.status).toBe(201);
    const longBody = (await long.json()) as RunResponse;
    expect(longBody.status).toBe('flagged');
    expect(longBody.flags).toContain('duration_long');
    const future = await submit(p, runBody({ endedAt: Date.now() + 3_600_000 }));
    expect((await errorOf(future)).details?.reasons).toContain('future_timestamp');
    const stale = await submit(p, runBody({ endedAt: Date.now() - 30 * 86_400_000 }));
    expect((await errorOf(stale)).details?.reasons).toContain('stale_run');
  });

  it('flags outliers: stored, unranked, not on the leaderboard', async () => {
    const p = await register();
    // 10 min on normal: soft 20,328 kills, hard 29,040
    const res = await submit(p, runBody({ stats: { kills: 25_000, elites: 10, bosses: 2, metins: 6, level: 40, yeop: 20_000 } }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as RunResponse;
    expect(body).toMatchObject({ status: 'flagged', rank: null, weekRank: null, classRank: null, best: false });
    expect(body.flags).toContain('kills_rate_high');
    const lb = (await (await call('/leaderboard?zone=yeonmu', { token: p.token })).json()) as LeaderboardResponse;
    expect(lb.you).toBeNull();
    expect(lb.entries.some((e) => e.you)).toBe(false);
  });

  it('flags overlapping runs of one player', async () => {
    const p = await register();
    const t = Date.now() - 60_000;
    const a = await submit(p, runBody({ endedAt: t }));
    expect(((await a.json()) as RunResponse).status).toBe('ok');
    const b = await submit(p, runBody({ endedAt: t + 30_000 }));
    const body = (await b.json()) as RunResponse;
    expect(body.status).toBe('flagged');
    expect(body.flags).toContain('overlap');
    // a run that ended 10 minutes + before the first started does not overlap
    const c = await submit(p, runBody({ endedAt: t - 601_000 }));
    expect(((await c.json()) as RunResponse).status).toBe('ok');
  });

  it('rate-limits submissions per player', async () => {
    await insideOneMinute();
    const p = await register();
    let limited = 0;
    for (let i = 0; i < 18; i++) {
      const res = await submit(p, runBody({ endedAt: Date.now() - 1000 - i * 700_000, duration: 60, stats: { kills: 50, elites: 0, bosses: 0, metins: 0, level: 5, yeop: 100 } }));
      if (res.status === 429) limited++;
      else expect([200, 201]).toContain(res.status);
    }
    expect(limited).toBeGreaterThanOrEqual(3);
  });
});

describe('GET /leaderboard', () => {
  /** Plausible stats whose score differs by `kills` only. */
  const withKills = (kills: number) => ({ kills, elites: 0, bosses: 0, metins: 0, level: 10, yeop: 0 });

  async function board(query: string, token?: string): Promise<LeaderboardResponse> {
    const res = await call(`/leaderboard?${query}`, token ? { token } : {});
    expect(res.status).toBe(200);
    return (await res.json()) as LeaderboardResponse;
  }

  it('orders by score, breaks ties by earliest, and ranks the caller beyond the limit', async () => {
    const zone = 'seori';
    const players = [];
    for (const [i, kills] of [100, 500, 300, 300, 50].entries()) {
      const p = await register();
      const res = await submit(p, runBody({ zone, stats: withKills(kills) }));
      expect(res.status, `player ${i}`).toBe(201);
      players.push({ p, kills });
    }
    // pin arrival order for the tie (players 2 and 3 both scored 300 kills) instead of sleeping
    await env.DB.batch([
      env.DB.prepare('UPDATE bests SET achieved_at = 1000 WHERE player_id = ?1 AND zone = ?2').bind(players[2]?.p.playerId, zone),
      env.DB.prepare('UPDATE bests SET achieved_at = 2000 WHERE player_id = ?1 AND zone = ?2').bind(players[3]?.p.playerId, zone),
    ]);
    const lb = await board(`zone=${zone}&limit=3`, players[4]?.p.token);
    expect(lb.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    const scores = lb.entries.map((e) => e.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(lb.entries[0]?.score).toBe(computeScore(withKills(500), { victory: false, duration: 600, difficulty: 'normal' }));
    expect(lb.total).toBe(5);
    expect(lb.entries.every((e) => !e.you)).toBe(true);
    // caller (lowest score) is outside the top 3 but still gets a rank
    expect(lb.you).toMatchObject({ rank: 5, you: true });
    // tie on 300 kills: the earlier submitter ranks above the later one (arrival order pinned explicitly)
    const full = await board(`zone=${zone}`, players[3]?.p.token);
    expect(full.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(full.entries[1]?.score).toBe(full.entries[2]?.score);
    expect(full.you?.rank).toBe(3);
    expect(full.entries.find((e) => e.you)?.rank).toBe(3);
    expect(full.entries[1]?.you).toBe(false);
    expect(full.entries[2]?.you).toBe(true);
    // the DB-level tiebreak matches: earlier achieved_at first
    const times = await env.DB.prepare(`SELECT player_id, achieved_at FROM bests WHERE zone = ?1 AND period = 'all' AND class_id = '*' AND score = ?2 ORDER BY achieved_at`)
      .bind(zone, full.entries[1]?.score)
      .all<{ player_id: string }>();
    expect(times.results.map((r) => r.player_id)).toEqual([players[2]?.p.playerId, players[3]?.p.playerId]);
  });

  it('keeps one best row per player and reports personal-best transitions', async () => {
    const zone = 'suryeon';
    const p = await register();
    const t = Date.now();
    const first = (await (await submit(p, runBody({ zone, stats: withKills(400), endedAt: t - 2_000_000 }))).json()) as RunResponse;
    expect(first.best).toBe(true);
    const worse = (await (await submit(p, runBody({ zone, stats: withKills(200), endedAt: t - 1_300_000 }))).json()) as RunResponse;
    expect(worse).toMatchObject({ best: false, bestScore: first.score, rank: 1 });
    const better = (await (await submit(p, runBody({ zone, stats: withKills(900), endedAt: t - 600_000 }))).json()) as RunResponse;
    expect(better.best).toBe(true);
    expect(better.bestScore).toBe(better.score);
    const lb = await board(`zone=${zone}&limit=100`, p.token);
    expect(lb.entries.filter((e) => e.you)).toHaveLength(1);
    expect(lb.you?.score).toBe(better.score);
  });

  it('separates zones, difficulties, classes and exposes no player ids', async () => {
    const p = await register();
    const t = Date.now();
    await submit(p, runBody({ zone: 'daeryeol', difficulty: 'hard', classId: 'yacha', stats: withKills(300), endedAt: t - 2_000_000 }));
    await submit(p, runBody({ zone: 'daeryeol', difficulty: 'hard', classId: 'wolfman', stats: withKills(600), endedAt: t - 1_000_000 }));
    const all = await board('zone=daeryeol&difficulty=hard', p.token);
    expect(all.entries).toHaveLength(1);
    expect(all.entries[0]).toMatchObject({ classId: 'wolfman', you: true });
    expect((await board('zone=daeryeol&difficulty=hard&class=yacha', p.token)).entries[0]?.classId).toBe('yacha');
    expect((await board('zone=daeryeol&difficulty=hard&class=warrior')).entries).toHaveLength(0);
    expect((await board('zone=daeryeol&difficulty=normal')).entries).toHaveLength(0);
    expect((await board('zone=yeonmu&difficulty=hard&class=yacha')).entries.every((e) => e.classId === 'yacha')).toBe(true);
    expect(JSON.stringify(all)).not.toContain(p.playerId);
  });

  it('serves anonymous callers and ignores stale credentials', async () => {
    const anon = await board('zone=yeonmu');
    expect(anon.you).toBeNull();
    const stale = await board('zone=yeonmu', `${'q'.repeat(16)}.${'r'.repeat(32)}`);
    expect(stale.you).toBeNull();
  });

  it('validates query parameters', async () => {
    for (const q of ['', 'zone=x', 'zone=yeonmu&period=year', 'zone=yeonmu&period=Day', 'zone=yeonmu&limit=500', 'zone=yeonmu&class=bard']) {
      const res = await call(`/leaderboard?${q}`);
      expect(res.status, q).toBe(400);
      expect((await errorOf(res)).code).toBe('validation');
      // an error never becomes a shared-cache entry
      expect(res.headers.get('cache-control'), q).toBe('no-store');
    }
  });

  it('caches only the caller-independent board: anonymous = short shared cache, with credentials = private, errors = no-store', async () => {
    const zone = 'daeryeol';
    const p = await register('Cache Hero');
    expect((await submit(p, runBody({ zone, difficulty: 'hard', stats: withKills(250) }))).status).toBe(201);
    const q = `zone=${zone}&difficulty=hard`;

    // anonymous: the same bytes for everybody → cacheable for a short time; Vary keeps it from answering an authenticated request
    const anon = await call(`/leaderboard?${q}`, { headers: { origin: 'https://metin-survivors.pages.dev' } });
    expect(anon.status).toBe(200);
    expect(anon.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=60');
    const vary = (anon.headers.get('vary') ?? '').split(',').map((v) => v.trim().toLowerCase());
    expect(vary).toContain('authorization');
    expect(vary).toContain('origin');
    const anonBody = (await anon.json()) as LeaderboardResponse;
    expect(anonBody.you).toBeNull();
    expect(anonBody.entries.every((e) => !e.you)).toBe(true);
    expect(anonBody.entries.some((e) => e.name === 'Cache Hero')).toBe(true);

    // the same URL with credentials carries the caller's own row → never shared, never stored
    const mine = await call(`/leaderboard?${q}`, { token: p.token });
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toBe('private, no-store');
    const mineBody = (await mine.json()) as LeaderboardResponse;
    expect(mineBody.you).toMatchObject({ you: true, name: 'Cache Hero' });
    expect(mineBody.entries.some((e) => e.you)).toBe(true);

    // a stale / malformed Authorization header resolves to no caller, but it is still a credentialed request: not shared
    for (const authorization of [`Bearer ${'q'.repeat(16)}.${'r'.repeat(32)}`, 'Bearer nonsense', 'Basic abc']) {
      const stale = await call(`/leaderboard?${q}`, { headers: { authorization } });
      expect(stale.status, authorization).toBe(200);
      expect(stale.headers.get('cache-control'), authorization).toBe('private, no-store');
      expect(((await stale.json()) as LeaderboardResponse).you).toBeNull();
    }

    // errors and every other endpoint keep the edge default
    expect((await call('/leaderboard?zone=x')).headers.get('cache-control')).toBe('no-store');
    expect((await call('/health')).headers.get('cache-control')).toBe('no-store');
  });

  it('weekly board only counts the current UTC week', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Wednesday 2026-03-04 12:00 UTC (week starting Monday 2026-03-02)
    const wed = Date.UTC(2026, 2, 4, 12);
    vi.setSystemTime(wed);
    const p = await register();
    const res = await submit(p, runBody({ zone: 'yeonmu', difficulty: 'hard', stats: withKills(222), endedAt: wed - 5000 }));
    expect(res.status).toBe(201);
    const thisWeek = await board('zone=yeonmu&difficulty=hard&period=week', p.token);
    expect(thisWeek.weekStart).toBe(Date.UTC(2026, 2, 2));
    expect(thisWeek.you?.rank).toBe(1);
    expect(thisWeek.entries.some((e) => e.you)).toBe(true);
    // Sunday 23:59 is still the same week
    vi.setSystemTime(Date.UTC(2026, 2, 8, 23, 59));
    expect((await board('zone=yeonmu&difficulty=hard&period=week', p.token)).entries.some((e) => e.you)).toBe(true);
    // Monday 00:00 opens a new week: weekly board empty, all-time still has the run
    vi.setSystemTime(Date.UTC(2026, 2, 9, 0, 0, 1));
    const next = await board('zone=yeonmu&difficulty=hard&period=week', p.token);
    expect(next.weekStart).toBe(Date.UTC(2026, 2, 9));
    expect(next.entries.some((e) => e.you)).toBe(false);
    expect(next.you).toBeNull();
    expect((await board('zone=yeonmu&difficulty=hard&period=all', p.token)).you?.rank).toBeGreaterThanOrEqual(1);
  });

  it('housekeeping drops old weekly rows, expired codes and stale counters but keeps all-time rows', async () => {
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO players (id, name, created_at, last_seen_at) VALUES ('hk-player-0000000', 'HkPlayer', ?1, ?1)`).bind(now).run();
    const week = Math.floor((Math.floor(now / 86_400_000) + 3) / 7);
    const row = (period: string) =>
      env.DB
        .prepare(
          `INSERT INTO bests (mode, period, zone, difficulty, class_id, player_id, score, run_id, run_class, victory, level, kills, duration_ms, achieved_at)
           VALUES ('solo', ?1, 'yeonmu', 'normal', '*', 'hk-player-0000000', 1, 1, 'warrior', 0, 1, 1, 1000, ?2)`,
        )
        .bind(period, now);
    await env.DB.batch([row('all'), row(`w${week}`), row(`w${week - 1}`)]);
    await row('w1').run();
    await env.DB.prepare(`INSERT INTO rate_counters VALUES ('old:key', ?1, 3)`).bind(now - 5 * 86_400_000).run();
    await env.DB.prepare(`INSERT INTO transfer_codes VALUES ('expiredhash', 'hk-player-0000000', ?1, ?2)`).bind(now - 90_000_000, now - 86_400_000).run();
    const result = await housekeeping(env, now);
    expect(result.codes).toBe(1);
    expect(result.boards).toBeGreaterThanOrEqual(1);
    expect(result.counters).toBeGreaterThanOrEqual(1);
    const periods = await env.DB.prepare(`SELECT period FROM bests WHERE player_id = 'hk-player-0000000' ORDER BY period`).all<{ period: string }>();
    expect(periods.results.map((r) => r.period).sort()).toEqual(['all', `w${week - 1}`, `w${week}`].sort());
  });

  it('housekeeping prunes day boards older than two days and leaves the weekly / all-time rows alone (DLY-01)', async () => {
    const now = Date.UTC(2026, 9, 30, 3, 17);
    const today = Math.floor(now / 86_400_000);
    const week = Math.floor((today + 3) / 7);
    await env.DB.prepare(`INSERT INTO players (id, name, created_at, last_seen_at) VALUES ('dy-player-0000000', 'DyPlayer', ?1, ?1)`).bind(now).run();
    const row = (period: string, zone = 'yeonmu') =>
      env.DB
        .prepare(
          `INSERT INTO bests (mode, period, zone, difficulty, class_id, player_id, score, run_id, run_class, victory, level, kills, duration_ms, achieved_at)
           VALUES ('solo', ?1, ?2, 'normal', '*', 'dy-player-0000000', 1, 1, 'warrior', 0, 1, 1, 1000, ?3)`,
        )
        .bind(period, zone, now);
    const keep = ['all', `w${week}`, `w${week - 1}`, `d${today}`, `d${today - 1}`, `d${today - 2}`];
    const drop = [`d${today - 3}`, `d${today - 10}`, `d${today - 400}`, 'd5'];
    await env.DB.batch([...keep, ...drop].map((p) => row(p)));
    // the same day number on another zone is pruned too, a weekly key that happens to be numerically small is a WEEK key
    await env.DB.batch([row(`d${today - 3}`, 'seori'), row('w1', 'seori')]);
    const result = await housekeeping(env, now);
    expect(result.dailyBoards).toBe(drop.length + 1);
    const left = await env.DB.prepare(`SELECT period FROM bests WHERE player_id = 'dy-player-0000000'`).all<{ period: string }>();
    expect(left.results.map((r) => r.period).sort()).toEqual([...keep].sort());
    // a second pass has nothing left to do
    expect((await housekeeping(env, now)).dailyBoards).toBe(0);
    // a day later today - 2 becomes today - 3 and goes
    expect((await housekeeping(env, now + 86_400_000)).dailyBoards).toBe(1);
  });

  it('housekeeping deletes unranked runs after the retention period but keeps runs a board row points at', async () => {
    const now = Date.now();
    const old = now - RUN_RETENTION_MS - 86_400_000;
    await env.DB.prepare(`INSERT INTO players (id, name, created_at, last_seen_at) VALUES ('rt-player-0000000', 'RtPlayer', ?1, ?1)`).bind(old).run();
    const insertRun = async (clientRunId: string, createdAt: number, status: string): Promise<number> => {
      const r = await env.DB.prepare(
        `INSERT INTO runs (player_id, client_run_id, zone, difficulty, class_id, seed, victory, duration_ms, started_at, ended_at, created_at,
           kills, elites, bosses, metins, level, yeop, score, status, client_version)
         VALUES ('rt-player-0000000', ?1, 'yeonmu', 'normal', 'warrior', 1, 0, 60000, ?2, ?2, ?2, 1, 0, 0, 0, 1, 0, 10, ?3, '1.0.0') RETURNING id`,
      )
        .bind(clientRunId, createdAt, status)
        .first<{ id: number }>();
      return r?.id ?? -1;
    };
    const stale = await insertRun('rt-stale-00001', old, 'flagged');
    const rejected = await insertRun('rt-rejected-01', old, 'rejected');
    const ranked = await insertRun('rt-ranked-0001', old, 'ok');
    const fresh = await insertRun('rt-fresh-00001', now, 'flagged');
    await env.DB.prepare(
      `INSERT INTO bests (mode, period, zone, difficulty, class_id, player_id, score, run_id, run_class, victory, level, kills, duration_ms, achieved_at)
       VALUES ('solo', 'all', 'suryeon', 'hard', '*', 'rt-player-0000000', 10, ?1, 'warrior', 0, 1, 1, 60000, ?2)`,
    )
      .bind(ranked, old)
      .run();
    const result = await housekeeping(env, now);
    expect(result.runs).toBeGreaterThanOrEqual(2);
    const left = await env.DB.prepare(`SELECT id FROM runs WHERE player_id = 'rt-player-0000000' ORDER BY id`).all<{ id: number }>();
    const ids = left.results.map((r) => r.id);
    expect(ids).toContain(ranked);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(stale);
    expect(ids).not.toContain(rejected);
  });
});

describe('co-op boards', () => {
  const withKills = (kills: number) => ({ kills, elites: 0, bosses: 0, metins: 0, level: 10, yeop: 0 });
  const board = async (query: string, token?: string): Promise<LeaderboardResponse> =>
    json<LeaderboardResponse>(await call(`/leaderboard?${query}`, token ? { token } : {}));

  it('ranks co-op runs on their own board and keeps them off the solo board', async () => {
    const zone = 'seori';
    const difficulty = 'hard';
    const solo = await register();
    const duo = await register();
    const quad = await register();
    const t = Date.now();
    const soloRes = await json<RunResponse>(await submit(solo, runBody({ zone, difficulty, stats: withKills(300), endedAt: t - 3_000_000 })));
    const duoRes = await submit(duo, runBody({ zone, difficulty, coop: 2, stats: withKills(900), endedAt: t - 2_000_000 }));
    expect(duoRes.status).toBe(201);
    const duoBody = await json<RunResponse>(duoRes);
    expect(duoBody).toMatchObject({ mode: 'coop', status: 'ok', best: true, rank: 1, weekRank: 1, classRank: 1 });
    const quadBody = await json<RunResponse>(await submit(quad, runBody({ zone, difficulty, coop: 4, stats: withKills(400), endedAt: t - 1_000_000 })));
    expect(quadBody).toMatchObject({ mode: 'coop', rank: 2 });
    expect(soloRes).toMatchObject({ mode: 'solo', rank: 1 });

    // default (and explicit) solo board: only the solo run, even though the co-op scores are higher
    for (const q of [`zone=${zone}&difficulty=${difficulty}`, `zone=${zone}&difficulty=${difficulty}&mode=solo`]) {
      const lb = await board(q, duo.token);
      expect(lb.mode).toBe('solo');
      expect(lb.entries.map((e) => e.score)).toEqual([soloRes.score]);
      expect(lb.entries[0]?.party).toBe(1);
      expect(lb.total).toBe(1);
      expect(lb.you).toBeNull(); // the duo player has no solo standing
    }
    const co = await board(`zone=${zone}&difficulty=${difficulty}&mode=coop`, quad.token);
    expect(co.mode).toBe('coop');
    expect(co.entries.map((e) => [e.rank, e.score, e.party])).toEqual([
      [1, duoBody.score, 2],
      [2, quadBody.score, 4],
    ]);
    expect(co.total).toBe(2);
    expect(co.you).toMatchObject({ rank: 2, party: 4, you: true });
    // the same player can hold independent solo and co-op bests
    const both = await json<RunResponse>(await submit(duo, runBody({ zone, difficulty, stats: withKills(100), endedAt: t - 500_000 })));
    expect(both).toMatchObject({ mode: 'solo', best: true, rank: 2 });
    expect((await board(`zone=${zone}&difficulty=${difficulty}&mode=coop`, duo.token)).you?.score).toBe(duoBody.score);
    // weekly + class filters work per mode
    expect((await board(`zone=${zone}&difficulty=${difficulty}&mode=coop&period=week`)).entries).toHaveLength(2);
    expect((await board(`zone=${zone}&difficulty=${difficulty}&mode=coop&class=ninja`)).entries).toHaveLength(0);
  });

  it('validates the party size and the mode parameter', async () => {
    const p = await register();
    for (const coop of [1, 5, 0, -2, 2.5, '3', null]) {
      const res = await submit(p, runBody({ coop: coop as never }));
      expect(res.status, String(coop)).toBe(400);
      expect((await errorOf(res)).details).toMatchObject({ field: 'coop' });
    }
    for (const coop of [2, 3, 4]) expect((await submit(p, runBody({ coop, endedAt: Date.now() - coop * 1_000_000 }))).status).toBe(201);
    const res = await call('/leaderboard?zone=yeonmu&mode=duo');
    expect(res.status).toBe(400);
    expect((await errorOf(res)).details).toMatchObject({ field: 'mode' });
  });

  it('stores the party size and applies the same plausibility checks to co-op runs', async () => {
    const p = await register();
    const ok = await json<RunResponse>(await submit(p, runBody({ coop: 3 })));
    const row = await env.DB.prepare('SELECT coop FROM runs WHERE id = ?1').bind(ok.id).first<{ coop: number }>();
    expect(row?.coop).toBe(3);
    const solo = await json<RunResponse>(await submit(p, runBody({ endedAt: Date.now() - 3_000_000 })));
    expect((await env.DB.prepare('SELECT coop FROM runs WHERE id = ?1').bind(solo.id).first<{ coop: number }>())?.coop).toBe(1);

    const cheat = await submit(p, runBody({ coop: 4, stats: { kills: 900_000, elites: 0, bosses: 0, metins: 0, level: 9000, yeop: 1_900_000_000 } }));
    expect(cheat.status).toBe(422);
    // fabricated co-op run exploiting unbounded elites for a 100,000,000 score must be rejected
    const eliteCheat = await submit(p, runBody({ coop: 2, stats: { kills: 0, elites: 1_000_000, bosses: 0, metins: 0, level: 1, yeop: 0 } }));
    expect(eliteCheat.status).toBe(422);
    expect((await errorOf(eliteCheat)).details?.reasons).toContain('elites_rate');
    const flagged = await json<RunResponse>(await submit(p, runBody({ coop: 2, endedAt: Date.now() - 4_000_000, stats: { kills: 25_000, elites: 10, bosses: 2, metins: 6, level: 40, yeop: 20_000 } })));
    expect(flagged).toMatchObject({ mode: 'coop', status: 'flagged', rank: null });
  });

  it('idempotent resubmission keeps the board it was ranked on', async () => {
    const p = await register();
    const run = runBody({ coop: 2 });
    const first = await json<RunResponse>(await submit(p, run));
    const again = await json<RunResponse>(await submit(p, run));
    expect(again).toMatchObject({ id: first.id, mode: 'coop', duplicate: true, rank: first.rank });
  });
});

describe('cloud save /save', () => {
  const put = (token: string, body: BodyInit, ifMatch: string | null, ip?: string) =>
    call('/save', { method: 'PUT', token, body, ...(ip ? { ip } : {}), headers: { 'content-type': 'application/json', ...(ifMatch !== null ? { 'if-match': ifMatch } : {}) } });

  it('stores, versions and returns the blob with ETag revisions', async () => {
    const p = await register();
    const none = await call('/save', { token: p.token });
    expect(none.status).toBe(204); // "no cloud save yet" is a normal answer, not a 404 console error
    expect(await none.text()).toBe('');
    expect(none.headers.get('cache-control')).toBe('private, no-store');
    // a revision without its blob is a storage fault, not "no save": that stays a structured error
    const ghost = await register();
    await env.DB.prepare('UPDATE players SET save_rev = 3 WHERE id = ?1').bind(ghost.playerId).run();
    const missing = await call('/save', { token: ghost.token });
    expect(missing.status).toBe(404);
    expect((await errorOf(missing)).code).toBe('no_save');
    const blob = JSON.stringify({ version: 3, profile: { id: p.playerId, name: 'x' }, bank: { yeop: 12345 } });
    expect((await put(p.token, blob, null)).status).toBe(428);
    expect((await put(p.token, blob, 'abc')).status).toBe(400);

    const first = await put(p.token, blob, '0');
    expect(first.status).toBe(200);
    const meta = await json<SaveMeta>(first);
    expect(meta).toMatchObject({ rev: 1, size: new TextEncoder().encode(blob).byteLength });
    expect(first.headers.get('etag')).toBe('"1"');

    const got = await call('/save', { token: p.token });
    expect(got.status).toBe(200);
    expect(await got.text()).toBe(blob);
    expect(got.headers.get('etag')).toBe('"1"');
    expect(Number(got.headers.get('x-save-updated'))).toBe(meta.updatedAt);
    expect(got.headers.get('content-type')).toContain('application/json');

    const notModified = await call('/save', { token: p.token, headers: { 'if-none-match': '"1"' } });
    expect(notModified.status).toBe(304);

    const blob2 = JSON.stringify({ version: 3, bank: { yeop: 99 } });
    const second = await put(p.token, blob2, '"1"');
    const secondMeta = await json<SaveMeta>(second);
    expect(secondMeta.rev).toBe(2);
    expect(await (await call('/save', { token: p.token })).text()).toBe(blob2);
    const row = await env.DB.prepare('SELECT save_blob FROM players WHERE id = ?1').bind(p.playerId).first<{ save_blob: string }>();
    expect(row?.save_blob).toMatch(new RegExp(`^saves/${p.playerId}\\.r2\\.`));
    const stored = await env.BLOBS.get(row!.save_blob);
    expect(await stored?.text()).toBe(blob2);
    expect(stored?.customMetadata?.rev).toBe('2');
    // superseded rev-1 blob was cleaned up
    expect((await env.BLOBS.list({ prefix: `saves/${p.playerId}.` })).objects.map((o) => o.key)).toEqual([row!.save_blob]);
  });

  it('detects revision conflicts (If-Match)', async () => {
    const p = await register();
    const blob = JSON.stringify({ version: 1 });
    await put(p.token, blob, '0');
    await put(p.token, blob, '1');
    const stale = await put(p.token, blob, '1');
    expect(stale.status).toBe(412);
    const err = await errorOf(stale);
    expect(err.code).toBe('rev_conflict');
    expect(err.details).toEqual({ currentRev: 2 });
    // a first-upload attempt against an existing save also conflicts
    expect((await put(p.token, blob, '0')).status).toBe(412);
    // blob untouched by the failed writes
    const kept = await json<{ version: number }>(await call('/save', { token: p.token }));
    expect(kept.version).toBe(1);
  });

  it('lets exactly one of two concurrent writers win', async () => {
    const p = await register();
    await put(p.token, JSON.stringify({ version: 1, n: 0 }), '0');
    const results = await Promise.all([
      put(p.token, JSON.stringify({ version: 1, n: 1 }), '1'),
      put(p.token, JSON.stringify({ version: 1, n: 2 }), '1'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
  });

  it('prevents a delayed older upload from overwriting a newer published revision body', async () => {
    const p = await register();
    const bodyOld = JSON.stringify({ version: 3, tag: 'older-rev-1' });
    const bodyNew1 = JSON.stringify({ version: 3, tag: 'winner-rev-1' });
    const bodyNew2 = JSON.stringify({ version: 3, tag: 'newer-rev-2' });
    const directPut = (body: string, ifMatch: string) =>
      worker.fetch(
        new Request(`${BASE}/save`, {
          method: 'PUT',
          headers: { authorization: `Bearer ${p.token}`, 'cf-connecting-ip': freshIp(), 'content-type': 'application/json', 'if-match': ifMatch },
          body,
        }),
        env,
        createExecutionContext(),
      );
    const realPut = env.BLOBS.put.bind(env.BLOBS);
    let intercepted = false;
    const spy = vi.spyOn(env.BLOBS, 'put').mockImplementation((async (...args: Parameters<typeof realPut>) => {
      if (!intercepted) {
        intercepted = true;
        // While the older rev 0->1 upload is mid-flight, two newer uploads complete to rev 2.
        expect((await directPut(bodyNew1, '0')).status).toBe(200);
        expect((await directPut(bodyNew2, '1')).status).toBe(200);
      }
      return realPut(...args);
    }) as never);
    let delayedRes: Response;
    try {
      delayedRes = await directPut(bodyOld, '0');
    } finally {
      spy.mockRestore();
    }
    expect(delayedRes.status).toBe(412);
    // D1 revision and R2 blob body both still reflect rev 2 (never overwritten by bodyOld).
    const got = await call('/save', { token: p.token });
    expect(got.status).toBe(200);
    expect(got.headers.get('etag')).toBe('"2"');
    expect(await got.text()).toBe(bodyNew2);
    // Unreferenced blob from the failed delayed upload was cleaned up.
    expect((await env.BLOBS.list({ prefix: `saves/${p.playerId}.` })).objects).toHaveLength(1);
  });

  it('leaves D1 unchanged when R2 PUT fails so subsequent GET and PUT succeed cleanly (NET-02)', async () => {
    const p = await register();
    const initialBody = JSON.stringify({ version: 3, bank: { yeop: 111 } });
    expect((await put(p.token, initialBody, '0')).status).toBe(200);
    const beforeRow = await env.DB
      .prepare('SELECT save_rev, save_blob FROM players WHERE id = ?1')
      .bind(p.playerId)
      .first<{ save_rev: number; save_blob: string }>();
    expect(beforeRow?.save_rev).toBe(1);

    const spy = vi.spyOn(env.BLOBS, 'put').mockImplementationOnce((async () => {
      throw new Error('simulated R2 write outage');
    }) as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let failedRes: Response;
    try {
      failedRes = await worker.fetch(
        new Request(`${BASE}/save`, {
          method: 'PUT',
          headers: { authorization: `Bearer ${p.token}`, 'cf-connecting-ip': freshIp(), 'content-type': 'application/json', 'if-match': '"1"' },
          body: JSON.stringify({ version: 3, bank: { yeop: 222 } }),
        }),
        env,
        createExecutionContext(),
      );
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
    expect(failedRes.status).toBe(503);
    expect((await errorOf(failedRes)).code).toBe('unavailable');
    // D1 revision and blob pointer MUST NOT have advanced on R2 failure.
    const afterFailRow = await env.DB
      .prepare('SELECT save_rev, save_blob FROM players WHERE id = ?1')
      .bind(p.playerId)
      .first<{ save_rev: number; save_blob: string }>();
    expect(afterFailRow).toEqual(beforeRow);

    // Fresh GET returns rev 1 and original body; subsequent PUT with If-Match "1" advances to rev 2.
    const got = await call('/save', { token: p.token });
    expect(got.status).toBe(200);
    expect(got.headers.get('etag')).toBe('"1"');
    expect(await got.text()).toBe(initialBody);
    const retryBody = JSON.stringify({ version: 3, bank: { yeop: 333 } });
    const retry = await put(p.token, retryBody, got.headers.get('etag'));
    expect(retry.status).toBe(200);
    expect((await json<SaveMeta>(retry)).rev).toBe(2);
    expect(await (await call('/save', { token: p.token })).text()).toBe(retryBody);
  });

  it('recovers from pre-migration / stale R2 customMetadata.rev vs D1 save_rev so fresh GET -> PUT never strands with 412 (NET-02)', async () => {
    const p = await register();
    const legacyKey = `saves/${p.playerId}.json`;
    const legacyBody = JSON.stringify({ version: 3, bank: { yeop: 555 } });
    // Simulate a pre-migration diverged state: D1 save_rev=4 with empty save_blob, while legacy R2 blob carries stale rev=1 metadata.
    await env.BLOBS.put(legacyKey, legacyBody, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { rev: '1', updatedAt: '1000' },
    });
    await env.DB
      .prepare(`UPDATE players SET save_rev = 4, save_size = ?1, save_updated_at = 4000, save_blob = '' WHERE id = ?2`)
      .bind(legacyBody.length, p.playerId)
      .run();

    // Fresh GET MUST serve D1's committed revision ("4") as ETag, not the stale blob customMetadata.rev ("1").
    const got = await call('/save', { token: p.token });
    expect(got.status).toBe(200);
    expect(got.headers.get('etag')).toBe('"4"');
    expect(Number(got.headers.get('x-save-updated'))).toBe(4000);
    expect(await got.text()).toBe(legacyBody);

    // Next PUT using the fetched ETag succeeds cleanly, publishes rev 5 under an immutable blob key, and removes legacy key.
    const nextBody = JSON.stringify({ version: 3, bank: { yeop: 777 } });
    const saved = await put(p.token, nextBody, got.headers.get('etag'));
    expect(saved.status).toBe(200);
    expect(await json<SaveMeta>(saved)).toMatchObject({ rev: 5 });
    expect(saved.headers.get('etag')).toBe('"5"');
    expect(await env.BLOBS.head(legacyKey)).toBeNull();
    const gotAfter = await call('/save', { token: p.token });
    expect(gotAfter.status).toBe(200);
    expect(gotAfter.headers.get('etag')).toBe('"5"');
    expect(await gotAfter.text()).toBe(nextBody);
  });

  it('caps size at 256 KB and validates content', async () => {
    const p = await register();
    const edge = JSON.stringify({ version: 1, pad: 'x'.repeat(SAVE_MAX_BYTES - 40) });
    expect(new TextEncoder().encode(edge).byteLength).toBeLessThanOrEqual(SAVE_MAX_BYTES);
    expect((await put(p.token, edge, '0')).status).toBe(200);
    const over = JSON.stringify({ version: 1, pad: 'x'.repeat(SAVE_MAX_BYTES) });
    const res = await put(p.token, over, '1');
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('payload_too_large');
    // chunked upload without content-length is capped while streaming
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const chunk = new Uint8Array(64 * 1024).fill(0x20);
        for (let i = 0; i < 6; i++) c.enqueue(chunk);
        c.close();
      },
    });
    const streamed = await call('/save', { method: 'PUT', token: p.token, body: stream, headers: { 'content-type': 'application/json', 'if-match': '1' } });
    expect(streamed.status).toBe(413);
    for (const bad of ['not json', '[]', '"str"', '{"nover":1}', '{"version":"1"}', '']) {
      const r = await put(p.token, bad, '1');
      expect(r.status, bad).toBe(400);
    }
  });

  it('isolates saves per player and requires auth', async () => {
    const a = await register();
    const b = await register();
    await put(a.token, JSON.stringify({ version: 1, secret: 'a-data' }), '0');
    expect((await call('/save', { token: b.token })).status).toBe(204);
    expect((await call('/save')).status).toBe(401);
    expect((await put('bad.token', '{}', '0')).status).toBe(401);
  });

  it('rate-limits uploads per player', async () => {
    await insideOneMinute();
    const p = await register();
    let rev = 0;
    let limited = false;
    for (let i = 0; i < 14; i++) {
      const res = await put(p.token, JSON.stringify({ version: 1, i }), String(rev));
      if (res.status === 429) {
        limited = true;
        break;
      }
      expect(res.status).toBe(200);
      const saved = await json<SaveMeta>(res);
      rev = saved.rev;
    }
    expect(limited).toBe(true);
  });
});

// DELETE /players/me racing PUT /save (prod4 runtime-memory-net). Every interleaving is forced by running the other request
// NESTED inside a hook at the chosen step of the first one (a spy on the R2 / D1 call that sits at that step), so the outcome
// does not depend on scheduling. (Holding a request on a promise the test resolves from outside would be cancelled by the
// Workers runtime as hung.) The invariant in all of them: once both requests are done the player has no row of any kind - no
// blob in R2, no rate-counter row - and the old credential is dead.
describe('erasure racing an upload', () => {
  const blob = JSON.stringify({ version: 3, bank: { yeop: 4242 } });
  /** the Worker called directly with the test's (spied) bindings, in the caller's own async context */
  const direct = async (path: string, token: string, init: { method: string; ifMatch?: string }): Promise<Response> =>
    worker.fetch(
      new Request(`${BASE}${path}`, {
        method: init.method,
        headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': freshIp(), ...(init.ifMatch !== undefined ? { 'content-type': 'application/json', 'if-match': init.ifMatch } : {}) },
        ...(init.method === 'PUT' ? { body: blob } : {}),
      }),
      env,
      createExecutionContext(),
    );
  const upload = (token: string, ifMatch = '0') => direct('/save', token, { method: 'PUT', ifMatch });
  const erase = (token: string) => direct('/players/me', token, { method: 'DELETE' });
  const ownRows = async (playerId: string): Promise<Record<string, number>> => {
    const n = async (sql: string, ...args: string[]): Promise<number> => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? -1;
    const blobs = (await env.BLOBS.list({ prefix: `saves/${playerId}.` })).objects.length;
    return {
      players: await n('SELECT COUNT(*) AS n FROM players WHERE id = ?1', playerId),
      credentials: await n('SELECT COUNT(*) AS n FROM credentials WHERE player_id = ?1', playerId),
      counters: await n('SELECT COUNT(*) AS n FROM rate_counters WHERE instr(key, ?1) > 0', `:p:${playerId}`),
      blob: blobs > 0 ? 1 : 0,
    };
  };
  const gone = { players: 0, credentials: 0, counters: 0, blob: 0 };

  it('the DELETE finishes between the PUT\'s revision swap and its blob write: the late blob is removed, the PUT is told 401', async () => {
    const p = await register();
    const realPut = env.BLOBS.put.bind(env.BLOBS);
    let erased = 0;
    const spy = vi.spyOn(env.BLOBS, 'put').mockImplementation((async (...args: Parameters<typeof realPut>) => {
      // the blob is about to be written: the whole erasure runs now
      erased = (await erase(p.token)).status;
      expect(await ownRows(p.playerId)).toEqual(gone);
      return realPut(...args);
    }) as never);
    let res: Response;
    try {
      res = await upload(p.token);
    } finally {
      spy.mockRestore();
    }
    expect(erased).toBe(204);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
    expect(await ownRows(p.playerId)).toEqual(gone); // the old code left saves/<id>.json here
    expect((await call('/save', { token: p.token })).status).toBe(401);
  });

  it('the DELETE\'s blob delete runs before the PUT\'s write and its row delete after the PUT\'s check: the second delete removes the blob', async () => {
    const p = await register();
    const realDelete = env.BLOBS.delete.bind(env.BLOBS);
    let deletes = 0;
    let nested = 0;
    const spy = vi.spyOn(env.BLOBS, 'delete').mockImplementation((async (keys: string | string[]) => {
      deletes += 1;
      await realDelete(keys);
      if (deletes === 1) {
        // the erasure's first delete is done (there was nothing to remove): now the upload runs to its end and sees the player still there
        const res = await upload(p.token);
        nested = res.status;
        expect((await env.BLOBS.list({ prefix: `saves/${p.playerId}.` })).objects.length).toBeGreaterThan(0);
      }
    }) as never);
    let status = 0;
    try {
      status = (await erase(p.token)).status;
    } finally {
      spy.mockRestore();
    }
    expect(status).toBe(204);
    expect(nested).toBe(200); // the upload won: it was acknowledged ...
    expect(deletes).toBe(2);
    expect(await ownRows(p.playerId)).toEqual(gone); // ... and then erased: the first-delete-only code left its blob here
  });

  it('the DELETE finishes after the PUT authenticated but before its swap: the swap finds no row, 401 (not a revision conflict), no counter row is left', async () => {
    const p = await register();
    const realPrepare = env.DB.prepare.bind(env.DB);
    let erased = 0;
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation(((sql: string) => {
      const statement = realPrepare(sql);
      if (!sql.startsWith('UPDATE players SET save_rev = ?1, save_size')) return statement;
      return {
        bind: (...args: unknown[]) => {
          const bound = statement.bind(...args);
          return {
            first: async (...rest: unknown[]) => {
              erased = (await erase(p.token)).status; // authenticated and counted (enforce) already, swap still to come
              return (bound.first as (...a: unknown[]) => Promise<unknown>)(...rest);
            },
          };
        },
      };
    }) as never);
    let res: Response;
    try {
      res = await upload(p.token);
    } finally {
      spy.mockRestore();
    }
    expect(erased).toBe(204);
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthorized');
    expect(await ownRows(p.playerId)).toEqual(gone); // the PUT's own enforce() rows ran before the DELETE's batch ... and its second one after
  });

  it('an upload that finishes before the DELETE is simply erased by it', async () => {
    const p = await register();
    expect((await upload(p.token)).status).toBe(200);
    expect((await env.BLOBS.list({ prefix: `saves/${p.playerId}.` })).objects.length).toBeGreaterThan(0);
    expect((await erase(p.token)).status).toBe(204);
    expect(await ownRows(p.playerId)).toEqual(gone);
  });

  it('a failing second blob delete does not turn a finished erasure into an error', async () => {
    const p = await register();
    expect((await upload(p.token)).status).toBe(200);
    const realDelete = env.BLOBS.delete.bind(env.BLOBS);
    let calls = 0;
    const spy = vi.spyOn(env.BLOBS, 'delete').mockImplementation((async (keys: string | string[]) => {
      calls += 1;
      if (calls === 2) throw new Error('R2 down');
      return realDelete(keys);
    }) as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await erase(p.token)).status).toBe(204);
      expect(calls).toBe(2);
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
    expect((await ownRows(p.playerId)).players).toBe(0);
  });

  it('a failing FIRST blob delete still refuses the erasure and keeps everything (retryable)', async () => {
    const p = await register();
    expect((await upload(p.token)).status).toBe(200);
    const spy = vi.spyOn(env.BLOBS, 'delete').mockImplementation((async () => {
      throw new Error('R2 down');
    }) as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await erase(p.token);
      expect(res.status).toBe(503);
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
    const rows = await ownRows(p.playerId);
    expect(rows.players).toBe(1);
    expect(rows.blob).toBe(1);
    expect((await erase(p.token)).status).toBe(204); // the retry works
    expect(await ownRows(p.playerId)).toEqual(gone);
  });
});

describe('orphan save sweep (safety net of the erasure)', () => {
  const addPlayer = (id: string) => env.DB.prepare('INSERT INTO players (id, name, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)').bind(id, `Sweep ${id}`, Date.now());
  const blobOf = (id: string) => env.BLOBS.put(`saves/${id}.json`, '{"version":1}', { httpMetadata: { contentType: 'application/json' } });
  const later = Date.now() + 2 * 3_600_000; // past the one-hour grace of a freshly written blob

  it('removes blobs whose player is gone, keeps the living players\' blobs and foreign keys, across D1 chunks', async () => {
    const live = Array.from({ length: 100 }, (_, i) => `sweep-live-${String(i).padStart(4, '0')}`);
    const orphans = Array.from({ length: 100 }, (_, i) => `sweep-orphan-${String(i).padStart(3, '0')}`);
    await env.DB.batch(live.map(addPlayer));
    await Promise.all([...live, ...orphans].map(blobOf));
    await env.BLOBS.put('saves/nested/sweep-not-a-save.json', 'x');
    await env.BLOBS.put('saves/sweep-no-extension', 'x');
    const removed = await sweepOrphanSaves(env, later);
    expect(removed).toBeGreaterThanOrEqual(100);
    for (const id of orphans) expect(await env.BLOBS.head(`saves/${id}.json`), id).toBeNull();
    for (const id of live) expect(await env.BLOBS.head(`saves/${id}.json`), id).not.toBeNull();
    expect(await env.BLOBS.head('saves/nested/sweep-not-a-save.json')).not.toBeNull();
    expect(await env.BLOBS.head('saves/sweep-no-extension')).not.toBeNull();
    expect(await sweepOrphanSaves(env, later)).toBe(0); // idempotent
  });

  it('never touches a blob younger than the grace period, and housekeeping runs the sweep', async () => {
    await blobOf('sweep-young-orphan');
    expect(await sweepOrphanSaves(env, Date.now())).toBe(0);
    expect(await env.BLOBS.head('saves/sweep-young-orphan.json')).not.toBeNull();
    const result = await housekeeping(env, later);
    expect(result.orphanSaves).toBeGreaterThanOrEqual(1);
    expect(await env.BLOBS.head('saves/sweep-young-orphan.json')).toBeNull();
  });

  it('a failing R2 listing does not fail the rest of the housekeeping', async () => {
    const spy = vi.spyOn(env.BLOBS, 'list').mockImplementation((async () => {
      throw new Error('R2 down');
    }) as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await housekeeping(env, later);
      expect(result.orphanSaves).toBe(0);
      expect(result.counters).toBeGreaterThanOrEqual(0);
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });

  it('persists the R2 listing cursor across sweeps so objects past the per-run cap are reached', async () => {
    // Seed 3 live players early in lexicographic order and 3 orphans later in order.
    const live = ['cursor-a-live-1', 'cursor-a-live-2', 'cursor-a-live-3'];
    const orphans = ['cursor-z-orphan-1', 'cursor-z-orphan-2', 'cursor-z-orphan-3'];
    await env.DB.batch(live.map(addPlayer));
    await Promise.all([...live, ...orphans].map(blobOf));
    // Clear any leftover cursor first, then sweep with max=2 per invocation until the cursor resets.
    await env.DB.prepare(`DELETE FROM cron_state WHERE key = 'orphan_save_cursor'`).run();
    let totalRemoved = 0;
    let passes = 0;
    while (passes < 200) {
      passes++;
      totalRemoved += await sweepOrphanSaves(env, later, 2);
      const saved = await env.DB.prepare(`SELECT value FROM cron_state WHERE key = 'orphan_save_cursor'`).first<{ value: string }>();
      if (!saved) break;
    }
    expect(passes).toBeGreaterThan(1);
    expect(totalRemoved).toBeGreaterThanOrEqual(orphans.length);
    for (const id of orphans) expect(await env.BLOBS.head(`saves/${id}.json`), id).toBeNull();
    for (const id of live) expect(await env.BLOBS.head(`saves/${id}.json`), id).not.toBeNull();
  });
});

describe('device transfer', () => {
  it('moves a profile: single use, new credential, donor stays valid, save follows', async () => {
    const donor = await register('Donor One');
    const blob = JSON.stringify({ version: 1, gold: 5 });
    await call('/save', { method: 'PUT', token: donor.token, body: blob, headers: { 'content-type': 'application/json', 'if-match': '0' } });

    const created = await call('/transfer', { method: 'POST', token: donor.token });
    expect(created.status).toBe(201);
    const code = (await created.json()) as TransferCreateResponse;
    expect(code.code).toHaveLength(8);
    expect([...code.code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(code.ttlSec).toBe(900);
    expect(code.expiresAt).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(code.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1000);
    // only a hash of the code is stored
    const rows = await env.DB.prepare('SELECT code_hash FROM transfer_codes WHERE player_id = ?1').bind(donor.playerId).all<{ code_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.code_hash).not.toContain(code.code);

    // the claiming device has no credentials; formatting is forgiving
    const display = `${code.code.slice(0, 4).toLowerCase()}-${code.code.slice(4)}`;
    const claimed = await call('/transfer/claim', { json: { code: display } });
    expect(claimed.status).toBe(200);
    const cred = (await claimed.json()) as TransferClaimResponse;
    expect(cred).toMatchObject({ playerId: donor.playerId, name: 'Donor One' });
    expect(cred.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(cred.secret).not.toBe(donor.secret);

    const newToken = `${cred.playerId}.${cred.secret}`;
    expect(await (await call('/save', { token: newToken })).text()).toBe(blob);
    expect((await call('/save', { token: donor.token })).status).toBe(200);

    // single use
    const again = await call('/transfer/claim', { json: { code: code.code } });
    expect(again.status).toBe(400);
    expect((await errorOf(again)).code).toBe('invalid_code');
  });

  it('expires codes after 15 minutes', async () => {
    const donor = await register();
    const code = (await (await call('/transfer', { method: 'POST', token: donor.token })).json()) as TransferCreateResponse;
    await env.DB.prepare('UPDATE transfer_codes SET expires_at = ?1 WHERE player_id = ?2').bind(Date.now() - 1, donor.playerId).run();
    const res = await call('/transfer/claim', { json: { code: code.code } });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('invalid_code');
  });

  it('a new code replaces the previous one', async () => {
    const donor = await register();
    const first = (await (await call('/transfer', { method: 'POST', token: donor.token })).json()) as TransferCreateResponse;
    const second = (await (await call('/transfer', { method: 'POST', token: donor.token })).json()) as TransferCreateResponse;
    expect(second.code).not.toBe(first.code);
    expect((await call('/transfer/claim', { json: { code: first.code } })).status).toBe(400);
    expect((await call('/transfer/claim', { json: { code: second.code } })).status).toBe(200);
  });

  it('validates claims and requires auth to mint', async () => {
    expect((await call('/transfer', { method: 'POST' })).status).toBe(401);
    for (const code of ['', 'short', 'ABCDEFG0', 'toolongcodevalue!!', 12]) {
      const res = await call('/transfer/claim', { json: { code } });
      expect(res.status, String(code)).toBe(400);
      expect((await errorOf(res)).code).toBe('validation');
    }
    const unknown = await call('/transfer/claim', { json: { code: 'ZZZZZZZZ' } });
    expect(unknown.status).toBe(400);
    expect((await errorOf(unknown)).code).toBe('invalid_code');
  });

  it('rate-limits claim attempts per IP', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      expect((await call('/transfer/claim', { ip, json: { code: 'ZZZZZZZZ' } })).status).toBe(400);
    }
    const res = await call('/transfer/claim', { ip, json: { code: 'ZZZZZZZZ' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('rate-limits minting per player and caps stored credentials at 8', async () => {
    const donor = await register();
    for (let i = 0; i < 6; i++) {
      const res = await call('/transfer', { method: 'POST', token: donor.token });
      expect(res.status).toBe(201);
    }
    expect((await call('/transfer', { method: 'POST', token: donor.token })).status).toBe(429);

    const p = await register();
    let token = p.token;
    for (let i = 0; i < 10; i++) {
      const { code } = await json<TransferCreateResponse>(await call('/transfer', { method: 'POST', token }));
      const claimed = await call('/transfer/claim', { json: { code } });
      expect(claimed.status, `claim ${i}`).toBe(200);
      const cred = await json<TransferClaimResponse>(claimed);
      token = `${cred.playerId}.${cred.secret}`;
      // minting is limited to 6/hour per player; reset the counter so the loop can reach the credential cap
      await env.DB.prepare(`DELETE FROM rate_counters WHERE key LIKE 'xfer_h:%'`).run();
    }
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE player_id = ?1').bind(p.playerId).first<{ n: number }>();
    expect(n?.n).toBe(8);
    // the original (oldest) credential was evicted, the newest still works
    expect((await call('/save', { token: p.token })).status).toBe(401);
    expect((await call('/save', { token })).status).toBe(204);
  });
});

describe('co-op HTTP surface', () => {
  it('allocates 6-char room codes for authenticated players', async () => {
    const p = await register();
    expect((await call('/coop', { method: 'POST' })).status).toBe(401);
    const res = await call('/coop', { method: 'POST', token: p.token });
    expect(res.status).toBe(201);
    const { room } = await json<CoopCreateResponse>(res);
    expect(room).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
  });

  it('requires a WebSocket upgrade, a valid code and credentials', async () => {
    const p = await register();
    const plain = await call('/coop/ABC234', { token: p.token });
    expect(plain.status).toBe(426);
    expect((await errorOf(plain)).code).toBe('upgrade_required');
    const badCode = await call('/coop/xx', { token: p.token, headers: { upgrade: 'websocket' } });
    expect(badCode.status).toBe(404);
    const noAuth = await call('/coop/ABC234', { headers: { upgrade: 'websocket' } });
    expect(noAuth.status).toBe(401);
    const unknown = await call('/coop/ABC234', { token: p.token, headers: { upgrade: 'websocket' } });
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe('room_not_found');
    const evil = await call('/coop/ABC234', { token: p.token, headers: { upgrade: 'websocket', origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
  });

  it('pauses room allocation and WebSocket upgrades with 503 when COOP_ENABLED is 0', async () => {
    const p = await register();
    const pausedEnv = { ...env, COOP_ENABLED: '0' } as unknown as typeof env;
    const createRes = await worker.fetch(
      new Request(`${BASE}/coop`, { method: 'POST', headers: { Authorization: `Bearer ${p.token}` } }),
      pausedEnv,
      createExecutionContext(),
    );
    expect(createRes.status).toBe(503);
    expect(createRes.headers.get('Retry-After')).toBe('300');
    const wsRes = await worker.fetch(
      new Request(`${BASE}/coop/ABC234`, { headers: { Authorization: `Bearer ${p.token}`, upgrade: 'websocket' } }),
      pausedEnv,
      createExecutionContext(),
    );
    expect(wsRes.status).toBe(503);
  });
});

describe('misc', () => {
  it('uid helper yields distinct run ids', () => {
    expect(uid()).not.toBe(uid());
  });
});
