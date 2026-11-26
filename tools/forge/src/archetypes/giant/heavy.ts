// Weighty animation toolkit for big bipeds on the humanoid skeleton (yeti, frost giants, ember warriors, golems, bosses).
// Everything goes through the humanoid pose solver (`applyPose`: planted-foot IK + hand grips in the chest frame), so a
// clip is "a Pose per time sample". What this module adds over `makeClips`:
//   * a parametric gait whose body height is derived from leg reach (so big strides crouch instead of floating),
//     with heel-strike stomp dips, pelvis sway/roll, shoulder roll counter-rotation and lagging arm swing;
//   * heavy flinch / collapse / rise clips with damped overshoot (weight, not planks);
//   * `recoil` pulses to bolt impact settle onto any action, and chain drivers for cape / skirt / hair / tail bones.
// Usage (typical):
//   const kit: HeavyKit = { idle, cfg, walk: {...HEAVY_WALK, sweep: 0.55}, run: {...HEAVY_RUN}, walkArms, runArms };
//   hooks.clips = (_c, a, sk) => [...locomotion(a, sk, kit), action('attack', a, sk, kit, keys, 1.6, 0.55, impact), hitClip(a, sk, kit), deathClip(a, sk, kit), spawnClip(a, sk, kit)]
//   extras.speed = authoredSpeeds(a, kit)
import { type ClipSpec, type PoseCtx } from '../../core/anim/clip.ts';
import { damped, keyed, ramp } from '../../core/anim/curve.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type Key, type Pose, type SolveCfg, applyPose, chainsOf, clonePose, evalKeys } from '../humanoid/index.ts';

const TAU = Math.PI * 2;

export type PosePatch = Key['p'];

/** merge a PosePatch (hands may be partial) over a pose, returning a new pose */
export function patchPose(base: Pose, p: PosePatch): Pose {
  const o = clonePose(base);
  const { r, l, ...rest } = p;
  Object.assign(o, rest);
  if (r) o.r = { g: r.g ?? base.r.g, b: r.b ?? base.r.b, e: r.e ?? base.r.e, c: r.c ?? base.r.c };
  if (l) o.l = { g: l.g ?? base.l.g, b: l.b ?? base.l.b, e: l.e ?? base.l.e, c: l.c ?? base.l.c };
  return o;
}

// ------------------------------------------------------------------------------------------------ gait

export interface GaitSpec {
  /** cycle seconds */
  T: number;
  /** stance fraction of the cycle (walk > 0.55, run < 0.5) */
  duty: number;
  /** stride: foot travel during one stance as a fraction of the straight leg length (walk ~0.5, run ~0.72) */
  sweep: number;
  /** swing-foot lift height (reference metres) */
  lift: number;
  /** extra up/down body bob on top of the reach-derived height (reference metres) */
  bob: number;
  /** root dip at every heel strike (reference metres), fast attack / slow release */
  stomp: number;
  /** pelvis lateral shift toward the stance foot (reference metres) */
  sway: number;
  /** forward torso lean (rad) */
  lean: number;
  /** pelvis yaw amplitude (rad) */
  twist: number;
  /** shoulder yaw counter-rotation amplitude (rad) */
  roll: number;
  /** pelvis roll toward the swing side (rad) */
  pelvisRoll: number;
  /** hand fore/aft swing (reference metres) */
  armSwing: number;
  /** arm swing lag behind the legs (fraction of a cycle) */
  armLag?: number;
  /** flight-phase style swing (run) */
  run?: boolean;
  /** extra permanent crouch (reference metres of root drop) */
  crouch?: number;
  /** fraction of the idle stance width kept while moving (default 0.6) */
  stance?: number;
  /** reach margin: legs may extend to this fraction of their length (default 0.99) */
  reach?: number;
}

