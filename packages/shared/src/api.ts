// @ms/shared/api — DTOs, constants and zod-free runtime guards for the HTTP API (ARCHITECTURE §10).
//
// Everything here is environment-neutral (no DOM, no Worker types) so the game client and the Worker
// compile against the exact same definitions. Guards never throw: they return `Validation<T>`.

export const API_BASE_PATH = '/api/v1' as const;

// ---------------------------------------------------------------------------


export const CLASS_IDS = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'] as const;
export type ClassId = (typeof CLASS_IDS)[number];
export const DIFFICULTIES = ['normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const ZONE_IDS = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;
export type ZoneId = (typeof ZONE_IDS)[number];
export const EMPIRE_IDS = ['saehwa', 'chowon', 'jihae'] as const;
export type EmpireId = (typeof EMPIRE_IDS)[number];
export const SEXES = ['m', 'f'] as const;
export type Sex = (typeof SEXES)[number];
export const DOCTRINE_KEYS = ['a', 'b'] as const;
export type DoctrineKey = (typeof DOCTRINE_KEYS)[number];

/** Periods the client offers as chips. The day board ({@link DAILY_PERIOD}) is deliberately not in this list (see below). */
export const LEADERBOARD_PERIODS = ['all', 'week'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];
/**
 * The Daily Challenge board (`bests.period = 'd<UTC day number>'`). GET /leaderboard accepts it next to
 * {@link LEADERBOARD_PERIODS}, but the list above stays `['all', 'week']` so no chip appears before the daily screens ship.
 */
export const DAILY_PERIOD = 'day' as const;
export type BoardPeriod = LeaderboardPeriod | typeof DAILY_PERIOD;
/** Largest UTC day number a submission may name (year ~4700); the real window is checked against the clock. */
export const DAILY_DAY_MAX = 1_000_000;
/** Solo and co-op runs rank on separate boards. */
export const LEADERBOARD_MODES = ['solo', 'coop'] as const;
export type LeaderboardMode = (typeof LEADERBOARD_MODES)[number];

export const PARTY_MIN = 2;
export const PARTY_MAX = 4;

// ---------------------------------------------------------------------------
// Constants

/** Version string the client reports with every run; the Worker keeps an allow-list (ALLOWED_CLIENT_VERSIONS). */
export const CLIENT_VERSION = '1.1.0';
/** Bumped whenever {@link computeScore} changes; informational. */
export const SCORE_VERSION = 1;
/** Nominal run length in seconds (balance.runLength). */
export const RUN_LENGTH_SEC = 900;
/**
 * A run clock may exceed {@link RUN_LENGTH_SEC} while the final boss is alive (PLAN §3.6: enrage after 3 min, then the
 * enraged boss must still be killed; with Run Options' ×3 boss health honest victories land as late as ~1,350 s and the
 * game has no hard time limit). Runs longer than `RUN_LENGTH_SEC + RUN_DURATION_SLACK_SEC` are accepted but flagged
 * (stored, never ranked); only {@link RUN_FIELD_MAX}.duration is a validation limit.
 */
export const RUN_DURATION_SLACK_SEC = 600;

export const NAME_MIN = 3;
export const NAME_MAX = 16;

export const SAVE_MAX_BYTES = 256 * 1024;

/** Unambiguous code alphabet (no 0/1/I/L/O): 31 symbols. Used for transfer codes (8) and co-op rooms (6). */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TRANSFER_CODE_LENGTH = 8;
export const TRANSFER_CODE_TTL_SEC = 15 * 60;
export const ROOM_CODE_LENGTH = 6;

export const LEADERBOARD_DEFAULT_LIMIT = 25;
export const LEADERBOARD_MAX_LIMIT = 100;

export const PLAYER_ID_LENGTH = 16;
export const SECRET_LENGTH = 32;

export const RUN_ID_MIN = 8;
export const RUN_ID_MAX = 40;

/** Response header carrying the cloud save's last-modified time (ms since epoch); the revision is the `ETag`. */
export const SAVE_UPDATED_HEADER = 'X-Save-Updated';

// ---------------------------------------------------------------------------
// Validation plumbing

export type Validation<T> = { ok: true; value: T } | { ok: false; field: string; reason: string };

const ok = <T>(value: T): Validation<T> => ({ ok: true, value });
const fail = (field: string, reason: string): Validation<never> => ({ ok: false, field, reason });

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readInt(obj: Record<string, unknown>, key: string, min: number, max: number, field = key): Validation<number> {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) return fail(field, 'must be an integer');
  if (v < min || v > max) return fail(field, `must be between ${min} and ${max}`);
  return ok(v);
}

