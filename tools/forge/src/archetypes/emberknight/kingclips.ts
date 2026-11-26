// pyre_king clip kit: two-handed flame greatsword on the heavy-biped toolkit (giant/heavy.ts). The left fist follows the right hand along
// the blade axis (SolveCfg.twoHand), so every key only places the right grip (g), blade axis (b) and edge / back of hand (e) in the chest frame.
// Hits (s): attack 0.6 (diagonal cleave), attack2 0.95 (flat sweep), special1 0.9 (overhead slam), special2 1.0 (low flame arc), special3 1.2 (roar, sword to the sky).
import type { ClipSpec } from '../../core/anim/clip.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type HeavyKit, HEAVY_RUN, HEAVY_WALK, action, deathClip, hitClip, kick, locomotion, patchPose, recoil, spawnClip } from '../giant/heavy.ts';
import { type Anatomy, type Key, type Pose, V, basePose } from '../humanoid/index.ts';
import { backToIdle } from './clips.ts';

export const KING_HITS = { attack: 0.6, attack2: 0.95, special1: 0.9, special2: 1.0, special3: 1.2 } as const;

export function kingKit(s: number): HeavyKit {
  const idle = patchPose(basePose(), {
    root: V(0, -0.05 * s, 0),
    fl: V(0.09 * s, 0, 0.16 * s),
    fr: V(-0.09 * s, 0, -0.15 * s),
    hip: [0, 0.2, 0],
    sp: [0.06, -0.08, 0],
    head: [0.02, 0.16, 0],
    r: { g: V(-0.22, -0.42, 0.26), b: V(-0.45, -0.6, 0.65), e: V(0.82, 0, 0.57), c: 1 },
    l: { g: V(0.1, -0.14, 0.4), c: 1 },
    poleR: V(-0.7, -0.4, -0.6),
    poleL: V(0.7, -0.5, -0.5),
  });
  return {
    idle,
    cfg: { twoHand: 0.15 },
    walk: { ...HEAVY_WALK, T: 1.1, sweep: 0.6, stomp: 0.03, sway: 0.04, lean: 0.06, armSwing: 0.06 },
    run: { ...HEAVY_RUN, T: 0.72, sweep: 0.77, lean: 0.22, armSwing: 0.08 },
    walkArms: { r: { g: V(-0.22, -0.38, 0.28), b: V(-0.4, -0.5, 0.75), e: V(0.88, 0, 0.47) } },
    runArms: { r: { g: V(-0.16, -0.16, 0.24), b: V(0.12, 0.62, -0.78), e: V(-0.2, -0.8, -0.6) } },
    idleDur: 3.0,
    breath: 1.3,
    chains: { cape: 0.45, hair: 0.9, skirt: 0.75 },
  };
}

