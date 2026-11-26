// Tree shadows from the crown silhouette (zones core B1). The old baked shadow was a soft capsule per tree (bakeLight.ts),
// a smudge that neither had the crown's outline nor its size. Here the REAL crown is projected along the sun onto the ground:
// every leaf card of the tree's variant (the same five variants per species the tree system draws, with the instance's yaw,
// lean and scale jitter from `treeJitter`) is rasterised into the light bake with the card texture's own alpha as its cut-out,
// and the trunk / branches as thin solid triangles. The union of the cards gives the ragged, lobed outline of the leaves
// (not a blob), the trunk shadow runs from the trunk's foot, and a tree has the size and direction its crown really has.
//
// Output = one byte per texel of the light bake, 0 = no tree shadow … 255 = full darkness (before the zone's `baked` strength).
// Pure CPU, deterministic, no DOM: foliage alpha masks are handed in (render/vegetation/foliageMask.ts reads them from the
// shipped textures); without a mask a procedural ragged leaf blob stands in (tests, missing textures).
import type { BufferGeometry } from 'three';
import type { TreePlacement, TreeSpecies } from '../../world/layoutTypes';
import { hash2 } from '../../world/rng';
import { treeJitter } from '../vegetation/trees';
import { acquireTreeVariants, releaseTreeVariants, TREE_VARIANTS } from '../vegetation/treeVariants';
import type { TreeStyle } from '../vegetation/treeCommon';

/** Alpha of a foliage card texture, `size`² bytes, row 0 = the TOP of the image (v = 1 with three's flipY). */
export interface FoliageMask {
  size: number;
  data: Uint8Array;
}

/** per species: masks of texture slot A and slot B (the alternate card some lobes use) */
export type TreeShadowMasks = Partial<Record<TreeSpecies, [FoliageMask | null, FoliageMask | null]>>;

export interface TreeShadowInput {
  trees: readonly TreePlacement[];
  style: TreeStyle;
  /** direction TOWARDS the sun (need not be normalised, y > 0) */
  sun: { x: number; y: number; z: number };
  /** domain edge length (m); the output covers [-size/2, size/2]² */
  size: number;
  /** texels per axis of the output */
  res: number;
  /** ground height at (x, z), used for the local slope under each tree only */
  heightAt(x: number, z: number): number;
  /** darkness of full leaf cover, 0..1 */
  strength: number;
  /** per-species multiplier on `strength` */
  species?: Partial<Record<TreeSpecies, number>>;
  masks?: TreeShadowMasks;
  /** variant LOD used for the leaf cards (default 0 = what is drawn near the camera) */
  foliageLod?: 0 | 1;
}

/** Foliage / bark data of one variant, copied out of the shared geometry (the geometry may be released afterwards). */
interface Part {
  pos: Float32Array;
  uv: Float32Array | null;
  sel: Float32Array | null;
  idx: Uint32Array;
}

interface VariantParts {
  foliage: Part;
  bark: Part;
}

function partOf(geo: BufferGeometry, withUv: boolean): Part {
  const pos = geo.getAttribute('position').array as Float32Array;
  const idx = (geo.getIndex()?.array ?? new Uint32Array(0)) as Uint32Array;
  if (!withUv) return { pos: new Float32Array(pos), uv: null, sel: null, idx: new Uint32Array(idx) };
  const uv = geo.getAttribute('uv').array as Float32Array;
  const dat = geo.getAttribute('aData').array as Float32Array;
  const n = pos.length / 3;
  const sel = new Float32Array(n);
  for (let i = 0; i < n; i++) sel[i] = dat[i * 4 + 2] as number;
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), sel, idx: new Uint32Array(idx) };
}

/** A ragged leaf-cluster blob (an ellipse with a noisy rim and a few holes) for a card without a texture mask. */
export function proceduralLeafMask(seed: number, size = 32): FoliageMask {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const r = Math.hypot(u / 0.44, v / 0.42);
      const a = Math.atan2(v, u);
      const rim = 0.78 + 0.3 * hash2(Math.floor((a + Math.PI) * 4), 3, seed) + 0.16 * (hash2(x, y, seed + 1) - 0.5);
      const hole = hash2(x >> 1, y >> 1, seed + 2) < 0.07 ? 0.25 : 1;
      data[y * size + x] = Math.round(255 * Math.max(0, Math.min(1, (rim - r) * 5)) * hole);
    }
  }
  return { size, data };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** card alpha at (u, v) (v up), cut at the foliage material's alpha test (0.42) with a soft edge. Nearest texel of the mask: a card
 * spans tens of mask texels per output texel, and the outline texels are sub-sampled by the caller. */
