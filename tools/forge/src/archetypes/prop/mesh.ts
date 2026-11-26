// PropMesh: hard-surface triangle soup that carries tile-space UVs (1 unit = one repeat of the group's material tile) next to
// positions, so painted/tileable materials can be baked per texel after xatlas has unwrapped the model.
// Parts come from the core hard-surface builders (extrude / lathe / sweep / bevelBox -> HardMesh) plus a `Mapper` that gives each
// triangle its tile coordinates, or from hand-parameterised surfaces (roof lofts) that provide their own UVs.
import type { HardMesh } from '../../core/hard/hardmesh.ts';
import { type Mat4, type Vec3, m4identity, m4transformPoint, vcross, vdot, vlen, vnorm, vsub } from '../../core/math.ts';
import type { Noise } from '../../core/noise.ts';
import type { Rgb, Tex } from './texlib.ts';

export type Vec2 = [number, number];

/** per-texel shading context handed to materials during the bake */
export interface Texel {
  /** model-space position (ground at y = 0) */
  p: Vec3;
  /** interpolated unit normal */
  n: Vec3;
  /** geometric face normal */
  nf: Vec3;
  /** tile-space coordinates of the material tile (1 = one repeat) */
  uv: Vec2;
  /** metres per texel at this point */
  mpt: number;
  /** tile units per metre of the surface mapping at this triangle */
  tpm: number;
  /** footprint of one texel in tile units (for mip selection) */
  fp: number;
  /** height above the ground (m) */
  hy: number;
  /** contact occlusion 0..1 (1 = open), short range */
  ao: number;
  /** large-scale sky occlusion 0..1 */
  aoL: number;
  /** convexity proxy 0..1 (bevels / rounded edges) */
  edge: number;
  /** model-wide seeded noise */
  noise: Noise;
  /** triplanar-free tile sample of a shipped texture at the texel's own uv scaled by `k` (k = repeats per tile unit) */
  tex(t: Tex, k?: number, du?: number, dv?: number): Rgb;
}

export interface Mat {
  name: string;
  /** albedo (linear RGB) at a texel */
  shade(t: Texel): Rgb;
  /** emissive radiance (linear RGB) or null; any material with `emit` makes the build write an emissive map */
  emit?(t: Texel): Rgb | null;
  /** how strongly baked AO darkens this material (default 1; 0 for self-lit stuff) */
  ao?: number;
}

export type Mapper = (a: Vec3, b: Vec3, c: Vec3, n: Vec3) => [Vec2, Vec2, Vec2];

const TWO_PI = Math.PI * 2;

/** wall-aware planar mapping: u runs along the face's horizontal tangent, v down the slope; `s` metres per tile */
export const mapAuto = (s = 1): Mapper => (a, b, c, n) => {
  let t: Vec3 = [-n[2], 0, n[0]];
  const l = Math.hypot(t[0], t[2]);
  if (l < 0.35) t = [1, 0, 0];
  else t = [t[0] / l, 0, t[2] / l];
  const w = vcross(n, t);
  const f = (p: Vec3): Vec2 => [vdot(p, t) / s, -vdot(p, w) / s];
  return [f(a), f(b), f(c)];
};

/** explicit planar frame: u = (p - o)·uAxis / s, v = (p - o)·vAxis / s */
export const mapPlanar = (o: Vec3, uAxis: Vec3, vAxis: Vec3, s = 1): Mapper => (a, b, c) => {
  const f = (p: Vec3): Vec2 => {
    const d = vsub(p, o);
    return [vdot(d, uAxis) / s, vdot(d, vAxis) / s];
  };
  return [f(a), f(b), f(c)];
};

/**
 * cylinder around the vertical axis through (cx, cz): u runs around (circumference snapped to a whole number of tiles so the
 * texture closes), v = -y / s. Triangles straddling the angle seam are unwrapped per triangle.
 */
export const mapCylY = (cx: number, cz: number, radius: number, s = 1): Mapper => {
  const tiles = Math.max(1, Math.round((TWO_PI * radius) / s));
  return (a, b, c) => {
    const ang = [a, b, c].map((p) => Math.atan2(p[2] - cz, p[0] - cx));
    const ref = ang[0]!;
    const u = ang.map((q) => {
      let d = q - ref;
      while (d > Math.PI) d -= TWO_PI;
      while (d < -Math.PI) d += TWO_PI;
      return ((ref + d) / TWO_PI) * tiles;
    });
    return [[u[0]!, -a[1] / s], [u[1]!, -b[1] / s], [u[2]!, -c[1] / s]];
  };
};

