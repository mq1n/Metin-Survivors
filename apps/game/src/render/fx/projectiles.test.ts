import { describe, expect, it } from 'vitest';
import type { ProjectileStyleDef } from '../feed';
import {
  MAX_TRAIL_M,
  PROJECTILE_SHAPES,
  SHAPE_DEFAULTS,
  SIM_TICK_RATE,
  compileProjectileStyles,
  nearestCutoff,
  projectileKinematics,
  trailMetres,
  type Kinematics,
} from './projectiles';

describe('compileProjectileStyles', () => {
  const styles: Array<ProjectileStyleDef | undefined> = [
    { shape: 'orb', color: '#ffffff' },
    { shape: 'arrow', color: '#000000', core: '#ff0000', length: 8, trail: 0.3 },
    undefined,
    { shape: 'bolt', color: '#808080', length: 0, trail: -1 },
  ];
  const c = compileProjectileStyles(styles);

  it('keeps the table size and appends a neutral fallback entry', () => {
    expect(c.count).toBe(4);
    expect(Array.from(c.valid)).toEqual([1, 1, 0, 1, 0]);
    expect(c.shape[4]).toBe(PROJECTILE_SHAPES.indexOf('orb'));
  });
  it('maps shapes to the batch order', () => {
    expect(Array.from(c.shape.slice(0, 4))).toEqual([0, 1, 0, 4]);
    expect(PROJECTILE_SHAPES).toEqual(['orb', 'arrow', 'blade', 'talisman', 'bolt']);
  });
  it('converts colours to linear space', () => {
    expect(c.color[0]).toBeCloseTo(1, 6);
    expect(c.color[3]).toBeCloseTo(0, 6);
    // sRGB 0x80 → ~0.2158 linear
    expect(c.color[9]).toBeCloseTo(0.2158, 3);
    expect(c.core[3]).toBeCloseTo(1, 6);
    expect(c.core[4]).toBeCloseTo(0, 6);
  });
  it('derives a hotter core colour when none is given', () => {
    for (let k = 0; k < 3; k++) expect(c.core[9 + k] as number).toBeGreaterThan(c.color[9 + k] as number);
  });
  it('uses shape defaults for missing / invalid length and trail', () => {
    expect(c.length[0]).toBe(SHAPE_DEFAULTS.orb.length);
    expect(c.trail[0]).toBeCloseTo(SHAPE_DEFAULTS.orb.trail, 6);
    expect(c.length[1]).toBe(8);
    expect(c.trail[1]).toBeCloseTo(0.3, 6);
    expect(c.length[3]).toBe(SHAPE_DEFAULTS.bolt.length);
    expect(c.trail[3]).toBe(SHAPE_DEFAULTS.bolt.trail);
  });
});

describe('projectileKinematics', () => {
  const out: Kinematics = { x: 0, z: 0, dx: 0, dz: 0, speed: 0 };

  it('interpolates between the previous and current tick', () => {
    projectileKinematics(10, 4, 8, 4, 0, 0.5, out);
    expect(out.x).toBeCloseTo(9, 6);
    expect(out.z).toBeCloseTo(4, 6);
    projectileKinematics(10, 4, 8, 4, 0, 0, out);
    expect(out.x).toBeCloseTo(8, 6);
    projectileKinematics(10, 4, 8, 4, 0, 1, out);
    expect(out.x).toBeCloseTo(10, 6);
  });
  it('derives unit direction and speed (m/s) from the tick displacement', () => {
    projectileKinematics(3, 4, 0, 0, 0, 1, out);
    expect(out.dx).toBeCloseTo(0.6, 6);
    expect(out.dz).toBeCloseTo(0.8, 6);
    expect(out.speed).toBeCloseTo(5 * SIM_TICK_RATE, 4);
  });
  it('falls back to the yaw (0 faces +Z) when the projectile barely moved', () => {
    projectileKinematics(1, 1, 1, 1, 0, 1, out);
    expect(out.dx).toBeCloseTo(0, 6);
    expect(out.dz).toBeCloseTo(1, 6);
    expect(out.speed).toBe(0);
    projectileKinematics(1, 1, 1, 1, Math.PI / 2, 1, out);
    expect(out.dx).toBeCloseTo(1, 6);
    expect(out.dz).toBeCloseTo(0, 5);
  });
});

describe('trailMetres', () => {
  it('scales with speed and is clamped', () => {
    expect(trailMetres(0.1, 20)).toBeCloseTo(2, 6);
    expect(trailMetres(0.5, 100)).toBe(MAX_TRAIL_M);
    expect(trailMetres(0.2, 0)).toBe(0);
    expect(trailMetres(-1, 10)).toBe(0);
  });
});

describe('nearestCutoff', () => {
  const lcg = (seed: number) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  it('returns +Infinity when everything fits', () => {
    const w = new Float32Array(8);
    expect(nearestCutoff([3, 1, 2], 3, 3, w)).toBe(Infinity);
    expect(nearestCutoff([3, 1, 2], 3, 10, w)).toBe(Infinity);
  });
  it('keeps exactly `cap` rows for distinct values', () => {
    const rnd = lcg(7);
    const n = 500;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = rnd() * 1000;
    const w = new Float32Array(n);
    for (const cap of [1, 17, 250, 499]) {
      const cut = nearestCutoff(d, n, cap, w);
      let kept = 0;
      for (let i = 0; i < n; i++) if ((d[i] as number) <= cut) kept++;
      expect(kept).toBe(cap);
    }
  });
  it('is the cap-th smallest value and does not modify the input', () => {
    const d = Float32Array.from([9, 2, 7, 4, 5, 1, 8]);
    const copy = Float32Array.from(d);
    expect(nearestCutoff(d, d.length, 3, new Float32Array(7))).toBe(4);
    expect(Array.from(d)).toEqual(Array.from(copy));
  });
  it('tolerates ties (may keep a few more than cap, never fewer)', () => {
    const d = Float32Array.from([1, 1, 1, 1, 1, 1, 2, 3]);
    const cut = nearestCutoff(d, d.length, 4, new Float32Array(8));
    expect(cut).toBe(1);
    expect(Array.from(d).filter((v) => v <= cut).length).toBeGreaterThanOrEqual(4);
  });
  it('drops everything for cap <= 0', () => {
    expect(nearestCutoff([1, 2], 2, 0, new Float32Array(2))).toBe(-Infinity);
  });
});
