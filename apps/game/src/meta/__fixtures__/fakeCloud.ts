// In-memory stand-in for net/api.ts `ApiClient` + the Worker: revisions, If-Match conflicts, transfer codes,
// leaderboard + run queue, failure injection. Several FakeClouds can share one FakeServer to model two devices.

import type {
  LeaderboardQuery,
  LeaderboardResponse,
  RegisterResponse,
  RenameResponse,
  RunResponse,
  RunSubmission,
  SaveMeta,
  TransferClaimResponse,
  TransferCreateResponse,
} from '@ms/shared/api';
import type { CloudApi } from '../cloud';

export class FakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${status} ${code}`);
  }
}

export class FakeServer {
  save: { rev: number; body: string; updatedAt: number } | null = null;
  transferCodes = new Map<string, number>();
  runs: RunSubmission[] = [];
  now = 1_000;
  /** invoked right before a PUT is evaluated (race injection) */
  beforePut: (() => void) | null = null;
}

export class FakeCloud implements CloudApi {
  credentials = false;
  /** next call(s) fail with this error */
  failNext: Error | null = null;
  /** when set, durable queue persistence throws this error (simulates localStorage quota exhaustion) */
  failStorage: Error | null = null;
  offline = false;
  calls: string[] = [];
  registered: (string | undefined)[] = [];
  queued: RunSubmission[] = [];
  flushed = 0;
  leaderboardResponse: LeaderboardResponse | null = null;

  constructor(readonly server: FakeServer = new FakeServer()) {}

  private gate(name: string): void {
    this.calls.push(name);
    if (this.offline) throw new FakeApiError(0, 'network');
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  hasCredentials(): boolean {
    return this.credentials;
  }

  register(name?: string): Promise<RegisterResponse> {
    try {
      this.gate('register');
    } catch (e) {
      return Promise.reject(e);
    }
    this.credentials = true;
    this.registered.push(name);
    return Promise.resolve({ playerId: 'p'.repeat(16), secret: 's'.repeat(32), name: name ?? 'Kahraman1234' });
  }

  rename(name: string): Promise<RenameResponse> {
    return Promise.resolve({ playerId: 'p'.repeat(16), name });
  }

  getSave(): Promise<{ meta: SaveMeta; body: string } | null> {
    try {
      this.gate('getSave');
    } catch (e) {
      return Promise.reject(e);
    }
    const s = this.server.save;
    return Promise.resolve(s ? { meta: { rev: s.rev, updatedAt: s.updatedAt, size: s.body.length }, body: s.body } : null);
  }

  putSave(body: string, ifMatchRev: number): Promise<SaveMeta> {
    try {
      this.gate('putSave');
      this.server.beforePut?.();
    } catch (e) {
      return Promise.reject(e);
    }
    const cur = this.server.save?.rev ?? 0;
    if (ifMatchRev !== cur) return Promise.reject(new FakeApiError(412, 'rev_conflict', { currentRev: cur }));
    this.server.now += 1000;
    this.server.save = { rev: cur + 1, body, updatedAt: this.server.now };
    return Promise.resolve({ rev: cur + 1, updatedAt: this.server.now, size: body.length });
  }

  createTransfer(): Promise<TransferCreateResponse> {
    try {
      this.gate('createTransfer');
    } catch (e) {
      return Promise.reject(e);
    }
    const code = 'ABCD2345';
    this.server.transferCodes.set(code, this.server.now + 900_000);
    return Promise.resolve({ code, expiresAt: this.server.now + 900_000, ttlSec: 900 });
  }

  claimTransfer(code: string): Promise<TransferClaimResponse> {
    try {
      this.gate('claimTransfer');
    } catch (e) {
      return Promise.reject(e);
    }
    if (!this.server.transferCodes.has(code)) return Promise.reject(new FakeApiError(400, 'invalid_code'));
    this.server.transferCodes.delete(code);
    this.credentials = true;
    return Promise.resolve({ playerId: 'p'.repeat(16), secret: 't'.repeat(32), name: 'Donor' });
  }

  submitRun(run: RunSubmission): Promise<RunResponse> {
    try {
      this.gate('submitRun');
    } catch (e) {
      return Promise.reject(e);
    }
    this.server.runs.push(run);
    return Promise.resolve(this.runResponse(run));
  }

  pendingRuns(): number {
    return this.queued.length;
  }

  enqueueRun(run: RunSubmission): number {
    if (this.failStorage) throw this.failStorage;
    this.queued = this.queued.filter((q) => q.runId !== run.runId);
    this.queued.push(run);
    return this.queued.length;
  }

  dequeueRun(runId: string): void {
    this.queued = this.queued.filter((q) => q.runId !== runId);
  }

  submitRunQueued(run: RunSubmission): Promise<{ status: 'submitted'; result: RunResponse } | { status: 'queued' }> {
    if (this.offline || !this.credentials) {
      try {
        this.enqueueRun(run);
      } catch (e) {
        return Promise.reject(e);
      }
      return Promise.resolve({ status: 'queued' });
    }
    return this.submitRun(run)
      .then((result) => {
        this.dequeueRun(run.runId);
        return { status: 'submitted' as const, result };
      })
      .catch((e: unknown) => {
        if (e instanceof FakeApiError && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500)) {
          this.enqueueRun(run);
          return { status: 'queued' as const };
        }
        this.dequeueRun(run.runId);
        throw e;
      });
  }

  async flushRunQueue(): Promise<unknown> {
    this.flushed++;
    if (this.offline || !this.credentials) return undefined;
    const rest: RunSubmission[] = [];
    for (const run of this.queued) {
      try {
        await this.submitRun(run);
      } catch {
        rest.push(run);
      }
    }
    this.queued = rest;
    return undefined;
  }

  leaderboard(query: LeaderboardQuery): Promise<LeaderboardResponse> {
    try {
      this.gate('leaderboard');
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(
      this.leaderboardResponse ?? {
        mode: query.mode,
        zone: query.zone,
        difficulty: query.difficulty,
        class: query.class,
        period: query.period,
        weekStart: null,
        limit: query.limit,
        total: 0,
        entries: [],
        you: null,
      },
    );
  }

  private runResponse(run: RunSubmission): RunResponse {
    return {
      id: this.server.runs.length,
      score: run.score ?? 0,
      status: 'ok',
      mode: run.coop === undefined ? 'solo' : 'coop',
      flags: [],
      duplicate: false,
      best: true,
      bestScore: run.score ?? 0,
      rank: 1,
      weekRank: 1,
      classRank: 1,
    };
  }
}
