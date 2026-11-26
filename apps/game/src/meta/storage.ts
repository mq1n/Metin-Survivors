// Persistence: a tiny key/value abstraction (IndexedDB → localStorage → memory fallback chain) and the
// SaveRepository that stores the save with atomic writes, integrity checksums and last-good-copy recovery.
//
// Write path (one atomic transaction): main ← new record; bak ← previous main (only if it verified);
// snap ← previous main when the snapshot is older than SNAPSHOT_EVERY_MS (a slow-moving fallback in case a logic
// bug writes a *valid but wrong* save that then rotates into bak). Load path: main → bak → snap, first that
// verifies (checksum + migrate + normalize) wins; the unreadable raw is kept under `save.corrupt` for rescue.

import { checksum, SaveError } from './errors';
import { migrateSave } from './migrations';
import { normalizeSave, type NormalizeOptions } from './save';
import type { MetaContent, SaveData } from './types';

export interface TxWrites {
  set?: Record<string, string>;
  remove?: readonly string[];
}

export interface KeyValueStore {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  get(key: string): Promise<string | undefined>;
  /** Atomic read-modify-write: `fn` runs synchronously with the current values of `readKeys` and returns the writes. */
  transact(readKeys: readonly string[], fn: (current: Record<string, string | undefined>) => TxWrites | undefined): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  readonly kind = 'memory';
  readonly data = new Map<string, string>();

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.data.get(key));
  }

  transact(readKeys: readonly string[], fn: (current: Record<string, string | undefined>) => TxWrites | undefined): Promise<void> {
    try {
      const current: Record<string, string | undefined> = {};
      for (const k of readKeys) current[k] = this.data.get(k);
      const w = fn(current);
      if (w?.set) for (const [k, v] of Object.entries(w.set)) this.data.set(k, v);
      if (w?.remove) for (const k of w.remove) this.data.delete(k);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }
}

export class LocalStorageStore implements KeyValueStore {
  readonly kind = 'localstorage';
  constructor(
    private readonly storage: Storage,
    private readonly prefix = 'ms.meta.',
  ) {}

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.storage.getItem(this.prefix + key) ?? undefined);
  }

  transact(readKeys: readonly string[], fn: (current: Record<string, string | undefined>) => TxWrites | undefined): Promise<void> {
    try {
      const current: Record<string, string | undefined> = {};
      for (const k of readKeys) current[k] = this.storage.getItem(this.prefix + k) ?? undefined;
      const w = fn(current);
      const touched = [...Object.keys(w?.set ?? {}), ...(w?.remove ?? [])];
      const undo = new Map<string, string | null>(touched.map((k) => [k, this.storage.getItem(this.prefix + k)]));
      try {
        for (const [k, v] of Object.entries(w?.set ?? {})) this.storage.setItem(this.prefix + k, v);
        for (const k of w?.remove ?? []) this.storage.removeItem(this.prefix + k);
      } catch (e) {
        // quota exceeded half-way: restore every key we touched so the save is never left half-written
        for (const [k, v] of undo) {
          if (v === null) this.storage.removeItem(this.prefix + k);
          else this.storage.setItem(this.prefix + k, v);
        }
        throw e;
      }
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }
}

export class IdbStore implements KeyValueStore {
  readonly kind = 'indexeddb';
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly dbName = 'metin-survivors',
    private readonly storeName = 'kv',
  ) {}

  private open(): Promise<IDBDatabase> {
    this.dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(this.storeName)) req.result.createObjectStore(this.storeName);
      };
      req.onsuccess = () => {
        const db = req.result;
        // another tab upgrading / deleting the DB: drop our handle, reopen lazily on next use
        db.onversionchange = () => {
          db.close();
          this.dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB open blocked'));
    }).catch((e: unknown) => {
      this.dbp = null;
      throw e;
    });
    return this.dbp;
  }

  async get(key: string): Promise<string | undefined> {
    const db = await this.open();
    return new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : undefined);
      req.onerror = () => reject(req.error ?? new Error('indexedDB read failed'));
    });
  }

  async transact(readKeys: readonly string[], fn: (current: Record<string, string | undefined>) => TxWrites | undefined): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const current: Record<string, string | undefined> = {};
      let pending = readKeys.length;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
      const apply = (): void => {
        try {
          const w = fn(current);
          if (w?.set) for (const [k, v] of Object.entries(w.set)) store.put(v, k);
          if (w?.remove) for (const k of w.remove) store.delete(k);
        } catch (e) {
          tx.abort();
          reject(e);
        }
      };
      if (pending === 0) apply();
      for (const key of readKeys) {
        const req = store.get(key);
        req.onsuccess = () => {
          current[key] = typeof req.result === 'string' ? req.result : undefined;
          if (--pending === 0) apply();
        };
      }
    });
  }
}

