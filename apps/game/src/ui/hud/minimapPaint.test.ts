import { describe, expect, it } from 'vitest';
import { paintMinimap } from './minimapPaint';

/** a flat olive field with a pale vertical road down the middle and a dark square (a tree crown) */
function field(n: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      let c: [number, number, number] = [92, 118, 62];
      if (Math.abs(x - n / 2) < 4) c = [186, 150, 104];
      if (x > 8 && x < 16 && y > 8 && y < 16) c = [26, 52, 30];
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

function std(px: Uint8ClampedArray, x0: number, x1: number, y0: number, y1: number, n: number): number {
  let s = 0;
  let q = 0;
  let c = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = px[(y * n + x) * 4 + 1] as number;
      s += v;
      q += v * v;
      c++;
    }
  }
  const m = s / c;
  return Math.sqrt(Math.max(0, q / c - m * m));
}

describe('paintMinimap', () => {
  it('keeps the size, stays opaque and is deterministic', () => {
    const src = field(64);
    const a = paintMinimap(src, 64, 64);
    const b = paintMinimap(src, 64, 64);
    expect(a.length).toBe(src.length);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('breathes texture into a flat field (mottled ground, not a flat fill)', () => {
    const n = 96;
    const out = paintMinimap(field(n), n, n);
    // the flat olive area away from the road and the crown
    expect(std(out, 56, 90, 40, 90, n)).toBeGreaterThan(2.5);
  });

  it('keeps the road lighter than the field and the crown darker', () => {
    const n = 96;
    const out = paintMinimap(field(n), n, n);
    const g = (x: number, y: number): number => out[(y * n + x) * 4 + 1] as number;
    const road = g(n / 2, 60);
    const field_ = g(80, 60);
    const crown = g(12, 12);
    expect(road).toBeGreaterThan(field_ + 15);
    expect(crown).toBeLessThan(field_ - 15);
  });
});
