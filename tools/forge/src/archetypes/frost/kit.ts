// Frost kit: SDF helpers shared by the yeti and the frost giant. Everything is world metres, +Z forward, +X = character's left.
//   rc / el / rbox / U       shorthands
//   Facets                   convex polytope as an intersection of half-spaces (crisp planar facets: ice, crystal, hewn wood)
//   crystal()                hexagonal prism with a pyramid tip (ice crystals / spikes); `jit` roughens the planes
//   chunk()                  irregular faceted lump (ice chunk / gem) = random half-spaces around an ellipsoid
//   lock()                   a shaggy fur lock: 2-3 segment flat tapered blade that curls toward a droop direction
//   surfaceAlong()           ray-march the body SDF from an inside point to its surface (fur roots, plate placement)
import { type Aabb, type Quat, type Vec3, qfromBasis, vadd, vcross, vdot, vlen, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Rng } from '../../core/rng.ts';
import { Sdf, smax } from '../../core/sdf/node.ts';
import { SmoothUnion, Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, RoundedBox } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';

export const rc = (a: Vec3, b: Vec3, ra: number, rb: number): Sdf => new RoundCone(a, b, ra, rb);
export const el = (c: Vec3, r: Vec3, rot?: Quat): Sdf => new Ellipsoid(c, r, rot);
export const rbox = (c: Vec3, half: Vec3, round: number, rot?: Quat): Sdf => new RoundedBox(c, half, round, rot);
export const U = (parts: Sdf[], w: number): Sdf => new SmoothUnion(parts.map((node) => ({ node, w })));

/** any unit vector perpendicular to v */
export function perp(v: Vec3): Vec3 {
  const ax: Vec3 = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return vnorm(vcross(v, ax));
}

/** orthonormal frame {x, y: dir, z} with y = dir and x as close to `side` as possible */
export function frame(dir: Vec3, side: Vec3 = [1, 0, 0]): { x: Vec3; y: Vec3; z: Vec3 } {
  const y = vnorm(dir);
  let x = vsub(side, vscale(y, vdot(side, y)));
  if (vlen(x) < 1e-6) x = perp(y);
  x = vnorm(x);
  return { x, y, z: vcross(x, y) };
}

/** rotation whose local +Z is `zAxis` and whose local +Y is as close to `up` as possible (orients flattened chunks / plates on a surface) */
export function orient(zAxis: Vec3, up: Vec3 = [0, 1, 0]): Quat {
  const z = vnorm(zAxis);
  let y = vsub(up, vscale(z, vdot(up, z)));
  if (vlen(y) < 1e-6) y = perp(z);
  y = vnorm(y);
  return qfromBasis(vcross(y, z), y, z);
}

// ------------------------------------------------------------------------------------------------ facets

export interface PlaneSpec {
  /** outward unit normal */
  n: Vec3;
  /** the solid is { p : dot(n, p) <= d } */
  d: number;
}

/** vertices of the polytope (every plane triple intersection that satisfies all planes) */
function polytopeVertices(planes: readonly PlaneSpec[]): Vec3[] {
  const out: Vec3[] = [];
  const n = planes.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = planes[i]!, b = planes[j]!, c = planes[k]!;
        const bc = vcross(b.n, c.n);
        const det = vdot(a.n, bc);
        if (Math.abs(det) < 1e-9) continue;
        const ca = vcross(c.n, a.n), ab = vcross(a.n, b.n);
        const p = vscale(vadd(vadd(vscale(bc, a.d), vscale(ca, b.d)), vscale(ab, c.d)), 1 / det);
        let ok = true;
        for (let m = 0; m < n && ok; m++) if (vdot(planes[m]!.n, p) > planes[m]!.d + 1e-6) ok = false;
        if (ok) out.push(p);
      }
    }
  }
  return out;
}

