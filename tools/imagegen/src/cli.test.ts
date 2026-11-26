import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parsePositiveInt } from './cli';
import { buildMany } from './post';
import { defaultRunOptions, runJobs } from './runner';

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

describe('imagegen CLI exit codes and numeric validation (TOOL-03)', () => {
  test('parsePositiveInt rejects 0, negative, NaN, Infinity, non-integers, and empty strings', () => {
    expect(parsePositiveInt(undefined, 4, '--parallel')).toBe(4);
    expect(parsePositiveInt('3', 4, '--parallel')).toBe(3);
    for (const bad of ['0', '-1', 'NaN', 'Infinity', '1.5', 'abc', '', '  ']) {
      expect(() => parsePositiveInt(bad, 4, '--parallel')).toThrow(/positive integer/);
    }
  });

  test('buildMany and runJobs reject non-positive or NaN worker/attempt counts', async () => {
    await expect(buildMany([], 0)).rejects.toThrow(/positive integer/);
    await expect(buildMany([], Number.NaN)).rejects.toThrow(/positive integer/);
    await expect(runJobs([], { ...defaultRunOptions, concurrency: 0 })).rejects.toThrow(/positive integer/);
    await expect(runJobs([], { ...defaultRunOptions, maxAttempts: -2 })).rejects.toThrow(/positive integer/);
    await expect(runJobs([], { ...defaultRunOptions, batchSize: Number.NaN })).rejects.toThrow(/positive integer/);
  });

  test('failed imagegen build CLI exits nonzero while preserving per-item failure summary', () => {
    const research = makeTemp('ms-imagegen-build-fail-');
    const rawDir = join(research, 'raw');
    mkdirSync(rawDir, { recursive: true });
    // Invalid PNG bytes trigger a deterministic post.py failure without calling any remote model
    writeFileSync(join(rawDir, 'audit_build_failure.png'), 'not-a-valid-png');
    const jobFile = join(research, 'fail.jsonl');
    writeFileSync(
      jobFile,
      JSON.stringify({
        id: 'audit_build_failure',
        group: 'audit',
        kind: 'vfx',
        size: 64,
        post: [],
        prompt: 'audit test failure fixture',
      }) + '\n',
    );

    const cli = resolve(import.meta.dir, 'cli.ts');
    const proc = Bun.spawnSync([process.execPath, cli, 'build', '--file', jobFile], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, MS_IMAGEGEN_RESEARCH: research },
    });
    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    expect(proc.exitCode).toBe(1);
    expect(stdout).toContain('0/1 built');
    expect(stdout).toContain('failed: audit_build_failure');
    expect(stderr).toContain('audit_build_failure FAILED');
  }, 30_000);

  test('imagegen CLI rejects invalid --parallel / --concurrency / --attempts with nonzero exit', () => {
    const cli = resolve(import.meta.dir, 'cli.ts');
    const research = makeTemp('ms-imagegen-bad-flags-');
    const jobFile = join(research, 'empty.jsonl');
    writeFileSync(jobFile, '');

    for (const args of [
      ['build', '--file', jobFile, '--parallel', '0'],
      ['build', '--file', jobFile, '--parallel', 'NaN'],
      ['run', '--file', jobFile, '-c', '0'],
      ['run', '--file', jobFile, '--attempts=-1'],
    ]) {
      const proc = Bun.spawnSync([process.execPath, cli, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, MS_IMAGEGEN_RESEARCH: research },
      });
      expect(proc.exitCode, args.join(' ')).toBe(1);
      expect(new TextDecoder().decode(proc.stderr)).toMatch(/positive integer/);
    }
  });
});
