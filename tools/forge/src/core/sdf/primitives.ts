import { type Aabb, type Quat, type Vec3, qfromBasis, qfromTo, qinv, qrotate, vadd, vcross, vlen, vnorm, vscale, vsub } from '../math.ts';
import { Sdf } from './node.ts';

export class Sphere extends Sdf {
  constructor(
    public c: Vec3,
    public r: number,
  ) {
    super();
  }
  d(x: number, y: number, z: number): number {
    const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - this.r;
  }
  protected computeBounds(): Aabb {
    const { c, r } = this;
    return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
  }
}

/**
 * Ellipsoid with optional rotation (approximate distance, exact zero level set).
 * Semi-axes are in the *local* frame; `rot` rotates local -> world.
 */
export class Ellipsoid extends Sdf {
  private inv: Quat;
  private ix: number;
  private iy: number;
  private iz: number;
  private iix: number;
  private iiy: number;
  private iiz: number;
  private rmin: number;
  constructor(
    public c: Vec3,
    public radii: Vec3,
    public rot: Quat = [0, 0, 0, 1],
  ) {
    super();
    this.inv = qinv(rot);
    this.ix = 1 / radii[0]; this.iy = 1 / radii[1]; this.iz = 1 / radii[2];
    this.iix = this.ix * this.ix; this.iiy = this.iy * this.iy; this.iiz = this.iz * this.iz;
    this.rmin = Math.min(radii[0], radii[1], radii[2]);
    const ratio = Math.max(radii[0], radii[1], radii[2]) / this.rmin;
    // the IQ approximation overshoots the true distance gradient on very thin shapes; measured bound
    this.lip = 1 + 0.35 * Math.min(ratio - 1, 6);
  }
  d(x: number, y: number, z: number): number {
    let px = x - this.c[0], py = y - this.c[1], pz = z - this.c[2];
    const q = this.inv;
    if (q[3] !== 1) {
      const r = qrotate(q, [px, py, pz]);
      px = r[0]; py = r[1]; pz = r[2];
    }
    const ax = px * this.ix, ay = py * this.iy, az = pz * this.iz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = px * this.iix, by = py * this.iiy, bz = pz * this.iiz;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    if (k1 < 1e-9) return -this.rmin;
    return (k0 * (k0 - 1)) / k1;
  }
  protected computeBounds(): Aabb {
    const [rx, ry, rz] = this.radii;
    // conservative: rotated box extents
    const ex = [qrotate(this.rot, [rx, 0, 0]), qrotate(this.rot, [0, ry, 0]), qrotate(this.rot, [0, 0, rz])];
    const hx = Math.abs(ex[0]![0]) + Math.abs(ex[1]![0]) + Math.abs(ex[2]![0]);
    const hy = Math.abs(ex[0]![1]) + Math.abs(ex[1]![1]) + Math.abs(ex[2]![1]);
    const hz = Math.abs(ex[0]![2]) + Math.abs(ex[1]![2]) + Math.abs(ex[2]![2]);
    const c = this.c;
    return { min: [c[0] - hx, c[1] - hy, c[2] - hz], max: [c[0] + hx, c[1] + hy, c[2] + hz] };
  }
}

/**
 * Round cone: two spheres (a, ra) and (b, rb) joined by their tangent hull. Exact distance.
 * With ra === rb it is a capsule. This is the workhorse for limbs, necks, tails, horns, claws.
 */
