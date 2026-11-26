// Cloud sync (ARCHITECTURE §10): pull/push of the save blob with server revisions, conflict surfacing, and the
// transfer-code flow. The network is behind `CloudApi` (satisfied by net/api.ts `ApiClient`), so this module is
// unit-testable with a fake.
//
// Conflict policy — "newest rev wins, with an explicit choice when both sides moved":
//   · only the cloud moved (cloud.rev > baseRev, no local changes) → take the cloud copy automatically
//   · only this device moved (cloud.rev == baseRev, dirty)            → push (If-Match baseRev)
//   · both moved (or first link of a device that already has progress against an existing cloud save, or the
//     push was rejected with rev_conflict)                            → outcome 'conflict' with both summaries;
//     the UI calls `resolveConflict('local' | 'cloud')`.
// Device settings (quality, volume, …) are never overwritten by a cloud copy.

import {
  isTransferCode,
  normalizeCode,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type RegisterResponse,
  type RenameResponse,
  type RunResponse,
  type RunSubmission,
  type SaveMeta,
  type TransferClaimResponse,
  type TransferCreateResponse,
} from '@ms/shared/api';
import { SaveError } from './errors';
import { migrateSave } from './migrations';
import { normalizeSave } from './save';
import { earnedPoints, spentTotal, talentCap } from './talents';
import type { SaveRepository, SyncMeta } from './storage';
import { CLASS_IDS, type MetaContent, type SaveData } from './types';

/** The HTTP client surface the meta layer needs (net/api.ts `ApiClient` implements it). */
export interface CloudApi {
  hasCredentials(): boolean;
  register(name?: string): Promise<RegisterResponse>;
  rename(name: string): Promise<RenameResponse>;
  /** null when the player has no cloud save yet; `unchanged: true` on 304 when `ifNoneMatchRev` matched (skips R2 read). */
  getSave(ifNoneMatchRev?: number): Promise<{ meta: SaveMeta; body: string; unchanged?: true } | null>;
  /** `ifMatchRev` 0 = no cloud save yet. Rejects with code 'rev_conflict' when the server moved on. */
  putSave(body: string, ifMatchRev: number): Promise<SaveMeta>;
  createTransfer(): Promise<TransferCreateResponse>;
  claimTransfer(code: string): Promise<TransferClaimResponse>;
  submitRun(run: RunSubmission): Promise<RunResponse>;
  /** submit, or persist for a later retry when the network is down (net/api.ts owns the offline queue) */
  submitRunQueued(run: RunSubmission): Promise<{ status: 'submitted'; result: RunResponse } | { status: 'queued' }>;
  /** durably persist a validated run into the local offline queue before network/registration attempts */
  enqueueRun?(run: RunSubmission): number;
  /** remove a previously queued run by id (e.g. after direct delivery or permanent rejection) */
  dequeueRun?(runId: string): void;
  flushRunQueue(): Promise<unknown>;
  pendingRuns?(): number;
  leaderboard(query: LeaderboardQuery): Promise<LeaderboardResponse>;
}

// ---------------------------------------------------------------------------
// Error classification

export type CloudFailureKind =
  | 'offline'
  | 'unauthorized'
  | 'rateLimited'
  | 'conflict'
  | 'invalidCode'
  | 'outdated'
  | 'rejected'
  | 'server'
  | 'unknown';

export interface CloudFailure {
  kind: CloudFailureKind;
  status?: number;
  code?: string;
  message: string;
  retryAfterSec?: number;
  /** rev_conflict: the cloud's current rev */
  currentRev?: number;
}

