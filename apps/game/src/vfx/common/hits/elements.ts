// Element hit sparks `hit.<element>` (common VFX target `hits`; owner: the hits builder) rebuilt as FxSpecs (r1 2026-10-13,
// r2 2026-10-19: grainy spark/puff sprites, element colour from frame 0, short tails, body-sized; r3 2026-10-19: ONE


// flare, yeongi puffs, half-ring streaks) recoloured, plus ONE signature sprite family that carries the element
// (flame puff, crystal cluster, flickering bolts, bubbling blob, ink splash, air slash, cross flare). Here the signature
// is the hero shape (generated sprites, ./art.ts), the sunburst is physical-only, and each element has its own size,
// aspect, timing and tail (flames rise, shards fall, motes drift, smoke lingers) so the family reads by shape, not by hue.
//
// Size: ~1.6-2.2 m visible at k = 1 (about 100-130 px at the 1080p game camera), tail 0.3-0.5 s. Spawn height: callers
// pass the body height (route: ground + 0.9), so `lift` is 0. Colours are sRGB keys [t, 0xRRGGBB, alpha, ...].
// Readability rules (r3 critic): no `occlude` on the ray ring / puffs (the dark matte read as grey streaks), alpha bodies
// carry the saturated colour on pale floors (additive light alone washes out on snow), tails fade through a darker shade of
// the same hue (never a blue / violet stain on the body).
import type { ColorCurve, FxSpec, ParticleSpec, TexSrc } from '../../spec/types';
import { ART_BOLT, ART_FLAME, ART_HOLY, ART_ICE, ART_INK, ART_PUFF, ART_SLASH, ART_SPARK, ART_TOXIC } from './art';

interface BaseLook {
  /** sunburst rays colour over life (never near-white: the first key is the element colour) */
  rays: ColorCurve;
  /** hot core cloud colour over life */
  core: ColorCurve;
  /** streak sparks colour over life */
  streak: ColorCurve;
  /** sunburst half size (m) */
  raysHalf?: number;
  /** hot core half size (m) */
  coreHalf?: number;
  streaks?: number;
  streakVel?: number;
}

/** the ray ring (line_ring_copy): masked round sprite, rays grow out of the core, additive only (no occlusion matte) */
function rayRing(rays: ColorCurve, half: number, life = 0.22): ParticleSpec {
  return {
    kind: 'particle',
    note: 'line_ring_copy -> vfx_hit_spark: grainy ring of fine rays growing out of the core (open hub, ragged round edge)',
    cycle: 0.05,
    max: 1,
    rate: [0, 60],
    life: [0, life],
    half: [0, half],
    // grows to ~0.9 of its size in the first 30 % of the life, then holds (the ring never swells past ~1.3 m wide)
    scale: [0, 0.5, 0.3, 0.92, 1, 1.0],
    color: rays,
    billboard: 'screen',
    rotation: { start: [0, 360] },
    blend: 'add',
    bright: 1.1,
    clamp: 1,
    tex: ART_SPARK,
  };
}

/** the hot core (7-2 / yeongi): a short cloud puff in the element colour (no white star) */
function coreCloud(core: ColorCurve, half = 0.4, life = 0.16): ParticleSpec {
  return {
    kind: 'particle',
    note: '7-2 / yeongi -> vfx_hit_puff: the short hot core of the blow, element colour (no white star)',
    cycle: 0.05,
    max: 1,
    rate: [0, 60],
    life: [0, life],
    half: [0, half],
    scale: [0, 0.6, 0.35, 1, 1, 0.85],
    color: core,
    billboard: 'screen',
    rotation: { start: [0, 360] },
    blend: 'add',
    bright: 1.1,
    clamp: 1,
    tex: ART_PUFF,
  };
}

/** half_ring_rainbow_line: thin sparks shooting out of the core */
function streakSparks(streak: ColorCurve, n = 6, vel = 0.06): ParticleSpec {
  return {
    kind: 'particle',
    note: 'half_ring_rainbow_line -> streakSoft (stretch): thin sparks shooting out of the core',
    cycle: 0.05,
    max: n,
    rate: [0, 600],
    life: [0, 0.2],
    shape: { kind: 'sphere', radius: 0.06 },
    adv: 'outer',
    vel: [0, vel],
    half: [0, 0.15],
    scale: [[0, 0.4], [0, 1.6, 1, 0.7]],
    color: streak,
    air: [0, 0.14],
    billboard: 'stretch',
    blend: 'add',
    bright: 1.2,
    clamp: 1,
    tex: 'streakSoft',
  };
}



