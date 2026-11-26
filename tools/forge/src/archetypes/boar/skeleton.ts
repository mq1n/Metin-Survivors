import type { Vec3 } from '../../core/math.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export const SOCKETS = { head: 'head', muzzle: 'muzzle', chest: 'chest', back: 'back', hand_l: 'hand_l', hand_r: 'hand_r' } as const;

/** 31 joints: canine layout + two bristle-ridge bones (mane_f / mane_r) so the hackles can rise independently of the spine. */
export function makeSkeleton(a: Anatomy): Skeleton {
  const s = a.hs;
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const c = Math.cos(a.headPitch), sn = Math.sin(a.headPitch);
  const hl = (x: number, y: number, z: number): Vec3 => [a.head[0] + x * s, a.head[1] + (y * c - z * sn) * s, a.head[2] + (y * sn + z * c) * s];
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: a.pelvis },
    { name: 'spine', parent: 'pelvis', pos: a.spine },
    { name: 'chest', parent: 'spine', pos: a.chest },
    { name: 'neck', parent: 'chest', pos: a.neck },
    { name: 'head', parent: 'neck', pos: a.head },
    { name: 'jaw', parent: 'head', pos: a.jaw },
    { name: 'muzzle', parent: 'head', pos: hl(0, -0.06, 0.37), helper: true },
    { name: 'back', parent: 'spine', pos: [0, a.withersY, a.chest[2]], helper: true },
    { name: 'mane_f', parent: 'chest', pos: a.maneF },
    { name: 'mane_r', parent: 'spine', pos: a.maneR },
    { name: 'ear_l', parent: 'head', pos: hl(0.072, 0.078, -0.04) },
    { name: 'ear_r', parent: 'head', pos: hl(-0.072, 0.078, -0.04) },
    { name: 'tail1', parent: 'pelvis', pos: a.tail[0]! },
    { name: 'tail2', parent: 'tail1', pos: a.tail[1]! },
    { name: 'tail3', parent: 'tail2', pos: a.tail[2]! },
    { name: 'tail4', parent: 'tail3', pos: a.tail[3]! },
  ];
  for (const [side, sx] of [['l', 1], ['r', -1]] as const) {
    const m = (v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
    bones.push(
      { name: `arm_${side}`, parent: 'chest', pos: m(a.front.shoulder) },
      { name: `forearm_${side}`, parent: `arm_${side}`, pos: m(a.front.elbow) },
      { name: `hand_${side}`, parent: `forearm_${side}`, pos: m(a.front.wrist) },
      { name: `thigh_${side}`, parent: 'pelvis', pos: m(a.hind.hip) },
      { name: `shin_${side}`, parent: `thigh_${side}`, pos: m(a.hind.stifle) },
      { name: `foot_${side}`, parent: `shin_${side}`, pos: m(a.hind.hock) },
      { name: `toe_${side}`, parent: `foot_${side}`, pos: m(a.hind.fetlock) },
    );
  }
  return new Skeleton(bones);
}
