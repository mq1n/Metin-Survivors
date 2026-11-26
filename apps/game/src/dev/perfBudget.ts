// Load-tolerant performance budgets for unit tests (dev only; imported by *.test.ts, never by the game).
//
// A bare `expect(wallMs).toBeLessThan(1500)` measures the machine as much as the code: with a browser, a build and a
// dozen other processes on the box, the same terrain bake costs 3-5x more wall-clock (the thread is descheduled) and the
// release test step flakes. Three measures keep the guard meaningful without trusting one noisy sample:
//
//   1. CPU time, not wall time: `process.cpuUsage()` (user + system of this process) does not count the time the thread
//      spends waiting for a core, so another process hogging the CPU stops moving the number. Work that really got more
//      expensive (an accidental O(n^2), a 3x slower loop) still shows. Granularity is one scheduler tick (15.6 ms on
//      Windows): fine for >= 300 ms of work, so a cheap operation is timed over a batch (`cpuMsPerCall`).
//   2. A machine-speed factor, computed lazily: only when an attempt is over its base budget, a fixed CPU loop (also
//      timed in CPU time) is compared with its reference cost; a slow or SMT-contended CI box scales the budget (never
//      below 1: a faster machine does not tighten the gate).
//   3. Attempts: the work is repeated (default 4) until one attempt fits its scaled budget; the first fit passes, so the
//      common case costs exactly one run. Slow on every attempt => fail with all the numbers in the message.
//
// Usage:  const r = withinBudget(() => { const t = cpuNow(); const v = work(); return { value: v, ms: cpuNow() - t }; }, { baseMs: 1500 });
//         expect(r.ms, r.log).toBeLessThanOrEqual(r.budget);

/** CPU ms (user + system) this process has used so far; wall clock where `process.cpuUsage` is missing. */
export function cpuNow(): number {
  if (typeof process !== 'undefined' && typeof process.cpuUsage === 'function') {
    const u = process.cpuUsage();
    return (u.user + u.system) / 1000;
  }
  return performance.now();
}

/** CPU ms of the calibration loop on the reference machine (an idle 3.5+ GHz desktop core, V8 in Node 22+). */
export const CALIBRATION_REF_MS = 100;

const CAL_N = 1 << 16;
let calBuf: Float32Array | null = null;
let calSink = 0;

/** A fixed CPU loop: float math + typed-array reads/writes, the instruction mix of the terrain bakes. */
function calibrationLoop(rounds: number): number {
  const a = (calBuf ??= new Float32Array(CAL_N));
  let s = 0;
  for (let k = 0; k < rounds; k++) {
    for (let i = 0; i < CAL_N; i++) {
      const v = Math.sin(i * 0.013 + k) * Math.sqrt(i + 1) + (a[(i * 7) & (CAL_N - 1)] as number) * 0.5;
      a[i] = v;
      s += v;
    }
  }
  return s;
}

/** CPU ms of the calibration loop now (after an untimed warm-up so the JIT is not measured). ~100 ms on the reference. */
export function calibrationMs(): number {
  calSink += calibrationLoop(8);
  const t0 = cpuNow();
  calSink += calibrationLoop(130);
  return cpuNow() - t0;
}

/** How many times slower than the reference machine this one is right now (>= 1). */
export function loadFactor(calMs: number = calibrationMs()): number {
  return Math.max(1, calMs / CALIBRATION_REF_MS);
}

export interface BudgetOptions {
  /** the budget on the reference machine (ms) */
  baseMs: number;
  /** attempts before failing (default 4) */
  attempts?: number;
  /** machine-speed factor (default: `loadFactor()`; injected by the tests of this module) */
  factor?: () => number;
}

export interface BudgetResult<T> {
  pass: boolean;
  /** the value of the best attempt (lowest ms / budget) */
  value: T;
  /** ms of that attempt */
  ms: number;
  /** the budget that attempt was held to */
  budget: number;
  attempts: number;
  /** one line for the assertion message */
  log: string;
}

/**
 * Runs `run` (returns the value to keep and the ms it cost) until one attempt fits its load-scaled budget.
 * Assert with `expect(r.ms, r.log).toBeLessThanOrEqual(r.budget)`.
 */
export function withinBudget<T>(run: () => { value: T; ms: number }, opts: BudgetOptions): BudgetResult<T> {
  const max = Math.max(1, opts.attempts ?? 4);
  const factorOf = opts.factor ?? loadFactor;
  let best: { value: T; ms: number; budget: number } | null = null;
  const seen: string[] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = run();
    let budget = opts.baseMs;
    if (r.ms > budget) budget = opts.baseMs * factorOf();
    seen.push(`${r.ms.toFixed(0)}/${budget.toFixed(0)}`);
    if (!best || r.ms / budget < best.ms / best.budget) best = { value: r.value, ms: r.ms, budget };
    if (r.ms <= budget) {
      return { pass: true, ...best, attempts: attempt, log: `${r.ms.toFixed(0)} cpu-ms within ${budget.toFixed(0)} (base ${opts.baseMs}, attempt ${attempt})` };
    }
  }
  const b = best as { value: T; ms: number; budget: number };
  return { pass: false, ...b, attempts: max, log: `over budget on all ${max} attempts (cpu-ms/budget): ${seen.join(', ')}; base ${opts.baseMs}` };
}

/** `withinBudget` for a piece of work measured in CPU time: `run` just does the work and returns its value. */
export function cpuWithinBudget<T>(run: () => T, opts: BudgetOptions): BudgetResult<T> {
  return withinBudget(() => {
    const t0 = cpuNow();
    const value = run();
    return { value, ms: cpuNow() - t0 };
  }, opts);
}

/** CPU ms per call of a cheap `fn`, timed over a batch long enough (>= ~120 ms) for the 15.6 ms CPU-clock tick not to matter. */
export function cpuMsPerCall(fn: (i: number) => unknown, minBatchMs = 120): number {
  fn(0); // warm-up (module init, JIT) outside the timing
  let n = 1;
  for (;;) {
    const t0 = cpuNow();
    for (let i = 0; i < n; i++) fn(i);
    const ms = cpuNow() - t0;
    if (ms >= minBatchMs || n >= 1 << 20) return ms / n;
    n = Math.min(1 << 20, Math.max(n * 2, Math.ceil((n * minBatchMs * 1.2) / Math.max(ms, 1))));
  }
}

/** Keeps the calibration loop from being optimised away. */
export function perfBudgetSink(): number {
  return calSink;
}
