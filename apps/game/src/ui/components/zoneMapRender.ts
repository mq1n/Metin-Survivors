// ZoneMap raster (UI core C14): a top-down map of a zone painted from the LIVE TerrainField, so it follows every zone
// rebuild without a re-bake. Relief shading comes from the 1 m height grid, ground colour from the splat paint maps
// (mean colour of each layer texture x the layer tint), liquids from the surface grid + liquid level (water depth, lava,
// ice, miasma), roads from the path layers of the paint, and objects from the layout (tree crowns, faceted rocks, tiled

// olive fields, grey-teal water, pale road lines, dark crown clusters, grey rock) made from our own data and noise.
//
// No DOM, no three.js: runs inside the ZoneMap worker (zoneMap.worker.ts) and on the main thread as a fallback.
// Deterministic: the same field + options give byte-identical pixels (integer-hash noise, no Math.random, no clock).
//
//   const raster = renderZoneMap(field, { res: 512, style: 'atlas', water: biome.water?.color });
//   raster.rgba            // Uint8ClampedArray res*res*4 (opaque)
//   raster.x0 / z0 / span  // world square: pixel (i, j) centre = (x0 + (i + .5) * span / res, z0 + (j + .5) * span / res)
//
// Orientation = the game camera: screen up = world -z ("north"), screen right = world +x.
import type { BiomePreset } from '../../data/schema';
import { createTerrainField, SURFACE, type TerrainField } from '../../world/terrainField';
import { PROP_DEFS } from '../../world/props';
import { hashInt } from '../../world/rng';
import { fbm, noise2 } from '../../world/noise';
import { TREE_DIMS } from '../../world/trees';
import type { TreeSpecies, WallKind } from '../../world/layoutTypes';

export type ZoneMapStyle = 'minimap' | 'atlas';

export interface ZoneMapRenderOpts {
  /** output size in px (square), 64..2048 */
  res: number;
  /** 'minimap' = crisp, no vignette (HUD) · 'atlas' = aged print with a vignette (zone select / world map) */
  style: ZoneMapStyle;
  /** half side (m) of the mapped square around the origin; default arenaRadius + 30 */
  extent?: number;
  /** biome water colour (#rrggbb, `biome.water.color`); default a grey teal */
  water?: string;
  /** draw trees / rocks / props / walls / bridges (default true) */
  objects?: boolean;
}

export interface ZoneMapRaster {
  res: number;
  /** world square covered by the raster (m) */
  x0: number;
  z0: number;
  span: number;
  /** res*res*4 RGBA, opaque */
  rgba: Uint8ClampedArray;
  /** FNV-1a 32 of the pixels (hex): equal hashes = byte-identical renders */
  hash: string;
  /** milliseconds: field-level precompute (0 when it was cached) and the per-render pass */
  ms: { pre: number; px: number };
}

// ------------------------------------------------------------------------------------------------- colour helpers

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

type Rgb = [number, number, number];

