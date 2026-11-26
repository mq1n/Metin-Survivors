// MetaService: the stateful facade the UI / app layer talks to. It owns the live SaveData, applies the pure
// operations (talents, gear, blacksmith, settlement, import) and persists every change (coalesced, atomic,
// last-good-copy; see storage.ts). Commands are synchronous from the caller's view — state updates immediately,
// disk/cloud writes follow in the background (`flush()` awaits them). Framework-free: wrap `subscribe` in a signal.

import type { ClassId, Difficulty, DoctrineKey, GearSlot } from '../data/schema';
import type { SettingsData } from '../engine/settings';
import type { MetaBonuses, RunResult } from '../sim/run';
import { attemptUpgrade, type UpgradeOptions, type UpgradeResult } from './blacksmith';
import { computeMetaBonuses, favourFor, type BonusContext } from './bonuses';
import { CloudSync, classifyCloudError, type CloudApi, type SyncOutcome } from './cloud';
import { equipGear, unequipGear, type EquipResult, type UnequipResult } from './gear';
import { LeaderboardClient, RunSubmitter, type SubmitOutcome, type SubmitOptions } from './leaderboard';
import { exportMsav, importMsav, type ImportResult } from './msav';
import { systemRng } from './rng';
import { newProfile, DEFAULT_PROFILE_NAME, publicProfileName } from './save';
import { settleRun, type SettlementSummary } from './settle';
import { SaveRepository, openBestStore, type KeyValueStore, type LoadResult } from './storage';
import { allocateTalent, refundTalent, respecTalents, type TalentResult } from './talents';
import type { MetaContent, MetaRng, SaveData } from './types';
import { canStartRun, type StartCheck } from './unlocks';

/** The Engine `settings` singleton satisfies this (engine/settings.ts). */
export interface SettingsPort {
  readonly value: SettingsData;
  update(patch: Partial<SettingsData>): void;
  subscribe(fn: (s: SettingsData) => void): () => void;
}

export interface MetaServiceOptions {
  content: MetaContent;
  /** default: IndexedDB → localStorage → memory */
  store?: KeyValueStore;
  /** HTTP client (net/api.ts `api`); omit for offline-only (cloud features stay null) */
  api?: CloudApi;
  rng?: MetaRng;
  now?: () => number;
  /** multi-tab notifier; default BroadcastChannel('ms.meta') when available */
  channel?: TabChannel | null;
}

export interface TabChannel {
  post(): void;
  onMessage(fn: () => void): void;
  close(): void;
}

function defaultChannel(): TabChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const bc = new BroadcastChannel('ms.meta');
  return {
    post: () => bc.postMessage('save'),
    onMessage: (fn) => {
      bc.onmessage = () => fn();
    },
    close: () => bc.close(),
  };
}

export type CommitReason = 'command' | 'settings' | 'external';

export interface SettleOutcome {
  summary: SettlementSummary;
  /** resolves once the run is submitted / queued / skipped (never rejects) */
  submit: Promise<SubmitOutcome>;
}

export interface SettleOptions extends Omit<SubmitOptions, 'endedAt' | 'profileName'> {
  /** false: bank locally only (e.g. practice / debug runs) */
  submit?: boolean;
  /** ms since epoch; default now */
  endedAt?: number;
}

export class MetaService {
  readonly content: MetaContent;
  readonly repo: SaveRepository;
  /** what loading found (recovered from backup? corrupt? repaired?) — surface a toast when relevant */
  readonly loadInfo: Omit<LoadResult, 'save'>;
  cloud: CloudSync | null = null;
  leaderboard: LeaderboardClient | null = null;
  submitter: RunSubmitter | null = null;

  private _save: SaveData;
  private rev = 0;
  private persistedRev = 0;
  private persistLoop: Promise<void> | null = null;
  private lastPersistError: unknown = null;
  private readonly listeners = new Set<(s: SaveData, reason: CommitReason) => void>();
  private readonly rng: MetaRng;
  private readonly now: () => number;
  private readonly channel: TabChannel | null;
  private settingsPort: SettingsPort | null = null;
  private unbindSettings: (() => void) | null = null;
  private autoSyncStop: (() => void) | null = null;

