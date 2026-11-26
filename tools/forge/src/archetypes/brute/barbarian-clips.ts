// Barbarian animation: a hunched, knuckle-forward brute with a huge club on the right shoulder.
//   idle    heavy breathing, weight shift, club resting on the shoulder, left fist dangling forward
//   walk    wide rolling lumber (shoulders counter-roll, heel stomps, the club bobs on the shoulder)
//   run     charging low, club trailing behind the hip, big pumping off-arm, stomp on every footfall
//   attack  rear back and coil with the club cocked high behind the head (held), then a diagonal overhead smash that lands at 0.35 s
//   hit / death / spawn  flinch with damped overshoot, buckle + topple (club slides off), rise with a roar
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import type { Vec3 } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type Hand, type Key, type Pose, V, applyPose, clonePose, evalKeys } from '../humanoid/index.ts';
import {
  type AnimEnv, type GaitSpec, actionClip, damped, finalize, gaitClip, gaitSpeedOf, grip, hang, hitClip, idleClip, makeEnv, poseOf, ramp, secondary, spawnClip, stance,
} from '../humans/anim.ts';

export const RUN_SPEED = 3.0;

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// ---- carries (chest frame, reference metres)
/** right fist beside the shoulder, club shaft up and OUT (head high over the shoulder, visible from front, side and above) */
export const CLUB_SHOULDER: Hand = grip(V(-0.36, 0.1, 0.34), norm(V(-0.42, 0.86, 0.12)), V(0.9, 0.35, 0.2), 1);
/** right fist out in front of the shoulder, club raised high and forward-out (run: a charging berserker) */
export const CLUB_TRAIL: Hand = grip(V(-0.4, 0.06, 0.42), norm(V(-0.3, 0.82, 0.48)), V(0.9, 0.3, 0.3), 1);
/** left fist dangling low and forward, knuckles leading */
export const KNUCKLES = (curl = 0.8): Hand => grip(V(0.37, -0.42, 0.27), norm(V(-0.05, -0.2, 1)), V(-0.95, 0.15, -0.15), curl);

/** run gait for ground speed `RUN_SPEED` at body scale `s` */
export function runSpec(s: number): GaitSpec {
  const T = 0.64, duty = 0.42;
  return {
    T, duty, sweep: Number(((RUN_SPEED * duty * T) / s).toFixed(4)), lift: 0.19, bob: 0.034, lean: 0.2, twist: 0.3, hipYaw: 0.3, roll: 0.14, sway: 0.05, crouch: 0.035, width: 1.05,
    armSwing: 0.2, armHeld: 0.2, heldSide: 'r', stomp: 0.03, headStab: 0.55, run: true, reach: 1.0,
    carry: { r: CLUB_TRAIL, sp: [0.0, -0.1, 0] },
    tweak: (P, u) => {
      const w = Math.sin(u * Math.PI * 2);
      const w2 = Math.sin(u * Math.PI * 4);
      // pumping off-arm: a big, late swing with the fist coming up to the chest on the forward stroke
      P.l.g = [0.4 - 0.05 * w, -0.34 + 0.2 * Math.max(0, -w) - 0.06 * Math.max(0, w), 0.1 - 0.34 * w];
      P.l.c = 1;
      // the club bounces with every footfall
      P.r.g = [P.r.g[0], P.r.g[1] + 0.035 * w2, P.r.g[2] - 0.03 * w];
      P.r.b = norm([P.r.b[0], P.r.b[1] + 0.07 * w2, P.r.b[2]]);
    },
  };
}

export const WALK: GaitSpec = {
  T: 1.14, duty: 0.66, sweep: 0.58, lift: 0.1, bob: 0.02, lean: 0.06, twist: 0.22, hipYaw: 0.2, roll: 0.16, sway: 0.05, crouch: 0.02, width: 1.1, armSwing: 0.12,
  armHeld: 0.25, heldSide: 'r', stomp: 0.03, headStab: 0.5, reach: 0.975,
  tweak: (P, u) => {
    const w = Math.sin(u * Math.PI * 2);
    const w2 = Math.sin(u * Math.PI * 4);
    P.l.g = [0.43 + 0.02 * w, -0.43 + 0.04 * Math.max(0, -w), 0.2 - 0.17 * w];
    P.r.g = [P.r.g[0], P.r.g[1] + 0.016 * w2, P.r.g[2]];
  },
};

