// SHARED MOMENTS (skill-logic redesign, DESIGN section 4 M6 / section 7 (4)): the `sk.gen.*` looks the shells, the veil, the lure and the dodge
// of the redesigned skills emit. The sim emits these ids (sim/skills/shell.ts, companions.ts); until a spec exists they draw nothing
// (the sim's old stop-gap stand-ins for the damage sources are gone: these specs are the only look). Registered through the one spread line in skills/common.ts (the eager chunk,
// next to every other `sk.gen.*`), so every class and every co-op guest has them whatever pack is loaded.
//
//   id                   kind    sim call                                                   scale / duration the sim hands
//   sk.gen.veil_ring     marker  castVeil: spawnMarker(.., 'sk.gen.veil_ring', 1.4, veil, follow)    k 1.4, until the veil ends
//   sk.gen.shell_ring    marker  (fallback) a `sk.<skill>.loop` marker with no spec of its own       k 1.4..3 (shellScale), the shell window
//   sk.gen.bait_ring     marker  knightCast: markerRow(.., 'sk.gen.bait_ring', taunt, life, 255)     k = taunt radius (6..7.9), stationary
//   sk.gen.ward_hit      event   absorbWard: vfx(.., dirToSource, scale 1, 0.25 s, blow element)     +Z = toward the attacker, tinted by the blow
//   sk.gen.ward_break    event   endWard: vfx(.., scale 1.5, 0.35 s, ward skill element)              ring + shards at the holder's feet
//   sk.gen.dodge_hop     event   slipBlow: vfx(.., dirAwayFromSource, scale 1.2, 0.3 s, blow element)  +Z = the hop direction
//   sk.gen.party_link    line    wyrm_retinue: vfxLine(caster -> host, scale 1, 1.0 s, skill element)    reliable for guests (duration >= 1)
//
// Look language (DESIGN): the hero stays opaque and readable. Every element is ADDITIVE (cannot darken), no `occlude`, `clamp` on the bright
// stacks; markers are ground rings / rims with slow wisps (the engine's hero guard fades them inside the hero's screen ellipse); events are
// short and thin. Roles are procedural (spec atlas): no new raster, no change of any run's art scope. Colours of markers are fixed (a marker
// row carries no element on the wire: net/coop/snapshot.ts mirrors kind, style, position and radius only); events carry the element and use
// `tint: true` templates (authored white / pale, multiplied by the element's palette main colour).
import type { FxSpec, ParticleSpec } from '../../spec/types';
import { alphaRing, burstSpec, flash, lineSpec, markerSpec, ringBand, risingMotes, sparkBurst } from './momentKit';

// ------------------------------------------------------------------------------------------------------------------ markers

/**
 * Veil ring (stealth, smoke bomb): the marker the veil window wears. Fix round 2 (vfx critic): the thin pale lilac ring was the size of the shell fallback, invisible on snow and
 * identical in both skills. Now a SATURATED violet rim (#9a6cff) breathing on the ground with an ALPHA twin and a soft violet ground pool (an annulus, outside the hero ellipse,
 * alpha) so it holds on snow, a dashed turning rim, and slow violet wisps at twice the old alpha: "the horde lost you", the hero fully opaque inside it. Smoke bomb draws the
 * grey-teal variant (`sk.gen.veil_ring_smoke`: the sim picks the style by skill, shell.ts VEIL_STYLE). The dashes do not drain over the veil (a marker cannot carry a live fraction).
 */
