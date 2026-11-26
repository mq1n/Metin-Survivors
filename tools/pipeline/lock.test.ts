import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lockFilePath, MANIFEST_LOCK, withLock, withLockSync } from './lock';
import { mergeManifest } from './manifest';

const temps: string[] = [];
function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

describe('tools/pipeline/lock', () => {
  test('acquires, serializes async callers, and releases cleanly on success and throw', async () => {
    const lockDir = makeTemp('ms-lock-test-');
    const order: string[] = [];

    const p1 = withLock(
      'alpha',
      async () => {
        order.push('p1:start');
        await new Promise((r) => setTimeout(r, 60));
        order.push('p1:end');
        return 1;
      },
      { lockDir, retryMinMs: 5, retryMaxMs: 20 },
    );
    await new Promise((r) => setTimeout(r, 10));
    const p2 = withLock(
      'alpha',
      async () => {
        order.push('p2:start');
        order.push('p2:end');
        return 2;
      },
      { lockDir, retryMinMs: 5, retryMaxMs: 20 },
    );

    expect(await Promise.all([p1, p2])).toEqual([1, 2]);
    expect(order).toEqual(['p1:start', 'p1:end', 'p2:start', 'p2:end']);
    expect(existsSync(lockFilePath('alpha', lockDir))).toBe(false);

    await expect(
      withLock(
        'alpha',
        async () => {
          throw new Error('boom');
        },
        { lockDir },
      ),
    ).rejects.toThrow('boom');
    expect(existsSync(lockFilePath('alpha', lockDir))).toBe(false);
  });

  test('reclaims stale locks from dead PID, expired timestamp, or old corrupt file', () => {
    const lockDir = makeTemp('ms-lock-stale-');
    const file = lockFilePath('stale', lockDir);
    mkdirSync(lockDir, { recursive: true });

    // 1. Dead PID
    writeFileSync(file, JSON.stringify({ pid: 999_999_999, token: 'dead', at: Date.now(), label: 'dead' }));
    expect(withLockSync('stale', () => 'ok-dead', { lockDir, retryMinMs: 5, retryMaxMs: 15 })).toBe('ok-dead');
    expect(existsSync(file)).toBe(false);

    // 2. Expired timestamp for live PID
    writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'old', at: Date.now() - 60_000, label: 'old' }));
    expect(
      withLockSync('stale', () => 'ok-old', { lockDir, staleMs: 1000, retryMinMs: 5, retryMaxMs: 15 }),
    ).toBe('ok-old');
    expect(existsSync(file)).toBe(false);

    // 3. Old corrupt/empty lock file
    writeFileSync(file, '\0\0\0');
    const past = new Date(Date.now() - 30_000);
    utimesSync(file, past, past);
    expect(
      withLockSync('stale', () => 'ok-corrupt', {
        lockDir,
        corruptStaleMs: 1000,
        retryMinMs: 5,
        retryMaxMs: 15,
      }),
    ).toBe('ok-corrupt');
    expect(existsSync(file)).toBe(false);
  });

  test('times out when a fresh live lock is held by another holder', async () => {
    const lockDir = makeTemp('ms-lock-busy-');
    const file = lockFilePath('busy', lockDir);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'other-holder', at: Date.now(), label: 'holder' }));

    await expect(
      withLock('busy', async () => 'nope', {
        lockDir,
        timeoutMs: 80,
        staleMs: 60_000,
        retryMinMs: 10,
        retryMaxMs: 25,
      }),
    ).rejects.toThrow(/busy/i);
    // Must not delete another holder's live lock
    expect(existsSync(file)).toBe(true);
  });

  test('parallel cross-process manifest publications preserve both entries without loss', async () => {
    const root = makeTemp('ms-manifest-race-');
    const publicDir = join(root, 'public');
    const lockDir = join(root, 'locks');
    mkdirSync(join(publicDir, 'assets', 'manifest'), { recursive: true });
    mkdirSync(join(publicDir, 'assets', 'models', 'prop'), { recursive: true });

    // Seed an existing model
    const seedGlb = new Uint8Array([1, 2, 3, 4]);
    writeFileSync(join(publicDir, 'assets', 'models', 'prop', 'existing.11111111.glb'), seedGlb);
    writeFileSync(
      join(publicDir, 'assets', 'manifest', 'models.json'),
      JSON.stringify(
        {
          existing: {
            id: 'existing',
            url: 'assets/models/prop/existing.11111111.glb',
            kind: 'prop',
            height: 1,
            radius: 0.5,
            clips: {},
            tris: 1,
            bones: 0,
            bytes: 4,
          },
        },
        null,
        2,
      ),
    );

    const manifestMod = resolve(import.meta.dir, '..', 'forge', 'src', 'core', 'export', 'manifest.ts');
    const lockMod = resolve(import.meta.dir, 'lock.ts');
    const workerScript = join(root, 'worker.ts');
    writeFileSync(
      workerScript,
      `
import { writeModelAsset } from ${JSON.stringify(manifestMod)};
import { MANIFEST_LOCK, withLockSync } from ${JSON.stringify(lockMod)};
const id = process.argv[2]!;
const publicDir = process.argv[3]!;
const lockDir = process.argv[4]!;
const delayMs = Number(process.argv[5] ?? 0);
const model = {
  id,
  kind: 'prop' as const,
  height: 1,
  radius: 0.5,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
  indices: new Uint32Array([0, 1, 2]),
  clips: [],
};
const glb = new TextEncoder().encode('glb-' + id);
// Hold the manifest lock briefly around a barrier to maximize contention across child processes
withLockSync(MANIFEST_LOCK, () => {
  if (delayMs > 0) Bun.sleepSync(delayMs);
}, { lockDir, label: 'pre-' + id });
writeModelAsset(model, glb, { publicDir, lock: { lockDir }, mergeAggregate: true });
`,
    );

    const spawnWorker = (id: string, delayMs: number) =>
      Bun.spawn(['bun', workerScript, id, publicDir, lockDir, String(delayMs)], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

    const a = spawnWorker('writer_a', 50);
    const b = spawnWorker('writer_b', 50);
    const [codeA, codeB] = await Promise.all([a.exited, b.exited]);
    if (codeA !== 0) throw new Error(`worker_a failed: ${await new Response(a.stderr).text()}`);
    if (codeB !== 0) throw new Error(`worker_b failed: ${await new Response(b.stderr).text()}`);

    const modelsPart = JSON.parse(
      readFileSync(join(publicDir, 'assets', 'manifest', 'models.json'), 'utf8'),
    ) as Record<string, { id: string; url: string }>;
    expect(Object.keys(modelsPart).sort()).toEqual(['existing', 'writer_a', 'writer_b']);

    // Also verify mergeManifest preserves all three and every referenced file exists
    const merged = mergeManifest({ publicDir, lock: { lockDir } });
    expect(Object.keys(merged.manifest.models).sort()).toEqual(['existing', 'writer_a', 'writer_b']);
    for (const entry of Object.values(merged.manifest.models)) {
      expect(existsSync(join(publicDir, entry.url))).toBe(true);
    }
    expect(existsSync(lockFilePath(MANIFEST_LOCK, lockDir))).toBe(false);
  });
});
