// Dragon clip set: idle, walk, run, attack (lunging bite), attack2 (claw + tail sweep), special1 (fire breath, `muzzle` socket),
// special2 (wing buffet / take-off slam), special3 (rearing roar / summon), hit, death, spawn (bursts out of the Great Metin), fly (hover).
// Rotations are deltas on identity rest rotations. +X rotation lowers a forward-pointing bone (nose down), +Y swings forward bones to +X,
// +Z rolls +X toward +Y. For wings `sx` (+1 left, -1 right) mirrors: raise = +z*sx, sweep-back = +y*sx.
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import { type FootOffset, type GaitSpec, type LegKey, QuadrupedRig, cwave, wave } from '../../core/anim/quadruped.ts';
import { QIDENT, clamp, clamp01, deg, mix, qmul, qrotate, smoothstep } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export const TAIL = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'] as const;
const NECK = ['neck1', 'neck2', 'neck3', 'neck4'] as const;
const NECK_W = [0.2, 0.3, 0.3, 0.2];
const NECK_S = [-0.5, -0.1, 0.5, 0.6];

export function dragonRig(skel: Skeleton): QuadrupedRig {
  return new QuadrupedRig(skel, {
    root: 'root', pelvis: 'pelvis', spine: 'spine', chest: 'chest', neck: 'neck1', head: 'head', jaw: 'jaw',
    tail: [...TAIL], ears: [],
    legs: {
      fl: { upper: 'arm_l', lower: 'forearm_l', foot: 'hand_l', parent: 'chest', kind: 'front' },
      fr: { upper: 'arm_r', lower: 'forearm_r', foot: 'hand_r', parent: 'chest', kind: 'front' },
      hl: { upper: 'thigh_l', lower: 'shin_l', foot: 'foot_l', toe: 'toe_l', parent: 'pelvis', kind: 'hind' },
      hr: { upper: 'thigh_r', lower: 'shin_r', foot: 'foot_r', toe: 'toe_r', parent: 'pelvis', kind: 'hind' },
    },
  });
}

/** neck chain: total pitch/yaw/roll spread over the four neck bones, `s` adds the swan S-curve (base arches up, head dips) */
export function neck(c: PoseCtx, pitch: number, yaw = 0, s = 0, roll = 0, lag?: { phase: number; u: number; yawAmp: number; pitchAmp: number }): void {
  NECK.forEach((b, i) => {
    let p = pitch * NECK_W[i]! + s * NECK_S[i]!;
    let y = yaw * NECK_W[i]!;
    if (lag) {
      p += lag.pitchAmp * wave(lag.u, 1, lag.phase - i * 0.07);
      y += lag.yawAmp * wave(lag.u, 1, lag.phase + 0.2 - i * 0.07);
    }
    c.set(b, p, y, roll * NECK_W[i]!);
  });
}

/** snout rest pitch baked into the head geometry (matches anatomy.headPitch) */
const HEAD_REST = 0.5;
const AIM_CHAIN = ['root', 'pelvis', 'spine', 'chest', 'neck1', 'neck2', 'neck3', 'neck4'] as const;

/** set the head so the snout points `snout` radians below horizontal in world space (+ = down), whatever the body/neck are doing */
export function aim(c: PoseCtx, snout: number, yaw = 0, roll = 0): void {
  let q = QIDENT;
  for (const b of AIM_CHAIN) q = qmul(q, c.pose.rot[c.skel.idx(b)]!);
  const d = qrotate(q, [0, -Math.sin(HEAD_REST), Math.cos(HEAD_REST)]);
  c.set('head', snout - Math.asin(clamp(-d[1], -1, 1)), yaw, roll);
}

/** tail chain: travelling wave, amplitude grows toward the blade */
export function tail(c: PoseCtx, yaw: number, pitch: number, phase: number, u: number, cycles = 1, lag = 0.09): void {
  TAIL.forEach((b, i) => {
    const k = 0.45 + i * 0.2;
    c.set(b, pitch * (0.6 + 0.12 * i) / 2, yaw * k * wave(u, cycles, phase - i * lag), 0);
  });
}

export interface WingSpec {
  /** humerus: raise (+ up) / sweep back / pitch */
  raise: number; back: number; pitch?: number;
  /** elbow yaw (+ sweeps the forearm back, negative folds it forward) and roll */
  elbow: number; foreZ?: number;
  /** finger yaw at the wrist (+ = fingers sweep back / curl in) and proximal-distal curl, plus roll lag for flapping */
  finger: number; tip: number; fingerZ?: number; tipZ?: number;
}

