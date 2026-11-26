// Albedo texture baking: every texel of the unwrapped mesh is mapped back onto the SDF surface and the *same* paint-layer
// stack that colours vertices is evaluated there. Seams are invisible because both sides of a seam sample the same 3-D field.
import { clamp01 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { Noise } from '../noise.ts';
import type { Unwrapped } from '../mesh/atlas.ts';
import type { Body } from '../sdf/body.ts';
import type { Sdf } from '../sdf/node.ts';
import type { Skeleton } from '../skin/skeleton.ts';
import { type PaintLayer, type PaintVertex, aoCavity, linearToSrgb, regionMask } from './painter.ts';

export interface BakeInput {
  atlas: Unwrapped;
  /** normals per atlas vertex */
  normals: Float32Array;
  /** dense skin weights per atlas vertex (vertex x boneCount) */
  dense: Float32Array;
  boneCount: number;
  sdf: Sdf;
  body: Body;
  skeleton: Skeleton;
  layers: PaintLayer[];
  seed: number | string;
  /** texture size in texels (square) */
  size: number;
  /** starting colour of every texel before the layers run (default mid grey; emissive bakes use black) */
  initial?: Vec3;
  /** colour of never-covered texels after dilation (default: average of the covered texels) */
  background?: Vec3;
  /** progress logging */
  log?: (s: string) => void;
}

export interface BakedTexture {
  /** sRGB RGBA bytes, row 0 = top (V = 0) */
  rgba: Uint8Array;
  size: number;
}

export function bakeAlbedo(input: BakeInput): BakedTexture {
  const { atlas, normals, dense, boneCount, sdf, body, skeleton, layers } = input;
  const S = input.size;
  const pos = atlas.positions, idx = atlas.indices, uv = atlas.uvs;
  const noise = new Noise(input.seed);
  const color = new Float32Array(S * S * 3);
  const score = new Float32Array(S * S).fill(-1);
  const boneIdx = new Map<string, number>();
  const bIdx = (name: string): number => {
    let i = boneIdx.get(name);
    if (i === undefined) boneIdx.set(name, (i = skeleton.idx(name)));
    return i;
  };
  // tag -> [sdf, aabb] once
  const tagCache = new Map<string, { sdf: Sdf; min: Vec3; max: Vec3 }[]>();
  const tagParts = (tag: string): { sdf: Sdf; min: Vec3; max: Vec3 }[] => {
    let a = tagCache.get(tag);
    if (!a) {
      a = body.tagged(tag).map((s) => ({ sdf: s, min: s.bounds().min, max: s.bounds().max }));
      tagCache.set(tag, a);
    }
    return a;
  };

  const nTri = idx.length / 3;
  let covered = 0;
  for (let t = 0; t < nTri; t++) {
    const ia = idx[t * 3]!, ib = idx[t * 3 + 1]!, ic = idx[t * 3 + 2]!;
    const ax = uv[ia * 2]! * S, ay = uv[ia * 2 + 1]! * S;
    const bx = uv[ib * 2]! * S, by = uv[ib * 2 + 1]! * S;
    const cx = uv[ic * 2]! * S, cy = uv[ic * 2 + 1]! * S;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), maxX = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), maxY = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)) + 1);

    // local evaluation context for this triangle
    const pa: Vec3 = [pos[ia * 3]!, pos[ia * 3 + 1]!, pos[ia * 3 + 2]!];
    const pb: Vec3 = [pos[ib * 3]!, pos[ib * 3 + 1]!, pos[ib * 3 + 2]!];
    const pc: Vec3 = [pos[ic * 3]!, pos[ic * 3 + 1]!, pos[ic * 3 + 2]!];
    const ctr: Vec3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const rad = Math.max(Math.hypot(pa[0] - ctr[0], pa[1] - ctr[1], pa[2] - ctr[2]), Math.hypot(pb[0] - ctr[0], pb[1] - ctr[1], pb[2] - ctr[2]), Math.hypot(pc[0] - ctr[0], pc[1] - ctr[1], pc[2] - ctr[2])) + 0.01;
    const local = sdf.restrict(ctr[0], ctr[1], ctr[2], rad + 0.32);
    const regionPad = rad + 0.1;
    const localTags = new Map<string, Sdf[]>();
    const tagsFor = (tag: string): Sdf[] => {
      let a = localTags.get(tag);
      if (!a) {
        a = tagParts(tag)
          .filter((q) => q.max[0] > ctr[0] - regionPad && q.min[0] < ctr[0] + regionPad && q.max[1] > ctr[1] - regionPad && q.min[1] < ctr[1] + regionPad && q.max[2] > ctr[2] - regionPad && q.min[2] < ctr[2] + regionPad)
          .map((q) => q.sdf);
        localTags.set(tag, a);
      }
      return a;
    };

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const px = tx + 0.5, py = ty + 0.5;
        const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l2 = 1 - l0 - l1;
        const sc = Math.min(l0, l1, l2);
        if (sc < -0.45) continue; // generous gutter: extrapolated texels sample the same 3-D field, so seams stay invisible
        const o = ty * S + tx;
        if (score[o]! >= sc) continue;
        const w0 = Math.max(l0, 0), w1 = Math.max(l1, 0), w2 = Math.max(l2, 0);
        const ws = w0 + w1 + w2 || 1;
        const k0 = w0 / ws, k1 = w1 / ws, k2 = w2 / ws;
        let p: Vec3 = [pa[0] * k0 + pb[0] * k1 + pc[0] * k2, pa[1] * k0 + pb[1] * k1 + pc[1] * k2, pa[2] * k0 + pb[2] * k1 + pc[2] * k2];
        // pull the flat-triangle point onto the true surface
        const h = 0.002;
        const d = local.d(p[0], p[1], p[2]);
        const gx = local.d(p[0] + h, p[1], p[2]) - local.d(p[0] - h, p[1], p[2]);
        const gy = local.d(p[0], p[1] + h, p[2]) - local.d(p[0], p[1] - h, p[2]);
        const gz = local.d(p[0], p[1], p[2] + h) - local.d(p[0], p[1], p[2] - h);
        const gl = gx * gx + gy * gy + gz * gz;
        if (gl > 1e-12) {
          const k = (d * 2 * h) / gl;
          p = [p[0] - gx * k, p[1] - gy * k, p[2] - gz * k];
        }
        let nx = normals[ia * 3]! * k0 + normals[ib * 3]! * k1 + normals[ic * 3]! * k2;
        let ny = normals[ia * 3 + 1]! * k0 + normals[ib * 3 + 1]! * k1 + normals[ic * 3 + 1]! * k2;
        let nz = normals[ia * 3 + 2]! * k0 + normals[ib * 3 + 2]! * k1 + normals[ic * 3 + 2]! * k2;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const n: Vec3 = [nx, ny, nz];
        let ac: { ao: number; cavity: number } | null = null;
        const v: PaintVertex = {
          i: k0 >= k1 && k0 >= k2 ? ia : k1 >= k2 ? ib : ic,
          p,
          n,
          get ao() { return (ac ??= aoCavity(local, p, n)).ao; },
          get cavity() { return (ac ??= aoCavity(local, p, n)).cavity; },
          bone: (name) => {
            const bi = bIdx(name);
            return dense[ia * boneCount + bi]! * k0 + dense[ib * boneCount + bi]! * k1 + dense[ic * boneCount + bi]! * k2;
          },
          region: (tag, soft = 0.02) => regionMask(tagsFor(tag), p, soft),
          noise,
          color: input.initial ? [...input.initial] : [0.5, 0.5, 0.5],
        };
        for (const l of layers) l.apply(v);
        if (score[o]! < 0) covered++;
        score[o] = sc;
        color[o * 3] = clamp01(v.color[0]);
        color[o * 3 + 1] = clamp01(v.color[1]);
        color[o * 3 + 2] = clamp01(v.color[2]);
      }
    }
  }
  input.log?.(`  baked ${covered}/${S * S} texels (${Math.round((covered / (S * S)) * 100)}% coverage)`);

  // dilate into the padding so bilinear filtering / mips never see the background
  let avg: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < S * S; i++) if (score[i]! >= 0) { avg[0] += color[i * 3]!; avg[1] += color[i * 3 + 1]!; avg[2] += color[i * 3 + 2]!; }
  avg = input.background ?? [avg[0] / Math.max(covered, 1), avg[1] / Math.max(covered, 1), avg[2] / Math.max(covered, 1)];
  const filled = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) filled[i] = score[i]! >= 0 ? 1 : 0;
  for (let pass = 0; pass < 8; pass++) {
    const nextFilled = filled.slice();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const o = y * S + x;
        if (filled[o]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
            const q = yy * S + xx;
            if (!filled[q]) continue;
            r += color[q * 3]!; g += color[q * 3 + 1]!; b += color[q * 3 + 2]!; c++;
          }
        }
        if (c) {
          color[o * 3] = r / c; color[o * 3 + 1] = g / c; color[o * 3 + 2] = b / c;
          nextFilled[o] = 1;
        }
      }
    }
    filled.set(nextFilled);
  }
  const rgba = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const f = filled[i]!;
    const r = f ? color[i * 3]! : avg[0], g = f ? color[i * 3 + 1]! : avg[1], b = f ? color[i * 3 + 2]! : avg[2];
    rgba[i * 4] = Math.round(linearToSrgb(r) * 255);
    rgba[i * 4 + 1] = Math.round(linearToSrgb(g) * 255);
    rgba[i * 4 + 2] = Math.round(linearToSrgb(b) * 255);
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, size: S };
}
