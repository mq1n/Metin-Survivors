// Humanoid clips: idle walk run attack attack2 cast dash hit death spawn victory, weapon-style aware.
// Locomotion is procedural (planted-foot gait); actions are key-pose sequences interpolated with per-segment easing;
// every pose goes through the IK solver in rig.ts. Secondary chains (skirts, hair, scarf, cape, tail) are driven from the
// leg / torso motion with phase lag.
import { type ClipSpec, type PoseCtx } from '../../../core/anim/clip.ts';
import { type Ease, keyed, ramp } from '../../../core/anim/curve.ts';
import type { Skeleton } from '../../../core/skin/skeleton.ts';
import type { Anatomy } from '../anatomy.ts';
import type { WeaponStyle } from '../params.ts';
import { type Hand, type Pose, type SolveCfg, V, applyPose, basePose, blendPose, clonePose } from './rig.ts';

const TAU = Math.PI * 2;
const hand = (g: [number, number, number], b: [number, number, number], e: [number, number, number], c: number): Hand => ({ g, b, e, c });

/** any subset of the Pose fields; hands may be given partially (e.g. only the grip point) */
export type PosePatch = Omit<Partial<Pose>, 'r' | 'l'> & { r?: Partial<Hand>; l?: Partial<Hand> };

/** a key pose: a PosePatch at time t, eased in from the previous key */
export interface Key {
  t: number;
  ease?: Ease;
  p: PosePatch;
}

function mergeHand(base: Hand, over?: Partial<Hand>): Hand {
  return over ? { g: over.g ?? base.g, b: over.b ?? base.b, e: over.e ?? base.e, c: over.c ?? base.c } : base;
}

function resolve(base: Pose, p: Key['p']): Pose {
  const o = clonePose(base);
  const { r, l, ...rest } = p;
  Object.assign(o, rest);
  o.r = mergeHand(base.r, r);
  o.l = mergeHand(base.l, l);
  return o;
}

/** evaluate a key sequence at time t; keys inherit unspecified fields from the previous resolved key */
export function evalKeys(base: Pose, keys: Key[], t: number): Pose {
  const poses: Pose[] = [];
  let prev = base;
  for (const k of keys) {
    const rp = resolve(prev, k.p);
    poses.push(rp);
    prev = rp;
  }
  if (t <= keys[0]!.t) return poses[0]!;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return poses[poses.length - 1]!;
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i]!, k1 = keys[i + 1]!;
    if (t <= k1.t) {
      const u = ramp(t, k0.t, k1.t, k1.ease ?? 'smooth');
      return blendPose(poses[i]!, poses[i + 1]!, u);
    }
  }
  return poses[poses.length - 1]!;
}

export interface StyleDef {
  cfg: SolveCfg;
  /** idle carry pose (stance, torso, hands) */
  idle: Pose;
  /** arm carriage while running (blended over idle) */
  run: PosePatch;
  walk?: PosePatch;
  attack: Key[];
  attack2: Key[];
  cast: Key[];
  hit: number;
  /** hit-time of attack clips (seconds) */
  attackHit: number;
  attack2Hit: number;
  castHit: number;
  attackDur: number;
  attack2Dur: number;
  castDur: number;
}

// -------------------------------------------------------------------------------------------------------------
// style data (chest frame, reference metres; +X = left, hands: right at -X)

const stance = (width: number, fwd: number, drop: number): PosePatch => ({
  fl: V(width, 0, fwd),
  fr: V(-width, 0, -fwd),
  root: V(0, -drop, 0),
});

