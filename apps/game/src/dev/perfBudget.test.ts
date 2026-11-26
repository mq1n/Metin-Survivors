import { describe, expect, it } from 'vitest';
import { CALIBRATION_REF_MS, calibrationMs, cpuMsPerCall, cpuNow, cpuWithinBudget, loadFactor, withinBudget } from './perfBudget';

/** feeds `withinBudget` a fixed list of measurements and counts how often the machine-speed factor was asked for */
function scripted(ms: number[], factor: number, base = 1000, attempts?: number) {
  let i = 0;
  let factorCalls = 0;
  const r = withinBudget(() => ({ value: i, ms: ms[i++] as number }), {
    baseMs: base,
    attempts,
    factor: () => {
      factorCalls++;
      return factor;
    },
  });
  return { r, runs: i, factorCalls };
}

describe('withinBudget', () => {
  it('passes on the first attempt under the base budget without calibrating', () => {
    const { r, runs, factorCalls } = scripted([900], 3);
    expect(r.pass).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.budget).toBe(1000);
    expect(runs).toBe(1);
    expect(factorCalls).toBe(0);
  });

  it('scales an over-budget attempt by the machine factor', () => {
    const { r, factorCalls } = scripted([1800], 2);
    expect(r.pass).toBe(true);
    expect(r.budget).toBe(2000);
    expect(factorCalls).toBe(1);
  });

  it('repeats a slow attempt until one fits, and keeps the value of the attempt that fitted', () => {
    const { r, runs } = scripted([5000, 4000, 900, 100], 1.5);
    expect(r.pass).toBe(true);
    expect(r.attempts).toBe(3);
    expect(runs).toBe(3);
    expect(r.ms).toBe(900);
    expect(r.value).toBe(2);
  });

  it('fails when every attempt is over its scaled budget, reporting the best one', () => {
    const { r, runs } = scripted([5000, 4200, 4800, 4600, 100], 1.2);
    expect(r.pass).toBe(false);
    expect(runs).toBe(4);
    expect(r.attempts).toBe(4);
    expect(r.ms).toBe(4200);
    expect(r.budget).toBeCloseTo(1200, 6);
    expect(r.log).toContain('over budget on all 4 attempts');
  });

  it('a 3x regression on a machine that is 1.2x slower still fails (the factor is not a blank cheque)', () => {
    const { r } = scripted([3600, 3500, 3700, 3600], 1.2, 1000);
    expect(r.pass).toBe(false);
  });

  it('honours the attempts option', () => {
    const { runs } = scripted([9e3, 9e3, 9e3, 9e3, 9e3, 9e3], 1, 1000, 2);
    expect(runs).toBe(2);
  });
});

describe('cpuWithinBudget / cpu clock', () => {
  it('cpuNow only moves forward and counts work, not waiting', async () => {
    const a = cpuNow();
    let s = 0;
    for (let i = 0; i < 2e6; i++) s += Math.sqrt(i);
    const b = cpuNow();
    expect(s).toBeGreaterThan(0);
    expect(b).toBeGreaterThanOrEqual(a);
    // 50 ms of waiting costs (almost) no CPU
    await new Promise((res) => setTimeout(res, 50));
    expect(cpuNow() - b).toBeLessThan(40);
  });

  it('measures real work against a budget', () => {
    const r = cpuWithinBudget(
      () => {
        let s = 0;
        for (let i = 0; i < 1e6; i++) s += Math.sin(i);
        return s;
      },
      { baseMs: 5000 },
    );
    expect(r.pass, r.log).toBe(true);
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it('cpuMsPerCall times a cheap call over a batch (positive, finite, far below the batch time)', () => {
    let sink = 0;
    const per = cpuMsPerCall(() => {
      for (let i = 0; i < 20000; i++) sink += Math.sqrt(i);
    }, 40);
    expect(sink).toBeGreaterThan(0);
    expect(per).toBeGreaterThan(0);
    expect(per).toBeLessThan(40);
  });
});

describe('machine-speed factor', () => {
  it('is never below 1 (a faster machine does not tighten a gate) and linear above the reference', () => {
    expect(loadFactor(1)).toBe(1);
    expect(loadFactor(CALIBRATION_REF_MS)).toBe(1);
    expect(loadFactor(CALIBRATION_REF_MS * 3)).toBeCloseTo(3, 9);
  });

  it('the calibration loop returns a finite, positive cost', () => {
    const ms = calibrationMs();
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
    expect(loadFactor()).toBeGreaterThanOrEqual(1);
  });
});
