// Orc / brute / monk animation: heavy, weighted clips for the humanoid rig. Locomotion is a parametrised planted-foot gait (stomp,
// sway, shoulder roll, weapon-arm inertia); actions are key-pose sequences (evalKeys) solved by the humanoid IK (`applyPose`), so feet
// stay planted and two-hand grips stay together. Death / hit / spawn are authored here (humanoid defaults are hero-neutral).
//
// Chest-frame conventions (see humanoid/anim/rig.ts): +X = character's left, +Y up, +Z forward, metres at reference scale (x body scale).
// Hand: g = grip point, b = direction the weapon tip points, EDGE helper below: weapon edge direction; the solver wants the palm normal `e`
// which is the opposite of the edge for our weapon frame (kit.ts weaponFrame: weapon +Z = hand -X(right) / +X(left)).
import { type ClipSpec, type PoseCtx } from '../../core/anim/clip.ts';
import { type Ease, bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type Key, type Pose, type SolveCfg, V, applyPose, basePose, blendPose, chainsOf, clonePose, evalKeys } from '../humanoid/index.ts';

const TAU = Math.PI * 2;
export type PosePatch = Key['p'];
export type Hand = Pose['r'];
type V3 = [number, number, number];

/** hand from grip point, blade (tip) direction, weapon edge direction, finger curl */
export const grip = (g: V3, blade: V3, edge: V3, c = 1): Hand => ({ g, b: blade, e: [-edge[0], -edge[1], -edge[2]], c });
/** the same as a partial patch for Key.p.r / Key.p.l */
export const gp = (g?: V3, blade?: V3, edge?: V3, c?: number): Partial<Hand> => ({
  ...(g ? { g } : {}), ...(blade ? { b: blade } : {}), ...(edge ? { e: [-edge[0], -edge[1], -edge[2]] as V3 } : {}), ...(c !== undefined ? { c } : {}),
});

export interface Gait {
  /** cycle seconds */
  T: number;
  /** stance fraction of the cycle */
  duty: number;
  /** stride length (reference metres) */
  sweep: number;
  /** foot lift (reference metres) */
  lift: number;
  /** vertical bob amplitude */
  bob: number;
  /** extra forward torso lean (rad) */
  lean: number;
  /** spine twist amplitude (rad) */
  twist: number;
  /** lateral root sway (reference metres) */
  sway: number;
  /** body drop at heel strike (reference metres): the stomp */
  stomp: number;
  /** free-arm swing (reference metres of grip travel) */
  arm: number;
  /** pelvis roll (rad) */
  roll: number;
}

export const WALK: Gait = { T: 1.08, duty: 0.66, sweep: 0.5, lift: 0.1, bob: 0.02, lean: 0.06, twist: 0.12, sway: 0.03, stomp: 0.02, arm: 0.09, roll: 0.07 };
export const RUN: Gait = { T: 0.7, duty: 0.42, sweep: 0.86, lift: 0.19, bob: 0.04, lean: 0.2, twist: 0.2, sway: 0.03, stomp: 0.04, arm: 0.17, roll: 0.09 };

export const gaitSpeed = (g: Gait): number => g.sweep / (g.duty * g.T);

export interface Special {
  keys: Key[];
  dur: number;
  hit?: number;
  /** the clip loops (its pose function must be periodic in t / dur): e.g. a boss charge cycle */
  loop?: boolean;
  /** final per-frame adjustment (impact shake etc.) */
  extra?: (P: Pose, t: number) => Pose;
}

