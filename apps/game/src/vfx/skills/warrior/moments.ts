
// Contracts (momentKit.ts): a marker row = tracked `summon`, k = the row radius, base 1 m; an event = `selfBuff`, k = the sim's scale in metres.
// Every element is authored for k = 1: `at` (height too!), sizes, paths and speeds all scale with k, gravity does not. The events are

// written in metres at their nominal scale and divided by KS / KO (4 / 5), so chest height stays 0.9 m and a chunk stays 0.35 m at any k. Flagged `moment: true`, so a LIVE generated
// family of the same skill (graniteform is live) keeps them (families.ts resolveSkillSpecs) and noCasterDarkening reads them.
//
//   id                      kind    sim call                                                      k / duration                      look
//   sk.graniteform.loop     marker  shell.ts grantWard: spawnMarker(.., shellScale, window, follow)  1.4..3, until the ward ends       saturated blue granite shell: ring + alpha twin, plates orbiting at the knee
//   sk.graniteform.loop_worn marker shell.ts wearMarker (ward < 40 %): the same marker, cracked      1.4..3, the rest of the window    the shell worn down: broken ring, two plates, stone dust
//   sk.graniteform.shatter  event   shell.ts endWard: vfx(.., fp.burst, 0.6 s)                       4 (BIG), 0.6 s                    stone shell shattering: blue rings, granite shards, spinning stun stars
//   sk.war_oath.save        event   shell.ts oathSave: vfx(.., max(4, nova), 1 s)                    5 (BIG), 1 s                      gold beam over the hero, oath seal, shock rings, debris (no sheath on the body)
//   sk.war_oath.guard       marker  shell.ts oathSave: spawnMarker(.., 1.4, lethalGuard 2.5 s)       1.4, 2.5 s                        gold double ring + alpha twin, the inner ring closes over the 2.5 s
//   sk.war_oath.nova        event   common.ts finishCast (NOVA_VFX): the oath's 5 m hurl-back         5, 0.45 s                         thin gold ring (no filled disc)
//   sk.warfever.nova         event   common.ts finishCast (NOVA_VFX): the 3.5 m roar                   3.5, 0.45 s                       thin red roar ring
//   sk.warfever.loop         marker  selfBuff.cast (WINDOW_LOOPS): spawnMarker(.., 1.4, window, follow) 1.4, the kill-fed window            ember ring + rim flames + embers + a crown above the head
//   sk.warfever.kill         event   hooks.ts killPulse (<= 3 / s): vfx(.., 1, 0.35 s)                  1, 0.35 s                         a kill stretches the rage: ember pulse
//
// NOT here: sk.second_wind.leech (the cone's heal is the cone itself). second_wind's cast is the cone spec itself (second_wind.family.ts + patch).
// HERO RULE (user 2026-10-26): nothing here darkens the hero. Everything is additive except the ALPHA twins of the ground rings and the granite plates / shards
// (alpha, luma >= 0.45: pull 0, noCasterDarkening reads them), no `occlude`, bright stacks carry `clamp`; the engine hero guard fades what sits on the hero.
// Fix round 2 (vfx critic): snow twins (X3), a visible granite shell + a worn look (the marker radius cannot carry a live fraction: the sim swaps the style), the
// shatter in the loop blue, a hollow oath pillar, nova rings instead of the filled cream disc (X1), the kill-fed berserk window.
import type { FxSpec, ParticleSpec, SurfaceSpec } from '../../spec/types';
import { alphaRing, burstSpec, flash, markerSpec, novaRing, orbiter, ringBand, risingMotes, sparkBurst } from '../common/momentKit';

// ------------------------------------------------------------------------------------------------------------------ graniteform.loop

/** the shell ring radius (m) at k = 1: x1.4 (the smallest shell scale) = 1.25 m, 1.25 x the gold player ring */
const R = 0.9;
/** nominal k of the shatter (graniteform burst 4 m) and of the oath save (nova 5 m): every metre below is divided by it */
const KS = 4;
const KO = 5;

/** a granite plate orbiting the shell at knee height: light grey-blue (luma ~0.6), alpha, so it reads on grass and on snow */
const plate = (i: number, n: number, period: number): ParticleSpec =>
  orbiter(`granite plate ${i + 1}: a small grey-blue stone shard orbiting the hero at knee height`, {
    radius: R * 1.02, y: 0.3, period, phase: i / n, half: 0.1, tex: 'shard0', blend: 'alpha', bob: 0.04, spin: 80,
    color: [0, 0xaeb8d0, 0, 0.05, 0xaeb8d0, 0.95, 0.95, 0xaeb8d0, 0.95, 1, 0xaeb8d0, 0],
  });