export function blowBase(b: BaseLook): ParticleSpec[] {
  return [rayRing(b.rays, b.raysHalf ?? 0.8), coreCloud(b.core, b.coreHalf ?? 0.38), streakSparks(b.streak, b.streaks ?? 6, b.streakVel ?? 0.06)];
}



function puffs(color: ColorCurve, n = 3, half = 0.42, life = 0.3, tex: TexSrc = ART_PUFF, blend: 'add' | 'alpha' = 'add'): ParticleSpec {
  return {
    kind: 'particle',
    note: 'yeongi -> vfx_hit_puff: grainy cloud puffs swelling at the core, drifting up',
    cycle: 0.05,
    max: n,
    rate: [0, 600],
    life: [0, life],
    shape: { kind: 'sphere', radius: 0.12 },
    adv: 'outer',
    vel: [0, 0.006],
    dir: { y: [0, 0.6] },
    half: [0, half],
    scale: [0, 0.55, 1, 1.3],
    color,
    air: [0, 0.08],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 60, randomDir: true },
    blend,
    ...(blend === 'add' ? { clamp: 1 } : {}),
    tex,
  };
}

function hitSpec(id: string, desc: string, elements: ParticleSpec[]): FxSpec {
  return {
    id,
    desc,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.6,
    lift: 0,
    elements,
  };
}

// ---------------------------------------------------------------------------------------------------- physical




export function physicalElements(): ParticleSpec[] {
  return [
    {
      kind: 'particle',
      note: '',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.22],
      half: [0, 0.92],
      scale: [0, 0.5, 0.3, 0.95, 1, 1.05],
      color: [0, 0xb8d8b0, 0.22, 0.5, 0x98b898, 0.12, 1, 0x587858, 0],
      billboard: 'screen',
      rotation: { start: [0, 360] },
      blend: 'add',
      clamp: 1,
      tex: ART_PUFF,
    },
    ...blowBase({
      rays: [0, 0xe8d29c, 0.92, 0.45, 0xdcb878, 0.7, 0.8, 0xb08850, 0.28, 1, 0x806038, 0],
      core: [0, 0xf07a20, 0.95, 0.5, 0xe06a18, 0.8, 1, 0xa04a14, 0],
      streak: [0, 0xffa860, 1, 0.5, 0xff8a40, 0.9, 1, 0xc84a1c, 0],
      raysHalf: 0.82,
      coreHalf: 0.42,
      streaks: 7,
    }),
    puffs([0, 0xf0781c, 0.75, 0.3, 0xd86a1c, 0.55, 0.7, 0x9a5216, 0.25, 1, 0x603010, 0], 3, 0.5, 0.3),
    puffs([0, 0xc06a12, 0.92, 0.5, 0xa05414, 0.5, 1, 0x6a4020, 0], 2, 0.46, 0.27, ART_PUFF, 'alpha'),
  ];
}