const veilRing = (id: string, name: string, rim: number, pale: number, pool: number, wisp: number, notes: string): FxSpec =>
  markerSpec({
    id,
    desc: `${name} (marker, follows the hero): a saturated rim breathing on the ground with an alpha twin and a soft ground pool so it holds on snow, a dashed rim turning slowly, wisps climbing from the rim - the horde lost you; the hero stays opaque`,
    ref: {},
    dur: 2.4,
    elements: [
      ringBand('rim: a saturated ring breathing on the ground', {
        r0: 0.88, r1: 1.0, life: 2.4, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], clamp: 1, soft: 0.55, bright: 1.3,
        color: [0, rim, 0.7, 0.5, pale, 0.9, 1, rim, 0.7],
      }),
      alphaRing('alpha twin of the rim: the same band in its own colour so it holds on snow', {
        r0: 0.86, r1: 1.02, life: 2.4, loop: true, scale: [0, 0.985, 0.5, 1.025, 1, 0.985], soft: 0.55, y: 0.045,
        color: [0, pool, 0.6, 0.5, pool, 0.75, 1, pool, 0.6],
      }),
      alphaRing('pool: a soft ground pool of the veil colour between the rim and the hero (outside the hero ellipse)', {
        r0: 0.5, r1: 0.9, life: 2.4, loop: true, scale: [0, 0.99, 0.5, 1.01, 1, 0.99], soft: 1, y: 0.04, minTier: 1,
        color: [0, pool, 0.14, 0.5, pool, 0.22, 1, pool, 0.14],
      }),
      ...[0, 120, 240].map((a0) =>
        ringBand(`dash ${a0}: a short bright arc turning round the rim (three of them make the dashed rim)`, {
          r0: 0.9, r1: 1.0, life: 3.4, loop: true, span: 40, a0, spin: [0, 0, 1, 360], softU: 0.4, clamp: 1, soft: 0.5, y: 0.07,
          color: [0, pale, 0.85, 1, pale, 0.85],
        }),
      ),
      risingMotes('wisps: slow smoke climbing from the rim', {
        radius: 0.95, rate: 8, max: 14, life: 1.5, rise: 0.55, half: 0.34, tex: 'wisp', spin: 25, clamp: 1,
        color: [0, pale, 0, 0.25, wisp, 0.6, 1, rim, 0],
      }),
      risingMotes('motes: tiny glints rising faster', {
        radius: 0.9, rate: 4, max: 6, life: 1.1, rise: 0.8, half: 0.07, tex: 'sparkle', minTier: 1,
        color: [0, 0xffffff, 0, 0.2, pale, 0.8, 1, rim, 0],
      }),
    ],
  });

const VEIL_RING: FxSpec = veilRing('sk.gen.veil_ring', 'Veil ring', 0x9a6cff, 0xe0d0ff, 0x9a6cff, 0xc4a8ff, 'sim: castVeil, k = 1.4, lives for the veil seconds; violet (stealth); additive + alpha twin');
const VEIL_RING_SMOKE: FxSpec = veilRing('sk.gen.veil_ring_smoke', 'Smoke veil ring', 0x40c0b0, 0xd0f4ee, 0x30a898, 0x9ee0d4, 'sim: castVeil for smoke_bomb (shell.ts VEIL_STYLE), k = 1.4; grey-teal so the two veils are told apart');

/**
 * Generic shell ring: the neutral ring a `sk.<skill>.loop` marker draws when the skill has no loop spec of its own (app/skillVfxFeed.ts falls back to this id). Every shipped
 * shell has its own loop now, so this is a DEV fallback: in a dev build it is LOUD MAGENTA (a missing `.loop` spec shows up at once in captures); a production build keeps the
 * saturated gold ring with an alpha twin, which reads on grass and snow.
 */
