


//

// concentric two-lobe "( )" motion blur + a small swirl), fills out at 1.0-1.4 s, its arms drift outward and fade by ~1.6
// s, and only the burning / violet blade is left. Our zone lasts 3.5 s (x1.5 awakened), so the same spin is a PULSE that
// repeats every PULSE s (0.5 s of burning blade between two whirls) (windup only before the first one; between pulses the blade flame carries the read):


//                   deg/s, 0.13 s) strobing for the first 0.5 s of each pulse; g2/g3 add a second and a third swirl 1.2 m
//                   ahead of / behind the centre, g3 adds two olive-yellow crescent layers that grow with the swirl

//                   (pale blue at birth, then the grade colour), plus a crackle of stretched bolts racing hilt -> tip; g3 also
//                   leaves a column of pink smoke above the raised blade

import type { FxSpec } from '../../spec/types';

/** art roles (generated sprites; the fallback is the procedural role the old spec used) */
const SWIRL = { art: 'vfx_bladewheel_swirl', fallback: 'swirl2' } as const;
const BLUR = { art: 'vfx_bladewheel_blur', fallback: 'spinBlur' } as const;
const PUFF = { art: 'vfx_bladewheel_puff', fallback: 'cloud' } as const;
// one bolt frame: the codex-regenerated bolt (glowing core, 512x159) no longer matches the aspect of the old hairline second
// frame vfx_bladewheel_bolt_b (512x49), and a frame list stretches every frame into the first one's cell; re-add it as
// ['vfx_bladewheel_bolt', 'vfx_bladewheel_bolt_b'] once bolt_b is regenerated with the same aspect
const BOLT = { art: 'vfx_bladewheel_bolt', fallback: 'boltH' } as const;


const W = 0.8;
/** pulse period, s: windup-less repeat of the whirl (2 pulses in the 3.5 s zone, 3 in the awakened 5.25 s one) */
const PULSE = 1.6;

const WAIST = 0.95;

const SWEEP = 0.47;
/** one particle at the start of every cycle (max 1 alive): rate burst */
const ONE = [0, 60, 0.04, 60, 0.05, 0] as const;

const LAG = 0.06;

/** swirl alpha envelope over the particle life: a quick fade-in, the burst, a long translucent drift outward, gone */
const env = (c1: number, c2: number, c3: number, a: number): readonly number[] => [0, c1, 0, 0.07, c1, a, 0.3, c2, a * 0.8, 0.65, c3, a * 0.3, 1, c3, 0];

