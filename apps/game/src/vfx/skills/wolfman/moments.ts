
// Contracts (momentKit.ts): an event = `selfBuff`, k = the sim's scale in metres, +Z of the spec = the event's facing. Every element is authored for
// k = 1: `at` (height too), sizes, paths and speeds all scale with k, gravity does not; the looks are written in metres at their nominal scale and

//
//   id                           kind   sim call                                                         k / duration   look
//   sk.spirit_wolves.pounce      event  companions.ts hunter step: vfx(`${def.vfx}.pounce`, wolf, dir to prey, 1.2, 0.35 s)   1.2, 0.35 s   blue streaks + dust at the launch, a ghost wolf leaping
//   sk.redmane_spirit.bite    event  behaviors/selfBuff.ts update (pulse): vfx(.., foe, dir hero -> foe, 1.2, 0.4 s)        1.2, 0.4 s    crimson wolf head lunging + claw rake at the target
//
// NOT here (the sim does not emit them yet): sk.spirit_wolves.howl, sk.blood_frenzy.stack, the possession loops sk.redmane_spirit.loop /


// Both are small events (a guest may drop them under the 40-per-snapshot cap: they are flavour, the damage is the sim's).
// HERO RULE (user 2026-10-26): nothing here darkens the hero; every element is ADDITIVE, no `occlude`, bright stacks carry `clamp`.
import type { FxSpec, ParticleSpec } from '../../spec/types';
import { burstSpec, flash, killPulse, novaRing, ringBand, sparkBurst, windowLoop } from '../common/momentKit';

const KP = 1.2;
const KC = 1.2;

/**
 * spirit_wolves.pounce: a spirit wolf leaps from where it stands toward its prey (+Z). Blue-white streaks race forward, a pale ghost wolf head
 * flies the first metres of the leap, a puff of pale dust and a small ring kick up behind the launch. Cold blue = the indigo / spirit palette.
 */
