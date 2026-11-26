// Bake passes for the pickup family: ray-cast ambient occlusion (hemisphere sets, optional ground plane, optional
// "lid open" configuration for interior surfaces), hidden-face culling for overlapping solids, and colour-error driven
// adaptive edge refinement (so AO / paint gradients get vertices exactly where they change).
import type { Mat4 } from '../../core/math.ts';
import { Bvh } from './bvh.ts';
import type { TriMesh } from './mesh.ts';

export interface AoSpec {
  /** hemisphere rays per sample (default 48) */
  rays?: number;
  /** occluders farther than this do not count (m) */
  maxDist: number;
  /** distance falloff exponent of the occlusion weight (default 1 = linear) */
  falloff?: number;
  /** drop rays below this sine of elevation (self-hit guard on faceted curves, default 0.2) */
  minElev?: number;
  /** ray origin offset along the normal (m, default 0.002) */
  eps?: number;
  /** treat y = 0 as an occluding ground plane */
  ground?: boolean;
  /** surfaces whose AO is evaluated with the lid opened (interior, lid underside, rim top): predicate on the closed-pose sample */
  openIf?: (x: number, y: number, z: number, nx: number, ny: number, nz: number, zone: number, bone: number) => boolean;
}

const hemisphereCache = new Map<string, Float32Array>();
/** cosine-weighted Fibonacci hemisphere directions (local z = normal) */
function hemisphere(n: number, minElev: number): Float32Array {
  const key = `${n}|${minElev}`;
  let h = hemisphereCache.get(key);
  if (h) return h;
  const out: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const total = Math.ceil(n / (1 - minElev * minElev));
  for (let i = 0; i < total; i++) {
    const u = (i + 0.5) / total;
    const z = Math.sqrt(1 - u);
    if (z < minElev) continue;
    const r = Math.sqrt(u);
    const phi = i * golden;
    out.push(Math.cos(phi) * r, Math.sin(phi) * r, z);
  }
  h = Float32Array.from(out);
  hemisphereCache.set(key, h);
  return h;
}

export class AoField {
  private readonly dirs: Float32Array;
  private readonly rays: number;
  private readonly eps: number;
  private readonly fall: number;

  constructor(
    private readonly closed: Bvh,
    private readonly openBvh: Bvh | null,
    private readonly spec: AoSpec,
    private readonly openXf: Mat4 | null = null,
    private readonly lidBone = 1,
  ) {
    this.dirs = hemisphere(spec.rays ?? 48, spec.minElev ?? 0.2);
    this.rays = this.dirs.length / 3;
    this.eps = spec.eps ?? 0.002;
    this.fall = spec.falloff ?? 1;
  }

  /** ambient visibility 0 (fully occluded) .. 1 (open) at a surface point */
  at(px: number, py: number, pz: number, nx: number, ny: number, nz: number, zone: number, bone: number): number {
    let bvh = this.closed;
    if (this.openBvh && this.spec.openIf?.(px, py, pz, nx, ny, nz, zone, bone)) {
      bvh = this.openBvh;
      if (bone === this.lidBone && this.openXf) {
        const m = this.openXf;
        const x = m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!;
        const y = m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!;
        const z = m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!;
        const tx = m[0]! * nx + m[4]! * ny + m[8]! * nz;
        const ty = m[1]! * nx + m[5]! * ny + m[9]! * nz;
        const tz = m[2]! * nx + m[6]! * ny + m[10]! * nz;
        px = x; py = y; pz = z; nx = tx; ny = ty; nz = tz;
      }
    }
    // tangent frame
    let ax = 0, ay = 1, az = 0;
    if (Math.abs(ny) > 0.9) { ax = 1; ay = 0; }
    let tx = ay * nz - az * ny, ty = az * nx - ax * nz, tz = ax * ny - ay * nx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const ox = px + nx * this.eps, oy = py + ny * this.eps, oz = pz + nz * this.eps;
    const maxD = this.spec.maxDist;
    const ground = this.spec.ground === true;
    const d = this.dirs;
    let occ = 0;
    for (let i = 0; i < this.rays; i++) {
      const lx = d[i * 3]!, ly = d[i * 3 + 1]!, lz = d[i * 3 + 2]!;
      const dx = tx * lx + bx * ly + nx * lz, dy = ty * lx + by * ly + ny * lz, dz = tz * lx + bz * ly + nz * lz;
      let t = bvh.nearest(ox, oy, oz, dx, dy, dz, maxD);
      if (ground && dy < -1e-6 && oy > 0) {
        const tg = -oy / dy;
        if (tg < t) t = tg;
      }
      if (t < maxD) occ += Math.pow(1 - t / maxD, this.fall);
    }
    return 1 - occ / this.rays;
  }
}

