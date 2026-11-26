// Geometry kit for the pickup family: matrices, convex hull solids (chamfered boxes, tapered pieces, facets), tubes and
// small helpers on top of the core hard-surface builders. Everything emits `HardMesh` triangle soups (group 0); the
// `Assembly` (assembly.ts) stamps zone/bone ids when parts are added.
import { HardMesh, lathe, sweep } from '../../core/hard/hardmesh.ts';
import { type Vec2, ensureCCW } from '../../core/hard/shape2d.ts';
import { type Mat4, type Vec3, m4mul, m4transformPoint, vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../core/math.ts';

export type V3 = Vec3;
export type { Mat4, Vec2 };

// ------------------------------------------------------------------------------------------------ matrices
export const rotX = (a: number, t: V3 = [0, 0, 0]): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, t[0], t[1], t[2], 1];
};
export const rotY = (a: number, t: V3 = [0, 0, 0]): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, t[0], t[1], t[2], 1];
};
export const rotZ = (a: number, t: V3 = [0, 0, 0]): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
};
export const move = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const scaleM = (x: number, y = x, z = x): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
/** compose(a, b, c) applies c first, then b, then a */
export const compose = (...ms: Mat4[]): Mat4 => ms.reduce((a, b) => m4mul(a, b));
export const xf = (m: Mat4, p: V3): V3 => m4transformPoint(m, p);

export { vadd, vsub, vscale, vcross, vdot, vlen, vnorm };
export const vlerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const sstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------ closed solids
/** Flip every triangle of a closed solid when its signed volume is negative (so normals point outward). */
export function orientOutward(m: HardMesh): HardMesh {
  let vol = 0;
  const t = m.tris;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i]!, ay = t[i + 1]!, az = t[i + 2]!, bx = t[i + 3]!, by = t[i + 4]!, bz = t[i + 5]!, cx = t[i + 6]!, cy = t[i + 7]!, cz = t[i + 8]!;
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    for (let i = 0; i < t.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const a = t[i + 3 + k]!;
        t[i + 3 + k] = t[i + 6 + k]!;
        t[i + 6 + k] = a;
      }
    }
  }
  return m;
}

/**
 * Convex hull solid of a point set (brute-force plane search; fine for <= ~80 points). Coplanar points are merged into one
 * polygon that is fan-triangulated, collinear boundary points are dropped. Faces are outward counter-clockwise.
 */
export function hull(points: readonly V3[], eps = 1e-6): HardMesh {
  const pts: V3[] = [];
  for (const p of points) if (!pts.some((q) => Math.abs(q[0] - p[0]) < eps && Math.abs(q[1] - p[1]) < eps && Math.abs(q[2] - p[2]) < eps)) pts.push(p);
  const n = pts.length;
  const out = new HardMesh();
  if (n < 4) return out;
  const c: V3 = [0, 0, 0];
  for (const p of pts) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
  const planes = new Map<string, { n: V3; idx: number[] }>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const e1 = vsub(pts[j]!, pts[i]!);
      for (let k = j + 1; k < n; k++) {
        const nn = vcross(e1, vsub(pts[k]!, pts[i]!));
        const l = vlen(nn);
        if (l < 1e-12) continue;
        let nrm: V3 = [nn[0] / l, nn[1] / l, nn[2] / l];
        let d = vdot(nrm, pts[i]!);
        if (vdot(nrm, c) - d > 0) { nrm = [-nrm[0], -nrm[1], -nrm[2]]; d = -d; }
        const key = `${Math.round(nrm[0] * 2000)},${Math.round(nrm[1] * 2000)},${Math.round(nrm[2] * 2000)},${Math.round(d * 20000)}`;
        if (planes.has(key)) continue;
        let ok = true;
        const idx: number[] = [];
        for (let q = 0; q < n; q++) {
          const s = vdot(nrm, pts[q]!) - d;
          if (s > eps) { ok = false; break; }
          if (s > -eps) idx.push(q);
        }
        if (ok) planes.set(key, { n: nrm, idx });
        else planes.set(key, { n: nrm, idx: [] }); // remember rejected planes too
      }
    }
  }
  for (const pl of planes.values()) {
    if (pl.idx.length < 3) continue;
    const nrm = pl.n;
    const u = vnorm(vcross(nrm, Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const w = vcross(nrm, u);
    const cc: V3 = [0, 0, 0];
    for (const i of pl.idx) { cc[0] += pts[i]![0] / pl.idx.length; cc[1] += pts[i]![1] / pl.idx.length; cc[2] += pts[i]![2] / pl.idx.length; }
    const ang = pl.idx.map((i) => {
      const d = vsub(pts[i]!, cc);
      return { i, a: Math.atan2(vdot(d, w), vdot(d, u)) };
    });
    ang.sort((a, b) => a.a - b.a);
    let poly = ang.map((x) => pts[x.i]!);
    // drop collinear corners
    for (let pass = 0; pass < 2; pass++) {
      const keep: V3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[(i + poly.length - 1) % poly.length]!, b = poly[i]!, d = poly[(i + 1) % poly.length]!;
        const cr = vlen(vcross(vsub(b, a), vsub(d, b)));
        if (cr > 1e-9) keep.push(b);
      }
      poly = keep;
    }
    for (let i = 1; i + 1 < poly.length; i++) out.tri(poly[0]!, poly[i]!, poly[i + 1]!);
  }
  return out;
}

