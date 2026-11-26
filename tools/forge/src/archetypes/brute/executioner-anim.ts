// Executioner animation set (idle walk run attack attack2 hit death spawn) on the humans clip kit (anim.ts), authored in
// reference metres. The cleaver rides the right shoulder when moving; the two big swings are two-handed: the right hand follows a
// WORLD-space pendulum arc around the chest (`setSwing`: arm angle, wrist cock, radius -> hand, blade axis and edge direction,
// converted to the chest frame of the current torso pose), the left hand is blended onto the handle by `grip2`. Weight comes from
// long anticipation holds, accelerating strikes, heel-strike dips, damped impact settles and secondary motion (apron hem, hood
// tail) driven from the legs.
import { PoseCtx, type ClipSpec } from '../../core/anim/clip.ts';
import { type Ease } from '../../core/anim/curve.ts';
import { type Quat, type Vec3, qinv, qrotate, vcross, vnorm } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type Hand, type Key, type Pose, V, applyPose, evalKeys } from '../humanoid/index.ts';
import {
  type ActionSpec, type AnimEnv, type GaitSpec, actionClip, bump, damped, finalize, gaitClip, gaitSpeedOf, grip, hang, hitClip, idleClip, makeEnv, poseOf, ramp, secondary, spawnClip, stance,
} from '../humans/anim.ts';
import { CLEAVER } from './executioner-cleaver.ts';

const DEG = Math.PI / 180;
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------------------------------------ hands
/** right hand on the cleaver: grip centre g, blade axis b, cutting-edge direction f (all in the chest frame) */
export function cleaverHand(g: Vec3, b: Vec3, f: Vec3, curl = 1): Hand {
  const bn = vnorm(b);
  // the solver wants the back-of-hand direction e; for the right hand the edge is b x e  =>  e = f x b
  const e = vnorm(vcross(vnorm(f), bn));
  return { g, b: bn, e, c: curl };
}

const blendHand = (x: Hand, y: Hand, w: number): Hand => ({ g: lerp3(x.g, y.g, w), b: vnorm(lerp3(x.b, y.b, w)), e: vnorm(lerp3(x.e, y.e, w)), c: x.c + (y.c - x.c) * w });

/** blend the left hand onto the cleaver handle (weight w), in front of the right hand toward the blade */
export function grip2(P: Pose, w: number, dist = CLEAVER.handL): void {
  if (w <= 0) return;
  const rb = vnorm(P.r.b);
  P.l = blendHand(P.l, { g: add3(P.r.g, sc3(rb, dist)), b: rb, e: sc3(P.r.e, -1), c: 1 }, w);
}

// ------------------------------------------------------------------------------------------------ gait specs
/** heavy walk: long deliberate stomping stride */
export const EXEC_WALK: GaitSpec = {
  T: 1.15, duty: 0.64, sweep: 0.8, lift: 0.1, bob: 0.016, lean: 0.06, twist: 0.2, hipYaw: 0.2, roll: 0.07, sway: 0.032, crouch: 0.02, width: 0.55,
  armSwing: 0.13, armHeld: 0.02, stomp: 0.034, headStab: 0.75, reach: 1.0,
};
/** charging stomp-run (3.5 m/s) */
export const EXEC_RUN: GaitSpec = {
  T: 0.66, duty: 0.44, sweep: 0.782, lift: 0.17, bob: 0.03, lean: 0.2, twist: 0.26, hipYaw: 0.26, roll: 0.09, sway: 0.03, crouch: 0.03, width: 0.42,
  armSwing: 0.2, armHeld: 0.03, stomp: 0.045, headStab: 0.65, run: true, reach: 1.0,
};

/** ground speeds (m/s) the two gaits author at body scale s (= extras.speed) */
export const execSpeeds = (s: number): { walk: number; run: number } => ({ walk: Number(gaitSpeedOf(EXEC_WALK, s).toFixed(3)), run: Number(gaitSpeedOf(EXEC_RUN, s).toFixed(3)) });

