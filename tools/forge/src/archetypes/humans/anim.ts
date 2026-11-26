// Enemy animation toolkit on top of the humanoid pose solver (applyPose: planted-foot leg IK, hand-grip arm IK).
// Everything is authored in REFERENCE metres (1.76 m human) and scaled by the body scale `a.s` right before solving, so the
// same key data works for a 1.7 m villager and a 2.3 m executioner.
//   * `gaitClip`   parametric walk / run with limp, drag, stomp, hunch, arm carry overrides
//   * `idleClip`   breathing + weight shift + look-around, loop-safe
//   * `actionClip` key-pose sequences with easing (attacks, casts, rallies ...)
//   * `hitClip`, `deathClip`, `spawnClip` parametric reactions
//   * `secondary`  skirt / hair / scarf / cape / tail / ear chains driven from the body motion
import { type ClipSpec, type PoseCtx } from '../../core/anim/clip.ts';
import { type Ease, bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import type { Vec3 } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type E3, type Hand, type Key, type Pose, type SolveCfg, V, applyPose, basePose, blendPose, chainsOf, clonePose, evalKeys } from '../humanoid/index.ts';

const TAU = Math.PI * 2;

/** partial pose patch (any Pose field, hands partial) */
export type Patch = Partial<Pose> & { r?: Partial<Hand>; l?: Partial<Hand> };

// ------------------------------------------------------------------------------------------------ hands
/**
 * One hand. `g` grip centre in the chest frame (reference metres), `axis` = direction of the grip axis (the held shaft / blade /
 * bow runs along it), `palm` = direction the palm faces, `curl` 0 open .. 1 fist.
 * (rig.ts convention: `Hand.b` = hand +Z, `Hand.e` = the hand's lateral axis = the BACK of the hand = -palm normal.)
 */
export const grip = (g: Vec3, axis: Vec3, palm: Vec3, curl = 1): Hand => ({ g, b: axis, e: [-palm[0], -palm[1], -palm[2]], c: curl });

/** a relaxed hanging hand (palm toward the thigh) */
export const hang = (sx: 'l' | 'r', curl = 0.4, g?: Vec3): Hand =>
  sx === 'r' ? grip(g ?? V(-0.24, -0.3, 0.1), V(0, 0, 1), V(1, 0, 0), curl) : grip(g ?? V(0.24, -0.3, 0.1), V(0, 0, 1), V(-1, 0, 0), curl);

/**
 * Express a body-frame point / direction (torso upright, facing +Z, origin at the chest joint) in the chest frame of a torso that
 * is turned by `yaw` and pitched by `pitch` (rad; the pose's chest rotation = sp + hip). Use it to aim hands at world targets
 * while the torso twists (archer draw, caster).
 */
export function inChest(v: Vec3, yaw: number, pitch = 0): Vec3 {
  const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
  const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
}

export interface Chains { skirt: boolean; hair: string[]; scarf: string[]; cape: string[]; tail: string[]; ears: boolean }

export interface AnimEnv {
  a: Anatomy;
  sk: Skeleton;
  /** carry / ready pose, reference metres. Every clip is expressed relative to it. */
  idle: Pose;
  cfg: SolveCfg;
  ch: Chains;
  /** extra secondary motion hook (own chains such as a quiver flap, banner): called by every clip */
  extra?: (c: PoseCtx, clip: string, t: number, phase: number, speed: number) => void;
  /** secondary-motion strength multiplier (heavy cloth 0.6, flowing silk 1.4) */
  flow?: number;
}

export const makeEnv = (a: Anatomy, sk: Skeleton, idle: Pose, cfg: SolveCfg = {}, extra?: Pick<AnimEnv, 'extra' | 'flow'>): AnimEnv => ({ a, sk, idle, cfg, ch: chainsOf(sk), ...(extra ?? {}) });

/** scale the world-space translation fields of a reference-metre pose to this body */
export function finalize(P: Pose, s: number): Pose {
  const o = clonePose(P);
  o.root = [P.root[0] * s, P.root[1] * s, P.root[2] * s];
  o.hipMove = [P.hipMove[0] * s, P.hipMove[1] * s, P.hipMove[2] * s];
  o.fl = [P.fl[0] * s, P.fl[1] * s, P.fl[2] * s];
  o.fr = [P.fr[0] * s, P.fr[1] * s, P.fr[2] * s];
  return o;
}

function solve(env: AnimEnv, c: PoseCtx, P: Pose): void {
  applyPose(c, env.a, finalize(P, env.a.s), env.cfg);
}