const GRANITEFORM_LOOP: FxSpec = markerSpec({
  id: 'sk.graniteform.loop',
  desc: 'Graniteform shell loop (marker, follows the hero): a saturated blue ring turning on the ground at 1.25 x the player ring with an alpha twin and floor so it holds on snow, a spiked crown ring, two dashed pulse rings, a faint upright blue column and five grey-blue granite plates orbiting at knee height; ends the moment the stone shell breaks',
  ref: {},
  dur: 3,
  elements: [
    {
      kind: 'particle',
      key: 'gyeokgongjang_loop#0',
      note: 'gyeokgong_triple_loop_1 -> art vfx_ring_thin_loops_a: the thin ring turning on the ground (105 deg/s), a saturated blue',
      cycle: 3,
      loops: 0,
      max: 2,
      rate: [0, 1],
      life: [0, 6],
      at: [0, 0.06, 0],
      half: [0, 2],
      scale: [[0, 0.45], [0, 0.45]],
      color: [0, 0x7a96ff, 0, 0.08, 0x7a96ff, 0.95, 0.92, 0x7a96ff, 0.95, 1, 0x7a96ff, 0],
      billboard: 'ground',
      rotation: { spin: 105 },
      attach: true,
      blend: 'add',
      bright: 1.7,
      clamp: 1.2,
      tex: { art: 'vfx_ring_thin_loops_a', fallback: 'ring' },
    },
    {
      kind: 'particle',
      key: 'gyeokgongjang_loop#1',
      note: 'gyeokgong_triple_loop_2 -> art vfx_ring_spiked_crown_w: the spiked crown ring slowly swelling, fading in over 3 s and out',
      cycle: 2,
      loops: 0,
      max: 3,
      rate: [0, 1],
      life: [0, 4.5],
      at: [0, 0.05, 0],
      half: [0, 1.7],
      scale: [0.006, 0.4, 1, 0.45],
      color: [0, 0x5a7cff, 0, 0.67, 0x5a7cff, 1, 1, 0x5a7cff, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 2.4,
      clamp: 1.2,
      tex: { art: 'vfx_ring_spiked_crown_w', fallback: 'ring' },
    },
    {
      kind: 'particle',
      key: 'gyeokgongjang_loop#2',
      note: 'gyeokgongjang_round -> art vfx_ring_dashes_b: a dashed pulse ring swelling 40 % every second (a lighter blue so it reads on mid-tone grass)',
      cycle: 1,
      loops: 0,
      max: 1,
      rate: [0, 10],
      life: [0, 0.56],
      at: [0, 0.05, 0],
      half: [0, 2],
      scale: [0, 0.5, 1, 0.7],
      color: [0, 0x4a6cff, 0, 0.12, 0x4a6cff, 1, 1, 0x4a6cff, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 2.4,
      clamp: 1.2,
      tex: { art: 'vfx_ring_dashes_b', fallback: 'ringThick' },
    },
    {
      kind: 'particle',
      key: 'gyeokgongjang_loop#3',
      note: 'the second dashed pulse ring, turned 11 deg (the converted copy) and half a period later',
      t0: 0.5,
      cycle: 1,
      loops: 0,
      max: 1,
      rate: [0, 10],
      life: [0, 0.56],
      at: [0, 0.05, 0],
      half: [0, 2],
      scale: [0, 0.5, 1, 0.7],
      color: [0, 0x4a6cff, 0, 0.12, 0x4a6cff, 1, 1, 0x4a6cff, 0],
      billboard: 'ground',
      rotation: { start: [11, 11] },
      attach: true,
      blend: 'add',
      bright: 2.4,
      clamp: 1.2,
      tex: { art: 'vfx_ring_dashes_b', fallback: 'ringThick' },
    },
    alphaRing('alpha twin of the ring: the same band in a mid blue that draws its own colour, so the shell holds on snow and pale stone', {
      r0: R * 0.9, r1: R * 1.04, life: 3, loop: true, scale: [0, 0.99, 0.5, 1.02, 1, 0.99], soft: 0.5, y: 0.045,
      color: [0, 0x5a7cff, 0.6, 0.5, 0x6a8cff, 0.72, 1, 0x5a7cff, 0.6],
    }),
    alphaRing('alpha floor: a very faint blue disc inside the ring', {
      r0: 0.05, r1: R * 0.92, life: 3, loop: true, scale: [0, 0.98, 0.5, 1, 1, 0.98], soft: 1, y: 0.04, minTier: 1,
      color: [0, 0x6a8cff, 0.09, 0.5, 0x7a9cff, 0.14, 1, 0x6a8cff, 0.09],
    }),
    ringBand('floor glow: a faint blue disc inside the ring so the shell reads as a body of light', {
      r0: 0.05, r1: R * 0.92, life: 3, loop: true, scale: [0, 0.97, 0.5, 1, 1, 0.97], clamp: 1, soft: 1, tex: 'glow', minTier: 1, y: 0.04,
      color: [0, 0x5a6cff, 0.12, 0.5, 0x7a8cff, 0.2, 1, 0x5a6cff, 0.12],
    }),
    {
      kind: 'surface',
      note: 'a pale upright column of blue light at the rim (alpha 0.15, the hero is inside it and stays untouched)',
      life: 3,
      loop: true,
      shape: { kind: 'cyl', rb: R * 0.96, rt: R * 0.96, h: 1.5 },
      at: [0, 0, 0],
      uv: [[0, 0, 1, 1], [0, 0]],
      tile: [5, 1],
      color: [0, 0x5a7cff, 0.1, 0.5, 0x7a9cff, 0.17, 1, 0x5a7cff, 0.1],
      blend: 'add',
      tex: 'curtain',
      clamp: 0.8,
      soft: 0.7,
      minTier: 1,
    } satisfies SurfaceSpec,
    ...[0, 1, 2, 3, 4].map((i) => plate(i, 5, 5)),
    risingMotes('glints: pale blue-white sparkles lifting off the ring', {
      radius: R * 0.95, rate: 4, max: 6, life: 1.2, rise: 0.55, half: 0.08, tex: 'sparkle', spin: 50, minTier: 1,
      color: [0, 0xffffff, 0, 0.2, 0xc8d4ff, 0.9, 1, 0x8a9cff, 0],
    }),
  ],
});

/**
 * graniteform.loop_worn: the same shell when the ward is under 40 % (the sim swaps the marker style, shell.ts wearMarker): the ring is BROKEN into two dim
 * arcs that flicker, only two plates still circle, grey stone dust falls from the rim. Same footprint, so the swap reads as the shell cracking.
 */
const GRANITEFORM_LOOP_WORN: FxSpec = markerSpec({
  id: 'sk.graniteform.loop_worn',
  desc: 'Graniteform shell, worn down (marker, ward under 40 %): the blue ring broken into two flickering arcs with an alpha twin, two granite plates still circling and grey stone dust falling from the rim - the shell is about to give',
  ref: { family: 'original (warrior strong_body): the loop of the stone shell, cracked', notes: 'sim: shell.ts wearMarker swaps `sk.strong_body.loop` for this style when ward < 40 % of its size; same k' },
  dur: 2,
  elements: [
    ringBand('broken ring A: a flickering arc of the blue ring', {
      r0: R * 0.9, r1: R * 1.02, life: 2.4, loop: true, span: 120, a0: 20, spin: [0, 0, 1, 120], softU: 0.3, clamp: 1, soft: 0.5, y: 0.06, bright: 1.4,
      color: [0, 0x7a96ff, 0.5, 0.15, 0x7a96ff, 0.9, 0.3, 0x7a96ff, 0.3, 0.5, 0x7a96ff, 0.85, 0.7, 0x7a96ff, 0.35, 1, 0x7a96ff, 0.5],
    }),
    ringBand('broken ring B: the opposite arc, out of step', {
      r0: R * 0.9, r1: R * 1.02, life: 2.4, loop: true, span: 100, a0: 200, spin: [0, 0, 1, 120], softU: 0.3, clamp: 1, soft: 0.5, y: 0.06, bright: 1.4,
      color: [0, 0x7a96ff, 0.35, 0.2, 0x7a96ff, 0.2, 0.45, 0x7a96ff, 0.8, 0.8, 0x7a96ff, 0.3, 1, 0x7a96ff, 0.35],
    }),
    alphaRing('alpha twin A: the arc in mid blue for snow', {
      r0: R * 0.9, r1: R * 1.04, life: 2.4, loop: true, span: 120, a0: 20, spin: [0, 0, 1, 120], softU: 0.3, soft: 0.5, y: 0.045,
      color: [0, 0x5a7cff, 0.5, 0.5, 0x6a8cff, 0.62, 1, 0x5a7cff, 0.5],
    }),
    alphaRing('alpha twin B: the opposite arc', {
      r0: R * 0.9, r1: R * 1.04, life: 2.4, loop: true, span: 100, a0: 200, spin: [0, 0, 1, 120], softU: 0.3, soft: 0.5, y: 0.045,
      color: [0, 0x5a7cff, 0.45, 0.5, 0x6a8cff, 0.55, 1, 0x5a7cff, 0.45],
    }),
    ...[0, 1].map((i) => plate(i, 2, 5)),
    risingMotes('stone dust: grey grit falling from the rim', {
      radius: R * 0.95, rate: 8, max: 10, life: 0.9, rise: -0.35, half: 0.12, tex: 'smoke0', y: 0.9, spin: 30,
      color: [0, 0xcfd6e6, 0, 0.2, 0xcfd6e6, 0.4, 1, 0xaeb8d0, 0],
    }),
  ],
});

// ------------------------------------------------------------------------------------------------------------------ graniteform.shatter

/**
 * graniteform.shatter: the granite shell bursts (k = the 4 m burst, 0.6 s, BIG so a guest always sees it). Two bright rings snap out over the
 * ground in the shell's blue, a noisy stone shock ring rolls behind them, grey-blue granite shards arc out and fall, pale blue splinters and streaks fly, and a ring of
 * spinning stun stars rises where the stunned pack stands. The 4 m damage burst follows in the sim at the same instant. Fix round 2: blue ring and shards (the
 * loop blue, was white), granite shards instead of flat white squares, spinning popping stars, the flash clamped and set behind the body.
 */
const GRANITEFORM_SHATTER: FxSpec = burstSpec({
  id: 'sk.graniteform.shatter',
  desc: 'Graniteform shatter (event, k = the 4 m burst): a bright blue ring and a stone ring snapping out over the ground with an alpha twin, a noisy stone shock ring, grey-blue granite shards and pale blue splinters flung out, streaks, a ring of spinning yellow stun stars rising and a short soft flash behind the body',
  ref: {},
  dur: 0.7,
  elements: [
    ringBand('snap ring: a bright blue ring expanding fast over the ground', {
      r0: 0.82, r1: 1.0, life: 0.42, scale: [0, 0.1, 0.35, 0.8, 1, 1.0], clamp: 0.9, soft: 0.5, y: 0.1 / KS,
      color: [0, 0xe6edff, 0.3, 0.18, 0xdfe8ff, 0.85, 0.5, 0x8aa4ff, 0.6, 1, 0x4a6cff, 0],
    }),
    alphaRing('alpha twin of the snap ring: a mid blue that holds on snow', {
      r0: 0.82, r1: 1.0, life: 0.45, scale: [0, 0.1, 0.35, 0.8, 1, 1.0], soft: 0.6, y: 0.07 / KS,
      color: [0, 0x5a7cff, 0.6, 0.5, 0x5a7cff, 0.45, 1, 0x5a7cff, 0],
    }),
    ringBand('stone ring: a wider warm-grey band right behind it', {
      t0: 0.08, r0: 0.6, r1: 0.95, life: 0.55, scale: [0, 0.1, 0.4, 0.75, 1, 0.95], clamp: 1, soft: 0.8, y: 0.08 / KS,
      color: [0, 0xd8cfbe, 0.35, 1, 0xb8ac98, 0],
    }),
    {
      kind: 'particle',
      note: 'shockwave role: the noisy stone shock ring rolling over the ground',
      cycle: 0.6,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.5],
      at: [0, 0.07 / KS, 0],
      half: [0, 1.05],
      scale: [0, 0.15, 0.4, 1, 1, 1.05],
      color: [0, 0xdfe4f4, 0.12, 0.2, 0xdfe4f4, 0.5, 0.6, 0xbcc4dc, 0.22, 1, 0xa0a8c4, 0],
      billboard: 'ground',
      blend: 'add',
      tex: 'shockwave',
      clamp: 0.8,
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'shard0 role (alpha, grey-blue granite, luma ~0.65 so it never darkens): small shards arcing out from the shell and falling',
      cycle: 0.1,
      max: 16,
      rate: [0, 1000],
      life: [0, 0.6],
      shape: { kind: 'sphere', radius: 0.12 },
      adv: 'outer',
      at: [0, 0.5 / KS, 0],
      dir: { y: [0, 45] },
      vel: [0, 0.014],
      half: [0, 0.075],
      scale: [0, 1, 1, 0.8],
      color: [0, 0xaab4cc, 0.95, 0.7, 0x9aa6c0, 0.8, 1, 0x8c98b4, 0],
      gravity: [0, 3],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 360, randomDir: true },
      blend: 'alpha',
      tex: 'shard0',
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'shard1 role: pale blue shell splinters tumbling out',
      cycle: 0.1,
      max: 14,
      rate: [0, 1000],
      life: [0, 0.5],
      shape: { kind: 'sphere', radius: 0.1 },
      adv: 'outer',
      at: [0, 0.8 / KS, 0],
      dir: { y: [0, 25] },
      vel: [0, 0.012],
      half: [0, 0.06],
      scale: [0, 1, 1, 0.6],
      color: [0, 0xdce6ff, 1, 0.5, 0x8aa8ff, 0.85, 1, 0x4a6cff, 0],
      gravity: [0, 2],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 420, randomDir: true },
      blend: 'add',
      tex: 'shard1',
      clamp: 1,
    } satisfies ParticleSpec,
    sparkBurst('streaks: short blue-white streaks flung from the shell', {
      n: 18, at: [0, 0.8 / KS, 0], radius: 0.2, speed: 1.6, life: 0.35, length: 0.07, width: 0.012, gravity: 3, clamp: 1,
      color: [0, 0xe6edff, 1, 0.5, 0x9ab4ff, 0.8, 1, 0x4a6cff, 0],
    }),
    {
      kind: 'particle',
      note: 'star5 role: eight yellow stun stars circling up from the stone ring and spinning (a scale pop at birth): the pack is stunned',
      t0: 0.1,
      cycle: 0.7,
      max: 8,
      rate: [0, 40],
      life: [0, 0.65],
      shape: { kind: 'ellipse', radius: 0.5, edge: true },
      at: [0, 0.5 / KS, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.003],
      half: [0, 0.085],
      scale: [0, 0.3, 0.12, 1.3, 0.3, 1, 1, 0.7],
      color: [0, 0xfff2a0, 0, 0.15, 0xffe870, 1, 0.8, 0xffd850, 0.8, 1, 0xffc040, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 420, randomDir: true },
      blend: 'add',
      tex: 'star5',
      clamp: 1,
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'star halos: a soft gold glow behind each star so it reads as light, not a sticker',
      t0: 0.1,
      cycle: 0.7,
      max: 8,
      rate: [0, 40],
      life: [0, 0.6],
      shape: { kind: 'ellipse', radius: 0.5, edge: true },
      at: [0, 0.5 / KS, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.003],
      half: [0, 0.14],
      scale: [0, 0.4, 0.2, 1, 1, 0.7],
      color: [0, 0xffe070, 0, 0.2, 0xffd860, 0.35, 1, 0xffc040, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'glow',
      clamp: 0.8,
      minTier: 1,
    } satisfies ParticleSpec,
    flash('flash: a short soft blue flash at chest height, set behind the body and clamped', {
      at: [0, 0.9 / KS, -0.5 / KS], half: 0.28, life: 0.14, tex: 'glowCore', grow: [0.6, 1.2], clamp: 0.6,
      color: [0, 0xdce6ff, 0.22, 0.5, 0xa8bcff, 0.14, 1, 0x6a8cff, 0],
    }),
  ],
});

