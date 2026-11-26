// Scorpion clip set: idle, walk (alternating tetrapod), run, attack (stinger strike, hit 0.35 s), hit, death (topple onto the side,
// legs curl), spawn (bursts up from the sand). Locomotion is in place with planted-foot IK.
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import { cwave, wave } from '../../core/anim/quadruped.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { LegSpec, ScorpionAnatomy } from './anatomy.ts';
import { LegRig } from './rig.ts';

const TAIL = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'] as const;

interface PalpPose {
  /** arm: pitch (x), spread yaw (outward positive), roll */
  ap?: number;
  ay?: number;
  /** elbow yaw (outward = straighter positive), pitch */
  ey?: number;
  ep?: number;
  /** wrist yaw / pitch */
  wy?: number;
  wp?: number;
  /** moving finger yaw: positive closes */
  f?: number;
}

function palp(c: PoseCtx, sd: 1 | -1, o: PalpPose): void {
  const n = sd === 1 ? 'l' : 'r';
  c.set(`arm_${n}`, o.ap ?? 0, sd * (o.ay ?? 0), 0);
  c.set(`forearm_${n}`, o.ep ?? 0, sd * (o.ey ?? 0), 0);
  c.set(`hand_${n}`, o.wp ?? 0, sd * (o.wy ?? 0), 0);
  c.set(`finger_${n}`, 0, sd * (o.f ?? 0), 0);
}

/** tail chain: pitch (positive curls the tip forward/down) and yaw per segment */
function tail(c: PoseCtx, pitch: number[], yaw: number[], roll = 0): void {
  TAIL.forEach((b, i) => c.set(b, pitch[i] ?? 0, yaw[i] ?? 0, i === 0 ? roll : 0));
}

const spread = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));

