
// Contracts (momentKit.ts): a marker row = tracked `summon`, k = the row radius, base 1 m; an event = `selfBuff`, k = the sim's scale in metres.
// Every element is authored for k = 1: `at` (height too), sizes, paths and speeds all scale with k, gravity does not. The marker / event looks are

// k = 1; sparkBurst / risingMotes take m/s and divide by 100 themselves).
//
//   id                    kind    sim call                                                       k / duration                       look

//   sk.nightshroud.decoy      marker  shell.ts castVeil: spawnMarker(.., 1.2, veil, follow = false)    1.2, STATIONARY at the cast point  violet afterimage of the ninja over a faint ring
//   sk.nightshroud.burst      event   shell.ts decoyBurst: vfx(.., max(1, area), 0.6 s) at the decoy   3, 0.6 s                          violet petal / claw ring
//   sk.eagle_eye.mark     event   behaviors/selfBuff.ts markFoes: per marked foe, 1 + radius       ~1.4..4, 0.6 s, no dir             golden eagle sigil closing in on the foe
//
// The veil look itself is the shared `sk.gen.veil_ring` (common/moments.ts), the dodge hop the shared `sk.gen.dodge_hop`.
// HERO RULE (user 2026-10-26): nothing here darkens the hero. Every element is ADDITIVE (cannot darken), no `occlude`, bright stacks carry
// `clamp`; the decoy is a luminous mid-violet afterimage, never a dark body. The engine hero guard fades what sits on the hero.
import type { FxSpec, ParticleSpec } from '../../spec/types';
import { alphaRing, burstSpec, flash, markerSpec, novaRing, ringBand, risingMotes, sparkBurst } from '../common/momentKit';

// ------------------------------------------------------------------------------------------------------------------ swallows_gait.loop


const FW = 0.75;







const SWALLOWS_GAIT_LOOP: FxSpec = markerSpec({
  id: 'sk.swallows_gait.loop',
  desc: '',
  ref: {},
  dur: 3,
  elements: [
    {
      kind: 'particle',
      note: '',
      cycle: 0.5,
      loops: 0,
      max: 3,
      rate: [0, 6],
      life: [0, 0.6],
      at: [0, 0.04 * FW, 0],
      half: [0, 0.8 * FW],
      scale: [0, 0.8, 0.4, 1, 1, 0.9],
      color: [0, 0x7d8fff, 0, 0.3, 0x7d8fff, 0.4, 1, 0x4d58fa, 0],
      bright: 1.4,
      clamp: 0.6,
      billboard: 'ground',
      attach: true,
      blend: 'add',
      tex: 'glowCore',
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.5,
      loops: 0,
      max: 6,
      rate: [0, 12],
      life: [0, 0.4],
      at: [0, 0.05 * FW, 0],
      half: [0, 0.75 * FW],
      scale: [0, 0.8, 1, 1.05],
      color: [0, 0xe6eaff, 0, 0.25, 0x7d8fff, 1, 1, 0x4d58fa, 0],
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -420 },
      attach: true,
      blend: 'add',
      bright: 2.8,
      clamp: 1.2,
      tex: 'crescent',
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.5,
      loops: 0,
      max: 3,
      rate: [0, 6],
      life: [0, 0.5],
      at: [0, 0.05 * FW, 0],
      half: [0, 0.8 * FW],
      scale: [0, 0.9, 1, 1.1],
      color: [0, 0xdfe4ff, 0, 0.3, 0x7d8fff, 1, 1, 0x4d58fa, 0],
      bright: 1.8,
      clamp: 1.2,
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -300 },
      attach: true,
      blend: 'add',
      tex: 'smear',
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.5,
      loops: 0,
      max: 10,
      rate: [0, 18],
      life: [0, 0.4639],
      at: [0, 0.1 * FW, 0],
      shape: { kind: 'box', box: [0.9 * FW, 0, 0.9 * FW] },
      dir: { y: [0, 6] },
      vel: [0.003, 0.08],
      half: [0, 0.64 * FW],
      scale: [0, 0.25, 1, 0.08],
      color: [0, 0xffffff, 1, 0.58, 0x8fa6ff, 0.6, 1, 0x5678ff, 0],
      gravity: [0, 1.5],
      billboard: 'screen',
      rotation: { start: [0, 360] },
      blend: 'add',
      tex: 'sparkle',
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.5,
      loops: 0,
      max: 6,
      rate: [0, 10],
      life: [0, 0.3351],
      at: [0, 0.15 * FW, 0],
      shape: { kind: 'box', box: [0.7 * FW, 0, 0.7 * FW] },
      dir: { y: [0, 6] },
      vel: [0, 0.06],
      half: [0, 0.25 * FW],
      scale: [0, 0.8, 1, 1.2],
      color: [0, 0xffffff, 0, 0.18, 0xc3c6ff, 0.5, 1, 0x1e28ff, 0],
      air: [0, 0.0825],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      tex: 'wisp',
      minTier: 1,
    },
    alphaRing('alpha twin: a blue-violet ring round the wind disc so the loop holds on snow (the pale disc bleached the shins there)', {
      r0: 0.5, r1: 0.7, life: 2, loop: true, scale: [0, 0.98, 0.5, 1.03, 1, 0.98], soft: 0.5, y: 0.03,
      color: [0, 0x7d8fff, 0.5, 0.5, 0x7d8fff, 0.68, 1, 0x7d8fff, 0.5],
    }),
  ],
});


