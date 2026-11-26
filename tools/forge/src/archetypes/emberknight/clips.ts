// Sword-warrior clip kits on the heavy-biped toolkit (giant/heavy.ts): poses are authored in the chest frame (reference metres, root / feet in
// world metres x s) and solved by the humanoid IK, so the baked sword (Hand.b = blade axis, Hand.e = edge = back of the right hand) follows.
import type { ClipSpec } from '../../core/anim/clip.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type GaitSpec, type HeavyKit, HEAVY_RUN, HEAVY_WALK, action, authoredSpeeds, deathClip, hitClip, kick, locomotion, patchPose, recoil, spawnClip } from '../giant/heavy.ts';
import { type Anatomy, type Key, type Pose, V, basePose } from '../humanoid/index.ts';

export { authoredSpeeds };

/** the pose a key list returns to (everything the actions touch) */
export const backToIdle = (k: HeavyKit): Key['p'] => ({
  root: k.idle.root, sp: k.idle.sp, hip: k.idle.hip, head: k.idle.head, fl: k.idle.fl, fr: k.idle.fr,
  r: { g: k.idle.r.g, b: k.idle.r.b, e: k.idle.r.e, c: k.idle.r.c }, l: { g: k.idle.l.g, b: k.idle.l.b, e: k.idle.l.e, c: k.idle.l.c },
});

export interface KnightTune {
  /** gait */
  walk: Partial<GaitSpec>;
  run: Partial<GaitSpec>;
}

/** idle / locomotion kit for the one-handed flame sword (right hand), left fist guarding */
export function knightKit(s: number, tune: Partial<KnightTune> = {}): HeavyKit {
  const idle = patchPose(basePose(), {
    root: V(0, -0.07 * s, 0),
    fl: V(0.07 * s, 0, 0.17 * s),
    fr: V(-0.07 * s, 0, -0.14 * s),
    hip: [0, 0.16, 0],
    sp: [0.06, -0.26, 0],
    head: [0.04, 0.16, 0],
    // blade held low-forward and out to the side so the top-down game camera sees its full length (an upright blade foreshortens away)
    r: { g: V(-0.3, -0.08, 0.36), b: V(-0.62, 0.32, 0.72), e: V(0.35, -0.85, 0.3), c: 1 },
    l: { g: V(0.2, -0.12, 0.42), b: V(0, 0.2, 1), e: V(1, 0, 0), c: 1 },
    poleR: V(-0.6, -0.4, -0.7),
    poleL: V(0.9, -0.5, -0.2),
  });
  const walk: GaitSpec = { ...HEAVY_WALK, T: 1.0, sweep: 0.62, stomp: 0.025, sway: 0.04, lean: 0.06, armSwing: 0.1, ...(tune.walk ?? {}) };
  const run: GaitSpec = { ...HEAVY_RUN, T: 0.64, sweep: 0.96, lean: 0.2, armSwing: 0.12, ...(tune.run ?? {}) };
  return {
    idle,
    walk,
    run,
    walkArms: { r: { g: V(-0.25, -0.1, 0.34), b: V(0.12, 0.7, 0.7), e: V(-0.1, -0.2, 1) }, l: { g: V(0.22, -0.14, 0.38) } },
    runArms: { r: { g: V(-0.24, -0.16, 0.2), b: V(0.08, 0.35, -0.93), e: V(-0.2, -1, 0) }, l: { g: V(0.24, -0.2, 0.36) } },
    idleDur: 2.6,
    breath: 1.2,
  };
}