export interface OrcStyle {
  cfg: SolveCfg;
  /** carry pose: stance, torso, hands, weapon */
  idle: Pose;
  /** arm carriage while moving, patched over idle */
  walk?: PosePatch;
  run?: PosePatch;
  gait?: { walk?: Partial<Gait>; run?: Partial<Gait> };
  attack: Key[];
  attackDur: number;
  attackHit: number;
  attack2?: Key[];
  attack2Dur?: number;
  attack2Hit?: number;
  specials?: Record<string, Special>;
  /** breathing / weight-shift amplitude multiplier */
  breath?: number;
  /** 0..1.5: flinch size, stomp accents, slump on death */
  weight?: number;
  death?: 'back' | 'forward';
  /** death: weapon hand relaxes (open fingers) */
  spawnRoar?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
const footAt = (g: Gait, ph: number): { z: number; y: number; pitch: number } => {
  const f = ph - Math.floor(ph);
  const run = g.sweep > 0.7;
  if (f < g.duty) {
    const u = f / g.duty;
    const z = g.sweep * 0.5 - g.sweep * u;
    const heel = u > 0.55 ? ramp(u, 0.55, 1, 'smooth') : 0;
    return { z, y: 0, pitch: heel * (run ? 0.75 : 0.55) - (u < 0.08 ? (0.08 - u) * 3 : 0) };
  }
  const u = (f - g.duty) / (1 - g.duty);
  const e = u * u * (3 - 2 * u);
  const z = -g.sweep * 0.5 + g.sweep * (run ? e * 0.7 + u * 0.3 : e);
  const y = g.lift * Math.sin(Math.PI * Math.pow(u, 0.85));
  const pitch = keyed(u, [[0, 0.7], [0.25, 0.25], [0.6, -0.15], [1, -0.3]], 'smooth');
  return { z, y, pitch };
};

const patch = (base: Pose, over: PosePatch | undefined): Pose => {
  if (!over) return base;
  const o = clonePose(base);
  const { r, l, ...rest } = over;
  Object.assign(o, rest);
  if (r) o.r = { g: r.g ?? base.r.g, b: r.b ?? base.r.b, e: r.e ?? base.r.e, c: r.c ?? base.r.c };
  if (l) o.l = { g: l.g ?? base.l.g, b: l.b ?? base.l.b, e: l.e ?? base.l.e, c: l.c ?? base.l.c };
  return o;
};

function idlePose(st: OrcStyle, u: number): Pose {
  const P = clonePose(st.idle);
  const k = st.breath ?? 1;
  const br = Math.sin(u * TAU);
  const br2 = Math.sin(u * TAU * 2 + 1);
  P.sp = [P.sp[0] + 0.022 * k * br, P.sp[1] + 0.03 * k * br2, P.sp[2] + 0.012 * k * Math.sin(u * TAU + 0.6)];
  P.head = [P.head[0] - 0.02 * k * br, P.head[1] + 0.07 * k * Math.sin(u * TAU * 1 + 0.4), P.head[2] + 0.02 * k * Math.sin(u * TAU + 2)];
  P.hip = [P.hip[0], P.hip[1], P.hip[2] + 0.035 * k * Math.sin(u * TAU)];
  // slow weight shift from foot to foot
  const shift = Math.sin(u * TAU);
  P.root = [P.root[0] + 0.012 * k * shift, P.root[1] + 0.012 * k * (br - 1), P.root[2]];
  P.fl = [P.fl[0], P.fl[1], P.fl[2]];
  P.r.g = [P.r.g[0], P.r.g[1] + 0.01 * k * br, P.r.g[2] + 0.006 * k * Math.sin(u * TAU + 1)];
  P.l.g = [P.l.g[0], P.l.g[1] + 0.01 * k * br, P.l.g[2] + 0.006 * k * Math.sin(u * TAU + 2)];
  P.shr = 0.045 * k * br;
  P.shl = 0.045 * k * br;
  return P;
}

function locoPose(st: OrcStyle, a: Anatomy, kind: 'walk' | 'run', u: number): Pose {
  const s = a.s;
  const g: Gait = { ...(kind === 'run' ? RUN : WALK), ...(st.gait?.[kind] ?? {}) };
  const w = st.weight ?? 1;
  const P = patch(clonePose(st.idle), st[kind]);
  const fl = footAt(g, u), fr = footAt(g, u + 0.5);
  P.fl = [st.idle.fl[0] * 0.55, fl.y * s, fl.z * s];
  P.fr = [st.idle.fr[0] * 0.55, fr.y * s, fr.z * s];
  P.fpl = fl.pitch;
  P.fpr = fr.pitch;
  const mid = g.duty / 2;
  const ph = (u - mid) * TAU * 2;
  // two bobs per cycle (one per step); the stomp is a sharp drop when each foot lands
  const stompL = Math.max(0, Math.cos((u - 0.0) * TAU * 2 + 0.2)) ** 6;
  const baseDrop = kind === 'run' ? 0.05 : 0.025;
  P.root = [g.sway * s * Math.sin(u * TAU) * w, (kind === 'run' ? -1 : 1) * g.bob * s * Math.cos(ph) - baseDrop * s - g.stomp * s * w * stompL, 0];
  P.sp = [P.sp[0] * 0.6 + g.lean, P.sp[1] * 0.5 + g.twist * Math.sin(u * TAU), 0.05 * Math.cos(u * TAU) * w];
  P.hip = [0.035 * Math.cos(ph * 0.5), -g.twist * 1.1 * Math.sin(u * TAU) + P.hip[1] * 0.3, g.roll * Math.sin(u * TAU)];
  P.head = [-0.05 - g.lean * 0.5, -0.05 * Math.sin(u * TAU), 0.03 * Math.sin(u * TAU)];
  P.shr = 0.06 * Math.sin(u * TAU);
  P.shl = -0.06 * Math.sin(u * TAU);
  // arm swing: the free hand pumps with the opposite leg, the weapon hand moves less but its weapon tip lags / bobs
  const sw = g.arm * Math.cos(u * TAU);
  const heldR = st.cfg.twoHand ? 0.15 : 0.5;
  const heldL = st.cfg.twoHand ? 0.15 : 1;
  P.r.g = [P.r.g[0], P.r.g[1] + (kind === 'run' ? 0.045 : 0.012) * Math.sin(u * TAU * 2), P.r.g[2] + sw * heldR];
  P.l.g = [P.l.g[0], P.l.g[1] - (kind === 'run' ? 0.045 : 0.012) * Math.sin(u * TAU * 2), P.l.g[2] - sw * heldL];
  P.r.b = [P.r.b[0], P.r.b[1] + 0.06 * Math.sin(u * TAU * 2), P.r.b[2]];
  return P;
}

// ---------------------------------------------------------------------------------------------------------------------
// secondary motion (skirts, hair, scarf, cape, tail, ears): driven by leg swing / twist with phase lag
function secondary(c: PoseCtx, sk: Skeleton, t: number, phase: number, speed: number, swing: number, twist: number): void {
  const ch = chainsOf(sk);
  const wave = (i: number, f: number, amp: number): number => amp * Math.sin(phase * TAU * f - i * 0.8);
  if (ch.skirt) {
    c.set('skirt_f', -0.55 * Math.max(swing, 0) - 0.08 * speed + 0.03 * Math.sin(t * 2), 0, 0);
    c.set('skirt_b', 0.5 * Math.max(-swing, 0) + 0.12 * speed + 0.03 * Math.sin(t * 2 + 1), 0, 0);
    c.set('skirt_l', 0, 0, -0.12 * Math.max(twist, 0) - 0.04 * speed);
    c.set('skirt_r', 0, 0, 0.12 * Math.max(-twist, 0) + 0.04 * speed);
  }
  ch.hair.forEach((n, i) => c.set(n, 0.12 * speed + wave(i, 1, 0.1 + 0.05 * speed) + 0.1 * Math.abs(swing), 0.1 * twist, 0));
  ch.scarf.forEach((n, i) => c.set(n, 0.35 * speed + wave(i, 1, 0.22) + 0.1 * i * speed, wave(i, 1, 0.12 + 0.1 * speed) + 0.2 * twist, 0));
  ch.cape.forEach((n, i) => c.set(n, 0.25 * speed + wave(i, 1, 0.12) + 0.08 * i * speed, 0.1 * twist, 0));
  ch.tail.forEach((n, i) => c.set(n, 0.1 * speed + wave(i, 1, 0.16), 0.25 * Math.sin(phase * TAU - i) * (0.4 + speed) + 0.2 * twist, 0));
  if (ch.ears) {
    c.set('ear_l', -0.04 * speed + wave(0, 2, 0.05), 0, 0.12 * speed);
    c.set('ear_r', -0.04 * speed + wave(0, 2, 0.05), 0, -0.12 * speed);
  }
}

const swingMetric = (P: Pose): number => Math.max(P.fl[2], P.fr[2]) * 0.8;

// ---------------------------------------------------------------------------------------------------------------------
const scale3 = (v: V3, s: number): V3 => [v[0] * s, v[1] * s, v[2] * s];
/** style data is authored in reference metres; root / foot / hip-move offsets are world metres, so scale them by the body scale once */
const scalePatch = (p: PosePatch, s: number): PosePatch => ({
  ...p,
  ...(p.root ? { root: scale3(p.root, s) } : {}), ...(p.fl ? { fl: scale3(p.fl, s) } : {}), ...(p.fr ? { fr: scale3(p.fr, s) } : {}),
  ...(p.hipMove ? { hipMove: scale3(p.hipMove, s) } : {}),
});
const scaleKeys = (keys: Key[] | undefined, s: number): Key[] | undefined => keys?.map((k) => ({ ...k, p: scalePatch(k.p, s) }));
function scaleStyle(st: OrcStyle, s: number): OrcStyle {
  const idle = scalePatch(st.idle, s) as Pose;
  const specials = st.specials ? Object.fromEntries(Object.entries(st.specials).map(([k, v]) => [k, { ...v, keys: scaleKeys(v.keys, s)! }])) : undefined;
  return {
    ...st, idle,
    ...(st.walk ? { walk: scalePatch(st.walk, s) } : {}), ...(st.run ? { run: scalePatch(st.run, s) } : {}),
    attack: scaleKeys(st.attack, s)!,
    ...(st.attack2 ? { attack2: scaleKeys(st.attack2, s)! } : {}),
    ...(specials ? { specials } : {}),
  };
}

export function orcClips(a: Anatomy, sk: Skeleton, st0: OrcStyle): ClipSpec[] {
  const s = a.s;
  const st = scaleStyle(st0, s);
  const w = st.weight ?? 1;
  const solve = (c: PoseCtx, P: Pose): void => applyPose(c, a, P, st.cfg);
  const out: ClipSpec[] = [];

  out.push({
    name: 'idle', duration: 2.8, loop: true,
    pose: (c) => {
      solve(c, idlePose(st, c.u));
      secondary(c, sk, c.t, c.u, 0, 0, 0);
    },
  });
  out.push({
    name: 'walk', duration: (st.gait?.walk?.T ?? WALK.T), loop: true,
    pose: (c) => {
      solve(c, locoPose(st, a, 'walk', c.u));
      secondary(c, sk, c.t, c.u, 0.35, -Math.cos(c.u * TAU) * 0.5, Math.sin(c.u * TAU));
    },
  });
  out.push({
    name: 'run', duration: (st.gait?.run?.T ?? RUN.T), loop: true,
    pose: (c) => {
      solve(c, locoPose(st, a, 'run', c.u));
      secondary(c, sk, c.t, c.u, 1, Math.cos(c.u * TAU), Math.sin(c.u * TAU));
    },
  });

  const action = (name: string, keys: Key[], dur: number, hit: number | undefined, extra?: (P: Pose, t: number) => Pose, loop = false): ClipSpec => ({
    name, duration: dur, loop, ...(hit !== undefined ? { hit } : {}),
    pose: (c) => {
      let P = evalKeys(st.idle, keys, c.t);
      if (extra) P = extra(P, c.t);
      solve(c, P);
      secondary(c, sk, loop ? c.u * Math.PI : c.t, loop ? c.u : c.t * 1.4, 0.6, swingMetric(P) * 2, P.sp[1]);
    },
  });
  out.push(action('attack', st.attack, st.attackDur, st.attackHit));
  if (st.attack2) out.push(action('attack2', st.attack2, st.attack2Dur ?? 1, st.attack2Hit));
  for (const [name, sp] of Object.entries(st.specials ?? {})) out.push(action(name, sp.keys, sp.dur, sp.hit, sp.extra, sp.loop));

  // ---- hit: a flinch whose size follows the weight; shoulders hunch, weapon arm sags then recovers
  const hitKeys: Key[] = [
    { t: 0, p: {} },
    { t: 0.09, ease: 'out', p: { sp: [-0.3 * w - 0.05, 0.22, 0.1], head: [-0.42, 0.18, 0.05], hip: [-0.08, 0, 0], root: V(0, -0.05 * s, -0.09 * s), fl: V(0.1, 0, 0.1 * s), fr: V(-0.1, 0, -0.16 * s), shr: 0.12, shl: 0.12 } },
    { t: 0.26, ease: 'smooth', p: { sp: [-0.1 * w, 0.06, 0.04], head: [-0.15, 0.04, 0], root: V(0, -0.03 * s, -0.05 * s), shr: 0.04, shl: 0.04 } },
    { t: 0.45, ease: 'smooth', p: { ...st.idle } },
  ];
  out.push({
    name: 'hit', duration: 0.45, loop: false,
    pose: (c) => {
      const P = evalKeys(st.idle, hitKeys, c.t);
      solve(c, P);
      secondary(c, sk, c.t, c.t * 2, 0.2, -0.6 * keyed(c.t, [[0, 0], [0.1, 1], [0.45, 0]], 'smooth'), 0);
    },
  });

  // ---- death: stagger, knees buckle, topple (back or forward), bounce on impact, settle
  const dir = st.death === 'forward' ? -1 : 1;
  out.push({
    name: 'death', duration: 1.9, loop: false,
    pose: (c) => {
      const t = c.t;
      const P = clonePose(st.idle);
      const k1 = ramp(t, 0, 0.3, 'out'); // hit reaction
      const k2 = ramp(t, 0.22, 0.85, 'in'); // knees buckle
      const lie = ramp(t, 0.35, 1.05, 'smooth'); // topple
      const land = bump(t, 1.0, 1.04, 1.1, 1.3, 'smooth');
      const bounce = damped(Math.max(0, t - 1.02), 3.2, 4.5) * ramp(t, 1.0, 1.04, 'linear');
      P.sp = [dir * (-0.38 * k1) + 0.22 * k2 * (dir > 0 ? 1 : -0.2), 0.22 * k1, 0.1 * k1];
      P.head = [dir * (-0.4 * k1) - 0.25 * land * dir, 0.18 * k1, 0];
      P.fl = [0.1 * k1, 0, 0.1 * s * k1 - 0.1 * s * k2];
      P.fr = [-0.1 * k1, 0, -0.14 * s * k1 - 0.05 * s * k2];
      const fall = (Math.PI / 2 - 0.1 + 0.05 * bounce) * lie; // rotate about X; + = topple forward, - = backward
      P.rootRot = [-dir * fall, 0, 0.1 * lie * dir];
      const drop = 0.2 * s * lie; // lift so the body lies on the ground rather than in it
      P.root = [0, 0.04 * s * (1 - lie) - 0.07 * s * k2 * (1 - lie) + drop + 0.03 * s * Math.max(0, bounce), -dir * 0.45 * lie * s];
      P.fl[1] = 0.14 * s * lie;
      P.fr[1] = 0.1 * s * lie;
      P.r = { ...P.r, g: [P.r.g[0] - 0.12 * lie, P.r.g[1] + 0.2 * k1 - 0.3 * lie, P.r.g[2] - 0.1 * lie], c: 0.15 };
      P.l = { ...P.l, g: [P.l.g[0] + 0.14 * lie, P.l.g[1] + 0.2 * k1 - 0.3 * lie, P.l.g[2] - 0.05 * lie], c: 0.15 };
      solve(c, P);
      secondary(c, sk, t, t, 0.3, -0.5 * k1, 0);
    },
  });

  // ---- spawn: rise from a crouch; optional roar / chest beat
  const roar = st.spawnRoar;
  const spawnKeys: Key[] = [
    { t: 0, p: { root: V(0, -0.36 * s, 0), sp: [0.55, 0, 0], head: [0.35, 0, 0], fl: V(0.16, 0, 0.1 * s), fr: V(-0.16, 0, -0.1 * s), r: { g: V(-0.3, -0.36, 0.1), c: 0.35 }, l: { g: V(0.3, -0.36, 0.1), c: 0.35 } } },
    { t: 0.4, ease: 'smooth', p: { root: V(0, -0.22 * s, 0), sp: [0.35, 0.0, 0], head: [0.1, 0, 0] } },
    roar
      ? { t: 0.78, ease: 'out', p: { ...st.idle, root: V(0, 0.02 * s, 0), sp: [-0.28, 0.1, 0], head: [-0.42, 0, 0], shr: 0.1, shl: 0.1 } }
      : { t: 0.8, ease: 'out', p: { ...st.idle, root: V(0, 0.02 * s, 0), sp: [-0.1, 0, 0], head: [-0.12, 0, 0] } },
    { t: 1.2, ease: 'smooth', p: { ...st.idle } },
  ];
  out.push({
    name: 'spawn', duration: 1.2, loop: false,
    pose: (c) => {
      solve(c, evalKeys(st.idle, spawnKeys, c.t));
      secondary(c, sk, c.t, c.t * 1.5, 0.2, 0, 0);
    },
  });
  return out;
}

export { blendPose, basePose };
export type { Ease };