const DEV_BUILD = import.meta.env.DEV === true;
const SHELL_MAIN = DEV_BUILD ? 0xff30e0 : 0xffc850;
const SHELL_PALE = DEV_BUILD ? 0xffb0f8 : 0xfff0c0;
const SHELL_DEEP = DEV_BUILD ? 0xff50e8 : 0xd09418;
const SHELL_RING: FxSpec = markerSpec({
  id: 'sk.gen.shell_ring',
  desc: 'Shell ring (marker, follows the hero): a saturated ground rim with an alpha twin, two slowly turning highlights, a faint floor glow and drifting glints - a ward stands here; the generic loop of a shell without a look of its own (loud magenta in a dev build)',
  ref: {},
  dur: 2.6,
  elements: [
    ringBand('floor glow: a faint disc of light inside the rim', {
      r0: 0.05, r1: 0.95, life: 2.6, loop: true, scale: [0, 0.97, 0.5, 1, 1, 0.97], clamp: 1, soft: 1, tex: 'glow',
      color: [0, SHELL_MAIN, 0.14, 0.5, SHELL_PALE, 0.22, 1, SHELL_MAIN, 0.14],
    }),
    ringBand('rim: a saturated ring breathing on the ground', {
      r0: 0.9, r1: 1.0, life: 2.6, loop: true, scale: [0, 0.99, 0.5, 1.02, 1, 0.99], clamp: 1, soft: 0.55, bright: 1.3,
      color: [0, SHELL_MAIN, 0.7, 0.5, SHELL_PALE, 0.9, 1, SHELL_MAIN, 0.7],
    }),
    alphaRing('alpha twin of the rim: holds on snow', {
      r0: 0.88, r1: 1.02, life: 2.6, loop: true, scale: [0, 0.99, 0.5, 1.02, 1, 0.99], soft: 0.55, y: 0.045,
      color: [0, SHELL_DEEP, 0.6, 0.5, SHELL_DEEP, 0.75, 1, SHELL_DEEP, 0.6],
    }),
    ringBand('turning highlight A: a bright arc sliding round the rim', {
      r0: 0.95, r1: 1.06, life: 3.2, loop: true, span: 80, a0: 0, spin: [0, 0, 1, 360], clamp: 1, soft: 0.6, softU: 0.42,
      color: [0, 0xffffff, 0.7, 1, 0xffffff, 0.7],
    }),
    ringBand('turning highlight B: the opposite arc', {
      r0: 0.95, r1: 1.06, life: 3.2, loop: true, span: 80, a0: 180, spin: [0, 0, 1, 360], clamp: 1, soft: 0.6, softU: 0.42,
      color: [0, 0xffffff, 0.7, 1, 0xffffff, 0.7],
    }),
    risingMotes('glints: sparkles lifting off the rim', {
      radius: 0.95, rate: 5, max: 8, life: 1.2, rise: 0.6, half: 0.09, tex: 'sparkle', spin: 60, minTier: 1,
      color: [0, 0xffffff, 0, 0.2, SHELL_PALE, 0.9, 1, SHELL_MAIN, 0],
    }),
  ],
});

/**
 * Bait ring (cursed legion knights): vfx critic round 2: six knights drew six overlapping 7 m hairline circles, a faint lattice over the whole screen where nothing read as
 * a LURE. The radius is no longer drawn: the look is the PULL. k = the taunt radius (6..7.9 m), stationary: violet rings contract from half the radius (3.5 m) to the knight in
 * 1.6 s, three staggered (a steady inward flow), each with an alpha twin so it shows on snow; the far field stays clean.
 */
const BAIT_RING: FxSpec = markerSpec({
  id: 'sk.gen.bait_ring',
  desc: 'Bait ring (marker, stationary under a knight, k = lure radius): violet rings contracting from half the lure radius to the knight, three staggered with alpha twins - the pull the horde walks into; nothing drawn at the far radius',
  ref: {},
  dur: 3,
  // round 2b: the first pass (three rings x 2, band 0.1 x k) stacked into a thick lattice again at 6 knights: now two thin rings (band 0.04 x k, from 0.42 x the radius), the alpha twin only a whisper
  elements: [0, 0.8].flatMap((t0, i) => [
    ringBand(`pull ${i + 1}: a thin violet ring contracting toward the knight`, {
      t0, r0: 0.96, r1: 1.0, life: 1.6, loop: true, scale: [0, 0.42, 1, 0.08], clamp: 0.9, soft: 0.8, y: 0.07, minTier: i === 0 ? 0 : 1,
      color: [0, 0x7a4ce0, 0, 0.15, 0x9a6cff, 0.34, 0.8, 0xb48cff, 0.3, 1, 0x9a6cff, 0],
    }),
    alphaRing(`alpha twin of pull ${i + 1}: holds on snow`, {
      t0, r0: 0.95, r1: 1.01, life: 1.6, loop: true, scale: [0, 0.42, 1, 0.08], soft: 0.8, y: 0.05, minTier: i === 0 ? 0 : 1,
      color: [0, 0x9a6cff, 0, 0.15, 0x9a6cff, 0.2, 0.8, 0x9a6cff, 0.16, 1, 0x9a6cff, 0],
    }),
  ]),
});

// ------------------------------------------------------------------------------------------------------------------ events

