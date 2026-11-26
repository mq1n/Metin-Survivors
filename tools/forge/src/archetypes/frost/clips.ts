// Roster clips for the frost giants: idle walk run attack hit death spawn attack2 (nothing else), built on the heavy-gait toolkit.
// Timing follows the game sim: `run` is the on-screen gait (speed > 2.6), attack hits land when the sim's windup ends, the spawn
// state is cut after 0.45 s (so the rise happens inside that window) and the corpse dissolve starts at 55 % of the death clip.
import { type ClipSpec, type PoseCtx } from '../../core/anim/clip.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type Hand, type Key, type Pose, V, basePose } from '../humanoid/index.ts';
import { type GaitSpec, type HeavyKit, type PosePatch, HEAVY_RUN, HEAVY_WALK, action, deathClip, gaitPose, hitClip, kick, locomotion, recoil, spawnClip } from '../giant/heavy.ts';

type V3 = [number, number, number];

const hand = (g: V3, b: V3, e: V3, c: number): Hand => ({ g, b, e, c });

/** play `clip` squeezed or stretched into `dur` seconds (the heavy-kit death / spawn timelines are longer than the game's windows) */
function retime(clip: ClipSpec, dur: number): ClipSpec {
  const k = clip.duration / dur;
  return {
    ...clip,
    duration: dur,
    ...(clip.hit !== undefined ? { hit: clip.hit / k } : {}),
    pose: (c) => clip.pose(Object.create(c, { t: { value: c.t * k }, duration: { value: clip.duration } }) as PoseCtx),
  };
}

const ROSTER = ['idle', 'walk', 'run', 'attack', 'hit', 'death', 'spawn', 'attack2'];

function roster(clips: ClipSpec[]): ClipSpec[] {
  return ROSTER.map((n) => {
    const c = clips.find((k) => k.name === n);
    if (!c) throw new Error(`frost clips: missing ${n}`);
    return c;
  });
}

// ------------------------------------------------------------------------------------------------ yeti

export const YETI_RUN: GaitSpec = { ...HEAVY_RUN, T: 0.695, duty: 0.46, sweep: 0.85, lift: 0.22, bob: 0.025, stomp: 0.035, sway: 0.05, lean: 0.1, twist: 0.22, roll: 0.3, pelvisRoll: 0.09, armSwing: 0.3, armLag: 0.05, stance: 0.8 };
export const YETI_WALK: GaitSpec = { ...HEAVY_WALK, T: 0.8, duty: 0.6, sweep: 0.8, lift: 0.12, bob: 0.02, stomp: 0.035, sway: 0.06, lean: 0.05, twist: 0.2, roll: 0.26, pelvisRoll: 0.07, armSwing: 0.22, armLag: 0.08, stance: 0.85 };

export function yetiKit(a: Anatomy): HeavyKit {
  const s = a.s;
  const idle = basePose();
  idle.root = [0, -0.07 * s, 0];
  idle.fl = [0, 0, 0.06 * s];
  idle.fr = [0, 0, -0.06 * s];
  idle.sp = [0.04, 0, 0];
  idle.head = [-0.16, 0, 0];
  idle.r = hand([-0.5, -0.71, 0.4], [0, 0, 1], [-1, 0, 0], 1);
  idle.l = hand([0.5, -0.71, 0.4], [0, 0, 1], [1, 0, 0], 1);
  idle.poleR = V(-0.6, -0.1, -1);
  idle.poleL = V(0.6, -0.1, -1);
  const walkArms: PosePatch = { r: { g: [-0.5, -0.7, 0.34] }, l: { g: [0.5, -0.7, 0.34] } };
  const runArms: PosePatch = { sp: [0.1, 0, 0], r: { g: [-0.48, -0.6, 0.3] }, l: { g: [0.48, -0.6, 0.3] } };
  const kit: HeavyKit = {
    idle, walk: YETI_WALK, run: YETI_RUN, walkArms, runArms, idleDur: 3.2, breath: 1.4,
    // knuckle-walk: each fist lifts while it swings forward and plants while it pushes back
    post: (P, name, _t, u) => {
      if (name !== 'walk' && name !== 'run') return P;
      const g = name === 'walk' ? YETI_WALK : YETI_RUN;
      const arms = name === 'walk' ? walkArms : runArms;
      const zAt = (uu: number, side: 'r' | 'l'): number => gaitPose(idle, a, g, uu, arms)[side].g[2];
      const fwd = (side: 'r' | 'l'): number => {
        const v = (zAt(u + 0.03, side) - zAt(u - 0.03, side)) / (0.5 * g.armSwing);
        return Math.max(0, Math.min(1, v));
      };
      const amp = name === 'run' ? 0.2 : 0.12;
      P.r = { ...P.r, g: [P.r.g[0], P.r.g[1] + amp * fwd('r'), P.r.g[2]] };
      P.l = { ...P.l, g: [P.l.g[0], P.l.g[1] + amp * fwd('l'), P.l.g[2]] };
      return P;
    },
  };
  return kit;
}

