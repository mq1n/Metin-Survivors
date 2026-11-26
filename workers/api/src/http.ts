import type { Context, Next } from 'hono';
import type { ApiErrorBody, ApiErrorCode } from '@ms/shared';
import type { ApiEnv } from './env';
import type { PlayerRow } from './auth';

export interface AppEnv {
  Bindings: ApiEnv;
  Variables: {
    requestId: string;
    ip: string;
    player: PlayerRow | null;
  };
}
export type Ctx = Context<AppEnv>;

/** Thrown anywhere in a handler; `onError` turns it into the structured error body. */
export class ApiException extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function errorBody(code: ApiErrorCode, message: string, requestId?: string, details?: Record<string, unknown>): ApiErrorBody {
  const error: ApiErrorBody['error'] = { code, message };
  if (requestId) error.requestId = requestId;
  if (details) error.details = details;
  return { error };
}

// ---------------------------------------------------------------------------
// Bodies

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/** Reads at most `maxBytes` of the request body; throws 413 as soon as the cap is exceeded (never buffers more). */
export async function readBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw new ApiException(413, 'payload_too_large', `Body exceeds ${maxBytes} bytes`, { maxBytes });
  }
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiException(413, 'payload_too_large', `Body exceeds ${maxBytes} bytes`, { maxBytes });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new ApiException(400, 'bad_request', 'Body is not valid UTF-8');
  }
}

/** Parses a JSON request body (cap `maxBytes`). Empty body → `undefined` when `optional`, else 400. */
export async function readJson(c: Ctx, maxBytes: number, optional = false): Promise<unknown> {
  const bytes = await readBodyBytes(c.req.raw, maxBytes);
  if (bytes.byteLength === 0) {
    if (optional) return undefined;
    throw new ApiException(400, 'bad_json', 'A JSON body is required');
  }
  const type = c.req.header('content-type') ?? '';
  if (!/\bapplication\/json\b/i.test(type)) {
    throw new ApiException(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  try {
    return JSON.parse(decodeUtf8(bytes));
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(400, 'bad_json', 'Body is not valid JSON');
  }
}

// ---------------------------------------------------------------------------
// CORS / origin allow-list

interface OriginRules {
  exact: Set<string>;
  /** `https://*.example.com`: exactly one extra DNS label */
  wildcards: { scheme: string; suffix: string }[];
  /** `http://localhost:*`: any port of that exact scheme + host (dev servers move between ports) */
  anyPort: Set<string>;
}
const ruleCache = new Map<string, OriginRules>();

function originRules(csv: string): OriginRules {
  let rules = ruleCache.get(csv);
  if (rules) return rules;
  rules = { exact: new Set(), wildcards: [], anyPort: new Set() };
  for (const raw of csv.split(',')) {
    const entry = raw.trim().replace(/\/+$/, '');
    if (!entry) continue;
    const m = /^(https?:\/\/)\*\.(.+)$/.exec(entry);
    const port = /^(https?:\/\/[^/:*]+):\*$/.exec(entry);
    if (m && m[1] && m[2]) rules.wildcards.push({ scheme: m[1], suffix: `.${m[2]}` });
    else if (port && port[1]) rules.anyPort.add(port[1]);
    else rules.exact.add(entry);
  }
  ruleCache.set(csv, rules);
  return rules;
}

export function originAllowed(env: ApiEnv, origin: string): boolean {
  const rules = originRules(env.ALLOWED_ORIGINS ?? '');
  if (rules.exact.has(origin)) return true;
  for (const w of rules.wildcards) {
    if (!origin.startsWith(w.scheme) || !origin.endsWith(w.suffix)) continue;
    const label = origin.slice(w.scheme.length, origin.length - w.suffix.length);
    if (/^[a-z0-9-]{1,63}$/i.test(label)) return true;
  }
  if (rules.anyPort.size > 0) {
    const m = /^(https?:\/\/[^/:]+):(\d{1,5})$/.exec(origin);
    if (m && m[1] && rules.anyPort.has(m[1]) && Number(m[2]) > 0 && Number(m[2]) < 65_536) return true;
  }
  return false;
}

const CORS_ALLOW_HEADERS = 'Authorization, Content-Type, If-Match, If-None-Match';
const CORS_EXPOSE_HEADERS = 'ETag, X-Save-Updated, X-Request-Id, Retry-After';

/**
 * The caller's address. Public requests carry the edge-set `CF-Connecting-IP`. Requests from the Pages proxy
 * (functions/api/[[path]].ts, service binding) carry it as well and additionally `X-Real-IP`, which the proxy copies from
 * its own `CF-Connecting-IP`. A public request always has the edge header, which wins, so a client-supplied `X-Real-IP`
 * can never pick its own rate-limit identity; the fallback only matters if the binding hop dropped the edge header.
 * Without either, every caller would share one rate-limit identity — `/health` reports it (`clientIp`).
 */
export function clientIp(req: Request): string | undefined {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? undefined;
}

/**
 * Request id, security headers, Origin allow-list (browsers only: requests without Origin pass), preflight.
 * Responses with a WebSocket (status 101) are returned untouched.
 */
export async function edgeMiddleware(c: Ctx, next: Next): Promise<Response | void> {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.set('ip', clientIp(c.req.raw) ?? 'local');
  c.set('player', null);

  const origin = c.req.header('origin');
  if (origin !== undefined && !originAllowed(c.env, origin)) {
    return c.json(errorBody('origin_not_allowed', 'Origin not allowed', requestId), 403, { 'X-Request-Id': requestId });
  }

  if (c.req.method === 'OPTIONS') {
    const headers: Record<string, string> = { 'X-Request-Id': requestId, Vary: 'Origin' };
    if (origin !== undefined) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
      headers['Access-Control-Allow-Headers'] = CORS_ALLOW_HEADERS;
      headers['Access-Control-Max-Age'] = '86400';
    }
    return new Response(null, { status: 204, headers });
  }

  await next();

  if (c.res.status === 101) return;
  c.header('X-Request-Id', requestId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Vary', 'Origin', { append: true });
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  if (origin !== undefined) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
  }
}