export const HEAVY_WALK: GaitSpec = { T: 1.0, duty: 0.63, sweep: 0.5, lift: 0.1, bob: 0.014, stomp: 0.02, sway: 0.032, lean: 0.07, twist: 0.2, roll: 0.24, pelvisRoll: 0.05, armSwing: 0.12, armLag: 0.07 };
export const HEAVY_RUN: GaitSpec = { T: 0.72, duty: 0.46, sweep: 0.72, lift: 0.2, bob: 0.03, stomp: 0.04, sway: 0.035, lean: 0.24, twist: 0.3, roll: 0.36, pelvisRoll: 0.07, armSwing: 0.22, armLag: 0.05, run: true };

/** authored ground speed in metres per second for this anatomy */
export const gaitSpeed = (g: GaitSpec, a: Anatomy): number => (g.sweep * (a.lengths.thigh + a.lengths.shin)) / (g.duty * g.T);

interface Foot {
  z: number;
  y: number;
  pitch: number;
}

function footAt(g: GaitSpec, ph: number): Foot {
  const f = ph - Math.floor(ph);
  if (f < g.duty) {
    const u = f / g.duty;
    const z = g.sweep * 0.5 - g.sweep * u;
    const heel = u > 0.6 ? ramp(u, 0.6, 1, 'smooth') : 0;
    const strike = u < 0.12 ? (0.12 - u) / 0.12 : 0;
    return { z, y: 0, pitch: heel * (g.run ? 0.8 : 0.55) - strike * 0.28 };
  }
  const u = (f - g.duty) / (1 - g.duty);
  const e = u * u * (3 - 2 * u);
  const z = -g.sweep * 0.5 + g.sweep * (g.run ? e * 0.7 + u * 0.3 : e);
  const y = g.lift * Math.sin(Math.PI * Math.pow(u, 0.85));
  return { z, y, pitch: keyed(u, [[0, 0.7], [0.25, 0.25], [0.6, -0.15], [1, -0.3]], 'smooth') };
}

/** heel-strike dip envelope for a foot at cycle phase ph: sharp drop at strike (f = 0), slow release */
function stompPulse(ph: number): number {
  const f = ph - Math.floor(ph);
  if (f < 0.5) return Math.exp(-f / 0.1);
  return f > 0.93 ? ramp(f, 0.93, 1, 'in') : 0;
}

/** one gait pose. `idle` supplies stance / torso / hands, `arms` is an optional carry patch blended in while moving */
export function gaitPose(idle: Pose, a: Anatomy, g: GaitSpec, u: number, arms?: PosePatch): Pose {
  const s = a.s;
  const Lleg = a.lengths.thigh + a.lengths.shin;
  const P = arms ? patchPose(idle, arms) : clonePose(idle);
  const fl = footAt(g, u), fr = footAt(g, u + 0.5);
  const sx = g.stance ?? 0.6;
  P.fl = [idle.fl[0] * sx, fl.y * s, fl.z * Lleg];
  P.fr = [idle.fr[0] * sx, fr.y * s, fr.z * Lleg];
  P.fpl = fl.pitch;
  P.fpr = fr.pitch;
  P.fyl = idle.fyl;
  P.fyr = idle.fyr;
  // body height from leg reach: both ankles must stay within `reach * leg length` of their hip
  const j = a.side(1);
  const Lm = (a.lengths.thigh + a.lengths.shin) * (g.reach ?? 0.99);
  const hipH = j.hip[1] - j.ankle[1];
  const need = (z: number, y: number, x: number): number => Math.max(0, hipH - y - Math.sqrt(Math.max(Lm * Lm - z * z - x * x, 0.01)));
  const dl = need(fl.z * Lleg, fl.y * s, idle.fl[0] * sx), dr = need(fr.z * Lleg, fr.y * s, idle.fr[0] * sx);
  const mid = g.duty / 2;
  const bobTerm = g.bob * s * 0.5 * (Math.cos(TAU * 2 * (u - mid)) - 1);
  const dip = g.stomp * s * Math.max(stompPulse(u), stompPulse(u + 0.5));
  P.root = [idle.root[0], idle.root[1] - Math.max(dl, dr) - (g.crouch ?? 0) * s + bobTerm - dip, idle.root[2]];
  // weight shift: sway toward the stance foot, torso counter-rolls, pelvis drops on the swing side
  const stanceSig = Math.sin(TAU * (u + 0.25 - mid));
  P.hipMove = [idle.hipMove[0] + g.sway * s * stanceSig, idle.hipMove[1], idle.hipMove[2]];
  const d = (fl.z - fr.z) / g.sweep; // +1 left foot far ahead
  const lag = g.armLag ?? 0.06;
  const dLag = (footAt(g, u - lag).z - footAt(g, u - lag + 0.5).z) / g.sweep;
  P.hip = [idle.hip[0] + 0.5 * g.lean * (stompPulse(u) + stompPulse(u + 0.5)) * 0.1, idle.hip[1] - g.twist * d, idle.hip[2] + g.pelvisRoll * stanceSig];
  P.sp = [idle.sp[0] + g.lean + 0.5 * dip / Math.max(s, 1e-3), idle.sp[1] + g.roll * d, idle.sp[2] - 0.7 * g.pelvisRoll * stanceSig];
  P.head = [idle.head[0] - 0.55 * g.lean + 0.8 * dip / Math.max(s, 1e-3), idle.head[1] - 0.25 * g.roll * dLag, idle.head[2]];
  // hands swing opposite to the legs, lagging behind them; a stomp jolts them down
  const sw = g.armSwing;
  P.r = { ...P.r, g: [P.r.g[0], P.r.g[1] - 0.6 * dip / Math.max(s, 1e-3), P.r.g[2] + sw * dLag] };
  P.l = { ...P.l, g: [P.l.g[0], P.l.g[1] - 0.6 * dip / Math.max(s, 1e-3), P.l.g[2] - sw * dLag] };
  const lift = 0.5 * dip / Math.max(s, 1e-3);
  P.shr = idle.shr + lift;
  P.shl = idle.shl + lift;
  return P;
}

