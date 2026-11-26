// Geometry helpers for the orc-camp / village props (PropsOrc): rough-hewn logs with explicit tile uvs, rope wraps, sharpened stakes,
// double-sided cloth sheets, bone horns, skulls, chamfered boards and chunky stones. Everything appends into a PropMesh.
// Winding convention (same as kit.sweepSolid): ring vertices run counter-clockwise seen from +tangent, quad (a_k, a_k+1, b_k+1, b_k)
// with b further along the tangent faces outward.
import { type HardMesh, extrude, lathe } from '../../../../core/hard/hardmesh.ts';
import type { Vec2 as H2 } from '../../../../core/hard/shape2d.ts';
import { type Mat4, type Vec3, basisFromDirSide, m4mul, m4translation, vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../../../core/math.ts';
import { Rng } from '../../../../core/rng.ts';
import { rotY } from '../../kit.ts';
import type { Mapper, PropMesh, Vec2 } from '../../mesh.ts';

export { rotY };
export const rotX = (a: number): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};
export const rotZ = (a: number): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};
export const scaleXf = (x: number, y = x, z = x): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
export const moveXf = (x: number, y: number, z: number): Mat4 => m4translation([x, y, z]);
/** local +Y -> `dir`, local +X as close as possible to `side`, origin -> `at` */
export function frameXf(at: Vec3, dir: Vec3, side: Vec3 = [1, 0, 0]): Mat4 {
  const { x, y, z } = basisFromDirSide(dir, side);
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, at[0], at[1], at[2], 1];
}
export const mul = (...ms: Mat4[]): Mat4 => ms.reduce((a, b) => m4mul(a, b));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const TAU = Math.PI * 2;
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const sstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const polar = (r: number, ang: number, y = 0): Vec3 => [Math.sin(ang) * r, y, Math.cos(ang) * r];

// ---------------------------------------------------------------------------------------------------------------------------------
// tubes (logs, horns, ropes, tusks)

export interface TubeSpec {
  /** centre line */
  path: Vec3[];
  /** radius at each path point (same length) */
  radii: number[];
  sides: number;
  mat: number;
  /** material of the end caps (default: mat) */
  capMat?: number;
  /** metres per uv tile (u along the tube, v around it) */
  s?: number;
  /** per-corner radial jitter (fraction) constant along the tube; gives hewn, uneven cross sections */
  jitter?: number;
  /** extra per-ring radius jitter (fraction) */
  wobble?: number;
  seed?: number | string;
  /** rotation of the corner pattern (rad) */
  phase?: number;
  /** radius multiplier along the second cross-section axis */
  squash?: number;
  caps?: 'both' | 'start' | 'end' | 'none';
  up?: Vec3;
  /** added to every u / v (lets a prop keep per-part texture variety) */
  uOff?: number;
  vOff?: number;
  /** uv shift per ring along v (twist of strands) */
  twist?: number;
}