// ------------------------------------------------------------------------------------------------ poses
// chest frame, reference metres: shoulders at (-/+0.265, 0.17, 0.03); hands rest at (-/+0.3, -0.3, 0.1)
const CARRY_G = V(-0.3, 0.1, 0.27);
const CARRY_B = V(-0.22, 0.84, -0.5);
const CARRY_F = V(-0.64, 0.63, 0.44);

export function execIdlePose(): Pose {
  return poseOf(stance(0.15, 0.1, 0.09), {
    sp: [0.22, 0.06, 0.03], hip: [0, 0.05, 0.03], head: [0.1, 0.0, 0.0],
    r: cleaverHand(CARRY_G, CARRY_B, CARRY_F, 1),
    l: hang('l', 0.8, V(0.31, -0.32, 0.12)),
    poleR: V(-0.7, -0.15, -0.35), poleL: V(0.5, -0.2, -1),
    shr: 0.05, shl: 0.0,
  });
}

// ------------------------------------------------------------------------------------------------ world-space swings
/** chest joint position + rotation (world) for a reference-metre pose */
function chestFrame(env: AnimEnv, P: Pose): { pos: Vec3; q: Quat } {
  const ctx = new PoseCtx(env.sk, 0, 0, 1);
  applyPose(ctx, env.a, finalize(P, env.a.s), env.cfg);
  const w = env.sk.fk(ctx.pose);
  const i = env.sk.idx('chest');
  return { pos: w.pos[i]!, q: w.rot[i]! };
}

export interface SwingO {
  /** 'vert': arm angle in the sagittal plane (0 = up, 90 = forward, 180 = down); 'horiz': yaw around the chest (0 = forward, + = toward the left) */
  mode: 'vert' | 'horiz';
  /** weight of the swing over the keyed carry pose (0..1) */
  m: number;
  /** arm angle (rad) */
  ang: number;
  /** extra blade rotation relative to the arm direction (wrist cock; rad) */
  cock: number;
  /** hand distance from the pivot (ref m) */
  radius: number;
  /** horizontal swings: how far the hands hang below the pivot (ref m) */
  drop?: number;
  /** pivot in the chest frame (ref m) */
  pivot?: Vec3;
  /** horizontal swings: vertical component of the blade axis (positive = tip up; default -0.08) */
  tilt?: number;
  /** roll of the edge about the blade axis (rad) */
  roll?: number;
}

/** put the right hand on a world-space pendulum arc around the chest (the torso pose in P decides where the chest is) */
export function setSwing(env: AnimEnv, P: Pose, o: SwingO): void {
  if (o.m <= 0) return;
  const s = env.a.s;
  const { pos, q } = chestFrame(env, P);
  const pv = o.pivot ?? V(-0.1, 0.17, 0.03);
  const pivotW = add3(pos, qrotate(q, sc3(pv, s)));
  let arm: Vec3, bl: Vec3, ed: Vec3;
  if (o.mode === 'vert') {
    const ab = o.ang + o.cock;
    arm = V(0, Math.cos(o.ang), Math.sin(o.ang));
    bl = V(0, Math.cos(ab), Math.sin(ab));
    ed = V(0, -Math.sin(ab), Math.cos(ab));
  } else {
    const ab = o.ang + o.cock;
    arm = V(Math.sin(o.ang), 0, Math.cos(o.ang));
    bl = V(Math.sin(ab), o.tilt ?? -0.08, Math.cos(ab));
    ed = V(Math.cos(ab), 0, -Math.sin(ab));
  }
  if (o.roll) {
    // Rodrigues about the blade axis: the edge swings toward blade x edge
    const bn = vnorm(bl);
    const cr = vcross(bn, ed);
    const c = Math.cos(o.roll), sn = Math.sin(o.roll);
    ed = V(ed[0] * c + cr[0] * sn, ed[1] * c + cr[1] * sn, ed[2] * c + cr[2] * sn);
  }
  const handW = add3(pivotW, add3(sc3(arm, o.radius * s), V(0, -(o.drop ?? 0) * s, 0)));
  const qi = qinv(q);
  const target = cleaverHand(sc3(qrotate(qi, [handW[0] - pos[0], handW[1] - pos[1], handW[2] - pos[2]]), 1 / s), qrotate(qi, bl), qrotate(qi, ed), 1);
  P.r = blendHand(P.r, target, Math.min(Math.max(o.m, 0), 1));
}

