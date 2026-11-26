// Shared painting helpers for the PropsElem models: world-space texture sampling for faceted hulls, heat ramps for ember glow,
// crack fields, 2-D signed distance motifs (runes, panels) with baked relief lighting, tile-mask loading for rune strips.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clamp01, smoothstep } from '../../../../core/math.ts';
import { repoRoot } from '../../../../core/export/manifest.ts';
import type { Mat, Texel } from '../../mesh.ts';
import { mixc, mulc } from '../../mats.ts';
import { type Rgb, type Tex, hasTex, sampleTex } from '../../texlib.ts';

export const sstep = smoothstep;
export const c01 = clamp01;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** world-space dominant-axis projection of a tileable texture (k = repeats per metre); flat faces get one consistent projection */
export function triSample(t: Texel, T: Tex, k: number, ox = 0, oy = 0): Rgb {
  const ax = Math.abs(t.nf[0]), ay = Math.abs(t.nf[1]), az = Math.abs(t.nf[2]);
  const fp = t.mpt * k;
  if (ay >= ax && ay >= az) return sampleTex(T, t.p[0] * k + ox, t.p[2] * k + oy, fp);
  if (ax >= az) return sampleTex(T, t.p[2] * k + ox, -t.p[1] * k + oy, fp);
  return sampleTex(T, t.p[0] * k + ox, -t.p[1] * k + oy, fp);
}

/** deterministic 0..1 per facet (constant over a flat face); `salt` decorrelates several uses */
export function facetHash(t: Texel, salt = 0): number {
  const q = (x: number): number => Math.round(x * 22);
  return t.noise.hash3(q(t.nf[0]) + salt * 17, q(t.nf[1]) - salt * 31, q(t.nf[2]) + salt * 7);
}

export type Stop = [number, Rgb];

/** piecewise linear colour ramp over x in [0,1] (stops sorted by position) */
export function ramp(stops: readonly Stop[], x: number): Rgb {
  if (x <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!;
    if (x <= p1) {
      const [p0, c0] = stops[i - 1]!;
      return mixc(c0, c1, (x - p0) / (p1 - p0 || 1));
    }
  }
  return stops[stops.length - 1]![1];
}

const EMBER_STOPS: Stop[] = [
  [0, [0, 0, 0]],
  [0.12, [0.1, 0.01, 0.003]],
  [0.35, [0.5, 0.06, 0.01]],
  [0.6, [1.0, 0.2, 0.025]],
  [0.82, [1.0, 0.42, 0.06]],
  [1, [1.0, 0.75, 0.28]],
];

/** molten colour for heat 0..1 (linear RGB, can exceed nothing: peak is 1.0) */
export const ember = (heat: number): Rgb => ramp(EMBER_STOPS, clamp01(heat));