/** idle breathing / weight shift on top of the idle carry pose (u = 0..1 over the idle loop) */
export function breathePose(idle: Pose, a: Anatomy, u: number, o: { amp?: number; sway?: number; head?: number } = {}): Pose {
  const s = a.s;
  const k = o.amp ?? 1;
  const br = Math.sin(TAU * u);
  const P = clonePose(idle);
  P.sp = [idle.sp[0] + 0.02 * k * br, idle.sp[1] + 0.03 * k * Math.sin(TAU * u * 2 + 1), idle.sp[2] + 0.015 * k * Math.sin(TAU * u)];
  P.head = [idle.head[0] - 0.014 * k * br, idle.head[1] + (o.head ?? 0.07) * Math.sin(TAU * u + 0.6), idle.head[2]];
  P.hip = [idle.hip[0], idle.hip[1], idle.hip[2] + 0.025 * k * Math.sin(TAU * u)];
  P.hipMove = [idle.hipMove[0] + (o.sway ?? 0.012) * s * Math.sin(TAU * u), idle.hipMove[1], idle.hipMove[2]];
  P.root = [idle.root[0], idle.root[1] + 0.008 * s * k * (br - 1), idle.root[2]];
  const drift = Math.sin(TAU * u - 0.9);
  P.r = { ...P.r, g: [P.r.g[0], P.r.g[1] + 0.012 * k * drift, P.r.g[2]] };
  P.l = { ...P.l, g: [P.l.g[0], P.l.g[1] + 0.012 * k * Math.sin(TAU * u - 1.3), P.l.g[2]] };
  P.shr = idle.shr + 0.035 * k * br;
  P.shl = idle.shl + 0.035 * k * br;
  return P;
}

// ------------------------------------------------------------------------------------------------ envelopes

/** impact settle: 0 before t0, then a damped cosine that starts at 1 (f Hz, decay k) */
export const recoil = (t: number, t0: number, f = 3.2, k = 9): number => (t < t0 ? 0 : damped(t - t0, f, k));
/** one-sided kick: 0 before t0, jumps to 1, decays like exp(-k dt) (stomps, ground pounds) */
export const kick = (t: number, t0: number, k = 12): number => (t < t0 ? 0 : Math.exp(-k * (t - t0)));