const SWALLOWS_GAIT_NOVA: FxSpec = novaRing({
  id: 'sk.swallows_gait.nova',
  desc: "Swallow's Gait gust (event, k = the 3 m nova): a thin pink-violet ring racing out over the ground with an alpha twin and a few wind streaks - the gust that shoves the pack, no big white double ring",
  ref: {},
  main: 0xff80d0,
  pale: 0xffe0f4,
  deep: 0xd070b0,
  sparks: 10,
});

// ------------------------------------------------------------------------------------------------------------------ stealth.decoy

/** nominal k of the decoy marker (1.2) */
const KD = 1.2;

/** one flickering upright glow of the afterimage; two of them, half a period apart, so the pulse never leaves a gap */
const decoyBody = (t0: number): ParticleSpec => ({
  kind: 'particle',
  note: `afterimage body (${t0 === 0 ? 'A' : 'B'}): a tall luminous mid-violet glow flickering like a double that has not caught up (additive: it cannot darken)`,
  t0,
  cycle: 1.4,
  loops: 0,
  max: 1,
  rate: [0, 10],
  life: [0, 1.4],
  at: [0, 0.95 / KD, 0],
  half: [[0, 0.36 / KD], [0, 1.0 / KD]],
  scale: [0, 0.97, 0.5, 1.03, 1, 0.97],
  color: [0, 0x7a60dc, 0, 0.15, 0x8a70ec, 0.4, 0.5, 0x7a60dc, 0.26, 0.85, 0x8a70ec, 0.38, 1, 0x7a60dc, 0],
  billboard: 'upright',
  attach: true,
  blend: 'add',
  tex: 'glow',
  bright: 1.3,
  clamp: 1,
});

/**
 * stealth.decoy: the shadow double the ninja leaves where he vanished (the sim keeps it STATIONARY at the cast point for the veil; the creatures
 * within 6 m walk to it). A tall translucent mid-violet afterimage (a luminous glow plus a head glow, flickering), smoke curling at its feet, a
 * faint ring on the ground, lilac wisps and pink streaks rising through it: unmistakably "something that is not quite the ninja", never dark.
 */