/** piecewise value curve [t, v, ease?]; the ease belongs to the segment ending at that key (as in Key.ease) */
type K = [number, number, Ease?];
function curve(t: number, keys: K[]): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i]![0]) {
      const k0 = keys[i - 1]!, k1 = keys[i]!;
      return k0[1] + (k1[1] - k0[1]) * ramp(t, k0[0], k1[0], k1[2] ?? 'smooth');
    }
  }
  return keys[keys.length - 1]![1];
}

// ------------------------------------------------------------------------------------------------ secondary motion
function thighPitch(c: PoseCtx, n: 'l' | 'r'): number {
  const q = c.pose.rot[c.skel.idx(`thigh_${n}`)]!;
  const d = qrotate(q, [0, -1, 0]);
  return Math.atan2(d[2], -d[1]);
}

/** the stiff apron hem is pushed forward by the swinging thighs and lags behind in the run; the other skirt bones follow default secondary motion */
function drive(c: PoseCtx, clip: string, t: number, _phase: number, speed: number): void {
  if (!c.skel.has('skirt_f')) return;
  const fl = thighPitch(c, 'l'), fr = thighPitch(c, 'r');
  const fwd = Math.max(fl, fr, 0), back = Math.max(-fl, -fr, 0);
  const sway = 0.03 * Math.sin(t * 2.1);
  c.set('skirt_f', -(0.92 * fwd) + 0.1 * back + 0.06 * speed + sway, 0, 0);
  c.set('skirt_b', 0.55 * back - 0.25 * fwd + 0.05 * speed, 0, 0);
  void clip;
}

// ------------------------------------------------------------------------------------------------ the set
export interface ExecAnim {
  env: AnimEnv;
  idle: Pose;
  clips: ClipSpec[];
  specs: Record<string, ActionSpec>;
}

