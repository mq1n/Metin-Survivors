// Orc kit helpers: SDF shorthands, the weapon-space -> hand-frame mapper, spikes / claws / chains / feathers shared by every
// orc and esoteric model. Pure geometry helpers (no pipeline state); everything is in world metres, +Z forward, +X = left.
import { type Aabb, type Quat, type Vec3, qfromBasis, qfromTo, vadd, vcross, vdot, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Sdf } from '../../core/sdf/node.ts';
import { SmoothIntersect, SmoothUnion } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, RoundedBox, Torus } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import type { Anatomy } from '../humanoid/index.ts';

export const rc = (a: Vec3, b: Vec3, ra: number, rb: number): Sdf => new RoundCone(a, b, ra, rb);
export const el = (c: Vec3, r: Vec3, rot?: Quat): Sdf => new Ellipsoid(c, r, rot);
export const rbox = (c: Vec3, half: Vec3, round: number, rot?: Quat): Sdf => new RoundedBox(c, half, round, rot);
export const U = (parts: Sdf[], w: number): Sdf => new SmoothUnion(parts.map((node) => ({ node, w })));
export const I = (parts: Sdf[], w: number): Sdf => new SmoothIntersect(parts, w);

/**
 * Weapon-space frame of a hand at the rest pose. Weapon axes: +Y along the haft (toward the business end), +Z = the edge side
 * (where the blade edge / spikes face), +X = flat normal (right-handed). Mapping into the hand frame (README, "Hand frame"):
 * weapon +Y -> hand +Z, weapon +Z -> hand -X (right) / +X (left). The weapon is skinned to the wrist bone, so wherever the
 * clips put the hand, the weapon follows rigidly.
 */
export interface WFrame {
  /** weapon-space point -> world rest-pose point (origin = grip centre at the palm) */
  p(x: number, y: number, z: number): Vec3;
  /** weapon-space direction -> world direction */
  d(x: number, y: number, z: number): Vec3;
  /** quaternion whose local x/y/z axes are the weapon axes in world (for oriented primitives) */
  q: Quat;
  /** skinning bone */
  bone: string;
  /** body scale */
  s: number;
  sx: 1 | -1;
}

export function weaponFrame(a: Anatomy, side: 'r' | 'l', grip: Vec3 = [0, 0, 0]): WFrame {
  const sx: 1 | -1 = side === 'l' ? 1 : -1;
  const palm = a.side(sx).palm;
  const X: Vec3 = side === 'r' ? [0, -1, 0] : [0, 1, 0];
  const Y: Vec3 = [0, 0, 1];
  const Z: Vec3 = side === 'r' ? [-1, 0, 0] : [1, 0, 0];
  const origin: Vec3 = vadd(palm, vadd(vadd(vscale(X, grip[0]), vscale(Y, grip[1])), vscale(Z, grip[2])));
  const d = (x: number, y: number, z: number): Vec3 => [X[0] * x + Y[0] * y + Z[0] * z, X[1] * x + Y[1] * y + Z[1] * z, X[2] * x + Y[2] * y + Z[2] * z];
  return {
    p: (x, y, z) => vadd(origin, d(x, y, z)),
    d,
    q: qfromBasis(X, Y, Z),
    bone: `wrist_${side}`,
    s: a.s,
    sx,
  };
}

/** a straight spike / claw / thorn */
export const spike = (base: Vec3, tip: Vec3, r: number, rTip = r * 0.12): Sdf => new RoundCone(base, tip, r, rTip);

/** curved horn / tusk / talon: tapered tube through base -> mid -> tip */
export function horn(base: Vec3, mid: Vec3, tip: Vec3, r0: number, r1 = r0 * 0.1, w = r0 * 0.5): Sdf {
  return tube([base, mid, tip], [[0, r0], [0.55, r0 * 0.62 + r1 * 0.38], [1, r1]], { segments: 4, w });
}

/** ring of linked chain loops along a path: alternating flat / edge-on tori */
export function chainLinks(pts: Vec3[], link: number, thick: number): { sdf: Sdf; at: Vec3 }[] {
  const out: { sdf: Sdf; at: Vec3 }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const dir = vnorm(vsub(b, a));
    const mid = vlerp(a, b, 0.5);
    // the torus axis is perpendicular to the chain direction; alternate between two perpendiculars
    const perp1 = vnorm(vcross(dir, [0, 1, 0.001]));
    const perp2 = vnorm(vcross(dir, perp1));
    out.push({ sdf: new Torus(mid, link, thick, i % 2 === 0 ? perp1 : perp2), at: mid });
  }
  return out;
}

