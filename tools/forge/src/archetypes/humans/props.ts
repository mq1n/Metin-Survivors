// Handheld props baked into the enemy mesh (single skinned mesh rule). Every prop is modelled in the REST pose relative to the
// hand it is held by (see kit.ts `hp`): grip axis = hand +Z, palm normal toward the body centre. The IK solver then aims the
// hand, and the rigid prop (bone wrist_x, stiff skinning) follows.
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import type { Ctx } from '../humanoid/index.ts';
import type { Anatomy } from '../humanoid/index.ts';
import { type HandN, STIFF, addTassel, ball, cylinder, disc, dome, frustum, handRef, hp, leaf, rigid, rod } from './kit.ts';

export interface PropMats {
  /** palette keys (family = key without trailing digits) */
  wood: string;
  metal: string;
  cloth: string;
  trim?: string;
}

export interface SpearOpts {
  hand?: HandN;
  /** shaft length behind / in front of the grip (m) */
  back?: number;
  front?: number;
  /** blade length / half width (m) */
  blade?: number;
  halfW?: number;
  /** red tuft under the blade */
  tuft?: boolean;
  /** notched / broken blade (plagued) */
  notch?: boolean;
  mats: PropMats;
}

/** spear: wooden shaft through the fist, socketed leaf blade, tuft; blade flat faces the palm normal */
export function addSpear(ctx: Ctx, a: Anatomy, o: SpearOpts): void {
  const h = handRef(a, o.hand ?? 'r');
  const s = a.s;
  const back = (o.back ?? 0.55) * s, front = (o.front ?? 1.32) * s;
  const wood = ctx.piece(o.mats.wood), metal = ctx.piece(o.mats.metal), cloth = ctx.piece(o.mats.cloth);
  const r = 0.0185 * s;
  // shaft + butt cap
  rigid(ctx, 'spear_shaft', rod(hp(h, 0, 0, -back), hp(h, 0, 0, front), r, r), h.bone, [wood.tag]);
  rigid(ctx, 'spear_butt', frustum(hp(h, 0, 0, -back - 0.02 * s), hp(h, 0, 0, -back + 0.07 * s), 0.016 * s, 0.024 * s, 0.006), h.bone, [metal.tag]);
  // socket collar + blade
  const sock0 = hp(h, 0, 0, front - 0.02 * s), sock1 = hp(h, 0, 0, front + 0.1 * s);
  rigid(ctx, 'spear_socket', frustum(sock0, sock1, 0.026 * s, 0.019 * s, 0.006), h.bone, [metal.tag]);
  const bl = (o.blade ?? 0.26) * s, hw = (o.halfW ?? 0.034) * s;
  const face: Vec3 = [-h.sx, 0, 0];
  rigid(ctx, 'spear_blade', leaf(hp(h, 0, 0, front + 0.06 * s), hp(h, 0, 0, front + 0.06 * s + bl), hw, 0.009 * s, face), h.bone, [metal.tag], 0.003);
  rigid(ctx, 'spear_ridge', rod(hp(h, 0, 0, front + 0.08 * s), hp(h, 0, 0, front + 0.06 * s + bl * 0.88), 0.011 * s, 0.004 * s), h.bone, [metal.tag], 0.003);
  if (o.notch) {
    // bite out of the blade edge
    for (const k of [0.4, 0.6]) {
      void k;
    }
  }
  if (o.tuft !== false) {
    // horsehair tuft: short curved tines fanned around the socket
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2;
      const c = hp(h, Math.cos(ang) * 0.02 * s, Math.sin(ang) * 0.02 * s, front + 0.07 * s);
      const t = hp(h, Math.cos(ang) * 0.075 * s, Math.sin(ang) * 0.075 * s - 0.035 * s, front + 0.0 * s);
      rigid(ctx, `spear_tuft${i}`, rod(c, t, 0.0105 * s, 0.003 * s), h.bone, [cloth.tag], 0.006);
    }
  }
}

export interface ShieldOpts {
  hand?: HandN;
  r?: number;
  /** boss + rim */
  boss?: boolean;
  /** how far the shield centre sits outward from the palm (m) */
  out?: number;
  /** vertical offset of the centre relative to the grip */
  up?: number;
  mats: PropMats;
}

/** round shield on the (left) hand: disc facing outward at rest (the back-of-hand direction), rim ring, central boss */
export function addShield(ctx: Ctx, a: Anatomy, o: ShieldOpts): void {
  const h = handRef(a, o.hand ?? 'l');
  const s = a.s;
  const R = (o.r ?? 0.3) * s;
  const out = (o.out ?? 0.07) * s;
  const c: Vec3 = hp(h, -out, (o.up ?? 0.02) * s, 0.0);
  const face: Vec3 = [h.sx, 0, 0]; // lateral = back-of-hand direction: +X for the left hand, -X for the right
  const wood = ctx.piece(o.mats.wood), metal = ctx.piece(o.mats.metal), cloth = ctx.piece(o.mats.cloth);
  rigid(ctx, 'shield_face', disc(c, face, R, 0.034 * s, 0.012 * s), h.bone, [wood.tag], 0.004);
  rigid(ctx, 'shield_rim', new Torus(c, R, 0.017 * s, face), h.bone, [metal.tag], 0.004);
  if (o.boss !== false) {
    const bc = vadd(c, vscale(face, 0.02 * s));
    rigid(ctx, 'shield_boss', dome(bc, face, 0.085 * s, 0.045 * s), h.bone, [metal.tag], 0.004);
    // raised cross-bars on the face
    const fc = vadd(c, vscale(face, 0.02 * s));
    rigid(ctx, 'shield_bar_h', rod(vadd(fc, [0, 0, -R * 0.82]), vadd(fc, [0, 0, R * 0.82]), 0.012 * s, 0.012 * s), h.bone, [cloth.tag], 0.003);
    rigid(ctx, 'shield_bar_v', rod(vadd(fc, [0, -R * 0.82, 0]), vadd(fc, [0, R * 0.82, 0]), 0.012 * s, 0.012 * s), h.bone, [cloth.tag], 0.003);
  }
  void ball; void cylinder; void vlerp; void vnorm; void vsub; void RoundCone; void Sphere; void Ellipsoid; void addTassel; void STIFF;
}