/** '#rrggbb' → linear RGB */
export function hexLin(hex: string): Rgb {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = v ? parseInt(v[1] as string, 16) : 0x808080;
  return [LIN[(n >> 16) & 255] as number, LIN[(n >> 8) & 255] as number, LIN[n & 255] as number];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale(a: Rgb, k: number): Rgb {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function smooth(e0: number, e1: number, x: number): number {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}







const TEX_MEAN: Record<string, string> = {
  tex_ash: '#413734',
  tex_basalt: '#3b3332',
  tex_cobble_dark: '#433932',
  tex_dirt_path: '#957447',
  tex_dry_grass: '#aa804c',
  tex_grass_a: '#508038',
  tex_grass_b: '#5d6f3b',
  tex_ice_blue: '#aac6e3',
  tex_lava_crust: '#6a361f',
  tex_meadow: '#64864e',
  tex_mud: '#624631',
  tex_ochre_dirt: '#b87946',
  tex_plaza_tile: '#a9977f',
  tex_rock_basalt_cols: '#383837',
  tex_rock_canyon: '#a8623d',
  tex_rock_frozen: '#7a818c',
  tex_rock_mossy: '#757b4c',
  tex_roof_tile: '#744533',
  tex_scorched: '#432e27',
  tex_snow_fresh: '#d4deed',
  tex_snow_packed: '#a4adbd',
  // Seori zone tiles (measured 2026-10-22 like the rest): the trail grit reads grey, the ice patches pale
  tex_seori_snow_a: '#dadfeb',
  tex_seori_ice: '#d5dfec',
  tex_seori_gravel_b: '#92969a',
  tex_seori_trail_b: '#8f9397',
  tex_seori_slate: '#9ea3ac',
  tex_seori_cliff: '#989fad',
  tex_stone_block_wall: '#7f7d76',
  tex_wood_plank: '#6a5644',
  tex_metin_obsidian: '#343034',
};

const TEX_GUESS: ReadonlyArray<readonly [RegExp, string]> = [
  [/lava|magma|ember/, '#7a3a26'],
  [/snow/, '#d4deed'],
  [/ice|frost|frozen/, '#7a92ad'],
  [/ash|scorch|char|basalt|obsidian|cinder/, '#3c3431'],
  [/sand|beach|desert|dune/, '#b89c70'],
  [/mud|bog|swamp/, '#624631'],
  [/dirt|path|road|ochre|earth|soil/, '#957447'],
  [/plaza|tile|cobble|pav|flag|brick/, '#9a8c78'],
  [/rock|cliff|canyon|stone|crag/, '#6f6f62'],
  [/moss|meadow|grass|field|turf|lawn/, '#557a3c'],
];

/** mean colour (#rrggbb) of a ground texture id (measured table, else a guess from the id) */
export function texColour(id: string): string {
  const known = TEX_MEAN[id];
  if (known) return known;
  for (const [re, c] of TEX_GUESS) if (re.test(id)) return c;
  return '#7a7464';
}

/** fine-detail strength of a layer (pixel grain), by texture family */
function texDetail(id: string): number {
  if (/snow|ice/.test(id)) return 0.04;
  if (/plaza|tile|cobble/.test(id)) return 0.07;
  if (/rock|cliff|canyon|basalt|stone/.test(id)) return 0.14;
  if (/grass|meadow|moss/.test(id)) return 0.12;
  return 0.09;
}

// --------------------------------------------------------------------------------------------- object palettes

/** crown colours (top-down): body, lit top */
const CROWN: Record<TreeSpecies, [string, string]> = {
  pine: ['#1a3020', '#2f4a2c'],
  broadleaf: ['#26431f', '#4a6a30'],
  autumn: ['#6e3a1a', '#b07a2c'],
  snowpine: ['#5a6a64', '#c9d4d8'],
  bare: ['#3e3428', '#6a5a46'],
  charred: ['#1e1918', '#3a302c'],
};

/** roof / top look per prop id (others: a neutral by height); `ember` marks a glowing top */
interface PropLook {
  c: string;
  ridge?: string;
  ember?: string;
  tiles?: boolean;
}
const PROP_LOOK: Record<string, PropLook> = {
  hall_tiled: { c: '#5a2620', ridge: '#c8b896', tiles: true },
  house_small: { c: '#6a3424', ridge: '#c0ae8c', tiles: true },
  pagoda_gate: { c: '#7a2416', ridge: '#c8a050' },
  giant_pagoda: { c: '#3e2a26', ridge: '#d0a650' },
  orc_tent: { c: '#7a6448', ridge: '#4a3a28' },
  yurt: { c: '#d0c6b2' },
  watchtower: { c: '#5c4230', ridge: '#8a6a48' },
  bonfire: { c: '#3a2a20', ember: '#ff8a30' },
  totem: { c: '#6a4a30' },
  weapon_rack: { c: '#5c4632' },
  ruined_shrine: { c: '#4c4642', ridge: '#8a8278', tiles: true },
  ruin_pillar: { c: '#8a8478' },
  broken_gate: { c: '#5e3a2e', ridge: '#9a8a70' },
  plague_brazier: { c: '#3a3430', ember: '#9ee04a' },
  lava_pillar: { c: '#8a4630', ember: '#ff7a30' },
  stone_gate: { c: '#8e6448', ridge: '#c09a70' },
  obelisk: { c: '#2a2628', ember: '#ff6a28' },
  brazier: { c: '#6a5030', ember: '#ff9040' },
  fire_brazier: { c: '#3a3430', ember: '#ff9040' },
  fire_altar: { c: '#5c3a30', ember: '#ff6a1a' },
  well: { c: '#8a8478' },
  haystack: { c: '#b89a56' },
  stele: { c: '#8e887c' },
  stone_lantern: { c: '#b0aa9c' },
  lamp_post: { c: '#e0b050' },
  banner_pole: { c: '#9a2a1a' },
  war_banner: { c: '#9a2a1a' },
  ice_crystal: { c: '#bfe2f2' },
  snow_shrine: { c: '#d8dee6', ridge: '#8e98a4' },
  frozen_tree: { c: '#b8ccd8' },
  lava_rock: { c: '#3a2c28', ember: '#ff5a14' },
  obsidian_spire: { c: '#221e24' },
  boulder: { c: '#8a8678' },
  wooden_fence: { c: '#7a6448' },
  barrel: { c: '#6a4a30' },
  crate: { c: '#7a6040' },
  urn: { c: '#6a5040' },
  signpost: { c: '#6a5038' },
};

const WALL: Record<WallKind, { c: string; w: number }> = {
  palisade: { c: '#5a4632', w: 1.0 },
  fence: { c: '#7e6a4c', w: 0.6 },
  stone_wall: { c: '#8e887a', w: 1.3 },
  ruin_wall: { c: '#7c766a', w: 1.2 },
  ice_wall: { c: '#bcd4e2', w: 1.4 },
};

const BRIDGE: Record<string, { deck: string; rail: string }> = {
  wood: { deck: '#7c5a3a', rail: '#3e2c1e' },
  rope: { deck: '#8a6c46', rail: '#4a3622' },
  stone: { deck: '#a0988a', rail: '#5c564c' },
};

// ----------------------------------------------------------------------------------------- field precompute (cached)

/** light towards the upper left of the screen (-x, -z), 40° above the horizon */
const LX = -0.5417;
const LY = 0.6428;
const LZ = -0.5417;

const RELIEF_Z = 3.2;

interface Pre {
  n: number;
  half: number;
  /** relief factor per height node (1 = flat ground) */
  shade: Float32Array;
  /** linear albedo per paint texel (3 floats): layer mix x blotches x cliff cracks */
  alb: Float32Array;
  /** pixel-grain amplitude per paint texel */
  det: Float32Array;
  pres: number;
  ptexel: number;
  /** lava crust / ice crack noise per height node (lava / ice zones) */
  liq: Float32Array | null;
  /** blurred lava mask per height node (0..1), lava zones only */
  glow: Float32Array | null;
  ms: number;
}

const preCache = new WeakMap<TerrainField, Pre>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface Lattice {
  v: Float32Array;
  /** samples per axis */
  m: number;
  /** metres between samples */
  step: number;
  half: number;
}

/** `fn` sampled every `step` metres over the field square (one sample beyond each edge) */
function lattice(half: number, step: number, fn: (x: number, z: number) => number): Lattice {
  const m = Math.ceil((half * 2) / step) + 2;
  const v = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) v[j * m + i] = fn(-half + i * step, -half + j * step);
  return { v, m, step, half };
}

function sampleLattice(l: Lattice, x: number, z: number): number {
  return bilin(l.v, l.m, (x + l.half) / l.step, (z + l.half) / l.step);
}

/** separable box blur (running sums), `passes` times; edge-clamped; returns a new array */
function boxBlur(src: Float32Array, n: number, r: number, passes: number): Float32Array {
  const a = src.slice();
  const b = new Float32Array(n * n);
  const w = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < n; j++) {
      const row = j * n;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + Math.min(n - 1, Math.max(0, k))] as number;
      for (let i = 0; i < n; i++) {
        b[row + i] = acc / w;
        acc += (a[row + Math.min(n - 1, i + r + 1)] as number) - (a[row + Math.max(0, i - r)] as number);
      }
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += b[Math.min(n - 1, Math.max(0, k)) * n + i] as number;
      for (let j = 0; j < n; j++) {
        a[j * n + i] = acc / w;
        acc += (b[Math.min(n - 1, j + r + 1) * n + i] as number) - (b[Math.max(0, j - r) * n + i] as number);
      }
    }
  }
  return a;
}