/** Convex polytope: d(p) = max_i (n_i . p - d_i). Exact inside, a lower bound outside. `blend` > 0 turns the max into a smooth max (rounded edges). */
export class Facets extends Sdf {
  private nx: Float64Array;
  private ny: Float64Array;
  private nz: Float64Array;
  private dd: Float64Array;
  private box: Aabb;
  constructor(planes: readonly PlaneSpec[], private readonly blend = 0) {
    super();
    this.nx = Float64Array.from(planes, (p) => p.n[0]);
    this.ny = Float64Array.from(planes, (p) => p.n[1]);
    this.nz = Float64Array.from(planes, (p) => p.n[2]);
    this.dd = Float64Array.from(planes, (p) => p.d);
    const vs = polytopeVertices(planes);
    if (vs.length === 0) throw new Error(`Facets: empty polytope (${planes.length} planes)`);
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i]!, v[i]!); mx[i] = Math.max(mx[i]!, v[i]!); }
    const pad = 0.002 + blend / 6;
    this.box = { min: [mn[0] - pad, mn[1] - pad, mn[2] - pad], max: [mx[0] + pad, mx[1] + pad, mx[2] + pad] };
  }
  d(x: number, y: number, z: number): number {
    const nx = this.nx, ny = this.ny, nz = this.nz, dd = this.dd;
    let m = nx[0]! * x + ny[0]! * y + nz[0]! * z - dd[0]!;
    const w = this.blend;
    for (let i = 1; i < nx.length; i++) {
      const v = nx[i]! * x + ny[i]! * y + nz[i]! * z - dd[i]!;
      m = w > 0 ? smax(m, v, w) : v > m ? v : m;
    }
    return m;
  }
  protected computeBounds(): Aabb {
    return this.box;
  }
}

export interface CrystalOpts {
  /** apothem of the hexagon at the base (m) */
  r: number;
  /** prism length before the pyramid tip (m) */
  len: number;
  /** pyramid tip height (m) */
  tip: number;
  /** cross-section sides (default 6) */
  sides?: number;
  /** rotation of the cross-section about the axis (rad) */
  twist?: number;
  /** 0..1 shrink of the apothem over the prism length (default 0.12) */
  taper?: number;
  /** plane noise: random tilt (rad) and offset (fraction of r) so facets are irregular */
  jit?: { rng: Rng; tilt?: number; off?: number };
  /** stretch of the cross-section along `base axis x` (1 = regular; <1 makes slab-like blades) */
  flat?: number;
  /** edge softening: smooth-max blend width (m); 0 = razor edges */
  round?: number;
}

/** Faceted ice crystal: tapered N-gon prism from `base` along `axis` with a pyramid tip. */
export function crystal(base: Vec3, axis: Vec3, o: CrystalOpts): Sdf {
  const sides = o.sides ?? 6;
  const f = frame(axis, [1, 0, 0]);
  const ax = f.y;
  const taper = o.taper ?? 0.12;
  const planes: PlaneSpec[] = [];
  const tilt = o.jit?.tilt ?? 0.06, off = o.jit?.off ?? 0.1;
  const j = (): number => (o.jit ? o.jit.rng.range(-1, 1) : 0);
  const fl = o.flat ?? 1;
  for (let k = 0; k < sides; k++) {
    const th = (o.twist ?? 0) + (Math.PI * 2 * k) / sides;
    // cross-section normal; `flat` squashes the section along local x (blade-like prisms)
    const ns = vadd(vscale(f.x, Math.cos(th)), vscale(f.z, Math.sin(th)));
    const rK = o.r * (1 + off * j()) * (1 + (fl - 1) * Math.cos(th) * Math.cos(th));
    const rKTop = rK * (1 - taper);
    // side plane through the base ring point and the top ring point (tilted by the taper)
    const tn = vnorm(vadd(vscale(ns, o.len), vscale(ax, rK - rKTop)));
    const sideN = jitter(tn, o.jit ? tilt * j() : 0, o.jit ? tilt * j() : 0, f);
    planes.push({ n: sideN, d: vdot(sideN, vadd(base, vscale(ns, rK))) });
    // pyramid tip plane through the apex and the top ring edge midpoint
    const ringMid = vadd(vadd(base, vscale(ax, o.len)), vscale(ns, rKTop));
    const apex = vadd(base, vscale(ax, o.len + o.tip));
    const tipN0 = vnorm(vadd(vscale(ns, o.tip), vscale(ax, rKTop)));
    const tipN = jitter(tipN0, o.jit ? tilt * j() : 0, o.jit ? tilt * j() : 0, f);
    planes.push({ n: tipN, d: Math.max(vdot(tipN, apex), vdot(tipN, ringMid)) });
  }
  planes.push({ n: vscale(ax, -1), d: -vdot(ax, base) });
  return new Facets(planes, o.round ?? 0);
}

function jitter(n: Vec3, a: number, b: number, f: { x: Vec3; y: Vec3; z: Vec3 }): Vec3 {
  if (a === 0 && b === 0) return n;
  return vnorm(vadd(n, vadd(vscale(f.x, a), vscale(f.z, b))));
}

export interface ChunkOpts {
  /** number of facets (8-14 reads as a hewn lump) */
  planes?: number;
  /** facet distance range as a fraction of the radius (smaller = more cut) */
  cut?: [number, number];
  /** rotation of the lump */
  rot?: Quat;
  /** edge softening in unit space (fraction of the radius, default 0.05) */
  round?: number;
}

