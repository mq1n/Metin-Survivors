// Frost-beetle clip set: idle (breathing, antenna sweeps, mandible clicks, crystal shimmer), walk/run (tripod gait, planted feet),
// attack ('explode' kamikaze: crouch + swell + crystal flare + shudder for 0.7 s, then the burst lunge, hit at 0.7 s), hit, death
// (flips onto its side, legs curl, crystals shake), spawn (bursts out of the ice, crystals pop up with overshoot).
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import { cwave, wave } from '../../core/anim/quadruped.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { BeetleAnatomy, LegSpec } from './anatomy.ts';
import { LegRig } from './rig.ts';

const CRESTS = ['crest_f', 'crest_m', 'crest_r'] as const;

interface Face {
  /** mandible opening (positive = open) */
  mand?: number;
  /** elytra parting (roll, positive = open) and rear lift */
  elytra?: number;
  lift?: number;
  /** head yaw / pitch (pitch positive = nose down) */
  hy?: number;
  hp?: number;
  /** antenna sweep yaw / pitch */
  ay?: number;
  ap?: number;
}

function face(c: PoseCtx, o: Face): void {
  const m = o.mand ?? 0;
  c.set('mand_l', 0, m, 0);
  c.set('mand_r', 0, -m, 0);
  const e = o.elytra ?? 0, l = o.lift ?? 0;
  c.set('elytra_l', l, 0, e);
  c.set('elytra_r', l, 0, -e);
  c.set('head', o.hp ?? 0, o.hy ?? 0, 0);
  c.set('ant_l', o.ap ?? 0, o.ay ?? 0, 0);
  c.set('ant_r', o.ap ?? 0, -(o.ay ?? 0), 0);
}

/** crystal fan: per-group scale + pitch (f/m/r) + roll */
function crest(c: PoseCtx, sc: [number, number, number], pitch: [number, number, number], roll = 0): void {
  CRESTS.forEach((b, i) => {
    c.set(b, pitch[i]!, 0, roll * (i === 1 ? 1 : 0.6));
    c.scale(b, sc[i]!);
  });
}

