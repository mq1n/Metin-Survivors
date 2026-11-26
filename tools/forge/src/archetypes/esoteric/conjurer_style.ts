// Conjurer animation style (OrcStyle for orcClips): a priest with a ritual staff. Chest frame, reference metres: +X = left, +Y = up, +Z =
// forward. Hands are authored as the solver wants them: g grip point, b the direction hand +Z (the staff tip) points, e the direction
// of the back of the hand. Idle: staff upright in the right hand, left hand holding a seal at the chest. Cast (attack): the staff goes
// overhead with the free palm open, then both drive forward and the body folds into the release; the talisman rings flare in the rig.
// Spawn: a summoning rise from a crouch with the staff planted, arms thrown up and back.
import { type Key, type Pose, V, basePose } from '../humanoid/index.ts';
import type { OrcStyle } from '../orc/anim.ts';
import { norm } from './styles.ts';

type V3 = [number, number, number];

const stance = (width: number, fwd: number, drop: number): Partial<Pose> => ({ fl: V(width, 0, fwd), fr: V(-width, 0, -fwd), root: V(0, -drop, 0) });

export const EVO_CAST_HIT = 0.52;
export const EVO_CAST_DUR = 1.3;

export function evoStyle(): OrcStyle {
  const bUp = norm([-0.05, 1, 0.12]);
  const eR: V3 = V(-0.2, 0.1, 1);
  const rHand = (g: V3, b: V3, c = 1): { g: V3; b: V3; e: V3; c: number } => ({ g, b, e: eR, c });
  const seal = { g: V(0.16, -0.06, 0.34), b: norm([-0.7, 0.5, 0.5]), e: V(0.3, 0.3, -1), c: 0.55 };
  const idle: Pose = Object.assign(basePose(), stance(0.1, 0.05, 0.015), {
    sp: [0.02, -0.1, 0] as V3,
    head: [-0.05, 0, 0] as V3,
    r: rHand(V(-0.3, -0.2, 0.24), bUp),
    l: seal,
  });
  const palm = (g: V3): { g: V3; b: V3; e: V3; c: number } => ({ g, b: norm([-0.9, 0.2, 0.3]), e: V(0, 0, -1), c: 0 });
  const attack: Key[] = [
    { t: 0, p: {} },
    // anticipation: a small sink, the staff drawn back toward the body
    { t: 0.14, ease: 'smooth', p: {
      r: rHand(V(-0.33, -0.26, 0.14), norm([-0.12, 1, -0.05])), l: { ...seal, g: V(0.18, -0.12, 0.3) },
      sp: [-0.04, -0.16, 0], head: [0.06, 0, 0], root: V(0, -0.045, -0.02), fl: V(0.1, 0, 0.02), fr: V(-0.1, 0, -0.08),
    } },
    // gather: the staff goes overhead, the free hand opens beside the head, the chest arches
    { t: 0.34, ease: 'out', p: {
      r: rHand(V(-0.24, 0.5, 0.2), norm([0, 1, 0.1])), l: palm(V(0.24, 0.3, 0.34)),
      sp: [-0.24, -0.12, 0], head: [-0.28, 0, 0], root: V(0, 0.015, -0.03), fl: V(0.1, 0, 0.06), fr: V(-0.1, 0, -0.12),
    } },
    // release: the staff drives forward and down, the open palm thrusts after it, the body folds into the step
    { t: EVO_CAST_HIT, ease: 'in', p: {
      r: rHand(V(-0.14, 0.04, 0.58), norm([0.06, -0.1, 1])), l: palm(V(0.12, 0.1, 0.7)),
      sp: [0.3, 0.1, 0], head: [-0.15, 0, 0], root: V(0, -0.1, 0.16), fl: V(0.1, 0, 0.34), fr: V(-0.1, 0, -0.1),
    } },
    { t: 0.76, ease: 'out', p: {
      r: rHand(V(-0.14, 0.07, 0.62), norm([0.06, -0.06, 1])), l: palm(V(0.12, 0.13, 0.74)),
      sp: [0.34, 0.12, 0], root: V(0, -0.11, 0.19),
    } },
    { t: EVO_CAST_DUR, ease: 'smooth', p: { ...idle } },
  ];
  // summon: crouch with the staff planted, rise, throw the arms up and back
  const spawn: Key[] = [
    { t: 0, p: {
      root: V(0, -0.5, 0), sp: [0.7, 0, 0], head: [0.4, 0, 0],
      r: rHand(V(-0.3, -0.5, 0.2), bUp), l: { g: V(0.3, -0.55, 0.2), b: norm([0, -0.2, 1]), e: V(0.3, 0.3, -1), c: 0.4 },
      fl: V(0.16, 0, 0.1), fr: V(-0.16, 0, -0.08),
    } },
    { t: 0.6, ease: 'smooth', p: { root: V(0, -0.3, 0), sp: [0.4, 0, 0], head: [0.15, 0, 0] } },
    { t: 1.15, ease: 'out', p: {
      ...idle, root: V(0, 0.04, 0), sp: [-0.28, 0, 0], head: [-0.4, 0, 0],
      r: rHand(V(-0.24, 0.55, 0.14), norm([0.05, 1, 0.05])), l: palm(V(0.28, 0.5, 0.2)),
    } },
    { t: 1.7, ease: 'smooth', p: { ...idle } },
  ];
  return {
    cfg: {}, idle, attack, attackDur: EVO_CAST_DUR, attackHit: EVO_CAST_HIT, weight: 0.8, breath: 0.8,
    specials: { spawn: { keys: spawn, dur: 1.7 } },
    walk: { sp: [0.06, -0.08, 0] },
    run: { sp: [0.16, -0.05, 0], r: { g: V(-0.3, -0.24, 0.18), b: norm([0.1, 0.9, 0.5]) } },
    gait: {
      walk: { T: 1.12, duty: 0.66, sweep: 0.46, lift: 0.08, bob: 0.014, lean: 0.04, twist: 0.1, sway: 0.02, stomp: 0.005, arm: 0.08, roll: 0.05 },
      run: { T: 0.7, duty: 0.4, sweep: 0.84, lift: 0.17, bob: 0.03, lean: 0.17, twist: 0.14, sway: 0.02, stomp: 0.01, arm: 0.12, roll: 0.07 },
    },
  };
}