// ------------------------------------------------------------------------------------------------ pose building
/** base pose with a stance: feet apart `w` (each side), left foot forward by `fwd`, body dropped by `drop` */
export const stance = (w: number, fwd: number, drop: number): Patch => ({ fl: V(w, 0, fwd), fr: V(-w, 0, -fwd), root: V(0, -drop, 0) });

export function poseOf(...patches: Patch[]): Pose {
  let P = basePose();
  for (const p of patches) P = resolve(P, p);
  return P;
}

/** apply a patch over a pose (hands merged field by field) */
export function resolve(base: Pose, p: Patch): Pose {
  const o = clonePose(base);
  const { r, l, ...rest } = p;
  Object.assign(o, rest);
  if (r) o.r = { g: r.g ?? base.r.g, b: r.b ?? base.r.b, e: r.e ?? base.r.e, c: r.c ?? base.r.c };
  if (l) o.l = { g: l.g ?? base.l.g, b: l.b ?? base.l.b, e: l.e ?? base.l.e, c: l.c ?? base.l.c };
  return o;
}

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const addE = (a: E3, b: E3): E3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ------------------------------------------------------------------------------------------------ secondary motion
/**
 * Drive the secondary chains. `speed` 0..1 (how much they trail), `swing` leg swing -1..1 (skirt front/back), `twist` torso
 * yaw (skirt sides), `phase` cycles for travelling waves.
 */
export function secondary(env: AnimEnv, c: PoseCtx, t: number, phase: number, speed: number, swing: number, twist: number): void {
  const ch = env.ch;
  const k = env.flow ?? 1;
  const wave = (i: number, f: number, amp: number): number => amp * k * Math.sin(phase * TAU * f - i * 0.8);
  if (ch.skirt) {
    c.set('skirt_f', k * (-0.55 * Math.max(swing, 0) - 0.08 * speed + 0.03 * Math.sin(t * 2)), 0, 0);
    c.set('skirt_b', k * (0.5 * Math.max(-swing, 0) + 0.12 * speed + 0.03 * Math.sin(t * 2 + 1)), 0, 0);
    c.set('skirt_l', 0, 0, k * (-0.12 * Math.max(twist, 0) - 0.04 * speed));
    c.set('skirt_r', 0, 0, k * (0.12 * Math.max(-twist, 0) + 0.04 * speed));
  }
  ch.hair.forEach((n, i) => c.set(n, k * (0.12 * speed + 0.1 * Math.abs(swing)) + wave(i, 1, 0.1 + 0.05 * speed), k * 0.1 * twist, 0));
  ch.scarf.forEach((n, i) => c.set(n, k * (0.35 * speed + 0.1 * i * speed) + wave(i, 1, 0.22), wave(i, 1, 0.12 + 0.1 * speed) + k * 0.2 * twist, 0));
  ch.cape.forEach((n, i) => c.set(n, k * (0.25 * speed + 0.08 * i * speed) + wave(i, 1, 0.12), k * 0.1 * twist, 0));
  ch.tail.forEach((n, i) => c.set(n, k * 0.1 * speed + wave(i, 1, 0.16), k * (0.25 * Math.sin(phase * TAU - i) * (0.4 + speed) + 0.2 * twist), 0));
  if (ch.ears) {
    c.set('ear_l', -0.04 * speed + wave(0, 2, 0.05), 0, 0.12 * speed);
    c.set('ear_r', -0.04 * speed + wave(0, 2, 0.05), 0, -0.12 * speed);
  }
}

// ------------------------------------------------------------------------------------------------ idle
export interface IdleSpec {
  dur?: number;
  /** chest breathing amplitude (rad) */
  breath?: number;
  /** lateral weight shift (m) */
  shift?: number;
  /** head look-around yaw amplitude (rad) */
  look?: number;
  /** extra per-frame tweak (u = 0..1 loop phase) */
  tweak?: (P: Pose, u: number) => void;
}