/** Maps net/api.ts `ApiError` (duck-typed) and raw fetch failures to a UI-friendly failure. */
export function classifyCloudError(e: unknown): CloudFailure {
  const message = e instanceof Error ? e.message : String(e);
  if (typeof e === 'object' && e !== null) {
    const status = 'status' in e && typeof e.status === 'number' ? e.status : undefined;
    const code = 'code' in e && typeof e.code === 'string' ? e.code : undefined;
    const details = 'details' in e && typeof e.details === 'object' && e.details !== null ? e.details : undefined;
    const retryAfterSec = 'retryAfterSec' in e && typeof e.retryAfterSec === 'number' ? e.retryAfterSec : undefined;
    const base = { message, ...(status !== undefined ? { status } : {}), ...(code !== undefined ? { code } : {}), ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) };
    if (code === 'storage') return { kind: 'unknown', ...base };
    if (status === 0 || code === 'network' || code === 'timeout') return { kind: 'offline', ...base };
    if (code === 'rev_conflict' || status === 412 || status === 409) {
      const rev = details && 'currentRev' in details && typeof details.currentRev === 'number' ? details.currentRev : undefined;
      return { kind: 'conflict', ...base, ...(rev !== undefined ? { currentRev: rev } : {}) };
    }
    if (code === 'invalid_code' || code === 'not_found') return { kind: code === 'invalid_code' ? 'invalidCode' : 'unknown', ...base };
    if (code === 'unauthorized' || code === 'forbidden' || code === 'banned' || status === 401 || status === 403) return { kind: 'unauthorized', ...base };
    if (code === 'rate_limited' || status === 429) return { kind: 'rateLimited', ...base };
    if (code === 'client_outdated' || code === 'upgrade_required') return { kind: 'outdated', ...base };
    if (status !== undefined && status >= 500) return { kind: 'server', ...base };
    if (status !== undefined && status >= 400) return { kind: 'rejected', ...base };
    if (e instanceof TypeError) return { kind: 'offline', message };
  }
  return { kind: 'unknown', message };
}

// ---------------------------------------------------------------------------
// Summaries (what the conflict dialog compares)

export interface SaveSummary {
  name: string;
  /** ms since epoch of the last change */
  updated: number;
  runs: number;
  wins: number;
  playTime: number;
  bestScore: number;
  yeop: number;
  shards: number;
  /** talent points earned across classes */
  talentPoints: number;
  /** gear pieces owned across classes */
  gearOwned: number;
  zonesUnlocked: number;
  version: number;
}

export function summarizeSave(save: SaveData): SaveSummary {
  let talentPoints = 0;
  let gearOwned = 0;
  const cap = talentCap(save); // Hard clears raise it (MT-02): the points above 40 are earned points too
  for (const c of CLASS_IDS) {
    talentPoints += earnedPoints(save.classes[c], cap);
    gearOwned += save.classes[c].collection.length;
  }
  return {
    name: save.profile.name,
    updated: save.profile.updated,
    runs: save.stats.runs,
    wins: save.stats.wins,
    playTime: save.stats.playTime,
    bestScore: save.stats.bestScore,
    yeop: save.bank.yeop,
    shards: save.bank.shards,
    talentPoints,
    gearOwned,
    zonesUnlocked: save.unlocks.zones.length,
    version: save.version,
  };
}