export function yetiClips(a: Anatomy, sk: Skeleton): ClipSpec[] {
  const s = a.s;
  const kit = yetiKit(a);
  const fists = (y: number, z: number, x = 0.36): Partial<Pose> => ({ r: { ...kit.idle.r, g: [-x, y, z] }, l: { ...kit.idle.l, g: [x, y, z] } });
  // double fist smash: rear back, hammer down (first blow 0.40), rear back higher, hammer down harder (hit 0.82 = the sim's windup)
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.2, ease: 'out', p: { sp: [-0.2, 0, 0], head: [-0.05, 0, 0], root: V(0, -0.1 * s, -0.08 * s), fl: V(0, 0, 0.1 * s), shr: 0.3, shl: 0.3, ...fists(0.42, 0.02, 0.44) } },
    { t: 0.4, ease: 'in', p: { sp: [0.42, 0, 0], head: [-0.3, 0, 0], root: V(0, -0.17 * s, 0.14 * s), fl: V(0, 0, 0.22 * s), shr: 0, shl: 0, ...fists(-0.32, 0.8, 0.34) } },
    { t: 0.5, ease: 'out', p: { sp: [0.34, 0, 0], ...fists(-0.34, 0.76, 0.36) } },
    { t: 0.64, ease: 'smooth', p: { sp: [-0.3, 0, 0], head: [0, 0, 0], root: V(0, -0.08 * s, -0.1 * s), fl: V(0, 0, 0.1 * s), shr: 0.35, shl: 0.35, ...fists(0.58, -0.02, 0.4) } },
    { t: 0.82, ease: 'in', p: { sp: [0.52, 0, 0], head: [-0.38, 0, 0], root: V(0, -0.2 * s, 0.18 * s), fl: V(0, 0, 0.28 * s), fr: V(0, 0, -0.1 * s), shr: 0, shl: 0, ...fists(-0.2, 0.88, 0.3) } },
    { t: 1.5, ease: 'smooth', p: { ...kit.idle } },
  ];
  const slamImpact = (P: Pose, t: number): Pose => {
    const k = kick(t, 0.4, 14) * 0.5 + kick(t, 0.82, 11);
    P.root = [P.root[0], P.root[1] - 0.045 * s * k, P.root[2]];
    P.sp = [P.sp[0] - 0.05 * recoil(t, 0.82, 4, 8), P.sp[1], P.sp[2]];
    return P;
  };
  // leap slam: gather low, hands overhead, spring (airborne ~1.0-1.4), crash down on both fists at 1.42
  const attack2: Key[] = [
    { t: 0, p: {} },
    { t: 0.5, ease: 'smooth', p: { root: V(0, -0.24 * s, -0.1 * s), sp: [0.3, 0, 0], head: [-0.2, 0, 0], fl: V(0.06, 0, 0.16 * s), fr: V(-0.06, 0, -0.16 * s), ...fists(-0.2, 0.26, 0.36) } },
    { t: 0.98, ease: 'smooth', p: { root: V(0, -0.28 * s, -0.14 * s), sp: [-0.28, 0, 0], head: [-0.1, 0, 0], shr: 0.35, shl: 0.35, ...fists(0.6, -0.04, 0.2) } },
    { t: 1.16, ease: 'out', p: { root: V(0, 0.34, 0.06 * s), fl: V(0.02, 0.5, -0.04 * s), fr: V(-0.02, 0.42, 0.04 * s), sp: [-0.16, 0, 0], shr: 0.2, shl: 0.2, ...fists(0.66, -0.02, 0.22) } },
    { t: 1.42, ease: 'in', p: { root: V(0, -0.2 * s, 0.3 * s), fl: V(0.05, 0, 0.34 * s), fr: V(-0.05, 0, 0.08 * s), sp: [0.62, 0, 0], head: [-0.38, 0, 0], shr: 0, shl: 0, ...fists(-0.12, 0.9, 0.22) } },
    { t: 2.1, ease: 'smooth', p: { ...kit.idle } },
  ];
  const quake = (P: Pose, t: number): Pose => {
    const k = kick(t, 1.42, 9);
    P.root = [P.root[0], P.root[1] - 0.06 * s * k, P.root[2]];
    P.sp = [P.sp[0] - 0.06 * recoil(t, 1.42, 3.5, 6), P.sp[1], P.sp[2]];
    return P;
  };
  const clips = [
    ...locomotion(a, sk, kit),
    action('attack', a, sk, kit, attack, 1.5, 0.82, slamImpact),
    hitClip(a, sk, kit, { k: 0.9 }),
    retime(deathClip(a, sk, kit, { fall: 'kneel', dur: 2.2, buckle: 0.55 }), 1.8),
    retime(spawnClip(a, sk, kit, { dur: 1.5, depth: 0.7 }), 0.9),
    action('attack2', a, sk, kit, attack2, 2.1, 1.42, quake),
  ];
  return roster(clips);
}