export const BLADEWHEEL: FxSpec = {
  id: 'sk.bladewheel',
  desc: '',
  behavior: 'spinAura',
  ref: {},
  size: 'radius',
  base: 3.2,
  dur: 3.5,
  fadeOut: 0.3,
  gradeScale: [1, 1.03, 1.06, 1.1],
  occlude: 1,
  clamp: 1,
  demo: { swing: { t0: W - 0.1, dur: 1.0, from: 0, to: -1080, pitch: 0 } },
  elements: [
    // ---------------------------------------------------------------------------------------- palbang_spin: swirls
    {
      kind: 'particle',
      note: '',
      t0: W + LAG,
      cycle: PULSE,
      loops: 0,
      max: 1,
      rate: ONE,
      life: [0, 0.98],
      at: [0, WAIST, 0],
      half: [0, 0.72],
      scale: [0, 2.5, 1, 6.0],
      color: env(0xffa838, 0xff8a20, 0xff6a10, 0.72),
      bright: 1.5,
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -1000 },
      attach: true,
      blend: 'add',
      tex: SWIRL,
      grade: {
        g1: { scale: [0, 3, 1, 6.5], color: env(0xffd058, 0xffb028, 0xff8a14, 0.9) },
        g2: { color: env(0xffdc30, 0xffbc20, 0xff7a10, 0.9) },
        g3: { bright: 1.25, color: env(0xffc830, 0xff9a20, 0xff5a10, 0.75) },
      },
    },
    {
      kind: 'particle',
      note: '',
      t0: W,
      cycle: PULSE,
      loops: 0,
      max: 3,
      rate: [0, 90, 0.5, 90, 0.51, 0],
      life: [0.003, 0.15],
      at: [0, WAIST, 0],
      half: [0, 0.69],
      scale: [0, 5.0],
      color: [0, 0xffa850, 0.9, 1, 0xf06a28, 0],
      bright: 1.6,
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -1500 },
      attach: true,
      blend: 'add',
      tex: BLUR,
      grade: {
        g1: { max: 3, life: [0.003, 0.18], scale: [0, 5.8], bright: 1.35, color: [0, 0x6a8cff, 0.6, 1, 0x2a3cf0, 0] },
        g2: { color: [0, 0x78a8ff, 0.7, 1, 0x2a5ccc, 0] },
        g3: { color: [0, 0xe060ff, 0.7, 0.28, 0xd8a0ff, 0.6, 0.5, 0x8a80ff, 0.5, 0.7, 0x5a62ee, 0.45, 1, 0x4a50e0, 0] },
      },
    },
    {
      kind: 'particle',
      note: 'G1+: palbang_3/4_spin #2: a second swirl 1.17 m ahead of the centre (g2: orange-white, g3: salmon pink), scale 3 -> 6',
      minRank: 5,
      t0: W + LAG,
      cycle: PULSE,
      loops: 0,
      max: 1,
      rate: ONE,
      life: [0, 0.98],
      at: [0, WAIST, 1.17],
      half: [0, 0.72],
      scale: [0, 2.6, 1, 5.6],
      color: env(0xffa060, 0xff8040, 0xff6030, 0.7),
      bright: 1.2,
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -1000 },
      attach: true,
      blend: 'add',
      tex: SWIRL,
      grade: {
        g3: { color: env(0xff5a90, 0xff4a84, 0xff3070, 0.7) },
      },
    },
    {
      kind: 'particle',
      note: 'G1+: palbang_3/4_spin #3: a third swirl 1.25 m behind the centre (g2: blue, g3: magenta), scale 3 -> 6',
      minRank: 5,
      t0: W + LAG,
      cycle: PULSE,
      loops: 0,
      max: 1,
      rate: ONE,
      life: [0, 0.98],
      at: [0, WAIST, -1.25],
      half: [0, 0.72],
      scale: [0, 2.6, 1, 5.6],
      color: env(0x5a96ff, 0x3a78f0, 0x2058d8, 0.7),
      bright: 1.2,
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -1000 },
      attach: true,
      blend: 'add',
      tex: SWIRL,
      grade: {
        g3: { color: env(0xe03ac8, 0xd02ab8, 0xb020a0, 0.7) },
      },
    },
    {
      kind: 'particle',
      note: 'P: palbang_4_spin #4/#5: two olive-yellow crescent layers behind the centre, scale 3 -> 6 over the swirl life: the broad yellow lobe',
      minRank: 7,
      t0: W + LAG,
      cycle: PULSE,
      loops: 0,
      max: 1,
      rate: ONE,
      life: [0, 0.98],
      at: [0, WAIST, -1.2],
      half: [0, 0.69],
      scale: [0, 3.0, 1, 6.2],
      color: env(0xf0dc30, 0xe4cc28, 0xd8bc20, 0.85),
      bright: 1.3,
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -1000 },
      attach: true,
      blend: 'add',
      tex: BLUR,
    },

    // ------------------------------------------------------------------------------- palbang_sword: the burning blade
    {
      kind: 'particle',
      note: '',
      attach: 'weapon',
      t0: 0,
      cycle: 3.4,
      loops: 0,
      max: 10,
      rate: [0, 20.6, SWEEP, 20.6, 0.5, 0],
      life: [0, 3],
      path: { y: [0, -0.88, SWEEP, -0.04] },
      half: [0, 0.7],
      scale: [[0, 0.36, 0.223, 0.37, 0.286, 0.55, 0.617, 0.55, 0.714, 0.4], [0, 0.35, 0.211, 0.36, 0.309, 0.5, 0.691, 0.51, 0.771, 0.385]],
      color: [0, 0x99ebff, 0.7, 0.1, 0x57afff, 0.7, 0.174, 0xff8800, 0.7, 0.423, 0xff7840, 0.65, 0.826, 0xff9060, 0.5, 1, 0xffa888, 0],
      bright: 1.35,
      billboard: 'screen',
      rotation: { start: [0, 800], spin: 500 },
      blend: 'add',
      tex: PUFF,
      occlude: 0,
      grade: {
        g1: {
          color: [0, 0x99ebff, 0.7, 0.105, 0x42a3ff, 0.7, 0.215, 0x1a2cff, 0.7, 0.433, 0x3a70d8, 0.65, 0.826, 0x4088d0, 0.5, 1, 0x4088d0, 0],
          scale: [[0, 0.36, 0.223, 0.8, 0.617, 0.8, 0.714, 0.4], [0, 0.35, 0.269, 0.8, 0.611, 0.78, 0.771, 0.385]],
        },
        g2: {
          color: [0, 0x99ebff, 0.7, 0.09, 0xc85050, 0.7, 0.172, 0xc5f600, 0.7, 0.546, 0x5058f0, 0.65, 0.826, 0xd8bdbc, 0.5, 1, 0xd8bdbc, 0],
        },
        g3: {
          color: [0, 0x2a34ff, 0.7, 0.097, 0x3a44ff, 0.7, 0.226, 0xff3a22, 0.7, 0.408, 0x4a54ff, 0.7, 0.826, 0xb8a8ff, 0.5, 1, 0xe8c8c6, 0],
        },
      },
    },
    {
      kind: 'particle',
      note: '',
      attach: 'weapon',
      t0: 0.016,
      cycle: 3.4,
      loops: 0,
      max: 10,
      rate: [0, 526],
      life: [0, 0.06],
      shape: { kind: 'ellipse', radius: 0.05, edge: true },
      at: [0, -0.88, 0],
      dir: { x: [0, -0.5155], y: [0, 180], z: [0, -0.5155] },
      jitter: [0.1, 0, 0.1],
      vel: [0, 0.1031],
      half: [0, 0.64],
      scale: [[0, 0.072, 0.12, 0.082, 0.262, 0.186, 0.691, 0.2165, 0.846, 0.062], [0, 0.093, 0.406, 0.258, 0.571, 0.155, 0.874, 0.031]],
      color: [0, 0xfffaf8, 1, 0.19, 0xfffaf8, 1, 0.436, 0xffb09b, 1, 0.7, 0xff6036, 0.53, 1, 0xff6036, 0],
      bright: 1.2,
      billboard: 'stretch',
      rotation: { start: [0, 40] },
      blend: 'add',
      tex: BOLT,
      occlude: 0,
      grade: {
        g1: { color: [0, 0xff5a96, 1, 0.55, 0xff4a22, 0.5, 1, 0xff4a22, 0] },
        g2: { color: [0, 0x3a40ff, 1, 0.6, 0x60a0ff, 0.45, 1, 0x60a0ff, 0] },
        g3: { color: [0, 0xffa536, 1, 1, 0xffa536, 0] },
      },
    },
    {
      kind: 'particle',
      note: 'G1+: palbang_3/4_sword #2: a second, wider bolt layer (g2: orange-pink -> yellow-green, g3: violet)',
      minRank: 5,
      attach: 'weapon',
      t0: 0.016,
      cycle: 3.4,
      loops: 0,
      max: 10,
      rate: [0, 526],
      life: [0, 0.06],
      shape: { kind: 'ellipse', radius: 0.05, edge: true },
      at: [0, -0.88, 0],
      dir: { x: [0, -0.5155], y: [0, 180], z: [0, -0.5155] },
      jitter: [0.1, 0, 0.1],
      vel: [0, 0.1031],
      half: [[0, 0.39], [0, 0.64]],
      scale: [[0, 0.072, 0.12, 0.082, 0.291, 0.32, 0.571, 0.247, 0.846, 0.062], [0, 0.093, 0.406, 0.258, 0.571, 0.155, 0.874, 0.031]],
      color: [0, 0xf88650, 1, 1, 0xd5e030, 0],
      bright: 1.2,
      billboard: 'stretch',
      rotation: { start: [0, 40] },
      blend: 'add',
      tex: BOLT,
      occlude: 0,
      grade: {
        g3: { color: [0, 0x8a4aff, 0.8, 1, 0x8a4aff, 0] },
      },
    },
    {
      kind: 'particle',
      note: '',
      minRank: 7,
      from: 'head',
      t0: 0,
      cycle: 3.4,
      loops: 0,
      max: 10,
      rate: [0, 20.6, SWEEP, 20.6, 0.5, 0],
      life: [0, 2],
      at: [0.1, 0, 0.1],
      path: { y: [0, -0.5, SWEEP, 0.55] },
      gravity: [0, -0.5],
      half: [0, 0.6],
      scale: [0, 0.95, 0.5, 1.2, 1, 1.5],
      color: [0, 0xf49a78, 0, 0.1, 0xf49a78, 0.55, 0.4, 0xb080e0, 0.36, 1, 0xe0a0b8, 0],
      bright: 1.1,
      billboard: 'screen',
      rotation: { start: [0, 800], spin: 400 },
      blend: 'add',
      tex: PUFF,
      occlude: 0,
    },

    // ------------------------------------------------------------------------------------------- blade trace (engine)
    {
      kind: 'trail',
      note: '',
      attach: 'weapon',
      t0: 0,
      life: 0.2,
      mode: 'band',
      width: 0.9,
      taper: [0, 1, 1, 0.5],
      color: [0, 0xffe8c0, 0.8, 0.35, 0xffb060, 0.6, 1, 0xff7020, 0],
      blend: 'add',
      bright: 1.4,
      tex: 'glowStrip',
      occlude: 0.3,
      grade: {
        g1: { color: [0, 0xfff0b0, 0.8, 0.35, 0xffc040, 0.6, 1, 0xff8a10, 0] },
        g2: { color: [0, 0xfff0c0, 0.8, 0.35, 0xffd040, 0.6, 1, 0x3a60ff, 0] },
        g3: { color: [0, 0xfff0ff, 0.85, 0.3, 0xff70d0, 0.65, 1, 0x4048ff, 0] },
      },
    },
  ],
};
