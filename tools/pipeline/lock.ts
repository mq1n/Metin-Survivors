// Tracked cross-process file mutex shared by asset producers, manifest merges, and QA snapshots.
// Lock files live outside the git working tree (under os.tmpdir(), scoped per repo root hash)
// so holding or releasing locks never dirties `git status`.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Canonical lock name shared by all manifest-part writers, aggregate manifest merges, and QA snapshots. */
export const MANIFEST_LOCK = 'manifest-parts';

export interface LockOptions {
  /** Max time to wait before failing (ms). Default: 120_000 (2 min). */
  timeoutMs?: number;
  /** Age after which a lock from a live PID is considered stale if not refreshed (ms). Default: 600_000 (10 min). */
  staleMs?: number;
  /** Age after which an unreadable/corrupt lock file is reclaimed (ms). Default: min(staleMs, 10_000). */
  corruptStaleMs?: number;
  /** Initial retry delay (ms). Default: 15. */
  retryMinMs?: number;
  /** Maximum retry delay (ms). Default: 150. */
  retryMaxMs?: number;
  /** Human-readable holder label written into the lock metadata. */
  label?: string;
  /** Override directory for lock files (defaults to MS_LOCK_DIR or repo-scoped temp dir). */
  lockDir?: string;
  /** Refresh the lock timestamp periodically while held (async `withLock` only). Default: true. */
  keepAlive?: boolean;
}

interface LockPayload {
  pid: number;
  token: string;
  at: number;
  label: string;
}

const DEFAULT_REPO_ROOT = resolve(import.meta.dir, '..', '..');

export function defaultLockDir(repoRoot = DEFAULT_REPO_ROOT): string {
  const normalized = process.platform === 'win32' ? resolve(repoRoot).toLowerCase() : resolve(repoRoot);
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return join(tmpdir(), 'ms-locks', hash);
}

