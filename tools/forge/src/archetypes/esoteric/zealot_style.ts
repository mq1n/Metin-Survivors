// Zealot animation style (OrcStyle): a hunched stalk with the long arms hanging forward, claws half open; the attack is a wild two-handed
// rake (rear back, lunge, tear down and across). No weapon. Chest frame, reference metres: +X = left, +Y = up, +Z = forward. Hand axes
// (solver): b = thumb direction, e = back-of-hand direction (fingers point down at rest).
import { type Key, type Pose, V, basePose } from '../humanoid/index.ts';
import type { OrcStyle } from '../orc/anim.ts';

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const stance = (width: number, fwd: number, drop: number): Partial<Pose> => ({ fl: V(width, 0, fwd), fr: V(-width, 0, -fwd), root: V(0, -drop, 0) });

interface Grip {
  g: V3;
  b: V3;
  e: V3;
  c: number;
}
/** a clawed hand: fingers curl toward the palm; `e` = back of the hand */
const claw = (sx: 1 | -1, g: V3, b: V3, c = 0.25, tilt = 0.2): Grip => ({ g, b: norm(b), e: norm([sx * 0.9, tilt, 0.2]), c });

export function zealotStyle(): OrcStyle {
  const idle: Pose = Object.assign(basePose(), stance(0.12, 0.1, 0.1), {
    sp: [0.36, 0.0, 0] as V3,
    head: [-0.34, 0, 0] as V3,
    hip: [0.1, 0, 0] as V3,
    r: claw(-1, V(-0.3, -0.36, 0.3), V(0, 0.15, 1), 0.3),
    l: claw(1, V(0.3, -0.36, 0.3), V(0, 0.15, 1), 0.3),
    poleR: V(-0.6, -0.2, -1), poleL: V(0.6, -0.2, -1),
  });
  const attack: Key[] = [
    { t: 0, p: {} },
    // rear back: both clawed hands rise over the shoulders, chest arches, weight drops onto the back leg
    { t: 0.3, ease: 'out', p: {
      r: claw(-1, V(-0.36, 0.34, 0.06), [0, 0.6, -0.5], 0.1),
      l: claw(1, V(0.36, 0.34, 0.06), [0, 0.6, -0.5], 0.1),
      sp: [0.05, 0.1, 0], head: [-0.2, 0, 0], hip: [-0.05, 0, 0], root: V(0, -0.14, -0.1), fl: V(0.12, 0, 0.05), fr: V(-0.12, 0, -0.22),
    } },
    // swing: the claws come over and forward, well in front of the chest
    { t: 0.4, ease: 'in', p: {
      r: claw(-1, V(-0.3, 0.26, 0.42), [0, 0.2, 1], 0.1),
      l: claw(1, V(0.3, 0.26, 0.42), [0, 0.2, 1], 0.1),
      sp: [0.2, -0.08, 0], root: V(0, -0.18, 0.1),
    } },
    // rake: lunge in, both hands tear down and cross in front, ending clear of the robe
    { t: 0.48, ease: 'in', p: {
      r: claw(-1, V(0.12, 0.1, 0.56), [0.1, -0.5, 1], 0.1),
      l: claw(1, V(-0.12, 0.1, 0.56), [-0.1, -0.5, 1], 0.1),
      sp: [0.3, -0.18, 0], head: [-0.4, 0, 0], hip: [0.1, 0, 0], root: V(0, -0.22, 0.3), fl: V(0.12, 0, 0.4), fr: V(-0.12, 0, -0.1),
    } },
    { t: 0.6, ease: 'out', p: {
      r: claw(-1, V(0.2, 0.02, 0.58), [0.2, -0.6, 1], 0.1),
      l: claw(1, V(-0.2, 0.02, 0.58), [-0.2, -0.6, 1], 0.1),
      sp: [0.36, -0.22, 0], root: V(0, -0.24, 0.34),
    } },
    { t: 0.85, ease: 'smooth', p: { sp: [0.36, 0, 0], root: V(0, -0.14, 0.16), r: claw(-1, V(-0.1, -0.1, 0.48), [0, -0.2, 1], 0.2), l: claw(1, V(0.1, -0.1, 0.48), [0, -0.2, 1], 0.2) } },
    { t: 1.15, ease: 'smooth', p: { ...idle } },
  ];
  return {
    cfg: {}, idle, attack, attackDur: 1.15, attackHit: 0.48, weight: 1.15, breath: 1.4, spawnRoar: true,
    walk: { sp: [0.46, 0, 0] },
    run: { sp: [0.55, 0, 0], r: { g: V(-0.3, -0.34, 0.26) }, l: { g: V(0.3, -0.34, 0.26) } },
    gait: {
      walk: { T: 1.16, duty: 0.68, sweep: 0.44, lift: 0.08, bob: 0.03, lean: 0.1, twist: 0.2, sway: 0.05, stomp: 0.012, arm: 0.12, roll: 0.12 },
      run: { T: 0.62, duty: 0.4, sweep: 0.92, lift: 0.18, bob: 0.04, lean: 0.3, twist: 0.3, sway: 0.05, stomp: 0.02, arm: 0.2, roll: 0.14 },
    },
  };
}
