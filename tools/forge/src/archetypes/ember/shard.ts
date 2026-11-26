// Faceted shard: a four-sided tapered prism (obsidian spike, flame blade, crystal, horn fin) with crisp planar facets.
// Local frame: z along base -> tip, x = `side` (width), y = z x x (thickness). The base end extends `root` metres BELOW the base
// point so the shard is rooted inside whatever it grows from; the tip is a (tu, tv) flat so it never degenerates.
import { type Aabb, type Vec3, vcross, vdot, vlen, vnorm, vsub } from '../../core/math.ts';
import { Sdf } from '../../core/sdf/node.ts';

export interface ShardOpts {
  /** tip half-width / half-thickness (default 8 % of the base) */
  tu?: number;
  tv?: number;
  /** extension below the base point (default 1.2 * wu) */
  root?: number;
  /** width direction hint (projected perpendicular to the axis) */
  side?: Vec3;
  /** edge rounding (metres) */
  round?: number;
  /** blade bow: tip offset along the width axis as a fraction of the length (0 = straight) */
  bow?: number;
}

export class Shard extends Sdf {
  private B: Vec3;
  private u: Vec3;
  private v: Vec3;
  private w: Vec3;
  private L: number;
  private wu: number;
  private wv: number;
  private tu: number;
  private tv: number;
  private root: number;
  private r: number;
  private su: number;
  private sv: number;
  private bow: number;
  constructor(base: Vec3, tip: Vec3, wu: number, wv: number, o: ShardOpts = {}) {
    super();
    this.B = base;
    const ax = vsub(tip, base);
    this.L = Math.max(vlen(ax), 1e-4);
    this.w = vnorm(ax);
    const hint = o.side ?? (Math.abs(this.w[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
    const d = vdot(hint, this.w);
    this.u = vnorm([hint[0] - this.w[0] * d, hint[1] - this.w[1] * d, hint[2] - this.w[2] * d]);
    this.v = vcross(this.w, this.u);
    this.wu = wu;
    this.wv = wv;
    this.tu = o.tu ?? wu * 0.08;
    this.tv = o.tv ?? wv * 0.08;
    this.root = o.root ?? wu * 1.2;
    this.r = Math.min(o.round ?? 0.003, wv * 0.9, wu * 0.9);
    this.bow = o.bow ?? 0;
    this.su = (this.tu - wu) / this.L;
    this.sv = (this.tv - wv) / this.L;
    this.su = 1 / Math.sqrt(1 + this.su * this.su + this.bow * this.bow);
    this.sv = 1 / Math.sqrt(1 + this.sv * this.sv);
    this.lip = 1.15;
  }

  d(x: number, y: number, z: number): number {
    const B = this.B;
    const px = x - B[0], py = y - B[1], pz = z - B[2];
    const lz = px * this.w[0] + py * this.w[1] + pz * this.w[2];
    let lx = px * this.u[0] + py * this.u[1] + pz * this.u[2];
    const ly = px * this.v[0] + py * this.v[1] + pz * this.v[2];
    const t = lz <= 0 ? 0 : lz >= this.L ? 1 : lz / this.L;
    if (this.bow !== 0) lx -= this.bow * this.L * t * t;
    const hw = this.wu + (this.tu - this.wu) * t, hh = this.wv + (this.tv - this.wv) * t;
    const r = this.r;
    const qx = (Math.abs(lx) - hw) * this.su + r, qy = (Math.abs(ly) - hh) * this.sv + r;
    const qz = Math.max(-this.root - lz, lz - this.L) + r;
    const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  }

  protected computeBounds(): Aabb {
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    const ends: [number, number, number, number][] = [[-this.root, this.wu, this.wv, 0], [this.L, this.tu, this.tv, 1]];
    for (const [z, hw, hh, t] of ends) {
      const off = this.bow * this.L * t * t;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const c = this.B[k]! + this.w[k]! * z + this.u[k]! * (sx * hw + off) + this.v[k]! * sy * hh;
            mn[k] = Math.min(mn[k]!, c - this.r - 0.002);
            mx[k] = Math.max(mx[k]!, c + this.r + 0.002);
          }
        }
      }
    }
    return { min: mn, max: mx };
  }
}