export function buildExecAnim(a: Anatomy, sk: Skeleton): ExecAnim {
  const idle = execIdlePose();
  const env = makeEnv(a, sk, idle, {}, { flow: 0.8, extra: drive });

  // ---- attack: overhead cleave, hit 0.7 = enemy windup. Body keys; the arm arc is added in the tweak.
  const attackKeys: Key[] = [
    { t: 0, p: {} },
    // dip: sink into the legs (anticipation of the anticipation)
    { t: 0.14, ease: 'out', p: { root: V(0, -0.1, 0), sp: [0.34, 0.08, 0.04], head: [0.2, 0, 0], fl: V(0.17, 0, 0.1), fr: V(-0.17, 0, -0.14) } },
    // heave up: chest arches back, weight on the rear leg, shoulders lift
    { t: 0.4, ease: 'smooth', p: { root: V(0, -0.04, -0.06), sp: [-0.34, -0.04, 0.02], hip: [-0.1, 0, 0], head: [-0.15, 0, 0], fl: V(0.17, 0, 0.1), fr: V(-0.17, 0, -0.3), shr: 0.12, shl: 0.12 } },
    // hold at the top
    { t: 0.56, ease: 'smooth', p: { root: V(0, -0.02, -0.07), sp: [-0.4, -0.02, 0.02], head: [-0.2, 0, 0] } },
    // CHOP: the whole body falls into the strike
    { t: 0.7, ease: 'in', p: { root: V(0, -0.24, 0.2), sp: [0.5, 0.0, 0.0], hip: [0.14, 0, 0], head: [0.2, 0, 0], fl: V(0.17, 0, 0.62), fr: V(-0.17, 0, -0.26), shr: 0.0, shl: 0.0 } },
    { t: 0.86, ease: 'out', p: { root: V(0, -0.22, 0.2), sp: [0.46, 0, 0] } },
    { t: 1.2, ease: 'smooth', p: { root: V(0, -0.12, 0.05), sp: [0.36, 0.05, 0.02], hip: [0.08, 0.0, 0.0], head: [0.12, 0, 0], fl: V(0.15, 0, 0.3), fr: V(-0.15, 0, -0.2) } },
    { t: 1.6, ease: 'smooth', p: { ...idle } },
  ];
  const ATTACK_ANG: K[] = [[0, 106 * DEG], [0.14, 100 * DEG], [0.4, 24 * DEG], [0.56, 18 * DEG], [0.7, 122 * DEG, 'in'], [0.86, 122 * DEG], [1.2, 70 * DEG], [1.6, 106 * DEG]];
  const ATTACK_COCK: K[] = [[0, -157 * DEG], [0.14, -150 * DEG], [0.4, -34 * DEG], [0.56, -42 * DEG], [0.7, 6 * DEG, 'in'], [0.86, 6 * DEG], [1.2, -90 * DEG], [1.6, -157 * DEG]];
  const ATTACK_R: K[] = [[0, 0.31], [0.14, 0.3], [0.4, 0.45], [0.56, 0.46], [0.7, 0.43, 'in'], [0.86, 0.43], [1.2, 0.4], [1.6, 0.31]];
  const attack: ActionSpec = {
    name: 'attack', dur: 1.6, hit: 0.7, keys: attackKeys, flow: 0.7,
    tweak: (P, t) => {
      const m = bump(t, 0.1, 0.3, 1.3, 1.58, 'smooth');
      setSwing(env, P, { mode: 'vert', m, ang: curve(t, ATTACK_ANG), cock: curve(t, ATTACK_COCK), radius: curve(t, ATTACK_R) });
      // left hand joins the handle for the whole swing (grabs while the arms rise, lets go in the recovery)
      grip2(P, bump(t, 0.1, 0.34, 1.0, 1.36, 'smooth'), 0.12);
      // blade-weight shudder on the hold and a damped bounce after the impact
      const hold = bump(t, 0.4, 0.46, 0.6, 0.68, 'smooth');
      P.r.g = add3(P.r.g, [0.006 * Math.sin(t * 55) * hold, 0.012 * Math.sin(t * 41) * hold, 0]);
      const hit = t >= 0.7 ? damped(t - 0.7, 3.4, 6.5) : 0;
      P.root = add3(P.root, [0, 0.03 * hit, 0]);
      P.sp = [P.sp[0] - 0.05 * hit, P.sp[1], P.sp[2]];
    },
  };

  // ---- attack2: wide horizontal sweep, hit 0.8
  const attack2Keys: Key[] = [
    { t: 0, p: {} },
    { t: 0.14, ease: 'out', p: { root: V(0, -0.1, 0), sp: [0.3, -0.35, 0.05], hip: [0, -0.2, 0], head: [0.15, 0.2, 0] } },
    // coil: torso wound far to the right, weight on the rear leg
    { t: 0.46, ease: 'smooth', p: { root: V(0, -0.17, -0.06), sp: [0.3, -0.85, 0.1], hip: [0, -0.5, 0], head: [0.0, 0.8, 0], fl: V(0.2, 0, 0.14), fr: V(-0.2, 0, -0.32), shr: 0.1 } },
    { t: 0.62, ease: 'smooth', p: { sp: [0.34, -0.92, 0.1], hip: [0, -0.56, 0] } },
    // SWEEP: hips lead, the torso unwinds through the front, long step with the left foot
    { t: 0.8, ease: 'in', p: { root: V(0, -0.2, 0.1), sp: [0.38, 0.1, 0.0], hip: [0, 0.25, 0.0], head: [0.05, -0.15, 0], fl: V(0.2, 0, 0.5), fr: V(-0.2, 0, -0.22), shr: 0.0 } },
    // follow-through: the cleaver drags the body round
    { t: 0.98, ease: 'out', p: { sp: [0.36, 0.6, -0.05], hip: [0, 0.45, 0.0], head: [0.05, -0.5, 0] } },
    { t: 1.35, ease: 'smooth', p: { root: V(0, -0.1, 0.05), sp: [0.3, 0.2, 0.02], hip: [0, 0.2, 0], head: [0.1, 0, 0] } },
    { t: 1.7, ease: 'smooth', p: { ...idle } },
  ];
  const A2_ANG: K[] = [[0, 0], [0.14, 0], [0.46, -62 * DEG], [0.62, -68 * DEG], [0.8, 8 * DEG, 'in'], [0.98, 70 * DEG, 'out'], [1.35, 64 * DEG], [1.7, 0]];
  const A2_COCK: K[] = [[0, 0], [0.46, -58 * DEG], [0.62, -62 * DEG], [0.8, 2 * DEG], [0.98, 6 * DEG], [1.7, 0]];
  const A2_R: K[] = [[0, 0.3], [0.14, 0.3], [0.46, 0.2], [0.62, 0.2], [0.8, 0.34, 'in'], [0.98, 0.38], [1.35, 0.36], [1.7, 0.3]];
  // height of the hands under the chest pivot (ref m) and blade tilt: the coil holds the cleaver raised behind the body so the wind-up reads from above
  const A2_DROP: K[] = [[0, 0.3], [0.14, 0.2], [0.46, -0.04], [0.62, -0.07], [0.8, 0.2, 'in'], [0.98, 0.3], [1.35, 0.26], [1.7, 0.3]];
  const A2_TILT: K[] = [[0, -0.08], [0.46, 0.4], [0.62, 0.46], [0.8, -0.08], [1.7, -0.08]];
  const attack2: ActionSpec = {
    name: 'attack2', dur: 1.7, hit: 0.8, keys: attack2Keys, flow: 0.7,
    tweak: (P, t) => {
      const m = bump(t, 0.1, 0.3, 1.3, 1.68, 'smooth');
      setSwing(env, P, { mode: 'horiz', m, ang: curve(t, A2_ANG), cock: curve(t, A2_COCK), radius: curve(t, A2_R), drop: curve(t, A2_DROP), tilt: curve(t, A2_TILT), pivot: V(-0.05, 0.17, 0.03) });
      grip2(P, bump(t, 0.1, 0.36, 1.05, 1.4, 'smooth'), 0.12);
      const hit = t >= 0.8 ? damped(t - 0.8, 3.0, 6) : 0;
      P.sp = [P.sp[0], P.sp[1] - 0.05 * hit, P.sp[2]];
    },
  };

  const specs = { attack, attack2 };
  const clips: ClipSpec[] = [
    idleClip(env, { dur: 3.2, breath: 0.03, shift: 0.012, look: 0.1 }),
    gaitClip(env, 'walk', EXEC_WALK),
    gaitClip(env, 'run', EXEC_RUN),
    actionClip(env, attack),
    actionClip(env, attack2),
    hitClip(env, { dur: 0.55, recoil: -0.22, twist: 0.16, drop: 0.045, shove: 0.08, arms: 0.5 }),
    execDeath(env, idle),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.5, 0), sp: [0.7, 0, 0], head: [0.4, 0, 0], r: cleaverHand(V(-0.3, -0.35, 0.45), V(0.05, -0.85, 0.5), V(0, -0.5, 0.85), 1) } },
      { t: 0.7, ease: 'smooth', p: { root: V(0, -0.28, 0), sp: [0.5, 0.1, 0], head: [0.25, 0, 0] } },
      { t: 1.25, ease: 'out', p: { ...idle, root: V(0, 0.02, 0), sp: [-0.08, 0.06, 0], head: [-0.15, 0, 0], shr: 0.1 } },
      { t: 1.7, ease: 'smooth', p: { ...idle } },
    ], 1.7),
  ];
  return { env, idle, clips, specs };
}