export function idleClip(env: AnimEnv, o: IdleSpec = {}): ClipSpec {
  const dur = o.dur ?? 2.6;
  const breath = o.breath ?? 0.016;
  const shift = o.shift ?? 0.008;
  const look = o.look ?? 0.07;
  return {
    name: 'idle', duration: dur, loop: true,
    pose: (c) => {
      const u = c.u;
      const br = Math.sin(u * TAU);
      const P = clonePose(env.idle);
      P.sp = addE(P.sp, [breath * br, 0.02 * Math.sin(u * TAU * 2 + 1), 0.012 * Math.sin(u * TAU)]);
      P.head = addE(P.head, [-0.012 * br, look * Math.sin(u * TAU), 0.02 * Math.sin(u * TAU * 2)]);
      P.hip = addE(P.hip, [0, 0, 0.022 * Math.sin(u * TAU) + shift * 1.5 * Math.sin(u * TAU)]);
      P.root = add3(P.root, [shift * Math.sin(u * TAU), 0.006 * (br - 1), 0]);
      P.r.g = add3(P.r.g, [0, 0.006 * br, 0]);
      P.l.g = add3(P.l.g, [0, 0.006 * br, 0]);
      P.shr += 0.02 * br;
      P.shl += 0.02 * br;
      o.tweak?.(P, u);
      solve(env, c, P);
      secondary(env, c, c.t, c.u, 0, 0, 0);
      env.extra?.(c, 'idle', c.t, c.u, 0);
    },
  };
}

// ------------------------------------------------------------------------------------------------ gait
export interface GaitSpec {
  /** cycle seconds */
  T: number;
  /** fraction of the cycle a foot is on the ground */
  duty: number;
  /** stride length per foot, reference metres: ground speed = sweep / (duty * T) */
  sweep: number;
  lift: number;
  bob: number;
  /** extra torso pitch (rad) */
  lean: number;
  /** spine yaw counter-rotation (rad) */
  twist: number;
  /** pelvis yaw (rad) */
  hipYaw?: number;
  /** side-to-side body roll (rad) */
  roll?: number;
  /** lateral root sway (m) */
  sway?: number;
  /** body drop (crouch) while moving (m) */
  crouch?: number;
  /** foot lateral spacing factor vs the idle stance (default 0.5) */
  width?: number;
  /** free arm swing (m, forward/back) and weapon arm share 0..1 */
  armSwing?: number;
  armHeld?: number;
  /** which hand carries the held item (its swing is scaled by armHeld, the other hand swings freely); default 'r' */
  heldSide?: 'l' | 'r';
  /** heel strike emphasis: extra root dip (m) at foot contact */
  stomp?: number;
  /** leg reach margin: ankles may extend to this fraction of the leg length (default 0.975); the body lowers instead of the feet floating */
  reach?: number;
  /** drag the swing foot along the ground (0..1) */
  drag?: number;
  /** limp: one leg takes a shorter stride and drops the body when loaded */
  limp?: { leg: 'l' | 'r'; short: number; dip: number };
  /** head stabilisation 0..1 (1 = steady gaze) */
  headStab?: number;
  /** head lolling amplitude (rad) */
  loll?: number;
  /** arm / carry overrides over the idle pose */
  carry?: Patch;
  /** run style (heel-less landing, longer swing) */
  run?: boolean;
  /** extra per-frame tweak (u = 0..1 loop phase) */
  tweak?: (P: Pose, u: number) => void;
}

/** ground speed (m/s) of a gait at body scale s */
export const gaitSpeedOf = (g: GaitSpec, s: number): number => (g.sweep * s) / (g.duty * g.T);

/** `speed` for HumanoidParams (-> GLB extras.speed): ground speeds in m/s authored by the walk and run gaits at body height `bodyHeight` */
export const speedsOf = (walk: GaitSpec, run: GaitSpec, bodyHeight: number): { walk: number; run: number } => ({
  walk: Number(gaitSpeedOf(walk, bodyHeight / 1.76).toFixed(3)),
  run: Number(gaitSpeedOf(run, bodyHeight / 1.76).toFixed(3)),
});

function footAt(g: GaitSpec, ph: number, limpK: number): { z: number; y: number; pitch: number } {
  const f = ph - Math.floor(ph);
  const sweep = g.sweep * limpK;
  if (f < g.duty) {
    const u = f / g.duty;
    const z = sweep * 0.5 - sweep * u;
    const heel = u > 0.55 ? ramp(u, 0.55, 1, 'smooth') : 0;
    return { z, y: 0, pitch: heel * (g.run ? 0.75 : 0.55) - (u < 0.08 ? (0.08 - u) * 3 : 0) };
  }
  const u = (f - g.duty) / (1 - g.duty);
  const e = u * u * (3 - 2 * u);
  const z = -sweep * 0.5 + sweep * (g.run ? e * 0.7 + u * 0.3 : e);
  const drag = g.drag ?? 0;
  const y = g.lift * (1 - 0.75 * drag) * Math.sin(Math.PI * Math.pow(u, 0.85));
  const pitch = keyed(u, [[0, 0.7], [0.25, 0.25 * (1 - drag)], [0.6, -0.15], [1, -0.3]], 'smooth');
  return { z, y, pitch: pitch * (1 - 0.6 * drag) };
}