export function knightClips(s: number, kit: HeavyKit): (a: Anatomy, sk: Skeleton) => ClipSpec[] {
  // attack: sword hauled up behind the right shoulder, diagonal chop down-forward (hit 0.4 = sim windup)
  const chop: Key[] = [
    { t: 0, p: {} },
    { t: 0.22, ease: 'out', p: { r: { g: V(-0.28, 0.3, -0.02), b: V(-0.2, 0.75, -0.62), e: V(0.3, 0.1, 1), c: 1 }, sp: [-0.04, -0.8, 0.1], hip: [0, -0.5, 0], root: V(0, -0.08 * s, -0.05 * s), fr: V(-0.12 * s, 0, -0.2 * s), fl: V(0.07 * s, 0, 0.08 * s), head: [-0.05, 0.3, 0], l: { g: V(0.28, -0.1, 0.1) } } },
    { t: 0.4, ease: 'in', p: { r: { g: V(0.04, -0.2, 0.47), b: V(0.15, -0.2, 0.96), e: V(0, -1, 0.1), c: 1 }, sp: [0.22, 0.7, -0.06], hip: [0, 0.6, 0], root: V(0, -0.16 * s, 0.14 * s), fl: V(0.12 * s, 0, 0.34 * s), fr: V(-0.1 * s, 0, -0.14 * s), head: [-0.1, -0.35, 0], l: { g: V(0.34, -0.02, -0.08) } } },
    { t: 0.58, ease: 'out', p: { r: { g: V(0.3, -0.34, 0.3), b: V(0.85, -0.5, 0.2), e: V(0.2, -1, 0.1) }, sp: [0.28, 0.95, 0.05], hip: [0, 0.75, 0] } },
    { t: 1.1, ease: 'smooth', p: backToIdle(kit) },
  ];
  // attack2: coil low with the sword drawn back, then a wide flaming sweep across the front (hit 0.8 = sim breath windup)
  const sweep: Key[] = [
    { t: 0, p: {} },
    { t: 0.4, ease: 'smooth', p: { root: V(0, -0.2 * s, -0.04 * s), r: { g: V(-0.3, -0.22, 0.04), b: V(-0.35, -0.2, -0.9), e: V(-0.2, 1, 0), c: 1 }, l: { g: V(0.2, -0.08, 0.3), b: V(0, 0.4, 1), e: V(0, -1, 0), c: 0.2 }, sp: [0.12, -0.9, 0], hip: [0, -0.6, 0], fl: V(0.14 * s, 0, 0.16 * s), fr: V(-0.14 * s, 0, -0.16 * s), head: [-0.06, 0.45, 0] } },
    { t: 0.6, ease: 'smooth', p: { r: { g: V(-0.3, 0.12, 0.0), b: V(-0.5, 0.65, -0.55), e: V(-0.4, 1, 0.2) }, sp: [-0.1, -1.0, 0.1], root: V(0, -0.14 * s, -0.08 * s) } },
    { t: 0.8, ease: 'in', p: { r: { g: V(0.12, -0.05, 0.5), b: V(0.55, 0.05, 0.84), e: V(0.1, 1, -0.1), c: 1 }, l: { g: V(0.1, -0.1, 0.42), b: V(0, 0.2, 1), e: V(0, -1, 0), c: 0.1 }, sp: [0.2, 0.9, -0.05], hip: [0, 0.7, 0], root: V(0, -0.16 * s, 0.16 * s), fl: V(0.1 * s, 0, 0.4 * s), fr: V(-0.12 * s, 0, -0.1 * s), head: [-0.08, -0.4, 0] } },
    { t: 1.0, ease: 'out', p: { r: { g: V(0.34, 0.0, 0.3), b: V(0.95, 0.2, -0.2), e: V(0.2, 1, 0.2) }, sp: [0.1, 1.15, 0.05], hip: [0, 0.85, 0] } },
    { t: 1.6, ease: 'smooth', p: backToIdle(kit) },
  ];
  const slam = (P: Pose, t: number): Pose => {
    const r = recoil(t, 0.4, 5.5, 8);
    P.root = [P.root[0], P.root[1] + 0.03 * s * r, P.root[2]];
    P.sp = [P.sp[0] - 0.04 * r, P.sp[1], P.sp[2]];
    return P;
  };
  const swing = (P: Pose, t: number): Pose => {
    const r = kick(t, 0.8, 9);
    P.root = [P.root[0], P.root[1] - 0.02 * s * r, P.root[2]];
    return P;
  };
  return (a: Anatomy, sk: Skeleton): ClipSpec[] => [
    ...locomotion(a, sk, kit),
    action('attack', a, sk, kit, chop, 1.1, 0.4, slam),
    hitClip(a, sk, kit, { k: 1.0 }),
    deathClip(a, sk, kit, { dur: 1.7, fall: 'back' }),
    spawnClip(a, sk, kit, { dur: 0.8, roar: false }),
    action('attack2', a, sk, kit, sweep, 1.6, 0.8, swing),
  ];
}
