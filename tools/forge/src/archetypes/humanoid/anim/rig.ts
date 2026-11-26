// Humanoid pose solver. A full-body pose is described by a small set of numbers (root, pelvis, spine/chest, head, foot
// offsets, hand grip points + weapon directions in the chest frame); `applyPose` turns it into bone rotations with
// analytic two-bone IK (legs plant on the ground, hands hold the weapon wherever the torso turns).
import { type PoseCtx } from '../../../core/anim/clip.ts';
import { aimQuat, twoBoneIK } from '../../../core/anim/ik.ts';
import { type Quat, type Vec3, QIDENT, qeuler, qinv, qmul, qrotate, vadd, vcross, vlen, vnorm, vscale, vsub } from '../../../core/math.ts';
import type { Anatomy } from '../anatomy.ts';

/** Euler triple (pitch about X, yaw about Y, roll about Z), radians */
export type E3 = [number, number, number];

export interface Hand {
  /** grip centre in the chest frame (metres at reference scale; multiplied by body scale) */
  g: Vec3;
  /** weapon / hand forward axis (hand +Z) in the chest frame */
  b: Vec3;
  /** edge direction (hand -X for the right hand, +X for the left at rest) in the chest frame */
  e: Vec3;
  /** finger curl 0 (open) .. 1 (closed fist) */
  c: number;
}

export interface Pose {
  /** root translation (metres, world) */
  root: Vec3;
  /** rotation of the whole body about the root origin (death falls etc.) */
  rootRot: E3;
  hip: E3;
  hipMove: Vec3;
  /** spine+chest total rotation */
  sp: E3;
  head: E3;
  /** ankle offsets from the rest stance (world, metres) and foot pitch (heel lift / toe tilt) */
  fl: Vec3;
  fr: Vec3;
  fpl: number;
  fpr: number;
  /** foot yaw (toe-out) */
  fyl: number;
  fyr: number;
  r: Hand;
  l: Hand;
  /** extra shoulder lift (radians) */
  shr: number;
  shl: number;
  /** pole hints for elbows in the chest frame */
  poleR: Vec3;
  poleL: Vec3;
}

export const V = (x: number, y: number, z: number): Vec3 => [x, y, z];

export function basePose(): Pose {
  return {
    root: [0, 0, 0],
    rootRot: [0, 0, 0],
    hip: [0, 0, 0],
    hipMove: [0, 0, 0],
    sp: [0, 0, 0],
    head: [0, 0, 0],
    fl: [0, 0, 0],
    fr: [0, 0, 0],
    fpl: 0,
    fpr: 0,
    fyl: 0,
    fyr: 0,
    r: { g: [-0.24, -0.3, 0.1], b: [0, 0, 1], e: [-1, 0, 0], c: 0.4 },
    l: { g: [0.24, -0.3, 0.1], b: [0, 0, 1], e: [1, 0, 0], c: 0.4 },
    shr: 0,
    shl: 0,
    poleR: [-0.5, -0.2, -1],
    poleL: [0.5, -0.2, -1],
  };
}

export function clonePose(p: Pose): Pose {
  return {
    ...p,
    root: [...p.root], rootRot: [...p.rootRot], hip: [...p.hip], hipMove: [...p.hipMove], sp: [...p.sp], head: [...p.head],
    fl: [...p.fl], fr: [...p.fr],
    r: { g: [...p.r.g], b: [...p.r.b], e: [...p.r.e], c: p.r.c },
    l: { g: [...p.l.g], b: [...p.l.b], e: [...p.l.e], c: p.l.c },
    poleR: [...p.poleR], poleL: [...p.poleL],
  };
}

const lerpN = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = <T extends number[]>(a: T, b: T, t: number): T => a.map((x, i) => lerpN(x, b[i]!, t)) as T;

