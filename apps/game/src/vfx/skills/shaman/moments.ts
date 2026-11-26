
// the skill covers, plus the hero-attached loops of the shells (the S4 families folded their AFFECT loops into the cast or dropped them). Every spec is
// flagged `moment: true` (a live generated family never drops it; vfx/__tests__/noCasterDarkening.test.ts reads it), built with the constructors of

// section 3.
//
//   id                              kind    sim call (sim/skills/)                                       scale / duration the sim hands
//   sk.mirror_shell.loop                 marker  shell.ts grantWard (each covered hero)                       k 1.4 (area 2.2 x .5), the ward window
//   sk.mirror_shell.burst                event   shell.ts endWard                                             k 3.5, 0.6 s
//   sk.mirror_shell.turn                 event   projectiles.ts mirrorFlip (a hostile bolt turned)            k 1, 0.3 s, +Z = the bolt's NEW direction, the bolt's element
//   sk.radiant_favor.loop                marker  shell.ts grantWard (each covered hero)                       k 1.5 (area 3 x .5), the ward window
//   sk.stormglass_shell.loop             marker  shell.ts grantWard (each covered hero)                       k 2 (area 4 x .5), the ward window
//   sk.stormglass_shell.pulse            event   shell.ts endWard (the burst moment of this skill)            k 4, 0.6 s   BIG
//   sk.thunder_guardians.plant      event   companions.ts pylonCast (one per idol)                       k 3, 1.0 s   BIG
//   sk.thunder_guardians.arc        line    companions.ts pylonArcs (idol -> idol, every 1.0 s)          k 1, 1.0 s: must read CONTINUOUS
//   sk.thunder_guardians.blink      line    companions.ts pylonStep leash (old spot -> new spot)         k 1, 0.3 s
//   sk.wyrm_retinue.breath            row     companions.ts coilStep (a Homing row, style `sk.wyrm_retinue.breath`)   radius 0.45 (k 1), tracked
//   sk.sovereigns_ire.descent    event   common.ts finishCast NOVA_VFX (the wrath's nova, k 6 / 8 awakened, 0.45 s): emitted since fix round 2
//   sk.stormglass_shell.nova / sk.surging_arms.nova / sk.tailwind.nova   event   common.ts finishCast NOVA_VFX: thin ring-only roars (no filled cream disc)
//
// Look language: Shaman = holy gold and pale yellow-green (reflect / aether), deep blue and violet (blessing), lightning blue-white (thunder), dragon
// gold (dragon aid). Every element is ADDITIVE (an additive element cannot darken), none uses `occlude`, bright stacks carry `clamp`; markers are
// ground rings and rims with slow wisps, the engine's hero guard fades them inside the hero's screen ellipse. Roles are procedural only: no new
// raster, no art key, no change of any run's art scope. Markers carry no element on the wire: fixed colours; events carry the element (`tint`).
import type { ColorCurve, FxSpec, ParticleSpec, SurfaceSpec, TexSrc, Vec3 } from '../../spec/types';
import { alphaRing, burstSpec, flash, lineSpec, markerSpec, novaRing, ringBand, risingMotes, sparkBurst } from '../common/momentKit';


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
    clamp: 1,
    ...(o.minTier !== undefined ? { minTier: o.minTier } : {}),
  };
}

/** an upright camera-facing card standing round the hero (an aura arc / halo), looping */
function standingCard(note: string, o: { w: number; h: number; y: number; life: number; color: ColorCurve; tex: TexSrc }): SurfaceSpec {
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
    clamp: 1,
  };
}

/** one-shot lying sprite on the ground (a rune, a crack, a glow disc): `half` m, `life` s, size over life as [from, to] */
function groundSprite(note: string, o: {
  half: number;
  life: number;
  color: ColorCurve;
  tex: TexSrc;
  grow?: readonly [number, number];
  t0?: number;
  y?: number;
  spin?: number;
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
  };
}

// ---------------------------------------------------------------------------------------------------------------- reflect (95 boho)





const REFLECT_LOOP: FxSpec = markerSpec({
  id: 'sk.mirror_shell.loop',
  desc: 'Reflect loop (marker, follows each covered hero): a thin pale yellow-green ring lying on the ground with a faint engraved pattern turning inside it and a golden half-circle arc standing behind the body, gold motes lifting - the mirror dome',
  ref: {},
  dur: 2.6,
  elements: [
    ringBand('floor glow: a faint warm disc of light inside the rim', {
      r0: 0.05, r1: 0.95, life: 2.6, loop: true, scale: [0, 0.97, 0.5, 1, 1, 0.97], clamp: 1, soft: 1, tex: 'glow',
      color: [0, 0xffe070, 0.18, 0.5, 0xfff0a0, 0.3, 1, 0xffe070, 0.18],
    }),
    ringBand('rim: the pale yellow-green boho ring on the ground', {
      r0: 0.9, r1: 1.0, life: 2.6, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], clamp: 1, soft: 0.55,
      color: [0, 0xfff07f, 0.6, 0.5, 0xfffbc0, 0.9, 1, 0xfff07f, 0.6],
    }),
    breath('pin pattern: the faint engraved ring turning slowly on the ground', {
      at: [0, 0.06, 0], half: 0.78, period: 3.0, tex: 'ornateRing', billboard: 'ground', spin: 14,
      color: [0, 0xffe890, 0, 0.3, 0xfff4b0, 0.26, 1, 0xffe890, 0],
    }),
    standingCard('empty_boho: the golden half-circle standing behind the body (arcThin)', {
      w: 1.7, h: 2.1, y: 1.0, life: 2.6, tex: 'arcThin',
      color: [0, 0xffd860, 0.34, 0.5, 0xfff0a0, 0.55, 1, 0xffd860, 0.34],
    }),
    alphaRing('alpha twin of the rim (fix round 2): a deep yellow-green ring that holds on snow and parts the loop from the gold player ring', {
      r0: 0.88, r1: 1.02, life: 2.6, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], soft: 0.55, y: 0.045,
      color: [0, 0xb8b020, 0.55, 0.5, 0xb8b020, 0.72, 1, 0xb8b020, 0.55],
    }),
    risingMotes('motes: gold sparkles lifting off the mirror', {
      radius: 0.95, rate: 5, max: 8, life: 1.2, rise: 0.6, half: 0.08, tex: 'sparkle', spin: 60, minTier: 1, clamp: 1,
      color: [0, 0xffffff, 0, 0.2, 0xfff2b0, 0.9, 1, 0xffd860, 0],
    }),
  ],
});