// ---------------------------------------------------------------------------------------------------- elements
const FIRE: FxSpec = hitSpec(
  'hit.fire',
  'Fire hit: licking flame tongues rising off the body (orange from frame 0, hot amber heart), embers thrown up and a dark smoke tail',
  [
    {
      kind: 'particle',
      note: 'flame body (alpha): the orange-red mass of the burst, taller than wide, so the fire keeps its colour on snow',
      cycle: 0.06,
      max: 2,
      rate: [0, 600],
      shape: { kind: 'sphere', radius: 0.07 },
      adv: 'outer',
      vel: [0, 0.003],
      life: [0, 0.36],
      half: [0, 0.66],
      scale: [[0, 0.5, 0.3, 0.95, 1, 1.05], [0, 0.5, 0.3, 1.05, 1, 1.2]],
      color: [0, 0xc83c06, 0.97, 0.5, 0xa83006, 0.7, 1, 0x602008, 0],
      billboard: 'screen',
      rotation: { start: [-8, 8] },
      blend: 'alpha',
      tex: ART_FLAME,
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.06,
      max: 2,
      rate: [0, 600],
      life: [0, 0.34],
      shape: { kind: 'sphere', radius: 0.07 },
      adv: 'outer',
      vel: [0, 0.006],
      dir: { y: [0, 0.5] },
      half: [0, 0.62],
      scale: [[0, 0.5, 0.3, 0.95, 1, 1.0], [0, 0.5, 0.3, 1.1, 1, 1.25]],
      color: [0, 0xffb040, 0.85, 0.25, 0xff9028, 0.8, 0.6, 0xff5a10, 0.5, 1, 0x7a1600, 0],
      billboard: 'screen',
      rotation: { start: [-10, 10] },
      blend: 'add',
      bright: 1.2,
      occlude: 0.5,
      clamp: 1.05,
      tex: ART_FLAME,
    },
    coreCloud([0, 0xffa828, 1, 0.5, 0xff7810, 0.8, 1, 0xa02a08, 0], 0.3, 0.14),
    streakSparks([0, 0xffd080, 1, 0.5, 0xff8a3a, 0.9, 1, 0xd03a10, 0], 5, 0.05),
    {
      kind: 'particle',
      note: 'embers: sparks thrown up out of the flame, falling back, orange -> red',
      cycle: 0.08,
      max: 6,
      rate: [0, 300],
      life: [0, 0.5],
      shape: { kind: 'sphere', radius: 0.22 },
      adv: 'outer',
      vel: [0, 0.022],
      dir: { y: [0, 1.6] },
      half: [0, 0.07],
      scale: [0, 1, 0.7, 0.8, 1, 0.3],
      color: [0, 0xffd070, 1, 0.5, 0xff8a30, 1, 1, 0xc02a08, 0],
      gravity: [0, 3.5],
      air: [0, 0.04],
      billboard: 'stretch',
      blend: 'add',
      bright: 1.4,
      tex: 'ember',
      minTier: 1,
    },
    puffs([0, 0x2e221c, 0, 0.25, 0x3a2a22, 0.3, 1, 0x4a4040, 0], 2, 0.42, 0.5, 'smoke1', 'alpha'),
  ],
);

const ICE: FxSpec = hitSpec(
  'hit.ice',
  'Ice hit: a faceted cyan crystal cluster bursting up out of the body (body-sized, never twice the mob) over a deep-blue shadow, frost mist, falling ice chips',
  [
    {
      kind: 'particle',
      note: 'icedumy underlay (alpha): the cluster silhouette in deep blue, so the crystals keep their body on snow',
      cycle: 0.05,
      max: 2,
      rate: [0, 600],
      shape: { kind: 'sphere', radius: 0.07 },
      adv: 'outer',
      vel: [0, 0.003],
      life: [0, 0.4],
      half: [0, 0.64],
      scale: [0, 0.35, 0.18, 1.0, 0.7, 1.03, 1, 1.06],
      color: [0, 0x1048b8, 0.97, 0.6, 0x103c9c, 0.8, 1, 0x143a80, 0],
      billboard: 'screen',
      rotation: { start: [-12, 12] },
      blend: 'alpha',
      tex: ART_ICE,
    },
    {
      kind: 'particle',
      note: 'icedumy -> vfx_hit_ice: crystal cluster popping up (fast scale-in, holds, then melts to blue)',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.4],
      half: [0, 0.62],
      scale: [0, 0.35, 0.18, 1.0, 0.7, 1.04, 1, 1.08],
      color: [0, 0xb4f0ff, 1, 0.2, 0x8ae6ff, 1, 0.7, 0x4ab8f0, 0.7, 1, 0x3a7ad8, 0],
      billboard: 'screen',
      rotation: { start: [-12, 12] },
      blend: 'add',
      bright: 1.25,
      occlude: 0.6,
      clamp: 1.05,
      tex: ART_ICE,
    },
    coreCloud([0, 0x50d8ff, 0.8, 0.5, 0x38b0f0, 0.6, 1, 0x2a70c0, 0], 0.28, 0.14),
    streakSparks([0, 0xc0f0ff, 1, 0.5, 0x90d8ff, 0.9, 1, 0x4891ff, 0], 5, 0.05),
    {
      kind: 'particle',
      note: 'ice chips: small bright shards thrown out and falling, spinning',
      cycle: 0.05,
      max: 6,
      rate: [0, 600],
      life: [0, 0.45],
      shape: { kind: 'sphere', radius: 0.14 },
      adv: 'outer',
      vel: [0, 0.028],
      dir: { y: [0, 1.4] },
      half: [0, 0.075],
      scale: [0, 1, 1, 0.6],
      color: [0, 0xc4f0ff, 1, 0.6, 0x9ee4ff, 0.9, 1, 0x4a9ae0, 0],
      gravity: [0, 9],
      air: [0, 0.03],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 540, randomDir: true },
      blend: 'add',
      bright: 1.3,
      clamp: 1.1,
      tex: 'shard0',
      minTier: 1,
    },
    puffs([0, 0xa8d4f0, 0.3, 0.4, 0x88b8e0, 0.2, 1, 0x6890c0, 0], 2, 0.45, 0.4, 'smoke1', 'alpha'),
  ],
);

