import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { FakeApiError, FakeCloud, FakeServer } from './__fixtures__/fakeCloud';
import { NOW, freshSave, makeRun } from './__fixtures__/testkit';
import {
  CloudSync,
  classifyCloudError,
  formatTransferCode,
  hasProgress,
  sameProgress,
  summarizeSave,
  type CloudApi,
  type SyncOutcome,
} from './cloud';
import { seededRng } from './rng';
import { settleRun } from './settle';
import { MemoryStore, SaveRepository } from './storage';
import type { SaveData } from './types';

const C = fixtureContent;

/** One device: live save + sync engine over a shared server. */
class Device {
  save: SaveData;
  counter = 0;
  readonly cloud: FakeCloud;
  readonly repo = new SaveRepository(new MemoryStore(), () => NOW);
  sync!: CloudSync;
  onAdopt: (() => Promise<void> | void) | null = null;

  constructor(server: FakeServer, save: SaveData = freshSave(), registered = true) {
    this.save = save;
    this.cloud = new FakeCloud(server);
    this.cloud.credentials = registered;
  }

  static async create(server: FakeServer, save?: SaveData, registered = true): Promise<Device> {
    const d = new Device(server, save, registered);
    d.sync = await CloudSync.create(
      d.cloud as CloudApi,
      {
        content: C,
        getSave: () => d.save,
        revision: () => d.counter,
        adoptSave: async (s) => {
          d.save = s;
          d.counter++;
          await d.onAdopt?.();
        },
      },
      d.repo,
      () => NOW,
    );
    return d;
  }

  /** play a run locally (mutates the live save, marks dirty) */
  async play(yeopLeft: number, classId: 'warrior' | 'ninja' = 'warrior'): Promise<void> {
    this.save = settleRun(this.save, C, makeRun({ yeopLeft, classId }), seededRng(yeopLeft), NOW).save;
    this.counter++;
    await this.sync.markDirty();
  }
}

const kinds = (o: SyncOutcome): string => o.kind;

describe('first sync', () => {
  it('is disabled until an identity exists; enable() registers once', async () => {
    const d = await Device.create(new FakeServer(), freshSave(), false);
    expect(kinds(await d.sync.sync())).toBe('disabled');
    expect(d.sync.enabled).toBe(false);
    expect(await d.sync.enable('Hero')).toEqual({ ok: true });
    expect(await d.sync.enable('Hero')).toEqual({ ok: true });
    expect(d.cloud.registered).toEqual(['Hero']);
    expect(d.sync.enabled).toBe(true);
  });

  it('pushes the local save when the cloud has none, then reports up-to-date', async () => {
    const server = new FakeServer();
    const d = await Device.create(server);
    await d.play(100);
    expect(await d.sync.sync()).toEqual({ kind: 'pushed', rev: 1 });
    expect(JSON.parse(server.save?.body ?? '{}').bank.yeop).toBe(100);
    expect(d.sync.state).toMatchObject({ baseRev: 1, dirty: false });
    expect(await d.repo.readSyncMeta()).toMatchObject({ baseRev: 1, dirty: false });
    expect(await d.sync.sync()).toEqual({ kind: 'upToDate', rev: 1 });
    expect(d.cloud.calls.filter((c) => c === 'putSave')).toHaveLength(1);
  });

  it('pushes subsequent local changes with If-Match = last synced rev', async () => {
    const server = new FakeServer();
    const d = await Device.create(server);
    await d.play(100);
    await d.sync.sync();
    await d.play(50);
    expect(await d.sync.sync()).toEqual({ kind: 'pushed', rev: 2 });
    expect(JSON.parse(server.save?.body ?? '{}').bank.yeop).toBe(150);
  });
});

