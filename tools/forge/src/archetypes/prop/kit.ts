// Architecture kit for props: lofted curved tile roofs (upturned eaves, hips, hip-and-gable), surfaces of revolution with
// per-angle modulation (lotus petals, fluting), pillars with entasis, bracket sets, stairs and ridge ornaments.
// Everything appends into a PropMesh; materials are indices into the model's `mats`.
import { HardMesh, bevelBox, extrude, lathe } from '../../core/hard/hardmesh.ts';
import { type Vec2 as H2, circleShape, ensureCCW, roundCorners } from '../../core/hard/shape2d.ts';
import { type Mat4, type Vec3, m4mul, m4translation, vcross, vdot, vlen, vnorm, vsub } from '../../core/math.ts';
import { type Mapper, type PropMesh, type Vec2, mapAuto, mapCylY } from './mesh.ts';

export const rotY = (a: number, t: Vec3 = [0, 0, 0]): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, t[0], t[1], t[2], 1];
};
export const place = (x: number, y: number, z: number, yaw = 0): Mat4 => (yaw === 0 ? m4translation([x, y, z]) : rotY(yaw, [x, y, z]));
export const compose = (...ms: Mat4[]): Mat4 => ms.reduce((a, b) => m4mul(a, b));

const sstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------------------------
// surfaces of revolution

/**
 * Lathe with radius modulation `mod(theta, y) -> factor` (lotus petals, fluting, scallops). `profile` = [r, y] bottom -> top,
 * smooth normals come from the crease-angle finish in PropMesh.
 */
export function revolve(profile: readonly H2[], segments: number, mod?: (theta: number, y: number) => number): HardMesh {
  const m = new HardMesh();
  const ring = (r: number, y: number, k: number): Vec3 => {
    const th = (k / segments) * Math.PI * 2;
    const f = mod ? mod(th, y) : 1;
    return [Math.cos(th) * r * f, y, -Math.sin(th) * r * f];
  };
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i]!, [r1, y1] = profile[i + 1]!;
    for (let k = 0; k < segments; k++) {
      const a = ring(r0, y0, k), b = ring(r0, y0, k + 1), c = ring(r1, y1, k + 1), d = ring(r1, y1, k);
      if (r0 < 1e-9 && r1 < 1e-9) continue;
      if (r0 < 1e-9) m.tri(a, c, d);
      else if (r1 < 1e-9) m.tri(a, b, d);
      else m.quad(a, b, c, d);
    }
  }
  return m;
}