function precompute(field: TerrainField): Pre {
  const cached = preCache.get(field);
  if (cached) return cached;
  const t0 = now();
  const { n, cell, bed } = field.grid;
  const half = field.size / 2;
  const seed = hashInt(field.layout.zone.length * 7919 + (field.layout.zone.charCodeAt(0) | 0)) & 0xffff;

  // relief: hillshade (exaggerated normals) x cavity (height minus its blur: valleys darker, crests lighter)
  const shade = new Float32Array(n * n);
  const blurH = boxBlur(bed, n, 4, 2);
  const inv = RELIEF_Z / (2 * cell);
  for (let j = 0; j < n; j++) {
    const j0 = j > 0 ? j - 1 : j;
    const j1 = j < n - 1 ? j + 1 : j;
    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < n - 1 ? i + 1 : i;
      const k = j * n + i;
      const gx = ((bed[j * n + i1] as number) - (bed[j * n + i0] as number)) * inv;
      const gz = ((bed[j1 * n + i] as number) - (bed[j0 * n + i] as number)) * inv;
      const len = Math.sqrt(gx * gx + 1 + gz * gz);
      const lam = (-gx * LX + LY - gz * LZ) / len;
      const lit = lam > 0 ? lam / LY : 0;
      let s = 0.3 + 0.7 * lit;
      const cav = (bed[k] as number) - (blurH[k] as number);
      s *= 1 + Math.max(-0.34, Math.min(0.24, cav * 0.12));
      shade[k] = s;
    }
  }

  // albedo: paint weights x layer colours (linear); path layers lifted so roads read; blotches at 3 scales; cracks on
  // the cliff layer; per-texel detail strength for the pixel grain
  const paint = field.paint();
  const layers = field.layout.groundLayers;
  const L = Math.min(8, layers.length);
  const cols = new Float32Array(8 * 3);
  const dets = new Float32Array(8);
  for (let k = 0; k < L; k++) {
    const g = layers[k];
    if (!g) continue;
    let c = hexLin(texColour(g.tex));
    if (g.tint) {
      const t = hexLin(g.tint);
      c = [c[0] * t[0], c[1] * t[1], c[2] * t[2]];
    }
    if (/path|road|plaza/.test(g.tex)) c = scale(c, 1.16);
    cols[k * 3] = c[0];
    cols[k * 3 + 1] = c[1];
    cols[k * 3 + 2] = c[2];
    dets[k] = texDetail(g.tex);
  }
  const cliff = field.layout.cliffLayer;
  const pres = paint.res;
  const alb = new Float32Array(pres * pres * 3);
  const det = new Float32Array(pres * pres);
  const { w0, w1 } = paint;
  // the two broad blotch scales are sampled on coarse lattices (4 m / 2 m) and interpolated: same look, a third of the cost
  const big = lattice(half, 4, (x, z) => fbm(x / 34, z / 34, seed + 3, 2));
  const mid = lattice(half, 2, (x, z) => noise2(x / 7.5, z / 7.5, seed + 9));
  for (let j = 0; j < pres; j++) {
    const z = -half + (j + 0.5) * paint.texel;
    for (let i = 0; i < pres; i++) {
      const x = -half + (i + 0.5) * paint.texel;
      const o = (j * pres + i) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let d = 0;
      let wc = 0;
      for (let k = 0; k < L; k++) {
        const w = (k < 4 ? (w0[o + k] as number) : (w1[o + k - 4] as number)) / 255;
        if (w === 0) continue;
        r += w * (cols[k * 3] as number);
        g += w * (cols[k * 3 + 1] as number);
        b += w * (cols[k * 3 + 2] as number);
        d += w * (dets[k] as number);
        if (k === cliff) wc = w;
      }
      // soft tonal patches (34 m), clumps (7.5 m) and a 2.5 m mottle, like tiled terrain seen from far above
      const bg = sampleLattice(big, x, z);
      const md = sampleLattice(mid, x, z);
      const small = noise2(x / 2.5, z / 2.5, seed + 13);
      let lum = 1 + bg * 0.14 + md * 0.1 + small * 0.07;
      if (wc > 0.05) {
        // fissures and strata on rock faces
        const cr = 1 - Math.abs(noise2(x / 3.2, z / 3.2, seed + 21));
        const cr2 = cr * cr;
        const cr8 = cr2 * cr2 * cr2 * cr2;
        lum *= 1 - wc * (0.45 * cr8 + 0.12 * Math.max(0, md));
      }
      const warm = bg * 0.04;
      const a = (j * pres + i) * 3;
      alb[a] = r * lum * (1 + warm);
      alb[a + 1] = g * lum;
      alb[a + 2] = b * lum * (1 - warm);
      det[j * pres + i] = d;
    }
  }

  // liquids: crust / crack noise per node, and the lava light spill onto the banks
  let liq: Float32Array | null = null;
  let glow: Float32Array | null = null;
  const kind = field.layout.liquid?.kind;
  if (kind === 'lava' || kind === 'ice') {
    liq = new Float32Array(n * n);
    const surf = field.grid.surface;
    const want = kind === 'lava' ? SURFACE.LAVA : SURFACE.ICE;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (surf[k] !== want) continue;
        const x = -half + i * cell;
        const z = -half + j * cell;
        liq[k] = kind === 'lava' ? fbm(x / 6, z / 6, seed + 77, 2) : Math.abs(fbm(x / 9, z / 9, seed + 91, 2));
      }
    }
  }
  if (kind === 'lava') {
    const m = new Float32Array(n * n);
    const surf = field.grid.surface;
    for (let k = 0; k < n * n; k++) m[k] = surf[k] === SURFACE.LAVA ? 1 : 0;
    glow = boxBlur(m, n, 3, 3);
  }

  const pre: Pre = { n, half, shade, alb, det, pres, ptexel: paint.texel, liq, glow, ms: now() - t0 };
  preCache.set(field, pre);
  return pre;
}

// ------------------------------------------------------------------------------------------------- per-pixel pass

function bilin(arr: Float32Array, n: number, u: number, v: number): number {
  const max = n - 1;
  u = u < 0 ? 0 : u > max ? max : u;
  v = v < 0 ? 0 : v > max ? max : v;
  let i = Math.floor(u);
  let j = Math.floor(v);
  if (i >= max) i = max - 1;
  if (j >= max) j = max - 1;
  const fx = u - i;
  const fz = v - j;
  const o = j * n + i;
  const a = (arr[o] as number) + ((arr[o + 1] as number) - (arr[o] as number)) * fx;
  const b = (arr[o + n] as number) + ((arr[o + n + 1] as number) - (arr[o + n] as number)) * fx;
  return a + (b - a) * fz;
}

/** grain in [-1, 1) from the pixel index (stable across renders) */
function grain(i: number, j: number, s: number): number {
  return hashInt(Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ s) / 2147483648 - 1;
}

interface Canvas {
  res: number;
  x0: number;
  z0: number;
  /** metres per pixel */
  mpp: number;
  /** linear RGB, res*res*3 (already graded) */
  c: Float32Array;
  /** per-pixel position factor (outside-arena falloff x vignette) that objects take too */
  pf: Float32Array;
  /** saturation of the grade (object colours are graded with it once) */
  sat: number;
}

/** world → pixel (continuous) */
function px(cv: Canvas, x: number): number {
  return (x - cv.x0) / cv.mpp - 0.5;
}
function pz(cv: Canvas, z: number): number {
  return (z - cv.z0) / cv.mpp - 0.5;
}

/** print grade of a colour: saturation, then greens pulled towards olive (the map reads as an old print, not a lawn) */
function graded(cv: Canvas, col: Rgb): Rgb {
  const l = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
  const r = l + (col[0] - l) * cv.sat;
  const g = l + (col[1] - l) * cv.sat;
  const b = l + (col[2] - l) * cv.sat;
  const gr = g - r > 0 ? g - r : 0;
  return [r + gr * OLIVE_R, g - gr * OLIVE_G, b];
}

/** olive shift of green-dominant colours (fraction of g - r moved off green / onto red) */
const OLIVE_G = 0.2;
const OLIVE_R = 0.05;

