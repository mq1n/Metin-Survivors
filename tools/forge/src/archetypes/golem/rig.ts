// Golem pose solver: a full-body pose is a handful of numbers (root, pelvis, torso, head, planted-foot offsets, fist targets
// in the chest frame); `GolemRig.apply` turns it into bone rotations with analytic two-bone IK. Same structure as the
// humanoid solver (applyPose), but (1) metres everywhere, (2) the rest bend poles are measured from the rest skeleton so the
// rest pose solves to EXACTLY identity rotations (rigid slabs must not twist at rest), (3) the fist is oriented by a
// fingertip direction + grip axis, (4) golem extras (core scale, shoulder lift).
import type { PoseCtx } from '../../core/anim/clip.ts';
import { aimQuat, twoBoneIK } from '../../core/anim/ik.ts';
import { type Vec3, qeuler, qinv, qmul, qrotate, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';

/** Euler triple (pitch about X, yaw about Y, roll about Z), radians */
export type E3 = [number, number, number];

export interface Fist {
  /** palm centre target (metres): in the chest frame (chest bone at the origin, rest orientation = world axes) unless `w` */
  g: Vec3;
  /** fingertip direction (rest: down) */
  f: Vec3;
  /** grip axis = fist forward (rest: +Z) */
  b: Vec3;
  /** elbow bend hint in the same frame */
  pole: Vec3;
  /** true: g / f / b / pole are in the ROOT frame (planted slams, ground blows) instead of the chest frame */
  w?: boolean;
}

export interface GPose {
  root: Vec3;
  /** rotation of the whole body about the root origin (death tilts) */
  rootRot: E3;
  hip: E3;
  hipMove: Vec3;
  /** spine + chest total rotation */
  sp: E3;
  head: E3;
  /** ankle offsets from the rest stance (world, metres), foot pitch (+ = heel up), yaw */
  fl: Vec3;
  fr: Vec3;
  fpl: number;
  fpr: number;
  fyl: number;
  fyr: number;
  r: Fist;
  l: Fist;
  /** extra clavicle lift (radians, + raises the shoulder) */
  shr: number;
  shl: number;
  /** uniform scale of the `core` bone */
  core: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = <T extends number[]>(a: T, b: T, t: number): T => a.map((x, i) => lerp(x, b[i]!, t)) as T;
const cloneV = <T extends number[]>(v: T): T => [...v] as T;

export function clonePose(p: GPose): GPose {
  const f = (h: Fist): Fist => ({ g: cloneV(h.g), f: cloneV(h.f), b: cloneV(h.b), pole: cloneV(h.pole), ...(h.w ? { w: true } : {}) });
  return {
    ...p, root: cloneV(p.root), rootRot: cloneV(p.rootRot), hip: cloneV(p.hip), hipMove: cloneV(p.hipMove), sp: cloneV(p.sp), head: cloneV(p.head),
    fl: cloneV(p.fl), fr: cloneV(p.fr), r: f(p.r), l: f(p.l),
  };
}

/** linear blend of two poses (directions renormalised) */
export function blendPose(a: GPose, b: GPose, t: number): GPose {
  const fist = (x: Fist, y: Fist): Fist => ({ g: lerpV(x.g, y.g, t), f: vnorm(lerpV(x.f, y.f, t)), b: vnorm(lerpV(x.b, y.b, t)), pole: vnorm(lerpV(x.pole, y.pole, t)), ...((t < 0.5 ? x.w : y.w) ? { w: true } : {}) });
  return {
    root: lerpV(a.root, b.root, t), rootRot: lerpV(a.rootRot, b.rootRot, t), hip: lerpV(a.hip, b.hip, t), hipMove: lerpV(a.hipMove, b.hipMove, t),
    sp: lerpV(a.sp, b.sp, t), head: lerpV(a.head, b.head, t), fl: lerpV(a.fl, b.fl, t), fr: lerpV(a.fr, b.fr, t),
    fpl: lerp(a.fpl, b.fpl, t), fpr: lerp(a.fpr, b.fpr, t), fyl: lerp(a.fyl, b.fyl, t), fyr: lerp(a.fyr, b.fyr, t),
    r: fist(a.r, b.r), l: fist(a.l, b.l), shr: lerp(a.shr, b.shr, t), shl: lerp(a.shl, b.shl, t), core: lerp(a.core, b.core, t),
  };
}

const perp = (a: Vec3, mid: Vec3, b: Vec3): Vec3 => {
  const ax = vnorm(vsub(b, a));
  const e = vsub(mid, a);
  return vnorm(vsub(e, vscale(ax, vdot(e, ax))));
};

export class GolemRig {
  private readonly p: Record<string, Vec3> = {};
  private readonly armPole: Record<'l' | 'r', Vec3>;
  private readonly legPole: Record<'l' | 'r', Vec3>;
  private readonly shRel: number;

  /** straight leg length (thigh + shin), metres */
  readonly legLen: number;
  /** rest hip-to-ankle height, metres (the root drops by the shortfall when a stride needs more reach) */
  readonly hipH: number;
  /** ankle-to-ball distance along the foot and the ball's drop below the ankle (metres): a heel-up foot pivots about the planted ball */
  private readonly ballDist: number;
  private readonly ballDrop: number;

  constructor(readonly sk: Skeleton) {
    for (const n of sk.names) this.p[n] = sk.restPos(n);
    const ap = (n: 'l' | 'r'): Vec3 => perp(this.p[`upper_arm_${n}`]!, this.p[`forearm_${n}`]!, this.p[`wrist_${n}`]!);
    const lp = (n: 'l' | 'r'): Vec3 => perp(this.p[`thigh_${n}`]!, this.p[`shin_${n}`]!, this.p[`foot_${n}`]!);
    this.armPole = { l: ap('l'), r: ap('r') };
    this.legPole = { l: lp('l'), r: lp('r') };
    this.shRel = this.p.upper_arm_l![1] - this.p.chest![1];
    this.legLen = vlen(vsub(this.p.shin_l!, this.p.thigh_l!)) + vlen(vsub(this.p.foot_l!, this.p.shin_l!));
    this.hipH = this.p.thigh_l![1] - this.p.foot_l![1];
    this.ballDist = this.p.toe_l![2] - this.p.foot_l![2];
    this.ballDrop = this.p.foot_l![1] - this.p.toe_l![1];
  }

  /** ankle shift (dy, dz) of a foot pitched heel-up by `pitch` rad about its planted ball (heel-down feet pivot about the heel: no shift) */
  ankleLift(pitch: number): [number, number] {
    const p = Math.max(pitch, 0);
    return [this.ballDist * Math.sin(p) + this.ballDrop * (Math.cos(p) - 1), this.ballDrop * Math.sin(p) + this.ballDist * (1 - Math.cos(p))];
  }

  /** rest position of a bone (metres, root frame) */
  restPos(bone: string): Vec3 {
    return this.p[bone]!;
  }

  rest(): GPose {
    const chest = this.p.chest!;
    const fist = (n: 'l' | 'r'): Fist => ({ g: vsub(this.p[`hand_${n}`]!, chest), f: [0, -1, 0], b: [0, 0, 1], pole: this.armPole[n] });
    return {
      root: [0, 0, 0], rootRot: [0, 0, 0], hip: [0, 0, 0], hipMove: [0, 0, 0], sp: [0, 0, 0], head: [0, 0, 0],
      fl: [0, 0, 0], fr: [0, 0, 0], fpl: 0, fpr: 0, fyl: 0, fyr: 0,
      r: fist('r'), l: fist('l'), shr: 0, shl: 0, core: 1,
    };
  }

  /** rest palm height relative to the chest (for authoring hanging fists) */
  get restG(): { l: Vec3; r: Vec3 } {
    const r = this.rest();
    return { l: r.l.g, r: r.r.g };
  }

  /** fist orientation helper: fingertips along `down`, knuckle row (grip axis) along `fwd` */
  static fist(down: Vec3, fwd: Vec3): { f: Vec3; b: Vec3 } {
    return { f: vnorm(down), b: vnorm(fwd) };
  }

  apply(c: PoseCtx, P: GPose): void {
    const sk = this.sk;
    const p = this.p;
    // ---- body
    c.set('root', P.rootRot[0], P.rootRot[1], P.rootRot[2]);
    c.move('root', P.root[0], P.root[1], P.root[2]);
    c.set('pelvis', P.hip[0], P.hip[1], P.hip[2]);
    c.move('pelvis', P.hipMove[0], P.hipMove[1], P.hipMove[2]);
    const sp = P.sp, hd = P.head;
    c.set('spine', sp[0] * 0.4, sp[1] * 0.38, sp[2] * 0.4);
    c.set('chest', sp[0] * 0.6, sp[1] * 0.62, sp[2] * 0.6);
    c.set('neck', hd[0] * 0.4 - sp[0] * 0.15, hd[1] * 0.4 - sp[1] * 0.3, hd[2] * 0.4 - sp[2] * 0.2);
    c.set('head', hd[0] * 0.6 - sp[0] * 0.15, hd[1] * 0.6 - sp[1] * 0.3, hd[2] * 0.6 - sp[2] * 0.2);
    if (Math.abs(P.core - 1) > 1e-4) c.scale('core', P.core);
    // shoulders lift when a fist goes above the shoulder line
    const lift = (f: Fist, extra: number): number => {
      const gy = f.w ? f.g[1] - this.p.chest![1] : f.g[1];
      const u = Math.min(Math.max((gy - (this.shRel - 0.55)) / 1.1, 0), 1);
      return u * u * (3 - 2 * u) * 0.3 + extra;
    };
    c.set('clavicle_r', 0, 0, -lift(P.r, P.shr));
    c.set('clavicle_l', 0, 0, lift(P.l, P.shl));
    const w = sk.fk(c.pose);

    // ---- legs: planted feet
    for (const sx of [1, -1] as const) {
      const n = sx === 1 ? 'l' : 'r';
      const fo = sx === 1 ? P.fl : P.fr;
      const pitch = sx === 1 ? P.fpl : P.fpr;
      const yaw = sx === 1 ? P.fyl : P.fyr;
      const iT = sk.idx(`thigh_${n}`);
      const hip = p[`thigh_${n}`]!, knee = p[`shin_${n}`]!, ankle = p[`foot_${n}`]!;
      const [dy, dz] = this.ankleLift(pitch);
      const target: Vec3 = [ankle[0] + fo[0], ankle[1] + fo[1] + dy, ankle[2] + fo[2] + dz];
      const parentW = w.rot[sk.parent[iT]!]!;
      const pole0 = this.legPole[n];
      const poleW = qrotate(parentW, pole0);
      const sol = twoBoneIK(w.pos[iT]!, target, vlen(vsub(knee, hip)), vlen(vsub(ankle, knee)), poleW);
      const restSide = vnorm(vcross(vnorm(vsub(ankle, hip)), pole0));
      const newSide = vnorm(vcross(vnorm(vsub(sol.end, w.pos[iT]!)), poleW));
      const upW = aimQuat(vnorm(vsub(knee, hip)), restSide, vnorm(vsub(sol.mid, w.pos[iT]!)), newSide);
      const loW = aimQuat(vnorm(vsub(ankle, knee)), restSide, vnorm(vsub(sol.end, sol.mid)), newSide);
      c.setQ(`thigh_${n}`, qmul(qinv(parentW), upW));
      c.setQ(`shin_${n}`, qmul(qinv(upW), loW));
      c.setQ(`foot_${n}`, qmul(qinv(loW), qeuler(pitch, yaw, 0)));
      c.set(`toe_${n}`, -Math.max(pitch, 0) * 0.9 + Math.min(pitch, 0) * 0.5, 0, 0);
    }

    // ---- arms: fists follow chest-frame (or root-frame) targets
    const chestQ = w.rot[sk.idx('chest')]!;
    const chestP = w.pos[sk.idx('chest')]!;
    const rootQ = w.rot[sk.idx('root')]!;
    const rootP = w.pos[sk.idx('root')]!;
    for (const sx of [-1, 1] as const) {
      const n = sx === 1 ? 'l' : 'r';
      const h = sx === 1 ? P.l : P.r;
      const iU = sk.idx(`upper_arm_${n}`);
      const shoulder = p[`upper_arm_${n}`]!, elbow = p[`forearm_${n}`]!, wrist = p[`wrist_${n}`]!, palm = p[`hand_${n}`]!;
      const fq = h.w ? rootQ : chestQ;
      const fp = h.w ? rootP : chestP;
      const gq = qrotate(fq, h.g);
      const gripW: Vec3 = [fp[0] + gq[0], fp[1] + gq[1], fp[2] + gq[2]];
      const Rh = aimQuat([0, 0, 1], [0, -1, 0], vnorm(qrotate(fq, h.b)), vnorm(qrotate(fq, h.f)));
      const off = qrotate(Rh, vsub(palm, wrist));
      const wristTarget: Vec3 = [gripW[0] - off[0], gripW[1] - off[1], gripW[2] - off[2]];
      const pole0 = this.armPole[n];
      const poleW = qrotate(fq, h.pole);
      const sol = twoBoneIK(w.pos[iU]!, wristTarget, vlen(vsub(elbow, shoulder)), vlen(vsub(wrist, elbow)), poleW);
      const restSide = vnorm(vcross(vnorm(vsub(wrist, shoulder)), pole0));
      const newSide = vnorm(vcross(vnorm(vsub(sol.end, w.pos[iU]!)), poleW));
      const upW = aimQuat(vnorm(vsub(elbow, shoulder)), restSide, vnorm(vsub(sol.mid, w.pos[iU]!)), newSide);
      const loW = aimQuat(vnorm(vsub(wrist, elbow)), restSide, vnorm(vsub(sol.end, sol.mid)), newSide);
      const parentW = w.rot[sk.parent[iU]!]!;
      c.setQ(`upper_arm_${n}`, qmul(qinv(parentW), upW));
      c.setQ(`forearm_${n}`, qmul(qinv(upW), loW));
      c.setQ(`wrist_${n}`, qmul(qinv(loW), Rh));
    }
  }
}
