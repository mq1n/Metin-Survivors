// FlameBlade: a sword blade as ONE signed-distance field: variable half-width / half-thickness / centre offset along its axis,
// a rhombic (lenticular) cross-section (crisp central ridge + bevelled edges that the voxel mesher can still resolve), a pointed
// tip, an optional sinuous "flamberge" outline and a sabre bow. Local frame: `axis` base -> tip, `across` = edge-to-edge width,
// `thick` = flat-face normal. Also builds the matching paint-only marks (centre fuller, edge bands).
import { type Aabb, type Vec3, vcross, vnorm } from '../../core/math.ts';
import { Sdf } from '../../core/sdf/node.ts';
import { tube } from '../../core/sdf/shapes.ts';

/** piecewise-linear curve through [t, value] points */
export type Curve = readonly (readonly [number, number])[];

export function curveAt(c: Curve, t: number): number {
  if (t <= c[0]![0]) return c[0]![1];
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i]!, b = c[i + 1]!;
    if (t <= b[0]) return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1);
  }
  return c[c.length - 1]![1];
}

export interface FlameBladeOpts {
  base: Vec3;
  /** unit blade direction (base -> tip) */
  axis: Vec3;
  /** unit edge-to-edge direction (perpendicular to the axis) */
  across: Vec3;
  length: number;
  /** base half width / half thickness (m) */
  halfW: number;
  halfT: number;
  /** width / thickness multipliers over t = 0..1 */
  width: Curve;
  thick: Curve;
  /** sinuous outline: relative amplitude of the half width, cycles along the blade, phase (rad), tip-ward skew (0..1: sawtooth lobes) */
  waveW?: { amp: number; cycles: number; phase?: number; skew?: number };
  /** serpentine centre line: amplitude (m) and cycles */
  waveC?: { amp: number; cycles: number; phase?: number };
  /** sabre bow: centre-line offset at the tip (m, along `across`, quadratic) */
  bow?: number;
  /** edge rounding radius (m) */
  round?: number;
  /** thickness at the edge as a fraction of the full half thickness (keeps edges >= ~1 voxel so the mesher never erodes them) */
  bevel?: number;
  /** fraction of the half width kept at full thickness before the chamfer starts */
  flat?: number;
}

export class FlameBlade extends Sdf {
  readonly o: Required<Omit<FlameBladeOpts, 'waveW' | 'waveC'>> & Pick<FlameBladeOpts, 'waveW' | 'waveC'>;
  /** orthonormal blade frame: axis (base -> tip), across (edge to edge), face normal */
  readonly A: Vec3;
  readonly U: Vec3;
  readonly V: Vec3;
  private r: number;