/** blends `col * k * pf` over pixel o with coverage a */
function put(cv: Canvas, p: number, col: Rgb, k: number, a: number): void {
  const o = p * 3;
  const f = k * (cv.pf[p] as number);
  const c = cv.c;
  c[o] = (c[o] as number) + (col[0] * f - (c[o] as number)) * a;
  c[o + 1] = (c[o + 1] as number) + (col[1] * f - (c[o + 1] as number)) * a;
  c[o + 2] = (c[o + 2] as number) + (col[2] * f - (c[o + 2] as number)) * a;
}

/** darkens a soft disc (shadow), `k` = max darkening 0..1 */
function shadowDisc(cv: Canvas, x: number, z: number, r: number, k: number): void {
  const cx = px(cv, x);
  const cz = pz(cv, z);
  const rp = r / cv.mpp;
  const i0 = Math.max(0, Math.floor(cx - rp - 1));
  const i1 = Math.min(cv.res - 1, Math.ceil(cx + rp + 1));
  const j0 = Math.max(0, Math.floor(cz - rp - 1));
  const j1 = Math.min(cv.res - 1, Math.ceil(cz + rp + 1));
  const c = cv.c;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i - cx;
      const dz = j - cz;
      const d = Math.sqrt(dx * dx + dz * dz) / (rp + 0.5);
      if (d >= 1) continue;
      const q = 1 - d * d;
      const f = 1 - k * q * q;
      const o = (j * cv.res + i) * 3;
      c[o] = (c[o] as number) * f;
      c[o + 1] = (c[o + 1] as number) * f;
      c[o + 2] = (c[o + 2] as number) * f;
    }
  }
}

/** foliage dome: lit from the upper left, darker rim, lobed outline (`lumpy`), leafy speckle */
function dome(cv: Canvas, x: number, z: number, r: number, body: Rgb, top: Rgb, lumpy: number, seed: number): void {
  const cx = px(cv, x);
  const cz = pz(cv, z);
  const rr = Math.max(0.6, r / cv.mpp);
  const i0 = Math.max(0, Math.floor(cx - rr * 1.3 - 1));
  const i1 = Math.min(cv.res - 1, Math.ceil(cx + rr * 1.3 + 1));
  const j0 = Math.max(0, Math.floor(cz - rr * 1.3 - 1));
  const j1 = Math.min(cv.res - 1, Math.ceil(cz + rr * 1.3 + 1));
  const lobes = 5 + (seed & 3);
  const phase = ((seed >>> 2) & 63) * 0.13;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const u = (i - cx) / rr;
      const v = (j - cz) / rr;
      let d = Math.sqrt(u * u + v * v);
      if (d > 1.35) continue;
      if (lumpy > 0 && d > 0.001) {
        // lobed outline from a pseudo-angle (no trig per pixel)
        const s = Math.abs(u) + Math.abs(v);
        const pa = v >= 0 ? 1 - u / s : 3 + u / s;
        const lobe = Math.abs(((pa * lobes + phase) % 2) - 1);
        d *= 1 + lumpy * (lobe - 0.5);
      }
      const edge = rr * (1 - d);
      const a = edge >= 0.5 ? 1 : edge <= -0.5 ? 0 : edge + 0.5;
      if (a <= 0) continue;
      const dd = d < 1 ? d : 1;
      const h = Math.sqrt(1 - dd * dd);
      const lam = u * LX + v * LZ + h * LY;
      const t = lam > 0 ? (lam > 1 ? 1 : lam) : 0;
      const g = grain(i, j, seed);
      const k = (0.62 + 0.5 * t) * (0.8 + 0.2 * h) * (1 + 0.16 * g);
      const col: Rgb = [body[0] + (top[0] - body[0]) * t * t, body[1] + (top[1] - body[1]) * t * t, body[2] + (top[2] - body[2]) * t * t];
      put(cv, j * cv.res + i, col, k, a);
    }
  }
}

/**
 * Faceted polygon top (rocks, pagoda tiers): `K` outline vertices around (x, z) with radii (ex, ez) jittered by `jit`,
 * an inner flat top at `topK` of the outline; each outer facet is lit by its own outward-tilted normal.
 */
function facets(cv: Canvas, x: number, z: number, ex: number, ez: number, yaw: number, K: number, jit: number, topK: number, col: Rgb, seed: number): void {
  const cx = px(cv, x);
  const cz = pz(cv, z);
  const vx = new Float64Array(K);
  const vz = new Float64Array(K);
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  let rmax = 0;
  for (let k = 0; k < K; k++) {
    const hk = hashInt(seed * 31 + k * 977);
    const ang = ((k + (jit > 0 ? ((hk & 255) / 255 - 0.5) * 0.5 : 0)) / K) * Math.PI * 2;
    const rad = 1 - jit * ((hk >>> 8) & 255) / 255;
    const lx = Math.cos(ang) * ex * rad;
    const lz = Math.sin(ang) * ez * rad;
    vx[k] = (lx * cs + lz * sn) / cv.mpp;
    vz[k] = (-lx * sn + lz * cs) / cv.mpp;
    rmax = Math.max(rmax, Math.abs(vx[k] as number), Math.abs(vz[k] as number));
  }
  // vertex angles (screen) for the sector lookup
  const va = new Float64Array(K);
  for (let k = 0; k < K; k++) va[k] = Math.atan2(vz[k] as number, vx[k] as number);
  const order = Array.from({ length: K }, (_, k) => k).sort((a, b) => (va[a] as number) - (va[b] as number));
  const ox = order.map((k) => vx[k] as number);
  const oz = order.map((k) => vz[k] as number);
  const oa = order.map((k) => va[k] as number);
  // per-facet light
  const lit: number[] = [];
  for (let k = 0; k < K; k++) {
    const k2 = (k + 1) % K;
    const mx = ((ox[k] as number) + (ox[k2] as number)) / 2;
    const mz = ((oz[k] as number) + (oz[k2] as number)) / 2;
    const ml = Math.sqrt(mx * mx + mz * mz) || 1;
    const nx = (mx / ml) * 0.72;
    const nz = (mz / ml) * 0.72;
    const ny = 0.69;
    lit.push(0.5 + 0.75 * Math.max(0, nx * LX + ny * LY + nz * LZ));
  }
  const topLit = 0.5 + 0.75 * LY;
  const i0 = Math.max(0, Math.floor(cx - rmax - 1));
  const i1 = Math.min(cv.res - 1, Math.ceil(cx + rmax + 1));
  const j0 = Math.max(0, Math.floor(cz - rmax - 1));
  const j1 = Math.min(cv.res - 1, Math.ceil(cz + rmax + 1));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i - cx;
      const dz = j - cz;
      const a0 = Math.atan2(dz, dx);
      // sector: last vertex angle <= a0 (wrapping)
      let s = K - 1;
      for (let k = 0; k < K; k++) {
        if ((oa[k] as number) <= a0) s = k;
        else break;
      }
      const s2 = (s + 1) % K;
      const ax = ox[s] as number;
      const az = oz[s] as number;
      const bx = (ox[s2] as number) - ax;
      const bz = (oz[s2] as number) - az;
      const bl = Math.sqrt(bx * bx + bz * bz) || 1;
      // signed distance (px) to the outline edge, positive inside (vertices sorted by increasing atan2(z, x))
      const inside = (bx * (dz - az) - bz * (dx - ax)) / bl;
      const a = inside >= 0.5 ? 1 : inside <= -0.5 ? 0 : inside + 0.5;
      if (a <= 0) continue;
      // inner top: the same edge scaled by topK
      const onTop = bx * (dz - az * topK) - bz * (dx - ax * topK) > 0;
      let k = onTop ? topLit : (lit[s] as number);
      if (inside < 0.9) k *= 0.7;
      k *= 1 + 0.08 * grain(i, j, seed);
      put(cv, j * cv.res + i, col, k, a);
    }
  }
}