function readNum(obj: Record<string, unknown>, key: string, min: number, max: number, field = key): Validation<number> {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(field, 'must be a finite number');
  if (v < min || v > max) return fail(field, `must be between ${min} and ${max}`);
  return ok(v);
}

function readEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  field = key,
): Validation<T> {
  const v = obj[key];
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) return fail(field, `must be one of ${values.join('|')}`);
  return ok(v as T);
}

export function isOneOf<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Auth token  (Authorization: Bearer <playerId>.<secret>)

const B64URL_PLAYER = /^[A-Za-z0-9_-]{16}$/;
const B64URL_SECRET = /^[A-Za-z0-9_-]{32}$/;

export interface Credentials {
  playerId: string;
  secret: string;
}

export function formatBearer(c: Credentials): string {
  return `${c.playerId}.${c.secret}`;
}

/** Parses `<playerId>.<secret>` (without the `Bearer ` prefix). */
export function parseToken(token: string): Credentials | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const playerId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!B64URL_PLAYER.test(playerId) || !B64URL_SECRET.test(secret)) return null;
  return { playerId, secret };
}

/** Parses an `Authorization` header value (`Bearer <playerId>.<secret>`). */
export function parseBearer(header: string | null | undefined): Credentials | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m && m[1] ? parseToken(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Display names

// ASCII letters/digits + Turkish letters (ç ğ ı i̇ ö ş ü, circumflexed â î û); single separators between segments.
const NAME_ALNUM = 'A-Za-z0-9\u00C7\u00E7\u011E\u011F\u0130\u0131\u00D6\u00F6\u015E\u015F\u00DC\u00FC\u00C2\u00E2\u00CE\u00EE\u00DB\u00FB';
const NAME_RE = new RegExp(`^[${NAME_ALNUM}]+(?:[ _.\\-][${NAME_ALNUM}]+)*$`);

/** NFC-normalise + trim. Format only (length 3–16, charset); profanity is the Worker's job. */
export function validateDisplayName(raw: unknown, field = 'name'): Validation<string> {
  if (typeof raw !== 'string') return fail(field, 'must be a string');
  if (raw.length > NAME_MAX * 4) return fail(field, `must be ${NAME_MIN}-${NAME_MAX} characters`);
  const name = raw.normalize('NFC').trim();
  const len = [...name].length;
  if (len < NAME_MIN || len > NAME_MAX) return fail(field, `must be ${NAME_MIN}-${NAME_MAX} characters`);
  if (!NAME_RE.test(name)) return fail(field, 'letters, digits, and single space/underscore/dot/dash separators only');
  return ok(name);
}

// ---------------------------------------------------------------------------
// Errors

export type ApiErrorCode =
  | 'bad_request'
  | 'bad_json'
  | 'validation'
  | 'name_rejected'
  | 'unauthorized'
  | 'forbidden'
  | 'banned'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rev_conflict'
  | 'precondition_required'
  | 'no_save'
  | 'rate_limited'
  | 'client_outdated'
  | 'implausible_run'
  | 'daily_mismatch'
  | 'invalid_code'
  | 'room_not_found'
  | 'room_full'
  | 'room_in_progress'
  | 'origin_not_allowed'
  | 'upgrade_required'
  | 'unavailable'
  | 'internal';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId?: string;
    /**
     * validation: `{ field, reason }`; rate_limited: `{ retryAfterSec }`; rev_conflict: `{ currentRev }`; implausible_run:
     * `{ reasons }`; daily_mismatch: `{ field, reason }` (reason `out_of_window` = the day is no longer open: not retryable)
     */
    details?: Record<string, unknown>;
  };
}

export function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (!isRecord(v) || !isRecord(v.error)) return false;
  return typeof v.error.code === 'string' && typeof v.error.message === 'string';
}

// ---------------------------------------------------------------------------
// POST /players, PATCH /players/me

export interface RegisterRequest {
  /** Optional: the Worker assigns `Kahraman####` when omitted. */
  name?: string;
}
export interface RegisterResponse {
  playerId: string;
  /** Shown exactly once — only sha256(secret) is stored. */
  secret: string;
  name: string;
}