  private constructor(opts: MetaServiceOptions, repo: SaveRepository, save: SaveData, info: Omit<LoadResult, 'save'>) {
    this.content = opts.content;
    this.repo = repo;
    this._save = save;
    this.loadInfo = info;
    this.rng = opts.rng ?? systemRng;
    this.now = opts.now ?? Date.now;
    this.channel = opts.channel === undefined ? defaultChannel() : opts.channel;
  }

  /** Loads (or creates) the profile. Throws SaveError('tooNew') when the stored save is from a newer build. */
  static async open(opts: MetaServiceOptions): Promise<MetaService> {
    const store = opts.store ?? (await openBestStore());
    const now = opts.now ?? Date.now;
    const repo = new SaveRepository(store, now);
    const rng = opts.rng ?? systemRng;
    const { save: loaded, ...info } = await repo.load(opts.content, { now: now(), rng });
    const save = loaded ?? newProfile(opts.content, { now: now(), rng });
    const svc = new MetaService(opts, repo, save, info);
    if (!loaded || info.recovered || info.repairs.length > 0 || (info.fromVersion ?? 0) !== save.version) {
      svc.rev = 1;
      await svc.persist();
    }
    svc.channel?.onMessage(() => void svc.reloadFromStore());
    if (opts.api) await svc.attachApi(opts.api);
    return svc;
  }

  // -------------------------------------------------------------------------
  // State

  get save(): SaveData {
    return this._save;
  }

  /** Increases on every state change (cheap change detection for UI stores). */
  get revision(): number {
    return this.rev;
  }

  get persistence(): KeyValueStore['kind'] {
    return this.repo.store.kind;
  }

  /** Last persistence failure (quota, blocked DB); cleared by the next successful write. */
  get persistError(): unknown {
    return this.lastPersistError;
  }

  /** Subscribes to state changes; fires immediately. Returns the unsubscribe function. */
  subscribe(fn: (s: SaveData, reason: CommitReason) => void): () => void {
    this.listeners.add(fn);
    fn(this._save, 'external');
    return () => this.listeners.delete(fn);
  }

  /** Awaits every pending disk write. */
  flush(): Promise<void> {
    return this.persist();
  }

  private commit(next: SaveData, reason: CommitReason, dirty: boolean): void {
    this._save = dirty ? { ...next, profile: { ...next.profile, updated: this.now() } } : next;
    this.rev += 1;
    for (const l of this.listeners) l(this._save, reason);
    if (dirty) void this.cloud?.markDirty();
    void this.persist().catch(() => undefined);
    if (dirty) this.channel?.post();
  }

  private persist(): Promise<void> {
    if (this.persistLoop) return this.persistLoop;
    if (this.persistedRev === this.rev) return Promise.resolve();
    let settled = false;
    let loop: Promise<void> | null = null;
    loop = (async () => {
      try {
        while (this.persistedRev !== this.rev) {
          const rev = this.rev;
          await this.repo.save(this._save);
          this.persistedRev = rev;
          this.lastPersistError = null;
        }
      } catch (e) {
        this.lastPersistError = e;
        throw e;
      } finally {
        settled = true;
        if (this.persistLoop === loop) this.persistLoop = null;
      }
    })();
    if (!settled) this.persistLoop = loop;
    return loop;
  }

  private async reloadFromStore(): Promise<void> {
    try {
      await this.persistLoop?.catch(() => undefined);
      const r = await this.repo.load(this.content, { now: this.now(), rng: this.rng });
      if (!r.save || r.save.profile.updated < this._save.profile.updated) return;
      this._save = r.save;
      this.rev += 1;
      this.persistedRev = this.rev;
      for (const l of this.listeners) l(this._save, 'external');
    } catch {
      /* another tab's write unreadable: keep ours; the next write repairs the store */
    }
  }

  // -------------------------------------------------------------------------
  // Commands (all return the pure operation's result; state is updated on success)

