// Geometry kit for enemy props, headgear and ornaments: hand frames, rigid prop parts (stiff skinning), discs / prisms / blades.
// All coordinates are WORLD rest-pose (A-pose) metres; the shared humanoid skeleton has identity rest rotations, so a point
// expressed relative to the palm stays correct for the hand bones (wrist_x) as the animation rotates them.
import { type Quat, type Vec3, qfromTo, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { type Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, RoundedBox, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { spindle } from '../../core/sdf/primitives.ts';
import { type Anatomy, Loft, type Ctx, type Side, frameQ } from '../humanoid/index.ts';

export type HandN = 'l' | 'r';

/** the hand of one side at rest: palm centre, bone, medial sign */
export interface HandRef {
  n: HandN;
  sx: Side;
  palm: Vec3;
  wrist: Vec3;
  /** bone rigid props follow (wrist_x: rotates with the hand orientation solved by the IK, not with finger curl) */
  bone: string;
}

export function handRef(a: Anatomy, n: HandN): HandRef {
  const sx: Side = n === 'l' ? 1 : -1;
  const j = a.side(sx);
  return { n, sx, palm: j.palm, wrist: j.wrist, bone: `wrist_${n}` };
}

/**
 * Point in the hand frame: `m` toward the body centre (palm normal at rest), `y` up (fingertips are -y), `z` along the grip axis
 * (forward at rest). Same call works for both hands.
 */
export const hp = (h: HandRef, m: number, y: number, z: number): Vec3 => [h.palm[0] - h.sx * m, h.palm[1] + y, h.palm[2] + z];

/** world rest point on a bone line: lerp between two world points */
export const lp = (a: Vec3, b: Vec3, t: number): Vec3 => vlerp(a, b, t);

export interface PartTag {
  /** paint tags for the part ([piece.tag, ...]) */
  tags: string[];
}

/** stiff skinning weight for rigid props (weapon, shield, helmet crest) */
export const STIFF = 30;

/** rigid part: follows exactly one bone */
export function rigid(ctx: Ctx, name: string, sdf: Sdf, bone: string, tags: string[], w = 0.004, grip = STIFF): void {
  ctx.add(name, sdf, bone, { tags, w, grip });
}

/** capsule / tapered rod between two points (radii at each end) */
export const rod = (a: Vec3, b: Vec3, ra: number, rb = ra): Sdf => new RoundCone(a, b, ra, rb);

/** rounded cylinder from `a` to `b` (flat ends, `round` = edge radius) */
export function cylinder(a: Vec3, b: Vec3, r: number, round = 0.004): Sdf {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const q = qfromTo([0, 1, 0], vnorm(vsub(b, a)));
  const loft = new Loft([{ y: 0, rx: r, rz: r, n: 2 }, { y: len, rx: r, rz: r, n: 2 }], { cap: Math.min(round, r * 0.9, len * 0.45) });
  return new Xform(loft, a, q);
}

/** tapered cylinder (frustum) with rounded ends */
export function frustum(a: Vec3, b: Vec3, ra: number, rb: number, round = 0.004): Sdf {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const q = qfromTo([0, 1, 0], vnorm(vsub(b, a)));
  const loft = new Loft([{ y: 0, rx: ra, rz: ra, n: 2 }, { y: len, rx: rb, rz: rb, n: 2 }], { cap: Math.min(round, Math.min(ra, rb) * 0.9, len * 0.45) });
  return new Xform(loft, a, q);
}

/** flat round disc (shield body, medallion): `n` is the face normal, rounded rim */
export function disc(c: Vec3, n: Vec3, r: number, thick: number, round = 0.004): Sdf {
  const q = qfromTo([0, 1, 0], vnorm(n));
  const loft = new Loft([{ y: -thick / 2, rx: r, rz: r, n: 2 }, { y: thick / 2, rx: r, rz: r, n: 2 }], { cap: Math.min(round, thick * 0.45) });
  return new Xform(loft, c, q);
}

/** domed disc: a lens (flattened ellipsoid), good for bosses and bucklers; `n` = face normal */
export function dome(c: Vec3, n: Vec3, r: number, h: number): Sdf {
  const q = qfromTo([0, 1, 0], vnorm(n));
  return new Ellipsoid(c, [r, h, r], q);
}

/** flat blade / leaf between two points: `halfW` half width, `halfT` half thickness, `face` = the flat-face normal */
export function leaf(a: Vec3, b: Vec3, halfW: number, halfT: number, face: Vec3 = [1, 0, 0]): Sdf {
  // spindle(a, b, [r_side, r_other], side): first radius along `side`
  const dir = vnorm(vsub(b, a));
  // width direction = perpendicular to both the blade axis and the face normal
  const wdir = vnorm([dir[1] * face[2] - dir[2] * face[1], dir[2] * face[0] - dir[0] * face[2], dir[0] * face[1] - dir[1] * face[0]]);
  return spindle(a, b, [halfW, halfT], wdir);
}

/** box between points with half-extents along the segment frame; `up` orients the second axis */
export function bar(a: Vec3, b: Vec3, halfW: number, halfT: number, up: Vec3 = [0, 1, 0], round = 0.003): Sdf {
  const mid = vlerp(a, b, 0.5);
  const half = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  const q: Quat = frameQ(vsub(b, a), up);
  // frameQ: local Y follows the segment, local X ~ `up`; the box is [halfW (x), half (y), halfT (z)]
  return new RoundedBox(mid, [halfW, half, halfT], round, q);
}

export const ring = (c: Vec3, axis: Vec3, R: number, r: number): Sdf => new Torus(c, R, r, axis);
export const ball = (c: Vec3, r: number): Sdf => new Sphere(c, r);

/** tuft of hanging cords / hair / feathers (tassel): `n` rods fanned from `base` downward */
export function addTassel(ctx: Ctx, name: string, base: Vec3, bone: string, tags: string[], o: { n?: number; len?: number; spread?: number; r?: number; dir?: Vec3; w?: number; seed?: number } = {}): void {
  const n = o.n ?? 5;
  const len = o.len ?? 0.2;
  const dir = vnorm(o.dir ?? [0, -1, 0]);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const jitter = Math.sin((i + (o.seed ?? 0)) * 12.9898) * 0.5;
    const d = vnorm([dir[0] + f * (o.spread ?? 0.5), dir[1], dir[2] + jitter * 0.12]);
    const l = len * (1 - Math.abs(f) * 0.25);
    ctx.add(`${name}_${i}`, new RoundCone(base, vadd(base, vscale(d, l)), o.r ?? 0.011, (o.r ?? 0.011) * 0.35), bone, { tags, w: o.w ?? 0.01 });
  }
}

export { vlerp };