describe('two devices', () => {
  it('a fresh device pulls the cloud save automatically', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    await a.play(500);
    await a.sync.sync();
    const b = await Device.create(server, freshSave(2));
    expect(await b.sync.sync()).toEqual({ kind: 'pulled', rev: 1 });
    expect(b.save.bank.yeop).toBe(500);
    expect(b.sync.state).toMatchObject({ baseRev: 1, dirty: false });
  });

  it('when only the cloud moved, the synced device takes it without asking', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    await a.play(100);
    await a.sync.sync();
    const b = await Device.create(server, freshSave(2));
    await b.sync.sync();
    await a.play(100);
    await a.sync.sync(); // rev 2
    expect(await b.sync.sync()).toEqual({ kind: 'pulled', rev: 2 });
    expect(b.save.bank.yeop).toBe(200);
  });

  it('when both moved, surfaces a conflict with both summaries — and keeps surfacing it', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    const b = await Device.create(server, freshSave(2));
    await a.play(100);
    await a.sync.sync();
    await b.sync.sync(); // pulls rev 1
    await a.play(1000);
    await a.sync.sync(); // cloud rev 2: yeop 1100
    await b.play(7); // local 107, dirty
    const out = await b.sync.sync();
    expect(out.kind).toBe('conflict');
    if (out.kind !== 'conflict') return;
    expect(out.conflict).toMatchObject({ cloudRev: 2, local: { yeop: 107 }, cloud: { yeop: 1100 } });
    expect(b.sync.conflict).toEqual(out.conflict);
    expect(kinds(await b.sync.sync())).toBe('conflict'); // no silent overwrite on retry
    expect(b.save.bank.yeop).toBe(107);
    expect(server.save?.rev).toBe(2);
  });

  it('conflict → take cloud: local replaced, no push', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    const b = await Device.create(server, freshSave(2));
    await a.play(100);
    await a.sync.sync();
    await b.sync.sync();
    await a.play(900);
    await a.sync.sync();
    await b.play(7);
    await b.sync.sync();
    expect(await b.sync.resolveConflict('cloud')).toEqual({ kind: 'pulled', rev: 2 });
    expect(b.save.bank.yeop).toBe(1000);
    expect(b.sync.conflict).toBeNull();
    expect(b.sync.state).toMatchObject({ baseRev: 2, dirty: false });
    expect(server.save?.rev).toBe(2);
  });

  it('conflict → keep local: overwrites the cloud (If-Match its rev) and the other device follows', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    const b = await Device.create(server, freshSave(2));
    await a.play(100);
    await a.sync.sync();
    await b.sync.sync();
    await a.play(900);
    await a.sync.sync();
    await b.play(7);
    await b.sync.sync();
    expect(await b.sync.resolveConflict('local')).toEqual({ kind: 'pushed', rev: 3 });
    expect(JSON.parse(server.save?.body ?? '{}').bank.yeop).toBe(107);
    expect(b.sync.conflict).toBeNull();
    expect(await a.sync.sync()).toEqual({ kind: 'pulled', rev: 3 });
    expect(a.save.bank.yeop).toBe(107);
  });

  it('a push that loses the race (rev_conflict) becomes a conflict with the fresh cloud copy', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    const b = await Device.create(server, freshSave(2));
    await a.play(100);
    await a.sync.sync();
    await b.sync.sync();
    await b.play(5);
    // after b read rev 1 (no change), a sneaks in a write before b's PUT lands
    server.beforePut = () => {
      server.beforePut = null;
      server.save = { rev: 2, body: JSON.stringify({ ...a.save, bank: { yeop: 4242, shards: 0 } }), updatedAt: 9 };
    };
    const out = await b.sync.sync();
    expect(out.kind).toBe('conflict');
    if (out.kind === 'conflict') expect(out.conflict).toMatchObject({ cloudRev: 2, cloud: { yeop: 4242 } });
    expect(await b.sync.resolveConflict('cloud')).toEqual({ kind: 'pulled', rev: 2 });
    expect(b.save.bank.yeop).toBe(4242);
  });

  it('first link of a device with progress against an existing cloud save asks, even without dirty flag', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    await a.play(100);
    await a.sync.sync();
    const b = await Device.create(server, settleRun(freshSave(2), C, makeRun({ yeopLeft: 9 }), seededRng(1), NOW).save);
    expect(b.sync.state.dirty).toBe(false);
    expect(kinds(await b.sync.sync())).toBe('conflict');
  });

  it('identical progress under different revisions is not a conflict', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    await a.play(100);
    await a.sync.sync();
    const b = await Device.create(server, structuredClone(a.save));
    await b.sync.markDirty();
    expect(await b.sync.sync()).toEqual({ kind: 'upToDate', rev: 1 });
    expect(b.sync.state).toMatchObject({ baseRev: 1, dirty: false });
  });

  it('device settings never decide equality', () => {
    const a = freshSave();
    const b = structuredClone(a);
    b.settings = { ...b.settings, masterVolume: 0.1 };
    b.profile.updated += 999;
    expect(sameProgress(a, b)).toBe(true);
    b.bank.yeop = 1;
    expect(sameProgress(a, b)).toBe(false);
  });
});