export function lockFilePath(name: string, lockDir?: string): string {
  const dir = lockDir ?? process.env.MS_LOCK_DIR ?? defaultLockDir();
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new Error(`invalid lock name: ${JSON.stringify(name)}`);
  return join(dir, `${safe}.lock`);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readPayload(file: string): LockPayload | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockPayload>;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.at === 'number' &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0
    ) {
      return {
        pid: parsed.pid,
        token: parsed.token,
        at: parsed.at,
        label: typeof parsed.label === 'string' ? parsed.label : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function stillOurs(file: string, token: string): boolean {
  const payload = readPayload(file);
  return payload !== null && payload.pid === process.pid && payload.token === token;
}

function tryTake(file: string, token: string, label: string, staleMs: number, corruptStaleMs: number): boolean {
  const payload: LockPayload = { pid: process.pid, token, at: Date.now(), label };
  try {
    const fd = openSync(file, 'wx');
    try {
      writeSync(fd, JSON.stringify(payload));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      mkdirSync(dirname(file), { recursive: true });
      return false;
    }
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') {
      throw err;
    }
    // Check if the existing lock is stale (dead PID, expired timestamp, or old corrupt/empty file)
    const existing = readPayload(file);
    if (existing) {
      if (!pidAlive(existing.pid) || Date.now() - existing.at > staleMs) {
        // Re-verify before unlinking so we don't unlink a lock freshly acquired by another contender
        const recheck = readPayload(file);
        if (recheck && recheck.token === existing.token && recheck.pid === existing.pid && recheck.at === existing.at) {
          try {
            rmSync(file, { force: true });
          } catch {
            /* raced with another contender */
          }
        }
      }
    } else {
      try {
        const age = Date.now() - statSync(file).mtimeMs;
        if (age > corruptStaleMs) {
          rmSync(file, { force: true });
        }
      } catch {
        /* file already gone or inaccessible */
      }
    }
    return false;
  }
}

function describeHolder(file: string): string {
  const existing = readPayload(file);
  if (!existing) return 'unknown';
  const ageMs = Math.max(0, Date.now() - existing.at);
  return `pid=${existing.pid} label=${existing.label || '?'} age=${ageMs}ms`;
}

function resolveParams(name: string, opts: LockOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const staleMs = opts.staleMs ?? 10 * 60_000;
  const corruptStaleMs = opts.corruptStaleMs ?? Math.min(staleMs, 10_000);
  const retryMinMs = Math.max(1, opts.retryMinMs ?? 15);
  const retryMaxMs = Math.max(retryMinMs, opts.retryMaxMs ?? 150);
  const label = opts.label ?? name;
  const file = lockFilePath(name, opts.lockDir);
  return { timeoutMs, staleMs, corruptStaleMs, retryMinMs, retryMaxMs, label, file };
}

/** Acquire a cross-process file lock synchronously, run `fn`, and release in `finally`. */
export function withLockSync<T>(name: string, fn: () => T, opts?: LockOptions): T {
  const { timeoutMs, staleMs, corruptStaleMs, retryMinMs, retryMaxMs, label, file } = resolveParams(name, opts);
  mkdirSync(dirname(file), { recursive: true });
  const token = randomBytes(12).toString('hex');
  const deadline = Date.now() + timeoutMs;
  let delay = retryMinMs;

  while (!tryTake(file, token, label, staleMs, corruptStaleMs)) {
    if (Date.now() >= deadline) {
      throw new Error(`lock "${name}" busy for ${timeoutMs}ms (holder: ${describeHolder(file)})`);
    }
    const jitter = Math.floor(Math.random() * Math.max(4, Math.floor(delay / 2)));
    const waitMs = Math.min(delay + jitter, Math.max(1, deadline - Date.now()));
    Bun.sleepSync(waitMs);
    delay = Math.min(retryMaxMs, Math.round(delay * 1.5));
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    process.off('exit', release);
    if (stillOurs(file, token)) {
      try {
        rmSync(file, { force: true });
      } catch {
        /* ignore cleanup errors on shutdown */
      }
    }
  };
  process.once('exit', release);
  try {
    return fn();
  } finally {
    release();
  }
}

/** Acquire a cross-process file lock asynchronously (with optional keep-alive heartbeat), run `fn`, and release in `finally`. */
export async function withLock<T>(name: string, fn: () => Promise<T> | T, opts?: LockOptions): Promise<T> {
  const { timeoutMs, staleMs, corruptStaleMs, retryMinMs, retryMaxMs, label, file } = resolveParams(name, opts);
  const keepAlive = opts?.keepAlive ?? true;
  mkdirSync(dirname(file), { recursive: true });
  const token = randomBytes(12).toString('hex');
  const deadline = Date.now() + timeoutMs;
  let delay = retryMinMs;

  while (!tryTake(file, token, label, staleMs, corruptStaleMs)) {
    if (Date.now() >= deadline) {
      throw new Error(`lock "${name}" busy for ${timeoutMs}ms (holder: ${describeHolder(file)})`);
    }
    const jitter = Math.floor(Math.random() * Math.max(4, Math.floor(delay / 2)));
    const waitMs = Math.min(delay + jitter, Math.max(1, deadline - Date.now()));
    await new Promise((r) => setTimeout(r, waitMs));
    delay = Math.min(retryMaxMs, Math.round(delay * 1.5));
  }

  let released = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  if (keepAlive && staleMs >= 100) {
    const intervalMs = Math.max(50, Math.min(60_000, Math.floor(staleMs / 3)));
    heartbeat = setInterval(() => {
      if (released || !stillOurs(file, token)) return;
      try {
        writeFileSync(file, JSON.stringify({ pid: process.pid, token, at: Date.now(), label } satisfies LockPayload));
      } catch {
        /* retried next heartbeat */
      }
    }, intervalMs);
    (heartbeat as { unref?: () => void }).unref?.();
  }

  const release = (): void => {
    if (released) return;
    released = true;
    if (heartbeat) clearInterval(heartbeat);
    process.off('exit', release);
    if (stillOurs(file, token)) {
      try {
        rmSync(file, { force: true });
      } catch {
        /* ignore cleanup errors on shutdown */
      }
    }
  };
  process.once('exit', release);
  try {
    return await fn();
  } finally {
    release();
  }
}