const SPIRIT_WOLVES_POUNCE: FxSpec = burstSpec({
  id: 'sk.spirit_wolves.pounce',
  desc: 'Spirit wolves pounce (event, +Z toward the prey, k = 1.2): blue-white streaks racing forward, a pale ghost wolf head flying the first metres of the leap, a puff of pale dust and a small ring kicked up at the launch, a soft blue flash',
  ref: {},
  dur: 0.4,
  elements: [
    {
      kind: 'particle',
      note: 'streakHard (stretch): eight blue-white streaks racing along the leap (fix round 2: wider and longer, the launch did not read at zoom 22)',
      cycle: 0.1,
      max: 8,
      rate: [0, 1000],
      life: [0, 0.3],
      shape: { kind: 'ellipse', radius: 0.3 / KP },
      at: [0, 0.5 / KP, 0],
      dir: { z: [0, 100] },
      vel: [0, 0.09],
      half: [[0, 0.07], [0, 0.7]],
      scale: [0, 1, 0.6, 1, 1, 0.5],
      color: [0, 0xffffff, 1, 0.5, 0xbfe2ff, 0.8, 1, 0x6a9cff, 0],
      billboard: 'stretch',
      blend: 'add',
      tex: 'streakHard',
      clamp: 1,
    } satisfies ParticleSpec,
    ...[0, 1, 2].map(
      (i): ParticleSpec => ({
        kind: 'particle',
        note: `wolfHead role: ghost wolf head, echo ${i + 1} of 3 along the first metres of the leap (a particle keeps its birth position: the lunge is three staggered echoes)`,
        t0: i * 0.05,
        cycle: 0.2,
        max: 1,
        rate: [0, 1000],
        life: [0, 0.2],
        at: [0, 0.75 / KP, (0.1 + i * 0.7) / KP],
        half: [0, (0.5 - i * 0.07) / KP],
        scale: [0, 0.8, 0.3, 1.05, 1, 0.95],
        color: [0, 0xbfe8ff, 0, 0.2, 0xd8f2ff, 0.7 - i * 0.12, 1, 0x6a9cff, 0],
        billboard: 'screen',
        blend: 'add',
        bright: 1.2,
        clamp: 1,
        tex: 'wolfHead',
      }),
    ),
    {
      kind: 'particle',
      note: 'cloud: pale blue-grey dust puffing up behind the launch (opposite the leap)',
      cycle: 0.1,
      max: 6,
      rate: [0, 1000],
      life: [0, 0.45],
      shape: { kind: 'box', box: [0.4 / KP, 0, 0.3 / KP] },
      at: [0, 0.15 / KP, 0],
      dir: { z: [0, -45], y: [0, 12] },
      vel: [0, 0.012],
      half: [0, 0.32 / KP],
      scale: [0, 0.6, 0.3, 1, 1, 1.4],
      color: [0, 0xd8ecff, 0, 0.15, 0xc8e0ff, 0.34, 1, 0x8ab0e8, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'add',
      tex: 'cloud',
      clamp: 1,
    } satisfies ParticleSpec,
    ringBand('kick ring: a small pale ring kicked out of the ground at the launch', {
      r0: 0.7, r1: 1.0, life: 0.3, scale: [0, 0.3, 1, 1.1], clamp: 1, soft: 0.8, y: 0.05 / KP,
      color: [0, 0xe8f4ff, 0.55, 1, 0xa8c8ff, 0],
    }),
    flash('flash: a soft blue-white flash at the launch', {
      at: [0, 0.6 / KP, 0], half: 0.4, life: 0.14, tex: 'glow', grow: [0.7, 1.2], clamp: 1,
      color: [0, 0xe8f4ff, 0.55, 0.5, 0xbfe0ff, 0.3, 1, 0x6a9cff, 0],
    }),
  ],
});






const REDMANE_SPIRIT_BITE: FxSpec = burstSpec({
  id: 'sk.redmane_spirit.bite',
  desc: 'Crimson wolf soul bite (event at the foe, +Z from the hero to the foe, k = 1.2): a crimson wolf head flying in and biting, three claw rips raking across the foe, red-gold sparks, a gold flare on the contact, a red ring and glow',
  ref: {},
  dur: 0.45,
  elements: [
    ...[0, 1, 2].map(
      (i): ParticleSpec => ({
        kind: 'particle',
        note: `wolfHead role: the crimson spectral wolf head lunging in from the hero side, echo ${i + 1} of 3 (the last one is the bite; a particle keeps its birth position)`,
        t0: i * 0.05,
        cycle: 0.3,
        max: 1,
        rate: [0, 1000],
        life: [0, i === 2 ? 0.3 : 0.14],
        at: [0, 0.95 / KC, (-1.5 + i * 0.75) / KC],
        half: [0, (0.5 + i * 0.07) / KC],
        scale: [0, 0.85, 0.3, 1.1, 1, 1.0],
        color: [0, 0xff7a50, 0, 0.15, 0xff3a28, 0.7 + i * 0.12, 0.55, 0xff5a30, 0.55 + i * 0.1, 1, 0xb01818, 0],
        billboard: 'screen',
        blend: 'add',
        bright: 1.5,
        clamp: 1,
        tex: 'wolfHead',
      }),
    ),
    {
      kind: 'particle',
      note: '',
      t0: 0.12,
      cycle: 0.3,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.26],
      at: [0, 0.95 / KC, 0.1 / KC],
      half: [0, 0.42 / KC],
      scale: [0, 0.8, 0.35, 1.1, 1, 1.0],
      color: [0, 0xffe08a, 0, 0.15, 0xffd060, 0.5, 1, 0xff8a30, 0],
      billboard: 'screen',
      blend: 'add',
      clamp: 1,
      tex: 'wolfHead',
    } satisfies ParticleSpec,
    {
      kind: 'particle',
      note: 'claw role: three claw rips raking diagonally across the foe at the bite',
      t0: 0.13,
      cycle: 0.3,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.26],
      at: [0, 0.9 / KC, 0],
      half: [0, 0.6 / KC],
      scale: [0, 0.4, 0.3, 1, 1, 1.08],
      color: [0, 0xffffff, 0, 0.15, 0xffffff, 0.9, 0.5, 0xff6040, 0.6, 1, 0xc02020, 0],
      billboard: 'screen',
      rotation: { start: [-35, -35] },
      blend: 'add',
      bright: 1.4,
      clamp: 1,
      tex: 'claw',
    } satisfies ParticleSpec,
    sparkBurst('sparks: red-gold sparks flying off the bite', {
      t0: 0.13, n: 12, at: [0, 0.9 / KC, 0], radius: 0.15, speed: 1.6, life: 0.3, length: 0.1, width: 0.02, gravity: 3, clamp: 1,
      color: [0, 0xffffff, 1, 0.5, 0xffa050, 0.85, 1, 0xff4020, 0],
    }),
    flash('contact flare: a gold four-point flare on the bite', {
      t0: 0.12, at: [0, 0.9 / KC, 0], half: 0.3, life: 0.2, tex: 'flare4', grow: [0.5, 1.3], clamp: 1, spin: 50,
      color: [0, 0xffffff, 0.9, 0.5, 0xffe08a, 0.55, 1, 0xff8a30, 0],
    }),
    ringBand('red ring: a small crimson ring on the ground at the foe', {
      t0: 0.13, r0: 0.75, r1: 1.0, life: 0.3, scale: [0, 0.35, 1, 1.2], clamp: 1, soft: 0.7, y: 0.05 / KC,
      color: [0, 0xff8a60, 0.6, 1, 0xd02818, 0],
    }),
    flash('glow: a soft crimson glow on the foe', {
      t0: 0.12, at: [0, 0.8 / KC, 0], half: 0.55, life: 0.3, tex: 'glow', grow: [0.7, 1.2], clamp: 1,
      color: [0, 0xff6a50, 0.4, 0.5, 0xe03a28, 0.22, 1, 0xa01010, 0],
    }),
  ],
});

// ------------------------------------------------------------------------------------------------------------------ fix round 2: nova rings (X1), window loops, kill pulses