const STEALTH_DECOY: FxSpec = markerSpec({
  id: 'sk.nightshroud.decoy',
  desc: 'Stealth decoy (marker, stationary at the cast point): a tall translucent mid-violet afterimage flickering over a faint violet ring, a head glow, smoke curling at its feet, lilac wisps and pink streaks rising through it - the double the horde runs to, never dark',
  ref: {},
  dur: 1.4,
  elements: [
    decoyBody(0),
    decoyBody(0.7),
    {
      kind: 'particle',
      note: 'head glow: a rounder lighter violet glow where the head would be',
      cycle: 1.4,
      loops: 0,
      max: 1,
      rate: [0, 10],
      life: [0, 1.4],
      at: [0, 1.65 / KD, 0],
      half: [0, 0.22 / KD],
      scale: [0, 0.95, 0.5, 1.08, 1, 0.95],
      color: [0, 0xb8a0ff, 0, 0.2, 0xc8b4ff, 0.34, 0.8, 0xb098ff, 0.26, 1, 0xb098ff, 0],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      tex: 'glow',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'feet smoke: lilac cloud turning slowly at the feet',
      cycle: 1.6,
      loops: 0,
      max: 2,
      rate: [0, 4],
      life: [0, 1.6],
      at: [0, 0.25 / KD, 0],
      half: [0, 0.8 / KD],
      scale: [0, 0.8, 1, 1.25],
      color: [0, 0xa890ff, 0, 0.25, 0xa890ff, 0.28, 1, 0x7a60dc, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 18, randomDir: true },
      attach: true,
      blend: 'add',
      tex: 'cloud',
      bright: 1.6,
      clamp: 1,
    },
    ringBand('bait rim: a faint violet ring on the ground under the double', {
      r0: 0.82, r1: 1.0, life: 2.4, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], clamp: 1, soft: 0.6, y: 0.05 / KD,
      color: [0, 0x8a6cf0, 0.22, 0.5, 0xa088ff, 0.36, 1, 0x8a6cf0, 0.22],
    }),
    risingMotes('wisps: lilac smoke curling up through the double', {
      radius: 0.3, rate: 5, max: 8, life: 1.4, rise: 0.5, half: 0.26 / KD, tex: 'wisp', spin: 22, clamp: 1, y: 0.2 / KD, minTier: 1,
      color: [0, 0xe0d8ff, 0, 0.25, 0xd4c8ff, 0.3, 1, 0xb8a8f0, 0],
    }),
    {
      kind: 'particle',
      note: 'pink streaks rising through the body (the shadow clone language)',
      cycle: 0.5,
      loops: 0,
      max: 4,
      rate: [0, 8],
      life: [0, 0.5],
      shape: { kind: 'ellipse', radius: 0.3 },
      at: [0, 0.3 / KD, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.012],
      half: [[0, 0.025], [0, 0.18]],
      scale: [0, 0.8, 0.3, 1.1, 1, 0.8],
      color: [0, 0xffffff, 0.6, 0.3, 0xff9ae8, 0.6, 1, 0xa901ff, 0],
      billboard: 'stretch',
      attach: true,
      blend: 'add',
      tex: 'glow',
      clamp: 1,
      minTier: 1,
    },
  ],
});

// ------------------------------------------------------------------------------------------------------------------ stealth.burst

/** nominal k of the decoy burst (the skill's 3 m area) */
const KB = 3;

/**
 * stealth.burst: the decoy pops where the ninja vanished (k = max(1, area) = 3, 0.6 s, BIG enough for a guest). A violet-pink ring snaps out over
 * the ground, lilac petals are flung outward spinning, claw rips scatter along the floor, three bright crescent arcs sweep round, a soft violet
 * flash and a few wisps close it.
 */