/** swept rough solid with explicit tile uvs; caps get planar uvs centred on the cap (u,v in metres/s, handy for end-grain rings) */
export function tube(m: PropMesh, o: TubeSpec): void {
  const n = o.sides, pts = o.path, np = pts.length;
  const s = o.s ?? 1;
  const rng = new Rng(o.seed ?? 'tube');
  const jit = Array.from({ length: n }, () => 1 + (rng.next() * 2 - 1) * (o.jitter ?? 0));
  const arc: number[] = [0];
  for (let i = 1; i < np; i++) arc.push(arc[i - 1]! + vlen(vsub(pts[i]!, pts[i - 1]!)));
  const tan: Vec3[] = pts.map((_, i) => {
    const d = vsub(pts[Math.min(np - 1, i + 1)]!, pts[Math.max(0, i - 1)]!);
    return vnorm(vlen(d) < 1e-9 ? [0, 1, 0] : d);
  });
  const up0: Vec3 = o.up ?? (Math.abs(tan[0]![1]) > 0.92 ? [0, 0, 1] : [0, 1, 0]);
  let e1 = vnorm(vcross(up0, tan[0]!));
  let e2 = vcross(tan[0]!, e1);
  const rings: Vec3[][] = [];
  const frames: { e1: Vec3; e2: Vec3 }[] = [];
  const phase = o.phase ?? 0;
  for (let i = 0; i < np; i++) {
    if (i > 0) {
      const t0 = tan[i - 1]!, t1 = tan[i]!;
      const ax = vcross(t0, t1);
      const sn = vlen(ax), cs = vdot(t0, t1);
      if (sn > 1e-9) {
        const k = vnorm(ax);
        const rot = (v: Vec3): Vec3 => {
          const kv = vcross(k, v), kd = vdot(k, v);
          return [v[0] * cs + kv[0] * sn + k[0] * kd * (1 - cs), v[1] * cs + kv[1] * sn + k[1] * kd * (1 - cs), v[2] * cs + kv[2] * sn + k[2] * kd * (1 - cs)];
        };
        e1 = rot(e1);
        e2 = rot(e2);
      }
    }
    frames.push({ e1, e2 });
    const wob = 1 + (rng.next() * 2 - 1) * (o.wobble ?? 0);
    const r = o.radii[i]! * wob;
    const c = pts[i]!;
    if (!Number.isFinite(c[0] + c[1] + c[2] + r)) throw new Error(`tube: non-finite ring ${i}`);
    rings.push(
      Array.from({ length: n }, (_, k) => {
        const th = phase + (k / n) * TAU;
        const rr = r * jit[k]!;
        const x = Math.cos(th) * rr, y = Math.sin(th) * rr * (o.squash ?? 1);
        return [c[0] + e1[0] * x + e2[0] * y, c[1] + e1[1] * x + e2[1] * y, c[2] + e1[2] * x + e2[2] * y] as Vec3;
      }),
    );
  }
  const rAvg = o.radii.reduce((a, b) => a + b, 0) / np;
  const tiles = Math.max(1, Math.round((TAU * rAvg) / s));
  const uo = o.uOff ?? 0, vo = o.vOff ?? 0;
  for (let i = 0; i + 1 < np; i++) {
    const a = rings[i]!, b = rings[i + 1]!;
    const ua = arc[i]! / s + uo, ub = arc[i + 1]! / s + uo;
    const twa = (o.twist ?? 0) * i, twb = (o.twist ?? 0) * (i + 1);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const va = (k / n) * tiles + vo, vb = ((k + 1) / n) * tiles + vo;
      m.quad(a[k]!, a[k2]!, b[k2]!, b[k]!, [ua, va + twa], [ua, vb + twa], [ub, vb + twb], [ub, va + twb], o.mat);
    }
  }
  const capMat = o.capMat ?? o.mat;
  const caps = o.caps ?? 'both';
  const cap = (i: number, flip: boolean): void => {
    const ring = rings[i]!;
    const c = pts[i]!;
    if (o.radii[i]! < 1e-4) return;
    const f = frames[i]!;
    const uvOf = (p: Vec3): Vec2 => {
      const d = vsub(p, c);
      return [vdot(d, f.e1) / s, vdot(d, f.e2) / s];
    };
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const A = ring[k]!, B = ring[k2]!;
      if (flip) m.tri(c, B, A, uvOf(c), uvOf(B), uvOf(A), capMat);
      else m.tri(c, A, B, uvOf(c), uvOf(A), uvOf(B), capMat);
    }
  };
  if (caps === 'both' || caps === 'start') cap(0, true);
  if (caps === 'both' || caps === 'end') cap(np - 1, false);
}

export interface LogOpts {
  sides?: number;
  segs?: number;
  /** lateral bow at mid-length (m, world vector) */
  bow?: Vec3;
  chamfer0?: number;
  chamfer1?: number;
  /** sharpened tip length at p1 */
  point?: number;
  tipR?: number;
  jitter?: number;
  wobble?: number;
  swell?: number;
  seed?: number | string;
  phase?: number;
  squash?: number;
  capMat?: number;
  s?: number;
  uOff?: number;
  vOff?: number;
  caps?: 'both' | 'start' | 'end' | 'none';
  up?: Vec3;
}