// ------------------------------------------------------------------------------------------------------------------ war_oath.save

const GOLD_PILLAR = (n: string, rb: number, rt: number, tex: SurfaceSpec['tex'], bright: number, a: number, at: number): SurfaceSpec => ({
  kind: 'surface',
  note: n,
  life: 0.9,
  shape: { kind: 'cyl', rb, rt, h: 1.25 },
  at: [0, at, 0],
  scale: [[0, 1, 0.5, 1, 1, 0.45], [0, 0.04, 0.16, 1, 1, 1.02], [0, 1, 0.5, 1, 1, 0.45]],
  tile: [2, 1],
  color: [0, 0xffe08a, 0, 0.1, 0xffd870, a, 0.45, 0xffc850, a * 0.7, 1, 0xffb030, 0],
  blend: 'add',
  tex,
  bright,
  clamp: 0.7,
  soft: 0.7,
});

/**
 * war_oath.save: the oath holds. The cancelled blow becomes a thin gold beam of light falling from above the head, NOTHING on the body (recheck B1: the round-2 sheath cylinder drew its near
 * wall in front of the whole body and, with a star on the chest and the hand cast's flames, left the hero a ghost for 0.35 s - the sheath is gone, the star sits above and behind the head),
 * a rune seal of the oath spinning on
 * the ground, a shock ring hurling the horde back over the 5 m nova, gold debris and rising sparks. k = max(4, nova) = 5, 1 s, BIG: every guest sees the cheat-death.
 * The 5 m nova under it is `sk.war_oath.nova` (a thin ring), not the filled shock.wave disc.
 */
