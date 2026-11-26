// Ascetic animation style (OrcStyle): an upright one-hand spear rest with a one-palm salute, a two-hand lunging spear thrust, planted-foot
// gaits that carry the spear level. Chest frame, reference metres: +X = left, +Y = up, +Z = forward. Hand axes (solver): g = grip point, b = direction the shaft
// points (hand +Z), e = direction of the back of the hand (right hand: hand -X, left hand: hand +X at rest).
//
// The spear is rigid on the right hand, so the guide (left) hand must sit ON the shaft: both grips are authored as two points and the shaft

// hand holds its place while the rear hand pushes the shaft through it in the thrust.
import { type Key, type Pose, V, basePose } from '../humanoid/index.ts';
import type { OrcStyle } from '../orc/anim.ts';

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** `e` made perpendicular to the shaft axis `b` */
const perp = (e: V3, b: V3): V3 => {
  const k = dot(e, b);
  return norm([e[0] - b[0] * k, e[1] - b[1] * k, e[2] - b[2] * k]);
};

interface Grip {
  g: V3;
  b: V3;
  e: V3;
  c: number;
}

/** both hands on the shaft: rear (right) hand at gR, guide (left) hand at gL; the shaft is the line between them */
function hold(gR: V3, gL: V3, o: { eR?: V3; eL?: V3; cR?: number; cL?: number } = {}): { r: Grip; l: Grip } {
  const b = norm([gL[0] - gR[0], gL[1] - gR[1], gL[2] - gR[2]]);
  return {
    r: { g: gR, b, e: perp(o.eR ?? V(-0.55, 0.8, 0.1), b), c: o.cR ?? 1 },
    l: { g: gL, b, e: perp(o.eL ?? V(0.5, 0.85, 0.0), b), c: o.cL ?? 0.95 },
  };
}

const stance = (width: number, fwd: number, drop: number): Partial<Pose> => ({ fl: V(width, 0, fwd), fr: V(-width, 0, -fwd), root: V(0, -drop, 0) });

export function asceticStyle(): OrcStyle {
  // idle: the spear stands upright in the right fist (forearm forward, butt clear of the floor, blade high above the head), the left hand is
  // raised before the chest in a one-palm salute. The thrust then swings the spear down into the two-hand grip.
  const up = norm([-0.17, 1, 0.3]);
  const idle: Pose = Object.assign(basePose(), stance(0.13, 0.1, 0.05), {
    sp: [0.04, -0.1, -0.04] as V3,
    hip: [0, 0.08, 0.05] as V3,
    head: [-0.04, 0.08, 0.03] as V3,
    fyl: 0.1, fyr: -0.3,
    r: { g: V(-0.27, -0.26, 0.2), b: up, e: perp(V(-1, 0, 0.15), up), c: 1 },
    l: { g: V(0.0, 0.07, 0.25), b: norm([0, 0.25, -1]), e: V(1, 0, 0), c: 0.05 },
    poleR: V(-0.6, -0.8, -0.3), poleL: V(0.7, -0.7, -0.2),
  });
  const attack: Key[] = [
    { t: 0, p: {} },
    // coil: weight drops onto the back leg, spear drawn back and levelled at the target, chest wound to the right
    { t: 0.3, ease: 'smooth', p: {
      ...hold([-0.28, -0.22, -0.02], [0.06, -0.1, 0.34]),
      sp: [-0.06, -0.5, 0.04], hip: [0, -0.05, 0], head: [0, 0.34, 0], root: V(0, -0.1, -0.06), fl: V(0.13, 0, 0.14), fr: V(-0.1, 0, -0.2),
    } },
    // thrust: hips unwind, front foot lunges, the rear hand drives the shaft through the guide hand
    { t: 0.52, ease: 'in', p: {
      ...hold([0.02, -0.1, 0.3], [0.04, -0.06, 0.55]),
      sp: [0.18, -0.12, -0.03], hip: [0, 0.14, 0], head: [-0.06, 0.1, 0], root: V(0, -0.16, 0.3), fl: V(0.13, 0, 0.5), fr: V(-0.1, 0, -0.08),
    } },
    // follow-through: the lunge overshoots a touch
    { t: 0.62, ease: 'out', p: {
      ...hold([0.04, -0.09, 0.34], [0.05, -0.06, 0.57]),
      sp: [0.25, -0.1, -0.03], root: V(0, -0.19, 0.34),
    } },
    // recover: the spear is drawn back to the guard
    { t: 0.9, ease: 'smooth', p: {
      ...hold([-0.18, -0.24, 0.1], [0.08, -0.05, 0.44]),
      sp: [0.1, -0.22, 0], hip: [0, 0.18, 0], head: [-0.02, 0.15, 0], root: V(0, -0.1, 0.12), fl: V(0.13, 0, 0.3), fr: V(-0.1, 0, -0.12),
    } },
    { t: 1.3, ease: 'smooth', p: { ...idle } },
  ];
  return {
    cfg: {}, idle, attack, attackDur: 1.3, attackHit: 0.54, weight: 1,
    walk: { ...hold([-0.12, -0.26, 0.15], [0.07, -0.05, 0.52]), sp: [0.1, -0.12, 0] },
    run: { ...hold([-0.05, -0.24, 0.14], [0.06, -0.04, 0.56]), sp: [0.2, -0.1, 0] },
    gait: {
      walk: { T: 1.06, duty: 0.64, sweep: 0.56, lift: 0.1, bob: 0.025, lean: 0.06, twist: 0.1, sway: 0.03, stomp: 0.012, arm: 0, roll: 0.07 },
      run: { T: 0.66, duty: 0.4, sweep: 0.98, lift: 0.2, bob: 0.045, lean: 0.22, twist: 0.16, sway: 0.03, stomp: 0.025, arm: 0, roll: 0.09 },
    },
  };
}