// ------------------------------------------------------------------------------------------------ chains

export interface ChainOpts {
  /** per-chain amplitude multipliers (default 1; 0 disables) */
  skirt?: number;
  hair?: number;
  scarf?: number;
  cape?: number;
  tail?: number;
  ears?: number;
}

/** drive the secondary chains (skirt/cape/hair/scarf/tail/ears) from body motion: speed 0..1 trailing, swing = leg swing scalar, twist = torso yaw scalar */
export function driveChains(c: PoseCtx, sk: Skeleton, phase: number, speed: number, swing: number, twist: number, o: ChainOpts = {}): void {
  const ch = chainsOf(sk);
  const t = c.t;
  const wave = (i: number, f: number, amp: number): number => amp * Math.sin(phase * TAU * f - i * 0.8);
  const ks = o.skirt ?? 1, kh = o.hair ?? 1, kf = o.scarf ?? 1, kc = o.cape ?? 1, kt = o.tail ?? 1, ke = o.ears ?? 1;
  if (ch.skirt) {
    c.set('skirt_f', ks * (-0.55 * Math.max(swing, 0) - 0.08 * speed + 0.03 * Math.sin(t * 2)), 0, 0);
    c.set('skirt_b', ks * (0.5 * Math.max(-swing, 0) + 0.12 * speed + 0.03 * Math.sin(t * 2 + 1)), 0, 0);
    c.set('skirt_l', 0, 0, ks * (-0.12 * Math.max(twist, 0) - 0.04 * speed));
    c.set('skirt_r', 0, 0, ks * (0.12 * Math.max(-twist, 0) + 0.04 * speed));
  }
  ch.hair.forEach((n, i) => c.set(n, kh * (0.12 * speed + wave(i, 1, 0.1 + 0.05 * speed) + 0.1 * Math.abs(swing)), kh * 0.1 * twist, 0));
  ch.scarf.forEach((n, i) => c.set(n, kf * (0.35 * speed + wave(i, 1, 0.22) + 0.1 * i * speed), kf * (wave(i, 1, 0.12 + 0.1 * speed) + 0.2 * twist), 0));
  ch.cape.forEach((n, i) => c.set(n, kc * (0.25 * speed + wave(i, 1, 0.12) + 0.08 * i * speed + 0.1 * Math.max(swing, 0)), kc * 0.1 * twist, 0));
  ch.tail.forEach((n, i) => c.set(n, kt * (0.1 * speed + wave(i, 1, 0.16)), kt * (0.25 * Math.sin(phase * TAU - i) * (0.4 + speed) + 0.2 * twist), 0));
  if (ch.ears) {
    c.set('ear_l', ke * (-0.04 * speed + wave(0, 2, 0.05)), 0, ke * 0.12 * speed);
    c.set('ear_r', ke * (-0.04 * speed + wave(0, 2, 0.05)), 0, -ke * 0.12 * speed);
  }
}

// ------------------------------------------------------------------------------------------------ clips

export interface HeavyKit {
  /** idle carry pose: stance (fl/fr/root), torso (sp/hip), hands (grips, finger curl) in the chest frame */
  idle: Pose;
  cfg?: SolveCfg;
  walk?: GaitSpec;
  run?: GaitSpec;
  /** arm carriage patches while moving (blended over idle) */
  walkArms?: PosePatch;
  runArms?: PosePatch;
  /** idle loop seconds (default 3.0) */
  idleDur?: number;
  /** idle breathing amplitude multiplier (default 1) */
  breath?: number;
  /** secondary chain amplitudes */
  chains?: ChainOpts;
  /** extra per-pose adjustment applied to every clip after the base pose (props, tails, ...) */
  post?: (P: Pose, name: string, t: number, u: number) => Pose;
}

function solveNamed(c: PoseCtx, a: Anatomy, kit: HeavyKit, name: string, P: Pose): void {
  applyPose(c, a, kit.post ? kit.post(P, name, c.t, c.u) : P, kit.cfg ?? {});
}