export function gaitPose(env: AnimEnv, g: GaitSpec, u: number): Pose {
  const P = clonePose(env.idle);
  if (g.carry) Object.assign(P, resolve(P, g.carry));
  const lk = g.limp;
  const kL = lk && lk.leg === 'l' ? 1 - lk.short : 1;
  const kR = lk && lk.leg === 'r' ? 1 - lk.short : 1;
  const fl = footAt(g, u, kL), fr = footAt(g, u + 0.5, kR);
  const w = g.width ?? 0.5;
  const idleW = Math.abs(env.idle.fl[0]) || 0.1;
  P.fl = [idleW * (w / 0.5) * 0.5 + (env.idle.fl[0] - idleW) * 0, fl.y, fl.z];
  P.fr = [-idleW * (w / 0.5) * 0.5, fr.y, fr.z];
  P.fpl = fl.pitch;
  P.fpr = fr.pitch;
  const mid = g.duty / 2;
  const bobPh = (u - mid) * TAU * 2;
  const run = !!g.run;
  const stomp = g.stomp ?? 0;
  // stomp: sharp dip right after each foot contact
  const contact = Math.max(0, Math.sin(((u * 2) % 1) * Math.PI)) ** 4;
  P.root = [
    (g.sway ?? 0.012) * Math.sin(u * TAU) + P.root[0],
    (run ? -1 : 1) * g.bob * Math.cos(bobPh) + P.root[1] - (g.crouch ?? 0) - stomp * contact,
    P.root[2],
  ];
  if (lk) {
    // body drops while the limping leg is loaded
    const loaded = Math.max(0, Math.sin((u + (lk.leg === 'l' ? 0 : 0.5)) * TAU));
    P.root[1] -= lk.dip * loaded;
    P.hip = addE(P.hip, [0, 0, (lk.leg === 'l' ? -1 : 1) * 0.12 * loaded]);
  }
  // legs must reach the ground: lower the body when a stride would overextend them (no floating, no foot sliding)
  {
    const j = env.a.side(1), s = env.a.s;
    const Lm = ((env.a.lengths.thigh + env.a.lengths.shin) / s) * (g.reach ?? 0.975);
    const hipH = (j.hip[1] - j.ankle[1]) / s;
    const cap = (x: number, y: number, z: number): number => Math.sqrt(Math.max(Lm * Lm - x * x - z * z, 0.01)) - hipH + y;
    const lo = Math.min(cap(P.fl[0], fl.y, fl.z), cap(P.fr[0], fr.y, fr.z));
    const k = 0.03, h = Math.max(k - Math.abs(P.root[1] - lo), 0) / k;
    P.root[1] = Math.min(P.root[1], lo) - h * h * k * 0.25; // polynomial smooth-min
  }
  P.sp = [P.sp[0] + g.lean, P.sp[1] * 0.4 + g.twist * Math.sin(u * TAU), (g.roll ?? 0.04) * Math.cos(u * TAU)];
  P.hip = addE(P.hip, [0.03 * Math.cos(bobPh * 0.5), -(g.hipYaw ?? 0.2) * Math.sin(u * TAU), 0.05 * Math.sin(u * TAU)]);
  const stab = g.headStab ?? 0.5;
  P.head = [P.head[0] - g.lean * 0.5 * stab, P.head[1] - g.twist * Math.sin(u * TAU) * stab, P.head[2]];
  if (g.loll) P.head = addE(P.head, [0.1 * g.loll * Math.sin(u * TAU * 2 + 0.5), g.loll * Math.sin(u * TAU + 1.2), g.loll * 0.8 * Math.sin(u * TAU * 2)]);
  // arms
  const sw = (g.armSwing ?? (run ? 0.17 : 0.08)) * Math.cos(u * TAU);
  const held = g.armHeld ?? (env.cfg.twoHand ? 0.2 : 0.35);
  const hl = g.heldSide === 'l';
  P.r.g = add3(P.r.g, [0, (run ? 0.04 : 0.01) * Math.sin(u * TAU * 2), sw * (hl ? 1 : held)]);
  P.l.g = add3(P.l.g, [0, -(run ? 0.04 : 0.01) * Math.sin(u * TAU * 2), -sw * (env.cfg.twoHand ? 0.2 : hl ? held : 1)]);
  g.tweak?.(P, u);
  return P;
}

