import { describe, expect, it } from 'vitest';
import { bannerVariantOf, bendCurve, dangerOf, hashStr, roman } from './zoneArt';
import type { ZoneDef } from '../../data/schema';

describe('bendCurve (road / chain between regions)', () => {
  it('starts and ends on the two region centres and bends to one side', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const { at } = bendCurve(a, b, 0.1);
    expect(at(0).x).toBeCloseTo(0);
    expect(at(1).x).toBeCloseTo(100);
    const mid = at(0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(Math.abs(mid.y)).toBeGreaterThan(2);
    expect(bendCurve(a, b, -0.1).at(0.5).y).toBeCloseTo(-mid.y);
  });

  it('a straight link (bend 0) keeps its tangent along the line', () => {
    const { at } = bendCurve({ x: 10, y: 10 }, { x: 10, y: 110 }, 0);
    expect(at(0.3).x).toBeCloseTo(10);
    expect(at(0.3).ang).toBeCloseTo(90);
  });
});

describe('banner variants', () => {
  it('every campaign zone has its own painted banner, unknown ids fall back into the sheet', () => {
    const v = ['yeonmu', 'suryeon', 'seori', 'daeryeol'].map((id, i) => bannerVariantOf(id, i + 1));
    expect(new Set(v).size).toBe(4);
    for (const n of [bannerVariantOf('nowhere', 1), bannerVariantOf('nowhere', 9)]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(4);
    }
  });
});

describe('small helpers', () => {
  it('hashStr is stable and roman numerals cover the campaign', () => {
    expect(hashStr('yeonmu')).toBe(hashStr('yeonmu'));
    expect(hashStr('yeonmu')).not.toBe(hashStr('seori'));
    expect([1, 2, 3, 4].map(roman)).toEqual(['I', 'II', 'III', 'IV']);
  });
  it('danger is one skull per chapter, four at most', () => {
    expect(dangerOf({ order: 0 } as ZoneDef)).toBe(1);
    expect(dangerOf({ order: 3 } as ZoneDef)).toBe(3);
    expect(dangerOf({ order: 9 } as ZoneDef)).toBe(4);
  });
});