/** add a lathe/revolve part with a cylinder mapper around its own axis */
export function addRevolved(m: PropMesh, mat: number, h: HardMesh, cx: number, cz: number, rMap: number, s: number, xf?: Mat4): void {
  m.add(h, mat, mapCylY(cx, cz, rMap, s), xf);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// roof loft

export interface RoofStage {
  /** slope parameter 0..1 where this keyframe sits (0 = eave, 1 = ridge) */
  f: number;
  /** corner positions (xz) at this keyframe, same count/order as the eave corners */
  corners: H2[];
}

export interface RoofSpec {
  /** eave outline corners (xz), counter-clockwise seen from above */
  corners: H2[];
  /** further keyframes (break rectangles, ridge targets); the last stage must be at f = 1 */
  stages: RoofStage[];
  /** eave height (top surface at the eave) */
  y0: number;
  /** total rise eave -> ridge */
  rise: number;
  /** height exponent: >1 concave (steeper near the ridge) */
  q?: number;
  /** rings along the slope (>= 3) */
  rings?: number;
  /** segments per edge (number or per-edge array) */
  segs?: number | number[];
  /** eave-corner uplift (m), outward flare (m) and reach (fraction of edge) */
  lift?: number;
  flare?: number;
  reach?: number;
  /** slab thickness at the eave (m) */
  thick?: number;
  /** how far the soffit runs inward before the wall hides it (m) */
  soffit?: number;
  /** keep the soffit's inner edge at the un-lifted eave height (y0 - thick) so lifted corners slope up from the wall instead of leaving a gap above it */
  soffitFlat?: boolean;
  /** tile size (m per uv unit) */
  tile: number;
  mats: { top: number; fascia: number; under: number };
  /** edges (by index) whose upper part is a vertical gable wall: gets `gable` mat instead of tiles when the stage x/z are constant */
  gable?: { edges: number[]; mat: number; fromF: number };
  /** the surface mapper used for gable walls */
  gableMap?: Mapper;
}

export interface RoofOut {
  /** eave outline points (top surface, ring 0), counter-clockwise */
  eave: Vec3[];
  /** per-corner path from the eave corner to the ridge target (top surface) */
  hips: Vec3[][];
  /** ridge/crest polyline for sweeps (tops of the last ring, closed loop of the last ring's points) */
  crest: Vec3[];
}

export function roofLoft(m: PropMesh, s: RoofSpec): RoofOut {
  const nc = s.corners.length;
  const R = Math.max(3, s.rings ?? 6);
  const q = s.q ?? 1.55;
  const lift = s.lift ?? 0, flare = s.flare ?? 0, reach = s.reach ?? 0.3, thick = s.thick ?? 0.14;
  const segsOf = (e: number): number => (Array.isArray(s.segs) ? s.segs[e] ?? 4 : s.segs ?? 4);
  const stages: RoofStage[] = [{ f: 0, corners: s.corners }, ...s.stages].sort((a, b) => a.f - b.f);
  // outward bisector per eave corner
  const outDir: Vec2[] = s.corners.map((c, i) => {
    const p = s.corners[(i + nc - 1) % nc]!, n = s.corners[(i + 1) % nc]!;
    const e0: Vec2 = [c[0] - p[0], c[1] - p[1]], e1: Vec2 = [n[0] - c[0], n[1] - c[1]];
    const n0: Vec2 = [e0[1], -e0[0]], n1: Vec2 = [e1[1], -e1[0]];
    const l0 = Math.hypot(n0[0], n0[1]) || 1, l1 = Math.hypot(n1[0], n1[1]) || 1;
    const d: Vec2 = [n0[0] / l0 + n1[0] / l1, n0[1] / l0 + n1[1] / l1];
    const l = Math.hypot(d[0], d[1]) || 1;
    return [d[0] / l, d[1] / l];
  });
  const cornersAt = (f: number): H2[] => {
    let a = stages[0]!, b = stages[stages.length - 1]!;
    for (let i = 0; i + 1 < stages.length; i++) {
      if (f >= stages[i]!.f && f <= stages[i + 1]!.f) { a = stages[i]!; b = stages[i + 1]!; break; }
    }
    const t = b.f > a.f ? (f - a.f) / (b.f - a.f) : 0;
    return a.corners.map((c, i) => [c[0] + (b.corners[i]![0] - c[0]) * t, c[1] + (b.corners[i]![1] - c[1]) * t] as H2);
  };
  // rings: [ring][point] with metadata
  interface Pt { p: Vec3; edge: number; j: number; u: number }
  const ringsTop: Pt[][] = [];
  const perim: number[] = [];
  const total = (e: number): number => segsOf(e);
  for (let k = 0; k <= R; k++) {
    const f = k / R;
    const cs = cornersAt(f);
    const h = s.y0 + s.rise * f ** q;
    const fade = (1 - f) ** 2.2;
    const ring: Pt[] = [];
    let u = 0;
    for (let e = 0; e < nc; e++) {
      const a = cs[e]!, b = cs[(e + 1) % nc]!;
      const m_ = total(e);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let j = 0; j < m_; j++) {
        const t = j / m_;
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const d = Math.min(t, 1 - t);
        const w = (1 - Math.min(1, d / reach)) ** 2.4;
        // outward direction blended between the two corners
        const o0 = outDir[e]!, o1 = outDir[(e + 1) % nc]!;
        const ox = o0[0] + (o1[0] - o0[0]) * t, oz = o0[1] + (o1[1] - o0[1]) * t;
        const ol = Math.hypot(ox, oz) || 1;
        // flare/lift act toward the nearest corner only (w peaks at the corner, vanishes mid-edge)
        const y = h + lift * w * fade;
        ring.push({ p: [x + (ox / ol) * flare * w * fade, y, z + (oz / ol) * flare * w * fade], edge: e, j, u: u + t * len });
      }
      u += len;
    }
    ringsTop.push(ring);
    perim.push(u);
  }
  const P = ringsTop[0]!.length;
  const tile = s.tile;
  // top surface quads (ring k -> k+1, point i -> i+1)
  const gable = s.gable;
  void s.rings;
  for (let k = 0; k < R; k++) {
    const r0 = ringsTop[k]!, r1 = ringsTop[k + 1]!;
    // cumulative slope distance per column (tile v)
    for (let i = 0; i < P; i++) {
      const i2 = (i + 1) % P;
      const a = r0[i]!, b = r0[i2]!, c = r1[i2]!, d = r1[i]!;
      const wrap = i2 === 0;
      // u = eave-ring column coordinate (constant along the slope so tile columns run eave -> ridge); v = distance down the slope
      const ua = ringsTop[0]![i]!.u / tile, ub = (wrap ? perim[0]! : ringsTop[0]![i2]!.u) / tile, uc = ub, ud = ua;
      const va = slopeDist(ringsTop, k, i) / tile, vb = slopeDist(ringsTop, k, i2) / tile, vc = slopeDist(ringsTop, k + 1, i2) / tile, vd = slopeDist(ringsTop, k + 1, i) / tile;
      const isGable = gable && gable.edges.includes(a.edge) && k / R >= gable.fromF - 1e-6;
      if (isGable) {
        // vertical gable wall: plane mapping
        const n = vnorm(vcross(vsub(b.p, a.p), vsub(c.p, a.p)));
        const mp = s.gableMap ?? mapAuto(1.2);
        const [t0, t1, t2] = mp(a.p, b.p, c.p, n);
        m.tri(a.p, b.p, c.p, t0, t1, t2, gable.mat);
        const [s0, s1, s2] = mp(a.p, c.p, d.p, n);
        m.tri(a.p, c.p, d.p, s0, s1, s2, gable.mat);
        continue;
      }
      // outline is CCW from above and rings go inward/up: (a,b,c,d) faces up/outward
      m.tri(a.p, b.p, c.p, [ua, va], [ub, vb], [uc, vc], s.mats.top);
      m.tri(a.p, c.p, d.p, [ua, va], [uc, vc], [ud, vd], s.mats.top);
    }
  }
  // fascia + soffit
  const r0 = ringsTop[0]!;
  const th = thick;
  for (let i = 0; i < P; i++) {
    const i2 = (i + 1) % P;
    const a = r0[i]!, b = r0[i2]!;
    const wrap = i2 === 0;
    const ua = a.u / tile, ub = (wrap ? perim[0]! : b.u) / tile;
    const al: Vec3 = [a.p[0], a.p[1] - th, a.p[2]], bl: Vec3 = [b.p[0], b.p[1] - th, b.p[2]];
    // fascia faces outward: quad (a_top, a_bot, b_bot, b_top) is CW seen from outside for CCW outline -> choose order accordingly
    m.tri(a.p, al, bl, [ua, 0], [ua, 1], [ub, 1], s.mats.fascia);
    m.tri(a.p, bl, b.p, [ua, 0], [ub, 1], [ub, 0], s.mats.fascia);
    // soffit: strip from the lower eave outline inward by `soffit`
    const inset = s.soffit ?? 0.6;
    const ia = inwardPoint(al, s.corners, inset), ib = inwardPoint(bl, s.corners, inset);
    if (s.soffitFlat) ia[1] = ib[1] = s.y0 - th;
    m.tri(al, ia, ib, [ua, 0], [ua, 1], [ub, 1], s.mats.under);
    m.tri(al, ib, bl, [ua, 0], [ub, 1], [ub, 0], s.mats.under);
  }
  // paths
  const hips: Vec3[][] = [];
  for (let e = 0; e < nc; e++) {
    const path: Vec3[] = [];
    let idx = 0;
    for (let c = 0; c < e; c++) idx += total(c);
    for (let k = 0; k <= R; k++) path.push(ringsTop[k]![idx]!.p);
    hips.push(path);
  }
  return { eave: r0.map((p) => p.p), hips, crest: ringsTop[R]!.map((p) => p.p) };
}

