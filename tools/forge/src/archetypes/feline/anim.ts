// Feline clip set. Locomotion is in place with IK-planted feet; attacks lunge and return to the origin.
//  idle      stalking crouch: breathing, slow head sweep, S-tail, ear flicks, occasional paw shift
//  walk      low prowl, shoulder-blade roll, lateral spine flex                       (cycle 1.0 s)


//  attack2   rear up -> raking paw swipe, second paw follow-up (hit 0.52 s)
//  hit / death / spawn
//  special1  long pounce + slam, special2 roar, special3 swipe combo (bosses)
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, ramp } from '../../core/anim/curve.ts';
import { type FootOffset, type GaitSpec, type LegKey, QuadrupedRig, cwave, wave } from '../../core/anim/quadruped.ts';
import { deg } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';
import { hasMane, tailBoneNames } from './skeleton.ts';

export function felineRig(skel: Skeleton, a: Anatomy): QuadrupedRig {
  return new QuadrupedRig(skel, {
    root: 'root', pelvis: 'pelvis', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head', jaw: 'jaw',
    tail: tailBoneNames(a.tailBones), ears: ['ear_l', 'ear_r'],
    legs: {
      fl: { upper: 'arm_l', lower: 'forearm_l', foot: 'hand_l', parent: 'chest', kind: 'front' },
      fr: { upper: 'arm_r', lower: 'forearm_r', foot: 'hand_r', parent: 'chest', kind: 'front' },
      hl: { upper: 'thigh_l', lower: 'shin_l', foot: 'foot_l', toe: 'toe_l', parent: 'pelvis', kind: 'hind' },
      hr: { upper: 'thigh_r', lower: 'shin_r', foot: 'foot_r', toe: 'toe_r', parent: 'pelvis', kind: 'hind' },
    },
  });
}

/** authored ground speeds (m/s) of the locomotion clips, derived from the gait specs below */
export function gaitSpeeds(a: Anatomy): { walk: number; run: number } {
  const s = a.s;
  return { walk: (0.6 * s) / (0.64 * 1.0), run: (1.1 * s) / (0.4 * 0.667) };
}

