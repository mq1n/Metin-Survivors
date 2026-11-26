// Geometry toolbox shared by the tree / rock generators: tiny vector helpers, a growable vertex builder with the
// vegetation vertex layout, and a seeded 3D value noise. Everything here runs once at load time.
import { BufferAttribute, BufferGeometry } from 'three';

export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const saturate = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = saturate((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Rotates `v` about the unit axis `k` by `a` radians (Rodrigues). */
export function rotate(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/** Any unit vector perpendicular to `t`. */
export function perp(t: V3): V3 {
  const a: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(a, t));
}

/** Unit vector from azimuth (about +Y, 0 = +X toward +Z) and elevation above the horizontal plane. */
export function dirFromAngles(azimuth: number, elevation: number): V3 {
  const ce = Math.cos(elevation);
  return [Math.cos(azimuth) * ce, Math.sin(elevation), Math.sin(azimuth) * ce];
}

// ---------------------------------------------------------------------------------------------------------------------
// vertex builder

/**
 * Vertex layout (identical for every vegetation geometry so BatchedMesh can pack them):
 *   position vec3, normal vec3, uv vec2, color vec3 (AO / per-card tint multiplier),
 *   aData vec4 = (sway mask 0..1, flutter mask 0..1, material select / mask, lod flag).
 */
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly dat: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  vertex(p: V3, n: V3, u: number, v: number, r: number, g: number, b: number, d0: number, d1: number, d2: number, d3: number): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(r, g, b);
    this.dat.push(d0, d1, d2, d3);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** copies `src` in, translating positions by `off` (optional) and scaling the aData lod flag */
  append(src: MeshBuilder): void {
    const base = this.vertexCount;
    for (let i = 0; i < src.pos.length; i++) this.pos.push(src.pos[i] as number);
    for (let i = 0; i < src.nrm.length; i++) this.nrm.push(src.nrm[i] as number);
    for (let i = 0; i < src.uv.length; i++) this.uv.push(src.uv[i] as number);
    for (let i = 0; i < src.col.length; i++) this.col.push(src.col[i] as number);
    for (let i = 0; i < src.dat.length; i++) this.dat.push(src.dat[i] as number);
    for (let i = 0; i < src.idx.length; i++) this.idx.push((src.idx[i] as number) + base);
  }

  /** overwrites the lod flag (aData.w) of every vertex */
  setLod(lod: number): void {
    for (let i = 3; i < this.dat.length; i += 4) this.dat[i] = lod;
  }

  /** recomputes smooth vertex normals from the triangles (area weighted) */
  computeNormals(): void {
    const n = this.vertexCount;
    const acc = new Float32Array(n * 3);
    const p = this.pos;
    for (let i = 0; i < this.idx.length; i += 3) {
      const a = (this.idx[i] as number) * 3;
      const b = (this.idx[i + 1] as number) * 3;
      const c = (this.idx[i + 2] as number) * 3;
      const e1x = (p[b] as number) - (p[a] as number);
      const e1y = (p[b + 1] as number) - (p[a + 1] as number);
      const e1z = (p[b + 2] as number) - (p[a + 2] as number);
      const e2x = (p[c] as number) - (p[a] as number);
      const e2y = (p[c + 1] as number) - (p[a + 1] as number);
      const e2z = (p[c + 2] as number) - (p[a + 2] as number);
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      for (const o of [a, b, c]) {
        acc[o] = (acc[o] as number) + nx;
        acc[o + 1] = (acc[o + 1] as number) + ny;
        acc[o + 2] = (acc[o + 2] as number) + nz;
      }
    }
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const l = Math.hypot(acc[o] as number, acc[o + 1] as number, acc[o + 2] as number) || 1;
      this.nrm[o] = (acc[o] as number) / l;
      this.nrm[o + 1] = (acc[o + 1] as number) / l;
      this.nrm[o + 2] = (acc[o + 2] as number) / l;
    }
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aData', new BufferAttribute(new Float32Array(this.dat), 4));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// seeded noise

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x85ebca6b) ^ Math.imul(seed, 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** smooth value noise in [-1,1] */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), ux);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), ux);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), ux);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz) * 2 - 1;
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves = 3): number {
  let amp = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** ridged noise in [0,1]: 1 on crests */
export function ridge3(x: number, y: number, z: number, seed: number, octaves = 3): number {
  let amp = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(x * f, y * f, z * f, seed + i * 57));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}
