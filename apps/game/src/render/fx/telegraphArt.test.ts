import { describe, expect, it } from 'vitest';
import {
  ELEMENT_HEX,
  GLYPH_ATLAS_SIZE,
  GLYPH_CELL,
  GLYPH_COUNT,
  GLYPH_GRID,
  GRAIN_SIZE,
  METIN_FALLBACK_HEX,
  clearTelegraphArtCaches,
  getMetinWarnTint,
  glyphStrokes,
  linearRgb,
  makeGlyphAtlas,
  makeGrainData,
  setMetinWarnTint,
  warnHex,
} from './telegraphArt';

describe('glyph atlas (our own rune set)', () => {
  const atlas = makeGlyphAtlas();
  const cell = (g: number): Uint8Array => {
    const out = new Uint8Array(GLYPH_CELL * GLYPH_CELL);
    const gx = g % GLYPH_GRID;
    const gy = Math.floor(g / GLYPH_GRID);
    for (let y = 0; y < GLYPH_CELL; y++) for (let x = 0; x < GLYPH_CELL; x++) out[y * GLYPH_CELL + x] = atlas[(gy * GLYPH_CELL + y) * GLYPH_ATLAS_SIZE + gx * GLYPH_CELL + x] as number;
    return out;
  };

  it('is deterministic and the declared size', () => {
    expect(atlas.length).toBe(GLYPH_ATLAS_SIZE * GLYPH_ATLAS_SIZE);
    expect(Array.from(makeGlyphAtlas().subarray(0, 4096))).toEqual(Array.from(atlas.subarray(0, 4096)));
  });

  it('every glyph is a stroke mark: ink covers 3-30 % of its cell, nothing touches the cell border, the cell is not flat', () => {
    for (let g = 0; g < GLYPH_COUNT; g++) {
      const c = cell(g);
      let ink = 0;
      let border = 0;
      for (let y = 0; y < GLYPH_CELL; y++) {
        for (let x = 0; x < GLYPH_CELL; x++) {
          const v = c[y * GLYPH_CELL + x] as number;
          if (v > 128) ink++;
          if ((x === 0 || y === 0 || x === GLYPH_CELL - 1 || y === GLYPH_CELL - 1) && v > 100) border++;
        }
      }
      const f = ink / (GLYPH_CELL * GLYPH_CELL);
      expect(f, `glyph ${g} ink`).toBeGreaterThan(0.03);
      expect(f, `glyph ${g} ink`).toBeLessThan(0.3);
      expect(border, `glyph ${g} border`).toBe(0);
    }
  });

  it('glyphs are distinct: no two cells are near-identical', () => {
    const cells: Uint8Array[] = [];
    for (let g = 0; g < GLYPH_COUNT; g++) cells.push(cell(g));
    let minDiff = 1;
    for (let a = 0; a < GLYPH_COUNT; a++) {
      for (let b = a + 1; b < GLYPH_COUNT; b++) {
        let d = 0;
        for (let i = 0; i < cells[a]!.length; i++) d += Math.abs((cells[a]![i] as number) - (cells[b]![i] as number));
        minDiff = Math.min(minDiff, d / (cells[a]!.length * 255));
      }
    }
    // two glyphs differ in at least 2 % of the cell's ink range (random shuffles of one family differ much more)
    expect(minDiff).toBeGreaterThan(0.02);
  });

  it('six stroke families, 2-4 strokes each', () => {
    const fams = new Set<number>();
    for (let g = 0; g < GLYPH_COUNT; g++) {
      const n = glyphStrokes(g).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
      fams.add(g % 6);
    }
    expect(fams.size).toBe(6);
  });
});

describe('grain texture', () => {
  const d = makeGrainData();
  it('RGBA, deterministic, every channel uses most of its range', () => {
    expect(d.length).toBe(GRAIN_SIZE * GRAIN_SIZE * 4);
    expect(Array.from(makeGrainData().subarray(0, 64))).toEqual(Array.from(d.subarray(0, 64)));
    for (let ch = 0; ch < 4; ch++) {
      let min = 255;
      let max = 0;
      for (let i = ch; i < d.length; i += 4) {
        const v = d[i] as number;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(max - min, `channel ${ch}`).toBeGreaterThan(150);
    }
  });

  it('the crack channel is thin seams: few texels near 0, most far from a seam', () => {
    let thin = 0;
    let wide = 0;
    for (let i = 2; i < d.length; i += 4) {
      const v = d[i] as number;
      if (v < 26) thin++;
      if (v > 200) wide++;
    }
    const n = GRAIN_SIZE * GRAIN_SIZE;
    expect(thin / n).toBeGreaterThan(0.01);
    expect(thin / n).toBeLessThan(0.14);
    expect(wide / n).toBeGreaterThan(0.4);
  });

  it('tiles: the seam across the wrap edge is as smooth as an inner step (all channels)', () => {
    for (const ch of [0, 3]) {
      let wrap = 0;
      let inner = 0;
      for (let y = 0; y < GRAIN_SIZE; y++) {
        wrap += Math.abs((d[(y * GRAIN_SIZE) * 4 + ch] as number) - (d[(y * GRAIN_SIZE + GRAIN_SIZE - 1) * 4 + ch] as number));
        inner += Math.abs((d[(y * GRAIN_SIZE + 1) * 4 + ch] as number) - (d[(y * GRAIN_SIZE) * 4 + ch] as number));
      }
      expect(wrap).toBeLessThan(inner * 2.5 + 60);
    }
  });
});

describe('warning tints', () => {
  it('enemy / boss / metin colours: element picks the hue, boss is a distinct (deeper) set, metin reads the rune registry', () => {
    clearTelegraphArtCaches();
    expect(warnHex(0, 1, 0)).toBe(ELEMENT_HEX[1]);
    expect(warnHex(0, 2, 0)).toBe(ELEMENT_HEX[2]);
    expect(warnHex(1, 0, 0)).not.toBe(warnHex(0, 0, 0));
    expect(warnHex(0, 99, 0)).toBe(ELEMENT_HEX[0]);
    expect(warnHex(2, 0, 5)).toBe(METIN_FALLBACK_HEX);
    setMetinWarnTint(5, 0x3cd08a);
    expect(getMetinWarnTint(5)).toBe(0x3cd08a);
    expect(warnHex(2, 0, 5)).toBe(0x3cd08a);
    expect(warnHex(2, 0, 6)).toBe(METIN_FALLBACK_HEX);
  });

  it('rune registry is bounded', () => {
    clearTelegraphArtCaches();
    for (let i = 1; i <= 200; i++) setMetinWarnTint(i, 0x112233 + i);
    expect(getMetinWarnTint(200)).toBe(0x112233 + 200);
    let kept = 0;
    for (let i = 1; i <= 200; i++) if (getMetinWarnTint(i) !== undefined) kept++;
    expect(kept).toBeLessThanOrEqual(50);
  });

  it('linearRgb converts sRGB hex to linear working space and is cached', () => {
    const a = linearRgb(0xff8000);
    expect(a[0]).toBeCloseTo(1, 3);
    expect(a[1]).toBeCloseTo(0.2158, 2);
    expect(a[2]).toBeCloseTo(0, 5);
    expect(linearRgb(0xff8000)).toBe(a);
  });
});
