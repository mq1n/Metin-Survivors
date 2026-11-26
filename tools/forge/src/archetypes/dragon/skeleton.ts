import type { Vec3 } from '../../core/math.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export const SOCKETS = { head: 'head', muzzle: 'muzzle', chest: 'chest', back: 'back', hand_l: 'hand_l', hand_r: 'hand_r' } as const;

/** finger bone names per wing side: f1a/f1b (leading, long), f2a/f2b, f3 (short trailing) */
export const FINGERS = ['f1a', 'f1b', 'f2a', 'f2b', 'f3'] as const;

/** 46 joints: root, 3 body, 4 neck + head + jaw + muzzle, 6 tail, 2x(3 foreleg + 4 hindleg + 7 wing), back socket */
export function makeSkeleton(a: Anatomy): Skeleton {
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: a.pelvis },
    { name: 'spine', parent: 'pelvis', pos: a.spine },
    { name: 'chest', parent: 'spine', pos: a.chest },
    { name: 'neck1', parent: 'chest', pos: a.neck[0]! },
    { name: 'neck2', parent: 'neck1', pos: a.neck[1]! },
    { name: 'neck3', parent: 'neck2', pos: a.neck[2]! },
    { name: 'neck4', parent: 'neck3', pos: a.neck[3]! },
    { name: 'head', parent: 'neck4', pos: a.head },
    { name: 'jaw', parent: 'head', pos: a.jaw },
    { name: 'muzzle', parent: 'head', pos: a.muzzle, helper: true },
    { name: 'back', parent: 'spine', pos: [0, a.stations[3]!.y + a.stations[3]!.hh, a.spine[2]], helper: true },
  ];
  a.tail.forEach((pos, i) => bones.push({ name: `tail${i + 1}`, parent: i === 0 ? 'pelvis' : `tail${i}`, pos }));
  const w = a.wing;
  for (const [side, sx] of [['l', 1], ['r', -1]] as const) {
    const m = (v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
    bones.push(
      { name: `arm_${side}`, parent: 'chest', pos: m(a.front.shoulder) },
      { name: `forearm_${side}`, parent: `arm_${side}`, pos: m(a.front.elbow) },
      { name: `hand_${side}`, parent: `forearm_${side}`, pos: m(a.front.wrist) },
      { name: `thigh_${side}`, parent: 'pelvis', pos: m(a.hind.hip) },
      { name: `shin_${side}`, parent: `thigh_${side}`, pos: m(a.hind.stifle) },
      { name: `foot_${side}`, parent: `shin_${side}`, pos: m(a.hind.hock) },
      { name: `toe_${side}`, parent: `foot_${side}`, pos: m(a.hind.ball) },
      { name: `wing_arm_${side}`, parent: 'chest', pos: m(w.S) },
      { name: `wing_fore_${side}`, parent: `wing_arm_${side}`, pos: m(w.E) },
      { name: `wing_f1a_${side}`, parent: `wing_fore_${side}`, pos: m(w.W) },
      { name: `wing_f1b_${side}`, parent: `wing_f1a_${side}`, pos: m(w.K1) },
      { name: `wing_f2a_${side}`, parent: `wing_fore_${side}`, pos: m(w.W) },
      { name: `wing_f2b_${side}`, parent: `wing_f2a_${side}`, pos: m(w.K2) },
      { name: `wing_f3_${side}`, parent: `wing_fore_${side}`, pos: m(w.W) },
      { name: `wing_f4_${side}`, parent: `wing_fore_${side}`, pos: m(w.W) },
    );
  }
  return new Skeleton(bones);
}