/** ground speeds written to GLB extras.speed */
export const speedsFor = (a: Anatomy): { walk: number; run: number } => ({
  walk: Number(gaitSpeedOf(WALK, a.s).toFixed(3)),
  run: Number(gaitSpeedOf(runSpec(a.s), a.s).toFixed(3)),
});

// ---- helpers for authoring keys
type Patch = Key['p'];
/** left hand takes the club shaft `dist` above the right hand (two-handed grip) */
const twoHand = (r: Hand, dist = 0.3): Partial<Hand> => ({ g: [r.g[0] + r.b[0] * dist, r.g[1] + r.b[1] * dist, r.g[2] + r.b[2] * dist], b: r.b, e: [-r.e[0], -r.e[1], -r.e[2]], c: 1 });

export function barbarianClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  const idle: Pose = poseOf(stance(0.07, 0.1, 0.075), {
    sp: [0.2, -0.16, 0.03], hip: [0.05, 0.12, -0.02], head: [-0.42, 0.02, 0],
    r: CLUB_SHOULDER, l: KNUCKLES(), shr: 0.1, shl: 0, poleR: V(-0.8, -0.5, -0.3), poleL: V(0.6, -0.4, -0.5),
  });
  const env = makeEnv(a, sk, idle, {}, { flow: 1.15 });
  const run = runSpec(a.s);

  // ---- attack: gather, coil (held), swing, smash, planted follow-through, drag back, shoulder the club
  // Hand targets are authored in WORLD space (grip centre + where the club points) and converted to the chest frame with
  
  const ground = (g: Vec3, b: Vec3): Hand => grip(g, norm(b), V(0.95, 0.1, 0.3), 1);
  const keys: Key[] = [
    { t: 0, p: {} },
    // gather: weight sinks onto the back foot, club peels off the shoulder, torso starts to turn
    { t: 0.09, ease: 'out', p: { r: grip(V(-0.26, 0.28, 0.0), norm(V(0.1, 0.62, -0.77)), V(0.9, 0.3, 0.2), 1), sp: [-0.05, -0.55, 0.06], hip: [0, -0.2, 0], root: V(0, -0.1, -0.06), fl: V(0.08, 0, 0.14), fr: V(-0.09, 0, -0.18), head: [-0.1, 0.3, 0], l: { g: V(0.38, 0.12, 0.3), b: V(0, 0.2, 1), e: V(1, 0, 0), c: 0.5 } } },
    // full coil: club cocked high behind the head, chest thrown out, off-arm up toward the target
    { t: 0.16, ease: 'out', p: { r: ground(V(-0.208, 0.513, 0.198), V(-0.457, 0.883, 0.106)), sp: [-0.3, -0.9, 0.12], hip: [-0.05, -0.35, 0], root: V(0, -0.07, -0.1), fl: V(0.08, 0, 0.17), fr: V(-0.1, 0, -0.3), head: [-0.1, 0.55, 0], l: { g: V(0.4, 0.3, 0.36), b: V(0, 0.4, 0.9), e: V(1, 0, 0), c: 0.3 }, shr: 0.2 } },
    // hold: a trembling beat at the top of the coil (this is what the player reads)
    { t: 0.22, ease: 'smooth', p: { r: ground(V(-0.15, 0.543, 0.231), V(-0.439, 0.885, 0.153)), sp: [-0.34, -0.95, 0.14], root: V(0, -0.075, -0.11) } },
    // the club comes over the top
    { t: 0.28, ease: 'in', p: { r: ground(V(-0.146, 0.59, 0.136), V(0.136, 0.99, 0.028)), sp: [0.12, -0.2, 0.05], hip: [0.05, -0.05, 0], root: V(0, -0.1, 0.02), fl: V(0.09, 0.08, 0.34), fr: V(-0.1, 0, -0.24), head: [0.1, 0.1, 0], l: { g: V(0.4, 0.05, 0.1), b: V(0, -0.3, 1), e: V(1, 0, 0), c: 0.8 } } },
    // IMPACT: body falls into the strike, club head slams the ground ahead, left foot stamps down
    { t: 0.35, ease: 'in', p: { r: ground(V(-0.393, 0.154, 0.387), V(-0.369, -0.01, 0.929)), sp: [0.66, 0.3, -0.05], hip: [0.1, 0.25, 0], root: V(0, -0.2, 0.14), fl: V(0.1, 0, 0.44), fr: V(-0.1, 0, -0.2), head: [-0.15, 0.1, 0], l: { g: V(0.52, -0.1, -0.2), b: V(0.3, -0.2, -0.9), e: V(1, 0, 0), c: 1 }, shr: 0 } },
    // follow-through: the torso keeps falling over the planted club
    { t: 0.41, ease: 'out', p: { r: ground(V(-0.397, 0.184, 0.32), V(-0.404, 0.058, 0.913)), sp: [0.74, 0.34, -0.05], root: V(0, -0.23, 0.16), head: [-0.2, 0.1, 0] } },
    // rebound: the ground fights back, the head bounces up, torso rebounds
    { t: 0.5, ease: 'smooth', p: { r: ground(V(-0.318, 0.149, 0.428), V(-0.257, 0.041, 0.965)), sp: [0.56, 0.2, 0], hip: [0.08, 0.15, 0], root: V(0, -0.17, 0.12), head: [-0.2, 0.05, 0] } },
    // drag: the head scrapes back across the dirt as he straightens
    { t: 0.66, ease: 'smooth', p: { r: ground(V(-0.314, 0.077, 0.438), V(-0.123, -0.435, 0.892)), sp: [0.4, 0.1, 0], root: V(0, -0.12, 0.08), head: [-0.2, 0, 0] } },
    // heave the club up and forward
    { t: 0.82, ease: 'smooth', p: { r: ground(V(-0.294, 0.037, 0.408), V(-0.129, 0.459, 0.879)), sp: [0.3, 0, 0], root: V(0, -0.1, 0.05) } },
    // onto the shoulder
    { t: 0.92, ease: 'smooth', p: { r: CLUB_SHOULDER } },
    { t: 1.0, ease: 'smooth', p: { ...idle } },
  ];
  void twoHand;

  // ---- spawn: rises from a crouch, roars with the club raised, settles
  const spawn: Key[] = [
    { t: 0, p: { root: V(0, -0.5, 0), sp: [0.95, -0.2, 0], head: [0.3, 0, 0], fl: V(0.12, 0, 0.22), fr: V(-0.12, 0, -0.1), r: ground(V(-0.241, 0.388, 0.427), V(0.2, 0.753, 0.627)), l: { g: V(0.36, -0.42, 0.45), b: V(0, -0.2, 1), e: V(1, 0, 0), c: 0.9 }, hip: [0.2, 0.1, 0] } },
    { t: 0.3, ease: 'smooth', p: { root: V(0, -0.4, 0), sp: [0.85, -0.25, 0], head: [0.1, 0, 0], r: ground(V(-0.206, 0.38, 0.466), V(0.263, 0.542, 0.799)) } },
    { t: 0.55, ease: 'smooth', p: { root: V(0, -0.3, 0), sp: [0.75, -0.3, 0], head: [-0.1, 0, 0], r: ground(V(-0.18, 0.359, 0.49), V(0.305, 0.314, 0.899)) } },
    // heave up: chest out, head thrown back, club hoisted overhead, off-fist clenched at the chest
    { t: 0.95, ease: 'out', p: { root: V(0, -0.04, 0), sp: [-0.3, -0.3, 0.05], head: [-0.65, 0.12, 0], hip: [-0.05, 0.05, 0], r: grip(V(-0.2, 0.55, 0.12), norm(V(0.1, 0.9, -0.3)), V(0.95, 0.2, 0.2), 1), l: { g: V(0.3, 0.12, 0.34), b: V(0, 0.1, 1), e: V(1, 0, 0), c: 1 }, shr: 0.25, shl: 0.2 } },
    { t: 1.25, ease: 'smooth', p: { sp: [-0.2, -0.28, 0.04], head: [-0.5, 0.05, 0], root: V(0, -0.02, 0) } },
    { t: 1.8, ease: 'smooth', p: { ...idle } },
  ];

  return [
    idleClip(env, { dur: 3.0, breath: 0.03, look: 0.1, shift: 0.014 }),
    gaitClip(env, 'walk', WALK),
    gaitClip(env, 'run', run),
    actionClip(env, { name: 'attack', dur: 1.0, hit: 0.35, keys, flow: 0.9 }),
    hitClip(env, { dur: 0.55, recoil: -0.4, twist: 0.3, drop: 0.07, shove: 0.12, arms: 0.7 }),
    deathClip(env, 2.2),
    spawnClip(env, spawn, 1.8),
  ];
}

