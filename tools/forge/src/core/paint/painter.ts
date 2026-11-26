// Vertex-colour painting. A painter evaluates an ordered stack of layers per final vertex. Layers see position, normal,
// SDF-derived AO / cavity, skin weights (bone masks), tag regions (from tagged body parts) and noise.
import { clamp, clamp01, smoothstep } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { Noise } from '../noise.ts';
import type { Body } from '../sdf/body.ts';
import type { Sdf } from '../sdf/node.ts';
import type { SkinData } from '../skin/weights.ts';
import type { Skeleton } from '../skin/skeleton.ts';

/** linear-light RGB */
export type Rgb = [number, number, number];

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** '#rrggbb' (sRGB) -> linear */
export function rgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}
export const toHex = (c: Rgb): string => '#' + c.map((x) => Math.round(clamp01(linearToSrgb(clamp01(x))) * 255).toString(16).padStart(2, '0')).join('');
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulRgb = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
export const addRgb = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** HSV-ish adjustment in sRGB space: shift value (+/-) and saturation multiplier */
export function adjust(c: Rgb, value = 0, sat = 1): Rgb {
  const s: Rgb = [linearToSrgb(clamp01(c[0])), linearToSrgb(clamp01(c[1])), linearToSrgb(clamp01(c[2]))];
  const l = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
  const o: Rgb = [l + (s[0] - l) * sat + value, l + (s[1] - l) * sat + value, l + (s[2] - l) * sat + value];
  return [srgbToLinear(clamp01(o[0])), srgbToLinear(clamp01(o[1])), srgbToLinear(clamp01(o[2]))];
}

export interface PaintVertex {
  readonly i: number;
  readonly p: Vec3;
  readonly n: Vec3;
  /** 1 = open, 0 = fully occluded (SDF cone-marched); computed lazily */
  readonly ao: number;
  /** -1 concave ... +1 convex; computed lazily */
  readonly cavity: number;
  /** skin weight of a bone (0..1) */
  bone(name: string): number;
  /** soft mask from parts carrying `tag`: 1 on/inside the part, fading to 0 over `soft` metres */
  region(tag: string, soft?: number): number;
  readonly noise: Noise;
  /** working colour (linear). Layers mutate it. */
  color: Rgb;
}

export interface PaintLayer {
  name: string;
  apply(v: PaintVertex): void;
}

export interface PaintInput {
  positions: Float32Array;
  normals: Float32Array;
  sdf: Sdf;
  body: Body;
  skeleton: Skeleton;
  skin: SkinData;
  seed?: number | string;
  /** AO / cavity sampling field (default: the same sdf) */
  aoSdf?: Sdf;
  /** starting colour of every vertex (default mid grey; use white for multiplier-only stacks) */
  initial?: Rgb;
}

const AO_H = [0.012, 0.03, 0.06, 0.11, 0.18];
const AO_W = [1, 0.85, 0.65, 0.45, 0.3];
const AO_WSUM = AO_W.reduce((x, y) => x + y, 0);
const CAV_H = 0.014;

/** SDF-marched ambient occlusion (1 open .. 0 occluded) and cavity (-1 concave .. +1 convex) at a surface point. */
export function aoCavity(sdf: Sdf, p: Vec3, n: Vec3): { ao: number; cavity: number } {
  let occ = 0;
  for (let k = 0; k < AO_H.length; k++) {
    const h = AO_H[k]!;
    const d = sdf.d(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h);
    occ += AO_W[k]! * clamp01((h - d) / h);
  }
  const d0 = sdf.d(p[0], p[1], p[2]);
  const lap = (sdf.d(p[0] + CAV_H, p[1], p[2]) + sdf.d(p[0] - CAV_H, p[1], p[2]) + sdf.d(p[0], p[1] + CAV_H, p[2]) + sdf.d(p[0], p[1] - CAV_H, p[2]) + sdf.d(p[0], p[1], p[2] + CAV_H) + sdf.d(p[0], p[1], p[2] - CAV_H) - 6 * d0) / (CAV_H * CAV_H);
  return { ao: clamp01(1 - occ / AO_WSUM), cavity: clamp(lap * 0.02, -1, 1) };
}

/** soft region mask from a set of tagged SDFs: 1 on/inside, fading to 0 over `soft` metres */
export function regionMask(sdfs: readonly Sdf[], p: Vec3, soft: number): number {
  let d = Infinity;
  for (const s of sdfs) d = Math.min(d, s.d(p[0], p[1], p[2]));
  return 1 - smoothstep(0, soft, d);
}

/** Run a layer stack per vertex; returns linear RGB floats (3 per vertex). */
export function paintMesh(input: PaintInput, layers: PaintLayer[]): Float32Array {
  const { positions, normals, sdf, body, skeleton, skin } = input;
  const aoSdf = input.aoSdf ?? sdf;
  const nv = positions.length / 3;
  const out = new Float32Array(nv * 3);
  const noise = new Noise(input.seed ?? 7);
  const regionCache = new Map<string, Sdf[]>();
  const tagSdfs = (tag: string): Sdf[] => {
    let a = regionCache.get(tag);
    if (!a) regionCache.set(tag, (a = body.tagged(tag)));
    return a;
  };
  for (let i = 0; i < nv; i++) {
    const p: Vec3 = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    const n: Vec3 = [normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!];
    let ac: { ao: number; cavity: number } | null = null;
    const v: PaintVertex = {
      i,
      p,
      n,
      get ao() { return (ac ??= aoCavity(aoSdf, p, n)).ao; },
      get cavity() { return (ac ??= aoCavity(aoSdf, p, n)).cavity; },
      bone: (name) => skin.dense[i * skin.boneCount + skeleton.idx(name)] ?? 0,
      region: (tag, soft = 0.02) => regionMask(tagSdfs(tag), p, soft),
      noise,
      color: input.initial ? ([...input.initial] as Rgb) : [0.5, 0.5, 0.5],
    };
    for (const l of layers) l.apply(v);
    out[i * 3] = clamp01(v.color[0]);
    out[i * 3 + 1] = clamp01(v.color[1]);
    out[i * 3 + 2] = clamp01(v.color[2]);
  }
  return out;
}
