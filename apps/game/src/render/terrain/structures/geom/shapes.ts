// Primitives on top of MeshBuilder.grid: bevelled/tapered boxes, lathes with automatic crease splitting, polygon
// lofts, swept tubes, ellipsoids and shape extrusion. All coordinates are in the builder's current local frame.
import { Color, ExtrudeGeometry, Shape, SplineCurve, Vector2 } from 'three';
import type { GridOpts, MeshBuilder, Paint, Vec2, Vec3 } from './builder';

export type Profile = ReadonlyArray<readonly [number, number]>;

const TAU = Math.PI * 2;

// --- loft / caps -------------------------------------------------------------------------------------------------

export interface LoftOpts extends GridOpts {
  /** rings are closed loops (default true) */
  closed?: boolean;
}

/**
 * Skins a stack of equally sized point rings (ring 0 → ring n-1 is the v direction). Closed rings that run
 * counter-clockwise seen from +Y with rings ascending face outward.
 */
export function loft(b: MeshBuilder, rings: ReadonlyArray<ReadonlyArray<Vec3>>, p: Paint, o: LoftOpts = {}): void {
  const first = rings[0];
  if (!first || rings.length < 2) return;
  const n = first.length;
  const closed = o.closed !== false;
  const nu = closed ? n : n - 1;
  b.grid(
    nu,
    rings.length - 1,
    (u, v, out) => {
      const i = Math.round(u * nu) % n;
      const ring = rings[Math.round(v * (rings.length - 1))] as ReadonlyArray<Vec3>;
      const q = ring[i] as Vec3;
      out[0] = q[0];
      out[1] = q[1];
      out[2] = q[2];
    },
    p,
    { ...o, closedU: o.closedU ?? closed },
  );
}

/** cap over a ring (`up` = faces +axis for a ring ordered as in `loft`): one quad for 4 points, else a fan to `centre` */
export function cap(b: MeshBuilder, ring: ReadonlyArray<Vec3>, centre: Vec3, up: boolean, p: Paint, o: GridOpts = {}): void {
  const n = ring.length;
  if (n === 4) {
    const [p0, p1, p2, p3] = ring as [Vec3, Vec3, Vec3, Vec3];
    b.grid(
      1,
      1,
      (u, v, out) => {
        for (let k = 0; k < 3; k++) out[k] = (p0[k] as number) * (1 - u) * (1 - v) + (p1[k] as number) * u * (1 - v) + (p2[k] as number) * u * v + (p3[k] as number) * (1 - u) * v;
      },
      p,
      { faceted: true, flip: !up, ...o },
    );
    return;
  }
  b.grid(
    n,
    1,
    (u, v, out) => {
      const q = ring[Math.round(u * n) % n] as Vec3;
      out[0] = q[0] + (centre[0] - q[0]) * v;
      out[1] = q[1] + (centre[1] - q[1]) * v;
      out[2] = q[2] + (centre[2] - q[2]) * v;
    },
    p,
    { faceted: true, flip: !up, ...o },
  );
}

// --- box -----------------------------------------------------------------------------------------------------------

export interface BoxOpts {
  /** chamfer of the four long edges in metres (0 = sharp box) */
  bevel?: number;
  /** size [a, b] of the +axis end for tapered blocks (axis y only: [w, d]) */
  top?: readonly [number, number];
  /** direction the block runs along: 0 x, 1 y, 2 z (default: the longest dimension, y when roughly cubic) */
  axis?: 0 | 1 | 2;
  /** build the start end face (default: only when the axis is not y: beam ends show, bases are buried) */
  bottom?: boolean;
  /** skip the +axis end face (when something sits on it) */
  noTop?: boolean;
  /** brightness added on chamfer faces: edge wear */
  wear?: number;
  /** bottom y (default 0) */
  y0?: number;
  /** brightness at the bottom / top end (baked gradient along y) */
  shadeY?: readonly [number, number];
}