/** rough-hewn log between two points: taper, optional bow, chamfered cut ends or a sharpened tip */
export function log(m: PropMesh, mat: number, p0: Vec3, p1: Vec3, r0: number, r1: number, o: LogOpts = {}): void {
  const d = vsub(p1, p0);
  const L = vlen(d);
  const ax = vscale(d, 1 / L);
  const segs = Math.max(1, o.segs ?? 3);
  const c0 = o.chamfer0 ?? 0, c1 = o.chamfer1 ?? 0, pt = o.point ?? 0;
  const bow = o.bow ?? [0, 0, 0];
  const stops: { s: number; shrink: number }[] = [];
  if (c0 > 0) stops.push({ s: 0, shrink: c0 });
  const sa = c0, sb = L - (pt > 0 ? pt : c1);
  for (let k = 0; k <= segs; k++) stops.push({ s: lerp(sa, sb, k / segs), shrink: 0 });
  if (pt > 0) stops.push({ s: L, shrink: -1 });
  else if (c1 > 0) stops.push({ s: L, shrink: c1 });
  const path: Vec3[] = [], radii: number[] = [];
  for (const st of stops) {
    const t = st.s / L;
    const b = Math.sin(Math.PI * t);
    path.push([p0[0] + ax[0] * st.s + bow[0] * b, p0[1] + ax[1] * st.s + bow[1] * b, p0[2] + ax[2] * st.s + bow[2] * b]);
    const base = lerp(r0, r1, t) * (1 + (o.swell ?? 0) * b);
    radii.push(st.shrink < 0 ? base * (o.tipR ?? 0.1) : Math.max(0.004, base - st.shrink));
  }
  const spec: TubeSpec = { path, radii, sides: o.sides ?? 7, mat, ...(o.capMat !== undefined ? { capMat: o.capMat } : {}), s: o.s ?? 1, jitter: o.jitter ?? 0.06, wobble: o.wobble ?? 0.03, seed: o.seed ?? `${p0}${p1}`, caps: o.caps ?? 'both' };
  if (o.phase !== undefined) spec.phase = o.phase;
  if (o.squash !== undefined) spec.squash = o.squash;
  if (o.uOff !== undefined) spec.uOff = o.uOff;
  if (o.vOff !== undefined) spec.vOff = o.vOff;
  if (o.up) spec.up = o.up;
  tube(m, spec);
}

/** rope lashing: a proud band around a log (u along the axis, v around; the rope material paints the strand wraps) */
export function lash(m: PropMesh, mat: number, at: Vec3, dir: Vec3, r: number, w: number, o: { bulge?: number; sides?: number; ridges?: number; s?: number; uOff?: number; seed?: number | string } = {}): void {
  const ax = vnorm(dir);
  const bulge = o.bulge ?? 0.03;
  const ridges = o.ridges ?? 1;
  const path: Vec3[] = [], radii: number[] = [];
  const n = ridges * 2 + 1;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    path.push([at[0] + ax[0] * (t - 0.5) * w, at[1] + ax[1] * (t - 0.5) * w, at[2] + ax[2] * (t - 0.5) * w]);
    radii.push(r + (i % 2 === 1 ? bulge : bulge * 0.15));
  }
  tube(m, { path, radii, sides: o.sides ?? 7, mat, s: o.s ?? 0.5, caps: 'none', jitter: 0.015, seed: o.seed ?? 'lash', uOff: o.uOff ?? 0 });
}

/** thin rope polyline (sag handled by the caller through the points) */
export function ropeLine(m: PropMesh, mat: number, pts: Vec3[], r: number, o: { sides?: number; s?: number; uOff?: number } = {}): void {
  tube(m, { path: pts, radii: pts.map(() => r), sides: o.sides ?? 5, mat, s: o.s ?? 0.35, caps: 'both', uOff: o.uOff ?? 0 });
}

/** rope hanging between two points with a catenary-ish sag (m) */
export function sagLine(a: Vec3, b: Vec3, sag: number, n = 5): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const p = lerp3(a, b, t);
    return [p[0], p[1] - sag * 4 * t * (1 - t), p[2]] as Vec3;
  });
}