/** linear blend of two poses (vectors renormalised where they are directions) */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const hand = (x: Hand, y: Hand): Hand => ({ g: lerpV(x.g, y.g, t), b: vnorm(lerpV(x.b, y.b, t)), e: vnorm(lerpV(x.e, y.e, t)), c: lerpN(x.c, y.c, t) });
  return {
    root: lerpV(a.root, b.root, t), rootRot: lerpV(a.rootRot, b.rootRot, t), hip: lerpV(a.hip, b.hip, t), hipMove: lerpV(a.hipMove, b.hipMove, t),
    sp: lerpV(a.sp, b.sp, t), head: lerpV(a.head, b.head, t), fl: lerpV(a.fl, b.fl, t), fr: lerpV(a.fr, b.fr, t),
    fpl: lerpN(a.fpl, b.fpl, t), fpr: lerpN(a.fpr, b.fpr, t), fyl: lerpN(a.fyl, b.fyl, t), fyr: lerpN(a.fyr, b.fyr, t),
    r: hand(a.r, b.r), l: hand(a.l, b.l), shr: lerpN(a.shr, b.shr, t), shl: lerpN(a.shl, b.shl, t),
    poleR: lerpV(a.poleR, b.poleR, t), poleL: lerpV(a.poleL, b.poleL, t),
  };
}

export interface SolveCfg {
  /** two-hand weapon: left hand follows the right hand's weapon axis at this distance (m); 0 = independent */
  twoHand?: number;
  /** thumb curl relative to the finger curl */
  thumb?: number;
}

const qe = (e: E3): Quat => qeuler(e[0], e[1], e[2]);

/** distribute a torso rotation over spine / chest / neck */
function torsoSplit(c: PoseCtx, sp: E3, head: E3): void {
  c.set('spine', sp[0] * 0.4, sp[1] * 0.38, sp[2] * 0.4);
  c.set('chest', sp[0] * 0.6, sp[1] * 0.62, sp[2] * 0.6);
  // the head counter-rotates a share of the torso so the gaze stays steadier than the shoulders
  c.set('neck', head[0] * 0.4 - sp[0] * 0.15, head[1] * 0.4 - sp[1] * 0.3, head[2] * 0.4 - sp[2] * 0.2);
  c.set('head', head[0] * 0.6 - sp[0] * 0.15, head[1] * 0.6 - sp[1] * 0.3, head[2] * 0.6 - sp[2] * 0.2);
}