/** box centred on `c` with chamfered edges (hull of 24 points; bevel 0 = plain 12-triangle box) */
export function chamferBox(c: V3, size: V3, bevel = 0): HardMesh {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  if (bevel <= 1e-9) {
    const pts: V3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hz]);
    return hull(pts);
  }
  const b = Math.min(bevel, hx * 0.98, hy * 0.98, hz * 0.98);
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([c[0] + sx * hx, c[1] + sy * (hy - b), c[2] + sz * (hz - b)]);
    pts.push([c[0] + sx * (hx - b), c[1] + sy * hy, c[2] + sz * (hz - b)]);
    pts.push([c[0] + sx * (hx - b), c[1] + sy * (hy - b), c[2] + sz * hz]);
  }
  return hull(pts);
}

/** box with independent bevels: bx/by/bz are the chamfer sizes of the edges running along that axis */
export function edgeBox(c: V3, size: V3, bx: number, by: number, bz: number): HardMesh {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    // edge along x is cut in the (y,z) plane etc.: each corner becomes up to 3 points
    const ex = Math.min(bx, hy * 0.98, hz * 0.98), ey = Math.min(by, hx * 0.98, hz * 0.98), ez = Math.min(bz, hx * 0.98, hy * 0.98);
    pts.push([c[0] + sx * hx, c[1] + sy * (hy - ez), c[2] + sz * (hz - ex)]);
    pts.push([c[0] + sx * (hx - ez), c[1] + sy * hy, c[2] + sz * (hz - ey)]);
    pts.push([c[0] + sx * (hx - ey), c[1] + sy * (hy - ex), c[2] + sz * hz]);
  }
  return hull(pts);
}

/** frustum-like piece between two rectangles (centre, half-width x, half-width z) at different heights */
export function taperBox(c0: V3, hx0: number, hz0: number, c1: V3, hx1: number, hz1: number): HardMesh {
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([c0[0] + sx * hx0, c0[1], c0[2] + sz * hz0]);
    pts.push([c1[0] + sx * hx1, c1[1], c1[2] + sz * hz1]);
  }
  return hull(pts);
}

/** regular n-gon ring in 3-D: centre, plane axes (u,w), radius, optional per-vertex radius scale */
export function ring3(c: V3, u: V3, w: V3, rx: number, rz: number, n: number, phase = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
    out.push([c[0] + u[0] * x + w[0] * z, c[1] + u[1] * x + w[1] * z, c[2] + u[2] * x + w[2] * z]);
  }
  return out;
}

/** rounded rectangle outline (ccw) for sweeps/extrusions */
export function rrect(w: number, h: number, r: number, seg = 1): Vec2[] {
  const hw = w / 2, hh = h / 2;
  const rr = Math.min(r, hw * 0.99, hh * 0.99);
  if (rr <= 1e-9) return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const out: Vec2[] = [];
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(hw - rr, -hh + rr, -Math.PI / 2);
  corner(hw - rr, hh - rr, 0);
  corner(-hw + rr, hh - rr, Math.PI / 2);
  corner(-hw + rr, -hh + rr, Math.PI);
  return out;
}

