// Contract test: the meta cloud layer against the REAL net/api.ts `ApiClient`, with a fake Worker behind `fetch`.
// Guards the CloudApi interface (compile-time assignment) and the wire details (ETag / If-Match / error bodies).

import { formatRev, parseRev, SAVE_UPDATED_HEADER, type Credentials } from '@ms/shared/api';
import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { NOW, makeRun } from './__fixtures__/testkit';
import { ApiClient, type CredentialStore, type KeyValueStore as ApiKv } from '../net/api';
import type { CloudApi } from './cloud';
import { seededRng } from './rng';
import { MetaService } from './service';
import { MemoryStore } from './storage';

const C = fixtureContent;

class MemKv implements ApiKv {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

class MemCreds implements CredentialStore {
  c: Credentials | null = null;
  load(): Credentials | null {
    return this.c;
  }
  save(c: Credentials): void {
    this.c = c;
  }
  clear(): void {
    this.c = null;
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const errBody = (code: string, message: string, details?: Record<string, unknown>) => ({ error: { code, message, ...(details ? { details } : {}) } });

/** Minimal Worker double speaking the ARCHITECTURE §10 wire format. */
class FakeWorker {
  rev = 0;
  body = '';
  updated = 0;
  down = false;
  /** the Worker has erased this player (DELETE /players/me): the revision and the blob are gone, the credential is dead */
  erased = false;
  /** holds PUT /save on the wire until it resolves (forces an erasure to overlap an upload) */
  holdPut: Promise<void> | null = null;
  /** holds DELETE /players/me on the wire (the network round trip during which a queued read used to leave with the erased secret) */
  holdDelete: Promise<void> | null = null;
  requests: { method: string; path: string; ifMatch: string | null; auth: string | null }[] = [];
  runs: unknown[] = [];

  fetch = (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.down) return Promise.reject(new TypeError('Failed to fetch'));
    const u = new URL(String(url));
    const path = u.pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    this.requests.push({ method, path, ifMatch: headers.get('If-Match'), auth: headers.get('Authorization') });
    const body = typeof init?.body === 'string' ? init.body : '';
    if (method === 'POST' && path === '/players') return Promise.resolve(json(201, { playerId: 'a'.repeat(16), secret: 'b'.repeat(32), name: 'Kahraman0001' }));
    if (path === '/save' && method === 'GET') {
      if (this.rev === 0) return Promise.resolve(new Response(null, { status: 204 })); // "no save yet" is 204, not an error
      return Promise.resolve(new Response(this.body, { status: 200, headers: { ETag: formatRev(this.rev), [SAVE_UPDATED_HEADER]: String(this.updated) } }));
    }
    if (path === '/save' && method === 'PUT') {
      const put = (): Response => {
        if (this.erased) return json(401, errBody('unauthorized', 'Invalid credentials'));
        const want = parseRev(headers.get('If-Match'));
        if (want !== this.rev) return json(412, errBody('rev_conflict', 'stale', { currentRev: this.rev }));
        this.rev += 1;
        this.body = body;
        this.updated = 5_000 + this.rev;
        return json(200, { rev: this.rev, updatedAt: this.updated, size: body.length });
      };
      return this.holdPut ? this.holdPut.then(put) : Promise.resolve(put());
    }
    if (method === 'DELETE' && path === '/players/me') {
      const erase = (): Response => {
        this.erased = true;
        this.rev = 0;
        this.body = '';
        return new Response(null, { status: 204 });
      };
      return this.holdDelete ? this.holdDelete.then(erase) : Promise.resolve(erase());
    }
    if (method === 'POST' && path === '/transfer') return Promise.resolve(json(201, { code: 'ABCD2345', expiresAt: 9, ttlSec: 900 }));
    if (method === 'POST' && path === '/transfer/claim') return Promise.resolve(json(200, { playerId: 'c'.repeat(16), secret: 'd'.repeat(32), name: 'Donor' }));
    if (method === 'POST' && path === '/runs') {
      this.runs.push(JSON.parse(body));
      return Promise.resolve(json(200, { id: 1, score: 1, status: 'ok', flags: [], duplicate: false, best: true, bestScore: 1, rank: 1, weekRank: 1, classRank: 1 }));
    }
    if (method === 'GET' && path === '/leaderboard') {
      return Promise.resolve(json(200, { zone: 'yeonmu', difficulty: 'normal', class: 'all', period: 'all', weekStart: null, limit: 25, total: 0, entries: [], you: null }));
    }
    return Promise.resolve(json(404, errBody('not_found', 'nope')));
  };
}

function client(worker: FakeWorker, registered = true): ApiClient {
  const creds = new MemCreds();
  if (registered) creds.c = { playerId: 'a'.repeat(16), secret: 'b'.repeat(32) };
  return new ApiClient({ baseUrl: 'http://test/api/v1', fetch: worker.fetch as typeof fetch, credentials: creds, store: new MemKv(), autoFlush: false, now: () => NOW });
}

async function open(api: ApiClient): Promise<MetaService> {
  return MetaService.open({ content: C, store: new MemoryStore(), api, rng: seededRng(5), now: () => NOW, channel: null });
}

describe('meta cloud layer ↔ net/api.ts ApiClient', () => {
  it('ApiClient satisfies the CloudApi contract (compile-time)', () => {
    const w = new FakeWorker();
    const api: CloudApi = client(w);
    expect(api.hasCredentials()).toBe(true);
  });

  it('first sync creates the cloud save with If-Match "0"; later pushes carry the stored rev', async () => {
    const w = new FakeWorker();
    const svc = await open(client(w));
    svc.settle(makeRun({ victory: true, yeopLeft: 250 }), { submit: false });
    expect(await svc.syncNow()).toEqual({ kind: 'pushed', rev: 1 });
    const put = w.requests.find((r) => r.method === 'PUT');
    expect(put).toMatchObject({ path: '/save', ifMatch: '"0"' });
    expect(put?.auth).toMatch(/^Bearer a{16}\.b{32}$/);
    expect(JSON.parse(w.body).bank.yeop).toBe(250);
    svc.rename('Zed');
    expect(await svc.syncNow()).toEqual({ kind: 'pushed', rev: 2 });
    expect(w.requests.filter((r) => r.method === 'PUT').at(-1)?.ifMatch).toBe('"1"');
  });

  it('a second install pulls it; a stale push surfaces rev_conflict as a conflict', async () => {
    const w = new FakeWorker();
    const a = await open(client(w));
    a.settle(makeRun({ victory: true, yeopLeft: 100 }), { submit: false });
    await a.syncNow();
    const b = await open(client(w));
    expect(await b.syncNow()).toEqual({ kind: 'pulled', rev: 1 });
    expect(b.save.bank.yeop).toBe(100);
    a.settle(makeRun({ yeopLeft: 1 }), { submit: false });
    await a.syncNow(); // rev 2
    b.settle(makeRun({ yeopLeft: 2 }), { submit: false });
    const out = await b.syncNow();
    expect(out.kind).toBe('conflict');
    expect(await b.cloud?.resolveConflict('cloud')).toEqual({ kind: 'pulled', rev: 2 });
    expect(b.save.bank.yeop).toBe(101);
  });

  it('an erasure waits for the sync that is uploading; the sync after it finds no identity and sends nothing', async () => {
    const w = new FakeWorker();
    let release = (): void => undefined;
    w.holdPut = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = client(w);
    const svc = await open(api);
    svc.settle(makeRun({ victory: true, yeopLeft: 250 }), { submit: false });
    const syncing = svc.syncNow();
    await new Promise((r) => setTimeout(r, 10));
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT']); // the upload is on the wire
    const erasing = api.deleteAccount(); // Settings > Privacy > "Delete my cloud data" calls this directly
    await new Promise((r) => setTimeout(r, 10));
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT']); // the erasure has not been sent
    release();
    expect(await syncing).toEqual({ kind: 'pushed', rev: 1 });
    await erasing;
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'DELETE']); // the Worker sees the PUT first, so the erasure removes it
    expect(w.erased).toBe(true);
    expect(w.rev).toBe(0);
    expect(api.hasCredentials()).toBe(false);
    expect(await svc.syncNow()).toEqual({ kind: 'disabled' });
    expect(w.requests).toHaveLength(3);
  });