/** idle (loop), walk (loop), run (loop) from the kit */
export function locomotion(a: Anatomy, sk: Skeleton, kit: HeavyKit): ClipSpec[] {
  const out: ClipSpec[] = [];
  const idleDur = kit.idleDur ?? 3.0;
  out.push({
    name: 'idle', duration: idleDur, loop: true,
    pose: (c) => {
      const P = breathePose(kit.idle, a, c.u, { amp: kit.breath ?? 1 });
      solveNamed(c, a, kit, 'idle', P);
      driveChains(c, sk, c.u, 0, 0, 0, kit.chains);
    },
  });
  if (kit.walk) {
    const g = kit.walk;
    out.push({
      name: 'walk', duration: g.T, loop: true,
      pose: (c) => {
        const P = gaitPose(kit.idle, a, g, c.u, kit.walkArms);
        solveNamed(c, a, kit, 'walk', P);
        driveChains(c, sk, c.u, 0.35, -Math.cos(c.u * TAU) * 0.5, Math.sin(c.u * TAU), kit.chains);
      },
    });
  }
  if (kit.run) {
    const g = kit.run;
    out.push({
      name: 'run', duration: g.T, loop: true,
      pose: (c) => {
        const P = gaitPose(kit.idle, a, g, c.u, kit.runArms);
        solveNamed(c, a, kit, 'run', P);
        driveChains(c, sk, c.u, 1, Math.cos(c.u * TAU), Math.sin(c.u * TAU), kit.chains);
      },
    });
  }
  return out;
}

/** authored speeds for `extras.speed` */
export function authoredSpeeds(a: Anatomy, kit: HeavyKit): { walk: number; run: number } {
  const w = kit.walk ? gaitSpeed(kit.walk, a) : 0;
  const r = kit.run ? gaitSpeed(kit.run, a) : w * 1.8;
  return { walk: Number(w.toFixed(3)), run: Number(r.toFixed(3)) };
}

/** a key-pose action clip (attack, special, spawn...). `extra` can add impact recoil etc. on top of the keyed pose. */
export function action(name: string, a: Anatomy, sk: Skeleton, kit: HeavyKit, keys: Key[], dur: number, hit: number | undefined, extra?: (P: Pose, t: number) => Pose, chainSpeed = 0.6): ClipSpec {
  return {
    name, duration: dur, loop: false, ...(hit !== undefined ? { hit } : {}),
    pose: (c) => {
      let P = evalKeys(kit.idle, keys, c.t);
      if (extra) P = extra(P, c.t);
      solveNamed(c, a, kit, name, P);
      driveChains(c, sk, c.t * 1.4, chainSpeed, Math.max(P.fl[2], P.fr[2]) * 1.6, P.sp[1], kit.chains);
    },
  };
}

export interface HitOpts {
  /** seconds (default 0.55) */
  dur?: number;
  /** flinch strength multiplier (default 1) */
  k?: number;
}