/**
 * Ward hit: where a blow lands on the ward. +Z is the direction TO the attacker (shell.ts absorbWard), so the look sits on the shield's skin on the attacker's side.
 * Fix round 2 (vfx critic X4): the legacy blue `player.shield` spike egg is gone (route.ts skips it for ward absorbs), so THIS is the read of a soaked blow: tinted by the
 * element of the WARD skill (granite blue, violet, gold, green: the sim passes the ward's element and throttles it to 4 a second per hero), grown to a 0.8 m ripple patch:
 * a bright flash, a wide expanding ring, a short arc of the ring on the ground toward the attacker, sparks flung off the skin.
 */
const WARD_HIT: FxSpec = burstSpec({
  id: 'sk.gen.ward_hit',
  desc: "Ward hit (event, +Z toward the attacker): a bright flash and a wide ripple ring (a ~0.8 m patch) on the ward's skin where the blow lands, a short ring arc on the ground toward the attacker, sparks flung off the skin; tinted by the ward skill element",
  ref: {},
  dur: 0.3,
  tint: true,
  elements: [
    flash('impact flash: the flash of the blow on the ward', {
      at: [0, 1.0, 0.8], half: 0.5, life: 0.16, tex: 'glow', grow: [0.5, 1.2], clamp: 1,
      color: [0, 0xffffff, 0.9, 0.5, 0xfff4e0, 0.55, 1, 0xffe8c0, 0],
    }),
    flash('ripple: a wide ring spreading from the impact (the 0.8 m patch)', {
      at: [0, 1.0, 0.8], half: 0.3, life: 0.24, tex: 'ringInner', grow: [0.5, 2.0], clamp: 1, bright: 1.3,
      color: [0, 0xffffff, 0.9, 1, 0xffe0a0, 0],
    }),
    flash('star: a four-point glint in the middle of the ripple', {
      at: [0, 1.0, 0.8], half: 0.34, life: 0.14, tex: 'flare4', grow: [0.5, 1.2], clamp: 1, spin: 60,
      color: [0, 0xffffff, 0.9, 0.5, 0xfff4e0, 0.5, 1, 0xffe8c0, 0],
    }),
    ringBand('ground arc: a short arc of the shell ring flaring on the ground toward the attacker', {
      r0: 0.8, r1: 1.0, life: 0.24, span: 90, a0: -45, softU: 0.4, scale: [0, 0.9, 1, 1.12], clamp: 1, soft: 0.6, y: 0.08,
      color: [0, 0xffffff, 0.8, 0.5, 0xffe0a0, 0.5, 1, 0xffe0a0, 0],
    }),
    sparkBurst('sparks: short streaks flung off the ward', {
      n: 8, at: [0, 1.0, 0.8], speed: 3.4, life: 0.2, length: 0.22, width: 0.03, gravity: 4, clamp: 1, dir: { z: [0, 55] },
      color: [0, 0xffffff, 1, 0.6, 0xffe8b0, 0.8, 1, 0xffe0a8, 0],
    }),
  ],
});

/**
 * Ward break: the shell ends (broken or run out). Two rings snapping outward on the ground, a ring of shards flung out at chest height, falling glints, a soft ground glow.
 * Tinted by the ward skill's element. Fix round 2: the sim hands scale 1.5 under a skill burst (the skill's own `sk.<skill>.burst|shatter|pulse` follows with the damage) and
 * 3 (BIG, 0.5 s) for a ward without a burst (blessing): then this is the ONLY "your shield is gone" signal, so it is a full ring of shards at 3 m. The chest flash that bleached the
 * hero is gone (a ground glow instead). `sk.gen.ward_ring` (below) is its neutral alpha twin for snow.
 */