const STEALTH_BURST: FxSpec = burstSpec({
  id: 'sk.nightshroud.burst',
  desc: 'Stealth burst (event at the decoy, k = the 3 m area): a violet-pink ring snapping out over the ground, lilac petals flung outward, claw rips scattered over the floor, three bright crescent arcs sweeping round, a soft violet flash and wisps',
  ref: {},
  dur: 0.7,
  elements: [
    ringBand('snap ring: a violet-pink ring expanding over the ground', {
      r0: 0.82, r1: 1.0, life: 0.45, scale: [0, 0.12, 0.35, 0.75, 1, 1.0], clamp: 1, soft: 0.5, y: 0.08 / KB,
      color: [0, 0xffe0ff, 0.9, 0.45, 0xd8a8ff, 0.55, 1, 0x8a6cff, 0],
    }),
    ringBand('second ring: a thinner pink ring behind it', {
      t0: 0.07, r0: 0.86, r1: 1.0, life: 0.45, scale: [0, 0.1, 0.4, 0.7, 1, 0.92], clamp: 1, soft: 0.6, y: 0.1 / KB,
      color: [0, 0xff9ae8, 0.7, 1, 0xc070ff, 0],
    }),
    ...[0, 120, 240].map((a0, i) =>
      ringBand(`crescent arc ${i + 1}: a bright arc sweeping out and round`, {
        t0: 0.03 + i * 0.03, r0: 0.7, r1: 0.9, life: 0.4, span: 56, a0, softU: 0.4, scale: [0, 0.25, 0.4, 0.75, 1, 1.0], spin: [0, 0, 1, 100], clamp: 1, soft: 0.6, y: 0.12 / KB,
        color: [0, 0xffffff, 0.9, 0.5, 0xffc8f4, 0.5, 1, 0xa070ff, 0],
      }),
    ),
    {
      kind: 'particle',
      note: 'petal role: lilac petals flung outward from the decoy, spinning',
      cycle: 0.1,
      max: 14,
      rate: [0, 1000],
      life: [0, 0.6],
      shape: { kind: 'sphere', radius: 0.1 },
      adv: 'outer',
      at: [0, 0.5 / KB, 0],
      dir: { y: [0, 30] },
      vel: [0, 0.011],
      half: [0, 0.1],
      scale: [0, 0.8, 0.3, 1, 1, 0.5],
      color: [0, 0xffd0ff, 0.9, 0.5, 0xc89aff, 0.75, 1, 0x8a6cff, 0],
      gravity: [0, 1],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 320, randomDir: true },
      blend: 'add',
      tex: 'petal',
      clamp: 1,
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'claw role (lie): claw rips scattered along the floor, white-pink fading violet',
      t0: 0.03,
      cycle: 0.1,
      max: 7,
      rate: [0, 1000],
      life: [0, 0.4],
      shape: { kind: 'ellipse', radius: 0.35, edge: true },
      adv: 'outer',
      at: [0, 0.1 / KB, 0],
      vel: [0, 0.006],
      half: [0, 0.13],
      scale: [0, 0.5, 0.3, 1, 1, 1.1],
      color: [0, 0xffffff, 0.9, 0.4, 0xffb8f0, 0.6, 1, 0x9a6cff, 0],
      billboard: 'ground',
      rotation: { start: [0, 360] },
      blend: 'add',
      tex: 'claw',
      clamp: 1,
    } satisfies ParticleSpec,
    flash('flash: a soft violet flash above the decoy spot', {
      at: [0, 0.7 / KB, 0], half: 0.3, life: 0.2, tex: 'glowCore', grow: [0.6, 1.2], clamp: 1,
      color: [0, 0xffe8ff, 0.5, 0.5, 0xd0a8ff, 0.25, 1, 0x8a6cff, 0],
    }),
    risingMotes('wisps: lilac smoke curling up from the spot', {
      radius: 0.5, rate: 24, max: 8, life: 0.55, rise: 0.4, half: 0.11, tex: 'wisp', spin: 40, clamp: 1, y: 0.2 / KB, attach: false, loops: 1, minTier: 1,
      color: [0, 0xe0d8ff, 0, 0.25, 0xd4c8ff, 0.3, 1, 0xb8a8f0, 0],
    }),
  ],
});

// ------------------------------------------------------------------------------------------------------------------ eagle_eye.mark

/** nominal k of a mark: 1 + the radius of a typical elite (0.8) */
const KE = 1.8;

/**
 * eagle_eye.mark: the hunter's mark drops on a branded creature (one event per marked foe, k = 1 + its radius, 0.6 s). A gold rune sigil closes
 * in from a wide faint circle and settles flat around the foe, two golden wing brackets spread beside it, a four-point flash and a ring mark the landing, gold
 * sparks leap. The weaken status loop of the engine shows the mark while it lasts; this is the moment it is put on.
 */
