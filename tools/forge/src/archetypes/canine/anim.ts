// Canine clip set: idle, walk, run, attack (bite lunge), attack2 (claw swipe), hit, death, spawn, special1 (howl).
// Locomotion is in place; feet are planted with IK so strides read at any playback speed.

import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import { type FootOffset, type GaitSpec, type LegKey, QuadrupedRig, cwave, wave } from '../../core/anim/quadruped.ts';
import { clamp01, deg, mix, smoothstep } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export function canineRig(skel: Skeleton): QuadrupedRig {
  return new QuadrupedRig(skel, {
    root: 'root', pelvis: 'pelvis', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head', jaw: 'jaw',
    tail: ['tail1', 'tail2', 'tail3', 'tail4'], ears: ['ear_l', 'ear_r'],
    legs: {
      fl: { upper: 'arm_l', lower: 'forearm_l', foot: 'hand_l', parent: 'chest', kind: 'front' },
      fr: { upper: 'arm_r', lower: 'forearm_r', foot: 'hand_r', parent: 'chest', kind: 'front' },
      hl: { upper: 'thigh_l', lower: 'shin_l', foot: 'foot_l', toe: 'toe_l', parent: 'pelvis', kind: 'hind' },
      hr: { upper: 'thigh_r', lower: 'shin_r', foot: 'foot_r', toe: 'toe_r', parent: 'pelvis', kind: 'hind' },
    },
  });
}

/** tail chain wave: each segment lags the previous, amplitude grows toward the tip */
function tail(c: PoseCtx, yaw: number, pitch: number, phase: number, u: number, cycles = 1, lag = 0.12): void {
  ['tail1', 'tail2', 'tail3', 'tail4'].forEach((b, i) => {
    const k = 0.6 + i * 0.35;
    c.set(b, (pitch * (0.7 + 0.3 * i)) / 2, yaw * k * wave(u, cycles, phase - i * lag), 0);
  });
  // fan tails (if any): same motion with a per-tail phase offset so they ripple
  let m = 0;
  while (c.skel.names.includes(`tailF${m}_1`)) {
    const side = m < (c.skel.names.filter((n) => /^tailF\d+_1$/.test(n)).length / 2) ? -1 : 1;
    ['_1', '_2'].forEach((sfx, i) => {
      const k = 0.7 + i * 0.5;
      c.set(`tailF${m}${sfx}`, (pitch * (0.8 + 0.4 * i)) / 2, yaw * k * wave(u, cycles, phase - (m * 0.09 + i * lag)) + side * 0.02, 0);
    });
    m++;
  }
}

/** spread the fan tails outward/upward (spread/raise in radians); no-op for single-tail canines */
function fanTails(c: PoseCtx, spread: number, raise: number, shake = 0, u = 0): void {
  const n = c.skel.names.filter((x) => /^tailF\d+_1$/.test(x)).length;
  for (let m = 0; m < n; m++) {
    const side = m < n / 2 ? -1 : 1;
    const rank = (m < n / 2 ? n / 2 - m : m - n / 2 + 1) / (n / 2);
    const wob = shake * wave(u, 6, m * 0.13);
    c.set(`tailF${m}_1`, raise * (1.1 - 0.3 * rank) + wob, side * spread * rank, 0);
    c.set(`tailF${m}_2`, raise * 0.5 + wob, side * spread * rank * 0.5, 0);
  }
}

function ears(c: PoseCtx, back: number, flickL = 0, flickR = 0): void {
  c.set('ear_l', -back * 0.5, flickL * 0.3, -back * 0.9 + flickL);
  c.set('ear_r', -back * 0.5, -flickR * 0.3, back * 0.9 - flickR);
}