  allocateTalent(classId: ClassId, doctrine: DoctrineKey, nodeId: string): TalentResult {
    const r = allocateTalent(this._save, this.content, classId, doctrine, nodeId);
    if (r.ok) this.commit(r.save, 'command', true);
    return r;
  }

  refundTalent(classId: ClassId, doctrine: DoctrineKey, nodeId: string): TalentResult {
    const r = refundTalent(this._save, this.content, classId, doctrine, nodeId);
    if (r.ok) this.commit(r.save, 'command', true);
    return r;
  }

  /** Free respec of one tree, or of the whole class when `doctrine` is omitted. */
  respecTalents(classId: ClassId, doctrine?: DoctrineKey): void {
    this.commit(respecTalents(this._save, classId, doctrine), 'command', true);
  }

  equip(classId: ClassId, gearId: string): EquipResult {
    const r = equipGear(this._save, this.content, classId, gearId);
    if (r.ok) this.commit(r.save, 'command', true);
    return r;
  }

  unequip(classId: ClassId, slot: GearSlot): UnequipResult {
    const r = unequipGear(this._save, classId, slot);
    if (r.ok) this.commit(r.save, 'command', true);
    return r;
  }

  /** One blacksmith attempt (materials are spent even on failure; the item is kept); `{ blessing: true }` reads a Blessing Scroll over it (MT-03). */
  upgradeGear(classId: ClassId, gearId: string, rng: MetaRng = this.rng, opts: UpgradeOptions = {}): UpgradeResult {
    const r = attemptUpgrade(this._save, this.content, classId, gearId, rng, opts);
    if (r.ok) this.commit(r.save, 'command', true);
    return r;
  }

  rename(name: string): void {
    const trimmed = name.normalize('NFC').trim().slice(0, 24).trim();
    this.commit({ ...this._save, profile: { ...this._save.profile, name: trimmed === '' ? DEFAULT_PROFILE_NAME : trimmed } }, 'command', true);
  }

  canStart(zoneId: string, difficulty: Difficulty): StartCheck {
    return canStartRun(this._save, this.content, zoneId, difficulty);
  }

  /**
   * MetaBonuses to put into RunConfig.meta for the chosen class/doctrine/empire. With `zone` + `difficulty` in the context
   * it includes Sky Sovereign's Favour for that zone (MT-01); in co-op every client calls it for the ROOM's zone with its own
   * save, so each hero's own favour travels in CoopPlayerInit.meta.
   */
  bonusesFor(ctx: BonusContext): MetaBonuses {
    return computeMetaBonuses(this._save, this.content, ctx);
  }

  /** Sky Sovereign's Favour (fraction, 0 .. 0.15) this profile has at `zoneId` / `difficulty` right now (MT-01; RP-01 / RP-02 show it). */
  favourFor(zoneId: string, difficulty: Difficulty): number {
    return favourFor(this._save, zoneId, difficulty);
  }

  /** Applies a finished run, persists, and (unless disabled) submits it to the leaderboard. */
  settle(run: RunResult, opts: SettleOptions = {}): SettleOutcome {
    const now = this.now();
    const { save, summary } = settleRun(this._save, this.content, run, this.rng, now);
    this.commit(save, 'command', true);
    const { submit: wantSubmit, endedAt, ...submitOpts } = opts;
    const submit =
      wantSubmit === false || !this.submitter
        ? Promise.resolve<SubmitOutcome>({ kind: 'skipped', reason: 'disabled' })
        : this.submitter
            .submit(run, summary, { ...submitOpts, endedAt: endedAt ?? now, profileName: publicProfileName(save.profile) })
            .catch((e): SubmitOutcome => ({ kind: 'failed', reason: 'error', failure: classifyCloudError(e) }));
    return { summary, submit };
  }

  // -------------------------------------------------------------------------
  // Settings mirror (Engine `settings` singleton ↔ SaveData.settings)

