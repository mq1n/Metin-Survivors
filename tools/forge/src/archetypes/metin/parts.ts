// Shared convex-part builders for the metin family: frustum limbs / horns, oriented boxes (chain links), prisms, jitter.
import { CLS, type Plane, Poly, sidePlane } from '../../core/ext/metins/poly.ts';
import type { Quat, Vec3 } from '../../core/math.ts';
import { qaxis, qmul, qrotate, vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Rng } from '../../core/rng.ts';

/** two unit vectors perpendicular to `axis` and to each other */
export function perpBasis(axis: Vec3): [Vec3, Vec3] {
  const a = vnorm(axis);
  const ref: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = vnorm(vcross(ref, a));
  return [u, vcross(a, u)];
}

/**
 * Convex frustum from A (radius rA) to B (radius rB) with `sides` facets. Ends are flat caps; `capA/capB` extend the cap past
 * the endpoint (use a little overlap so chains of segments have no visible gaps at bends).
 */
export function frustum(A: Vec3, B: Vec3, rA: number, rB: number, sides: number, opts: { phase?: number; extendA?: number; extendB?: number; rng?: Rng } = {}): Poly {
  const axis = vnorm(vsub(B, A));
  const L = vlen(vsub(B, A));
  const [u, v] = perpBasis(axis);
  const tau = Math.atan2(rA - rB, L);
  const planes: Plane[] = [];
  const ph = opts.phase ?? 0;
  for (let k = 0; k < sides; k++) {
    const a = ph + (k / sides) * Math.PI * 2 + (opts.rng ? opts.rng.range(-0.08, 0.08) : 0);
    const dir: Vec3 = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)];
    const n = vnorm([dir[0] * Math.cos(tau) + axis[0] * Math.sin(tau), dir[1] * Math.cos(tau) + axis[1] * Math.sin(tau), dir[2] * Math.cos(tau) + axis[2] * Math.sin(tau)]);
    const rr = opts.rng ? rA * opts.rng.range(0.92, 1.06) : rA;
    const p0 = vadd(A, vscale(dir, rr));
    planes.push({ n, d: vdot(n, p0), plane: -1 });
  }
  const ea = opts.extendA ?? 0, eb = opts.extendB ?? 0;
  planes.push({ n: axis, d: vdot(axis, B) + eb, plane: -1 });
  planes.push({ n: vscale(axis, -1), d: -vdot(axis, A) + ea, plane: -1 });
  return Poly.fromPlanes(planes, Math.max(vlen(A), vlen(B)) + Math.max(rA, rB) * 2 + 3) ?? Poly.box(A, B);
}

/** curved horn / rib / tentacle as a chain of frusta along `path` (radius interpolated from r0 to r1) */
export function limbChain(path: readonly Vec3[], r0: number, r1: number, sides: number, rng?: Rng, taperPow = 1): Poly[] {
  const out: Poly[] = [];
  const n = path.length - 1;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const ra = r0 + (r1 - r0) * t0 ** taperPow, rb = r0 + (r1 - r0) * t1 ** taperPow;
    out.push(frustum(path[i]!, path[i + 1]!, ra, rb, sides, { phase: i * 0.4, extendA: i === 0 ? 0 : ra * 0.5, extendB: i === n - 1 ? 0 : rb * 0.5, ...(rng ? { rng } : {}) }));
  }
  return out;
}

/** box with orthonormal axes (ax, ay, az), half extents (hx, hy, hz) around centre c */
export function orientedBox(c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, hx: number, hy: number, hz: number): Poly {
  const mk = (n: Vec3, h: number): Plane => ({ n, d: vdot(n, c) + h, plane: -1 });
  return Poly.fromPlanes([mk(ax, hx), mk(vscale(ax, -1), hx), mk(ay, hy), mk(vscale(ay, -1), hy), mk(az, hz), mk(vscale(az, -1), hz)], Math.hypot(c[0], c[1], c[2]) + Math.max(hx, hy, hz) * 2 + 2) as Poly;
}

/** vertical prism with `sides` facets: bottom radius rb at y0, top radius rt at y1; per-side radius jitter */
export function prism(cx: number, cz: number, y0: number, y1: number, rb: number, rt: number, sides: number, rng?: Rng, phase = 0): Poly {
  const tilt = Math.atan2(rb - rt, y1 - y0);
  const planes: Plane[] = [];
  for (let k = 0; k < sides; k++) {
    const a = phase + (k / sides) * Math.PI * 2 + (rng ? rng.range(-0.06, 0.06) : 0);
    const pl = sidePlane(a, rb * (rng ? rng.range(0.92, 1.06) : 1), tilt, -1, y0);
    planes.push({ n: pl.n, d: pl.d + vdot(pl.n, [cx, 0, cz]) });
  }
  planes.push({ n: [0, 1, 0], d: y1 }, { n: [0, -1, 0], d: -y0 });
  return Poly.fromPlanes(planes, Math.max(Math.abs(y0), Math.abs(y1), Math.hypot(cx, cz) + rb * 2) + 3) as Poly;
}

/** rigid transform about the origin: rotate by q then translate */
export function placePoly(p: Poly, q: Quat, t: Vec3): Poly {
  return p.map((v) => vadd(qrotate(q, v), t));
}

/** small rest-pose imperfection: yaw about the vertical axis through the centroid plus a lateral shift */
export function jitterSlab(p: Poly, rng: Rng, yawMax: number, shiftMax: number): Poly {
  const c = p.centroid();
  const q: Quat = qaxis([0, 1, 0], rng.range(-yawMax, yawMax));
  const s: Vec3 = [rng.range(-shiftMax, shiftMax), 0, rng.range(-shiftMax, shiftMax)];
  return p.map((v) => {
    const r = qrotate(q, vsub(v, c));
    return [c[0] + r[0] + s[0], c[1] + r[1], c[2] + r[2] + s[2]];
  });
}

/** retag planar faces lying at height y0 as hidden fracture faces (band painted) */
export function hideFacesAt(p: Poly, y0: number): Poly {
  for (const f of p.faces) if (f.pts.every((q) => Math.abs(q[1] - y0) < 1e-4)) f.cls = CLS.CRACK;
  return p;
}

export { qmul };
