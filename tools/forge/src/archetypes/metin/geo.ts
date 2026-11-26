// Convex-solid generators for metin parts: rubble rocks, crystal spurs, bipyramid shards, spires; plus rigid transforms.
import { CLS, Poly, type Plane, roofPlane, sidePlane } from '../../core/ext/metins/poly.ts';
import type { Quat, Vec3 } from '../../core/math.ts';
import { qaxis, qrotate, vnorm } from '../../core/math.ts';
import type { Rng } from '../../core/rng.ts';

/** rotate a solid about a pivot (quaternion) */
export function rotatePoly(p: Poly, q: Quat, pivot: Vec3 = [0, 0, 0]): Poly {
  return p.map((v) => {
    const r = qrotate(q, [v[0] - pivot[0], v[1] - pivot[1], v[2] - pivot[2]]);
    return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
  });
}

/** lean a solid by `angle` away from vertical towards horizontal heading `heading` (rad, 0 = +x, pi/2 = +z), pivoting at `pivot` */
export function leanPoly(p: Poly, heading: number, angle: number, pivot: Vec3): Poly {
  // lean toward +dir: rotate about the horizontal axis perpendicular to dir
  const axis = vnorm([Math.sin(heading), 0, -Math.cos(heading)]);
  return rotatePoly(p, qaxis(axis, angle), pivot);
}

/** keep y >= y0 (flat bottom). Faces on the cut get the CRACK class (hidden, band-painted) */
export function groundCut(p: Poly, y0 = 0): Poly {
  return p.clip([0, -1, 0], -y0, CLS.CRACK, -1) ?? p;
}

/** irregular rubble rock: random bounding planes around a centre, optional flat base on y=0 */
export function rock(rng: Rng, size: number, opts: { flat?: boolean; squash?: number; planes?: number } = {}): Poly {
  const planes: Plane[] = [];
  const n = opts.planes ?? 9;
  const sq = opts.squash ?? 0.75;
  for (let i = 0; i < n; i++) {
    // fibonacci-ish directions with jitter
    const y = 1 - (i + 0.5) * (2 / n);
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963 + rng.range(-0.35, 0.35);
    const dir = vnorm([Math.cos(a) * r, y * sq + rng.range(-0.12, 0.12), Math.sin(a) * r]);
    planes.push({ n: dir, d: size * rng.range(0.72, 1.0) });
  }
  for (const n2 of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) planes.push({ n: n2, d: size * 1.5 });
  let p = Poly.fromPlanes(planes, size * 4) ?? Poly.box([-size, -size, -size], [size, size, size]);
  if (opts.flat) p = groundCut(p.translate([0, size * 0.6, 0]), 0) ?? p;
  return p;
}

/**
 * Hexagonal crystal spur: `sides` planes of radius r (slight taper), a faceted crown made of `crown` roof planes.
 * Built upright with its base at y=0 and apex at ~h; use leanPoly/translate to place it.
 */
export function crystal(rng: Rng, r: number, h: number, opts: { sides?: number; crown?: number; taper?: number; slope?: number } = {}): Poly {
  const sides = opts.sides ?? 6;
  const planes: Plane[] = [];
  const a0 = rng.range(0, Math.PI);
  for (let i = 0; i < sides; i++) planes.push(sidePlane(a0 + (i / sides) * Math.PI * 2 + rng.range(-0.1, 0.1), r * rng.range(0.85, 1.1), opts.taper ?? 0.03, -1));
  const crown = opts.crown ?? 3;
  const ca = rng.range(0, Math.PI * 2);
  for (let i = 0; i < crown; i++) {
    const a = ca + (i / crown) * Math.PI * 2 + rng.range(-0.25, 0.25);
    planes.push(roofPlane(a, opts.slope ?? 0.9, [Math.cos(a) * r * 0.25, h * (0.78 + rng.range(0, 0.22)), Math.sin(a) * r * 0.25], -1));
  }
  planes.push({ n: [0, -1, 0], d: 0.02 });
  return Poly.fromPlanes(planes, Math.max(h, r) * 3) ?? Poly.box([-r, 0, -r], [r, h, r]);
}

/** double-ended crystal (rune shard): `sides` facets, tips at +-h, widest at the girdle (radius r) */
export function bipyramid(rng: Rng, r: number, h: number, sides = 5, opts: { girdle?: number; skew?: number } = {}): Poly {
  const planes: Plane[] = [];
  const a0 = rng.range(0, Math.PI * 2);
  const girdle = opts.girdle ?? 0.0;
  const slope = Math.atan2(h, r);
  for (let i = 0; i < sides; i++) {
    const a = a0 + (i / sides) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const rr = r * rng.range(0.9, 1.1);
    const up = roofPlane(a, Math.PI / 2 - slope, [Math.cos(a) * rr, girdle, Math.sin(a) * rr], -1);
    planes.push(up);
    const dn = vnorm([up.n[0], -up.n[1], up.n[2]]);
    planes.push({ n: dn, d: dn[0] * Math.cos(a) * rr + dn[1] * girdle + dn[2] * Math.sin(a) * rr, plane: -1 });
  }
  return Poly.fromPlanes(planes, Math.max(h, r) * 4) ?? Poly.box([-r, -h, -r], [r, h, r]);
}