/** True when the profile has any earned progress (a brand-new profile is safe to overwrite from the cloud). */
export function hasProgress(save: SaveData): boolean {
  if (save.stats.runs > 0 || save.bank.yeop > 0 || save.bank.shards > 0) return true;
  for (const c of CLASS_IDS) {
    const cs = save.classes[c];
    if (cs.xp > 0 || cs.collection.length > 0 || spentTotal(cs) > 0) return true;
  }
  return false;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const entries = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Content equality ignoring device settings and the last-modified stamp. */
export function sameProgress(a: SaveData, b: SaveData): boolean {
  const strip = (s: SaveData): string => stable({ ...s, settings: null, profile: { ...s.profile, updated: 0 } });
  return strip(a) === strip(b);
}

// ---------------------------------------------------------------------------
// Sync engine

export interface SyncConflict {
  local: SaveSummary;
  cloud: SaveSummary;
  cloudRev: number;
  cloudUpdatedAt: number;
}

export type SyncOutcome =
  /** no credentials yet: call `enable()` first */
  | { kind: 'disabled' }
  | { kind: 'upToDate'; rev: number }
  | { kind: 'pulled'; rev: number }
  | { kind: 'pushed'; rev: number }
  | { kind: 'conflict'; conflict: SyncConflict }
  /** the cloud save was written by a newer game version */
  | { kind: 'incompatible'; reason: string }
  | { kind: 'offline' }
  | { kind: 'error'; failure: CloudFailure };

export interface CloudSyncHost {
  content: MetaContent;
  /** the live save */
  getSave(): SaveData;
  /** counter that changes on every local mutation (detects edits made while a push is in flight) */
  revision(): number;
  /** replace the live save with a cloud copy (host keeps device settings) */
  adoptSave(save: SaveData): Promise<void>;
}

interface PendingCloud {
  save: SaveData;
  rev: number;
  updatedAt: number;
}

export type TransferCodeResult =
  | { ok: true; code: string; display: string; expiresAt: number }
  | { ok: false; failure: CloudFailure }
  | { ok: false; failure?: undefined; outcome: SyncOutcome };

export type ClaimResult = { ok: true; outcome: SyncOutcome } | { ok: false; failure: CloudFailure };

/** `ABCD-EFGH` display form of a transfer code. */
export function formatTransferCode(code: string): string {
  const c = normalizeCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Upper bound for a single CloudSync operation once it begins executing (guards against hung CloudApi / body reads). */
export const CLOUD_OP_TIMEOUT_MS = 45_000;

export class CloudSync {
  private meta: SyncMeta;
  private pending: PendingCloud | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private metaWrites: Promise<void> = Promise.resolve();
  private dirtyEpoch = 0;
  private opSeq = 0;
  private listeners = new Set<(o: SyncOutcome) => void>();

  constructor(
    private readonly api: CloudApi,
    private readonly host: CloudSyncHost,
    private readonly repo: SaveRepository,
    initial: SyncMeta,
    private readonly now: () => number = Date.now,
    private readonly opTimeoutMs: number = CLOUD_OP_TIMEOUT_MS,
  ) {
    this.meta = { ...initial };
  }

  static async create(
    api: CloudApi,
    host: CloudSyncHost,
    repo: SaveRepository,
    now: () => number = Date.now,
    opTimeoutMs: number = CLOUD_OP_TIMEOUT_MS,
  ): Promise<CloudSync> {
    return new CloudSync(api, host, repo, await repo.readSyncMeta(), now, opTimeoutMs);
  }

  get state(): Readonly<SyncMeta> {
    return this.meta;
  }

  /** The conflict awaiting a user decision, if any. */
  get conflict(): SyncConflict | null {
    const p = this.livePending();
    return p ? this.describe(p) : null;
  }

  /**
   * The surfaced conflict, unless the identity it was surfaced for is gone (the account was erased on this device, see
   * net/api.ts `deleteAccount`): then it is void - taking "the cloud copy" would bring the erased account's data back
   * into the live save, and a later new identity must start from a clean state.
   */
  private livePending(): PendingCloud | null {
    if (this.pending && !this.api.hasCredentials()) this.pending = null;
    return this.pending;
  }

  get enabled(): boolean {
    return this.api.hasCredentials();
  }

  subscribe(fn: (o: SyncOutcome) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Serialises sync operations so triggers (timer, online event, button) never interleave. Each operation's timeout clock
   * starts ONLY once it begins executing (not while queued), and a timed-out operation releases the chain while marking
   * itself stale so any late resolution cannot mutate state or emit stale outcomes.
   */
  private run<T>(fn: (isStale: () => boolean) => Promise<T>, onTimeout: (err: Error) => T): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((r) => {
      release = r;
    });
    return (async (): Promise<T> => {
      await prev;
      const opId = ++this.opSeq;
      let timedOut = false;
      const isStale = (): boolean => timedOut || this.opSeq !== opId;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<T>((resolve, reject) => {
          let settled = false;
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            timedOut = true;
            const err = Object.assign(new Error('Cloud sync operation timed out'), { status: 0, code: 'timeout' });
            resolve(onTimeout(err));
          }, this.opTimeoutMs);
          Promise.resolve()
            .then(() => fn(isStale))
            .then(
              (val) => {
                if (settled) return;
                settled = true;
                resolve(val);
              },
              (err) => {
                if (settled) return;
                settled = true;
                reject(err);
              },
            );
        });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        release();
      }
    })();
  }

  private emit(o: SyncOutcome): SyncOutcome {
    for (const l of this.listeners) l(o);
    return o;
  }

  private setMeta(patch: Partial<SyncMeta>): Promise<void> {
    const next = { ...this.meta, ...patch };
    this.meta = next;
    const write = this.metaWrites.then(() => this.repo.writeSyncMeta(next));
    this.metaWrites = write.catch(() => undefined);
    return write;
  }

  /** Records a local change (the host calls this after every persisted mutation). */
  markDirty(): Promise<void> {
    this.dirtyEpoch += 1;
    if (this.meta.dirty) return Promise.resolve();
    return this.setMeta({ dirty: true });
  }

  /** Registers an anonymous cloud identity if this device has none. */
  enable(name?: string): Promise<{ ok: true } | { ok: false; failure: CloudFailure }> {
    return this.run(
      async () => {
        if (this.api.hasCredentials()) return { ok: true } as const;
        try {
          await this.api.register(name);
          return { ok: true } as const;
        } catch (e) {
          return { ok: false, failure: classifyCloudError(e) } as const;
        }
      },
      (err) => ({ ok: false, failure: classifyCloudError(err) }) as const,
    );
  }

  /** Reconciles local and cloud as described in the module header. */
  sync(): Promise<SyncOutcome> {
    return this.run(
      async (isStale) => {
        const out = await this.doSync(isStale);
        return isStale() ? out : this.emit(out);
      },
      () => this.emit({ kind: 'offline' }),
    );
  }

  private async doSync(isStale: () => boolean = () => false): Promise<SyncOutcome> {
    if (!this.api.hasCredentials()) {
      // no identity (never linked, or erased on this device): a conflict and the revision we synced against belonged to an
      // identity that is gone, so the next one starts like a first link
      this.pending = null;
      if (this.meta.baseRev !== 0 || this.meta.lastSyncAt !== 0) await this.setMeta({ baseRev: 0, lastSyncAt: 0 });
      return { kind: 'disabled' };
    }
    if (this.pending) return { kind: 'conflict', conflict: this.describe(this.pending) };
    const dirtyAtStart = this.dirtyEpoch;
    const localAtStart = this.host.getSave();
    let cloud: { meta: SaveMeta; body: string; unchanged?: true } | null;
    try {
      cloud = await this.api.getSave(this.meta.baseRev > 0 ? this.meta.baseRev : undefined);
    } catch (e) {
      return isStale() ? { kind: 'offline' } : this.failOrErased(e, isStale);
    }
    if (isStale()) return { kind: 'offline' };
    if (!cloud) return this.push(0, isStale);
    if (cloud.unchanged) {
      const rev = cloud.meta.rev || this.meta.baseRev;
      return this.meta.dirty ? this.push(rev, isStale) : { kind: 'upToDate', rev };
    }

    const parsed = this.parseCloud(cloud.body);
    if ('outcome' in parsed) return parsed.outcome;
    const rev = cloud.meta.rev;
    const incoming: PendingCloud = { save: parsed.save, rev, updatedAt: cloud.meta.updatedAt };
    const local = this.host.getSave();

    if (rev === this.meta.baseRev) return this.meta.dirty ? this.push(rev, isStale) : { kind: 'upToDate', rev };
    // the cloud differs from what we last synced against
    const movedDuringFetch = this.dirtyEpoch !== dirtyAtStart || !sameProgress(localAtStart, local);
    if (sameProgress(local, incoming.save) && !movedDuringFetch) {
      await this.setMeta({ baseRev: rev, dirty: false, lastSyncAt: this.now() });
      return { kind: 'upToDate', rev };
    }
    const localMoved = this.meta.dirty || movedDuringFetch || (this.meta.baseRev === 0 && hasProgress(local));
    if (!localMoved) return this.adopt(incoming, isStale);
    this.pending = incoming;
    return { kind: 'conflict', conflict: this.describe(incoming) };
  }

  private describe(p: PendingCloud): SyncConflict {
    return { local: summarizeSave(this.host.getSave()), cloud: summarizeSave(p.save), cloudRev: p.rev, cloudUpdatedAt: p.updatedAt };
  }

  private parseCloud(body: string): { save: SaveData } | { outcome: SyncOutcome } {
    try {
      const data: unknown = JSON.parse(body);
      return { save: normalizeSave(migrateSave(data), this.host.content, { now: this.now() }) };
    } catch (e) {
      if (e instanceof SaveError && e.code === 'tooNew') return { outcome: { kind: 'incompatible', reason: e.message } };
      return { outcome: { kind: 'error', failure: { kind: 'rejected', code: 'bad_cloud_save', message: e instanceof Error ? e.message : String(e) } } };
    }
  }

  private async adopt(p: PendingCloud, isStale: () => boolean = () => false): Promise<SyncOutcome> {
    if (isStale()) return { kind: 'offline' };
    const dirtyAtStart = this.dirtyEpoch;
    await this.host.adoptSave(p.save);
    if (isStale()) return { kind: 'offline' };
    this.pending = null;
    // Preserve dirty when a newer local edit landed while adoptSave was awaiting disk flush.
    const editedDuringAdopt = this.dirtyEpoch !== dirtyAtStart || !sameProgress(this.host.getSave(), p.save);
    await this.setMeta({ baseRev: p.rev, dirty: editedDuringAdopt, lastSyncAt: this.now() });
    return { kind: 'pulled', rev: p.rev };
  }

  private async push(ifMatch: number, isStale: () => boolean = () => false): Promise<SyncOutcome> {
    if (isStale()) return { kind: 'offline' };
    const local = this.host.getSave();
    const revisionAtStart = this.host.revision();
    let saved: SaveMeta;
    try {
      saved = await this.api.putSave(JSON.stringify(local), ifMatch);
    } catch (e) {
      if (isStale()) return { kind: 'offline' };
      const failure = classifyCloudError(e);
      if (failure.kind === 'conflict') return this.refetchConflict(isStale);
      return this.failOrErased(e, isStale);
    }
    if (isStale()) return { kind: 'offline' };
    // edits made while the PUT was in flight stay dirty
    await this.setMeta({ baseRev: saved.rev, dirty: this.host.revision() !== revisionAtStart, lastSyncAt: this.now() });
    return { kind: 'pushed', rev: saved.rev };
  }

  /** After a rev_conflict on PUT: read the cloud's current copy and surface the choice. */
  private async refetchConflict(isStale: () => boolean = () => false): Promise<SyncOutcome> {
    if (isStale()) return { kind: 'offline' };
    let cloud: { meta: SaveMeta; body: string } | null;
    try {
      cloud = await this.api.getSave();
    } catch (e) {
      return isStale() ? { kind: 'offline' } : this.failOrErased(e, isStale);
    }
    if (isStale()) return { kind: 'offline' };
    if (!cloud) return { kind: 'error', failure: { kind: 'conflict', message: 'cloud save vanished during conflict' } };
    const parsed = this.parseCloud(cloud.body);
    if ('outcome' in parsed) return parsed.outcome;
    this.pending = { save: parsed.save, rev: cloud.meta.rev, updatedAt: cloud.meta.updatedAt };
    return { kind: 'conflict', conflict: this.describe(this.pending) };
  }

  private fail(e: unknown): SyncOutcome {
    const failure = classifyCloudError(e);
    return failure.kind === 'offline' ? { kind: 'offline' } : { kind: 'error', failure };
  }

  /**
   * A request failed. If the identity is gone, an erasure (net/api.ts `deleteAccount`) ran ahead of it in the write chain
   * and took the credentials - the request never left the page (the client's local "Not registered yet" 401). That is not a
   * sync error: report the same 'disabled' a sync started after the erasure gets (and drop the revision / conflict that
   * belonged to the erased identity).
   */
  private failOrErased(e: unknown, isStale: () => boolean = () => false): Promise<SyncOutcome> | SyncOutcome {
    return this.api.hasCredentials() ? this.fail(e) : this.doSync(isStale);
  }

  /** The user's decision on a surfaced conflict. */
  resolveConflict(choice: 'local' | 'cloud'): Promise<SyncOutcome> {
    return this.run(
      async (isStale) => {
        const p = this.livePending();
        if (!p) return this.emit({ kind: 'upToDate', rev: this.meta.baseRev });
        if (choice === 'cloud') {
          const out = await this.adopt(p, isStale);
          return isStale() ? out : this.emit(out);
        }
        this.pending = null;
        // keep local: overwrite the cloud copy we just saw (If-Match its rev)
        const out = await this.push(p.rev, isStale);
        return isStale() ? out : this.emit(out);
      },
      () => this.emit({ kind: 'offline' }),
    );
  }

  /** Drops a pending conflict without resolving it (the next sync will surface it again). */
  dismissConflict(): void {
    this.pending = null;
  }

  // -------------------------------------------------------------------------
  // Transfer codes (move a profile between devices)

  /** Pushes the latest save, then asks the Worker for an 8-char code (valid TRANSFER_CODE_TTL_SEC). */
  createTransferCode(name?: string): Promise<TransferCodeResult> {
    return this.run(
      async (isStale) => {
        try {
          if (!this.api.hasCredentials()) await this.api.register(name);
        } catch (e) {
          return { ok: false, failure: classifyCloudError(e) } as const;
        }
        if (isStale()) return { ok: false, failure: { kind: 'offline', code: 'timeout', message: 'Cloud sync operation timed out' } } as const;
        const rawSync = await this.doSync(isStale);
        if (isStale()) return { ok: false, outcome: rawSync } as const;
        const synced = this.emit(rawSync);
        if (synced.kind !== 'upToDate' && synced.kind !== 'pushed' && synced.kind !== 'pulled') return { ok: false, outcome: synced } as const;
        try {
          const r = await this.api.createTransfer();
          return { ok: true, code: r.code, display: formatTransferCode(r.code), expiresAt: r.expiresAt } as const;
        } catch (e) {
          return { ok: false, failure: classifyCloudError(e) } as const;
        }
      },
      (err) => ({ ok: false, failure: classifyCloudError(err) }) as const,
    );
  }

  /**
   * Adopts the donor's cloud identity on this device, then syncs. A device with existing progress gets the
   * conflict dialog (baseRev is reset to 0 so its local progress counts as "moved").
   */
  claimTransferCode(raw: string): Promise<ClaimResult> {
    return this.run(
      async (isStale) => {
        const code = normalizeCode(raw);
        if (!isTransferCode(code)) return { ok: false, failure: { kind: 'invalidCode', message: 'invalid transfer code' } } as const;
        try {
          await this.api.claimTransfer(code);
        } catch (e) {
          return { ok: false, failure: classifyCloudError(e) } as const;
        }
        if (isStale()) return { ok: false, failure: { kind: 'offline', code: 'timeout', message: 'Cloud sync operation timed out' } } as const;
        this.pending = null;
        await this.setMeta({ baseRev: 0, dirty: false, lastSyncAt: 0 });
        const rawSync = await this.doSync(isStale);
        return { ok: true, outcome: isStale() ? rawSync : this.emit(rawSync) } as const;
      },
      (err) => ({ ok: false, failure: classifyCloudError(err) }) as const,
    );
  }
}