/** spread wing (bind pose) <-> folded wing (Z-fold: humerus back, forearm forward, fingers swept back) */
export function wingFold(f: number, extra: Partial<WingSpec> = {}): WingSpec {
  const e = (x: number): number => x * f;
  return {
    raise: e(0.15) + (extra.raise ?? 0), back: e(1.15) + (extra.back ?? 0), pitch: e(-0.1) + (extra.pitch ?? 0),
    elbow: e(-1.9) + (extra.elbow ?? 0), foreZ: e(0.35) + (extra.foreZ ?? 0),
    finger: e(2.25) + (extra.finger ?? 0), tip: e(1.1) + (extra.tip ?? 0), fingerZ: extra.fingerZ ?? 0, tipZ: extra.tipZ ?? 0,
  };
}

export function wing(c: PoseCtx, sx: 1 | -1, w: WingSpec): void {
  const sd = sx === 1 ? 'l' : 'r';
  c.set(`wing_arm_${sd}`, w.pitch ?? 0, sx * w.back, sx * w.raise);
  c.set(`wing_fore_${sd}`, 0, sx * w.elbow, sx * (w.foreZ ?? 0));
  const fz = w.fingerZ ?? 0, tz = w.tipZ ?? 0;
  c.set(`wing_f1a_${sd}`, 0, sx * w.finger, sx * fz);
  c.set(`wing_f1b_${sd}`, 0, sx * w.tip, sx * tz);
  c.set(`wing_f2a_${sd}`, 0, sx * w.finger * 0.96, sx * fz * 0.9);
  c.set(`wing_f2b_${sd}`, 0, sx * w.tip * 0.9, sx * tz * 0.9);
  c.set(`wing_f3_${sd}`, 0, sx * w.finger * 0.85, sx * fz * 0.7);
  c.set(`wing_f4_${sd}`, 0, sx * w.finger * 0.8, sx * fz * 0.6);
}

const wings = (c: PoseCtx, w: WingSpec, wr: WingSpec = w): void => {
  wing(c, 1, w);
  wing(c, -1, wr);
};

