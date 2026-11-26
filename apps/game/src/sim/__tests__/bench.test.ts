// Sanity gate for sim cost: the exact numbers are reported by bench.run.ts; here we only assert generous ceilings so a
// regression (e.g. an accidental O(n²)) fails CI without making the suite flaky on slow or busy machines.
//
// Wall-clock per-tick samples are polluted by the scheduler: when the thread is descheduled in the middle of a tick (a
// parallel test run, a browser, other agents) that tick "costs" 20-70 ms and p95 explodes without the sim getting any
// slower. So (see dev/perfBudget.ts):
//   - the average is CPU time per tick (`process.cpuUsage`, which does not count time spent waiting for a core), and
//   - the p95 stays a wall-clock tail, but is divided by how starved the thread was during the run (wall / CPU over the
//     whole bench, >= 1): a sim that really got slower raises CPU and wall together, so the starvation factor does not
//     hide it; a thread that only waited for a core does not fail. Slow on every attempt (default 4) => fail.

import { describe, expect, it } from 'vitest';
import { cpuNow, withinBudget } from '../../dev/perfBudget';
import { runBench, type BenchResult } from './bench';

const OPTS = { enemies: 600, seconds: 12, warmup: 25, pile: true } as const;
/** every sim step runBench executes: warm-up + measured + the per-system breakdown pass (min(n, 600)) */
const TOTAL_TICKS = Math.round(OPTS.warmup * 60) + Math.round(OPTS.seconds * 60) + Math.min(Math.round(OPTS.seconds * 60), 600);

interface Measured {
  r: BenchResult;
  /** CPU ms per sim tick over the whole bench */
  cpuPerTick: number;
  /** wall time / CPU time of the whole bench, >= 1 */
  starvation: number;
}

function measure(): Measured {
  const c0 = cpuNow();
  const w0 = performance.now();
  const r = runBench(OPTS);
  const cpu = Math.max(1, cpuNow() - c0);
  const wall = performance.now() - w0;
  return { r, cpuPerTick: cpu / TOTAL_TICKS, starvation: Math.max(1, wall / cpu) };
}

describe('sim cost per tick', () => {
  it('600 enemies piled on the hero stay far below the 16.7 ms frame budget', () => {
    const p95 = withinBudget(
      () => {
        const m = measure();
        // eslint-disable-next-line no-console
        console.log(
          `sim @${m.r.enemies} enemies: avg ${m.r.avgMs.toFixed(3)} ms wall, ${m.cpuPerTick.toFixed(3)} ms cpu, p95 ${m.r.p95Ms.toFixed(3)} ms, p99 ${m.r.p99Ms.toFixed(3)} ms, max ${m.r.maxMs.toFixed(2)} ms, starvation x${m.starvation.toFixed(2)}`,
        );
        return { value: m, ms: m.r.p95Ms / m.starvation };
      },
      { baseMs: 12 },
    );
    const m = p95.value;
    expect(m.r.enemies).toBeGreaterThan(450);
    expect(m.cpuPerTick, 'average CPU ms per sim tick').toBeLessThan(5);
    expect(p95.ms, `p95 tick (wall, / starvation x${m.starvation.toFixed(2)}): ${p95.log}`).toBeLessThanOrEqual(p95.budget);
  }, 300_000);
});