/** a flat feather / leaf / talisman slip: spindle between two points */
export function feather(base: Vec3, tip: Vec3, halfW: number, halfT: number, side: Vec3 = [1, 0, 0]): Sdf {
  const dir = vsub(tip, base);
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const y = vnorm(dir);
  let z = vcross(side, y);
  if (Math.hypot(z[0], z[1], z[2]) < 1e-5) z = [0, 0, 1];
  z = vnorm(z);
  const x = vnorm(vcross(y, z));
  const q = qfromBasis(x, y, z);
  // ellipsoid centred mid-way with radii (halfW, len/2, halfT)
  return new Ellipsoid(vlerp(base, tip, 0.5), [halfW, len / 2, halfT], q);
}

/** unit rotation taking +Y to dir (oriented boxes / ellipsoids along a direction) */
export const qAlong = (dir: Vec3): Quat => qfromTo([0, 1, 0], vnorm(dir));

/** orthonormal basis (x,y,z) with y = dir and x as close to `side` as possible, as an oriented-primitive rotation */
export function qBasis(dir: Vec3, side: Vec3): Quat {
  const y = vnorm(dir);
  const z = vnorm(vcross(side, y));
  const x = vnorm(vcross(y, z));
  return qfromBasis(x, y, z);
}

// ---------------------------------------------------------------------------------------------------------------------
// Slab: a 2-D outline extruded along a local X axis with a thickness profile = crisp blades, axe heads, banners, talisman
// slips, spear leaves. The outline lives in the (y, z) plane of a local frame (origin `o`, axes `ax`), thickness along x.
export interface Frame {
  o: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

export class Slab extends Sdf {
  private n: number;
  private px: Float64Array;
  private py: Float64Array;
  constructor(
    private f: Frame,
    outline: [number, number][],
    /** half thickness at an outline-plane point (y, z): bevels / taper live here */
    private half: (y: number, z: number) => number,
    private round = 0.003,
    private hmax = 0.03,
  ) {
    super();
    this.n = outline.length;
    this.px = Float64Array.from(outline.map((p) => p[0]));
    this.py = Float64Array.from(outline.map((p) => p[1]));
    this.lip = 1.6;
  }

  /** signed distance to the outline polygon (negative inside) */
  private d2(y: number, z: number): number {
    const n = this.n, px = this.px, py = this.py;
    let dmin = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = px[j]!, ay = py[j]!, bx = px[i]!, by = py[i]!;
      const ex = bx - ax, ey = by - ay;
      const wx = y - ax, wy = z - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      const dx = wx - ex * t, dy = wy - ey * t;
      const dd = dx * dx + dy * dy;
      if (dd < dmin) dmin = dd;
      if (ay > z !== by > z && y < ((bx - ax) * (z - ay)) / (by - ay) + ax) inside = !inside;
    }
    const d = Math.sqrt(dmin);
    return inside ? -d : d;
  }

  d(x: number, y: number, z: number): number {
    const o = this.f.o;
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    const lx = dx * this.f.x[0] + dy * this.f.x[1] + dz * this.f.x[2];
    const ly = dx * this.f.y[0] + dy * this.f.y[1] + dz * this.f.y[2];
    const lz = dx * this.f.z[0] + dy * this.f.z[1] + dz * this.f.z[2];
    const r = this.round;
    const d2 = this.d2(ly, lz) + r;
    const h = Math.max(this.half(ly, lz) - r, 1e-4);
    const dxn = Math.abs(lx) - h;
    const ox = d2 > 0 ? d2 : 0, oy = dxn > 0 ? dxn : 0;
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(d2, dxn), 0) - r;
  }

  protected computeBounds(): Aabb {
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      y0 = Math.min(y0, this.px[i]!); y1 = Math.max(y1, this.px[i]!);
      z0 = Math.min(z0, this.py[i]!); z1 = Math.max(z1, this.py[i]!);
    }
    const pad = this.round + 0.004;
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const lx = c & 1 ? this.hmax + pad : -this.hmax - pad;
      const ly = c & 2 ? y1 + pad : y0 - pad;
      const lz = c & 4 ? z1 + pad : z0 - pad;
      for (let k = 0; k < 3; k++) {
        const w = this.f.o[k]! + this.f.x[k]! * lx + this.f.y[k]! * ly + this.f.z[k]! * lz;
        mn[k] = Math.min(mn[k]!, w); mx[k] = Math.max(mx[k]!, w);
      }
    }
    return { min: mn, max: mx };
  }
}

/** frame from a weapon frame (world-space axes of the weapon at the hand) */
export const frameOf = (f: WFrame, origin: Vec3 = f.p(0, 0, 0)): Frame => ({ o: origin, x: f.d(1, 0, 0), y: f.d(0, 1, 0), z: f.d(0, 0, 1) });

void vdot;
