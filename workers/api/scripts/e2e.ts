// End-to-end smoke test against `wrangler dev --local` (real workerd, local D1/R2/Durable Objects).
//   bun scripts/e2e.ts            # spawns wrangler itself on a free local port with a throw-away state dir
//   API_URL=http://127.0.0.1:18686 bun scripts/e2e.ts   # or target an already running dev server (no spawn)
//   API_URL=http://127.0.0.1:18788 E2E_ORIGIN=http://127.0.0.1:18788 bun scripts/e2e.ts
//                                 # …or the built client's origin under `wrangler pages dev` (through the /api proxy)
// Never point it at production: it registers players, submits runs and trips the per-IP registration limit.
// Flow: register → submit run → leaderboard → save put/get/conflict → transfer → two WebSocket clients in a room →
// registration rate limit → erasure (DELETE /players/me).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import {
  COOP_SUBPROTOCOL,
  SnapshotFlags,
  computeScore,
  encodeSnapshot,
  readSnapshotHeader,
  type CoopCreateResponse,
  type LeaderboardResponse,
  type RegisterResponse,
  type RunResponse,
  type SaveMeta,
  type ServerMessage,
  type TransferClaimResponse,
  type TransferCreateResponse,
} from '@ms/shared';
import { RULES } from '../src/limits';

const root = path.resolve(import.meta.dirname, '..');
const external = process.env.API_URL;

/** Ask the OS for a free port (fixed ports such as 8787 can fall inside Windows' excluded ranges). */
async function freePort(): Promise<number> {
  const srv = createServer();
  const { promise, resolve } = Promise.withResolvers<void>();
  srv.listen(0, '127.0.0.1', resolve);
  await promise;
  const address = srv.address();
  const chosen = typeof address === 'object' && address ? address.port : 0;
  const closed = Promise.withResolvers<void>();
  srv.close(() => closed.resolve());
  await closed.promise;
  return chosen;
}

const port = external ? 0 : Number(process.env.E2E_PORT ?? (await freePort()));
const base = (external ?? `http://127.0.0.1:${port}`).replace(/\/$/, '');
const api = `${base}/api/v1`;
const stateDir = path.join(root, '.wrangler', 'e2e-state');
const ORIGIN = process.env.E2E_ORIGIN ?? 'http://localhost:5173';
/** Production allows the Pages origins only (wrangler.toml); dev servers add localhost on any port (as `bun run dev`). */
const DEV_ALLOWED_ORIGINS = 'https://metin-survivors.com,https://www.metin-survivors.com,https://metin-survivors.pages.dev,https://*.metin-survivors.pages.dev,http://localhost:*,http://127.0.0.1:*';