/** IndexedDB if usable (probed with a real read), else localStorage, else memory (progress lasts the session). */
export async function openBestStore(): Promise<KeyValueStore> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const store = new IdbStore(indexedDB);
      await store.get('probe');
      return store;
    } catch {
      /* private mode / blocked: fall through */
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const probe = '__ms_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return new LocalStorageStore(localStorage);
    } catch {
      /* storage disabled */
    }
  }
  return new MemoryStore();
}

// ---------------------------------------------------------------------------
// Records

export const SAVE_RECORD_FORMAT = 1;
const KEY_MAIN = 'save.main';
const KEY_BAK = 'save.bak';
const KEY_SNAP = 'save.snap';
const KEY_CORRUPT = 'save.corrupt';
const KEY_SYNC = 'sync.meta';
/** The slow snapshot refreshes at most this often. */
export const SNAPSHOT_EVERY_MS = 6 * 60 * 60 * 1000;

interface RecordEnvelope {
  f: number;
  /** ms since epoch the record was written */
  t: number;
  /** checksum of `d` */
  c: string;
  /** JSON text of SaveData */
  d: string;
}

export function encodeRecord(save: SaveData, now: number): string {
  const d = JSON.stringify(save);
  const env: RecordEnvelope = { f: SAVE_RECORD_FORMAT, t: now, c: checksum(d), d };
  return JSON.stringify(env);
}

/** Verifies the envelope + checksum and returns the parsed (still untrusted) save JSON. Throws SaveError. */
export function decodeRecord(raw: string): { data: unknown; writtenAt: number } {
  let env: unknown;
  try {
    env = JSON.parse(raw);
  } catch {
    throw new SaveError('format', 'record is not JSON');
  }
  if (typeof env !== 'object' || env === null || !('d' in env) || !('c' in env) || !('f' in env) || !('t' in env)) {
    throw new SaveError('format', 'record envelope malformed');
  }
  if (env.f !== SAVE_RECORD_FORMAT) throw new SaveError('format', `unknown record format ${String(env.f)}`);
  if (typeof env.d !== 'string' || typeof env.c !== 'string') throw new SaveError('format', 'record envelope malformed');
  if (checksum(env.d) !== env.c) throw new SaveError('checksum', 'record checksum mismatch');
  let data: unknown;
  try {
    data = JSON.parse(env.d);
  } catch {
    throw new SaveError('format', 'record payload is not JSON');
  }
  return { data, writtenAt: typeof env.t === 'number' ? env.t : 0 };
}

export interface LoadResult {
  /** null when there is nothing usable (fresh install, or every copy unreadable) */
  save: SaveData | null;
  source: 'main' | 'backup' | 'snapshot' | 'none';
  /** true when the primary copy was unreadable and an older copy was used */
  recovered: boolean;
  /** true when stored data existed but none of it could be read */
  corrupt: boolean;
  /** why the primary copy failed, if it did */
  problem?: string;
  /** SaveData.version found in the stored copy before migration */
  fromVersion?: number;
  /** repairs applied by normalizeSave */
  repairs: string[];
}

export interface SyncMeta {
  /** cloud rev this device last synced at (0 = never) */
  baseRev: number;
  /** local changes not yet pushed */
  dirty: boolean;
  lastSyncAt: number;
}

export const EMPTY_SYNC_META: SyncMeta = { baseRev: 0, dirty: false, lastSyncAt: 0 };