/** distance along the slope from the eave ring to ring k at column i (cumulative polyline length) */
function slopeDist(rings: { p: Vec3 }[][], k: number, i: number): number {
  let d = 0;
  for (let r = 0; r < k; r++) d += vlen(vsub(rings[r + 1]![i]!.p, rings[r]![i]!.p));
  return d;
}

/** point pulled toward the outline centre by `d` metres in plan (keeps y) */
function inwardPoint(p: Vec3, outline: H2[], d: number): Vec3 {
  let cx = 0, cz = 0;
  for (const c of outline) { cx += c[0]; cz += c[1]; }
  cx /= outline.length; cz /= outline.length;
  const dx = cx - p[0], dz = cz - p[2];
  const l = Math.hypot(dx, dz) || 1;
  const k = Math.min(1, d / l);
  return [p[0] + dx * k, p[1], p[2] + dz * k];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// shapes

/** rectangle corners (xz), counter-clockwise from above, centred at the origin: (-hx,-hz) (+hx,-hz) (+hx,+hz) (-hx,+hz) -> reorder so it is CCW in the xz plane seen from +y */
export const rectCorners = (hx: number, hz: number): H2[] => [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]];
/** regular polygon corners at radius r (xz), counter-clockwise seen from above */
export const polyCorners = (n: number, r: number, phase = 0): H2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase - (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as H2;
  });

