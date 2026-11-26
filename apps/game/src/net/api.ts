// Typed client for the Metin Survivors Worker API (ARCHITECTURE §10). Owner: NET.
//
// - Base URL: `VITE_API_BASE` (origin, or a full `…/api/v1` URL; empty string = same origin). Default: the local
//   `wrangler dev` Worker (workers/api, port 18686) in dev builds, same-origin `/api/v1` in production builds — on
//   Cloudflare Pages a Pages Function (apps/game/functions/api) proxies `/api/*` to the Worker through a service
//   binding, so the shipped client needs no build-time URL. VITE_API_BASE stays an override (e.g. the workers.dev URL).
// - Errors: every failure is an `ApiError` (`status` 0 = network/timeout, otherwise the HTTP status, `code` from the
//   server's structured error body). A 2xx whose body is not the Worker's JSON (an HTML SPA fallback when /api is
//   misrouted, a proxy page) is a retryable `network` error (status 0), exactly like being offline.
// - Offline tolerance: `submitRunQueued()` stores validated runs in localStorage when the Worker is unreachable and
//   `flushRunQueue()` (automatic on `online` and after the next successful submission) delivers them later; the
//   server de-duplicates by `runId`.
// - Write ordering: the calls that change a player's server state (PUT /save, POST /runs, DELETE /players/me) run on one
//   chain, in call order, so an account erasure waits for an upload in flight and nothing issued behind it is sent with
//   the erased credential (see `serialised`). The cloud-save read (GET /save) rides the same chain: a read queued behind an
//   erasure would otherwise leave with the credential the DELETE is erasing (a 401 and a console error). Other reads and
//   registration are not on the chain.
// - Credentials (`playerId` + `secret`) live in localStorage under `ms.api.credentials`, deliberately outside SaveData /
//   .msav exports so a shared save file never leaks a login.

import {
  API_BASE_PATH,
  CLIENT_VERSION,
  SAVE_MAX_BYTES,
  SAVE_UPDATED_HEADER,
  formatBearer,
  formatRev,
  isApiErrorBody,
  isRecord,
  leaderboardQueryString,
  parseRev,
  parseRunSubmission,
  parseToken,
  type ApiErrorCode,
  type CoopCreateResponse,
  type Credentials,
  type HealthResponse,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type RegisterResponse,
  type RenameResponse,
  type RunResponse,
  type RunSubmission,
  type SaveMeta,
  type TransferClaimResponse,
  type TransferCreateResponse,
} from '@ms/shared';

export { CLIENT_VERSION };

// ---------------------------------------------------------------------------
// Errors

export type ClientErrorCode = ApiErrorCode | 'network' | 'timeout' | 'storage';

export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 when no response was received (offline, DNS, CORS failure, timeout, local storage failure). */
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly retryAfterSec?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Worth retrying later without changing the request (offline, timeout, 408/429/5xx). */
  get retryable(): boolean {
    return (this.status === 0 && this.code !== 'storage') || this.status === 408 || this.status === 429 || this.status >= 500;
  }

  /** `rev_conflict`: the server's current save revision. */
  get currentRev(): number | null {
    const rev = this.details?.currentRev;
    return typeof rev === 'number' ? rev : null;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

// ---------------------------------------------------------------------------
// Storage plumbing

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** localStorage when usable (it throws in some private modes), otherwise an in-memory store. */
export function defaultStore(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    const probe = '__ms_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return new MemoryStore();
  }
}

export interface CredentialStore {
  load(): Credentials | null;
  save(c: Credentials): void;
  clear(): void;
}

export const CREDENTIALS_KEY = 'ms.api.credentials';
export const RUN_QUEUE_KEY = 'ms.api.runQueue';

export class StorageCredentialStore implements CredentialStore {
  constructor(
    private readonly store: KeyValueStore = defaultStore(),
    private readonly key: string = CREDENTIALS_KEY,
  ) {}