const WARD_BREAK: FxSpec = burstSpec({
  id: 'sk.gen.ward_break',
  desc: 'Ward break (event, k = 1.5 under a skill burst, 3 alone): two rings snapping outward on the ground, a ring of bright shards in the ward colour flung out at chest height, a soft ground glow and falling glints; tinted by the ward element',
  ref: {},
  dur: 0.5,
  tint: true,
  elements: [
    ringBand('snap ring A: a bright ring expanding fast on the ground', {
      r0: 0.7, r1: 1.0, life: 0.34, scale: [0, 0.5, 1, 1.45], clamp: 0.8, soft: 0.6,
      color: [0, 0xffffff, 0.2, 0.2, 0xffffff, 0.6, 0.4, 0xffffff, 0.4, 1, 0xffffff, 0],
    }),
    ringBand('snap ring B: a thinner ring right behind', {
      t0: 0.06, r0: 0.8, r1: 1.0, life: 0.32, scale: [0, 0.4, 1, 1.25], clamp: 0.8, soft: 0.6,
      color: [0, 0xfff0d0, 0.15, 0.25, 0xfff0d0, 0.6, 1, 0xfff0d0, 0],
    }),
    sparkBurst('splinters: the ward breaks into bright streaks in the ward colour flung outward', {
      n: 18, at: [0, 0.9, 0], radius: 0.55, speed: 3.4, life: 0.42, length: 0.15, width: 0.05, gravity: 4, clamp: 1,
      color: [0, 0xffffff, 1, 0.5, 0xfff0d0, 0.9, 1, 0xffe8b8, 0],
    }),
    ringBand('shard ring: a ring of the ward colour flung out at knee height', {
      t0: 0.02, r0: 0.55, r1: 0.7, life: 0.4, scale: [0, 0.6, 1, 1.5], clamp: 1, soft: 0.7, y: 0.4, tex: 'ringInner',
      color: [0, 0xffffff, 0.7, 0.5, 0xfff0d0, 0.45, 1, 0xffe8b8, 0],
    }),
    ringBand('ground glow: a soft disc of the ward colour where the shell stood (no flash on the body)', {
      t0: 0.06, r0: 0.05, r1: 0.9, life: 0.3, scale: [0, 0.6, 1, 1.15], clamp: 0.7, soft: 1, tex: 'glow', y: 0.06,
      color: [0, 0xffffff, 0.0, 0.2, 0xffffff, 0.12, 0.5, 0xfff4e0, 0.08, 1, 0xffe8c0, 0],
    }),
    sparkBurst('glints: sparkles falling where the shell stood', {
      n: 10, at: [0, 0.9, 0], radius: 0.5, speed: 1.4, life: 0.5, length: 0.09, width: 0.09, tex: 'sparkle', billboard: 'screen', gravity: 3, minTier: 1,
      color: [0, 0xffffff, 0, 0.15, 0xfff4d0, 0.9, 1, 0xffe8b8, 0],
    }),
  ],
});

/**
 * Ward ring: the neutral ALPHA twin of the ward break (snow / pale ground: additive light vanishes there and a `tint: true` spec may not hold an alpha element, so this twin is its
 * own fixed-colour spec: a steel-blue ring luma ~0.55 that draws its own colour). Emitted by shell.ts endWard right after `sk.gen.ward_break`, same point and scale.
 */
const WARD_RING: FxSpec = burstSpec({
  id: 'sk.gen.ward_ring',
  desc: 'Ward ring (event, k = the ward break scale): a steel-blue alpha ring snapping out over the ground where the shell broke - the neutral twin of sk.gen.ward_break that holds on snow',
  ref: { family: 'original: alpha twin of the ward break ring', notes: 'sim: endWard, same scale / duration as sk.gen.ward_break; fixed colour (alpha elements are not allowed in a tint template)' },
  dur: 0.5,
  elements: [
    alphaRing('ring: a steel-blue band racing out over the ground', {
      r0: 0.72, r1: 1.0, life: 0.4, scale: [0, 0.5, 1, 1.45], soft: 0.6, y: 0.05,
      color: [0, 0x6a88c8, 0.6, 0.5, 0x6a88c8, 0.4, 1, 0x6a88c8, 0],
    }),
  ],
});

/**
 * Dodge hop: a charge slips a blow. +Z = the direction AWAY from the attacker (shell.ts slipBlow). A pale blue-white afterimage slides along the hop while it fades, a 1.2 m wind
 * streak races along it, wind streaks trail, a blue-violet ring puffs on the ground (with an alpha twin for snow) and a feather drifts. Fixed cool colours (not tinted), additive and faint
 * on the body: the hero is never covered (the hero guard also fades what sits on the hero).
 */