const WAR_OATH_SAVE: FxSpec = burstSpec({
  id: 'sk.war_oath.save',
  desc: 'War Oath save (event, k = the 5 m nova, 1 s): a thin gold beam falling from above the head (no sheath round the body), a rune seal of the oath turning on the ground, two shock rings and soft rays hurling the pack back, gold shards and rising sparks, a small four-point star above and behind the head - the hero stays clear',
  ref: {},
  dur: 1,
  elements: [
    GOLD_PILLAR('beam: a thin bright beam falling onto the hero from above his head (starts at 2.2 m)', 0.04, 0.03, 'glowStrip', 1.2, 0.5, 1.9 / KO),
    ringBand('shock ring A: a gold-white ring hurling outward over the nova radius', {
      r0: 0.84, r1: 1.0, life: 0.55, scale: [0, 0.08, 0.3, 0.7, 1, 1.0], clamp: 0.8, soft: 0.5, y: 0.1 / KO,
      color: [0, 0xffeeb0, 0.35, 0.15, 0xffeeb0, 0.9, 0.45, 0xffd870, 0.55, 1, 0xffc040, 0],
    }),
    alphaRing('alpha twin of shock ring A: a mid gold that holds on snow', {
      r0: 0.84, r1: 1.0, life: 0.55, scale: [0, 0.08, 0.3, 0.7, 1, 1.0], soft: 0.5, y: 0.07 / KO,
      color: [0, 0xd09418, 0.65, 0.45, 0xd09418, 0.45, 1, 0xd09418, 0],
    }),
    ringBand('shock ring B: a thinner gold ring a beat behind', {
      t0: 0.12, r0: 0.88, r1: 1.0, life: 0.55, scale: [0, 0.08, 0.3, 0.6, 1, 0.9], clamp: 0.8, soft: 0.6, y: 0.12 / KO,
      color: [0, 0xffe08a, 0.7, 1, 0xffc040, 0],
    }),
    {
      kind: 'particle',
      note: 'runeCircle role: the oath seal, a gold rune circle on the ground turning slowly',
      cycle: 1,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.95],
      at: [0, 0.1 / KO, 0],
      half: [0, 0.46],
      scale: [0, 0.6, 0.3, 1, 1, 1.08],
      color: [0, 0xffe08a, 0, 0.15, 0xffd870, 0.8, 0.7, 0xffc850, 0.6, 1, 0xffb030, 0],
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -50 },
      blend: 'add',
      bright: 1.0,
      clamp: 0.7,
      tex: 'runeCircle',
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'raysSoft role: soft gold rays blooming across the ground',
      cycle: 0.5,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.45],
      at: [0, 0.09 / KO, 0],
      half: [0, 0.95],
      scale: [0, 0.3, 0.4, 0.9, 1, 1],
      color: [0, 0xffe08a, 0.45, 0.4, 0xffc850, 0.25, 1, 0xffb030, 0],
      billboard: 'ground',
      rotation: { start: [0, 360], spin: 30 },
      blend: 'add',
      clamp: 0.8,
      tex: 'raysSoft',
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'shard1 role: gold shards thrown out by the shock',
      cycle: 0.1,
      max: 14,
      rate: [0, 1000],
      life: [0, 0.7],
      shape: { kind: 'sphere', radius: 0.1 },
      adv: 'outer',
      at: [0, 0.3 / KO, 0],
      dir: { y: [0, 30] },
      vel: [0, 0.0095],
      half: [0, 0.035],
      scale: [0, 1, 1, 0.6],
      color: [0, 0xfff0c0, 1, 0.5, 0xffe08a, 0.9, 1, 0xffc040, 0],
      gravity: [0, 4],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 360, randomDir: true },
      blend: 'add',
      tex: 'shard1',
      clamp: 0.9,
    } satisfies ParticleSpec,
    sparkBurst('rising sparks: gold streaks climbing the pillar and arcing down', {
      n: 22, at: [0, 0.3 / KO, 0], radius: 0.18, speed: 1.3, life: 0.8, length: 0.045, width: 0.01, gravity: 1.2, clamp: 0.9, dir: { y: [0, 90] },
      color: [0, 0xfff0c0, 1, 0.5, 0xffe08a, 0.8, 1, 0xffc040, 0],
    }),
    flash('star: a small four-point star well above the head and set behind it (recheck B1: at 1.9 m with a 0.9 m half-size it covered the head and chest)', {
      at: [0, 2.9 / KO, -0.5 / KO], half: 0.1, life: 0.4, tex: 'flare4', grow: [0.4, 1.3], clamp: 0.6, spin: 40,
      color: [0, 0xfff0c0, 0.9, 0.5, 0xffe08a, 0.6, 1, 0xffc040, 0],
    }),
    risingMotes('falling glints: gold sparkles drifting down over the nova', {
      radius: 0.8, rate: 14, max: 14, life: 0.9, rise: -0.25, half: 0.05, tex: 'sparkle', spin: 60, attach: false, y: 1.2 / KO, minTier: 1, loops: 1,
      color: [0, 0xfff0c0, 0, 0.2, 0xffe08a, 0.9, 1, 0xffc040, 0],
    }),
  ],
});

