
//
// STATUS (rigfix r4 ship 2026-10-29): wired into render/hero.ts (HeroView.mountWeapon) and app/heroPreview.ts, per hero GLB: only a hero that declares the

// shipped: yacha + shaman (r3, rebuilt in r4), wolfman (r4: the same claw in both hands) and the ninja (F2 2026-10-30: daggers in both hands, the bow upright in the
// LEFT hand, drawn by the right one in attack / attack2 with its runtime string, render/bowString.ts). Weapon-fit fix r1 (2026-10-30): all 36 heroes regenerated

// so its mounting is unchanged), and the archer's cast is an authored left-hand shot (drawn string). (All four wolfman claws are the Tripo `worn` ones: no frame fix.)

//

//   dagger and claw = BOTH hands (PART_WEAPON on the right "equip_right", PART_WEAPON_LEFT on the left "equip_left"; the left part loads
//   the item's sub model, CItemData::GetSubModelThing, which falls back to the main model when the item has none),
//   bow = the LEFT hand only (PART_WEAPON_LEFT), everything else = the right hand only.
// Each weapon is its own rigid model placed at its parent bone's world matrix; nothing animates the equip bone, so the weapon rides the hand.
//
// Our weapon GLBs have no left variant, so a left instance of a dual weapon is the right one mirrored about the sagittal plane x -> -x of the


// B back of the hand); hand_l is the anatomical mirror of hand_r with its X axis flipped, so the x -> -x mirror of a right-hand weapon on
// hand_l sits in the left fist the way the original sits in the right one. (They are no longer world-aligned at the rest pose: the old forge
// helpers were.)

import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';

/** turn of a forge claw about the grip's X axis onto the Tripo claws' talon pitch (weaponFrameFix) */
export const FORGE_CLAW_PITCH = (40 * Math.PI) / 180;








export function weaponFrameFix(extras: unknown): Quaternion | null {
  const w = (extras as { weapon?: { type?: unknown; worn?: unknown } } | null | undefined)?.weapon;
  if (w?.type === 'claw' && !w.worn) return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), FORGE_CLAW_PITCH);
  return null;
}

/** start of the scene extras' `humanoid.handFrame` text of a hand-fixed hero GLB; the forge GLBs' text is "palm +X(r) / -X(l), ..." */
export const EQUIP_JOINTS_MARK = 'anatomical equip joints';






export function hasEquipJoints(heroExtras: unknown): boolean {
  const t = (heroExtras as { humanoid?: { handFrame?: unknown } } | null | undefined)?.humanoid?.handFrame;
  return typeof t === 'string' && t.startsWith(EQUIP_JOINTS_MARK);
}



export function isRig1to1(heroExtras: unknown): boolean {
  const r = (heroExtras as { rig?: unknown } | null | undefined)?.rig;
  return typeof r === 'string' && r.startsWith('rig1to1/');
}

export type Hand = 'r' | 'l';

export interface WeaponHands {
  /** the hand of the main instance: the blade-tip VFX socket, the clip hold and the measured blade belong to it */
  main: Hand;
  /** the hand of the second, mirrored instance (dagger / claw), or null */
  off: Hand | null;
}

/** weapon types held in both hands (the same model twice, the left one mirrored) */
const BOTH_HANDS = new Set(['dagger', 'claw']);
/** weapon types held in the left hand only */
const LEFT_HAND = new Set(['bow']);

/** The hands of a weapon model, from its scene extras (`extras.weapon.type`, `extras.weapon.hand`); a weapon without extras is a right-hand weapon. */
export function weaponHands(extras: unknown): WeaponHands {
  const w = (extras as { weapon?: { type?: unknown; hand?: unknown } } | null | undefined)?.weapon;
  const type = typeof w?.type === 'string' ? w.type : '';
  if (BOTH_HANDS.has(type)) return { main: 'r', off: 'l' };
  if (LEFT_HAND.has(type)) return { main: 'l', off: null };
  return { main: w?.hand === 'l' ? 'l' : 'r', off: null };
}

