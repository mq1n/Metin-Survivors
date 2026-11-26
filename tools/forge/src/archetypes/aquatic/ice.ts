// Faceted ice crystal primitive: an irregular hexagonal prism that tapers and ends in a pyramid tip. Planes are folded with a
// tiny smooth-max so the facets stay crisp (SDF "quartz"). Lives in the archetype (core/ stays untouched).
import { type Aabb, type Vec3, vcross, vnorm } from '../../core/math.ts';
import { Sdf, smax } from '../../core/sdf/node.ts';

export interface CrystalOpts {
  /** number of side faces (default 6) */
  sides?: number;
  /** fraction of the length taken by the pyramid termination (default 0.34) */
  tip?: number;
  /** radius at the termination shoulder relative to the base radius (default 0.82) */
  taper?: number;
  /** rotation of the hexagon about the axis (radians) */
  twist?: number;
  /** per-face apothem multipliers (irregular facets); default regular */
  jitter?: number[];
  /** edge bevel (smooth-max width, metres) */
  bevel?: number;
  /** fraction of the shoulder radius left at the very top (0 = pointed pyramid, ~0.6 = flat-topped slab) */
  apex?: number;
}

export class Crystal extends Sdf {
  private b: Vec3;
  private ax: Vec3;
  private ux: Vec3;
  private uy: Vec3;
  private n: number;
  private cs: Float64Array;
  private sn: Float64Array;
  private jit: Float64Array;
  private h: number;
  private r0: number;
  private r1: number;
  private h0: number;
  private cosHalf: number;
  private w: number;
  private slopeBody: number;
  private slopeTip: number;
  private kBody: number;
  private kTip: number;

  constructor(base: Vec3, dir: Vec3, h: number, r: number, o: CrystalOpts = {}) {
    super();
    this.b = base;
    this.ax = vnorm(dir);
    const helper: Vec3 = Math.abs(this.ax[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    this.ux = vnorm(vcross(helper, this.ax));
    this.uy = vcross(this.ax, this.ux);
    this.n = o.sides ?? 6;
    this.cs = new Float64Array(this.n);
    this.sn = new Float64Array(this.n);
    this.jit = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const phi = (i / this.n) * Math.PI * 2 + (o.twist ?? 0);
      this.cs[i] = Math.cos(phi);
      this.sn[i] = Math.sin(phi);
      this.jit[i] = o.jitter?.[i] ?? 1;
    }
    this.h = h;
    this.r0 = r;
    this.r1 = r * (o.taper ?? 0.82);
    this.h0 = h * (1 - (o.tip ?? 0.34));
    this.cosHalf = Math.cos(Math.PI / this.n);
    this.w = o.bevel ?? 0.0035;
    this.slopeBody = (this.r1 - this.r0) / this.h0;
    this.slopeTip = (-this.r1 * (1 - (o.apex ?? 0))) / (h - this.h0);
    this.kBody = 1 / Math.sqrt(1 + this.slopeBody * this.slopeBody);
    this.kTip = 1 / Math.sqrt(1 + this.slopeTip * this.slopeTip);
    this.lip = 1.25;
  }

  d(x: number, y: number, z: number): number {
    const px = x - this.b[0], py = y - this.b[1], pz = z - this.b[2];
    const t = px * this.ax[0] + py * this.ax[1] + pz * this.ax[2];
    const lx = px * this.ux[0] + py * this.ux[1] + pz * this.ux[2];
    const ly = px * this.uy[0] + py * this.uy[1] + pz * this.uy[2];
    let rad: number, k: number;
    if (t < this.h0) {
      rad = this.r0 + this.slopeBody * (t < 0 ? 0 : t);
      k = this.kBody;
    } else {
      rad = this.r1 + this.slopeTip * (t - this.h0);
      if (rad < 0) rad = 0;
      k = this.kTip;
    }
    const ap = rad * this.cosHalf;
    let d = ((lx * this.cs[0]! + ly * this.sn[0]!) - ap * this.jit[0]!) * k;
    for (let i = 1; i < this.n; i++) d = smax(d, ((lx * this.cs[i]! + ly * this.sn[i]!) - ap * this.jit[i]!) * k, this.w);
    d = smax(d, -t, this.w);
    d = smax(d, t - this.h, this.w);
    return d;
  }

  protected computeBounds(): Aabb {
    const R = this.r0 * 1.02;
    const mn: Vec3 = [Infinity, Infinity, Infinity];
    const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const t of [0, this.h]) {
      for (const a of [-R, R]) {
        for (const c of [-R, R]) {
          for (let i = 0; i < 3; i++) {
            const v = this.b[i]! + this.ax[i]! * t + this.ux[i]! * a + this.uy[i]! * c;
            mn[i] = Math.min(mn[i]!, v);
            mx[i] = Math.max(mx[i]!, v);
          }
        }
      }
    }
    return { min: mn, max: mx };
  }
}

/** a shard cluster description (resolved by body.ts into Crystal parts) */
export interface Shard {
  base: Vec3;
  dir: Vec3;
  h: number;
  r: number;
}
