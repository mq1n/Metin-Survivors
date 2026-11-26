// Convex solids from half-space clipping (rocks, crystals, shards, fractured crust plates) for hard-faceted props.
// A solid is `∩ { x : n·x <= d }` clipped out of a big box, so every face is exactly planar and the silhouette is crisp.
// Faces are emitted as centroid fans whose uv carries an edge-distance field instead of a tile coordinate:
//   uv = (w, ±h): w is the barycentric weight of the centroid (1 at the centroid, 0 on the rim), h the distance (m) from the
//   centroid to the rim edge of that fan triangle. Edge distance of a texel = uv[0] * |uv[1]|; uv[1] < 0 marks a "seam" edge
//   (a rim edge shared with a gap / crack face) so materials can glow or chip it differently from plain hard edges.
// Materials for these parts must sample textures in world space (see paint.ts `triSample`), they never use the uv as a tile coord.
import type { Mat4, Vec3 } from '../../../../core/math.ts';
import { vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../../../core/math.ts';
import type { Rng } from '../../../../core/rng.ts';
import type { PropMesh } from '../../mesh.ts';

export interface Plane {
  n: Vec3;
  d: number;
  /** carried onto the face this plane creates */
  tag?: number;
}

export interface Face {
  poly: Vec3[];
  n: Vec3;
  tag: number;
  /** per rim edge i (poly[i] -> poly[i+1]): true = seam edge */
  seam?: boolean[];
}

export const TAG_SKIN = 0;
export const TAG_GROUND = 1;
export const TAG_GAP = 2;

const EPS = 1e-9;
const d2 = (a: Vec3, b: Vec3): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function boxFaces(R: number): Face[] {
  const f = (n: Vec3, u: Vec3, v: Vec3): Face => {
    const c = vscale(n, R);
    const U = vscale(u, R), V = vscale(v, R);
    return { poly: [vsub(vsub(c, U), V), vsub(vadd(c, U), V), vadd(vadd(c, U), V), vadd(vsub(c, U), V)], n, tag: TAG_SKIN };
  };
  return [
    f([1, 0, 0], [0, 1, 0], [0, 0, 1]),
    f([-1, 0, 0], [0, 0, 1], [0, 1, 0]),
    f([0, 1, 0], [0, 0, 1], [1, 0, 0]),
    f([0, -1, 0], [1, 0, 0], [0, 0, 1]),
    f([0, 0, 1], [1, 0, 0], [0, 1, 0]),
    f([0, 0, -1], [0, 1, 0], [1, 0, 0]),
  ];
}

function dedupe(poly: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of poly) if (!out.length || d2(p, out[out.length - 1]!) > 1e-12) out.push(p);
  while (out.length > 1 && d2(out[0]!, out[out.length - 1]!) <= 1e-12) out.pop();
  return out;
}

function clipPoly(poly: Vec3[], pl: Plane, cut: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  const m = poly.length;
  for (let i = 0; i < m; i++) {
    const a = poly[i]!, b = poly[(i + 1) % m]!;
    const da = vdot(pl.n, a) - pl.d, db = vdot(pl.n, b) - pl.d;
    const ina = da <= 0, inb = db <= 0;
    if (ina) {
      out.push(a);
      if (da > -1e-9) cut.push(a);
    }
    if (ina !== inb && Math.abs(da) > 1e-9 && Math.abs(db) > 1e-9) {
      const t = da / (da - db);
      const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      out.push(p);
      cut.push(p);
    }
  }
  return dedupe(out);
}

function polyArea(p: readonly Vec3[]): number {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i + 1 < p.length; i++) {
    const c = vcross(vsub(p[i]!, p[0]!), vsub(p[i + 1]!, p[0]!));
    ax += c[0]; ay += c[1]; az += c[2];
  }
  return 0.5 * Math.hypot(ax, ay, az);
}

function orderCut(pts: Vec3[], n: Vec3): Vec3[] {
  const uniq: Vec3[] = [];
  for (const p of pts) if (!uniq.some((q) => d2(p, q) < 1e-12)) uniq.push(p);
  if (uniq.length < 3) return [];
  const c: Vec3 = [0, 0, 0];
  for (const p of uniq) { c[0] += p[0] / uniq.length; c[1] += p[1] / uniq.length; c[2] += p[2] / uniq.length; }
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = vnorm(vcross(ref, n));
  const v = vcross(n, u);
  const ang = (p: Vec3): number => Math.atan2(vdot(vsub(p, c), v), vdot(vsub(p, c), u));
  return uniq.sort((a, b) => ang(a) - ang(b));
}

