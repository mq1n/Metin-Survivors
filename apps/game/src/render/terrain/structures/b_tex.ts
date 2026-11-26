// Procedural fallback detail textures for the set-B structures (used when the Imagegen texture is absent).
// Tileable 8-bit RGBA, built from periodic value noise, cached per kind. The structure shader only uses them as a
// luminance/hue *breakup* (texel ÷ texture average), so absolute brightness here is irrelevant.
import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping, SRGBColorSpace, UnsignedByteType, RGBAFormat } from 'three';

export type ProceduralKind = 'wood' | 'bark' | 'stone' | 'cloth';

const cache = new Map<ProceduralKind, DataTexture>();

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrap(i: number, p: number): number {
  return ((i % p) + p) % p;
}

/** value noise in [0,1], periodic with `px` × `py` lattice cells over the unit square */
function pnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px;
  const y = v * py;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const xa = wrap(x0, px);
  const xb = wrap(x0 + 1, px);
  const ya = wrap(y0, py);
  const yb = wrap(y0 + 1, py);
  const a = hash(xa, ya, seed);
  const b = hash(xb, ya, seed);
  const c = hash(xa, yb, seed);
  const d = hash(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u: number, v: number, px: number, py: number, seed: number, oct = 4): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * pnoise(u, v, px << o, py << o, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return s / norm;
}

type Sampler = (u: number, v: number) => [number, number, number];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function wood(): Sampler {
  const knots = [
    { u: 0.27, v: 0.31, r: 0.9 },
    { u: 0.78, v: 0.72, r: 0.7 },
  ];
  return (u, v) => {
    const warp = fbm(u, v, 3, 2, 3, 3);
    const rings = 0.5 + 0.5 * Math.sin((7 * u + warp * 2.4) * Math.PI * 2);
    const streak = pnoise(u, v, 48, 3, 11);
    const fine = pnoise(u, v, 160, 6, 23);
    let lum = 0.52 + 0.2 * (streak - 0.5) * 2 + 0.16 * (rings - 0.5) * 2 + 0.07 * (fine - 0.5) * 2;
    for (const k of knots) {
      let du = Math.abs(u - k.u);
      du = Math.min(du, 1 - du);
      let dv = Math.abs(v - k.v);
      dv = Math.min(dv, 1 - dv);
      const d = Math.hypot(du * 1.0, dv * 0.45) / (0.05 * k.r);
      if (d < 3) lum += (0.18 * Math.sin(d * 5.5) - 0.28 * Math.exp(-d * d * 0.55)) * (1 - d / 3);
    }
    const crack = pnoise(u, v, 6, 40, 31);
    if (crack > 0.93) lum -= 0.22;
    lum = clamp01(lum);
    return [lum * 1.0, lum * 0.82 + 0.02, lum * 0.62 + 0.03];
  };
}

function bark(): Sampler {
  return (u, v) => {
    const warp = fbm(u, v, 4, 3, 5, 3);
    const ridge = 1 - Math.abs(pnoise(u + warp * 0.12, v, 14, 3, 7) * 2 - 1);
    const lump = fbm(u, v, 8, 6, 9, 3);
    const lum = clamp01(0.3 + 0.38 * ridge * ridge + 0.3 * lump);
    return [lum, lum * 0.9, lum * 0.78];
  };
}

function stone(): Sampler {
  return (u, v) => {
    const blot = fbm(u, v, 5, 5, 13, 4);
    const grit = pnoise(u, v, 96, 96, 29);
    const vein = Math.abs(fbm(u, v, 7, 7, 19, 3) * 2 - 1);
    let lum = 0.42 + 0.45 * (blot - 0.5) + 0.08 * (grit - 0.5);
    if (vein < 0.06) lum -= 0.2;
    lum = clamp01(lum);
    return [lum, lum, lum * 0.97];
  };
}

function cloth(): Sampler {
  return (u, v) => {
    const weave = 0.5 + 0.5 * Math.sin(u * 96 * Math.PI * 2) * Math.sin(v * 96 * Math.PI * 2);
    const blot = fbm(u, v, 4, 4, 41, 4);
    const fibreA = pnoise(u, v, 192, 10, 43);
    const fibreB = pnoise(u, v, 10, 192, 47);
    const speck = hash(Math.floor(u * 256), Math.floor(v * 256), 53);
    const lum = clamp01(0.5 + 0.34 * (blot - 0.5) + 0.07 * (weave - 0.5) + 0.07 * (fibreA - 0.5) + 0.07 * (fibreB - 0.5) + 0.05 * (speck - 0.5));
    return [lum, lum * 0.95, lum * 0.88];
  };
}

const SAMPLERS: Record<ProceduralKind, () => Sampler> = { wood, bark, stone, cloth };
const SIZES: Record<ProceduralKind, number> = { wood: 256, bark: 256, stone: 256, cloth: 256 };

/** Shared tileable detail texture (never dispose: shared across models). */
export function proceduralTexture(kind: ProceduralKind): DataTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const n = SIZES[kind];
  const sample = SAMPLERS[kind]();
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [r, g, b] = sample((i + 0.5) / n, (j + 0.5) / n);
      const o = (j * n + i) * 4;
      data[o] = Math.round(clamp01(r) * 255);
      data[o + 1] = Math.round(clamp01(g) * 255);
      data[o + 2] = Math.round(clamp01(b) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set(kind, tex);
  return tex;
}