describe('failure handling', () => {
  it('offline: stays dirty and syncs later', async () => {
    const server = new FakeServer();
    const d = await Device.create(server);
    await d.play(100);
    d.cloud.offline = true;
    expect(await d.sync.sync()).toEqual({ kind: 'offline' });
    expect(d.sync.state.dirty).toBe(true);
    d.cloud.offline = false;
    expect(await d.sync.sync()).toEqual({ kind: 'pushed', rev: 1 });
  });

  it('server errors map to a classified failure', async () => {
    const d = await Device.create(new FakeServer());
    d.cloud.failNext = new FakeApiError(503, 'unavailable');
    expect(await d.sync.sync()).toMatchObject({ kind: 'error', failure: { kind: 'server', status: 503 } });
    d.cloud.failNext = new FakeApiError(429, 'rate_limited');
    expect(await d.sync.sync()).toMatchObject({ kind: 'error', failure: { kind: 'rateLimited' } });
  });

  it('a cloud save from a newer game version is incompatible, never overwritten', async () => {
    const server = new FakeServer();
    server.save = { rev: 4, body: JSON.stringify({ ...freshSave(), version: 99 }), updatedAt: 1 };
    const d = await Device.create(server);
    await d.play(10);
    expect(kinds(await d.sync.sync())).toBe('incompatible');
    expect(d.cloud.calls).not.toContain('putSave');
  });

  it('an unreadable cloud blob is reported, not applied', async () => {
    const server = new FakeServer();
    server.save = { rev: 1, body: '<<not json>>', updatedAt: 1 };
    const d = await Device.create(server);
    const out = await d.sync.sync();
    expect(out).toMatchObject({ kind: 'error', failure: { code: 'bad_cloud_save' } });
    expect(d.save.bank.yeop).toBe(0);
  });

  it('edits made while the PUT is in flight stay dirty', async () => {
    const server = new FakeServer();
    const d = await Device.create(server);
    await d.play(100);
    server.beforePut = () => {
      server.beforePut = null;
      d.counter++; // the player kept playing
    };
    expect(await d.sync.sync()).toEqual({ kind: 'pushed', rev: 1 });
    expect(d.sync.state).toMatchObject({ baseRev: 1, dirty: true });
  });

  it('a concurrent local edit during cloud adoption is not cleared as clean', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    await a.play(250);
    await a.sync.sync();

    const b = await Device.create(server, freshSave(2));
    b.onAdopt = async () => {
      b.onAdopt = null;
      // Player makes a new local edit while adoptSave is still settling (e.g. awaiting disk flush).
      await b.play(77);
    };
    expect(await b.sync.sync()).toEqual({ kind: 'pulled', rev: 1 });
    expect(b.sync.state).toMatchObject({ baseRev: 1, dirty: true });
    // Because dirty stayed true, the next sync pushes the concurrent edit to rev 2.
    expect(await b.sync.sync()).toEqual({ kind: 'pushed', rev: 2 });
    expect(JSON.parse(server.save?.body ?? '{}').bank.yeop).toBeGreaterThan(250);
  });

  it('serialises concurrent sync() calls', async () => {
    const server = new FakeServer();
    const d = await Device.create(server);
    await d.play(100);
    const results = await Promise.all([d.sync.sync(), d.sync.sync(), d.sync.sync()]);
    expect(results.map(kinds)).toEqual(['pushed', 'upToDate', 'upToDate']);
    expect(d.cloud.calls.filter((c) => c === 'putSave')).toHaveLength(1);
  });

  it('notifies subscribers of every outcome', async () => {
    const d = await Device.create(new FakeServer());
    const seen: string[] = [];
    const off = d.sync.subscribe((o) => seen.push(o.kind));
    await d.play(1);
    await d.sync.sync();
    await d.sync.sync();
    off();
    await d.sync.sync();
    expect(seen).toEqual(['pushed', 'upToDate']);
  });
});

