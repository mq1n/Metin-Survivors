// Exact hidden-face removal for overlapping convex solids. Coplanar neighbouring triangles of one group are first merged back
// into convex planar faces; every face is then clipped against the planes of the covers on the same bone (the covered part is
// dropped, the rest stays as convex polygons). Cut vertices are shared with every polygon edge they lie on (no T-junctions) and
// the polygons are re-triangulated. A cover is tested with a sample offset `eps` along the face normal, so coplanar contact faces
// are hidden but same-direction coplanar faces are not.
import type { V3 } from './geom.ts';
import { TriMesh } from './mesh.ts';

export interface Cover {
  bone: number;
  /** outward unit normal + offset (nx, ny, nz, d) per plane */
  planes: number[];
  lo: V3;
  hi: V3;
  /** true: faces only partly inside are split exactly along the cover; false: only faces fully inside are dropped */
  clip: boolean;
}

/** convex cover from the triangle floats tris[from, to): planes deduplicated and oriented away from the centroid */
export function coverOf(tris: readonly number[], from: number, to: number, bone: number, clip: boolean): Cover | null {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  let cx = 0, cy = 0, cz = 0, cn = 0;
  for (let i = from; i < to; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k]!;
      if (v < lo[k]!) lo[k] = v;
      if (v > hi[k]!) hi[k] = v;
    }
    cx += tris[i]!; cy += tris[i + 1]!; cz += tris[i + 2]!;
    cn++;
  }
  if (cn === 0) return null;
  cx /= cn; cy /= cn; cz /= cn;
  const seen = new Set<string>();
  const planes: number[] = [];
  for (let i = from; i < to; i += 9) {
    const ax = tris[i]!, ay = tris[i + 1]!, az = tris[i + 2]!;
    const e1x = tris[i + 3]! - ax, e1y = tris[i + 4]! - ay, e1z = tris[i + 5]! - az;
    const e2x = tris[i + 6]! - ax, e2y = tris[i + 7]! - ay, e2z = tris[i + 8]! - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    nx /= l; ny /= l; nz /= l;
    let d = nx * ax + ny * ay + nz * az;
    if (nx * cx + ny * cy + nz * cz > d) { nx = -nx; ny = -ny; nz = -nz; d = -d; }
    const key = `${Math.round(nx * 1000)},${Math.round(ny * 1000)},${Math.round(nz * 1000)},${Math.round(d * 10000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    planes.push(nx, ny, nz, d);
  }
  return { bone, planes, lo, hi, clip };
}

/** a planar convex face: group, unit normal and the boundary loop (vertex ids of the source mesh, counter-clockwise) */
interface Face {
  g: number;
  n: V3;
  ring: number[];
}

/** merges coplanar edge-adjacent triangles of one group into convex faces (falls back to single triangles when a union is not convex) */
function mergeFaces(m: TriMesh): Face[] {
  const nt = m.nt, NV = m.nv;
  const P = m.pos;
  const nrm: V3[] = [];
  const off: number[] = [];
  const half = new Map<number, number>();
  const parent = Array.from({ length: nt }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (let t = 0; t < nt; t++) {
    const n: V3 = [0, 0, 0];
    m.faceNormal(t, n);
    nrm.push(n);
    const a = m.idx[t * 3]!;
    off.push(n[0] * P[a * 3]! + n[1] * P[a * 3 + 1]! + n[2] * P[a * 3 + 2]!);
    for (let k = 0; k < 3; k++) half.set(m.idx[t * 3 + k]! * NV + m.idx[t * 3 + (k + 1) % 3]!, t);
  }
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const u = half.get(m.idx[t * 3 + (k + 1) % 3]! * NV + m.idx[t * 3 + k]!);
      if (u === undefined || u === t || m.triGroup(u) !== m.triGroup(t)) continue;
      const dot = nrm[t]![0] * nrm[u]![0] + nrm[t]![1] * nrm[u]![1] + nrm[t]![2] * nrm[u]![2];
      if (dot > 1 - 1e-9 && Math.abs(off[t]! - off[u]!) < 1e-6) parent[find(t)] = find(u);
    }
  }
  const comps = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    const list = comps.get(r);
    if (list) list.push(t);
    else comps.set(r, [t]);
  }
  const faces: Face[] = [];
  const single = (t: number): void => {
    faces.push({ g: m.triGroup(t), n: nrm[t]!, ring: [m.idx[t * 3]!, m.idx[t * 3 + 1]!, m.idx[t * 3 + 2]!] });
  };
  for (const [root, tris] of comps) {
    if (tris.length === 1) { single(tris[0]!); continue; }
    const next = new Map<number, number>();
    let ok = true, edges = 0;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const a = m.idx[t * 3 + k]!, b = m.idx[t * 3 + (k + 1) % 3]!;
        const u = half.get(b * NV + a);
        if (u !== undefined && u !== t && find(u) === root) continue;
        if (next.has(a)) ok = false;
        next.set(a, b);
        edges++;
      }
    }
    const ring: number[] = [];
    if (ok) {
      const start = next.keys().next().value as number;
      let v = start;
      do {
        ring.push(v);
        v = next.get(v)!;
      } while (v !== start && v !== undefined && ring.length <= edges);
      ok = v === start && ring.length === edges;
    }
    if (ok) {
      const n = nrm[tris[0]!]!;
      for (let i = 0; i < ring.length && ok; i++) {
        const p = ring[(i + ring.length - 1) % ring.length]! * 3, c = ring[i]! * 3, q = ring[(i + 1) % ring.length]! * 3;
        const ax = P[c]! - P[p]!, ay = P[c + 1]! - P[p + 1]!, az = P[c + 2]! - P[p + 2]!;
        const bx = P[q]! - P[c]!, by = P[q + 1]! - P[c + 1]!, bz = P[q + 2]! - P[c + 2]!;
        const turn = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
        if (turn < -1e-9 * Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)) ok = false;
      }
    }
    if (ok) faces.push({ g: m.triGroup(tris[0]!), n: nrm[tris[0]!]!, ring });
    else for (const t of tris) single(t);
  }
  return faces;
}

const ON = 1e-7;
/** polygon vertex: x y z nx ny nz */
const S = 6;

function pushV(dst: number[], src: number[], i: number): void {
  for (let k = 0; k < S; k++) dst.push(src[i * S + k]!);
}

/** Sutherland-Hodgman split by the plane n.p = thr: `out` holds the part with n.p > thr, `inn` the rest (on-plane vertices go to both) */
function split(poly: number[], nx: number, ny: number, nz: number, thr: number, out: number[], inn: number[]): void {
  out.length = 0;
  inn.length = 0;
  const n = poly.length / S;
  const s: number[] = [];
  let anyOut = false, anyIn = false;
  for (let i = 0; i < n; i++) {
    const v = nx * poly[i * S]! + ny * poly[i * S + 1]! + nz * poly[i * S + 2]! - thr;
    s.push(v);
    if (v > ON) anyOut = true;
    else if (v < -ON) anyIn = true;
  }
  if (!anyIn) { for (const v of poly) out.push(v); return; }
  if (!anyOut) { for (const v of poly) inn.push(v); return; }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const si = s[i]!, sj = s[j]!;
    if (si >= -ON) pushV(out, poly, i);
    if (si <= ON) pushV(inn, poly, i);
    if ((si > ON && sj < -ON) || (si < -ON && sj > ON)) {
      const t = si / (si - sj);
      for (let k = 0; k < S; k++) {
        const v = poly[i * S + k]! + (poly[j * S + k]! - poly[i * S + k]!) * t;
        out.push(v);
        inn.push(v);
      }
    }
  }
}

function area2(poly: number[]): number {
  const n = poly.length / S;
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i + 1 < n; i++) {
    const ux = poly[i * S]! - poly[0]!, uy = poly[i * S + 1]! - poly[1]!, uz = poly[i * S + 2]! - poly[2]!;
    const vx = poly[(i + 1) * S]! - poly[0]!, vy = poly[(i + 1) * S + 1]! - poly[1]!, vz = poly[(i + 1) * S + 2]! - poly[2]!;
    ax += uy * vz - uz * vy; ay += uz * vx - ux * vz; az += ux * vy - uy * vx;
  }
  return Math.hypot(ax, ay, az);
}

/**
 * Appends the parts of `poly` outside the cover to `res`; returns true when the polygon was altered. Polygons that do not reach
 * into the cover are left untouched (no cuts from planes of a cover that is not actually overlapped).
 */
function subtract(poly: number[], planes: readonly number[], n: V3, eps: number, clip: boolean, res: number[][]): boolean {
  const out: number[] = [];
  const inn: number[] = [];
  const thr = (k: number): number => {
    const dot = planes[k]! * n[0] + planes[k + 1]! * n[1] + planes[k + 2]! * n[2];
    return planes[k + 3]! - (Math.abs(dot) > 0.9995 ? eps * dot : 0);
  };
  let rem = poly;
  let whole = true;
  for (let k = 0; k < planes.length; k += 4) {
    split(rem, planes[k]!, planes[k + 1]!, planes[k + 2]!, thr(k), out, inn);
    if (inn.length === 0) return false;
    if (out.length > 0) whole = false;
    rem = inn.slice();
  }
  if (area2(rem) < 1e-9) return false;
  if (whole) return true;
  if (!clip) return false;
  rem = poly;
  for (let k = 0; k < planes.length; k += 4) {
    split(rem, planes[k]!, planes[k + 1]!, planes[k + 2]!, thr(k), out, inn);
    if (out.length > 0) res.push(out.slice());
    rem = inn.slice();
  }
  return true;
}

const posKey = (x: number, y: number, z: number): string => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
const JOIN = 1e-6;
const CELL = 0.04;

/** points that must be shared by every polygon edge passing through them */
class CutPoints {
  private readonly cells = new Map<string, V3[]>();
  private readonly seen = new Set<string>();

  add(x: number, y: number, z: number): void {
    const k = posKey(x, y, z);
    if (this.seen.has(k)) return;
    this.seen.add(k);
    const ck = `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
    const list = this.cells.get(ck);
    if (list) list.push([x, y, z]);
    else this.cells.set(ck, [[x, y, z]]);
  }

  /** points strictly inside the segment a-b, sorted from a to b, with their parameter */
  onSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number): { s: number; p: V3 }[] {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const l2 = dx * dx + dy * dy + dz * dz;
    const res: { s: number; p: V3 }[] = [];
    if (l2 < 1e-12) return res;
    const len = Math.sqrt(l2);
    const x0 = Math.floor((Math.min(ax, bx) - JOIN) / CELL), x1 = Math.floor((Math.max(ax, bx) + JOIN) / CELL);
    const y0 = Math.floor((Math.min(ay, by) - JOIN) / CELL), y1 = Math.floor((Math.max(ay, by) + JOIN) / CELL);
    const z0 = Math.floor((Math.min(az, bz) - JOIN) / CELL), z1 = Math.floor((Math.max(az, bz) + JOIN) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const list = this.cells.get(`${ix},${iy},${iz}`);
      if (!list) continue;
      for (const p of list) {
        const s = ((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / l2;
        if (s * len < 5 * JOIN || (1 - s) * len < 5 * JOIN) continue;
        const ex = p[0] - ax - dx * s, ey = p[1] - ay - dy * s, ez = p[2] - az - dz * s;
        if (ex * ex + ey * ey + ez * ez <= JOIN * JOIN) res.push({ s, p });
      }
    }
    return res.sort((u, v) => u.s - v.s);
  }
}

/** inserts the cut points lying strictly inside an edge of `poly` (normals are interpolated along the edge) */
function insertCuts(poly: number[], cuts: CutPoints): number[] {
  const n = poly.length / S;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushV(out, poly, i);
    const on = cuts.onSegment(poly[i * S]!, poly[i * S + 1]!, poly[i * S + 2]!, poly[j * S]!, poly[j * S + 1]!, poly[j * S + 2]!);
    for (const { s, p } of on) {
      out.push(p[0], p[1], p[2]);
      for (let k = 3; k < S; k++) out.push(poly[i * S + k]! + (poly[j * S + k]! - poly[i * S + k]!) * s);
    }
  }
  return out;
}

