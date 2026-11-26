// 3-D noise toolkit: gradient noise, fbm, ridged, voronoi/worley. Seeded; no globals.
import { Rng } from './rng.ts';

export interface Voronoi {
  /** distance to nearest feature point */
  f1: number;
  /** distance to second nearest */
  f2: number;
  /** stable random id (0..1) of the nearest cell */
  id: number;
  /** nearest feature point */
  cx: number;
  cy: number;
  cz: number;
}

export interface FbmOpts {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
}

export class Noise {
  private perm = new Uint8Array(512);
  private seed: number;

  constructor(seed: number | string = 1) {
    const rng = new Rng(seed);
    this.seed = Math.floor(rng.next() * 0x7fffffff);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  /** integer hash -> [0,1) */
  hash3(x: number, y: number, z: number): number {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + this.seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  /** improved Perlin noise, range ~[-1,1] */
  noise(x: number, y: number, z: number): number {
    const perm = this.perm;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = perm[xi]! + yi, AA = perm[A]! + zi, AB = perm[A + 1]! + zi;
    const B = perm[xi + 1]! + yi, BA = perm[B]! + zi, BB = perm[B + 1]! + zi;
    const l0 = grad(perm[AA]!, x, y, z), l1 = grad(perm[BA]!, x - 1, y, z);
    const l2 = grad(perm[AB]!, x, y - 1, z), l3 = grad(perm[BB]!, x - 1, y - 1, z);
    const l4 = grad(perm[AA + 1]!, x, y, z - 1), l5 = grad(perm[BA + 1]!, x - 1, y, z - 1);
    const l6 = grad(perm[AB + 1]!, x, y - 1, z - 1), l7 = grad(perm[BB + 1]!, x - 1, y - 1, z - 1);
    const a = l0 + u * (l1 - l0), b = l2 + u * (l3 - l2), c = l4 + u * (l5 - l4), d = l6 + u * (l7 - l6);
    const e = a + v * (b - a), f = c + v * (d - c);
    return e + w * (f - e);
  }

  /** fractal Brownian motion, normalised to ~[-1,1] */
  fbm(x: number, y: number, z: number, o: FbmOpts = {}): number {
    const oct = o.octaves ?? 4, lac = o.lacunarity ?? 2, gain = o.gain ?? 0.5;
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise(x * f + i * 17.3, y * f + i * 9.1, z * f + i * 5.7);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  /** ridged multifractal, range ~[0,1] (sharp creases at 0 crossings of the base noise) */
  ridged(x: number, y: number, z: number, o: FbmOpts = {}): number {
    const oct = o.octaves ?? 4, lac = o.lacunarity ?? 2, gain = o.gain ?? 0.5;
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(this.noise(x * f + i * 13.7, y * f + i * 7.3, z * f + i * 3.1));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  /** 3-D worley / voronoi: nearest two feature distances in cell units */
  voronoi(x: number, y: number, z: number, jitter = 1): Voronoi {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    let f1 = 1e9, f2 = 1e9, id = 0, cx = 0, cy = 0, cz = 0;
    for (let k = -1; k <= 1; k++) {
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const ix = X + i, iy = Y + j, iz = Z + k;
          const px = ix + 0.5 + (this.hash3(ix, iy, iz) - 0.5) * jitter;
          const py = iy + 0.5 + (this.hash3(ix + 101, iy + 37, iz + 11) - 0.5) * jitter;
          const pz = iz + 0.5 + (this.hash3(ix + 53, iy + 211, iz + 89) - 0.5) * jitter;
          const dx = px - x, dy = py - y, dz = pz - z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = this.hash3(ix + 7, iy + 13, iz + 29);
            cx = px; cy = py; cz = pz;
          } else if (d < f2) f2 = d;
        }
      }
    }
    return { f1, f2, id, cx, cy, cz };
  }
}

function grad(h: number, x: number, y: number, z: number): number {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}
