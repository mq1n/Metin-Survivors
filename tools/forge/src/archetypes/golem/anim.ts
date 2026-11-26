// Golem clips on the GolemRig pose solver. Heavy, weighty motion: stompy planted-foot gait (heel-strike root drops, sway, shoulder
// roll, fists that lag the legs), held wind-ups with fast strikes and damped settles, knees that buckle, slabs that shrink and sink.
// Roster clips: idle walk run attack hit death spawn attack2 special1. Locomotion is in place; the stance foot slides back at the
// authored ground speed (stride / stance time) so nothing skates. `hit` marks the damaging contact of attack-like clips.
import type { ClipSpec } from '../../core/anim/clip.ts';
import { type Ease, damped, keyed, ramp } from '../../core/anim/curve.ts';
import { type Vec3, vadd, vnorm } from '../../core/math.ts';
import { type E3, type Fist, type GPose, type GolemRig, blendPose, clonePose } from './rig.ts';

const TAU = Math.PI * 2;

/** impact settle: 0 before t0, then a damped cosine starting at 1 (f Hz, decay k) */
const recoil = (t: number, t0: number, f = 3.2, k = 9): number => (t < t0 ? 0 : damped(t - t0, f, k));
/** one-sided kick: 0 before t0, jumps to 1, decays like exp(-k dt) */
const kick = (t: number, t0: number, k = 12): number => (t < t0 ? 0 : Math.exp(-k * (t - t0)));

// ------------------------------------------------------------------------------------------------ gait

export interface Gait {
  /** cycle seconds */
  T: number;
  /** stance fraction of the cycle */
  duty: number;
  /** foot travel during one stance as a fraction of the straight leg length */
  sweep: number;
  /** swing-foot lift height (fraction of leg length) */
  lift: number;
  /** root dip at every heel strike (metres), fast attack / slow release */
  stomp: number;
  /** extra up/down bob (metres) */
  bob: number;
  /** pelvis lateral shift toward the stance foot (metres) */
  sway: number;
  /** forward torso lean (rad) */
  lean: number;
  /** pelvis yaw amplitude (rad) */
  twist: number;
  /** shoulder yaw counter-rotation (rad) */
  roll: number;
  /** pelvis roll (rad) */
  pelvisRoll: number;
  /** fist fore/aft swing (metres) */
  armSwing: number;
  /** arm lag behind the legs (fraction of a cycle) */
  armLag: number;
  run?: boolean;
}

interface Foot {
  z: number;
  y: number;
  pitch: number;
}

function footAt(g: Gait, ph: number): Foot {
  const f = ph - Math.floor(ph);
  if (f < g.duty) {
    const u = f / g.duty;
    const heel = u > 0.6 ? ramp(u, 0.6, 1, 'smooth') : 0;
    const strike = u < 0.12 ? (0.12 - u) / 0.12 : 0;
    return { z: g.sweep * 0.5 - g.sweep * u, y: 0, pitch: heel * (g.run ? 0.5 : 0.32) - strike * 0.2 };
  }
  const u = (f - g.duty) / (1 - g.duty);
  const e = u * u * (3 - 2 * u);
  return {
    z: -g.sweep * 0.5 + g.sweep * (g.run ? e * 0.7 + u * 0.3 : e),
    y: g.lift * Math.sin(Math.PI * Math.pow(u, 0.85)),
    pitch: keyed(u, [[0, 0.7], [0.25, 0.25], [0.6, -0.15], [1, -0.3]], 'smooth'),
  };
}

/** heel-strike dip envelope for a foot at cycle phase ph: sharp drop at strike (f = 0), slow release */
function stompPulse(ph: number): number {
  const f = ph - Math.floor(ph);
  if (f < 0.5) return Math.exp(-f / 0.1);
  return f > 0.93 ? ramp(f, 0.93, 1, 'in') : 0;
}

/** authored ground speed (m/s) of a gait: stance travel / stance time */
export const gaitSpeed = (rig: GolemRig, g: Gait): number => (g.sweep * rig.legLen) / (g.duty * g.T);