// ------------------------------------------------------------------------------------------------------------------ war_oath.guard

/**
 * war_oath.guard: the 2.5 s the oath makes the hero untouchable. A thin double gold ring on the ground with an ALPHA twin (the white glyph ring of the old
 * look vanished on snow), the inner ring CLOSING toward the feet over the 2.5 s (the countdown: when it is shut the iframes are over), two bright gold arcs turning
 * on it, a faint gold light sheath at the rim and gold glints rising: "protected" without covering the hero. The marker lives exactly the iframes, the countdown ring
 * is one pass of 2.5 s (not looped).
 */
const WAR_OATH_GUARD: FxSpec = markerSpec({
  id: 'sk.war_oath.guard',
  desc: 'War Oath guard (marker, follows the hero, 2.5 s): a thin gold double ring on the ground with an alpha twin for snow, the inner ring closing toward the feet over the 2.5 s as a countdown, two bright arcs turning on it, a faint gold light sheath at the rim and gold glints rising - untouchable, the hero stays opaque',
  ref: { family: 'original (warrior war_oath): thin gold rim language of the oath, same marker grammar as the shared shell ring', notes: 'sim: oathSave spawnMarker(.., 1.4, trig.lethalGuard, follow); fixed gold colours (a marker row carries no element); the countdown ring is a single 2.5 s pass' },
  dur: 2.5,
  elements: [
    ringBand('outer ring: a thin gold ring breathing fast', {
      r0: 0.92, r1: 1.0, life: 1.2, loop: true, scale: [0, 0.985, 0.5, 1.03, 1, 0.985], clamp: 1, y: 0.05, soft: 0.55,
      color: [0, 0xffc850, 0.6, 0.5, 0xffe08a, 0.9, 1, 0xffc850, 0.6],
    }),
    alphaRing('alpha twin of the outer ring: a mid gold that holds on snow', {
      r0: 0.9, r1: 1.02, life: 1.2, loop: true, scale: [0, 0.985, 0.5, 1.03, 1, 0.985], y: 0.04, soft: 0.55,
      color: [0, 0xd09418, 0.5, 0.5, 0xd09418, 0.7, 1, 0xd09418, 0.5],
    }),
    ringBand('countdown ring: the inner ring closing toward the feet over the 2.5 s (shut = the iframes are over)', {
      r0: 0.9, r1: 1.0, life: 2.5, scale: [0, 0.78, 1, 0.3], clamp: 1, y: 0.05, soft: 0.5,
      color: [0, 0xffd870, 0.7, 0.8, 0xffe9a0, 0.9, 1, 0xffd870, 0.7],
    }),
    alphaRing('alpha twin of the countdown ring', {
      r0: 0.88, r1: 1.02, life: 2.5, scale: [0, 0.78, 1, 0.3], y: 0.04, soft: 0.5,
      color: [0, 0xd09418, 0.5, 1, 0xd09418, 0.6],
    }),
    ringBand('arc A: a bright gold arc turning round the inner ring', {
      r0: 0.62, r1: 0.76, life: 1.6, loop: true, span: 70, a0: 0, spin: [0, 0, 1, -360], clamp: 1, y: 0.05, soft: 0.6, softU: 0.4,
      color: [0, 0xfff0c0, 0.8, 1, 0xfff0c0, 0.8],
    }),
    ringBand('arc B: the opposite arc', {
      r0: 0.62, r1: 0.76, life: 1.6, loop: true, span: 70, a0: 180, spin: [0, 0, 1, -360], clamp: 1, y: 0.05, soft: 0.6, softU: 0.4,
      color: [0, 0xfff0c0, 0.8, 1, 0xfff0c0, 0.8],
    }),
    {
      kind: 'surface',
      note: 'light sheath: a faint gold wall of rising light shafts at the rim (low alpha, the hero is seen through it)',
      life: 1.6,
      loop: true,
      shape: { kind: 'cyl', rb: 0.96, rt: 0.96, h: 1.1 },
      at: [0, 0, 0],
      uv: [[0, 0, 1, 1], [0, 0]],
      tile: [4, 1],
      color: [0, 0xffe08a, 0.1, 0.5, 0xfff0c0, 0.18, 1, 0xffe08a, 0.1],
      blend: 'add',
      tex: 'curtain',
      clamp: 1,
      soft: 0.7,
      minTier: 1,
    } satisfies SurfaceSpec,
    risingMotes('glints: gold sparkles rising from the rim', {
      radius: 0.95, rate: 6, max: 9, life: 1.1, rise: 0.8, half: 0.08, tex: 'sparkle', spin: 60, minTier: 1,
      color: [0, 0xfff0c0, 0, 0.2, 0xffe08a, 0.9, 1, 0xffc040, 0],
    }),
  ],
});