/** flinch: snap back with weight, damped overshoot, settle */
export function hitClip(a: Anatomy, sk: Skeleton, kit: HeavyKit, o: HitOpts = {}): ClipSpec {
  const dur = o.dur ?? 0.55;
  const k = o.k ?? 1;
  const s = a.s;
  return {
    name: 'hit', duration: dur, loop: false,
    pose: (c) => {
      const t = c.t;
      const snap = ramp(t, 0, 0.08, 'out');
      const rec = ramp(t, 0.08, dur, 'smooth');
      const w = snap * (1 - rec);
      const ring = recoil(t, 0.08, 4.5, 8) * 0.25;
      const P = clonePose(kit.idle);
      P.sp = [kit.idle.sp[0] - (0.34 * w + 0.1 * ring) * k, kit.idle.sp[1] + 0.2 * w * k, kit.idle.sp[2] + 0.1 * w * k];
      P.head = [kit.idle.head[0] - (0.45 * w + 0.15 * ring) * k, kit.idle.head[1] + 0.15 * w, kit.idle.head[2]];
      P.hip = [kit.idle.hip[0] - 0.12 * w * k, kit.idle.hip[1], kit.idle.hip[2]];
      P.root = [kit.idle.root[0], kit.idle.root[1] - 0.05 * s * w * k, kit.idle.root[2] - 0.1 * s * w * k];
      P.fl = [kit.idle.fl[0], 0, kit.idle.fl[2] + 0.1 * s * w * k];
      P.fr = [kit.idle.fr[0], 0, kit.idle.fr[2] - 0.2 * s * w * k];
      P.r = { ...P.r, g: [P.r.g[0] - 0.08 * w * k, P.r.g[1] + 0.1 * w * k, P.r.g[2] + 0.04 * w] };
      P.l = { ...P.l, g: [P.l.g[0] + 0.08 * w * k, P.l.g[1] + 0.1 * w * k, P.l.g[2] + 0.04 * w] };
      solveNamed(c, a, kit, 'hit', P);
      driveChains(c, sk, t * 2, 0.2, -0.6 * w, 0, kit.chains);
    },
  };
}

export interface DeathOpts {
  /** seconds (default 2.2) */
  dur?: number;
  /** 'back' topples onto the back, 'front' face down, 'kneel' collapses to the knees and slumps forward */
  fall?: 'back' | 'front' | 'kneel';
  /** how far the knees buckle (reference metres of root drop, default 0.4) */
  buckle?: number;
}

/** weighty collapse: reel, knees buckle (IK folds the legs), torso topples, impact bounce, limp settle */
export function deathClip(a: Anatomy, sk: Skeleton, kit: HeavyKit, o: DeathOpts = {}): ClipSpec {
  const dur = o.dur ?? 2.2;
  const fall = o.fall ?? 'back';
  const s = a.s;
  const buckle = (o.buckle ?? 0.4) * s;
  return {
    name: 'death', duration: dur, loop: false,
    pose: (c) => {
      const t = c.t;
      const reel = ramp(t, 0, 0.3, 'out');
      const sag = ramp(t, 0.25, 0.95, 'in');
      const topple = ramp(t, 0.85, 1.55, 'in');
      const slam = recoil(t, 1.55, 5, 7) * 0.12 * Math.min(1, ramp(t, 1.55, 1.6, 'linear'));
      const sign = fall === 'front' ? 1 : -1;
      const P = clonePose(kit.idle);
      P.sp = [kit.idle.sp[0] + (fall === 'back' ? -0.45 * reel + 0.25 * sag : 0.25 * reel + 0.5 * sag), kit.idle.sp[1] + 0.25 * reel, kit.idle.sp[2] + 0.12 * reel];
      P.head = [kit.idle.head[0] + (fall === 'back' ? -0.4 * reel - 0.3 * topple : 0.1 * reel + 0.4 * sag), kit.idle.head[1] + 0.2 * reel, 0];
      P.hip = [kit.idle.hip[0] + (fall === 'back' ? -0.1 * reel : 0.1 * sag), kit.idle.hip[1], kit.idle.hip[2]];
      P.fl = [kit.idle.fl[0], 0, kit.idle.fl[2] + (0.12 * reel + 0.2 * sag) * s];
      P.fr = [kit.idle.fr[0], 0, kit.idle.fr[2] - (0.15 * reel + 0.1 * sag) * s];
      let ry = kit.idle.root[1] - buckle * sag * (1 - topple);
      let rz = kit.idle.root[2] - 0.12 * s * reel;
      if (fall !== 'kneel') {
        const ang = 1.5 * topple + slam;
        P.rootRot = [sign * ang, 0, 0.1 * topple];
        rz += sign * (fall === 'back' ? 0.1 : -0.25) * s * topple;
        ry = Math.max(ry, 0) + 0.2 * s * topple;
        P.fl = [P.fl[0], 0.22 * s * topple, P.fl[2] - 0.1 * s * topple];
        P.fr = [P.fr[0], 0.16 * s * topple, P.fr[2] - 0.18 * s * topple];
      } else {
        const sl = ramp(t, 0.9, 1.7, 'in');
        P.sp = [P.sp[0] + 0.5 * sl, P.sp[1], P.sp[2]];
        P.head = [P.head[0] + 0.4 * sl, P.head[1], P.head[2]];
        ry -= 0.12 * s * sl;
        P.rootRot = [0.35 * sl + slam, 0, 0];
        rz += 0.2 * s * sl;
      }
      P.root = [kit.idle.root[0], ry, rz];
      // arms go limp: swing out and down
      const limp = ramp(t, 0.2, 1.2, 'smooth');
      P.r = { ...P.r, g: [P.r.g[0] - 0.12 * limp, P.r.g[1] - 0.1 * limp + 0.1 * reel, P.r.g[2] - 0.08 * limp], c: 0.15 };
      P.l = { ...P.l, g: [P.l.g[0] + 0.12 * limp, P.l.g[1] - 0.1 * limp + 0.1 * reel, P.l.g[2] - 0.08 * limp], c: 0.15 };
      solveNamed(c, a, kit, 'death', P);
      driveChains(c, sk, t, 0.3, -0.5 * reel, 0, kit.chains);
    },
  };
}