function gaitPose(rig: GolemRig, idle: GPose, g: Gait, u: number): GPose {
  const P = clonePose(idle);
  const L = rig.legLen;
  const fl = footAt(g, u), fr = footAt(g, u + 0.5);
  P.fl = [0, fl.y * L, fl.z * L];
  P.fr = [0, fr.y * L, fr.z * L];
  P.fpl = fl.pitch;
  P.fpr = fr.pitch;
  // body height from leg reach: both ankles must stay within 98.5 % of the leg length of their hip
  const Lm = L * 0.985;
  const hipEff = rig.hipH + idle.root[1];
  // the ankle target of a heel-up foot sits above / ahead of the planted ball (same offsets as GolemRig.apply)
  const need = (f: Foot): number => {
    const [dy, dz] = rig.ankleLift(f.pitch);
    return Math.max(0, hipEff - (f.y * L + dy) - Math.sqrt(Math.max(Lm * Lm - (f.z * L + dz) ** 2, 0.01)));
  };
  const mid = g.duty / 2;
  const bobTerm = g.bob * 0.5 * (Math.cos(TAU * 2 * (u - mid)) - 1);
  const dip = g.stomp * Math.max(stompPulse(u), stompPulse(u + 0.5));
  P.root = [idle.root[0], idle.root[1] - Math.max(need(fl), need(fr)) + bobTerm - dip, idle.root[2]];
  // weight shift: sway toward the stance foot, torso counter-rolls, pelvis drops on the swing side
  const stanceSig = Math.sin(TAU * (u + 0.25 - mid));
  P.hipMove = [idle.hipMove[0] + g.sway * stanceSig, idle.hipMove[1], idle.hipMove[2]];
  const d = (fl.z - fr.z) / g.sweep; // +1: left foot far ahead
  const dLag = (footAt(g, u - g.armLag).z - footAt(g, u - g.armLag + 0.5).z) / g.sweep;
  const dipN = dip / Math.max(g.stomp, 1e-3);
  P.hip = [idle.hip[0], idle.hip[1] - g.twist * d, idle.hip[2] + g.pelvisRoll * stanceSig];
  P.sp = [idle.sp[0] + g.lean + 0.1 * dipN, idle.sp[1] + g.roll * d, idle.sp[2] - 0.7 * g.pelvisRoll * stanceSig];
  P.head = [idle.head[0] - 0.55 * g.lean + 0.2 * dipN, idle.head[1] - 0.25 * g.roll * dLag, idle.head[2]];
  // fists swing opposite to the legs, lagging; every stomp jolts them down; shoulders shrug on the strike
  const sw = g.armSwing;
  P.r = { ...P.r, g: [P.r.g[0], P.r.g[1] - 0.12 * dipN, P.r.g[2] + sw * dLag] };
  P.l = { ...P.l, g: [P.l.g[0], P.l.g[1] - 0.12 * dipN, P.l.g[2] - sw * dLag] };
  P.shr = idle.shr + 0.08 * dipN;
  P.shl = idle.shl + 0.08 * dipN;
  P.core = idle.core * (1 + 0.1 * dipN);
  return P;
}

// ------------------------------------------------------------------------------------------------ keyed actions

interface Key {
  t: number;
  p: GPose;
  /** easing of the segment arriving at this key */
  e?: Ease;
}

function evalKeys(keys: readonly Key[], t: number): GPose {
  const first = keys[0]!;
  if (t <= first.t) return first.p;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!, b = keys[i + 1]!;
    if (t <= b.t) return blendPose(a.p, b.p, ramp(t, a.t, b.t, b.e ?? 'smooth'));
  }
  return keys[keys.length - 1]!.p;
}

