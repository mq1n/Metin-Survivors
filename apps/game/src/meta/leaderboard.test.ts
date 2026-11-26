import { CLIENT_VERSION, parseRunSubmission, type LeaderboardQuery } from '@ms/shared/api';
import { describe, expect, it } from 'vitest';
import { ApiClient, StorageCredentialStore, type KeyValueStore } from '../net/api';
import { fixtureContent } from './__fixtures__/content';
import { FakeApiError, FakeCloud } from './__fixtures__/fakeCloud';
import { NOW, freshSave, makeRun } from './__fixtures__/testkit';
import { LeaderboardClient, RunSubmitter, buildRunSubmission, leaderboardKey } from './leaderboard';
import { seededRng } from './rng';
import { settleRun, scoreOf } from './settle';

const C = fixtureContent;
const Q: LeaderboardQuery = { mode: 'solo', zone: 'yeonmu', difficulty: 'normal', class: 'all', period: 'all', limit: 25 };

function settled(over: Parameters<typeof makeRun>[0] = {}) {
  const run = makeRun({ bossesKilled: ['yeonmu_boss1'], ...over });
  const { summary } = settleRun(freshSave(), C, run, seededRng(8), NOW);
  return { run, summary };
}

describe('buildRunSubmission', () => {
  it('maps a settled run to a valid POST /runs body', () => {
    const { run, summary } = settled({ victory: true, time: 905.1234567, level: 41, seed: 4294967295 });
    const body = buildRunSubmission(run, summary, { endedAt: NOW, empire: 'chowon', sex: 'f' });
    expect(body).not.toBeNull();
    if (!body) return;
    expect(body).toMatchObject({
      runId: summary.runId,
      clientVersion: CLIENT_VERSION,
      zone: 'yeonmu',
      difficulty: 'normal',
      classId: 'warrior',
      doctrine: 'a',
      empire: 'chowon',
      sex: 'f',
      seed: 4294967295,
      victory: true,
      endedAt: NOW,
      score: scoreOf(run),
      stats: { kills: 500, elites: 10, bosses: 1, metins: 4, level: 41, yeop: 4000 },
    });
    expect(body.duration).toBeCloseTo(905.123, 3);
    expect(parseRunSubmission(JSON.parse(JSON.stringify(body))).ok).toBe(true);
  });

  it('omits optional identity fields when unknown and clamps odd seeds / durations', () => {
    const { run, summary } = settled({ seed: -5, time: 99999 });
    const body = buildRunSubmission(run, summary, { endedAt: NOW });
    expect(body).not.toBeNull();
    expect(body && 'empire' in body).toBe(false);
    expect(body?.seed).toBeGreaterThanOrEqual(0);
    expect(body?.duration).toBeLessThanOrEqual(7200);
  });

  it('solo runs carry no `coop`; party runs carry the party size (clamped to the API range)', () => {
    const solo = settled();
    expect(buildRunSubmission(solo.run, solo.summary, { endedAt: NOW })).not.toHaveProperty('coop');
    const party = (n: number) => Array.from({ length: n }, (_, index) => ({ index, level: 30, kills: 100, yeop: 500, alive: index === 0 }));
    for (const n of [2, 3, 4]) {
      const { run, summary } = settled({ players: party(n) });
      expect(buildRunSubmission(run, summary, { endedAt: NOW })).toMatchObject({ coop: n });
    }
    const crowd = settled({ players: party(9) });
    expect(buildRunSubmission(crowd.run, crowd.summary, { endedAt: NOW })).toMatchObject({ coop: 4 });
  });

  it('refuses runs the server could never accept (unknown zone)', () => {
    const { run, summary } = settled({ zone: 'atlantis' });
    expect(buildRunSubmission(run, summary, { endedAt: NOW })).toBeNull();
  });
});

