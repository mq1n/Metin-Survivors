import type { Vec3 } from '../../core/math.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export const SOCKETS = { head: 'head', muzzle: 'muzzle', chest: 'chest', back: 'back', hand_l: 'hand_l', hand_r: 'hand_r' } as const;

export const tailBoneNames = (n: number): string[] => Array.from({ length: n }, (_, i) => `tail${i + 1}`);

export function hasMane(a: Anatomy): boolean {
  return a.p.maneStyle !== 'none' && a.p.mane > 0.05;
}

export function makeSkeleton(a: Anatomy): Skeleton {
  const hs = a.p.headScale * a.s;
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: a.pelvis },
    { name: 'spine', parent: 'pelvis', pos: a.spine },
    { name: 'chest', parent: 'spine', pos: a.chest },
    { name: 'neck', parent: 'chest', pos: a.neck },
    { name: 'head', parent: 'neck', pos: a.head },
    { name: 'jaw', parent: 'head', pos: a.jaw },
    { name: 'muzzle', parent: 'head', pos: [0, a.head[1] - 0.05 * hs, a.head[2] + (0.1 + 0.12 * a.p.muzzleLength) * hs * 1.15], helper: true },
    { name: 'back', parent: 'spine', pos: [0, a.withersY, a.spine[2]], helper: true },
    { name: 'ear_l', parent: 'head', pos: [0.085 * hs * a.p.skullWidth, a.head[1] + 0.085 * hs, a.head[2] - 0.03 * hs] },
    { name: 'ear_r', parent: 'head', pos: [-0.085 * hs * a.p.skullWidth, a.head[1] + 0.085 * hs, a.head[2] - 0.03 * hs] },
  ];
  const names = tailBoneNames(a.tailBones);
  names.forEach((nm, i) => bones.push({ name: nm, parent: i === 0 ? 'pelvis' : names[i - 1]!, pos: a.tail[i]! }));
  if (hasMane(a)) {
    const nk = a.neck;
    bones.push({ name: 'mane_l', parent: 'neck', pos: [0.1 * a.s, nk[1] + 0.02 * a.s, nk[2] + 0.1 * a.s] });
    bones.push({ name: 'mane_r', parent: 'neck', pos: [-0.1 * a.s, nk[1] + 0.02 * a.s, nk[2] + 0.1 * a.s] });
    if (a.p.kind === 'boss') bones.push({ name: 'mane_b', parent: 'chest', pos: [0, a.withersY, a.chest[2] - 0.05 * a.s] });
  }
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