  load(): Credentials | null {
    const raw = this.store.getItem(this.key);
    if (!raw) return null;
    try {
      const v: unknown = JSON.parse(raw);
      if (isRecord(v) && typeof v.playerId === 'string' && typeof v.secret === 'string') {
        return parseToken(`${v.playerId}.${v.secret}`);
      }
    } catch {
      // corrupt entry: treated as "not registered"
    }
    return null;
  }

  save(c: Credentials): void {
    this.store.setItem(this.key, JSON.stringify({ playerId: c.playerId, secret: c.secret }));
  }

  clear(): void {
    this.store.removeItem(this.key);
  }
}

// ---------------------------------------------------------------------------
// Base URL

/** `wrangler dev` address of the API Worker (workers/api/wrangler.toml [dev]; above Windows' dynamic port range). */
export const DEV_API_ORIGIN = 'http://127.0.0.1:18686';

/** Normalises a configured base: origin → `<origin>/api/v1`; full `…/api/v1` URLs and same-origin paths pass through. */
export function normalizeApiBase(raw: string | undefined, dev: boolean): string {
  if (raw === undefined) return dev ? `${DEV_API_ORIGIN}${API_BASE_PATH}` : API_BASE_PATH;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return API_BASE_PATH;
  return trimmed.endsWith(API_BASE_PATH) ? trimmed : `${trimmed}${API_BASE_PATH}`;
}