function makeStyles(): Record<WeaponStyle, StyleDef> {
  const none = (): StyleDef => ({
    cfg: {},
    idle: Object.assign(basePose(), stance(0.02, 0.03, 0.01)),
    run: {},
    attack: [],
    attack2: [],
    cast: [],
    hit: 0,
    attackHit: 0.4, attack2Hit: 0.4, castHit: 0.5, attackDur: 0.9, attack2Dur: 0.9, castDur: 1.1,
  });

  // ---------------- two-hand greatsword (warrior A)
  const sword2h: StyleDef = (() => {
    const idle = Object.assign(basePose(), stance(0.1, 0.1, 0.05), {
      sp: [0.06, -0.18, 0.0] as [number, number, number],
      hip: [0, 0.12, 0] as [number, number, number],
      r: hand(V(-0.12, -0.2, 0.3), V(0.22, 0.75, 0.62), V(0.2, 0, 1), 1),
      l: hand(V(0.1, -0.1, 0.4), V(0.22, 0.75, 0.62), V(-0.2, 0, -1), 1),
    });
    const hiBack = { r: { g: V(-0.2, 0.2, 0.0), b: V(-0.2, 0.55, -0.8), e: V(0.9, 0.2, 0.0) } };
    const strike = { r: { g: V(0.02, -0.18, 0.42), b: V(0.35, -0.1, 0.93), e: V(0, -1, 0.1) } };
    const across = { r: { g: V(0.16, -0.24, 0.3), b: V(0.9, -0.25, 0.35), e: V(0.2, -1, 0.1) } };
    return {
      cfg: { twoHand: 0.21 },
      idle,
      run: { sp: [0.16, -0.1, 0], r: { g: V(-0.1, -0.12, 0.26), b: V(0.15, 0.85, -0.5) } },
      attack: [
        { t: 0, p: {} },
        { t: 0.26, ease: 'out', p: { ...hiBack, sp: [-0.02, -0.75, 0.1], hip: [0, -0.5, 0], fl: V(0.1, 0, 0.0), fr: V(-0.14, 0, -0.22), root: V(0, -0.08, -0.04) } },
        { t: 0.4, ease: 'in', p: { ...strike, sp: [0.2, 0.7, -0.05], hip: [0, 0.55, 0], fl: V(0.14, 0, 0.3), fr: V(-0.1, 0, -0.16), root: V(0, -0.14, 0.12), head: [0, 0.1, 0] } },
        { t: 0.58, ease: 'out', p: { ...across, sp: [0.28, 0.95, 0.05], hip: [0, 0.7, 0], root: V(0, -0.12, 0.14) } },
        { t: 0.9, ease: 'smooth', p: { ...idle, root: idle.root } },
      ],
      attack2: [
        { t: 0, p: {} },
        { t: 0.3, ease: 'out', p: { r: { g: V(-0.28, -0.3, 0.1), b: V(-0.9, -0.2, 0.2), e: V(0, -1, 0.3) }, sp: [0.1, -1.0, 0], hip: [0, -0.7, 0], fl: V(0.06, 0, 0.12), fr: V(-0.12, 0, -0.1), root: V(0, -0.1, 0) } },
        { t: 0.46, ease: 'in', p: { r: { g: V(0.08, -0.05, 0.4), b: V(0.2, 0.9, 0.35), e: V(0, 0, 1) }, sp: [0.12, 0.9, -0.05], hip: [0, 0.6, 0], fl: V(0.14, 0, 0.22), fr: V(-0.1, 0, -0.1), root: V(0, -0.04, 0.1) } },
        { t: 0.66, ease: 'out', p: { r: { g: V(0.24, 0.12, 0.2), b: V(0.55, 0.8, -0.2), e: V(-0.3, 0.3, 1) }, sp: [0.02, 1.0, 0.1], hip: [0, 0.7, 0] } },
        { t: 1.0, ease: 'smooth', p: { ...idle } },
      ],
      cast: [
        { t: 0, p: {} },
        { t: 0.35, ease: 'smooth', p: { r: { g: V(-0.12, 0.05, 0.28), b: V(0, 0.95, 0.3), e: V(0, 0, 1) }, sp: [-0.16, 0, 0], root: V(0, -0.12, 0), fl: V(0.12, 0, 0.05), fr: V(-0.12, 0, -0.05), head: [-0.2, 0, 0] } },
        { t: 0.55, ease: 'in', p: { r: { g: V(-0.1, 0.38, 0.3), b: V(0, 1, 0.1), e: V(0, 0, 1) }, sp: [-0.2, 0, 0], root: V(0, 0.0, 0) } },
        { t: 0.75, ease: 'in', p: { r: { g: V(-0.08, -0.35, 0.42), b: V(0, -0.5, 1), e: V(1, 0, 0) }, sp: [0.2, 0, 0], root: V(0, -0.14, 0.04) } },
        { t: 1.1, ease: 'smooth', p: { ...idle } },
      ],
      hit: 0,
      attackHit: 0.4, attack2Hit: 0.46, castHit: 0.55, attackDur: 0.9, attack2Dur: 1.0, castDur: 1.1,
    };
  })();

  // ---------------- one-hand sword (warrior B, yacha)
  const sword1h: StyleDef = (() => {
    const idle = Object.assign(basePose(), stance(0.09, 0.14, 0.05), {
      sp: [0.04, -0.3, 0] as [number, number, number],
      hip: [0, 0.2, 0] as [number, number, number],
      r: hand(V(-0.22, -0.02, 0.34), V(0.1, 0.9, 0.42), V(0, -0.3, 1), 1),
      l: hand(V(0.25, -0.2, 0.12), V(0, 0.2, 1), V(1, 0, 0), 0.5),
    });
    return {
      cfg: {},
      idle,
      run: { sp: [0.2, -0.05, 0], r: { g: V(-0.2, -0.1, 0.18), b: V(0.1, 0.4, -0.9) }, l: { g: V(0.2, -0.15, 0.12) } },
      attack: [
        { t: 0, p: {} },
        { t: 0.22, ease: 'out', p: { r: { g: V(-0.3, 0.2, 0.0), b: V(-0.5, 0.6, -0.6), e: V(0.2, -1, 0) }, sp: [0.0, -0.7, 0.1], hip: [0, -0.4, 0], l: { g: V(0.26, -0.05, 0.12) }, root: V(0, -0.08, -0.04), fr: V(-0.12, 0, -0.2) } },
        { t: 0.38, ease: 'in', p: { r: { g: V(0.04, -0.1, 0.46), b: V(0.3, 0.1, 0.95), e: V(0.2, -1, 0.1) }, sp: [0.18, 0.7, -0.05], hip: [0, 0.6, 0], fl: V(0.12, 0, 0.34), root: V(0, -0.12, 0.14), l: { g: V(0.3, 0.0, -0.05) } } },
        { t: 0.56, ease: 'out', p: { r: { g: V(0.3, -0.2, 0.3), b: V(0.9, -0.3, 0.3), e: V(0.2, -1, 0.1) }, sp: [0.24, 0.95, 0.05], hip: [0, 0.75, 0] } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      attack2: [
        { t: 0, p: {} },
        { t: 0.24, ease: 'out', p: { r: { g: V(0.2, -0.22, 0.24), b: V(0.9, -0.3, 0.2), e: V(0, -1, 0.2) }, sp: [0.1, 0.7, 0], hip: [0, 0.5, 0], root: V(0, -0.1, 0), fl: V(0.08, 0, 0.12) } },
        { t: 0.4, ease: 'in', p: { r: { g: V(-0.34, -0.1, 0.3), b: V(-0.9, 0.1, 0.4), e: V(0, 1, 0.2) }, sp: [0.12, -0.8, 0], hip: [0, -0.55, 0], fl: V(0.12, 0, 0.3), root: V(0, -0.12, 0.14) } },
        { t: 0.62, ease: 'out', p: { r: { g: V(-0.4, 0.0, 0.1), b: V(-0.8, 0.5, -0.3) }, sp: [0.05, -1.0, 0.1], hip: [0, -0.7, 0] } },
        { t: 0.95, ease: 'smooth', p: { ...idle } },
      ],
      cast: [
        { t: 0, p: {} },
        { t: 0.3, ease: 'smooth', p: { l: { g: V(0.16, 0.0, 0.34), b: V(0, 0.2, 1), e: V(0, -1, 0), c: 0 }, r: { g: V(-0.24, -0.15, 0.3) }, sp: [-0.1, 0.2, 0], root: V(0, -0.1, 0) } },
        { t: 0.55, ease: 'in', p: { l: { g: V(0.1, 0.1, 0.5), b: V(0, 0.1, 1), e: V(0, -1, 0), c: 0 }, r: { g: V(-0.22, 0.2, 0.2), b: V(-0.2, 0.9, 0.3) }, sp: [0.12, 0.15, 0], root: V(0, -0.14, 0.04) } },
        { t: 1.1, ease: 'smooth', p: { ...idle } },
      ],
      hit: 0,
      attackHit: 0.38, attack2Hit: 0.4, castHit: 0.55, attackDur: 0.9, attack2Dur: 0.95, castDur: 1.1,
    };
  })();

  // ---------------- dual daggers (ninja A): low, fast, forward blades
  const dagger: StyleDef = (() => {
    const idle = Object.assign(basePose(), stance(0.11, 0.18, 0.1), {
      sp: [0.22, -0.12, 0] as [number, number, number],
      hip: [0.0, 0.1, 0] as [number, number, number],
      r: hand(V(-0.16, -0.1, 0.3), V(0.1, 0.1, 1), V(-0.2, -1, 0), 1),
      l: hand(V(0.2, -0.12, 0.28), V(-0.1, 0.1, 1), V(0.2, -1, 0), 1),
    });
    return {
      cfg: {},
      idle,
      run: { sp: [0.34, 0, 0], r: { g: V(-0.2, -0.16, 0.14), b: V(0, -0.2, 1) }, l: { g: V(0.2, -0.16, 0.14), b: V(0, -0.2, 1) } },
      attack: [
        { t: 0, p: {} },
        { t: 0.16, ease: 'out', p: { r: { g: V(-0.34, 0.0, 0.14), b: V(-0.6, 0.1, 0.8), e: V(0, -1, 0.1) }, l: { g: V(0.1, -0.05, 0.4), b: V(0.1, 0.1, 1) }, sp: [0.25, -0.55, 0], hip: [0, -0.4, 0], root: V(0, -0.14, -0.02) } },
        { t: 0.26, ease: 'in', p: { r: { g: V(0.1, -0.05, 0.5), b: V(0.55, 0, 0.84), e: V(0, -1, 0.1) }, l: { g: V(0.2, -0.08, 0.14), b: V(-0.2, 0.1, 1) }, sp: [0.3, 0.55, 0], hip: [0, 0.5, 0], fl: V(0.1, 0, 0.36), root: V(0, -0.16, 0.18) } },
        { t: 0.42, ease: 'in', p: { r: { g: V(-0.1, -0.1, 0.2), b: V(0.1, 0, 1) }, l: { g: V(0.0, -0.05, 0.54), b: V(-0.5, 0, 0.86), e: V(0, -1, -0.1) }, sp: [0.3, -0.5, 0], hip: [0, -0.5, 0], fl: V(0.1, 0, 0.36), root: V(0, -0.16, 0.2) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      attack2: [
        { t: 0, p: {} },
        { t: 0.2, ease: 'out', p: { r: { g: V(-0.3, 0.25, 0.1), b: V(-0.5, 0.7, 0.5), e: V(0, -1, 0.2) }, l: { g: V(0.3, 0.25, 0.1), b: V(0.5, 0.7, 0.5), e: V(0, -1, 0.2) }, sp: [0.15, 0, 0], root: V(0, -0.2, 0) } },
        { t: 0.34, ease: 'in', p: { r: { g: V(-0.08, -0.18, 0.46), b: V(0.15, -0.3, 0.94) }, l: { g: V(0.08, -0.18, 0.46), b: V(-0.15, -0.3, 0.94) }, sp: [0.36, 0, 0], root: V(0, -0.2, 0.22), fl: V(0.12, 0, 0.32), fr: V(-0.12, 0, -0.14) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      cast: [
        { t: 0, p: {} },
        { t: 0.3, ease: 'smooth', p: { r: { g: V(-0.3, 0.1, 0.1), b: V(-1, 0.3, 0.2) }, l: { g: V(0.3, 0.1, 0.1), b: V(1, 0.3, 0.2) }, sp: [0.1, 0, 0], root: V(0, -0.16, 0) } },
        { t: 0.55, ease: 'in', p: { r: { g: V(-0.1, 0.0, 0.46), b: V(0.3, 0, 1) }, l: { g: V(0.1, 0.0, 0.46), b: V(-0.3, 0, 1) }, sp: [0.3, 0, 0], root: V(0, -0.16, 0.12) } },
        { t: 1.1, ease: 'smooth', p: { ...idle } },
      ],
      hit: 0,
      attackHit: 0.26, attack2Hit: 0.34, castHit: 0.55, attackDur: 0.8, attack2Dur: 0.8, castDur: 1.0,
    };
  })();

  // ---------------- bow (ninja B): bow in the left hand, vertical
  const bow: StyleDef = (() => {
    const idle = Object.assign(basePose(), stance(0.1, 0.1, 0.05), {
      sp: [0.04, 0.35, 0] as [number, number, number],
      hip: [0, -0.1, 0] as [number, number, number],
      l: hand(V(0.22, -0.02, 0.4), V(0, 0.2, 1), V(0, 1, 0), 1),
      r: hand(V(-0.2, -0.28, 0.14), V(0, 0.2, 1), V(-1, 0, 0), 0.5),
    });
    return {
      cfg: {},
      idle,
      run: { sp: [0.22, 0.1, 0], l: { g: V(0.2, -0.12, 0.2), b: V(0, 1, 0.2) } },
      attack: [
        { t: 0, p: {} },
        { t: 0.3, ease: 'smooth', p: { l: { g: V(0.12, 0.08, 0.62), b: V(0.05, 0.1, 1), e: V(0, 1, 0), c: 1 }, r: { g: V(-0.1, 0.06, 0.18), b: V(0.2, 0.05, 1), e: V(-1, 0, 0), c: 0.8 }, sp: [0, 0.6, 0], hip: [0, 0.2, 0], head: [0, -0.4, 0] } },
        { t: 0.42, ease: 'smooth', p: { r: { g: V(-0.14, 0.08, 0.04), c: 0.9 } } },
        { t: 0.5, ease: 'in', p: { r: { g: V(-0.2, 0.06, 0.28), c: 0.1 }, l: { g: V(0.12, 0.08, 0.62) }, root: V(0, -0.02, -0.03) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      attack2: [
        { t: 0, p: {} },
        { t: 0.26, ease: 'smooth', p: { l: { g: V(0.1, 0.12, 0.62), b: V(0, 0.4, 1), e: V(0, 1, 0), c: 1 }, r: { g: V(-0.12, 0.1, 0.12), b: V(0.2, 0.05, 1), e: V(-1, 0, 0), c: 0.8 }, sp: [0, 0.6, 0], hip: [0, 0.2, 0], head: [0, -0.4, 0], root: V(0, -0.1, 0) } },
        { t: 0.44, ease: 'in', p: { r: { g: V(-0.2, 0.1, 0.34), c: 0.1 }, root: V(0, -0.1, -0.04) } },
        { t: 0.8, ease: 'smooth', p: { ...idle } },
      ],
      cast: [
        { t: 0, p: {} },
        { t: 0.4, ease: 'smooth', p: { l: { g: V(0.1, 0.35, 0.3), b: V(0, 1, 0.3), e: V(0, 0, 1), c: 1 }, r: { g: V(-0.1, 0.35, 0.3), b: V(0, 1, 0.3), e: V(0, 0, 1), c: 0.3 }, sp: [-0.14, 0, 0], head: [-0.25, 0, 0], root: V(0, -0.08, 0) } },
        { t: 0.6, ease: 'in', p: { l: { g: V(0.1, 0.0, 0.5), b: V(0, 0.1, 1) }, r: { g: V(-0.1, 0.0, 0.5), b: V(0, 0.1, 1) }, sp: [0.2, 0, 0], root: V(0, -0.14, 0.08) } },
        { t: 1.1, ease: 'smooth', p: { ...idle } },
      ],
      hit: 0,
      attackHit: 0.5, attack2Hit: 0.44, castHit: 0.6, attackDur: 0.9, attack2Dur: 0.8, castDur: 1.1,
    };
  })();

  // ---------------- fan (shaman A): fan in the right hand, graceful
  const fan: StyleDef = (() => {
    const idle = Object.assign(basePose(), stance(0.07, 0.04, 0.0), {
      sp: [0.0, -0.1, 0] as [number, number, number],
      r: hand(V(-0.22, -0.02, 0.32), V(0.0, 0.9, 0.4), V(0, 0, 1), 0.7),
      l: hand(V(0.22, -0.18, 0.12), V(0, 0.2, 1), V(1, 0, 0), 0.2),
    });
    return {
      cfg: {},
      idle,
      run: { sp: [0.14, 0, 0], r: { g: V(-0.2, -0.08, 0.2), b: V(0, 0.8, 0.5) }, l: { g: V(0.2, -0.14, 0.1) } },
      attack: [
        { t: 0, p: {} },
        { t: 0.24, ease: 'out', p: { r: { g: V(-0.34, 0.1, 0.1), b: V(-0.6, 0.7, 0.3), e: V(0.2, 0, 1) }, sp: [0, -0.7, 0], hip: [0, -0.4, 0], root: V(0, -0.06, 0) } },
        { t: 0.4, ease: 'in', p: { r: { g: V(0.1, 0.0, 0.46), b: V(0.6, 0.3, 0.74), e: V(0, 0, 1) }, sp: [0.1, 0.7, 0], hip: [0, 0.5, 0], fl: V(0.08, 0, 0.2), root: V(0, -0.1, 0.1) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      attack2: [
        { t: 0, p: {} },
        { t: 0.26, ease: 'out', p: { l: { g: V(0.3, 0.0, 0.2), b: V(0.7, 0.2, 0.5), e: V(0, 1, 0), c: 0 }, r: { g: V(-0.1, 0.1, 0.44), b: V(-0.4, 0.5, 0.7) }, sp: [0, 0.5, 0], hip: [0, 0.3, 0] } },
        { t: 0.42, ease: 'in', p: { l: { g: V(-0.1, 0.0, 0.5), b: V(-0.3, 0.1, 0.95), e: V(0, 1, 0), c: 0 }, r: { g: V(-0.3, 0.1, 0.34), b: V(-0.9, 0.3, 0.2) }, sp: [0.05, -0.5, 0], hip: [0, -0.3, 0], root: V(0, -0.06, 0.06) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      cast: [
        { t: 0, p: {} },
        { t: 0.4, ease: 'smooth', p: { r: { g: V(-0.2, 0.3, 0.3), b: V(0.1, 0.8, 0.6), e: V(0, 0, 1) }, l: { g: V(0.2, 0.3, 0.3), b: V(0, 0.9, 0.4), e: V(0, 0, 1), c: 0 }, sp: [-0.14, 0, 0], head: [-0.2, 0, 0], root: V(0, 0.01, 0) } },
        { t: 0.7, ease: 'in', p: { r: { g: V(-0.1, 0.0, 0.5), b: V(0.1, 0.2, 1) }, l: { g: V(0.1, 0.0, 0.5), b: V(-0.1, 0.2, 1) }, sp: [0.16, 0, 0], root: V(0, -0.08, 0.06) } },
        { t: 1.2, ease: 'smooth', p: { ...idle } },
      ],
      hit: 0,
      attackHit: 0.4, attack2Hit: 0.42, castHit: 0.7, attackDur: 0.9, attack2Dur: 0.9, castDur: 1.2,
    };
  })();

  // ---------------- bell staff (shaman B)
  const bell: StyleDef = (() => {
    const idle = Object.assign(basePose(), stance(0.07, 0.04, 0.0), {
      sp: [0.0, 0.0, 0] as [number, number, number],
      r: hand(V(-0.26, -0.12, 0.2), V(0, 1, 0.1), V(0, 0, 1), 1),
      l: hand(V(0.22, -0.2, 0.1), V(0, 0.2, 1), V(1, 0, 0), 0.2),
    });
    return {
      cfg: {},
      idle,
      run: { sp: [0.14, 0, 0], r: { g: V(-0.24, -0.1, 0.16) } },
      attack: [
        { t: 0, p: {} },
        { t: 0.26, ease: 'out', p: { r: { g: V(-0.2, 0.3, 0.1), b: V(0, 0.9, -0.4) }, sp: [-0.1, -0.4, 0], root: V(0, 0.0, 0) } },
        { t: 0.42, ease: 'in', p: { r: { g: V(0, -0.1, 0.5), b: V(0, -0.3, 1), e: V(0, 1, 0) }, sp: [0.2, 0.3, 0], hip: [0, 0.3, 0], fl: V(0.06, 0, 0.2), root: V(0, -0.1, 0.08) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      attack2: [
        { t: 0, p: {} },
        { t: 0.3, ease: 'out', p: { r: { g: V(-0.1, 0.35, 0.3), b: V(0.1, 1, 0.1) }, sp: [-0.1, 0, 0] } },
        { t: 0.5, ease: 'in', p: { r: { g: V(-0.1, 0.1, 0.4), b: V(0.1, 1, 0.1) }, sp: [0.1, 0, 0], root: V(0, -0.05, 0.04) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      cast: [
        { t: 0, p: {} },
        { t: 0.4, ease: 'smooth', p: { r: { g: V(-0.2, 0.3, 0.3), b: V(0, 1, 0.1) }, l: { g: V(0.2, 0.3, 0.3), b: V(0, 0.9, 0.4), e: V(0, 0, 1), c: 0 }, sp: [-0.14, 0, 0], head: [-0.2, 0, 0] } },
        { t: 0.7, ease: 'in', p: { r: { g: V(-0.1, 0.0, 0.4), b: V(0, 0.9, 0.4) }, l: { g: V(0.1, 0.0, 0.5), b: V(0, 0.2, 1), c: 0 }, sp: [0.16, 0, 0], root: V(0, -0.08, 0.06) } },
        { t: 1.2, ease: 'smooth', p: { ...idle } },
      ],
      hit: 0,
      attackHit: 0.42, attack2Hit: 0.5, castHit: 0.7, attackDur: 0.9, attack2Dur: 0.9, castDur: 1.2,
    };
  })();

  // ---------------- claws (wolfman): hunched, raking swipes
  const claw: StyleDef = (() => {
    const idle = Object.assign(basePose(), stance(0.12, 0.12, 0.08), {
      sp: [0.12, 0.0, 0] as [number, number, number],
      r: hand(V(-0.26, -0.22, 0.26), V(0, 0.2, 1), V(-1, 0, 0), 0.25),
      l: hand(V(0.26, -0.22, 0.26), V(0, 0.2, 1), V(1, 0, 0), 0.25),
    });
    return {
      cfg: {},
      idle,
      run: { sp: [0.3, 0, 0], r: { g: V(-0.24, -0.2, 0.2) }, l: { g: V(0.24, -0.2, 0.2) } },
      attack: [
        { t: 0, p: {} },
        { t: 0.2, ease: 'out', p: { r: { g: V(-0.42, 0.14, 0.04), b: V(-0.6, 0.2, 0.8), e: V(0, -1, 0), c: 0 }, l: { g: V(0.24, -0.2, 0.3) }, sp: [0.1, -0.7, 0.1], hip: [0, -0.4, 0], root: V(0, -0.1, -0.04) } },
        { t: 0.32, ease: 'in', p: { r: { g: V(0.1, -0.2, 0.5), b: V(0.5, -0.2, 0.84), e: V(0, -1, 0), c: 0 }, sp: [0.26, 0.6, 0], hip: [0, 0.5, 0], fl: V(0.1, 0, 0.32), root: V(0, -0.14, 0.18) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      attack2: [
        { t: 0, p: {} },
        { t: 0.2, ease: 'out', p: { l: { g: V(0.42, 0.14, 0.04), b: V(0.6, 0.2, 0.8), e: V(0, -1, 0), c: 0 }, r: { g: V(-0.24, -0.2, 0.3) }, sp: [0.1, 0.7, -0.1], hip: [0, 0.4, 0], root: V(0, -0.1, -0.04) } },
        { t: 0.32, ease: 'in', p: { l: { g: V(-0.1, -0.2, 0.5), b: V(-0.5, -0.2, 0.84), e: V(0, -1, 0), c: 0 }, sp: [0.26, -0.6, 0], hip: [0, -0.5, 0], fr: V(-0.1, 0, 0.32), root: V(0, -0.14, 0.18) } },
        { t: 0.9, ease: 'smooth', p: { ...idle } },
      ],
      cast: [
        { t: 0, p: {} },
        { t: 0.3, ease: 'smooth', p: { r: { g: V(-0.3, 0.3, 0.1), b: V(-0.2, 0.8, 0.5), c: 0 }, l: { g: V(0.3, 0.3, 0.1), b: V(0.2, 0.8, 0.5), c: 0 }, sp: [-0.2, 0, 0], head: [-0.4, 0, 0], root: V(0, 0.0, 0) } },
        { t: 0.55, ease: 'in', p: { r: { g: V(-0.2, -0.1, 0.5), b: V(0.2, -0.3, 1), c: 0 }, l: { g: V(0.2, -0.1, 0.5), b: V(-0.2, -0.3, 1), c: 0 }, sp: [0.4, 0, 0], root: V(0, -0.2, 0.1) } },
        { t: 1.1, ease: 'smooth', p: { ...idle } },
      ],
      hit: 0,
      attackHit: 0.32, attack2Hit: 0.32, castHit: 0.55, attackDur: 0.8, attack2Dur: 0.8, castDur: 1.1,
    };
  })();

  const n = none();
  return { sword2h, sword1h, dagger, bow, fan, bell, claw, spear: sword1h, club: sword2h, fist: claw, staff: bell, axe2h: sword2h, none: n };
}

export const STYLES = makeStyles();

// -------------------------------------------------------------------------------------------------------------
// gait

interface Gait {
  T: number;
  duty: number;
  sweep: number;
  lift: number;
  bob: number;
  run: boolean;
}

const WALK: Gait = { T: 1.0, duty: 0.64, sweep: 0.62, lift: 0.11, bob: 0.018, run: false };
const RUN: Gait = { T: 0.667, duty: 0.36, sweep: 0.98, lift: 0.2, bob: 0.045, run: true };

/** authored ground speeds (m/s at body scale 1) */
export const gaitSpeed = (g: Gait): number => g.sweep / (g.duty * g.T);

const footAt = (g: Gait, ph: number): { z: number; y: number; pitch: number } => {
  const f = ph - Math.floor(ph);
  if (f < g.duty) {
    const u = f / g.duty;
    const z = g.sweep * 0.5 - g.sweep * u;
    const heel = u > 0.55 ? ramp(u, 0.55, 1, 'smooth') : 0;
    return { z, y: 0, pitch: heel * (g.run ? 0.75 : 0.55) - (u < 0.08 ? (0.08 - u) * 3 : 0) };
  }
  const u = (f - g.duty) / (1 - g.duty);
  const e = u * u * (3 - 2 * u);
  const z = -g.sweep * 0.5 + g.sweep * (g.run ? e * 0.7 + u * 0.3 : e);
  const y = g.lift * Math.sin(Math.PI * Math.pow(u, 0.85));
  const pitch = keyed(u, [[0, 0.7], [0.25, 0.25], [0.6, -0.15], [1, -0.3]], 'smooth');
  return { z, y, pitch };
};

function locoPose(st: StyleDef, a: Anatomy, kind: 'idle' | 'walk' | 'run', u: number): Pose {
  const s = a.s;
  const P = clonePose(st.idle);
  if (kind === 'idle') {
    const br = Math.sin(u * TAU);
    P.sp = [P.sp[0] + 0.014 * br, P.sp[1] + 0.02 * Math.sin(u * TAU * 2 + 1), P.sp[2]];
    P.head = [P.head[0] - 0.01 * br, 0.04 * Math.sin(u * TAU), 0];
    P.hip = [P.hip[0], P.hip[1], P.hip[2] + 0.02 * Math.sin(u * TAU)];
    P.root = [P.root[0] + 0.008 * Math.sin(u * TAU), P.root[1] + 0.006 * (br - 1), P.root[2]];
    P.r.g = [P.r.g[0], P.r.g[1] + 0.006 * br, P.r.g[2]];
    P.l.g = [P.l.g[0], P.l.g[1] + 0.006 * br, P.l.g[2]];
    P.shr = 0.02 * br;
    P.shl = 0.02 * br;
    return P;
  }
  const g = kind === 'run' ? RUN : WALK;
  const over = kind === 'run' ? st.run : st.walk ?? {};
  // arm carriage
  const carry = resolve(P, over);
  Object.assign(P, carry);
  const fl = footAt(g, u), fr = footAt(g, u + 0.5);
  const rest = 0;
  P.fl = [st.idle.fl[0] * 0.5, fl.y * s, fl.z * s + rest * 0.0];
  P.fr = [st.idle.fr[0] * 0.5, fr.y * s, fr.z * s];
  P.fpl = fl.pitch;
  P.fpr = fr.pitch;
  const mid = g.duty / 2;
  const bobPh = (u - mid) * TAU * 2;
  P.root = [0.012 * s * Math.sin(u * TAU), (g.run ? -1 : 1) * g.bob * s * Math.cos(bobPh) + (g.run ? -0.05 * s : -0.015 * s), 0];
  const lean = g.run ? 0.2 : 0.04;
  P.sp = [P.sp[0] * 0.5 + lean, P.sp[1] * 0.4 + 0.18 * Math.sin(u * TAU) * (g.run ? 1.3 : 0.7), 0.04 * Math.cos(u * TAU)];
  P.hip = [0.03 * Math.cos(bobPh * 0.5), -0.2 * Math.sin(u * TAU) * (g.run ? 1.0 : 0.6) + P.hip[1] * 0.3, 0.05 * Math.sin(u * TAU)];
  P.head = [-0.04 - lean * 0.5, -0.04 * Math.sin(u * TAU), 0];
  // arm swing in the chest frame: the free hand pumps; the weapon hand moves less
  const sw = (g.run ? 0.17 : 0.08) * Math.cos(u * TAU);
  const heldR = st.cfg.twoHand ? 0.2 : 0.55;
  P.r.g = [P.r.g[0], P.r.g[1] + (g.run ? 0.04 : 0.01) * Math.sin(u * TAU * 2), P.r.g[2] + sw * heldR];
  P.l.g = [P.l.g[0], P.l.g[1] - (g.run ? 0.04 : 0.01) * Math.sin(u * TAU * 2), P.l.g[2] - sw * (st.cfg.twoHand ? 0.2 : 1)];
  return P;
}

// -------------------------------------------------------------------------------------------------------------
// secondary motion

interface Chains {
  skirt: boolean;
  hair: string[];
  scarf: string[];
  cape: string[];
  tail: string[];
  ears: boolean;
}

export function chainsOf(sk: Skeleton): Chains {
  const pick = (p: string): string[] => sk.names.filter((n) => new RegExp(`^${p}\\d+$`).test(n));
  return { skirt: sk.has('skirt_f'), hair: pick('hair'), scarf: pick('scarf'), cape: pick('cape'), tail: pick('tail'), ears: sk.has('ear_l') };
}

/** drive the secondary chains: `drive` = body acceleration-ish scalar (leg swing), `speed` 0..1 trailing amount */
function secondary(c: PoseCtx, ch: Chains, t: number, phase: number, speed: number, swing: number, twist: number): void {
  const wave = (i: number, f: number, a: number): number => a * Math.sin(phase * TAU * f - i * 0.8);
  if (ch.skirt) {
    c.set('skirt_f', -0.55 * Math.max(swing, 0) - 0.08 * speed + 0.03 * Math.sin(t * 2), 0, 0);
    c.set('skirt_b', 0.5 * Math.max(-swing, 0) + 0.12 * speed + 0.03 * Math.sin(t * 2 + 1), 0, 0);
    c.set('skirt_l', 0, 0, -0.12 * Math.max(twist, 0) - 0.04 * speed);
    c.set('skirt_r', 0, 0, 0.12 * Math.max(-twist, 0) + 0.04 * speed);
  }
  ch.hair.forEach((n, i) => c.set(n, 0.12 * speed + wave(i, 1, 0.1 + 0.05 * speed) + 0.1 * Math.abs(swing), 0.1 * twist, 0));
  ch.scarf.forEach((n, i) => c.set(n, 0.35 * speed + wave(i, 1, 0.22) + 0.1 * i * speed, wave(i, 1, 0.12 + 0.1 * speed) + 0.2 * twist, 0));
  ch.cape.forEach((n, i) => c.set(n, 0.25 * speed + wave(i, 1, 0.12) + 0.08 * i * speed, 0.1 * twist, 0));
  ch.tail.forEach((n, i) => c.set(n, 0.1 * speed + wave(i, 1, 0.16) , 0.25 * Math.sin(phase * TAU - i) * (0.4 + speed) + 0.2 * twist, 0));
  if (ch.ears) {
    c.set('ear_l', -0.04 * speed + wave(0, 2, 0.05), 0, 0.12 * speed);
    c.set('ear_r', -0.04 * speed + wave(0, 2, 0.05), 0, -0.12 * speed);
  }
}

// -------------------------------------------------------------------------------------------------------------
// clip assembly

export interface ClipOpts {
  /** style used for the `_b` doctrine variants (optional) */
  styleB?: WeaponStyle;
}

function swingMetric(P: Pose): number {
  // forward swing amount of the lead leg (for skirt motion in action clips)
  return Math.max(P.fl[2], P.fr[2]) * 0.8 - Math.min(P.fl[2], P.fr[2]) * 0.0;
}

export function makeClips(a: Anatomy, sk: Skeleton, style: WeaponStyle, suffix = '', styles?: Partial<Record<WeaponStyle, StyleDef>>): ClipSpec[] {
  const st = styles?.[style] ?? STYLES[style];
  const ch = chainsOf(sk);
  const s = a.s;
  const out: ClipSpec[] = [];
  const nm = (n: string): string => n + suffix;
  const solveWith = (c: PoseCtx, P: Pose): void => applyPose(c, a, P, st.cfg);

  // ---- locomotion
  out.push({
    name: nm('idle'), duration: 2.6, loop: true,
    pose: (c) => {
      const P = locoPose(st, a, 'idle', c.u);
      solveWith(c, P);
      secondary(c, ch, c.t, c.u, 0, 0, 0);
    },
  });
  if (!suffix) {
    out.push({
      name: 'walk', duration: WALK.T, loop: true,
      pose: (c) => {
        const P = locoPose(st, a, 'walk', c.u);
        solveWith(c, P);
        secondary(c, ch, c.t, c.u, 0.35, -(Math.cos(c.u * TAU)) * 0.5, Math.sin(c.u * TAU));
      },
    });
  }
  out.push({
    name: nm('run'), duration: RUN.T, loop: true,
    pose: (c) => {
      const P = locoPose(st, a, 'run', c.u);
      solveWith(c, P);
      secondary(c, ch, c.t, c.u, 1, Math.cos(c.u * TAU), Math.sin(c.u * TAU));
    },
  });

  // ---- actions
  const action = (name: string, keys: Key[], dur: number, hit: number | undefined, extra?: (P: Pose, t: number) => Pose): ClipSpec => ({
    name: nm(name), duration: dur, loop: false, ...(hit !== undefined ? { hit } : {}),
    pose: (c) => {
      let P = evalKeys(st.idle, keys, c.t);
      if (extra) P = extra(P, c.t);
      solveWith(c, P);
      secondary(c, ch, c.t, c.t * 1.4, 0.6, swingMetric(P) * 2, P.sp[1]);
    },
  });
  out.push(action('attack', st.attack, st.attackDur, st.attackHit));
  out.push(action('attack2', st.attack2, st.attack2Dur, st.attack2Hit));
  out.push(action('cast', st.cast, st.castDur, st.castHit));
  // dash: low forward lunge, weapon trailing
  const dashKeys: Key[] = [
    { t: 0, p: {} },
    { t: 0.1, ease: 'out', p: { sp: [0.45, 0, 0], head: [-0.3, 0, 0], root: V(0, -0.16, 0.0), fl: V(0.06, 0, 0.5), fr: V(-0.06, 0, -0.45), fpr: 0.7 } },
    { t: 0.32, ease: 'smooth', p: { sp: [0.5, 0, 0], head: [-0.35, 0, 0], root: V(0, -0.12, 0.1), fl: V(0.06, 0.1, 0.6), fr: V(-0.06, 0.12, -0.55), fpr: 0.9 } },
    { t: 0.5, ease: 'smooth', p: { ...st.idle, root: V(0, -0.14, 0.0), sp: [0.3, 0, 0] } },
  ];
  out.push({
    name: nm('dash'), duration: 0.5, loop: false,
    pose: (c) => {
      let P = evalKeys(st.idle, dashKeys, c.t);
      // hands trail behind the body
      const k = keyed(c.t, [[0, 0], [0.1, 1], [0.34, 1], [0.5, 0]], 'smooth');
      const trail = (h: typeof P.r, sx: number): void => {
        h.g = [h.g[0] * (1 - 0.3 * k) + sx * 0.0, h.g[1] * (1 - 0.7 * k) - 0.1 * k, h.g[2] * (1 - 0.8 * k) - 0.14 * k];
        h.b = [h.b[0] * (1 - 0.6 * k), h.b[1] * (1 - 0.5 * k) + 0.2 * k, h.b[2] * (1 - k) - 0.9 * k];
      };
      P = clonePose(P);
      trail(P.r, -1);
      trail(P.l, 1);
      solveWith(c, P);
      secondary(c, ch, c.t, c.t, 1, Math.cos(c.t * 10), 0);
    },
  });
  if (suffix) return out;

  // ---- hit: flinch back
  const hitKeys: Key[] = [
    { t: 0, p: {} },
    { t: 0.1, ease: 'out', p: { sp: [-0.35, 0.2, 0.1], head: [-0.4, 0.15, 0], hip: [-0.1, 0, 0], root: V(0, -0.05, -0.1), fl: V(0.1, 0, 0.1), fr: V(-0.1, 0, -0.2), r: { g: V(-0.3, -0.05, 0.1) }, l: { g: V(0.3, -0.05, 0.1) } } },
    { t: 0.28, ease: 'smooth', p: { sp: [-0.12, 0.05, 0.05], head: [-0.15, 0, 0], root: V(0, -0.03, -0.06) } },
    { t: 0.45, ease: 'smooth', p: { ...st.idle } },
  ];
  out.push({
    name: 'hit', duration: 0.45, loop: false,
    pose: (c) => {
      solveWith(c, evalKeys(st.idle, hitKeys, c.t));
      secondary(c, ch, c.t, c.t * 2, 0.2, -0.6 * keyed(c.t, [[0, 0], [0.1, 1], [0.45, 0]], 'smooth'), 0);
    },
  });

  // ---- death: stagger, fall backward, lie on the ground
  out.push({
    name: 'death', duration: 1.9, loop: false,
    pose: (c) => {
      const t = c.t;
      const P = clonePose(st.idle);
      const k1 = ramp(t, 0, 0.35, 'out'); // hit-reaction
      const k2 = ramp(t, 0.3, 0.9, 'in'); // collapse
      const k3 = ramp(t, 0.8, 1.25, 'out'); // slam to the ground
      const lie = ramp(t, 0.35, 1.25, 'smooth');
      // upper body jerks back, knees give, then the whole body topples about the feet
      P.sp = [-0.4 * k1 + 0.2 * k2, 0.2 * k1, 0.1 * k1];
      P.head = [-0.4 * k1 - 0.3 * k3, 0.15 * k1, 0];
      P.fl = [0.1 * k1, 0, 0.12 * k1 - 0.1 * k2];
      P.fr = [-0.1 * k1, 0, -0.15 * k1 - 0.05 * k2];
      const fall = 1.45 * lie; // rotate about X (head toward -Z)
      P.rootRot = [-fall, 0, 0.12 * lie];
      P.root = [0, (0.03 + 0.1 * (1 - Math.cos(Math.min(fall, 1.4)))) * 1 + (-0.05 * k2) * (1 - lie), -0.1 * k1 - 0.55 * lie * s];
      P.root[1] = Math.max(P.root[1], 0) + 0.09 * s * lie;
      // legs go slack in the air: lift ankles with the fall
      P.fl[1] = 0.25 * s * k3; P.fr[1] = 0.18 * s * k3;
      P.fl[2] += -0.12 * s * k3; P.fr[2] += -0.2 * s * k3;
      P.r = { ...P.r, g: [-0.3 - 0.1 * k3, -0.1 + 0.2 * k1 - 0.2 * k3, 0.1 - 0.15 * k3], c: 0.2, b: [0, 0.2, 1], e: [-1, 0, 0] };
      P.l = { ...P.l, g: [0.3 + 0.1 * k3, -0.1 + 0.2 * k1 - 0.2 * k3, 0.1 - 0.15 * k3], c: 0.2, b: [0, 0.2, 1], e: [1, 0, 0] };
      solveWith(c, P);
      secondary(c, ch, t, t, 0.3, -0.5 * k1, 0);
    },
  });

  // ---- spawn: rise from a crouch with a flourish
  const spawnKeys: Key[] = [
    { t: 0, p: { root: V(0, -0.34 * s, 0), sp: [0.5, 0, 0], head: [0.3, 0, 0], fl: V(0.14, 0, 0.1), fr: V(-0.14, 0, -0.1), r: { g: V(-0.3, -0.35, 0.1), c: 0.3 }, l: { g: V(0.3, -0.35, 0.1), c: 0.3 } } },
    { t: 0.45, ease: 'smooth', p: { root: V(0, -0.2 * s, 0.0), sp: [0.3, 0, 0], head: [0.1, 0, 0] } },
    { t: 0.8, ease: 'out', p: { ...st.idle, root: V(0, 0.02 * s, 0), sp: [-0.1, 0, 0], head: [-0.12, 0, 0] } },
    { t: 1.2, ease: 'smooth', p: { ...st.idle } },
  ];
  out.push({
    name: 'spawn', duration: 1.2, loop: false,
    pose: (c) => {
      solveWith(c, evalKeys(st.idle, spawnKeys, c.t));
      secondary(c, ch, c.t, c.t * 1.5, 0.2, 0, 0);
    },
  });

  // ---- victory: weapon / fist raised with a roar, then hold
  const vicKeys: Key[] = [
    { t: 0, p: {} },
    { t: 0.5, ease: 'smooth', p: { sp: [0.2, 0, 0], root: V(0, -0.12 * s, 0), r: { g: V(-0.2, -0.1, 0.3) } } },
    { t: 0.95, ease: 'out', p: { sp: [-0.24, 0.25, 0], head: [-0.3, 0, 0], root: V(0, 0.03 * s, 0), r: { g: V(-0.22, 0.45, 0.12), b: V(-0.1, 1, 0.2), c: 1 }, l: { g: V(0.26, 0.15, 0.2), b: V(0, 0.4, 1), c: 0.7 } } },
    { t: 2.0, ease: 'smooth', p: { sp: [-0.16, 0.25, 0], head: [-0.2, 0.1, 0], r: { g: V(-0.22, 0.42, 0.12) } } },
  ];
  out.push({
    name: 'victory', duration: 2.0, loop: false,
    pose: (c) => {
      solveWith(c, evalKeys(st.idle, vicKeys, c.t));
      secondary(c, ch, c.t, c.t, 0.1, 0, 0);
    },
  });
  void blendPose;
  return out;
}

export const AUTHORED_SPEED = { walk: gaitSpeed(WALK), run: gaitSpeed(RUN) };