/** convex solid = intersection of half-spaces, as outward CCW polygons (R = half size of the bounding box the planes cut) */
export function hull(planes: readonly Plane[], R = 40): Face[] {
  let faces = boxFaces(R);
  for (const pl of planes) {
    const next: Face[] = [];
    const cut: Vec3[] = [];
    for (const f of faces) {
      const poly = clipPoly(f.poly, pl, cut);
      if (poly.length >= 3 && polyArea(poly) > 1e-8) next.push({ ...f, poly });
    }
    const ordered = orderCut(cut, pl.n);
    if (ordered.length >= 3 && polyArea(ordered) > 1e-8) next.push({ poly: ordered, n: pl.n, tag: pl.tag ?? TAG_SKIN });
    faces = next;
  }
  return faces;
}

/** all vertices of a set of faces (deduplicated) */
export function hullVerts(faces: readonly Face[]): Vec3[] {
  const out: Vec3[] = [];
  for (const f of faces) for (const p of f.poly) if (!out.some((q) => d2(p, q) < 1e-10)) out.push(p);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// transforms (rigid + uniform scale are fine for planes; non-uniform scale is expressed through the semi-axes instead)

export const rotX = (a: number): Mat4 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
export const rotZ = (a: number): Mat4 => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
export const rotYm = (a: number): Mat4 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };

/** rotation part of a rigid matrix applied to a direction */
export const rotDir = (m: Mat4, v: Vec3): Vec3 => [m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2], m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2], m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2]];

export function xfPlanes(planes: readonly Plane[], m: Mat4): Plane[] {
  const T: Vec3 = [m[12]!, m[13]!, m[14]!];
  return planes.map((p) => {
    const n = rotDir(m, p.n);
    return { n, d: p.d + vdot(n, T), ...(p.tag !== undefined ? { tag: p.tag } : {}) };
  });
}

export function xfFaces(faces: readonly Face[], f: (p: Vec3) => Vec3): Face[] {
  return faces.map((fc) => ({ ...fc, poly: fc.poly.map(f) }));
}

/** y >= 0 (the ground), tagged so it is not rendered */
export const groundPlane = (y = 0): Plane => ({ n: [0, -1, 0], d: -y, tag: TAG_GROUND });

// ---------------------------------------------------------------------------------------------------------------------------------
// rock planes