// ------------------------------------------------------------------------------------------------------------------ nova rings (X1)

const WAR_OATH_NOVA: FxSpec = novaRing({
  id: 'sk.war_oath.nova',
  desc: 'War Oath hurl-back (event, k = the 5 m nova): a thin gold ring racing out over the ground with an alpha twin and a spray of gold streaks - no filled disc under the save pillar',
  ref: { family: 'original (warrior war_oath): the shared awakening nova as a thin gold ring', notes: 'sim: finishCast NOVA_VFX (war_oath): scale = nova 5, 0.45 s; replaces the shared vfx_nova shock.wave disc (it whited the hero out at the cheat-death instant)' },
  main: 0xffc850,
  pale: 0xfff0c0,
  deep: 0xd09418,
});

const BERSERK_NOVA: FxSpec = novaRing({
  id: 'sk.warfever.nova',
  desc: 'Berserk roar (event, k = the 3.5 m nova): a thin red roar ring racing out over the ground with an alpha twin and ember streaks - the rage, no filled cream disc',
  ref: { family: 'original (warrior berserk): the shared base-kit nova as a thin red roar ring', notes: 'sim: finishCast NOVA_VFX (berserk): scale = nova 3.5, 0.45 s' },
  main: 0xff3a20,
  pale: 0xffb090,
  deep: 0xe85a40,
  sparks: 18,
});

