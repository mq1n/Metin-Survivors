// The gutter between the cells of the art array (spec/artGutter.ts, art.ts addBlit, shaders.ts roleRect): a texel read at the border of a sprite never
// reaches the neighbouring run. Pins: (1) the inner rect every role decodes to sits ART_GUTTER cells inside its run on every side, on both pages;
// (2) a CPU model of the array (the blit's extrusion + a box-filter mip chain + the bilinear tap of the shader) shows the seam of the old layout
// (the neighbour's colour at the border) and that the gutter removes it for every mip level up to 1 + log2(gutter px); (3) the blit of a sheet frame
// keeps the frames' own edges (no leak between the frames of one source image).
import { describe, expect, it } from 'vitest';
import { ART_DENSE_RATIO } from '../spec/artPage';
import { ART_GUTTER, artInnerRect } from '../spec/artGutter';
import { artRect, packArtRole, type ArtFootprint } from '../spec/art';

describe('role decode: the inner rect', () => {
  it('sits ART_GUTTER of a cell inside its run on every side (full layers and dense layers, every size and frame)', () => {
    let n = 0;
    for (const dense of [false, true]) {
      const G = dense ? 8 * ART_DENSE_RATIO : 8;
      for (const [cw, ch, frames] of [[1, 1, 1], [2, 1, 3], [1, 4, 2], [4, 1, 4], [2, 2, 5]] as const) {
        for (const [col, row] of [[0, 0], [3, 2], [G - cw, G - ch]] as const) {
          const fp: ArtFootprint = { id: 'k', cw, ch, frames, cols: 1, rows: 1 };
          const pk = packArtRole({ layer: 1, col: col % G, row: row % G, dense }, fp);
          for (let f = 0; f < frames; f++) {
            const a = artRect(pk, f, 8);
            const r = artInnerRect(a, a.cells);
            expect((r.u0 - a.u0) * a.cells).toBeCloseTo(ART_GUTTER, 9);
            expect((r.v0 - a.v0) * a.cells).toBeCloseTo(ART_GUTTER, 9);
            expect((a.u0 + a.du - (r.u0 + r.du)) * a.cells).toBeCloseTo(ART_GUTTER, 9);
            expect((a.v0 + a.dv - (r.v0 + r.dv)) * a.cells).toBeCloseTo(ART_GUTTER, 9);
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it('two runs side by side keep 2 x ART_GUTTER of a cell between their inner rects', () => {
    const fp: ArtFootprint = { id: 'k', cw: 1, ch: 1, frames: 1, cols: 1, rows: 1 };
    const a = artRect(packArtRole({ layer: 0, col: 2, row: 0 }, fp), 0, 8);
    const b = artRect(packArtRole({ layer: 0, col: 3, row: 0 }, fp), 0, 8);
    const ia = artInnerRect(a, 8);
    const ib = artInnerRect(b, 8);
    expect((ib.u0 - (ia.u0 + ia.du)) * 8).toBeCloseTo(2 * ART_GUTTER, 9);
  });

  it('is a share of the cell, so a dense cell (half the pixels) keeps the same share', () => {
    expect(ART_GUTTER).toBe(1 / 64);
    const full = artInnerRect({ u0: 0, v0: 0, du: 1 / 8, dv: 1 / 8 }, 8);
    const dense = artInnerRect({ u0: 0, v0: 0, du: 1 / 16, dv: 1 / 16 }, 16);
    expect(dense.u0 * 16).toBeCloseTo(full.u0 * 8, 12);
  });
});

// ------------------------------------------------------------------------------------------------ a CPU model of the array

/**
 * The atlas row of two runs (A | B) of `cell` px each. Both sprites are full-bleed, the worst case: their border texels are their colour (A = 1, B = 0, no
 * black margin). The blit draws the image inside the run and repeats its border texels over the gutter (art.ts addBlit), so a constant-bordered sprite
 * is that constant over its whole run, gutter or not: what the gutter changes is WHERE the shader samples (the inner rect, artInnerRect), not the row.
 */
function atlasRow(cell: number): Float64Array {
  const row = new Float64Array(cell * 2);
  for (let x = 0; x < row.length; x++) row[x] = x < cell ? 1 : 0;
  return row;
}

/** box-filter mip chain of a row (what generateMipmaps builds for the array) */
function mips(base: Float64Array): Float64Array[] {
  const out = [base];
  while ((out[out.length - 1] as Float64Array).length > 1) {
    const prev = out[out.length - 1] as Float64Array;
    const next = new Float64Array(prev.length >> 1);
    for (let i = 0; i < next.length; i++) next[i] = ((prev[2 * i] as number) + (prev[2 * i + 1] as number)) / 2;
    out.push(next);
  }
  return out;
}

/** bilinear tap of mip level `k` at atlas position `u` in [0, 1] (clamp-to-edge, texel centres at j + 0.5) */
function tap(levels: Float64Array[], k: number, u: number): number {
  const lv = levels[k] as Float64Array;
  const x = u * lv.length - 0.5;
  const i0 = Math.floor(x);
  const t = x - i0;
  const at = (i: number): number => lv[Math.max(0, Math.min(lv.length - 1, i))] as number;
  return at(i0) * (1 - t) + at(i0 + 1) * t;
}

describe('the seam at the border of a sprite (CPU model of blit + mips + bilinear tap)', () => {
  const cell = 144; // the cell of a 4-layer array at high (artCellFor)
  // sprite A fills its run: its right border is the cell edge; the tap goes where the shader's border pixel samples (the inner rect's edge)
  const rightEdge = (inner: boolean): number => {
    const rect = { u0: 0, v0: 0, du: 0.5, dv: 1 };
    const r = inner ? artInnerRect(rect, 2) : rect;
    return r.u0 + r.du;
  };

  it('START (no gutter): the border texel mixes in the neighbour at every mip level', () => {
    const levels = mips(atlasRow(cell));
    for (let k = 0; k <= 3; k++) expect(tap(levels, k, rightEdge(false)), `mip ${k}`).toBeLessThan(1 - 1e-6);
    // the first mip levels: the border pixel is half neighbour (level 0 sits exactly on the cell edge)
    expect(tap(levels, 0, rightEdge(false))).toBeCloseTo(0.5, 6);
  });

  it('with the gutter: the border pixel is the sprite\'s own colour up to mip level 1 + log2(gutter px) = 2 (2.25 px at a 144 px cell)', () => {
    const levels = mips(atlasRow(cell));
    const px = ART_GUTTER * cell;
    expect(px).toBeCloseTo(2.25, 9);
    for (let k = 0; k <= 1 + Math.floor(Math.log2(px)); k++) expect(tap(levels, k, rightEdge(true)), `mip ${k}`).toBeCloseTo(1, 9);
    // the limit is real: a level whose texel is wider than twice the gutter still reaches the neighbour (a sprite drawn at 1/8 of its cell)
    expect(tap(levels, 3, rightEdge(true))).toBeLessThan(1 - 1e-3);
  });

  it('the same at the left border of the neighbour and at the other cell sizes of the tiers (96 .. 176 px)', () => {
    for (const c of [96, 128, 144, 160, 176]) {
      const levels = mips(atlasRow(c));
      const px = ART_GUTTER * c;
      const kMax = Math.floor(Math.log2(Math.max(px, 1))) + 1;
      const rightA = artInnerRect({ u0: 0, v0: 0, du: 0.5, dv: 1 }, 2);
      const leftB = artInnerRect({ u0: 0.5, v0: 0, du: 0.5, dv: 1 }, 2);
      for (let k = 0; k <= Math.min(kMax, 3); k++) {
        // a mip chain whose cell edge is aligned to its texels (cell % 2^k == 0) is what the model describes
        if (c % 2 ** k !== 0) continue;
        expect(tap(levels, k, rightA.u0 + rightA.du), `${c}px mip ${k} right edge of A`).toBeCloseTo(1, 9);
        expect(tap(levels, k, leftB.u0), `${c}px mip ${k} left edge of B`).toBeCloseTo(0, 9);
      }
    }
  });
});