export interface RenameRequest {
  name: string;
}
export interface RenameResponse {
  playerId: string;
  name: string;
}

export function parseRegisterRequest(body: unknown): Validation<RegisterRequest> {
  if (body === undefined || body === null) return ok({});
  if (!isRecord(body)) return fail('body', 'must be a JSON object');
  if (body.name === undefined) return ok({});
  const name = validateDisplayName(body.name);
  return name.ok ? ok({ name: name.value }) : name;
}

export function parseRenameRequest(body: unknown): Validation<RenameRequest> {
  if (!isRecord(body)) return fail('body', 'must be a JSON object');
  const name = validateDisplayName(body.name);
  return name.ok ? ok({ name: name.value }) : name;
}

// ---------------------------------------------------------------------------
// POST /runs

export interface RunStats {
  /** Enemies killed, elites and bosses included. */
  kills: number;
  elites: number;
  bosses: number;
  /** Metin stones broken (the Great Metin counts). */
  metins: number;
  /** Final hero level (starts at 1). */
  level: number;
  /** Yeop collected during the run. */
  yeop: number;
}

/** The pre-run difficulty sliders (balance.json `runOptions`): multipliers, 1 = off. */
export const RUN_OPTION_KEYS = ['density', 'health', 'damage', 'speed'] as const;
export type RunOptionKey = (typeof RUN_OPTION_KEYS)[number];
export type RunOptionsDto = Record<RunOptionKey, number>;
/** Slider range of the game (balance.json runOptions min / max; a test keeps them equal). */
export const RUN_OPTION_MIN = 1;
export const RUN_OPTION_MAX = 3;

export interface RunSubmission {
  /** Client-generated idempotency key (UUID-like, 8–40 of [A-Za-z0-9_-]); resubmitting returns the stored result. */
  runId: string;
  clientVersion: string;
  zone: ZoneId;
  difficulty: Difficulty;
  classId: ClassId;
  doctrine?: DoctrineKey;
  empire?: EmpireId;
  sex?: Sex;
  seed: number;
  /**
   * Co-op party size (integer 2..4); absent = solo. Co-op runs rank on the `mode=coop` boards only. Each player submits
   * their OWN kills/yeop/level together with the party-shared elites/bosses/metins and the party's run clock, so the
   * per-player numbers stay inside the solo plausibility envelopes.
   */
  coop?: number;
  /**
   * Daily Challenge: the UTC day number (see daily.ts `dayIndex`) of the spec this run played. Present only on a run that
   * followed `dailySpec(daily)`; the Worker accepts it for today or yesterday and only when zone, class, doctrine,
   * empire, difficulty, seed and `runOptions` equal the spec (else 400 `daily_mismatch`), solo only. Such a run ranks on
   * the day board and nowhere else.
   */
  daily?: number;
  /** Run Options the run was played with. Required (and checked) for a daily; accepted and ignored otherwise. */
  runOptions?: RunOptionsDto;
  victory: boolean;
  /** Run clock at the end of the run, seconds. */
  duration: number;
  /** Client wall clock when the run ended (ms since epoch); lets the offline queue flush late. */
  endedAt: number;
  stats: RunStats;
  /** Score the client computed with {@link computeScore}; the server recomputes and only records a mismatch. */
  score?: number;
}

export type RunStatus = 'ok' | 'flagged';

export interface RunResponse {
  /** Server-side run row id. */
  id: number;
  /** Authoritative score (server recomputation). */
  score: number;
  status: RunStatus;
  /** Board the run ranks on (`coop` when `RunSubmission.coop` was set). */
  mode: LeaderboardMode;
  /** `flagged` runs are stored but kept off the leaderboards. Reason codes, e.g. `kills_rate`. */
  flags: string[];
  /** True when `runId` was already submitted; the stored result is returned unchanged. */
  duplicate: boolean;
  /** New personal best for this mode+zone+difficulty (all classes, all time). */
  best: boolean;
  bestScore: number | null;
  /** All-time rank in mode+zone+difficulty across all classes; null when flagged. */
  rank: number | null;
  /** Rank in the current week (UTC Monday start). */
  weekRank: number | null;
  /** All-time rank within the run's class. */
  classRank: number | null;
  /**
   * Only on a submission that carried `daily`: the player's rank on that day's board (`rank`, `weekRank` and `classRank`
   * are null then: a daily ranks on the day board only). `best` / `bestScore` then describe the day board too.
   */
  dayRank?: number | null;
}

