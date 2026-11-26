import type { Vec3 } from '../../core/math.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export const SOCKETS = { head: 'head', muzzle: 'muzzle', chest: 'chest', back: 'back', hand_l: 'hand_l', hand_r: 'hand_r' } as const;

/** head-local anchor points shared by skeleton and body (metres at headScale 1) */
export const HEAD_ANCHORS = {
  jaw: [0, -0.075, 0.03] as Vec3,
  muzzle: [0, -0.07, 0.345] as Vec3,
  ear: [0.118, 0.112, -0.045] as Vec3,
};

export function makeSkeleton(a: Anatomy): Skeleton {
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const ear = a.headToWorld(HEAD_ANCHORS.ear);
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: a.pelvis },
    { name: 'spine', parent: 'pelvis', pos: a.spine },
    { name: 'chest', parent: 'spine', pos: a.chest },
    { name: 'neck', parent: 'chest', pos: a.neck },
    { name: 'head', parent: 'neck', pos: a.head },
    { name: 'jaw', parent: 'head', pos: a.headToWorld(HEAD_ANCHORS.jaw) },
    { name: 'muzzle', parent: 'head', pos: a.headToWorld(HEAD_ANCHORS.muzzle), helper: true },
    { name: 'back', parent: 'spine', pos: [0, a.humpTop, a.chest[2]], helper: true },
    { name: 'ear_l', parent: 'head', pos: ear },
    { name: 'ear_r', parent: 'head', pos: mir(ear) },
    { name: 'tail1', parent: 'pelvis', pos: a.tail[0]! },
    { name: 'tail2', parent: 'tail1', pos: a.tail[1]! },
    { name: 'tail3', parent: 'tail2', pos: a.tail[2]! },
  ];
  for (const [side, sx] of [['l', 1], ['r', -1]] as const) {
    const m = (v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
    bones.push(
      { name: `clav_${side}`, parent: 'chest', pos: m(a.clav) },
      { name: `arm_${side}`, parent: `clav_${side}`, pos: m(a.front.shoulder) },
      { name: `forearm_${side}`, parent: `arm_${side}`, pos: m(a.front.elbow) },
      { name: `hand_${side}`, parent: `forearm_${side}`, pos: m(a.front.wrist) },
      { name: `thigh_${side}`, parent: 'pelvis', pos: m(a.hind.hip) },
      { name: `shin_${side}`, parent: `thigh_${side}`, pos: m(a.hind.stifle) },
      { name: `foot_${side}`, parent: `shin_${side}`, pos: m(a.hind.hock) },
      { name: `toe_${side}`, parent: `foot_${side}`, pos: m(a.hind.ball) },
    );
  }
  return new Skeleton(bones);
}