/** logs / beams along an arbitrary axis: u runs along the axis, v around it */
export const mapAxis = (origin: Vec3, axis: Vec3, radius: number, s = 1): Mapper => {
  const ax = vnorm(axis);
  const ref: Vec3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = vnorm(vcross(ref, ax));
  const e2 = vcross(ax, e1);
  const tiles = Math.max(1, Math.round((TWO_PI * radius) / s));
  return (a, b, c) => {
    const pts = [a, b, c].map((p) => {
      const d = vsub(p, origin);
      return { along: vdot(d, ax), ang: Math.atan2(vdot(d, e2), vdot(d, e1)) };
    });
    const ref0 = pts[0]!.ang;
    return pts.map((q) => {
      let d = q.ang - ref0;
      while (d > Math.PI) d -= TWO_PI;
      while (d < -Math.PI) d += TWO_PI;
      return [q.along / s, ((ref0 + d) / TWO_PI) * tiles] as Vec2;
    }) as [Vec2, Vec2, Vec2];
  };
};

/** uvs from world x/z/y by dominant axis (stone blocks, terrain-like rock): top = (x,z), x-facing = (z,y), z-facing = (x,y) */
export const mapBox = (s = 1): Mapper => (a, b, c, n) => {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const f = (p: Vec3): Vec2 => (ay >= ax && ay >= az ? [p[0] / s, p[2] / s] : ax >= az ? [p[2] / s, -p[1] / s] : [p[0] / s, -p[1] / s]);
  return [f(a), f(b), f(c)];
};

export interface Finished {
  positions: Float32Array;
  normals: Float32Array;
  /** tile-space uv per vertex */
  tuv: Float32Array;
  groups: Uint16Array;
  indices: Uint32Array;
}

export class PropMesh {
  /** 9 floats per triangle */
  readonly tris: number[] = [];
  /** 6 floats per triangle (tile-space uv per corner) */
  readonly uvs: number[] = [];
  readonly grp: number[] = [];
  /** group (material index) for triangles added next */
  mat = 0;
  /** true: keep the authored ground at y = 0 and flatten anything below it onto the ground (sunken/ruined parts) instead of re-seating the model on its lowest vertex */
  fixedGround = false;

  get triCount(): number {
    return this.grp.length;
  }

  /** append triangle with explicit tile uvs */
  tri(a: Vec3, b: Vec3, c: Vec3, ua: Vec2, ub: Vec2, uc: Vec2, mat = this.mat): this {
    this.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.uvs.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    this.grp.push(mat);
    return this;
  }

  /** append a core hard-surface part (optionally transformed) with a uv mapper; every triangle gets material `mat` */
  add(h: HardMesh, mat: number, map: Mapper, xf: number[] = m4identity()): this {
    for (let i = 0; i < h.tris.length; i += 9) {
      const a = m4transformPoint(xf, [h.tris[i]!, h.tris[i + 1]!, h.tris[i + 2]!]);
      const b = m4transformPoint(xf, [h.tris[i + 3]!, h.tris[i + 4]!, h.tris[i + 5]!]);
      const c = m4transformPoint(xf, [h.tris[i + 6]!, h.tris[i + 7]!, h.tris[i + 8]!]);
      const n = vcross(vsub(b, a), vsub(c, a));
      if (vlen(n) < 1e-14) continue;
      const nn = vnorm(n);
      const [ua, ub, uc] = map(a, b, c, nn);
      this.tri(a, b, c, ua, ub, uc, mat);
    }
    return this;
  }

