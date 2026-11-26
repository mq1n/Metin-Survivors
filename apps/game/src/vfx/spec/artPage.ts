// Second cell size of the art array (pure: no three.js; used by the packer, the shaders' role decode, tests and tools).
//
// The art array is a stack of equal square layers. A normal ("full") layer is a G x G grid of cells (G = 8 when a scope needs more
// than one layer). A DENSE layer has the same pixel size but ART_DENSE_RATIO x G cells per side: its cells are 1/ratio of a full
// cell (a quarter of the area at ratio 2), so one dense layer holds 4 x the cells for the VRAM of one full layer. Sprites that lose
// (almost) nothing at half size (soft glows, puffs, haze: artDetail.ts, measured on the pixels) are the ones the packer may put there.
//
// ROLE ENCODING (packed art role, spec/art.ts packArtRole; the shaders decode it in spec/shaders.ts roleRect):
//   65536 + layer + 8 col + 64 row + 512 (w-1) + 2048 (h-1) + 8192 (frames-1)  + ART_ROLE_PAGE_UNIT * page
// page 0 = a full layer: exactly the encoding of every role before the second page existed (frames-1 <= 31 stays below the page unit).
// page 1..4 = a dense layer: page - 1 = (col >= 8) + 2 (row >= 8): col / row run 0..15 there, the 3-bit fields hold col % 8 / row % 8.
// Largest role 65536 + 4 * 262144 + 262143 < 2^21: exact in a float32 attribute.
import { ART_SOFT } from './artDetail';
import { artParts } from './artScope';

/** cells per layer side of a dense layer = this x the full layer's grid (so a dense cell is 1 / ratio of a full cell) */
export const ART_DENSE_RATIO = 2;
/** a scope whose full-page layout takes at most this many layers is laid out as before the second page existed (no dense layer) */
export const ART_PAGE1_LAYERS = 4;
/** value of one step of the role's page field (2^18: above the 5-bit frame count) */
export const ART_ROLE_PAGE_UNIT = 262144;

/**
 * How soft a key is: the largest measured loss of its sprites (artDetail.ts, lower = softer), undefined for a crisp key (any part not
 * listed, so unknown and new sprites are crisp). A frame list is as soft as its crispest frame.
 */
export function artSoftness(key: string): number | undefined {
  let worst = -1;
  for (const id of artParts(key)) {
    const v = ART_SOFT[id];
    if (v === undefined) return undefined;
    if (v > worst) worst = v;
  }
  return worst >= 0 ? worst : undefined;
}
