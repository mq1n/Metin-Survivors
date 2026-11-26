// Humanoid skeleton: identity rest rotations, A-pose joint positions from the anatomy, sockets and optional secondary chains.
//   root > pelvis > spine > chest > neck > head (+ muzzle)
//   chest > clavicle_x > upper_arm_x > forearm_x > wrist_x > { hand_x (socket, palm centre), thumb_x, fingers_x }
//   pelvis > thigh_x > shin_x > foot_x > toe_x
//   sockets: head, hand_r, hand_l, back, chest, muzzle
//   optional chains (rig opts): skirt_f/b/l/r, hair1-3, scarf1-3, cape1-3, tail1-3, ear_l/r
import type { Vec3 } from '../../core/math.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';
import type { RigOpts, Side } from './params.ts';

export const SOCKETS = { head: 'head', hand_r: 'hand_r', hand_l: 'hand_l', back: 'back', chest: 'chest', muzzle: 'muzzle' } as const;

export interface Chain {
  /** bone names, root first */
  bones: string[];
  /** joint positions (world rest), one per bone, plus the tip */
  pts: Vec3[];
}

export interface RigLayout {
  skirt: { f: Vec3; b: Vec3; l: Vec3; r: Vec3 } | null;
  hair: Chain | null;
  scarf: Chain | null;
  cape: Chain | null;
  tail: Chain | null;
  ears: { l: Vec3; r: Vec3 } | null;
}

const chain = (prefix: string, pts: Vec3[], n: number): Chain => ({ bones: Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`), pts: pts.slice(0, n + 1) });

export function rigLayout(a: Anatomy, rig: RigOpts): RigLayout {
  const s = a.s;
  const hs = a.hs;
  const sk = a.skull;
  const hair = rig.hairBones
    ? chain('hair', [
      [0, sk[1] + 0.02 * s * hs, sk[2] - 0.085 * s * hs],
      [0, sk[1] - 0.075 * s * hs, sk[2] - 0.125 * s * hs],
      [0, sk[1] - 0.19 * s * hs, sk[2] - 0.15 * s * hs],
      [0, sk[1] - 0.31 * s * hs, sk[2] - 0.17 * s * hs],
    ], rig.hairBones)
    : null;
  const nk = a.neck;
  const scarf = rig.scarfBones
    ? chain('scarf', [
      [0, nk[1] + 0.02 * s, nk[2] - 0.05 * s],
      [0, nk[1] - 0.06 * s, nk[2] - 0.17 * s],
      [0, nk[1] - 0.16 * s, nk[2] - 0.3 * s],
      [0, nk[1] - 0.3 * s, nk[2] - 0.4 * s],
    ], rig.scarfBones)
    : null;
  const ch = a.chest;
  const cape = rig.capeBones
    ? chain('cape', [
      [0, nk[1] - 0.03 * s, nk[2] - 0.1 * s],
      [0, ch[1] - 0.12 * s, ch[2] - 0.17 * s],
      [0, ch[1] - 0.38 * s, ch[2] - 0.2 * s],
      [0, ch[1] - 0.64 * s, ch[2] - 0.22 * s],
    ], rig.capeBones)
    : null;
  const pv = a.pelvis;
  const tail = rig.tailBones
    ? chain('tail', [
      [0, pv[1] - 0.03 * s, pv[2] - 0.1 * s],
      [0, pv[1] - 0.11 * s, pv[2] - 0.24 * s],
      [0, pv[1] - 0.24 * s, pv[2] - 0.34 * s],
      [0, pv[1] - 0.4 * s, pv[2] - 0.38 * s],
    ], rig.tailBones)
    : null;
  const hipY = a.side(1).hip[1];
  const skirt = rig.skirt
    ? {
      f: [0, hipY, 0.1 * s] as Vec3,
      b: [0, hipY, -0.1 * s] as Vec3,
      l: [0.15 * s, hipY, 0] as Vec3,
      r: [-0.15 * s, hipY, 0] as Vec3,
    }
    : null;
  const ears = rig.earBones
    ? { l: [0.06 * s * hs, sk[1] + 0.085 * s * hs, sk[2] - 0.01 * s * hs] as Vec3, r: [-0.06 * s * hs, sk[1] + 0.085 * s * hs, sk[2] - 0.01 * s * hs] as Vec3 }
    : null;
  return { skirt, hair, scarf, cape, tail, ears };
}

export function makeSkeleton(a: Anatomy, rig: RigOpts): { skeleton: Skeleton; layout: RigLayout } {
  const layout = rigLayout(a, rig);
  const s = a.s;
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: a.pelvis },
    { name: 'spine', parent: 'pelvis', pos: a.spine },
    { name: 'chest', parent: 'spine', pos: a.chest },
    { name: 'neck', parent: 'chest', pos: a.neck },
    { name: 'head', parent: 'neck', pos: a.head },
    { name: 'muzzle', parent: 'head', pos: [0, a.skull[1] - 0.04 * s * a.hs, a.skull[2] + 0.1 * s * a.hs], helper: true },
    { name: 'back', parent: 'chest', pos: [0, a.chest[1] + 0.09 * s, a.chest[2] - 0.13 * s], helper: true },
  ];
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    const j = a.side(sx);
    bones.push(
      { name: `clavicle_${n}`, parent: 'chest', pos: j.clav },
      { name: `upper_arm_${n}`, parent: `clavicle_${n}`, pos: j.shoulder },
      { name: `forearm_${n}`, parent: `upper_arm_${n}`, pos: j.elbow },
      { name: `wrist_${n}`, parent: `forearm_${n}`, pos: j.wrist },
      { name: `hand_${n}`, parent: `wrist_${n}`, pos: j.palm, helper: true },
      { name: `thumb_${n}`, parent: `wrist_${n}`, pos: j.thumb },
      { name: `fingers_${n}`, parent: `wrist_${n}`, pos: j.knuckle },
    );
  }
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    const j = a.side(sx);
    bones.push(
      { name: `thigh_${n}`, parent: 'pelvis', pos: j.hip },
      { name: `shin_${n}`, parent: `thigh_${n}`, pos: j.knee },
      { name: `foot_${n}`, parent: `shin_${n}`, pos: j.ankle },
      { name: `toe_${n}`, parent: `foot_${n}`, pos: j.ball },
    );
  }
  if (layout.skirt) {
    bones.push(
      { name: 'skirt_f', parent: 'pelvis', pos: layout.skirt.f },
      { name: 'skirt_b', parent: 'pelvis', pos: layout.skirt.b },
      { name: 'skirt_l', parent: 'pelvis', pos: layout.skirt.l },
      { name: 'skirt_r', parent: 'pelvis', pos: layout.skirt.r },
    );
  }
  const addChain = (c: Chain | null, parent: string): void => {
    if (!c) return;
    c.bones.forEach((nm, i) => bones.push({ name: nm, parent: i === 0 ? parent : c.bones[i - 1]!, pos: c.pts[i]! }));
  };
  addChain(layout.hair, 'head');
  addChain(layout.scarf, 'chest');
  addChain(layout.cape, 'chest');
  addChain(layout.tail, 'pelvis');
  if (layout.ears) {
    bones.push({ name: 'ear_l', parent: 'head', pos: layout.ears.l }, { name: 'ear_r', parent: 'head', pos: layout.ears.r });
  }
  return { skeleton: new Skeleton(bones), layout };
}
