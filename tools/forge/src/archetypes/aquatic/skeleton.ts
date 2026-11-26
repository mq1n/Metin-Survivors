import type { Vec3 } from '../../core/math.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export const SOCKETS = { head: 'head', muzzle: 'muzzle', chest: 'chest', back: 'back' } as const;

export function makeSkeleton(a: Anatomy): Skeleton {
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const top = a.at(0.05 * a.s);
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'chest', parent: 'root', pos: a.chest },
    { name: 'neck', parent: 'chest', pos: a.neck },
    { name: 'head', parent: 'neck', pos: a.head },
    { name: 'jaw', parent: 'head', pos: a.hinge },
    { name: 'muzzle', parent: 'head', pos: [0, a.mouthY, a.noseZ - 0.04 * a.s], helper: true },
    { name: 'back', parent: 'chest', pos: [0, top.cy + top.hh, 0.05 * a.s], helper: true },
    { name: 'spine', parent: 'chest', pos: a.spine },
    { name: 'tail1', parent: 'spine', pos: a.tail1 },
    { name: 'tail2', parent: 'tail1', pos: a.tail2 },
    { name: 'tail3', parent: 'tail2', pos: a.tail3 },
    { name: 'fluke', parent: 'tail3', pos: a.fluke },
    { name: 'fluke_l', parent: 'fluke', pos: a.lobe.L0 },
    { name: 'fluke_r', parent: 'fluke', pos: mir(a.lobe.L0) },
    { name: 'dorsal1', parent: 'chest', pos: a.dorsal.d1 },
    { name: 'dorsal2', parent: 'dorsal1', pos: a.dorsal.d2 },
  ];
  for (const [side, sx] of [['l', 1], ['r', -1]] as const) {
    const m = (v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
    bones.push(
      { name: `pec_${side}`, parent: 'chest', pos: m(a.pec.S) },
      { name: `pec2_${side}`, parent: `pec_${side}`, pos: m(a.pec.E) },
      { name: `pec3_${side}`, parent: `pec2_${side}`, pos: m(a.pec.W) },
      { name: `pel_${side}`, parent: 'spine', pos: m(a.pel.P0) },
    );
  }
  return new Skeleton(bones);
}
