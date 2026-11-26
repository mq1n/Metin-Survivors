import { SAVE_MAX_BYTES, type RunResponse, type RunSubmission } from '@ms/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  ApiError,
  RUN_QUEUE_KEY,
  StorageCredentialStore,
  isApiError,
  normalizeApiBase,
  toWebSocketUrl,
  type ApiEvent,
  type KeyValueStore,
} from './api';

class MemStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const PLAYER = 'P'.repeat(16);
const SECRET = 's'.repeat(32);
const BASE = 'https://api.example/api/v1';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

interface Call {
  url: string;
  init: RequestInit;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function errorBody(code: string, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, requestId: 'req-1', ...(details ? { details } : {}) } };
}

function setup(handler: Handler, opts: { registered?: boolean; now?: () => number } = {}) {
  const calls: Call[] = [];
  const credStore = new MemStore();
  const queueStore = new MemStore();
  const credentials = new StorageCredentialStore(credStore);
  if (opts.registered !== false) credentials.save({ playerId: PLAYER, secret: SECRET });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call.url, call.init);
  }) as typeof fetch;
  const client = new ApiClient({ baseUrl: BASE, fetch: fetchImpl, credentials, store: queueStore, autoFlush: false, ...(opts.now ? { now: opts.now } : {}) });
  return { client, calls, credentials, credStore, queueStore };
}

function run(over: Partial<RunSubmission> = {}): RunSubmission {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    clientVersion: '1.0.0',
    zone: 'yeonmu',
    difficulty: 'normal',
    classId: 'warrior',
    seed: 1,
    victory: false,
    duration: 600,
    endedAt: Date.now() - 1000,
    stats: { kills: 2000, elites: 10, bosses: 3, metins: 8, level: 40, yeop: 10_000 },
    ...over,
  };
}

const runResponse = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 1,
  score: 1234,
  status: 'ok',
  mode: 'solo',
  flags: [],
  duplicate: false,
  best: true,
  bestScore: 1234,
  rank: 1,
  weekRank: 1,
  classRank: 1,
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('base URL helpers', () => {
  it('normalises configured bases', () => {
    expect(normalizeApiBase(undefined, true)).toBe('http://127.0.0.1:18686/api/v1');
    expect(normalizeApiBase(undefined, false)).toBe('/api/v1');
    expect(normalizeApiBase('', false)).toBe('/api/v1');
    expect(normalizeApiBase('https://api.example.workers.dev/', false)).toBe('https://api.example.workers.dev/api/v1');
    expect(normalizeApiBase('https://api.example/api/v1', false)).toBe('https://api.example/api/v1');
    expect(normalizeApiBase('/api/v1/', false)).toBe('/api/v1');
  });
  it('derives WebSocket URLs', () => {
    expect(toWebSocketUrl('https://api.example/api/v1', '/coop/ABC234')).toBe('wss://api.example/api/v1/coop/ABC234');
    expect(toWebSocketUrl('http://127.0.0.1:18686/api/v1', '/coop/ABC234')).toBe('ws://127.0.0.1:18686/api/v1/coop/ABC234');
    // same-origin base (production through the Pages proxy): the socket stays on the page's own origin
    expect(toWebSocketUrl('/api/v1', '/coop/ABC234')).toMatch(/^wss?:\/\/[^/]+\/api\/v1\/coop\/ABC234$/);
  });
});