const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z.]{1,16})?$/;

/** Upper sanity bounds so absurd values fail validation before any plausibility maths. */
export const RUN_FIELD_MAX = {
  kills: 1_000_000,
  elites: 1_000_000,
  bosses: 1_000,
  metins: 10_000,
  level: 10_000,
  yeop: 2_000_000_000,
  duration: 7_200,
} as const;

export function parseRunSubmission(body: unknown): Validation<RunSubmission> {
  if (!isRecord(body)) return fail('body', 'must be a JSON object');

  const runId = body.runId;
  if (typeof runId !== 'string' || runId.length < RUN_ID_MIN || runId.length > RUN_ID_MAX || !RUN_ID_RE.test(runId)) {
    return fail('runId', `must be ${RUN_ID_MIN}-${RUN_ID_MAX} chars of [A-Za-z0-9_-]`);
  }
  const clientVersion = body.clientVersion;
  if (typeof clientVersion !== 'string' || !VERSION_RE.test(clientVersion)) return fail('clientVersion', 'must look like 1.2.3');

  const zone = readEnum(body, 'zone', ZONE_IDS);
  if (!zone.ok) return zone;
  const difficulty = readEnum(body, 'difficulty', DIFFICULTIES);
  if (!difficulty.ok) return difficulty;
  const classId = readEnum(body, 'classId', CLASS_IDS);
  if (!classId.ok) return classId;

  let doctrine: DoctrineKey | undefined;
  if (body.doctrine !== undefined) {
    const d = readEnum(body, 'doctrine', DOCTRINE_KEYS);
    if (!d.ok) return d;
    doctrine = d.value;
  }
  let empire: EmpireId | undefined;
  if (body.empire !== undefined) {
    const e = readEnum(body, 'empire', EMPIRE_IDS);
    if (!e.ok) return e;
    empire = e.value;
  }
  let sex: Sex | undefined;
  if (body.sex !== undefined) {
    const s = readEnum(body, 'sex', SEXES);
    if (!s.ok) return s;
    sex = s.value;
  }

  const seed = readInt(body, 'seed', 0, 0xffffffff);
  if (!seed.ok) return seed;
  if (typeof body.victory !== 'boolean') return fail('victory', 'must be a boolean');
  const duration = readNum(body, 'duration', 0, RUN_FIELD_MAX.duration);
  if (!duration.ok) return duration;
  const endedAt = readInt(body, 'endedAt', 0, 8_640_000_000_000_000);
  if (!endedAt.ok) return endedAt;

  const s = body.stats;
  if (!isRecord(s)) return fail('stats', 'must be an object');
  const kills = readInt(s, 'kills', 0, RUN_FIELD_MAX.kills, 'stats.kills');
  if (!kills.ok) return kills;
  const elites = readInt(s, 'elites', 0, RUN_FIELD_MAX.elites, 'stats.elites');
  if (!elites.ok) return elites;
  const bosses = readInt(s, 'bosses', 0, RUN_FIELD_MAX.bosses, 'stats.bosses');
  if (!bosses.ok) return bosses;
  const metins = readInt(s, 'metins', 0, RUN_FIELD_MAX.metins, 'stats.metins');
  if (!metins.ok) return metins;
  const level = readInt(s, 'level', 1, RUN_FIELD_MAX.level, 'stats.level');
  if (!level.ok) return level;
  const yeop = readInt(s, 'yeop', 0, RUN_FIELD_MAX.yeop, 'stats.yeop');
  if (!yeop.ok) return yeop;

  const out: RunSubmission = {
    runId,
    clientVersion,
    zone: zone.value,
    difficulty: difficulty.value,
    classId: classId.value,
    seed: seed.value,
    victory: body.victory,
    duration: Math.round(duration.value * 1000) / 1000,
    endedAt: endedAt.value,
    stats: {
      kills: kills.value,
      elites: elites.value,
      bosses: bosses.value,
      metins: metins.value,
      level: level.value,
      yeop: yeop.value,
    },
  };
  if (doctrine) out.doctrine = doctrine;
  if (empire) out.empire = empire;
  if (sex) out.sex = sex;
  if (body.coop !== undefined) {
    const party = readInt(body, 'coop', PARTY_MIN, PARTY_MAX);
    if (!party.ok) return party;
    out.coop = party.value;
  }
  if (body.score !== undefined) {
    const sc = readInt(body, 'score', 0, Number.MAX_SAFE_INTEGER);
    if (!sc.ok) return sc;
    out.score = sc.value;
  }
  if (body.daily !== undefined) {
    const day = readInt(body, 'daily', 0, DAILY_DAY_MAX);
    if (!day.ok) return day;
    out.daily = day.value;
  }
  if (body.runOptions !== undefined) {
    const ro = body.runOptions;
    if (!isRecord(ro)) return fail('runOptions', 'must be an object');
    const opts = {} as RunOptionsDto;
    for (const key of RUN_OPTION_KEYS) {
      const v = readNum(ro, key, RUN_OPTION_MIN, RUN_OPTION_MAX, `runOptions.${key}`);
      if (!v.ok) return v;
      opts[key] = v.value;
    }
    out.runOptions = opts;
  }
  return ok(out);
}

