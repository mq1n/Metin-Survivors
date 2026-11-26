// Machine-wide caps for shared heavy resources, with lock files in %TEMP% (stale locks — dead pid or older than the
// pool's max age — are reclaimed):

//   codex   concurrent `codex exec` image sessions (MS_CODEX_SLOTS, default 12; the ChatGPT account has a high quota since 2026-10-20, the machine is the limit) — tools/imagegen/src/codex.ts
//   gemini  concurrent Gemini image requests (MS_GEMINI_SLOTS, default 8) — tools/imagegen/src/gemini.ts
// plus withFileLockSync(): a mutex for read-modify-write of shared JSON (manifest parts, imagegen review state).
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLockSync } from '../pipeline/lock';

const ROOT = join(tmpdir(), 'ms-qa-locks');

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryTake(f: string, tag: string, maxAgeMs: number): boolean {
  try {
    const fd = openSync(f, 'wx');
    writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), tag }));
    closeSync(fd);
    return true;
  } catch {
    try {
      const st = JSON.parse(readFileSync(f, 'utf8')) as { pid: number; at: number };
      if (!pidAlive(st.pid) || Date.now() - st.at > maxAgeMs) rmSync(f, { force: true });
    } catch {
      // being written / removed by its owner - unless it has stayed unreadable for a minute: a lock left half-written by a
      // crash (seen 2026-10-21: slot2.lock = 48 NUL bytes) would otherwise block its slot forever
      try {
        if (Date.now() - statSync(f).mtimeMs > 60_000) rmSync(f, { force: true });
      } catch {
        /* already gone */
      }
    }
    return false;
  }
}

const POOLS: Record<string, { slots: number; maxAgeMs: number }> = {
  chrome: { slots: Number(process.env.MS_QA_SLOTS ?? 6), maxAgeMs: 20 * 60_000 },
  codex: { slots: Number(process.env.MS_CODEX_SLOTS ?? 12), maxAgeMs: 25 * 60_000 },
  gemini: { slots: Number(process.env.MS_GEMINI_SLOTS ?? 8), maxAgeMs: 20 * 60_000 },
};

/** the lock still holds what this process wrote last (a lock reclaimed as stale and re-taken by another process is not ours to delete) */
function stillOurs(f: string, at: number): boolean {
  try {
    const st = JSON.parse(readFileSync(f, 'utf8')) as { pid: number; at: number };
    return st.pid === process.pid && st.at === at;
  } catch {
    return false;
  }
}

/**
 * Blocks until a slot of `pool` is free; returns the release function (also released on process exit).
 * `keepAlive`: a holder that keeps its slot longer than the pool's max age (a playthrough lane: 20-120 min) re-stamps the lock every minute,
 * otherwise another process reclaims it as stale after 20 min while it is still in use (two Chromes on one slot). The release only deletes
 * the lock while it is still this holder's (it used to delete whatever lock file had that name, also a newer holder's).
 */
export async function acquireSlot(tag = 'chrome', pool: 'chrome' | 'codex' | 'gemini' = 'chrome', opts: { keepAlive?: boolean } = {}): Promise<() => void> {
  const cfg = POOLS[pool] ?? POOLS.chrome!;
  const dir = join(ROOT, pool);
  mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + 60 * 60_000;
  let waited = false;
  while (Date.now() < deadline) {
    for (let i = 0; i < cfg.slots; i++) {
      const f = join(dir, `slot${i}.lock`);
      if (!tryTake(f, tag, cfg.maxAgeMs)) continue;
      if (waited) console.error(`[slots] got ${pool} slot ${i}`);
      let done = false;
      let at = (() => {
        try {
          return (JSON.parse(readFileSync(f, 'utf8')) as { at: number }).at;
        } catch {
          return -1;
        }
      })();
      let timer: ReturnType<typeof setInterval> | null = null;
      if (opts.keepAlive) {
        timer = setInterval(() => {
          if (done || !stillOurs(f, at)) return;
          const next = Date.now();
          try {
            writeFileSync(f, JSON.stringify({ pid: process.pid, at: next, tag }));
            at = next;
          } catch {
            /* retried next minute */
          }
        }, 60_000);
        (timer as { unref?: () => void }).unref?.();
      }
      const release = (): void => {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        if (at < 0 || stillOurs(f, at)) rmSync(f, { force: true });
      };
      process.once('exit', release);
      return release;
    }
    if (!waited) console.error(`[slots] all ${cfg.slots} ${pool} slots busy, waiting…`);
    waited = true;
    await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));
  }
  throw new Error(`no free ${pool} slot within 60 min`);
}

/** Mutex for a short critical section (shared JSON read-modify-write). Delegates to the canonical pipeline lock. */
export function withFileLockSync<T>(name: string, fn: () => T, timeoutMs = 120_000): T {
  return withLockSync(name, fn, { timeoutMs });
}
