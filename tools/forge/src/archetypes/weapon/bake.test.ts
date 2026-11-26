import { describe, expect, test } from 'bun:test';
import type { EdgeField } from './features.ts';
import { bakeMaps, type PaintSample } from './bake.ts';

describe('TOOL-RENDER-04 weapon bakeMaps world-space texel footprint', () => {
  test('passes the true world-space texel footprint across all columns and scales for emissive density', () => {
    const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const idx = new Uint32Array([0, 1, 2, 1, 3, 2]);
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const zone = new Uint16Array([0, 0, 0, 0]);
    const ao = new Float32Array([1, 1, 1, 1]);
    const ef: EdgeField = { count: 0, query: () => ({ cvx: 0.004, ccv: 0.004 }) };
    const texelSize = 0.001;

    // 1. Albedo-only 4x4 bake: every single sample across columns tx = 0..3 must receive texelSize (NOT [0.5, 1.5, 2.5, 3.5])
    const albedoPx: number[] = [];
    const albedoOnly = bakeMaps(
      4,
      4,
      0,
      0,
      uv,
      idx,
      pos,
      nrm,
      zone,
      ao,
      (s: PaintSample) => {
        albedoPx.push(s.px);
        return { albedo: [0.5, 0.5, 0.5] };
      },
      ef,
      'seed',
      texelSize,
    );
    expect(albedoOnly.albedo.rgba.length).toBe(4 * 4 * 4);
    expect(albedoOnly.emissive).toBeUndefined();
    expect(albedoPx.length).toBeGreaterThanOrEqual(16);
    for (const v of albedoPx) {
      expect(v).toBeCloseTo(texelSize, 10);
    }

    // 2. Albedo 4x4 + Emissive 2x2: albedo gets texelSize, emissive gets texelSize * 2 (half density)
    const allPx: number[] = [];
    const both = bakeMaps(
      4,
      4,
      2,
      2,
      uv,
      idx,
      pos,
      nrm,
      zone,
      ao,
      (s: PaintSample) => {
        allPx.push(s.px);
        return { albedo: [0.5, 0.5, 0.5], emissive: [0.2, 0.2, 0.2] };
      },
      ef,
      'seed',
      texelSize,
    );
    expect(both.emissive?.rgba.length).toBe(2 * 2 * 4);
    const albedoSamples = allPx.slice(0, albedoPx.length);
    const emissiveSamples = allPx.slice(albedoPx.length);
    expect(emissiveSamples.length).toBeGreaterThanOrEqual(4);
    for (const v of albedoSamples) expect(v).toBeCloseTo(texelSize, 10);
    for (const v of emissiveSamples) expect(v).toBeCloseTo(texelSize * 2, 10);
  });
});