describe('RunSubmitter', () => {
  it('submits and returns the server result', async () => {
    const api = new FakeCloud();
    api.credentials = true;
    const { run, summary } = settled();
    const out = await new RunSubmitter(api).submit(run, summary, { endedAt: NOW });
    expect(out).toMatchObject({ kind: 'submitted', result: { rank: 1, status: 'ok' } });
    expect(api.server.runs).toHaveLength(1);
    expect(api.server.runs[0]?.runId).toBe(summary.runId);
  });

  it('registers an anonymous player on demand with a valid profile name', async () => {
    const api = new FakeCloud();
    const { run, summary } = settled();
    expect((await new RunSubmitter(api).submit(run, summary, { endedAt: NOW, profileName: 'Ejder Kral' })).kind).toBe('submitted');
    expect(api.registered).toEqual(['Ejder Kral']);
    const api2 = new FakeCloud();
    await new RunSubmitter(api2).submit(run, summary, { endedAt: NOW, profileName: 'x' }); // too short for the API
    expect(api2.registered).toEqual([undefined]);
  });

  it('autoRegister:false stays offline-from-leaderboard', async () => {
    const api = new FakeCloud();
    const { run, summary } = settled();
    expect(await new RunSubmitter(api).submit(run, summary, { endedAt: NOW, autoRegister: false })).toEqual({ kind: 'skipped', reason: 'noCredentials' });
    expect(api.calls).toEqual([]);
  });

  it('queues when offline or the server is struggling, rejects permanent errors', async () => {
    const { run, summary } = settled();
    const api = new FakeCloud();
    api.credentials = true;
    api.offline = true;
    expect(await new RunSubmitter(api).submit(run, summary, { endedAt: NOW })).toEqual({ kind: 'queued' });
    expect(api.queued).toHaveLength(1);

    // First offline run with NO credentials yet: registration fails offline, but the run MUST still be stored in the queue
    // and delivered once connectivity returns and flush() runs.
    const freshOffline = new FakeCloud();
    freshOffline.offline = true;
    const submitter = new RunSubmitter(freshOffline);
    expect(await submitter.submit(run, summary, { endedAt: NOW, profileName: 'İlk Koşu' })).toEqual({ kind: 'queued' });
    expect(freshOffline.queued).toHaveLength(1);
    expect(freshOffline.queued[0]?.runId).toBe(summary.runId);
    freshOffline.offline = false;
    await submitter.flush();
    expect(freshOffline.credentials).toBe(true);
    expect(freshOffline.queued).toHaveLength(0);
    expect(freshOffline.server.runs.map((r) => r.runId)).toEqual([summary.runId]);

    const flaky = new FakeCloud();
    flaky.credentials = true;
    flaky.failNext = new FakeApiError(503, 'unavailable');
    expect((await new RunSubmitter(flaky).submit(run, summary, { endedAt: NOW })).kind).toBe('queued');
    expect(flaky.queued).toHaveLength(1);

    const strict = new FakeCloud();
    strict.credentials = true;
    strict.failNext = new FakeApiError(422, 'implausible_run');
    expect(await new RunSubmitter(strict).submit(run, summary, { endedAt: NOW })).toMatchObject({ kind: 'rejected', failure: { kind: 'rejected', code: 'implausible_run' } });
  });

  it('skips invalid payloads and flushes the queue on request', async () => {
    const api = new FakeCloud();
    api.credentials = true;
    const bad = settled({ zone: 'atlantis' });
    const s = new RunSubmitter(api);
    expect(await s.submit(bad.run, bad.summary, { endedAt: NOW })).toEqual({ kind: 'skipped', reason: 'invalid' });
    await s.flush();
    expect(api.flushed).toBe(1);
  });

  it('persists the first offline run BEFORE registration so it survives reload and flushes once, including on 429 and 503 (NET-05)', async () => {
    class MemKv implements KeyValueStore {
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

    const scenarios: { name: string; regMode: 'offline' | 429 | 503 }[] = [
      { name: 'offline', regMode: 'offline' },
      { name: 'registration 429', regMode: 429 },
      { name: 'registration 503', regMode: 503 },
    ];

    for (const sc of scenarios) {
      const credStore = new MemKv();
      const queueStore = new MemKv();
      const delivered: string[] = [];
      let healthy = false;
      const makeFetch = (): typeof fetch =>
        (async (url: string | URL | Request, init?: RequestInit) => {
          const u = String(url);
          if (!healthy) {
            if (sc.regMode === 'offline') throw new TypeError('Failed to fetch');
            const code = sc.regMode === 429 ? 'rate_limited' : 'unavailable';
            return new Response(JSON.stringify({ error: { code, message: sc.name } }), {
              status: sc.regMode,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (u.endsWith('/players')) {
            return new Response(JSON.stringify({ playerId: 'A'.repeat(16), secret: 'b'.repeat(32), name: 'İlk Koşu' }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (u.endsWith('/runs')) {
            const parsed = JSON.parse(String(init?.body)) as { runId: string; score?: number };
            delivered.push(parsed.runId);
            return new Response(
              JSON.stringify({
                id: delivered.length,
                score: parsed.score ?? 100,
                status: 'ok',
                mode: 'solo',
                flags: [],
                duplicate: false,
                best: true,
                bestScore: parsed.score ?? 100,
                rank: 1,
                weekRank: 1,
                classRank: 1,
              }),
              { status: 201, headers: { 'content-type': 'application/json' } },
            );
          }
          return new Response('{}', { status: 404 });
        }) as typeof fetch;

      const api1 = new ApiClient({
        baseUrl: 'https://api.example/api/v1',
        fetch: makeFetch(),
        credentials: new StorageCredentialStore(credStore),
        store: queueStore,
        autoFlush: false,
        now: () => NOW,
      });
      const { run, summary } = settled();
      const out = await new RunSubmitter(api1).submit(run, summary, { endedAt: NOW, profileName: 'İlk Koşu' });
      expect(out, sc.name).toEqual({ kind: 'queued' });
      expect(api1.hasCredentials(), sc.name).toBe(false);
      expect(api1.pendingRuns(), sc.name).toBe(1);

      // Simulate full page reload: brand-new ApiClient + RunSubmitter over the same persistent stores.
      healthy = true;
      const api2 = new ApiClient({
        baseUrl: 'https://api.example/api/v1',
        fetch: makeFetch(),
        credentials: new StorageCredentialStore(credStore),
        store: queueStore,
        autoFlush: false,
        now: () => NOW,
      });
      expect(api2.pendingRuns(), sc.name).toBe(1);
      await new RunSubmitter(api2).flush();
      expect(api2.hasCredentials(), sc.name).toBe(true);
      expect(api2.pendingRuns(), sc.name).toBe(0);
      expect(delivered, sc.name).toEqual([summary.runId]);
    }
  });

  it('never falsely claims queued when queue storage throws QuotaExceededError (NET-05)', async () => {
    const quotaError = (): DOMException => new DOMException('Quota exceeded', 'QuotaExceededError');
    const throwingStore: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw quotaError();
      },
      removeItem: () => undefined,
    };
    const credStore: KeyValueStore = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    // Unregistered + offline + quota failure on queueStore -> must return failed/storage, NEVER queued.
    const offlineApi = new ApiClient({
      baseUrl: 'https://api.example/api/v1',
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
      credentials: new StorageCredentialStore(credStore),
      store: throwingStore,
      autoFlush: false,
      now: () => NOW,
    });
    const { run, summary } = settled();
    const out1 = await new RunSubmitter(offlineApi).submit(run, summary, { endedAt: NOW });
    expect(out1.kind).toBe('failed');
    expect(out1).toMatchObject({ kind: 'failed', reason: 'storage' });
    expect(offlineApi.pendingRuns()).toBe(0);

    // Unregistered + registration 503 + quota failure -> must return failed/storage, NEVER queued.
    const reg503Api = new ApiClient({
      baseUrl: 'https://api.example/api/v1',
      fetch: (async () => new Response(JSON.stringify({ error: { code: 'unavailable', message: 'down' } }), { status: 503 })) as typeof fetch,
      credentials: new StorageCredentialStore(credStore),
      store: throwingStore,
      autoFlush: false,
      now: () => NOW,
    });
    const out2 = await new RunSubmitter(reg503Api).submit(run, summary, { endedAt: NOW });
    expect(out2).toMatchObject({ kind: 'failed', reason: 'storage' });

    // Registered + FakeCloud with failStorage + offline -> must return failed/storage, NEVER queued.
    const fake = new FakeCloud();
    fake.credentials = true;
    fake.offline = true;
    fake.failStorage = quotaError();
    const out3 = await new RunSubmitter(fake).submit(run, summary, { endedAt: NOW });
    expect(out3).toMatchObject({ kind: 'failed', reason: 'storage' });
    expect(fake.queued).toHaveLength(0);
  });
});

describe('LeaderboardClient', () => {
  const clock = { t: 10_000 };

  it('caches within the TTL, refetches after it or when forced', async () => {
    const api = new FakeCloud();
    const lb = new LeaderboardClient(api, () => clock.t, 30_000);
    expect(await lb.fetch(Q)).toMatchObject({ ok: true, stale: false });
    await lb.fetch(Q);
    expect(api.calls.filter((c) => c === 'leaderboard')).toHaveLength(1);
    clock.t += 31_000;
    await lb.fetch(Q);
    expect(api.calls.filter((c) => c === 'leaderboard')).toHaveLength(2);
    await lb.fetch(Q, true);
    expect(api.calls.filter((c) => c === 'leaderboard')).toHaveLength(3);
    await lb.fetch({ ...Q, class: 'ninja' });
    expect(api.calls.filter((c) => c === 'leaderboard')).toHaveLength(4);
  });

  it('de-duplicates concurrent identical requests', async () => {
    const api = new FakeCloud();
    const lb = new LeaderboardClient(api, () => clock.t);
    await Promise.all([lb.fetch(Q), lb.fetch(Q), lb.fetch(Q)]);
    expect(api.calls.filter((c) => c === 'leaderboard')).toHaveLength(1);
  });

  it('serves the last page marked stale when the network fails, else a classified failure', async () => {
    const api = new FakeCloud();
    const lb = new LeaderboardClient(api, () => clock.t, 1000);
    const first = await lb.fetch(Q);
    expect(first.ok).toBe(true);
    clock.t += 5000;
    api.offline = true;
    expect(await lb.fetch(Q)).toMatchObject({ ok: true, stale: true, failure: { kind: 'offline' } });
    expect(await lb.fetch({ ...Q, zone: 'seori' })).toMatchObject({ ok: false, failure: { kind: 'offline' } });
    lb.clear();
    expect(await lb.fetch(Q)).toMatchObject({ ok: false });
  });

  it('keys by every query field', () => {
    expect(leaderboardKey(Q)).toBe('solo|yeonmu|normal|all|all|25');
    expect(leaderboardKey({ ...Q, period: 'week', limit: 10 })).toBe('solo|yeonmu|normal|all|week|10');
    expect(leaderboardKey({ ...Q, mode: 'coop' })).toBe('coop|yeonmu|normal|all|all|25');
  });
});