export function makeClips(a: Anatomy, skel: Skeleton): ClipSpec[] {
  const rig = canineRig(skel);
  const s = a.s;
  const pawLen = 0.17 * s;
  const lenScale = Math.sqrt(s * a.p.legLength);

  const walkG: GaitSpec = {
    duty: 0.64,
    phases: { hl: 0, fl: 0.25, hr: 0.5, fr: 0.75 },
    sweep: { front: 0.36 * s, hind: 0.38 * s },
    lift: { front: 0.075 * s, hind: 0.085 * s },
    pawLen,
    curl: 0.5,
  };
  const runG: GaitSpec = {
    duty: 0.36,
    phases: { hl: 0.0, hr: 0.09, fr: 0.44, fl: 0.54 },
    sweep: { front: 0.66 * s, hind: 0.74 * s },
    lift: { front: 0.15 * s, hind: 0.17 * s },
    pawLen,
    curl: 0.75,
  };

  // ------------------------------------------------------------------ idle
  const idle: ClipSpec = {
    name: 'idle', duration: 1.333, loop: true,
    pose(c) {
      const u = c.u;
      const br = wave(u, 1, 0);
      c.move('root', 0, -0.03 * s + 0.004 * s * br, 0.01 * s);
      c.set('pelvis', -0.04 + deg(0.5) * br, 0.02 * wave(u, 1, 0.25), 0.012 * wave(u, 1, 0.5));
      c.set('spine', 0.06 + deg(-0.8) * br, -0.015 * wave(u, 1, 0.25), 0);
      c.set('chest', 0.08 + deg(1.4) * br, -0.02 * wave(u, 1, 0.3), -0.01 * wave(u, 1, 0.5));
      c.set('neck', deg(-1.2) * br + 0.2, 0.05 * wave(u, 1, 0.2), 0);
      c.set('head', deg(1.5) * wave(u, 2, 0.1) - 0.02, 0.09 * wave(u, 1, 0.35), 0.03 * wave(u, 1, 0.1));
      c.set('jaw', 0.3 + 0.05 * Math.max(0, br), 0, 0);
      tail(c, 0.12, 0.05 + 0.03 * br, 0, u, 1, 0.1);
      const fl = bump(u, 0.55, 0.6, 0.62, 0.68);
      ears(c, 0.1 * (0.5 + 0.5 * wave(u, 1, 0.3)), fl * 0.4, 0);
      rig.plantAll(c);
    },
  };

  // ------------------------------------------------------------------ walk
  const walk: ClipSpec = {
    name: 'walk', duration: 0.867, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.012 * s - 0.014 * s * cwave(u, 2, 0.12), 0);
      c.set('pelvis', 0.02 * wave(u, 2, 0.1), 0.07 * wave(u, 1, 0), 0.05 * wave(u, 1, 0.25));
      c.set('spine', 0.015 * wave(u, 2, 0.3), -0.1 * wave(u, 1, 0), -0.03 * wave(u, 1, 0.25));
      c.set('chest', 0.025 * wave(u, 2, 0.15), -0.12 * wave(u, 1, 0), 0.03 * wave(u, 1, 0.25));
      c.set('neck', 0.05 + 0.03 * wave(u, 2, 0.4), 0.14 * wave(u, 1, 0.05), 0);
      c.set('head', 0.05 + 0.03 * wave(u, 2, 0.5), -0.07 * wave(u, 1, 0.05), 0);
      c.set('jaw', 0.02, 0, 0);
      tail(c, 0.2, 0.08, 0.1, u, 1, 0.13);
      ears(c, 0.12);
      rig.gait(c, walkG, u);
    },
  };

  // ------------------------------------------------------------------ run (gallop)
  const run: ClipSpec = {
    name: 'run', duration: 0.6, loop: true,
    pose(c) {
      const u = c.u;
      const ext = wave(u, 1, 0.0); // +1 reach / -1 gather
      c.move('root', 0, 0.03 * s * ext - 0.06 * s, 0);
      c.set('root', 0.045 * wave(u, 1, 0.25), 0, 0);
      c.set('pelvis', 0.1 * cwave(u, 1, 0.02), 0, 0.02 * wave(u, 1, 0.5));
      c.set('spine', -0.14 * cwave(u, 1, 0.02), 0.03 * wave(u, 1, 0.5), 0);
      c.set('chest', 0.1 * cwave(u, 1, 0.02) + 0.08, 0, 0.02 * wave(u, 1, 0.5));
      c.set('neck', 0.2 + 0.07 * cwave(u, 1, 0.2), 0, 0);
      c.set('head', 0.12 - 0.05 * cwave(u, 1, 0.2), 0, 0);
      c.set('jaw', 0.18 + 0.1 * wave(u, 1, 0.1), 0, 0);
      tail(c, 0.1, 0.35 + 0.1 * wave(u, 1, 0.1), 0.1, u, 1, 0.1);
      ears(c, 0.55);
      rig.gait(c, runG, u);
    },
  };

  // ------------------------------------------------------------------ attack: bite lunge, hit at 0.42 s
  const attack: ClipSpec = {
    name: 'attack', duration: 1.067, loop: false, hit: 0.42,
    pose(c) {
      const t = c.t;
      const coil = ramp(t, 0.0, 0.3, 'inout3') * (1 - ramp(t, 0.3, 0.38, 'in'));
      const lunge = ramp(t, 0.3, 0.42, 'out') * (1 - ramp(t, 0.5, 0.95, 'inout3'));
      const bite = bump(t, 0.3, 0.38, 0.4, 0.46); // jaw open then snap
      const shake = bump(t, 0.43, 0.46, 0.56, 0.7) * wave(t, 6.5, 0);
      c.move('root', 0, -0.07 * s * coil - 0.02 * s * lunge, 0.26 * s * lunge);
      c.set('pelvis', -0.1 * coil + 0.14 * lunge, 0, 0);
      c.set('spine', 0.1 * coil - 0.08 * lunge, 0, 0);
      c.set('chest', 0.05 * coil + 0.2 * lunge, 0.12 * shake, 0);
      c.set('neck', -0.28 * coil + 0.35 * lunge, 0.25 * shake, 0);
      c.set('head', -0.18 * coil + 0.12 * lunge, 0.35 * shake, 0);
      c.set('jaw', 0.05 + 0.75 * bite - 0.05 * lunge, 0, 0);
      tail(c, 0.12, 0.2 * lunge + 0.1 * coil, 0, c.u, 2, 0.1);
      ears(c, 0.5 * coil + 0.4 * lunge);
      const fo = (k: LegKey): FootOffset | undefined => (k[0] === 'f' ? { dz: 0.14 * s * lunge, dy: 0.1 * s * lunge, pitch: 0.5 * lunge } : undefined);
      rig.plantAll(c, { fl: fo('fl')!, fr: fo('fr')! });
    },
  };

  // ------------------------------------------------------------------ attack2: rear up and claw swipe, hit at 0.5 s
  const attack2: ClipSpec = {
    name: 'attack2', duration: 1.2, loop: false, hit: 0.5,
    pose(c) {
      const t = c.t;
      const up = ramp(t, 0.05, 0.38, 'inout3') * (1 - ramp(t, 0.58, 1.05, 'inout3'));
      const swing = ramp(t, 0.34, 0.52, 'in') * (1 - ramp(t, 0.55, 0.8, 'out')); // paw sweep
      const wind = ramp(t, 0.1, 0.34, 'out') * (1 - ramp(t, 0.34, 0.4));
      c.move('root', 0, -0.03 * s * up, -0.05 * s * up + 0.1 * s * swing);
      c.set('pelvis', -0.14 * up, 0, 0);
      c.set('spine', -0.06 * up, 0.1 * swing, 0);
      c.set('chest', -0.3 * up, 0.18 * swing - 0.15 * wind, -0.08 * wind);
      c.set('neck', 0.1 * up + 0.2 * swing, -0.2 * swing, 0);
      c.set('head', 0.12 * swing, -0.15 * swing, 0);
      c.set('jaw', 0.04 + 0.5 * bump(t, 0.38, 0.46, 0.55, 0.72), 0, 0);
      tail(c, 0.15, 0.25 * up, 0, c.u, 2, 0.1);
      ears(c, 0.6 * up);
      // right paw rakes across the body: lift/wind-up, then sweep forward-inward-down
      const lift = ramp(t, 0.08, 0.34, 'out');
      const dz = 0.28 * s * lift + 0.18 * s * swing;
      const dy = 0.3 * s * lift - 0.2 * s * swing;
      const dx = 0.1 * s * wind - 0.22 * s * swing;
      rig.plantAll(c, { fr: { dz, dy, dx, pitch: -0.2 * wind + 0.8 * swing } });
    },
  };

  // ------------------------------------------------------------------ hit flinch
  const hit: ClipSpec = {
    name: 'hit', duration: 0.5, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.07, 'out') * Math.exp(-5.2 * Math.max(0, t - 0.07)); // sharp peak, fast decay
      const osc = damped(Math.max(0, t - 0.07), 5, 7);
      c.move('root', 0, -0.015 * s * imp, -0.11 * s * imp);
      c.set('pelvis', 0.08 * imp, 0.05 * osc, 0.04 * osc);
      c.set('spine', -0.1 * imp, 0.1 * osc, 0);
      c.set('chest', -0.2 * imp, -0.12 * osc, 0.05 * osc);
      c.set('neck', -0.4 * imp, 0.1 * osc, 0);
      c.set('head', -0.3 * imp, -0.08 * osc, 0);
      c.set('jaw', 0.6 * imp, 0, 0);
      tail(c, 0.35 * (1 - imp), 0.5 * imp, 0, c.u, 1, 0.08);
      ears(c, 0.9 * imp);
      rig.plantAll(c, { fl: { dz: 0.05 * s * imp, dy: 0, pitch: 0 }, fr: { dz: 0.05 * s * imp, dy: 0, pitch: 0 } });
    },
  };

  // ------------------------------------------------------------------ death: stagger, topple onto the left side, settle
  const death: ClipSpec = {
    name: 'death', duration: 1.1, loop: false,
    pose(c) {
      const t = c.t;
      const stagger = ramp(t, 0, 0.22, 'out');
      const fall = ramp(t, 0.18, 0.72, 'in'); // topple
      const settle = ramp(t, 0.72, 1.1, 'out');
      const roll = deg(-84) * fall + deg(-4) * settle;
      const ground = (0.2 * s) * fall; // body half-width lifts the rolled body onto the ground
      c.move('root', -0.15 * s * stagger - 0.1 * s * fall, ground - 0.1 * s * stagger * (1 - fall), -0.12 * s * stagger);
      c.set('root', 0, 0, roll);
      c.set('pelvis', 0.1 * stagger, 0, 0);
      c.set('spine', -0.05 * stagger, 0.15 * fall, 0);
      c.set('chest', -0.15 * stagger, -0.2 * fall, 0);
      c.set('neck', -0.45 * stagger + 0.5 * fall, 0.35 * fall, 0.2 * fall);
      c.set('head', -0.25 * stagger + 0.4 * fall, 0.3 * fall, 0);
      c.set('jaw', 0.5 * stagger + 0.15 * settle, 0, 0);
      tail(c, 0.1, -0.25 * fall, 0, c.u, 1, 0.1);
      ears(c, 0.9 * stagger);
      // limbs: buckle then splay limply (FK)
      const twitch = 0.07 * damped(Math.max(0, t - 0.72), 7, 6) * settle;
      const limp = (bone: string, x: number, z = 0): void => {
        c.set(bone, x, 0, z);
      };
      limp('arm_l', -0.5 * fall + 0.4 * stagger + twitch, 0.3 * fall);
      limp('forearm_l', 0.9 * fall + 0.5 * stagger, 0);
      limp('hand_l', 0.4 * fall, 0);
      limp('arm_r', -0.9 * fall + 0.3 * stagger + twitch, -0.4 * fall);
      limp('forearm_r', 0.7 * fall + 0.4 * stagger, 0);
      limp('hand_r', 0.3 * fall, 0);
      limp('thigh_l', 0.5 * fall + 0.3 * stagger, 0.2 * fall);
      limp('shin_l', -0.8 * fall - 0.5 * stagger, 0);
      limp('foot_l', 0.5 * fall, 0);
      limp('thigh_r', 0.3 * fall + 0.3 * stagger + twitch, -0.3 * fall);
      limp('shin_r', -0.7 * fall - 0.5 * stagger, 0);
      limp('foot_r', 0.4 * fall, 0);
    },
  };

  // ------------------------------------------------------------------ spawn: rise from a crouch, shake it off
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.4, loop: false,
    pose(c) {
      const t = c.t;
      const low = 1 - ramp(t, 0.05, 0.62, 'inout3'); // crouch amount
      const rise = ramp(t, 0.5, 0.72, 'out') * (1 - ramp(t, 0.72, 0.9));
      const shake = bump(t, 0.8, 0.84, 1.0, 1.32) * wave(t, 7, 0);
      const headUp = ramp(t, 0.55, 0.85, 'out') * (1 - ramp(t, 1.0, 1.4, 'inout3'));
      c.move('root', 0, -0.3 * s * low + 0.03 * s * rise, 0);
      c.set('pelvis', -0.2 * low, 0.07 * shake, 0.05 * shake);
      c.set('spine', 0.18 * low, -0.1 * shake, 0);
      c.set('chest', 0.35 * low - 0.12 * headUp, 0.12 * shake, 0);
      c.set('neck', 0.35 * low - 0.4 * headUp, 0.2 * shake, 0);
      c.set('head', 0.3 * low - 0.2 * headUp, -0.25 * shake, 0.1 * shake);
      c.set('jaw', 0.55 * headUp, 0, 0);
      tail(c, 0.25 * (0.3 + shake), 0.2 + 0.3 * rise, 0, c.u, 4, 0.08);
      ears(c, 0.8 * low);
      rig.plantAll(c);
    },
  };

  // ------------------------------------------------------------------ special1: howl (call the pack)
  const howl: ClipSpec = {
    name: 'special1', duration: 1.9, loop: false,
    pose(c) {
      const t = c.t;
      const raise = ramp(t, 0.0, 0.45, 'inout3') * (1 - ramp(t, 1.45, 1.9, 'inout3'));
      const quiver = 0.02 * wave(t, 9, 0) * bump(t, 0.5, 0.6, 1.4, 1.5);
      c.move('root', 0, 0.0, -0.03 * s * raise);
      c.set('pelvis', -0.05 * raise, 0, 0);
      c.set('spine', -0.1 * raise, 0, 0);
      c.set('chest', -0.3 * raise, 0, 0);
      c.set('neck', -0.75 * raise + quiver, 0, 0);
      c.set('head', -0.65 * raise + quiver, 0, 0);
      c.set('jaw', 0.55 * raise * (0.8 + 0.2 * wave(t, 3, 0)), 0, 0);
      tail(c, 0.18, 0.4 * raise, 0, c.u, 2, 0.1);
      ears(c, 0.35 * raise);
      rig.plantAll(c);
    },
  };

  const clips = [idle, walk, run, attack, attack2, hit, death, spawn, howl];
  if ((a.p.tails ?? 1) > 1) {
    // special2: fan flare — crouch, tails spread wide and rise, spirit-fire burst at 0.9 s
    clips.push({
      name: 'special2', duration: 1.7, loop: false, hit: 0.9,
      pose(c) {
        const t = c.t;
        const coil = ramp(t, 0.0, 0.6, 'inout3') * (1 - ramp(t, 1.25, 1.7, 'inout3'));
        const burst = bump(t, 0.82, 0.95, 1.1, 1.3);
        c.move('root', 0, -0.05 * s * coil + 0.02 * s * burst, 0);
        c.set('spine', -0.08 * coil, 0, 0);
        c.set('chest', 0.12 * coil - 0.12 * burst, 0, 0);
        c.set('neck', -0.2 * coil - 0.2 * burst, 0, 0);
        c.set('head', -0.15 * coil, 0, 0);
        c.set('jaw', 0.25 * burst, 0, 0);
        tail(c, 0.08, 0.2 * coil, 0, c.u, 3, 0.08);
        fanTails(c, 0.9 * coil + 0.25 * burst, 0.55 * coil + 0.3 * burst, 0.05 * burst, c.u);
        ears(c, 0.4 * coil);
        rig.plantAll(c);
      },
    });
    // special3: tail lash — body torques, all tails sweep sideways across the front arc, hit at 0.7 s
    clips.push({
      name: 'special3', duration: 1.5, loop: false, hit: 0.7,
      pose(c) {
        const t = c.t;
        const wind = ramp(t, 0.0, 0.5, 'inout3') * (1 - ramp(t, 0.5, 0.75, 'in'));
        const lash = ramp(t, 0.5, 0.78, 'in') * (1 - ramp(t, 0.95, 1.5, 'inout3'));
        c.set('spine', 0, 0.25 * wind - 0.35 * lash, 0);
        c.set('chest', 0, 0.2 * wind - 0.3 * lash, 0);
        c.set('neck', 0.05, -0.15 * wind + 0.2 * lash, 0);
        tail(c, 0.1, 0.3, 0, c.u, 1, 0.1);
        fanTails(c, 1.15 * (wind - 1.4 * lash), 0.3 * (wind + lash), 0, c.u);
        ears(c, 0.3 * lash);
        rig.plantAll(c);
      },
    });
  }
  return clips;
}

export { clamp01, keyed, mix, smoothstep };