// ------------------------------------------------------------------------------------------------ frosty man

export const FROSTY_RUN: GaitSpec = { ...HEAVY_RUN, T: 0.55, duty: 0.45, sweep: 0.78, lift: 0.2, bob: 0.025, stomp: 0.04, sway: 0.04, lean: 0.2, twist: 0.26, roll: 0.32, pelvisRoll: 0.07, armSwing: 0.14, armLag: 0.05, stance: 0.8 };
export const FROSTY_WALK: GaitSpec = { ...HEAVY_WALK, T: 0.65, duty: 0.6, sweep: 0.7, lift: 0.11, bob: 0.015, stomp: 0.025, sway: 0.035, lean: 0.07, twist: 0.2, roll: 0.24, pelvisRoll: 0.05, armSwing: 0.1, armLag: 0.07, stance: 0.8 };

export function frostyKit(a: Anatomy): HeavyKit {
  const s = a.s;
  const idle = basePose();
  idle.root = [0, -0.04 * s, 0];
  idle.fl = [0.02, 0, 0.05 * s];
  idle.fr = [-0.02, 0, -0.05 * s];
  idle.sp = [0.05, 0, 0];
  idle.head = [0.02, 0, 0];
  idle.r = hand([-0.32, -0.4, 0.3], [0.1, 0.78, 0.62], [-1, 0, 0], 0.9);
  idle.l = hand([0.32, -0.36, 0.14], [0, 0, 1], [1, 0, 0], 0.7);
  const walkArms: PosePatch = { r: { g: [-0.32, -0.34, 0.3] }, l: { g: [0.32, -0.34, 0.16] } };
  const runArms: PosePatch = { r: { g: [-0.3, -0.16, 0.34], b: [0.08, 0.8, 0.6] }, l: { g: [0.32, -0.16, 0.26] } };
  return { idle, walk: FROSTY_WALK, run: FROSTY_RUN, walkArms, runArms, idleDur: 3.0, breath: 1 };
}

