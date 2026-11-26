// Hand-frame helpers for props baked into the mesh: the rest-pose hand axes are the world axes (the humanoid skeleton has
// identity rest rotations), so a point "in the hand" is just the palm centre plus an offset. `m` = toward the body centre
// (palm normal), `y` = up (fingertips are -y), `z` = along the grip axis (blade direction at rest).
import { type Vec3, qfromTo, vnorm, vsub } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundedBox } from '../../core/sdf/primitives.ts';
import { type Anatomy, type Ctx, Loft, type Side } from '../humanoid/index.ts';

export interface HandRef {
  n: 'l' | 'r';
  sx: Side;
  palm: Vec3;
  wrist: Vec3;
  /** rigid props follow this bone (wrist_x: the hand orientation solved by the IK, not the finger curl) */
  bone: string;
  /** unit vector of the cutting-edge side = back of the hand (outward) */
  edge: Vec3;
}

export function handRef(a: Anatomy, n: 'l' | 'r'): HandRef {
  const sx: Side = n === 'l' ? 1 : -1;
  const j = a.side(sx);
  return { n, sx, palm: j.palm, wrist: j.wrist, bone: `wrist_${n}`, edge: [sx, 0, 0] };
}

/** point in the hand frame */
export const hp = (h: HandRef, m: number, y: number, z: number): Vec3 => [h.palm[0] - h.sx * m, h.palm[1] + y, h.palm[2] + z];

/** stiff skinning weight for rigid props */
export const STIFF = 30;

/** rigid prop part: follows exactly one bone */
export function rigid(ctx: Ctx, name: string, sdf: Sdf, bone: string, tags: string[], w = 0.004, grip = STIFF): void {
  ctx.add(name, sdf, bone, { tags, w, grip });
}

/** rounded cylinder from a to b (flat ends, `round` = edge radius), optionally tapering (ra -> rb) */
export function cylinder(a: Vec3, b: Vec3, ra: number, rb = ra, round = 0.004): Sdf {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const q = qfromTo([0, 1, 0], vnorm(vsub(b, a)));
  const loft = new Loft([{ y: 0, rx: ra, rz: ra, n: 2 }, { y: len, rx: rb, rz: rb, n: 2 }], { cap: Math.min(round, Math.min(ra, rb) * 0.9, len * 0.45) });
  return new Xform(loft, a, q);
}

/** chunky armoured fist closed around a grip along z: block + four finger rolls + thumb wedge. Returns nothing; parts go to `bone` with `tags`. */
export function armouredFist(ctx: Ctx, a: Anatomy, h: HandRef, name: string, tags: string[], size = 1): void {
  const s = a.s;
  const j = a.side(h.sx);
  const len = Math.abs(j.palm[1] - j.fingerTip[1]);
  const half: Vec3 = [a.r.palmT * 1.6 * size + 0.01 * s, len * 0.52, a.r.palmW * 0.68 * size];
  const cx = j.palm[0] + h.sx * 0.002 * s, cy = j.palm[1] - len * 0.1, cz = j.palm[2] + 0.004 * s;
  rigid(ctx, `${name}_block`, new RoundedBox([cx, cy, cz], half, 0.014 * s), h.bone, tags, 0.008, 1.4);
  for (let f = 0; f < 4; f++) {
    const z = cz + (f - 1.5) * ((half[2] * 2) / 4.2);
    rigid(ctx, `${name}_finger${f}`, new Ellipsoid([cx - h.sx * half[0] * 0.55, cy - half[1] * 0.72, z], [half[0] * 0.78, half[1] * 0.3, half[2] * 0.26]), h.bone, tags, 0.006, 1.4);
  }
  rigid(ctx, `${name}_thumb`, new Ellipsoid([cx - h.sx * half[0] * 0.2, cy + half[1] * 0.3, cz + half[2] * 0.95], [half[0] * 0.75, half[1] * 0.4, half[2] * 0.34]), h.bone, tags, 0.008, 1.4);
}