export class RoundCone extends Sdf {
  private ba: Vec3;
  private l2: number;
  private rr: number;
  private a2: number;
  private il2: number;
  constructor(
    public a: Vec3,
    public b: Vec3,
    public ra: number,
    public rb: number,
  ) {
    super();
    this.ba = vsub(b, a);
    this.l2 = this.ba[0] * this.ba[0] + this.ba[1] * this.ba[1] + this.ba[2] * this.ba[2];
    this.rr = ra - rb;
    this.a2 = this.l2 - this.rr * this.rr;
    this.il2 = 1 / this.l2;
    if (this.l2 < 1e-12 || this.a2 <= 1e-12) {
      // degenerate (one sphere contains the other): fall back to larger sphere
      this.degenerate = true;
    }
  }
  private degenerate = false;
  d(x: number, y: number, z: number): number {
    const a = this.a;
    if (this.degenerate) {
      const big = this.ra >= this.rb;
      const c = big ? a : this.b;
      const r = big ? this.ra : this.rb;
      return Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
    }
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const ba = this.ba, l2 = this.l2, rr = this.rr, a2 = this.a2, il2 = this.il2;
    const yy = pax * ba[0] + pay * ba[1] + paz * ba[2];
    const zz = yy - l2;
    const vx = pax * l2 - ba[0] * yy, vy = pay * l2 - ba[1] * yy, vz = paz * l2 - ba[2] * yy;
    const x2 = vx * vx + vy * vy + vz * vz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = (rr < 0 ? -1 : 1) * rr * rr * x2;
    if ((zz < 0 ? -1 : 1) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - this.rb;
    if ((yy < 0 ? -1 : 1) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - this.ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - this.ra;
  }
  protected computeBounds(): Aabb {
    const { a, b, ra, rb } = this;
    return {
      min: [Math.min(a[0] - ra, b[0] - rb), Math.min(a[1] - ra, b[1] - rb), Math.min(a[2] - ra, b[2] - rb)],
      max: [Math.max(a[0] + ra, b[0] + rb), Math.max(a[1] + ra, b[1] + rb), Math.max(a[2] + ra, b[2] + rb)],
    };
  }
}

/** Box with rounded edges (radius `round` is *inside* the half extents). Optional rotation local -> world. */
export class RoundedBox extends Sdf {
  private inv: Quat;
  constructor(
    public c: Vec3,
    public half: Vec3,
    public round = 0,
    public rot: Quat = [0, 0, 0, 1],
  ) {
    super();
    this.inv = qinv(rot);
  }
  d(x: number, y: number, z: number): number {
    let px = x - this.c[0], py = y - this.c[1], pz = z - this.c[2];
    if (this.inv[3] !== 1) {
      const r = qrotate(this.inv, [px, py, pz]);
      px = r[0]; py = r[1]; pz = r[2];
    }
    const r = this.round;
    const qx = Math.abs(px) - (this.half[0] - r), qy = Math.abs(py) - (this.half[1] - r), qz = Math.abs(pz) - (this.half[2] - r);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  }
  protected computeBounds(): Aabb {
    const h = this.half;
    const ex = [qrotate(this.rot, [h[0], 0, 0]), qrotate(this.rot, [0, h[1], 0]), qrotate(this.rot, [0, 0, h[2]])];
    const hx = Math.abs(ex[0]![0]) + Math.abs(ex[1]![0]) + Math.abs(ex[2]![0]);
    const hy = Math.abs(ex[0]![1]) + Math.abs(ex[1]![1]) + Math.abs(ex[2]![1]);
    const hz = Math.abs(ex[0]![2]) + Math.abs(ex[1]![2]) + Math.abs(ex[2]![2]);
    const c = this.c;
    return { min: [c[0] - hx, c[1] - hy, c[2] - hz], max: [c[0] + hx, c[1] + hy, c[2] + hz] };
  }
}

/** Torus: major radius R around `axis`, tube radius r. */
export class Torus extends Sdf {
  private inv: Quat;
  private axisRot: Quat;
  constructor(
    public c: Vec3,
    public R: number,
    public r: number,
    axis: Vec3 = [0, 1, 0],
  ) {
    super();
    this.axisRot = qfromTo([0, 1, 0], vnorm(axis));
    this.inv = qinv(this.axisRot);
  }
  d(x: number, y: number, z: number): number {
    const p = qrotate(this.inv, [x - this.c[0], y - this.c[1], z - this.c[2]]);
    const qx = Math.hypot(p[0], p[2]) - this.R;
    return Math.hypot(qx, p[1]) - this.r;
  }
  protected computeBounds(): Aabb {
    const ext = this.R + this.r;
    const ex = [qrotate(this.axisRot, [ext, 0, 0]), qrotate(this.axisRot, [0, this.r, 0]), qrotate(this.axisRot, [0, 0, ext])];
    const hx = Math.abs(ex[0]![0]) + Math.abs(ex[1]![0]) + Math.abs(ex[2]![0]);
    const hy = Math.abs(ex[0]![1]) + Math.abs(ex[1]![1]) + Math.abs(ex[2]![1]);
    const hz = Math.abs(ex[0]![2]) + Math.abs(ex[1]![2]) + Math.abs(ex[2]![2]);
    const c = this.c;
    return { min: [c[0] - hx, c[1] - hy, c[2] - hz], max: [c[0] + hx, c[1] + hy, c[2] + hz] };
  }
}

/** Infinite half-space below the plane through `point` with outward normal `n` (d = dot(p - point, n)). Bounds are finite stand-ins. */
export class HalfSpace extends Sdf {
  private n: Vec3;
  constructor(
    public point: Vec3,
    n: Vec3,
    private extent = 100,
  ) {
    super();
    this.n = vnorm(n);
  }
  d(x: number, y: number, z: number): number {
    const p = this.point, n = this.n;
    return (x - p[0]) * n[0] + (y - p[1]) * n[1] + (z - p[2]) * n[2];
  }
  protected computeBounds(): Aabb {
    const e = this.extent;
    return { min: [-e, -e, -e], max: [e, e, e] };
  }
}

// ---------------------------------------------------------------- convenience constructors
export const sphere = (c: Vec3, r: number): Sphere => new Sphere(c, r);
export const ellipsoid = (c: Vec3, radii: Vec3, rot?: Quat): Ellipsoid => new Ellipsoid(c, radii, rot);
export const roundCone = (a: Vec3, b: Vec3, ra: number, rb: number): RoundCone => new RoundCone(a, b, ra, rb);
export const capsule = (a: Vec3, b: Vec3, r: number): RoundCone => new RoundCone(a, b, r, r);
export const roundedBox = (c: Vec3, half: Vec3, round = 0, rot?: Quat): RoundedBox => new RoundedBox(c, half, round, rot);
export const torus = (c: Vec3, R: number, r: number, axis?: Vec3): Torus => new Torus(c, R, r, axis);

/** Ellipsoid whose long axis runs from `a` to `b` (radii = the two short semi-axes; `side` orients the first): leaf shapes — ears, claws, feathers. */
export function spindle(a: Vec3, b: Vec3, radii: [number, number], side: Vec3 = [1, 0, 0]): Ellipsoid {
  // local frame: Z = a->b, X = side-ish, Y = Z x X
  const z = vnorm(vsub(b, a));
  let x = vsub(side, vscale(z, side[0] * z[0] + side[1] * z[1] + side[2] * z[2]));
  if (vlen(x) < 1e-6) x = vcross(z, [0, 1, 0]);
  x = vnorm(x);
  const y = vcross(z, x);
  const q = qfromBasis(x, y, z);
  const mid = vscale(vadd(a, b), 0.5);
  const half = vlen(vsub(b, a)) / 2;
  return new Ellipsoid(mid, [radii[0], radii[1], half], q);
}