export interface SpawnOpts {
  /** seconds (default 1.5) */
  dur?: number;
  /** roar: chest out, head back, fists clenched (default true) */
  roar?: boolean;
  /** start depth (reference metres below standing, default 0.45) */
  depth?: number;
}

/** emerge: heave up out of a crouch, plant, chest out, settle */
export function spawnClip(a: Anatomy, sk: Skeleton, kit: HeavyKit, o: SpawnOpts = {}): ClipSpec {
  const dur = o.dur ?? 1.5;
  const s = a.s;
  const depth = (o.depth ?? 0.45) * s;
  const roar = o.roar ?? true;
  return {
    name: 'spawn', duration: dur, loop: false,
    pose: (c) => {
      const t = c.t;
      const up = ramp(t, 0.05, dur * 0.55, 'inout3');
      const heave = ramp(t, dur * 0.5, dur * 0.72, 'out') * (1 - ramp(t, dur * 0.72, dur, 'smooth'));
      const settle = recoil(t, dur * 0.72, 3.5, 6) * 0.05;
      const P = clonePose(kit.idle);
      P.root = [kit.idle.root[0], kit.idle.root[1] - depth * (1 - up) + 0.02 * s * heave + settle * s, kit.idle.root[2]];
      P.sp = [kit.idle.sp[0] + 0.5 * (1 - up) + (roar ? -0.3 * heave : 0), kit.idle.sp[1], kit.idle.sp[2]];
      P.head = [kit.idle.head[0] + 0.35 * (1 - up) + (roar ? -0.35 * heave : 0), kit.idle.head[1], 0];
      P.fl = [kit.idle.fl[0] + 0.06 * (1 - up), 0, kit.idle.fl[2] + 0.1 * s * (1 - up)];
      P.fr = [kit.idle.fr[0] - 0.06 * (1 - up), 0, kit.idle.fr[2] - 0.1 * s * (1 - up)];
      const hy = -0.2 * (1 - up) + (roar ? 0.12 * heave : 0);
      P.r = { ...P.r, g: [P.r.g[0] - 0.06 * heave - 0.05 * (1 - up), P.r.g[1] + hy, P.r.g[2] - 0.06 * (1 - up)], c: 0.3 + 0.7 * heave };
      P.l = { ...P.l, g: [P.l.g[0] + 0.06 * heave + 0.05 * (1 - up), P.l.g[1] + hy, P.l.g[2] - 0.06 * (1 - up)], c: 0.3 + 0.7 * heave };
      P.shr = kit.idle.shr + 0.2 * heave;
      P.shl = kit.idle.shl + 0.2 * heave;
      solveNamed(c, a, kit, 'spawn', P);
      driveChains(c, sk, t * 1.5, 0.2, 0, 0, kit.chains);
    },
  };
}