export function gaitClip(env: AnimEnv, name: 'walk' | 'run', g: GaitSpec): ClipSpec {
  const speed = name === 'run' ? 1 : 0.35;
  return {
    name, duration: g.T, loop: true,
    pose: (c) => {
      const P = gaitPose(env, g, c.u);
      solve(env, c, P);
      const sw = -Math.cos(c.u * TAU) * (name === 'run' ? 1 : 0.5);
      secondary(env, c, c.t, c.u, speed, sw, Math.sin(c.u * TAU));
      env.extra?.(c, name, c.t, c.u, speed);
    },
  };
}

// ------------------------------------------------------------------------------------------------ actions
export interface ActionSpec {
  name: string;
  keys: Key[];
  dur: number;
  /** seconds of the damaging contact (omit for non-attacks) */
  hit?: number;
  /** per-frame tweak (t seconds) after key evaluation */
  tweak?: (P: Pose, t: number) => void;
  /** secondary motion strength 0..1 (default 0.6) */
  flow?: number;
}

/** key sequence from the idle pose; the first key at t=0 is usually `{ t: 0, p: {} }` */
export function actionClip(env: AnimEnv, o: ActionSpec): ClipSpec {
  return {
    name: o.name, duration: o.dur, loop: false, ...(o.hit !== undefined ? { hit: o.hit } : {}),
    pose: (c) => {
      const P = evalKeys(env.idle, o.keys, c.t);
      o.tweak?.(P, c.t);
      solve(env, c, P);
      secondary(env, c, c.t, c.t * 1.4, o.flow ?? 0.6, Math.max(P.fl[2], P.fr[2]) * 1.6, P.sp[1]);
      env.extra?.(c, o.name, c.t, c.t * 1.4, o.flow ?? 0.6);
    },
  };
}

// ------------------------------------------------------------------------------------------------ hit reaction
export interface HitSpec {
  dur?: number;
  /** torso recoil pitch (rad, negative = back) and yaw twist */
  recoil?: number;
  twist?: number;
  /** body drop (m) and backward shove (m) */
  drop?: number;
  shove?: number;
  /** weight of the hands flailing */
  arms?: number;
  /** extra tweak (t seconds, k = reaction envelope 0..1) */
  tweak?: (P: Pose, t: number, k: number) => void;
}

export function hitClip(env: AnimEnv, o: HitSpec = {}): ClipSpec {
  const dur = o.dur ?? 0.5;
  const rec = o.recoil ?? -0.35;
  const tw = o.twist ?? 0.18;
  return {
    name: 'hit', duration: dur, loop: false,
    pose: (c) => {
      const t = c.t;
      const k = ramp(t, 0, 0.08, 'out') * (1 - ramp(t, 0.1, dur, 'smooth')); // impact envelope
      const ring = damped(t, 5, 5); // overshoot wobble after the impact
      const P = clonePose(env.idle);
      P.sp = addE(P.sp, [rec * k + 0.06 * ring * (1 - k), tw * k, 0.1 * k]);
      P.head = addE(P.head, [rec * 1.1 * k + 0.1 * ring, tw * 0.8 * k, 0.05 * k]);
      P.hip = addE(P.hip, [-0.08 * k, 0, 0]);
      P.root = add3(P.root, [0, -(o.drop ?? 0.05) * k, -(o.shove ?? 0.1) * k]);
      const a = o.arms ?? 1;
      P.r.g = add3(P.r.g, [-0.08 * a * k, 0.05 * a * k, -0.06 * k]);
      P.l.g = add3(P.l.g, [0.08 * a * k, 0.05 * a * k, -0.06 * k]);
      o.tweak?.(P, t, k);
      solve(env, c, P);
      secondary(env, c, t, t * 2, 0.2, -0.6 * k, 0);
      env.extra?.(c, 'hit', t, t * 2, 0.2);
    },
  };
}

// ------------------------------------------------------------------------------------------------ death
export interface DeathSpec {
  dur?: number;
  /** 'back' falls backwards, 'front' forwards, 'side' to the character's left (+X) */
  fall?: 'back' | 'front' | 'side';
  /** buckle the knees first (seconds into the clip the topple starts) */
  topple?: number;
  /** arm flail strength */
  flail?: number;
  /** a staggering step before the fall (m) */
  stagger?: number;
  /** body thickness: how high the root sits when lying (m, reference) */
  thick?: number;
}

