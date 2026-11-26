import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy, LegSpec } from './anatomy.ts';

/** logical socket -> bone (the creature has no spare joints for dedicated helpers: budget is 32) */
export function sockets(a: Anatomy): Record<string, string> {
  return a.family === 'scorpion' ? { head: 'chest', chest: 'chest', back: 'back' } : { head: 'head', muzzle: 'head', chest: 'chest', back: 'back' };
}

function legBones(legs: LegSpec[]): BoneSpec[] {
  const out: BoneSpec[] = [];
  for (const l of legs) {
    out.push({ name: l.upper, parent: l.parent, pos: l.hip });
    out.push({ name: l.lower, parent: l.upper, pos: l.knee });
    if (l.foot) out.push({ name: l.foot, parent: l.lower, pos: l.ankle });
  }
  return out;
}

export function makeSkeleton(a: Anatomy): Skeleton {
  const bones: BoneSpec[] = [{ name: 'root', parent: null, pos: [0, 0, 0] }];
  if (a.family === 'scorpion') {
    bones.push({ name: 'chest', parent: 'root', pos: a.chest });
    bones.push({ name: 'back', parent: 'chest', pos: a.back });
    a.tail.slice(0, 5).forEach((j, i) => bones.push({ name: `tail${i + 1}`, parent: i === 0 ? 'back' : `tail${i}`, pos: j }));
    for (const pl of a.palps) {
      const sd = pl.side === 1 ? 'l' : 'r';
      bones.push({ name: `arm_${sd}`, parent: 'chest', pos: pl.shoulder });
      bones.push({ name: `forearm_${sd}`, parent: `arm_${sd}`, pos: pl.elbow });
      bones.push({ name: `hand_${sd}`, parent: `forearm_${sd}`, pos: pl.wrist });
      bones.push({ name: `finger_${sd}`, parent: `hand_${sd}`, pos: pl.pivot });
    }
    bones.push(...legBones(a.legs));
  } else {
    bones.push({ name: 'chest', parent: 'root', pos: a.chest });
    bones.push({ name: 'head', parent: 'chest', pos: a.head });
    bones.push({ name: 'back', parent: 'chest', pos: a.back });
    for (const sd of [1, -1] as const) {
      const n = sd === 1 ? 'l' : 'r';
      bones.push({ name: `elytra_${n}`, parent: 'chest', pos: [sd * a.elytraHinge[0] + sd * 0.05 * a.s, a.elytraHinge[1], a.elytraHinge[2]] });
      bones.push({ name: `mand_${n}`, parent: 'head', pos: [sd * a.mandible.path[0]![0] * 1, a.mandible.path[0]![1], a.mandible.path[0]![2]] });
      bones.push({ name: `ant_${n}`, parent: 'head', pos: [sd * a.antenna[0]![0], a.antenna[0]![1], a.antenna[0]![2]] });
    }
    const crest = (name: string, z: number, parent: string): BoneSpec => ({ name, parent, pos: [0, a.elytraHinge[1] - 0.02 * a.s, z] });
    bones.push(crest('crest_f', 0.18 * a.s, 'chest'));
    bones.push(crest('crest_m', -0.05 * a.s, 'back'));
    bones.push(crest('crest_r', -0.26 * a.s, 'back'));
    bones.push(...legBones(a.legs));
  }
  return new Skeleton(bones);
}
