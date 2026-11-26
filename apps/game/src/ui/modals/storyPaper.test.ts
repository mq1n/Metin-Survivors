import { describe, expect, it } from 'vitest';
import { fbm, PAPER_TONES, paperPixels, runePaper, smoothPath, spiralPts, SWIRL_H, SWIRL_W, swirlShapes, taperedOutline, vnoise, WEAVE_PITCH, WEAVE_SIZE, weavePixels } from './storyPaper';

describe('story paper', () => {
  it('value noise is smooth, bounded and seeded', () => {
    expect(vnoise(3.3, 4.1, 7)).toBe(vnoise(3.3, 4.1, 7));
    expect(vnoise(3.3, 4.1, 7)).not.toBe(vnoise(3.3, 4.1, 8));
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.37, i * 0.21, 5, 4);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    // continuous across a lattice line
    expect(Math.abs(vnoise(2 - 1e-6, 5.5, 3) - vnoise(2 + 1e-6, 5.5, 3))).toBeLessThan(1e-3);
  });

  it('paper is pale and warm, deterministic, and never repeats along the sheet', () => {
    const w = 160;
    const h = 100;
    const a = paperPixels(w, h, 11);
    expect(paperPixels(w, h, 11)).toEqual(a);
    expect(paperPixels(w, h, 12)).not.toEqual(a);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < w * h; i++) {
      r += a[i * 4] as number;
      g += a[i * 4 + 1] as number;
      b += a[i * 4 + 2] as number;
      expect(a[i * 4 + 3]).toBe(255);
    }
    r /= w * h;
    g /= w * h;
    b /= w * h;
    // a pale tan: bright, warm (r > g > b), not saturated orange
    expect(r).toBeGreaterThan(190);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b + 20);
    expect((r - b) / r).toBeLessThan(0.36);
    // the left half is not a copy of the right half (rows of both halves correlate weakly)
    let same = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) if (a[(y * w + x) * 4] === a[(y * w + x + w / 2) * 4]) same++;
    expect(same / ((w / 2) * h)).toBeLessThan(0.1);
  });

  it('the ash page is darker than the plain one, the rune page leans toward its colour', () => {
    const lum = (t: { rgb: readonly [number, number, number] }): number => t.rgb[0] * 0.3 + t.rgb[1] * 0.59 + t.rgb[2] * 0.11;
    expect(lum(PAPER_TONES.ash)).toBeLessThan(lum(PAPER_TONES.plain) - 20);
    const green = runePaper('#3cd08a');
    expect(green.rgb[1] - green.rgb[0]).toBeGreaterThan(PAPER_TONES.plain.rgb[1] - PAPER_TONES.plain.rgb[0]);
    expect(runePaper(null)).toBe(PAPER_TONES.plain);
  });
});

describe('story weave', () => {
  const n = WEAVE_SIZE;
  const px = weavePixels(3);
  const at = (x: number, y: number, c: number): number => px[(((y + n) % n) * n + ((x + n) % n)) * 4 + c] as number;

  it('is deterministic, seeded, and shows both light and dark threads', () => {
    expect(px.length).toBe(n * n * 4);
    expect(weavePixels(3)).toEqual(px);
    expect(weavePixels(4)).not.toEqual(px);
    let light = 0;
    let dark = 0;
    let alpha = 0;
    for (let i = 0; i < n * n; i++) {
      const a = px[i * 4 + 3] as number;
      alpha += a;
      if (a > 12) {
        if ((px[i * 4] as number) > 200) light++;
        else dark++;
      }
    }
    expect(light).toBeGreaterThan(n * n * 0.1);
    expect(dark).toBeGreaterThan(n * n * 0.1);
    // a texture, not a veil: it never covers the paper (mean alpha well below half)
    expect(alpha / (n * n)).toBeLessThan(110);
  });

  it('tiles without a seam: the pattern is periodic over the tile in both directions', () => {
    expect(n % (WEAVE_PITCH * 2)).toBe(0);
    // the weave has a structure with period `pitch * 2` diagonally; a shift of one tile wraps onto itself, and the seam columns / rows
    // differ from their neighbours no more than two interior neighbours differ from each other
    const step = (x0: number, y0: number, dx: number, dy: number): number => Math.abs(at(x0 + dx, y0 + dy, 3) - at(x0, y0, 3));
    let seam = 0;
    let inner = 0;
    for (let k = 0; k < n; k++) {
      seam += step(n - 1, k, 1, 0) + step(k, n - 1, 0, 1);
      inner += step(n / 2 - 1, k, 1, 0) + step(k, n / 2 - 1, 0, 1);
    }
    expect(seam / inner).toBeLessThan(1.6);
    expect(seam / inner).toBeGreaterThan(0.4);
  });
});

describe('story flourish', () => {
  it('smoothPath passes through its points and spirals wind inward', () => {
    const p = smoothPath([[0, 0], [10, 5], [20, 0]], 4);
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([20, 0]);
    expect(p.length).toBe(9);
    const s = spiralPts(0, 0, 30, 4, 0, 360, 30);
    expect(Math.hypot(...(s[0] as [number, number]))).toBeCloseTo(30, 5);
    expect(Math.hypot(...(s[s.length - 1] as [number, number]))).toBeCloseTo(4, 5);
  });

  it('a tapered outline is thick where it starts and thin where it ends', () => {
    const line: [number, number][] = [];
    for (let i = 0; i <= 20; i++) line.push([i * 5, 0]);
    const d = taperedOutline(line, (t) => 10 - 9 * t);
    const nums = d.match(/-?\d+(\.\d+)? -?\d+(\.\d+)?/g)?.map((s) => s.split(' ').map(Number)) ?? [];
    expect(nums.length).toBe(42);
    const half = nums.length / 2;
    // left edge first (y = +w/2 at the start, shrinking), then the right edge back
    expect(Math.abs((nums[0] as number[])[1] as number)).toBeGreaterThan(Math.abs((nums[half - 1] as number[])[1] as number) + 3);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('the flourish has a body, stays inside its box (corner at the bottom right) and anchors in the corner', () => {
    const shapes = swirlShapes();
    expect(shapes.length).toBeGreaterThanOrEqual(6);
    let nearCorner = 0;
    for (const d of shapes) {
      for (const m of d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        expect(x).toBeGreaterThan(-4);
        expect(y).toBeGreaterThan(-4);
        expect(x).toBeLessThan(SWIRL_W + 30);
        expect(y).toBeLessThan(SWIRL_H + 30);
        if (x > SWIRL_W - 24 && y > SWIRL_H - 24) nearCorner++;
      }
    }
    expect(nearCorner).toBeGreaterThan(8);
    expect(swirlShapes()).toBe(shapes);
  });
});
