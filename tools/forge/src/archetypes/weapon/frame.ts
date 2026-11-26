// Weapon frames. Weapons are AUTHORED in the canonical frame (origin = grip centre, +Y = business end, +Z = cutting edge / shot
// direction / forward, +X = flat face normal) and SHIPPED in the hero hand frame so the game can parent the GLB to the hand bone with
// no offset (agreed with Heroes):
//   hand_r: weapon +Y -> hand +Z, weapon +Z -> hand -X, weapon +X -> hand -Y    (hand = (-wz, -wx, wy))
//   hand_l: weapon +Y -> hand +Z, weapon +Z -> hand +X, weapon +X -> hand +Y    (hand = ( wz,  wx, wy))
// Dual-wield weapons (daggers, claws) ship in the right-hand frame; the rig rotates 180 degrees about hand Z for the off hand
// (their geometry is X-symmetric, so mirror and rotation are equivalent).
import type { Vec3 } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';

export type Hand = 'r' | 'l';

export const toHand = (p: Vec3, hand: Hand): Vec3 => (hand === 'r' ? [-p[2], -p[0], p[1]] : [p[2], p[0], p[1]]);
export const fromHand = (p: Vec3, hand: Hand): Vec3 => (hand === 'r' ? [-p[1], p[2], -p[0]] : [p[1], p[2], p[0]]);

/** rotate a flat xyz array in place with `f` */
export function mapVec3(a: Float32Array, f: (p: Vec3) => Vec3): void {
  for (let i = 0; i < a.length; i += 3) {
    const q = f([a[i]!, a[i + 1]!, a[i + 2]!]);
    a[i] = q[0]; a[i + 1] = q[1]; a[i + 2] = q[2];
  }
}

export interface DisplayOpts {
  /** lean about the viewer's depth axis (degrees) */
  tilt?: number;
  /** turn about the weapon axis (degrees) */
  roll?: number;
  /** grip height above the ground (m) */
  lift?: number;
}

/** Copy of a shipped (hand-frame) weapon rotated back to the canonical blade-up frame, tilted and lifted, for the viewer / gauntlet. */
export function displayCopy(m: ModelData, hand: Hand, o: DisplayOpts = {}): ModelData {
  const tilt = ((o.tilt ?? 40) * Math.PI) / 180, roll = ((o.roll ?? -25) * Math.PI) / 180, lift = o.lift ?? 0.9;
  const cr = Math.cos(roll), sr = Math.sin(roll), ct = Math.cos(tilt), st = Math.sin(tilt);
  const xf = (p: Vec3): Vec3 => {
    const c = fromHand(p, hand);
    const r: Vec3 = [c[0] * cr + c[2] * sr, c[1], -c[0] * sr + c[2] * cr]; // roll about Y
    return [r[0] * ct - r[1] * st, r[0] * st + r[1] * ct, r[2]]; // lean about Z
  };
  const positions = Float32Array.from(m.positions), normals = Float32Array.from(m.normals);
  mapVec3(positions, xf);
  for (let i = 0; i < positions.length; i += 3) positions[i + 1] = positions[i + 1]! + lift;
  mapVec3(normals, xf);
  return { ...m, positions, normals };
}

/** Everything the game / VFX can use to place the weapon: all positions are in the shipped hand frame. */
export interface WeaponMeta {
  type: string;
  tier: number;
  hand: Hand;
  /** grip description */
  grip: 'one_hand' | 'two_hand' | 'dual' | 'bow' | 'fan' | 'bell' | 'claw';
  /** overall length along the weapon axis (m) */
  length: number;
  /** weapon-axis coordinates (hand +Z) of the pommel end and the business end */
  pommelZ: number;
  tipZ: number;
  /** slash-trail segment along the hand Z axis: [base, tip] */
  trail: [number, number];
  /** second hand position for two-handers (hand frame) */
  handL?: Vec3;
  /** hit-point / muzzle position: bow arrow nock, fan pivot, bell mouth (hand frame) */
  muzzle?: Vec3;
}