export function deathClip(env: AnimEnv, o: DeathSpec = {}): ClipSpec {
  const dur = o.dur ?? 1.9;
  const s = env.a.s;
  const fall = o.fall ?? 'back';
  const t0 = o.topple ?? 0.45;
  const flail = o.flail ?? 1;
  const thick = o.thick ?? 0.1;
  const sign = fall === 'front' ? 1 : -1;
  return {
    name: 'death', duration: dur, loop: false,
    pose: (c) => {
      const t = c.t;
      const k1 = ramp(t, 0, 0.3, 'out'); // hit reaction
      const kb = ramp(t, 0.12, t0, 'smooth'); // knees buckle
      const lie = ramp(t, t0, t0 + 0.75, 'in'); // topple
      const slam = ramp(t, t0 + 0.55, t0 + 0.8, 'out'); // body hits the ground
      const rest = ramp(t, t0 + 0.8, dur, 'smooth');
      const P = clonePose(env.idle);
      const dir = fall === 'back' ? -1 : 1;
      P.sp = [P.sp[0] + (-0.4 * k1 + 0.25 * kb) * (fall === 'front' ? -0.4 : 1), P.sp[1] + 0.25 * k1 * (fall === 'side' ? 0.3 : 1), P.sp[2] + 0.12 * k1];
      P.head = addE(P.head, [-0.35 * k1 - 0.25 * slam * (fall === 'back' ? 1 : -0.4), 0.18 * k1, 0.08 * k1 + 0.1 * rest]);
      // knees give
      P.root = add3(P.root, [0, -0.2 * kb * (1 - lie), (o.stagger ?? 0.1) * dir * 0 - 0.1 * k1 * (fall === 'back' ? 1 : 0)]);
      P.fl = add3(P.fl, [0.08 * k1, 0, (o.stagger ?? 0.12) * (fall === 'front' ? 1 : -1) * k1 * 0.5 - 0.05 * kb]);
      P.fr = add3(P.fr, [-0.08 * k1, 0, (o.stagger ?? 0.12) * (fall === 'front' ? 1 : -1) * k1 - 0.04 * kb]);
      const roll = 1.5 * lie;
      if (fall === 'side') P.rootRot = [0.1 * lie, 0, 1.5 * lie];
      else P.rootRot = [sign * roll, 0, 0.12 * lie * (fall === 'back' ? 1 : -1)];
      P.root[1] = Math.max(P.root[1] + 0.02, 0) + thick * lie;
      P.root[2] += (fall === 'back' ? -0.5 : fall === 'front' ? 0.5 : 0) * lie * s * 0.9;
      if (fall === 'side') P.root[0] += 0.5 * lie * s;
      // limbs go slack
      P.fl[1] += 0.22 * slam * (1 - rest * 0.5);
      P.fr[1] += 0.16 * slam;
      P.fl[2] += -0.1 * slam * dir * -1;
      const fl = flail;
      P.r = { ...P.r, g: V(-0.3 - 0.12 * slam * fl, -0.1 + 0.25 * k1 * fl - 0.35 * slam, 0.1 - 0.2 * slam), c: 0.2, b: V(0, 0.2, 1), e: V(-1, 0, 0) };
      P.l = { ...P.l, g: V(0.3 + 0.12 * slam * fl, -0.1 + 0.25 * k1 * fl - 0.35 * slam, 0.1 - 0.2 * slam), c: 0.2, b: V(0, 0.2, 1), e: V(1, 0, 0) };
      solve(env, c, P);
      secondary(env, c, t, t, 0.3, -0.5 * k1, 0);
      env.extra?.(c, 'death', t, t, 0.3);
    },
  };
}

// ------------------------------------------------------------------------------------------------ spawn
export function spawnClip(env: AnimEnv, keys: Key[], dur: number, tweak?: (P: Pose, t: number) => void): ClipSpec {
  return {
    name: 'spawn', duration: dur, loop: false,
    pose: (c) => {
      const P = evalKeys(env.idle, keys, c.t);
      tweak?.(P, c.t);
      solve(env, c, P);
      secondary(env, c, c.t, c.t * 1.5, 0.2, 0, 0);
      env.extra?.(c, 'spawn', c.t, c.t * 1.5, 0.2);
    },
  };
}

export { type Key, type Pose, type Hand, V, blendPose, bump, evalKeys, keyed, ramp, damped };
export type { Ease, E3 };
