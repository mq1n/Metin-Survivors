import { env, exports } from 'cloudflare:workers';
import { CLIENT_VERSION, type RegisterResponse, type RunSubmission } from '@ms/shared';

export const BASE = 'https://api.test/api/v1';

let counter = 0;
export function uid(prefix = 'run'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Unique client IP so per-IP counters never leak between tests unless a test pins one. */
export function freshIp(): string {
  counter += 1;
  return `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export interface Req {
  method?: string;
  token?: string;
  ip?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
}

export async function call(path: string, req: Req = {}): Promise<Response> {
  const headers: Record<string, string> = { 'cf-connecting-ip': req.ip ?? freshIp(), ...(req.headers ?? {}) };
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  let body = req.body;
  if (req.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.json);
  }
  return exports.default.fetch(new Request(`${BASE}${path}`, { method: req.method ?? (body ? 'POST' : 'GET'), headers, ...(body !== undefined ? { body } : {}) }));
}

export interface TestPlayer extends RegisterResponse {
  token: string;
  ip: string;
}

let nameCounter = 0;
export async function register(name?: string): Promise<TestPlayer> {
  nameCounter += 1;
  const ip = freshIp();
  const res = await call('/players', { method: 'POST', ip, json: { name: name ?? `Hero${nameCounter}x` } });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as RegisterResponse;
  return { ...body, token: `${body.playerId}.${body.secret}`, ip };
}

export function runBody(over: Partial<RunSubmission> = {}): RunSubmission {
  return {
    runId: uid(),
    clientVersion: CLIENT_VERSION,
    zone: 'yeonmu',
    difficulty: 'normal',
    classId: 'warrior',
    doctrine: 'a',
    empire: 'saehwa',
    sex: 'm',
    seed: 12345,
    victory: false,
    duration: 600,
    endedAt: Date.now() - 1000,
    stats: { kills: 2500, elites: 40, bosses: 3, metins: 8, level: 40, yeop: 20_000 },
    ...over,
  };
}

export async function submit(p: TestPlayer, run: RunSubmission): Promise<Response> {
  return call('/runs', { token: p.token, ip: p.ip, json: run });
}

export const sql = env.DB;