const LIGHTNING: FxSpec = hitSpec(
  'hit.lightning',
  'Lightning hit: jagged blue-white bolts re-struck around the body for ~0.25 s over an indigo flash that keeps its colour on snow',
  [
    {
      kind: 'particle',
      note: 'indigo flash body (alpha): a deep blue glow behind the bolts so they read on snow',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.26],
      half: [0, 0.6],
      scale: [0, 0.7, 0.25, 1, 1, 1.08],
      color: [0, 0x3428b8, 0.8, 0.3, 0x2820a0, 0.6, 1, 0x1a1870, 0],
      billboard: 'screen',
      blend: 'alpha',
      tex: 'glow',
    },
    {
      kind: 'particle',
      note: 'blow_electric 1-6 -> vfx_hit_bolt (4-frame sheet): bolts re-struck over 0.22 s, each flickering through the frames',
      cycle: 0.26,
      max: 4,
      rate: [0, 48, 0.2, 30, 0.26, 0],
      life: [0, 0.13],
      shape: { kind: 'sphere', radius: 0.14 },
      half: [0, 1.0],
      scale: [[0, 1, 1, 1.12], [0, 0.6, 1, 0.7]],
      color: [0, 0xc4d0ff, 1, 0.45, 0xa8b8ff, 1, 1, 0x7a80ff, 0],
      billboard: 'screen',
      rotation: { start: [0, 360] },
      blend: 'add',
      bright: 1.8,
      clamp: 1.5,
      tex: ART_BOLT,
      frames: { fps: 0, random: true },
    },
    {
      kind: 'particle',
      note: 'blue rim flash on the body: short glow, flickers with the bolts',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.2],
      half: [0, 0.6],
      scale: [0, 0.8, 0.25, 1, 1, 1.1],
      color: [0, 0x90a0ff, 0.7, 0.2, 0x7a8cff, 0.55, 0.5, 0x6a74ff, 0.35, 1, 0x4a50e0, 0],
      billboard: 'screen',
      blend: 'add',
      occlude: 0.4,
      clamp: 1,
      tex: 'glow',
    },
    streakSparks([0, 0xd0d8ff, 1, 0.5, 0xa0a8ff, 0.9, 1, 0x7a80ff, 0], 6, 0.08),
  ],
);

const DARK: FxSpec = hitSpec(
  'hit.dark',
  'Dark hit: a violet void-ink splash with curling tendrils over a near-black smudge that stays dark on snow, pink-violet star glints',
  [
    {
      kind: 'particle',
      note: 'dark underlay (alpha): a dense near-black smudge under the glow, the dark core that also reads on snow',
      cycle: 0.05,
      max: 2,
      rate: [0, 600],
      life: [0, 0.4],
      shape: { kind: 'sphere', radius: 0.1 },
      adv: 'outer',
      vel: [0, 0.004],
      half: [0, 0.6],
      scale: [0, 0.45, 0.25, 1, 1, 1.1],
      color: [0, 0x0e0418, 0.96, 0.55, 0x160824, 0.78, 1, 0x1a0a2c, 0],
      billboard: 'screen',
      rotation: { start: [0, 360] },
      blend: 'alpha',
      tex: ART_PUFF,
    },
    {
      kind: 'particle',
      note: '15 / 14 -> vfx_hit_ink: violet ink splash bursting out with tendrils, glowing rim',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.32],
      half: [0, 0.7],
      scale: [0, 0.5, 0.25, 1, 1, 1.1],
      color: [0, 0xb078ff, 0.85, 0.3, 0x9658e8, 0.7, 0.7, 0x5a20b0, 0.3, 1, 0x2a0a60, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'add',
      bright: 1.1,
      occlude: 0.6,
      clamp: 1.1,
      tex: ART_INK,
    },
    {
      kind: 'particle',
      note: '15_star / 15-starsmall -> sparkle: pink-violet glints around the splash',
      cycle: 0.1,
      max: 5,
      rate: [0, 120],
      life: [0, 0.3],
      shape: { kind: 'sphere', radius: 0.42 },
      half: [0, 0.13],
      scale: [0, 0.4, 0.3, 1, 1, 0.3],
      color: [0, 0xf8a8e8, 1, 0.5, 0xf391db, 0.9, 1, 0x9a50e0, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 258, randomDir: true },
      blend: 'add',
      bright: 1.4,
      clamp: 1.1,
      tex: 'sparkle',
      minTier: 1,
    },
    coreCloud([0, 0x8a40d0, 0.75, 0.5, 0x6030a8, 0.5, 1, 0x381070, 0], 0.3, 0.15),
    streakSparks([0, 0xe0a8ff, 1, 0.5, 0xbd56f9, 0.9, 1, 0x6a20c0, 0], 4, 0.055),
  ],
);

