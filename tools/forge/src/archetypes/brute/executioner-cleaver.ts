// The executioner's cleaver: a huge notched butcher's blade (~1.1 m) baked into the right fist as rigid parts of `wrist_r`.
// Modelled in the REST hand frame (humans/kit.ts `hp`): the handle runs along the grip axis (+Z), the blade starts in front of
// the fists, the cutting edge faces hand -Y (fingertip side) and the flats face the palm normal, so an IK-aimed hand carries it
// edge-first like an axe. Dimensions are authored in reference metres and scaled by the body scale.
import { type Aabb, type Vec3 } from '../../core/math.ts';
import { Sdf } from '../../core/sdf/node.ts';
import { Ellipsoid, RoundCone, Torus } from '../../core/sdf/primitives.ts';
import type { Anatomy, Ctx } from '../humanoid/index.ts';
import { cylinder, frustum, handRef, hp, rigid } from '../humans/kit.ts';

/** Reference-metre layout of the cleaver along the hand's grip axis (z from the right palm centre). */
export const CLEAVER = {
  /** pommel / ferrule / blade root along the grip axis */
  pommelZ: -0.135,
  ferruleZ: 0.215,
  rootZ: 0.245,
  /** blade length from the root to the squared tip, spine / edge offsets from the handle axis (v positive = toward the edge) */
  len: 0.8,
  spineV: -0.052,
  edgeV: 0.178,
  /** grip centre of the second hand relative to the right palm */
  handL: 0.15,
};

/** an outline polygon (u along the blade, v across toward the edge) extruded along the flat normal with a half-thickness profile */
class BladeSlab extends Sdf {
  private n: number;
  private pu: Float64Array;
  private pv: Float64Array;
  constructor(
    private o: Vec3,
    outline: [number, number][],
    private half: (u: number, v: number) => number,
    private round: number,
    private hmax: number,
  ) {
    super();
    this.n = outline.length;
    this.pu = Float64Array.from(outline.map((p) => p[0]));
    this.pv = Float64Array.from(outline.map((p) => p[1]));
    this.lip = 1.6;
  }

  /** signed distance to the outline polygon (negative inside) */
  private d2(u: number, v: number): number {
    const n = this.n, pu = this.pu, pv = this.pv;
    let dmin = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = pu[j]!, ay = pv[j]!, bx = pu[i]!, by = pv[i]!;
      const ex = bx - ax, ey = by - ay;
      const wx = u - ax, wy = v - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      const dx = wx - ex * t, dy = wy - ey * t;
      const dd = dx * dx + dy * dy;
      if (dd < dmin) dmin = dd;
      if (ay > v !== by > v && u < ((bx - ax) * (v - ay)) / (by - ay) + ax) inside = !inside;
    }
    const d = Math.sqrt(dmin);
    return inside ? -d : d;
  }

  // frame: flat normal = world X, blade axis u = world +Z, edge direction v = world -Y (right-hand rest frame)
  d(x: number, y: number, z: number): number {
    const o = this.o;
    const lx = x - o[0], u = z - o[2], v = -(y - o[1]);
    const r = this.round;
    const d2 = this.d2(u, v) + r;
    const h = Math.max(this.half(u, v) - r, 1e-4);
    const dxn = Math.abs(lx) - h;
    const ox = d2 > 0 ? d2 : 0, oy = dxn > 0 ? dxn : 0;
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(d2, dxn), 0) - r;
  }

  protected computeBounds(): Aabb {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      u0 = Math.min(u0, this.pu[i]!); u1 = Math.max(u1, this.pu[i]!);
      v0 = Math.min(v0, this.pv[i]!); v1 = Math.max(v1, this.pv[i]!);
    }
    const pad = this.round + 0.004;
    const o = this.o;
    return { min: [o[0] - this.hmax - pad, o[1] - v1 - pad, o[2] + u0 - pad], max: [o[0] + this.hmax + pad, o[1] - v0 + pad, o[2] + u1 + pad] };
  }
}

const smooth01 = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/**
 * Blade silhouette (u along the blade from the root, v across toward the edge), reference metres: a squared, slightly drooping
 * butcher's tip with a rounded lower corner, a straight heavy spine and a belly edge chewed by chips of different sizes.
 */
export function cleaverOutline(): [number, number][] {
  const { len, spineV: sv, edgeV: ev } = CLEAVER;
  const L = len;
  const pts: [number, number][] = [];
  // spine from the root to the tip (top edge, straight)
  pts.push([0.0, sv + 0.016], [0.045, sv + 0.003], [0.1, sv]);
  pts.push([L * 0.7, sv - 0.002], [L * 0.86, sv + 0.001]);
  // squared tip with a rounded top corner and a drooping front edge
  pts.push([L * 0.955, sv + 0.014], [L * 1.0, sv + 0.058]);
  pts.push([L * 1.006, 0.058], [L * 1.0, 0.1]);
  // big bite out of the lower front corner
  pts.push([L * 0.985, 0.118], [L * 0.935, 0.13], [L * 0.92, 0.156], [L * 0.895, ev - 0.012]);
  // belly edge back toward the heel: nominal curve + chips (u centre, depth, half width)
  const chips: [number, number, number][] = [[0.64, 0.052, 0.052], [0.47, 0.034, 0.036], [0.325, 0.058, 0.056]];
  const edge = (u: number): number => ev - 0.012 * Math.max(0, (L * 0.9 - u) / L) * 0.6 - 0.05 * Math.pow(Math.max(0, (0.2 - u) / 0.2), 1.6);
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const u = L * 0.9 - (L * 0.9 * i) / N;
    let v = edge(u);
    for (const [uc, depth, hw] of chips) {
      const t = (u - uc) / hw;
      if (Math.abs(t) < 1) {
        // asymmetric chip: steep leading side, shallow trailing side
        const prof = t < 0 ? 1 - Math.pow(-t, 0.8) : 1 - Math.pow(t, 1.5);
        v -= depth * Math.max(0, prof);
      }
    }
    pts.push([u, v]);
  }
  // heel up to the root
  pts.push([0.045, 0.062], [0.0, 0.02]);
  return pts;
}

