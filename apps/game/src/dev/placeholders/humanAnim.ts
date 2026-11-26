// DEV-only: procedural clip set for humanoid rigs (orcs, brutes, bosses, heroes). Poses are authored as spline curves
// over normalised time; every attack has a readable wind-up → strike → recover with the contact instant recorded in `hit`.
// Conventions (see rig.ts): negative rx swings a hanging limb forward / tips the head up; +rx bends the torso forward.
import type { AnimationClip } from 'three';
import { clamp, curve, easeInOut } from './math';
import { bakeClips, type ClipSpec, type Pose, type Rig } from './rig';

export type AttackKind = 'smash' | 'stab' | 'cast' | 'bow';

export interface HumanAnimStyle {
  attack: AttackKind;
  /** > 1 = heavier/slower motion with bigger bob */
  mass: number;
  /** resting forward lean of the spine (rad) */
  hunch: number;
  /** arm carry style: club / sword held ready vs hanging */
  guard: boolean;
  /** hero clip extras (cast, dash, victory) */
  hero: boolean;
  /** boss extras (special2, special3) and bigger timings */
  boss: boolean;
  /** centre-of-mass height used by the death fall (m) */
  bodyH: number;
  /** half thickness lying on the ground (m) */
  halfT: number;
  /** total height (m) used to scale slams */
  height: number;
  /** knuckle-walker (long arms touch the ground) */
  knuckle: boolean;
}

const TAU = Math.PI * 2;
const SIDE = [
  { n: 'l', s: 1 },
  { n: 'r', s: -1 },
] as const;

function leg(p: Pose, n: string, swing: number, knee: number, foot = 0): void {
  p.r(`thigh_${n}`, -swing, 0, 0);
  p.r(`shin_${n}`, knee, 0, 0);
  p.r(`foot_${n}`, foot, 0, 0);
}

function arm(p: Pose, n: string, s: number, swing: number, abd: number, elbow: number, twist = 0): void {
  p.r(`uarm_${n}`, -swing, twist, s * abd);
  p.r(`farm_${n}`, -elbow, 0, 0);
}

interface Attack {
  T: number;
  /** contact instant, 0..1 */
  hitU: number;
  fn: (u: number, p: Pose) => void;
}

