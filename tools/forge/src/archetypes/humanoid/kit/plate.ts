// Curved armour plate: a patch of a cylindrical shell (or a flat slab when R = 0) with rounded edges. The workhorse for
// pauldron lames, bracers, greaves, tassets, gorgets, lamellar scales, belts and shoulder horns.
import { type Aabb, type Vec3, vcross, vdot, vnorm, vsub } from '../../../core/math.ts';
import { Sdf } from '../../../core/sdf/node.ts';

export interface PlateOpts {
  /** centre of the plate on its mid-surface */
  o: Vec3;
  /** outward normal at the centre */
  nrm: Vec3;
  /** direction of the straight (v) axis; projected perpendicular to `nrm` */
  up: Vec3;
  /** half extent along the curved direction (arc length, metres) */
  hu: number;
  /** half extent along the straight direction */
  hv: number;
  /** curvature radius about the v axis; >0 convex (bulges toward nrm), <0 concave, 0 = flat */
  R?: number;
  /** thickness (metres) */
  t: number;
  /** edge rounding (metres, < t/2 .. hu) */
  round?: number;
  /** 0..1: narrowing of the arc width toward +v (>0) or -v (<0) */
  taper?: number;
  /** bow of the v edges along u: positive curls both v edges toward -v at the u edges (scalloped / cupped lames) */
  bow?: number;
  /** thickness multiplier toward the u edges (<1 = chamfered rims) */
  edgeThin?: number;
}

const OPT_DEFAULT = { R: 0, round: 0.003, taper: 0, bow: 0, edgeThin: 1 };

export class Plate extends Sdf {
  readonly o: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
  readonly hu: number;
  readonly hv: number;
  readonly R: number;
  readonly t: number;
  readonly round: number;
  readonly taper: number;
  readonly bow: number;
  readonly edgeThin: number;
  constructor(opts: PlateOpts) {
    super();
    const o = { ...OPT_DEFAULT, ...opts };
    this.o = o.o;
    this.n = vnorm(o.nrm);
    const up = vnorm(o.up);
    const vperp = vsub(up, [this.n[0] * vdot(up, this.n), this.n[1] * vdot(up, this.n), this.n[2] * vdot(up, this.n)]);
    this.v = vnorm(vperp);
    this.u = vnorm(vcross(this.v, this.n));
    this.hu = o.hu;
    this.hv = o.hv;
    this.R = o.R;
    this.t = o.t;
    this.round = Math.min(o.round, o.t * 0.5 - 1e-4);
    this.taper = o.taper;
    this.bow = o.bow;
    this.edgeThin = o.edgeThin;
    this.lip = 1.25 + Math.abs(this.bow) * 4;
  }

  /** (edge distance along arc, along v, radial) in local units, all signed distance-like (negative inside) */
  private local(x: number, y: number, z: number, out: Float64Array): void {
    const dx = x - this.o[0], dy = y - this.o[1], dz = z - this.o[2];
    const pu = dx * this.u[0] + dy * this.u[1] + dz * this.u[2];
    let pv = dx * this.v[0] + dy * this.v[1] + dz * this.v[2];
    const pn = dx * this.n[0] + dy * this.n[1] + dz * this.n[2];
    let arc: number, rad: number;
    if (this.R > 0) {
      const R = this.R;
      const w = pn + R;
      const rho = Math.sqrt(pu * pu + w * w);
      arc = Math.atan2(pu, w) * R;
      rad = rho - R;
    } else if (this.R < 0) {
      const R = -this.R;
      const w = R - pn;
      const rho = Math.sqrt(pu * pu + w * w);
      arc = Math.atan2(pu, w) * R;
      rad = R - rho;
    } else {
      rad = pn;
      arc = pu;
    }
    if (this.bow !== 0) {
      const k = this.hu > 0 ? arc / this.hu : 0;
      pv += this.bow * Math.max(1 - k * k, 0);
    }
    let hu = this.hu;
    if (this.taper !== 0) {
      const s = this.hv > 0 ? pv / this.hv : 0;
      hu *= 1 - this.taper * (s * 0.5 + 0.5) * 0.9;
      if (hu < 1e-3) hu = 1e-3;
    }
    out[0] = Math.abs(arc) - hu;
    out[1] = Math.abs(pv) - this.hv;
    out[2] = this.edgeThin !== 1 ? Math.abs(rad) - this.t * 0.5 * (1 - (1 - this.edgeThin) * Math.min(1, Math.abs(arc) / (hu || 1)) ** 3) : Math.abs(rad) - this.t * 0.5;
  }

  private tmp = new Float64Array(3);

  d(x: number, y: number, z: number): number {
    const q = this.tmp;
    this.local(x, y, z, q);
    const r = this.round;
    const a = q[0]! + r, b = q[1]! + r, c = q[2]! + r;
    const ox = a > 0 ? a : 0, oy = b > 0 ? b : 0, oz = c > 0 ? c : 0;
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(a, b, c), 0) - r;
  }

  /** inset distance from the plate boundary in the surface directions (positive inside the outline) */
  inset(x: number, y: number, z: number): number {
    const q = this.tmp;
    this.local(x, y, z, q);
    return -Math.max(q[0]!, q[1]!);
  }

  /** the band of this plate within `width` of its outline (paint-only region for gold trim) */
  rim(width: number): Sdf {
    return new PlateRim(this, width);
  }

  protected computeBounds(): Aabb {
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    const R = Math.abs(this.R);
    const thetaMax = R > 0 ? Math.min(this.hu / R, Math.PI) : 0;
    const pad = this.t * 0.5 + 0.004 + Math.abs(this.bow);
    const huw = this.hu;
    const push = (pu: number, pv: number, pn: number): void => {
      const p: Vec3 = [
        this.o[0] + this.u[0] * pu + this.v[0] * pv + this.n[0] * pn,
        this.o[1] + this.u[1] * pu + this.v[1] * pv + this.n[1] * pn,
        this.o[2] + this.u[2] * pu + this.v[2] * pv + this.n[2] * pn,
      ];
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i]!, p[i]! - pad); mx[i] = Math.max(mx[i]!, p[i]! + pad); }
    };
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const f = (i / steps) * 2 - 1;
      let pu: number, pn: number;
      if (R > 0) {
        const th = f * thetaMax;
        pu = R * Math.sin(th);
        pn = this.R > 0 ? R * Math.cos(th) - R : R - R * Math.cos(th);
      } else {
        pu = f * huw;
        pn = 0;
      }
      push(pu, this.hv, pn);
      push(pu, -this.hv, pn);
    }
    return { min: mn, max: mx };
  }
}

class PlateRim extends Sdf {
  constructor(private plate: Plate, private width: number) {
    super();
    this.lip = plate.lip * 1.2;
  }
  d(x: number, y: number, z: number): number {
    const dp = this.plate.d(x, y, z);
    const core = -this.plate.inset(x, y, z) + this.width; // negative inside the core
    const m = -core;
    return dp > m ? dp : m;
  }
  protected computeBounds(): Aabb {
    return this.plate.bounds();
  }
}