// ------------------------------------------------------------------------------------------------------------------ berserk.loop / kill

/**
 * berserk.loop: the kill-fed fury window made visible. A pulsing red-orange ring at the feet with an alpha twin, rim flames rising from the ring, embers drifting off it
 * and a small ring of embers hovering ABOVE the head (a crown: nothing on the body). The marker lives exactly as long as the buff and the sim lengthens it with every kill
 * (hooks.ts killPulse), so the look outlives the 8 s base window while the hero keeps killing.
 */
const BERSERK_LOOP: FxSpec = markerSpec({
  id: 'sk.warfever.loop',
  desc: 'Berserk fury window (marker, follows the hero, lengthened by every kill): a pulsing red-orange ring on the ground with an alpha twin, flame tongues rising from the rim, embers drifting off it and a crown of embers hovering above the head',
  ref: {},
  dur: 1.6,
  elements: [
    ringBand('fury ring: a hot red-orange ring pulsing on the ground', {
      r0: 0.8, r1: 0.95, life: 0.9, loop: true, scale: [0, 0.97, 0.5, 1.05, 1, 0.97], clamp: 1, soft: 0.5, y: 0.06, bright: 1.3,
      color: [0, 0xff4a20, 0.6, 0.5, 0xff8a40, 0.95, 1, 0xff4a20, 0.6],
    }),
    alphaRing('alpha twin of the fury ring: a deep red that holds on snow', {
      r0: 0.78, r1: 0.97, life: 0.9, loop: true, scale: [0, 0.97, 0.5, 1.05, 1, 0.97], soft: 0.5, y: 0.045,
      color: [0, 0xe85a40, 0.55, 0.5, 0xe85a40, 0.72, 1, 0xe85a40, 0.55],
    }),
    {
      kind: 'particle',
      note: 'tufts role: flame tongues rising from the rim of the ring (upright cards, additive)',
      cycle: 1,
      loops: 0,
      max: 14,
      rate: [0, 12],
      life: [0, 0.8],
      shape: { kind: 'ellipse', radius: 0.88, edge: true },
      at: [0, 0.05, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.006],
      half: [[0, 0.16], [0, 0.34]],
      scale: [0, 0.6, 0.3, 1, 1, 0.5],
      color: [0, 0xffb060, 0, 0.2, 0xff6a28, 0.55, 1, 0xd02810, 0],
      billboard: 'upright',
      attach: true,
      blend: 'add',
      tex: 'tufts',
      clamp: 0.9,
      minTier: 1,
    } satisfies ParticleSpec,
    risingMotes('embers: red-orange embers drifting off the ring', {
      radius: 0.9, rate: 8, max: 12, life: 1.3, rise: 0.7, half: 0.07, tex: 'ember', spin: 40, clamp: 1,
      color: [0, 0xffe0a0, 0, 0.15, 0xff8a30, 0.95, 1, 0xd03010, 0],
    }),
    risingMotes('crown: a small ring of embers hovering above the head, nothing on the body', {
      radius: 0.3, rate: 6, max: 8, life: 1.0, rise: 0.2, half: 0.06, tex: 'ember', spin: 90, y: 2.05, clamp: 1, minTier: 1,
      color: [0, 0xfff0c0, 0, 0.2, 0xffa040, 0.95, 1, 0xff5020, 0],
    }),
  ],
});