export class SaveRepository {
  constructor(
    readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async load(content: MetaContent, normalize: NormalizeOptions = {}): Promise<LoadResult> {
    const raws: [LoadResult['source'], string | undefined][] = [
      ['main', await this.store.get(KEY_MAIN)],
      ['backup', await this.store.get(KEY_BAK)],
      ['snapshot', await this.store.get(KEY_SNAP)],
    ];
    let problem: string | undefined;
    let sawData = false;
    let primaryFailed = false;
    for (const [source, raw] of raws) {
      if (raw === undefined) continue;
      sawData = true;
      try {
        const { data } = decodeRecord(raw);
        const migrated = migrateSave(data);
        const fromVersion = typeof data === 'object' && data !== null && 'version' in data && typeof data.version === 'number' ? data.version : 0;
        const repairs: string[] = [];
        const save = normalizeSave(migrated, content, { ...normalize, repairs });
        if (source !== 'main' || primaryFailed) {
          return { save, source, recovered: true, corrupt: false, ...(problem !== undefined ? { problem } : {}), fromVersion, repairs };
        }
        return { save, source, recovered: false, corrupt: false, fromVersion, repairs };
      } catch (e) {
        problem ??= e instanceof Error ? e.message : String(e);
        if (source === 'main') primaryFailed = true;
        // a save from a NEWER build must not be overwritten by an older client: surface instead of recovering
        if (e instanceof SaveError && e.code === 'tooNew') throw e;
        if (source === 'main') await this.stashCorrupt(raw);
      }
    }
    return { save: null, source: 'none', recovered: false, corrupt: sawData, ...(problem !== undefined ? { problem } : {}), repairs: [] };
  }

  private async stashCorrupt(raw: string): Promise<void> {
    try {
      await this.store.transact([], () => ({ set: { [KEY_CORRUPT]: raw } }));
    } catch {
      /* best effort */
    }
  }

  /** The raw unreadable main record last seen (for a "rescue / report" flow), if any. */
  readCorrupt(): Promise<string | undefined> {
    return this.store.get(KEY_CORRUPT);
  }

  /** Atomically writes the save and rotates the previous good copy into backup (+ slow snapshot). */
  async save(save: SaveData): Promise<void> {
    const now = this.now();
    const record = encodeRecord(save, now);
    await this.store.transact([KEY_MAIN, KEY_SNAP], (cur) => {
      const set: Record<string, string> = { [KEY_MAIN]: record };
      const prev = cur[KEY_MAIN];
      if (prev !== undefined && isValidRecord(prev)) {
        set[KEY_BAK] = prev;
        const snap = cur[KEY_SNAP];
        if (snap === undefined || now - recordTime(snap) >= SNAPSHOT_EVERY_MS) set[KEY_SNAP] = prev;
      }
      return { set };
    });
  }

  async readSyncMeta(): Promise<SyncMeta> {
    const raw = await this.store.get(KEY_SYNC);
    if (raw === undefined) return { ...EMPTY_SYNC_META };
    try {
      const v: unknown = JSON.parse(raw);
      if (typeof v === 'object' && v !== null) {
        const baseRev = 'baseRev' in v && typeof v.baseRev === 'number' && v.baseRev >= 0 ? Math.floor(v.baseRev) : 0;
        const dirty = 'dirty' in v && v.dirty === true;
        const lastSyncAt = 'lastSyncAt' in v && typeof v.lastSyncAt === 'number' ? v.lastSyncAt : 0;
        return { baseRev, dirty, lastSyncAt };
      }
    } catch {
      /* fall through */
    }
    return { ...EMPTY_SYNC_META };
  }

  async writeSyncMeta(meta: SyncMeta): Promise<void> {
    await this.store.transact([], () => ({ set: { [KEY_SYNC]: JSON.stringify(meta) } }));
  }

  /** Wipes every meta key (profile reset). Cloud data is untouched. */
  async clear(): Promise<void> {
    await this.store.transact([], () => ({ remove: [KEY_MAIN, KEY_BAK, KEY_SNAP, KEY_CORRUPT, KEY_SYNC] }));
  }
}

function isValidRecord(raw: string): boolean {
  try {
    decodeRecord(raw);
    return true;
  } catch {
    return false;
  }
}

function recordTime(raw: string): number {
  try {
    return decodeRecord(raw).writtenAt;
  } catch {
    return 0;
  }
}