describe('credentials', () => {
  it('registers, persists and reuses credentials', async () => {
    const { client, calls } = setup(() => json({ playerId: PLAYER, secret: SECRET, name: 'Hero' }, 201), { registered: false });
    expect(client.hasCredentials()).toBe(false);
    const res = await client.register('Hero');
    expect(res.name).toBe('Hero');
    expect(calls[0]?.url).toBe(`${BASE}/players`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ name: 'Hero' });
    expect(client.getCredentials()).toEqual({ playerId: PLAYER, secret: SECRET });
    await client.ensureRegistered();
    expect(calls).toHaveLength(1);
    client.clearCredentials();
    expect(client.hasCredentials()).toBe(false);
  });

  it('ignores corrupt stored credentials', () => {
    const store = new MemStore();
    store.setItem('ms.api.credentials', '{"playerId":"x"');
    expect(new StorageCredentialStore(store).load()).toBeNull();
    store.setItem('ms.api.credentials', JSON.stringify({ playerId: 'short', secret: 'short' }));
    expect(new StorageCredentialStore(store).load()).toBeNull();
  });

  it('sends Bearer credentials and refuses authenticated calls when unregistered', async () => {
    const { client, calls } = setup(() => json({ playerId: PLAYER, name: 'New Name' }));
    await client.rename('New Name');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PLAYER}.${SECRET}`);
    expect(calls[0]?.init.method).toBe('PATCH');

    const anon = setup(() => json({}), { registered: false });
    await expect(anon.client.rename('Nope Name')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(anon.calls).toHaveLength(0);
  });

  it('adopts the credential minted by a device transfer', async () => {
    const other = { playerId: 'Q'.repeat(16), secret: 'z'.repeat(32), name: 'Moved' };
    const { client, calls } = setup(() => json(other), { registered: false });
    await client.claimTransfer('ABCD-EFGH');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ code: 'ABCD-EFGH' });
    expect(client.getCredentials()).toEqual({ playerId: other.playerId, secret: other.secret });
  });
});

describe('errors', () => {
  it('maps structured error bodies to ApiError', async () => {
    const { client } = setup(() => json(errorBody('rate_limited', 'slow down', { retryAfterSec: 30 }), 429, { 'Retry-After': '31' }));
    const err = await client.rename('Whatever').catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', message: 'slow down', retryAfterSec: 31, requestId: 'req-1' });
    expect((err as ApiError).retryable).toBe(true);
  });

  it('falls back to a status-derived code for non-JSON failures', async () => {
    const { client } = setup(() => new Response('<html>bad gateway</html>', { status: 502 }));
    const err = await client.rename('Whatever').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'internal' });
    expect((err as ApiError).retryable).toBe(true);
  });

  it('reports network failures as status 0', async () => {
    const { client } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await client.leaderboard({ zone: 'yeonmu' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'network' });
    expect((err as ApiError).retryable).toBe(true);
  });

  it('times out hanging requests', async () => {
    vi.useFakeTimers();
    const { client } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = client.health().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toMatchObject({ status: 0, code: 'timeout' });
  });

  it('emits `unauthorized` when the server rejects our credentials', async () => {
    const { client } = setup(() => json(errorBody('unauthorized', 'Invalid credentials'), 401));
    const events: ApiEvent[] = [];
    client.subscribe((e) => events.push(e));
    await expect(client.createTransfer()).rejects.toMatchObject({ status: 401 });
    expect(events).toEqual([{ type: 'unauthorized' }]);
  });
});

// `/api` misrouted (Pages answers every unknown path with 200 + index.html) or a proxy/captive-portal page: the answer did
// not come from the Worker, so it must behave like being offline — retryable, queue-preserving, never a crash.
describe('200 responses that are not the Worker\'s JSON', () => {
  const SPA = '<!doctype html><html><head><title>Metin Survivors</title></head><body><canvas id="game"></canvas></body></html>';
  const spa = (): Response => new Response(SPA, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('turns an HTML 200 into a retryable network-class error on every JSON endpoint', async () => {
    const { client } = setup(spa);
    const calls: [string, () => Promise<unknown>][] = [
      ['health', () => client.health()],
      ['leaderboard', () => client.leaderboard({ zone: 'yeonmu' })],
      ['rename', () => client.rename('Whatever')],
      ['putSave', () => client.putSave('{"version":1}', 0)],
      ['createTransfer', () => client.createTransfer()],
      ['createRoom', () => client.createRoom()],
    ];
    for (const [name, call] of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(isApiError(err), name).toBe(true);
      expect(err, name).toMatchObject({ status: 0, code: 'network', message: 'The server sent an unreadable response' });
      expect((err as ApiError).retryable, name).toBe(true);
      expect((err as ApiError).details, name).toMatchObject({ cause: 'not_json', httpStatus: 200, contentType: 'text/html; charset=utf-8' });
    }
  });

  it('does not store credentials from a registration that was really an HTML page', async () => {
    const { client } = setup(spa, { registered: false });
    await expect(client.register('Hero')).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(client.hasCredentials()).toBe(false);
  });

  it('treats an empty body, truncated JSON and non-object JSON the same way (no TypeError on the first field read)', async () => {
    for (const body of ['', '{"playerId":"P', 'null', '42', '"ok"']) {
      const { client } = setup(() => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }), { registered: false });
      const err = await client.register('Hero').catch((e: unknown) => e);
      expect(err, JSON.stringify(body)).toMatchObject({ status: 0, code: 'network' });
      expect((err as ApiError).retryable).toBe(true);
    }
  });

  it('still returns arrays and objects untouched', async () => {
    const { client } = setup(() => json({ ok: true, service: 'metin-survivors-api' }));
    await expect(client.health()).resolves.toMatchObject({ ok: true });
  });

  it('queues a finished run instead of losing it, and keeps queued runs queued on flush', async () => {
    const { client, queueStore } = setup(spa);
    const first = run();
    expect(await client.submitRunQueued(first)).toEqual({ status: 'queued', pending: 1 });
    const flushed = await client.flushRunQueue();
    expect(flushed).toEqual({ sent: 0, dropped: 0, remaining: 1 });
    expect(JSON.parse(queueStore.getItem(RUN_QUEUE_KEY) ?? '[]')).toHaveLength(1);
    // the page comes back as JSON later: the very same run is delivered
    const healthy = setup(() => json(runResponse()));
    healthy.queueStore.setItem(RUN_QUEUE_KEY, queueStore.getItem(RUN_QUEUE_KEY) ?? '[]');
    expect(await healthy.client.flushRunQueue()).toEqual({ sent: 1, dropped: 0, remaining: 0 });
  });

  it('GET /save: an HTML page (or a 200 without a revision) is retryable, not an "internal" rejection', async () => {
    const html = setup(spa);
    await expect(html.client.getSave()).rejects.toMatchObject({ status: 0, code: 'network' });
    // the SPA fallback's own ETag is a content hash — even a numeric one must not pass as a save revision
    const withEtag = setup(() => new Response(SPA, { status: 200, headers: { 'content-type': 'text/html', ETag: '"123456"' } }));
    const err = await withEtag.client.getSave().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'network' });
    expect((err as ApiError).details).toMatchObject({ cause: 'html' });
    const noRev = setup(() => new Response('{"version":1}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const err2 = await noRev.client.getSave().catch((e: unknown) => e);
    expect(err2).toMatchObject({ status: 0, code: 'network' });
    expect((err2 as ApiError).retryable).toBe(true);
  });
});

describe('deleteAccount (DELETE /players/me)', () => {
  const queued = (s: ReturnType<typeof setup>): number => JSON.parse(s.queueStore.getItem(RUN_QUEUE_KEY) ?? '[]').length;

  it('erases on the server, then forgets the cloud identity and the offline queue (local state stays usable)', async () => {
    let online = false;
    const s = setup((_url, init) => (init.method === 'DELETE' ? new Response(null, { status: 204 }) : online ? json(runResponse()) : new Response('down', { status: 503 })));
    await s.client.submitRunQueued(run());
    expect(queued(s)).toBe(1);
    const events: ApiEvent[] = [];
    s.client.subscribe((e) => events.push(e));

    await expect(s.client.deleteAccount()).resolves.toBeUndefined();

    const del = s.calls.at(-1);
    expect(del?.url).toBe(`${BASE}/players/me`);
    expect(del?.init.method).toBe('DELETE');
    expect((del?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PLAYER}.${SECRET}`);
    expect(del?.init.body).toBeUndefined();
    expect(s.client.hasCredentials()).toBe(false);
    expect(s.credStore.getItem('ms.api.credentials')).toBeNull();
    expect(s.client.pendingRuns()).toBe(0);
    expect(events).toEqual([{ type: 'queue', pending: 0 }]);

    // the game continues "not linked": a new run queues locally (no network, no credentials) and nothing is uploaded
    const callsBefore = s.calls.length;
    online = true;
    expect(await s.client.submitRunQueued(run())).toEqual({ status: 'queued', pending: 1 });
    expect(s.calls.length).toBe(callsBefore);
  });

  it('treats a 401 as "this identity is already gone": nothing left to erase, so the local identity is dropped too', async () => {
    const s = setup(() => json(errorBody('unauthorized', 'Invalid credentials'), 401));
    await s.client.submitRunQueued(run()).catch(() => undefined);
    await expect(s.client.deleteAccount()).resolves.toBeUndefined();
    expect(s.client.hasCredentials()).toBe(false);
    expect(s.client.pendingRuns()).toBe(0);
  });

  it('is a quiet no-op without a cloud identity (no request)', async () => {
    const s = setup(() => new Response(null, { status: 204 }), { registered: false });
    await expect(s.client.deleteAccount()).resolves.toBeUndefined();
    expect(s.calls).toHaveLength(0);
  });

  it('keeps everything and rejects with a retryable error when the server cannot be reached or refuses', async () => {
    const cases: [string, Handler, Partial<ApiError>][] = [
      ['offline', () => { throw new TypeError('Failed to fetch'); }, { status: 0, code: 'network' }],
      ['5xx', () => json(errorBody('internal', 'boom'), 500), { status: 500, code: 'internal' }],
      ['storage down', () => json(errorBody('unavailable', 'Save storage is temporarily unavailable, try again'), 503), { status: 503, code: 'unavailable' }],
      ['rate limited', () => json(errorBody('rate_limited', 'slow down', { retryAfterSec: 20 }), 429, { 'Retry-After': '20' }), { status: 429, code: 'rate_limited', retryAfterSec: 20 }],
      ['misrouted /api (HTML 200)', () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), { status: 0, code: 'network' }],
    ];
    for (const [name, handler, expected] of cases) {
      const s = setup(handler);
      s.queueStore.setItem(RUN_QUEUE_KEY, JSON.stringify([{ run: run(), queuedAt: Date.now() }]));
      const err = await s.client.deleteAccount().catch((e: unknown) => e);
      expect(err, name).toMatchObject(expected);
      expect((err as ApiError).retryable, name).toBe(true);
      expect(s.client.hasCredentials(), name).toBe(true);
      expect(queued(s), name).toBe(1);
    }
  });

  it('a banned player (403) is refused and keeps the local identity', async () => {
    const s = setup(() => json(errorBody('banned', 'This player is banned'), 403));
    const err = await s.client.deleteAccount().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403, code: 'banned' });
    expect((err as ApiError).retryable).toBe(false);
    expect(s.client.hasCredentials()).toBe(true);
  });
});

