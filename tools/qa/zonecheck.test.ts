import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captureZone,
  evaluateZone,
  gateExitCode,
  summarizeChecks,
  type EvaluateDeps,
  type Meta,
  type ZoneFilter,
} from './zonecheck';

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

function makeFixtureDeps(root: string, overrides: Partial<EvaluateDeps> = {}): EvaluateDeps {
  const refPath = join(root, 'ref_field.png');
  writeFileSync(refPath, 'fake-ref');
  const meta: Meta = {
    gallery: {},
    scale: { oursPpmAtZoom22: 20, refIsoPpm: 20 },
    boxes: { hfField: [0, 0, 1, 1], edgeLower60: [0, 0.4, 1, 1], hero: [0.4, 0.4, 0.6, 0.6] },
    roles: {
      yeonmu: {
        field: { spawn: null },
        cliff: { ridge: null },
      },
    },
    refs: {
      yeonmu: [{ file: 'ref_field.png', box: [0, 0, 1, 1] }],
    },
  };
  const filter: ZoneFilter = { set: 'world', still: false, only: null };
  return {
    root,
    spotsAll: { yeonmu: { spawn: [0, 0, 22], ridge: [10, 10, 22] } },
    meta,
    content: [],
    py: (args) => {
      if (args[0] === 'stats') return { dominant: [['#556644', 0.5]] };
      if (args[0] === 'measure') return { mean_luma: 95, mean_saturation: 50, hf: 1.0, dark_frac: 0.01, flat_near_frac: 0.01, fine: 0.1 };
      if (args[0] === 'diff') return { mad_pct: 0.1 };
      return {};
    },
    findLook: () => ({ targets: {} }),
    resolveBiome: () => ({ fog: { color: '#808080' } }),
    baseline: null,
    tol: 0.5,
    filter,
    ...overrides,
  };
}

