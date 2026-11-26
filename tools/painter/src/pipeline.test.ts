import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertPublishableBake, isBetterCandidate, passesAlignmentGate, selectBestCandidate, type BakeReport } from './pipeline.ts';

function report(views: BakeReport['views'], err = 0.02): BakeReport {
  return {
    views,
    recon: { mean_abs_err_lowfreq: Object.fromEntries(Object.keys(views).map((k) => [k, err])) },
    prims: [{ prim: 0, T: 1024, covered: 1000, seen_frac: 0.98 }],
    files: ['tex.png', 'tex.webp'],
  };
}

describe('painter alignment gate', () => {
  it('accepts a bake whose views all align and meet IoU thresholds', () => {
    const r = report({
      front: { iou_before: 0.72, iou_after: 0.91, aligned: true },
      back: { iou_before: 0.7, iou_after: 0.88, aligned: true },
      left: { iou_before: 0.69, iou_after: 0.84, aligned: true },
    });
    expect(passesAlignmentGate(r)).toBe(true);
    expect(assertPublishableBake('wolf_test', r).gate).toBe(true);
  });

  it('refuses to publish or cache a bake that fails mean IoU, min view IoU, or view alignment', () => {
    const lowMean = report({
      front: { iou_before: 0.6, iou_after: 0.78, aligned: true },
      back: { iou_before: 0.6, iou_after: 0.76, aligned: true },
    });
    expect(passesAlignmentGate(lowMean)).toBe(false);
    expect(() => assertPublishableBake('wolf_low_mean', lowMean)).toThrow(/alignment gate failed/);

    const lowMin = report({
      front: { iou_before: 0.9, iou_after: 0.95, aligned: true },
      back: { iou_before: 0.9, iou_after: 0.95, aligned: true },
      left: { iou_before: 0.4, iou_after: 0.55, aligned: true },
    });
    expect(passesAlignmentGate(lowMin)).toBe(false);
    expect(() => assertPublishableBake('wolf_low_min', lowMin)).toThrow(/alignment gate failed/);

    const unaligned = report({
      front: { iou_before: 0.9, iou_after: 0.92, aligned: true },
      back: { iou_before: 0.85, iou_after: 0.86, aligned: false },
    });
    expect(passesAlignmentGate(unaligned)).toBe(false);
    expect(() => assertPublishableBake('wolf_unaligned', unaligned)).toThrow(/alignment gate failed/);
  });

  it('allows explicit debug override only when allowFailedGate is true', () => {
    const failing = report({
      front: { iou_before: 0.5, iou_after: 0.6, aligned: false },
    });
    expect(assertPublishableBake('wolf_override', failing, { allowFailedGate: true }).gate).toBe(false);
  });

  it('strictly prefers a gate-passing candidate over a higher-scoring unaccepted candidate (TOOL-05)', () => {
    const attempt1 = { id: 'attempt1', gate: true, score: 0.82 };
    const attempt2 = { id: 'attempt2', gate: false, score: 0.95 };

    // Attempt 1 passes gate (0.82), attempt 2 fails gate (0.95) -> attempt 1 MUST win
    expect(isBetterCandidate(attempt2, attempt1)).toBe(false);
    expect(selectBestCandidate([attempt1, attempt2])?.id).toBe('attempt1');

    // Reversed order: attempt 2 first (failing 0.95), then attempt 1 (passing 0.82) -> attempt 1 still wins
    expect(isBetterCandidate(attempt1, attempt2)).toBe(true);
    expect(selectBestCandidate([attempt2, attempt1])?.id).toBe('attempt1');

    // Among two passing candidates, higher score wins
    const attempt3 = { id: 'attempt3', gate: true, score: 0.89 };
    expect(selectBestCandidate([attempt1, attempt2, attempt3])?.id).toBe('attempt3');

    // Real BakeReport gate evaluation: passing report (score ~0.82) beats unaligned high-IoU report (score ~0.95)
    const passingReport = report(
      {
        front: { iou_before: 0.75, iou_after: 0.85, aligned: true },
        back: { iou_before: 0.75, iou_after: 0.85, aligned: true },
      },
      0.02, // score = 0.85 - 1.5*0.02 = 0.82
    );
    const failingHighScoreReport = report(
      {
        front: { iou_before: 0.95, iou_after: 0.96, aligned: true },
        back: { iou_before: 0.95, iou_after: 0.97, aligned: false },
      },
      0.01, // score = 0.965 - 0.015 = 0.95, but fails gate because aligned: false
    );
    expect(passesAlignmentGate(passingReport)).toBe(true);
    expect(passesAlignmentGate(failingHighScoreReport)).toBe(false);
    const picked = selectBestCandidate([
      { id: 'r1', report: passingReport, gate: passesAlignmentGate(passingReport), score: 0.82 },
      { id: 'r2', report: failingHighScoreReport, gate: passesAlignmentGate(failingHighScoreReport), score: 0.95 },
    ]);
    expect(picked?.id).toBe('r1');
  });
});

describe('painter batch CLI exit code', () => {
  it('exits non-zero when one or more batch jobs fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-painter-batch-'));
    try {
      const jobsFile = join(dir, 'fail_jobs.json');
      writeFileSync(
        jobsFile,
        JSON.stringify({
          jobs: [{ id: 'missing_model_test', subject: 'test subject', glb: join(dir, 'does_not_exist.glb') }],
        }),
      );
      const cli = resolve(import.meta.dir, 'cli.ts');
      const proc = Bun.spawnSync([process.execPath, cli, 'batch', jobsFile], { stdout: 'pipe', stderr: 'pipe' });
      expect(proc.exitCode).toBe(1);
      const stdout = new TextDecoder().decode(proc.stdout);
      expect(stdout).toContain('missing_model_test');
      expect(stdout).toContain('FAILED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 when batch has zero failed jobs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-painter-batch-ok-'));
    try {
      const jobsFile = join(dir, 'empty_jobs.json');
      writeFileSync(jobsFile, JSON.stringify({ jobs: [] }));
      const cli = resolve(import.meta.dir, 'cli.ts');
      const proc = Bun.spawnSync([process.execPath, cli, 'batch', jobsFile], { stdout: 'pipe', stderr: 'pipe' });
      expect(proc.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero when --parallel, --tries, or --candidates is non-positive or NaN', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-painter-bad-flags-'));
    try {
      const jobsFile = join(dir, 'empty_jobs.json');
      writeFileSync(jobsFile, JSON.stringify({ jobs: [] }));
      const cli = resolve(import.meta.dir, 'cli.ts');
      for (const flagVal of ['0', '-1', 'NaN']) {
        const proc = Bun.spawnSync([process.execPath, cli, 'batch', jobsFile, '--parallel', flagVal], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(proc.exitCode, `--parallel ${flagVal}`).toBe(1);
        expect(new TextDecoder().decode(proc.stderr)).toMatch(/positive integer/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