  it('prod4 I1: an auto-sync queued behind the uploading sync never reads with the credential the erasure is erasing', async () => {
    const w = new FakeWorker();
    let release = (): void => undefined;
    w.holdPut = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseDelete = (): void => undefined;
    w.holdDelete = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const api = client(w);
    const svc = await open(api);
    svc.settle(makeRun({ victory: true, yeopLeft: 250 }), { submit: false });
    const first = svc.syncNow();
    await new Promise((r) => setTimeout(r, 10));
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT']); // the upload is held on the wire
    const second = svc.syncNow(); // the 120 s auto-sync (or the online event) fires meanwhile: queued behind the first
    const erasing = api.deleteAccount();
    await new Promise((r) => setTimeout(r, 10));
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    release();
    expect(await first).toEqual({ kind: 'pushed', rev: 1 });
    await new Promise((r) => setTimeout(r, 10)); // the DELETE is on the wire (credentials still stored), the queued sync is running
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'DELETE']); // no GET /save went out beside it
    releaseDelete();
    // the queued sync finds no identity: the same quiet outcome as a sync started after the erasure, not an error
    expect(await second).toEqual({ kind: 'disabled' });
    await erasing;
    // exactly one request after the DELETE would be a GET with the erased secret (the Worker answers it 401)
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'DELETE']);
    expect(w.requests.slice(0, 2).every((r) => r.auth !== null)).toBe(true);
    expect(w.erased).toBe(true);
    expect(api.hasCredentials()).toBe(false);
    expect(svc.cloud?.state).toMatchObject({ baseRev: 0, lastSyncAt: 0 });
  });

  it('prod4 I1: the refetch after a rev_conflict (412) that an erasure is queued behind is dropped the same way', async () => {
    const w = new FakeWorker();
    let release = (): void => undefined;
    w.holdPut = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = client(w);
    const svc = await open(api);
    svc.settle(makeRun({ victory: true, yeopLeft: 250 }), { submit: false });
    const syncing = svc.syncNow(); // GET -> 204 (no cloud save yet), then PUT If-Match "0" held on the wire
    await new Promise((r) => setTimeout(r, 10));
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    const erasing = api.deleteAccount();
    w.rev = 4; // another device uploaded meanwhile: the PUT answers 412, and the sync would refetch the cloud copy
    w.body = '{}';
    release();
    expect(await syncing).toEqual({ kind: 'disabled' }); // the refetch finds the identity erased instead of reading with it
    await erasing;
    expect(w.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'DELETE']);
    expect(svc.cloud?.conflict).toBeNull();
  });

  it('network failure reads as offline and keeps changes dirty', async () => {
    const w = new FakeWorker();
    const svc = await open(client(w));
    svc.rename('Offline');
    w.down = true;
    expect(await svc.syncNow()).toEqual({ kind: 'offline' });
    expect(svc.cloud?.state.dirty).toBe(true);
    w.down = false;
    expect(await svc.syncNow()).toEqual({ kind: 'pushed', rev: 1 });
  });

  it('registers on demand, submits runs, queues them offline, reads the leaderboard', async () => {
    const w = new FakeWorker();
    const api = client(w, false);
    const svc = await open(api);
    const { summary, submit } = svc.settle(makeRun({ victory: true }), { empire: 'saehwa' });
    expect(await submit).toMatchObject({ kind: 'submitted', result: { rank: 1 } });
    expect(api.hasCredentials()).toBe(true);
    expect(w.runs[0]).toMatchObject({ runId: summary.runId, zone: 'yeonmu', victory: true, empire: 'saehwa' });
    w.down = true;
    const queued = await svc.settle(makeRun()).submit;
    expect(queued.kind).toBe('queued');
    w.down = false;
    const lb = await svc.leaderboard?.fetch({ mode: 'solo', zone: 'yeonmu', difficulty: 'normal', class: 'all', period: 'all', limit: 25 });
    expect(lb).toMatchObject({ ok: true, data: { total: 0 } });
    await svc.submitter?.flush();
    expect(w.runs).toHaveLength(2);
  });

  it('transfer flow end to end', async () => {
    const w = new FakeWorker();
    const donor = await open(client(w));
    donor.settle(makeRun({ victory: true, yeopLeft: 640 }), { submit: false });
    const code = await donor.cloud?.createTransferCode();
    expect(code).toMatchObject({ ok: true, display: 'ABCD-2345' });
    const apiNew = client(w, false);
    const fresh = await open(apiNew);
    const claimed = await fresh.cloud?.claimTransferCode('abcd-2345');
    expect(claimed).toEqual({ ok: true, outcome: { kind: 'pulled', rev: 1 } });
    expect(apiNew.getCredentials()?.playerId).toBe('c'.repeat(16));
    expect(fresh.save.bank.yeop).toBe(640);
  });
});