export function humanClips(rig: Rig, st: HumanAnimStyle): { clips: AnimationClip[]; hit: Record<string, number> } {
  const m = st.mass;
  const has = (n: string): boolean => rig.has(n);
  const secondary = (p: Pose, u: number, amp: number, lag = 0): void => {
    // tails, hair chains and boss spikes follow the body with a phase lag
    for (let i = 1; i <= 4; i++) {
      if (has(`tail${i}`)) {
        p.r(`tail${i}`, 0.08 * amp * Math.sin(TAU * u - lag - i * 0.7), 0.35 * amp * Math.sin(TAU * u - lag - i * 0.9), 0);
      }
      if (has(`hair${i}`)) {
        p.r(`hair${i}`, 0.18 * amp * Math.sin(TAU * u - lag - i * 0.8), 0.1 * amp * Math.sin(TAU * u * 2 - i), 0);
      }
      if (has(`spike${i}`)) p.r(`spike${i}`, 0.05 * amp * Math.sin(TAU * u - lag - i * 0.5), 0, 0);
    }
  };
  const bob = (p: Pose, y: number): void => p.m('hips', 0, y, 0);
  const stance = (p: Pose): void => {
    p.r('spine', st.hunch * 0.55, 0, 0);
    p.r('chest', st.hunch * 0.45, 0, 0);
    p.r('neck', -st.hunch * 0.5, 0, 0);
  };
  const guard = (p: Pose, k = 1): void => {
    if (!st.guard) return;
    p.r('uarm_r', -0.35 * k, 0, -0.05 * k);
    p.r('farm_r', -0.75 * k, 0, 0);
    p.r('hand_r', -0.15 * k, 0, 0);
  };

  const idle = (u: number, p: Pose): void => {
    const a = TAU * u;
    stance(p);
    p.m('hips', 0, -0.006 * m * Math.sin(a * 2 - 0.5) - 0.004, 0);
    p.r('hips', 0, 0.015 * Math.sin(a), 0.012 * Math.sin(a));
    p.r('spine', 0.012 * Math.sin(a * 2 - 1), -0.02 * Math.sin(a), -0.012 * Math.sin(a));
    p.r('chest', -0.022 * Math.sin(a * 2 - 1.4), 0, 0);
    p.r('clav_l', 0, 0, 0.02 * Math.sin(a * 2 - 1.4));
    p.r('clav_r', 0, 0, -0.02 * Math.sin(a * 2 - 1.4));
    p.r('neck', -0.02 * Math.sin(a * 2 - 1.8), 0.06 * Math.sin(a), 0);
    p.r('head', 0.02 * Math.sin(a * 2 - 2), 0.1 * Math.sin(a + 0.5), 0.02 * Math.sin(a));
    p.r('jaw', 0.03 + 0.02 * Math.max(0, Math.sin(a * 2)), 0, 0);
    arm(p, 'l', 1, 0.03 * Math.sin(a + 0.4), 0.05 + 0.02 * Math.sin(a * 2), 0.15 + 0.03 * Math.sin(a));
    arm(p, 'r', -1, -0.03 * Math.sin(a + 0.4), 0.05 + 0.02 * Math.sin(a * 2 + 1), 0.15 + 0.03 * Math.sin(a + 1));
    guard(p);
    leg(p, 'l', 0.03, 0.04);
    leg(p, 'r', -0.03, 0.04);
    p.r('thigh_l', 0, 0, 0.015 * Math.sin(a));
    p.r('thigh_r', 0, 0, 0.015 * Math.sin(a));
    secondary(p, u, 0.6, 0.5);
  };

  const walk = (u: number, p: Pose): void => {
    const a = TAU * u;
    stance(p);
    for (const { n, s } of SIDE) {
      const ph = a + (s > 0 ? 0 : Math.PI);
      const sw = Math.sin(ph);
      const lift = Math.max(0, Math.cos(ph));
      leg(p, n, 0.46 * sw, 0.08 + 0.85 * lift, -0.1 * lift + 0.2 * (sw - 0.3) * (sw < 0 ? 0.5 : 0));
      arm(p, n, s, -0.38 * sw * (st.knuckle ? 0.7 : 1), 0.06, 0.2 + 0.25 * Math.max(0, -sw), -0.1 * sw);
    }
    guard(p, 0.6);
    p.m('hips', 0, 0.022 * m * Math.cos(a * 2) - 0.012, 0);
    p.r('hips', 0.03, -0.13 * Math.sin(a), 0.035 * Math.sin(a));
    p.r('spine', 0.02 * Math.cos(a * 2), 0.12 * Math.sin(a), -0.03 * Math.sin(a));
    p.r('chest', 0.02, 0.09 * Math.sin(a), 0);
    p.r('neck', 0, -0.08 * Math.sin(a), 0);
    p.r('head', 0.02 * Math.cos(a * 2), -0.06 * Math.sin(a), 0);
    p.r('jaw', 0.04, 0, 0);
    secondary(p, u, 1.2, 0.8);
  };

  const run = (u: number, p: Pose): void => {
    const a = TAU * u;
    p.r('spine', st.hunch * 0.5 + 0.2, 0, 0);
    p.r('chest', 0.1, 0, 0);
    for (const { n, s } of SIDE) {
      const ph = a + (s > 0 ? 0 : Math.PI);
      const sw = Math.sin(ph);
      const lift = Math.max(0, Math.cos(ph));
      leg(p, n, 0.85 * sw + 0.1, 0.25 + 1.35 * lift, -0.35 * lift);
      arm(p, n, s, -0.75 * sw + 0.1, 0.1, 1.15 + 0.3 * Math.max(0, -sw), -0.15 * sw);
    }
    guard(p, 0.35);
    p.m('hips', 0, 0.06 * m * Math.abs(Math.sin(a)) - 0.05, 0);
    p.r('hips', 0.06, -0.2 * Math.sin(a), 0.05 * Math.sin(a));
    p.r('spine', 0, 0.18 * Math.sin(a), 0);
    p.r('chest', 0, 0.12 * Math.sin(a), 0);
    p.r('neck', -0.12, -0.1 * Math.sin(a), 0);
    p.r('head', -0.04, -0.06 * Math.sin(a), 0);
    p.r('jaw', 0.1, 0, 0);
    secondary(p, u, 2.2, 1.0);
  };

  // --------------------------------------------------------------- attack kits
  const smash1: Attack = {
    T: st.boss ? 1.5 : 1.0 * Math.sqrt(m),
    hitU: 0.54,
    fn(u, p) {
      const w = curve(u, [[0, 0], [0.42, 1], [0.47, 1], [0.56, 0], [1, 0]]);
      const s = curve(u, [[0, 0], [0.44, 0], [0.54, 1], [0.66, 0.92], [0.88, 0.15], [1, 0]]);
      const reach = st.knuckle ? 0.9 : 1;
      stance(p);
      p.m('root', 0, -0.05 * s * m, 0.18 * s * reach);
      p.r('hips', 0, 0.2 * w - 0.35 * s, 0);
      p.r('spine', -0.22 * w + 0.42 * s, 0.25 * w - 0.4 * s, 0);
      p.r('chest', -0.15 * w + 0.3 * s, 0.2 * w - 0.3 * s, 0);
      p.r('neck', 0.1 * w - 0.25 * s, 0, 0);
      p.r('head', 0.05 * w, 0, 0);
      p.r('jaw', 0.5 * s * (st.boss ? 1.2 : 1), 0, 0);
      p.r('uarm_r', -2.65 * w - 0.55 * s, 0, -0.18 * w);
      p.r('farm_r', -0.9 * w - 0.3 * s, 0, 0);
      p.r('hand_r', 0.2 * w - 0.5 * s, 0, 0);
      p.r('uarm_l', -1.2 * w - 0.2 * s, 0, 0.5 * w + 0.2 * s);
      p.r('farm_l', -0.6 * w - 0.4 * s, 0, 0);
      leg(p, 'l', -0.25 * s + 0.15 * w, 0.4 * s + 0.15 * w, 0);
      leg(p, 'r', 0.35 * s - 0.1 * w, 0.3 * w + 0.3 * s, 0);
      secondary(p, u, 0.8 * (w + s), 0);
    },
  };
  const sweep2: Attack = {
    T: st.boss ? 1.8 : 1.2 * Math.sqrt(m),
    hitU: 0.58,
    fn(u, p) {
      const t = curve(u, [[0, 0], [0.38, -1], [0.48, -1], [0.6, 1], [0.8, 0.35], [1, 0]]);
      const ext = curve(u, [[0, 0], [0.3, 0.6], [0.5, 1], [0.7, 1], [1, 0]]);
      stance(p);
      p.m('root', 0, -0.03 * ext * m, 0);
      p.r('hips', 0, -0.3 * t, 0);
      p.r('spine', 0.1 * ext, 0.5 * t, 0);
      p.r('chest', 0, 0.35 * t, 0);
      p.r('head', 0, -0.25 * t, 0);
      p.r('jaw', 0.35 * Math.max(0, t), 0, 0);
      p.r('uarm_r', -0.8 * ext - 0.5 * Math.max(0, t), 0, -1.25 * ext);
      p.r('farm_r', -0.3 * ext, 0, 0);
      p.r('uarm_l', -0.4 * ext, 0, 0.6 * ext);
      p.r('farm_l', -0.8 * ext, 0, 0);
      leg(p, 'l', -0.2 * ext, 0.2 * ext, 0);
      leg(p, 'r', 0.25 * ext, 0.25 * ext, 0);
    },
  };
  const stab1: Attack = {
    T: 0.55,
    hitU: 0.46,
    fn(u, p) {
      const w = curve(u, [[0, 0], [0.3, 1], [0.38, 1], [0.5, 0], [1, 0]]);
      const s = curve(u, [[0, 0], [0.34, 0], [0.46, 1], [0.58, 0.9], [0.85, 0.1], [1, 0]]);
      stance(p);
      p.m('root', 0, -0.03 * w, 0.28 * s);
      p.r('hips', 0.04 * s, 0.3 * w - 0.6 * s, 0);
      p.r('spine', 0.15 * s - 0.1 * w, 0.3 * w - 0.5 * s, 0);
      p.r('chest', 0.1 * s, 0.25 * w - 0.3 * s, 0);
      p.r('head', 0, -0.2 * w + 0.35 * s, 0);
      p.r('jaw', 0.3 * s, 0, 0);
      p.r('uarm_r', 0.6 * w - 1.55 * s, 0.2 * w, -0.5 * w);
      p.r('farm_r', -1.2 * w - 0.1 * s, 0, 0);
      p.r('hand_r', 0, 0, 0);
      p.r('uarm_l', -0.5 * w + 0.6 * s, 0, 0.5 * w + 0.3 * s);
      p.r('farm_l', -0.9 * w, 0, 0);
      leg(p, 'l', -0.7 * s + 0.1 * w, 0.6 * s, 0);
      leg(p, 'r', 0.5 * s, 0.2 * w + 0.25 * s, 0);
      secondary(p, u, 1 * (w + s), 0);
    },
  };
  const cross2: Attack = {
    T: 0.72,
    hitU: 0.46,
    fn(u, p) {
      const t = curve(u, [[0, 0], [0.26, -1], [0.34, -1], [0.48, 1], [0.7, 0.2], [1, 0]]);
      const ext = curve(u, [[0, 0], [0.25, 1], [0.6, 1], [1, 0]]);
      stance(p);
      p.m('root', 0, -0.04 * ext, 0.15 * Math.max(0, t));
      p.r('hips', 0, -0.35 * t, 0);
      p.r('spine', 0.2 * ext, 0.55 * t, 0);
      p.r('chest', 0, 0.35 * t, 0);
      p.r('head', 0, -0.3 * t, 0);
      p.r('uarm_r', -1.0 * Math.max(0, t) + 0.5 * Math.max(0, -t), 0, -1.1 * Math.max(0, -t) - 0.2);
      p.r('farm_r', -0.6 * ext, 0, 0);
      p.r('uarm_l', -1.1 * Math.max(0, -t) + 0.3, 0, 0.9 * Math.max(0, t));
      p.r('farm_l', -0.6 * ext, 0, 0);
      leg(p, 'l', -0.5 * ext, 0.5 * ext, 0);
      leg(p, 'r', 0.4 * ext, 0.4 * ext, 0);
      secondary(p, u, 1.2 * ext, 0);
    },
  };
  const cast1: Attack = {
    T: 0.95,
    hitU: 0.5,
    fn(u, p) {
      const w = curve(u, [[0, 0], [0.42, 1], [0.5, 1], [0.58, 0], [1, 0]]);
      const s = curve(u, [[0, 0], [0.44, 0], [0.56, 1], [0.8, 0.6], [1, 0]]);
      stance(p);
      p.r('spine', -0.14 * w + 0.16 * s, 0, 0);
      p.r('chest', -0.1 * w + 0.12 * s, 0, 0);
      p.r('head', -0.15 * w + 0.1 * s, 0, 0);
      p.r('uarm_r', -1.7 * w - 0.4 * s, 0, -0.25 * w);
      p.r('farm_r', -0.9 * w - 0.5 * s, 0, 0);
      p.r('uarm_l', -0.9 * w - 0.9 * s, 0, 0.6 * w);
      p.r('farm_l', -1.0 * w - 0.3 * s, 0, 0);
      p.m('root', 0, 0.02 * w, 0);
      leg(p, 'l', -0.15 * s, 0.1 * s, 0);
      leg(p, 'r', 0.2 * s, 0.15 * s, 0);
      secondary(p, u, 1 * (w + s), 0);
    },
  };
  const spin2: Attack = {
    T: 1.15,
    hitU: 0.5,
    fn(u, p) {
      const k = curve(u, [[0, 0], [0.18, 0.6], [0.35, 1], [0.7, 1], [1, 0]]);
      stance(p);
      p.r('root', 0, TAU * easeInOut(clamp((u - 0.15) / 0.65, 0, 1)), 0);
      p.m('root', 0, 0.06 * Math.sin(Math.PI * clamp((u - 0.15) / 0.65, 0, 1)), 0);
      p.r('spine', 0.12 * k, 0, 0);
      p.r('uarm_r', -0.4 * k, 0, -1.5 * k);
      p.r('uarm_l', -0.4 * k, 0, 1.5 * k);
      p.r('farm_r', -0.2 * k, 0, 0);
      p.r('farm_l', -0.2 * k, 0, 0);
      leg(p, 'l', 0.3 * k, 0.8 * k, 0);
      leg(p, 'r', -0.2 * k, 0.2 * k, 0);
      secondary(p, u, 2 * k, 0);
    },
  };
  const bow1: Attack = {
    T: 0.85,
    hitU: 0.52,
    fn(u, p) {
      const draw = curve(u, [[0, 0], [0.35, 1], [0.5, 1], [0.54, 0], [1, 0]]);
      const hold = curve(u, [[0, 0], [0.25, 1], [0.7, 1], [1, 0]]);
      stance(p);
      p.r('spine', 0, -0.5 * hold, 0);
      p.r('chest', 0, -0.3 * hold, 0);
      p.r('head', 0, 0.45 * hold, 0);
      p.r('uarm_l', -1.45 * hold, -0.1, 0.12 * hold);
      p.r('farm_l', 0, 0, 0);
      p.r('uarm_r', -1.35 * hold, 0, -0.95 * hold - 0.2 * draw);
      p.r('farm_r', -1.9 * draw - 0.2 * (hold - draw), 0, 0);
      p.m('root', 0, -0.02 * hold, -0.04 * draw);
      leg(p, 'l', 0.2 * hold, 0.1, 0);
      leg(p, 'r', -0.25 * hold, 0.1, 0);
    },
  };
  const rapid2: Attack = {
    T: 0.62,
    hitU: 0.4,
    fn(u, p) {
      const k = curve(u, [[0, 0], [0.2, 1], [0.5, 0.6], [0.72, 0.9], [1, 0]]);
      stance(p);
      p.m('root', 0, -0.05 * k, -0.1 * k);
      p.r('spine', 0.15 * k, 0, 0);
      p.r('uarm_l', -1.4 * k, 0, 0.1);
      p.r('uarm_r', -1.2 * k, 0, -0.8 * k);
      p.r('farm_r', -1.3 * k, 0, 0);
      leg(p, 'l', 0.4 * k, 0.6 * k, 0);
      leg(p, 'r', -0.4 * k, 0.3 * k, 0);
    },
  };
  const kits: Record<AttackKind, [Attack, Attack]> = {
    smash: [smash1, sweep2],
    stab: [stab1, cross2],
    cast: [cast1, spin2],
    bow: [bow1, rapid2],
  };
  const [atk1, atk2] = kits[st.attack];

  const hit = (u: number, p: Pose): void => {
    const k = curve(u, [[0, 0], [0.16, 1], [0.4, 0.3], [1, 0]]);
    stance(p);
    p.m('root', 0, 0, -0.12 * k);
    p.r('hips', -0.1 * k, 0.15 * k, 0);
    p.r('spine', -0.3 * k, -0.2 * k, 0.05 * k);
    p.r('chest', -0.2 * k, -0.15 * k, 0);
    p.r('neck', -0.3 * k, 0, 0);
    p.r('head', -0.25 * k, 0.2 * k, 0.1 * k);
    p.r('jaw', 0.5 * k, 0, 0);
    p.r('uarm_l', 0.3 * k, 0, 0.6 * k);
    p.r('uarm_r', 0.3 * k, 0, -0.6 * k);
    p.r('farm_l', -0.5 * k, 0, 0);
    p.r('farm_r', -0.5 * k, 0, 0);
    leg(p, 'l', 0.2 * k, 0.25 * k, 0);
    leg(p, 'r', -0.15 * k, 0.1 * k, 0);
    secondary(p, u, 2 * k, 0);
  };

  const death = (u: number, p: Pose): void => {
    // stagger, knees buckle, topple backwards, arms flop, settle
    const stag = curve(u, [[0, 0], [0.12, 1], [0.3, 0.6], [0.4, 0.2]]);
    const buckle = curve(u, [[0, 0], [0.25, 0.1], [0.45, 1], [0.62, 0.5], [0.78, 0]]);
    const fall = curve(u, [[0, 0], [0.3, 0], [0.62, 1], [0.7, 1.03], [0.8, 1]]);
    const th = -fall * (Math.PI / 2) * 0.97;
    const cy = st.bodyH + (st.halfT - st.bodyH) * clamp(fall, 0, 1);
    p.r('root', th, 0, 0);
    p.m('root', 0, cy - st.bodyH * Math.cos(th), -st.bodyH * Math.sin(th));
    p.m('root', 0, 0, -0.1 * stag);
    p.r('hips', 0, 0.25 * stag, 0);
    p.r('spine', -0.3 * stag + 0.2 * buckle, -0.3 * stag, 0);
    p.r('chest', -0.2 * stag, 0, 0);
    p.r('neck', -0.3 * stag, 0, 0);
    p.r('head', -0.2 * stag - 0.15 * fall, 0.3 * fall, 0.25 * fall);
    p.r('jaw', 0.6 * Math.min(1, stag + fall), 0, 0);
    p.r('uarm_l', 0.4 * stag, 0, 0.5 * stag + 0.9 * fall);
    p.r('uarm_r', 0.2 * stag, 0, -0.5 * stag - 0.7 * fall);
    p.r('farm_l', -0.6 * stag, 0, 0);
    p.r('farm_r', -0.8 * stag, 0, 0);
    // a lying body would pin a tail under it: swing it out along the ground
    if (has('tail1')) {
      p.r('tail1', -1.35 * fall, 0, 0);
      p.r('tail2', -0.25 * fall, 0, 0);
    }
    p.r('hand_l', 0.4 * fall, 0, 0);
    p.r('hand_r', 0.2 * fall, 0, 0);
    leg(p, 'l', -0.35 * buckle + 0.05 * fall, 0.9 * buckle, 0);
    leg(p, 'r', -0.55 * buckle - 0.08 * fall, 1.2 * buckle, 0);
    secondary(p, 0.25, 1.2 * (1 - fall), 0);
  };

  const spawn = (u: number, p: Pose): void => {
    const rise = curve(u, [[0, 0], [0.55, 1], [0.72, 1.02], [1, 1]]);
    const pop = curve(u, [[0, 0.3], [0.5, 1.1], [0.75, 0.98], [1, 1]]);
    const flex = curve(u, [[0, 0], [0.5, 0], [0.68, 1], [0.85, -0.3], [1, 0]]);
    p.m('root', 0, -0.9 * (1 - rise), 0);
    p.s('root', pop);
    p.r('root', 0.45 * (1 - rise), 0, 0);
    p.r('spine', -0.1 * flex + 0.2 * (1 - rise), 0, 0);
    p.r('chest', -0.2 * flex, 0, 0);
    p.r('head', -0.25 * flex - 0.3 * (1 - rise), 0, 0);
    p.r('jaw', 0.4 * Math.max(0, flex), 0, 0);
    p.r('uarm_l', -0.3 * flex, 0, 0.5 * flex);
    p.r('uarm_r', -0.3 * flex, 0, -0.5 * flex);
    leg(p, 'l', 0.2 * (1 - rise), 0.3 * (1 - rise), 0);
    leg(p, 'r', -0.2 * (1 - rise), 0.3 * (1 - rise), 0);
  };

  // special1: roar / war cry / chest pound
  const roar = (u: number, p: Pose): void => {
    const k = curve(u, [[0, 0], [0.22, 1], [0.78, 1], [1, 0]]);
    const q = Math.sin(TAU * u * 6) * 0.04 * k;
    const pound = st.knuckle ? Math.max(0, Math.sin(TAU * u * 3 - 1.2)) * k : 0;
    stance(p);
    p.m('root', 0, 0.015 * k, 0);
    p.r('spine', -0.2 * k, 0, 0);
    p.r('chest', -0.35 * k, 0, q);
    p.r('neck', -0.2 * k, 0, 0);
    p.r('head', -0.55 * k, 0, q * 2);
    p.r('jaw', 0.85 * k, 0, 0);
    if (st.knuckle) {
      p.r('uarm_l', -1.25 * k + 0.1 * pound, 0, 0.5 * k - 0.5 * pound);
      p.r('uarm_r', -1.25 * k + 0.1 * pound, 0, -0.5 * k + 0.5 * pound);
      p.r('farm_l', -1.6 * k, 0, 0);
      p.r('farm_r', -1.6 * k, 0, 0);
    } else {
      p.r('uarm_l', -0.4 * k, 0, 1.1 * k);
      p.r('uarm_r', -0.4 * k, 0, -1.1 * k);
      p.r('farm_l', -0.5 * k, 0, 0);
      p.r('farm_r', -0.5 * k, 0, 0);
    }
    leg(p, 'l', -0.1 * k, 0.1 * k, 0);
    leg(p, 'r', 0.15 * k, 0.1 * k, 0);
    secondary(p, u, 1.5 * k, 0);
  };

  // boss specials
  const slam: Attack = {
    T: 2.3,
    hitU: 0.58,
    fn(u, p) {
      const w = curve(u, [[0, 0], [0.45, 1], [0.54, 1], [0.6, 0], [1, 0]]);
      const s = curve(u, [[0, 0], [0.5, 0], [0.58, 1], [0.75, 0.85], [1, 0]]);
      stance(p);
      p.m('root', 0, 0.05 * w - 0.12 * s, 0.12 * s);
      p.r('spine', -0.3 * w + 0.7 * s, 0, 0);
      p.r('chest', -0.2 * w + 0.4 * s, 0, 0);
      p.r('neck', 0.2 * w - 0.3 * s, 0, 0);
      p.r('head', -0.3 * w + 0.3 * s, 0, 0);
      p.r('jaw', 1.0 * w * (1 - s) + 0.2 * s, 0, 0);
      p.r('uarm_l', -2.9 * w - 0.25 * s, 0, 0.3 * w);
      p.r('uarm_r', -2.9 * w - 0.25 * s, 0, -0.3 * w);
      p.r('farm_l', -0.6 * w - 0.2 * s, 0, 0);
      p.r('farm_r', -0.6 * w - 0.2 * s, 0, 0);
      leg(p, 'l', 0.2 * w - 0.4 * s, 0.3 * w + 0.5 * s, 0);
      leg(p, 'r', -0.1 * w + 0.2 * s, 0.3 * w + 0.4 * s, 0);
      secondary(p, u, 1.5 * (w + s), 0);
    },
  };
  const whirl: Attack = {
    T: 2.0,
    hitU: 0.5,
    fn(u, p) {
      const k = curve(u, [[0, 0], [0.2, 1], [0.78, 1], [1, 0]]);
      const sp = easeInOut(clamp((u - 0.2) / 0.58, 0, 1));
      stance(p);
      p.r('root', 0, TAU * 2 * sp, 0);
      p.r('spine', 0.28 * k, 0, 0);
      p.r('uarm_l', -0.3 * k, 0, 1.45 * k);
      p.r('uarm_r', -0.3 * k, 0, -1.45 * k);
      p.r('farm_l', -0.15 * k, 0, 0);
      p.r('farm_r', -0.15 * k, 0, 0);
      p.r('head', 0.1 * k, 0, 0);
      leg(p, 'l', 0.25 * k, 0.6 * k, 0);
      leg(p, 'r', -0.25 * k, 0.25 * k, 0);
      secondary(p, u, 3 * k, 0);
    },
  };

  // hero extras
  const dash = (u: number, p: Pose): void => {
    const k = curve(u, [[0, 0], [0.2, 1], [0.7, 1], [1, 0]]);
    p.r('root', 0.5 * k, 0, 0);
    p.m('root', 0, -0.1 * k, 0);
    p.r('spine', 0.15 * k, 0, 0);
    p.r('head', -0.45 * k, 0, 0);
    p.r('uarm_l', 1.0 * k, 0, 0.4 * k);
    p.r('uarm_r', 1.1 * k, 0, -0.35 * k);
    p.r('farm_l', -0.4 * k, 0, 0);
    p.r('farm_r', -0.5 * k, 0, 0);
    leg(p, 'l', -1.0 * k, 1.2 * k, 0);
    leg(p, 'r', 0.9 * k, 0.5 * k, -0.4 * k);
    secondary(p, u, 2.5 * k, 0);
  };
  const victory = (u: number, p: Pose): void => {
    const k = curve(u, [[0, 0], [0.2, 1], [0.85, 1], [1, 0]]);
    const cheer = Math.sin(TAU * u * 3) * 0.06 * k;
    stance(p);
    p.r('spine', -0.12 * k, 0, 0);
    p.r('chest', -0.2 * k, 0, 0);
    p.r('head', -0.3 * k, 0, 0);
    p.r('jaw', 0.6 * k * Math.max(0, Math.sin(TAU * u * 3)), 0, 0);
    p.r('uarm_r', -2.7 * k + cheer, 0, -0.35 * k);
    p.r('farm_r', -0.4 * k, 0, 0);
    p.r('uarm_l', -0.3 * k, 0, 0.8 * k);
    p.r('farm_l', -0.8 * k, 0, 0);
    p.m('root', 0, 0.02 * k, 0);
    leg(p, 'l', -0.1 * k, 0.1 * k, 0);
    leg(p, 'r', 0.15 * k, 0.1 * k, 0);
    secondary(p, u, 1.4 * k, 0);
  };

  const specs: ClipSpec[] = [
    { name: 'idle', duration: st.boss ? 3.2 : 2.6, loop: true, fn: idle },
    { name: 'walk', duration: st.boss ? 1.5 : st.knuckle ? 1.2 : 1.05, loop: true, fn: walk },
    { name: 'run', duration: st.boss ? 0.9 : 0.64, loop: true, fn: run },
    { name: 'attack', duration: atk1.T, loop: false, fn: atk1.fn, fps: 30 },
    { name: 'attack2', duration: atk2.T, loop: false, fn: atk2.fn, fps: 30 },
    { name: 'hit', duration: 0.46, loop: false, fn: hit, fps: 30 },
    { name: 'death', duration: st.boss ? 2.2 : 1.5, loop: false, fn: death, fps: 30 },
    { name: 'spawn', duration: 1.0, loop: false, fn: spawn, fps: 30 },
    { name: 'special1', duration: st.boss ? 2.6 : 1.9, loop: false, fn: roar },
  ];
  const hits: Record<string, number> = { attack: atk1.T * atk1.hitU, attack2: atk2.T * atk2.hitU };
  if (st.boss) {
    specs.push({ name: 'special2', duration: slam.T, loop: false, fn: slam.fn, fps: 30 });
    specs.push({ name: 'special3', duration: whirl.T, loop: false, fn: whirl.fn, fps: 30 });
    hits.special2 = slam.T * slam.hitU;
    hits.special3 = whirl.T * whirl.hitU;
  }
  if (st.hero) {
    specs.push({ name: 'cast', duration: cast1.T, loop: false, fn: cast1.fn, fps: 30 });
    specs.push({ name: 'dash', duration: 0.5, loop: false, fn: dash, fps: 30 });
    specs.push({ name: 'victory', duration: 1.8, loop: false, fn: victory });
    hits.cast = cast1.T * cast1.hitU;
  }
  const posBones = ['root', 'hips'];
  const clips = bakeClips(rig, specs, { posBones, scaleBones: ['root'] });
  return { clips, hit: hits };
}