export interface CleaverOpts {
  hand?: 'r' | 'l';
  /** palette keys: blade = steel, handle = leather wrap, metal = iron/brass fittings */
  mats: { blade: string; handle: string; metal: string };
}

/** add the cleaver to the build context (call from `hooks.afterOutfit`); returns the paint tag of the steel blade */
export function addCleaver(ctx: Ctx, a: Anatomy, o: CleaverOpts): { bladeTag: string } {
  const h = handRef(a, o.hand ?? 'r');
  const s = a.s;
  const blade = ctx.piece(o.mats.blade), handle = ctx.piece(o.mats.handle), metal = ctx.piece(o.mats.metal);
  const bone = h.bone;
  const z = (ref: number): number => ref * s;
  const C = CLEAVER;

  // ---- handle: leather-wrapped grip with swelling at the pommel, flared iron pommel cap, lanyard ring
  const gr = 0.0225 * s;
  rigid(ctx, 'cleaver_grip', cylinder(hp(h, 0, 0, z(C.pommelZ + 0.01)), hp(h, 0, 0, z(C.ferruleZ)), gr, 0.008), bone, [handle.tag], 0.004);
  rigid(ctx, 'cleaver_swell', new RoundCone(hp(h, 0, 0, z(C.pommelZ + 0.03)), hp(h, 0, 0, z(C.pommelZ + 0.085)), gr * 1.28, gr * 1.1), bone, [handle.tag], 0.004);
  for (let i = 0; i < 3; i++) {
    const zz = z(0.02 + 0.058 * i);
    rigid(ctx, `cleaver_wrap${i}`, new Torus(hp(h, 0, 0, zz), gr * 1.0, gr * 0.27, [0, 0, 1]), bone, [handle.tag], 0.003);
  }
  rigid(ctx, 'cleaver_pommel', new Ellipsoid(hp(h, 0, 0, z(C.pommelZ)), [gr * 1.7, gr * 1.7, gr * 1.0]), bone, [metal.tag], 0.004);
  rigid(ctx, 'cleaver_ring', new Torus(hp(h, 0, -gr * 2.3, z(C.pommelZ - 0.01)), gr * 1.5, gr * 0.46, [1, 0, 0]), bone, [metal.tag], 0.003);
  // ---- ferrule collar between grip and blade
  rigid(ctx, 'cleaver_ferrule', frustum(hp(h, 0, 0, z(C.ferruleZ - 0.012)), hp(h, 0, 0, z(C.rootZ + 0.02)), gr * 1.42, gr * 1.18, 0.006), bone, [metal.tag], 0.004);

  // ---- blade slab: heavy spine, thinning toward a chipped edge, thicker tang at the heel
  const hSpine = 0.0155 * s, hEdge = 0.006 * s;
  const origin = hp(h, 0, 0, z(C.rootZ));
  const outline = cleaverOutline().map(([u, v]): [number, number] => [u * s, v * s]);
  const half = (u: number, v: number): number => {
    // flat face to v ~ 0.06 ref m, then a crisp bevel down to the thin edge by v ~ 0.15
    const t = smooth01((0.15 * s - v) / (0.09 * s));
    const heel = 0.0045 * s * smooth01(1 - u / (0.15 * s));
    return hEdge + (hSpine - hEdge) * t + heel;
  };
  const slab = new BladeSlab(origin, outline, half, 0.004, hSpine + 0.0055 * s);
  rigid(ctx, 'cleaver_blade', slab, bone, [blade.tag], 0.003);
  // ---- tang rivets (both faces)
  for (let i = 0; i < 3; i++) {
    const zr = z(C.rootZ + 0.035 + 0.06 * i);
    for (const side of [1, -1]) {
      const c = hp(h, side * (hSpine + 0.0085 * s + 0.003), -0.004 * s, zr);
      rigid(ctx, `cleaver_rivet${i}_${side}`, new Ellipsoid(c, [0.011 * s, 0.021 * s, 0.021 * s]), bone, [metal.tag], 0.003);
    }
  }
  // ---- hanging hole near the spine at the tip end
  const hy = -0.012 * s, hz = z(C.rootZ + C.len * 0.84);
  ctx.cut('cleaver_hole', cylinder(hp(h, -0.06 * s, hy, hz), hp(h, 0.06 * s, hy, hz), 0.029 * s, 0.002), bone, { tags: [blade.tag], w: 0.003 });
  return { bladeTag: blade.tag };
}