describe('an identity erased on this device (net/api.ts deleteAccount clears the credentials)', () => {
  /** device b holds a pending conflict against a cloud copy of 1100 yeop; its own save has 107 */
  async function conflicted(): Promise<{ server: FakeServer; b: Device }> {
    const server = new FakeServer();
    const a = await Device.create(server);
    const b = await Device.create(server, freshSave(2));
    await a.play(100);
    await a.sync.sync();
    await b.sync.sync();
    await a.play(1000);
    await a.sync.sync();
    await b.play(7);
    expect(kinds(await b.sync.sync())).toBe('conflict');
    expect(b.sync.state.baseRev).toBe(1);
    return { server, b };
  }

  it('the pending conflict is void: choosing "cloud copy" cannot bring the erased account\'s data back', async () => {
    const { server, b } = await conflicted();
    b.cloud.credentials = false;
    server.save = null; // the Worker erased it
    expect(b.sync.conflict).toBeNull();
    expect(kinds(await b.sync.resolveConflict('cloud'))).toBe('upToDate');
    expect(b.save.bank.yeop).toBe(107); // not the erased copy's 1100
  });

  it('the next identity starts like a first link: no stale revision, no stale conflict, a plain first upload', async () => {
    const { server, b } = await conflicted();
    b.cloud.credentials = false;
    server.save = null;
    expect(kinds(await b.sync.sync())).toBe('disabled');
    expect(b.sync.state).toMatchObject({ baseRev: 0, lastSyncAt: 0 });
    expect(b.sync.conflict).toBeNull();
    expect(await b.sync.enable()).toEqual({ ok: true });
    expect(await b.sync.sync()).toEqual({ kind: 'pushed', rev: 1 });
    const uploaded = server.save as FakeServer['save']; // (not narrowed to the null assigned above)
    expect(uploaded?.rev).toBe(1);
    expect(JSON.parse(uploaded?.body ?? '{}').bank.yeop).toBe(107);
  });

  it('a sync() that was waiting behind an erasure finds no identity instead of pushing', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    await a.play(100);
    await a.sync.sync();
    await a.play(50);
    a.cloud.credentials = false;
    const calls = a.cloud.calls.length;
    expect(kinds(await a.sync.sync())).toBe('disabled');
    expect(a.cloud.calls.length).toBe(calls);
    expect(server.save?.rev).toBe(1);
  });
});

describe('an erasure that lands while a sync request is waiting for its turn (prod4 I1)', () => {
  /** the client's write chain ran the DELETE ahead of the request: the identity is gone when the request's turn comes */
  const erasedAhead = (d: Device, method: 'getSave' | 'putSave'): void => {
    d.cloud[method] = (): Promise<never> => {
      d.cloud.credentials = false;
      return Promise.reject(new FakeApiError(401, 'unauthorized'));
    };
  };

  it('the cloud read: reports disabled (not an error), and the next identity starts like a first link', async () => {
    const server = new FakeServer();
    const d = await Device.create(server);
    await d.play(100);
    await d.sync.sync();
    expect(d.sync.state.baseRev).toBe(1);
    await d.play(5);
    erasedAhead(d, 'getSave');
    const seen: string[] = [];
    d.sync.subscribe((o) => seen.push(o.kind));
    expect(kinds(await d.sync.sync())).toBe('disabled');
    expect(seen).toEqual(['disabled']); // listeners (the UI) never see an unauthorized error
    expect(d.sync.state).toMatchObject({ baseRev: 0, lastSyncAt: 0 });
    expect(d.sync.conflict).toBeNull();
  });

  it('the upload: reports disabled too', async () => {
    const server = new FakeServer();
    const d = await Device.create(server);
    await d.play(100);
    erasedAhead(d, 'putSave');
    expect(kinds(await d.sync.sync())).toBe('disabled');
    expect(server.save).toBeNull();
  });

  it('a 401 with the identity still stored stays an unauthorized error (the server really rejected it)', async () => {
    const d = await Device.create(new FakeServer());
    await d.play(100);
    d.cloud.failNext = new FakeApiError(401, 'unauthorized');
    expect(await d.sync.sync()).toMatchObject({ kind: 'error', failure: { kind: 'unauthorized' } });
    expect(d.sync.enabled).toBe(true);
  });
});

