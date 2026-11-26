// Hero select (B3): the pure maths of the turntable adapter (heroTurn.ts).
import { describe, expect, it } from 'vitest';
import { FRONT_YAW, PREVIEW_YAW0, REST_TURN, TWO_PI, approach, frontOf, nearestRest, restOf, swayAt, swingAt, SWAY } from './heroTurn';

describe('nearestRest', () => {
  it('keeps a pose that is already the rest pose', () => {
    expect(nearestRest(0.3, 0.3)).toBeCloseTo(0.3, 9);
  });
  it('wraps a figure dragged through several turns back to the closest rest', () => {
    expect(nearestRest(0.3 + TWO_PI * 3 + 0.4, 0.3)).toBeCloseTo(0.3 + TWO_PI * 3, 9);
    expect(nearestRest(0.3 - TWO_PI * 2 - 0.2, 0.3)).toBeCloseTo(0.3 - TWO_PI * 2, 9);
  });
  it('picks the nearer of two rest poses around the half-turn', () => {
    expect(nearestRest(0.3 + Math.PI - 0.1, 0.3)).toBeCloseTo(0.3, 9); // a little short of the half-turn: stay
    expect(nearestRest(0.3 + Math.PI + 0.1, 0.3)).toBeCloseTo(0.3 + TWO_PI, 9); // a little past it: next turn
  });
});

describe('swayAt / approach / swingAt', () => {
  it('stays inside the amplitude', () => {
    for (let t = 0; t < 40; t += 0.37) expect(Math.abs(swayAt(t))).toBeLessThanOrEqual(SWAY + 1e-9);
  });
  it('approach never overshoots and is frame-rate independent', () => {
    const a = approach(0, 1, 0.1, 3);
    const b = approach(approach(0, 1, 0.05, 3), 1, 0.05, 3);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(a).toBeCloseTo(b, 9);
  });
  it('swing runs from the start pose to the rest pose and clamps', () => {
    expect(swingAt(0, 1.5, 0.3)).toBeCloseTo(1.5, 9);
    expect(swingAt(1, 1.5, 0.3)).toBeCloseTo(0.3, 9);
    expect(swingAt(2, 1.5, 0.3)).toBeCloseTo(0.3, 9);
    expect(swingAt(0.5, 1.5, 0.3)).toBeLessThan(0.7); // ease-out: more than half way at half time
  });
});

describe('per-model front', () => {
  it('rest = front + the 3/4 turn, and unknown models face the camera at yaw 0', () => {
    expect(frontOf('nobody', 'x')).toBe(0);
    expect(restOf('nobody', 'x')).toBeCloseTo(REST_TURN, 9);
    for (const [k, v] of Object.entries(FRONT_YAW)) expect(restOf(k.split('_')[0] ?? '', k.split('_')[1] ?? '')).toBeCloseTo(v + REST_TURN, 9);
  });
  it('heroPreview starts at the documented yaw', () => {
    expect(PREVIEW_YAW0).toBe(0.35);
  });
});