export function beetleClips(a: BeetleAnatomy, skel: Skeleton): ClipSpec[] {
  const s = a.s;
  const rig = new LegRig(skel, a.legs);
  const group = (l: LegSpec): number => ((l.side === 1) === (l.row % 2 === 0) ? 0 : 0.5);
  const walkG = { duty: 0.62, phase: group, sweep: (l: LegSpec) => [0.26, 0.24, 0.28][l.row]! * s, lift: 0.09 * s, out: 0.025 * s, pitch: 0.4 };
  const runG = { duty: 0.5, phase: group, sweep: (l: LegSpec) => [0.44, 0.4, 0.46][l.row]! * s, lift: 0.12 * s, out: 0.03 * s, pitch: 0.5 };

  // ------------------------------------------------------------------ idle
  const idle: ClipSpec = {
    name: 'idle', duration: 1.8, loop: true,
    pose(c) {
      const u = c.u;
      const br = wave(u, 1, 0);
      c.move('root', 0, s * (-0.004 + 0.005 * br), 0);
      c.set('chest', 0.012 * br, 0.03 * wave(u, 1, 0.2), 0.012 * wave(u, 1, 0.5));
      c.set('back', -0.01 * br, -0.03 * wave(u, 1, 0.3), 0);
      const click = bump(u, 0.6, 0.64, 0.66, 0.74);
      face(c, {
        mand: 0.14 + 0.07 * wave(u, 2, 0.1) - 0.3 * click,
        elytra: 0.03 + 0.025 * br,
        lift: 0.012 * br,
        hy: 0.16 * wave(u, 1, 0.1),
        hp: 0.05 * wave(u, 2, 0.3) + 0.04,
        ay: 0.18 * wave(u, 1, 0.2),
        ap: 0.14 * wave(u, 2, 0.45),
      });
      crest(c, [1 + 0.02 * wave(u, 3, 0), 1 + 0.02 * wave(u, 3, 0.25), 1 + 0.02 * wave(u, 3, 0.5)], [0.02 * wave(u, 2, 0), 0.015 * wave(u, 2, 0.2), -0.02 * wave(u, 2, 0.4)], 0.02 * wave(u, 1, 0.3));
      const tap = bump(u, 0.45, 0.5, 0.58, 0.66);
      rig.plantAll(c, (l) => (l.id === 'r1' ? { dy: 0.05 * s * tap, dz: 0.04 * s * tap, pitch: 0.3 * tap } : undefined));
    },
  };

  // ------------------------------------------------------------------ walk
  const walk: ClipSpec = {
    name: 'walk', duration: 0.7, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.008 * s - 0.01 * s * cwave(u, 2, 0.12), 0);
      c.set('chest', 0.015 * wave(u, 2, 0.1), 0.05 * wave(u, 1, 0), 0.035 * wave(u, 1, 0.25));
      c.set('back', 0.01 * wave(u, 2, 0.35), -0.06 * wave(u, 1, 0.05), -0.02 * wave(u, 1, 0.25));
      face(c, {
        mand: 0.18 + 0.08 * wave(u, 2, 0.2),
        elytra: 0.035 + 0.025 * wave(u, 2, 0.3),
        lift: 0.02 * wave(u, 2, 0.5),
        hy: -0.06 * wave(u, 1, 0.05),
        hp: 0.05 + 0.03 * wave(u, 2, 0.5),
        ay: 0.2 * wave(u, 1, 0.3),
        ap: 0.1 * wave(u, 2, 0.6),
      });
      crest(c, [1, 1, 1], [0.025 * wave(u, 2, 0.1), 0.03 * wave(u, 2, 0.2), 0.035 * wave(u, 2, 0.3)], -0.04 * wave(u, 1, 0.15));
      rig.gait(c, walkG, u);
    },
  };

  // ------------------------------------------------------------------ run
  const run: ClipSpec = {
    name: 'run', duration: 0.34, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.016 * s - 0.016 * s * cwave(u, 2, 0.15), 0);
      c.set('chest', 0.07 + 0.02 * wave(u, 2, 0.1), 0.05 * wave(u, 1, 0), 0.04 * wave(u, 1, 0.25));
      c.set('back', 0.03 * wave(u, 2, 0.4), -0.07 * wave(u, 1, 0.05), -0.03 * wave(u, 1, 0.25));
      face(c, {
        mand: 0.35 + 0.1 * wave(u, 2, 0.2),
        elytra: 0.08 + 0.04 * wave(u, 2, 0.3),
        lift: 0.05 + 0.03 * wave(u, 2, 0.5),
        hy: -0.06 * wave(u, 1, 0.05),
        hp: 0.12,
        ay: 0.1 * wave(u, 1, 0.3) + 0.2,
        ap: -0.25,
      });
      crest(c, [1, 1, 1], [-0.12 + 0.03 * wave(u, 2, 0.1), -0.14 + 0.03 * wave(u, 2, 0.2), -0.16 + 0.035 * wave(u, 2, 0.3)], -0.05 * wave(u, 1, 0.15));
      rig.gait(c, runG, u);
    },
  };

  // ------------------------------------------------------------------ attack: kamikaze charge-up, burst at 0.7 s
  const attack: ClipSpec = {
    name: 'attack', duration: 1.1, loop: false, hit: 0.7,
    pose(c) {
      const t = c.t;
      const charge = ramp(t, 0.0, 0.66, 'inout3');
      const burst = ramp(t, 0.64, 0.72, 'out');
      const recoil = ramp(t, 0.72, 1.06, 'inout3');
      const hold = charge * (1 - burst);
      const shudder = charge * charge * wave(t, 17, 0) * (1 - burst);
      const swell = 1 + 0.12 * charge * (1 - burst) + 0.1 * burst * (1 - recoil);
      const afterShock = burst * (1 - recoil);
      c.move('root', 0.012 * s * shudder, s * (-0.07 * hold + 0.035 * afterShock + 0.006 * shudder), s * (-0.04 * hold + 0.42 * afterShock));
      c.set('chest', 0.12 * hold - 0.2 * afterShock, 0.03 * shudder, 0.02 * shudder);
      c.scale('elytra_l', swell);
      c.scale('elytra_r', swell);
      c.set('back', -0.1 * hold + 0.1 * afterShock, 0, 0);
      face(c, {
        mand: 0.14 + 0.5 * charge * (1 - burst) - 0.34 * burst * (1 - 0.6 * recoil),
        elytra: 0.65 * hold + 0.1 * afterShock,
        lift: 0.35 * hold,
        hy: 0.03 * shudder,
        hp: 0.22 * hold - 0.25 * afterShock,
        ay: 0.4 * hold,
        ap: -0.3 * hold,
      });
      const flare = 1 + 0.4 * charge * (1 - burst) + 0.55 * afterShock;
      crest(c, [flare * (1 + 0.04 * shudder), flare * (1 - 0.04 * shudder), flare * (1 + 0.05 * shudder)], [0.3 * hold - 0.25 * afterShock, 0.05 * shudder, -0.3 * hold + 0.2 * afterShock], 0.08 * shudder + 0.12 * afterShock);
      const fo = (l: LegSpec): { dz: number; dy: number } => ({ dz: s * 0.42 * afterShock * (l.row === 0 ? 0.85 : l.row === 1 ? 0.6 : 0.4), dy: l.row === 0 ? 0.03 * s * burst : 0 });
      rig.plantAll(c, fo);
    },
  };

  // ------------------------------------------------------------------ hit flinch
  const hit: ClipSpec = {
    name: 'hit', duration: 0.5, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.06, 'out') * Math.exp(-5.5 * Math.max(0, t - 0.06));
      const osc = damped(Math.max(0, t - 0.06), 7, 7);
      c.move('root', 0, -0.025 * s * imp, -0.12 * s * imp);
      c.set('chest', -0.15 * imp + 0.03 * osc, 0.04 * osc, 0.05 * osc);
      c.set('back', -0.06 * imp, 0, 0);
      face(c, { mand: 0.5 * imp + 0.1 * osc, elytra: 0.3 * imp + 0.05 * osc, lift: 0.15 * imp, hp: -0.2 * imp, ay: 0.3 * imp, ap: -0.3 * imp });
      crest(c, [1 + 0.1 * imp, 1 + 0.08 * imp, 1 + 0.1 * imp], [0.1 * imp + 0.08 * osc, 0.1 * osc, -0.1 * imp - 0.08 * osc], 0.12 * osc);
      rig.plantAll(c, () => ({ dz: -0.05 * s * imp }));
    },
  };

  // ------------------------------------------------------------------ death: stagger, flip onto the side, legs curl, crystals shake
  const death: ClipSpec = {
    name: 'death', duration: 1.1, loop: false,
    pose(c) {
      const t = c.t;
      const stagger = ramp(t, 0, 0.18, 'out');
      const fall = ramp(t, 0.14, 0.64, 'in');
      const settle = ramp(t, 0.64, 1.1, 'out');
      const tw = damped(Math.max(0, t - 0.64), 7, 5) * settle;
      const shake = bump(t, 0.05, 0.12, 0.6, 0.85) * wave(t, 16, 0);
      c.move('root', -0.22 * s * fall, s * (0.3 * fall), -0.1 * s * stagger + 0.05 * s * fall);
      c.set('root', 0, 0.12 * fall, -1.08 * fall - 0.04 * settle);
      c.set('chest', -0.18 * stagger + 0.08 * fall, 0, 0);
      c.set('back', -0.1 * stagger, 0.08 * fall, 0);
      face(c, { mand: 0.2 + 0.5 * stagger + 0.1 * tw, elytra: 0.25 * stagger + 0.6 * fall, lift: 0.3 * fall, hp: -0.2 * stagger + 0.2 * fall, hy: 0.2 * fall, ay: 0.4 * fall, ap: 0.5 * fall });
      crest(c, [1 - 0.38 * fall + 0.04 * shake, 1 - 0.34 * fall - 0.04 * shake, 1 - 0.42 * fall + 0.04 * shake], [0.15 * shake + 0.2 * fall, 0.1 * shake, -0.15 * shake - 0.2 * fall], 0.14 * shake + 0.1 * tw);
      rig.foldAll(c, (l) => ({ amt: 0.4 * stagger * (1 - fall) + 0.95 * fall, spread: 0.2 * (l.row === 0 ? 1 : l.row === 2 ? -1 : 0) * fall, twitch: 0.35 * tw * (l.row % 2 === 0 ? 1 : -1) }));
    },
  };

  // ------------------------------------------------------------------ spawn: bursts out of the ice; crystals pop up one after another
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.2, loop: false,
    pose(c) {
      const t = c.t;
      const rise = keyed(t, [[0, -0.6], [0.32, 0.06], [0.48, -0.015], [0.6, 0]], 'smooth');
      const up = 1 - ramp(t, 0.05, 0.6, 'inout3');
      const shake = bump(t, 0.4, 0.45, 0.8, 1.1) * wave(t, 9, 0);
      c.move('root', 0, s * rise, 0);
      c.set('chest', -0.5 * up + 0.04 * shake, 0.05 * shake, 0.18 * up * wave(t, 3, 0));
      c.set('back', -0.18 * up, 0, 0);
      const pop = (t0: number): number => keyed(t, [[t0, 0.05], [t0 + 0.16, 1.28], [t0 + 0.28, 0.94], [t0 + 0.4, 1]], 'smooth');
      crest(c, [pop(0.22), pop(0.3), pop(0.38)], [0.2 * shake, 0.12 * shake, -0.2 * shake], 0.1 * shake);
      const snap = bump(t, 0.5, 0.55, 0.6, 0.7) + bump(t, 0.8, 0.84, 0.88, 0.94);
      face(c, { mand: 0.6 * up + 0.4 * (1 - up) * 0.4 - 0.3 * snap, elytra: 0.8 * up * (1 - 0.4 * snap), lift: 0.4 * up, hp: 0.2 * up, ay: 0.5 * up, ap: -0.4 * up });
      const unfold = 1 - ramp(t, 0.12, 0.62, 'inout3');
      if (t < 0.62) rig.foldAll(c, (l) => ({ amt: unfold * 0.95, spread: 0.3 * (l.row === 0 ? 1 : l.row === 2 ? -1 : 0) * unfold, twitch: 0.2 * wave(t, 6, l.row * 0.2) * unfold }));
      else rig.plantAll(c);
    },
  };

  return [idle, walk, run, attack, hit, death, spawn];
}