/** cut a face into rows (e.g. wood grain): planes perpendicular to `axis`, evenly spaced so every row is about `step` wide */
export interface Slice {
  axis: 0 | 1 | 2;
  step: number;
}

export interface CarveOpts {
  /** sample offset along the face normal for the cover test (m) */
  eps?: number;
  /** per-face slicing: called with the zone and the unit face normal, null = leave the face whole */
  slice?: (zone: number, n: V3) => Slice | null;
}

export function carveCovered(m: TriMesh, covers: readonly Cover[], opts: CarveOpts = {}): TriMesh {
  const eps = opts.eps ?? 0.0012;
  const P = m.pos, N = m.nrm;
  const faces = mergeFaces(m);
  const pieces: (number[][] | null)[] = [];
  const cuts = new CutPoints();
  const polyOf = (f: Face): number[] => {
    const poly: number[] = [];
    for (const v of f.ring) poly.push(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!, N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!);
    return poly;
  };

  // ---- phase A: clip every face against the covers of its bone
  for (const f of faces) {
    const bone = f.g >> 8;
    const base = polyOf(f);
    let polys: number[][] | null = null;
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < base.length / S; i++) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, base[i * S + k]!);
        hi[k] = Math.max(hi[k]!, base[i * S + k]!);
      }
    }
    for (const cv of covers) {
      if (cv.bone !== bone) continue;
      if (hi[0]! < cv.lo[0] - 1e-4 || lo[0]! > cv.hi[0] + 1e-4 || hi[1]! < cv.lo[1] - 1e-4 || lo[1]! > cv.hi[1] + 1e-4 || hi[2]! < cv.lo[2] - 1e-4 || lo[2]! > cv.hi[2] + 1e-4) continue;
      const cur = polys ?? [base];
      const next: number[][] = [];
      let touched = false;
      for (const poly of cur) {
        if (subtract(poly, cv.planes, f.n, eps, cv.clip, next)) touched = true;
        else next.push(poly);
      }
      if (touched) polys = next.filter((p) => area2(p) > 1e-9);
      if (polys && polys.length === 0) break;
    }
    const sl = opts.slice?.(f.g & 255, f.n);
    if (sl) {
      const rows = Math.round((hi[sl.axis]! - lo[sl.axis]!) / sl.step);
      if (rows > 1) {
        let cur = polys ?? [base];
        const nAxis: V3 = [0, 0, 0];
        nAxis[sl.axis] = 1;
        const out: number[] = [];
        const inn: number[] = [];
        for (let r = 1; r < rows; r++) {
          const c = lo[sl.axis]! + ((hi[sl.axis]! - lo[sl.axis]!) * r) / rows;
          const next: number[][] = [];
          for (const poly of cur) {
            split(poly, nAxis[0], nAxis[1], nAxis[2], c, out, inn);
            if (out.length > 0) next.push(out.slice());
            if (inn.length > 0) next.push(inn.slice());
          }
          cur = next;
        }
        polys = cur.filter((p) => area2(p) > 1e-9);
      }
    }
    pieces.push(polys);
    if (polys) for (const poly of polys) for (let i = 0; i < poly.length / S; i++) cuts.add(poly[i * S]!, poly[i * S + 1]!, poly[i * S + 2]!);
  }

  // ---- phase B: share cut vertices, triangulate, emit with welded vertices
  const pos: number[] = [], nrm: number[] = [], grp: number[] = [], pid: number[] = [], idx: number[] = [];
  const pidOf = new Map<string, number>();
  let nextPid = 0;
  for (let v = 0; v < m.nv; v++) {
    pidOf.set(posKey(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!), m.pid[v]!);
    if (m.pid[v]! >= nextPid) nextPid = m.pid[v]! + 1;
  }
  const vmap = new Map<string, number>();
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, g: number): number => {
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const pk = posKey(x, y, z);
    const key = `${pk}|${Math.round(nx * 500)},${Math.round(ny * 500)},${Math.round(nz * 500)}|${g}`;
    let v = vmap.get(key);
    if (v !== undefined) return v;
    let p = pidOf.get(pk);
    if (p === undefined) {
      p = nextPid++;
      pidOf.set(pk, p);
    }
    v = pos.length / 3;
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    grp.push(g);
    pid.push(p);
    vmap.set(key, v);
    return v;
  };

  const emit = (poly: number[], g: number): void => {
    const n = poly.length / S;
    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(vertex(poly[i * S]!, poly[i * S + 1]!, poly[i * S + 2]!, poly[i * S + 3]!, poly[i * S + 4]!, poly[i * S + 5]!, g));
    // a vertex with collinear neighbours sits on a straight edge: never fan from such a vertex or its neighbours
    const isCorner: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      const ax = poly[i * S]! - poly[p * S]!, ay = poly[i * S + 1]! - poly[p * S + 1]!, az = poly[i * S + 2]! - poly[p * S + 2]!;
      const bx = poly[q * S]! - poly[i * S]!, by = poly[q * S + 1]! - poly[i * S + 1]!, bz = poly[q * S + 2]! - poly[i * S + 2]!;
      const cr = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      isCorner.push(cr > 1e-4 * Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
    }
    let origin = -1;
    for (let i = 0; i < n && origin < 0; i++) if (isCorner[i] && isCorner[(i + 1) % n] && isCorner[(i + n - 1) % n]) origin = i;
    if (origin >= 0) {
      for (let k = 1; k + 1 < n; k++) {
        const a = ids[origin]!, b = ids[(origin + k) % n]!, c = ids[(origin + k + 1) % n]!;
        if (a !== b && b !== c && a !== c) idx.push(a, b, c);
      }
      return;
    }
    // every vertex touches a straight edge: star from the centroid
    const c = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < S; k++) c[k] = c[k]! + poly[i * S + k]! / n;
    const cv = vertex(c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, g);
    for (let i = 0; i < n; i++) {
      const a = ids[i]!, b = ids[(i + 1) % n]!;
      if (a !== b) idx.push(cv, a, b);
    }
  };

  faces.forEach((f, fi) => {
    for (const poly of pieces[fi] ?? [polyOf(f)]) emit(insertCuts(poly, cuts), f.g);
  });

  return TriMesh.fromArrays(pos, nrm, grp, pid, idx);
}