export function makeClips(a: Anatomy, skel: Skeleton): ClipSpec[] {
  const rig = felineRig(skel, a);
  const s = a.s;
  const pawLen = 0.2 * s;
  const tn = tailBoneNames(a.tailBones);
  const maneOn = hasMane(a);
  const boss = a.p.kind === 'boss';

  /** tail chain: curved base pose (pitch) + travelling yaw wave with a lag per segment */
  const tail = (c: PoseCtx, yaw: number, pitch: number, phase: number, cycles = 1, lag = 0.1): void => {
    tn.forEach((b, i) => {
      const k = 0.45 + i * (0.9 / tn.length);
      c.set(b, (pitch * (0.6 + 0.25 * i)) / tn.length * 2.2, yaw * k * wave(c.u, cycles, phase - i * lag), 0);
    });
  };
  const ears = (c: PoseCtx, back: number, flickL = 0, flickR = 0): void => {
    c.set('ear_l', -back * 0.55, flickL * 0.3, -back * 0.9 + flickL);
    c.set('ear_r', -back * 0.55, -flickR * 0.3, back * 0.9 - flickR);
  };
  /** mane / flame locks trail the neck motion */
  const mane = (c: PoseCtx, flare: number, sway: number): void => {
    if (!maneOn) return;
    c.set('mane_l', -0.25 * flare, 0.1 * sway, 0.3 * flare);
    c.set('mane_r', -0.25 * flare, -0.1 * sway, -0.3 * flare);
    if (boss) c.set('mane_b', 0.2 * flare + 0.06 * sway, 0, 0);
  };

  const walkG: GaitSpec = {
    duty: 0.64,
    phases: { hl: 0, fl: 0.25, hr: 0.5, fr: 0.75 },
    sweep: { front: 0.6 * s, hind: 0.64 * s },
    lift: { front: 0.1 * s, hind: 0.11 * s },
    pawLen,
    curl: 0.55,
  };
  const runG: GaitSpec = {
    duty: 0.4,
    phases: { hl: 0, hr: 0.1, fr: 0.45, fl: 0.55 },
    sweep: { front: 1.1 * s, hind: 1.18 * s },
    lift: { front: 0.2 * s, hind: 0.22 * s },
    pawLen,
    curl: 0.85,
  };

  // ------------------------------------------------------------------ idle
  const idle: ClipSpec = {
    name: 'idle', duration: 1.6, loop: true,
    pose(c) {
      const u = c.u;
      const br = wave(u, 1, 0);
      const look = wave(u, 1, 0.15);
      c.move('root', 0.01 * s * wave(u, 1, 0.1), -0.015 * s + 0.005 * s * br, 0);
      c.set('pelvis', deg(0.6) * br, 0.03 * wave(u, 1, 0.3), 0.012 * wave(u, 1, 0.5));
      c.set('spine', deg(-1) * br, -0.025 * wave(u, 1, 0.3), 0);
      c.set('chest', deg(1.6) * br, -0.04 * look, -0.012 * wave(u, 1, 0.5));
      c.set('neck', deg(-1.5) * br + 0.06, 0.1 * look, 0);
      c.set('head', deg(1.5) * wave(u, 2, 0.1) - 0.02, 0.14 * wave(u, 1, 0.4), 0.04 * wave(u, 1, 0.1));
      c.set('jaw', 0.05 + 0.04 * Math.max(0, br) + 0.1 * bump(u, 0.62, 0.68, 0.74, 0.82), 0, 0);
      tail(c, 0.3, 0.1 + 0.05 * br, 0, 1, 0.14);
      ears(c, 0.12 * (0.5 + 0.5 * wave(u, 1, 0.3)), bump(u, 0.55, 0.59, 0.61, 0.66) * 0.5, bump(u, 0.2, 0.24, 0.26, 0.3) * 0.35);
      mane(c, 0.1 * br, 0.4 * look);
      // weight shift: left forepaw lifts and sets down once per loop
      const lift = bump(u, 0.62, 0.72, 0.8, 0.9);
      rig.plantAll(c, { fl: { dz: 0.12 * s * lift, dy: 0.06 * s * lift, pitch: 0.3 * lift } });
    },
  };

  // ------------------------------------------------------------------ walk (prowl)
  const walk: ClipSpec = {
    name: 'walk', duration: 1.0, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.02 * s - 0.014 * s * cwave(u, 2, 0.12), 0);
      c.set('pelvis', 0.025 * wave(u, 2, 0.1), 0.08 * wave(u, 1, 0), 0.05 * wave(u, 1, 0.25));
      c.set('spine', 0.02 * wave(u, 2, 0.3), -0.11 * wave(u, 1, 0), -0.035 * wave(u, 1, 0.25));
      c.set('chest', 0.03 * wave(u, 2, 0.15), -0.14 * wave(u, 1, 0), 0.04 * wave(u, 1, 0.25));
      c.set('neck', 0.06 + 0.03 * wave(u, 2, 0.4), 0.16 * wave(u, 1, 0.05), 0);
      c.set('head', 0.06 + 0.03 * wave(u, 2, 0.5), -0.08 * wave(u, 1, 0.05), 0);
      c.set('jaw', 0.04, 0, 0);
      tail(c, 0.34, 0.12, 0.1, 1, 0.13);
      ears(c, 0.14);
      mane(c, 0.05, wave(u, 1, 0.1));
      rig.gait(c, walkG, u);
    },
  };

  // ------------------------------------------------------------------ run (gallop)
  const run: ClipSpec = {
    name: 'run', duration: 0.667, loop: true,
    pose(c) {
      const u = c.u;
      const ext = wave(u, 1, 0.0); // +1 reach / -1 gather
      c.move('root', 0, 0.045 * s * ext - 0.07 * s, 0);
      c.set('root', 0.055 * wave(u, 1, 0.25), 0, 0);
      c.set('pelvis', 0.16 * cwave(u, 1, 0.02), 0, 0.02 * wave(u, 1, 0.5));
      c.set('spine', -0.22 * cwave(u, 1, 0.02), 0.03 * wave(u, 1, 0.5), 0);
      c.set('chest', 0.14 * cwave(u, 1, 0.02) + 0.08, 0, 0.02 * wave(u, 1, 0.5));
      c.set('neck', 0.2 + 0.08 * cwave(u, 1, 0.2), 0, 0);
      c.set('head', 0.1 - 0.06 * cwave(u, 1, 0.2), 0, 0);
      c.set('jaw', 0.2 + 0.12 * wave(u, 1, 0.1), 0, 0);
      tail(c, 0.12, 0.5 + 0.12 * wave(u, 1, 0.1), 0.1, 1, 0.1);
      ears(c, 0.6);
      mane(c, 0.5 + 0.2 * wave(u, 1, 0.2), 0.3 * wave(u, 1, 0.1));
      rig.gait(c, runG, u);
    },
  };

  // ------------------------------------------------------------------ attack: coil, pounce, bite (hit 0.5 s)
  const attack: ClipSpec = {
    name: 'attack', duration: 1.2, loop: false, hit: 0.5,
    pose(c) {
      const t = c.t;
      const coil = ramp(t, 0.0, 0.32, 'inout3') * (1 - ramp(t, 0.32, 0.4, 'in'));
      const lunge = ramp(t, 0.32, 0.5, 'out') * (1 - ramp(t, 0.58, 1.1, 'inout3'));
      const bite = bump(t, 0.34, 0.44, 0.47, 0.54); // jaw gapes then snaps shut on the hit
      const shake = bump(t, 0.52, 0.56, 0.7, 0.85) * wave(t, 5.5, 0);
      c.move('root', 0, -0.09 * s * coil + 0.03 * s * lunge, -0.05 * s * coil + 0.34 * s * lunge);
      c.set('pelvis', -0.14 * coil + 0.16 * lunge, 0, 0);
      c.set('spine', 0.12 * coil - 0.1 * lunge, 0, 0);
      c.set('chest', 0.08 * coil - 0.2 * lunge, 0.14 * shake, 0);
      c.set('neck', -0.3 * coil - 0.12 * lunge, 0.28 * shake, 0);
      c.set('head', -0.2 * coil + 0.04 * lunge, 0.38 * shake, 0);
      c.set('jaw', 0.05 + 0.95 * bite, 0, 0);
      tail(c, 0.16, 0.3 * lunge + 0.1 * coil, 0, 2, 0.1);
      ears(c, 0.55 * coil + 0.5 * lunge);
      mane(c, 0.5 * lunge, shake);
      const fo = (k: LegKey): FootOffset =>
        k[0] === 'f'
          ? { dz: 0.2 * s * lunge - 0.04 * s * coil, dy: 0.13 * s * lunge, pitch: 0.7 * lunge }
          : { dz: 0.22 * s * lunge + 0.03 * s * coil, dy: 0.04 * s * lunge * (1 - lunge), pitch: 0, toe: 0.4 * lunge };
      rig.plantAll(c, { fl: fo('fl'), fr: fo('fr'), hl: fo('hl'), hr: fo('hr') });
    },
  };

  // ------------------------------------------------------------------ attack2: rear up, raking swipe (hit 0.52 s)
  const attack2: ClipSpec = {
    name: 'attack2', duration: 1.3, loop: false, hit: 0.52,
    pose(c) {
      const t = c.t;
      const up = ramp(t, 0.04, 0.36, 'inout3') * (1 - ramp(t, 0.7, 1.2, 'inout3'));
      const wind = ramp(t, 0.1, 0.38, 'out') * (1 - ramp(t, 0.38, 0.44));
      const swing = ramp(t, 0.38, 0.54, 'in') * (1 - ramp(t, 0.58, 0.82, 'out'));
      const swing2 = ramp(t, 0.66, 0.78, 'in') * (1 - ramp(t, 0.8, 1.0, 'out'));
      c.move('root', 0, -0.03 * s * up, -0.06 * s * up + 0.12 * s * swing);
      c.set('pelvis', -0.2 * up, 0, 0);
      c.set('spine', -0.08 * up, 0.12 * swing - 0.1 * swing2, 0);
      c.set('chest', -0.4 * up, 0.22 * swing - 0.18 * wind - 0.2 * swing2, -0.1 * wind);
      c.set('neck', 0.12 * up + 0.24 * swing, -0.24 * swing + 0.2 * swing2, 0);
      c.set('head', 0.14 * swing, -0.18 * swing, 0);
      c.set('jaw', 0.05 + 0.7 * bump(t, 0.38, 0.48, 0.58, 0.8), 0, 0);
      tail(c, 0.2, 0.3 * up, 0, 2, 0.1);
      ears(c, 0.7 * up);
      mane(c, 0.4 * up, swing);
      const lift = ramp(t, 0.08, 0.38, 'out');
      const dz = 0.34 * s * lift + 0.2 * s * swing;
      const dy = 0.36 * s * lift - 0.26 * s * swing;
      const dx = 0.12 * s * wind - 0.26 * s * swing;
      // second raking swipe with the other paw
      const dz2 = 0.3 * s * swing2, dy2 = 0.3 * s * swing2, dx2 = -0.2 * s * swing2;
      rig.plantAll(c, { fr: { dz, dy, dx, pitch: -0.25 * wind + 0.9 * swing }, fl: { dz: dz2, dy: dy2, dx: -dx2, pitch: 0.6 * swing2 } });
    },
  };

  // ------------------------------------------------------------------ hit flinch
  const hit: ClipSpec = {
    name: 'hit', duration: 0.5, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.07, 'out') * Math.exp(-5.2 * Math.max(0, t - 0.07));
      const osc = damped(Math.max(0, t - 0.07), 5, 7);
      c.move('root', 0, -0.02 * s * imp, -0.12 * s * imp);
      c.set('pelvis', 0.08 * imp, 0.05 * osc, 0.04 * osc);
      c.set('spine', -0.12 * imp, 0.1 * osc, 0);
      c.set('chest', -0.24 * imp, -0.12 * osc, 0.05 * osc);
      c.set('neck', -0.45 * imp, 0.1 * osc, 0);
      c.set('head', -0.32 * imp, -0.08 * osc, 0);
      c.set('jaw', 0.7 * imp, 0, 0);
      tail(c, 0.4 * (1 - imp), 0.5 * imp, 0, 1, 0.08);
      ears(c, 0.9 * imp);
      mane(c, 0.6 * imp, osc);
      rig.plantAll(c, { fl: { dz: 0.06 * s * imp, dy: 0, pitch: 0 }, fr: { dz: 0.06 * s * imp, dy: 0, pitch: 0 } });
    },
  };

  // ------------------------------------------------------------------ death: stagger, topple onto the left side, settle
  const death: ClipSpec = {
    name: 'death', duration: 1.4, loop: false,
    pose(c) {
      const t = c.t;
      const stagger = ramp(t, 0, 0.26, 'out');
      const fall = ramp(t, 0.22, 0.86, 'in');
      const settle = ramp(t, 0.86, 1.4, 'out');
      const roll = deg(-84) * fall + deg(-4) * settle;
      const ground = 0.24 * s * fall;
      c.move('root', -0.15 * s * stagger - 0.1 * s * fall, ground - 0.1 * s * stagger * (1 - fall), -0.14 * s * stagger);
      c.set('root', 0, 0, roll);
      c.set('pelvis', 0.1 * stagger, 0, 0);
      c.set('spine', -0.05 * stagger, 0.15 * fall, 0);
      c.set('chest', -0.18 * stagger, -0.2 * fall, 0);
      c.set('neck', -0.5 * stagger + 0.5 * fall, 0.35 * fall, 0.2 * fall);
      c.set('head', -0.3 * stagger + 0.4 * fall, 0.3 * fall, 0);
      c.set('jaw', 0.55 * stagger + 0.2 * settle, 0, 0);
      tail(c, 0.1, -0.25 * fall, 0, 1, 0.1);
      ears(c, 0.9 * stagger);
      mane(c, -0.3 * fall, 0);
      const twitch = 0.07 * damped(Math.max(0, t - 0.86), 7, 6) * settle;
      const limp = (bone: string, x: number, z = 0): void => { c.set(bone, x, 0, z); };
      limp('arm_l', -0.5 * fall + 0.4 * stagger + twitch, 0.3 * fall);
      limp('forearm_l', 0.9 * fall + 0.5 * stagger);
      limp('hand_l', 0.4 * fall);
      limp('arm_r', -0.9 * fall + 0.3 * stagger + twitch, -0.4 * fall);
      limp('forearm_r', 0.7 * fall + 0.4 * stagger);
      limp('hand_r', 0.3 * fall);
      limp('thigh_l', 0.5 * fall + 0.3 * stagger, 0.2 * fall);
      limp('shin_l', -0.8 * fall - 0.5 * stagger);
      limp('foot_l', 0.5 * fall);
      limp('thigh_r', 0.3 * fall + 0.3 * stagger + twitch, -0.3 * fall);
      limp('shin_r', -0.7 * fall - 0.5 * stagger);
      limp('foot_r', 0.4 * fall);
    },
  };

  // ------------------------------------------------------------------ spawn: rise from a crouch, roar, shake it off
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.5, loop: false,
    pose(c) {
      const t = c.t;
      const low = 1 - ramp(t, 0.05, 0.62, 'inout3');
      const rise = ramp(t, 0.5, 0.72, 'out') * (1 - ramp(t, 0.72, 0.9));
      const shake = bump(t, 0.82, 0.86, 1.05, 1.4) * wave(t, 7, 0);
      const headUp = ramp(t, 0.55, 0.85, 'out') * (1 - ramp(t, 1.0, 1.5, 'inout3'));
      c.move('root', 0, -0.32 * s * low + 0.03 * s * rise, 0);
      c.set('pelvis', -0.2 * low, 0.07 * shake, 0.05 * shake);
      c.set('spine', 0.18 * low, -0.1 * shake, 0);
      c.set('chest', 0.35 * low - 0.14 * headUp, 0.12 * shake, 0);
      c.set('neck', 0.35 * low - 0.45 * headUp, 0.2 * shake, 0);
      c.set('head', 0.3 * low - 0.25 * headUp, -0.25 * shake, 0.1 * shake);
      c.set('jaw', 0.7 * headUp, 0, 0);
      tail(c, 0.25 * (0.3 + shake), 0.2 + 0.3 * rise, 0, 4, 0.08);
      ears(c, 0.8 * low);
      mane(c, 0.6 * headUp, shake);
      rig.plantAll(c);
    },
  };

  const clips: ClipSpec[] = [idle, walk, run, attack, attack2, hit, death, spawn];

  if (boss) {
    // special1: long pounce -> slam (hit 0.72 s)
    clips.push({
      name: 'special1', duration: 1.8, loop: false, hit: 0.72,
      pose(c) {
        const t = c.t;
        const coil = ramp(t, 0.0, 0.5, 'inout3') * (1 - ramp(t, 0.5, 0.58, 'in'));
        const air = ramp(t, 0.5, 0.72, 'out') * (1 - ramp(t, 0.78, 1.5, 'inout3'));
        const arc = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.5) / 0.3))) * (t < 0.8 ? 1 : 0);
        const slam = bump(t, 0.7, 0.74, 0.8, 1.0);
        c.move('root', 0, -0.14 * s * coil + 0.34 * s * arc - 0.03 * s * slam, -0.1 * s * coil + 0.9 * s * air);
        c.set('pelvis', -0.22 * coil + 0.26 * air, 0, 0);
        c.set('spine', 0.18 * coil - 0.14 * air, 0, 0);
        c.set('chest', 0.14 * coil - 0.24 * air, 0, 0);
        c.set('neck', -0.4 * coil - 0.14 * air, 0, 0);
        c.set('head', -0.3 * coil + 0.05 * air, 0, 0);
        c.set('jaw', 0.05 + 0.9 * bump(t, 0.52, 0.64, 0.74, 0.86), 0, 0);
        tail(c, 0.2, 0.4 * air + 0.15 * coil, 0, 2, 0.1);
        ears(c, 0.6 * coil + 0.5 * air);
        mane(c, 0.9 * air + 0.3 * coil, wave(t, 3, 0));
        const fo = (k: LegKey): FootOffset =>
          k[0] === 'f'
            ? { dz: 0.4 * s * air, dy: 0.2 * s * arc, pitch: 0.8 * air }
            : { dz: 0.5 * s * air, dy: 0.08 * s * arc, pitch: 0, toe: 0.5 * air };
        rig.plantAll(c, { fl: fo('fl'), fr: fo('fr'), hl: fo('hl'), hr: fo('hr') });
      },
    });
    // special2: roar (hit window = shockwave at 0.8 s)
    clips.push({
      name: 'special2', duration: 2.2, loop: false, hit: 0.8,
      pose(c) {
        const t = c.t;
        const rear = ramp(t, 0.0, 0.7, 'inout3') * (1 - ramp(t, 1.6, 2.2, 'inout3'));
        const quiver = 0.025 * wave(t, 11, 0) * bump(t, 0.75, 0.85, 1.55, 1.7);
        const gape = ramp(t, 0.4, 0.75, 'out') * (1 - ramp(t, 1.6, 2.0));
        c.move('root', 0, 0.02 * s * rear, -0.12 * s * rear);
        c.set('pelvis', -0.12 * rear, 0, 0);
        c.set('spine', -0.2 * rear, 0, 0);
        c.set('chest', -0.5 * rear + quiver, 0, 0);
        c.set('neck', -0.7 * rear + quiver, 0, 0);
        c.set('head', -0.5 * rear + quiver, 0, 0);
        c.set('jaw', 0.05 + 0.9 * gape * (0.85 + 0.15 * wave(t, 5, 0)), 0, 0);
        tail(c, 0.3, 0.5 * rear, 0, 2, 0.1);
        ears(c, 0.9 * rear);
        mane(c, 1.1 * rear, wave(t, 4, 0) * rear);
        rig.plantAll(c, { fl: { dz: -0.04 * s * rear, dy: 0, pitch: 0 }, fr: { dz: -0.04 * s * rear, dy: 0, pitch: 0 } });
      },
    });
    // special3: swipe combo — left, right, overhead double slam (hit 0.55 s)
    clips.push({
      name: 'special3', duration: 2.1, loop: false, hit: 0.55,
      pose(c) {
        const t = c.t;
        const up = ramp(t, 0.0, 0.3, 'inout3') * (1 - ramp(t, 1.6, 2.05, 'inout3'));
        const s1 = bump(t, 0.36, 0.52, 0.56, 0.74);
        const s2 = bump(t, 0.74, 0.88, 0.92, 1.1);
        const s3 = bump(t, 1.1, 1.3, 1.34, 1.6);
        c.move('root', 0, -0.02 * s * up, -0.05 * s * up + 0.1 * s * (s1 + s2 + s3));
        c.set('pelvis', -0.22 * up, 0, 0);
        c.set('spine', -0.08 * up, 0.14 * (s1 - s2), 0);
        c.set('chest', -0.42 * up + 0.12 * s3, 0.3 * (s1 - s2), 0);
        c.set('neck', 0.15 * up + 0.2 * s3, -0.26 * (s1 - s2), 0);
        c.set('head', 0.1 * s3, -0.2 * (s1 - s2), 0);
        c.set('jaw', 0.05 + 0.6 * bump(t, 0.3, 0.5, 1.2, 1.4), 0, 0);
        tail(c, 0.3, 0.3 * up, 0, 3, 0.1);
        ears(c, 0.8 * up);
        mane(c, 0.7 * up, (s1 - s2));
        rig.plantAll(c, {
          fl: { dz: 0.3 * s * s1 + 0.34 * s * s3, dy: 0.34 * s * (s1 + s3) * 0.9, dx: -0.2 * s * s1, pitch: 0.8 * s1 + 0.6 * s3 },
          fr: { dz: 0.3 * s * s2 + 0.34 * s * s3, dy: 0.34 * s * (s2 + s3) * 0.9, dx: 0.2 * s * s2, pitch: 0.8 * s2 + 0.6 * s3 },
        });
      },
    });
  }
  return clips;
}
