import { describe, expect, it } from 'vitest';
import { Euler, MathUtils, Quaternion } from 'three';
import { WeaponHold } from './weaponHold';

const rot = (rx: number, ry: number, rz: number): Quaternion => new Quaternion().setFromEuler(new Euler(rx * MathUtils.DEG2RAD, ry * MathUtils.DEG2RAD, rz * MathUtils.DEG2RAD, 'XYZ'));
const close = (a: Quaternion, b: Quaternion): void => {
  const d = Math.abs(a.dot(b));
  expect(d).toBeGreaterThan(1 - 1e-6);
};

describe('WeaponHold (per-clip weapon hold)', () => {
  it('is absent for weapons without a clipHold table (today\'s static hold stays untouched)', () => {
    expect(WeaponHold.from(undefined, new Quaternion())).toBeNull();
    expect(WeaponHold.from({ weapon: { type: 'bow' } }, new Quaternion())).toBeNull();
    expect(WeaponHold.from({ weapon: { clipHold: {} } }, new Quaternion())).toBeNull();
    expect(WeaponHold.from({ weapon: { clipHold: { idle: [1, 2] } } }, new Quaternion())).toBeNull();
  });

  it('a single full-weight layer gives base * that clip rotation', () => {
    const base = rot(0, 0, 30);
    const h = WeaponHold.from({ weapon: { clipHold: { dash: [-10, 20, 0], idle: [0, -10, 0] } } }, base)!;
    expect(h.clips.sort()).toEqual(['dash', 'idle']);
    const out = new Quaternion();
    close(h.apply([['dash', 1]], out), base.clone().multiply(rot(-10, 20, 0)));
    close(h.apply([['idle', 1]], out), base.clone().multiply(rot(0, -10, 0)));
  });

  it('a clip without an entry and zero total weight both give the base rotation', () => {
    const base = rot(5, 0, 0);
    const h = WeaponHold.from({ weapon: { clipHold: { run: [-10, 0, 0] } } }, base)!;
    const out = new Quaternion();
    close(h.apply([['attack', 1]], out), base);
    close(h.apply([], out), base);
    close(h.apply([['run', 0]], out), base);
  });

  it('blends between layers (half run + half no rotation = about half the angle) and normalises', () => {
    const h = WeaponHold.from({ weapon: { clipHold: { run: [-20, 0, 0] } } }, new Quaternion())!;
    const out = h.apply([['idle', 0.5], ['run', 0.5]], new Quaternion());
    expect(out.length()).toBeCloseTo(1, 6);
    const e = new Euler().setFromQuaternion(out, 'XYZ');
    expect(e.x * MathUtils.RAD2DEG).toBeCloseTo(-10, 1);
  });
});