/** rotated rectangle roof / deck: lit and shaded halves along the ridge, tile rows, ridge cap, dark eave line */
function roof(cv: Canvas, x: number, z: number, w: number, d: number, yaw: number, col: Rgb, ridge: Rgb | null, tiles: boolean, eave: number): void {
  const cx = px(cv, x);
  const cz = pz(cv, z);
  const hw = w / 2 / cv.mpp;
  const hd = d / 2 / cv.mpp;
  const rr = Math.sqrt(hw * hw + hd * hd);
  const i0 = Math.max(0, Math.floor(cx - rr - 1));
  const i1 = Math.min(cv.res - 1, Math.ceil(cx + rr + 1));
  const j0 = Math.max(0, Math.floor(cz - rr - 1));
  const j1 = Math.min(cv.res - 1, Math.ceil(cz + rr + 1));
  // local axes as in props.ts: world = (x + lx*cos + lz*sin, z - lx*sin + lz*cos)
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  // ridge along local x; the lz > 0 half faces world (sn, cs): lit when that direction points towards the light
  const lightSide = sn * LX + cs * LZ > 0 ? 1 : -1;
  const rowPx = 0.62 / cv.mpp;
  const capPx = Math.max(0.55, 0.32 / cv.mpp);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i - cx;
      const dz = j - cz;
      const lx = dx * cs - dz * sn;
      const lz = dx * sn + dz * cs;
      const e = Math.min(hw - Math.abs(lx), hd - Math.abs(lz));
      const a = e >= 0.5 ? 1 : e <= -0.5 ? 0 : e + 0.5;
      if (a <= 0) continue;
      let k = 1;
      let c = col;
      if (ridge) {
        k = lz * lightSide > 0 ? 1.2 : 0.7;
        if (Math.abs(lz) < capPx) {
          c = ridge;
          k = 0.95;
        }
      }
      if (tiles && rowPx >= 1.2) {
        // tile courses run down the slope (perpendicular to the ridge)
        const t = (Math.abs(lz) / rowPx) % 1;
        k *= t < 0.22 ? 0.84 : 1;
      }
      if (e < eave) k *= 0.6;
      put(cv, j * cv.res + i, c, k, a);
    }
  }
}

/** additive glow disc (emissive tops: braziers, lava rocks) */
function glowDisc(cv: Canvas, x: number, z: number, r: number, col: Rgb, k: number): void {
  const cx = px(cv, x);
  const cz = pz(cv, z);
  const rp = Math.max(1.2, r / cv.mpp);
  const i0 = Math.max(0, Math.floor(cx - rp - 1));
  const i1 = Math.min(cv.res - 1, Math.ceil(cx + rp + 1));
  const j0 = Math.max(0, Math.floor(cz - rp - 1));
  const j1 = Math.min(cv.res - 1, Math.ceil(cz + rp + 1));
  const c = cv.c;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i - cx;
      const dz = j - cz;
      const d = Math.sqrt(dx * dx + dz * dz) / rp;
      if (d >= 1) continue;
      const f = k * (1 - d) * (1 - d);
      const o = (j * cv.res + i) * 3;
      c[o] = (c[o] as number) + col[0] * f;
      c[o + 1] = (c[o + 1] as number) + col[1] * f;
      c[o + 2] = (c[o + 2] as number) + col[2] * f;
    }
  }
}