/** Irregular faceted lump: random half-spaces tangent around an ellipsoid of radii `r`, centred on `c`. */
export function chunk(c: Vec3, r: Vec3, rng: Rng, o: ChunkOpts = {}): Sdf {
  const n = o.planes ?? 10;
  const cut = o.cut ?? [0.72, 0.95];
  const planes: PlaneSpec[] = [];
  // fibonacci-sphere normals with jitter keep the facet sizes balanced
  const golden = Math.PI * (3 - Math.sqrt(5));
  const off = rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = off + golden * i + rng.range(-0.25, 0.25);
    const v: Vec3 = vnorm([Math.cos(th) * rr + rng.range(-0.12, 0.12), y + rng.range(-0.1, 0.1), Math.sin(th) * rr + rng.range(-0.12, 0.12)]);
    planes.push({ n: v, d: rng.range(cut[0], cut[1]) });
  }
  return new Xform(new Facets(planes, o.round ?? 0.05), c, o.rot ?? [0, 0, 0, 1], r);
}

// ------------------------------------------------------------------------------------------------ fur

export interface LockOpts {
  /** growth direction at the root (unit) */
  dir: Vec3;
  /** direction the tip droops / curls toward (unit; usually gravity) */
  droop?: Vec3;
  /** 0..1 how far the tip bends toward `droop` */
  curl?: number;
  /** flat-face normal (usually the surface normal at the root) */
  facing: Vec3;
  len: number;
  /** half-width at the root (m) */
  w: number;
  /** thickness / width ratio at the root (0.3 = flat blade, 1 = round cone) */
  flat?: number;
  /** tip half-width (m) */
  tipW?: number;
  /** segments (2 or 3) */
  segs?: 2 | 3;
}

/** radius profile of a lock as fractions of the root half-width at the joints (tip is `tipW`): fat through the middle, pointed end */
const LOCK_PROFILE: Record<2 | 3, number[]> = { 2: [1, 0.9], 3: [1, 0.98, 0.86] };

/** A shaggy lock: a short chain of flattened round cones from the root along `dir`, bending toward `droop`. */
export function lock(root: Vec3, o: LockOpts): Sdf {
  const segs = o.segs ?? 2;
  const droop = o.droop ?? [0, -1, 0];
  const curl = o.curl ?? 0.5;
  const flat = Math.min(1, Math.max(0.08, o.flat ?? 0.4));
  const tipW = o.tipW ?? Math.max(o.w * 0.22, 0.006);
  const prof = LOCK_PROFILE[segs];
  const pts: Vec3[] = [root];
  let d = vnorm(o.dir);
  const step = o.len / segs;
  for (let i = 1; i <= segs; i++) {
    // bend a little more with every segment
    const k = curl * (i / segs) * (segs === 2 ? 0.9 : 0.7);
    d = vnorm(vlerp(d, droop, k));
    pts.push(vadd(pts[i - 1]!, vscale(d, step)));
  }
  const parts: Sdf[] = [];
  for (let i = 0; i < segs; i++) {
    const w0 = o.w * prof[i]!;
    const w1 = i + 1 < segs ? o.w * prof[i + 1]! : tipW;
    parts.push(flatCone(pts[i]!, pts[i + 1]!, w0, w1, flat, o.facing));
  }
  return U(parts, Math.max(o.w * 0.3, 0.004));
}

// ------------------------------------------------------------------------------------------------ surface queries

/** distance along `dir` from the inside point `o` to the SDF surface (null if `o` is outside or nothing is hit within `tMax`) */
export function surfaceAlong(sdf: Sdf, o: Vec3, dir: Vec3, tMax = 1.2): { p: Vec3; t: number } | null {
  const u = vnorm(dir);
  if (sdf.d(o[0], o[1], o[2]) > 0) return null;
  const h = 0.01;
  let t0 = 0;
  for (let t = h; t <= tMax; t += h) {
    const d = sdf.d(o[0] + u[0] * t, o[1] + u[1] * t, o[2] + u[2] * t);
    if (d >= 0) {
      let a = t0, b = t;
      for (let i = 0; i < 12; i++) {
        const m = (a + b) / 2;
        if (sdf.d(o[0] + u[0] * m, o[1] + u[1] * m, o[2] + u[2] * m) >= 0) b = m;
        else a = m;
      }
      const tt = (a + b) / 2;
      return { p: [o[0] + u[0] * tt, o[1] + u[1] * tt, o[2] + u[2] * tt], t: tt };
    }
    t0 = t;
  }
  return null;
}
