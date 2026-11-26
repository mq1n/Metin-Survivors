import { describe, expect, it } from 'vitest';
import { FixedLoop, SIM_DT } from './loop';

function make(): { loop: FixedLoop; steps: number[]; alphas: number[] } {
  const steps: number[] = [];
  const alphas: number[] = [];
  const loop = new FixedLoop({
    step: (dt) => steps.push(dt),
    render: (a) => alphas.push(a),
  });
  return { loop, steps, alphas };
}

describe('FixedLoop', () => {
  it('runs whole ticks and exposes the remainder as alpha', () => {
    const { loop, steps, alphas } = make();
    loop.advance(SIM_DT * 2.5);
    expect(steps.length).toBe(2);
    expect(alphas[0]).toBeCloseTo(0.5, 5);
    loop.advance(SIM_DT * 0.5);
    expect(steps.length).toBe(3);
    expect(alphas[1]).toBeCloseTo(0, 5);
  });

  it('never steps while paused but keeps rendering', () => {
    const { loop, steps, alphas } = make();
    loop.paused = true;
    loop.advance(1);
    expect(steps.length).toBe(0);
    expect(alphas.length).toBe(1);
  });

  it('time scale multiplies tick rate', () => {
    const { loop, steps } = make();
    loop.timeScale = 4;
    loop.advance(SIM_DT * 3);
    expect(steps.length).toBe(12);
  });

  it('clamps long frames and drops the backlog instead of spiralling', () => {
    const { loop, steps } = make();
    loop.advance(10); // clamped to 0.25 s = 15 ticks, but maxSteps = 5
    expect(steps.length).toBe(5);
    expect(loop.stats.droppedSteps).toBeGreaterThan(0);
    expect(loop.alpha).toBeLessThan(1);
  });
});