/** berserk.kill: a kill stretches the rage. A ring pulse at the feet, embers thrown up (<= 3 a second from the sim). */
const BERSERK_KILL: FxSpec = burstSpec({
  id: 'sk.warfever.kill',
  desc: 'Berserk kill pulse (event, k = 1, 0.35 s): a quick ember ring flaring at the hero\'s feet and a few embers thrown up - a kill stretches the rage',
  ref: { family: 'original (warrior berserk): kill pulse of the fury window', notes: 'sim: hooks.killPulse, scale 1, 0.35 s, at most 3 a second; small: a co-op guest may drop it under the 40-event cap (the loop marker is mirrored)' },
  dur: 0.4,
  elements: [
    ringBand('pulse ring: a bright ring flaring from the feet', {
      r0: 0.7, r1: 0.9, life: 0.3, scale: [0, 0.8, 1, 1.5], clamp: 0.9, soft: 0.6, y: 0.07,
      color: [0, 0xffd090, 0.8, 0.5, 0xff7a30, 0.5, 1, 0xff4a20, 0],
    }),
    sparkBurst('embers: a few embers thrown up', {
      n: 8, at: [0, 0.2, 0], radius: 0.4, speed: 1.6, life: 0.4, length: 0.08, width: 0.02, gravity: 3, clamp: 1, dir: { y: [0, 90] },
      color: [0, 0xfff0c0, 1, 0.5, 0xff8a30, 0.8, 1, 0xd03010, 0],
    }),
  ],
});

/** every warrior moment, in registration order (skills/warrior/index.ts spreads this list at the end of WARRIOR_SPECS) */
export const WARRIOR_MOMENT_SPECS: FxSpec[] = [
  GRANITEFORM_LOOP,
  GRANITEFORM_LOOP_WORN,
  GRANITEFORM_SHATTER,
  WAR_OATH_SAVE,
  WAR_OATH_GUARD,
  WAR_OATH_NOVA,
  BERSERK_NOVA,
  BERSERK_LOOP,
  BERSERK_KILL,
];

/** the ids above, for tests and tools */
export const WARRIOR_MOMENT_IDS: readonly string[] = WARRIOR_MOMENT_SPECS.map((s) => s.id);