/**
 * Reflect burst (the mirror dome ends and pulses back what it absorbed, k = burst 3.5 m, 0.6 s): the boho stamp of the cast as the dome ends - a wide
 * flat ground disc with a pale blue-white rim and a yellow inner glow, a rune pattern flashing in it, gold mirror shards flung out and sparkles
 * falling. Authored for k 1 = the burst radius.
 */
const REFLECT_BURST: FxSpec = burstSpec({
  id: 'sk.mirror_shell.burst',
  desc: 'Reflect burst (event, k = burst radius): a wide flat ground disc with a pale blue-white rim and a yellow inner glow, a rune pattern flashing in it, gold mirror shards flung out and sparkles falling - the dome pulses back what it took',
  ref: {},
  dur: 0.6,
  elements: [
    groundSprite('disc: the yellow inner glow of the flat stamp disc', {
      half: 1.0, life: 0.5, tex: 'glow', grow: [0.5, 1.0],
      color: [0, 0xfff7a0, 0.4, 0.4, 0xffe870, 0.3, 1, 0xffd040, 0],
    }),
    ringBand('rim: the pale blue-white rim of the disc racing out', {
      r0: 0.84, r1: 1.0, life: 0.42, scale: [0, 0.3, 1, 1.03], clamp: 1, soft: 0.6,
      color: [0, 0xf0f4ff, 0.9, 0.4, 0xdee7ff, 0.6, 1, 0xa8c0ff, 0],
    }),
    groundSprite('rune pattern: the engraved rune circle flashing in the disc', {
      half: 0.62, life: 0.55, tex: 'runeCircle', grow: [0.7, 1.05], spin: 40,
      color: [0, 0xffffff, 0, 0.12, 0xfff0a0, 0.7, 0.6, 0xffe070, 0.45, 1, 0xffd040, 0],
    }),
    sparkBurst('mirror shards: bright gold shards flung out of the dome', {
      n: 14, at: [0, 0.8, 0], radius: 0.3, speed: 2.4, life: 0.4, length: 0.26, width: 0.04, gravity: 2, clamp: 1,
      color: [0, 0xffffff, 1, 0.5, 0xfff0a0, 0.85, 1, 0xffd860, 0],
    }),
    sparkBurst('sparkles: white-gold stars falling where the dome stood', {
      n: 10, at: [0, 0.9, 0], radius: 0.6, speed: 0.8, life: 0.5, length: 0.09, width: 0.09, tex: 'sparkle', billboard: 'screen', gravity: 2, minTier: 1, clamp: 1,
      color: [0, 0xffffff, 0, 0.15, 0xfff4c0, 0.9, 1, 0xffe890, 0],
    }),
    flash('flash: a short soft gold flash at chest height', {
      at: [0, 0.9, 0], half: 0.3, life: 0.16, tex: 'glowCore', grow: [0.6, 1.2], clamp: 1,
      color: [0, 0xffffff, 0.4, 0.5, 0xfff0a0, 0.22, 1, 0xffd860, 0],
    }),
  ],
});

/**
 * Reflect turn (a hostile bolt entering the dome is turned around, k 1, 0.3 s): +Z of the event is the bolt's NEW direction. A short star flash and a
 * small ring where the bolt turned, a reversed streak flung along its new way, a few sparks. Small and short (a swarm of turned bolts must not become a
 * wall of flashes), tinted by the bolt's element (a `tint` template, authored white / pale).
 */
