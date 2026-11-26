import { describe, expect, it } from 'vitest';
import { fallHeight, fallPath, heightAtFall, isFallingBody, isImpactAct, shadowGrowth, telegraphHook, wantsSpriteLayer } from './fallCue';

describe('isFallingBody (boss meteor rows as bosses.ts creates them)', () => {
  it('owner boss, circle, Impact act, not following, small radius, knock 2', () => {
    expect(isFallingBody(1, 0, 2, 0, 2.4, 2)).toBe(true);
    expect(isFallingBody(1, 0, 2, 0, 3.6, 2)).toBe(true);
  });
  it('slams (follow the boss / big radius / strong knock), novas, enemies and metins are not meteors', () => {
    expect(isFallingBody(1, 0, 2, 7, 4.5, 4)).toBe(false); // follows the boss
    expect(isFallingBody(1, 0, 2, 0, 4.5, 4)).toBe(false); // radius + knock
    expect(isFallingBody(1, 3, 2, 0, 2.4, 2)).toBe(false); // ring
    expect(isFallingBody(0, 0, 2, 0, 2.4, 2)).toBe(false); // enemy
    expect(isFallingBody(2, 0, 3, 0, 4.2, 6.5)).toBe(false); // metin
    expect(isFallingBody(1, 0, 0, 0, 2.4, 2)).toBe(false); // Visual act
    expect(isFallingBody(1, 0, 2, 0, 0.3, 2)).toBe(false); // speck
  });
});

describe('sprite-layer + impact rules', () => {
  it('bosses and metins always, trash only when big', () => {
    expect(wantsSpriteLayer(1, 0, 1, 0)).toBe(true);
    expect(wantsSpriteLayer(2, 0, 4.2, 0)).toBe(true);
    expect(wantsSpriteLayer(0, 0, 2.4, 0)).toBe(false);
    expect(wantsSpriteLayer(0, 0, 4.5, 0)).toBe(true);
    expect(wantsSpriteLayer(0, 2, 0, 10)).toBe(true);
    expect(wantsSpriteLayer(0, 2, 0, 6)).toBe(false);
  });
  it('Impact and MetinImpact acts land an impact, Visual / Hit do not', () => {
    expect(isImpactAct(2)).toBe(true);
    expect(isImpactAct(3)).toBe(true);
    expect(isImpactAct(0)).toBe(false);
    expect(isImpactAct(1)).toBe(false);
  });
  it('the hook slot is empty until the vfx route installs a listener', () => {
    expect(telegraphHook.onBegin === null || typeof telegraphHook.onBegin === 'function').toBe(true);
  });
});

describe('fallPath', () => {
  it('touches the ground exactly at T and starts at the fall height', () => {
    for (const [T, R, a] of [[1.2, 2.4, 0.4], [0.7, 3.6, 2.1], [2.0, 1.0, 5]] as const) {
      const p = fallPath(T, R, a);
      expect(heightAtFall(p, 0)).toBeCloseTo(fallHeight(R), 6);
      expect(heightAtFall(p, T)).toBeCloseTo(0, 6);
      expect(heightAtFall(p, T + 3)).toBe(0);
      // sideways drift lands the body on the centre: start + v T = 0
      expect(p.ox + p.vx * p.T).toBeCloseTo(0, 6);
      expect(p.oz + p.vz * p.T).toBeCloseTo(0, 6);
    }
  });
  it('falls monotonically and accelerates (more drop in the second half)', () => {
    const p = fallPath(1.2, 2.4, 1);
    let prev = Infinity;
    for (let i = 0; i <= 20; i++) {
      const h = heightAtFall(p, (i / 20) * p.T);
      expect(h).toBeLessThanOrEqual(prev + 1e-9);
      prev = h;
    }
    const drop1 = heightAtFall(p, 0) - heightAtFall(p, p.T / 2);
    const drop2 = heightAtFall(p, p.T / 2) - heightAtFall(p, p.T);
    expect(drop2).toBeGreaterThan(drop1 * 2.5);
  });
  it('comes from behind the circle (away from the camera) and the shadow grows from a speck to the full circle', () => {
    const p = fallPath(1.2, 2.4, 0.8);
    expect(p.oz).toBeLessThan(0);
    expect(shadowGrowth(p, 0)).toBeCloseTo(0, 6);
    expect(shadowGrowth(p, p.T)).toBeCloseTo(1, 6);
    expect(shadowGrowth(p, p.T * 0.5)).toBeLessThan(0.5);
  });
  it('higher for bigger circles, capped', () => {
    expect(fallHeight(4)).toBeGreaterThan(fallHeight(1));
    expect(fallHeight(40)).toBeLessThanOrEqual(14);
  });
});
