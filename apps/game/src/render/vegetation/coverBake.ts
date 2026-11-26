// CPU bake for the ground-cover scatter: a HalfFloat height texture of the bare ground (bridge decks excluded) and one
// R8 density mask per cover spec (ground-layer weights x spec.layers, cleared on liquids / steep slopes / blockers).
import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import type { CoverSpec } from '../../world/layoutTypes';
import { SURFACE } from '../../world/layoutTypes';
import type { TerrainField } from '../../world/terrainField';

export interface CoverBake {
  height: DataTexture;
  /** value subtracted from the heights before they were stored as half floats */
  heightBase: number;
  masks: DataTexture[];
  /** per-spec maximum of `layers` (the mask is normalised by it) */
  layerMax: number[];
  /** side of the baked domain (m) */
  size: number;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** where cover may grow at all: 1 on open ground, 0 on liquids, cliffs and under blockers */
function suitability(field: TerrainField, res: number): Float32Array {
  const g = field.grid;
  const n = g.n;
  const half = field.size / 2;
  const texel = field.size / res;
  const out = new Float32Array(res * res).fill(1);
  for (let j = 0; j < res; j++) {
    const z = -half + (j + 0.5) * texel;
    const gz = Math.min(n - 2, Math.max(1, Math.round((z + half) / g.cell)));
    for (let i = 0; i < res; i++) {
      const x = -half + (i + 0.5) * texel;
      const gx = Math.min(n - 2, Math.max(1, Math.round((x + half) / g.cell)));
      const idx = gz * n + gx;
      if ((g.surface[idx] as number) !== SURFACE.GROUND) {
        out[j * res + i] = 0;
        continue;
      }
      const sx = ((g.bed[idx + 1] as number) - (g.bed[idx - 1] as number)) / (2 * g.cell);
      const sz = ((g.bed[idx + n] as number) - (g.bed[idx - n] as number)) / (2 * g.cell);
      out[j * res + i] = 1 - smooth(0.45, 0.8, Math.hypot(sx, sz));
    }
  }
  // blockers: trunks, rocks, props and wall posts keep a clear disc with a soft rim
  for (const b of field.blockers) {
    const r = b.r + 0.3;
    const rim = r + 0.9;
    const i0 = Math.max(0, Math.floor((b.x - rim + half) / texel));
    const i1 = Math.min(res - 1, Math.ceil((b.x + rim + half) / texel));
    const j0 = Math.max(0, Math.floor((b.z - rim + half) / texel));
    const j1 = Math.min(res - 1, Math.ceil((b.z + rim + half) / texel));
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * texel;
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * texel;
        const k = smooth(r, rim, Math.hypot(x - b.x, z - b.z));
        const o = j * res + i;
        if (k < (out[o] as number)) out[o] = k;
      }
    }
  }
  return out;
}

export function bakeCover(field: TerrainField, specs: readonly CoverSpec[]): CoverBake {
  const g = field.grid;
  const n = g.n;
  let hMin = Infinity;
  for (let i = 0; i < g.bed.length; i++) hMin = Math.min(hMin, g.bed[i] as number);
  const half = new Uint16Array(n * n);
  for (let i = 0; i < half.length; i++) half[i] = DataUtils.toHalfFloat((g.bed[i] as number) - hMin);
  const height = new DataTexture(half, n, n, RedFormat, HalfFloatType);
  height.minFilter = height.magFilter = LinearFilter;
  height.wrapS = height.wrapT = ClampToEdgeWrapping;
  height.generateMipmaps = false;
  // 513 texels x 2 bytes per row is not 4-byte aligned
  height.unpackAlignment = 1;
  height.needsUpdate = true;

  const paint = field.paint();
  const res = paint.res;
  const suit = suitability(field, res);
  const masks: DataTexture[] = [];
  const layerMax: number[] = [];
  for (const spec of specs) {
    const lm = Math.max(1e-4, ...spec.layers);
    layerMax.push(lm);
    const data = new Uint8Array(res * res);
    const k = 1 / (255 * lm);
    const L = spec.layers;
    const l0 = L[0] ?? 0;
    const l1 = L[1] ?? 0;
    const l2 = L[2] ?? 0;
    const l3 = L[3] ?? 0;
    const l4 = L[4] ?? 0;
    const l5 = L[5] ?? 0;
    const l6 = L[6] ?? 0;
    const l7 = L[7] ?? 0;
    for (let p = 0; p < res * res; p++) {
      const o = p * 4;
      const w0 = paint.w0;
      const w1 = paint.w1;
      const m =
        ((w0[o] as number) * l0 + (w0[o + 1] as number) * l1 + (w0[o + 2] as number) * l2 + (w0[o + 3] as number) * l3 + (w1[o] as number) * l4 + (w1[o + 1] as number) * l5 + (w1[o + 2] as number) * l6 + (w1[o + 3] as number) * l7) *
        k *
        (suit[p] as number);
      data[p] = Math.round(Math.min(1, m) * 255);
    }
    const t = new DataTexture(data, res, res, RedFormat, UnsignedByteType);
    t.minFilter = t.magFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    masks.push(t);
  }
  return { height, heightBase: hMin, masks, layerMax, size: field.size };
}