/** square pyramid / n-gon roof helper: ridge target = apex */
export function pyramidStages(n: number): RoofStage[] {
  return [{ f: 1, corners: Array.from({ length: n }, () => [0, 0] as H2) }];
}

/** pillar with entasis: radius r0 at the foot, r1 at the top, swelling by `swell` in the lower third */
export function pillar(r0: number, r1: number, h: number, swell = 0.04, rings = 5): H2[] {
  const out: H2[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = r0 + (r1 - r0) * t + swell * Math.sin(Math.min(1, t * 1.5) * Math.PI) * 0.6;
    out.push([r, h * t]);
  }
  return out;
}

/** axis-aligned bevel box helper that appends into a PropMesh with the wall-aware mapper */
export function box(m: PropMesh, mat: number, map: Mapper, size: Vec3, at: Vec3, bevel = 0, yaw = 0): void {
  const b = bevelBox(size, bevel, [0, 0, 0], 1);
  m.add(b, mat, map, place(at[0], at[1], at[2], yaw));
}

/** 12-triangle box `size` (x,y,z) centred at `at` in a frame rotated by `yaw` about the model Y axis (so `at` is frame-local) */
export function slab(m: PropMesh, mat: number, map: Mapper, size: Vec3, at: Vec3, yaw = 0): void {
  const h = extrude([[-size[0] / 2, -size[1] / 2], [size[0] / 2, -size[1] / 2], [size[0] / 2, size[1] / 2], [-size[0] / 2, size[1] / 2]], size[2]);
  m.add(h, mat, map, compose(rotY(yaw), m4translation([at[0], at[1], at[2] - size[2] / 2])));
}

/** vertical prism over an arbitrary outline (xz, CCW) from y0 to y1 */
export function prism(m: PropMesh, mat: number, map: Mapper, outline: H2[], y0: number, y1: number, opts: { bevel?: number; taper?: number } = {}): void {
  const h = extrude(outline, y1 - y0, { axis: 'y', z0: y0, ...(opts.bevel ? { bevel: { size: opts.bevel, segments: 1 } } : {}), ...(opts.taper !== undefined ? { taper: opts.taper } : {}) });
  m.add(h, mat, map);
}

/** stone staircase descending toward local +z from the face of a platform at z = 0; `at` is the foot of the platform face */
export function stairs(m: PropMesh, mat: number, map: Mapper, at: Vec3, w: number, steps: number, run: number, rise: number, yaw = 0): void {
  const xf = place(at[0], at[1], at[2], yaw);
  for (let i = 0; i < steps; i++) {
    const h = rise * (steps - i);
    const b = extrude([[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]], run, { axis: 'z', z0: i * run });
    m.add(b, mat, map, xf);
  }
}