/** A promise the test opens by hand: holds a fake server answer back so requests overlap on purpose. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}
/** Lets every already-resolved promise continuation run (a few turns of the event loop). */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
const methods = (s: ReturnType<typeof setup>): string[] => s.calls.map((c) => c.init.method ?? 'GET');

describe('write ordering: PUT /save, POST /runs, DELETE /players/me and the GET /save read share one chain', () => {
  const queued = (s: ReturnType<typeof setup>): number => JSON.parse(s.queueStore.getItem(RUN_QUEUE_KEY) ?? '[]').length;
  const saveMeta = { rev: 1, updatedAt: 1, size: 14 };

  it('an erasure waits for the upload that is already on the wire', async () => {
    const put = gate();
    const s = setup(async (_url, init) => {
      if (init.method === 'PUT') {
        await put.wait;
        return json(saveMeta);
      }
      return new Response(null, { status: 204 });
    });
    const upload = s.client.putSave('{"version":1}', 0);
    await settled();
    expect(methods(s)).toEqual(['PUT']);
    let erased = false;
    const erase = s.client.deleteAccount().then(() => {
      erased = true;
    });
    await settled();
    expect(methods(s)).toEqual(['PUT']); // the DELETE has not been sent: the upload is still in flight
    expect(erased).toBe(false);
    put.open();
    await expect(upload).resolves.toEqual(saveMeta);
    await erase;
    expect(methods(s)).toEqual(['PUT', 'DELETE']); // the server sees the upload first, then the erasure
    expect(s.client.hasCredentials()).toBe(false);
  });

  it('a save or run issued behind an erasure never goes out with the erased credential', async () => {
    const del = gate();
    const s = setup(async (_url, init) => {
      if (init.method === 'DELETE') {
        await del.wait;
        return new Response(null, { status: 204 });
      }
      return init.method === 'PUT' ? json(saveMeta) : json(runResponse(), 201);
    });
    const erase = s.client.deleteAccount();
    const upload = s.client.putSave('{"version":1}', 3); // issued while the DELETE is on the wire
    const submit = s.client.submitRunQueued(run());
    const direct = s.client.submitRun(run());
    await settled();
    expect(methods(s)).toEqual(['DELETE']);
    del.open();
    await erase;
    await expect(upload).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    await expect(direct).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    // the run is new data of the next identity: queued locally, sent once one is registered, never with the old secret
    await expect(submit).resolves.toEqual({ status: 'queued', pending: 1 });
    expect(methods(s)).toEqual(['DELETE']); // nothing else was sent, so nothing carried the erased secret
    expect(s.client.hasCredentials()).toBe(false);
    expect(queued(s)).toBe(1);
  });

  it('a GET /save issued behind an erasure never goes out with the erased credential', async () => {
    const del = gate();
    const s = setup(async (_url, init) => {
      if (init.method === 'DELETE') {
        await del.wait;
        return new Response(null, { status: 204 });
      }
      return json({ rev: 1 }); // would answer if it were ever sent
    });
    const erase = s.client.deleteAccount();
    const read = s.client.getSave(); // the cloud sync's read, queued while the DELETE is on the wire
    const readAssert = expect(read).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    await settled();
    expect(methods(s)).toEqual(['DELETE']);
    del.open();
    await erase;
    await readAssert;
    expect(methods(s)).toEqual(['DELETE']); // the GET never left the page
    expect(s.client.hasCredentials()).toBe(false);
  });

  it('an erasure waits for a GET /save that is already on the wire', async () => {
    const get = gate();
    const s = setup(async (_url, init) => {
      if (init.method === 'GET') {
        await get.wait;
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204 });
    });
    const read = s.client.getSave();
    await settled();
    expect(methods(s)).toEqual(['GET']);
    const erase = s.client.deleteAccount();
    await settled();
    expect(methods(s)).toEqual(['GET']); // the DELETE waits: the Worker answers the read before it erases
    get.open();
    await expect(read).resolves.toBeNull();
    await erase;
    expect(methods(s)).toEqual(['GET', 'DELETE']);
  });

  it('a failed upload does not block the erasure behind it', async () => {
    const s = setup((_url, init) => (init.method === 'PUT' ? new Response('down', { status: 503 }) : new Response(null, { status: 204 })));
    const first = s.client.putSave('{"version":1}', 0).catch((e: unknown) => e);
    const erase = s.client.deleteAccount();
    expect(await first).toMatchObject({ status: 503 });
    await erase;
    expect(methods(s)).toEqual(['PUT', 'DELETE']);
    expect(s.client.hasCredentials()).toBe(false);
  });

  it('an erasure that fails (offline) leaves the identity, so the saves behind it still go out', async () => {
    let online = false;
    const s = setup((_url, init) => {
      if (!online && init.method === 'DELETE') throw new TypeError('offline');
      return init.method === 'DELETE' ? new Response(null, { status: 204 }) : json(saveMeta);
    });
    const erase = s.client.deleteAccount().catch((e: unknown) => e);
    const upload = s.client.putSave('{"version":1}', 0);
    expect(await erase).toMatchObject({ status: 0, code: 'network' });
    await expect(upload).resolves.toEqual(saveMeta);
    expect(s.client.hasCredentials()).toBe(true);
    online = true;
    await s.client.deleteAccount();
    expect(methods(s)).toEqual(['DELETE', 'PUT', 'DELETE']);
  });

  it('an in-flight queue flush cannot write the erased queue back', async () => {
    const post = gate();
    const s = setup(async (_url, init) => {
      if (init.method === 'POST') {
        await post.wait;
        return json(runResponse(), 201);
      }
      return new Response(null, { status: 204 });
    });
    const ids = ['flush-run-0001', 'flush-run-0002', 'flush-run-0003'];
    s.queueStore.setItem(RUN_QUEUE_KEY, JSON.stringify(ids.map((runId) => ({ run: run({ runId }), queuedAt: Date.now() }))));
    const flush = s.client.flushRunQueue();
    await settled();
    expect(methods(s)).toEqual(['POST']); // the first queued run is on the wire
    const erase = s.client.deleteAccount();
    post.open();
    await erase;
    const summary = await flush;
    expect(methods(s)).toEqual(['POST', 'DELETE']); // nothing is sent after the erasure
    expect(summary.sent).toBe(1);
    expect(queued(s)).toBe(0); // the old code wrote [run 2, run 3] back here
    expect(s.queueStore.getItem(RUN_QUEUE_KEY)).toBeNull();
    expect(s.client.hasCredentials()).toBe(false);
  });

  it('a flush keeps the runs that were queued while its request was in flight', async () => {
    const post = gate();
    const s = setup(async () => {
      await post.wait;
      return json(runResponse(), 201);
    });
    s.queueStore.setItem(RUN_QUEUE_KEY, JSON.stringify([{ run: run({ runId: 'flush-keep-0001' }), queuedAt: Date.now() }]));
    const flush = s.client.flushRunQueue();
    await settled();
    // a run finishes (and is queued, e.g. the network dropped for it) while the first one is on the wire
    s.queueStore.setItem(
      RUN_QUEUE_KEY,
      JSON.stringify([
        { run: run({ runId: 'flush-keep-0001' }), queuedAt: Date.now() },
        { run: run({ runId: 'flush-keep-0002' }), queuedAt: Date.now() },
      ]),
    );
    post.open();
    expect(await flush).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(methods(s)).toEqual(['POST', 'POST']);
  });

  it('only forgets the identity it erased (a register / transfer claim that stored another one meanwhile stays)', async () => {
    const del = gate();
    const s = setup(async () => {
      await del.wait;
      return new Response(null, { status: 204 });
    });
    const erase = s.client.deleteAccount();
    await settled();
    s.credentials.save({ playerId: 'N'.repeat(16), secret: 'n'.repeat(32) });
    del.open();
    await erase;
    expect(s.client.getCredentials()).toEqual({ playerId: 'N'.repeat(16), secret: 'n'.repeat(32) });
  });

  it('a response body that stalls rejects its own promise at the deadline and releases the chain (NET-06)', async () => {
    vi.useFakeTimers();
    let first = true;
    const s = setup((_url, init) => {
      if (init.method === 'PUT' && first) {
        first = false;
        // headers arrived promptly, but the body never settles
        return { ok: true, status: 200, headers: new Headers(), json: () => new Promise(() => undefined) } as unknown as Response;
      }
      return new Response(null, { status: 204 });
    });
    const stalledPut = s.client.putSave('{"version":1}', 0).catch((e: unknown) => e);
    const erase = s.client.deleteAccount();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(methods(s)).toEqual(['PUT']);
    await vi.advanceTimersByTimeAsync(1_500);
    const putErr = await stalledPut;
    expect(isApiError(putErr)).toBe(true);
    expect(putErr).toMatchObject({ status: 0, code: 'timeout' });
    expect((putErr as ApiError).retryable).toBe(true);
    await erase;
    expect(methods(s)).toEqual(['PUT', 'DELETE']);
  });

  it('keeps the deadline active across never-ending ReadableStream bodies for 200 JSON, 500 error, and GET /save (NET-06)', async () => {
    vi.useFakeTimers();
    const makeStalledClient = (status: number, headers: Record<string, string>) => {
      let cancelled = false;
      let signal: AbortSignal | null = null;
      const credStore = new MemStore();
      const queueStore = new MemStore();
      const credentials = new StorageCredentialStore(credStore);
      credentials.save({ playerId: PLAYER, secret: SECRET });
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        signal = init?.signal ?? null;
        const stream = new ReadableStream<Uint8Array>({
          start() {
            // never enqueues or closes
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(stream, { status, headers });
      }) as typeof fetch;
      const client = new ApiClient({ baseUrl: BASE, fetch: fetchImpl, credentials, store: queueStore, timeoutMs: 25, autoFlush: false });
      return { client, getCancelled: () => cancelled, getSignal: () => signal };
    };

    // 200 JSON response whose headers arrive immediately but stream never ends
    const ok200 = makeStalledClient(200, { 'content-type': 'application/json' });
    const lbPending = ok200.client.leaderboard({ zone: 'yeonmu' }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30);
    const lbErr = await lbPending;
    expect(lbErr).toMatchObject({ status: 0, code: 'timeout' });
    expect((lbErr as ApiError).retryable).toBe(true);
    expect(ok200.getSignal()?.aborted).toBe(true);
    expect(ok200.getCancelled()).toBe(true);

    // 500 error response whose headers arrive immediately but error body never ends
    const err500 = makeStalledClient(500, { 'content-type': 'application/json' });
    const runPending = err500.client.submitRunQueued(run({ runId: 'stalled-500-run' }));
    await vi.advanceTimersByTimeAsync(30);
    expect(await runPending).toEqual({ status: 'queued', pending: 1 });
    expect(err500.getSignal()?.aborted).toBe(true);
    expect(err500.getCancelled()).toBe(true);
    expect(err500.client.pendingRuns()).toBe(1);

    // 200 GET /save response whose headers arrive immediately but save body never ends
    const save200 = makeStalledClient(200, { 'content-type': 'application/json', ETag: '"3"' });
    const savePending = save200.client.getSave().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30);
    const saveErr = await savePending;
    expect(saveErr).toMatchObject({ status: 0, code: 'timeout' });
    expect(save200.getSignal()?.aborted).toBe(true);
    expect(save200.getCancelled()).toBe(true);
  });

  it('does not start a queued write timeout clock until that write actually begins executing (NET-06)', async () => {
    vi.useFakeTimers();
    let call = 0;
    const credStore = new MemStore();
    const queueStore = new MemStore();
    const credentials = new StorageCredentialStore(credStore);
    credentials.save({ playerId: PLAYER, secret: SECRET });
    const fetchImpl = (async () => {
      call += 1;
      const myCall = call;
      // Each write takes 70 ms — less than the 100 ms per-request timeout, but two writes total 140 ms > 100 ms.
      await new Promise((r) => setTimeout(r, 70));
      return json({ rev: myCall, updatedAt: myCall * 100, size: 13 });
    }) as typeof fetch;
    const client = new ApiClient({ baseUrl: BASE, fetch: fetchImpl, credentials, store: queueStore, timeoutMs: 100, autoFlush: false });

    const first = client.putSave('{"version":1}', 0);
    const second = client.putSave('{"version":1}', 1);
    await vi.advanceTimersByTimeAsync(75);
    expect(await first).toMatchObject({ rev: 1 });
    // Second write starts at t=70ms and needs until t=140ms; if its 100ms timer had started at t=0 it would have failed at t=100ms.
    await vi.advanceTimersByTimeAsync(75);
    expect(await second).toMatchObject({ rev: 2 });
  });

  it('throws a non-retryable storage ApiError instead of falsely claiming queued when queueStore.setItem throws quota error (NET-05)', async () => {
    const credStore = new MemStore();
    const fullStore: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
      credentials: new StorageCredentialStore(credStore),
      store: fullStore,
      autoFlush: false,
    });
    const err = await client.submitRunQueued(run({ runId: 'quota-run-0001' })).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ status: 0, code: 'storage' });
    expect((err as ApiError).retryable).toBe(false);
    expect(() => client.enqueueRun(run({ runId: 'quota-run-0002' }))).toThrow(ApiError);
  });
});