/** thin ring-only roars (the shared filled cream disc of `vfx_nova` whited the wolfman out at every buff cast: vfx critic X1) */
const CRIMSON_NOVA: FxSpec = novaRing({
  id: 'sk.redmane_spirit.nova',
  desc: 'Redmane Spirit roar (event, k = the 4.5 m nova): a thin red ring racing out over the ground with an alpha twin and ember streaks - no filled cream disc',
  ref: { family: 'original (wolfman crimson wolf soul): the shared base-kit nova as a thin red ring', notes: 'sim: finishCast NOVA_VFX (crimson_wolf_soul): scale = nova 4.5, 0.45 s' },
  main: 0xff3a28,
  pale: 0xffb8a0,
  deep: 0xe85a40,
});
const BLOOD_FRENZY_NOVA: FxSpec = novaRing({
  id: 'sk.blood_frenzy.nova',
  desc: 'Blood Frenzy roar (event, k = the 5 m nova): a thin blood-red ring racing out over the ground with an alpha twin and streaks - no filled cream disc',
  ref: { family: 'original (wolfman blood frenzy): the shared base-kit nova as a thin blood-red ring', notes: 'sim: finishCast NOVA_VFX (blood_frenzy): scale = nova 5, 0.45 s' },
  main: 0xe02050,
  pale: 0xffa0b8,
  deep: 0xe8607c,
});
const INDIGO_NOVA: FxSpec = novaRing({
  id: 'sk.moonmane_spirit.nova',
  desc: 'Moonmane Spirit howl (event, k = the 4.5 m nova): a thin blue ring racing out over the ground with an alpha twin and cold streaks - no filled cream disc',
  ref: {},
  main: 0x4a8cff,
  pale: 0xc0dcff,
  deep: 0x5a84ff,
});

const CRIMSON_LOOP: FxSpec = windowLoop({
  id: 'sk.redmane_spirit.loop',
  desc: 'Redmane Spirit window (marker, follows the hero, lengthened by kills): a pulsing red ring on the ground with an alpha twin, flame tongues rising from the rim, embers drifting off it and a crown of embers above the head - the possession',
  ref: {},
  main: 0xff4a30,
  pale: 0xffd0a0,
  deep: 0xe85a40,
  ember: 0xffa040,
});
const CRIMSON_KILL: FxSpec = killPulse({
  id: 'sk.redmane_spirit.kill',
  desc: 'Redmane Spirit kill pulse (event, k = 1, 0.35 s): a quick red ring flaring at the feet and a few sparks thrown up - the kill feeds the possession',
  ref: { family: 'original (wolfman crimson wolf soul): kill pulse of the window', notes: 'sim: hooks.killPulse, scale 1, 0.35 s, <= 3 a second' },
  main: 0xff5a30,
  pale: 0xffd0a0,
});
const BLOOD_FRENZY_LOOP: FxSpec = windowLoop({
  id: 'sk.blood_frenzy.loop',
  desc: 'Blood Frenzy window (marker, follows the hero, lengthened and fed by kills): a pulsing blood-red ring on the ground with an alpha twin, tongues rising from the rim, embers drifting off it and a crown above the head - every kill makes it stronger',
  ref: { family: 'original (wolfman blood frenzy): blood-red window marker', notes: 'sim: selfBuff.cast WINDOW_LOOPS spawnMarker(.., 1.4, dur, follow); hooks.killPulse lengthens it' },
  main: 0xe02050,
  pale: 0xffb0c4,
  deep: 0xe8607c,
  ember: 0xff7090,
});
const BLOOD_FRENZY_KILL: FxSpec = killPulse({
  id: 'sk.blood_frenzy.kill',
  desc: 'Blood Frenzy kill pulse (event, k = 1, 0.35 s): a quick blood-red ring flaring at the feet and a few sparks thrown up - a stack is fed',
  ref: { family: 'original (wolfman blood frenzy): kill pulse of the window', notes: 'sim: hooks.killPulse, scale 1, 0.35 s, <= 3 a second' },
  main: 0xe02050,
  pale: 0xffb0c4,
});
const INDIGO_LOOP: FxSpec = windowLoop({
  id: 'sk.moonmane_spirit.loop',
  desc: 'Moonmane Spirit window (marker on every covered hero, follows): a pulsing blue ring on the ground with an alpha twin, tongues rising from the rim, motes drifting off it and a crown above the head - the pack spirit the party carries',
  ref: {},
  main: 0x4a8cff,
  pale: 0xc0dcff,
  deep: 0x5a84ff,
  ember: 0x80b0ff,
});

/** every wolfman moment, in registration order (skills/wolfman/index.ts spreads this list at the end of WOLFMAN_SPECS) */
export const WOLFMAN_MOMENT_SPECS: FxSpec[] = [
  SPIRIT_WOLVES_POUNCE,
  REDMANE_SPIRIT_BITE,
  CRIMSON_NOVA,
  BLOOD_FRENZY_NOVA,
  INDIGO_NOVA,
  CRIMSON_LOOP,
  CRIMSON_KILL,
  BLOOD_FRENZY_LOOP,
  BLOOD_FRENZY_KILL,
  INDIGO_LOOP,
];

/** the ids above, for tests and tools */
export const WOLFMAN_MOMENT_IDS: readonly string[] = WOLFMAN_MOMENT_SPECS.map((s) => s.id);
