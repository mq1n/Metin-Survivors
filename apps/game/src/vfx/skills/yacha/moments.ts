
// the skill covers, plus the converted hero-attached loops of the two shells. Every spec is flagged `moment: true` (a live generated family never
// drops it; vfx/__tests__/noCasterDarkening.test.ts reads it), built with the constructors of ../common/momentKit.ts, registered through the ONE

//
//   id                              kind    sim call (sim/skills/)                                    scale / duration the sim hands
//   sk.umbral_plate.loop        marker  shell.ts grantWard  spawnMarker(.. '.loop', shellScale)   k 1.4 (area 2.2 x .5), the ward window
//   sk.umbral_plate.burst       event   shell.ts endWard    vfx('.burst', burst)                  k 3.5, 0.6 s
//   sk.obsidian_bulwark.loop         marker  shell.ts grantWard                                        k 1.4 (area 1.8 x .5), the ward window
//   sk.obsidian_bulwark.burst        event   shell.ts endWard                                          k 4.5, 0.6 s
//   sk.cursed_legion.rise           event   companions.ts knightCast (one per knight, the corpse spot) k 3, 1.0 s   BIG
//   sk.dark_covenant.pay            event   behaviors/selfBuff.ts cast (`cost`)                       k 2, 0.5 s
//   sk.unbinding_sigil.purge                 event   NOT EMITTED YET (zones.ts purges silently); the look is ready for the day it is
//   sk.blaze_familiars.cast            event   adapter skillCast (summon / re-kindle only)               area 1.5 (hand sockets: k does not matter)
//   sk.blaze_familiars.explode         event   adapter swaps the twin's vfx_explode                      k = area / 1.5 (burst = area), 0.35 s
//
// The body of the spirit (`sk.blaze_familiars`, tracked on the orbiting rows and on the twins) is the hand spec in ./magic.ts.
//

// are ALPHA-DARKENING effects in the client; here the same identity is coloured LIGHT: every element is additive (an additive element cannot darken),
// none uses `occlude`, bright stacks carry `clamp`. The hero guard (vfx/heroGuard.ts) fades everything inside the hero's screen ellipse anyway.
// Roles are procedural only: no new raster, no art key, no change of any run's art scope. Markers carry no element on the wire: fixed colours.
import type { ColorCurve, FxSpec, ParticleSpec, SurfaceSpec, TexSrc, Vec3 } from '../../spec/types';
import { burstSpec, flash, markerSpec, ringBand, risingMotes, sparkBurst } from '../common/momentKit';


// ---------------------------------------------------------------------------------------------------------------- local recipes

/** a soft sprite that breathes in place for as long as the marker lives (two overlapping copies keep the light steady; rides the marker) */
function breath(note: string, o: {
  at: Vec3;
  half: number;
  period: number;
  color: ColorCurve;
  tex?: TexSrc;
  scale?: readonly number[];
  billboard?: ParticleSpec['billboard'];
  spin?: number;
  clamp?: number;
  minTier?: 0 | 1 | 2 | 3;
}): ParticleSpec {
  return {
    kind: 'particle',
    note,
    cycle: o.period,
    loops: 0,
    max: 3,
    rate: [0, 2 / o.period],
    life: [0, o.period],
    at: o.at,
    half: [0, o.half],
    scale: o.scale ?? [0, 0.92, 0.5, 1, 1, 0.92],
    color: o.color,
    billboard: o.billboard ?? 'screen',
    ...(o.spin !== undefined ? { rotation: { start: [0, 360] as const, spin: o.spin, randomDir: true } } : {}),
    attach: true,
    blend: 'add',
    tex: o.tex ?? 'glow',
    ...(o.clamp !== undefined ? { clamp: o.clamp } : { clamp: 1 }),
    ...(o.minTier !== undefined ? { minTier: o.minTier } : {}),
  };
}

/** an upright camera-facing card standing round the hero (the jumagap_loop / heuksin arcs), looping */
function standingCard(note: string, o: { w: number; h: number; y: number; life: number; color: ColorCurve; tex: TexSrc; softU?: number }): SurfaceSpec {
  return {
    kind: 'surface',
    note,
    life: o.life,
    loop: true,
    shape: { kind: 'card', w: o.w, h: o.h },
    at: [0, o.y, 0],
    billboard: 'upright',
    color: o.color,
    blend: 'add',
    tex: o.tex,
    soft: 0.5,
    ...(o.softU !== undefined ? { softU: o.softU } : {}),
    clamp: 1,
  };
}

