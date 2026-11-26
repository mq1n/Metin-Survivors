// Shared tileable noise atlas for the fluid and sky shaders (one 512² RGBA8 texture, process lifetime, never disposed):
//   R,G  ripple slope (dH/dx, dH/dy) of a water-wavelet height field, 0.5 = flat
//   B    smooth fbm 0..1 (foam / cloud shape / domain warps)
//   A    warped cellular edge distance 0..1 (0 on the cell borders: cracks, crust plates, caustics, cloud puffs)
// Generated once on the CPU with periodic gradient noise so that every channel wraps seamlessly.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

export const ATLAS_SIZE = 512;

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Periodic Perlin noise lattice: `cycles` cells per tile, value in about [-1, 1]. */
class Lattice {
  private readonly gx: Float32Array;
  private readonly gy: Float32Array;
  constructor(
    readonly cycles: number,
    seed: number,
  ) {
    this.gx = new Float32Array(cycles * cycles);
    this.gy = new Float32Array(cycles * cycles);
    for (let j = 0; j < cycles; j++) {
      for (let i = 0; i < cycles; i++) {
        const a = hash2(i, j, seed) * Math.PI * 2;
        this.gx[j * cycles + i] = Math.cos(a);
        this.gy[j * cycles + i] = Math.sin(a);
      }
    }
  }

  /** `u`,`v` in tile units (any real; periodic with period 1) */
  at(u: number, v: number): number {
    const c = this.cycles;
    const x = (u - Math.floor(u)) * c;
    const y = (v - Math.floor(v)) * c;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const x1 = ix + 1 === c ? 0 : ix + 1;
    const y1 = iy + 1 === c ? 0 : iy + 1;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const i00 = iy * c + ix;
    const i10 = iy * c + x1;
    const i01 = y1 * c + ix;
    const i11 = y1 * c + x1;
    const n00 = this.gx[i00]! * fx + this.gy[i00]! * fy;
    const n10 = this.gx[i10]! * (fx - 1) + this.gy[i10]! * fy;
    const n01 = this.gx[i01]! * fx + this.gy[i01]! * (fy - 1);
    const n11 = this.gx[i11]! * (fx - 1) + this.gy[i11]! * (fy - 1);
    const a = n00 + (n10 - n00) * sx;
    const b = n01 + (n11 - n01) * sx;
    return (a + (b - a) * sy) * 1.41;
  }
}

let cached: DataTexture | null = null;

export function getNoiseAtlas(): DataTexture {
  if (cached) return cached;
  const N = ATLAS_SIZE;
  const inv = 1 / N;

  // wavelet height: soft fbm + ridged crests, 4 octaves from 6 cycles per tile
  const wave = [new Lattice(6, 11), new Lattice(12, 12), new Lattice(24, 13), new Lattice(48, 14)];
  const height = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      const v = y * inv;
      const a = wave[0]!.at(u, v);
      const b = wave[1]!.at(u, v);
      const c = wave[2]!.at(u, v);
      const d = wave[3]!.at(u, v);
      const soft = a + b * 0.5 + c * 0.25 + d * 0.12;
      // soft-ridged crests: 1 - |n| has a derivative kink exactly on the lattice nodes (pin-prick glints), so round it off
      const crest = (1 - Math.sqrt(b * b + 0.06)) * 0.6 + (1 - Math.sqrt(c * c + 0.06)) * 0.3 + (1 - Math.sqrt(a * a + 0.06)) * 0.5;
      height[y * N + x] = soft * 0.55 + crest * 0.45;
    }
  }
  const slope = new Float32Array(N * N * 2);
  let sumSq = 0;
  for (let y = 0; y < N; y++) {
    const ym = ((y + N - 1) % N) * N;
    const yp = ((y + 1) % N) * N;
    for (let x = 0; x < N; x++) {
      const xm = (x + N - 1) % N;
      const xp = (x + 1) % N;
      const dx = height[y * N + xp]! - height[y * N + xm]!;
      const dy = height[yp + x]! - height[ym + x]!;
      slope[(y * N + x) * 2] = dx;
      slope[(y * N + x) * 2 + 1] = dy;
      sumSq += dx * dx + dy * dy;
    }
  }
  // normalise so one standard deviation of the slope maps to ±0.3 of the encoded range
  const gain = 0.3 / Math.sqrt(sumSq / (N * N * 2));

  const fbmLat = [new Lattice(4, 21), new Lattice(8, 22), new Lattice(16, 23), new Lattice(32, 24)];
  const smooth = new Float32Array(N * N);
  let sMin = Infinity;
  let sMax = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      const v = y * inv;
      const f = fbmLat[0]!.at(u, v) + fbmLat[1]!.at(u, v) * 0.5 + fbmLat[2]!.at(u, v) * 0.25 + fbmLat[3]!.at(u, v) * 0.125;
      smooth[y * N + x] = f;
      if (f < sMin) sMin = f;
      if (f > sMax) sMax = f;
    }
  }

  // warped periodic worley (F2 - F1): feature points on a C x C grid, domain warped by two low-frequency noises
  const C = 9;
  const fx = new Float32Array(C * C);
  const fy = new Float32Array(C * C);
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      fx[j * C + i] = 0.12 + hash2(i, j, 31) * 0.76;
      fy[j * C + i] = 0.12 + hash2(i, j, 32) * 0.76;
    }
  }
  const warpX = new Lattice(3, 41);
  const warpY = new Lattice(3, 42);
  const warpX2 = new Lattice(7, 43);
  const warpY2 = new Lattice(7, 44);
  const edge = new Float32Array(N * N);
  let eMax = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      const v = y * inv;
      const pu = (u + warpX.at(u, v) * 0.085 + warpX2.at(u, v) * 0.02) * C;
      const pv = (v + warpY.at(u, v) * 0.085 + warpY2.at(u, v) * 0.02) * C;
      const ci = Math.floor(pu);
      const cj = Math.floor(pv);
      let f1 = 9;
      let f2 = 9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const gi = ci + di;
          const gj = cj + dj;
          const wi = ((gi % C) + C) % C;
          const wj = ((gj % C) + C) % C;
          const ex = gi + fx[wj * C + wi]! - pu;
          const ey = gj + fy[wj * C + wi]! - pv;
          const d = ex * ex + ey * ey;
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const e = Math.sqrt(f2) - Math.sqrt(f1);
      edge[y * N + x] = e;
      if (e > eMax) eMax = e;
    }
  }

  const data = new Uint8Array(N * N * 4);
  const sRange = 1 / (sMax - sMin);
  const eScale = 1 / (eMax * 0.62);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    data[o] = Math.max(0, Math.min(255, Math.round((0.5 + slope[i * 2]! * gain) * 255)));
    data[o + 1] = Math.max(0, Math.min(255, Math.round((0.5 + slope[i * 2 + 1]! * gain) * 255)));
    data[o + 2] = Math.round((smooth[i]! - sMin) * sRange * 255);
    data[o + 3] = Math.round(Math.min(1, edge[i]! * eScale) * 255);
  }
  const tex = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