export function kingClips(s: number, kit: HeavyKit): (a: Anatomy, sk: Skeleton) => ClipSpec[] {
  const H = KING_HITS;
  // attack: blade hauled up over the right shoulder, diagonal two-handed cleave down-forward
  const cleave: Key[] = [
    { t: 0, p: {} },
    { t: 0.4, ease: 'out', p: { r: { g: V(-0.2, 0.24, 0.02), b: V(-0.25, 0.55, -0.8), e: V(0.9, 0.2, 0) }, sp: [-0.06, -0.7, 0.08], hip: [0, -0.45, 0], root: V(0, -0.06 * s, -0.05 * s), fl: V(0.1 * s, 0, 0.06 * s), fr: V(-0.14 * s, 0, -0.24 * s), head: [-0.06, 0.25, 0] } },
    { t: H.attack, ease: 'in', p: { r: { g: V(0.02, -0.2, 0.46), b: V(0.3, -0.25, 0.92), e: V(0, -1, 0.1) }, sp: [0.28, 0.6, -0.05], hip: [0, 0.5, 0], root: V(0, -0.2 * s, 0.16 * s), fl: V(0.14 * s, 0, 0.36 * s), fr: V(-0.1 * s, 0, -0.18 * s), head: [-0.1, -0.3, 0] } },
    { t: 0.8, ease: 'out', p: { r: { g: V(0.16, -0.32, 0.34), b: V(0.8, -0.5, 0.3), e: V(0.2, -1, 0.1) }, sp: [0.32, 0.85, 0.04], hip: [0, 0.68, 0] } },
    { t: 1.35, ease: 'smooth', p: backToIdle(kit) },
  ];
  // attack2: coil to the right, flat sweep across the front
  const sweep: Key[] = [
    { t: 0, p: {} },
    { t: 0.6, ease: 'smooth', p: { r: { g: V(-0.32, -0.12, 0.1), b: V(-0.9, 0.15, -0.35), e: V(-0.35, 0, 0.9) }, sp: [0.1, -1.0, 0], hip: [0, -0.7, 0], root: V(0, -0.16 * s, -0.02 * s), head: [-0.05, 0.4, 0], fl: V(0.12 * s, 0, 0.14 * s), fr: V(-0.14 * s, 0, -0.16 * s) } },
    { t: H.attack2, ease: 'in', p: { r: { g: V(0.04, -0.12, 0.5), b: V(0.1, 0.1, 1), e: V(1, 0, -0.1) }, sp: [0.18, 0.5, -0.05], hip: [0, 0.45, 0], root: V(0, -0.2 * s, 0.14 * s), fl: V(0.12 * s, 0, 0.38 * s), fr: V(-0.12 * s, 0, -0.1 * s), head: [-0.08, -0.3, 0] } },
    { t: 1.15, ease: 'out', p: { r: { g: V(0.3, -0.1, 0.3), b: V(0.95, 0.15, -0.2), e: V(0.2, 0, 1) }, sp: [0.1, 1.1, 0.05], hip: [0, 0.85, 0] } },
    { t: 1.75, ease: 'smooth', p: backToIdle(kit) },
  ];
  // special1: sword raised straight overhead, held, then slammed point-first into the ground in a deep lunge
  const slamKeys: Key[] = [
    { t: 0, p: {} },
    { t: 0.55, ease: 'out', p: { r: { g: V(-0.05, 0.42, 0.06), b: V(0, 0.45, -0.9), e: V(0, 0.9, 0.45) }, sp: [-0.3, -0.05, 0], hip: [0, 0, 0], root: V(0, 0.02 * s, -0.06 * s), head: [-0.25, 0, 0], fl: V(0.12 * s, 0, 0.1 * s), fr: V(-0.12 * s, 0, -0.2 * s) } },
    { t: 0.72, ease: 'smooth', p: { r: { g: V(-0.04, 0.46, 0.0), b: V(0, 0.3, -0.95), e: V(0, 0.95, 0.3) }, sp: [-0.36, 0, 0], root: V(0, 0.04 * s, -0.08 * s) } },
    { t: H.special1, ease: 'in', p: { r: { g: V(0, -0.42, 0.45), b: V(0, -0.3, 0.95), e: V(0, -0.95, -0.3) }, sp: [0.55, 0, 0], hip: [0.1, 0, 0], root: V(0, -0.38 * s, 0.18 * s), fl: V(0.14 * s, 0, 0.42 * s), fr: V(-0.14 * s, 0, -0.26 * s), head: [-0.15, 0, 0] } },
    { t: 1.2, ease: 'out', p: { sp: [0.5, 0, 0], root: V(0, -0.34 * s, 0.16 * s) } },
  ];
  // special2: low wind-up behind the right hip, then a wide flaming arc skimming the ground from right to far left
  const arc: Key[] = [
    { t: 0, p: {} },
    { t: 0.6, ease: 'smooth', p: { r: { g: V(-0.34, -0.2, -0.05), b: V(-0.7, -0.2, -0.7), e: V(-0.7, 0, 0.7) }, sp: [0.25, -1.2, 0.05], hip: [0, -0.8, 0], root: V(0, -0.24 * s, -0.06 * s), fl: V(0.16 * s, 0, 0.2 * s), fr: V(-0.2 * s, 0, -0.2 * s), head: [-0.1, 0.6, 0] } },
    { t: 0.82, ease: 'in', p: { r: { g: V(-0.2, -0.3, 0.38), b: V(-0.45, -0.35, 0.82), e: V(0.88, 0, 0.48) }, sp: [0.35, -0.4, 0], hip: [0, -0.2, 0] } },
    { t: H.special2, ease: 'linear', p: { r: { g: V(0.1, -0.32, 0.5), b: V(0.3, -0.2, 0.93), e: V(0.95, 0, -0.3) }, sp: [0.38, 0.4, -0.05], hip: [0, 0.4, 0], root: V(0, -0.3 * s, 0.12 * s), fl: V(0.18 * s, 0, 0.34 * s), fr: V(-0.16 * s, 0, -0.18 * s), head: [-0.1, -0.2, 0] } },
    { t: 1.2, ease: 'out', p: { r: { g: V(0.36, -0.22, 0.2), b: V(0.85, -0.25, -0.45), e: V(0.47, 0, 0.88) }, sp: [0.3, 1.25, 0.05], hip: [0, 0.9, 0], head: [-0.05, -0.5, 0] } },
  ];
  // special3: gather low with the point down, then heave the sword to the sky and roar (summon)
  const roarKeys: Key[] = [
    { t: 0, p: {} },
    { t: 0.5, ease: 'smooth', p: { r: { g: V(-0.04, -0.3, 0.36), b: V(0.05, -0.85, 0.5), e: V(0, 0.5, 0.85) }, sp: [0.35, 0, 0], hip: [0, 0, 0], root: V(0, -0.22 * s, 0), head: [0.3, 0, 0], fl: V(0.14 * s, 0, 0.12 * s), fr: V(-0.14 * s, 0, -0.12 * s) } },
    { t: 1.0, ease: 'out', p: { r: { g: V(-0.04, 0.5, 0.18), b: V(0, 1, 0.08), e: V(0, -0.08, 1) }, sp: [-0.35, 0, 0], root: V(0, 0.03 * s, -0.02 * s), head: [-0.55, 0, 0] } },
    { t: H.special3, ease: 'out', p: { r: { g: V(-0.04, 0.54, 0.16), b: V(0, 1, 0.05), e: V(0, -0.05, 1) }, sp: [-0.42, 0, 0], head: [-0.62, 0, 0] } },
    { t: 1.65, ease: 'smooth', p: { sp: [-0.36, 0, 0], head: [-0.5, 0, 0] } },
    { t: 2.3, ease: 'smooth', p: backToIdle(kit) },
  ];
  const impact = (t0: number, amp: number) => (P: Pose, t: number): Pose => {
    const r = recoil(t, t0, 5.5, 7);
    P.root = [P.root[0], P.root[1] + amp * s * r, P.root[2]];
    P.sp = [P.sp[0] - 0.05 * r, P.sp[1], P.sp[2]];
    return P;
  };
  const dip = (t0: number) => (P: Pose, t: number): Pose => {
    const r = kick(t, t0, 9);
    P.root = [P.root[0], P.root[1] - 0.025 * s * r, P.root[2]];
    return P;
  };
  const tremble = (P: Pose, t: number): Pose => {
    const w = Math.max(0, Math.min(1, (t - 1.0) / 0.15)) * Math.max(0, Math.min(1, (1.8 - t) / 0.3));
    P.root = [P.root[0] + 0.006 * s * w * Math.sin(t * 71), P.root[1] + 0.005 * s * w * Math.sin(t * 53), P.root[2]];
    P.head = [P.head[0] + 0.03 * w * Math.sin(t * 47), P.head[1] + 0.03 * w * Math.sin(t * 61), P.head[2]];
    return P;
  };
  return (a: Anatomy, sk: Skeleton): ClipSpec[] => [
    ...locomotion(a, sk, kit),
    action('attack', a, sk, kit, cleave, 1.35, H.attack, impact(H.attack, 0.04)),
    action('attack2', a, sk, kit, sweep, 1.75, H.attack2, dip(H.attack2)),
    hitClip(a, sk, kit, { k: 0.8, dur: 0.6 }),
    deathClip(a, sk, kit, { dur: 2.8, fall: 'back' }),
    spawnClip(a, sk, kit, { dur: 0.8, roar: true }),
    action('special1', a, sk, kit, slamKeys, 1.9, H.special1, impact(H.special1, 0.07)),
    action('special2', a, sk, kit, arc, 2.1, H.special2, dip(H.special2)),
    action('special3', a, sk, kit, roarKeys, 2.3, H.special3, tremble),
  ];
}