function drawObjects(cv: Canvas, field: TerrainField): void {
  const L = field.layout;
  const ppm = 1 / cv.mpp;
  const sh = 0.55; // shadow offset per metre of height (sun 40°, cast towards +x +z = lower right)
  const minR = 0.4 * cv.mpp;
  const inView = (x: number, z: number, r: number): boolean => {
    const i = px(cv, x);
    const j = pz(cv, z);
    const rp = r * ppm + 2;
    return i > -rp && j > -rp && i < cv.res + rp && j < cv.res + rp;
  };
  const G = (hex: string): Rgb => graded(cv, hexLin(hex));

  // bridges (on the water, below everything else)
  for (const b of L.bridges) {
    const look = BRIDGE[b.kind] ?? (BRIDGE.wood as { deck: string; rail: string });
    const dx = b.x1 - b.x0;
    const dz = b.z1 - b.z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.5) continue;
    // roof() local x runs along world (cos, -sin) of its yaw
    const yaw = Math.atan2(-dz, dx);
    const mx = (b.x0 + b.x1) / 2;
    const mz = (b.z0 + b.z1) / 2;
    if (!inView(mx, mz, len)) continue;
    roof(cv, mx + 0.8, mz + 0.8, len, b.width + 1.2, yaw, scale(G('#1a1814'), 1), null, false, 0);
    roof(cv, mx, mz, len, b.width + 0.6, yaw, G(look.rail), null, false, 0);
    roof(cv, mx, mz, len - 0.4, b.width - 0.4, yaw, G(look.deck), null, b.kind !== 'stone', 0);
  }

  // shadows first (trees, rocks, props, walls), then tops
  for (const t of L.trees) {
    const dims = TREE_DIMS[t.species];
    const r = dims.crownRadius * t.scale;
    if (r < minR || !inView(t.x, t.z, r + dims.height * sh)) continue;
    const off = Math.min(dims.height * t.scale * sh * 0.45, r * 1.6);
    shadowDisc(cv, t.x + off * 0.7071, t.z + off * 0.7071, r * 1.1, 0.55);
  }
  for (const r of L.rocks) {
    if (r.kind === 'pebbles') continue;
    const rad = Math.max(r.sx, r.sz) * 0.5;
    if (rad < minR || !inView(r.x, r.z, rad * 2)) continue;
    const hgt = Math.max(0.3, r.sy - (r.sink ?? 0));
    const off = Math.min(hgt * sh * 0.5, rad * 1.2);
    shadowDisc(cv, r.x + off * 0.7071, r.z + off * 0.7071, rad, r.kind === 'outcrop' || r.kind === 'ledge' ? 0.42 : 0.36); // zones core A2: the squared 'ledge' blocks replace outcrops in some rims, same map shadow
  }
  for (const p of L.props) {
    const def = PROP_DEFS[p.id];
    if (!def) continue;
    const rad = def.radius * p.scale;
    if (rad < 0.5 || !inView(p.x, p.z, rad * 2)) continue;
    const off = Math.min(def.height * p.scale * sh * 0.35, rad * 1.4);
    shadowDisc(cv, p.x + off * 0.7071, p.z + off * 0.7071, rad * 0.95, 0.45);
  }
  for (const w of L.walls) {
    const dx = w.x1 - w.x0;
    const dz = w.z1 - w.z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      shadowDisc(cv, w.x0 + dx * t + w.height * 0.35, w.z0 + dz * t + w.height * 0.35, 1.3, 0.3);
    }
  }

  // rocks: faceted tops; boulders a pale weathered grey, outcrops take the rock material
  const rockCols = L.rockMaterials.map((id) => hexLin(texColour(id)));
  const pale = hexLin('#a8a293');
  const grey = hexLin('#7e7a6e');
  for (const r of L.rocks) {
    if (r.kind === 'pebbles') continue;
    const ex = r.sx * 0.5;
    const ez = r.sz * 0.5;
    if (Math.max(ex, ez) < minR || !inView(r.x, r.z, Math.max(ex, ez))) continue;
    const base = rockCols[r.mat] ?? grey;
    let col: Rgb;
    if (r.kind === 'crystal') col = hexLin('#8fc6da');
    else if (r.kind === 'boulder' || r.kind === 'slab') col = mix(base, pale, 0.4);
    else col = mix(base, grey, 0.35);
    const K = r.kind === 'basalt' ? 6 : r.kind === 'spire' ? 5 : 5 + (r.seed % 3);
    facets(cv, r.x, r.z, ex, ez, r.yaw, K, r.kind === 'basalt' ? 0.05 : 0.3, r.kind === 'slab' ? 0.75 : 0.42, graded(cv, col), r.seed);
  }

  // walls
  for (const w of L.walls) {
    const look = WALL[w.kind] ?? WALL.stone_wall;
    const dx = w.x1 - w.x0;
    const dz = w.z1 - w.z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.2 || !inView((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2, len)) continue;
    const yaw = Math.atan2(-dz, dx);
    roof(cv, (w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2, len + look.w * 0.5, Math.max(look.w, cv.mpp * 1.1), yaw, G(look.c), null, false, Math.max(0.3, look.w * 0.2 * ppm));
  }

  // props: footprint parts as roofs / tops
  for (const p of L.props) {
    const def = PROP_DEFS[p.id];
    if (!def) continue;
    const rad = def.radius * p.scale;
    if (rad * ppm < 0.7 || !inView(p.x, p.z, rad)) continue;
    const look = PROP_LOOK[p.id] ?? { c: def.height > 4 ? '#5e5048' : '#7a7062' };
    const col = G(look.c);
    const ridge = look.ridge ? G(look.ridge) : null;
    const cs = Math.cos(p.yaw);
    const sn = Math.sin(p.yaw);
    if (p.id === 'pagoda_gate' || p.id === 'stone_gate' || p.id === 'broken_gate') {
      // the roof beam between the pillars (the footprint is only the pillars)
      const span = (p.id === 'broken_gate' ? 7.2 : 9.6) * p.scale;
      roof(cv, p.x, p.z, span, 2.4 * p.scale, p.yaw, col, ridge, false, 0.5);
      continue;
    }
    if (p.id === 'giant_pagoda') {
      // tiered octagon roofs (lit facets), gold finial
      const r0 = 13.5 * p.scale * 1.15;
      for (let k = 0; k < 5; k++) {
        const rk = r0 * (1 - k * 0.18);
        facets(cv, p.x, p.z, rk, rk, p.yaw + 0.3927, 8, 0, 0.82, scale(col, k % 2 ? 1.35 : 1), p.seed + k);
      }
      facets(cv, p.x, p.z, r0 * 0.12, r0 * 0.12, p.yaw, 8, 0, 0.5, ridge ?? G('#d0a650'), p.seed + 9);
      continue;
    }
    for (const part of def.footprint) {
      if ('rect' in part) {
        const [lx, lz, w, d] = part.rect;
        const wx = p.x + (lx * cs + lz * sn) * p.scale;
        const wz = p.z + (-lx * sn + lz * cs) * p.scale;
        // eaves overhang the footprint
        roof(cv, wx, wz, (w + 1.4) * p.scale, (d + 1.4) * p.scale, p.yaw, col, ridge, look.tiles === true, Math.max(0.5, 0.45 * ppm));
      } else {
        const [lx, lz, r] = part.circle;
        const wx = p.x + (lx * cs + lz * sn) * p.scale;
        const wz = p.z + (-lx * sn + lz * cs) * p.scale;
        const rr = Math.max(r * p.scale * 1.15, cv.mpp * 0.7);
        if (p.id === 'yurt' || p.id === 'orc_tent' || p.id === 'fire_altar' || p.id === 'well' || p.id === 'haystack') facets(cv, wx, wz, rr, rr, p.yaw, p.id === 'well' ? 8 : 10, 0.04, p.id === 'well' ? 0.62 : 0.3, col, p.seed);
        else dome(cv, wx, wz, rr, scale(col, 0.85), scale(col, 1.2), 0, p.seed);
      }
    }
    if (look.ember) glowDisc(cv, p.x, p.z, Math.max(2.2, rad * 1.6), hexLin(look.ember), 0.5);
  }

  // tree crowns last (they overhang roads and walls): clustered lobes, north first so southern crowns overlap
  const order = L.trees.map((_, i) => i).sort((a, b) => (L.trees[a] as { z: number }).z - (L.trees[b] as { z: number }).z || a - b);
  for (const idx of order) {
    const t = L.trees[idx];
    if (!t) continue;
    const dims = TREE_DIMS[t.species];
    const r = dims.crownRadius * t.scale;
    if (r < minR || !inView(t.x, t.z, r)) continue;
    const [b0, t0] = CROWN[t.species];
    const v = 0.84 + 0.32 * ((t.seed & 255) / 255);
    const body = scale(G(b0), v);
    const top = scale(G(t0), v);
    if (t.species === 'pine' || t.species === 'snowpine') {
      dome(cv, t.x, t.z, r * 0.95, body, top, 0.34, t.seed);
      continue;
    }
    // 3-4 satellite clumps around a main crown
    const lobes = 3 + (t.seed & 1);
    for (let k = 0; k < lobes; k++) {
      const hk = hashInt(t.seed * 13 + k * 101);
      const ang = ((k + ((hk & 255) / 255) * 0.6) / lobes) * Math.PI * 2;
      const dd = r * (0.38 + 0.12 * (((hk >>> 8) & 255) / 255));
      dome(cv, t.x + Math.cos(ang) * dd, t.z + Math.sin(ang) * dd, r * 0.56, scale(body, 0.9), scale(top, 0.92), 0.18, hk);
    }
    dome(cv, t.x - r * 0.08, t.z - r * 0.08, r * 0.66, body, top, 0.16, t.seed);
  }
}

