// Small tileable noise texture shared by the terrain shader: four decorrelated fractal noise bands in RGBA.
// R = large scale (colour patches), G = medium, B = fine (anti-tiling / detail mix), A = very fine glints.
import { DataTexture, LinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';
import { hashInt } from '../../world/rng';

const SIZE = 256;

function lattice(ix: number, iz: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const z = ((iz % period) + period) % period;
  return hashInt(Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) / 4294967296;
}

/** periodic value noise with quintic interpolation; `period` cells across the texture */
function tileNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const z = v * period;
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = lattice(ix, iz, period, seed);
  const b = lattice(ix + 1, iz, period, seed);
  const c = lattice(ix, iz + 1, period, seed);
  const d = lattice(ix + 1, iz + 1, period, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbmTile(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileNoise(u, v, p, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

let shared: DataTexture | null = null;

/**
 * The one tileable noise texture of the terrain family (terrain shader, atmosphere patch). Created lazily, never disposed
 * (256 KB for the whole page lifetime).
 */
export function sharedNoise(): DataTexture {
  if (shared) return shared;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const u = i / SIZE;
      const v = j / SIZE;
      const o = (j * SIZE + i) * 4;
      data[o] = Math.round(fbmTile(u, v, 3, 4, 11) * 255);
      data[o + 1] = Math.round(fbmTile(u, v, 6, 4, 23) * 255);
      data[o + 2] = Math.round(fbmTile(u, v, 12, 3, 37) * 255);
      data[o + 3] = Math.round(tileNoise(u, v, 128, 53) * 255);
    }
  }
  const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.colorSpace = NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}