/** ridge cap: swept rounded beam along a polyline (e.g. out.crest) */
export function ridgeBeam(m: PropMesh, mat: number, path: Vec3[], r: number, map: Mapper, closed = false): void {
  m.add(sweepSolid(roundCorners(circleShape(r, 8), r * 0.2, 1), path, closed ? { closed: true } : {}), mat, map);
}


export interface SweepSolidOpts {
  scale?: (t: number) => number;
  twist?: (t: number) => number;
  closed?: boolean;
  caps?: boolean;
  up?: Vec3;
}

/**
 * Sweep a CCW outline along a polyline with outward-facing sides (core `sweep` winds its side quads inward while its end
 * caps face outward; props need consistent solids). Parallel-transport frames, optional per-ring scale/twist.
 */
export function sweepSolid(outline: readonly H2[], path: readonly Vec3[], o: SweepSolidOpts = {}): HardMesh {
  const shape = ensureCCW(outline);
  const n = path.length;
  const m = new HardMesh();
  const tan: Vec3[] = path.map((_, i) => {
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(n - 1, i + 1)]!;
    const t = vsub(b, a);
    return vnorm(vlen(t) < 1e-9 ? [0, 0, 1] : t);
  });
  if (o.closed) {
    tan[0] = vnorm(vsub(path[1]!, path[n - 1]!));
    tan[n - 1] = vnorm(vsub(path[0]!, path[n - 2]!));
  }
  const up0: Vec3 = o.up ?? (Math.abs(tan[0]![1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
  let x = vnorm(vcross(up0, tan[0]!));
  let y = vcross(tan[0]!, x);
  const rings: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const t0 = tan[i - 1]!, t1 = tan[i]!;
      const axis = vcross(t0, t1);
      const sn = vlen(axis), cs = vdot(t0, t1);
      if (sn > 1e-9) {
        const k = vnorm(axis);
        const rot = (v: Vec3): Vec3 => {
          const kv = vcross(k, v), kd = vdot(k, v);
          return [v[0] * cs + kv[0] * sn + k[0] * kd * (1 - cs), v[1] * cs + kv[1] * sn + k[1] * kd * (1 - cs), v[2] * cs + kv[2] * sn + k[2] * kd * (1 - cs)];
        };
        x = rot(x);
        y = rot(y);
      }
    }
    const t = n > 1 ? i / (n - 1) : 0;
    const sc = o.scale ? o.scale(t) : 1;
    const tw = o.twist ? o.twist(t) : 0;
    const ct = Math.cos(tw), st = Math.sin(tw);
    const p = path[i]!;
    rings.push(
      shape.map(([px, py]) => {
        const rx = (px * ct - py * st) * sc, ry = (px * st + py * ct) * sc;
        return [p[0] + x[0] * rx + y[0] * ry, p[1] + x[1] * rx + y[1] * ry, p[2] + x[2] * rx + y[2] * ry] as Vec3;
      }),
    );
  }
  const count = o.closed ? n : n - 1;
  for (let r = 0; r < count; r++) {
    const a = rings[r]!, b = rings[(r + 1) % n]!;
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      m.quad(a[i]!, a[j]!, b[j]!, b[i]!);
    }
  }
  if (o.caps !== false && !o.closed) {
    m.polygon([...rings[0]!].reverse());
    m.polygon(rings[n - 1]!);
  }
  return m;
}

/** planar mapper for a board seen from +/-z: u = (x - x0)/w, v = (yTop - y)/h (one 0..1 square over the board) */
export const mapBoard = (x0: number, w: number, yTop: number, h: number): Mapper => (a, b, c) => {
  const f = (p: Vec3): Vec2 => [(p[0] - x0) / w, (yTop - p[1]) / h];
  return [f(a), f(b), f(c)];
};

// ---------------------------------------------------------------------------------------------------------------------------------
// timber-frame details