const POISON: FxSpec = hitSpec(
  'hit.poison',
  'Poison hit: a grainy acid-green sludge splash with flung droplets and a sickly gas puff (no bubble outlines)',
  [
    {
      kind: 'particle',
      note: 'toxic body (alpha): the solid green mass of the blob, so the poison keeps its colour on snow',
      cycle: 0.05,
      max: 2,
      rate: [0, 600],
      shape: { kind: 'sphere', radius: 0.07 },
      adv: 'outer',
      vel: [0, 0.003],
      life: [0, 0.4],
      half: [0, 0.6],
      scale: [0, 0.45, 0.2, 0.95, 1, 1.08],
      color: [0, 0x2a9014, 0.97, 0.65, 0x23780f, 0.7, 1, 0x1a5a14, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 30, randomDir: true },
      blend: 'alpha',
      tex: ART_TOXIC,
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.4],
      half: [0, 0.6],
      scale: [0, 0.45, 0.2, 0.95, 1, 1.1],
      color: [0, 0xb8f870, 0.65, 0.25, 0x98f048, 0.6, 0.65, 0x50d020, 0.4, 1, 0x1a6a10, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 30, randomDir: true },
      blend: 'add',
      bright: 1.1,
      occlude: 0.6,
      clamp: 1.0,
      tex: ART_TOXIC,
    },
    coreCloud([0, 0x88e838, 0.8, 0.5, 0x58c828, 0.6, 1, 0x2a8a20, 0], 0.3, 0.15),
    {
      kind: 'particle',
      note: 'droplets: solid round green drops thrown up and falling (filled glow discs, no outlines)',
      cycle: 0.05,
      max: 6,
      rate: [0, 600],
      life: [0, 0.45],
      shape: { kind: 'sphere', radius: 0.14 },
      adv: 'outer',
      vel: [0, 0.026],
      dir: { y: [0, 1.5] },
      half: [0, 0.065],
      scale: [0, 1, 1, 0.55],
      color: [0, 0xc0f880, 1, 0.6, 0x7ae040, 0.9, 1, 0x2a8a20, 0],
      gravity: [0, 9],
      air: [0, 0.03],
      billboard: 'screen',
      blend: 'add',
      bright: 1.3,
      clamp: 1.1,
      tex: 'dot',
      minTier: 1,
    },
    puffs([0, 0x4aa828, 0.5, 0.4, 0x3a8a24, 0.34, 1, 0x2a5a20, 0], 2, 0.5, 0.45, 'smoke1', 'alpha'),
  ],
);

