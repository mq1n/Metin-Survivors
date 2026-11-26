// Architecture helpers for the PropsElem models: chamfered tapering drums (octagonal or round) with separate materials for the
// chamfer rings, metre-based uv mappers (so painted motifs can be authored in metres), smooth closed outlines (cloud scrolls).
import type { Vec3 } from '../../../../core/math.ts';
import { vcross, vnorm, vsub } from '../../../../core/math.ts';
import type { Mapper, PropMesh, Vec2 } from '../../mesh.ts';

/**
 * metre uv for upright faces around an axis through (cx, cz): u = distance along the face tangent from the face centre line
 * (so u = 0 is the middle of every face of a regular polygon), v = height above y0. Near-horizontal faces get plan coordinates.
 */
export const mapDrum = (cx: number, cz: number, y0: number): Mapper => (a, b, c, n) => {
  const nl = Math.hypot(n[0], n[2]);
  if (nl < 0.45) {
    const f = (p: Vec3): Vec2 => [p[0] - cx, p[2] - cz + 17.3];
    return [f(a), f(b), f(c)];
  }
  const tx = -n[2] / nl, tz = n[0] / nl;
  const f = (p: Vec3): Vec2 => [(p[0] - cx) * tx + (p[2] - cz) * tz, p[1] - y0];
  return [f(a), f(b), f(c)];
};

/** metre uv in an arbitrary plane frame: u = (p - o)·ux, v = (p - o)·vy */
export const mapMetres = (o: Vec3, ux: Vec3, vy: Vec3): Mapper => (a, b, c) => {
  const f = (p: Vec3): Vec2 => [(p[0] - o[0]) * ux[0] + (p[1] - o[1]) * ux[1] + (p[2] - o[2]) * ux[2], (p[0] - o[0]) * vy[0] + (p[1] - o[1]) * vy[1] + (p[2] - o[2]) * vy[2]];
  return [f(a), f(b), f(c)];
};

/** emit one triangle through a mapper (normal from the winding) */
export function tri3(m: PropMesh, mat: number, map: Mapper, a: Vec3, b: Vec3, c: Vec3): void {
  const n = vcross(vsub(b, a), vsub(c, a));
  const l = Math.hypot(n[0], n[1], n[2]);
  if (l < 1e-12) return;
  const nn = vnorm(n);
  const [ua, ub, uc] = map(a, b, c, nn);
  m.tri(a, b, c, ua, ub, uc, mat);
}

export interface DrumOpts {
  cx: number;
  cz: number;
  y0: number;
  y1: number;
  /** circumradius at the bottom / top of the straight side */
  r0: number;
  r1: number;
  /** rotation of the polygon (rad) */
  phase?: number;
  sides?: number;
  /** chamfer size (m) at the bottom / top edge (radial inset = vertical rise) */
  cb?: number;
  ct?: number;
  /** relative radial jitter of the corners (hand-hewn look) */
  jitter?: number;
  seed?: number;
  mats: { side: number; top?: number; bot?: number; cap?: number };
  map?: Mapper;
}

/** hash for corner jitter */
const h1 = (k: number, seed: number): number => {
  let h = (Math.imul(k + 1, 374761393) + Math.imul(seed + 7, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** chamfered, tapering polygonal drum; the top chamfer ring, bottom chamfer ring, side and caps can carry different materials */
export function drum(m: PropMesh, o: DrumOpts): void {
  const n = o.sides ?? 8;
  const cb = o.cb ?? 0.05, ct = o.ct ?? 0.05;
  const phase = o.phase ?? 0;
  const map = o.map ?? mapDrum(o.cx, o.cz, o.y0);
  const jit = o.jitter ?? 0;
  const jf = Array.from({ length: n }, (_, k) => 1 + jit * (h1(k, o.seed ?? 0) - 0.5) * 2);
  const ring = (k: number, r: number, y: number): Vec3 => {
    const th = phase + (k / n) * Math.PI * 2;
    const f = jf[k % n]!;
    return [o.cx + Math.cos(th) * r * f, y, o.cz - Math.sin(th) * r * f];
  };
  // side radius as a function of height (linear taper over the whole drum)
  const rAt = (y: number): number => o.r0 + (o.r1 - o.r0) * ((y - o.y0) / (o.y1 - o.y0));
  const yb = o.y0 + cb, yt = o.y1 - ct;
  const matTop = o.mats.top ?? o.mats.side, matBot = o.mats.bot ?? o.mats.side, matCap = o.mats.cap ?? o.mats.side;
  const topC: Vec3 = [o.cx, o.y1, o.cz], botC: Vec3 = [o.cx, o.y0, o.cz];
  for (let k = 0; k < n; k++) {
    const k1 = k + 1;
    // side
    const a = ring(k, rAt(yb), yb), b = ring(k1, rAt(yb), yb), c = ring(k1, rAt(yt), yt), d = ring(k, rAt(yt), yt);
    tri3(m, o.mats.side, map, a, b, c);
    tri3(m, o.mats.side, map, a, c, d);
    // bottom chamfer + cap
    const e = ring(k, rAt(yb) - cb, o.y0), f = ring(k1, rAt(yb) - cb, o.y0);
    tri3(m, matBot, map, e, f, b);
    tri3(m, matBot, map, e, b, a);
    tri3(m, matCap, map, botC, f, e);
    // top chamfer + cap
    const g = ring(k, rAt(yt) - ct, o.y1), hh = ring(k1, rAt(yt) - ct, o.y1);
    tri3(m, matTop, map, d, c, hh);
    tri3(m, matTop, map, d, hh, g);
    tri3(m, matCap, map, topC, g, hh);
  }
}

/** Catmull-Rom (centripetal-ish uniform) through closed control points, sampled `per` times per span */
export function smoothClosed(pts: readonly Vec2[], per = 3): Vec2[] {
  const n = pts.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// crown loft: rings of 2n points alternating polygon corners (radius rc, lifted by lc) and edge midpoints (radius re, lifted by le):
// a flared bowl whose rim rises into n pointed, upturned petals.

export interface CrownRing {
  y: number;
  rc: number;
  re: number;
  lc?: number;
  le?: number;
}

export function crownRings(profile: readonly CrownRing[], n: number, phase = 0, cx = 0, cz = 0): Vec3[][] {
  return profile.map((p) =>
    Array.from({ length: 2 * n }, (_, k) => {
      const corner = k % 2 === 0;
      const th = phase + ((corner ? k / 2 : (k - 1) / 2 + 0.5) / n) * Math.PI * 2;
      const r = corner ? p.rc : p.re;
      return [cx + Math.cos(th) * r, p.y + (corner ? (p.lc ?? 0) : (p.le ?? 0)), cz - Math.sin(th) * r] as Vec3;
    }),
  );
}

/** quads between consecutive closed rings (profile travelled bottom -> top on the outside, same winding as revolve()) */
export function loftRings(m: PropMesh, mat: number, map: Mapper, rings: readonly Vec3[][]): void {
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i]!, B = rings[i + 1]!;
    const k = A.length;
    for (let j = 0; j < k; j++) {
      const a = A[j]!, b = A[(j + 1) % k]!, c = B[(j + 1) % k]!, d = B[j]!;
      tri3(m, mat, map, a, b, c);
      tri3(m, mat, map, a, c, d);
    }
  }
}