const EAGLE_EYE_MARK: FxSpec = burstSpec({
  id: 'sk.eagle_eye.mark',
  desc: 'Eagle Eye mark (event on each branded creature, k = 1 + its radius): a gold rune sigil closing in and settling flat around the foe, two golden wing brackets spreading beside it, a four-point flash and a ring on the landing, gold sparks',
  ref: { family: 'original (ninja eagle_eye): gold-lime hunter palette of the archer channels (46 repetitive shot g3) with the rune circle and wing-arc vocabulary', notes: 'sim: selfBuff markFoes, one vfx per branded foe, scale = 1 + foe radius, 0.6 s, no dir; additive gold only' },
  dur: 0.6,
  elements: [
    {
      kind: 'particle',
      note: 'runeCircle role (lie): the sigil closing in on the foe from a wide faint circle and settling flat on the ground, turning (a particle keeps its birth position, so the drop is a shrink, not a path)',
      cycle: 0.6,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.6],
      at: [0, 0.05 / KE, 0],
      half: [0, 1.0 / KE],
      scale: [0, 2.1, 0.4, 1, 1, 0.95],
      color: [0, 0xffc030, 0, 0.15, 0xffd040, 0.9, 0.7, 0xffc030, 0.65, 1, 0xd8a020, 0],
      billboard: 'ground',
      rotation: { start: [0, 360], spin: 140 },
      attach: true,
      blend: 'add',
      bright: 1.1,
      clamp: 0.9,
      tex: 'runeCircle',
    } satisfies ParticleSpec,
    ringBand('landing ring: a gold ring spreading from the sigil as it lands', {
      t0: 0.24, r0: 0.78, r1: 1.0, life: 0.3, scale: [0, 0.6, 1, 1.5], clamp: 1, soft: 0.5, y: 0.08 / KE,
      color: [0, 0xffffff, 0.9, 0.5, 0xffe08a, 0.5, 1, 0xffc850, 0],
    }),
    {
      kind: 'particle',
      note: 'arcPair role (upright): two golden wing brackets spreading beside the foe',
      t0: 0.22,
      cycle: 0.4,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.38],
      at: [0, 0.8 / KE, 0],
      half: [0, 0.8 / KE],
      scale: [0, 0.6, 0.3, 1.1, 1, 1.35],
      color: [0, 0xfff0b8, 0, 0.2, 0xffe08a, 0.85, 1, 0xffc850, 0],
      billboard: 'upright',
      attach: true,
      blend: 'add',
      bright: 1.3,
      clamp: 1,
      tex: 'arcPair',
    } satisfies ParticleSpec,
    flash('landing flash: a four-point star on the foe', {
      t0: 0.24, at: [0, 0.9 / KE, 0], half: 0.3, life: 0.26, tex: 'flare4', grow: [0.5, 1.3], clamp: 1, spin: 60,
      color: [0, 0xffffff, 0.9, 0.5, 0xfff0b8, 0.55, 1, 0xffd060, 0],
    }),
    sparkBurst('sparks: gold streaks leaping off the landing', {
      t0: 0.24, n: 10, at: [0, 0.6 / KE, 0], radius: 0.3, speed: 1.4, life: 0.32, length: 0.1, width: 0.018, gravity: 3, clamp: 1, dir: { y: [0, 60] },
      color: [0, 0xffffff, 1, 0.5, 0xffe08a, 0.8, 1, 0xffc040, 0],
    }),
  ],
});

// ------------------------------------------------------------------------------------------------------------------ eagle_eye.brand

/**
 * eagle_eye.brand: the PERSISTENT brand. The stamp above lasted 0.4 s, so nobody could see the 3 branded foes during the 9 s weaken (vfx critic: the payoff of the
 * ultimate). The sim re-emits this over every marked foe that still lives every 0.9 s for 1.0 s (selfBuff.brandFoes; the 0.1 s overlap is a fade-in / fade-out pair, so it
 * never blinks): a small gold eagle sigil (two wing arcs + a bright core, a 0.5 m billboard) hovering over the foe, a gold ring on the ground under it, both with an alpha
 * twin in a deep gold so the brand reads on snow. k = 1 + the foe radius (nominal KE).
 */