let steps = 0;
function ok(label: string, detail?: unknown): void {
  steps += 1;
  console.log(`  ✓ ${String(steps).padStart(2, '0')} ${label}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
function check(cond: unknown, label: string, detail?: unknown): asserts cond {
  if (!cond) throw new Error(`FAILED: ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

async function http<T>(method: string, route: string, opts: { token?: string; json?: unknown; body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: T; res: Response }> {
  const headers: Record<string, string> = { origin: ORIGIN, ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`${api}${route}`, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // raw body (e.g. /save)
  }
  return { status: res.status, body: parsed as T, res };
}

// ---------------------------------------------------------------------------
// dev server lifecycle

let server: ChildProcess | null = null;

function wrangler(args: string[]): ChildProcess {
  return spawn('bunx', ['wrangler', ...args], { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function startServer(): Promise<void> {
  if (external) return;
  rmSync(stateDir, { recursive: true, force: true });
  const migrate = spawnSync('bunx', ['wrangler', 'd1', 'migrations', 'apply', 'metin-survivors-db', '--local', '--persist-to', stateDir], { cwd: root, shell: true, encoding: 'utf8' });
  check(migrate.status === 0, 'd1 migrations apply --local', migrate.stdout + migrate.stderr);
  ok('applied D1 migrations (local)');
  server = wrangler(['dev', '--local', '--port', String(port), '--persist-to', stateDir, '--ip', '127.0.0.1', '--var', `"ALLOWED_ORIGINS:${DEV_ALLOWED_ORIGINS}"`]);
  let log = '';
  server.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  server.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${api}/health`);
      if (r.status === 200) {
        ok(`wrangler dev --local is up on :${port}`);
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not become ready:\n${log}`);
}

function stopServer(): void {
  if (!server?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
}

// ---------------------------------------------------------------------------
// WebSocket client

class Peer {
  readonly inbox: (ServerMessage | { binary: ArrayBuffer })[] = [];
  private waiters: (() => void)[] = [];
  closed: { code: number; reason: string } | null = null;
  private constructor(readonly ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => {
      this.inbox.push(typeof ev.data === 'string' ? (JSON.parse(ev.data) as ServerMessage) : { binary: ev.data as ArrayBuffer });
      this.wake();
    };
    ws.onclose = (ev) => {
      this.closed = { code: ev.code, reason: ev.reason };
      this.wake();
    };
  }
  static async connect(room: string, token: string): Promise<Peer> {
    const wsUrl = `${base.replace(/^http/, 'ws')}/api/v1/coop/${room}`;
    const ws = new WebSocket(wsUrl, [COOP_SUBPROTOCOL, `auth.${token}`]);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('websocket error'));
    await promise;
    check(ws.protocol === COOP_SUBPROTOCOL, 'server selected the relay subprotocol only', ws.protocol);
    return new Peer(ws);
  }
  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }
  async wait<T>(pick: () => T | undefined): Promise<T> {
    for (;;) {
      const v = pick();
      if (v !== undefined) return v;
      const { promise, resolve } = Promise.withResolvers<void>();
      this.waiters.push(resolve);
      await Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out waiting for a websocket message')), 10_000))]);
    }
  }
  next<T extends ServerMessage['t']>(type: T, where?: (m: Extract<ServerMessage, { t: T }>) => boolean): Promise<Extract<ServerMessage, { t: T }>> {
    return this.wait(() => {
      const i = this.inbox.findIndex((m) => 't' in m && m.t === type && (!where || where(m as Extract<ServerMessage, { t: T }>)));
      return i < 0 ? undefined : (this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>);
    });
  }
  nextBinary(): Promise<ArrayBuffer> {
    return this.wait(() => {
      const i = this.inbox.findIndex((m) => 'binary' in m);
      return i < 0 ? undefined : (this.inbox.splice(i, 1)[0] as { binary: ArrayBuffer }).binary;
    });
  }
  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Metin Survivors API e2e smoke → ${api}`);
  await startServer();

  // health + CORS
  const health = await http<{ ok: boolean; db: boolean; blobs: boolean }>('GET', '/health');
  check(health.status === 200 && health.body.ok, 'health ok', health.body);
  ok('GET /health', health.body);
  const evil = await http<{ error: { code: string } }>('GET', '/health', { headers: { origin: 'https://evil.example' } });
  check(evil.status === 403 && evil.body.error.code === 'origin_not_allowed', 'CORS blocks foreign origins', evil.body);
  ok(`CORS: foreign origin rejected, ${ORIGIN} allowed`);

  // register two players
  const a = await http<RegisterResponse>('POST', '/players', { json: { name: 'Çağatay' } });
  check(a.status === 201 && a.body.playerId.length === 16 && a.body.secret.length === 32, 'register A', a.body);
  const b = await http<RegisterResponse>('POST', '/players', { json: { name: 'Mavi Kurt' } });
  check(b.status === 201, 'register B', b.body);
  const tokA = `${a.body.playerId}.${a.body.secret}`;
  const tokB = `${b.body.playerId}.${b.body.secret}`;
  ok('POST /players ×2', { A: a.body.name, B: b.body.name });
  const bad = await http<{ error: { code: string } }>('POST', '/players', { json: { name: 'siktir' } });
  check(bad.status === 422 && bad.body.error.code === 'name_rejected', 'profanity filter', bad.body);
  ok('display-name filter rejects profanity (422 name_rejected)');
  const unauth = await http<{ error: { code: string } }>('GET', '/save', { token: `${a.body.playerId}.${'x'.repeat(32)}` });
  check(unauth.status === 401, 'wrong secret → 401', unauth.body);
  ok('wrong secret → 401');
  const renamed = await http<{ name: string }>('PATCH', '/players/me', { token: tokA, json: { name: 'Çağatay Han' } });
  check(renamed.status === 200 && renamed.body.name === 'Çağatay Han', 'rename', renamed.body);
  ok('PATCH /players/me');

  // runs + leaderboard
  const now = Date.now();
  const statsA = { kills: 3200, elites: 60, bosses: 4, metins: 11, level: 47, yeop: 52_000 };
  const statsB = { kills: 4100, elites: 75, bosses: 5, metins: 13, level: 52, yeop: 70_000 };
  const runA = { runId: `e2e-${now}-a`, clientVersion: '1.0.0', zone: 'yeonmu', difficulty: 'normal', classId: 'warrior', doctrine: 'a', empire: 'saehwa', sex: 'm', seed: 1234, victory: false, duration: 780, endedAt: now - 5_000, stats: statsA };
  const runB = { ...runA, runId: `e2e-${now}-b`, classId: 'ninja', seed: 99, victory: true, duration: 905, stats: statsB };
  const ra = await http<RunResponse>('POST', '/runs', { token: tokA, json: runA });
  check(ra.status === 201 && ra.body.status === 'ok', 'run A accepted', ra.body);
  const expectedA = computeScore(statsA, { victory: false, duration: 780, difficulty: 'normal' });
  check(ra.body.score === expectedA, 'server recomputed score', { got: ra.body.score, expectedA });
  ok('POST /runs (A)', { score: ra.body.score, rank: ra.body.rank, best: ra.body.best });
  const rb = await http<RunResponse>('POST', '/runs', { token: tokB, json: runB });
  check(rb.status === 201 && rb.body.rank === 1, 'run B ranks first', rb.body);
  ok('POST /runs (B, victory)', { score: rb.body.score, rank: rb.body.rank });
  const dup = await http<RunResponse>('POST', '/runs', { token: tokA, json: runA });
  check(dup.status === 200 && dup.body.duplicate && dup.body.id === ra.body.id, 'idempotent resubmit', dup.body);
  ok('resubmitting the same runId is idempotent');
  const cheat = await http<{ error: { code: string; details: { reasons: string[] } } }>('POST', '/runs', {
    token: tokA,
    json: { ...runA, runId: `e2e-${now}-cheat`, endedAt: now - 3_000_000, stats: { ...statsA, kills: 500_000, level: 900 } },
  });
  check(cheat.status === 422 && cheat.body.error.code === 'implausible_run', 'cheat rejected', cheat.body);
  ok('implausible run rejected (422)', cheat.body.error.details.reasons);

  const lb = await http<LeaderboardResponse>('GET', '/leaderboard?zone=yeonmu&difficulty=normal&period=all&limit=10', { token: tokA });
  check(lb.status === 200 && lb.body.entries.length === 2, 'leaderboard has two entries', lb.body);
  check(lb.body.entries[0]?.score === rb.body.score && lb.body.entries[1]?.you === true && lb.body.you?.rank === 2, 'ordering + caller rank', lb.body);
  ok('GET /leaderboard', lb.body.entries.map((e) => `#${e.rank} ${e.name} ${e.score}${e.you ? ' (you)' : ''}`));
  const wk = await http<LeaderboardResponse>('GET', '/leaderboard?zone=yeonmu&period=week&class=ninja', { token: tokB });
  check(wk.body.entries.length === 1 && wk.body.you?.rank === 1, 'weekly + class filter', wk.body);
  ok('GET /leaderboard?period=week&class=ninja', { total: wk.body.total, weekStart: new Date(wk.body.weekStart ?? 0).toISOString() });

  // co-op board: a party-of-2 run ranks on mode=coop only
  const duoRun = { ...runA, runId: `e2e-${now}-duo`, coop: 2, seed: 7, endedAt: now - 2_000_000, stats: { ...statsB, kills: 4300 } };
  const rc = await http<RunResponse>('POST', '/runs', { token: tokB, json: duoRun });
  check(rc.status === 201 && rc.body.mode === 'coop' && rc.body.rank === 1, 'co-op run ranks on the co-op board', rc.body);
  const soloBoard = await http<LeaderboardResponse>('GET', '/leaderboard?zone=yeonmu&difficulty=normal', { token: tokB });
  check(soloBoard.body.entries.length === 2 && soloBoard.body.entries.every((e) => e.party === 1), 'solo board excludes co-op runs', soloBoard.body.entries);
  const coopBoard = await http<LeaderboardResponse>('GET', '/leaderboard?zone=yeonmu&difficulty=normal&mode=coop', { token: tokB });
  check(coopBoard.body.mode === 'coop' && coopBoard.body.entries.length === 1 && coopBoard.body.entries[0]?.party === 2 && coopBoard.body.you?.rank === 1, 'co-op board', coopBoard.body);
  ok('co-op boards: coop=2 run → mode=coop rank 1; solo board unchanged', { solo: soloBoard.body.entries.length, coop: coopBoard.body.entries.length });
  const badParty = await http<{ error: { code: string } }>('POST', '/runs', { token: tokB, json: { ...duoRun, runId: `e2e-${now}-p9`, coop: 9 } });
  check(badParty.status === 400 && badParty.body.error.code === 'validation', 'party size validated', badParty.body);

  // cloud save
  const none = await http<unknown>('GET', '/save', { token: tokA });
  check(none.status === 204, 'no save yet is 204 No Content, not an error', none.body);
  const blob = JSON.stringify({ version: 1, profile: { id: a.body.playerId, name: 'Çağatay Han' }, bank: { yeop: 4242 } });
  const noMatch = await http<unknown>('PUT', '/save', { token: tokA, body: blob, headers: { 'content-type': 'application/json' } });
  check(noMatch.status === 428, 'If-Match required', noMatch.body);
  const put1 = await http<SaveMeta>('PUT', '/save', { token: tokA, body: blob, headers: { 'content-type': 'application/json', 'if-match': '"0"' } });
  check(put1.status === 200 && put1.body.rev === 1, 'first PUT', put1.body);
  const got = await http<unknown>('GET', '/save', { token: tokA });
  check(got.status === 200 && got.res.headers.get('etag') === '"1"' && JSON.stringify(got.body) === blob, 'GET returns the blob + ETag', got.res.headers.get('etag'));
  const put2 = await http<SaveMeta>('PUT', '/save', { token: tokA, body: blob, headers: { 'content-type': 'application/json', 'if-match': '1' } });
  check(put2.status === 200 && put2.body.rev === 2, 'second PUT', put2.body);
  const conflict = await http<{ error: { code: string; details: { currentRev: number } } }>('PUT', '/save', { token: tokA, body: blob, headers: { 'content-type': 'application/json', 'if-match': '1' } });
  check(conflict.status === 412 && conflict.body.error.code === 'rev_conflict' && conflict.body.error.details.currentRev === 2, 'stale rev → 412', conflict.body);
  ok('PUT/GET /save: rev 0→1→2, stale If-Match → 412 rev_conflict (currentRev 2)');
  const big = await http<{ error: { code: string } }>('PUT', '/save', { token: tokA, body: JSON.stringify({ version: 1, pad: 'x'.repeat(300_000) }), headers: { 'content-type': 'application/json', 'if-match': '2' } });
  check(big.status === 413, 'save size cap', big.body);
  ok('save > 256 KB → 413');

  // transfer
  const code = await http<TransferCreateResponse>('POST', '/transfer', { token: tokA });
  check(code.status === 201 && code.body.code.length === 8, 'transfer code', code.body);
  const claim = await http<TransferClaimResponse>('POST', '/transfer/claim', { json: { code: code.body.code } });
  check(claim.status === 200 && claim.body.playerId === a.body.playerId, 'claim', claim.body);
  const tokA2 = `${claim.body.playerId}.${claim.body.secret}`;
  const viaNew = await http<unknown>('GET', '/save', { token: tokA2 });
  check(viaNew.status === 200 && JSON.stringify(viaNew.body) === blob, 'new device reads the same save', viaNew.status);
  const reuse = await http<{ error: { code: string } }>('POST', '/transfer/claim', { json: { code: code.body.code } });
  check(reuse.status === 400 && reuse.body.error.code === 'invalid_code', 'code is single use', reuse.body);
  ok('transfer: mint 8-char code → claim → new credential works, code single-use', { code: `${code.body.code.slice(0, 4)}-${code.body.code.slice(4)}`, ttlSec: code.body.ttlSec });

  // co-op: two WebSocket clients exchange messages
  const room = await http<CoopCreateResponse>('POST', '/coop', { token: tokA });
  check(room.status === 201 && /^[2-9A-HJKMNP-Z]{6}$/.test(room.body.room), 'room created', room.body);
  const host = await Peer.connect(room.body.room, tokA);
  const hostHello = await host.next('hello');
  check(hostHello.slot === 0 && hostHello.host === 0, 'host seated in slot 0', hostHello);
  const guest = await Peer.connect(room.body.room, tokB);
  const guestHello = await guest.next('hello');
  check(guestHello.slot === 1 && guestHello.players.length === 2, 'guest seated in slot 1', guestHello);
  const joined = await host.next('roomState', (m) => m.players.length === 2);
  check(joined.players[1]?.name === 'Mavi Kurt', 'host sees the guest', joined.players);
  ok(`co-op room ${room.body.room}: host slot 0 + guest slot 1 connected`);

  const loadout = { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 1 };
  host.send({ t: 'join', loadout });
  guest.send({ t: 'join', loadout: { ...loadout, classId: 'ninja', doctrine: 'b' }, ready: true });
  await host.next('roomState', (m) => m.players[1]?.ready === true && m.players[0]?.loadout !== null);
  host.send({ t: 'start', zone: 'yeonmu', difficulty: 'normal', seed: 4242 });
  const start = await guest.next('start');
  check(start.seed === 4242 && start.slots.length === 2, 'start broadcast', start);
  await host.next('start');
  ok('lobby → start (seed 4242)');

  guest.send({ t: 'input', seq: 1, tick: 10, mx: 100, mz: -50, aim: 64, btn: 1 });
  const inp = await host.next('input');
  check(inp.slot === 1 && inp.mx === 100 && inp.mz === -50, 'input relayed to host with slot', inp);
  host.send({ t: 'event', k: 'levelUp', tick: 11, d: { level: 2, cards: [3, 7, 9] } });
  const ev = await guest.next('event');
  check(ev.from === 0 && ev.k === 'levelUp', 'event relayed to guest', ev);
  guest.send({ t: 'pick', id: 1, index: 2 });
  const pick = await host.next('pick');
  check(pick.slot === 1 && pick.index === 2, 'pick relayed to host', pick);
  const snapshot = encodeSnapshot({ flags: SnapshotFlags.keyframe, seq: 1, tick: 12, epoch: 1, baseDelta: 0 }, new Uint8Array(512).map((_, i) => i & 255));
  host.ws.send(snapshot);
  const snap = await guest.nextBinary();
  check(snap.byteLength === snapshot.byteLength && readSnapshotHeader(snap)?.tick === 12, 'binary snapshot relayed intact', readSnapshotHeader(snap));
  ok('relay: input→host, event→guest, pick→host, binary snapshot→guest (528 B)');

  host.ws.close(1000, 'bye');
  const migrated = await guest.next('roomState', (m) => m.cause?.kind === 'hostChanged');
  check(migrated.host === 1 && migrated.epoch === 2, 'host migrated to the guest', migrated);
  ok('host left → host migrated to slot 1 (epoch 2)');
  guest.ws.close(1000, 'bye');

  // erasure on request: the player, its credentials, runs, board rows and the cloud save disappear
  const erase = await http<unknown>('DELETE', '/players/me', { token: tokA2 });
  check(erase.status === 204, 'DELETE /players/me', erase.body);
  const gone = await http<{ error: { code: string } }>('GET', '/save', { token: tokA });
  check(gone.status === 401, 'erased player credentials are dead (every device)', gone.body);
  const boardAfter = await http<LeaderboardResponse>('GET', '/leaderboard?zone=yeonmu&difficulty=normal&period=all&limit=10');
  check(boardAfter.status === 200 && !boardAfter.body.entries.some((e) => e.name === 'Çağatay Han'), 'erased player left the board', boardAfter.body.entries);
  ok('DELETE /players/me: save, credentials, runs and board rows erased', { boardEntries: boardAfter.body.entries.length });

  // rate limiting: registrations per IP (hourly cap, src/limits.ts RULES.register) end in 429 + Retry-After
  const cap = RULES.register[0]?.limit ?? 30;
  const burst: number[] = [];
  for (let i = 0; i <= cap && !burst.includes(429); i++) burst.push((await http<unknown>('POST', '/players', { json: { name: `Burst ${i}abc` } })).status);
  check(burst.includes(429), 'registration rate limit kicks in', burst);
  const limited = await http<{ error: { code: string; details: { retryAfterSec: number } } }>('POST', '/players', { json: { name: 'Burst zzz' } });
  check(limited.status === 429 && limited.res.headers.get('retry-after') !== null, '429 with Retry-After', limited.body);
  ok(`rate limit: registration per IP (cap ${cap}/h) → 429 + Retry-After`, { attempts: burst.length, retryAfterSec: limited.body.error.details.retryAfterSec });

  console.log(`\nE2E OK — ${steps} checks passed against ${base}`);
}

try {
  await main();
  stopServer();
  if (existsSync(stateDir) && !external) {
    // workerd releases its SQLite files a moment after the kill on Windows; a leftover state dir is harmless
    try {
      rmSync(stateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (e) {
      console.warn(`(could not remove ${stateDir}: ${e instanceof Error ? e.message : String(e)})`);
    }
  }
  process.exit(0);
} catch (e) {
  console.error(`\nE2E FAILED: ${e instanceof Error ? e.message : String(e)}`);
  stopServer();
  process.exit(1);
}
