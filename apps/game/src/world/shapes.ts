// Building blocks for recipe height/paint functions. Pure arithmetic (see recipe.ts determinism rule).
import { clamp, fbm, smoothstep } from './noise';

export { clamp, smoothstep };

/** smooth minimum (polynomial), k = blend width in the units of a/b */
export function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** 1 at d=0 falling smoothly to 0 at d=r (compact bump) */
export function bump(d: number, r: number): number {
  const t = 1 - clamp(d / r, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Plateau blend: returns weight 1 inside `inner`, 0 outside `outer` (smooth). */
export function disc(d: number, inner: number, outer: number): number {
  return 1 - smoothstep(inner, outer, d);
}

/**
 * Channel carve profile for distance `d` from a centreline: returns depth (m, ≥ 0) removed from the terrain.
 * Flat bed of half-width `bed`, banks rising over `bank` metres to the surrounding ground.
 */
export function channelDepth(d: number, bed: number, bank: number, depth: number): number {
  return depth * (1 - smoothstep(bed, bed + bank, d));
}

/**
 * River carve profile (zones core C3) for distance `d` (m) from the centreline: depth (m, ≥ 0) removed from the terrain.
 * Instead of channelDepth's parabolic canal: a deep core, a gentle slope up to a shallow sand shelf (`beach` metres wide,
 * at most 0.35 m deep: the waterline sits on it, so the water edge is soft and wide), then a soft bank rising over
 * `bankSoft` metres beyond `width` (the half-width at the bank top). Feed it a width that varies along the river
 * (riverWidth) and the channel stops reading as a constant-width canal. Pure arithmetic (determinism rule).
 */
export function riverProfile(d: number, width: number, bankSoft: number, beach: number, depth = 1.6): number {
  const x = Math.abs(d);
  const shelf = Math.min(0.35, depth * 0.25);
  const inner = width - Math.max(0, beach);
  // core → shelf: the deep channel shoals smoothly over half its own half-width (at least 1 m)
  const toShelf = smoothstep(inner - Math.max(1, inner * 0.5), inner, x);
  const body = depth + (shelf - depth) * toShelf;
  // shelf → dry bank: the soft bank
  const bank = Math.max(0.5, bankSoft);
  return body * (1 - smoothstep(width - bank * 0.3, width + bank, x));
}

/**
 * Noise-varied river half-width (C3) at arc length `s` (m) along the river: `base` × (1 ± `vary`), wandering with a
 * `wavelength` (m) and never below 35 % of `base`. Deterministic (noise.ts fbm only).
 */
export function riverWidth(s: number, base: number, vary: number, wavelength: number, seed: number): number {
  const n = fbm(s / Math.max(1, wavelength), seed * 0.137 + 0.5, seed, 3);
  return Math.max(base * 0.35, base * (1 + vary * n));
}

/** Terrace/step: quantises `h` to `step` with smooth risers (width fraction `soft` 0..1). */
export function terrace(h: number, step: number, soft: number): number {
  const q = h / step;
  const f = q - Math.floor(q);
  const s = smoothstep(1 - soft, 1, f);
  return (Math.floor(q) + s) * step;
}

/** Bridge deck height along a segment: parabolic arch from yEnd at the ends to yMid in the middle. */
export function archHeight(t: number, yEnd: number, yMid: number): number {
  const u = 1 - (2 * t - 1) * (2 * t - 1);
  return yEnd + (yMid - yEnd) * u;
}

/** Axis helper: distance to the segment (ax,az)-(bx,bz) + parameter t. */
export { distToSegment, Polyline, smoothPath } from './noise';