const DODGE_HOP: FxSpec = burstSpec({
  id: 'sk.gen.dodge_hop',
  desc: 'Dodge hop (event, +Z = away from the blow, k = 1.2): three pale blue-white afterimage glows slide along the hop and fade, a 1.2 m blue-white wind streak races along it, soft wind streaks trail, a blue-violet ground ring puffs with an alpha twin and a feather drifts',
  ref: {},
  dur: 0.4,
  elements: [
    ...[0, 0.05, 0.1].map(
      (t0, i): ParticleSpec => ({
        kind: 'particle',
        note: `afterimage ${i + 1}: a tall pale glow sliding along the hop (delayed ${t0} s)`,
        t0,
        cycle: 0.3,
        max: 1,
        rate: [0, 1000],
        life: [0, 0.3],
        at: [0, 0.95, -0.1],
        path: { z: [0, 0, 0.3, 0.9 - i * 0.15] },
        half: [[0, 0.42], [0, 0.95]],
        scale: [0, 0.9, 1, 1.1],
        color: [0, 0xe8f4ff, 0, 0.12, 0xd4e8ff, 0.3 - i * 0.07, 1, 0xa8c8ff, 0],
        billboard: 'upright',
        attach: true,
        blend: 'add',
        tex: 'glow',
        clamp: 1,
      }),
    ),
    {
      kind: 'particle',
      note: 'wind streak: one long soft streak racing along the hop (1.2 m)',
      cycle: 0.3,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.28],
      at: [0, 0.8, 0.1],
      path: { z: [0, 0, 0.28, 0.6] },
      half: [[0, 0.1], [0, 0.6]],
      scale: [0, 0.6, 0.4, 1, 1, 0.5],
      color: [0, 0xffffff, 0, 0.1, 0xdcecff, 0.85, 0.5, 0xb0ccff, 0.5, 1, 0x7d8fff, 0],
      billboard: 'stretch',
      blend: 'add',
      tex: 'streakSoft',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'wind streaks: thin pale streaks racing along the hop',
      cycle: 0.2,
      max: 5,
      rate: [0, 50],
      life: [0, 0.22],
      shape: { kind: 'ellipse', radius: 0.35 },
      at: [0, 0.8, -0.3],
      dir: { z: [0, 100] },
      vel: [0, 0.03],
      half: [[0, 0.05], [0, 0.3]],
      scale: [0, 1, 1, 0.6],
      color: [0, 0xffffff, 0.7, 0.5, 0xd4e8ff, 0.5, 1, 0xa8c8ff, 0],
      billboard: 'stretch',
      blend: 'add',
      tex: 'streakSoft',
      clamp: 1,
    },
    ringBand('puff: a small blue-violet ring of dust-light on the ground', {
      r0: 0.7, r1: 1.0, life: 0.3, scale: [0, 0.35, 1, 1.15], clamp: 0.8, soft: 0.8,
      color: [0, 0xc4d4ff, 0.55, 1, 0x7d8fff, 0],
    }),
    alphaRing('alpha twin of the puff: holds on snow', {
      r0: 0.7, r1: 1.0, life: 0.3, scale: [0, 0.35, 1, 1.15], soft: 0.8, y: 0.05,
      color: [0, 0x6a88c8, 0.55, 1, 0x6a88c8, 0],
    }),
    {
      kind: 'particle',
      note: 'feather: one light feather left drifting',
      t0: 0.04,
      cycle: 0.4,
      max: 2,
      rate: [0, 60],
      life: [0, 0.4],
      shape: { kind: 'ellipse', radius: 0.2 },
      at: [0, 0.9, 0],
      dir: { y: [0, 30], z: [0, 60] },
      vel: [0, 0.012],
      half: [0, 0.1],
      scale: [0, 0.9, 1, 1],
      color: [0, 0xffffff, 0.9, 0.6, 0xdcecff, 0.7, 1, 0xb8d4ff, 0],
      gravity: [0, 1.5],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 140, randomDir: true },
      blend: 'add',
      tex: 'feather',
      minTier: 1,
    },
  ],
});

// ------------------------------------------------------------------------------------------------------------------ lines

/**
 * Party link: a rope of light from the caster to an ally the skill reaches (the dragon's host, a covered or healed ally). A bright core rope
 * with a wider soft sheath draws out from the caster in 0.2 s, holds, and retracts toward the ally; motes stream along it, soft glows sit on
 * both ends. Duration 1 s so a guest always sees it. Tinted by the skill's element.
 */