/** death: the hit wrenches the cleaver up and throws the chest back, the knees give under the weight, then the hulk topples backwards like a
 *  felled tree (accelerating fall, hard slam, damped bounce) and lies sprawled with the cleaver dropped along his right side */
function execDeath(env: AnimEnv, idle: Pose): ClipSpec {
  const DUR = 2.7;
  const keys: Key[] = [
    { t: 0, p: {} },
    // hit snap: head and chest thrown back, cleaver wrenched up over the shoulder, one stumbling step back
    { t: 0.22, ease: 'out', p: { sp: [-0.45, 0.28, 0.12], head: [-0.5, 0.2, 0.1], root: V(0, -0.04, -0.12), fl: V(0.17, 0, 0.0), fr: V(-0.17, 0, -0.3), shr: 0.15, shl: 0.1,
      r: cleaverHand(V(-0.45, 0.38, -0.02), V(-0.2, 0.7, -0.7), V(0, 0.7, 0.7), 0.7), l: hang('l', 0.2, V(0.58, 0.1, -0.1)) } },
    // the legs give: weight sinks, the arm drops under the cleaver's weight
    { t: 0.85, ease: 'smooth', p: { sp: [0.12, 0.1, 0.06], head: [0.1, 0.2, 0.05], root: V(0, -0.46, -0.2), fl: V(0.2, 0, 0.1), fr: V(-0.2, 0, -0.3), shr: 0, shl: 0,
      r: cleaverHand(V(-0.3, 0.0, 0.2), V(-0.12, -0.2, 0.97), V(0, -0.97, -0.2), 0.8), l: hang('l', 0.3, V(0.4, -0.3, 0.05)) } },
    // topple back (accelerating), arms flung out
    { t: 1.45, ease: 'in', p: { rootRot: [-1.45, 0, 0.12], root: V(0, 0.0, -0.1), sp: [-0.1, 0, 0], head: [-0.25, 0.3, 0.1], fl: V(0.2, 0.0, -0.1), fr: V(-0.2, 0, -0.2),
      r: cleaverHand(V(-0.55, 0.05, 0.05), V(-0.12, -0.95, 0.1), V(-1, 0, 0.1), 0.6), l: grip(V(0.66, 0.2, 0.0), V(0.8, 0.5, 0.1), V(-0.2, 0, 1), 0.3) } },
    // impact: the body settles, the cleaver clatters flat
    { t: 1.66, ease: 'out', p: { rootRot: [-1.5, 0, 0.12], root: V(0, 0.0, -0.12), sp: [-0.06, 0, 0], head: [-0.15, 0.45, 0.14], fl: V(0.22, 0.2, -0.38), fr: V(-0.2, 0, -0.22),
      r: cleaverHand(V(-0.62, -0.02, 0.06), V(-0.1, -0.97, 0.0), V(-1, 0, 0.0), 0.5), l: grip(V(0.7, 0.22, 0.0), V(0.9, 0.35, 0.0), V(-0.2, 0, 1), 0.25) } },
    { t: DUR, ease: 'smooth', p: { rootRot: [-1.5, 0, 0.12], root: V(0, 0.0, -0.12), sp: [-0.04, 0, 0], head: [-0.1, 0.5, 0.16], fl: V(0.22, 0.22, -0.4), fr: V(-0.2, 0, -0.22),
      r: cleaverHand(V(-0.62, -0.02, 0.06), V(-0.1, -0.97, 0.0), V(-1, 0, 0.0), 0.4), l: grip(V(0.72, 0.22, 0.0), V(0.9, 0.35, 0.0), V(-0.2, 0, 1), 0.2) } },
  ];
  return {
    name: 'death', duration: DUR, loop: false,
    pose: (c) => {
      const t = c.t;
      const P = evalKeys(idle, keys, t);
      // ground impact: a small damped bounce of the whole body, the limbs flop with it
      const b = t > 1.5 ? damped(t - 1.5, 2.6, 9) : 0;
      P.root = add3(P.root, [0, 0.035 * b, 0]);
      P.fl = add3(P.fl, [0, 0.05 * b, 0]);
      applyPose(c, env.a, finalize(P, env.a.s), env.cfg);
      const k1 = ramp(t, 0, 0.22, 'out') * (1 - ramp(t, 0.22, 0.7, 'smooth'));
      secondary(env, c, t, t, 0.3, -0.5 * k1, 0);
      env.extra?.(c, 'death', t, t, 0.3);
    },
  };
}