function maskAlpha(m: FoliageMask, u: number, v: number): number {
  const s = m.size;
  const x = Math.max(0, Math.min(s - 1, (u * s) | 0));
  const y = Math.max(0, Math.min(s - 1, ((1 - v) * s) | 0));
  const a = (m.data[y * s + x] as number) / 255;
  return a <= 0.3 ? 0 : a >= 0.55 ? 1 : smooth(0.3, 0.55, a);
}

/** Rotation of three's Euler 'YXZ' (x = lean about X, y = yaw, z = lean about Z), row-major 3x3. */
export function eulerYXZ(rx: number, ry: number, rz: number): Float64Array {
  const a = Math.cos(rx);
  const b = Math.sin(rx);
  const c = Math.cos(ry);
  const d = Math.sin(ry);
  const e = Math.cos(rz);
  const f = Math.sin(rz);
  return Float64Array.of(c * e + d * f * b, d * e * b - c * f, a * d, a * f, a * e, -b, c * f * b - d * e, d * f + c * e * b, a * c);
}

/**
 * Projects every tree's crown and trunk along the sun and rasterises them. Returns `res * res` bytes (row 0 = z -size/2).
 */
export function rasterTreeShadows(inp: TreeShadowInput): Uint8Array {
  const { res, size } = inp;
  const out = new Uint8Array(res * res);
  const k = res / size;
  const half = size / 2;
  const sl = Math.hypot(inp.sun.x, inp.sun.y, inp.sun.z) || 1;
  const Lx = inp.sun.x / sl;
  const Ly = Math.max(0.2, inp.sun.y / sl);
  const Lz = inp.sun.z / sl;
  const lod = inp.foliageLod ?? 0;
  const fallback: [FoliageMask, FoliageMask] = [proceduralLeafMask(11), proceduralLeafMask(29)];

  // per-species item index = the tree's index in its species list in layout order (the tree system's `item`)
  const bySpecies = new Map<TreeSpecies, TreePlacement[]>();
  for (const t of inp.trees) {
    const l = bySpecies.get(t.species);
    if (l) l.push(t);
    else bySpecies.set(t.species, [t]);
  }

  const px = new Float64Array(3);
  const rot = (m: Float64Array, sxz: number, sy: number, x: number, y: number, z: number, o: Float64Array): void => {
    const X = x * sxz;
    const Y = y * sy;
    const Z = z * sxz;
    o[0] = (m[0] as number) * X + (m[1] as number) * Y + (m[2] as number) * Z;
    o[1] = (m[3] as number) * X + (m[4] as number) * Y + (m[5] as number) * Z;
    o[2] = (m[6] as number) * X + (m[7] as number) * Y + (m[8] as number) * Z;
  };

  // scratch for one projected triangle: texel-space x, y; uv; sel
  const X = new Float64Array(3);
  const Y = new Float64Array(3);
  const U = new Float64Array(3);
  const V = new Float64Array(3);

  const leafTri = (dark: number, mask: FoliageMask): void => {
    const den = (Y[1]! - Y[2]!) * (X[0]! - X[2]!) + (X[2]! - X[1]!) * (Y[0]! - Y[2]!);
    if (Math.abs(den) < 1e-3) return; // an edge-on card casts no shadow
    const inv = 1 / den;
    const x0 = Math.max(0, Math.floor(Math.min(X[0]!, X[1]!, X[2]!) - 0.5));
    const x1 = Math.min(res - 1, Math.ceil(Math.max(X[0]!, X[1]!, X[2]!) - 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(Y[0]!, Y[1]!, Y[2]!) - 0.5));
    const y1 = Math.min(res - 1, Math.ceil(Math.max(Y[0]!, Y[1]!, Y[2]!) - 0.5));
    for (let j = y0; j <= y1; j++) {
      const py = j + 0.5;
      for (let i = x0; i <= x1; i++) {
        const pxx = i + 0.5;
        const w0 = ((Y[1]! - Y[2]!) * (pxx - X[2]!) + (X[2]! - X[1]!) * (py - Y[2]!)) * inv;
        const w1 = ((Y[2]! - Y[0]!) * (pxx - X[2]!) + (X[0]! - X[2]!) * (py - Y[2]!)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        let a = maskAlpha(mask, w0 * U[0]! + w1 * U[1]! + w2 * U[2]!, w0 * V[0]! + w1 * V[1]! + w2 * V[2]!);
        if (a > 0.04 && a < 0.96) {
          // a texel on a leaf outline: four sub-samples (only where all of them are inside this triangle, so the diagonal of a
          // split card never shows a seam) average the cut-out into an anti-aliased edge instead of a stair-step
          let sum = a;
          let cnt = 1;
          let inside = true;
          const sub: number[] = [];
          for (let q = 0; q < 4 && inside; q++) {
            const sx = pxx + (q & 1 ? 0.25 : -0.25);
            const sy = py + (q & 2 ? 0.25 : -0.25);
            const b0 = ((Y[1]! - Y[2]!) * (sx - X[2]!) + (X[2]! - X[1]!) * (sy - Y[2]!)) * inv;
            const b1 = ((Y[2]! - Y[0]!) * (sx - X[2]!) + (X[0]! - X[2]!) * (sy - Y[2]!)) * inv;
            if (b0 < 0 || b1 < 0 || b0 + b1 > 1) inside = false;
            else sub.push(maskAlpha(mask, b0 * U[0]! + b1 * U[1]! + (1 - b0 - b1) * U[2]!, b0 * V[0]! + b1 * V[1]! + (1 - b0 - b1) * V[2]!));
          }
          if (inside) {
            for (const x of sub) sum += x;
            cnt += 4;
            a = sum / cnt;
          }
        }
        if (a <= 0) continue;
        const v = Math.round(dark * a);
        const o = j * res + i;
        if (v > (out[o] as number)) out[o] = v;
      }
    }
  };

  /** solid triangle that may be thinner than a texel (trunk, branches): coverage by distance to the edges, scaled by width */
  const thinTri = (dark: number): void => {
    const cr = (X[1]! - X[0]!) * (Y[2]! - Y[0]!) - (X[2]! - X[0]!) * (Y[1]! - Y[0]!);
    const area2 = Math.abs(cr);
    if (area2 < 1e-4) return;
    const e0 = Math.hypot(X[1]! - X[0]!, Y[1]! - Y[0]!);
    const e1 = Math.hypot(X[2]! - X[1]!, Y[2]! - Y[1]!);
    const e2 = Math.hypot(X[0]! - X[2]!, Y[0]! - Y[2]!);
    const w = area2 / Math.max(e0, e1, e2, 1e-6); // the triangle's smallest height, texels
    const f = Math.min(1, w);
    const sgn = cr > 0 ? 1 : -1;
    const x0 = Math.max(0, Math.floor(Math.min(X[0]!, X[1]!, X[2]!) - 1));
    const x1 = Math.min(res - 1, Math.ceil(Math.max(X[0]!, X[1]!, X[2]!) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(Y[0]!, Y[1]!, Y[2]!) - 1));
    const y1 = Math.min(res - 1, Math.ceil(Math.max(Y[0]!, Y[1]!, Y[2]!) + 1));
    const ex = [X[1]! - X[0]!, X[2]! - X[1]!, X[0]! - X[2]!];
    const ey = [Y[1]! - Y[0]!, Y[2]! - Y[1]!, Y[0]! - Y[2]!];
    const el = [e0 || 1, e1 || 1, e2 || 1];
    for (let j = y0; j <= y1; j++) {
      const py = j + 0.5;
      for (let i = x0; i <= x1; i++) {
        const pxx = i + 0.5;
        let d = 1e9;
        for (let q = 0; q < 3; q++) {
          const sx = X[q]!;
          const sy = Y[q]!;
          // signed distance to edge q, positive inside
          const dd = (sgn * (ex[q]! * (py - sy) - ey[q]! * (pxx - sx))) / el[q]!;
          if (dd < d) d = dd;
        }
        const c = Math.max(0, Math.min(1, 0.5 + d)) * f;
        if (c <= 0) continue;
        const v = Math.round(dark * c);
        const o = j * res + i;
        if (v > (out[o] as number)) out[o] = v;
      }
    }
  };

  for (const [species, list] of bySpecies) {
    const set = acquireTreeVariants(species, inp.style);
    try {
      const parts: VariantParts[] = [];
      for (let v = 0; v < TREE_VARIANTS; v++) {
        parts.push({ foliage: partOf(set.foliage[v * 2 + lod]!, true), bark: partOf(set.bark[1 + v * 2]!, false) });
      }
      // per-instance projected vertex table (texel space), sized for the largest part of this species
      let maxV = 1;
      for (const vp of parts) maxV = Math.max(maxV, vp.foliage.pos.length / 3, vp.bark.pos.length / 3);
      const projX = new Float64Array(maxV);
      const projY = new Float64Array(maxV);
      const m = inp.masks?.[species];
      const maskA = m?.[0] ?? fallback[0];
      const maskB = m?.[1] ?? m?.[0] ?? fallback[1];
      const dark = Math.round(255 * Math.max(0, Math.min(1, inp.strength * (inp.species?.[species] ?? 1))));
      if (dark <= 0) continue;
      for (let item = 0; item < list.length; item++) {
        const t = list[item] as TreePlacement;
        const jit = treeJitter(item, t);
        const rm = eulerYXZ(jit.rx, t.yaw, jit.rz);
        const vp = parts[t.seed % TREE_VARIANTS] as VariantParts;
        // the ground under the tree as a plane through its foot: gradient from the heights round the shadow's centre, so a
        // crown on a slope throws its shadow up / down the slope and not onto a level plane
        const reach = 3 + 5 * t.scale;
        const cx = t.x - (Lx / Ly) * reach;
        const cz = t.z - (Lz / Ly) * reach;
        const dgx = (inp.heightAt(cx + 2, cz) - inp.heightAt(cx - 2, cz)) / 4;
        const dgz = (inp.heightAt(cx, cz + 2) - inp.heightAt(cx, cz - 2)) / 4;
        const gx = Math.max(-0.9, Math.min(0.9, dgx));
        const gz = Math.max(-0.9, Math.min(0.9, dgz));
        const denom = Math.max(0.15, Ly - gx * Lx - gz * Lz);

        // every vertex of the variant is projected once (they are shared by 2-4 triangles), then the triangles read the table
        const projectAll = (part: Part, xs: Float64Array, ys: Float64Array): void => {
          const nv = part.pos.length / 3;
          for (let vi = 0; vi < nv; vi++) {
            rot(rm, jit.sxz, jit.sy, part.pos[vi * 3] as number, part.pos[vi * 3 + 1] as number, part.pos[vi * 3 + 2] as number, px);
            const dx = px[0] as number;
            const dz = px[2] as number;
            const s = Math.max(0, (px[1] as number) - gx * dx - gz * dz) / denom;
            xs[vi] = (t.x + dx - Lx * s + half) * k;
            ys[vi] = (t.z + dz - Lz * s + half) * k;
          }
        };

        const bark = vp.bark;
        projectAll(bark, projX, projY);
        for (let q = 0; q < bark.idx.length; q += 3) {
          for (let c = 0; c < 3; c++) {
            const vi = bark.idx[q + c] as number;
            X[c] = projX[vi] as number;
            Y[c] = projY[vi] as number;
          }
          thinTri(dark);
        }
        const fol = vp.foliage;
        const uv = fol.uv as Float32Array;
        const sel = fol.sel as Float32Array;
        projectAll(fol, projX, projY);
        for (let q = 0; q < fol.idx.length; q += 3) {
          for (let c = 0; c < 3; c++) {
            const vi = fol.idx[q + c] as number;
            X[c] = projX[vi] as number;
            Y[c] = projY[vi] as number;
            U[c] = uv[vi * 2] as number;
            V[c] = uv[vi * 2 + 1] as number;
          }
          leafTri(dark, (sel[fol.idx[q] as number] as number) > 0.5 ? maskB : maskA);
        }
      }
    } finally {
      releaseTreeVariants(species, inp.style);
    }
  }
  return out;
}

/** Separable [1 2 1] smoothing of a byte buffer, `passes` times (anti-aliases the rasterised edges). */
export function smoothBytes(buf: Uint8Array, res: number, passes: number): void {
  if (passes <= 0) return;
  const tmp = new Uint8Array(res * res);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < res; j++) {
      const r = j * res;
      for (let i = 0; i < res; i++) {
        const a = buf[r + Math.max(0, i - 1)] as number;
        const b = buf[r + i] as number;
        const c = buf[r + Math.min(res - 1, i + 1)] as number;
        tmp[r + i] = (a + 2 * b + c + 2) >> 2;
      }
    }
    for (let j = 0; j < res; j++) {
      const rm = Math.max(0, j - 1) * res;
      const r = j * res;
      const rp = Math.min(res - 1, j + 1) * res;
      for (let i = 0; i < res; i++) buf[r + i] = ((tmp[rm + i] as number) + 2 * (tmp[r + i] as number) + (tmp[rp + i] as number) + 2) >> 2;
    }
  }
}