/** uv for a box face: v runs along the long axis, u across, both in metres (wood grain follows v) */
export function boxUv(p: Vec3, n: Vec3, axis: number): Vec2 {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const na = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  if (na === axis) {
    const a = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    return [p[a] as number, p[c] as number];
  }
  const other = 3 - na - axis;
  return [p[other] as number, p[axis] as number];
}

/**
 * Cross-section ring (4 points sharp, 8 chamfered) of a prism running along `axis` at position t. The point order makes
 * lofts ascending along +axis face outward (see loft).
 */
function section(axis: number, ha: number, hb: number, c: number, t: number, cy: number): Vec3[] {
  let pts: Array<[number, number]>;
  if (axis === 1) {
    pts = c > 0 ? [[-ha + c, hb], [ha - c, hb], [ha, hb - c], [ha, -hb + c], [ha - c, -hb], [-ha + c, -hb], [-ha, -hb + c], [-ha, hb - c]] : [[-ha, hb], [ha, hb], [ha, -hb], [-ha, -hb]];
    return pts.map(([p, q]) => [p, t, q] as Vec3);
  }
  if (axis === 0) {
    // (p, q) = (z, y): half sizes ha along z, hb along y
    pts = c > 0 ? [[-ha + c, hb], [ha - c, hb], [ha, hb - c], [ha, -hb + c], [ha - c, -hb], [-ha + c, -hb], [-ha, -hb + c], [-ha, hb - c]] : [[-ha, hb], [ha, hb], [ha, -hb], [-ha, -hb]];
    return pts.map(([p, q]) => [t, q + cy, p] as Vec3);
  }
  // axis z: (p, q) = (x, y)
  pts = c > 0 ? [[ha, -hb + c], [ha, hb - c], [ha - c, hb], [-ha + c, hb], [-ha, hb - c], [-ha, -hb + c], [-ha + c, -hb], [ha - c, -hb]] : [[ha, -hb], [ha, hb], [-ha, hb], [-ha, -hb]];
  return pts.map(([p, q]) => [p, q + cy, t] as Vec3);
}

/** box standing on y0, centred in x/z; w along x, h up, d along z */
export function box(b: MeshBuilder, w: number, h: number, d: number, p: Paint, o: BoxOpts = {}): void {
  const y0 = o.y0 ?? 0;
  const axis = o.axis ?? (h >= Math.max(w, d) * 0.8 ? 1 : w >= d ? 0 : 2);
  const [ta, tb] = o.top ?? (axis === 1 ? [w, d] : [0, 0]);
  const bev = Math.min(o.bevel ?? 0, w * 0.45, h * 0.45, d * 0.45);
  const c = bev < 0.004 ? 0 : bev;
  const [sb, st] = o.shadeY ?? [1, 1];
  const wear = o.wear ?? 0.12;
  const uv = (_u: number, _v: number, q: Vec3, n: Vec3): Vec2 => boxUv(q, n, axis);
  const gShade = (q: Vec3, cell: number): number => {
    const t = h > 1e-6 ? (q[1] - y0) / h : 0;
    const base = sb + (st - sb) * Math.max(0, Math.min(1, t));
    return c > 0 && cell % 2 === 1 ? base * (1 + wear) : base;
  };
  let r0: Vec3[];
  let r1: Vec3[];
  if (axis === 1) {
    r0 = section(1, w / 2, d / 2, c, y0, 0);
    r1 = section(1, ta / 2, tb / 2, c, y0 + h, 0);
  } else if (axis === 0) {
    r0 = section(0, d / 2, h / 2, c, -w / 2, y0 + h / 2);
    r1 = section(0, d / 2, h / 2, c, w / 2, y0 + h / 2);
  } else {
    r0 = section(2, w / 2, h / 2, c, -d / 2, y0 + h / 2);
    r1 = section(2, w / 2, h / 2, c, d / 2, y0 + h / 2);
  }
  loft(b, [r0, r1], p, { faceted: true, uv, shade: (_u, _v, q, cell) => gShade(q, cell) });
  const centre = (r: Vec3[]): Vec3 => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const q of r) {
      x += q[0];
      y += q[1];
      z += q[2];
    }
    return [x / r.length, y / r.length, z / r.length];
  };
  if (!o.noTop) cap(b, r1, centre(r1), true, p, { uv });
  if (o.bottom ?? axis !== 1) cap(b, r0, centre(r0), false, p, { uv });
}