/** `https://host/api/v1` (+ `/coop/ABC234`) → `wss://host/api/v1/coop/ABC234`; relative bases resolve against the page origin. */
export function toWebSocketUrl(base: string, path: string): string {
  const origin = typeof location === 'undefined' ? 'http://localhost' : location.href;
  const url = new URL(`${base}${path}`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

const configuredBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? undefined;
export const DEFAULT_API_BASE = normalizeApiBase(configuredBase, import.meta.env.DEV === true);

// ---------------------------------------------------------------------------
// Client

export type ApiEvent =
  | { type: 'runSubmitted'; run: RunSubmission; response: RunResponse; fromQueue: boolean }
  | { type: 'runDropped'; run: RunSubmission; error: ApiError }
  | { type: 'queue'; pending: number }
  /** the server rejected our stored credentials (401); the caller decides whether to re-register */
  | { type: 'unauthorized' };

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  credentials?: CredentialStore;
  /** storage for the offline run queue */
  store?: KeyValueStore;
  /** ms; default 10 000 (save transfers 20 000) */
  timeoutMs?: number;
  now?: () => number;
  /** attach a window `online` listener that flushes the run queue (default true) */
  autoFlush?: boolean;
}

interface QueuedRun {
  run: RunSubmission;
  queuedAt: number;
}

export type SubmitOutcome = { status: 'submitted'; result: RunResponse } | { status: 'queued'; pending: number };
export interface FlushSummary {
  sent: number;
  dropped: number;
  remaining: number;
}

const QUEUE_MAX = 50;
/** Server refuses runs older than 14 days; drop ours a day earlier. */
const QUEUE_MAX_AGE_MS = 13 * 86_400_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const SAVE_TIMEOUT_MS = 20_000;
/**
 * The longest a mutating call keeps the ones queued behind it waiting. Every request carries its own timeout (10 / 20 s), so
 * this only matters when a response body stalls after the headers arrived (the abort timer is gone by then); it keeps one
 * stuck call from freezing every later save / run / erase for the rest of the session.
 */
const WRITE_HOLD_MAX_MS = 30_000;

interface RequestOptions {
  auth?: boolean;
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const FALLBACK_CODES: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_large',
  412: 'rev_conflict',
  426: 'client_outdated',
  429: 'rate_limited',
};

interface ResponseIo {
  text(res: Response): Promise<string>;
  json(res: Response): Promise<unknown>;
  cancel(res: Response): void;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly credentialStore: CredentialStore;
  private readonly queueStore: KeyValueStore;
  private readonly timeoutMs: number;
  private readonly saveTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly writeHoldMs: number;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly listeners = new Set<(e: ApiEvent) => void>();
  private flushing: Promise<FlushSummary> | null = null;
  /** tail of the write chain (see {@link serialised}); never rejects */
  private writes: Promise<void> = Promise.resolve();

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_API_BASE;
    this.credentialStore = opts.credentials ?? new StorageCredentialStore();
    this.queueStore = opts.store ?? defaultStore();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.saveTimeoutMs = opts.timeoutMs ?? SAVE_TIMEOUT_MS;
    this.healthTimeoutMs = opts.timeoutMs !== undefined ? Math.min(5000, opts.timeoutMs) : 5000;
    this.writeHoldMs = opts.timeoutMs !== undefined ? Math.max(opts.timeoutMs * 2, opts.timeoutMs + 100) : WRITE_HOLD_MAX_MS;
    this.now = opts.now ?? Date.now;
    this.fetchImpl = opts.fetch;
    if (opts.autoFlush !== false && typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('online', () => void this.flushRunQueue());
    }
  }

  // ---- events -------------------------------------------------------------

  subscribe(listener: (e: ApiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: ApiEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (err) {
        console.error('api listener failed', err);
      }
    }
  }

  // ---- credentials ---------------------------------------------------------

  hasCredentials(): boolean {
    return this.credentialStore.load() !== null;
  }
  getCredentials(): Credentials | null {
    return this.credentialStore.load();
  }
  setCredentials(c: Credentials): void {
    this.credentialStore.save(c);
  }
  clearCredentials(): void {
    this.credentialStore.clear();
  }

  // ---- transport -----------------------------------------------------------

  /**
   * Runs the calls that change server state for a player - PUT /save, POST /runs and DELETE /players/me - strictly one
   * after another, in call order. Credentials are read when a call's turn comes, not when it was issued, so:
   *   · an erasure waits for the upload that is already on the wire (the Worker never sees a PUT land after its DELETE);
   *   · a save / run that was issued behind an erasure finds the credentials gone and never goes out with the erased
   *     identity's secret (it fails with the local "Not registered yet" 401 instead of resurrecting server data).
   * A failure of one call never blocks the next. Each operation's hold timeout starts ONLY when it begins executing, and
   * rejects its own promise on expiry while releasing the chain for successors.
   */
  private serialised<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writes;
    let release!: () => void;
    this.writes = new Promise<void>((r) => {
      release = r;
    });
    return (async (): Promise<T> => {
      await prev;
      let cap: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<T>((resolve, reject) => {
          let settled = false;
          cap = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new ApiError(0, 'timeout', 'Request timed out'));
          }, this.writeHoldMs);
          Promise.resolve()
            .then(fn)
            .then(
              (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
              },
              (err) => {
                if (settled) return;
                settled = true;
                reject(err);
              },
            );
        });
      } finally {
        if (cap !== undefined) clearTimeout(cap);
        release();
      }
    })();
  }

  /**
   * Executes one HTTP request and keeps its AbortController deadline active across BOTH fetch() AND full response body
   * consumption (json / text / error body). Cancels the response body stream on deadline expiry and normalises aborts into
   * a retryable `ApiError(0, 'timeout', ...)`.
   */
  private async withRequest<T>(
    method: string,
    path: string,
    opts: RequestOptions,
    consume: (res: Response, io: ResponseIo) => Promise<T>,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
    if (opts.auth) {
      const creds = this.credentialStore.load();
      if (!creds) throw new ApiError(401, 'unauthorized', 'Not registered yet');
      headers.Authorization = `Bearer ${formatBearer(creds)}`;
    }
    let body = opts.body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let res: Response | null = null;
    let activeCancel: (() => unknown) | null = null;
    let rejectDeadline!: (err: ApiError) => void;
    const deadlinePromise = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    deadlinePromise.catch(() => undefined);

    const cancelQuiet = (fn: (() => unknown) | null | undefined): void => {
      if (!fn) return;
      try {
        const out = fn();
        if (out && typeof (out as Promise<unknown>).catch === 'function') {
          (out as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        // ignore cancel errors on already-closed or locked streams
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      rejectDeadline(new ApiError(0, 'timeout', 'Request timed out'));
      controller.abort();
      cancelQuiet(activeCancel);
      if (res?.body && typeof res.body.cancel === 'function') cancelQuiet(() => res!.body!.cancel());
    }, timeoutMs);

    const race = <U>(p: Promise<U>): Promise<U> => {
      if (timedOut) {
        p.catch(() => undefined);
        return Promise.reject(new ApiError(0, 'timeout', 'Request timed out'));
      }
      p.catch(() => undefined);
      return Promise.race([p, deadlinePromise]);
    };

    const readText = async (r: Response): Promise<string> => {
      if (r.body && typeof r.body.getReader === 'function') {
        const reader = r.body.getReader();
        activeCancel = () => reader.cancel();
        const decoder = new TextDecoder();
        let text = '';
        try {
          while (true) {
            const chunk = await race(reader.read());
            if (timedOut || controller.signal.aborted) throw new ApiError(0, 'timeout', 'Request timed out');
            if (chunk.done) break;
            if (chunk.value) text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
          if (timedOut || controller.signal.aborted) throw new ApiError(0, 'timeout', 'Request timed out');
          return text;
        } finally {
          activeCancel = null;
          try {
            reader.releaseLock();
          } catch {
            // ignore release errors after cancel
          }
        }
      }
      const text = await race(r.text());
      if (timedOut || controller.signal.aborted) throw new ApiError(0, 'timeout', 'Request timed out');
      return text;
    };

    const readJson = async (r: Response): Promise<unknown> => {
      if (r.body && typeof r.body.getReader === 'function') {
        return JSON.parse(await readText(r));
      }
      const parsed = await race(r.json());
      if (timedOut || controller.signal.aborted) throw new ApiError(0, 'timeout', 'Request timed out');
      return parsed;
    };

    const io: ResponseIo = {
      text: readText,
      json: readJson,
      cancel: (r: Response) => {
        if (r.body && typeof r.body.cancel === 'function') cancelQuiet(() => r.body!.cancel());
      },
    };

    try {
      const doFetch = this.fetchImpl ?? globalThis.fetch.bind(globalThis);
      res = await race(doFetch(`${this.baseUrl}${path}`, { method, headers, signal: controller.signal, ...(body !== undefined ? { body } : {}) }));
      const out = await consume(res, io);
      if (timedOut || controller.signal.aborted) throw new ApiError(0, 'timeout', 'Request timed out');
      return out;
    } catch (e) {
      if (timedOut || controller.signal.aborted) {
        throw new ApiError(0, 'timeout', 'Request timed out', { cause: e instanceof Error ? e.message : String(e) });
      }
      if (isApiError(e)) throw e;
      throw new ApiError(0, 'network', 'Network unavailable', { cause: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(timer);
      activeCancel = null;
    }
  }

  private async toError(res: Response, auth: boolean, io: ResponseIo): Promise<ApiError> {
    let parsed: unknown;
    try {
      parsed = await io.json(res);
    } catch (e) {
      if (isApiError(e) && e.code === 'timeout') throw e;
      parsed = undefined;
    }
    const header = Number(res.headers.get('Retry-After'));
    const retryHeader = Number.isFinite(header) && header > 0 ? header : undefined;
    if (auth && res.status === 401) this.emit({ type: 'unauthorized' });
    if (isApiErrorBody(parsed)) {
      const { code, message, details, requestId } = parsed.error;
      const detailRetry = typeof details?.retryAfterSec === 'number' ? details.retryAfterSec : undefined;
      return new ApiError(res.status, code, message, details, retryHeader ?? detailRetry, requestId);
    }
    const code: ApiErrorCode = FALLBACK_CODES[res.status] ?? (res.status >= 500 ? 'internal' : 'bad_request');
    return new ApiError(res.status, code, res.statusText || `HTTP ${res.status}`, undefined, retryHeader);
  }

  /**
   * A success status whose body is not what the Worker sends: an HTML SPA fallback when `/api` is misrouted (Pages answers
   * 200 `index.html` for unknown paths), a captive-portal / proxy page, a truncated body. The answer did not come from our
   * API, so it is the same class as being offline — retryable (queued runs stay queued, the cloud sync tries again) — and
   * never a crash on a missing field or a terminal rejection.
   */
  private notAnApiResponse(res: Response, why: string): ApiError {
    return new ApiError(0, 'network', 'The server sent an unreadable response', { cause: why, httpStatus: res.status, contentType: res.headers.get('content-type') ?? '' });
  }

  private json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.withRequest(method, path, opts, async (res, io) => {
      if (!res.ok) throw await this.toError(res, opts.auth === true, io);
      let parsed: unknown;
      try {
        parsed = await io.json(res);
      } catch (e) {
        if (isApiError(e) && e.code === 'timeout') throw e;
        throw this.notAnApiResponse(res, 'not_json');
      }
      // every endpoint answers a JSON object; `null` / a number / a string would crash the callers on the first field read
      if (typeof parsed !== 'object' || parsed === null) throw this.notAnApiResponse(res, 'not_an_object');
      return parsed as T;
    });
  }

  // ---- players -------------------------------------------------------------

  /** POST /players — registers an anonymous player and persists the credentials. */
  async register(name?: string): Promise<RegisterResponse> {
    const res = await this.json<RegisterResponse>('POST', '/players', { json: name === undefined ? {} : { name } });
    this.credentialStore.save({ playerId: res.playerId, secret: res.secret });
    return res;
  }

  /** Registers only when no credentials are stored; returns the stored identity otherwise. */
  async ensureRegistered(name?: string): Promise<Credentials> {
    const existing = this.credentialStore.load();
    if (existing) return existing;
    const res = await this.register(name);
    return { playerId: res.playerId, secret: res.secret };
  }

  /** PATCH /players/me */
  rename(name: string): Promise<RenameResponse> {
    return this.json<RenameResponse>('PATCH', '/players/me', { auth: true, json: { name } });
  }

  /**
   * DELETE /players/me — erasure on request (KVKK / GDPR): the Worker deletes the cloud save, every credential, the runs,
   * the leaderboard rows and the transfer codes of this player (answers 204, no body). Afterwards this device forgets its
   * cloud identity (credentials) and the offline run queue — those runs belong to the erased player and must not be
   * uploaded under a new one — so the game simply continues as an offline / not-yet-linked install; local progress stays.
   * A 401 means the server no longer knows this identity (erased on another device, or the credentials are stale):
   * there is nothing left to erase, so the local identity is dropped the same way. Every other failure (offline, timeout,
   * 429, 5xx, 403 banned) throws an `ApiError` and leaves everything untouched, so the caller can offer a retry.
   *
   * Serialised with the other mutating calls ({@link serialised}): it waits for an upload / run submission that is in
   * flight, and anything issued while it runs waits for it and then finds the credentials gone. The local cleanup only
   * touches the identity this erasure was about (a register / transfer claim that stored another one meanwhile stays).
   */
  deleteAccount(): Promise<void> {
    return this.serialised(async () => {
      const erased = this.credentialStore.load();
      try {
        await this.withRequest('DELETE', '/players/me', { auth: true, timeoutMs: this.saveTimeoutMs }, async (res, io) => {
          if (!res.ok) throw await this.toError(res, true, io);
          // a 200 page instead of the Worker's 204 (misrouted /api) erased nothing: do not pretend it did
          if (res.status !== 204 && /\bhtml\b/i.test(res.headers.get('content-type') ?? '')) {
            io.cancel(res);
            throw this.notAnApiResponse(res, 'html');
          }
          io.cancel(res);
        });
      } catch (e) {
        if (!(isApiError(e) && e.status === 401 && e.code === 'unauthorized')) throw e;
      }
      const now = this.credentialStore.load();
      if (now && (!erased || now.playerId !== erased.playerId || now.secret !== erased.secret)) return;
      this.credentialStore.clear();
      this.saveQueue([]);
    });
  }

  // ---- runs & leaderboard ----------------------------------------------------

  /** POST /runs — throws on any failure (including offline); see {@link submitRunQueued} for the tolerant variant. */
  async submitRun(run: RunSubmission): Promise<RunResponse> {
    const checked = parseRunSubmission(run);
    if (!checked.ok) throw new ApiError(400, 'validation', `Invalid ${checked.field}`, { field: checked.field, reason: checked.reason });
    return this.serialised(() => this.json<RunResponse>('POST', '/runs', { auth: true, json: checked.value }));
  }

  /**
   * Durably persists a validated run into the local offline queue. Throws `ApiError(0, 'storage', ...)` if localStorage
   * persistence fails (e.g. QuotaExceededError) so callers never falsely claim a run was queued.
   */
  enqueueRun(run: RunSubmission): number {
    const checked = parseRunSubmission(run);
    if (!checked.ok) throw new ApiError(400, 'validation', `Invalid ${checked.field}`, { field: checked.field, reason: checked.reason });
    return this.enqueue(checked.value);
  }

  /** Removes a previously queued run by id (best-effort cleanup after direct delivery or permanent rejection). */
  dequeueRun(runId: string): void {
    try {
      const all = this.loadQueue();
      const kept = all.filter((q) => q.run.runId !== runId);
      if (kept.length !== all.length) this.saveQueue(kept);
    } catch {
      // best effort
    }
  }

  /**
   * Submits a finished run; when the Worker cannot be reached (or answers 429/5xx) the run is queued locally and
   * delivered later by {@link flushRunQueue}. Permanent rejections (validation, implausible run, outdated client) and
   * local queue storage failures throw.
   */
  async submitRunQueued(run: RunSubmission): Promise<SubmitOutcome> {
    const checked = parseRunSubmission(run);
    if (!checked.ok) throw new ApiError(400, 'validation', `Invalid ${checked.field}`, { field: checked.field, reason: checked.reason });
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online || !this.hasCredentials()) return { status: 'queued', pending: this.enqueue(checked.value) };
    try {
      const result = await this.submitRun(checked.value);
      this.dequeueRun(checked.value.runId);
      this.emit({ type: 'runSubmitted', run: checked.value, response: result, fromQueue: false });
      if (this.pendingRuns() > 0) void this.flushRunQueue();
      return { status: 'submitted', result };
    } catch (e) {
      if (isApiError(e) && e.retryable) return { status: 'queued', pending: this.enqueue(checked.value) };
      // an erasure that ran ahead of this run in the write chain took the credentials: the run is new data of the next
      // identity (queued, sent once one is registered) and is never sent with the erased secret
      if (isApiError(e) && e.status === 401 && !this.hasCredentials()) return { status: 'queued', pending: this.enqueue(checked.value) };
      this.dequeueRun(checked.value.runId);
      throw e;
    }
  }

  /** GET /leaderboard (sends credentials when registered so the response carries the caller's own rank). */
  leaderboard(q: Partial<LeaderboardQuery> & Pick<LeaderboardQuery, 'zone'>): Promise<LeaderboardResponse> {
    return this.json<LeaderboardResponse>('GET', `/leaderboard?${leaderboardQueryString(q)}`, { auth: this.hasCredentials() });
  }

  // ---- offline queue -----------------------------------------------------------

  pendingRuns(): number {
    return this.loadQueue().length;
  }

  private loadQueue(): QueuedRun[] {
    const raw = this.queueStore.getItem(RUN_QUEUE_KEY);
    if (!raw) return [];
    try {
      const v: unknown = JSON.parse(raw);
      if (!Array.isArray(v)) return [];
      const out: QueuedRun[] = [];
      for (const item of v) {
        if (!isRecord(item) || typeof item.queuedAt !== 'number') continue;
        const run = parseRunSubmission(item.run);
        if (run.ok) out.push({ run: run.value, queuedAt: item.queuedAt });
      }
      return out;
    } catch {
      return [];
    }
  }

  private saveQueue(queue: QueuedRun[], strict = false): void {
    try {
      if (queue.length === 0) this.queueStore.removeItem(RUN_QUEUE_KEY);
      else this.queueStore.setItem(RUN_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      if (strict) {
        throw new ApiError(0, 'storage', 'Could not persist the run queue', { cause: e instanceof Error ? e.message : String(e) });
      }
      console.warn('could not persist the run queue', e);
      return;
    }
    this.emit({ type: 'queue', pending: queue.length });
  }

  private enqueue(run: RunSubmission): number {
    let existing: QueuedRun[];
    try {
      existing = this.loadQueue();
    } catch (e) {
      throw new ApiError(0, 'storage', 'Could not read the run queue', { cause: e instanceof Error ? e.message : String(e) });
    }
    const queue = existing.filter((q) => q.run.runId !== run.runId);
    queue.push({ run, queuedAt: this.now() });
    while (queue.length > QUEUE_MAX) queue.shift();
    this.saveQueue(queue, true);
    return queue.length;
  }

  /** Delivers queued runs oldest-first; stops at the first retryable failure. Concurrent calls share one pass. */
  flushRunQueue(): Promise<FlushSummary> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(): Promise<FlushSummary> {
    let sent = 0;
    let dropped = 0;
    if (!this.hasCredentials()) return { sent, dropped, remaining: this.loadQueue().length };
    // The persisted queue is the source of truth: it is re-read after every request (which may take seconds) and a run
    // is removed by id. Writing back a copy taken before the request would undo an erasure that cleared the queue
    // meanwhile (resurrecting the erased player's runs for the next identity) and drop runs queued in the meantime.
    const handled = new Set<string>();
    const next = (): QueuedRun | undefined => this.loadQueue().find((q) => !handled.has(q.run.runId));
    const settle = (runId: string): void => {
      handled.add(runId);
      const all = this.loadQueue();
      const kept = all.filter((q) => q.run.runId !== runId);
      if (kept.length !== all.length) this.saveQueue(kept);
    };
    for (let head = next(); head; head = next()) {
      if (this.now() - head.queuedAt > QUEUE_MAX_AGE_MS) {
        settle(head.run.runId);
        dropped += 1;
        continue;
      }
      try {
        const response = await this.submitRun(head.run);
        settle(head.run.runId);
        sent += 1;
        this.emit({ type: 'runSubmitted', run: head.run, response, fromQueue: true });
      } catch (e) {
        if (!isApiError(e) || e.retryable || e.status === 401) break;
        settle(head.run.runId);
        dropped += 1;
        this.emit({ type: 'runDropped', run: head.run, error: e });
      }
    }
    return { sent, dropped, remaining: this.loadQueue().length };
  }

  // ---- cloud save ----------------------------------------------------------------

  /**
   * GET /save — `null` when the player has no cloud save yet (the server answers 204; a server from before that change
   * answered 404 `no_save`, still understood). When `ifNoneMatchRev` matches the server's revision, sends `If-None-Match`
   * so the server returns 304 without reading R2 (`unchanged: true`, empty body).
   */
  getSave(ifNoneMatchRev?: number): Promise<{ meta: SaveMeta; body: string; unchanged?: true } | null> {
    // On the write chain ({@link serialised}): a read issued while an erasure is queued or running waits for it and then finds
    // the credentials gone (the local "Not registered yet" 401, nothing goes out); a read already on the wire is waited for by
    // the erasure. Either way no GET /save carries the credential the DELETE is erasing.
    return this.serialised(() => {
      const headers = ifNoneMatchRev !== undefined && ifNoneMatchRev > 0 ? { 'If-None-Match': formatRev(ifNoneMatchRev) } : undefined;
      return this.withRequest('GET', '/save', { auth: true, timeoutMs: this.saveTimeoutMs, ...(headers ? { headers } : {}) }, async (res, io) => {
        if (res.status === 204) {
          io.cancel(res);
          return null;
        }
        if (res.status === 304) {
          io.cancel(res);
          const rev = parseRev(res.headers.get('ETag')) ?? ifNoneMatchRev ?? 0;
          const updated = Number(res.headers.get(SAVE_UPDATED_HEADER));
          return { meta: { rev, updatedAt: Number.isFinite(updated) ? updated : 0, size: 0 }, body: '', unchanged: true };
        }
        if (res.status === 404) {
          const err = await this.toError(res, true, io);
          if (err.code === 'no_save') return null;
          throw err;
        }
        if (!res.ok) throw await this.toError(res, true, io);
        // a 200 that is a web page (misrouted /api → the SPA fallback) or carries no revision is not our Worker: retryable
        if (/\bhtml\b/i.test(res.headers.get('content-type') ?? '')) {
          io.cancel(res);
          throw this.notAnApiResponse(res, 'html');
        }
        const rev = parseRev(res.headers.get('ETag'));
        if (rev === null) {
          io.cancel(res);
          throw this.notAnApiResponse(res, 'no_revision');
        }
        const body = await io.text(res);
        const updated = Number(res.headers.get(SAVE_UPDATED_HEADER));
        return { meta: { rev, updatedAt: Number.isFinite(updated) ? updated : 0, size: new TextEncoder().encode(body).byteLength }, body };
      });
    });
  }

  /**
   * PUT /save with `If-Match: <ifMatchRev>` (0 = no cloud save yet). A stale revision throws `ApiError` with
   * `code === 'rev_conflict'` and `currentRev` set.
   */
  putSave(body: string, ifMatchRev: number): Promise<SaveMeta> {
    if (new TextEncoder().encode(body).byteLength > SAVE_MAX_BYTES) {
      return Promise.reject(new ApiError(413, 'payload_too_large', `Save exceeds ${SAVE_MAX_BYTES} bytes`, { maxBytes: SAVE_MAX_BYTES }));
    }
    return this.serialised(() =>
      this.json<SaveMeta>('PUT', '/save', {
        auth: true,
        body,
        headers: { 'Content-Type': 'application/json', 'If-Match': formatRev(ifMatchRev) },
        timeoutMs: this.saveTimeoutMs,
      }),
    );
  }

  // ---- device transfer -------------------------------------------------------------

  createTransfer(): Promise<TransferCreateResponse> {
    return this.json<TransferCreateResponse>('POST', '/transfer', { auth: true });
  }

  /** POST /transfer/claim — unauthenticated; persists the fresh credential for the claimed player. */
  async claimTransfer(code: string): Promise<TransferClaimResponse> {
    const res = await this.json<TransferClaimResponse>('POST', '/transfer/claim', { json: { code } });
    this.credentialStore.save({ playerId: res.playerId, secret: res.secret });
    return res;
  }

  // ---- co-op & health ----------------------------------------------------------------

  /** POST /coop — allocates a room; the caller becomes host once connected. */
  createRoom(): Promise<CoopCreateResponse> {
    return this.json<CoopCreateResponse>('POST', '/coop', { auth: true });
  }

  /** WebSocket URL for a room (`GET /coop/:room`). */
  coopSocketUrl(room: string): string {
    return toWebSocketUrl(this.baseUrl, `/coop/${room.toUpperCase()}`);
  }

  health(): Promise<HealthResponse> {
    return this.json<HealthResponse>('GET', '/health', { timeoutMs: this.healthTimeoutMs });
  }
}

/** Shared instance for the game. */
export const api = new ApiClient();
