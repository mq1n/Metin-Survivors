// Leaderboard client wrapper + run submission. The HTTP client (net/api.ts) owns the persistent offline queue for
// run submissions (`submitRunQueued` / `flushRunQueue`: localStorage, 50 entries, 14-day expiry, auto-flush on
// 'online'); this module builds the validated payload, registers an anonymous identity on demand, classifies
// failures for the UI, and caches leaderboard pages (TTL + in-flight de-dup + stale-on-error).

import {
  CLIENT_VERSION,
  PARTY_MAX,
  PARTY_MIN,
  RUN_FIELD_MAX,
  parseRunSubmission,
  validateDisplayName,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type RunResponse,
  type RunSubmission,
} from '@ms/shared/api';
import type { EmpireId, Sex } from '../data/schema';
import type { RunResult } from '../sim/run';
import { classifyCloudError, type CloudApi, type CloudFailure } from './cloud';
import { runStatsOf, type SettlementSummary } from './settle';

export interface RunSubmitContext {
  /** ms since epoch the run ended (lets queued runs flush late) */
  endedAt: number;
  empire?: EmpireId;
  sex?: Sex;
  clientVersion?: string;
}

/** Builds the POST /runs body; null when the run cannot be a valid submission (e.g. unknown zone id). */
export function buildRunSubmission(run: RunResult, summary: SettlementSummary, ctx: RunSubmitContext): RunSubmission | null {
  const candidate: Record<string, unknown> = {
    runId: summary.runId,
    clientVersion: ctx.clientVersion ?? CLIENT_VERSION,
    zone: run.zone,
    difficulty: run.difficulty,
    classId: run.classId,
    doctrine: run.doctrine,
    ...(ctx.empire ? { empire: ctx.empire } : {}),
    ...(ctx.sex ? { sex: ctx.sex } : {}),
    seed: Number.isInteger(run.seed) && run.seed >= 0 && run.seed <= 0xffffffff ? run.seed : run.seed >>> 0,
    victory: run.victory,
    duration: Math.min(RUN_FIELD_MAX.duration, Math.max(0, summary.time)),
    endedAt: Math.floor(ctx.endedAt),
    stats: runStatsOf(run),
    score: summary.score,
    ...(run.players.length >= PARTY_MIN ? { coop: Math.min(PARTY_MAX, run.players.length) } : {}),
  };
  const v = parseRunSubmission(candidate);
  return v.ok ? v.value : null;
}

export type SubmitOutcome =
  | { kind: 'submitted'; result: RunResponse }
  /** accepted for later: durably persisted in the offline queue (net/api.ts retries when back online) */
  | { kind: 'queued' }
  /** nothing to send (invalid payload, or online play disabled) */
  | { kind: 'skipped'; reason: 'invalid' | 'noCredentials' | 'disabled' }
  /** the server refused it for good (implausible run, validation, outdated client) */
  | { kind: 'rejected'; failure: CloudFailure }
  /** could not submit AND could not durably persist to the local queue (e.g. storage quota full) */
  | { kind: 'failed'; reason: 'storage' | 'error'; failure: CloudFailure };

function isStorageFailure(e: unknown): boolean {
  if (typeof e === 'object' && e !== null) {
    if ('code' in e && e.code === 'storage') return true;
    if ('name' in e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) return true;
  }
  return false;
}

export interface SubmitOptions extends RunSubmitContext {
  /** register an anonymous player (profile name if valid) when none exists yet; default true */
  autoRegister?: boolean;
  profileName?: string;
}

export class RunSubmitter {
  private pendingProfileName: string | undefined;

  constructor(private readonly api: CloudApi) {}