/** `box` placed at (x, y, z) with optional yaw: shorthand for at() / box() / pop() */
export function boxAt(b: MeshBuilder, x: number, y: number, z: number, w: number, h: number, d: number, p: Paint, o: BoxOpts = {}, yaw = 0): void {
  b.at(x, y, z, yaw);
  box(b, w, h, d, p, o);
  b.pop();
}

// --- lathe ---------------------------------------------------------------------------------------------------------

export interface LatheOpts {
  /** flat-shaded n-gon facets */
  faceted?: boolean;
  /** start angle (rad) */
  phase?: number;
  /** z / x radius ratio (ellipse) */
  sz?: number;
  /** profile corners sharper than this (degrees) are split into hard edges */
  crease?: number;
  /** brightness by position */
  shade?: (p: Vec3) => number;
  /** colour edit by position */
  color?: (p: Vec3, out: Color) => void;
  /** emission by position */
  emis?: (p: Vec3) => number;
  /** multiplies the uv scale (default 1 = metres) */
  uvScale?: number;
}

/**
 * Surface of revolution around +Y. `prof` = [radius, y] points; walking the profile with the solid on the LEFT
 * (bottom centre → outwards → up → inwards at the top) yields outward normals. Hard corners split automatically.
 */
export function lathe(b: MeshBuilder, prof: Profile, segs: number, p: Paint, o: LatheOpts = {}): void {
  const n = prof.length;
  if (n < 2) return;
  const crease = Math.cos(((o.crease ?? 38) * Math.PI) / 180);
  const arc: number[] = [0];
  const nrm: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = prof[i] as readonly [number, number];
    const c = prof[i + 1] as readonly [number, number];
    const dr = c[0] - a[0];
    const dy = c[1] - a[1];
    const l = Math.hypot(dr, dy) || 1e-9;
    arc.push((arc[i] as number) + l);
    nrm.push([dy / l, -dr / l]);
  }
  // split runs where consecutive segment normals diverge
  const runs: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = nrm[i - 1] as Vec2;
    const c = nrm[i] as Vec2;
    if (a[0] * c[0] + a[1] * c[1] < crease) {
      runs.push([start, i]);
      start = i;
    }
  }
  runs.push([start, n - 1]);
  const phase = o.phase ?? 0;
  const sz = o.sz ?? 1;
  const uvs = o.uvScale ?? 1;
  const { shade: sh, color: co, emis: em } = o;
  for (const [s0, s1] of runs) {
    const len = s1 - s0;
    let rMax = 0;
    for (let i = s0; i <= s1; i++) rMax = Math.max(rMax, (prof[i] as readonly [number, number])[0]);
    if (rMax < 1e-5) continue;
    b.grid(
      segs,
      len,
      (u, v, out) => {
        const pt = prof[s0 + Math.round(v * len)] as readonly [number, number];
        const a = phase + u * TAU;
        out[0] = pt[0] * Math.cos(a);
        out[1] = pt[1];
        out[2] = -pt[0] * Math.sin(a) * sz;
      },
      p,
      {
        closedU: true,
        faceted: o.faceted,
        uv: (u, v) => [u * TAU * rMax * uvs, (arc[s0 + Math.round(v * len)] as number) * uvs],
        shade: sh ? (_u, _v, q) => sh(q) : undefined,
        color: co ? (_u, _v, q, out) => co(q, out) : undefined,
        emis: em ? (_u, _v, q) => em(q) : undefined,
      },
    );
  }
}

