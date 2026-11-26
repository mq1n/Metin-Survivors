// Geometry helpers for the PropsElem2 props: phased lathes with per-vertex (r, y) modulation, a cylinder/top uv mapper that keeps
// texel density on walls and flat rings alike, and small math utilities. Everything appends into a PropMesh.
import type { Vec3 } from '../../../../core/math.ts';
import type { Mapper, PropMesh, Vec2 } from '../../mesh.ts';

export const TAU = Math.PI * 2;

/** angle around the vertical axis through (cx, cz), same convention as kit.revolve (x = cos th, z = -sin th); front (+z) = -PI/2 */
export const thetaOf = (p: Vec3, cx = 0, cz = 0): number => Math.atan2(-(p[2] - cz), p[0] - cx);

/** wrap an angle to (-PI, PI] */
export const wrapA = (a: number): number => a - TAU * Math.round(a / TAU);

/** face index, distance to the nearest corner joint (m) and the local u from the face centre (m) on an n-gon of circumradius r whose corner 0 sits at angle `ph` */
export function faceAt(th: number, r: number, n: number, ph: number): { j: number; dj: number; lu: number } {
  const step = TAU / n;
  const a = (((th - ph) % TAU) + TAU) % TAU;
  const j = Math.floor(a / step);
  const f = a / step - j;
  const ap = r * Math.cos(Math.PI / n);
  return { j, dj: Math.min(f, 1 - f) * step * ap, lu: (f - 0.5) * step * ap };
}

/**
 * uv in metres for surfaces of revolution: walls get (arc length at the triangle's own radius, -y), near-flat faces get plan (x, z).
 * Triangles straddling the angle seam are unwrapped relative to their first corner.
 */
export const mapCylTop = (cx = 0, cz = 0, flat = 0.72): Mapper => (a, b, c, n) => {
  if (Math.abs(n[1]) > flat) {
    const f = (p: Vec3): Vec2 => [p[0] - cx, p[2] - cz];
    return [f(a), f(b), f(c)];
  }
  const r = (Math.hypot(a[0] - cx, a[2] - cz) + Math.hypot(b[0] - cx, b[2] - cz) + Math.hypot(c[0] - cx, c[2] - cz)) / 3;
  const t0 = thetaOf(a, cx, cz);
  const f = (p: Vec3): Vec2 => [(t0 + wrapA(thetaOf(p, cx, cz) - t0)) * r, -p[1]];
  return [f(a), f(b), f(c)];
};

export interface Lathe2Opts {
  cx?: number;
  cz?: number;
  /** rotation of vertex 0 (rad) */
  phase?: number;
  /** per-vertex modulation: (theta, ring index, k, r, y) -> [r, y] */
  mod?: (th: number, i: number, k: number, r: number, y: number) => [number, number];
  map?: Mapper;
}

/** lathe of an [r, y] profile (bottom -> top on the outside, outward winding like kit.revolve) with phase and r/y modulation */
export function lathe2(m: PropMesh, mat: number, profile: readonly (readonly [number, number])[], segs: number, o: Lathe2Opts = {}): void {
  const cx = o.cx ?? 0, cz = o.cz ?? 0, ph = o.phase ?? 0;
  const map = o.map ?? mapCylTop(cx, cz);
  const rings: Vec3[][] = profile.map(([r0, y0], i) =>
    Array.from({ length: segs }, (_, k) => {
      const th = ph + (k / segs) * TAU;
      const [r, y] = o.mod ? o.mod(th, i, k, r0, y0) : [r0, y0];
      return [cx + Math.cos(th) * r, y, cz - Math.sin(th) * r] as Vec3;
    }),
  );
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i]!, B = rings[i + 1]!;
    const r0 = profile[i]![0], r1 = profile[i + 1]![0];
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      const a = A[k]!, b = A[k1]!, c = B[k1]!, d = B[k]!;
      if (r0 < 1e-9 && r1 < 1e-9) continue;
      const tri = (p: Vec3, q: Vec3, s: Vec3): void => {
        const n = nrm(p, q, s);
        if (!n) return;
        const [ua, ub, uc] = map(p, q, s, n);
        m.tri(p, q, s, ua, ub, uc, mat);
      };
      if (r0 < 1e-9) tri(a, c, d);
      else if (r1 < 1e-9) tri(a, b, d);
      else {
        tri(a, b, c);
        tri(a, c, d);
      }
    }
  }
}

/** unit normal of a triangle or null when degenerate */
export function nrm(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(n[0], n[1], n[2]);
  return l < 1e-12 ? null : [n[0] / l, n[1] / l, n[2] / l];
}

/** emit one triangle through a mapper */
export function triM(m: PropMesh, mat: number, map: Mapper, a: Vec3, b: Vec3, c: Vec3): void {
  const n = nrm(a, b, c);
  if (!n) return;
  const [ua, ub, uc] = map(a, b, c, n);
  m.tri(a, b, c, ua, ub, uc, mat);
}

/** deterministic hash of an integer pair -> 0..1 */
export const hash2 = (a: number, b: number): number => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