  async submit(run: RunResult, summary: SettlementSummary, opts: SubmitOptions): Promise<SubmitOutcome> {
    const body = buildRunSubmission(run, summary, opts);
    if (!body) return { kind: 'skipped', reason: 'invalid' };
    if (!this.api.hasCredentials()) {
      if (opts.autoRegister === false) return { kind: 'skipped', reason: 'noCredentials' };
      // Persist the validated run to the durable offline queue BEFORE attempting registration/network.
      let persisted = false;
      let storageError: unknown = null;
      try {
        if (this.api.enqueueRun) {
          this.api.enqueueRun(body);
          persisted = true;
        } else {
          const q = await this.api.submitRunQueued(body);
          if (q.status === 'submitted') return { kind: 'submitted', result: q.result };
          persisted = true;
        }
      } catch (e) {
        storageError = e;
      }

      const name = opts.profileName !== undefined ? validateDisplayName(opts.profileName) : null;
      const validName = name && name.ok ? name.value : undefined;
      this.pendingProfileName = validName;
      try {
        await this.api.register(validName);
        this.pendingProfileName = undefined;
      } catch (e) {
        if (isStorageFailure(e)) {
          return { kind: 'failed', reason: 'storage', failure: classifyCloudError(e) };
        }
        const failure = classifyCloudError(e);
        if (failure.kind === 'offline' || failure.kind === 'server' || failure.kind === 'rateLimited') {
          if (persisted) return { kind: 'queued' };
          return { kind: 'failed', reason: 'storage', failure: classifyCloudError(storageError ?? e) };
        }
        // Permanent registration rejection: drop the pre-queued entry so it does not linger.
        if (persisted) this.api.dequeueRun?.(body.runId);
        return { kind: 'rejected', failure };
      }

      try {
        const r = await this.api.submitRunQueued(body);
        return r.status === 'submitted' ? { kind: 'submitted', result: r.result } : { kind: 'queued' };
      } catch (e) {
        if (isStorageFailure(e)) {
          return persisted
            ? { kind: 'queued' }
            : { kind: 'failed', reason: 'storage', failure: classifyCloudError(e) };
        }
        const failure = classifyCloudError(e);
        if (failure.kind === 'offline' || failure.kind === 'server' || failure.kind === 'rateLimited') {
          return persisted ? { kind: 'queued' } : { kind: 'failed', reason: 'error', failure };
        }
        if (persisted) this.api.dequeueRun?.(body.runId);
        return { kind: 'rejected', failure };
      }
    }

    try {
      const r = await this.api.submitRunQueued(body);
      return r.status === 'submitted' ? { kind: 'submitted', result: r.result } : { kind: 'queued' };
    } catch (e) {
      if (isStorageFailure(e)) {
        return { kind: 'failed', reason: 'storage', failure: classifyCloudError(e) };
      }
      const failure = classifyCloudError(e);
      if (failure.kind === 'offline' || failure.kind === 'server' || failure.kind === 'rateLimited') {
        return { kind: 'failed', reason: 'error', failure };
      }
      return { kind: 'rejected', failure };
    }
  }

  /** Retry queued submissions now (also runs automatically in net/api.ts on 'online'). */
  async flush(): Promise<void> {
    try {
      if (!this.api.hasCredentials() && (this.api.pendingRuns?.() ?? 0) > 0) {
        await this.api.register(this.pendingProfileName);
        this.pendingProfileName = undefined;
      }
      await this.api.flushRunQueue();
    } catch {
      /* stays queued */
    }
  }
}

// ---------------------------------------------------------------------------
// Leaderboard reads

export type LeaderboardResult =
  | { ok: true; data: LeaderboardResponse; fetchedAt: number; stale: false }
  | { ok: true; data: LeaderboardResponse; fetchedAt: number; stale: true; failure: CloudFailure }
  | { ok: false; failure: CloudFailure };

export function leaderboardKey(q: LeaderboardQuery): string {
  return `${q.mode}|${q.zone}|${q.difficulty}|${q.class}|${q.period}|${q.limit}`;
}

export class LeaderboardClient {
  private readonly cache = new Map<string, { data: LeaderboardResponse; at: number }>();
  private readonly inflight = new Map<string, Promise<LeaderboardResult>>();

  constructor(
    private readonly api: Pick<CloudApi, 'leaderboard'>,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30_000,
  ) {}

  /** Cached within `ttlMs` unless `force`; on failure falls back to the last cached page marked `stale`. */
  fetch(query: LeaderboardQuery, force = false): Promise<LeaderboardResult> {
    const key = leaderboardKey(query);
    const hit = this.cache.get(key);
    if (!force && hit && this.now() - hit.at < this.ttlMs) {
      return Promise.resolve({ ok: true, data: hit.data, fetchedAt: hit.at, stale: false });
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.load(query, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async load(query: LeaderboardQuery, key: string): Promise<LeaderboardResult> {
    try {
      const data = await this.api.leaderboard(query);
      const at = this.now();
      this.cache.set(key, { data, at });
      return { ok: true, data, fetchedAt: at, stale: false };
    } catch (e) {
      const failure = classifyCloudError(e);
      const hit = this.cache.get(key);
      return hit ? { ok: true, data: hit.data, fetchedAt: hit.at, stale: true, failure } : { ok: false, failure };
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