describe('transfer codes', () => {
  it('create: pushes the latest save first, then returns a displayable code', async () => {
    const server = new FakeServer();
    const d = await Device.create(server, freshSave(), false);
    await d.play(321);
    const r = await d.sync.createTransferCode('Hero');
    expect(r).toMatchObject({ ok: true, code: 'ABCD2345', display: 'ABCD-2345' });
    expect(d.cloud.registered).toEqual(['Hero']);
    expect(JSON.parse(server.save?.body ?? '{}').bank.yeop).toBe(321);
    expect(d.cloud.calls.indexOf('putSave')).toBeLessThan(d.cloud.calls.indexOf('createTransfer'));
  });

  it('create: refuses (with the outcome) while a conflict is unresolved', async () => {
    const server = new FakeServer();
    const a = await Device.create(server);
    await a.play(100);
    await a.sync.sync();
    const b = await Device.create(server, settleRun(freshSave(2), C, makeRun({ yeopLeft: 9 }), seededRng(1), NOW).save);
    const r = await b.sync.createTransferCode();
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ outcome: { kind: 'conflict' } });
    expect(b.cloud.calls).not.toContain('createTransfer');
  });

  it('claim: validates the code locally, adopts the identity, and pulls the donor save', async () => {
    const server = new FakeServer();
    const donor = await Device.create(server);
    await donor.play(777);
    const code = await donor.sync.createTransferCode();
    expect(code.ok).toBe(true);
    const fresh = await Device.create(server, freshSave(9), false);
    expect(await fresh.sync.claimTransferCode('abc')).toMatchObject({ ok: false, failure: { kind: 'invalidCode' } });
    expect(fresh.cloud.calls).not.toContain('claimTransfer');
    const r = await fresh.sync.claimTransferCode(' abcd-2345 ');
    expect(r).toEqual({ ok: true, outcome: { kind: 'pulled', rev: 1 } });
    expect(fresh.save.bank.yeop).toBe(777);
    expect(fresh.sync.enabled).toBe(true);
  });

  it('claim on a device with progress raises the conflict choice', async () => {
    const server = new FakeServer();
    const donor = await Device.create(server);
    await donor.play(777);
    await donor.sync.createTransferCode();
    const other = await Device.create(server, settleRun(freshSave(4), C, makeRun({ yeopLeft: 5 }), seededRng(2), NOW).save, false);
    const r = await other.sync.claimTransferCode('ABCD2345');
    expect(r).toMatchObject({ ok: true, outcome: { kind: 'conflict' } });
  });

  it('claim: a wrong/expired code is an invalidCode failure', async () => {
    const d = await Device.create(new FakeServer(), freshSave(), false);
    expect(await d.sync.claimTransferCode('ZZZZ9999')).toMatchObject({ ok: false, failure: { kind: 'invalidCode' } });
  });

  it('formats codes', () => {
    expect(formatTransferCode('abcd 2345')).toBe('ABCD-2345');
    expect(formatTransferCode('SHORT')).toBe('SHORT');
  });
});

describe('error classification', () => {
  const k = (e: unknown): string => classifyCloudError(e).kind;
  it('maps ApiError-shaped errors and fetch failures', () => {
    expect(k(new FakeApiError(0, 'network'))).toBe('offline');
    expect(k(new FakeApiError(0, 'timeout'))).toBe('offline');
    expect(k(new TypeError('Failed to fetch'))).toBe('offline');
    expect(classifyCloudError(new FakeApiError(412, 'rev_conflict', { currentRev: 9 }))).toMatchObject({ kind: 'conflict', currentRev: 9 });
    expect(k(new FakeApiError(401, 'unauthorized'))).toBe('unauthorized');
    expect(k(new FakeApiError(403, 'banned'))).toBe('unauthorized');
    expect(k(new FakeApiError(429, 'rate_limited'))).toBe('rateLimited');
    expect(k(new FakeApiError(426, 'upgrade_required'))).toBe('outdated');
    expect(k(new FakeApiError(400, 'invalid_code'))).toBe('invalidCode');
    expect(k(new FakeApiError(422, 'implausible_run'))).toBe('rejected');
    expect(k(new FakeApiError(500, 'internal'))).toBe('server');
    expect(k('weird')).toBe('unknown');
    expect(k(null)).toBe('unknown');
  });
});