/** vertical cylinder from y0 to y0+h with optional bevel rings; closed top, bottom optional */
export function cylinder(b: MeshBuilder, r: number, h: number, segs: number, p: Paint, o: LatheOpts & { bottom?: boolean; r2?: number; y0?: number } = {}): void {
  const y0 = o.y0 ?? 0;
  const r2 = o.r2 ?? r;
  const prof: Array<[number, number]> = [];
  if (o.bottom) prof.push([0, y0]);
  prof.push([r, y0], [r2, y0 + h], [0, y0 + h]);
  lathe(b, prof, segs, p, o);
}

/** ellipsoid centred at the origin */
export function ellipsoid(b: MeshBuilder, rx: number, ry: number, rz: number, p: Paint, o: LatheOpts & { rings?: number; segs?: number } = {}): void {
  const rings = o.rings ?? 6;
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * Math.PI;
    prof.push([rx * Math.sin(a), -ry * Math.cos(a)]);
  }
  lathe(b, prof, o.segs ?? 10, p, { ...o, sz: rz / rx, crease: 180 });
}

/** radius profile with entasis (belly) for a column: r0 at the foot, r1 at the neck */
export function entasisProfile(r0: number, r1: number, y0: number, h: number, steps = 6, belly = 0.05): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // straight taper plus a gentle bulge peaking in the lower third
    const bulge = belly * r0 * Math.sin(Math.PI * Math.pow(t, 0.75));
    out.push([r0 + (r1 - r0) * t + bulge, y0 + h * t]);
  }
  return out;
}

/** flat panel facing +Z: lower-left corner (x, y) at depth z, size w × h (decals, glyph strokes, inlays) */
export function quadZ(b: MeshBuilder, x: number, y: number, w: number, h: number, z: number, p: Paint, o: GridOpts = {}): void {
  b.grid(1, 1, (u, v, out) => {
    out[0] = x + w * u;
    out[1] = y + h * v;
    out[2] = z;
  }, p, { faceted: true, uv: (u, v) => [u * w, v * h], ...o });
}

// --- swept tube ------------------------------------------------------------------------------------------------------

export interface TubeOpts extends GridOpts {
  /** close both ends with a point (default true) */
  caps?: boolean;
  /** extra rotation of the cross-section start (rad) */
  twist?: number;
}