/** bent path from `base` starting along `dir`, turning toward `bend` by `curl` radians over `len` metres */
export function arcPath(base: Vec3, dir: Vec3, bend: Vec3, len: number, curl: number, n = 6, ease = 1.15): Vec3[] {
  const d0 = vnorm(dir);
  let b = vsub(bend, vscale(d0, vdot(bend, d0)));
  b = vnorm(b);
  const out: Vec3[] = [base];
  let p = base;
  for (let i = 1; i <= n; i++) {
    const t = (i - 0.5) / n;
    const phi = curl * t ** ease;
    const d: Vec3 = [d0[0] * Math.cos(phi) + b[0] * Math.sin(phi), d0[1] * Math.cos(phi) + b[1] * Math.sin(phi), d0[2] * Math.cos(phi) + b[2] * Math.sin(phi)];
    p = vadd(p, vscale(d, len / n));
    out.push(p);
  }
  return out;
}

/** curved tapering horn / tusk along `path`; tip is a point */
export function horn(m: PropMesh, mat: number, path: Vec3[], r: number, o: { sides?: number; taper?: number; s?: number; uOff?: number; seed?: number | string; capMat?: number; blunt?: number } = {}): void {
  const n = path.length;
  const radii = path.map((_, i) => {
    const t = i / (n - 1);
    return r * (1 - (1 - (o.blunt ?? 0.05)) * t ** (o.taper ?? 0.9));
  });
  tube(m, { path, radii, sides: o.sides ?? 6, mat, s: o.s ?? 0.3, caps: 'start', jitter: 0.03, seed: o.seed ?? 'horn', uOff: o.uOff ?? 0, ...(o.capMat !== undefined ? { capMat: o.capMat } : {}) });
}