describe('summaries', () => {
  it('summarises and detects progress', () => {
    const s = freshSave();
    expect(hasProgress(s)).toBe(false);
    const played = settleRun(s, C, makeRun({ victory: true, yeopLeft: 50 }), seededRng(1), NOW).save;
    expect(hasProgress(played)).toBe(true);
    expect(summarizeSave(played)).toMatchObject({ name: 'Tester', runs: 1, wins: 1, yeop: 50, zonesUnlocked: 2, version: 1 });
    expect(summarizeSave(played).talentPoints).toBeGreaterThan(0);
  });
});

describe('stalled CloudApi deadline & chain recovery (NET-06)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds a hanging getSave so subsequent sync / enable / transfer operations are never wedged', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const d = await Device.create(server);
    // Recreate with a short opTimeoutMs for deterministic fake-timer testing.
    d.sync = await CloudSync.create(
      d.cloud as CloudApi,
      {
        content: C,
        getSave: () => d.save,
        revision: () => d.counter,
        adoptSave: async (s) => {
          d.save = s;
          d.counter++;
        },
      },
      d.repo,
      () => NOW,
      50,
    );
    await d.play(300);

    // First sync hangs forever inside getSave (simulating a stalled response body on a custom CloudApi).
    const hung: { resolve: ((v: null) => void) | null } = { resolve: null };
    const origGetSave = d.cloud.getSave.bind(d.cloud);
    let hangFirst = true;
    d.cloud.getSave = () => {
      if (hangFirst) {
        hangFirst = false;
        return new Promise((r) => {
          hung.resolve = r;
        });
      }
      return origGetSave();
    };

    const first = d.sync.sync();
    // Queue a second sync right behind the hung one: its timeout MUST NOT expire while waiting behind the first.
    const second = d.sync.sync();
    await vi.advanceTimersByTimeAsync(55);
    expect(await first).toEqual({ kind: 'offline' });
    // Chain released cleanly: the queued second sync executes and pushes the save to rev 1!
    expect(await second).toEqual({ kind: 'pushed', rev: 1 });
    expect(JSON.parse(server.save?.body ?? '{}').bank.yeop).toBe(300);

    // Late resolution of the timed-out first getSave MUST NOT corrupt synced state or trigger stale uploads.
    hung.resolve?.(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(d.sync.state).toMatchObject({ baseRev: 1, dirty: false });
    expect(server.save?.rev).toBe(1);

    // Transfer code creation also proceeds unimpeded on the same chain.
    const xfer = await d.sync.createTransferCode();
    expect(xfer).toMatchObject({ ok: true, code: 'ABCD2345' });
  });

  it('bounds a hanging register() inside enable() and lets a retry succeed', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const d = await Device.create(server, freshSave(), false);
    d.sync = await CloudSync.create(
      d.cloud as CloudApi,
      {
        content: C,
        getSave: () => d.save,
        revision: () => d.counter,
        adoptSave: async (s) => {
          d.save = s;
          d.counter++;
        },
      },
      d.repo,
      () => NOW,
      40,
    );
    const origRegister = d.cloud.register.bind(d.cloud);
    let hangFirst = true;
    d.cloud.register = (name) => {
      if (hangFirst) {
        hangFirst = false;
        return new Promise(() => undefined);
      }
      return origRegister(name);
    };

    const first = d.sync.enable('Hero');
    const retry = d.sync.enable('Hero');
    await vi.advanceTimersByTimeAsync(45);
    expect(await first).toMatchObject({ ok: false, failure: { kind: 'offline', code: 'timeout' } });
    expect(await retry).toEqual({ ok: true });
    expect(d.sync.enabled).toBe(true);
  });
});