describe('TOOL-UI-02 zonecheck gate decisions', () => {
  test('empty shot directory records MISSING checks and exits nonzero', () => {
    const root = makeTemp('ms-zonecheck-empty-');
    const shotDir = join(root, 'shots', 'yeonmu');
    mkdirSync(shotDir, { recursive: true });
    const deps = makeFixtureDeps(root);

    const { checks } = evaluateZone('yeonmu', shotDir, deps);
    const summary = summarizeChecks(checks);

    expect(summary.missing).toBe(2); // spawn + ridge
    expect(summary.measured).toBe(0);
    expect(summary.ok).toBe(false);
    expect(gateExitCode({ yeonmu: summary })).toBe(1);
  });

  test('missing explicitly requested --baseline PNG records MISSING and exits nonzero', () => {
    const root = makeTemp('ms-zonecheck-base-');
    const shotDir = join(root, 'shots', 'yeonmu');
    const baseDir = join(root, 'baseline');
    mkdirSync(shotDir, { recursive: true });
    mkdirSync(join(baseDir, 'yeonmu'), { recursive: true });
    writeFileSync(join(shotDir, 'spawn.png'), 'shot');
    writeFileSync(join(shotDir, 'ridge.png'), 'shot');
    // Only provide ridge baseline; spawn baseline is missing
    writeFileSync(join(baseDir, 'yeonmu', 'ridge.png'), 'base');

    const deps = makeFixtureDeps(root, { baseline: baseDir });
    const { checks } = evaluateZone('yeonmu', shotDir, deps);
    const summary = summarizeChecks(checks);

    expect(checks.some((c) => c.check === 'diff' && c.spot === 'spawn' && c.status === 'MISSING')).toBe(true);
    expect(checks.some((c) => c.check === 'diff.madPct' && c.spot === 'ridge' && c.status === 'PASS')).toBe(true);
    expect(summary.missing).toBe(1);
    expect(summary.ok).toBe(false);
    expect(gateExitCode({ yeonmu: summary })).toBe(1);
  });

  test('failed capture subprocess is not ignored and causes nonzero exit', async () => {
    const root = makeTemp('ms-zonecheck-capfail-');
    const shotDir = join(root, 'shots', 'yeonmu');
    mkdirSync(shotDir, { recursive: true });
    const deps = makeFixtureDeps(root);

    const cap = await captureZone('yeonmu', shotDir, {
      spotsAll: deps.spotsAll,
      meta: deps.meta,
      filter: deps.filter,
      run: async () => ({ code: 2, out: '', err: 'playwright crash' }),
    });
    expect(cap.errors.length).toBe(1);

    // Even if stale shots existed on disk, a failed capture subprocess must fail the gate
    writeFileSync(join(shotDir, 'spawn.png'), 'stale');
    writeFileSync(join(shotDir, 'ridge.png'), 'stale');
    const { checks } = evaluateZone('yeonmu', shotDir, deps, cap.errors);
    const summary = summarizeChecks(checks, cap.errors);

    expect(summary.captureFailed).toBe(1);
    expect(summary.ok).toBe(false);
    expect(gateExitCode({ yeonmu: summary })).toBe(1);
  });

  test('--only records excluded roles as SKIPPED rather than MISSING and fails when zero checks are measured', () => {
    const root = makeTemp('ms-zonecheck-only-');
    const shotDir = join(root, 'shots', 'yeonmu');
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(join(shotDir, 'spawn.png'), 'shot');

    // Only select 'spawn'; 'ridge' is absent on disk but intentionally excluded -> SKIPPED -> gate PASSES
    const deps = makeFixtureDeps(root, { filter: { set: 'world', still: false, only: new Set(['spawn']) } });
    const { checks } = evaluateZone('yeonmu', shotDir, deps);
    const summary = summarizeChecks(checks);

    expect(checks.some((c) => c.check === 'cliff' && c.spot === 'ridge' && c.status === 'SKIPPED')).toBe(true);
    expect(summary.missing).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.measured).toBeGreaterThan(0);
    expect(summary.ok).toBe(true);
    expect(gateExitCode({ yeonmu: summary })).toBe(0);

    // Selecting a spot that matches zero roles -> zero measured checks -> gate FAILS
    const emptyFilterDeps = makeFixtureDeps(root, { filter: { set: 'world', still: false, only: new Set(['nonexistent']) } });
    const emptyRes = evaluateZone('yeonmu', shotDir, emptyFilterDeps);
    const emptySummary = summarizeChecks(emptyRes.checks);
    expect(emptySummary.measured).toBe(0);
    expect(emptySummary.ok).toBe(false);
    expect(emptySummary.reasons.some((r) => /zero applicable checks/i.test(r))).toBe(true);
    expect(gateExitCode({ yeonmu: emptySummary })).toBe(1);
  });

  test('valid complete fixture with matching baselines passes with exit code 0', () => {
    const root = makeTemp('ms-zonecheck-ok-');
    const shotDir = join(root, 'shots', 'yeonmu');
    const baseDir = join(root, 'baseline');
    mkdirSync(shotDir, { recursive: true });
    mkdirSync(join(baseDir, 'yeonmu'), { recursive: true });
    writeFileSync(join(shotDir, 'spawn.png'), 'shot');
    writeFileSync(join(shotDir, 'ridge.png'), 'shot');
    writeFileSync(join(baseDir, 'yeonmu', 'spawn.png'), 'base');
    writeFileSync(join(baseDir, 'yeonmu', 'ridge.png'), 'base');

    const deps = makeFixtureDeps(root, { baseline: baseDir });
    const { checks } = evaluateZone('yeonmu', shotDir, deps);
    const summary = summarizeChecks(checks);

    expect(summary.missing).toBe(0);
    expect(summary.fail).toBe(0);
    expect(summary.pass).toBeGreaterThan(0);
    expect(summary.ok).toBe(true);
    expect(gateExitCode({ yeonmu: summary })).toBe(0);
  });
});
