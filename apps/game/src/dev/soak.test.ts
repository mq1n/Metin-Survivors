// Keeps the soak runner (dev/soak.ts + soakCore.ts) from rotting: 60 s of sim on the first zone with the real content and
// terrain, the selftest faults, the determinism pair and the leak analysis. Runs in a few seconds.

import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { analyzeMemory, bareRow, compareDeterminism, runCase, runSelftest, STATS, type CaseSpec } from './soakCore';

function specFor(over: Partial<CaseSpec> = {}): CaseSpec {
  const zone = content.zones.slice().sort((a, b) => a.order - b.order)[0];
  const cls = content.classes[0];
  if (!zone || !cls) throw new Error('content has no zone / class');
  return {
    id: 'test/first',
    group: 'test',
    zone: zone.id,
    classId: cls.id,
    doctrine: 'a',
    difficulty: 'normal',
    seed: 1,
    sex: cls.sexes[0] ?? 'm',
    empire: 'saehwa',
    stats: 'god',
    runOptionsMax: false,
    seconds: 60,
    cards: 'random',
    env: 'game',
    bot: 'chase',
    bossSpawn: {},
    expectVictory: false,
    checkpoints: true,
    wallLimitMs: 60_000,
    p99LimitMs: 1000,
    maxTickLimitMs: 2000,
    ...over,
  };
}

describe('soak runner', () => {
  it('plays 60 s on the first zone: no violation other than the (intended) missing end', () => {
    const row = runCase(content, specFor());
    expect(row.ticks).toBeGreaterThan(3000);
    expect(row.simSeconds).toBeGreaterThanOrEqual(60);
    expect(row.tickMs.p99).toBeGreaterThan(0);
    expect(row.heroStartWalkable).toBe(true);
    // 60 s of a 15-minute run never ends, so the end-of-run detector is the only one that may fire
    expect(row.violations.map((v) => v.kind)).toEqual(['no-end']);
    expect(row.stateHash).not.toBe('');
  });

  it('the same seed gives the same final state, another seed another one', () => {
    const a = runCase(content, specFor({ seconds: 30 }));
    const b = runCase(content, specFor({ seconds: 30, id: 'test/twin', twinOf: 'test/first' }));
    const c = runCase(content, specFor({ seconds: 30, seed: 2 }));
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.stateHash).not.toBe(c.stateHash);
    expect(compareDeterminism([a, b])[0]?.equal).toBe(true);
  });

  it('every injected fault is detected', () => {
    const lines = runSelftest(content, specFor());
    for (const l of lines) expect(l.detected, `${l.fault}: expected ${l.expected.join('+')}, got ${l.got.join('+') || 'nothing'}`).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(10);
  }, 60_000);

  it('flags a run that references an unknown zone instead of throwing', () => {
    const row = runCase(content, specFor({ zone: 'no_such_zone' }));
    expect(row.violations[0]?.kind).toBe('bad-case');
    expect(bareRow(specFor()).outcome).toBe('crash');
  });

  it('stat presets keep their order: god > seasoned > plain', () => {
    expect(STATS.god.damage).toBeGreaterThan(STATS.seasoned.damage ?? 0);
    expect(Object.keys(STATS.plain)).toHaveLength(0);
  });

  it('the leak analysis flags a growing heap and ignores a flat one', () => {
    const grow = analyzeMemory({ worker: 1, heapMB: Array.from({ length: 10 }, (_, i) => 100 + i * 5), rssMB: Array.from({ length: 10 }, () => 300) });
    const flat = analyzeMemory({ worker: 2, heapMB: Array.from({ length: 10 }, (_, i) => 100 + (i % 2)), rssMB: Array.from({ length: 10 }, () => 300) });
    expect(grow.leak).toBe(true);
    expect(flat.leak).toBe(false);
    // 1 MB per run over 20 runs on a 10 MB heap with GC noise: the first thresholds (+25 MB, > 1.5 MB/run) missed it
    const noise = [0.3, -0.4, 0.1, 6.5, -0.2, 0.4, -0.3, 0.2, 0, -0.1];
    const small = analyzeMemory({ worker: 3, heapMB: Array.from({ length: 20 }, (_, i) => 10 + i + (noise[i % 10] as number)), rssMB: Array.from({ length: 20 }, () => 300) });
    expect(small.leak).toBe(true);
    // a real worker series (review data, final pass worker 1: warm-up drift, one +2 MB GC outlier) stays quiet
    const real = [9.2, 9.1, 9.7, 8.6, 8.5, 8.6, 10, 10.3, 9.7, 10.4, 10.9, 10.2, 11.4, 12.5, 12.9, 13.1, 13.1, 13.1, 13.2, 14.1, 14.2, 14.4];
    expect(analyzeMemory({ worker: 4, heapMB: real, rssMB: real.map(() => 300) }).leak).toBe(false);
  });
});