describe('cloud save', () => {
  it('uploads with a quoted If-Match revision and returns the new meta', async () => {
    const { client, calls } = setup(() => json({ rev: 4, updatedAt: 99, size: 12 }));
    const meta = await client.putSave('{"version":1}', 3);
    expect(meta).toEqual({ rev: 4, updatedAt: 99, size: 12 });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('"3"');
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.init.body).toBe('{"version":1}');
    expect(calls[0]?.init.method).toBe('PUT');
  });

  it('surfaces revision conflicts with the current revision', async () => {
    const { client } = setup(() => json(errorBody('rev_conflict', 'changed', { currentRev: 9 }), 412));
    const err = await client.putSave('{"version":1}', 3).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 412, code: 'rev_conflict' });
    expect((err as ApiError).currentRev).toBe(9);
  });

  it('refuses oversize saves without touching the network', async () => {
    const { client, calls } = setup(() => json({}));
    await expect(client.putSave('x'.repeat(SAVE_MAX_BYTES + 1), 0)).rejects.toMatchObject({ status: 413, code: 'payload_too_large' });
    expect(calls).toHaveLength(0);
  });

  it('downloads the raw blob with its revision from ETag / X-Save-Updated', async () => {
    const blob = '{"version":2,"bank":{"yeop":5}}';
    const { client } = setup(() => new Response(blob, { status: 200, headers: { ETag: '"7"', 'X-Save-Updated': '1700000000000', 'content-type': 'application/json' } }));
    const got = await client.getSave();
    expect(got?.body).toBe(blob);
    expect(got?.meta).toEqual({ rev: 7, updatedAt: 1_700_000_000_000, size: blob.length });
  });

  it('sends If-None-Match when ifNoneMatchRev > 0 and handles 304 Not Modified without reading R2', async () => {
    const { client, calls } = setup(
      () => new Response(null, { status: 304, headers: { ETag: '"7"', 'X-Save-Updated': '1700000000000' } }),
    );
    const got = await client.getSave(7);
    expect((calls[0]?.init.headers as Record<string, string>)['If-None-Match']).toBe('"7"');
    expect(got).toEqual({ meta: { rev: 7, updatedAt: 1_700_000_000_000, size: 0 }, body: '', unchanged: true });
  });

  it('returns null when there is no cloud save yet (204, and the 404 no_save of servers from before that change)', async () => {
    const empty = setup(() => new Response(null, { status: 204 }));
    expect(await empty.client.getSave()).toBeNull();
    const { client } = setup(() => json(errorBody('no_save', 'No cloud save yet'), 404));
    expect(await client.getSave()).toBeNull();
    const failing = setup(() => json(errorBody('not_found', 'Not found'), 404));
    await expect(failing.client.getSave()).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('leaderboard', () => {
  it('builds the query and authenticates when registered', async () => {
    const body = { zone: 'seori', difficulty: 'hard', class: 'ninja', period: 'week', weekStart: 1, limit: 10, total: 0, entries: [], you: null };
    const { client, calls } = setup(() => json(body));
    await client.leaderboard({ zone: 'seori', difficulty: 'hard', class: 'ninja', period: 'week', limit: 10 });
    expect(calls[0]?.url).toBe(`${BASE}/leaderboard?zone=seori&difficulty=hard&class=ninja&period=week&limit=10`);
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toContain(PLAYER);
    await client.leaderboard({ zone: 'seori', mode: 'coop' });
    expect(calls[1]?.url).toBe(`${BASE}/leaderboard?zone=seori&mode=coop`);
    const anon = setup(() => json(body), { registered: false });
    await anon.client.leaderboard({ zone: 'seori' });
    expect((anon.calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('run submission & offline queue', () => {
  it('submits directly when online', async () => {
    const { client, calls, queueStore } = setup(() => json(runResponse(), 201));
    const r = run();
    const out = await client.submitRunQueued(r);
    expect(out).toEqual({ status: 'submitted', result: runResponse() });
    expect(JSON.parse(String(calls[0]?.init.body)).runId).toBe(r.runId);
    expect(queueStore.getItem(RUN_QUEUE_KEY)).toBeNull();
  });

  it('sends the co-op party size and keeps it through the offline queue', async () => {
    let online = false;
    const bodies: unknown[] = [];
    const { client } = setup((_url, init) => {
      if (!online) throw new TypeError('offline');
      bodies.push(JSON.parse(String(init.body)));
      return json(runResponse({ mode: 'coop' }), 201);
    });
    await client.submitRunQueued(run({ runId: 'coop-run-0001', coop: 3 }));
    expect(client.pendingRuns()).toBe(1);
    online = true;
    await client.flushRunQueue();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ runId: 'coop-run-0001', coop: 3 });
    await expect(client.submitRun(run({ coop: 5 }))).rejects.toMatchObject({ status: 400, code: 'validation', details: { field: 'coop' } });
    await expect(client.submitRun(run({ coop: 1 }))).rejects.toMatchObject({ code: 'validation' });
  });

  it('validates before touching the network or the queue', async () => {
    const { client, calls, queueStore } = setup(() => json(runResponse()));
    await expect(client.submitRunQueued(run({ zone: 'atlantis' as never }))).rejects.toMatchObject({ status: 400, code: 'validation' });
    await expect(client.submitRun(run({ seed: -1 }))).rejects.toMatchObject({ code: 'validation' });
    expect(calls).toHaveLength(0);
    expect(queueStore.getItem(RUN_QUEUE_KEY)).toBeNull();
  });

  it('queues while offline and delivers on flush, oldest first, firing events', async () => {
    let online = false;
    const delivered: string[] = [];
    const { client, queueStore } = setup((_url, init) => {
      if (!online) throw new TypeError('Failed to fetch');
      delivered.push(JSON.parse(String(init.body)).runId);
      return json(runResponse({ id: delivered.length }), 201);
    });
    const events: ApiEvent[] = [];
    client.subscribe((e) => events.push(e));
    const [a, b] = [run({ runId: 'queued-run-a' }), run({ runId: 'queued-run-b' })];
    expect(await client.submitRunQueued(a)).toEqual({ status: 'queued', pending: 1 });
    expect(await client.submitRunQueued(b)).toEqual({ status: 'queued', pending: 2 });
    expect(client.pendingRuns()).toBe(2);
    expect(JSON.parse(queueStore.getItem(RUN_QUEUE_KEY) ?? '[]')).toHaveLength(2);

    // still offline: nothing is lost
    expect(await client.flushRunQueue()).toEqual({ sent: 0, dropped: 0, remaining: 2 });

    online = true;
    expect(await client.flushRunQueue()).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(delivered).toEqual(['queued-run-a', 'queued-run-b']);
    expect(queueStore.getItem(RUN_QUEUE_KEY)).toBeNull();
    const submitted = events.filter((e) => e.type === 'runSubmitted');
    expect(submitted).toHaveLength(2);
    expect(submitted.every((e) => e.type === 'runSubmitted' && e.fromQueue)).toBe(true);
  });

  it('queues on 429/5xx but throws on permanent rejections', async () => {
    const limited = setup(() => json(errorBody('rate_limited', 'slow', { retryAfterSec: 5 }), 429));
    expect(await limited.client.submitRunQueued(run())).toMatchObject({ status: 'queued' });
    const down = setup(() => new Response('', { status: 503 }));
    expect(await down.client.submitRunQueued(run())).toMatchObject({ status: 'queued' });
    const cheat = setup(() => json(errorBody('implausible_run', 'no', { reasons: ['kills_rate'] }), 422));
    await expect(cheat.client.submitRunQueued(run())).rejects.toMatchObject({ status: 422, code: 'implausible_run' });
    expect(cheat.client.pendingRuns()).toBe(0);
  });

  it('flush drops permanently rejected entries and delivers the rest', async () => {
    let online = false;
    const { client } = setup((_url, init) => {
      if (!online) throw new TypeError('offline');
      const id = JSON.parse(String(init.body)).runId as string;
      return id === 'bad-run-0001' ? json(errorBody('implausible_run', 'no'), 422) : json(runResponse(), 201);
    });
    const events: ApiEvent[] = [];
    client.subscribe((e) => events.push(e));
    await client.submitRunQueued(run({ runId: 'bad-run-0001' }));
    await client.submitRunQueued(run({ runId: 'good-run-0002' }));
    online = true;
    expect(await client.flushRunQueue()).toEqual({ sent: 1, dropped: 1, remaining: 0 });
    expect(events.filter((e) => e.type === 'runDropped')).toHaveLength(1);
  });

  it('stops flushing at the first retryable failure and keeps order', async () => {
    let mode: 'offline' | 'ok' | 'flaky' = 'offline';
    let seen = 0;
    const { client } = setup(() => {
      if (mode === 'offline') throw new TypeError('offline');
      seen += 1;
      if (mode === 'flaky' && seen > 1) return new Response('', { status: 503 });
      return json(runResponse(), 201);
    });
    for (const id of ['order-run-001', 'order-run-002', 'order-run-003']) await client.submitRunQueued(run({ runId: id }));
    mode = 'flaky';
    expect(await client.flushRunQueue()).toEqual({ sent: 1, dropped: 0, remaining: 2 });
    mode = 'ok';
    expect(await client.flushRunQueue()).toEqual({ sent: 2, dropped: 0, remaining: 0 });
  });

  it('dedupes by runId, caps the queue and expires old entries', async () => {
    let clock = 1_000_000;
    const { client } = setup(
      () => {
        throw new TypeError('offline');
      },
      { now: () => clock },
    );
    await client.submitRunQueued(run({ runId: 'dup-run-0001' }));
    await client.submitRunQueued(run({ runId: 'dup-run-0001' }));
    expect(client.pendingRuns()).toBe(1);
    for (let i = 0; i < 60; i++) await client.submitRunQueued(run({ runId: `cap-run-${String(i).padStart(4, '0')}` }));
    expect(client.pendingRuns()).toBe(50);

    const aged = setup(
      () => json(runResponse(), 201),
      { now: () => clock },
    );
    aged.queueStore.setItem(RUN_QUEUE_KEY, JSON.stringify([{ run: run({ runId: 'ancient-run-01' }), queuedAt: clock - 14 * 86_400_000 }, { run: run({ runId: 'fresh-run-0001' }), queuedAt: clock - 1000 }]));
    expect(await aged.client.flushRunQueue()).toEqual({ sent: 1, dropped: 1, remaining: 0 });
  });

  it('keeps queued runs while unregistered and shares one flush pass between callers', async () => {
    const anon = setup(() => json(runResponse(), 201), { registered: false });
    expect(await anon.client.submitRunQueued(run())).toMatchObject({ status: 'queued' });
    expect(await anon.client.flushRunQueue()).toEqual({ sent: 0, dropped: 0, remaining: 1 });
    expect(anon.calls).toHaveLength(0);

    let online = false;
    let inflight = 0;
    let maxInflight = 0;
    let submitted = 0;
    const shared = setup(async () => {
      if (!online) throw new TypeError('offline');
      inflight += 1;
      submitted += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await Promise.resolve();
      inflight -= 1;
      return json(runResponse(), 201);
    });
    await shared.client.submitRunQueued(run({ runId: 'share-run-0001' }));
    await shared.client.submitRunQueued(run({ runId: 'share-run-0002' }));
    online = true;
    const [first, second] = await Promise.all([shared.client.flushRunQueue(), shared.client.flushRunQueue()]);
    expect(first).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(second).toBe(first);
    expect(submitted).toBe(2);
    expect(maxInflight).toBe(1);
  });
});

describe('co-op helpers', () => {
  it('creates rooms and builds socket URLs', async () => {
    const { client, calls } = setup(() => json({ room: 'ABC234' }, 201));
    expect(await client.createRoom()).toEqual({ room: 'ABC234' });
    expect(calls[0]?.url).toBe(`${BASE}/coop`);
    expect(client.coopSocketUrl('abc234')).toBe('wss://api.example/api/v1/coop/ABC234');
  });
});