export function ellipse(a: number, b: number, n = 8, phase = 0): Vec2[] {
  return Array.from({ length: n }, (_, i) => [Math.cos(phase + (i / n) * Math.PI * 2) * a, Math.sin(phase + (i / n) * Math.PI * 2) * b] as Vec2);
}

/** closed tube/bar swept along a polyline; `scale(t)` shrinks the outline along the path (tapered horns, claws, cords) */
export function bar(outline: readonly Vec2[], path: readonly V3[], scale?: (t: number) => number, up?: V3): HardMesh {
  const m = sweep(ensureCCW(outline), path, { ...(scale ? { scale } : {}), ...(up ? { up } : {}) });
  return orientOutward(m);
}

/** Catmull-Rom spline through control points (centripetal not needed at this scale) */
export function spline(ctrl: readonly V3[], samples: number): V3[] {
  const n = ctrl.length;
  const out: V3[] = [];
  const get = (i: number): V3 => ctrl[Math.max(0, Math.min(n - 1, i))]!;
  const segs = n - 1;
  for (let s = 0; s <= samples; s++) {
    const f = (s / samples) * segs;
    const i = Math.min(segs - 1, Math.floor(f));
    const t = f - i;
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const q: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      q[k] = 0.5 * (2 * p1[k]! + (-p0[k]! + p2[k]!) * t + (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t * t + (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * t * t * t);
    }
    out.push(q);
  }
  return out;
}

/** points on a circular arc in the plane spanned by unit vectors (u, w) around `c` */
export function arc(c: V3, u: V3, w: V3, r: number, a0: number, a1: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    out.push([c[0] + u[0] * x + w[0] * y, c[1] + u[1] * x + w[1] * y, c[2] + u[2] * x + w[2] * y]);
  }
  return out;
}

/** lathe of an (r, y) profile (bottom -> top, outward = +r) with `seg` segments. The core lathe already winds outward. */
export function revolve(profile: readonly Vec2[], seg: number): HardMesh {
  return lathe(profile, { segments: seg });
}

/** pyramid-ish stud: n-gon base at `c` (axis `up`) with apex lifted by h (rivets, spikes, teeth). Base cap omitted. */
export function stud(c: V3, up: V3, r: number, h: number, n = 5, topR = 0, phase = 0): HardMesh {
  const m = new HardMesh();
  const u0: V3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = vnorm(vcross(up, u0));
  const w = vcross(up, u);
  const base = ring3(c, u, w, r, r, n, phase);
  const apexC = vadd(c, vscale(up, h));
  if (topR > 1e-9) {
    const top = ring3(apexC, u, w, topR, topR, n, phase);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      m.quad(base[i]!, base[j]!, top[j]!, top[i]!);
    }
    for (let i = 1; i + 1 < n; i++) m.tri(top[0]!, top[i]!, top[i + 1]!);
  } else {
    for (let i = 0; i < n; i++) m.tri(base[i]!, base[(i + 1) % n]!, apexC);
  }
  // make outward: check normal of first triangle vs centre
  const t = m.tris;
  if (t.length >= 9) {
    const a: V3 = [t[0]!, t[1]!, t[2]!], b: V3 = [t[3]!, t[4]!, t[5]!], d: V3 = [t[6]!, t[7]!, t[8]!];
    const nn = vcross(vsub(b, a), vsub(d, a));
    const mid: V3 = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3];
    // outward = away from the axis line
    const rel = vsub(mid, c);
    const radial = vsub(rel, vscale(up, vdot(rel, up)));
    if (vdot(nn, radial) < 0) {
      for (let i = 0; i < t.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const x = t[i + 3 + k]!;
          t[i + 3 + k] = t[i + 6 + k]!;
          t[i + 6 + k] = x;
        }
      }
    }
  }
  return m;
}

/** cheap dome rivet: 4/5-sided low pyramid with a flat top, base on the surface. */
export function rivet(c: V3, nrm: V3, r: number, h: number, n = 5): HardMesh {
  return stud(c, nrm, r, h, n, r * 0.45);
}