const PARTY_LINK: FxSpec = lineSpec({
  id: 'sk.gen.party_link',
  desc: 'Party link (line, 1 s): a bright rope of light drawn from the caster to the ally in 0.2 s inside a wider soft sheath, motes streaming along it and soft glows on both ends, then it draws back; tinted by the skill element',
  ref: {},
  dur: 1,
  tint: true,
  elements: [
    {
      kind: 'surface',
      note: 'sheath: a wide soft band along the link',
      life: 1,
      shape: { kind: 'bolt', len: 4, w: 0.6, jag: 0.05, hz: 1 },
      place: 'along',
      at: [0, 1.1, 0],
      sweep: [[0, 0, 0.2, 1, 1, 1], [0, 0, 0.72, 0, 1, 1]],
      color: [0, 0xffffff, 0, 0.15, 0xfff6dc, 0.32, 0.75, 0xfff0c8, 0.26, 1, 0xffe8b0, 0],
      blend: 'add',
      tex: 'glowStrip',
      clamp: 1,
    },
    {
      kind: 'surface',
      note: 'core: the bright thin rope with a slow crackle',
      life: 1,
      shape: { kind: 'bolt', len: 4, w: 0.22, jag: 0.05, hz: 2 },
      place: 'along',
      at: [0, 1.1, 0],
      sweep: [[0, 0, 0.2, 1, 1, 1], [0, 0, 0.72, 0, 1, 1]],
      color: [0, 0xffffff, 0, 0.15, 0xffffff, 0.9, 0.75, 0xfff6e0, 0.8, 1, 0xffeac0, 0],
      blend: 'add',
      tex: 'energyStrip',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'motes: sparkles strung along the rope, rising a little',
      t0: 0.08,
      cycle: 1,
      max: 16,
      rate: [0, 40, 0.75, 40, 0.8, 0],
      life: [0, 0.45],
      shape: { kind: 'sphere', radius: 0.06 },
      place: 'along',
      at: [0, 1.1, 0],
      dir: { y: [0, 40] },
      vel: [0, 0.01],
      half: [0, 0.1],
      scale: [0, 0.7, 0.3, 1, 1, 0.6],
      color: [0, 0xffffff, 0, 0.15, 0xffffff, 0.9, 1, 0xffe0a0, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 90, randomDir: true },
      blend: 'add',
      tex: 'sparkle',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'source glow: a soft light where the rope leaves the caster',
      cycle: 1,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.9],
      at: [0, 1.1, 0],
      half: [0, 0.5],
      scale: [0, 0.5, 0.2, 1, 1, 0.9],
      color: [0, 0xffffff, 0, 0.1, 0xfff4d8, 0.4, 0.7, 0xffe8c0, 0.3, 1, 0xffe8b8, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'glow',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'ally glow: a flare where the rope lands, a ring spreading from it',
      t0: 0.18,
      cycle: 1,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.7],
      place: 'target',
      at: [0, 1.1, 0],
      half: [0, 0.55],
      scale: [0, 0.5, 0.25, 1, 1, 1.2],
      color: [0, 0xffffff, 0, 0.1, 0xffffff, 0.55, 0.6, 0xfff0c8, 0.35, 1, 0xffe0a0, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'flare4',
      clamp: 1,
    },
    {
      kind: 'particle',
      note: 'ally ring: a thin ring on the ground under the ally',
      t0: 0.2,
      cycle: 1,
      max: 1,
      rate: [0, 1000],
      life: [0, 0.6],
      place: 'target',
      at: [0, 0.08, 0],
      half: [0, 0.9],
      scale: [0, 0.4, 1, 1.15],
      color: [0, 0xffffff, 0.6, 1, 0xfff0c8, 0],
      billboard: 'ground',
      blend: 'add',
      tex: 'ringInner',
      clamp: 1,
    },
  ],
});

/** every shared moment spec, in registration order (skills/common.ts spreads this list) */
export const COMMON_MOMENT_SPECS: FxSpec[] = [VEIL_RING, VEIL_RING_SMOKE, SHELL_RING, BAIT_RING, WARD_HIT, WARD_BREAK, WARD_RING, DODGE_HOP, PARTY_LINK];

/** the ids above, for tests and tools */
export const COMMON_MOMENT_IDS: readonly string[] = COMMON_MOMENT_SPECS.map((s) => s.id);
