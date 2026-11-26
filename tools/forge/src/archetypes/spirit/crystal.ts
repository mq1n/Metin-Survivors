// Faceted crystal primitive: an exact convex polytope (prism + pyramid caps) built from planes, with polynomial smooth-max
// so the edges are crisp but never razor-thin. This is what gives the ice spirits their cut-gem silhouettes instead of
// round blobs. Cross-sections may be flattened into blades.
import { type Aabb, type Vec3, basisFromDirSide, vcross, vlen, vnorm, vsub } from '../../core/math.ts';
import { FnSdf, type Sdf, smax } from '../../core/sdf/node.ts';

export interface CrystalOpts {
  /** cross-section polygon sides (3..8) */
  sides?: number;
  /** fraction of the length where the prism ends and the tip pyramid starts (1 = flat top, 0.5 = half pyramid) */
  shoulder?: number;
  /** base end: 'point' = pyramid (double terminated), 'flat' = cut flat, 'blunt' = short pyramid */
  base?: 'point' | 'flat' | 'blunt';
  /** fraction of the length from the base end where the base pyramid ends (point: 0.3, blunt: 0.1) */
  baseShoulder?: number;
  /** across/along flattening of the cross-section: 1 regular, 0.3 blade-like */
  flat?: number;
  /** cross-section rotation (rad) */
  twist?: number;
  /** radius multiplier at the shoulder end relative to the base (1 = straight prism; <1 narrows, >1 widens) */
  taper?: number;
  /** edge rounding (m, smooth-max width) */
  edge?: number;
  /** direction of the wide side of a flattened crystal */
  side?: Vec3;
  /** stagger of the tip facets relative to the side faces (0..1 of a side step; 0.5 = cut-gem zigzag) */
  stagger?: number;
}

/** Crystal along a -> b (a = base, b = tip) with maximum (inscribed) radius `r`. */
export function crystal(a: Vec3, b: Vec3, r: number, o: CrystalOpts = {}): Sdf {
  const n = o.sides ?? 6;
  const L = vlen(vsub(b, a));
  const Ls = (o.shoulder ?? 0.6) * L;
  const flat = o.flat ?? 1;
  const taper = o.taper ?? 1;
  const w = o.edge ?? 0.005;
  const twist = o.twist ?? 0;
  const stagger = o.stagger ?? 0.5;
  const base = o.base ?? 'point';
  const Lb = base === 'flat' ? 0 : (o.baseShoulder ?? (base === 'point' ? 0.3 : 0.1)) * L;
  const axis = vnorm(vsub(b, a));
  const sideHint: Vec3 = o.side ?? (Math.abs(axis[1]) < 0.9 ? vcross(axis, [0, 1, 0]) : [1, 0, 0]);
  const basis = basisFromDirSide(axis, sideHint); // y = axis, x = side (wide), z = x cross y
  const bx = basis.x, by = basis.y, bz = basis.z;

  // support radius of the (flattened) cross-section in direction theta
  const sup = (th: number): number => r * Math.hypot(Math.cos(th), flat * Math.sin(th));
  const dTaper = (1 - taper) / Math.max(Ls, 1e-6);

  // plane table: [nx, ny, nz, offset] with d = n . p_local - offset (p_local: y measured from the base point)
  const planes: number[] = [];
  const push = (nx: number, ny: number, nz: number, off: number): void => {
    const l = Math.hypot(nx, ny, nz);
    planes.push(nx / l, ny / l, nz / l, off / l);
  };
  // side faces: radial distance h (1 - dTaper y)  ->  c x + k y + s z = h with k = h dTaper
  for (let i = 0; i < n; i++) {
    const th = twist + (2 * Math.PI * i) / n;
    const h = sup(th);
    push(Math.cos(th), h * dTaper, Math.sin(th), h);
  }
  if (Ls < L * 0.999) {
    for (let i = 0; i < n; i++) {
      const th = twist + (2 * Math.PI * (i + stagger)) / n;
      const rho = sup(th) * taper;
      const k = rho / Math.max(L - Ls, 1e-6);
      // c x + s z + k (y - L) = 0
      push(Math.cos(th), k, Math.sin(th), k * L);
    }
  } else {
    push(0, 1, 0, L);
  }
  if (base === 'flat') {
    push(0, -1, 0, 0);
  } else {
    for (let i = 0; i < n; i++) {
      const th = twist + (2 * Math.PI * (i + stagger)) / n;
      const k = sup(th) / Math.max(Lb, 1e-6);
      // c x + s z - k y = 0
      push(Math.cos(th), -k, Math.sin(th), 0);
    }
  }
  const np = planes.length / 4;
  const P = Float64Array.from(planes);
  const ax = a[0], ay = a[1], az = a[2];
  const fn = (x: number, y: number, z: number): number => {
    const px = x - ax, py = y - ay, pz = z - az;
    const lx = px * bx[0] + py * bx[1] + pz * bx[2];
    const ly = px * by[0] + py * by[1] + pz * by[2];
    const lz = px * bz[0] + py * bz[1] + pz * bz[2];
    let d = P[0]! * lx + P[1]! * ly + P[2]! * lz - P[3]!;
    for (let i = 1; i < np; i++) {
      const o4 = i * 4;
      d = smax(d, P[o4]! * lx + P[o4 + 1]! * ly + P[o4 + 2]! * lz - P[o4 + 3]!, w);
    }
    return d;
  };
  const m = r * 1.3 + 0.01;
  const box: Aabb = {
    min: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m],
    max: [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m],
  };
  return new FnSdf(fn, box, 1);
}