/** circular section swept along `path` (parallel-transport frames); radius may vary along t ∈ [0,1] */
export function tube(b: MeshBuilder, path: ReadonlyArray<Vec3>, radius: number | ((t: number) => number), sides: number, p: Paint, o: TubeOpts = {}): void {
  const n = path.length;
  if (n < 2) return;
  const T: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)] as Vec3;
    const c = path[Math.min(n - 1, i + 1)] as Vec3;
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const dz = c[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    T.push([dx / l, dy / l, dz / l]);
  }
  const Nv: Vec3[] = [];
  const Bv: Vec3[] = [];
  const t0 = T[0] as Vec3;
  // initial normal: world axis least aligned with the tangent
  const h: Vec3 = Math.abs(t0[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  let nx = h[1] * t0[2] - h[2] * t0[1];
  let ny = h[2] * t0[0] - h[0] * t0[2];
  let nz = h[0] * t0[1] - h[1] * t0[0];
  let nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  for (let i = 0; i < n; i++) {
    const t = T[i] as Vec3;
    const d = nx * t[0] + ny * t[1] + nz * t[2];
    nx -= d * t[0];
    ny -= d * t[1];
    nz -= d * t[2];
    nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    Nv.push([nx, ny, nz]);
    Bv.push([t[1] * nz - t[2] * ny, t[2] * nx - t[0] * nz, t[0] * ny - t[1] * nx]);
  }
  const caps = o.caps !== false;
  const total = n + (caps ? 2 : 0);
  const rad = typeof radius === 'number' ? () => radius : radius;
  const twist = o.twist ?? 0;
  b.grid(
    sides,
    total - 1,
    (u, v, out) => {
      let k = Math.round(v * (total - 1));
      let r: number;
      if (caps && (k === 0 || k === total - 1)) {
        const e = k === 0 ? 0 : n - 1;
        k = e;
        r = 0;
      } else {
        k -= caps ? 1 : 0;
        r = rad(k / (n - 1));
      }
      const a = twist + u * TAU;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      const q = path[k] as Vec3;
      const nn = Nv[k] as Vec3;
      const bb = Bv[k] as Vec3;
      out[0] = q[0] + nn[0] * c + bb[0] * s;
      out[1] = q[1] + nn[1] * c + bb[1] * s;
      out[2] = q[2] + nn[2] * c + bb[2] * s;
    },
    p,
    { ...o, closedU: true },
  );
}

/**
 * Flat strip following `path`, `width` wide (constant or by t ∈ [0,1]); its normal is `up` (flip for the other side).
 * Used for cracks, inlays, banners, cloth and trim.
 */
export function ribbon(b: MeshBuilder, path: ReadonlyArray<Vec3>, width: number | ((t: number) => number), up: Vec3, p: Paint, o: GridOpts = {}): void {
  const n = path.length;
  if (n < 2) return;
  const w = typeof width === 'number' ? () => width : width;
  b.grid(
    n - 1,
    1,
    (u, v, out) => {
      const k = Math.round(u * (n - 1));
      const a = path[Math.max(0, k - 1)] as Vec3;
      const c = path[Math.min(n - 1, k + 1)] as Vec3;
      const tx = c[0] - a[0];
      const ty = c[1] - a[1];
      const tz = c[2] - a[2];
      // side = up × tangent
      let sx = up[1] * tz - up[2] * ty;
      let sy = up[2] * tx - up[0] * tz;
      let sz = up[0] * ty - up[1] * tx;
      const l = Math.hypot(sx, sy, sz) || 1;
      sx /= l;
      sy /= l;
      sz /= l;
      const half = (w(k / (n - 1)) * (v - 0.5)) ;
      const q = path[k] as Vec3;
      out[0] = q[0] + sx * half;
      out[1] = q[1] + sy * half;
      out[2] = q[2] + sz * half;
    },
    p,
    { uv: (u, v) => [u * n * 0.5, v], ...o },
  );
}

/** points of a Catmull-Rom spline through `pts` (3D), `per` samples per span */
export function spline3(pts: ReadonlyArray<Vec3>, per = 6): Vec3[] {
  const out: Vec3[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)] as Vec3;
    const p1 = pts[i] as Vec3;
    const p2 = pts[i + 1] as Vec3;
    const p3 = pts[Math.min(n - 1, i + 2)] as Vec3;
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, c: number, d: number, e: number): number => 0.5 * (2 * c + (-a + d) * t + (2 * a - 5 * c + 4 * d - e) * t2 + (-a + 3 * c - 3 * d + e) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
    }
  }
  out.push([...(pts[n - 1] as Vec3)] as Vec3);
  return out;
}

// --- extrusion -------------------------------------------------------------------------------------------------------

/** outline [x,y] extruded along z (centred on z = 0); bevel > 0 rounds the rim */
export function extrude(b: MeshBuilder, outline: ReadonlyArray<readonly [number, number]>, depth: number, p: Paint, o: { bevel?: number; shade?: (q: Vec3) => number } = {}): void {
  const shape = new Shape();
  outline.forEach((q, i) => (i === 0 ? shape.moveTo(q[0], q[1]) : shape.lineTo(q[0], q[1])));
  extrudeShape(b, shape, depth, p, o);
}

export function extrudeShape(b: MeshBuilder, shape: Shape, depth: number, p: Paint, o: { bevel?: number; shade?: (q: Vec3) => number } = {}): void {
  const bevel = o.bevel ?? 0;
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    curveSegments: 8,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  b.addGeometry(g, p, o.shade);
  g.dispose();
}

/** smooth 2D outline through control points (Catmull-Rom) */
export function spline2(pts: ReadonlyArray<readonly [number, number]>, samples: number): Vec2[] {
  const c = new SplineCurve(pts.map((q) => new Vector2(q[0], q[1])));
  return c.getPoints(samples).map((q) => [q.x, q.y] as Vec2);
}

/** deterministic pseudo-noise in [-1, 1] from a 2D position (jagged breaks, glyph jitter) */
export function jag(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