const HOLY: FxSpec = hitSpec(
  'hit.holy',
  'Holy hit: a radiant gold halo (vfx_hit_holy: a thin ring readable on its own, a crown of fine rays, a bright heart) over a warm gold glow, motes drifting up; never a lens star, a white disc or the physical sunburst',
  [
    {
      kind: 'particle',
      note: '15-center (alpha): a warm gold glow body so the holy light keeps colour on snow',
      cycle: 0.05,
      max: 2,
      rate: [0, 600],
      shape: { kind: 'sphere', radius: 0.07 },
      adv: 'outer',
      vel: [0, 0.003],
      life: [0, 0.34],
      half: [0, 0.42],
      scale: [0, 0.5, 0.3, 1, 1, 1.05],
      color: [0, 0xd08c10, 0.7, 0.5, 0xc08420, 0.45, 1, 0x9a6a20, 0],
      billboard: 'screen',
      rotation: { start: [0, 360] },
      blend: 'alpha',
      tex: ART_PUFF,
    },
    {
      kind: 'particle',
      note: '15_star -> vfx_hit_holy: radiant halo burst (ring + tapered rays + sparkles), turning slowly, gold',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.27],
      half: [0, 0.9],
      scale: [0, 0.5, 0.2, 1, 1, 0.9],
      color: [0, 0xffd060, 1, 0.3, 0xffc040, 0.75, 0.6, 0xff9a30, 0.3, 0.88, 0xff9a30, 0.03, 1, 0xff9a30, 0],
      billboard: 'screen',
      rotation: { start: [-10, 10], spin: 40 },
      blend: 'add',
      bright: 1.5,
      occlude: 0.5,
      clamp: 1.05,
      tex: ART_HOLY,
    },
    coreCloud([0, 0xffc860, 0.8, 0.5, 0xffa840, 0.5, 1, 0xff8a30, 0], 0.28, 0.15),
    {
      kind: 'particle',
      note: '15-starsmall -> sparkle: motes rising and twinkling out',
      cycle: 0.12,
      max: 6,
      rate: [0, 120],
      life: [0, 0.55],
      shape: { kind: 'sphere', radius: 0.4 },
      dir: { y: [0, 1] },
      vel: [0, 1.2],
      half: [0, 0.11],
      scale: [0, 0.4, 0.3, 1, 1, 0.2],
      color: [0, 0xffe890, 1, 0.6, 0xffd060, 0.85, 1, 0xffa030, 0],
      air: [0, 0.03],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 180, randomDir: true },
      blend: 'add',
      bright: 1.3,
      clamp: 1.1,
      tex: 'sparkle',
      minTier: 1,
    },
  ],
);

const WIND: FxSpec = hitSpec(
  'hit.wind',
  'Wind hit: two curved air-slash crescents sweeping past the body, cyan going teal-blue, pale cyan streaks and a dust puff',
  [
    {
      kind: 'particle',
      note: 'gyeonggong_boom_02 (alpha copy): the crescents in real teal-blue, so they stay readable on snow (additive cyan washes out)',
      cycle: 0.06,
      max: 2,
      rate: [0, 400],
      life: [0, 0.34],
      half: [0, 0.8],
      scale: [0, 0.55, 0.3, 1, 1, 1.15],
      color: [0, 0x1488b8, 0.97, 0.4, 0x1470a8, 0.7, 1, 0x1a5a90, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 420 },
      blend: 'alpha',
      tex: ART_SLASH,
    },
    {
      kind: 'particle',
      note: 'gyeonggong_boom_02 / half_ring lines -> vfx_hit_slash: air-slash crescents sweeping round (spin), cyan -> teal blue',
      cycle: 0.06,
      max: 2,
      rate: [0, 400],
      life: [0, 0.34],
      half: [0, 0.8],
      scale: [0, 0.55, 0.3, 1, 1, 1.15],
      color: [0, 0x9afff0, 1, 0.25, 0x50e8ff, 0.95, 0.55, 0x2aa8ff, 0.7, 1, 0x2080d0, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 420 },
      blend: 'add',
      bright: 1.2,
      clamp: 1.05,
      tex: ART_SLASH,
    },
    coreCloud([0, 0x58e8f0, 0.7, 0.5, 0x38c8f0, 0.5, 1, 0x2870d0, 0], 0.26, 0.13),
    streakSparks([0, 0xc0fff8, 1, 0.5, 0x88f0f0, 0.85, 1, 0x40a0e0, 0], 6, 0.09),
    puffs([0, 0xc0b898, 0.3, 0.4, 0xa8a088, 0.2, 1, 0x908870, 0], 2, 0.45, 0.4, 'dust', 'alpha'),
  ],
);

/** hit.physical: the same blow as sk.gen.hit, spawned at body height by its caller (lift 0) */
const PHYSICAL: FxSpec = hitSpec(
  'hit.physical',
  'Physical hit: grainy cream fine-ray sunburst around a saturated ochre-orange core cloud and orange streaks',
  physicalElements(),
);

export const ELEMENT_HIT_SPECS: readonly FxSpec[] = [PHYSICAL, FIRE, ICE, LIGHTNING, DARK, POISON, HOLY, WIND];