  constructor(opts: FlameBladeOpts) {
    super();
    this.o = { bow: 0, round: 0.004, bevel: 0.42, flat: 0.4, ...opts };
    this.A = vnorm(opts.axis);
    const u0 = opts.across;
    const d = u0[0] * this.A[0] + u0[1] * this.A[1] + u0[2] * this.A[2];
    this.U = vnorm([u0[0] - this.A[0] * d, u0[1] - this.A[1] * d, u0[2] - this.A[2] * d]);
    this.V = vnorm(vcross(this.A, this.U));
    this.r = this.o.round;
    // Lipschitz: sample the slopes of the outline functions
    let slope = 0;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const dw = Math.abs(this.hw(t1) - this.hw(t0)) / (this.o.length / n);
      const dc = Math.abs(this.cen(t1) - this.cen(t0)) / (this.o.length / n);
      const dt = Math.abs(this.ht(t1) - this.ht(t0)) / (this.o.length / n);
      slope = Math.max(slope, Math.hypot(dw, dc, dt));
    }
    this.lip = Math.sqrt(1 + slope * slope) * 1.12;
  }

  /** half width at t */
  hw(t: number): number {
    const o = this.o;
    let w = o.halfW * curveAt(o.width, t);
    if (o.waveW) {
      const th = 2 * Math.PI * o.waveW.cycles * t + (o.waveW.phase ?? 0);
      const k = o.waveW.skew ?? 0;
      // skewed lobe: slow rise toward the tip side, sharp fall (flame tongue); fades in over the first 12 % and out at the tip
      const lobe = Math.sin(th) + k * 0.5 * Math.sin(2 * th + 0.6);
      const env = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.14);
      w *= 1 + o.waveW.amp * lobe * Math.max(env, 0);
    }
    return Math.max(w, 1e-4);
  }

  ht(t: number): number {
    return Math.max(this.o.halfT * curveAt(this.o.thick, t), 1e-4);
  }

  /** centre-line offset along `across` at t */
  cen(t: number): number {
    const o = this.o;
    let c = o.bow * t * t;
    if (o.waveC) c += o.waveC.amp * Math.sin(2 * Math.PI * o.waveC.cycles * t + (o.waveC.phase ?? 0)) * Math.min(1, t / 0.2);
    return c;
  }

  /** world point on the centre line at t (offset `side` of the half width along `across`, `lift` along the face normal) */
  at(t: number, side = 0, lift = 0): Vec3 {
    const o = this.o;
    const w = t * o.length;
    const c = this.cen(t) + side * this.hw(t);
    return [
      o.base[0] + this.A[0] * w + this.U[0] * c + this.V[0] * lift,
      o.base[1] + this.A[1] * w + this.U[1] * c + this.V[1] * lift,
      o.base[2] + this.A[2] * w + this.U[2] * c + this.V[2] * lift,
    ];
  }

  d(x: number, y: number, z: number): number {
    const o = this.o;
    const px = x - o.base[0], py = y - o.base[1], pz = z - o.base[2];
    const w = px * this.A[0] + py * this.A[1] + pz * this.A[2];
    const u = px * this.U[0] + py * this.U[1] + pz * this.U[2];
    const v = px * this.V[0] + py * this.V[1] + pz * this.V[2];
    const L = o.length;
    const t = w <= 0 ? 0 : w >= L ? 1 : w / L;
    const r = this.r;
    const hw = Math.max(this.hw(t) - r, 1e-4), ht = Math.max(this.ht(t) - r, 1e-4);
    const ax = Math.abs(u - this.cen(t)), ay = Math.abs(v);
    // chamfered hexagon = intersection of |u| <= hw, |v| <= ht and the bevel planes; max of plane distances is a conservative SDF
    const x0 = hw * o.flat;
    const slope = (ht * (1 - o.bevel)) / Math.max(hw - x0, 1e-4);
    const dBevel = (ay + slope * (ax - x0) - ht) / Math.sqrt(1 + slope * slope);
    const dc = Math.max(ax - hw, ay - ht, dBevel);
    const dw = Math.max(-w, w - L);
    const a = dc + r, b = dw + r;
    const qa = a > 0 ? a : 0, qb = b > 0 ? b : 0;
    return Math.sqrt(qa * qa + qb * qb) + Math.min(Math.max(a, b), 0) - r;
  }

  protected computeBounds(): Aabb {
    const o = this.o;
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    const pad = this.r + 0.004;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const w = t * o.length;
      const cc = this.cen(t), hw = this.hw(t), ht = this.ht(t);
      for (const su of [-1, 1]) {
        for (const sv of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const p = o.base[k]! + this.A[k]! * w + this.U[k]! * (cc + su * hw) + this.V[k]! * sv * ht;
            mn[k] = Math.min(mn[k]!, p - pad);
            mx[k] = Math.max(mx[k]!, p + pad);
          }
        }
      }
    }
    return { min: mn, max: mx };
  }

  /** centre fuller: a thin tube following the centre line, radius covers the flat faces for `halfStrip` either side (paint mark) */
  fuller(t0: number, t1: number, halfStrip: number): Sdf {
    const n = 14;
    const pts: Vec3[] = [];
    for (let i = 0; i <= n; i++) pts.push(this.at(t0 + ((t1 - t0) * i) / n));
    const ht = this.ht((t0 + t1) / 2);
    return tube(pts, () => Math.sqrt(ht * ht + halfStrip * halfStrip) + 0.002, { segments: n, w: 0.004 });
  }

  /** edge bands along both edges (paint mark): `width` is how far the band reaches over the faces */
  edges(t0: number, t1: number, width: number, which: 'both' | 'left' | 'right' = 'both'): Sdf[] {
    const out: Sdf[] = [];
    const n = 18;
    for (const side of which === 'both' ? [-1, 1] : which === 'left' ? [-1] : [1]) {
      const pts: Vec3[] = [];
      for (let i = 0; i <= n; i++) pts.push(this.at(t0 + ((t1 - t0) * i) / n, side * 0.98));
      out.push(tube(pts, (t) => this.ht(t0 + (t1 - t0) * t) * this.o.bevel + width, { segments: n, w: 0.004 }));
    }
    return out;
  }
}
