// Ursine clip set: idle (sniff + sway), walk (diagonal-pacing roll), run (lumbering gallop), attack (rear up and swat), attack2
// (two-paw slam), hit, death (slump and roll), spawn (rise and shake). Locomotion is in place; feet are planted with IK.

import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, ramp } from '../../core/anim/curve.ts';
import { type FootOffset, type GaitSpec, type LegKey, QuadrupedRig, cwave, wave } from '../../core/anim/quadruped.ts';
import { deg } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export function ursineRig(skel: Skeleton): QuadrupedRig {
  return new QuadrupedRig(skel, {
    root: 'root', pelvis: 'pelvis', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head', jaw: 'jaw',
    tail: ['tail1', 'tail2', 'tail3'], ears: ['ear_l', 'ear_r'],
    legs: {
      fl: { upper: 'arm_l', lower: 'forearm_l', foot: 'hand_l', parent: 'clav_l', kind: 'front' },
      fr: { upper: 'arm_r', lower: 'forearm_r', foot: 'hand_r', parent: 'clav_r', kind: 'front' },
      hl: { upper: 'thigh_l', lower: 'shin_l', foot: 'foot_l', toe: 'toe_l', parent: 'pelvis', kind: 'hind' },
      hr: { upper: 'thigh_r', lower: 'shin_r', foot: 'foot_r', toe: 'toe_r', parent: 'pelvis', kind: 'hind' },
    },
  });
}

function tail(c: PoseCtx, yaw: number, pitch: number, phase: number, u: number, cycles = 1, lag = 0.12): void {
  ['tail1', 'tail2', 'tail3'].forEach((b, i) => {
    c.set(b, (pitch * (0.7 + 0.3 * i)) / 2, yaw * (0.6 + i * 0.4) * wave(u, cycles, phase - i * lag), 0);
  });
}

/** round bear ears: back = flatten against the skull, flickL/R = twitch */
function ears(c: PoseCtx, back: number, flickL = 0, flickR = 0): void {
  c.set('ear_l', -back * 0.45, flickL * 0.3, -back * 0.8 + flickL);
  c.set('ear_r', -back * 0.45, -flickR * 0.3, back * 0.8 - flickR);
}

export interface UrsineClips {
  clips: ClipSpec[];
  /** authored in-place ground speeds, m/s */
  speed: { walk: number; run: number };
}