/** apply `Pose` to the PoseCtx: root/pelvis/torso, leg IK (planted feet), arm IK (grips), finger curl */
export function applyPose(c: PoseCtx, a: Anatomy, P: Pose, cfg: SolveCfg = {}): void {
  const sk = c.skel;
  const s = a.s;
  // ---- body
  c.set('root', P.rootRot[0], P.rootRot[1], P.rootRot[2]);
  c.move('root', P.root[0], P.root[1], P.root[2]);
  c.set('pelvis', P.hip[0], P.hip[1], P.hip[2]);
  c.move('pelvis', P.hipMove[0], P.hipMove[1], P.hipMove[2]);
  torsoSplit(c, P.sp, P.head);
  // shoulder lift follows the hands: raise the clavicle when a hand is above the shoulder line
  const lift = (h: Hand, extra: number): number => Math.min(Math.max((h.g[1] - 0.12) / 0.4, 0), 1) * 0.28 + extra;
  c.set('clavicle_r', 0, 0, -lift(P.r, P.shr));
  c.set('clavicle_l', 0, 0, lift(P.l, P.shl));
  const w = sk.fk(c.pose);

  // ---- legs
  for (const sx of [1, -1] as (1 | -1)[]) {
    const n = sx === 1 ? 'l' : 'r';
    const fo = sx === 1 ? P.fl : P.fr;
    const pitch = sx === 1 ? P.fpl : P.fpr;
    const yaw = sx === 1 ? P.fyl : P.fyr;
    const iT = sk.idx(`thigh_${n}`), iS = sk.idx(`shin_${n}`), iF = sk.idx(`foot_${n}`), iB = sk.idx(`toe_${n}`);
    const hip = sk.restPos(iT), knee = sk.restPos(iS), ankle = sk.restPos(iF), ball = sk.restPos(iB);
    const ballDist = ball[2] - ankle[2];
    const target: Vec3 = [ankle[0] + fo[0], ankle[1] + fo[1] + Math.max(Math.sin(pitch), 0) * ballDist, ankle[2] + fo[2] - ballDist * (1 - Math.cos(Math.max(pitch, 0)))];
    const l1 = vlen(vsub(knee, hip)), l2 = vlen(vsub(ankle, knee));
    const pole = qrotate(w.rot[sk.parent[iT]!]!, [sx * 0.08, 0, 1]);
    const sol = twoBoneIK(w.pos[iT]!, target, l1, l2, pole);
    const restAxis = vnorm(vsub(ankle, hip));
    const restSide = vnorm(vcross(restAxis, [0, 0, 1]));
    const newAxis = vnorm(vsub(sol.end, w.pos[iT]!));
    const newSide = vnorm(vcross(newAxis, pole));
    const upW = aimQuat(vnorm(vsub(knee, hip)), restSide, vnorm(vsub(sol.mid, w.pos[iT]!)), newSide);
    const loW = aimQuat(vnorm(vsub(ankle, knee)), restSide, vnorm(vsub(sol.end, sol.mid)), newSide);
    c.setQ(`thigh_${n}`, qmul(qinv(w.rot[sk.parent[iT]!]!), upW));
    c.setQ(`shin_${n}`, qmul(qinv(upW), loW));
    const footW = qeuler(pitch, yaw, 0);
    c.setQ(`foot_${n}`, qmul(qinv(loW), footW));
    c.set(`toe_${n}`, -Math.max(pitch, 0) * 0.9 + Math.min(pitch, 0) * 0.5, 0, 0);
  }

  // ---- arms
  const chestQ = w.rot[sk.idx('chest')]!;
  const chestP = w.pos[sk.idx('chest')]!;
  const hands: { h: Hand; sx: 1 | -1; pole: Vec3 }[] = [{ h: P.r, sx: -1, pole: P.poleR }, { h: P.l, sx: 1, pole: P.poleL }];
  for (const { h, sx, pole } of hands) {
    const n = sx === 1 ? 'l' : 'r';
    const iU = sk.idx(`upper_arm_${n}`), iFa = sk.idx(`forearm_${n}`), iW = sk.idx(`wrist_${n}`), iH = sk.idx(`hand_${n}`);
    const shoulder = sk.restPos(iU), elbow = sk.restPos(iFa), wrist = sk.restPos(iW), palm = sk.restPos(iH);
    let g = h.g, b = h.b, e = h.e;
    if (cfg.twoHand && sx === 1) {
      // left hand holds the same weapon: further along the blade, palm facing the opposite way
      const rb = vnorm(P.r.b);
      g = vadd(P.r.g, vscale(rb, cfg.twoHand));
      b = rb;
      e = vscale(P.r.e, -1);
    }
    const gripW = vadd(chestP, qrotate(chestQ, vscale(g, s)));
    const bladeW = vnorm(qrotate(chestQ, b));
    const edgeW = vnorm(qrotate(chestQ, e));
    const restEdge: Vec3 = [sx, 0, 0];
    const Rh = aimQuat([0, 0, 1], restEdge, bladeW, edgeW);
    const wristTarget = vsub(gripW, qrotate(Rh, vsub(palm, wrist)));
    const poleW = qrotate(chestQ, pole);
    const l1 = vlen(vsub(elbow, shoulder)), l2 = vlen(vsub(wrist, elbow));
    const sol = twoBoneIK(w.pos[iU]!, wristTarget, l1, l2, poleW);
    const restAxis = vnorm(vsub(wrist, shoulder));
    const restPole: Vec3 = [sx * 0.3, 0, -1];
    const restSide = vnorm(vcross(restAxis, restPole));
    const newAxis = vnorm(vsub(sol.end, w.pos[iU]!));
    const newSide = vnorm(vcross(newAxis, poleW));
    const upW = aimQuat(vnorm(vsub(elbow, shoulder)), restSide, vnorm(vsub(sol.mid, w.pos[iU]!)), newSide);
    const loW = aimQuat(vnorm(vsub(wrist, elbow)), restSide, vnorm(vsub(sol.end, sol.mid)), newSide);
    const parentW = w.rot[sk.parent[iU]!]!;
    c.setQ(`upper_arm_${n}`, qmul(qinv(parentW), upW));
    c.setQ(`forearm_${n}`, qmul(qinv(upW), loW));
    c.setQ(`wrist_${n}`, qmul(qinv(loW), Rh));
    const curl = Math.min(Math.max(h.c, 0), 1);
    c.set(`fingers_${n}`, 0, 0, -sx * curl * 1.05);
    c.set(`thumb_${n}`, 0, sx * curl * 0.25, -sx * curl * (cfg.thumb ?? 0.55));
  }
}

export { QIDENT, qe };
