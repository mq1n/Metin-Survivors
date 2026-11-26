// Weapon paint kit: hand-painted looking materials evaluated per texel in the canonical weapon frame. Imagegen tiles (steel streaks, gold
// scrollwork, grain, leather wrap, dragon silk, jade, bone) provide the micro structure and are recoloured through each weapon's
// palette; procedural layers add mirror streaks, temper lines, ink + highlight creases, engraved runes and gem glow. Everything falls
// back to noise when a tile source is missing.
import { clamp01, mix, smoothstep } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import type { Noise } from '../../core/noise.ts';
import { type Rgb, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { PaintSample, Painted } from './bake.ts';
import { type TileId, lum, tile } from './tiles.ts';
import { Z } from './zones.ts';

export interface Pal {
  steel: Rgb; steelDark: Rgb; steelLight: Rgb; edge: Rgb;
  gold: Rgb; goldDark: Rgb; goldLight: Rgb;
  iron: Rgb; ironLight: Rgb;
  wood: Rgb; woodDark: Rgb;
  wrap: Rgb; wrapDark: Rgb; wrapAccent: Rgb;
  silk: Rgb; silkDark: Rgb; silkTrim: Rgb;
  gem: Rgb; gemGlow: Rgb;
  jade: Rgb; bone: Rgb; lacquer: Rgb;
  rune: Rgb;
  fur: Rgb;
}

/** hex strings (sRGB) -> palette; unspecified entries fall back to neutral steel/gold/leather defaults */
export function makePal(h: Partial<Record<keyof Pal, string>>): Pal {
  const d: Record<keyof Pal, string> = {
    steel: '#74808e', steelDark: '#1f2836', steelLight: '#cfdbe8', edge: '#f2f7fb',
    gold: '#b98a2c', goldDark: '#4e300a', goldLight: '#ffd978',
    iron: '#3b3d44', ironLight: '#7d838d',
    wood: '#5b3520', woodDark: '#2a160c',
    wrap: '#4a2c20', wrapDark: '#1d0f0b', wrapAccent: '#b3292b',
    silk: '#b3222a', silkDark: '#5e0f18', silkTrim: '#e8bf5a',
    gem: '#3fd0c0', gemGlow: '#8ffff0',
    jade: '#4fae86', bone: '#e6d9bd', lacquer: '#8f1b1e',
    rune: '#7fe9ff',
    fur: '#d8d4c8',
  };
  const out = {} as Pal;
  for (const k of Object.keys(d) as (keyof Pal)[]) out[k] = rgb(h[k] ?? d[k]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// small helpers

export const lerp3 = (a: Rgb, b: Rgb, t: number): Rgb => mixRgb(a, b, clamp01(t));
export const scale3 = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
export const add3 = (a: Rgb, b: Rgb, k = 1): Rgb => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** three-stop ramp: 0 -> dark, 0.5 -> mid, 1 -> light */
export function ramp(dark: Rgb, mid: Rgb, light: Rgb, v: number): Rgb {
  const t = clamp01(v);
  return t < 0.5 ? mixRgb(dark, mid, t * 2) : mixRgb(mid, light, (t - 0.5) * 2);
}
export const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
export const fract = (x: number): number => x - Math.floor(x);
const band = (u: number, c: number, w: number): number => 1 - smoothstep(0, w, Math.abs(fract(u) - c));

/** wave / scale ("seigaiha") motif: returns stroke intensity 0..1 for overlapping ring rows */
export function seigaiha(u: number, v: number, cell: number, strokes = 3, width = 0.09): number {
  const x = u / cell, y = v / (cell * 0.5);
  const row = Math.floor(y);
  const fx = fract(x + (row & 1 ? 0.5 : 0)) - 0.5;
  const fy = y - row;
  const d0 = Math.hypot(fx, fy * 0.5);
  const fx2 = fract(x + (row & 1 ? 0 : 0.5)) - 0.5;
  const d1 = Math.hypot(fx2, (fy - 1) * 0.5);
  let best = 0;
  for (const d of [d0, d1]) {
    for (let k = 1; k <= strokes; k++) {
      const r = (k / (strokes + 0.6)) * 0.62;
      best = Math.max(best, 1 - smoothstep(0, width, Math.abs(d - r)));
    }
  }
  return best;
}

/** pseudo-script glyph: a hashed set of strokes inside a unit cell; returns mask 0..1 (u,v in 0..1) */
export function glyph(id: number, u: number, v: number, thick = 0.1): number {
  let m = 0;
  const node = (i: number): [number, number] => [0.2 + 0.3 * (i % 3), 0.12 + 0.19 * Math.floor(i / 3)];
  const segs = 3 + Math.floor(hash1(id * 3.1) * 3);
  for (let k = 0; k < segs; k++) {
    const a = Math.floor(hash1(id * 7.7 + k * 13.3) * 15), b = Math.floor(hash1(id * 5.3 + k * 29.1) * 15);
    if (a === b) continue;
    const [ax, ay] = node(a), [bx, by] = node(b);
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = clamp01(((u - ax) * dx + (v - ay) * dy) / l2);
    const d = Math.hypot(u - (ax + dx * t), v - (ay + dy * t));
    m = Math.max(m, 1 - smoothstep(thick * 0.6, thick, d));
  }
  if (hash1(id * 11.9) > 0.5) m = Math.max(m, 1 - smoothstep(thick * 0.6, thick, Math.abs(u - 0.5)) * (v > 0.1 && v < 0.9 ? 1 : 0));
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// tile sampling

export type TileMap = 'yz' | 'tri' | 'cyl';

/** normalised luminance (0..1, mean 0.5) of a tile at the sample point, or null when the tile source is missing */
export function tileValue(id: TileId, sm: PaintSample, map: TileMap, tileM: number, cylRadius = 0.02): number | null {
  const t = tile(id);
  if (!t) return null;
  const { p, n, px } = sm;
  const lod = t.lodFor(tileM, px);
  const sample = (u: number, v: number): number => lum(t.sample(u, v, lod));
  let l: number;
  if (map === 'yz') {
    l = sample(p[1] / tileM, p[2] / tileM);
  } else if (map === 'cyl') {
    const circ = 2 * Math.PI * cylRadius, reps = Math.max(1, Math.round(circ / tileM));
    const ang = Math.atan2(p[2], p[0]) / (Math.PI * 2);
    l = sample(ang * reps, p[1] / (circ / reps));
  } else {
    const wx = Math.abs(n[0]) ** 4, wy = Math.abs(n[1]) ** 4, wz = Math.abs(n[2]) ** 4;
    const ws = wx + wy + wz || 1;
    l = 0;
    if (wx > 0.01) l += (wx / ws) * sample(p[1] / tileM, p[2] / tileM);
    if (wy > 0.01) l += (wy / ws) * sample(p[2] / tileM, p[0] / tileM);
    if (wz > 0.01) l += (wz / ws) * sample(p[1] / tileM, p[0] / tileM);
  }
  return clamp01(0.5 + (l - t.mean) / (t.std * 3));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// edge painting: hand-painted highlight along convex creases, ink along concave ones

export function edgeLines(sm: PaintSample, c: Rgb, hi: Rgb, ink: Rgb, k: { hi?: number; ink?: number; hiW?: number; inkW?: number } = {}): Rgb {
  const h = (1 - smoothstep(0.0001, k.hiW ?? 0.0009, sm.cvx)) * (k.hi ?? 0.55);
  const d = (1 - smoothstep(0.0002, k.inkW ?? 0.0012, sm.ccv)) * (k.ink ?? 0.65);
  return lerp3(lerp3(c, hi, h), ink, d);
}

const LIGHT: Vec3 = (() => {
  const l = Math.hypot(0.35, 0.75, 0.55);
  return [0.35 / l, 0.75 / l, 0.55 / l];
})();
/** painted top-left lighting cue, 0..1 */
export const lambert = (n: Vec3): number => clamp01((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) * 0.6 + 0.45);

// ---------------------------------------------------------------------------------------------------------------------------------
// materials

export interface SteelLocal {
  /** 0..1 along the blade */
  t: number;
  /** -1 (spine / -Z edge) .. +1 (edge side) across the blade */
  s: number;
  /** half width (m) at this station */
  w: number;
  /** +1 on the +X face, -1 on the -X face */
  side: number;
}

export interface SteelOpts {
  /** temper line (hamon) on the edge side */
  hamon?: boolean;
  /** subtle etched wave pattern */
  etch?: number;
  /** wear 0..1: scratches, edge chips and dull patches */
  wear?: number;
  /** blade tint multiplier (0..1.2) */
  tint?: Rgb;
  /** rune row inside the fuller: glow colour is pal.rune */
  runes?: { t0: number; t1: number; pitch: number; width: number };
  /** gold inlay row (decor lines) along the flats */
  inlay?: { s: number; w: number };
  /** polish 0..1: how much the flats mirror the environment */
  polish?: number;
  /** seed offset for per-weapon variation */
  seed?: number;
}

export function steelFlat(sm: PaintSample, pal: Pal, L: SteelLocal, o: SteelOpts = {}): Painted {
  const { p, noise: N, ao } = sm;
  const seed = o.seed ?? 0;
  const pol = o.polish ?? 0.8;
  const tv = tileValue('steel', sm, 'yz', 0.3);
  const micro = tv !== null ? (tv - 0.5) * 0.7 : 0.06 * (N.noise(p[0] * 150 + seed, p[2] * 420, p[1] * 5) * 0.5 + N.noise(p[0] * 90, p[2] * 900 + 3.1, p[1] * 11) * 0.5) + 0.08 * N.fbm(p[0] * 8, p[1] * 18, p[2] * 8, { octaves: 3 });
  // mirror streaks running along the blade (a bright band on the edge side, a soft one near the spine) with a slow drift along the length
  const x = L.s + 0.2 * L.t * L.side;
  const amp = 0.55 + 0.45 * N.noise(L.t * 4 + seed, 1.7, L.side);
  const diag = 0.3 * band(L.t * 3.2 + L.s * 0.4 * L.side + (seed % 7) * 0.31, 0.5, 0.1);
  const glint = Math.max(amp * (1 - smoothstep(0, 0.2, Math.abs(x - 0.42))), 0.55 * amp * (1 - smoothstep(0, 0.34, Math.abs(x + 0.28))), diag) * pol;
  let v = 0.68 + 0.1 * (L.s * 0.5 + 0.5) + micro * 0.8 + 0.26 * glint;
  v -= 0.16 * (1 - smoothstep(0, 0.12, L.t)); // tarnish toward the guard
  const wearAmt = o.wear ?? 0;
  const scratch = smoothstep(0.82, 0.97, Math.abs(N.noise(p[0] * 40, p[1] * 90, p[2] * 700 + 7))) * wearAmt;
  v -= 0.25 * scratch;
  let c = ramp(pal.steelDark, pal.steel, pal.steelLight, v);
  if (o.tint) c = [c[0] * o.tint[0], c[1] * o.tint[1], c[2] * o.tint[2]];
  if (o.hamon) {
    const wob = N.noise(p[1] * 38, 0.5, seed) * 0.07 + N.noise(p[1] * 110, 1.5, seed) * 0.03;
    const line = L.s - (0.38 + wob);
    const mist = smoothstep(-0.05, 0.02, line) * (1 - smoothstep(0.2, 0.55, line));
    c = lerp3(c, pal.steelLight, 0.5 * mist);
    c = lerp3(c, pal.edge, 0.35 * (1 - smoothstep(0, 0.035, Math.abs(line))));
    c = lerp3(c, scale3(pal.steelDark, 1.4), 0.25 * (1 - smoothstep(-0.25, 0.0, line)));
  }
  if (o.etch) {
    const e = Math.sin((p[1] + p[2] * 0.7) * 160 + N.noise(p[1] * 9, p[2] * 30, 5) * 5) * 0.5 + 0.5;
    c = lerp3(c, scale3(c, 0.74), o.etch * smoothstep(0.55, 1, e));
  }
  if (o.inlay) {
    const d = Math.abs(L.s - o.inlay.s) * L.w;
    const m = 1 - smoothstep(o.inlay.w * 0.6, o.inlay.w, d);
    if (m > 0) c = lerp3(c, ramp(pal.goldDark, pal.gold, pal.goldLight, 0.65 + 0.4 * (tv ?? 0.5) - 0.2), m);
  }
  c = edgeLines(sm, c, pal.edge, scale3(pal.steelDark, 0.4), { hi: 0.8, ink: 0.7 });
  c = scale3(c, 0.8 + 0.2 * ao);
  return { albedo: c };
}

/** polished bevel / edge: bright, hard rim line toward the edge, nicks */
export function steelEdge(sm: PaintSample, pal: Pal, L: SteelLocal, o: SteelOpts = {}): Painted {
  const { p, noise: N, ao } = sm;
  const tv = tileValue('steel', sm, 'yz', 0.3);
  const brush = tv !== null ? (tv - 0.5) * 0.6 : N.noise(p[1] * 6 + (o.seed ?? 0), p[0] * 300, p[2] * 300) * 0.12;
  const edgeDist = 1 - Math.abs(L.s);
  const wear = o.wear ?? 0;
  const nick = smoothstep(0.78, 0.95, N.noise(p[1] * 70, 4.4, (o.seed ?? 0) + 2)) * wear;
  // grind facet: darker next to the flat, bright toward the edge
  const v = 0.3 + 0.3 * smoothstep(0.5, 0.0, edgeDist) + brush - 0.3 * nick;
  let c = ramp(scale3(pal.steel, 0.6), pal.steel, pal.steelLight, v);
  if (o.tint) c = [c[0] * o.tint[0], c[1] * o.tint[1], c[2] * o.tint[2]];
  c = edgeLines(sm, c, pal.edge, scale3(pal.steelDark, 0.5), { hi: 0.9, ink: 0.4, hiW: 0.0012 });
  return { albedo: scale3(c, 0.88 + 0.12 * ao) };
}

/** recessed groove: darker, gradient into the floor; optional glowing rune row with halo */
export function steelFuller(sm: PaintSample, pal: Pal, L: SteelLocal, o: SteelOpts = {}): Painted {
  const { p, noise: N, ao } = sm;
  const tv = tileValue('steel', sm, 'yz', 0.3);
  const brush = tv !== null ? (tv - 0.5) * 0.5 : N.noise(p[0] * 120, p[2] * 500, p[1] * 4) * 0.16;
  const dim = o.runes ? 0.5 : 1; // runed fullers are dark so the glow reads
  let c = ramp(scale3(pal.steelDark, 0.55 * dim), scale3(pal.steelDark, 0.95 * dim), scale3(pal.steel, 0.8 * dim), 0.3 + brush + 0.3 * L.t + 0.18 * (L.s * 0.5 + 0.5));
  if (o.tint) c = [c[0] * o.tint[0], c[1] * o.tint[1], c[2] * o.tint[2]];
  c = edgeLines(sm, c, pal.steelLight, scale3(pal.steelDark, 0.3), { hi: 0.6, ink: 0.8, inkW: 0.002 });
  c = scale3(c, 0.7 + 0.3 * ao);
  let emissive: Rgb | undefined;
  if (o.runes && L.t > o.runes.t0 && L.t < o.runes.t1) {
    const r = o.runes;
    const sample = (dt: number, ds: number): number => {
      const tt = L.t + dt, cell = Math.floor((tt - r.t0) / r.pitch);
      const cu = fract((tt - r.t0) / r.pitch);
      const cv = 0.5 + (L.s + ds) * (L.w / r.width) * 0.5;
      return cv > 0.02 && cv < 0.98 ? glyph(cell + (o.seed ?? 0) * 7, cv, cu, 0.07) : 0;
    };
    const m = sample(0, 0);
    const halo = (sample(0.006, 0) + sample(-0.006, 0) + sample(0, 0.18) + sample(0, -0.18)) * 0.25;
    const g = Math.max(m, halo * 0.45);
    if (g > 0.01) {
      emissive = scale3(lerp3(pal.rune, pal.edge, m * 0.35), g * 1.5);
      c = lerp3(c, lerp3(pal.rune, pal.edge, 0.4), Math.min(1, g * 0.95));
    }
  }
  return { albedo: c, ...(emissive ? { emissive } : {}) };
}

export interface GoldOpts {
  /** engraved wave scroll strength 0..1 (procedural fallback only) */
  engrave?: number;
  /** scroll cell size (m) */
  cell?: number;
  wear?: number;
  seed?: number;
  /** tile span (m): the scrollwork scale */
  tileM?: number;
}

export function gold(sm: PaintSample, pal: Pal, o: GoldOpts = {}): Painted {
  const { p, n, noise: N, ao } = sm;
  const tv = tileValue('gold', sm, 'tri', o.tileM ?? 0.07);
  let t: number;
  if (tv !== null) {
    t = 0.08 + 0.45 * lambert(n) + 0.9 * (tv - 0.5);
  } else {
    const brush = N.noise(p[0] * 60 + (o.seed ?? 0), p[1] * 60, p[2] * 60) * 0.5 + N.noise(p[0] * 220, p[1] * 220, p[2] * 220) * 0.25;
    t = 0.18 + 0.6 * lambert(n) + 0.14 * brush + 0.06 * N.fbm(p[0] * 15, p[1] * 15, p[2] * 15);
  }
  let c = ramp(pal.goldDark, pal.gold, pal.goldLight, t);
  if (o.engrave && tv === null) {
    const dom = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? [2, 1] : Math.abs(n[1]) > Math.abs(n[2]) ? [0, 2] : [0, 1];
    const m = seigaiha(p[dom[0]!]! + (o.seed ?? 0) * 0.01, p[dom[1]!]!, o.cell ?? 0.014, 3, 0.1);
    c = lerp3(c, scale3(pal.goldDark, 0.7), o.engrave * 0.75 * m);
  }
  const worn = smoothstep(0.6, 0.9, N.fbm(p[0] * 25, p[1] * 25, p[2] * 25, { octaves: 3 })) * (o.wear ?? 0);
  c = lerp3(c, pal.goldLight, 0.25 * worn);
  c = edgeLines(sm, c, pal.goldLight, scale3(pal.goldDark, 0.4), { hi: 0.8, ink: 0.7 });
  return { albedo: scale3(c, 0.62 + 0.38 * ao) };
}

export function ironDark(sm: PaintSample, pal: Pal, o: { seed?: number; wear?: number } = {}): Painted {
  const { p, n, noise: N, ao } = sm;
  void o;
  const tv = tileValue('iron_dark', sm, 'tri', 0.12);
  const pit = tv !== null ? (tv - 0.5) * 0.9 : (N.noise(p[0] * 120, p[1] * 120, p[2] * 120) * 0.5 + N.fbm(p[0] * 24, p[1] * 24, p[2] * 24, { octaves: 3 }) * 0.5) * 0.4;
  const t = 0.22 + 0.5 * lambert(n) + pit * 0.6;
  let c = ramp(scale3(pal.iron, 0.5), pal.iron, pal.ironLight, t);
  c = edgeLines(sm, c, pal.ironLight, scale3(pal.iron, 0.3), { hi: 0.8, ink: 0.7 });
  return { albedo: scale3(c, 0.55 + 0.45 * ao) };
}

export function wood(sm: PaintSample, pal: Pal, o: { lacquer?: boolean; seed?: number; radius?: number } = {}): Painted {
  const { p, noise: N, ao, n } = sm;
  const tv = tileValue('wood', sm, 'tri', 0.18);
  const grain = tv !== null ? (tv - 0.5) * 0.9 : N.noise(p[0] * 90 + (o.seed ?? 0), p[1] * 6, p[2] * 90) * 0.4;
  const t = 0.3 + 0.3 * lambert(n) + 0.5 * grain;
  let c = ramp(pal.woodDark, pal.wood, scale3(pal.wood, 1.7), t);
  if (o.lacquer) c = ramp(scale3(pal.lacquer, 0.25), pal.lacquer, scale3(pal.lacquer, 1.8), 0.1 + 0.6 * lambert(n) + 0.5 * grain);
  c = edgeLines(sm, c, o.lacquer ? scale3(pal.lacquer, 2.4) : scale3(pal.wood, 1.9), scale3(pal.woodDark, 0.5), { hi: 0.5, ink: 0.6 });
  return { albedo: scale3(c, 0.6 + 0.4 * ao) };
}

export interface WrapOpts {
  /** helix pitch along y (m per crossing) for the procedural fallback */
  pitch?: number;
  radius: number;
  diamond?: boolean;
  seed?: number;
  /** accent colour knots every few wraps */
  accent?: boolean;
}

export function wrap(sm: PaintSample, pal: Pal, o: WrapOpts): Painted {
  const { p, noise: N, ao, n } = sm;
  const tv = tileValue('leather', sm, 'cyl', 0.06, o.radius);
  let c: Rgb;
  if (tv !== null) {
    c = ramp(pal.wrapDark, pal.wrap, scale3(pal.wrap, 1.8), 0.15 + 0.7 * tv + 0.12 * lambert(n));
  } else {
    const ang = Math.atan2(p[2], p[0]);
    const pitch = o.pitch ?? 0.012;
    const s1 = Math.abs(Math.sin(Math.PI * (p[1] / pitch + (ang / (Math.PI * 2)) * 3))), s2 = Math.abs(Math.sin(Math.PI * (p[1] / pitch - (ang / (Math.PI * 2)) * 3)));
    const ridge = smoothstep(0.0, 0.55, o.diamond ? Math.min(s1, s2) : s1);
    c = ramp(pal.wrapDark, pal.wrap, scale3(pal.wrap, 1.7), 0.18 + 0.5 * ridge + 0.14 * N.noise(p[0] * 300, p[1] * 300, p[2] * 300) * 0.5 + 0.14 * lambert(n));
  }
  if (o.accent) {
    const cell = Math.floor(p[1] / 0.036);
    if (hash1(cell + (o.seed ?? 0)) > 0.7) c = lerp3(c, pal.wrapAccent, 0.45);
  }
  return { albedo: scale3(c, 0.5 + 0.5 * ao) };
}

export function silk(sm: PaintSample, pal: Pal, o: { stripe?: number; pattern?: number; seed?: number } = {}): Painted {
  const { p, noise: N, ao, n } = sm;
  const tv = tileValue('silk', sm, 'tri', 0.05);
  const fold = N.fbm(p[0] * 20, p[1] * 14, p[2] * 20, { octaves: 2 });
  let c = ramp(pal.silkDark, pal.silk, scale3(pal.silk, 1.5), 0.34 + 0.3 * lambert(n) + 0.18 * fold + (tv !== null ? 0.8 * (tv - 0.5) * (o.pattern ?? 0.8) : 0));
  c = edgeLines(sm, c, scale3(pal.silk, 1.8), scale3(pal.silkDark, 0.5), { hi: 0.4, ink: 0.5 });
  return { albedo: scale3(c, 1.15 * (0.72 + 0.28 * ao)) };
}

export function gem(sm: PaintSample, pal: Pal, o: { glow?: number } = {}): Painted {
  const { n, p } = sm;
  const facet = lambert(n);
  const k = 0.15 + 0.85 * facet + 0.1 * Math.sin(p[0] * 300 + p[1] * 200 + p[2] * 100);
  let c = ramp(scale3(pal.gem, 0.3), pal.gem, pal.gemGlow, k);
  c = edgeLines(sm, c, pal.gemGlow, scale3(pal.gem, 0.3), { hi: 0.8, ink: 0.5 });
  const g = o.glow ?? 0.9;
  return { albedo: c, emissive: scale3(lerp3(pal.gem, pal.gemGlow, clamp01(k - 0.2)), g) };
}

export function jade(sm: PaintSample, pal: Pal): Painted {
  const { p, n, noise: N, ao } = sm;
  const tv = tileValue('jade', sm, 'tri', 0.08);
  const cloud = tv !== null ? (tv - 0.5) * 1.1 : N.fbm(p[0] * 40, p[1] * 40, p[2] * 40, { octaves: 3 }) * 0.6;
  let c = ramp(scale3(pal.jade, 0.4), pal.jade, scale3(pal.jade, 1.6), 0.28 + 0.4 * cloud + 0.4 * lambert(n));
  c = edgeLines(sm, c, scale3(pal.jade, 2), scale3(pal.jade, 0.25), { hi: 0.5, ink: 0.5 });
  return { albedo: scale3(c, 0.6 + 0.4 * ao) };
}

export function bone(sm: PaintSample, pal: Pal): Painted {
  const { p, noise: N, ao, n } = sm;
  const tv = tileValue('bone', sm, 'tri', 0.1);
  const grain = tv !== null ? (tv - 0.5) * 0.9 : N.fbm(p[0] * 20, p[1] * 20, p[2] * 20, { octaves: 3 }) * 0.4;
  let c = ramp(scale3(pal.bone, 0.4), pal.bone, scale3(pal.bone, 1.2), 0.3 + 0.4 * lambert(n) + 0.4 * grain);
  c = edgeLines(sm, c, scale3(pal.bone, 1.3), scale3(pal.bone, 0.3), { hi: 0.5, ink: 0.55 });
  return { albedo: scale3(c, 0.6 + 0.4 * ao) };
}

export function lacquer(sm: PaintSample, pal: Pal, o: { seed?: number } = {}): Painted {
  return wood(sm, pal, { lacquer: true, seed: o.seed });
}

export function furTuft(sm: PaintSample, pal: Pal): Painted {
  const { p, noise: N, ao } = sm;
  const hair = N.noise(p[0] * 220, p[1] * 40, p[2] * 220);
  const c = ramp(scale3(pal.fur, 0.4), pal.fur, scale3(pal.fur, 1.15), 0.55 + 0.35 * hair);
  return { albedo: scale3(c, 0.55 + 0.45 * ao) };
}

/** convenience: dispatch non-blade zones with default settings */
export function genericZone(sm: PaintSample, pal: Pal, o: { goldEngrave?: number; wrapRadius?: number; wrapDiamond?: boolean; seed?: number; woodLacquer?: boolean; goldWear?: number; goldTileM?: number } = {}): Painted {
  switch (sm.zone) {
    case Z.gold:
    case Z.trim:
      return gold(sm, pal, { engrave: o.goldEngrave ?? 0.5, seed: o.seed, wear: o.goldWear, tileM: o.goldTileM });
    case Z.iron:
      return ironDark(sm, pal);
    case Z.wood:
      return wood(sm, pal, { lacquer: o.woodLacquer, seed: o.seed });
    case Z.wrap:
      return wrap(sm, pal, { radius: o.wrapRadius ?? 0.018, diamond: o.wrapDiamond ?? true, seed: o.seed, accent: true });
    case Z.silk:
      return silk(sm, pal, { pattern: 0.6 });
    case Z.gem:
      return gem(sm, pal);
    case Z.jade:
      return jade(sm, pal);
    case Z.bone:
      return bone(sm, pal);
    case Z.lacquer:
      return lacquer(sm, pal, { seed: o.seed });
    case Z.fur:
      return furTuft(sm, pal);
    default:
      return { albedo: pal.iron };
  }
}

export type { Vec3, Noise };
export { mix };
