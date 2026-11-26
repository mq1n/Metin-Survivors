import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { NOW, freshSave, makeRun } from './__fixtures__/testkit';
import { SaveError, checksum } from './errors';
import { seededRng } from './rng';
import { settleRun } from './settle';
import {
  IdbStore,
  LocalStorageStore,
  MemoryStore,
  SNAPSHOT_EVERY_MS,
  SaveRepository,
  decodeRecord,
  encodeRecord,
  type KeyValueStore,
} from './storage';
import { SAVE_VERSION, type SaveData } from './types';

const C = fixtureContent;

class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  /** throw QuotaExceeded on the Nth setItem call (1-based) from now; 0 = never */
  failOnSet = 0;
  private sets = 0;
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  setItem(k: string, v: string): void {
    this.sets++;
    if (this.failOnSet && this.sets === this.failOnSet) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
}

const stores: [string, () => KeyValueStore][] = [
  ['memory', () => new MemoryStore()],
  ['localStorage', () => new LocalStorageStore(new FakeStorage())],
  ['indexedDB (fake-indexeddb)', () => new IdbStore(new IDBFactory(), `db-${Math.random()}`)],
];

describe.each(stores)('KeyValueStore contract: %s', (_name, make) => {
  it('reads what was written, undefined otherwise', async () => {
    const s = make();
    expect(await s.get('a')).toBeUndefined();
    await s.transact([], () => ({ set: { a: '1', b: '2' } }));
    expect(await s.get('a')).toBe('1');
    expect(await s.get('b')).toBe('2');
  });

  it('transact is a read-modify-write on the current values', async () => {
    const s = make();
    await s.transact([], () => ({ set: { n: '1' } }));
    let seen: Record<string, string | undefined> = {};
    await s.transact(['n', 'missing'], (cur) => {
      seen = cur;
      return { set: { n: String(Number(cur.n) + 1) }, remove: ['gone'] };
    });
    expect(seen).toEqual({ n: '1', missing: undefined });
    expect(await s.get('n')).toBe('2');
  });

  it('removes keys', async () => {
    const s = make();
    await s.transact([], () => ({ set: { a: '1', b: '2' } }));
    await s.transact([], () => ({ remove: ['a'] }));
    expect(await s.get('a')).toBeUndefined();
    expect(await s.get('b')).toBe('2');
  });

  it('a throwing callback writes nothing', async () => {
    const s = make();
    await s.transact([], () => ({ set: { a: 'keep' } }));
    await expect(
      s.transact(['a'], () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await s.get('a')).toBe('keep');
  });

  it('serialises concurrent read-modify-writes', async () => {
    const s = make();
    await s.transact([], () => ({ set: { n: '0' } }));
    await Promise.all(Array.from({ length: 20 }, () => s.transact(['n'], (c) => ({ set: { n: String(Number(c.n) + 1) } }))));
    expect(await s.get('n')).toBe('20');
  });
});

describe('LocalStorageStore atomicity', () => {
  it('restores every touched key when a write fails half-way (quota)', async () => {
    const fake = new FakeStorage();
    const s = new LocalStorageStore(fake);
    await s.transact([], () => ({ set: { a: 'old-a', b: 'old-b' } }));
    fake.failOnSet = 4; // the 4th setItem overall (2nd of this transaction) throws
    await expect(s.transact([], () => ({ set: { a: 'new-a', b: 'new-b' } }))).rejects.toThrow(/Quota/);
    expect(await s.get('a')).toBe('old-a');
    expect(await s.get('b')).toBe('old-b');
  });
});

describe.each(stores)('SaveRepository on %s', (_name, make) => {
  const clock = { t: NOW };
  const repo = (store: KeyValueStore): SaveRepository => new SaveRepository(store, () => clock.t);
  const played = (): SaveData => settleRun(freshSave(), C, makeRun({ yeopLeft: 321 }), seededRng(1), NOW).save;

  it('fresh install: nothing found, not corrupt', async () => {
    const r = await repo(make()).load(C);
    expect(r).toMatchObject({ save: null, source: 'none', recovered: false, corrupt: false });
  });

  it('round-trips a save exactly', async () => {
    const store = make();
    const save = played();
    await repo(store).save(save);
    const r = await repo(store).load(C, { now: NOW });
    expect(r.source).toBe('main');
    expect(r.recovered).toBe(false);
    expect(r.save).toEqual(save);
    expect(r.fromVersion).toBe(SAVE_VERSION);
  });

  it('keeps the previous good copy as backup and recovers from a corrupted primary', async () => {
    const store = make();
    const v1 = freshSave();
    const v2 = played();
    const r = repo(store);
    await r.save(v1);
    await r.save(v2);
    expect((await r.load(C)).save).toEqual(v2);
    // corrupt the primary record (valid JSON envelope, wrong checksum)
    const main = await store.get('save.main');
    expect(main).toBeDefined();
    const broken = JSON.stringify({ ...JSON.parse(main as string), c: '00000000000000' });
    await store.transact([], () => ({ set: { 'save.main': broken } }));
    const rec = await r.load(C);
    expect(rec).toMatchObject({ source: 'backup', recovered: true, corrupt: false });
    expect(rec.problem).toMatch(/checksum/);
    expect(rec.save).toEqual(v1);
    expect(await r.readCorrupt()).toBe(broken);
  });

  it('a corrupted primary is never rotated into the backup', async () => {
    const store = make();
    const r = repo(store);
    await r.save(freshSave());
    await r.save(played()); // bak = fresh, main = played
    const bakBefore = await store.get('save.bak');
    await store.transact([], () => ({ set: { 'save.main': 'garbage{' } }));
    await r.save(played());
    expect(await store.get('save.bak')).toBe(bakBefore);
    expect((await r.load(C)).source).toBe('main');
  });

  it('truncated / non-JSON primary falls back, everything unreadable reports corrupt', async () => {
    const store = make();
    const r = repo(store);
    await r.save(freshSave());
    await r.save(played());
    await store.transact([], () => ({ set: { 'save.main': '{"f":1,"t":1,"c":"x","d":"{\\"vers' } }));
    expect((await r.load(C)).recovered).toBe(true);
    await store.transact([], () => ({ set: { 'save.main': 'nope', 'save.bak': 'nope', 'save.snap': '{}' } }));
    const dead = await r.load(C);
    expect(dead).toMatchObject({ save: null, source: 'none', corrupt: true });
    expect(dead.problem).toBeDefined();
  });

  it('never silently downgrades a save written by a newer build', async () => {
    const store = make();
    const r = repo(store);
    await r.save(freshSave());
    const future = encodeRecord({ ...freshSave(), version: SAVE_VERSION + 1 }, NOW);
    await store.transact([], () => ({ set: { 'save.main': future } }));
    await expect(r.load(C)).rejects.toMatchObject({ code: 'tooNew' });
    expect(await store.get('save.main')).toBe(future);
    expect(await r.readCorrupt()).toBeUndefined();
  });

  it('migrates an old stored version on load', async () => {
    const store = make();
    const v0 = { profile: { id: 'x', name: 'Old', created: 1 }, classes: { warrior: { xp: 300, gear: { weapon: { id: 'yeonmu_weapon_warrior', plus: 2 } }, collection: [] } }, bank: { yeop: 5, shards: 0 } };
    const raw = JSON.stringify(v0);
    // hand-built record with a valid checksum
    await store.transact([], () => ({ set: { 'save.main': JSON.stringify({ f: 1, t: NOW, c: checksum(raw), d: raw }) } }));
    const r = await repo(store).load(C, { now: NOW });
    expect(r.fromVersion).toBe(0);
    expect(r.save?.version).toBe(SAVE_VERSION);
    expect(r.save?.classes.warrior.plus).toEqual({ yeonmu_weapon_warrior: 2 });
    expect(r.save?.classes.warrior.gear.weapon).toBe('yeonmu_weapon_warrior');
  });

  it('refreshes the slow snapshot only every SNAPSHOT_EVERY_MS', async () => {
    const store = make();
    const r = repo(store);
    const snapT = async (): Promise<number> => decodeRecord((await store.get('save.snap')) as string).writtenAt;
    clock.t = NOW;
    await r.save(freshSave()); // no previous main: no snapshot yet
    expect(await store.get('save.snap')).toBeUndefined();
    clock.t = NOW + 1000;
    await r.save(freshSave()); // prev main (written NOW) becomes the first snapshot
    expect(await snapT()).toBe(NOW);
    clock.t = NOW + SNAPSHOT_EVERY_MS - 5000;
    await r.save(freshSave());
    expect(await snapT()).toBe(NOW);
    clock.t = NOW + SNAPSHOT_EVERY_MS + 10;
    await r.save(freshSave());
    expect(await snapT()).toBe(NOW + SNAPSHOT_EVERY_MS - 5000);
  });

  it('restores from the snapshot when main and backup are both bad', async () => {
    const store = make();
    const r = repo(store);
    clock.t = NOW;
    const first = freshSave();
    await r.save(first);
    clock.t = NOW + 10;
    await r.save(played());
    await store.transact([], () => ({ set: { 'save.main': 'bad', 'save.bak': 'bad' } }));
    const rec = await r.load(C, { now: NOW });
    expect(rec).toMatchObject({ source: 'snapshot', recovered: true });
    expect(rec.save).toEqual(first);
  });

  it('stores sync metadata separately and tolerates garbage', async () => {
    const store = make();
    const r = repo(store);
    expect(await r.readSyncMeta()).toEqual({ baseRev: 0, dirty: false, lastSyncAt: 0 });
    await r.writeSyncMeta({ baseRev: 7, dirty: true, lastSyncAt: 99 });
    expect(await r.readSyncMeta()).toEqual({ baseRev: 7, dirty: true, lastSyncAt: 99 });
    await store.transact([], () => ({ set: { 'sync.meta': '{{{' } }));
    expect(await r.readSyncMeta()).toEqual({ baseRev: 0, dirty: false, lastSyncAt: 0 });
    await r.save(freshSave());
    await r.clear();
    expect(await r.load(C)).toMatchObject({ save: null, corrupt: false });
  });

  it('record encoding round-trips and rejects tampering', () => {
    const s = played();
    const enc = encodeRecord(s, 5);
    expect(decodeRecord(enc)).toMatchObject({ data: s, writtenAt: 5 });
    expect(() => decodeRecord(enc.replace('yeop', 'yanG'))).toThrowError(SaveError);
    expect(() => decodeRecord('[]')).toThrowError(SaveError);
    expect(() => decodeRecord('{"f":2,"t":1,"c":"x","d":"{}"}')).toThrowError(/format/);
  });
});