// ------------------------------------------------------------------------------------------------ lid pose
function applyXf(m: Mat4, x: number, y: number, z: number, out: number[]): void {
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
}

/** the soup of a mesh with the lid-bone triangles moved by `lidXf` (identity when null) */
export function poseSoup(m: TriMesh, lidXf: Mat4 | null, lidBone = 1): Float32Array {
  if (!lidXf) return m.soup();
  const out = new Float32Array(m.nt * 9);
  const tmp = [0, 0, 0];
  for (let t = 0; t < m.nt; t++) {
    const bone = m.triGroup(t) >> 8;
    for (let k = 0; k < 3; k++) {
      const v = m.idx[t * 3 + k]!;
      const x = m.pos[v * 3]!, y = m.pos[v * 3 + 1]!, z = m.pos[v * 3 + 2]!;
      if (bone === lidBone) {
        applyXf(lidXf, x, y, z, tmp);
        out[t * 9 + k * 3] = tmp[0]!; out[t * 9 + k * 3 + 1] = tmp[1]!; out[t * 9 + k * 3 + 2] = tmp[2]!;
      } else {
        out[t * 9 + k * 3] = x; out[t * 9 + k * 3 + 1] = y; out[t * 9 + k * 3 + 2] = z;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ colour-driven refinement
export interface RefineSpec {
  /** hard cap on edge length per zone (m) */
  maxEdge: (zone: number) => number;
  /** edges shorter than 2 x this are never split by the colour test */
  minEdge: number;
  /** colour error (perceptual units, ~0..1) above which an edge is split */
  tol: number;
  passes: number;
  /** triangle cap for colour-driven splits (forced length splits ignore it) */
  budget: number;
  /** per-stage tri-count trace */
  log?: (s: string) => void;
}

export type ColorFn = (px: number, py: number, pz: number, nx: number, ny: number, nz: number, grp: number, bevel: number, out: number[]) => void;

const GAMMA = 1 / 2.2;
/** perceptual distance between two linear colours */
export function colorDist(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dr = Math.pow(Math.max(0, a[0]!), GAMMA) - Math.pow(Math.max(0, b[0]!), GAMMA);
  const dg = Math.pow(Math.max(0, a[1]!), GAMMA) - Math.pow(Math.max(0, b[1]!), GAMMA);
  const db = Math.pow(Math.max(0, a[2]!), GAMMA) - Math.pow(Math.max(0, b[2]!), GAMMA);
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) * 1.8;
}

/** per-vertex "bevel" measure: 1 - cos(angle between the vertex normal and the incident face normals), max over faces */
export function bevelMeasure(m: TriMesh): number[] {
  const out = new Array<number>(m.nv).fill(0);
  const n = [0, 0, 0];
  for (let t = 0; t < m.nt; t++) {
    m.faceNormal(t, n);
    for (let k = 0; k < 3; k++) {
      const v = m.idx[t * 3 + k]!;
      const d = 1 - (n[0]! * m.nrm[v * 3]! + n[1]! * m.nrm[v * 3 + 1]! + n[2]! * m.nrm[v * 3 + 2]!);
      if (d > out[v]!) out[v] = d;
    }
  }
  return out;
}

export interface Shaded {
  /** linear rgb per vertex */
  color: number[];
  bevel: number[];
}

/**
 * Evaluates `fn` for every vertex and then repeatedly splits edges whose midpoint colour differs from the endpoint average
 * (forced splits for edges over the zone's `maxEdge`). Returns the per-vertex colours for the final mesh.
 */
export function refineShaded(m: TriMesh, fn: ColorFn, spec: RefineSpec): Shaded {
  const color: number[] = [];
  let bevel = bevelMeasure(m);
  const tmp = [0, 0, 0];
  const fill = (): void => {
    for (let v = color.length / 3; v < m.nv; v++) {
      fn(m.pos[v * 3]!, m.pos[v * 3 + 1]!, m.pos[v * 3 + 2]!, m.nrm[v * 3]!, m.nrm[v * 3 + 1]!, m.nrm[v * 3 + 2]!, m.grp[v]!, bevel[v]!, tmp);
      color.push(tmp[0]!, tmp[1]!, tmp[2]!);
    }
  };
  // forced length splits first (cheap, no shading needed)
  const before = m.nt;
  m.subdivideTo(spec.maxEdge, 10);
  bevel = extendBevel(m, bevel);
  fill();
  spec.log?.(`  refine: forced length splits ${before} -> ${m.nt} tris`);
  const mc = [0, 0, 0];
  const avg = [0, 0, 0];
  for (let pass = 0; pass < spec.passes; pass++) {
    const seen = new Map<number, number>();
    const cand: { key: number; err: number }[] = [];
    for (let t = 0; t < m.nt; t++) {
      for (let k = 0; k < 3; k++) {
        const a = m.idx[t * 3 + k]!, b = m.idx[t * 3 + ((k + 1) % 3)]!;
        const key = m.edgeKey(a, b);
        if (seen.has(key)) continue;
        seen.set(key, 1);
        const L = m.edgeLen(a, b);
        if (L < spec.minEdge * 2) continue;
        const px = (m.pos[a * 3]! + m.pos[b * 3]!) / 2, py = (m.pos[a * 3 + 1]! + m.pos[b * 3 + 1]!) / 2, pz = (m.pos[a * 3 + 2]! + m.pos[b * 3 + 2]!) / 2;
        let nx = m.nrm[a * 3]! + m.nrm[b * 3]!, ny = m.nrm[a * 3 + 1]! + m.nrm[b * 3 + 1]!, nz = m.nrm[a * 3 + 2]! + m.nrm[b * 3 + 2]!;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        fn(px, py, pz, nx, ny, nz, m.grp[a]!, (bevel[a]! + bevel[b]!) / 2, mc);
        avg[0] = (color[a * 3]! + color[b * 3]!) / 2; avg[1] = (color[a * 3 + 1]! + color[b * 3 + 1]!) / 2; avg[2] = (color[a * 3 + 2]! + color[b * 3 + 2]!) / 2;
        const err = colorDist(mc, avg);
        if (err > spec.tol) cand.push({ key, err });
      }
    }
    if (cand.length === 0) break;
    cand.sort((x, y) => y.err - x.err);
    const room = Math.max(0, Math.floor((spec.budget - m.nt) / 2.2));
    if (room === 0) break;
    const marked = new Set<number>();
    for (let i = 0; i < Math.min(room, cand.length); i++) marked.add(cand[i]!.key);
    m.splitEdges(marked);
    bevel = extendBevel(m, bevel);
    fill();
    spec.log?.(`  refine pass ${pass}: ${cand.length} candidate edges, split ${marked.size} -> ${m.nt} tris`);
  }
  return { color, bevel };
}

/** new vertices inherit the mean of the bevel measure of their parents; we recompute exactly from incident faces */
function extendBevel(m: TriMesh, old: number[]): number[] {
  if (old.length === m.nv) return old;
  const out = bevelMeasure(m);
  for (let i = 0; i < old.length; i++) out[i] = old[i]!;
  return out;
}