  /**
   * Mirrors the live device settings into the save (for export/import portability). The device value is the
   * source of truth: it is NOT overwritten by cloud adoption; a `.msav` import applies the file's settings.
   */
  bindSettings(port: SettingsPort): () => void {
    this.unbindSettings?.();
    this.settingsPort = port;
    const off = port.subscribe((s) => {
      if (JSON.stringify(s) === JSON.stringify(this._save.settings)) return;
      this.commit({ ...this._save, settings: s }, 'settings', false);
    });
    this.unbindSettings = off;
    return () => {
      off();
      if (this.unbindSettings === off) this.unbindSettings = null;
    };
  }

  // -------------------------------------------------------------------------
  // Export / import / reset

  exportMsav(): string {
    return exportMsav(this._save);
  }

  /** Replaces the current profile with the file's. Throws SaveError (the current profile is untouched). */
  async importMsav(text: string): Promise<ImportResult> {
    const result = importMsav(text, this.content, { now: this.now(), rng: this.rng });
    await this.replaceSave(result.save, { applySettings: true, dirty: true });
    return result;
  }

  /** Wipes local progress and starts a new profile (cloud data untouched until the next push). */
  async resetProfile(name?: string): Promise<void> {
    const fresh = newProfile(this.content, { now: this.now(), rng: this.rng, ...(name !== undefined ? { name } : {}), settings: this._save.settings });
    await this.replaceSave(fresh, { applySettings: false, dirty: true });
  }

  private async replaceSave(next: SaveData, o: { applySettings: boolean; dirty: boolean }): Promise<void> {
    if (o.applySettings) this.settingsPort?.update(next.settings);
    this.commit(next, 'external', o.dirty);
    await this.flush();
  }

  // -------------------------------------------------------------------------
  // Cloud

  /** Wires the HTTP client: cloud sync, leaderboard reads, run submission. */
  async attachApi(api: CloudApi): Promise<void> {
    this.cloud = await CloudSync.create(
      api,
      {
        content: this.content,
        getSave: () => this._save,
        revision: () => this.rev,
        adoptSave: async (cloudSave) => {
          // a cloud copy never overwrites this device's settings
          await this.replaceSave({ ...cloudSave, settings: this._save.settings }, { applySettings: false, dirty: false });
        },
      },
      this.repo,
      this.now,
    );
    this.leaderboard = new LeaderboardClient(api, this.now);
    this.submitter = new RunSubmitter(api);
  }

  /**
   * Debounced background sync: pushes ~`debounceMs` after the last change, pulls every `intervalMs`, and syncs on
   * reconnect / when the tab is hidden. Conflicts are surfaced through `cloud.subscribe`. Returns a stop function.
   */
  startAutoSync(opts: { debounceMs?: number; intervalMs?: number } = {}): () => void {
    this.autoSyncStop?.();
    const debounceMs = opts.debounceMs ?? 15_000;
    const intervalMs = opts.intervalMs ?? 600_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (): void => {
      if (this.cloud?.enabled) void this.cloud.sync().catch(() => undefined);
    };
    const offSave = this.subscribe((_s, reason) => {
      if (reason !== 'command') return;
      clearTimeout(timer);
      timer = setTimeout(run, debounceMs);
    });
    // Skip periodic background polls while the tab is hidden to avoid wasting Worker/D1 requests on idle tabs.
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      run();
    }, intervalMs);
    const onOnline = (): void => {
      run();
      void this.submitter?.flush();
    };
    // On tab hide, only sync when there are unsaved local mutations to flush.
    const onHidden = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && this.cloud?.state.dirty) run();
    };
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHidden);
    const stop = (): void => {
      offSave();
      clearInterval(interval);
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHidden);
      if (this.autoSyncStop === stop) this.autoSyncStop = null;
    };
    this.autoSyncStop = stop;
    return stop;
  }

  /** One-shot sync (button). 'disabled' until `cloud.enable()` registered an identity. */
  syncNow(): Promise<SyncOutcome> {
    return this.cloud ? this.cloud.sync() : Promise.resolve({ kind: 'disabled' });
  }

  dispose(): void {
    this.autoSyncStop?.();
    this.unbindSettings?.();
    this.channel?.close();
  }
}