// ---- death: stagger, knees buckle, the club slides off, topples forward face-down, limp settle
function deathClip(env: AnimEnv, dur: number): ClipSpec {
  const s = env.a.s;
  return {
    name: 'death', duration: dur, loop: false,
    pose: (c: PoseCtx) => {
      const t = c.t;
      const k1 = ramp(t, 0, 0.16, 'out'); // struck: reel back
      const kb = ramp(t, 0.14, 0.62, 'smooth'); // knees buckle
      const lie = ramp(t, 0.62, 1.4, 'in'); // topple
      const slam = ramp(t, 1.2, 1.45, 'out'); // body hits the ground
      const rest = ramp(t, 1.45, dur, 'smooth');
      const bounce = t > 1.3 ? damped(t - 1.3, 3.5, 6) * 0.04 : 0;
      const P: Pose = clonePose(env.idle);
      const add = (u: Vec3, v: Vec3): Vec3 => [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
      P.sp = [P.sp[0] + (-0.5 * k1 + 0.95 * kb) * (1 - 0.3 * lie), P.sp[1] + 0.3 * k1, P.sp[2] + 0.12 * k1];
      P.head = [P.head[0] - 0.4 * k1 - 0.1 * kb - 0.3 * slam, P.head[1] + 0.2 * k1, 0.1 * rest];
      P.root = add(P.root, [0, -0.28 * kb * (1 - lie), -0.12 * k1 + 0.02 * kb]);
      P.fl = add(P.fl, [0.06 * k1, 0, 0.1 * kb - 0.06 * k1]);
      P.fr = add(P.fr, [-0.06 * k1, 0, -0.14 * kb]);
      P.rootRot = [1.45 * lie, 0, 0.1 * lie];
      P.root[1] = Math.max(P.root[1] + 0.02, 0) + 0.14 * lie + bounce;
      P.root[2] += 0.56 * lie * s * 0.9;
      P.fl[1] += 0.2 * slam * (1 - rest * 0.5);
      P.fr[1] += 0.14 * slam;
      // club: kicked off the shoulder on the hit, then slides forward and lies along the ground ahead of the body (chest +y = world forward when prone)
      const grab = 1 - ramp(t, 0.1, 0.5, 'smooth');
      const cb: Vec3 = [0.15, 0.55 * (1 - lie) + 0.9 * lie, 0.4 * (1 - lie) - 0.55 * lie];
      P.r = {
        g: [-0.3 - 0.06 * k1 + 0.0 * slam, 0.1 + 0.35 * k1 * grab - 0.3 * kb - 0.05 * lie, 0.25 - 0.1 * kb - 0.2 * lie],
        b: norm(add(P.r.b.map((x) => x * grab) as Vec3, cb.map((x) => x * (1 - grab)) as Vec3)),
        e: V(-1, 0, 0), c: 0.9 - 0.7 * kb,
      };
      P.l = { g: [0.42 + 0.12 * k1 - 0.1 * lie, -0.3 + 0.35 * k1 - 0.5 * slam, 0.2 + 0.1 * k1 - 0.2 * lie], b: V(0, 0.2, 1), e: V(1, 0, 0), c: 0.3 };
      applyPose(c, env.a, finalize(P, s), env.cfg);
      secondary(env, c, t, t, 0.3, -0.5 * k1, 0);
    },
  };
}

export { hang, evalKeys };