/** cone-like spike (revolve of a short profile) along `dir`, e.g. iron spikes, teeth, tent-pole tips */
export function spike(m: PropMesh, mat: number, at: Vec3, dir: Vec3, len: number, r: number, o: { sides?: number; s?: number; uOff?: number; side?: Vec3; bulge?: number } = {}): void {
  const ax = vnorm(dir);
  const sides = o.sides ?? 5;
  const path: Vec3[] = [at, vadd(at, vscale(ax, len * 0.45)), vadd(at, vscale(ax, len))];
  const radii = [r, r * (0.62 + (o.bulge ?? 0)), r * 0.04];
  const spec: TubeSpec = { path, radii, sides, mat, s: o.s ?? 0.3, caps: 'start', jitter: 0, uOff: o.uOff ?? 0 };
  if (o.side) spec.up = o.side;
  tube(m, spec);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// cloth / hide sheets

export interface SheetSpec {
  nu: number;
  nv: number;
  /** front surface position for (u, v) in 0..1 */
  at: (u: number, v: number) => Vec3;
  /** tile uv of the surface point (default: u, v) */
  uv?: (u: number, v: number) => Vec2;
  mat: number;
  backMat?: number;
  edgeMat?: number;
  /** thickness (m); 0 / omitted = single-sided front only */
  thick?: number;
  /** reverse the facing of the front side */
  flip?: boolean;
  /** world direction the front must face; overrides `flip` by testing the normal at the middle of the sheet */
  outward?: Vec3;
  /** skip grid cells */
  cell?: (i: number, j: number) => boolean;
  /** close the border of a thick sheet with edge strips (default true) */
  edge?: boolean;
}

/** parametric sheet. Front faces +(dP/du x dP/dv) (reversed with `flip`); with `thick` a back layer + edge strips make it solid */
export function sheet(m: PropMesh, o: SheetSpec): void {
  const { nu, nv } = o;
  const P: Vec3[][] = [], N: Vec3[][] = [];
  for (let i = 0; i <= nu; i++) {
    P.push([]);
    for (let j = 0; j <= nv; j++) {
      const p = o.at(i / nu, j / nv);
      if (!Number.isFinite(p[0] + p[1] + p[2])) throw new Error(`sheet: non-finite point at ${i},${j}`);
      P[i]!.push(p);
    }
  }
  let flipped = o.flip ?? false;
  if (o.outward) {
    const i = nu >> 1, j = nv >> 1;
    const du = vsub(P[Math.min(nu, i + 1)]![j]!, P[Math.max(0, i - 1)]![j]!);
    const dv = vsub(P[i]![Math.min(nv, j + 1)]!, P[i]![Math.max(0, j - 1)]!);
    flipped = vdot(vcross(du, dv), o.outward) < 0;
  }
  const sgn = flipped ? -1 : 1;
  for (let i = 0; i <= nu; i++) {
    N.push([]);
    for (let j = 0; j <= nv; j++) {
      const du = vsub(P[Math.min(nu, i + 1)]![j]!, P[Math.max(0, i - 1)]![j]!);
      const dv = vsub(P[i]![Math.min(nv, j + 1)]!, P[i]![Math.max(0, j - 1)]!);
      N[i]!.push(vscale(vnorm(vcross(du, dv)), sgn));
    }
  }
  const uvf = o.uv ?? ((u: number, v: number): Vec2 => [u, v]);
  const thick = o.thick ?? 0;
  const Q: Vec3[][] | null = thick > 0 ? P.map((row, i) => row.map((p, j) => vsub(p, vscale(N[i]![j]!, thick)))) : null;
  const on = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nu && j < nv && (o.cell ? o.cell(i, j) : true);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      if (!on(i, j)) continue;
      const a = P[i]![j]!, b = P[i + 1]![j]!, c = P[i + 1]![j + 1]!, d = P[i]![j + 1]!;
      const ua = uvf(i / nu, j / nv), ub = uvf((i + 1) / nu, j / nv), uc = uvf((i + 1) / nu, (j + 1) / nv), ud = uvf(i / nu, (j + 1) / nv);
      if (flipped) m.quad(a, d, c, b, ua, ud, uc, ub, o.mat);
      else m.quad(a, b, c, d, ua, ub, uc, ud, o.mat);
      if (Q) {
        const qa = Q[i]![j]!, qb = Q[i + 1]![j]!, qc = Q[i + 1]![j + 1]!, qd = Q[i]![j + 1]!;
        const bm = o.backMat ?? o.mat;
        if (flipped) m.quad(qa, qb, qc, qd, ua, ub, uc, ud, bm);
        else m.quad(qa, qd, qc, qb, ua, ud, uc, ub, bm);
      }
    }
  }
  if (Q && o.edge !== false) {
    const em = o.edgeMat ?? o.backMat ?? o.mat;
    const strip = (A: Vec3, B: Vec3, A2: Vec3, B2: Vec3, hint: Vec3, ua: Vec2, ub: Vec2): void => {
      const nrm = vcross(vsub(A2, A), vsub(B2, A));
      const k = vdot(nrm, hint) >= 0;
      const uA2: Vec2 = [ua[0], ua[1]], uB2: Vec2 = [ub[0], ub[1]];
      if (k) {
        m.tri(A, A2, B2, ua, uA2, uB2, em);
        m.tri(A, B2, B, ua, uB2, ub, em);
      } else {
        m.tri(A, B2, A2, ua, uB2, uA2, em);
        m.tri(A, B, B2, ua, ub, uB2, em);
      }
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        if (!on(i, j)) continue;
        if (!on(i, j - 1)) strip(P[i]![j]!, P[i + 1]![j]!, Q[i]![j]!, Q[i + 1]![j]!, vsub(P[i]![j]!, P[i]![j + 1]!), uvf(i / nu, j / nv), uvf((i + 1) / nu, j / nv));
        if (!on(i, j + 1)) strip(P[i]![j + 1]!, P[i + 1]![j + 1]!, Q[i]![j + 1]!, Q[i + 1]![j + 1]!, vsub(P[i]![j + 1]!, P[i]![j]!), uvf(i / nu, (j + 1) / nv), uvf((i + 1) / nu, (j + 1) / nv));
        if (!on(i - 1, j)) strip(P[i]![j]!, P[i]![j + 1]!, Q[i]![j]!, Q[i]![j + 1]!, vsub(P[i]![j]!, P[i + 1]![j]!), uvf(i / nu, j / nv), uvf(i / nu, (j + 1) / nv));
        if (!on(i + 1, j)) strip(P[i + 1]![j]!, P[i + 1]![j + 1]!, Q[i + 1]![j]!, Q[i + 1]![j + 1]!, vsub(P[i + 1]![j]!, P[i]![j]!), uvf((i + 1) / nu, j / nv), uvf((i + 1) / nu, (j + 1) / nv));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// chamfered boards / stones (hard-surface parts added through a mapper)

/** board outline in the xy plane (x across, y up from 0), CCW. `top`: flat | point | slant | jag | broken */
export function boardOutline(w: number, h: number, top: 'flat' | 'point' | 'slant' | 'jag' | 'broken' = 'flat', rng?: Rng, cut = 0.12): H2[] {
  const hw = w / 2;
  const r = rng ?? new Rng(7);
  const j = (a: number): number => (r.next() - 0.5) * a;
  const pts: H2[] = [[-hw + j(0.01), 0], [hw + j(0.01), 0]];
  if (top === 'flat') pts.push([hw, h + j(0.02)], [-hw, h + j(0.02)]);
  else if (top === 'point') pts.push([hw, h - cut], [j(0.03), h], [-hw, h - cut]);
  else if (top === 'slant') pts.push([hw, h], [-hw, h - cut]);
  else if (top === 'jag') pts.push([hw, h - cut * 0.3], [hw * 0.35, h + cut * 0.15], [-hw * 0.1, h - cut * 0.7], [-hw * 0.55, h], [-hw, h - cut * 0.4]);
  else pts.push([hw, h - cut * 0.6], [hw * 0.4, h - cut * 1.1], [hw * 0.1, h - cut * 0.35], [-hw * 0.5, h - cut * 0.9], [-hw, h]);
  return pts;
}

/** chamfered board: outline extruded along z (depth d, centred at z = 0) with a 45 degree front/back chamfer */
export function board(outline: H2[], d: number, chamfer = 0.012): HardMesh {
  return extrude(outline, d, { axis: 'z', z0: -d / 2, bevel: { size: Math.min(chamfer, d / 2 - 1e-4), segments: 1 } });
}

/** chunky chamfered, slightly tapered stone (irregular polygon prism); origin at the centre of its base */
export function stoneChunk(rng: Rng, w: number, h: number, d: number, sides = 7, taper = 0.78): HardMesh {
  const poly: H2[] = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * TAU + (rng.next() - 0.5) * 0.35;
    const rr = 0.5 * (0.82 + rng.next() * 0.36);
    return [Math.cos(a) * rr * w, Math.sin(a) * rr * d] as H2;
  });
  return extrude(poly, h, { axis: 'y', bevel: { size: Math.min(w, d) * 0.14, segments: 1 }, taper });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// bone work

/** mapper that gives skull-local front-plane uv (units of `size`), with the back of the skull shifted far away so painted faces only land on the front */
export function mapSkull(at: Vec3, yaw: number, size: number): Mapper {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // local axes in world: right = (c, 0, -s), forward = (s, 0, c)
  return (a, b, cc) => {
    const f = (p: Vec3, back: boolean): Vec2 => {
      const dx = p[0] - at[0], dy = p[1] - at[1], dz = p[2] - at[2];
      const x = dx * c - dz * s, z = dx * s + dz * c;
      return [x / size + (back ? 40 : 0), dy / size];
    };
    const cz = (p: Vec3): number => {
      const dx = p[0] - at[0], dz = p[2] - at[2];
      return dx * s + dz * c;
    };
    const back = (cz(a) + cz(b) + cz(cc)) / 3 < -0.04 * size;
    return [f(a, back), f(b, back), f(cc, back)];
  };
}

export interface SkullOpts {
  /** 0: cranium + snout; 1: + brow, jaw; 2: + cheek wedges, tusks */
  detail?: 0 | 1 | 2;
  /** pitch (rad, + looks down) and roll */
  pitch?: number;
  roll?: number;
  /** jaw drop (m at scale 1) */
  jaw?: number;
  tusk?: number;
  /** muzzle length factor */
  muzzle?: number;
  /** curved bull horns growing from the cranium sides */
  horns?: { mat: number; len?: number; r?: number; curl?: number; up?: number; segs?: number; sides?: number };
}

/** low-poly orc/ox skull facing +Z at `yaw` (rotation about Y); `size` ~ its length in metres. Needs skull + dark materials */
export function skull(m: PropMesh, mats: { bone: number }, at: Vec3, yaw: number, size: number, o: SkullOpts = {}): void {
  const det = o.detail ?? 1;
  const mz = o.muzzle ?? 1;
  const jawDrop = o.jaw ?? 0.08;
  const base = mul(rotY(yaw, at), rotX(o.pitch ?? 0), rotZ(o.roll ?? 0), scaleXf(size));
  const map = mapSkull(at, yaw, size);
  // cranium: squashed egg
  const crown = lathe([[0, -0.26], [0.42, 0.0], [0.4, 0.22], [0, 0.36]], { segments: 7 });
  m.add(crown, mats.bone, map, mul(base, m4translation([0, 0.3, -0.1]), scaleXf(1, 1, 1.15)));
  // snout: tapering frustum with a closed tip, flatter than wide
  const snout = lathe([[0.21, 0], [0.12, 0.5 * mz], [0, 0.5 * mz]], { segments: 6 });
  m.add(snout, mats.bone, map, mul(base, m4translation([0, 0.1, 0.18]), rotX(Math.PI / 2), scaleXf(1, 1, 0.82)));
  if (det >= 1) {
    // heavy brow ridge
    const brow = extrude([[-0.43, -0.02], [-0.35, 0.22], [0.35, 0.22], [0.43, -0.02], [0.3, -0.14], [-0.3, -0.14]], 0.11, { axis: 'y', z0: 0 });
    m.add(brow, mats.bone, map, mul(base, m4translation([0, 0.41, 0.22])));
    // lower jaw
    const jaw = extrude([[-0.27, 0.0], [-0.17, 0.5 * mz], [0.17, 0.5 * mz], [0.27, 0.0], [0.21, -0.1], [-0.21, -0.1]], 0.13, { axis: 'y', z0: 0 });
    m.add(jaw, mats.bone, map, mul(base, m4translation([0, -0.2 - jawDrop, 0.2]), rotX(0.1)));
  }
  if (det >= 2) {
    for (const sx of [-1, 1]) {
      // cheek bone wedge
      const cheek = extrude([[0, 0], [0.2 * sx, 0.1], [0, 0.24]].map(([x, z]) => [x!, z!] as H2), 0.09, { axis: 'y', z0: 0 });
      m.add(cheek, mats.bone, map, mul(base, m4translation([sx * 0.2, 0.02, 0.12])));
      // tusk rising from the lower jaw alongside the snout
      const p0: Vec3 = [sx * 0.17, -0.16 - jawDrop, 0.2 + 0.46 * mz];
      const path = arcPath(p0, [sx * 0.12, 1, 0.12], [sx * 0.6, 0.1, 1], o.tusk ?? 0.4, 0.9, 3);
      horn(m, mats.bone, path.map((p) => m4pt(base, p)), 0.05 * size, { sides: 4, s: size, uOff: 200, taper: 1 });
    }
  }
  if (o.horns) {
    const h = o.horns;
    for (const sx of [-1, 1]) {
      const p0: Vec3 = [sx * 0.34, 0.4, -0.02];
      const path = arcPath(p0, [sx * 1, h.up ?? 0.35, 0.1], [-sx * 0.25, 1, 0.45], (h.len ?? 1.1), h.curl ?? 1.6, h.segs ?? 6);
      horn(m, h.mat, path.map((p) => m4pt(base, p)), (h.r ?? 0.1) * size, { sides: h.sides ?? 6, s: 0.3, seed: `sh${sx}${at}` });
    }
  }
}

const m4pt = (xf: Mat4, p: Vec3): Vec3 => [
  xf[0]! * p[0] + xf[4]! * p[1] + xf[8]! * p[2] + xf[12]!,
  xf[1]! * p[0] + xf[5]! * p[1] + xf[9]! * p[2] + xf[13]!,
  xf[2]! * p[0] + xf[6]! * p[1] + xf[10]! * p[2] + xf[14]!,
];
export { m4pt };

/** vertical posts / staves: u runs up the grain (y), v across it; caps use (x, z) */
export const mapGrainY = (s = 1): Mapper => (a, b, c, n) => {
  const f = (p: Vec3): Vec2 => (Math.abs(n[1]) > 0.7 ? [p[0] / s, p[2] / s] : Math.abs(n[0]) >= Math.abs(n[2]) ? [p[1] / s, p[2] / s] : [p[1] / s, p[0] / s]);
  return [f(a), f(b), f(c)];
};
