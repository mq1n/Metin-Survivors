// Boar clip set: idle (head-low sniffing + hoof scrape), walk, run (heavy bound), attack (wind-up, upward tusk hook), attack2 (charge lunge),
// hit, death (topple), spawn (root in the ground, rise, shake). Locomotion is in place; feet are planted with IK.

// Rotation conventions: +pitch on neck/head = nose down (hook up = negative); +pitch on a mane bone = bristles stand up;
// +pitch on a tail bone = tail lifts.
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import { type FootOffset, type GaitSpec, type LegKey, QuadrupedRig, cwave, wave } from '../../core/anim/quadruped.ts';
import { deg } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export function boarRig(skel: Skeleton): QuadrupedRig {
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

/** gait specs (shared by the clips and by the authored ground speed in the model extras); front and hind sweep equal so no foot outruns another */
export function gaits(a: Anatomy): { walk: GaitSpec; run: GaitSpec; walkDur: number; runDur: number } {
  const s = a.s;
  return {
    walkDur: 0.867,
    runDur: 0.667,
    walk: {
      duty: 0.66,
      phases: { hl: 0, fl: 0.25, hr: 0.5, fr: 0.75 },
      sweep: { front: 0.3 * s, hind: 0.3 * s },
      lift: { front: 0.065 * s, hind: 0.07 * s },
      pawLen: 0.1 * s,
      curl: 0.45,
    },
    run: {
      duty: 0.4,
      phases: { hl: 0.0, hr: 0.1, fr: 0.46, fl: 0.56 },
      sweep: { front: 0.56 * s, hind: 0.56 * s },
      lift: { front: 0.12 * s, hind: 0.13 * s },
      pawLen: 0.1 * s,
      curl: 0.65,
    },
  };
}

/** authored ground speeds (m/s): stride sweep / (stance fraction x cycle time) */
export function authoredSpeeds(a: Anatomy): { walk: number; run: number } {
  const g = gaits(a);
  return { walk: g.walk.sweep.front / (g.walk.duty * g.walkDur), run: g.run.sweep.front / (g.run.duty * g.runDur) };
}

/** tail chain: each segment lags the previous, amplitude grows toward the tip */
function tail(c: PoseCtx, yaw: number, pitch: number, phase: number, u: number, cycles = 1, lag = 0.12): void {
  ['tail1', 'tail2', 'tail3', 'tail4'].forEach((b, i) => {
    const k = 0.6 + i * 0.35;
    c.set(b, (pitch * (0.7 + 0.3 * i)) / 2, yaw * k * wave(u, cycles, phase - i * lag), 0);
  });
}

function ears(c: PoseCtx, back: number, flickL = 0, flickR = 0): void {
  c.set('ear_l', -back * 0.5, flickL * 0.3, -back * 0.9 + flickL);
  c.set('ear_r', -back * 0.5, -flickR * 0.3, back * 0.9 - flickR);
}

/** bristle ridge: raise (+) / flatten (-) the front and rear hackles, with a ripple along the back */
function hackles(c: PoseCtx, raise: number, ripple = 0): void {
  c.set('mane_f', raise + 0.5 * ripple, 0, 0);
  c.set('mane_r', raise * 0.8 - 0.5 * ripple, 0, 0);
}

export function makeClips(a: Anatomy, skel: Skeleton): ClipSpec[] {
  const rig = boarRig(skel);
  const s = a.s;
  const g = gaits(a);

  // ------------------------------------------------------------------ idle: head low, snout working, one hoof scrapes the ground
  const idle: ClipSpec = {
    name: 'idle', duration: 2.0, loop: true,
    pose(c) {
      const u = c.u;
      const br = wave(u, 1, 0);
      const sniff = bump(u, 0.26, 0.34, 0.46, 0.54);
      const scrape = bump(u, 0.62, 0.68, 0.84, 0.9);
      const stroke = wave(u, 4, 0.1);
      c.move('root', 0, -0.006 * s + 0.004 * s * br - 0.008 * s * scrape, 0);
      c.set('pelvis', 0.006 * br, 0.025 * wave(u, 1, 0.25), 0.012 * wave(u, 1, 0.5));
      c.set('spine', -0.008 * br, -0.02 * wave(u, 1, 0.25), 0);
      c.set('chest', 0.014 * br + 0.05 * scrape, -0.03 * wave(u, 1, 0.3) + 0.04 * scrape, -0.01 * wave(u, 1, 0.5));
      c.set('neck', 0.03 + 0.03 * wave(u, 2, 0.1) - 0.2 * sniff + 0.12 * scrape, 0.1 * wave(u, 1, 0.2) - 0.1 * scrape, 0);
      c.set('head', 0.02 * wave(u, 3, 0.2) - 0.22 * sniff + 0.1 * scrape + 0.05 * sniff * wave(u, 9, 0), 0.1 * wave(u, 1, 0.35) * (1 - scrape), 0.03 * wave(u, 1, 0.1));
      c.set('jaw', -0.06 + 0.05 * Math.max(0, br) + 0.1 * sniff * Math.max(0, wave(u, 9, 0.25)), 0, 0);
      hackles(c, 0.03 + 0.03 * br + 0.1 * scrape, 0.04 * wave(u, 2, 0.3));
      tail(c, 0.16, 0.05 + 0.03 * br, 0, u, 2, 0.1);
      ears(c, 0.06 * (0.5 + 0.5 * wave(u, 1, 0.3)), bump(u, 0.12, 0.15, 0.17, 0.2) * 0.5, bump(u, 0.74, 0.77, 0.79, 0.82) * 0.4);
      rig.plantAll(c, { fr: { dz: 0.04 * s * scrape + 0.06 * s * scrape * stroke, dy: 0.055 * s * scrape, pitch: 0.55 * scrape } });
    },
  };

  // ------------------------------------------------------------------ walk: heavy plod, head swinging low
  const walk: ClipSpec = {
    name: 'walk', duration: g.walkDur, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.008 * s - 0.012 * s * cwave(u, 2, 0.12), 0);
      c.set('pelvis', 0.02 * wave(u, 2, 0.1), 0.07 * wave(u, 1, 0), 0.05 * wave(u, 1, 0.25));
      c.set('spine', 0.015 * wave(u, 2, 0.3), -0.1 * wave(u, 1, 0), -0.03 * wave(u, 1, 0.25));
      c.set('chest', 0.03 * wave(u, 2, 0.15), -0.12 * wave(u, 1, 0), 0.03 * wave(u, 1, 0.25));
      c.set('neck', 0.1 + 0.05 * wave(u, 2, 0.4), 0.16 * wave(u, 1, 0.05), 0);
      c.set('head', 0.06 + 0.04 * wave(u, 2, 0.5), -0.1 * wave(u, 1, 0.05), 0.03 * wave(u, 1, 0.3));
      c.set('jaw', 0.04, 0, 0);
      hackles(c, 0.06, 0.07 * wave(u, 2, 0.2));
      tail(c, 0.22, 0.06, 0.1, u, 1, 0.13);
      ears(c, 0.08, 0.12 * wave(u, 2, 0.1), 0.12 * wave(u, 2, 0.6));
      rig.gait(c, g.walk, u);
    },
  };

  // ------------------------------------------------------------------ run: low-headed bounding charge, hackles up
  const run: ClipSpec = {
    name: 'run', duration: g.runDur, loop: true,
    pose(c) {
      const u = c.u;
      const ext = wave(u, 1, 0.0); // +1 reach / -1 gather
      c.move('root', 0, 0.025 * s * ext - 0.055 * s, 0);
      c.set('root', 0.04 * wave(u, 1, 0.25), 0, 0);
      c.set('pelvis', 0.09 * cwave(u, 1, 0.02), 0, 0.02 * wave(u, 1, 0.5));
      c.set('spine', -0.12 * cwave(u, 1, 0.02), 0.03 * wave(u, 1, 0.5), 0);
      c.set('chest', 0.09 * cwave(u, 1, 0.02) + 0.05, 0, 0.02 * wave(u, 1, 0.5));
      c.set('neck', 0.18 + 0.08 * cwave(u, 1, 0.2), 0.05 * wave(u, 2, 0.1), 0);
      c.set('head', 0.12 - 0.06 * cwave(u, 1, 0.2), 0.05 * wave(u, 2, 0.35), 0);
      c.set('jaw', 0.12 + 0.08 * wave(u, 1, 0.1), 0, 0);
      hackles(c, 0.2, 0.12 * wave(u, 1, 0.3));
      tail(c, 0.1, 0.3 + 0.1 * wave(u, 1, 0.1), 0.1, u, 1, 0.1);
      ears(c, 0.5, 0.1 * wave(u, 2, 0.1), 0.1 * wave(u, 2, 0.6));
      rig.gait(c, g.run, u);
    },
  };

  // ------------------------------------------------------------------ attack: shrink back, head to the ground, then an upward tusk hook; hit at 0.57 s
  const attack: ClipSpec = {
    name: 'attack', duration: 1.5, loop: false, hit: 0.57,
    pose(c) {
      const t = c.t;
      // h: +1 head hauled down & back (wind-up), -1 head thrown up (hook)
      const h = keyed(t, [[0, 0], [0.34, 1], [0.44, 1], [0.57, -1], [0.72, -0.85], [1.05, 0.15], [1.5, 0]], 'smooth');
      const lunge = keyed(t, [[0, 0], [0.34, -0.45], [0.44, -0.45], [0.57, 1], [0.8, 0.5], [1.15, 0], [1.5, 0]], 'smooth');
      const crouch = keyed(t, [[0, 0], [0.34, 1], [0.44, 1], [0.57, 0.1], [0.8, 0.2], [1.5, 0]], 'smooth');
      const stamp = bump(t, 0.12, 0.2, 0.26, 0.34) * Math.max(0, wave(t, 2.6, 0));
      const snap = bump(t, 0.5, 0.56, 0.62, 0.74);
      c.move('root', 0, -0.04 * s * crouch - 0.012 * s * lunge, 0.13 * s * lunge);
      c.set('pelvis', -0.08 * crouch + 0.1 * Math.max(0, lunge) * 0.6, 0, 0);
      c.set('spine', 0.05 * crouch - 0.05 * Math.max(0, -h), 0, 0);
      c.set('chest', 0.18 * crouch * Math.max(0, h) - 0.14 * Math.max(0, -h) - 0.04 * stamp, 0, 0);
      c.set('neck', 0.26 * h, 0.12 * ramp(t, 0.57, 0.7) * (1 - ramp(t, 0.7, 1.0)), 0);
      c.set('head', 0.42 * h, 0.2 * ramp(t, 0.57, 0.68) * (1 - ramp(t, 0.68, 1.0)), 0);
      c.set('jaw', 0.08 + 0.5 * snap, 0, 0);
      hackles(c, 0.25 * Math.max(0, h) + 0.1 * Math.max(0, -h), 0.1 * snap);
      tail(c, 0.14, 0.22 * Math.max(0, lunge) + 0.1 * crouch, 0, c.u, 2, 0.1);
      ears(c, 0.4 * Math.max(0, h) + 0.15 * snap);
      const fo = (k: LegKey): FootOffset | undefined => (k[0] === 'f' ? { dz: 0.09 * s * lunge, dy: 0.04 * s * Math.max(0, lunge), pitch: 0.3 * Math.max(0, lunge) } : undefined);
      rig.plantAll(c, { fl: fo('fl')!, fr: { ...fo('fr')!, dy: 0.05 * s * stamp, dz: fo('fr')!.dz + 0.02 * s * stamp, pitch: 0.4 * stamp } });
    },
  };

  // ------------------------------------------------------------------ attack2: paw, then a head-down charging lunge; hit at 0.40 s
  const attack2: ClipSpec = {
    name: 'attack2', duration: 1.6, loop: false, hit: 0.4,
    pose(c) {
      const t = c.t;
      const pawing = bump(t, 0.04, 0.1, 0.22, 0.3);
      const paw = pawing * Math.max(0, wave(t, 3.3, 0.0));
      const lunge = keyed(t, [[0, 0], [0.26, -0.3], [0.4, 1], [0.62, 1.05], [0.95, 0.4], [1.3, 0], [1.6, 0]], 'smooth');
      const low = keyed(t, [[0, 0], [0.26, 1], [0.4, 0.8], [0.62, 0.6], [1.0, 0.25], [1.4, 0], [1.6, 0]], 'smooth');
      const shake = bump(t, 0.66, 0.74, 0.96, 1.2) * wave(t, 5, 0);
      c.move('root', 0, -0.03 * s * low, 0.3 * s * lunge);
      c.set('pelvis', 0.1 * Math.max(0, lunge) - 0.06 * low * (1 - Math.max(0, lunge)), 0.04 * shake, 0);
      c.set('spine', -0.08 * Math.max(0, lunge) + 0.05 * low, 0.07 * shake, 0);
      c.set('chest', 0.14 * low - 0.04 * Math.max(0, lunge), 0.08 * shake, 0);
      c.set('neck', 0.1 * low + 0.14 * Math.max(0, lunge), 0.3 * shake, 0);
      c.set('head', 0.16 * low + 0.18 * Math.max(0, lunge), 0.4 * shake, 0.06 * shake);
      c.set('jaw', 0.06 + 0.3 * bump(t, 0.32, 0.4, 0.5, 0.65), 0, 0);
      hackles(c, 0.28 * low + 0.08 * Math.max(0, lunge), 0.1 * shake);
      tail(c, 0.12, 0.34 * Math.max(0, lunge) + 0.1 * low, 0, c.u, 2, 0.1);
      ears(c, 0.55 * low + 0.15 * Math.max(0, lunge));
      const fo = (k: LegKey): FootOffset => (k[0] === 'f' ? { dz: 0.22 * s * lunge, dy: 0.05 * s * Math.max(0, lunge) * (1 - ramp(t, 0.62, 0.8)), pitch: 0.4 * Math.max(0, lunge) } : { dz: 0.0, dy: 0, pitch: 0 });
      rig.plantAll(c, { fl: fo('fl'), fr: { ...fo('fr'), dy: fo('fr').dy + 0.06 * s * paw, dz: fo('fr').dz - 0.03 * s * paw, pitch: fo('fr').pitch + 0.5 * paw } });
    },
  };

  // ------------------------------------------------------------------ hit: head snaps up, body recoils
  const hit: ClipSpec = {
    name: 'hit', duration: 0.4, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.06, 'out') * Math.exp(-5.5 * Math.max(0, t - 0.06));
      const osc = damped(Math.max(0, t - 0.06), 5, 7);
      c.move('root', 0, -0.012 * s * imp, -0.09 * s * imp);
      c.set('pelvis', 0.07 * imp, 0.05 * osc, 0.04 * osc);
      c.set('spine', -0.08 * imp, 0.09 * osc, 0);
      c.set('chest', -0.16 * imp, -0.1 * osc, 0.05 * osc);
      c.set('neck', -0.3 * imp, 0.1 * osc, 0);
      c.set('head', -0.3 * imp, -0.08 * osc, 0);
      c.set('jaw', 0.5 * imp, 0, 0);
      hackles(c, 0.3 * imp, 0.1 * osc);
      tail(c, 0.3 * (1 - imp), 0.5 * imp, 0, c.u, 1, 0.08);
      ears(c, 0.8 * imp);
      rig.plantAll(c, { fl: { dz: 0.04 * s * imp, dy: 0, pitch: 0 }, fr: { dz: 0.04 * s * imp, dy: 0, pitch: 0 } });
    },
  };

  // ------------------------------------------------------------------ death: stagger, topple onto the side with the tusks down, legs go slack
  const death: ClipSpec = {
    name: 'death', duration: 1.2, loop: false,
    pose(c) {
      const t = c.t;
      const stagger = ramp(t, 0, 0.24, 'out');
      const fall = ramp(t, 0.2, 0.78, 'in');
      const settle = ramp(t, 0.78, 1.2, 'out');
      const roll = deg(-86) * fall + deg(-3) * settle;
      const ground = 0.21 * s * fall;
      c.move('root', -0.1 * s * stagger - 0.08 * s * fall, ground - 0.07 * s * stagger * (1 - fall), -0.1 * s * stagger);
      c.set('root', 0, 0, roll);
      c.set('pelvis', 0.08 * stagger, 0, 0);
      c.set('spine', -0.04 * stagger, 0.12 * fall, 0);
      c.set('chest', -0.14 * stagger, -0.18 * fall, 0);
      c.set('neck', -0.4 * stagger + 0.55 * fall, 0.3 * fall, 0.15 * fall);
      c.set('head', -0.25 * stagger + 0.35 * fall, 0.25 * fall, 0);
      c.set('jaw', 0.45 * stagger + 0.12 * settle, 0, 0);
      hackles(c, 0.3 * stagger - 0.3 * fall);
      tail(c, 0.1, -0.25 * fall, 0, c.u, 1, 0.1);
      ears(c, 0.9 * stagger);
      const twitch = 0.08 * damped(Math.max(0, t - 0.78), 7, 6) * settle;
      const limp = (bone: string, x: number, z = 0): void => {
        c.set(bone, x, 0, z);
      };
      limp('arm_l', -0.45 * fall + 0.4 * stagger + twitch, 0.3 * fall);
      limp('forearm_l', 0.85 * fall + 0.45 * stagger, 0);
      limp('hand_l', 0.35 * fall, 0);
      limp('arm_r', -0.85 * fall + 0.3 * stagger + twitch, -0.4 * fall);
      limp('forearm_r', 0.65 * fall + 0.35 * stagger, 0);
      limp('hand_r', 0.3 * fall, 0);
      limp('thigh_l', 0.45 * fall + 0.3 * stagger, 0.2 * fall);
      limp('shin_l', -0.75 * fall - 0.45 * stagger, 0);
      limp('foot_l', 0.45 * fall, 0);
      limp('thigh_r', 0.3 * fall + 0.3 * stagger + twitch, -0.3 * fall);
      limp('shin_r', -0.65 * fall - 0.45 * stagger, 0);
      limp('foot_r', 0.35 * fall, 0);
    },
  };

  // ------------------------------------------------------------------ spawn: snout rooting in the ground, heave up, shake it off
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.6, loop: false,
    pose(c) {
      const t = c.t;
      const dig = bump(t, 0.0, 0.12, 0.7, 0.9);
      const rootBob = dig * (0.5 + 0.5 * wave(t, 2.6, 0.0));
      const rise = ramp(t, 0.7, 1.0, 'out');
      const low = (1 - rise) * 0.75 + 0.25 * (1 - ramp(t, 0.0, 0.1));
      const shake = bump(t, 0.95, 1.0, 1.35, 1.58) * wave(t, 6.5, 0);
      c.move('root', 0, -0.07 * s * low + 0.015 * s * bump(t, 0.9, 1.0, 1.1, 1.25), 0);
      c.set('pelvis', -0.12 * low, 0.07 * shake, 0.05 * shake);
      c.set('spine', 0.1 * low, -0.1 * shake, 0);
      c.set('chest', 0.22 * low - 0.08 * rise, 0.14 * shake, 0);
      c.set('neck', 0.3 * low + 0.12 * rootBob - 0.18 * bump(t, 0.9, 1.05, 1.25, 1.5), 0.2 * shake, 0);
      c.set('head', 0.28 * low + 0.16 * rootBob - 0.2 * bump(t, 0.9, 1.05, 1.25, 1.5), -0.28 * shake, 0.1 * shake);
      c.set('jaw', 0.1 * dig + 0.35 * bump(t, 0.9, 1.0, 1.2, 1.4), 0, 0);
      hackles(c, 0.3 * low + 0.12 * shake * shake + 0.2 * bump(t, 0.9, 1.0, 1.3, 1.5), 0.1 * shake);
      tail(c, 0.25 * (0.3 + Math.abs(shake)), 0.2 + 0.3 * rise, 0, c.u, 4, 0.08);
      ears(c, 0.7 * low + 0.2 * Math.abs(shake));
      rig.plantAll(c);
    },
  };

  return [idle, walk, run, attack, attack2, hit, death, spawn];
}