  /** quad a,b,c,d (counter-clockwise from the front) with explicit uvs */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ua: Vec2, ub: Vec2, uc: Vec2, ud: Vec2, mat = this.mat): this {
    return this.tri(a, b, c, ua, ub, uc, mat).tri(a, c, d, ua, uc, ud, mat);
  }

  /** apply `xf` to every triangle added since triangle index `from` (use `m.triCount` before building a part) */
  transformFrom(from: number, xf: number[]): this {
    for (let t = from; t < this.triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const i = t * 9 + k * 3;
        const p = m4transformPoint(xf, [this.tris[i]!, this.tris[i + 1]!, this.tris[i + 2]!]);
        this.tris[i] = p[0]; this.tris[i + 1] = p[1]; this.tris[i + 2] = p[2];
      }
    }
    return this;
  }

  /** displace every vertex of the triangles added since `from` (bends, slants, breaks) */
  deform(from: number, fn: (p: Vec3) => Vec3): this {
    for (let t = from; t < this.triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const i = t * 9 + k * 3;
        const p = fn([this.tris[i]!, this.tris[i + 1]!, this.tris[i + 2]!]);
        this.tris[i] = p[0]; this.tris[i + 1] = p[1]; this.tris[i + 2] = p[2];
      }
    }
    return this;
  }

  /** drop triangles added since `from` whose centroid fails `keep` (cuts, breaks, ruins) */
  filterFrom(from: number, keep: (cx: number, cy: number, cz: number) => boolean): this {
    const tris: number[] = [], uvs: number[] = [], grp: number[] = [];
    for (let t = from; t < this.triCount; t++) {
      const cx = (this.tris[t * 9]! + this.tris[t * 9 + 3]! + this.tris[t * 9 + 6]!) / 3;
      const cy = (this.tris[t * 9 + 1]! + this.tris[t * 9 + 4]! + this.tris[t * 9 + 7]!) / 3;
      const cz = (this.tris[t * 9 + 2]! + this.tris[t * 9 + 5]! + this.tris[t * 9 + 8]!) / 3;
      if (!keep(cx, cy, cz)) continue;
      for (let k = 0; k < 9; k++) tris.push(this.tris[t * 9 + k]!);
      for (let k = 0; k < 6; k++) uvs.push(this.uvs[t * 6 + k]!);
      grp.push(this.grp[t]!);
    }
    this.tris.length = from * 9;
    this.uvs.length = from * 6;
    this.grp.length = from;
    this.tris.push(...tris);
    this.uvs.push(...uvs);
    this.grp.push(...grp);
    return this;
  }

  bounds(): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.tris.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, this.tris[i + k]!);
        max[k] = Math.max(max[k]!, this.tris[i + k]!);
      }
    }
    return { min, max };
  }

  /** weld by (position, uv, material), average normals within `crease` degrees, drop degenerate triangles; ground is moved to y = 0 */
  finish(crease = 40): Finished {
    const cosCrease = Math.cos((crease * Math.PI) / 180);
    const weld = 1e-5;
    const nt = this.triCount;
    const bb = this.bounds();
    const dy = this.fixedGround ? 0 : Number.isFinite(bb.min[1]) ? -bb.min[1] : 0;
    const key = (x: number, y: number, z: number): string => `${Math.round(x / weld)},${Math.round(y / weld)},${Math.round(z / weld)}`;
    const ids = new Map<string, number>();
    const pos: number[] = [];
    const tri = new Int32Array(nt * 3);
    const fn = new Float32Array(nt * 3);
    const area = new Float32Array(nt);
    const keep = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const x = this.tris[t * 9 + k * 3]!, z = this.tris[t * 9 + k * 3 + 2]!;
        const y = this.fixedGround ? Math.max(0, this.tris[t * 9 + k * 3 + 1]!) : this.tris[t * 9 + k * 3 + 1]! + dy;
        const kk = key(x, y, z);
        let id = ids.get(kk);
        if (id === undefined) {
          id = pos.length / 3;
          ids.set(kk, id);
          pos.push(x, y, z);
        }
        tri[t * 3 + k] = id;
      }
      const a = tri[t * 3]! * 3, b = tri[t * 3 + 1]! * 3, c = tri[t * 3 + 2]! * 3;
      const n = vcross([pos[b]! - pos[a]!, pos[b + 1]! - pos[a + 1]!, pos[b + 2]! - pos[a + 2]!], [pos[c]! - pos[a]!, pos[c + 1]! - pos[a + 1]!, pos[c + 2]! - pos[a + 2]!]);
      const l = vlen(n);
      if (tri[t * 3] === tri[t * 3 + 1] || tri[t * 3 + 1] === tri[t * 3 + 2] || tri[t * 3] === tri[t * 3 + 2] || l < 1e-12) continue;
      keep[t] = 1;
      area[t] = l / 2;
      fn[t * 3] = n[0] / l; fn[t * 3 + 1] = n[1] / l; fn[t * 3 + 2] = n[2] / l;
    }
    const nv = pos.length / 3;
    const inc: number[][] = Array.from({ length: nv }, () => []);
    for (let t = 0; t < nt; t++) if (keep[t]) for (let k = 0; k < 3; k++) inc[tri[t * 3 + k]!]!.push(t);
    const outPos: number[] = [], outNrm: number[] = [], outUv: number[] = [], outGrp: number[] = [], outIdx: number[] = [];
    const cache = new Map<string, number>();
    for (let t = 0; t < nt; t++) {
      if (!keep[t]) continue;
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k]!;
        let nx = 0, ny = 0, nz = 0;
        for (const u of inc[v]!) {
          const d = fn[u * 3]! * fn[t * 3]! + fn[u * 3 + 1]! * fn[t * 3 + 1]! + fn[u * 3 + 2]! * fn[t * 3 + 2]!;
          if (d >= cosCrease) { nx += fn[u * 3]! * area[u]!; ny += fn[u * 3 + 1]! * area[u]!; nz += fn[u * 3 + 2]! * area[u]!; }
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const g = this.grp[t]!;
        const uu = this.uvs[t * 6 + k * 2]!, vv = this.uvs[t * 6 + k * 2 + 1]!;
        const ck = `${v}|${Math.round(nx * 400)}|${Math.round(ny * 400)}|${Math.round(nz * 400)}|${g}|${Math.round(uu * 2000)}|${Math.round(vv * 2000)}`;
        let id = cache.get(ck);
        if (id === undefined) {
          id = outPos.length / 3;
          cache.set(ck, id);
          outPos.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
          outNrm.push(nx, ny, nz);
          outUv.push(uu, vv);
          outGrp.push(g);
        }
        outIdx.push(id);
      }
    }
    return { positions: Float32Array.from(outPos), normals: Float32Array.from(outNrm), tuv: Float32Array.from(outUv), groups: Uint16Array.from(outGrp), indices: Uint32Array.from(outIdx) };
  }
}
