import { ApiException, type Ctx } from './http';
import { hmacSha256Hex, sha256Hex } from './crypto';
import type { ApiEnv } from './env';

/**
 * Rate limiting for a PUBLIC deployment, two layers:
 *  1. Edge counters (Workers Rate Limiting bindings RL_IP / RL_PLAYER): every request, no D1 writes.
 *  2. Exact D1 fixed-window counters for sensitive/expensive endpoints (`enforce`), per IP and per player.
 */
export interface RateRule {
  /** counter namespace; part of the D1 key */
  name: string;
  limit: number;
  windowSec: number;
}

export const RULES = {
  // Sized for shared addresses: Turkish mobile carriers put many subscribers behind one CGNAT IPv4 and internet cafés
  // often wipe browser storage between sessions (every visit registers again). Identity spam is bounded by the
  // per-player run limits and the plausibility envelope, not by this counter.
  register: [
    { name: 'register_h', limit: 30, windowSec: 3600 },
    { name: 'register_d', limit: 200, windowSec: 86_400 },
  ],
  rename: [{ name: 'rename_h', limit: 5, windowSec: 3600 }],
  runPlayer: [
    { name: 'run_m', limit: 15, windowSec: 60 },
    { name: 'run_h', limit: 80, windowSec: 3600 },
  ],
  runIp: [{ name: 'run_ip_h', limit: 200, windowSec: 3600 }],
  savePutPlayer: [
    { name: 'save_m', limit: 12, windowSec: 60 },
    { name: 'save_h', limit: 120, windowSec: 3600 },
  ],
  savePutIp: [{ name: 'save_ip_h', limit: 300, windowSec: 3600 }],
  transferCreate: [{ name: 'xfer_h', limit: 6, windowSec: 3600 }],
  transferClaimIp: [
    { name: 'claim_10m', limit: 10, windowSec: 600 },
    { name: 'claim_d', limit: 60, windowSec: 86_400 },
  ],
  coopCreatePlayer: [{ name: 'coop_new_h', limit: 12, windowSec: 3600 }],
  coopCreateIp: [{ name: 'coop_new_ip_h', limit: 40, windowSec: 3600 }],
  coopJoinPlayer: [{ name: 'coop_join_10m', limit: 40, windowSec: 600 }],
  coopJoinIp: [{ name: 'coop_join_ip_10m', limit: 120, windowSec: 600 }],
} satisfies Record<string, RateRule[]>;

const RATE_SQL = `INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1)
  ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
    window_start = excluded.window_start
  RETURNING count`;

function tooMany(retryAfterSec: number, rule?: string): ApiException {
  return new ApiException(
    429,
    'rate_limited',
    'Too many requests, slow down',
    rule ? { retryAfterSec, rule } : { retryAfterSec },
    { 'Retry-After': String(retryAfterSec) },
  );
}

/** Counts one hit for every rule (D1) and throws 429 when any is over its limit. `subject` is e.g. `ip:<hash>` / `p:<id>`. */
export async function enforce(env: ApiEnv, rules: readonly RateRule[], subject: string, now = Date.now()): Promise<void> {
  const stmts = rules.map((r) => {
    const windowMs = r.windowSec * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    return env.DB.prepare(RATE_SQL).bind(`${r.name}:${subject}`, windowStart);
  });
  const results = await env.DB.batch<{ count: number }>(stmts);
  let retryAfterSec = 0;
  let ruleName = '';
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] as RateRule;
    const count = results[i]?.results[0]?.count ?? 0;
    if (count <= r.limit) continue;
    const windowMs = r.windowSec * 1000;
    const windowEnd = (Math.floor(now / windowMs) + 1) * windowMs;
    const retry = Math.max(1, Math.ceil((windowEnd - now) / 1000));
    if (retry > retryAfterSec) {
      retryAfterSec = retry;
      ruleName = r.name;
    }
  }
  if (retryAfterSec > 0) throw tooMany(retryAfterSec, ruleName);
}

/** Rate-limit identity of a client address: IPv4 as is, IPv6 collapsed to its /64 (one subscriber owns a whole /64). */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return mapped[1];
  const [head = '', tail] = lower.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups = tail === undefined ? first : [...first, ...new Array<string>(Math.max(0, 8 - first.length - last.length)).fill('0'), ...last];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Stable counter subject for a client IP. With the `IP_HASH_SECRET` Worker secret set (production:
 * `wrangler secret put IP_HASH_SECRET`) it is an HMAC-SHA-256 of the address, so `rate_counters` rows — and D1 exports or
 * backups — cannot be turned back into IPs by hashing the whole IPv4 space. Without the secret it falls back to a plain
 * SHA-256 (pseudonymous only; fine for local dev and tests).
 */
export async function ipSubject(ip: string, secret?: string): Promise<string> {
  const data = `ip|${ipKey(ip)}`;
  const digest = secret ? await hmacSha256Hex(secret, data) : await sha256Hex(data);
  return `ip:${digest.slice(0, 24)}`;
}

/** {@link ipSubject} of the calling client. */
export function clientSubject(c: Ctx): Promise<string> {
  return ipSubject(c.get('ip'), c.env.IP_HASH_SECRET || undefined);
}

/** Edge-level flood guard for every request (per IP). Skipped when the binding is absent (e.g. bare local tooling). */
export async function edgeGuardIp(c: Ctx): Promise<void> {
  const rl = c.env.RL_IP;
  if (!rl) return;
  const { success } = await rl.limit({ key: ipKey(c.get('ip')) });
  if (!success) throw tooMany(60);
}

export async function edgeGuardPlayer(c: Ctx, playerId: string): Promise<void> {
  const rl = c.env.RL_PLAYER;
  if (!rl) return;
  const { success } = await rl.limit({ key: playerId });
  if (!success) throw tooMany(60);
}

/** Removes counters whose window ended more than a day ago. */
export async function sweepRateCounters(db: D1Database, now = Date.now()): Promise<number> {
  const res = await db.prepare('DELETE FROM rate_counters WHERE window_start < ?1').bind(now - 2 * 86_400_000).run();
  return res.meta.changes ?? 0;
}