export function makeClips(a: Anatomy, skel: Skeleton): ClipSpec[] {
  const rig = dragonRig(skel);
  const s = a.s;
  const pawLen = 0.95 * s;
  const rest = (k: LegKey): FootOffset => ({ dz: 0, dy: 0, pitch: 0 });
  void rest;
  const FOLD = Number(process.env.DRAGON_FOLD ?? NaN);

  const walkG: GaitSpec = {
    duty: 0.62,
    phases: { hl: 0, fl: 0.25, hr: 0.5, fr: 0.75 },
    sweep: { front: 2.2 * s, hind: 2.4 * s },
    lift: { front: 0.55 * s, hind: 0.6 * s },
    pawLen,
    curl: 0.45,
  };
  const runG: GaitSpec = {
    duty: 0.4,
    phases: { hl: 0, fr: 0.02, hr: 0.5, fl: 0.52 },
    sweep: { front: 2.1 * s, hind: 2.2 * s },
    lift: { front: 0.9 * s, hind: 1.0 * s },
    pawLen,
    curl: 0.7,
  };

  // ------------------------------------------------------------------ idle: crouched threat display, wings spread wide and breathing, lazy tail
  const idle: ClipSpec = {
    name: 'idle', duration: 3.2, loop: true,
    pose(c) {
      const u = c.u;
      const br = wave(u, 1, 0);
      c.move('root', 0, -0.34 * s + 0.05 * s * br, 0.12 * s);
      c.set('pelvis', -0.05 + 0.012 * br, 0.03 * wave(u, 1, 0.25), 0.014 * wave(u, 1, 0.5));
      c.set('spine', 0.02 - 0.01 * br, -0.03 * wave(u, 1, 0.25), 0);
      c.set('chest', 0.1 + 0.035 * br, -0.05 * wave(u, 1, 0.3), 0.012 * wave(u, 1, 0.5));
      neck(c, 0.1 + 0.04 * wave(u, 2, 0.1), 0.16 * wave(u, 1, 0.15), 0.6 + 0.06 * br, 0.03 * wave(u, 1, 0.4), { phase: 0.1, u, yawAmp: 0.07, pitchAmp: 0.04 });
      aim(c, 0.52 + 0.04 * wave(u, 2, 0.3), 0.18 * wave(u, 1, 0.38), 0.05 * wave(u, 1, 0.1));
      const snarl = bump(u, 0.55, 0.62, 0.74, 0.86);
      c.set('jaw', 0.42 + 0.05 * Math.max(0, br) + 0.3 * snarl, 0, 0);
      tail(c, 0.16, 0.06 + 0.03 * br, 0, u, 1, 0.1);
      // spread wings: breathing flex, slow finger ripple, a tip twitch
      const fl = Number.isFinite(FOLD) ? FOLD : 0.04;
      const flex = 0.09 * br;
      const twitch = bump(u, 0.28, 0.33, 0.38, 0.46);
      wings(
        c,
        wingFold(fl, { raise: 0.34 + flex, tip: -0.08 * twitch, fingerZ: 0.07 * wave(u, 1, 0.2) + 0.05 * twitch, tipZ: 0.1 * wave(u, 1, 0.35) }),
        wingFold(fl, { raise: 0.34 + flex, tip: 0.04 * wave(u, 2, 0.5), fingerZ: 0.07 * wave(u, 1, 0.3), tipZ: 0.1 * wave(u, 1, 0.45) }),
      );
      // weight shift: the near fore foot re-places itself once per cycle
      const shuf = bump(u, 0.8, 0.86, 0.9, 0.96);
      rig.plantAll(c, { fr: { dz: 0.22 * s * shuf, dy: 0.28 * s * Math.sin(Math.PI * clamp01((u - 0.8) / 0.16)) * (u > 0.8 && u < 0.96 ? 1 : 0), pitch: 0.2 * shuf } });
    },
  };

  // ------------------------------------------------------------------ walk: heavy 4-beat gait, body roll, neck/tail counter-swing
  const walk: ClipSpec = {
    name: 'walk', duration: 1.25, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.16 * s - 0.09 * s * cwave(u, 2, 0.1), 0);
      c.set('root', 0.012 * wave(u, 2, 0.3), 0, 0);
      c.set('pelvis', 0.02 * wave(u, 2, 0.1), 0.1 * wave(u, 1, 0), 0.06 * wave(u, 1, 0.25));
      c.set('spine', 0.015 * wave(u, 2, 0.3), -0.12 * wave(u, 1, 0), -0.04 * wave(u, 1, 0.25));
      c.set('chest', 0.03 * wave(u, 2, 0.15) - 0.03, -0.15 * wave(u, 1, 0), 0.05 * wave(u, 1, 0.25));
      neck(c, -0.1 + 0.05 * wave(u, 2, 0.4), 0.2 * wave(u, 1, 0.05), 0.2, 0.03 * wave(u, 1, 0.3), { phase: 0.2, u, yawAmp: 0.07, pitchAmp: 0.04 });
      aim(c, 0.4 + 0.04 * wave(u, 2, 0.5), -0.1 * wave(u, 1, 0.05), 0);
      c.set('jaw', 0.05, 0, 0);
      tail(c, 0.3, 0.1, 0.1, u, 1, 0.12);
      wings(c, wingFold(0.45, { raise: 0.1 + 0.05 * wave(u, 2, 0.1) }), wingFold(0.45, { raise: 0.1 + 0.05 * wave(u, 2, 0.1) }));
      rig.gait(c, walkG, u);
    },
  };

  // ------------------------------------------------------------------ run: low trot, wings swept back and pumping, neck stretched
  const run: ClipSpec = {
    name: 'run', duration: 1.0, loop: true,
    pose(c) {
      const u = c.u;
      c.move('root', 0, -0.45 * s + 0.2 * s * Math.abs(wave(u, 2, 0.1)), 0.05 * s);
      c.set('root', 0.07 + 0.02 * wave(u, 2, 0.3), 0, 0.02 * wave(u, 1, 0.25));
      c.set('pelvis', -0.04 * cwave(u, 2, 0.02), 0.12 * wave(u, 1, 0), 0.07 * wave(u, 1, 0.25));
      c.set('spine', 0.04 * cwave(u, 2, 0.02), -0.14 * wave(u, 1, 0), -0.04 * wave(u, 1, 0.25));
      c.set('chest', 0.06 + 0.04 * cwave(u, 2, 0.02), -0.18 * wave(u, 1, 0), 0.04 * wave(u, 1, 0.25));
      neck(c, 0.7 + 0.08 * wave(u, 2, 0.3), 0.18 * wave(u, 1, 0.05), -0.25, 0.02 * wave(u, 1, 0.3));
      aim(c, 0.12 - 0.05 * wave(u, 2, 0.5), -0.1 * wave(u, 1, 0.05), 0);
      c.set('jaw', 0.22 + 0.12 * wave(u, 2, 0.1), 0, 0);
      tail(c, 0.38, -0.12, 0.1, u, 1, 0.12);
      const pump = wave(u, 2, 0.25);
      wings(c, wingFold(0.5, { raise: 0.45 + 0.28 * pump, back: 0.4, fingerZ: 0.12 * pump, tipZ: 0.2 * pump }), wingFold(0.5, { raise: 0.45 + 0.28 * pump, back: 0.4, fingerZ: 0.12 * pump, tipZ: 0.2 * pump }));
      rig.gait(c, runG, u);
    },
  };

  // ------------------------------------------------------------------ attack: coil back, lunging bite (hit 0.7 s), shake, recover
  const attack: ClipSpec = {
    name: 'attack', duration: 1.6, loop: false, hit: 0.7,
    pose(c) {
      const t = c.t;
      const coil = ramp(t, 0.0, 0.5, 'inout3') * (1 - ramp(t, 0.5, 0.62, 'in'));
      const lunge = ramp(t, 0.5, 0.72, 'out') * (1 - ramp(t, 0.86, 1.45, 'inout3'));
      const bite = bump(t, 0.46, 0.62, 0.66, 0.73);
      const shake = bump(t, 0.72, 0.76, 0.9, 1.08) * wave(t, 5.5, 0);
      c.move('root', 0, -0.35 * s * coil - 0.12 * s * lunge, -0.5 * s * coil + 1.5 * s * lunge);
      c.set('pelvis', -0.1 * coil + 0.14 * lunge, 0.05 * shake, 0);
      c.set('spine', 0.1 * coil - 0.1 * lunge, 0.06 * shake, 0);
      c.set('chest', -0.24 * coil + 0.3 * lunge, 0.1 * shake, 0);
      neck(c, -0.85 * coil + 1.0 * lunge, 0.35 * shake + 0.25 * coil, 0.7 * coil - 0.3 * lunge, 0.15 * shake);
      aim(c, 0.45 - 0.75 * coil + 0.45 * lunge, 0.4 * shake, 0.1 * shake);
      c.set('jaw', 0.05 + 1.0 * bite, 0, 0);
      tail(c, 0.3, 0.2 * lunge + 0.1 * coil, 0, c.u, 1, 0.1);
      const flare = Math.max(coil, lunge * 0.6);
      wings(c, wingFold(0.62 - 0.55 * flare, { raise: 0.3 + 0.5 * flare, back: 0.1 * lunge }));
      const fo = (k: LegKey): FootOffset | undefined => (k[0] === 'f' ? { dz: 1.0 * s * lunge, dy: 0.35 * s * Math.sin(Math.PI * clamp01(lunge * 1.1)) * 0.6, pitch: 0.3 * lunge } : undefined);
      rig.plantAll(c, { fl: fo('fl')!, fr: fo('fr')! });
    },
  };

  // ------------------------------------------------------------------ attack2: tail whip behind + claw swipe in front (hit 0.85 s)
  const attack2: ClipSpec = {
    name: 'attack2', duration: 1.8, loop: false, hit: 0.85,
    pose(c) {
      const t = c.t;
      const wind = ramp(t, 0.0, 0.6, 'inout3') * (1 - ramp(t, 0.6, 0.78, 'in'));
      const swing = ramp(t, 0.6, 0.88, 'in') * (1 - ramp(t, 0.9, 1.5, 'inout3'));
      const claw = ramp(t, 0.5, 0.86, 'in') * (1 - ramp(t, 0.9, 1.4, 'inout3'));
      c.move('root', 0, -0.2 * s * wind - 0.06 * s * swing, -0.15 * s * wind + 0.4 * s * swing);
      c.set('pelvis', 0, 0.35 * wind - 0.55 * swing, 0.05 * wind);
      c.set('spine', -0.04 * wind, -0.15 * wind + 0.35 * swing, 0);
      c.set('chest', -0.12 * wind + 0.06 * swing, -0.3 * wind + 0.55 * swing, -0.08 * wind);
      neck(c, -0.3 * wind + 0.35 * swing, -0.35 * wind + 0.55 * swing, 0.5 * wind);
      aim(c, 0.45 - 0.35 * wind + 0.05 * swing, -0.2 * wind + 0.3 * swing, 0);
      c.set('jaw', 0.08 + 0.45 * bump(t, 0.55, 0.7, 0.9, 1.05), 0, 0);
      // tail: coil toward +x then whip across to -x (each joint lags the previous one)
      TAIL.forEach((b, i) => {
        const lagT = clamp01(swing * 1.0 - 0.07 * i);
        const whip = ramp(t - 0.04 * i, 0.6, 0.9, 'in') * (1 - ramp(t - 0.04 * i, 0.92, 1.5, 'inout3'));
        void lagT;
        c.set(b, -0.08 * wind, (0.55 * wind - 1.0 * whip) * (0.7 + 0.18 * i) * (i === 0 ? 0.6 : 1), 0);
      });
      wings(c, wingFold(0.62 - 0.4 * (wind + swing) * 0.6, { raise: 0.3 + 0.4 * wind, back: -0.15 * swing }));
      // claws: right fore paw lifts and rakes across (inward + down)
      const lift = ramp(t, 0.1, 0.52, 'out') * (1 - ramp(t, 0.52, 0.64, 'in'));
      const dz = 0.7 * s * lift + 0.9 * s * claw;
      const dy = 1.3 * s * lift - 1.2 * s * claw;
      const dx = -0.1 * s * lift - 0.9 * s * claw;
      rig.plantAll(c, { fr: { dz, dy, dx, pitch: -0.3 * lift + 0.9 * claw } });
    },
  };

  // ------------------------------------------------------------------ special1: fire breath. Inhale 0-1.0 s, breathe 1.0-3.6 s (muzzle socket aims along +Z), recover.
  const BREATH0 = 1.0, BREATH1 = 3.6;
  const breath: ClipSpec = {
    name: 'special1', duration: 4.4, loop: false, hit: BREATH0,
    pose(c) {
      const t = c.t;
      const inhale = ramp(t, 0.0, BREATH0, 'inout3') * (1 - ramp(t, BREATH0, BREATH0 + 0.16, 'in'));
      const fire = ramp(t, BREATH0, BREATH0 + 0.2, 'out') * (1 - ramp(t, BREATH1, BREATH1 + 0.6, 'inout3'));
      const sweepA = bump(t, BREATH0 + 0.2, BREATH0 + 0.5, BREATH1 - 0.3, BREATH1) * wave((t - BREATH0) / (BREATH1 - BREATH0), 1, 0);
      const rumble = fire * wave(t, 11, 0);
      c.move('root', 0, -0.4 * s * inhale - 0.3 * s * fire + 0.03 * s * rumble, -0.35 * s * inhale + 0.15 * s * fire);
      c.set('pelvis', -0.08 * inhale + 0.06 * fire, 0.05 * sweepA, 0);
      c.set('spine', 0.06 * inhale - 0.04 * fire, 0.1 * sweepA, 0);
      c.set('chest', -0.3 * inhale + 0.12 * fire + 0.012 * rumble, 0.2 * sweepA, 0);
      // neck: pulled up and back while inhaling, then thrust forward with the head level so the cone leaves along +Z
      neck(c, -1.0 * inhale + 0.62 * fire, 0.45 * sweepA, 0.9 * inhale - 0.35 * fire, 0);
      aim(c, 0.45 - 1.2 * inhale - 0.5 * fire + 0.012 * rumble, 0.25 * sweepA, 0.02 * rumble);
      c.set('jaw', 0.12 + 0.45 * inhale + 0.5 * fire + 0.06 * rumble, 0, 0);
      tail(c, 0.12 * (1 - fire) + 0.05 * rumble, 0.45 * fire + 0.15 * inhale, 0, c.u, 2, 0.08);
      const spread = Math.max(inhale * 0.9, fire);
      wings(c, wingFold(0.62 - 0.6 * spread, { raise: 0.25 + 0.5 * spread + 0.04 * rumble, back: 0.2 * fire, fingerZ: 0.05 * rumble }));
      // hind legs plant wide for the recoil, forefeet dig in
      rig.plantAll(c, { fl: { dz: 0.3 * s * fire, dy: 0, pitch: 0.1 * fire, dx: 0.3 * s * fire }, fr: { dz: 0.3 * s * fire, dy: 0, pitch: 0.1 * fire, dx: -0.3 * s * fire } });
    },
  };

  // ------------------------------------------------------------------ special2: wing buffet / take-off slam (impact 1.4 s)
  const slamT = 1.4;
  const buffet: ClipSpec = {
    name: 'special2', duration: 2.8, loop: false, hit: slamT,
    pose(c) {
      const t = c.t;
      const crouch = ramp(t, 0.0, 0.55, 'inout3') * (1 - ramp(t, 0.55, 0.72, 'in'));
      const air = ramp(t, 0.58, 0.95, 'out') * (1 - ramp(t, 1.2, slamT, 'in'));
      const down = ramp(t, 0.72, 0.98, 'in') * (1 - ramp(t, 0.98, 1.22, 'out')); // power stroke
      const cock = ramp(t, 0.0, 0.55, 'inout3') * (1 - ramp(t, 0.55, 0.7, 'in')); // wings cocked up
      const slam = ramp(t, slamT - 0.1, slamT + 0.06, 'in') * (1 - ramp(t, slamT + 0.06, slamT + 0.9, 'out'));
      const buf = bump(t, slamT - 0.08, slamT + 0.02, slamT + 0.4, slamT + 0.9); // second sweeping buffet
      const jolt = damped(Math.max(0, t - slamT), 6, 5) * ramp(t, slamT, slamT + 0.04);
      const y = -0.8 * s * crouch + 2.3 * s * air - 0.5 * s * slam + 0.12 * s * jolt;
      c.move('root', 0, y, 0.5 * s * air);
      c.set('pelvis', 0.12 * crouch - 0.15 * air + 0.08 * slam, 0, 0);
      c.set('spine', -0.06 * crouch + 0.08 * slam, 0, 0);
      c.set('chest', 0.14 * crouch - 0.28 * air + 0.2 * slam, 0, 0);
      neck(c, 0.25 * crouch - 0.7 * air + 0.55 * slam, 0, 0.3 * crouch - 0.2 * slam, 0);
      aim(c, 0.45 + 0.2 * crouch - 0.55 * air + 0.3 * slam, 0, 0);
      c.set('jaw', 0.08 + 0.7 * bump(t, 0.95, 1.1, slamT, slamT + 0.35), 0, 0);
      tail(c, 0.1, 0.35 * air, 0, c.u, 1, 0.08);
      // wings: cocked high -> power stroke down (membrane lags behind the bones) -> forward slam buffet
      const raise = 0.55 + 0.95 * cock - 1.55 * down - 0.35 * buf;
      const lag = (0.3 + 0.2 * down) * (cock - down) - 0.5 * buf;
      const w = wingFold(0.55 - 0.55 * Math.max(cock, down, air, slam, buf), { raise, back: -0.5 * slam - 0.25 * buf, pitch: -0.35 * buf + 0.2 * down, fingerZ: lag * 0.5, tipZ: lag });
      wings(c, w);
      const off = (dx: number): FootOffset => ({ dz: 0, dy: 2.3 * s * air - 0.8 * s * (air > 0.01 ? 0 : 0), pitch: 0.5 * air, dx });
      rig.plantAll(c, { fl: off(0), fr: off(0), hl: { dz: -0.2 * s * air, dy: 2.3 * s * air, pitch: 0.5 * air }, hr: { dz: -0.2 * s * air, dy: 2.3 * s * air, pitch: 0.5 * air } });
    },
  };

  // ------------------------------------------------------------------ special3: rear up and roar / summon (peak 1.2 s)
  const rearT = 1.2;
  const roar: ClipSpec = {
    name: 'special3', duration: 3.0, loop: false, hit: rearT,
    pose(c) {
      const t = c.t;
      const rear = ramp(t, 0.0, rearT, 'inout3') * (1 - ramp(t, 1.9, 2.7, 'inout3'));
      const peak = bump(t, rearT - 0.3, rearT, 2.0, 2.45);
      const quake = 0.03 * wave(t, 13, 0) * peak;
      const slam = damped(Math.max(0, t - 2.7), 7, 6) * ramp(t, 2.6, 2.7);
      c.move('root', 0, 0.5 * s * rear - 0.3 * s * slam + quake * s, -0.5 * s * rear);
      c.set('pelvis', -0.28 * rear, 0, 0);
      c.set('spine', -0.18 * rear, 0.02 * quake * 10, 0);
      c.set('chest', -0.5 * rear + quake, 0, 0);
      neck(c, -0.2 * rear + 0.12 * quake * 10, 0.1 * wave(t, 3, 0) * peak, 0.9 * rear, 0);
      aim(c, 0.45 - 1.0 * rear + quake * 3, 0, 0.04 * wave(t, 9, 0) * peak);
      c.set('jaw', 0.1 + 0.95 * peak + 0.05 * wave(t, 9, 0) * peak, 0, 0);
      tail(c, 0.35 * peak + 0.1, 0.4 * rear, 0, c.u, 2, 0.1);
      const flap = 0.1 * wave(t, 4, 0) * peak;
      wings(c, wingFold(0.62 - 0.62 * rear, { raise: 0.2 + 0.85 * rear + flap, back: -0.1 * rear, fingerZ: 0.18 * flap * 6, tipZ: 0.3 * flap * 6 }));
      const lift = (k: LegKey): FootOffset => (k[0] === 'f' ? { dz: 0.5 * s * rear, dy: 1.7 * s * rear, pitch: -0.4 * rear, dx: (k === 'fl' ? 1 : -1) * 0.3 * s * rear } : { dz: 0, dy: 0, pitch: 0 });
      rig.plantAll(c, { fl: lift('fl'), fr: lift('fr') });
    },
  };

  // ------------------------------------------------------------------ hit: recoil with whiplash
  const hit: ClipSpec = {
    name: 'hit', duration: 0.7, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.08, 'out') * Math.exp(-4.6 * Math.max(0, t - 0.08));
      const osc = damped(Math.max(0, t - 0.08), 4.5, 6);
      c.move('root', 0, -0.1 * s * imp, -0.45 * s * imp);
      c.set('pelvis', 0.06 * imp, 0.05 * osc, 0.04 * osc);
      c.set('spine', -0.08 * imp, 0.07 * osc, 0);
      c.set('chest', -0.25 * imp, -0.1 * osc, 0.04 * osc);
      neck(c, -0.85 * imp + 0.1 * osc, 0.18 * osc, 0.5 * imp, 0);
      aim(c, 0.45 - 1.15 * imp, -0.1 * osc, 0);
      c.set('jaw', 0.7 * imp, 0, 0);
      tail(c, 0.4 * (1 - imp), 0.6 * imp, 0, c.u, 1, 0.08);
      wings(c, wingFold(0.62 - 0.45 * imp, { raise: 0.25 + 0.45 * imp, fingerZ: 0.1 * osc, tipZ: 0.2 * osc }));
      rig.plantAll(c, { fl: { dz: -0.2 * s * imp, dy: 0, pitch: 0 }, fr: { dz: -0.2 * s * imp, dy: 0, pitch: 0 } });
    },
  };

  // ------------------------------------------------------------------ death: bellow, stagger, collapse onto the belly, wings drape, last breath
  const death: ClipSpec = {
    name: 'death', duration: 4.6, loop: false,
    pose(c) {
      const t = c.t;
      const stagger = ramp(t, 0, 0.7, 'out');
      const buckle = ramp(t, 0.5, 1.7, 'in');
      const sink = ramp(t, 1.4, 2.5, 'out');
      const settle = ramp(t, 2.5, 4.2, 'out');
      const bellow = bump(t, 0.05, 0.4, 0.9, 1.5);
      const twitch = 0.04 * damped(Math.max(0, t - 2.4), 6, 3) * ramp(t, 2.4, 2.5);
      const last = bump(t, 3.4, 3.8, 3.9, 4.4) * 0.05;
      c.move('root', 0, -1.45 * s * buckle - 0.15 * s * sink - 0.05 * s * settle + twitch * s, -0.5 * s * stagger + 0.5 * s * sink);
      c.set('pelvis', -0.08 * stagger - 0.12 * buckle, 0.05 * sink, 0);
      c.set('spine', 0.05 * buckle, 0.1 * sink, 0);
      c.set('chest', -0.25 * stagger + 0.5 * buckle + 0.15 * sink - last, -0.15 * sink, -0.06 * sink);
      neck(c, -0.9 * bellow + 0.55 * sink + 0.35 * settle, 0.5 * sink, 0.5 * bellow - 0.35 * sink, 0.1 * sink);
      aim(c, 0.45 - 1.3 * bellow + 0.7 * sink + 0.1 * settle, 0.3 * sink, 0.1 * sink);
      c.set('jaw', 0.05 + 0.95 * bellow + 0.25 * sink * (1 - settle) + last, 0, 0);
      tail(c, 0.2 * (1 - sink), 0.3 * (1 - sink) - 0.12 * sink, 0, c.u, 1, 0.08);
      // wings first flare, then slump open and drape on the ground
      const flare = bump(t, 0.05, 0.5, 0.9, 1.5);
      const drape = ramp(t, 1.2, 2.6, 'out');
      wings(c, wingFold(0.5 - 0.5 * flare - 0.5 * drape, { raise: 0.3 + 0.75 * flare - 1.0 * drape, back: 0.15 * drape, pitch: 0.2 * drape, fingerZ: -0.15 * drape, tipZ: -0.55 * drape }));
      const down = (k: LegKey): FootOffset => ({ dz: (k[0] === 'f' ? 0.9 : -0.1) * s * buckle, dy: 0, pitch: 0.2 * buckle, dx: (k.endsWith('l') ? 1 : -1) * 0.5 * s * sink });
      rig.plantAll(c, { fl: down('fl'), fr: down('fr'), hl: down('hl'), hr: down('hr') });
    },
  };

  // ------------------------------------------------------------------ spawn: bursts out of the shattering Great Metin (starts fully underground), unfolds, roars
  const spawn: ClipSpec = {
    name: 'spawn', duration: 3.6, loop: false,
    pose(c) {
      const t = c.t;
      const rise = ramp(t, 0.0, 1.9, 'inout3');
      const breach = ramp(t, 1.5, 2.0, 'out');
      const shake = (1 - ramp(t, 1.6, 2.6)) * wave(t, 12, 0);
      const unfold = ramp(t, 1.9, 2.8, 'out');
      const rearUp = bump(t, 2.1, 2.55, 3.0, 3.5);
      const roarP = bump(t, 2.5, 2.7, 3.1, 3.5);
      const y = -7.2 * s * (1 - rise) - 0.12 * s + 0.4 * s * breach * (1 - ramp(t, 2.0, 2.5));
      c.move('root', 0.06 * s * shake * (1 - rise), y, 0);
      c.set('root', 0.05 * shake, 0, 0.04 * shake);
      c.set('pelvis', -0.1 * rearUp, 0.03 * shake, 0);
      c.set('spine', -0.06 * rearUp, 0, 0);
      c.set('chest', 0.12 * (1 - unfold) - 0.3 * rearUp, 0.04 * shake, 0);
      neck(c, 0.8 * (1 - unfold) - 0.2 * rearUp, 0.1 * shake, 0.2 + 0.7 * rearUp, 0);
      aim(c, 0.45 + 0.5 * (1 - unfold) - 1.0 * rearUp, 0, 0);
      c.set('jaw', 0.05 + 0.95 * roarP, 0, 0);
      tail(c, 0.22 * (1 - unfold) + 0.1, 0.25 * rearUp, 0, c.u, 3, 0.07);
      const flap = 0.12 * wave(t, 3, 0) * ramp(t, 2.0, 2.4) * (1 - ramp(t, 3.0, 3.5));
      wings(c, wingFold(1 - 0.38 * unfold - 0.1 * rearUp + 0.02 * shake, { raise: 0.35 * unfold * 0 + flap + 0.45 * rearUp, fingerZ: flap, tipZ: 2 * flap }));
      // feet ride along with the body until the dragon is above ground, then plant
      const ground = 1 - ramp(t, 0.0, 2.0, 'inout3');
      const o: FootOffset = { dz: 0, dy: -7.2 * s * ground, pitch: 0 };
      const hold = (k: LegKey): FootOffset => (k[0] === 'f' ? { ...o, dy: o.dy + 0.7 * s * rearUp, dz: 0.3 * s * rearUp } : o);
      rig.plantAll(c, { fl: hold('fl'), fr: hold('fr'), hl: o, hr: o });
    },
  };

  // ------------------------------------------------------------------ fly: hover loop (the roster's extra `fly` clip)
  const fly: ClipSpec = {
    name: 'fly', duration: 1.2, loop: true,
    pose(c) {
      const u = c.u;
      const stroke = cwave(u, 1, 0); // +1 up-stroke top, -1 bottom
      const lagw = wave(u, 1, 0.12);
      c.move('root', 0, 2.7 * s + 0.4 * s * -stroke, 0);
      c.set('root', 0.24 + 0.03 * stroke, 0, 0);
      c.set('pelvis', 0.15 - 0.04 * stroke, 0, 0);
      c.set('spine', 0.05, 0, 0);
      c.set('chest', -0.18 + 0.03 * stroke, 0, 0);
      neck(c, 0.1 - 0.05 * stroke, 0.08 * wave(u, 1, 0.3), 0.3, 0);
      aim(c, 0.35 + 0.05 * stroke, 0, 0);
      c.set('jaw', 0.5 + 0.08 * wave(u, 2, 0.2), 0, 0);
      tail(c, 0.3, 0.1, 0.2, u, 1, 0.13);
      const w = wingFold(0, { raise: 0.3 + 0.95 * stroke, back: 0.1 - 0.12 * stroke, elbow: -0.15 * stroke, fingerZ: -0.35 * lagw, tipZ: -0.7 * lagw, finger: 0.12 - 0.1 * stroke });
      wings(c, w);
      // legs hang loosely: hind trailing, fore tucked
      for (const sd of ['l', 'r'] as const) {
        c.set(`arm_${sd}`, 0.95, 0, 0);
        c.set(`forearm_${sd}`, -0.85, 0, 0);
        c.set(`hand_${sd}`, 0.5, 0, 0);
        c.set(`thigh_${sd}`, 0.95 + 0.05 * wave(u, 1, 0.2), 0, 0);
        c.set(`shin_${sd}`, 0.75, 0, 0);
        c.set(`foot_${sd}`, -0.45, 0, 0);
        c.set(`toe_${sd}`, 0.5, 0, 0);
      }
    },
  };

  return [idle, walk, run, attack, attack2, breath, buffet, roar, hit, death, spawn, fly];
}

export { clamp01, deg, keyed, mix, smoothstep };