const REFLECT_TURN: FxSpec = burstSpec({
  id: 'sk.mirror_shell.turn',
  desc: 'Reflect turn (event, +Z = the bolt\'s new direction, k 1): a short star flash and a small ring where the enemy bolt turned, a reversed streak flung along its new way and a few sparks; tinted by the bolt element',
  ref: {},
  dur: 0.3,
  tint: true,
  elements: [
    flash('star: the flash of the turn', {
      at: [0, 0.9, 0], half: 0.34, life: 0.16, tex: 'flare4', grow: [0.5, 1.3], clamp: 1,
      color: [0, 0xffffff, 1, 0.5, 0xfff4e0, 0.6, 1, 0xffe8c0, 0],
    }),
    flash('ring: a small ring where the bolt turned', {
      at: [0, 0.9, 0], half: 0.3, life: 0.22, tex: 'ringInner', grow: [0.4, 1.6], clamp: 1,
      color: [0, 0xffffff, 0.75, 1, 0xffe0a0, 0],
    }),
    flash('mirror pane (fix round 2): a hexagonal pane of light flashing where the bolt turned', {
      at: [0, 0.9, 0.1], half: 0.3, life: 0.2, tex: 'hex', grow: [0.5, 1.3], clamp: 1, spin: 40,
      color: [0, 0xffffff, 0.8, 0.5, 0xffe8b0, 0.5, 1, 0xffe0a8, 0],
    }),
    sparkBurst('reversed streak: the turned bolt leaving along its new way (fix round 2: a 1.5 m gold streak)', {
      n: 6, at: [0, 0.9, 0], speed: 9, life: 0.2, length: 0.9, width: 0.07, clamp: 1, dir: { z: [0, 100] },
      color: [0, 0xffffff, 1, 0.5, 0xfff0d0, 0.85, 1, 0xffe0a0, 0],
    }),
    sparkBurst('sparks: a few sparks', {
      n: 5, at: [0, 0.9, 0], speed: 2.2, life: 0.2, length: 0.12, width: 0.03, gravity: 3, clamp: 1, minTier: 1,
      color: [0, 0xffffff, 1, 0.6, 0xffe8b0, 0.8, 1, 0xffe0a0, 0],
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------- blessing (94 3hosin)





const BLESSING_LOOP: FxSpec = markerSpec({
  id: 'sk.radiant_favor.loop',
  desc: 'Blessing loop (marker, follows each covered hero): a flat deep-blue swirling disc under the feet, a blue-violet rim, an upright oval halo of soft blue-violet flame tongues framing the body and blue star specks floating up - the protective circle',
  ref: {},
  dur: 3.0,
  elements: [
    ringBand('swirl disc: the flat deep-blue swirling disc under the feet', {
      r0: 0.05, r1: 0.88, life: 3.0, loop: true, scale: [0, 0.97, 0.5, 1, 1, 0.97], spin: [0, 0, 1, 360], clamp: 1, soft: 0.8, tex: 'twistDisc',
      color: [0, 0x0a70e8, 0.34, 0.5, 0x2a95ff, 0.5, 1, 0x0a70e8, 0.34],
    }),
    ringBand('rim: the blue-violet rim of the circle', {
      r0: 0.9, r1: 1.0, life: 3.0, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], clamp: 1, soft: 0.55,
      color: [0, 0x5a66ff, 0.55, 0.5, 0xa0b0ff, 0.85, 1, 0x5a66ff, 0.55],
    }),
    standingCard('the upright oval halo framing the caster (arcPair)', {
      w: 1.4, h: 2.2, y: 1.05, life: 3.0, tex: 'arcPair',
      color: [0, 0x6a70ff, 0.32, 0.5, 0x9aa4ff, 0.5, 1, 0x6a70ff, 0.32],
    }),
    {
      kind: 'particle',
      note: 'flame tongues: soft spiky blue-violet flames rising along the oval halo',
      cycle: 1,
      loops: 0,
      max: 12,
      rate: [0, 14],
      life: [0, 0.8],
      shape: { kind: 'ellipse', radius: 0.68, edge: true },
      at: [0, 0.15, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.0045],
      half: [0, 0.3],
      scale: [0, 0.7, 0.4, 1, 1, 0.5],
      color: [0, 0xb0b8ff, 0, 0.25, 0x7a84ff, 0.4, 1, 0x4048e8, 0],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      tex: 'flameFB',
      frames: { fps: 0, random: true },
      clamp: 1,
      minTier: 1,
    },
    alphaRing('alpha twin of the disc (fix round 2): a mid blue ring that holds on snow', {
      r0: 0.7, r1: 0.95, life: 2.6, loop: true, scale: [0, 0.99, 0.5, 1.02, 1, 0.99], soft: 0.6, y: 0.045,
      color: [0, 0x5a7cff, 0.5, 0.5, 0x5a7cff, 0.66, 1, 0x5a7cff, 0.5],
    }),
    risingMotes('star specks: blue star specks floating up inside the halo', {
      radius: 0.8, rate: 6, max: 9, life: 1.3, rise: 0.55, half: 0.08, tex: 'sparkle', spin: 50, clamp: 1,
      color: [0, 0xffffff, 0, 0.2, 0xb8d0ff, 0.9, 1, 0x5a80ff, 0],
    }),
  ],
});

// ---------------------------------------------------------------------------------------------------------------- aether ward (182 chunwoon)






const STORMGLASS_SHELL_LOOP: FxSpec = markerSpec({
  id: 'sk.stormglass_shell.loop',
  desc: 'Stormglass Shell loop (marker, follows each covered hero): three concentric rings of yellow-green light swelling outward on the ground one after the other, a thin ring standing round the torso and tiny yellow sparks drifting up - the aether barrier',
  ref: {},
  dur: 2.4,
  elements: [
    ringBand('floor glow: a faint yellow-green disc of light', {
      r0: 0.05, r1: 0.95, life: 2.4, loop: true, scale: [0, 0.97, 0.5, 1, 1, 0.97], clamp: 1, soft: 1, tex: 'glow',
      color: [0, 0xc8ff7a, 0.16, 0.5, 0xe7ff9e, 0.26, 1, 0xc8ff7a, 0.16],
    }),
    ringBand('rim (fix round 2): a saturated yellow-green ground rim at the edge of the barrier, so the party barrier is seen on every covered ally', {
      r0: 0.9, r1: 1.0, life: 2.4, loop: true, scale: [0, 0.99, 0.5, 1.02, 1, 0.99], clamp: 1, soft: 0.55, bright: 1.4,
      color: [0, 0xc8ff40, 0.7, 0.5, 0xe7ff7e, 0.95, 1, 0xc8ff40, 0.7],
    }),
    alphaRing('alpha twin of the rim: a mid green that holds on snow', {
      r0: 0.88, r1: 1.02, life: 2.4, loop: true, scale: [0, 0.99, 0.5, 1.02, 1, 0.99], soft: 0.55, y: 0.045,
      color: [0, 0x60b820, 0.55, 0.5, 0x60b820, 0.75, 1, 0x60b820, 0.55],
    }),
    ringBand('swell A: the first barrier ring swelling outward', {
      r0: 0.9, r1: 1.0, life: 2.4, loop: true, scale: [0, 0.45, 1, 1.0], clamp: 1, soft: 0.6, tex: 'ringLine',
      color: [0, 0xe7ff7e, 0, 0.15, 0xe7ff7e, 0.95, 0.8, 0xc8ff60, 0.5, 1, 0xc8ff60, 0],
    }),
    ringBand('swell B: the second ring, a third of a period behind', {
      t0: 0.8, r0: 0.9, r1: 1.0, life: 2.4, loop: true, scale: [0, 0.45, 1, 1.0], clamp: 1, soft: 0.6, tex: 'ringLine',
      color: [0, 0xe7ff7e, 0, 0.15, 0xe7ff7e, 0.95, 0.8, 0xc8ff60, 0.5, 1, 0xc8ff60, 0],
    }),
    ringBand('swell C: the third ring', {
      t0: 1.6, r0: 0.9, r1: 1.0, life: 2.4, loop: true, scale: [0, 0.45, 1, 1.0], clamp: 1, soft: 0.6, tex: 'ringLine', minTier: 1,
      color: [0, 0xe7ff7e, 0, 0.15, 0xe7ff7e, 0.95, 0.8, 0xc8ff60, 0.5, 1, 0xc8ff60, 0],
    }),
    breath('gather ring: a thin ring standing round the torso, camera-facing', {
      at: [0, 1.1, 0], half: 0.62, period: 2.4, tex: 'ringInner',
      color: [0, 0xe7ff9e, 0, 0.3, 0xe7ff9e, 0.16, 1, 0xe7ff9e, 0],
    }),
    risingMotes('gather sparks: tiny yellow sparks drifting up', {
      radius: 0.9, rate: 6, max: 9, life: 1.2, rise: 0.6, half: 0.07, tex: 'sparkle', spin: 50, minTier: 1, clamp: 1,
      color: [0, 0xffffff, 0, 0.2, 0xfff0a0, 0.9, 1, 0xffd860, 0],
    }),
  ],
});

/** one lightning bolt lying flat at `yaw` deg, radiating from the middle (the Aether pulse's ring of lightning) */
function pulseBolt(yaw: number, t0: number): SurfaceSpec {
  return {
    kind: 'surface',
    note: `lightning ring: a jagged bolt radiating at ${yaw} deg`,
    t0,
    life: 0.22,
    shape: { kind: 'bolt', len: 0.95, w: 0.1, jag: 0.8, hz: 22 },
    at: [0, 0.35, 0],
    rot: [yaw, 0, 0],
    scale: [0, 0.35, 0.5, 1, 1, 1],
    color: [0, 0xffffff, 0.95, 0.6, 0xe8ffb0, 0.8, 1, 0xb8f060, 0],
    blend: 'add',
    tex: 'glowStrip',
    clamp: 1,
  };
}

/**
 * Stormglass Shell pulse (the barrier ends and bursts as lightning at its holder, k 4, 0.6 s, BIG so a guest sees it): chunwoon_1_blow - a white-yellow flash
 * blooms into a fluffy yellow-green cloud, concentric rings (yellow-green, mint, cyan: g3 shifts green -> cyan -> pink) race to the rim with orange-yellow
 * speed streaks flung to both sides; the lightning is a ring of jagged bolts radiating over the ground. Authored for k 1 = the burst radius.
 */
const STORMGLASS_SHELL_PULSE: FxSpec = burstSpec({
  id: 'sk.stormglass_shell.pulse',
  desc: 'Stormglass Shell pulse (event, k = burst radius): a white-yellow flash blooms into a yellow-green cloud, yellow-green, mint and cyan rings race to the rim with orange-yellow speed streaks, a ring of jagged lightning bolts radiates over the ground - the barrier bursts as lightning',
  ref: {},
  dur: 0.6,
  elements: [
    flash('flash: the white-yellow flash at the middle (small: the holder stays readable)', {
      at: [0, 0.9, 0], half: 0.2, life: 0.18, tex: 'glowCore', grow: [0.6, 1.3], clamp: 1,
      color: [0, 0xffffff, 0.5, 0.5, 0xfffbc0, 0.28, 1, 0xe7ff7e, 0],
    }),
    {
      kind: 'particle',
      note: 'cloud: the fluffy yellow-green glowing cloud blooming at the middle',
      cycle: 0.1,
      max: 3,
      rate: [0, 400],
      life: [0, 0.4],
      shape: { kind: 'ellipse', radius: 0.3, edge: true },
      at: [0, 0.5, 0],
      half: [0, 0.34],
      scale: [0, 0.6, 1, 1.5],
      color: [0, 0xf4ffb0, 0, 0.2, 0xe7ff7e, 0.26, 1, 0xb8e050, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 30, randomDir: true },
      blend: 'add',
      tex: 'cloud',
      clamp: 1,
      minTier: 1,
    },
    ringBand('ring A: yellow-green, racing to the rim', {
      r0: 0.82, r1: 1.0, life: 0.4, scale: [0, 0.3, 1, 1.03], clamp: 1, soft: 0.6,
      color: [0, 0xf4ffb0, 0.9, 0.4, 0xe7ff7e, 0.6, 1, 0xb8e050, 0],
    }),
    ringBand('ring B: mint, a beat behind', {
      t0: 0.08, r0: 0.84, r1: 1.0, life: 0.4, scale: [0, 0.25, 1, 0.94], clamp: 1, soft: 0.6,
      color: [0, 0xe0ffe8, 0.75, 1, 0xa0ffc8, 0],
    }),
    ringBand('ring C: cyan, the innermost', {
      t0: 0.16, r0: 0.86, r1: 1.0, life: 0.4, scale: [0, 0.2, 1, 0.82], clamp: 1, soft: 0.6, minTier: 1,
      color: [0, 0xe0ffff, 0.7, 1, 0x80e8ff, 0],
    }),
    sparkBurst('speed streaks: orange-yellow horizontal streaks shot out to both sides', {
      n: 12, at: [0, 0.5, 0], radius: 0.2, speed: 2.8, life: 0.3, length: 0.34, width: 0.03, clamp: 1,
      color: [0, 0xffffff, 1, 0.4, 0xffd060, 0.85, 1, 0xff9a30, 0],
    }),
    ...[0, 72, 144, 216, 288].map((yaw, i) => pulseBolt(yaw + 18, 0.02 + i * 0.015)),
  ],
});

// ---------------------------------------------------------------------------------------------------------------- thunder guardians

const ICE = 0xeaf6ff;
const ELEC = 0xbfe0ff;
const BLUE = 0x6ab8ff;

/**
 * Thunder Guardians plant (an idol is planted at its flank spot, k 3, 1.0 s, BIG): a sky bolt strikes the spot in three quick flickers, a white-blue
 * flash and a shock ring burst at its foot, a rune circle and a crack of lightning flare in the ground and fade over the second, sparks fly and motes
 * linger. One event per idol (two or three at a cast). Authored for k 1 (the sim hands 3).
 */
const THUNDER_PLANT: FxSpec = burstSpec({
  id: 'sk.thunder_guardians.plant',
  desc: 'Thunder Guardians plant (event, k 3, 1.0 s): a sky bolt strikes the idol spot in three flickers, a white-blue flash and a shock ring burst at its foot, a rune circle and a lightning crack flare in the ground and fade over a second, sparks fly and motes linger',
  ref: {},
  dur: 1.0,
  elements: [
    {
      kind: 'particle',
      note: 'noejeon_light: the sky bolt (boltV), three quick flickers',
      cycle: 0.1,
      loops: 3,
      max: 2,
      rate: [0, 1000],
      life: [0, 0.1],
      at: [0, 1.2, 0],
      half: [[0, 0.08], [0, 1.2]],
      scale: [0, 1],
      color: [0, 0xd8e8ff, 0.9, 0.6, 0xa8c8ff, 0.9, 1, 0x6a8cff, 0],
      billboard: 'upright',
      bright: 1.0,
      blend: 'add',
      tex: 'boltV',
      frames: { fps: 40, random: true },
      clamp: 1.0,
    },
    flash('strike flash: the white-blue flash at the foot of the bolt', {
      at: [0, 0.3, 0], half: 0.36, life: 0.22, tex: 'glowCore', grow: [0.6, 1.3], clamp: 1,
      color: [0, 0xffffff, 0.42, 0.5, 0xd0e4ff, 0.24, 1, 0x8ab8ff, 0],
    }),
    ringBand('shock ring: a blue-white ring racing out of the strike', {
      r0: 0.6, r1: 0.85, life: 0.42, scale: [0, 0.2, 1, 1.0], clamp: 1, soft: 0.6,
      color: [0, 0xf0f8ff, 0.9, 0.4, ELEC, 0.6, 1, BLUE, 0],
    }),
    groundSprite('crack: lightning crack flaring in the ground', {
      half: 0.5, life: 0.9, tex: 'crack', grow: [0.6, 1.0], t0: 0.04,
      color: [0, 0xffffff, 0, 0.1, 0xd8ecff, 0.85, 0.5, ELEC, 0.5, 1, BLUE, 0],
    }),
    groundSprite('rune circle: the idol rune flaring on the ground and fading over the second', {
      half: 0.5, life: 0.95, tex: 'runeCircle', grow: [0.8, 1.05], t0: 0.08, spin: 25,
      color: [0, 0xffffff, 0, 0.12, ICE, 0.7, 0.6, ELEC, 0.45, 1, BLUE, 0],
    }),
    sparkBurst('sparks: electric sparks flung out of the strike', {
      n: 14, at: [0, 0.25, 0], radius: 0.2, speed: 2.6, life: 0.45, length: 0.2, width: 0.035, gravity: 4, clamp: 1,
      color: [0, 0xffffff, 1, 0.5, ELEC, 0.85, 1, BLUE, 0],
    }),
    risingMotes('motes: blue sparkles lingering over the planted idol', {
      radius: 0.4, rate: 12, max: 12, life: 0.8, rise: 0.5, half: 0.07, tex: 'sparkle', spin: 60, clamp: 1, attach: false, loops: 1, y: 0.1, minTier: 1,
      color: [0, 0xffffff, 0, 0.2, 0xd0e8ff, 0.9, 1, BLUE, 0],
    }),
  ],
});

/**
 * Thunder Guardians arc (the live web between two idols, re-emitted every 1.0 s per pair, k 1): a thin jagged bright strand and a fainter secondary one
 * between the two idol heads, a soft glow along it and sparks crawling on it. It must read CONTINUOUS: the strands are `loop: true` surfaces that
 * re-strike back-to-back for the whole second and the last one finishes its own life past the end, so the next line (emitted at 1.0 s) overlaps it - no
 * blink at the boundary.
 */
const THUNDER_ARC: FxSpec = lineSpec({
  id: 'sk.thunder_guardians.arc',
  desc: 'Thunder Guardians arc (line idol to idol, 1.0 s, re-emitted every second): a thin bright jagged strand with a fainter secondary one and a soft glow along it, sparks crawling on it - the live web, continuous across the re-emits',
  ref: {},
  dur: 1.0,
  elements: [
    {
      kind: 'surface',
      note: 'pokroe_b: the main jagged strand along the segment, re-striking back-to-back',
      life: 0.3,
      loop: true,
      shape: { kind: 'bolt', len: 8, w: 0.16, jag: 0.6, hz: 18 },
      place: 'along',
      at: [0, 1.0, 0],
      color: [0, 0xf4fcff, 0.9, 1, 0x9ad0ff, 0.9],
      blend: 'add',
      tex: 'glowStrip',
      clamp: 1,
    },
    {
      kind: 'surface',
      note: 'pokroe_b: the faint secondary strand',
      life: 0.2,
      loop: true,
      shape: { kind: 'bolt', len: 8, w: 0.11, jag: 0.9, hz: 26 },
      place: 'along',
      at: [0, 1.0, 0],
      color: [0, 0xb8e0ff, 0.4, 1, 0x80b0ff, 0.4],
      blend: 'add',
      tex: 'glowStrip',
      clamp: 1,
    },
    {
      kind: 'surface',
      note: 'soft glow: a wide dim glow along the web',
      life: 0.6,
      loop: true,
      shape: { kind: 'bolt', len: 8, w: 0.7, jag: 0, hz: 1 },
      place: 'along',
      at: [0, 1.0, 0],
      color: [0, 0x6aa8ff, 0.14, 0.5, 0x8ac0ff, 0.2, 1, 0x6aa8ff, 0.14],
      blend: 'add',
      tex: 'glow',
      clamp: 1,
      minTier: 1,
    },
    {
      kind: 'particle',
      note: 'sparks crawling on the web',
      cycle: 1,
      loops: 0,
      max: 8,
      rate: [0, 10],
      life: [0, 0.3],
      place: 'along',
      at: [0, 1.0, 0],
      half: [0, 0.07],
      scale: [0, 1, 1, 0.4],
      color: [0, 0xffffff, 1, 1, 0x80b8ff, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'sparkle',
      clamp: 1,
      minTier: 1,
    },
  ],
});

/**
 * Thunder Guardians blink (an idol leashed to the hero re-plants at her side, k 1, 0.3 s): a bright streak flashes along the jump from the old spot to
 * the new one, a flash and a small ring pop at both ends - "the idol leaps back". Short and bright.
 */
const THUNDER_BLINK: FxSpec = lineSpec({
  id: 'sk.thunder_guardians.blink',
  desc: 'Thunder Guardians blink (line old spot to new spot, 0.3 s): a bright blue-white streak flashes along the jump and a flash and a small ring pop at both ends - the idol leaps back to its hero',
  ref: {},
  dur: 0.3,
  elements: [
    {
      kind: 'surface',
      note: 'the streak along the jump (jagged bolt)',
      life: 0.22,
      shape: { kind: 'bolt', len: 8, w: 0.34, jag: 0.5, hz: 24 },
      place: 'along',
      at: [0, 0.9, 0],
      color: [0, 0xffffff, 0.95, 0.6, 0xc0e0ff, 0.7, 1, 0x80b0ff, 0],
      blend: 'add',
      tex: 'glowStrip',
      bright: 1.2,
      clamp: 1.2,
    },
    {
      kind: 'particle',
      note: 'origin flash: the idol vanishes from the old spot',
      cycle: 0.2,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.2],
      at: [0, 0.8, 0],
      half: [0, 0.5],
      scale: [0, 1.2, 1, 0.4],
      color: [0, 0xffffff, 0.8, 0.5, ELEC, 0.45, 1, BLUE, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'glowCore',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'arrival flash: the idol lands at the new spot',
      t0: 0.04,
      cycle: 0.2,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.22],
      place: 'target',
      at: [0, 0.8, 0],
      half: [0, 0.55],
      scale: [0, 0.5, 0.4, 1.1, 1, 1.2],
      color: [0, 0xffffff, 0.9, 0.5, ELEC, 0.5, 1, BLUE, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'glowCore',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'arrival ring: a small blue ring on the ground at the new spot',
      t0: 0.04,
      cycle: 0.3,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.26],
      place: 'target',
      at: [0, 0.06, 0],
      half: [0, 0.75],
      scale: [0, 0.3, 1, 1.0],
      color: [0, 0xf0f8ff, 0.8, 0.5, ELEC, 0.5, 1, BLUE, 0],
      billboard: 'ground',
      blend: 'add',
      tex: 'ringInner',
      clamp: 1,
    },
  ],
});

// ---------------------------------------------------------------------------------------------------------------- dragon's aid

/**
 * Wyrm Retinue breath (the coiled spirit dragon breathes holy fire at the host's prey: a Homing row of radius 0.45, tracked every frame, 12 m/s): a small
 * holy-gold fireball - a hot white-gold core, a soft halo, gold flames and sparkles shed behind it as a trail - that bursts into a small golden flash,
 * ring and sparks where it ends. `homingProjectile` contract (track, mult, base 0.45: k 1 at the sim's radius).
 */
const WYRM_RETINUE_BREATH: FxSpec = {
  id: 'sk.wyrm_retinue.breath',
  desc: 'Wyrm Retinue breath (tracked bolt, 12 m/s): a small holy-gold fireball with a hot white-gold core, a soft halo and a trail of gold flames and sparkles, bursting into a small golden flash, ring and sparks where it ends',
  behavior: 'homingProjectile',
  ref: {},
  size: 'mult',
  base: 0.45,
  dur: 0.6,
  fadeOut: 0.05,
  clamp: 1.2,
  moment: true,
  elements: [
    {
      kind: 'particle',
      note: 'core: the hot white-gold fireball',
      cycle: 0.2,
      loops: 0,
      max: 5,
      rate: [0, 30],
      life: [0, 0.16],
      half: [0, 0.34],
      scale: [0, 0.8, 0.5, 1, 1, 0.9],
      color: [0, 0xffffff, 1, 1, 0xffd870, 0.5],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      bright: 1.1,
      tex: 'glowCore',
    },
    {
      kind: 'particle',
      note: 'halo: a soft gold halo round the ball',
      cycle: 0.4,
      loops: 0,
      max: 3,
      rate: [0, 7],
      life: [0, 0.4],
      half: [0, 0.7],
      scale: [0, 0.9, 1, 1.1],
      color: [0, 0xfff0b0, 0.2, 0.5, 0xffc860, 0.36, 1, 0xff9a30, 0],
      billboard: 'screen',
      rotation: { start: [0, 360] },
      attach: true,
      blend: 'add',
      tex: 'raysSoft',
    },
    {
      kind: 'particle',
      note: 'trail: gold flames left behind in the world',
      cycle: 0.3,
      loops: 0,
      max: 30,
      rate: [0, 80],
      life: [0, 0.34],
      shape: { kind: 'sphere', radius: 0.06 },
      dir: { y: [0, 40] },
      vel: [0, 0.004],
      half: [0, 0.42],
      scale: [0, 1, 1, 0.3],
      color: [0, 0xfff0a0, 0.85, 0.5, 0xffa030, 0.8, 1, 0xc05010, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'flameFB',
      frames: { fps: 0, random: true },
    },
    {
      kind: 'trail',
      note: 'ribbon: a smooth gold ribbon along the flight (a bolt at 12 m/s must read as a streak, not as dots)',
      attach: 'origin',
      mode: 'ribbon',
      width: 0.42,
      life: 0.22,
      taper: [0, 1, 1, 0.1],
      color: [0, 0xfff4c0, 0.8, 0.5, 0xffc860, 0.5, 1, 0xff9a30, 0],
      blend: 'add',
      tex: 'smear',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'glints: holy sparkles shed behind',
      cycle: 0.5,
      loops: 0,
      max: 8,
      rate: [0, 16],
      life: [0, 0.4],
      shape: { kind: 'sphere', radius: 0.14 },
      half: [0, 0.06],
      scale: [0, 1, 1, 0.3],
      color: [0, 0xffffff, 1, 1, 0xffd060, 0],
      gravity: [0, 1],
      billboard: 'screen',
      blend: 'add',
      tex: 'sparkle',
      minTier: 1,
    },
  ],
  impact: [
    {
      kind: 'particle',
      note: 'end flash: a small golden flash where the breath ends',
      cycle: 0.2,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.2],
      half: [0, 0.5],
      scale: [0, 0.5, 0.3, 1, 1, 1.2],
      color: [0, 0xffffff, 1, 0.5, 0xffe090, 0.7, 1, 0xffa030, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'glowCore',
    },
    {
      kind: 'particle',
      note: 'end ring: a thin gold ring',
      cycle: 0.3,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.26],
      half: [0, 0.7],
      scale: [0, 0.3, 1, 1],
      color: [0, 0xfff4c0, 0.8, 0.5, 0xffd060, 0.45, 1, 0xff9a30, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'ringInner',
    },
    sparkBurst('end sparks: golden sparks', {
      n: 8, at: [0, 0, 0], speed: 1.8, life: 0.26, length: 0.14, width: 0.035, clamp: 1,
      color: [0, 0xffffff, 1, 0.5, 0xffd060, 0.8, 1, 0xff9a30, 0],
    }),
  ],
};

// ---------------------------------------------------------------------------------------------------------------- dragon god's wrath (not emitted yet)

/**
 * Sovereign's Ire descent (the golden wave of the Wrath, k 6, 1.0 s, BIG): a golden shock ring races over the ground, a vertical column of light
 * stands at the middle for a beat, golden sparkles rise. NOT EMITTED by the sim yet (the base-kit nova draws the generic vfx_nova); the look is ready
 * for the day `sk.sovereigns_ire.descent` is emitted.
 */
const SOVEREIGNS_IRE_DESCENT: FxSpec = burstSpec({
  id: 'sk.sovereigns_ire.descent',
  desc: 'Sovereign\'s Ire descent (event, k 6, 1.0 s): a golden shock ring and a second behind it race over the ground, a column of golden light stands at the middle for a beat and golden sparkles rise - the Sky Sovereign answers',
  ref: {},
  dur: 1.0,
  elements: [
    ringBand('wave ring: the golden wave racing over the ground', {
      r0: 0.84, r1: 1.0, life: 0.6, scale: [0, 0.2, 1, 1.02], clamp: 1, soft: 0.6,
      color: [0, 0xfff4c0, 0.9, 0.4, 0xffd060, 0.65, 1, 0xff9a30, 0],
    }),
    ringBand('wave ring B: a second ring behind', {
      t0: 0.12, r0: 0.86, r1: 1.0, life: 0.6, scale: [0, 0.15, 1, 0.88], clamp: 1, soft: 0.6,
      color: [0, 0xffe890, 0.7, 1, 0xffb040, 0],
    }),
    groundSprite('ground glow: golden light flooding the wave disc', {
      half: 1.0, life: 0.7, tex: 'glow', grow: [0.3, 1.0],
      color: [0, 0xfff0b0, 0.3, 0.4, 0xffd060, 0.22, 1, 0xff9a30, 0],
    }),
    {
      kind: 'surface',
      note: 'light column: a vertical column of golden light standing at the middle',
      life: 0.7,
      shape: { kind: 'cyl', rb: 0.06, rt: 0.05, h: 0.9 },
      at: [0, 0, 0],
      scale: [[0, 0.3, 0.2, 1, 1, 0.7], [0, 1, 1, 1], [0, 0.3, 0.2, 1, 1, 0.7]],
      color: [0, 0xffffff, 0, 0.12, 0xfff0b0, 0.5, 0.6, 0xffd060, 0.35, 1, 0xff9a30, 0],
      blend: 'add',
      tex: 'glowStrip',
      clamp: 1,
    },
    risingMotes('sparkles: golden sparkles rising out of the wave', {
      radius: 0.7, rate: 14, max: 14, life: 0.9, rise: 0.6, half: 0.06, tex: 'sparkle', spin: 60, clamp: 1, attach: false, loops: 1, y: 0.1,
      color: [0, 0xffffff, 0, 0.2, 0xfff0a0, 0.9, 1, 0xffc040, 0],
    }),
    alphaRing('alpha twin of the wave ring: a mid gold that holds on snow (fix round 2)', {
      r0: 0.84, r1: 1.0, life: 0.6, scale: [0, 0.2, 1, 1.02], soft: 0.6, y: 0.06,
      color: [0, 0xd09418, 0.6, 0.4, 0xd09418, 0.5, 1, 0xd09418, 0],
    }),
    {
      kind: 'particle',
      note: 'falling golden light rain at the wave front (fix round 2): thin gold streaks dropping from above the ring as it passes',
      t0: 0.08,
      cycle: 0.7,
      max: 40,
      rate: [0, 70],
      life: [0, 0.35],
      shape: { kind: 'ellipse', radius: 0.85, edge: true },
      at: [0, 0.7, 0],
      dir: { y: [0, -100] },
      vel: [0, 0.03],
      half: [[0, 0.012], [0, 0.18]],
      scale: [0, 1, 1, 0.6],
      color: [0, 0xffffff, 0, 0.15, 0xfff0a0, 0.9, 1, 0xffc040, 0],
      billboard: 'stretch',
      blend: 'add',
      tex: 'streakHard',
      clamp: 0.9,
      minTier: 1,
    } satisfies ParticleSpec,
  ],
});

// ---------------------------------------------------------------------------------------------------------------- nova rings (vfx critic X1)

/** thin ring-only roars of the base-kit nova of three shaman buffs (the shared filled cream disc of `vfx_nova` -> shock.wave whited the caster out, 26.6 % of the screen on snow) */
const STORMGLASS_SHELL_NOVA: FxSpec = novaRing({
  id: 'sk.stormglass_shell.nova',
  desc: '',
  ref: {},
  main: 0x40ffb0,
  pale: 0xd0fff0,
  deep: 0x30c890,
  sparks: 18,
});
const SURGING_ARMS_NOVA: FxSpec = novaRing({
  id: 'sk.surging_arms.nova',
  desc: 'Surging Arms burst (event, k = the 3.5 m nova): a thin lime-orange burning ring racing out over the ground with an alpha twin and ember streaks - the 111 flame palette, no filled cream disc',
  ref: {},
  main: 0xffa830,
  pale: 0xf0ffa0,
  deep: 0xd88a20,
});
const SWIFTNESS_NOVA: FxSpec = novaRing({
  id: 'sk.tailwind.nova',
  desc: 'Swiftness gust (event, k = the 3.5 m nova): a thin lime-green wind ring racing out over the ground with an alpha twin and wind streaks - no filled mint disc',
  ref: {},
  main: 0x80ff60,
  pale: 0xe0ffd0,
  deep: 0x50c040,
  sparks: 16,
});

export const SHAMAN_MOMENT_SPECS: FxSpec[] = [
  REFLECT_LOOP,
  REFLECT_BURST,
  REFLECT_TURN,
  BLESSING_LOOP,
  STORMGLASS_SHELL_LOOP,
  STORMGLASS_SHELL_PULSE,
  THUNDER_PLANT,
  THUNDER_ARC,
  THUNDER_BLINK,
  WYRM_RETINUE_BREATH,
  SOVEREIGNS_IRE_DESCENT,
  STORMGLASS_SHELL_NOVA,
  SURGING_ARMS_NOVA,
  SWIFTNESS_NOVA,
];

/** the ids above (README / tests): every one is registered `moment: true` */
export const SHAMAN_MOMENT_IDS: readonly string[] = SHAMAN_MOMENT_SPECS.map((s) => s.id);