// ---------------------------------------------------------------------------
// Score (single source of truth: the client shows it, the Worker recomputes it)

export const SCORE_WEIGHTS = {
  kill: 10,
  elite: 100,
  boss: 1500,
  metin: 600,
  /** per level above 1 */
  level: 120,
  /** one point per `yeopPer` yeop */
  yeopPer: 10,
  /** per second survived */
  second: 5,
  victory: 25_000,
  hardMultiplier: 1.5,
} as const;

export function computeScore(
  stats: RunStats,
  ctx: { victory: boolean; duration: number; difficulty: Difficulty },
): number {
  const w = SCORE_WEIGHTS;
  const base =
    stats.kills * w.kill +
    stats.elites * w.elite +
    stats.bosses * w.boss +
    stats.metins * w.metin +
    Math.max(0, stats.level - 1) * w.level +
    Math.floor(stats.yeop / w.yeopPer) +
    Math.floor(Math.max(0, ctx.duration)) * w.second +
    (ctx.victory ? w.victory : 0);
  return Math.round(base * (ctx.difficulty === 'hard' ? w.hardMultiplier : 1));
}

// ---------------------------------------------------------------------------
// GET /leaderboard

export interface LeaderboardQuery {
  /** `solo` (default) excludes co-op runs; `coop` is the co-op board. */
  mode: LeaderboardMode;
  zone: ZoneId;
  difficulty: Difficulty;
  /** Class filter or `all`. */
  class: ClassId | 'all';
  /** `all` | `week`, or `day` ({@link DAILY_PERIOD}): today's Daily Challenge board (UTC). */
  period: BoardPeriod;
  limit: number;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  /** Class of the run that produced the entry. */
  classId: ClassId;
  /** Party size of the run: 1 on the solo board, 2..4 on the co-op board. */
  party: number;
  victory: boolean;
  level: number;
  kills: number;
  /** seconds */
  duration: number;
  /** ms since epoch */
  achievedAt: number;
  /** True for the authenticated caller's own row. */
  you: boolean;
}

export interface LeaderboardResponse {
  mode: LeaderboardMode;
  zone: ZoneId;
  difficulty: Difficulty;
  class: ClassId | 'all';
  period: BoardPeriod;
  /** Start of the current week window (ms, UTC Monday 00:00) when `period === 'week'`. */
  weekStart: number | null;
  /** UTC day number of the board when `period === 'day'` (absent otherwise). */
  day?: number;
  limit: number;
  /** Players ranked in this category. */
  total: number;
  entries: LeaderboardEntry[];
  /** The caller's own standing (even when outside the top N); null when unauthenticated or unranked. */
  you: LeaderboardEntry | null;
}

export interface QueryParamSource {
  get(name: string): string | null;
}

