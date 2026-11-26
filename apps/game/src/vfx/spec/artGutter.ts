// Gutter between the cells of the art array (pure: no three.js; used by the blit in art.ts, the shaders' role decode in shaders.ts, tests and tools).
//
// A sprite is drawn into the cells of its run with the cells of its neighbours touching it. The array is sampled with a linear filter (and with
// mipmaps for anything drawn smaller than its cell), so a texel at the border of a run mixes in the texels of the NEXT run: a sprite whose edge
// texels are not black (a full-bleed pillar, a ring that reaches its cell) shows a 1 px seam in the colour of whatever sits beside it, and the
// seam moves with the packing order.
//
// ART_GUTTER is the cure, in two halves that must agree:
//   1. the BLIT (art.ts addBlit) draws the image into the run INSET by the gutter on every side and fills the gutter with the image's own edge
//      texels (the quad covers the whole run, its uv runs past the image and is clamped to it), so the border of every run is its own colour;
//   2. the DECODE (shaders.ts roleRect) hands the shaders the inner rect, so the sprite still spans its quad edge to edge and a texel read at its
//      border (bilinear tap, or a coarse mip texel) lands in the gutter, never in the neighbour.
// The gutter is a SHARE of the cell edge, so one constant serves every page and cell size (a full cell of 144 px has 2.25 px, 176 px 2.75 px, a dense
// cell of half that): a gutter of g px keeps the neighbour out of mip levels up to 1 + log2(g).
// Legacy kit shaders (shaders/common.ts GLSL_ART) read the whole cell, gutter included: their sprites come out 2 x ART_GUTTER (3 %) smaller.

/** the gutter on each side of a cell run, as a share of ONE cell edge (1/64: 2.25 px at a 144 px cell, 2.75 px at 176) */
export const ART_GUTTER = 1 / 64;

/** a rect in atlas uv (u0, v0 = lower left, du, dv = size) */
export interface UvRect {
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

/**
 * The inner rect of a cell run: `rect` (the run in atlas uv, spec/art.ts artRect) shrunk by the gutter on every side. `cells` is the grid the
 * rect is in (artRect().cells: the full layer's cells per side, or ART_DENSE_RATIO x that on a dense one). JS mirror of the tail of roleRect.
 */
export function artInnerRect(rect: UvRect, cells: number): UvRect {
  const i = ART_GUTTER / Math.max(cells, 1);
  return { u0: rect.u0 + i, v0: rect.v0 + i, du: rect.du - 2 * i, dv: rect.dv - 2 * i };
}