export interface HeldMount {
  hand: Hand;
  /** the hero bone (socket helper joint) the weapon instance is added to */
  bone: Object3D;
  /** a left instance of a dual weapon: the main instance mirrored (see {@link placeMirrored}) */
  mirrored: boolean;
  /** hold scale of the helper joint the main instance hangs on relative to this joint (hand_r carries the dagger 1.5 / claw 1.7 hold scale, hand_l none) */
  scaleK: number;
}

export interface HeldPlan {
  /** mounts[0] = the main instance, mounts[1] = the mirrored off-hand instance of a dual weapon */
  mounts: HeldMount[];
  /** the right-hand socket joint (hand_r, or hand_r_b of doctrine B): the VFX `hand_r` socket, whether or not the right hand holds a weapon */
  rightBone: Object3D;
}

/**
 * Where the instances of one weapon hang on a hero. `socketName` maps a socket key (hand_r / hand_r_b / hand_l / hand_l_b) to the joint name of
 * the hero GLB's socket table (undefined = the key itself). Right hand: hand_r, or hand_r_b for doctrine B when the hero ships it (otherwise both
 * doctrines share hand_r); left hand: hand_l, or hand_l_b for doctrine B when the hero ships it (Ninja bow, SPEC rig1to1 R1; otherwise hand_l). A
 * hero without a hand_l joint keeps every weapon in the right hand, and so does a hero without the equip joints (`equipJoints` false, see
 * {@link hasEquipJoints}); the default is true (the weapon type decides).
 */
export function planHeldWeapons(
  extras: unknown,
  styleB: boolean,
  socketName: (key: string) => string | undefined,
  bones: ReadonlyMap<string, Object3D>,
  root: Object3D,
  equipJoints = true,
): HeldPlan {
  const find = (key: string): Object3D | undefined => bones.get(socketName(key) ?? key);
  const rightKey = styleB && socketName('hand_r_b') ? 'hand_r_b' : 'hand_r';
  const rightBone = find(rightKey) ?? bones.get('hand_r') ?? root;
  const leftKey = styleB && socketName('hand_l_b') ? 'hand_l_b' : 'hand_l';
  const leftBone = find(leftKey) ?? find('hand_l');
  const hands: WeaponHands = equipJoints ? weaponHands(extras) : { main: 'r', off: null };
  const mounts: HeldMount[] = [];
  if (hands.main === 'l' && leftBone) {
    mounts.push({ hand: 'l', bone: leftBone, mirrored: false, scaleK: 1 });
  } else {
    mounts.push({ hand: 'r', bone: rightBone, mirrored: false, scaleK: 1 });
    if (hands.off === 'l' && leftBone) mounts.push({ hand: 'l', bone: leftBone, mirrored: true, scaleK: uniformScale(rightBone) / uniformScale(leftBone) });
  }
  return { mounts, rightBone };
}

function uniformScale(o: Object3D): number {
  const s = o.scale.x;
  return Number.isFinite(s) && Math.abs(s) > 1e-6 ? Math.abs(s) : 1;
}

/** the reflection x -> -x of a rotation: the quaternion (x, y, z, w) becomes (x, -y, -z, w) */
export function mirrorQuaternionX(q: Quaternion, out: Quaternion): Quaternion {
  return out.set(q.x, -q.y, -q.z, q.w);
}

/**
 * Puts `off` at the sagittal mirror of `main` in the hand frame: M_off = Mx * M_main, i.e. the main's transform reflected about the plane x = 0 of
 * the helper joint frame (position (-x, y, z), rotation the reflected quaternion, scale (-sx, sy, sz): the negative determinant is the mirror,
 * three.js flips the face winding for it). `k` carries the helper joints' hold-scale difference (see HeldMount.scaleK).
 */
export function placeMirrored(off: Object3D, main: Object3D, k = 1): void {
  off.position.set(-main.position.x * k, main.position.y * k, main.position.z * k);
  mirrorQuaternionX(main.quaternion, off.quaternion);
  off.scale.set(-main.scale.x * k, main.scale.y * k, main.scale.z * k);
  off.updateMatrix();
}

/** Re-mirrors the rotation only (the per-clip hold turns the main instance every frame; position and scale never change). */
export function syncMirrored(off: Object3D, main: Object3D): void {
  mirrorQuaternionX(main.quaternion, off.quaternion);
}