/** one-slot cache keyed by texel position so shade() and emit() share a computation */
export function memo1<T>(fn: (t: Texel) => T): (t: Texel) => T {
  let px = NaN, py = NaN, pz = NaN, val: T | undefined;
  return (t) => {
    if (val !== undefined && t.p[0] === px && t.p[1] === py && t.p[2] === pz) return val;
    px = t.p[0]; py = t.p[1]; pz = t.p[2];
    val = fn(t);
    return val;
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// cracks

export interface CrackOpts {
  /** cells per metre */
  scale: number;
  /** anisotropy: scale multipliers per axis (y < 1 = tall cells -> mostly vertical cracks) */
  stretch?: [number, number, number];
  /** half width of the hot core (m) */
  width: number;
  /** half width of the soft glow / scorch halo (m) */
  halo?: number;
  /** domain warp strength in cells (organic wander) */
  warp?: number;
  /** 0..1: fraction of crack network kept (breaks the net into segments) */
  keep?: number;
  seed?: number;
}

export interface CrackHit {
  /** 1 on the crack centre, 0 outside */
  core: number;
  /** wider soft falloff */
  halo: number;
}

/** 3-D Voronoi crack network painted onto any surface (continuous across edges and parts) */
export function cracks(t: Texel, o: CrackOpts): CrackHit {
  const s = o.scale;
  const [sx, sy, sz] = o.stretch ?? [1, 1, 1];
  const so = (o.seed ?? 0) * 13.7;
  const wp = o.warp ?? 0.35;
  let x = t.p[0] * s * sx, y = t.p[1] * s * sy, z = t.p[2] * s * sz;
  if (wp > 0) {
    x += wp * t.noise.noise(t.p[0] * s * 0.9 + so, t.p[1] * s * 0.9, t.p[2] * s * 0.9);
    y += wp * t.noise.noise(t.p[0] * s * 0.9, t.p[1] * s * 0.9 + so, t.p[2] * s * 0.9 + 3.1);
    z += wp * t.noise.noise(t.p[0] * s * 0.9 + 5.3, t.p[1] * s * 0.9, t.p[2] * s * 0.9 + so);
  }
  const v = t.noise.voronoi(x + so, y, z, 0.95);
  const e = v.f2 - v.f1; // ~ 2 x distance (cells) to the bisector
  let w = o.width * s * 2;
  const vary = 0.45 + 1.1 * (0.5 + 0.5 * t.noise.noise(t.p[0] * 2.3 + so, t.p[1] * 2.3, t.p[2] * 2.3));
  w *= vary;
  let keep = 1;
  if (o.keep !== undefined && o.keep < 1) {
    // smooth position noise: crack segments fade in and out along their length instead of whole cells flipping
    const kn = 0.5 + 0.5 * t.noise.fbm(t.p[0] * s * 0.32 + so, t.p[1] * s * 0.32 + 4.1, t.p[2] * s * 0.32 - so, { octaves: 2 });
    keep = smoothstep(1 - o.keep - 0.12, 1 - o.keep + 0.12, kn);
  }
  const hw = (o.halo ?? o.width * 4) * s * 2;
  return { core: (1 - smoothstep(w * 0.45, w, e)) * keep, halo: (1 - smoothstep(0, hw, e)) * keep };
}

/** thin meandering crack / vein lines = zero level set of a noise field (continuous curves, no polygon net); `keep` 0..1 breaks them up */
export function veins(t: Texel, scale: number, widthM: number, seed = 0, keep = 0.6): number {
  const so = seed * 11.3;
  const n = t.noise.fbm(t.p[0] * scale + so, t.p[1] * scale * 1.15 - so, t.p[2] * scale + 2.7, { octaves: 2 });
  const w = widthM * scale * 1.5;
  const brk = 0.5 + 0.5 * t.noise.noise(t.p[0] * scale * 0.55 + 9.1, t.p[1] * scale * 0.55 - so, t.p[2] * scale * 0.55);
  return (1 - smoothstep(w * 0.4, w, Math.abs(n))) * smoothstep(1 - keep - 0.1, 1 - keep + 0.1, brk);
}

const LIGHT: [number, number, number] = (() => {
  const l = Math.hypot(-0.45, 0.8, 0.4);
  return [-0.45 / l, 0.8 / l, 0.4 / l];
})();

/** baked micro relief: shading factor from the tangential gradient of a noise height field lit from the upper left (1 = flat) */
export function noiseBump(t: Texel, freq: number, amp: number, oct = 3, seed = 0): number {
  const e = 0.22 / freq;
  const f = (x: number, y: number, z: number): number => t.noise.fbm(x * freq + seed * 5.1, y * freq - seed * 2.3, z * freq + seed * 1.7, { octaves: oct });
  const [x, y, z] = t.p;
  const h0 = f(x, y, z);
  const gx = (f(x + e, y, z) - h0) / e, gy = (f(x, y + e, z) - h0) / e, gz = (f(x, y, z + e) - h0) / e;
  const n = t.n;
  const gn = gx * n[0] + gy * n[1] + gz * n[2];
  const tx = gx - n[0] * gn, ty = gy - n[1] * gn, tz = gz - n[2] * gn;
  return 1 - (amp / freq) * (tx * LIGHT[0] + ty * LIGHT[1] + tz * LIGHT[2]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2-D signed distance helpers (metres) for painted motifs

export const sdBox = (x: number, y: number, hx: number, hy: number): number => {
  const dx = Math.abs(x) - hx, dy = Math.abs(y) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};
export const sdSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
};
export const sdCircle = (x: number, y: number, r: number): number => Math.hypot(x, y) - r;

type Seg = [number, number, number, number];
const glyphCache = new Map<number, Seg[]>();

/** pseudo rune: a stem plus branches on a 3x5 anchor grid in a unit cell (-0.5..0.5); distance in cell units */
export function runeSdf(x: number, y: number, seed: number): number {
  let segs = glyphCache.get(seed);
  if (!segs) {
    let s = (seed * 2654435761) >>> 0 || 1;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const gx = [-0.24, 0, 0.24], gy = [0.4, 0.2, 0, -0.2, -0.4];
    segs = [];
    const kind = rnd();
    if (kind < 0.7) segs.push([0, 0.42, 0, -0.42]);
    else {
      segs.push([-0.2, 0.42, -0.2, -0.42]);
      segs.push([0.2, 0.42, 0.2, -0.42]);
    }
    const nb = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nb; i++) {
      const ax = gx[Math.floor(rnd() * 3)]!, ay = gy[Math.floor(rnd() * 5)]!;
      let bx = gx[Math.floor(rnd() * 3)]!, by = ay + (rnd() < 0.5 ? -0.2 : rnd() < 0.5 ? 0 : 0.2);
      if (bx === ax && by === ay) bx = ax === 0 ? 0.24 : 0;
      by = Math.max(-0.42, Math.min(0.42, by));
      segs.push([ax, ay, bx, by]);
    }
    glyphCache.set(seed, segs);
  }
  let d = 1e9;
  for (const [ax, ay, bx, by] of segs) d = Math.min(d, sdSeg(x, y, ax, ay, bx, by));
  return d;
}

/** baked relief shading factor from a height field h(x,y) in 0..1 (light from the upper left) */
export function relief(h: (x: number, y: number) => number, x: number, y: number, e: number, k = 2.2): number {
  const g = h(x + e, y - e) - h(x - e, y + e);
  return 1 + k * g;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// non-tiling masks (rune strips etc.), decoded at native size

export interface Mask {
  w: number;
  h: number;
  data: Float32Array;
}
const maskCache = new Map<string, Mask | null>();

export function loadMask(id: string): Mask | null {
  const hit = maskCache.get(id);
  if (hit !== undefined) return hit;
  const mf = join(repoRoot(), 'apps', 'game', 'public', 'assets', 'manifest', 'textures.json');
  let out: Mask | null = null;
  if (hasTex(id)) {
    const entry = (JSON.parse(readFileSync(mf, 'utf8')) as Record<string, { url: string }>)[id];
    const file = entry ? join(repoRoot(), 'apps', 'game', 'public', entry.url) : '';
    if (file && existsSync(file)) {
      const info = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
      const [w, h] = info.stdout.trim().split(',').map(Number);
      if (w && h) {
        const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: w * h + 1024 });
        if (r.status === 0 && r.stdout.length >= w * h) {
          const raw = r.stdout as unknown as Uint8Array;
          const data = new Float32Array(w * h);
          for (let i = 0; i < w * h; i++) data[i] = raw[i]! / 255;
          out = { w, h, data };
        }
      }
    }
  }
  maskCache.set(id, out);
  return out;
}

/** bilinear sample; u,v in 0..1 over the image (v down); outside = 0 */
export function sampleMask(m: Mask, u: number, v: number): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const fx = u * m.w - 0.5, fy = v * m.h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const px = (x: number, y: number): number => m.data[Math.min(m.h - 1, Math.max(0, y)) * m.w + Math.min(m.w - 1, Math.max(0, x))]!;
  const a = px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx;
  const b = px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// glow material: base painting + heat field -> albedo (charred around, dark inside) and emission

export interface Glow {
  /** 0..1 molten heat (drives emission colour) */
  heat: number;
  /** 0..1 scorch / soot around the hot area (darkens + reddens the albedo) */
  char: number;
}

export interface GlowMatOpts {
  /** emission gain on top of the ember ramp */
  gain?: number;
  /** faint emissive spill on the cool stone next to hot zones (0..1) */
  spill?: number;
  /** scorch colour multiplier */
  scorch?: Rgb;
  /** how strongly the baked AO darkens this material (0 = fully self lit) */
  ao?: number;
}

export function glowMat(name: string, base: (t: Texel) => Rgb, glow: (t: Texel) => Glow, o: GlowMatOpts = {}): Mat {
  const g = memo1(glow);
  const scorch = o.scorch ?? [0.09, 0.035, 0.025];
  const gain = o.gain ?? 1;
  const spill = o.spill ?? 0.1;
  return {
    name,
    ...(o.ao !== undefined ? { ao: o.ao } : {}),
    shade(t) {
      const gl = g(t);
      let c = base(t);
      if (gl.char > 0) c = mixc(c, mulc(scorch, 0.7 + 0.6 * t.ao), clamp01(gl.char) * 0.85);
      if (gl.heat > 0) c = mixc(c, [0.2, 0.035, 0.01], smoothstep(0.05, 0.5, gl.heat));
      return c;
    },
    emit(t) {
      const gl = g(t);
      const h = gl.heat + spill * gl.char * 0.4;
      if (h < 0.004) return null;
      return mulc(ember(h), gain);
    },
  };
}