export function scorpionClips(a: ScorpionAnatomy, skel: Skeleton): ClipSpec[] {
  const s = a.s;
  const rig = new LegRig(skel, a.legs);
  const closeA = Math.atan2(0.14 * a.p.clawOpen, 0.395);
  const group = (l: LegSpec): number => ((l.side === 1) === (l.row % 2 === 0) ? 0 : 0.5);
  const walkG = { duty: 0.6, phase: (l: LegSpec) => group(l) - 0.045 * l.row, sweep: (l: LegSpec) => [0.33, 0.31, 0.31, 0.35][l.row]! * s, lift: 0.085 * s, out: 0.02 * s };
  const runG = { duty: 0.52, phase: (l: LegSpec) => group(l) - 0.03 * l.row, sweep: (l: LegSpec) => [0.4, 0.4, 0.4, 0.44][l.row]! * s, lift: 0.11 * s, out: 0.03 * s };

  // ------------------------------------------------------------------ idle
  const idle: ClipSpec = {
    name: 'idle', duration: 2.0, loop: true,
    pose(c) {
      const u = c.u;
      const br = wave(u, 1, 0);
      c.move('root', 0, s * (-0.004 + 0.005 * br), 0);
      c.set('chest', 0.012 * br, 0.03 * wave(u, 1, 0.2), 0.012 * wave(u, 1, 0.5));
      c.set('back', -0.012 * br, -0.04 * wave(u, 1, 0.25), 0);
      const flick = bump(u, 0.58, 0.62, 0.65, 0.72);
      tail(c, spread(5, (i) => 0.035 * wave(u, 1, 0.25 - 0.09 * i) * (0.6 + 0.2 * i) - 0.2 * flick * (i === 4 ? 1 : 0.35)), spread(5, (i) => 0.1 * wave(u, 1, 0.05 - 0.1 * i) * (0.5 + 0.25 * i)));
      const snapL = bump(u, 0.28, 0.32, 0.35, 0.44);
      const snapR = bump(u, 0.74, 0.78, 0.8, 0.9);
      palp(c, 1, { ay: 0.05 + 0.05 * wave(u, 1, 0.2), ap: -0.02 * br, ey: 0.04 * wave(u, 1, 0.45), f: closeA - 0.08 + (0.2 + 0.1) * snapL * 0.7 });
      palp(c, -1, { ay: 0.05 + 0.05 * wave(u, 1, 0.7), ap: -0.02 * br, ey: 0.04 * wave(u, 1, 0.95), f: closeA - 0.08 + 0.3 * snapR * 0.7 });
      const tapA = bump(u, 0.56, 0.62, 0.7, 0.78);
      const tapB = bump(u, 0.2, 0.26, 0.32, 0.4);
      rig.plantAll(c, (l) => (l.id === 'r1' ? { dy: 0.045 * s * tapA, dz: 0.035 * s * tapA } : l.id === 'l3' ? { dy: 0.03 * s * tapB, dz: -0.025 * s * tapB } : undefined));
    },
  };

  // ------------------------------------------------------------------ walk
  const walk: ClipSpec = {
    name: 'walk', duration: 0.7, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.006 * s - 0.008 * s * cwave(u, 2, 0.12), 0);
      c.set('chest', 0.012 * wave(u, 2, 0.1), 0.045 * wave(u, 1, 0), 0.03 * wave(u, 1, 0.25));
      c.set('back', 0.01 * wave(u, 2, 0.35), -0.07 * wave(u, 1, 0.05), -0.02 * wave(u, 1, 0.25));
      tail(c, spread(5, (i) => 0.02 + 0.04 * wave(u, 2, 0.1 - 0.08 * i) * (0.5 + 0.2 * i)), spread(5, (i) => 0.14 * wave(u, 1, 0.5 - 0.09 * i) * (0.45 + 0.28 * i)));
      palp(c, 1, { ay: 0.08 + 0.07 * wave(u, 1, 0.1), ap: 0.03 * wave(u, 2, 0.2), ey: 0.06 * wave(u, 1, 0.35), f: closeA - 0.05 + 0.05 * wave(u, 2, 0.1) });
      palp(c, -1, { ay: 0.08 + 0.07 * wave(u, 1, 0.6), ap: 0.03 * wave(u, 2, 0.7), ey: 0.06 * wave(u, 1, 0.85), f: closeA - 0.05 + 0.05 * wave(u, 2, 0.6) });
      rig.gait(c, walkG, u);
    },
  };

  // ------------------------------------------------------------------ run
  const run: ClipSpec = {
    name: 'run', duration: 0.36, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.012 * s - 0.014 * s * cwave(u, 2, 0.15), 0);
      c.set('chest', 0.05 + 0.02 * wave(u, 2, 0.1), 0.05 * wave(u, 1, 0), 0.035 * wave(u, 1, 0.25));
      c.set('back', 0.03 * wave(u, 2, 0.4), -0.08 * wave(u, 1, 0.05), -0.03 * wave(u, 1, 0.25));
      tail(c, spread(5, (i) => -0.12 + 0.06 * wave(u, 2, 0.1 - 0.1 * i) * (0.5 + 0.25 * i) - 0.03 * i), spread(5, (i) => 0.16 * wave(u, 1, 0.5 - 0.1 * i) * (0.4 + 0.3 * i)));
      palp(c, 1, { ay: -0.1 + 0.05 * wave(u, 1, 0.1), ap: 0.04 * wave(u, 2, 0.2), ey: -0.12, wy: -0.05, f: closeA });
      palp(c, -1, { ay: -0.1 + 0.05 * wave(u, 1, 0.6), ap: 0.04 * wave(u, 2, 0.7), ey: -0.12, wy: -0.05, f: closeA });
      rig.gait(c, runG, u);
    },
  };

  // ------------------------------------------------------------------ attack: stinger strike, hit at 0.35 s
  const attack: ClipSpec = {
    name: 'attack', duration: 1.1, loop: false, hit: 0.35,
    pose(c) {
      const t = c.t;
      const wind = ramp(t, 0.0, 0.19, 'out') * (1 - ramp(t, 0.19, 0.24, 'in')); // cock back + rear up
      const strike = ramp(t, 0.17, 0.35, 'in') * (1 - ramp(t, 0.52, 1.02, 'inout3'));
      const lunge = ramp(t, 0.15, 0.35, 'in') * (1 - ramp(t, 0.5, 1.0, 'inout3'));
      const rear = ramp(t, 0.0, 0.2, 'out') * (1 - ramp(t, 0.2, 0.36, 'in'));
      const quiver = bump(t, 0.35, 0.37, 0.5, 0.62) * wave(t, 14, 0);
      const jab = bump(t, 0.3, 0.35, 0.36, 0.44);
      const ox = 0.0;
      c.move('root', ox, s * (-0.02 * wind + 0.01 * lunge), s * (-0.05 * wind + 0.4 * lunge));
      c.set('chest', -0.22 * rear + 0.14 * strike, 0, 0);
      c.set('back', -0.12 * rear + 0.1 * strike, 0, 0);
      // tail: cock back (negative = unfurl), then whip forward and down
      const cock = [-0.4, -0.3, -0.14, 0.04, 0.13];
      const whip = [1.15, 0.27, -0.2, -0.42, -0.67];
      tail(c, spread(5, (i) => cock[i]! * wind + whip[i]! * strike + 0.05 * quiver + 0.08 * jab * (i === 4 ? 1 : 0.3)), spread(5, (i) => 0.02 * quiver * i));
      // claws spread wide while rearing, then grab shut on the strike
      const grab = ramp(t, 0.26, 0.36, 'in') * (1 - ramp(t, 0.55, 0.9, 'inout3'));
      const spreadW = 0.5 * wind + 0.12 * (1 - grab);
      for (const sd of [1, -1] as const) {
        palp(c, sd, { ay: 0.1 + spreadW - 0.25 * grab, ap: -0.2 * rear + 0.05 * strike, ey: 0.15 * wind - 0.15 * grab, wy: 0.1 * wind, f: closeA - 0.55 * wind + (0.34 + closeA * 0) * grab + 0.0 });
      }
      const fo = (l: LegSpec): { dz: number; dy: number } => ({ dz: s * lunge * 0.4 * [0.95, 0.9, 0.8, 0.7][l.row]!, dy: l.row < 1 ? 0.06 * s * rear : 0 });
      rig.plantAll(c, fo);
    },
  };

  // ------------------------------------------------------------------ hit flinch
  const hit: ClipSpec = {
    name: 'hit', duration: 0.5, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.06, 'out') * Math.exp(-5.5 * Math.max(0, t - 0.06));
      const osc = damped(Math.max(0, t - 0.06), 6, 7);
      c.move('root', 0, -0.02 * s * imp, -0.1 * s * imp);
      c.set('chest', -0.16 * imp + 0.03 * osc, 0.05 * osc, 0.04 * osc);
      c.set('back', -0.08 * imp, 0, 0);
      tail(c, spread(5, (i) => (0.22 * imp + 0.18 * osc) * (0.5 + 0.25 * i) - 0.05 * imp), spread(5, (i) => 0.1 * osc * i));
      for (const sd of [1, -1] as const) palp(c, sd, { ay: 0.25 * imp + 0.04 * osc, ap: -0.15 * imp, ey: 0.12 * imp, f: closeA - 0.5 * imp });
      rig.plantAll(c, () => ({ dz: -0.05 * s * imp }));
    },
  };

  // ------------------------------------------------------------------ death: stagger, topple onto the left side, legs curl
  const death: ClipSpec = {
    name: 'death', duration: 1.1, loop: false,
    pose(c) {
      const t = c.t;
      const stagger = ramp(t, 0, 0.18, 'out');
      const fall = ramp(t, 0.14, 0.62, 'in');
      const settle = ramp(t, 0.62, 1.1, 'out');
      const roll = -0.95 * fall - 0.04 * settle;
      const tw = damped(Math.max(0, t - 0.62), 6, 5) * settle;
      c.move('root', -0.22 * s * fall, s * (0.24 * fall - 0.01 * stagger), -0.12 * s * stagger + 0.06 * s * fall);
      c.set('root', 0, 0.12 * fall, roll);
      c.set('chest', -0.2 * stagger + 0.1 * fall, 0, 0);
      c.set('back', -0.1 * stagger, 0.1 * fall, 0);
      tail(c, spread(5, (i) => -0.25 * stagger * (1 - fall) + 0.28 * fall * (0.6 + 0.2 * i) + 0.12 * tw), spread(5, (i) => 0.25 * fall * (0.4 + 0.2 * i) + 0.08 * tw * i));
      for (const sd of [1, -1] as const) palp(c, sd, { ay: 0.3 * stagger - 0.1 * fall + 0.08 * tw, ap: 0.2 * fall, ey: -0.5 * fall, f: closeA + 0.3 * fall + 0.1 * tw });
      rig.foldAll(c, (l) => ({ amt: 0.5 * stagger * (1 - fall) + (0.9 - (l.side === 1 ? 0.1 : 0)) * fall, spread: 0.2 * (l.row < 2 ? 1 : -1) * fall, twitch: 0.35 * tw * (l.row % 2 === 0 ? 1 : -1) }));
    },
  };

  // ------------------------------------------------------------------ spawn: bursts up out of the sand, legs unfold, tail whips up
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.2, loop: false,
    pose(c) {
      const t = c.t;
      const rise = keyed(t, [[0, -0.62], [0.34, 0.05], [0.5, -0.01], [0.6, 0]], 'smooth');
      const up = 1 - ramp(t, 0.05, 0.62, 'inout3');
      const shake = bump(t, 0.45, 0.5, 0.75, 1.1) * wave(t, 8, 0);
      c.move('root', 0, s * rise, 0);
      c.set('chest', -0.55 * up + 0.04 * shake, 0.06 * shake, 0.2 * up * wave(t, 3, 0));
      c.set('back', -0.2 * up, 0, 0);
      const whip = keyed(t, [[0, -0.5], [0.3, -0.35], [0.5, 0.18], [0.7, -0.04], [1.0, 0]], 'smooth');
      tail(c, spread(5, (i) => whip * (0.6 + 0.2 * i)), spread(5, (i) => 0.1 * shake * i));
      const snap = bump(t, 0.5, 0.56, 0.62, 0.72) + bump(t, 0.78, 0.82, 0.86, 0.92);
      for (const sd of [1, -1] as const) palp(c, sd, { ay: 0.6 * up + 0.05 * shake, ap: -0.3 * up, ey: 0.35 * up, f: closeA - 0.6 * up * 0.6 + 0.45 * snap * 0.6 });
      const unfold = 1 - ramp(t, 0.12, 0.62, 'inout3');
      if (t < 0.62) rig.foldAll(c, (l) => ({ amt: unfold * 0.95, spread: 0.3 * (l.row < 2 ? 1 : -1) * unfold, twitch: 0.2 * wave(t, 6, l.row * 0.2) * unfold }));
      else rig.plantAll(c);
    },
  };

  return [idle, walk, run, attack, hit, death, spawn];
}