export function frostyClips(a: Anatomy, sk: Skeleton): ClipSpec[] {
  const s = a.s;
  const kit = frostyKit(a);
  const club = (g: V3, b: V3, e: V3 = [-1, 0, 0]): Partial<Pose> => ({ r: { g, b, e, c: 1 } });
  // overhead smash: club up behind the head, drop through the front at 0.42 (the sim's melee windup is 0.4 s)
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.27, ease: 'out', p: { sp: [-0.3, 0.2, 0], head: [-0.12, 0, 0], root: V(0, -0.12 * s, -0.06 * s), fl: V(0.04, 0, 0.1 * s), fr: V(-0.04, 0, -0.14 * s), shr: 0.3, shl: 0.15, ...club([-0.2, 0.64, -0.1], [0, 0.66, -0.75]), l: { ...kit.idle.l, g: [0.28, 0.22, 0.2], b: [0, 0.3, 1] } } },
    { t: 0.42, ease: 'in', p: { sp: [0.5, -0.15, 0], head: [0.14, 0, 0], root: V(0, -0.22 * s, 0.12 * s), fl: V(0, 0, 0.34 * s), fr: V(-0.04, 0, -0.1 * s), shr: 0, shl: 0, ...club([-0.14, -0.36, 0.68], [0, -0.55, 0.84]), l: { ...kit.idle.l, g: [0.3, -0.2, 0.4] } } },
    { t: 0.55, ease: 'out', p: { sp: [0.4, -0.1, 0] } },
    { t: 1.1, ease: 'smooth', p: { ...kit.idle } },
  ];
  const smashImpact = (P: Pose, t: number): Pose => {
    const k = kick(t, 0.42, 13);
    P.root = [P.root[0], P.root[1] - 0.04 * s * k, P.root[2]];
    P.sp = [P.sp[0] - 0.06 * recoil(t, 0.42, 4.2, 8), P.sp[1], P.sp[2]];
    return P;
  };
  // horizontal sweep: twist back to the right, club cocked wide, whip through the front at 0.32 and follow across
  const attack2: Key[] = [
    { t: 0, p: {} },
    { t: 0.17, ease: 'out', p: { sp: [0.08, -0.8, 0], hip: [0, -0.35, 0], head: [0, 0.3, 0], root: V(0, -0.1 * s, -0.04 * s), fl: V(0.06, 0, 0.12 * s), fr: V(-0.06, 0, -0.1 * s), ...club([-0.56, -0.04, -0.14], [-0.7, 0.12, -0.7]), l: { ...kit.idle.l, g: [0.34, -0.2, 0.3] } } },
    { t: 0.32, ease: 'in', p: { sp: [0.16, 0.5, 0], hip: [0, 0.3, 0], head: [0, -0.3, 0], root: V(0, -0.14 * s, 0.06 * s), fl: V(0.04, 0, 0.2 * s), ...club([0.02, -0.1, 0.72], [0.5, 0.06, 0.85]), l: { ...kit.idle.l, g: [0.26, -0.24, 0.12] } } },
    { t: 0.46, ease: 'out', p: { sp: [0.12, 0.88, 0], hip: [0, 0.5, 0], head: [0, -0.5, 0], ...club([0.3, -0.04, 0.5], [0.95, 0.04, 0.3]) } },
    { t: 1.05, ease: 'smooth', p: { ...kit.idle } },
  ];
  const sweepImpact = (P: Pose, t: number): Pose => {
    const k = recoil(t, 0.32, 3.8, 8);
    P.sp = [P.sp[0], P.sp[1] + 0.08 * k, P.sp[2]];
    return P;
  };
  const clips = [
    ...locomotion(a, sk, kit),
    action('attack', a, sk, kit, attack, 1.1, 0.42, smashImpact),
    hitClip(a, sk, kit),
    retime(deathClip(a, sk, kit, { fall: 'back', dur: 2.2, buckle: 0.4 }), 1.7),
    retime(spawnClip(a, sk, kit, { dur: 1.5, depth: 0.5 }), 0.9),
    action('attack2', a, sk, kit, attack2, 1.05, 0.32, sweepImpact),
  ];
  return roster(clips);
}