/** one-shot lying sprite on the ground (a crack, a rune, a ray disc): `half` m, `life` s, size over life as [from, to] */
function groundSprite(note: string, o: {
  half: number;
  life: number;
  color: ColorCurve;
  tex: TexSrc;
  grow?: readonly [number, number];
  t0?: number;
  y?: number;
  spin?: number;
  bright?: number;
}): ParticleSpec {
  return {
    kind: 'particle',
    note,
    ...(o.t0 !== undefined ? { t0: o.t0 } : {}),
    cycle: Math.max(0.1, o.life),
    max: 1,
    rate: [0, 1000],
    life: [0, o.life],
    at: [0, o.y ?? 0.06, 0],
    half: [0, o.half],
    scale: [0, o.grow?.[0] ?? 1, 1, o.grow?.[1] ?? 1],
    color: o.color,
    billboard: 'ground',
    rotation: { start: [0, 360], ...(o.spin !== undefined ? { spin: o.spin } : {}) },
    blend: 'add',
    tex: o.tex,
    clamp: 1,
    ...(o.bright !== undefined ? { bright: o.bright } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------- enchanted armour (65 jumagap)






const UMBRAL_PLATE_LOOP: FxSpec = markerSpec({
  id: 'sk.umbral_plate.loop',
  desc: 'Umbral Plate loop (marker, follows the yacha): a thin violet ring standing round the body (jumagap_loop as light, never dark), a ground rim with a faint violet floor glow, thin violet needles drifting down and slow violet wisps rising',
  ref: {},
  dur: 2.4,
  elements: [
    ringBand('floor glow: a faint violet disc of light inside the rim', {
      r0: 0.05, r1: 0.95, life: 2.4, loop: true, scale: [0, 0.97, 0.5, 1, 1, 0.97], clamp: 1, soft: 1, tex: 'glow',
      color: [0, 0x5a2aa8, 0.22, 0.5, 0x7a40d0, 0.34, 1, 0x5a2aa8, 0.22],
    }),
    ringBand('rim: the violet ring breathing on the ground', {
      r0: 0.9, r1: 1.0, life: 2.4, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], clamp: 1, soft: 0.55,
      color: [0, 0x8a50f0, 0.65, 0.5, 0xc0a0ff, 0.95, 1, 0x8a50f0, 0.65],
    }),
    standingCard('umbral ring: the 2-face ring standing round the sura (arcPair), violet light', {
      w: 1.5, h: 1.9, y: 0.95, life: 2.4, tex: 'arcPair',
      color: [0, 0x8a50f0, 0.42, 0.5, 0xb890ff, 0.68, 1, 0x8a50f0, 0.42],
    }),
    {
      kind: 'particle',
      note: 'jumagap needles: thin violet needles drifting down round the body',
      cycle: 1,
      loops: 0,
      max: 10,
      rate: [0, 8],
      life: [0, 0.75],
      shape: { kind: 'ellipse', radius: 0.9, edge: true },
      at: [0, 1.9, 0],
      dir: { y: [0, -100] },
      vel: [0, 0.0095],
      half: [[0, 0.022], [0, 0.17]],
      scale: [0, 1, 1, 0.8],
      color: [0, 0xffffff, 0, 0.2, 0xc8a8ff, 0.75, 1, 0x7a40d0, 0],
      billboard: 'upright',
      attach: true,
      blend: 'add',
      tex: 'streakHard',
      clamp: 1,
      minTier: 1,
    },
    risingMotes('wisps: slow violet smoke lifting off the rim', {
      radius: 0.9, rate: 6, max: 10, life: 1.5, rise: 0.5, half: 0.3, tex: 'wisp', spin: 25, clamp: 1,
      color: [0, 0xb890ff, 0, 0.25, 0x9060e0, 0.36, 1, 0x6a30c8, 0],
    }),
  ],
});

/**
 * Umbral Plate burst (the plate ends and hurls the absorbed pain back, k = burst 3.5 m, 0.6 s): jumagap's black radial burst as violet-black
 * LIGHT. An expanding ring and a second behind it, a ground ray disc, a spray of thin needles flung to the rim, deep-violet haze at the rim and a
 * short flash that stays small so the yacha is never bleached. Authored for k 1 = the burst radius.
 */
const UMBRAL_PLATE_BURST: FxSpec = burstSpec({
  id: 'sk.umbral_plate.burst',
  desc: 'Umbral Plate burst (event, k = burst radius): a violet ring and a second behind it sweep out to the rim, a radial ray disc lies on the ground, thin violet needles are flung out, deep-violet haze rolls at the rim - the plate hurls its pain back (additive, never dark)',
  ref: {},
  dur: 0.6,
  elements: [
    ringBand('shock ring: a violet ring racing out to the burst radius', {
      r0: 0.8, r1: 1.0, life: 0.38, scale: [0, 0.25, 1, 1.04], clamp: 1, soft: 0.6,
      color: [0, 0xe0d0ff, 0.9, 0.4, 0xa070ff, 0.6, 1, 0x6a30c8, 0],
    }),
    ringBand('shock ring B: a thinner ring right behind', {
      t0: 0.08, r0: 0.86, r1: 1.0, life: 0.4, scale: [0, 0.2, 1, 0.92], clamp: 1, soft: 0.6,
      color: [0, 0xc0a0ff, 0.65, 1, 0x7a40d0, 0],
    }),
    groundSprite('ray disc: radial rays of violet light lying on the ground (jumagap black_mine_edge, additive)', {
      half: 1.0, life: 0.34, tex: 'rays', grow: [0.35, 1.0],
      color: [0, 0xc0a0ff, 0.55, 0.5, 0x8a50f0, 0.36, 1, 0x6a30c8, 0],
    }),
    sparkBurst('needles: thin violet needles flung out to the rim', {
      n: 14, at: [0, 0.45, 0], radius: 0.25, speed: 2.4, life: 0.34, length: 0.18, width: 0.035, clamp: 0.9,
      color: [0, 0xd8c0ff, 1, 0.4, 0xb090ff, 0.85, 1, 0x7a40d0, 0],
    }),
    {
      kind: 'particle',
      note: 'ink haze: deep-violet smoke rolling at the rim (additive: reads as purple mist, never as a dark patch)',
      t0: 0.05,
      cycle: 0.1,
      max: 8,
      rate: [0, 400],
      life: [0, 0.5],
      shape: { kind: 'ellipse', radius: 0.72, edge: true },
      at: [0, 0.3, 0],
      dir: { y: [0, 22] },
      vel: [0, 0.01],
      half: [0, 0.34],
      scale: [0, 0.6, 1, 1.5],
      color: [0, 0x7a40d8, 0, 0.2, 0x8a50f0, 0.3, 1, 0x4a1a90, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'add',
      tex: 'smoke2',
      clamp: 1,
      minTier: 1,
    },
    flash('core flash: a small violet-white flash at the middle (small on purpose: the yacha stays readable)', {
      at: [0, 0.8, 0], half: 0.28, life: 0.16, tex: 'glowCore', grow: [0.6, 1.2], clamp: 1,
      color: [0, 0xe8dcff, 0.4, 0.5, 0xb890ff, 0.22, 1, 0x7a40d0, 0],
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------- dark protection (79 heuksin)






const OBSIDIAN_BULWARK_LOOP: FxSpec = markerSpec({
  id: 'sk.obsidian_bulwark.loop',
  desc: 'Obsidian Bulwark loop (marker, follows the yacha): a ~3 m bubble of magenta light breathing round the body (heuksin_loop, no black), two turning smoky arcs, violet mist crawling over the rim, pale bone skulls floating inside and pink glints - the souls the bubble keeps',
  ref: {},
  dur: 2.6,
  elements: [
    ringBand('floor glow: a faint magenta disc of light under the bubble', {
      r0: 0.05, r1: 0.95, life: 2.6, loop: true, scale: [0, 0.97, 0.5, 1, 1, 0.97], clamp: 1, soft: 1, tex: 'glow',
      color: [0, 0x9a3a9a, 0.24, 0.5, 0xd070c0, 0.38, 1, 0x9a3a9a, 0.24],
    }),
    ringBand('rim: the bubble meets the ground in a pink-violet ring', {
      r0: 0.9, r1: 1.0, life: 2.6, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], clamp: 1, soft: 0.55,
      color: [0, 0xb060b8, 0.6, 0.5, 0xf0a0e0, 0.95, 1, 0xb060b8, 0.6],
    }),
    breath('jumagap_in: the magenta glow filling the bubble, breathing', {
      at: [0, 1.0, 0], half: 1.1, period: 2.4, tex: 'glow',
      color: [0, 0xd070c0, 0, 0.3, 0xd070c0, 0.36, 1, 0xd070c0, 0],
    }),
    breath('jumagap_in: the bubble wall as a soft ring of pink light', {
      at: [0, 1.0, 0], half: 1.18, period: 2.8, tex: 'ringInner', scale: [0, 0.96, 0.5, 1, 1, 0.96],
      color: [0, 0xe080d0, 0, 0.3, 0xe080d0, 0.42, 1, 0xe080d0, 0],
    }),
    breath('hueksin shell arcs: two smoky arcs bounding the bubble, turning slowly', {
      at: [0, 1.0, 0], half: 1.2, period: 3.2, tex: 'arcPair', spin: 18,
      color: [0, 0x9a78b8, 0, 0.25, 0xb090d0, 0.5, 0.75, 0xb090d0, 0.5, 1, 0x9a78b8, 0],
    }),
    {
      kind: 'particle',
      note: 'jumagap_loop: violet mist crawling over the bubble wall (additive smoke)',
      cycle: 1,
      loops: 0,
      max: 14,
      rate: [0, 18],
      life: [0, 0.8],
      shape: { kind: 'sphere', radius: 1.0, edge: true },
      at: [0, 1.0, 0],
      half: [0, 0.32],
      scale: [0, 0.7, 1, 1.2],
      color: [0, 0xb090d8, 0, 0.3, 0xa078c0, 0.3, 1, 0x7a58a0, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      swirl: [0, 1.2],
      attach: true,
      blend: 'add',
      tex: 'smoke1',
      clamp: 1,
      minTier: 1,
    },
    {
      kind: 'particle',
      note: '',
      cycle: 1,
      loops: 0,
      max: 5,
      rate: [0, 3.2],
      life: [0, 1.4],
      shape: { kind: 'sphere', radius: 0.7, edge: true },
      at: [0, 0.9, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.0014],
      half: [0, 0.15],
      scale: [0, 0.8, 0.5, 1, 1, 1.1],
      color: [0, 0xe8e4c0, 0, 0.3, 0xf2eed4, 0.7, 0.7, 0xe8e4c0, 0.6, 1, 0xd070c0, 0],
      billboard: 'screen',
      rotation: { start: [-15, 15], spin: 10, randomDir: true },
      attach: true,
      blend: 'add',
      tex: 'skull',
      clamp: 1,
    },
    risingMotes('jumagap_spark: pink glints lifting inside the bubble (the specks, as light)', {
      radius: 0.9, rate: 8, max: 12, life: 0.8, rise: 0.55, half: 0.06, tex: 'sparkle', minTier: 1, spin: 40, clamp: 1,
      color: [0, 0xffffff, 0, 0.2, 0xf8b8ee, 0.85, 1, 0xd070c0, 0],
    }),
  ],
});

/**
 * Obsidian Bulwark burst (the bubble releases the souls it kept, k = burst 4.5 m, 0.6 s): skulls fly out in a ring, pink-violet rings race to the rim, a
 * magenta ground glow and soul wisps follow. Additive only. Authored for k 1 = the burst radius.
 */
const OBSIDIAN_BULWARK_BURST: FxSpec = burstSpec({
  id: 'sk.obsidian_bulwark.burst',
  desc: 'Obsidian Bulwark burst (event, k = burst radius): ten pale skulls fly out in a ring, a pink-violet ring and a second behind it race to the rim, a magenta glow floods the ground and soul wisps trail them - the bubble releases the souls (additive, never dark)',
  ref: {},
  dur: 0.6,
  elements: [
    ringBand('soul ring: a pink-violet ring racing out to the burst radius', {
      r0: 0.82, r1: 1.0, life: 0.42, scale: [0, 0.22, 1, 1.03], clamp: 1, soft: 0.6,
      color: [0, 0xffd0f4, 0.9, 0.4, 0xd070c0, 0.6, 1, 0x8a30a0, 0],
    }),
    ringBand('soul ring B: a violet ring right behind', {
      t0: 0.1, r0: 0.86, r1: 1.0, life: 0.42, scale: [0, 0.2, 1, 0.92], clamp: 1, soft: 0.6,
      color: [0, 0xc0a0ff, 0.6, 1, 0x7a40d0, 0],
    }),
    ringBand('ground glow: magenta light flooding the burst disc', {
      r0: 0.05, r1: 1.0, life: 0.45, scale: [0, 0.4, 1, 1.0], clamp: 1, soft: 1, tex: 'glow',
      color: [0, 0xe080d0, 0.32, 0.4, 0xd070c0, 0.22, 1, 0x8a30a0, 0],
    }),
    {
      kind: 'particle',
      note: '',
      t0: 0.02,
      cycle: 0.1,
      max: 10,
      rate: [0, 1000],
      life: [0, 0.5],
      shape: { kind: 'ellipse', radius: 0.12, edge: true },
      adv: 'outer',
      at: [0, 0.6, 0],
      dir: { y: [0, 22] },
      vel: [0, 0.019],
      half: [0, 0.075],
      scale: [0, 0.7, 0.3, 1, 1, 1.15],
      color: [0, 0xffffff, 0, 0.12, 0xf4f0d8, 0.9, 0.7, 0xe8e4c0, 0.6, 1, 0xd070c0, 0],
      billboard: 'screen',
      rotation: { start: [-20, 20], spin: 50, randomDir: true },
      blend: 'add',
      tex: 'skull',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'soul wisps: magenta smoke trailing the skulls outward',
      t0: 0.04,
      cycle: 0.1,
      max: 8,
      rate: [0, 400],
      life: [0, 0.5],
      shape: { kind: 'ellipse', radius: 0.15, edge: true },
      adv: 'outer',
      at: [0, 0.5, 0],
      vel: [0, 0.011],
      half: [0, 0.2],
      scale: [0, 0.6, 1, 1.4],
      color: [0, 0xe080d0, 0, 0.2, 0xd070c0, 0.3, 1, 0x7a2a90, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 50, randomDir: true },
      blend: 'add',
      tex: 'wisp',
      clamp: 1,
      minTier: 1,
    },
    flash('core flash: a small pink-white flash at the middle (small on purpose)', {
      at: [0, 0.8, 0], half: 0.2, life: 0.16, tex: 'glowCore', grow: [0.6, 1.2], clamp: 1,
      color: [0, 0xfff0fa, 0.4, 0.5, 0xf0a0e0, 0.22, 1, 0xd070c0, 0],
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------- cursed legion

/**
 * Cursed Legion rise (a knight rises where a kill fell, k 3, 1.0 s, BIG so a co-op guest sees it): a violet ring and a ground crack open under the
 * corpse spot, spectral violet-green wisps lift out of it, a few pale skulls float up, a short violet flash pops. The knight body is the tracked
 * `sk.cursed_legion` familiar; this is only the rising. Additive. Authored for k 1 (the sim hands 3).
 */
const CURSED_LEGION_RISE: FxSpec = burstSpec({
  id: 'sk.cursed_legion.rise',
  desc: 'Cursed Legion rise (event, k 3, 1.0 s): a violet ring and a glowing ground crack open where the kill fell, spectral violet-green wisps lift out of it with a few pale skulls and a short violet flash - the fallen warrior stands up as a knight',
  ref: {},
  dur: 1.0,
  elements: [
    groundSprite('crack: a glowing violet-green crack opening in the ground', {
      half: 0.62, life: 1.0, tex: 'crack', grow: [0.5, 1.0],
      color: [0, 0xffffff, 0, 0.1, 0xb890ff, 0.8, 0.5, 0x70ffc0, 0.55, 1, 0x70ffc0, 0],
    }),
    ringBand('summon ring: a violet ring opening under the spot', {
      r0: 0.62, r1: 0.78, life: 0.7, scale: [0, 0.3, 0.45, 1, 1, 1.12], clamp: 1, soft: 0.6,
      color: [0, 0xe0d0ff, 0.9, 0.5, 0x9a60ff, 0.6, 1, 0x6a30c8, 0],
    }),
    ringBand('summon ring B: a green ring half a beat behind', {
      t0: 0.12, r0: 0.5, r1: 0.64, life: 0.7, scale: [0, 0.3, 0.45, 1, 1, 1.1], clamp: 1, soft: 0.6, minTier: 1,
      color: [0, 0xc8ffe8, 0.7, 0.5, 0x70ffc0, 0.45, 1, 0x30c080, 0],
    }),
    risingMotes('wisps: spectral smoke lifting out of the crack', {
      radius: 0.4, rate: 16, max: 14, life: 0.85, rise: 0.7, half: 0.22, tex: 'wisp', spin: 40, clamp: 1, attach: false, loops: 1, y: 0.1,
      color: [0, 0xe0d0ff, 0, 0.2, 0xa880ff, 0.34, 0.6, 0x70ffc0, 0.26, 1, 0x30c080, 0],
    }),
    {
      kind: 'particle',
      note: 'fear skulls: two pale skulls floating up out of the ground',
      t0: 0.12,
      cycle: 0.1,
      max: 2,
      rate: [0, 1000],
      life: [0, 0.8],
      shape: { kind: 'ellipse', radius: 0.18 },
      at: [0, 0.1, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.011],
      half: [0, 0.1],
      scale: [0, 0.8, 0.4, 1, 1, 1.1],
      color: [0, 0xffffff, 0, 0.15, 0xe8e4c0, 0.7, 0.7, 0xe8e4c0, 0.55, 1, 0x9a60ff, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'skull',
      clamp: 1,
      minTier: 1,
    },
    sparkBurst('motes: violet sparks thrown up from the crack', {
      n: 10, at: [0, 0.1, 0], radius: 0.3, speed: 1.0, life: 0.6, length: 0.08, width: 0.08, tex: 'sparkle', billboard: 'screen', gravity: 0.8, clamp: 1, minTier: 1,
      dir: { y: [0, 90] },
      color: [0, 0xffffff, 0, 0.15, 0xd8c0ff, 0.9, 1, 0x9a60ff, 0],
    }),
    flash('pop: a short violet flash as the knight stands', {
      t0: 0.08, at: [0, 0.5, 0], half: 0.34, life: 0.2, tex: 'glowCore', grow: [0.6, 1.3], clamp: 1,
      color: [0, 0xe8dcff, 0.5, 0.5, 0xb890ff, 0.28, 1, 0x7a40d0, 0],
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------- dark covenant

/**
 * Dark Covenant pay (the blood price, k 2, 0.5 s, at the yacha): a crimson seal flashes on the ground under him, a ring rings out, drops of blood fall
 * from the chest into it and a small crimson flash marks the cut. Red drop-and-seal, additive crimson (the existing cast `sk.dark_covenant` is the
 * pact itself).
 */
const DARK_COVENANT_PAY: FxSpec = burstSpec({
  id: 'sk.dark_covenant.pay',
  desc: 'Dark Covenant pay (event, k 2, 0.5 s): a crimson seal flashes on the ground under the yacha, a ring rings out of it and drops of blood fall from his chest into it - the blood price of the pact (additive crimson)',
  ref: {},
  dur: 0.5,
  elements: [
    groundSprite('seal: a crimson rune circle flashing on the ground (fix round 2: 1.2 m across at k 2)', {
      half: 0.6, life: 0.5, tex: 'runeCircle', grow: [0.7, 1.05],
      color: [0, 0xff8090, 0, 0.12, 0xff3048, 1, 0.6, 0xe02040, 0.7, 1, 0xa01020, 0],
    }),
    ringBand('ring: a crimson ring ringing out of the seal', {
      r0: 0.75, r1: 1.0, life: 0.4, scale: [0, 0.4, 1, 1.15], clamp: 1, soft: 0.6,
      color: [0, 0xffa0b0, 0.8, 0.5, 0xff3048, 0.5, 1, 0xa01020, 0],
    }),
    {
      kind: 'particle',
      note: 'drops: drops of blood falling from the chest into the seal (fix round 2: twice the size, eight of them, so they read at zoom 22)',
      cycle: 0.1,
      max: 8,
      rate: [0, 100],
      life: [0, 0.4],
      shape: { kind: 'ellipse', radius: 0.3 },
      at: [0, 1.05, 0],
      gravity: [0, 6],
      half: [0, 0.13],
      scale: [0, 0.8, 1, 0.9],
      color: [0, 0xffa0a8, 0.9, 0.5, 0xff3048, 0.85, 1, 0xa01020, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'drop',
      clamp: 1,
    },
    flash('cut: a small crimson flash at the chest (fix round 2: dimmer, the hero was 12 % pale)', {
      at: [0, 1.0, 0], half: 0.22, life: 0.16, tex: 'glowCore', grow: [0.6, 1.2], clamp: 0.6,
      color: [0, 0xffa0b0, 0.3, 0.5, 0xff5068, 0.18, 1, 0xa01020, 0],
    }),
    {
      kind: 'particle',
      note: 'alpha drops: the same drops in a mid crimson that draws its own colour, so they hold on snow (alpha, luma 0.42: pull ~0)',
      cycle: 0.1,
      max: 8,
      rate: [0, 100],
      life: [0, 0.4],
      shape: { kind: 'ellipse', radius: 0.3 },
      at: [0, 1.05, 0],
      gravity: [0, 6],
      half: [0, 0.11],
      scale: [0, 0.8, 1, 0.9],
      color: [0, 0xf0586c, 0.8, 0.5, 0xf0586c, 0.75, 1, 0xf0586c, 0],
      billboard: 'screen',
      blend: 'alpha',
      tex: 'drop',
    },
  ],
});

// ---------------------------------------------------------------------------------------------------------------- dispel (not emitted yet)

/**
 * Dispel purge (a hostile bolt dissolves in the sigil / a corruption glow pops, k 1, 0.3 s): pale violet-white motes and one small ring. NOT EMITTED by the
 * sim yet (sim/skills/zones.ts purges rows and the corruption stamp silently); the look is ready for the day it is.
 */
const DISPEL_PURGE: FxSpec = burstSpec({
  id: 'sk.unbinding_sigil.purge',
  desc: 'Dispel purge (event, k 1, 0.3 s): pale violet-white motes scatter and one small ring puffs where an enemy bolt dissolves or a corruption glow is stripped',
  ref: {},
  dur: 0.3,
  elements: [
    ringBand('puff: a small pale ring', {
      r0: 0.7, r1: 1.0, life: 0.26, scale: [0, 0.3, 1, 0.9], clamp: 1, soft: 0.6, y: 0.5,
      color: [0, 0xf0e4ff, 0.7, 1, 0xb890ff, 0],
    }),
    groundSprite('glyph: a violet-white unbinding rune popping on the ground under the stripped creature (fix round 2: the purge had no look in game)', {
      half: 0.55, life: 0.3, tex: 'runeCircle', grow: [0.6, 1.1], spin: -120,
      color: [0, 0xffffff, 0, 0.15, 0xe8dcff, 0.9, 0.6, 0xb890ff, 0.5, 1, 0x8a60e0, 0],
    }),
    {
      kind: 'particle',
      note: 'sucked glow: orange corruption motes drawn UP off the creature and fading violet',
      cycle: 0.3,
      max: 8,
      rate: [0, 40],
      life: [0, 0.3],
      shape: { kind: 'ellipse', radius: 0.35 },
      at: [0, 0.1, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.012],
      half: [0, 0.07],
      scale: [0, 1, 1, 0.5],
      color: [0, 0xffa050, 0, 0.15, 0xff9040, 0.9, 0.7, 0xd080c0, 0.6, 1, 0xb890ff, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'ember',
      clamp: 1,
    },
    sparkBurst('motes: pale motes scatter', {
      n: 8, at: [0, 0.5, 0], radius: 0.1, speed: 0.9, life: 0.3, length: 0.07, width: 0.07, tex: 'sparkle', billboard: 'screen', clamp: 1,
      color: [0, 0xffffff, 0.9, 0.5, 0xe0d0ff, 0.6, 1, 0xb890ff, 0],
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------- flame spirit (78 muyeong)






const BLAZE_FAMILIARS_CAST: FxSpec = {
  id: 'sk.blaze_familiars.cast',
  desc: 'Blaze Familiars cast: a yellow-orange fireball with a soft halo forms in the raised left hand and brightens (white-hot and bigger at P), then is flung forward as a hot ball trailing curling flames - the spirit is summoned',
  behavior: 'skyStrike',
  ref: {},
  size: 'radius',
  base: 1.5,
  dur: 0.95,
  gradeScale: [1, 1.1, 1.25, 1.5],
  clamp: 1.2,
  moment: true,
  elements: [
    {
      kind: 'particle',
      note: 'muyeong_make fireball: the hand orb forming, brightening, flung at 0.62 s',
      cycle: 0.8,
      max: 2,
      rate: [0, 30],
      life: [0, 0.18],
      at: [0, 0.04, 0],
      half: [0, 0.07, 0.6, 0.2],
      scale: [0, 0.85, 0.5, 1, 1, 0.9],
      color: [0, 0xffe0a0, 0.9, 0.5, 0xffc050, 1, 1, 0xff9030, 0.9],
      billboard: 'screen',
      attach: 'hand_l',
      blend: 'add',
      bright: 1.1,
      tex: 'glowCore',
    },
    {
      kind: 'particle',
      note: 'mine_edge halo: a soft pink-orange halo round the orb',
      cycle: 0.8,
      max: 2,
      rate: [0, 10],
      life: [0, 0.3],
      at: [0, 0.04, 0],
      half: [0, 0.14, 0.6, 0.34],
      scale: [0, 0.9, 1, 1.1],
      color: [0, 0xfeb4b4, 0.3, 0.6, 0xfa7c4c, 0.45, 1, 0xfa7c4c, 0],
      billboard: 'screen',
      rotation: { start: [0, 360] },
      attach: 'hand_l',
      blend: 'add',
      tex: 'raysSoft',
    },
    {
      kind: 'particle',
      note: 'muyeong_make fireburn: curling flames shed off the conjured orb',
      cycle: 0.8,
      max: 10,
      rate: [0, 40],
      life: [0, 0.3],
      shape: { kind: 'sphere', radius: 0.05 },
      at: [0, 0.05, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.004],
      half: [0, 0.12],
      scale: [0, 1, 1, 0.4],
      color: [0, 0xffd070, 0.9, 0.4, 0xff7020, 0.85, 1, 0x902010, 0],
      billboard: 'screen',
      from: 'hand_l',
      blend: 'add',
      tex: 'flameFB',
      frames: { fps: 0, random: true },
    },
    {
      kind: 'particle',
      note: 'release: at 0.62 s the ball is flung forward-down, a hot orange ball with a ribbon of flames behind it',
      t0: 0.62,
      cycle: 0.3,
      max: 12,
      rate: [0, 60],
      life: [0, 0.28],
      shape: { kind: 'sphere', radius: 0.04 },
      at: [0, 0.04, 0],
      dir: { z: [0, 100], y: [0, -25] },
      vel: [0, 0.03],
      half: [0, 0.2],
      scale: [0, 1, 1, 0.3],
      color: [0, 0xfff0b0, 0.9, 0.4, 0xff9030, 0.85, 1, 0xff4010, 0],
      billboard: 'screen',
      from: 'hand_l',
      blend: 'add',
      tex: 'flameFB',
      frames: { fps: 0, random: true },
    },
    {
      kind: 'particle',
      note: 'release streak: the thrown ball as a short comet',
      t0: 0.62,
      cycle: 0.2,
      max: 3,
      rate: [0, 40],
      life: [0, 0.16],
      at: [0, 0.04, 0],
      dir: { z: [0, 100], y: [0, -25] },
      vel: [0, 0.03],
      half: [[0, 0.1], [0, 0.45]],
      scale: [0, 1, 1, 0.4],
      color: [0, 0xfff0b0, 0.9, 0.5, 0xffa040, 0.8, 1, 0xff5010, 0],
      billboard: 'stretch',
      from: 'hand_l',
      blend: 'add',
      tex: 'streakSoft',
    },
    {
      kind: 'particle',
      note: 'embers: a few sparks rising off the hand',
      cycle: 0.8,
      max: 8,
      rate: [0, 12],
      life: [0, 0.5],
      shape: { kind: 'sphere', radius: 0.12 },
      at: [0, 0.04, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.006],
      half: [0, 0.035],
      scale: [0, 1, 1, 0.3],
      color: [0, 0xffd080, 1, 1, 0xff5010, 0],
      from: 'hand_l',
      billboard: 'screen',
      blend: 'add',
      tex: 'ember',
      minTier: 1,
    },
  ],
};








const BLAZE_FAMILIARS_EXPLODE: FxSpec = {
  id: 'sk.blaze_familiars.explode',
  desc: 'Blaze Familiars twin impact: a white-yellow flash, six to eight long golden-amber feather streaks fanning out with orange spark lines, a flat pale-yellow ground disc, a few fire tongues and falling embers, gone in half a second',
  behavior: 'skyStrike',
  ref: {},
  size: 'radius',
  base: 1.5,
  dur: 0.5,
  clamp: 1.2,
  moment: true,
  elements: [
    {
      kind: 'particle',
      note: 'muyeong_red flash: the white-yellow flash on the target',
      cycle: 0.2,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.2],
      at: [0, 0.6, 0],
      half: [0, 0.55],
      scale: [0, 0.5, 0.3, 1, 1, 1.15],
      color: [0, 0xffffff, 0.85, 0.4, 0xfff4b0, 0.6, 1, 0xffb040, 0],
      billboard: 'screen',
      blend: 'add',
      bright: 1.15,
      tex: 'glowCore',
    },
    {
      kind: 'particle',
      note: 'feather streaks: seven long thin golden-amber petals fanning out (the loud part, ~0.16 s)',
      cycle: 0.1,
      max: 7,
      rate: [0, 1000],
      life: [0, 0.22],
      shape: { kind: 'sphere', radius: 0.06 },
      adv: 'outer',
      at: [0, 0.6, 0],
      dir: { y: [0, 25] },
      vel: [0, 0.055],
      half: [[0, 0.1], [0, 0.6]],
      scale: [0, 0.8, 0.3, 1, 1, 0.5],
      color: [0, 0xfff0b8, 1, 0.4, 0xf3b943, 0.9, 1, 0xe6902a, 0],
      billboard: 'stretch',
      blend: 'add',
      tex: 'streakSoft',
    },
    sparkBurst('spark lines: thin orange spark lines between the petals', {
      n: 14, at: [0, 0.6, 0], radius: 0.08, speed: 6.5, life: 0.24, length: 0.4, width: 0.022, clamp: 1,
      color: [0, 0xffe0a0, 1, 0.5, 0xff7a20, 0.8, 1, 0xff5010, 0],
    }),
    {
      kind: 'particle',
      note: 'ground disc: the flat pale-yellow, radially streaked disc under the target (0.58 s of the reference)',
      t0: 0.04,
      cycle: 0.4,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.36],
      at: [0, 0.06, 0],
      half: [0, 1.15],
      scale: [0, 0.4, 0.5, 1, 1, 1.05],
      color: [0, 0xf4e8a0, 0.55, 0.5, 0xe9d98a, 0.38, 1, 0xe9a050, 0],
      billboard: 'ground',
      rotation: { start: [0, 360] },
      blend: 'add',
      tex: 'rays',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'fire tongues: orange flames licking up on the target',
      t0: 0.1,
      cycle: 0.1,
      max: 5,
      rate: [0, 400],
      life: [0, 0.32],
      shape: { kind: 'ellipse', radius: 0.3 },
      at: [0, 0.2, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.006],
      half: [0, 0.38],
      scale: [0, 0.7, 0.4, 1, 1, 0.6],
      color: [0, 0xffd070, 0.9, 0.4, 0xff7020, 0.85, 1, 0x902010, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'flameFB',
      frames: { fps: 0, random: true },
      minTier: 1,
    },
    sparkBurst('embers: orange embers falling around the target', {
      t0: 0.12, n: 10, at: [0, 0.5, 0], radius: 0.4, speed: 1.4, life: 0.4, length: 0.05, width: 0.05, tex: 'ember', billboard: 'screen', gravity: 3, minTier: 1,
      color: [0, 0xffd080, 1, 1, 0xff5010, 0],
    }),
  ],
};

export const YACHA_MOMENT_SPECS: FxSpec[] = [
  UMBRAL_PLATE_LOOP,
  UMBRAL_PLATE_BURST,
  OBSIDIAN_BULWARK_LOOP,
  OBSIDIAN_BULWARK_BURST,
  CURSED_LEGION_RISE,
  DARK_COVENANT_PAY,
  DISPEL_PURGE,
  BLAZE_FAMILIARS_CAST,
  BLAZE_FAMILIARS_EXPLODE,
];

/** the ids above (README / tests): every one is registered `moment: true` */
export const YACHA_MOMENT_IDS: readonly string[] = YACHA_MOMENT_SPECS.map((s) => s.id);