export interface GolemStyle {
  /** body height (m): fist targets are authored in fractions of it */
  H: number;
  walk: Gait;
  run: Gait;
  /** idle root drop (bent knees, metres) */
  crouch: number;
  /** forward torso pitch of the idle stance (rad) */
  hunch: number;
  /** idle/locomotion fist carry relative to the hanging rest pose (x outward, y up, z forward; metres): arms flexed so the fists stay off the ground */
  carry: { x: number; y: number; z: number };
  /** ground blow: palm target (x offset from the midline, y, z ahead of the root; the fist bottom touches the ground), root drop and torso pitch at impact */
  slam: { x: number; y: number; z: number; drop: number; pitch: number };
  /** clip lengths / hit times (s) */
  attack: { dur: number; hit: number };
  attack2: { dur: number; hit: number };
  special1: { dur: number; hit: number };
  death: number;
  spawn: number;
  hit: number;
}

interface Anim {
  clips: ClipSpec[];
  /** authored ground speeds for `extras.speed` */
  speed: { walk: number; run: number };
}

export function golemClips(rig: GolemRig, st: GolemStyle, variant: 'ice' | 'fire'): Anim {
  const rest = rig.rest();
  const chest = rig.restPos('chest');
  const H = st.H;
  const k = H / 3;
  const pos = (n: 'l' | 'r', x: number, y: number, z: number): Vec3 => [n === 'l' ? x : -x, y, z];

  const base = clonePose(rest);
  base.root = [0, -st.crouch, 0];
  base.sp = [st.hunch, 0, 0];
  base.head = [-0.6 * st.hunch, 0, 0];
  base.l = { ...rest.l, g: vadd(rest.l.g, pos('l', st.carry.x, st.carry.y, st.carry.z)) };
  base.r = { ...rest.r, g: vadd(rest.r.g, pos('r', st.carry.x, st.carry.y, st.carry.z)) };

  /** root-frame fist (planted blows, raises): position, fingertip dir, grip axis */
  const fistW = (n: 'l' | 'r', at: Vec3, down: Vec3 = [0, -1, 0], fwd: Vec3 = [0, 0, 1]): Fist => ({ g: at, f: vnorm(down), b: vnorm(fwd), pole: rest[n].pole, w: true });
  const hand0 = { l: vadd(chest, base.l.g), r: vadd(chest, base.r.g) };
  /** a copy of `p` with both fists in the root frame at the given positions */
  const withFists = (p: GPose, l: Fist, r: Fist): GPose => ({ ...clonePose(p), l, r });
  const rootBase = withFists(base, fistW('l', hand0.l), fistW('r', hand0.r));
  const patch = (p: GPose, o: Partial<Pick<GPose, 'root' | 'rootRot' | 'hip' | 'hipMove' | 'sp' | 'head' | 'fl' | 'fr' | 'shr' | 'shl' | 'core'>>): GPose => ({ ...clonePose(p), ...o });
  const e3 = (a: number, b: number, c: number): E3 => [a, b, c];

  // ---------------------------------------------------------------- idle: slow breathing, weight shift, core pulse
  const idle: ClipSpec = {
    name: 'idle', duration: 3.2, loop: true,
    pose: (c) => {
      const u = c.u;
      const br = Math.sin(TAU * u);
      const P = clonePose(base);
      P.sp = [base.sp[0] + 0.022 * br, base.sp[1] + 0.03 * Math.sin(TAU * u * 2 + 1), base.sp[2] + 0.016 * Math.sin(TAU * u)];
      P.head = [base.head[0] - 0.02 * br, base.head[1] + 0.07 * Math.sin(TAU * u + 0.6), base.head[2]];
      P.hip = [base.hip[0], base.hip[1], base.hip[2] + 0.02 * Math.sin(TAU * u)];
      P.hipMove = [base.hipMove[0] + 0.014 * Math.sin(TAU * u), base.hipMove[1], base.hipMove[2]];
      P.root = [base.root[0], base.root[1] + 0.012 * (br - 1), base.root[2]];
      P.r = { ...P.r, g: [P.r.g[0], P.r.g[1] + 0.014 * Math.sin(TAU * u - 0.9), P.r.g[2]] };
      P.l = { ...P.l, g: [P.l.g[0], P.l.g[1] + 0.014 * Math.sin(TAU * u - 1.3), P.l.g[2]] };
      P.shr = 0.04 * br;
      P.shl = 0.04 * br;
      P.core = 1 + 0.07 * (0.5 + 0.5 * Math.sin(TAU * u * 2 - 1.2));
      rig.apply(c, P);
    },
  };

  const loco = (name: 'walk' | 'run', g: Gait): ClipSpec => ({
    name, duration: g.T, loop: true,
    pose: (c) => rig.apply(c, gaitPose(rig, base, g, c.u)),
  });

  // ---------------------------------------------------------------- attack: held overhead wind-up, fast double-fist slam, damped settle
  const aA = st.attack;
  const slamL = pos('l', st.slam.x, st.slam.y, st.slam.z);
  const overL = pos('l', 0.2 * H, 0.9 * H, 0.0);
  const gatherL = pos('l', 0.3 * H, 0.31 * H, 0.1 * H);
  const kAttack: Key[] = [
    { t: 0, p: rootBase },
    { t: aA.hit * 0.28, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.1 * k, -0.03 * k), sp: e3(-0.1, 0, 0), head: e3(0.05, 0, 0) }), fistW('l', gatherL), fistW('r', pos('r', gatherL[0], gatherL[1], gatherL[2]))), e: 'smooth' },
    { t: aA.hit * 0.8, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.02 * k, -0.06 * k), sp: e3(-0.34, 0, 0), head: e3(-0.34, 0, 0), shl: 0.12, shr: 0.12, core: 1.2 }), fistW('l', overL, [0, -0.4, 1]), fistW('r', pos('r', overL[0], overL[1], overL[2]), [0, -0.4, 1])), e: 'smooth' },
    { t: aA.hit * 0.94, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.02 * k, -0.07 * k), sp: e3(-0.4, 0, 0), head: e3(-0.38, 0, 0), shl: 0.14, shr: 0.14, core: 1.28 }), fistW('l', pos('l', overL[0], overL[1] + 0.06 * k, overL[2] - 0.04), [0, -0.4, 1]), fistW('r', pos('r', overL[0], overL[1] + 0.06 * k, overL[2] - 0.04), [0, -0.4, 1])), e: 'linear' },
    { t: aA.hit, p: withFists(patch(base, { root: e3(0, -st.crouch - st.slam.drop, 0.1 * k), sp: e3(st.slam.pitch, 0, 0), head: e3(0.3, 0, 0), core: 1.0 }), fistW('l', slamL, [0, -0.3, 1], [0, -1, 0.2]), fistW('r', pos('r', slamL[0], slamL[1], slamL[2]), [0, -0.3, 1], [0, -1, 0.2])), e: 'in' },
    { t: aA.hit + 0.42, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.6 * st.slam.drop, 0.04 * k), sp: e3(0.75 * st.slam.pitch, 0, 0), head: e3(0.15, 0, 0) }), fistW('l', pos('l', slamL[0], slamL[1] + 0.02, slamL[2] - 0.05)), fistW('r', pos('r', slamL[0], slamL[1] + 0.02, slamL[2] - 0.05))), e: 'out' },
    { t: aA.dur, p: rootBase, e: 'smooth' },
  ];
  const attack: ClipSpec = {
    name: 'attack', duration: aA.dur, loop: false, hit: aA.hit,
    pose: (c) => {
      const P = evalKeys(kAttack, c.t);
      const imp = kick(c.t, aA.hit, 10);
      const ring = recoil(c.t, aA.hit, 3.4, 7);
      P.root = [P.root[0], P.root[1] - 0.06 * k * imp + 0.03 * k * ring, P.root[2]];
      P.sp = [P.sp[0] + 0.05 * ring, P.sp[1], P.sp[2]];
      P.shl += 0.08 * imp;
      P.shr += 0.08 * imp;
      P.core = Math.max(P.core, 1 + 0.9 * imp);
      rig.apply(c, P);
    },
  };

  // ---------------------------------------------------------------- attack2: wind-up twist to one side, fast sweeping backhand across the front, follow-through
  const aB = st.attack2;
  const sweepStart = pos('r', 0.32 * H, 0.62 * H, -0.04 * H);
  const sweepMid = pos('r', -0.18 * H, 0.5 * H, 0.38 * H);
  const sweepEnd = pos('r', -0.62 * H, 0.46 * H, 0.2 * H);
  const rightFirst = (p: GPose, f: Fist): GPose => ({ ...clonePose(p), r: f });
  const kSweep: Key[] = [
    { t: 0, p: rootBase },
    { t: aB.hit * 0.45, p: rightFirst(patch(rootBase, { root: e3(0, -st.crouch - 0.06 * k, -0.04 * k), hip: e3(0, -0.28, 0), sp: e3(0.04, -0.6, 0.05), head: e3(0, 0.3, 0), shr: -0.1 }), fistW('r', pos('r', 0.34 * H, 0.55 * H, -0.02 * H), [0, -1, 0.3], [0.3, 0, 1])), e: 'smooth' },
    { t: aB.hit * 0.92, p: rightFirst(patch(rootBase, { root: e3(0, -st.crouch - 0.08 * k, -0.07 * k), hip: e3(0, -0.4, 0), sp: e3(0.02, -0.86, 0.08), head: e3(0, 0.45, 0), shr: -0.18, core: 1.2 }), fistW('r', sweepStart, [0, -1, 0.3], [0.5, 0, 1])), e: 'smooth' },
    { t: aB.hit, p: rightFirst(patch(rootBase, { root: e3(0, -st.crouch - 0.1 * k, 0.04 * k), hip: e3(0, 0.12, 0), sp: e3(0.12, 0.2, -0.02), head: e3(0.05, -0.1, 0), shr: 0.1, core: 1.0 }), fistW('r', sweepMid, [0, -1, 0.2], [-0.6, 0, 1])), e: 'in' },
    { t: aB.hit + 0.2, p: rightFirst(patch(rootBase, { root: e3(0, -st.crouch - 0.06 * k, 0.02 * k), hip: e3(0, 0.34, 0), sp: e3(0.1, 0.55, -0.05), head: e3(0.05, -0.3, 0), shr: 0.12 }), fistW('r', sweepEnd, [0, -1, 0.2], [-1, 0, 0.6])), e: 'out' },
    { t: aB.dur, p: rootBase, e: 'smooth' },
  ];
  const attack2: ClipSpec = {
    name: 'attack2', duration: aB.dur, loop: false, hit: aB.hit,
    pose: (c) => {
      const P = evalKeys(kSweep, c.t);
      const ring = recoil(c.t, aB.hit + 0.2, 3.2, 7);
      P.sp = [P.sp[0] + 0.04 * ring, P.sp[1] + 0.12 * ring, P.sp[2]];
      P.core = Math.max(P.core, 1 + 0.5 * kick(c.t, aB.hit, 9));
      rig.apply(c, P);
    },
  };

  // ---------------------------------------------------------------- hit: flinch with weight, damped overshoot, core flare
  const hitClip: ClipSpec = {
    name: 'hit', duration: st.hit, loop: false,
    pose: (c) => {
      const t = c.t;
      const snap = ramp(t, 0, 0.08, 'out');
      const rec = ramp(t, 0.08, st.hit, 'smooth');
      const w = snap * (1 - rec);
      const ring = recoil(t, 0.08, 4.2, 8) * 0.25;
      const P = clonePose(base);
      P.sp = [base.sp[0] - 0.3 * w - 0.1 * ring, base.sp[1] + 0.16 * w, base.sp[2] + 0.1 * w];
      P.head = [base.head[0] - 0.4 * w - 0.12 * ring, base.head[1] + 0.12 * w, 0];
      P.hip = [base.hip[0] - 0.1 * w, base.hip[1], base.hip[2]];
      P.root = [0, base.root[1] - 0.05 * k * w, -0.1 * k * w];
      P.r = { ...P.r, g: [P.r.g[0] - 0.06 * w, P.r.g[1] + 0.1 * w, P.r.g[2] + 0.12 * w] };
      P.l = { ...P.l, g: [P.l.g[0] + 0.06 * w, P.l.g[1] + 0.1 * w, P.l.g[2] + 0.12 * w] };
      P.shr = 0.1 * w;
      P.shl = 0.1 * w;
      P.core = 1 + 0.35 * kick(t, 0.02, 9);
      rig.apply(c, P);
    },
  };

  // ---------------------------------------------------------------- death: reel, knees buckle, slump forward, then the slabs shrink and sink
  const D = st.death;
  const death: ClipSpec = {
    name: 'death', duration: D, loop: false,
    pose: (c) => {
      const t = c.t;
      const reel = ramp(t, 0, 0.3, 'out');
      const sag = ramp(t, 0.25, 1.15, 'in');
      const slump = ramp(t, 1.0, 1.7, 'in');
      const sink = ramp(t, 1.55, D, 'in');
      const slam = recoil(t, 1.15, 4.2, 6) * 0.08 * ramp(t, 1.15, 1.2, 'linear');
      const P = clonePose(base);
      P.sp = [base.sp[0] - 0.3 * reel + 0.3 * sag + 0.35 * slump + slam, base.sp[1] + 0.2 * reel, base.sp[2] + 0.1 * reel];
      P.head = [base.head[0] - 0.3 * reel + 0.2 * sag + 0.45 * slump, base.head[1] + 0.2 * reel, 0];
      P.hip = [base.hip[0] + 0.1 * sag, base.hip[1], base.hip[2]];
      P.root = [0, base.root[1] - 0.46 * k * sag * (1 - 0.3 * slump) - 0.12 * k * sink, -0.1 * k * reel + 0.18 * k * slump];
      P.fl = [0, 0, 0.05 * k * sag];
      P.fr = [0, 0, -0.06 * k * sag];
      P.rootRot = [0.18 * slump + slam, 0, 0];
      // arms: fly out on the reel, then go limp and drag
      const limp = ramp(t, 0.2, 1.2, 'smooth');
      const fly = Math.sin(Math.PI * ramp(t, 0, 0.5, 'linear')) * 0.2;
      P.r = { ...P.r, g: [P.r.g[0] - 0.1 * limp - fly, P.r.g[1] - 0.2 * k * sag + 0.1 * reel, P.r.g[2] + 0.05 * limp] };
      P.l = { ...P.l, g: [P.l.g[0] + 0.1 * limp + fly, P.l.g[1] - 0.2 * k * sag + 0.1 * reel, P.l.g[2] + 0.05 * limp] };
      P.core = 1 + 0.5 * kick(t, 0.02, 4) - 0.9 * ramp(t, 1.2, 2.0, 'smooth');
      rig.apply(c, P);
      // crumble: head and shoulders first, then the whole mass sinks into the ground
      if (sink > 0) {
        c.scale('head', 1 - sink * 0.95);
        c.scale('clavicle_l', 1 - sink * 0.6);
        c.scale('clavicle_r', 1 - sink * 0.6);
        c.scale('chest', 1 - sink * 0.4);
        c.scale('root', 1 - sink * 0.94);
      }
    },
  };

  // ---------------------------------------------------------------- spawn: heave up out of the ground, roar with a core flare, settle
  const S = st.spawn;
  const spawn: ClipSpec = {
    name: 'spawn', duration: S, loop: false,
    pose: (c) => {
      const t = c.t;
      const up = ramp(t, 0.0, S * 0.62, 'inout3');
      const roar = ramp(t, S * 0.58, S * 0.74, 'out') * (1 - ramp(t, S * 0.74, S * 0.9, 'smooth'));
      const settle = recoil(t, S * 0.74, 3.4, 6) * 0.04;
      const P = clonePose(base);
      P.root = [0, -1.9 * k * (1 - up) + base.root[1] * up + settle * k, 0];
      P.sp = [base.sp[0] + 0.5 * (1 - up) - 0.38 * roar, base.sp[1] + 0.08 * Math.sin(t * 40) * (1 - up), 0];
      P.head = [base.head[0] + 0.4 * (1 - up) - 0.5 * roar, 0, 0];
      const lift = 0.12 * k * (1 - up);
      P.r = { ...P.r, g: [P.r.g[0] + 0.1 * (1 - up) - 0.05 * roar, P.r.g[1] + lift + 0.28 * roar, P.r.g[2] - 0.1 * (1 - up)] };
      P.l = { ...P.l, g: [P.l.g[0] - 0.1 * (1 - up) + 0.05 * roar, P.l.g[1] + lift + 0.28 * roar, P.l.g[2] - 0.1 * (1 - up)] };
      P.shr = 0.2 * roar;
      P.shl = 0.2 * roar;
      P.core = 0.5 + 0.5 * up + 0.9 * roar;
      rig.apply(c, P);
      // the slabs assemble: everything starts a little smaller and grows into place
      const grow = 0.78 + 0.22 * ramp(t, 0, S * 0.7, 'smooth');
      c.scale('root', grow);
    },
  };

  // ---------------------------------------------------------------- special1: ice = frost-nova slam, fire = roar + overhead pound (core flare)
  const sp = st.special1;
  const kSpecial: Key[] = variant === 'ice'
    ? [
      { t: 0, p: rootBase },
      { t: sp.hit * 0.4, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.16 * k, -0.04 * k), sp: e3(0.16, 0, 0), head: e3(0.2, 0, 0), core: 1.35 }), fistW('l', pos('l', 0.18 * H, 0.45 * H, 0.2 * H)), fistW('r', pos('r', 0.18 * H, 0.45 * H, 0.2 * H))), e: 'smooth' },
      { t: sp.hit * 0.82, p: withFists(patch(base, { root: e3(0, -st.crouch, -0.06 * k), sp: e3(-0.4, 0, 0), head: e3(-0.5, 0, 0), shl: 0.18, shr: 0.18, core: 1.7 }), fistW('l', pos('l', 0.42 * H, 0.84 * H, 0.04 * H), [0, -0.5, 1]), fistW('r', pos('r', 0.42 * H, 0.84 * H, 0.04 * H), [0, -0.5, 1])), e: 'smooth' },
      { t: sp.hit * 0.96, p: withFists(patch(base, { root: e3(0, -st.crouch, -0.07 * k), sp: e3(-0.46, 0, 0), head: e3(-0.55, 0, 0), shl: 0.2, shr: 0.2, core: 1.8 }), fistW('l', pos('l', 0.4 * H, 0.88 * H, 0.0), [0, -0.5, 1]), fistW('r', pos('r', 0.4 * H, 0.88 * H, 0.0), [0, -0.5, 1])), e: 'linear' },
      { t: sp.hit, p: withFists(patch(base, { root: e3(0, -st.crouch - st.slam.drop, 0.1 * k), sp: e3(st.slam.pitch, 0, 0), head: e3(0.3, 0, 0), core: 2.1 }), fistW('l', pos('l', st.slam.x, st.slam.y, st.slam.z), [0, -0.3, 1], [0, -1, 0.2]), fistW('r', pos('r', st.slam.x, st.slam.y, st.slam.z), [0, -0.3, 1], [0, -1, 0.2])), e: 'in' },
      { t: sp.hit + 0.6, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.75 * st.slam.drop, 0.06 * k), sp: e3(0.85 * st.slam.pitch, 0, 0), head: e3(0.2, 0, 0), core: 1.5 }), fistW('l', pos('l', st.slam.x, st.slam.y + 0.02, st.slam.z - 0.04)), fistW('r', pos('r', st.slam.x, st.slam.y + 0.02, st.slam.z - 0.04))), e: 'out' },
      { t: sp.dur, p: rootBase, e: 'smooth' },
    ]
    : [
      { t: 0, p: rootBase },
      { t: sp.hit * 0.3, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.1 * k, -0.03 * k), sp: e3(-0.32, 0, 0), head: e3(-0.5, 0, 0), shl: 0.14, shr: 0.14, core: 1.5 }), fistW('l', pos('l', 0.44 * H, 0.66 * H, 0.1 * H), [0, -0.8, 0.6]), fistW('r', pos('r', 0.44 * H, 0.66 * H, 0.1 * H), [0, -0.8, 0.6])), e: 'smooth' },
      { t: sp.hit * 0.6, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.04 * k, -0.05 * k), sp: e3(-0.4, 0.12, 0), head: e3(-0.6, 0, 0), shl: 0.16, shr: 0.16, core: 1.7 }), fistW('l', pos('l', 0.5 * H, 0.82 * H, 0.0), [0, -0.5, 1]), fistW('r', pos('r', 0.5 * H, 0.82 * H, 0.0), [0, -0.5, 1])), e: 'smooth' },
      { t: sp.hit * 0.9, p: withFists(patch(base, { root: e3(0, -st.crouch, -0.07 * k), sp: e3(-0.5, 0, 0), head: e3(-0.4, 0, 0), shl: 0.2, shr: 0.2, core: 1.8 }), fistW('l', pos('l', 0.2 * H, 0.94 * H, -0.01 * H), [0, -0.4, 1]), fistW('r', pos('r', 0.2 * H, 0.94 * H, -0.01 * H), [0, -0.4, 1])), e: 'smooth' },
      { t: sp.hit, p: withFists(patch(base, { root: e3(0, -st.crouch - st.slam.drop, 0.1 * k), sp: e3(st.slam.pitch, 0, 0), head: e3(0.3, 0, 0), core: 2.1 }), fistW('l', pos('l', st.slam.x * 0.85, st.slam.y, st.slam.z), [0, -0.3, 1], [0, -1, 0.2]), fistW('r', pos('r', st.slam.x * 0.85, st.slam.y, st.slam.z), [0, -0.3, 1], [0, -1, 0.2])), e: 'in' },
      { t: sp.hit + 0.6, p: withFists(patch(base, { root: e3(0, -st.crouch - 0.75 * st.slam.drop, 0.06 * k), sp: e3(0.85 * st.slam.pitch, 0, 0), head: e3(0.2, 0, 0), core: 1.5 }), fistW('l', pos('l', st.slam.x * 0.85, st.slam.y + 0.02, st.slam.z - 0.04)), fistW('r', pos('r', st.slam.x * 0.85, st.slam.y + 0.02, st.slam.z - 0.04))), e: 'out' },
      { t: sp.dur, p: rootBase, e: 'smooth' },
    ];
  const special1: ClipSpec = {
    name: 'special1', duration: sp.dur, loop: false, hit: sp.hit,
    pose: (c) => {
      const P = evalKeys(kSpecial, c.t);
      const imp = kick(c.t, sp.hit, 8);
      const ring = recoil(c.t, sp.hit, 3.0, 6);
      P.root = [P.root[0], P.root[1] - 0.07 * k * imp + 0.03 * k * ring, P.root[2]];
      P.sp = [P.sp[0] + 0.06 * ring, P.sp[1], P.sp[2]];
      P.core = Math.max(P.core, 1 + 1.2 * imp);
      rig.apply(c, P);
    },
  };

  return {
    clips: [idle, loco('walk', st.walk), loco('run', st.run), attack, hitClip, death, spawn, attack2, special1],
    speed: { walk: Number(gaitSpeed(rig, st.walk).toFixed(3)), run: Number(gaitSpeed(rig, st.run).toFixed(3)) },
  };
}