const EAGLE_EYE_BRAND: FxSpec = burstSpec({
  id: 'sk.eagle_eye.brand',
  desc: 'Eagle Eye brand (event re-emitted over each branded creature while the weaken lasts, k = 1 + its radius, 1 s with seamless overlap): a small gold eagle sigil - two wing arcs and a bright core - hovering over the foe with an alpha twin for snow, and a gold ring under its feet',
  ref: { family: 'original (ninja eagle_eye): gold hunter palette of the archer channels with the rune circle and wing-arc vocabulary', notes: 'sim: selfBuff.brandFoes, one vfx per live branded foe every 0.9 s, scale = 1 + radius, 1.0 s; the drop stamp is sk.eagle_eye.mark' },
  dur: 1,
  elements: [
    {
      kind: 'particle',
      note: 'arcPair role (upright): the two wing arcs of the eagle sigil hovering over the foe, gently breathing',
      cycle: 1,
      max: 1,
      rate: [0, 1000],
      life: [0, 1],
      at: [0, 1.75 / KE, 0],
      half: [0, (0.34 / KE) * 1.8],
      scale: [0, 0.9, 0.1, 1, 0.5, 1.08, 0.9, 1, 1, 0.9],
      color: [0, 0xffd040, 0, 0.1, 0xffd040, 0.95, 0.9, 0xffc030, 0.95, 1, 0xffc030, 0],
      billboard: 'upright',
      attach: true,
      blend: 'add',
      bright: 1.2,
      clamp: 0.9,
      tex: 'arcPair',
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'glowCore role: the bright eye of the eagle, a small gold core between the wings',
      cycle: 1,
      max: 1,
      rate: [0, 1000],
      life: [0, 1],
      at: [0, 1.75 / KE, 0],
      half: [0, (0.14 / KE) * 1.8],
      scale: [0, 0.9, 0.5, 1.2, 1, 0.9],
      color: [0, 0xfff0a0, 0, 0.1, 0xfff0a0, 1, 0.9, 0xffe070, 1, 1, 0xffe070, 0],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      clamp: 0.9,
      tex: 'glowCore',
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'alpha twin of the sigil: a deep gold disc behind the wings (alpha, luma 0.63) so the brand holds on snow',
      cycle: 1,
      max: 1,
      rate: [0, 1000],
      life: [0, 1],
      at: [0, 1.75 / KE, 0],
      half: [0, (0.3 / KE) * 1.8],
      scale: [0, 1, 1, 1],
      color: [0, 0xd0a020, 0, 0.1, 0xd0a020, 0.5, 0.9, 0xd0a020, 0.5, 1, 0xd0a020, 0],
      billboard: 'screen',
      attach: true,
      blend: 'alpha',
      tex: 'glow',
    } satisfies ParticleSpec,
    ringBand('ground ring: a gold ring under the branded foe', {
      r0: 0.7, r1: 0.9, life: 1, scale: [0, 0.98, 0.5, 1.04, 1, 0.98], clamp: 0.9, soft: 0.5, y: 0.07 / KE,
      color: [0, 0xffc030, 0, 0.1, 0xffd040, 0.8, 0.9, 0xffc030, 0.8, 1, 0xffc030, 0],
    }),
    alphaRing('alpha twin of the ground ring: a deep gold that holds on snow', {
      r0: 0.68, r1: 0.92, life: 1, scale: [0, 0.98, 0.5, 1.04, 1, 0.98], soft: 0.5, y: 0.05 / KE,
      color: [0, 0xd0a020, 0, 0.1, 0xd0a020, 0.6, 0.9, 0xd0a020, 0.6, 1, 0xd0a020, 0],
    }),
  ],
});

/** every ninja moment, in registration order (skills/ninja/index.ts spreads this list at the end of NINJA_SPECS) */
export const NINJA_MOMENT_SPECS: FxSpec[] = [SWALLOWS_GAIT_LOOP, SWALLOWS_GAIT_NOVA, STEALTH_DECOY, STEALTH_BURST, EAGLE_EYE_MARK, EAGLE_EYE_BRAND];

/** the ids above, for tests and tools */
export const NINJA_MOMENT_IDS: readonly string[] = NINJA_MOMENT_SPECS.map((s) => s.id);