export function parseLeaderboardQuery(q: QueryParamSource): Validation<LeaderboardQuery> {
  const mode = q.get('mode') ?? 'solo';
  if (!isOneOf(LEADERBOARD_MODES, mode)) return fail('mode', 'must be solo|coop');
  const zone = q.get('zone');
  if (!zone || !isOneOf(ZONE_IDS, zone)) return fail('zone', `must be one of ${ZONE_IDS.join('|')}`);
  const difficulty = q.get('difficulty') ?? 'normal';
  if (!isOneOf(DIFFICULTIES, difficulty)) return fail('difficulty', `must be one of ${DIFFICULTIES.join('|')}`);
  const cls = q.get('class') ?? 'all';
  if (cls !== 'all' && !isOneOf(CLASS_IDS, cls)) return fail('class', `must be all or one of ${CLASS_IDS.join('|')}`);
  const period = q.get('period') ?? 'all';
  if (!isOneOf(LEADERBOARD_PERIODS, period) && period !== DAILY_PERIOD) return fail('period', `must be ${LEADERBOARD_PERIODS.join('|')}|${DAILY_PERIOD}`);
  const limitRaw = q.get('limit');
  let limit: number = LEADERBOARD_DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^\d{1,4}$/.test(limitRaw)) return fail('limit', `must be an integer 1-${LEADERBOARD_MAX_LIMIT}`);
    limit = Number(limitRaw);
    if (limit < 1 || limit > LEADERBOARD_MAX_LIMIT) return fail('limit', `must be an integer 1-${LEADERBOARD_MAX_LIMIT}`);
  }
  return ok({ mode, zone, difficulty, class: cls as ClassId | 'all', period: period as BoardPeriod, limit });
}

export function leaderboardQueryString(q: Partial<LeaderboardQuery> & Pick<LeaderboardQuery, 'zone'>): string {
  const parts = [`zone=${q.zone}`];
  if (q.mode) parts.push(`mode=${q.mode}`);
  if (q.difficulty) parts.push(`difficulty=${q.difficulty}`);
  if (q.class) parts.push(`class=${q.class}`);
  if (q.period) parts.push(`period=${q.period}`);
  if (q.limit !== undefined) parts.push(`limit=${q.limit}`);
  return parts.join('&');
}

// ---------------------------------------------------------------------------
// GET/PUT /save  (body = the raw SaveData JSON; revision travels in ETag / If-Match)

export interface SaveMeta {
  rev: number;
  /** ms since epoch */
  updatedAt: number;
  /** bytes */
  size: number;
}

/** Revision header helpers: ETag/If-Match carry the integer rev as a quoted string; `0` = "no cloud save yet". */
export function formatRev(rev: number): string {
  return `"${rev}"`;
}
export function parseRev(header: string | null | undefined): number | null {
  if (header === null || header === undefined) return null;
  const m = /^\s*(?:W\/)?"?(\d{1,15})"?\s*$/.exec(header);
  return m && m[1] !== undefined ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// POST /transfer, POST /transfer/claim

export interface TransferCreateResponse {
  /** 8 chars of {@link CODE_ALPHABET}; show as `ABCD-EFGH`. */
  code: string;
  /** ms since epoch */
  expiresAt: number;
  ttlSec: number;
}
export interface TransferClaimRequest {
  code: string;
}
/** The claiming device receives a fresh credential for the same player (the donor device stays valid). */
export interface TransferClaimResponse {
  playerId: string;
  secret: string;
  name: string;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

function isCode(raw: string, len: number): boolean {
  if (raw.length !== len) return false;
  for (let i = 0; i < raw.length; i++) if (!CODE_ALPHABET.includes(raw[i] as string)) return false;
  return true;
}

export const isTransferCode = (c: string): boolean => isCode(c, TRANSFER_CODE_LENGTH);
export const isRoomCode = (c: string): boolean => isCode(c, ROOM_CODE_LENGTH);

export function parseTransferClaimRequest(body: unknown): Validation<{ code: string }> {
  if (!isRecord(body) || typeof body.code !== 'string' || body.code.length > 32) return fail('code', 'must be a string');
  const code = normalizeCode(body.code);
  if (!isTransferCode(code)) return fail('code', `must be ${TRANSFER_CODE_LENGTH} characters`);
  return ok({ code });
}

// ---------------------------------------------------------------------------
// POST /coop, GET /health

export interface CoopCreateResponse {
  /** 6-char room code; connect with GET /coop/:room (WebSocket, subprotocol `ms.coop.v1`). */
  room: string;
}

export interface HealthResponse {
  ok: boolean;
  service: 'metin-survivors-api';
  api: typeof API_BASE_PATH;
  /** ms since epoch */
  time: number;
  db: boolean;
  blobs: boolean;
  /**
   * The Worker received the caller's address (per-client rate limits work). False means every caller shares one
   * rate-limit identity — the post-deploy smoke test checks it through the Pages proxy. Never the address itself.
   */
  clientIp?: boolean;
}