export function makeClips(a: Anatomy, skel: Skeleton): UrsineClips {
  const rig = ursineRig(skel);
  const s = a.s;
  const pawLenF = 0.27 * s;
  const pawLenH = 0.24 * s;

  const WALK_T = 1.133, RUN_T = 0.733;
  const walkG: GaitSpec = {
    duty: 0.7,
    phases: { hl: 0, fl: 0.25, hr: 0.5, fr: 0.75 },
    sweep: { front: 0.54 * s, hind: 0.54 * s },
    lift: { front: 0.1 * s, hind: 0.11 * s },
    pawLen: pawLenF,
    curl: 0.45,
  };
  const runG: GaitSpec = {
    duty: 0.4,
    phases: { hl: 0.0, hr: 0.1, fr: 0.5, fl: 0.6 },
    sweep: { front: 1.0 * s, hind: 1.0 * s },
    lift: { front: 0.2 * s, hind: 0.22 * s },
    pawLen: pawLenF,
    curl: 0.7,
  };
  const speed = { walk: Number(((walkG.sweep.front / (walkG.duty * WALK_T))).toFixed(3)), run: Number(((runG.sweep.front / (runG.duty * RUN_T))).toFixed(3)) };

  // ------------------------------------------------------------------ idle: weight shift, breathing, a sniff and a slow head sway
  const idle: ClipSpec = {
    name: 'idle', duration: 2.4, loop: true,
    pose(c) {
      const u = c.u;
      const br = wave(u, 1, 0);
      const sniff = bump(u, 0.3, 0.38, 0.52, 0.62);
      const sway = wave(u, 1, 0.1);
      c.move('root', 0.012 * s * sway, -0.012 * s + 0.006 * s * br, 0);
      c.set('pelvis', 0.008 * br, -0.035 * sway, 0.02 * sway);
      c.set('spine', -0.012 * br, 0.03 * sway, -0.01 * sway);
      c.set('chest', 0.025 * br - 0.02 * sniff, 0.05 * sway, -0.02 * sway);
      c.set('clav_l', 0.04 * br, 0, 0);
      c.set('clav_r', 0.04 * br, 0, 0);
      c.set('neck', 0.06 - 0.12 * sniff + 0.015 * br, 0.2 * wave(u, 1, 0.0), 0.04 * sway);
      c.set('head', 0.04 - 0.1 * sniff + 0.015 * wave(u, 3, 0) * sniff, 0.16 * wave(u, 1, 0.12), -0.05 * wave(u, 1, 0.0));
      c.set('jaw', 0.12 + 0.04 * Math.max(0, br) + 0.06 * sniff, 0, 0);
      tail(c, 0.1, 0.02, 0, u, 1, 0.1);
      ears(c, 0.1 * (0.5 + 0.5 * wave(u, 1, 0.3)), bump(u, 0.66, 0.7, 0.74, 0.8) * 0.5, bump(u, 0.12, 0.16, 0.2, 0.26) * 0.4);
      rig.plantAll(c);
    },
  };

  // ------------------------------------------------------------------ walk: diagonal pacing roll
  const walk: ClipSpec = {
    name: 'walk', duration: WALK_T, loop: true,
    pose(c) {
      const u = c.u;
      const roll = wave(u, 1, 0.0);
      c.move('root', 0.03 * s * roll, -0.05 * s - 0.016 * s * cwave(u, 2, 0.1), 0);
      c.set('pelvis', 0.03 * wave(u, 2, 0.1), 0.1 * wave(u, 1, 0.0), 0.07 * roll);
      c.set('spine', 0.02 * wave(u, 2, 0.3), -0.12 * wave(u, 1, 0.0), -0.04 * roll);
      c.set('chest', 0.035 * wave(u, 2, 0.15), -0.14 * wave(u, 1, 0.0), -0.06 * roll);
      c.set('clav_l', 0.14 * wave(u, 1, 0.5), 0, 0);
      c.set('clav_r', 0.14 * wave(u, 1, 0.0), 0, 0);
      c.set('neck', 0.1 + 0.04 * wave(u, 2, 0.4), 0.2 * wave(u, 1, 0.05), 0.05 * roll);
      c.set('head', 0.06 + 0.04 * wave(u, 2, 0.5), -0.1 * wave(u, 1, 0.05), 0.04 * wave(u, 1, 0.0));
      c.set('jaw', 0.1, 0, 0);
      tail(c, 0.12, 0.03, 0.1, u, 1, 0.13);
      ears(c, 0.12);
      rig.gait(c, walkG, u);
    },
  };

  // ------------------------------------------------------------------ run: heavy gallop
  const run: ClipSpec = {
    name: 'run', duration: RUN_T, loop: true,
    pose(c) {
      const u = c.u;
      const ext = wave(u, 1, 0.0);
      c.move('root', 0, 0.045 * s * ext - 0.1 * s, 0);
      c.set('root', 0.04 * wave(u, 1, 0.25), 0, 0);
      c.set('pelvis', 0.12 * cwave(u, 1, 0.02), 0.05 * wave(u, 1, 0.5), 0.04 * wave(u, 1, 0.5));
      c.set('spine', -0.16 * cwave(u, 1, 0.02), -0.05 * wave(u, 1, 0.5), 0);
      c.set('chest', 0.12 * cwave(u, 1, 0.02) + 0.1, -0.06 * wave(u, 1, 0.5), 0.03 * wave(u, 1, 0.5));
      c.set('clav_l', 0.18 * wave(u, 1, 0.6), 0, 0);
      c.set('clav_r', 0.18 * wave(u, 1, 0.5), 0, 0);
      c.set('neck', 0.22 + 0.08 * cwave(u, 1, 0.2), 0.04 * wave(u, 1, 0.5), 0);
      c.set('head', 0.1 - 0.06 * cwave(u, 1, 0.2), 0, 0);
      c.set('jaw', 0.22 + 0.12 * wave(u, 1, 0.1), 0, 0);
      tail(c, 0.12, 0.2, 0.1, u, 1, 0.1);
      ears(c, 0.5);
      rig.gait(c, runG, u);
    },
  };

  // ------------------------------------------------------------------ attack: rear up and swat, hit at 0.70 s
  const attack: ClipSpec = {
    name: 'attack', duration: 1.7, loop: false, hit: 0.7,
    pose(c) {
      const t = c.t;
      const sink = bump(t, 0.0, 0.14, 0.18, 0.3, 'out'); // weight dips before the rise
      const up = ramp(t, 0.12, 0.46, 'inout3') * (1 - ramp(t, 0.82, 1.5, 'inout3'));
      const swing = ramp(t, 0.56, 0.7, 'in') * (1 - ramp(t, 0.72, 1.0, 'out'));
      const roar = bump(t, 0.34, 0.44, 0.62, 0.78);
      const shake = 0.02 * wave(t, 9, 0) * bump(t, 0.46, 0.5, 0.6, 0.68);
      c.move('root', 0, -0.04 * s * sink - 0.02 * s * up - 0.03 * s * swing, -0.14 * s * up + 0.16 * s * swing);
      c.set('pelvis', 0.1 * sink - 0.76 * up + 0.5 * swing, 0, 0);
      c.set('spine', 0.05 * sink - 0.1 * up + 0.12 * swing, -0.12 * swing, 0);
      c.set('chest', -0.24 * up + 0.35 * swing, 0.28 * swing - 0.25 * roar, 0);
      c.set('clav_l', -0.2 * up, 0, 0);
      c.set('clav_r', -0.3 * up + 0.2 * swing, 0, 0);
      c.set('neck', -0.25 * up - 0.2 * roar + 0.5 * swing + shake, -0.25 * swing + 0.1 * roar, 0);
      c.set('head', -0.2 * up - 0.15 * roar + 0.25 * swing + shake, -0.15 * swing, 0);
      c.set('jaw', 0.1 + 0.75 * roar + 0.2 * swing, 0, 0);
      tail(c, 0.1, 0.3 * up, 0, c.u, 2, 0.1);
      ears(c, 0.6 * up);
      // left paw: raised and spread; right paw: cocked back behind the head, then a heavy cross-body swat
      const lift = ramp(t, 0.1, 0.46, 'out') * (1 - ramp(t, 0.8, 1.4, 'inout3'));
      const cock = ramp(t, 0.3, 0.55, 'out') * (1 - ramp(t, 0.56, 0.62));
      const fr: FootOffset = {
        dz: -0.1 * s * cock + 0.45 * s * swing + 0.05 * s * lift,
        dy: 1.0 * s * lift + 0.18 * s * cock - 0.75 * s * swing,
        dx: -0.18 * s * cock + 0.52 * s * swing,
        pitch: -0.6 * cock + 1.3 * swing,
      };
      const fl: FootOffset = { dz: 0.12 * s * lift - 0.1 * s * swing, dy: 0.95 * s * lift - 0.3 * s * swing, dx: 0.12 * s * lift, pitch: -0.4 * lift };
      rig.plantAll(c, { fl, fr });
    },
  };

  // ------------------------------------------------------------------ attack2: two-paw overhead slam, hit at 0.55 s
  const attack2: ClipSpec = {
    name: 'attack2', duration: 1.4, loop: false, hit: 0.55,
    pose(c) {
      const t = c.t;
      const up = ramp(t, 0.06, 0.36, 'inout3') * (1 - ramp(t, 0.56, 1.2, 'inout3'));
      const slam = ramp(t, 0.4, 0.55, 'in') * (1 - ramp(t, 0.58, 1.0, 'out'));
      const bite = bump(t, 0.5, 0.54, 0.62, 0.8);
      const rec = ramp(t, 0.55, 0.62, 'out') * (1 - ramp(t, 0.62, 0.9));
      c.move('root', 0, -0.02 * s * up - 0.07 * s * slam, -0.1 * s * up + 0.2 * s * slam);
      c.set('pelvis', -0.58 * up + 0.55 * slam, 0, 0);
      c.set('spine', -0.08 * up + 0.12 * slam, 0.03 * wave(t, 6, 0) * rec, 0);
      c.set('chest', -0.2 * up + 0.4 * slam, 0, 0);
      c.set('clav_l', -0.2 * up + 0.2 * slam, 0, 0);
      c.set('clav_r', -0.2 * up + 0.2 * slam, 0, 0);
      c.set('neck', -0.2 * up + 0.55 * slam, 0, 0);
      c.set('head', -0.25 * up + 0.2 * slam, 0.12 * wave(t, 7, 0) * rec, 0);
      c.set('jaw', 0.1 + 0.55 * bite + 0.4 * ramp(t, 0.26, 0.38) * (1 - ramp(t, 0.42, 0.5)), 0, 0);
      tail(c, 0.1, 0.25 * up, 0, c.u, 2, 0.1);
      ears(c, 0.7 * up);
      const lift = ramp(t, 0.1, 0.38, 'out') * (1 - ramp(t, 0.4, 0.5));
      const fo = (sx: number): FootOffset => ({
        dz: 0.1 * s * lift + 0.3 * s * slam,
        dy: 1.05 * s * lift - 0.12 * s * slam * 0,
        dx: sx * (0.1 * s * lift - 0.04 * s * slam),
        pitch: -0.5 * lift + 0.7 * slam,
      });
      rig.plantAll(c, { fl: fo(1), fr: fo(-1) });
    },
  };

  // ------------------------------------------------------------------ hit flinch
  const hit: ClipSpec = {
    name: 'hit', duration: 0.6, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.07, 'out') * Math.exp(-4.6 * Math.max(0, t - 0.07));
      const osc = damped(Math.max(0, t - 0.07), 4.5, 6);
      c.move('root', 0, -0.02 * s * imp, -0.1 * s * imp);
      c.set('pelvis', 0.06 * imp, 0.05 * osc, 0.04 * osc);
      c.set('spine', -0.1 * imp, 0.08 * osc, 0);
      c.set('chest', -0.22 * imp, -0.1 * osc, 0.04 * osc);
      c.set('neck', -0.4 * imp, 0.1 * osc, 0);
      c.set('head', -0.3 * imp, -0.08 * osc, 0);
      c.set('jaw', 0.5 * imp, 0, 0);
      tail(c, 0.3 * (1 - imp), 0.4 * imp, 0, c.u, 1, 0.08);
      ears(c, 0.9 * imp);
      rig.plantAll(c, { fl: { dz: 0.05 * s * imp, dy: 0, pitch: 0 }, fr: { dz: 0.05 * s * imp, dy: 0, pitch: 0 } });
    },
  };

  // ------------------------------------------------------------------ death: stagger, hind legs buckle, slump and roll onto the side
  const death: ClipSpec = {
    name: 'death', duration: 1.6, loop: false,
    pose(c) {
      const t = c.t;
      const stagger = ramp(t, 0, 0.3, 'out');
      const fall = ramp(t, 0.28, 0.95, 'in');
      const settle = ramp(t, 0.95, 1.6, 'out');
      const roll = deg(-82) * fall + deg(-6) * settle;
      const ground = 0.27 * s * fall;
      c.move('root', -0.05 * s * stagger - 0.1 * s * fall, ground - 0.14 * s * stagger * (1 - fall), -0.1 * s * stagger);
      c.set('root', 0.1 * stagger * (1 - fall), 0, roll);
      c.set('pelvis', 0.18 * stagger, 0, 0);
      c.set('spine', -0.06 * stagger, 0.1 * fall, 0);
      c.set('chest', -0.2 * stagger, -0.14 * fall, 0);
      c.set('neck', -0.45 * stagger + 0.6 * fall, 0.3 * fall, 0.2 * fall);
      c.set('head', -0.25 * stagger + 0.45 * fall, 0.3 * fall, 0);
      c.set('jaw', 0.45 * stagger + 0.2 * settle, 0, 0);
      tail(c, 0.08, -0.2 * fall, 0, c.u, 1, 0.1);
      ears(c, 0.9 * stagger);
      const twitch = 0.06 * damped(Math.max(0, t - 0.95), 6, 5) * settle;
      const limb = (bone: string, x: number, z = 0): void => {
        c.set(bone, x, 0, z);
      };
      // lying on the left side: the left (under) limbs tuck, the right (upper) limbs curl loosely
      limb('clav_l', -0.1 * fall);
      limb('clav_r', -0.1 * fall);
      limb('arm_l', 0.25 * fall + 0.5 * stagger + twitch, 0.25 * fall);
      limb('forearm_l', 0.6 * fall + 0.5 * stagger, 0);
      limb('hand_l', 0.2 * fall, 0);
      limb('arm_r', -0.5 * fall + 0.3 * stagger + twitch, -0.35 * fall);
      limb('forearm_r', 1.05 * fall + 0.4 * stagger, 0);
      limb('hand_r', 0.45 * fall, 0);
      limb('thigh_l', 0.35 * fall + 0.4 * stagger, 0.2 * fall);
      limb('shin_l', -0.6 * fall - 0.6 * stagger, 0);
      limb('foot_l', 0.3 * fall, 0);
      limb('thigh_r', -0.7 * fall + 0.4 * stagger + twitch, -0.35 * fall);
      limb('shin_r', -0.9 * fall - 0.6 * stagger, 0);
      limb('foot_r', 0.4 * fall, 0);
    },
  };

  // ------------------------------------------------------------------ spawn: rise from a crouch, roar, shake it off
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.7, loop: false,
    pose(c) {
      const t = c.t;
      const low = 1 - ramp(t, 0.05, 0.7, 'inout3');
      const rise = ramp(t, 0.55, 0.8, 'out') * (1 - ramp(t, 0.8, 1.0));
      const shake = bump(t, 0.9, 0.96, 1.2, 1.55) * wave(t, 6, 0);
      const headUp = ramp(t, 0.5, 0.9, 'out') * (1 - ramp(t, 1.1, 1.65, 'inout3'));
      c.move('root', 0, -0.4 * s * low + 0.03 * s * rise, 0);
      c.set('pelvis', -0.1 * low, 0.07 * shake, 0.05 * shake);
      c.set('spine', 0.18 * low, -0.1 * shake, 0);
      c.set('chest', 0.3 * low - 0.15 * headUp, 0.14 * shake, 0);
      c.set('neck', 0.4 * low - 0.35 * headUp, 0.2 * shake, 0);
      c.set('head', 0.3 * low - 0.2 * headUp, -0.25 * shake, 0.1 * shake);
      c.set('jaw', 0.6 * headUp, 0, 0);
      tail(c, 0.25 * (0.3 + shake), 0.2 + 0.3 * rise, 0, c.u, 4, 0.08);
      ears(c, 0.8 * low);
      rig.plantAll(c);
    },
  };

  return { clips: [idle, walk, run, attack, attack2, hit, death, spawn], speed };
}