// --------------------------------------------------------------------------------------------------- render

function fnv1a(bytes: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  const u32 = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  for (let k = 0; k < u32.length; k++) {
    h ^= u32[k] as number;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface StyleGrade {
  /** saturation multiplier (linear) */
  sat: number;
  /** tone curve: out = gain * in^gamma (linear light), baked into the encode table */
  gain: number;
  gamma: number;
  /** per-channel print tint (atlas: warm paper) */
  tint: Rgb;
  /** darkening outside the play area (0..1 at 40 m beyond the rim) */
  out: number;
  /** vignette strength (atlas) */
  vig: number;
}

const GRADES: Record<ZoneMapStyle, StyleGrade> = {
  minimap: { sat: 0.7, gain: 1.0, gamma: 1.16, tint: [1, 1, 1], out: 0.5, vig: 0 },
  atlas: { sat: 0.64, gain: 0.97, gamma: 1.16, tint: [1.04, 1, 0.92], out: 0.6, vig: 0.5 },
};

const encCache = new Map<string, Uint8Array>();
/** linear 0..1 (4096 steps) → sRGB byte through the style's tone curve */
function encTable(g: StyleGrade): Uint8Array {
  const key = `${g.gain}|${g.gamma}`;
  let t = encCache.get(key);
  if (!t) {
    t = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) {
      const l = g.gain * Math.pow(i / 4095, g.gamma);
      const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
      t[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
    }
    encCache.set(key, t);
  }
  return t;
}

/** Paints the map of `field` (see the header). */
export function renderZoneMap(field: TerrainField, opts: ZoneMapRenderOpts): ZoneMapRaster {
  const res = Math.max(64, Math.min(2048, Math.round(opts.res)));
  const hadPre = preCache.has(field);
  const pre = precompute(field);
  const t0 = now();
  const grade = GRADES[opts.style] ?? GRADES.minimap;
  const extent = opts.extent ?? field.arenaRadius + 30;
  const span = extent * 2;
  const x0 = -extent;
  const z0 = -extent;
  const mpp = span / res;
  const cv: Canvas = { res, x0, z0, mpp, c: new Float32Array(res * res * 3), pf: new Float32Array(res * res), sat: grade.sat };
  const { n, half, shade, alb, det, pres, ptexel, liq, glow } = pre;
  const grid = field.grid;
  const surf = grid.surface;
  const inside = grid.inside;
  const bed = grid.bed;
  const liquid = field.layout.liquid;
  const level = liquid?.level ?? -1e9;
  const kind = liquid?.kind ?? null;

  // liquid palettes (linear)
  const wBase = hexLin(opts.water ?? '#4a6a66');
  const wGrey = hexLin('#4b5f5a');
  const wShallow = mix(mix(wBase, wGrey, 0.62), hexLin('#8a9a8c'), 0.25);
  const wDeep = mix(mix(wBase, wGrey, 0.5), hexLin('#1c2a2c'), 0.55);
  const wFoam = hexLin('#aeb9ae');
  const lavaEdge = hexLin('#7a1e06');
  const lavaMid = hexLin('#f05a0e');
  const lavaHot = hexLin('#ffc848');
  const lavaGlow = hexLin('#ff5a10');
  const iceThin = hexLin('#c6d6e0');
  const iceDeep = hexLin('#8ea8bc');
  const miasma = hexLin('#6e8a34');
  const sat = grade.sat;
  const vig = grade.vig;

  const c = cv.c;
  const pf = cv.pf;
  const gs = 0x2f6b; // grain seed
  const pmax = pres - 1;
  for (let j = 0; j < res; j++) {
    const z = z0 + (j + 0.5) * mpp;
    const gv = z + half; // height-grid coordinate (cell 1 m)
    let pv = (z + half) / ptexel - 0.5;
    pv = pv < 0 ? 0 : pv > pmax ? pmax : pv;
    let pj = Math.floor(pv);
    if (pj >= pmax) pj = pmax - 1;
    const fz = pv - pj;
    const vy = (j + 0.5) / res - 0.5;
    for (let i = 0; i < res; i++) {
      const x = x0 + (i + 0.5) * mpp;
      const gu = x + half;
      // albedo + detail strength (bilinear over paint texels)
      let pu = (x + half) / ptexel - 0.5;
      pu = pu < 0 ? 0 : pu > pmax ? pmax : pu;
      let pi = Math.floor(pu);
      if (pi >= pmax) pi = pmax - 1;
      const fx = pu - pi;
      const t00 = pj * pres + pi;
      const w00 = (1 - fx) * (1 - fz);
      const w10 = fx * (1 - fz);
      const w01 = (1 - fx) * fz;
      const w11 = fx * fz;
      const o00 = t00 * 3;
      const o01 = o00 + pres * 3;
      let r = (alb[o00] as number) * w00 + (alb[o00 + 3] as number) * w10 + (alb[o01] as number) * w01 + (alb[o01 + 3] as number) * w11;
      let g = (alb[o00 + 1] as number) * w00 + (alb[o00 + 4] as number) * w10 + (alb[o01 + 1] as number) * w01 + (alb[o01 + 4] as number) * w11;
      let b = (alb[o00 + 2] as number) * w00 + (alb[o00 + 5] as number) * w10 + (alb[o01 + 2] as number) * w01 + (alb[o01 + 5] as number) * w11;
      const dA = (det[t00] as number) * w00 + (det[t00 + 1] as number) * w10 + (det[t00 + pres] as number) * w01 + (det[t00 + pres + 1] as number) * w11;
      const s = bilin(shade, n, gu, gv) * (1 + dA * grain(i, j, gs));
      r *= s;
      g *= s;
      b *= s;

      // liquids / hazards (surface class from the nearest node, depth from the bed)
      let ni = (gu + 0.5) | 0;
      let nj = (gv + 0.5) | 0;
      ni = ni < 0 ? 0 : ni >= n ? n - 1 : ni;
      nj = nj < 0 ? 0 : nj >= n ? n - 1 : nj;
      const sc = surf[nj * n + ni] as number;
      if (kind !== null) {
        if (kind === 'water') {
          if (sc === SURFACE.SHALLOW || sc === SURFACE.DEEP || level - (bed[nj * n + ni] as number) > -0.3) {
            const depth = level - bilin(bed, n, gu, gv);
            if (depth > 0) {
              const t = smooth(0, 2.6, depth);
              let wr = wShallow[0] + (wDeep[0] - wShallow[0]) * t;
              let wg = wShallow[1] + (wDeep[1] - wShallow[1]) * t;
              let wb = wShallow[2] + (wDeep[2] - wShallow[2]) * t;
              // the bed shows through the first decimetres, a pale lap line at the bank
              const see = (1 - smooth(0, 0.7, depth)) * 0.45;
              wr += (r * 0.8 - wr) * see;
              wg += (g * 0.85 - wg) * see;
              wb += (b * 0.9 - wb) * see;
              const foam = depth < 0.2 ? (1 - depth / 0.2) * 0.5 : 0;
              wr += (wFoam[0] - wr) * foam;
              wg += (wFoam[1] - wg) * foam;
              wb += (wFoam[2] - wb) * foam;
              const ws = 0.92 + 0.08 * bilin(shade, n, gu, gv) + 0.025 * grain(i >> 1, j >> 1, gs + 7);
              r = wr * ws;
              g = wg * ws;
              b = wb * ws;
            }
          }
        } else if (kind === 'lava') {
          if (sc === SURFACE.LAVA) {
            const depth = level - bilin(bed, n, gu, gv);
            const crust = liq ? bilin(liq, n, gu, gv) : 0;
            let hot = smooth(0, 1.4, depth > 0 ? depth : 0) * 0.9 + crust * 0.4;
            hot = hot < 0 ? 0 : hot > 1 ? 1 : hot;
            const lo = hot < 0.5;
            const tt = lo ? hot * 2 : (hot - 0.5) * 2;
            const A = lo ? lavaEdge : lavaMid;
            const B = lo ? lavaMid : lavaHot;
            r = A[0] + (B[0] - A[0]) * tt;
            g = A[1] + (B[1] - A[1]) * tt;
            b = A[2] + (B[2] - A[2]) * tt;
          }
        } else if (sc === SURFACE.ICE) {
          const depth = level - bilin(bed, n, gu, gv);
          const t = smooth(0, 2.4, depth) * 0.8;
          const crack = liq ? bilin(liq, n, gu, gv) : 1;
          const k = (0.9 + 0.14 * bilin(shade, n, gu, gv)) * (crack < 0.035 ? 0.78 : 1) * (1 + 0.025 * grain(i, j, gs + 3));
          r = (iceThin[0] + (iceDeep[0] - iceThin[0]) * t) * k;
          g = (iceThin[1] + (iceDeep[1] - iceThin[1]) * t) * k;
          b = (iceThin[2] + (iceDeep[2] - iceThin[2]) * t) * k;
        }
      }
      if (sc === SURFACE.MIASMA) {
        r = r * 0.55 + miasma[0] * 0.45;
        g = g * 0.55 + miasma[1] * 0.45;
        b = b * 0.55 + miasma[2] * 0.45;
      }
      if (glow) {
        const gl = bilin(glow, n, gu, gv);
        if (gl > 0.002) {
          const k = sc === SURFACE.LAVA ? 0.25 * gl : 0.6 * gl;
          r += lavaGlow[0] * k;
          g += lavaGlow[1] * k;
          b += lavaGlow[2] * k;
        }
      }
      // grade: saturation + olive shift (as graded()), then the position factor (outside the play area darker + greyer;
      // atlas vignette)
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
      const gr = g - r > 0 ? g - r : 0;
      r += gr * OLIVE_R;
      g -= gr * OLIVE_G;
      let f = 1;
      const ins = bilin(inside, n, gu, gv);
      if (ins < 0) {
        const k = smooth(0, 40, -ins);
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r += (lum - r) * 0.4 * k;
        g += (lum - g) * 0.4 * k;
        b += (lum - b) * 0.4 * k;
        f = 1 - grade.out * k;
      }
      if (vig > 0) {
        const vx = (i + 0.5) / res - 0.5;
        f *= 1 - vig * smooth(0.3, 0.72, Math.sqrt(vx * vx + vy * vy));
      }
      const p = j * res + i;
      pf[p] = f;
      const o = p * 3;
      c[o] = r * f;
      c[o + 1] = g * f;
      c[o + 2] = b * f;
    }
  }

  if (opts.objects !== false) drawObjects(cv, field);

  // encode: print tint + tone curve table → sRGB bytes
  const enc = encTable(grade);
  const [tr, tg, tb] = grade.tint;
  const rgba = new Uint8ClampedArray(res * res * 4);
  for (let p = 0, o = 0, q = 0; p < res * res; p++, o += 3, q += 4) {
    const r = (c[o] as number) * tr;
    const g = (c[o + 1] as number) * tg;
    const b = (c[o + 2] as number) * tb;
    rgba[q] = enc[r <= 0 ? 0 : r >= 1 ? 4095 : (r * 4095 + 0.5) | 0] as number;
    rgba[q + 1] = enc[g <= 0 ? 0 : g >= 1 ? 4095 : (g * 4095 + 0.5) | 0] as number;
    rgba[q + 2] = enc[b <= 0 ? 0 : b >= 1 ? 4095 : (b * 4095 + 0.5) | 0] as number;
    rgba[q + 3] = 255;
  }

  return { res, x0, z0, span, rgba, hash: fnv1a(rgba), ms: { pre: hadPre ? 0 : pre.ms, px: now() - t0 } };
}

/** Raster pixel → world, for pins and hit tests. */
export function rasterToWorld(r: Pick<ZoneMapRaster, 'res' | 'x0' | 'z0' | 'span'>, i: number, j: number): { x: number; z: number } {
  return { x: r.x0 + (i / r.res) * r.span, z: r.z0 + (j / r.res) * r.span };
}

// ------------------------------------------------------------------------------------------- bake (worker + fallback)

/** A map request: the zone's biome preset (content), the scatter seed and the render options. */
export interface ZoneMapJob {
  id: number;
  biome: BiomePreset;
  seed: number;
  opts: ZoneMapRenderOpts;
}

export interface ZoneMapLandmark {
  id: string;
  kind: 'centre' | 'spawn' | 'poi' | 'boss';
  x: number;
  z: number;
  r: number;
}

/** A finished map: the raster + what the overlay needs from the field (so the main thread never bakes one). */
export interface ZoneMapResult extends ZoneMapRaster {
  zone: string;
  seed: number;
  style: ZoneMapStyle;
  arenaRadius: number;
  landmarks: ZoneMapLandmark[];
  /** ms: field bake (0 when memoised), paint maps (0 when cached), map precompute, pixel pass */
  timing: { bake: number; paint: number; pre: number; px: number };
}

export type ZoneMapReply = { id: number; ok: true; result: ZoneMapResult } | { id: number; ok: false; error: string };

/** Bakes (or reuses) the zone's field and paints its map. Runs in the ZoneMap worker; the main thread only as a fallback. */
export function bakeZoneMap(biome: BiomePreset, seed: number, opts: ZoneMapRenderOpts): ZoneMapResult {
  const t0 = now();
  const field = createTerrainField(biome, seed);
  const t1 = now();
  field.paint();
  const t2 = now();
  const r = renderZoneMap(field, opts);
  return {
    ...r,
    zone: biome.id,
    seed,
    style: opts.style,
    arenaRadius: field.arenaRadius,
    landmarks: field.landmarks.map((l) => ({ id: l.id, kind: l.kind, x: l.x, z: l.z, r: l.r })),
    timing: { bake: t1 - t0, paint: t2 - t1, pre: r.ms.pre, px: r.ms.px },
  };
}