/** band mapper for the side faces of any polygonal prism: u along each face (tangent from the face normal), v = 0..1 from `yTop` down `bandH`; cap faces fall back to a ground-plane mapping */
export const mapBandSides = (yTop: number, bandH: number): Mapper => (a, b, c) => {
  const n = vnorm(vcross(vsub(b, a), vsub(c, a)));
  if (Math.abs(n[1]) > 0.7) {
    const g = (p: Vec3): Vec2 => [p[0] / bandH, p[2] / bandH];
    return [g(a), g(b), g(c)];
  }
  const t: Vec3 = [n[2], 0, -n[0]];
  const f = (p: Vec3): Vec2 => [vdot(p, t) / bandH, (yTop - p[1]) / bandH];
  return [f(a), f(b), f(c)];
};

/** band mapper for round collars: u wraps seamlessly round the axis (a whole number of dancheong tile periods), v = 0..1 from `yTop` down `bandH` */
export const mapRing = (cx: number, cz: number, radius: number, yTop: number, bandH: number): Mapper => {
  const period = 1 / 0.19;
  const k = Math.max(1, Math.round((2 * Math.PI * radius) / (bandH * period)));
  const span = k * period;
  return (a, b, c) => {
    const ang = [a, b, c].map((p) => Math.atan2(p[2] - cz, p[0] - cx));
    for (let i = 1; i < 3; i++) {
      while (ang[i]! - ang[0]! > Math.PI) ang[i]! -= 2 * Math.PI;
      while (ang[i]! - ang[0]! < -Math.PI) ang[i]! += 2 * Math.PI;
    }
    const f = (p: Vec3, i: number): Vec2 => [(ang[i]! / (2 * Math.PI)) * span, (yTop - p[1]) / bandH];
    return [f(a, 0), f(b, 1), f(c, 2)];
  };
};

/** band mapper for beams/boards: u along the face (x for z-facing faces, z for x-facing), v = 0..1 from `yTop` down `bandH` metres */
export const mapBand = (yTop: number, bandH: number, axis: 'x' | 'z', uScale: number): Mapper => (a, b, c) => {
  const f = (p: Vec3): Vec2 => [(axis === 'x' ? p[0] : p[2]) / uScale, (yTop - p[1]) / bandH];
  return [f(a), f(b), f(c)];
};

/** stepped bracket set (dougong): block -> arm -> long arm. Local frame faces +z, arms run along x. 3 boxes = 36 tris. The arms get a painted band (`mats.arm`, band uv) */
export function dougong(m: PropMesh, mats: { block: number; arm: number }, map: Mapper, at: Vec3, scale = 1, yaw = 0): void {
  const [x, y, z] = at;
  const s = scale;
  const put = (mat: number, size: Vec3, dx: number, dy: number, dz: number, band = false): void => {
    const h = extrude([[-size[0] / 2, -size[1] / 2], [size[0] / 2, -size[1] / 2], [size[0] / 2, size[1] / 2], [-size[0] / 2, size[1] / 2]], size[2] * s);
    const mp = band ? mapBand(y + (dy + size[1] / 2) * s, size[1] * s, 'x', size[1] * s) : map;
    m.add(h, mat, mp, compose(rotY(yaw), m4translation([x + dx * s, y + dy * s, z + dz * s - (size[2] * s) / 2])));
  };
  put(mats.block, [0.4 * s, 0.22 * s, 0.4], 0, 0.11, 0);
  put(mats.arm, [1.05 * s, 0.2 * s, 0.26], 0, 0.32, 0, true);
  put(mats.arm, [1.55 * s, 0.2 * s, 0.26], 0, 0.52, 0, true);
}

/** swept rounded ridge cap along `path`; thin (r) with `sides` profile corners */
export function cap(m: PropMesh, mat: number, path: Vec3[], r: number, map: Mapper, sides = 6): void {
  m.add(sweepSolid(circleShape(r, sides), path), mat, map);
}

/** small onion/bulb finial (revolve) standing at `at` */
export function finial(m: PropMesh, mat: number, at: Vec3, h: number, r: number, map: Mapper): void {
  const p: H2[] = [[0, 0], [r * 0.9, 0], [r * 0.55, h * 0.16], [r, h * 0.38], [r * 0.7, h * 0.62], [r * 0.2, h * 0.86], [0, h]];
  m.add(revolve(p, 8), mat, map, m4translation(at));
}

export { lathe, extrude, bevelBox, roundCorners, circleShape, sstep, mapAuto };