export function fibSphere(n: number, rng: Rng): Vec3[] {
  const out: Vec3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  const off = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i + off;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

export interface RockSpec {
  /** semi axes (x, y, z) of the ellipsoid the facets are tangent to */
  r: Vec3;
  /** number of facet planes */
  n: number;
  /** direction jitter (0 = even fibonacci cover, 0.5 = very ragged) */
  jitter?: number;
  /** plane distance factor range (1 = tangent to the ellipsoid) */
  cut?: [number, number];
  /** lopsidedness: planes facing along this vector sit further out (lean / wedge / egg), magnitude ~0.1-0.35 */
  skew?: Vec3;
  /** chip planes shaved off random corners afterwards */
  chips?: number;
  /** chip depth range as a fraction of the smallest semi axis */
  chipDepth?: [number, number];
}

/** planes of a faceted boulder centred at the origin */
export function rockPlanes(rng: Rng, s: RockSpec): Plane[] {
  const [rx, ry, rz] = s.r;
  const jit = s.jitter ?? 0.3;
  const [c0, c1] = s.cut ?? [0.8, 1.0];
  const sk = s.skew ?? [0, 0, 0];
  const planes: Plane[] = [];
  for (const base of fibSphere(s.n, rng)) {
    const n = vnorm([base[0] + (rng.next() - 0.5) * 2 * jit, base[1] + (rng.next() - 0.5) * 2 * jit, base[2] + (rng.next() - 0.5) * 2 * jit]);
    const sup = Math.sqrt((rx * n[0]) ** 2 + (ry * n[1]) ** 2 + (rz * n[2]) ** 2);
    planes.push({ n, d: sup * rng.range(c0, c1) * Math.max(0.5, 1 + vdot(n, sk)) });
  }
  const chips = s.chips ?? 0;
  if (chips > 0) {
    const [k0, k1] = s.chipDepth ?? [0.06, 0.22];
    for (let i = 0; i < chips; i++) {
      const verts = hullVerts(hull(planes, Math.max(rx, ry, rz) * 6));
      const v = verts[Math.floor(rng.next() * verts.length)]!;
      const n = vnorm([v[0] / rx ** 2 + (rng.next() - 0.5) * 0.2, v[1] / ry ** 2 + (rng.next() - 0.5) * 0.2, v[2] / rz ** 2 + (rng.next() - 0.5) * 0.2]);
      planes.push({ n, d: vdot(n, v) - rng.range(k0, k1) * Math.min(rx, ry, rz) });
    }
  }
  return planes;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// emit faces into a PropMesh

export interface RoughOpts {
  /** edge-midpoint displacement along the radial direction as a fraction of the edge length (+ = bulge out, biased) */
  edge?: number;
  /** only edges at least this long (m) get a midpoint */
  minEdge?: number;
  /** face-centre displacement along the face normal as a fraction of the face radius (random sign biased outward) */
  centre?: number;
  seed?: number;
}

export interface AddHullOpts {
  /** material index, or per face */
  mat: number | ((f: Face) => number);
  /** skip faces with these tags (default: ground) */
  skip?: number[];
  /** optional vertex transform */
  xf?: (p: Vec3) => Vec3;
  /** hand-chiselled irregularity: bumpy edges and shallow pyramid faces (keeps edges crisp, breaks the CAD-polyhedron look) */
  rough?: RoughOpts;
}

const hash1 = (x: number, y: number, z: number, seed: number): number => {
  let h = (Math.imul(Math.round(x * 4096), 374761393) + Math.imul(Math.round(y * 4096), 668265263) + Math.imul(Math.round(z * 4096), 1274126177) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function addFaces(m: PropMesh, faces: readonly Face[], o: AddHullOpts): void {
  const skip = new Set(o.skip ?? [TAG_GROUND]);
  const rough = o.rough;
  // solid centre for radial edge displacement
  const ctr: Vec3 = [0, 0, 0];
  let nv = 0;
  for (const f of faces) for (const p of f.poly) { ctr[0] += p[0]; ctr[1] += p[1]; ctr[2] += p[2]; nv++; }
  if (nv) { ctr[0] /= nv; ctr[1] /= nv; ctr[2] /= nv; }
  for (const f0 of faces) {
    if (skip.has(f0.tag)) continue;
    let poly: Vec3[] = o.xf ? f0.poly.map(o.xf) : f0.poly;
    let seam: boolean[] | undefined = f0.seam;
    if (poly.length < 3) continue;
    if (rough?.edge) {
      const np: Vec3[] = [];
      const ns: boolean[] = [];
      const minE = rough.minEdge ?? 0.16;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
        np.push(a);
        ns.push(seam?.[i] ?? false);
        const el = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (el >= minE && !(a[1] < 0.01 && b[1] < 0.01)) {
          // symmetric key: both faces sharing this edge compute the same midpoint
          const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          const hsh = hash1(mid[0], mid[1], mid[2], rough.seed ?? 1);
          const rad = vnorm(vsub(mid, ctr));
          const amt = (hsh - 0.3) * rough.edge * el;
          np.push([mid[0] + rad[0] * amt, Math.max(0, mid[1] + rad[1] * amt), mid[2] + rad[2] * amt]);
          ns.push(seam?.[i] ?? false);
        }
      }
      poly = np;
      seam = ns;
    }
    const k = poly.length;
    const c: Vec3 = [0, 0, 0];
    for (const p of poly) { c[0] += p[0] / k; c[1] += p[1] / k; c[2] += p[2] / k; }
    if (rough?.centre) {
      let rad = 0;
      for (const p of poly) rad = Math.max(rad, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
      const nrm = f0.n;
      const hsh = hash1(c[0], c[1], c[2], (rough.seed ?? 1) + 7);
      const amt = (hsh - 0.3) * rough.centre * rad;
      c[0] += nrm[0] * amt; c[1] += nrm[1] * amt; c[2] += nrm[2] * amt;
    }
    const mat = typeof o.mat === 'number' ? o.mat : o.mat(f0);
    for (let i = 0; i < k; i++) {
      const a = poly[i]!, b = poly[(i + 1) % k]!;
      const e = vsub(b, a);
      const el = vlen(e);
      if (el < 1e-7) continue;
      let h = vlen(vcross(e, vsub(c, a))) / el;
      h = Math.max(h, 1e-4);
      const sgn = seam?.[i] ? -1 : 1;
      m.tri(c, a, b, [1, sgn * h], [0, sgn * h], [0, sgn * h], mat);
    }
  }
}

/** distance (m) from the nearest rim edge of the face this texel lies on, and whether that edge is a seam */
export const hullEdge = (uv: readonly [number, number]): { d: number; seam: boolean } => ({ d: uv[0] * Math.abs(uv[1]), seam: uv[1] < 0 });

// ---------------------------------------------------------------------------------------------------------------------------------
// fractured cells (Voronoi): a hull split into crust plates separated by gaps

export interface CellSpec {
  /** outer planes of the whole body (already in world space) */
  outer: Plane[];
  /** cell seed points */
  seeds: Vec3[];
  /** gap width between neighbouring cells (m) */
  gap: number;
  /** extent of the start box */
  R?: number;
}

/** cells of a body split by bisector planes; faces made by a bisector carry TAG_GAP, and rim edges next to them are seam edges */
export function cells(s: CellSpec): Face[][] {
  const out: Face[][] = [];
  for (let i = 0; i < s.seeds.length; i++) {
    const si = s.seeds[i]!;
    const planes: Plane[] = [...s.outer];
    for (let j = 0; j < s.seeds.length; j++) {
      if (j === i) continue;
      const sj = s.seeds[j]!;
      const n = vnorm(vsub(sj, si));
      const mid: Vec3 = [(si[0] + sj[0]) / 2, (si[1] + sj[1]) / 2, (si[2] + sj[2]) / 2];
      planes.push({ n, d: vdot(n, mid) - s.gap / 2, tag: TAG_GAP });
    }
    const faces = hull(planes, s.R ?? 20);
    markSeams(faces);
    out.push(faces);
  }
  return out;
}

/** flag rim edges that border a TAG_GAP face (for gap faces themselves nothing is flagged) */
export function markSeams(faces: Face[]): void {
  for (const f of faces) f.seam = f.poly.map(() => false);
  for (let a = 0; a < faces.length; a++) {
    const fa = faces[a]!;
    for (let i = 0; i < fa.poly.length; i++) {
      const p = fa.poly[i]!, q = fa.poly[(i + 1) % fa.poly.length]!;
      for (let b = 0; b < faces.length; b++) {
        if (b === a) continue;
        const fb = faces[b]!;
        if (fb.tag !== TAG_GAP) continue;
        const hasP = fb.poly.some((x) => d2(x, p) < 1e-9);
        const hasQ = fb.poly.some((x) => d2(x, q) < 1e-9);
        if (hasP && hasQ) fa.seam![i] = true;
      }
    }
  }
}

export { EPS };

// ---------------------------------------------------------------------------------------------------------------------------------
// block rocks: a slightly skewed box whose corners and edges are shaved by planes of very different depth, so a stone has a few
// broad faces and several smaller bevel-like facets (quarry-chunk / hewn-boulder look instead of an even polyhedron)

export interface BlockSpec {
  /** half extents (x, y, z) of the base box */
  size: Vec3;
  /** skew of the six base planes (0 = axis aligned) */
  tilt?: number;
  /** corner / edge shaving planes */
  cuts: number;
  /** shave depth range as a fraction of the smallest half extent */
  depth?: [number, number];
  /** probability that a shave follows an edge (bisector of two base faces) rather than a corner */
  edgeBias?: number;
  /** only shave in directions with y >= this (e.g. -0.2 keeps the underside flat) */
  minY?: number;
}

export function blockPlanes(rng: Rng, s: BlockSpec): Plane[] {
  const [hx, hy, hz] = s.size;
  const t = s.tilt ?? 0.16;
  const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const planes: Plane[] = dirs.map((n) => {
    const nn = vnorm([n[0] + (rng.next() - 0.5) * 2 * t, n[1] + (rng.next() - 0.5) * 2 * t, n[2] + (rng.next() - 0.5) * 2 * t]);
    const ext = Math.abs(n[0]) * hx + Math.abs(n[1]) * hy + Math.abs(n[2]) * hz;
    return { n: nn, d: ext * rng.range(0.94, 1.04) };
  });
  const [dLo, dHi] = s.depth ?? [0.1, 0.5];
  const mn = Math.min(hx, hy, hz);
  for (let i = 0; i < s.cuts; i++) {
    let n: Vec3;
    let guard = 0;
    do {
      if (rng.next() < (s.edgeBias ?? 0.45)) {
        const a = dirs[Math.floor(rng.next() * 6)]!, b = dirs[Math.floor(rng.next() * 6)]!;
        n = vnorm([a[0] + b[0] + (rng.next() - 0.5) * 0.3, a[1] + b[1] + (rng.next() - 0.5) * 0.3, a[2] + b[2] + (rng.next() - 0.5) * 0.3]);
        if (Math.hypot(a[0] + b[0], a[1] + b[1], a[2] + b[2]) < 0.5) n = vnorm([1, 1, 1]);
      } else {
        n = vnorm([(rng.next() - 0.5) * 2, (rng.next() - 0.5) * 2, (rng.next() - 0.5) * 2]);
      }
    } while (n[1] < (s.minY ?? -1) && guard++ < 30);
    const verts = hullVerts(hull(planes, 20));
    let sup = -1e9;
    for (const v of verts) sup = Math.max(sup, vdot(n, v));
    planes.push({ n, d: sup - rng.range(dLo, dHi) * mn });
  }
  return planes;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// crystals / shards: an irregular prismatic shaft that tapers, closed by a few steep tip facets

export interface CrystalSpec {
  /** apex height (y up, base at y = 0) */
  h: number;
  /** mean shaft radius at the base */
  r: number;
  /** shaft facet count (4-8) */
  sides: number;
  /** shaft width at the apex as a fraction of the base width (0.1 = needle, 0.9 = nearly a prism) */
  narrow?: number;
  /** length of the closing termination (m) measured up the axis from the point where the shaft planes end */
  tipLen?: number;
  /** number of tip facets (1 = chisel, 2 = ridge, 3-4 = pyramid) */
  tip?: number;
  /** per-side radius irregularity 0..0.5 and angular jitter 0..0.5 */
  irregular?: number;
  /** cross-section elongation 0..0.8 (blade-like shards) along a random direction */
  aspect?: number;
  /** apex offset (fraction of r) so the point is not centred */
  offset?: number;
  /** where the base ends (negative = buried below the origin) */
  bottom?: number;
}

/** an irregular prismatic crystal: tapering shaft planes closed by a few slanted termination facets (apex at height h) */
export function crystalPlanes(rng: Rng, s: CrystalSpec): Plane[] {
  const planes: Plane[] = [];
  const irr = s.irregular ?? 0.25;
  const asp = s.aspect ?? 0;
  const tipLen = s.tipLen ?? s.r * 1.3;
  const shaftH = Math.max(0.05, s.h - tipLen);
  const tau = Math.atan((s.r * (1 - (s.narrow ?? 0.4))) / shaftH);
  const ct = Math.cos(tau), st = Math.sin(tau);
  const start = rng.next() * Math.PI * 2;
  const ph0 = rng.next() * Math.PI;
  for (let k = 0; k < s.sides; k++) {
    const phi = start + ((k + (rng.next() - 0.5) * irr * 1.2) / s.sides) * Math.PI * 2;
    const rk = s.r * (1 + (rng.next() - 0.5) * 2 * irr) * (1 + asp * Math.cos(2 * (phi - ph0)));
    planes.push({ n: [Math.cos(phi) * ct, st, Math.sin(phi) * ct], d: rk * ct });
  }
  planes.push({ n: [0, -1, 0], d: -(s.bottom ?? 0) });
  const nt = s.tip ?? 3;
  const ox = (rng.next() - 0.5) * 2 * (s.offset ?? 0.25) * s.r * (1 - (s.narrow ?? 0.4)), oz = (rng.next() - 0.5) * 2 * (s.offset ?? 0.25) * s.r * (1 - (s.narrow ?? 0.4));
  const ps = rng.next() * Math.PI * 2;
  // termination planes pass through the apex and fall to the shaft end (normal elevation = 90deg - slope, slope = atan(tipLen / half width))
  const half = s.r * (s.narrow ?? 0.4);
  const al = Math.atan2(Math.max(0.02, half), tipLen);
  for (let k = 0; k < nt; k++) {
    const psi = ps + ((k + (rng.next() - 0.5) * 0.5) / nt) * Math.PI * 2;
    const a = al * rng.range(0.8, 1.2);
    const n: Vec3 = [Math.cos(psi) * Math.cos(a), Math.sin(a), Math.sin(psi) * Math.cos(a)];
    planes.push({ n, d: vdot(n, [ox, s.h, oz]) });
  }
  return planes;
}
