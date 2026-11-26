// Level-up and skill-up (common VFX target `levelup-heal`; owner: the levelup-heal builder), rebuilt r1 (2026-10-19) from the

// workflow: ../../spec/README.md; ids are the contract (../README.md).

// 5th level bigger (see LEVEL_UP below). The skill-up (SKILL_UP) and the helpers `one` / `strip` / `band` / `shell` (used by selfSpecs.ts) are unchanged.
//
// Camera facts that shaped the numbers (game camera: zoom 22, ~67 px per metre at the hero, hero ~100 px, hero marker ring
// ~140 px): a column must be >= 2 m wide and stand >= 6 m tall to read next to the ring; additive teal over snow only
// whitens, so every additive strip has an alpha-blended deep-teal body underneath (hue survives on white).
import type { FxSpec, ParticleSpec, SurfaceSpec } from '../../spec/types';
import {
  ART_DISC_WARM, ART_GLINT, ART_GLOW, ART_PIP, ART_RING_GLOW_BAND, ART_SKILLUP_COLUMN, ART_SPOKES, ART_STAR,
  ART_STREAK_BUNDLE, ART_WALL_A, ART_WALL_B, ART_WALL_C,
} from './art';

/** one particle at t0 (the `cycle 0.05 / max 1 / rate 60` idiom of the common specs) */
export function one(p: Omit<ParticleSpec, 'kind' | 'cycle' | 'max' | 'rate'> & { max?: number }): ParticleSpec {
  return { kind: 'particle', cycle: 0.05, rate: [0, 60], max: 1, ...p } as ParticleSpec;
}

// ---------------------------------------------------------------------------------------------------------------- level up
/** one upright strip of the level-up column (a ribbon strip): `x` m off the hero, `w` x `h` m, in at 0.05, out from 0.78 of its life */
export function strip(note: string, x: number, w: number, h: number, art: SurfaceSpec['tex'], blend: 'add' | 'alpha', hex: number, hex2: number, a: number, extra: Partial<SurfaceSpec> = {}): SurfaceSpec {
  return {
    kind: 'surface',
    note,
    life: 2.0,
    shape: { kind: 'card', w, h },
    at: [x, h / 2 - 0.55, 0],
    billboard: 'upright',
    attach: true,
    color: [0, hex, 0, 0.05, hex, a, 0.6, hex2, a * 0.92, 0.78, hex2, a * 0.6, 0.93, hex2, 0],
    blend,
    tex: art,
    ...extra,
  } as SurfaceSpec;
}


/**
 * One bright band of the level-up shell: a slightly curved card (`bend` rad across its width: concave toward the camera on the far side
 * of the hero, convex on the near side) standing `x` m right / `z` m toward the camera of the hero (the game camera has a FIXED yaw: screen
 * right = +X, the camera is on the +Z side), turned `yaw` deg; the strip sprite is a bundle of fine streaks with a bright core and dark soft
 * margins, so the empty space between two cards is a real dark gap. Colour keys as `strip` (in at 0.05, full to 0.78, out by ~0.93 of 2 s).
 */
export function band(note: string, x: number, z: number, yaw: number, w: number, h: number, bend: number, hex: number, hex2: number, a: number, extra: Partial<SurfaceSpec> = {}): SurfaceSpec {
  return {
    kind: 'surface',
    note,
    life: 2.0,
    shape: { kind: 'card', w, h, bend },
    at: [x, h / 2 - 0.55, z],
    rot: [yaw, 0, 0],
    billboard: 'none',
    attach: true,
    color: [0, hex, 0, 0.05, hex, a, 0.6, hex2, a * 0.92, 0.78, hex2, a * 0.6, 0.93, hex2, 0],
    blend: 'add',
    tex: ART_STREAK_BUNDLE,
    ...extra,
  } as SurfaceSpec;
}







export function shell(note: string, r: number, h: number, tile: number, art: SurfaceSpec['tex'], blend: 'add' | 'alpha', hex: number, hex2: number, a: number, extra: Partial<SurfaceSpec> = {}): SurfaceSpec {
  return {
    kind: 'surface',
    note,
    life: 2.0,
    shape: { kind: 'cyl', rb: r, rt: r * 0.96, h, span: 360 },
    at: [0, -0.6, 0],
    tile: [tile, 1],
    color: [0, hex, 0, 0.05, hex, a, 0.6, hex2, a * 0.92, 0.78, hex2, a * 0.6, 0.93, hex2, 0],
    blend,
    tex: art,
    soft: 0.04,
    ...extra,
  } as SurfaceSpec;
}

/** every `levelUp` event at a multiple of this plays the milestone version of the level-up (route.ts passes LEVEL_UP_MILESTONE_RANK) */
export const LEVEL_UP_MILESTONE_EVERY = 5;
/** the SpawnOpts.rank of a milestone level-up: the elements with `minRank: 3` (a 5 m ring that replaces the 3.5 m one, a second ring, a wider crown, more sparks) join in. Ranks only gate elements here: this spec has no per-grade keys */
export const LEVEL_UP_MILESTONE_RANK = 3;



















const LEVEL_UP: FxSpec = {
  id: 'sk.gen.level_up',
  desc: 'Level up: a hot gold-white core and a hub of thin light spokes flash under the hero, a crisp bright ring runs out to 3.5 m in 0.35 s, a flare pops at the chest and gold sparks rise; every 5th level adds a 5 m ring, a second ring, a wider crown and more sparks',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 1,
  dur: 1.3,
  follow: true,
  elements: [
    // ---- the shockwave: 3.5 m in 0.35 s (ring_glow_band_a: crest at 0.79, outer edge 0.94 of the quad half-width -> half 3.7 = 3.5 m).
    // Two layers on ONE crest: a deep-gold alpha body (every tier: the hue survives on snow, and an alpha layer cannot clip to white) and the additive
    // white-gold crest (medium and up: low has no composite pass, so additive layers clip there at once). The ring comes in late (alpha ~0.3 at 0.1 s):
    // the first frames belong to the hot core and the spokes, so the opening has contrast instead of a milky disc
    one({
      note: 'shockwave ring (alpha body): deep gold under the crest, so the ring keeps its hue on snow and pale stone',
      life: [0, 0.38],
      half: [0, 3.7],
      scale: [0, 0.14, 0.25, 0.55, 0.6, 0.86, 1, 1.0],
      color: [0, 0xd89018, 0, 0.3, 0xd89018, 0.3, 0.55, 0xd08818, 0.6, 0.8, 0xc88418, 0.4, 1, 0xb87810, 0],
      billboard: 'ground',
      attach: true,
      blend: 'alpha',
      maxRank: LEVEL_UP_MILESTONE_RANK - 1,
      tex: ART_RING_GLOW_BAND,
    }),
    one({
      note: 'shockwave ring (add): the bright white-gold crest, 3.5 m, 0.35 s, fast out and easing; held bright to the end of its run so the crest stays a crest',
      life: [0, 0.35],
      half: [0, 3.7],
      scale: [0, 0.14, 0.25, 0.55, 0.6, 0.86, 1, 1.0],
      color: [0, 0xffffff, 0, 0.3, 0xfff2c8, 0.4, 0.5, 0xffd870, 0.95, 0.8, 0xffc040, 0.6, 1, 0xffa020, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 1.4,
      clamp: 1.0,
      occlude: 0.15,
      maxRank: LEVEL_UP_MILESTONE_RANK - 1,
      minTier: 1,
      tex: ART_RING_GLOW_BAND,
    }),
    // ---- the hot opening: a small bright core under the hero and a hub of thin spokes (dark gaps between them: contrast, not a filled disc)
    one({
      note: 'core: a small hot white-gold flash on the floor under the hero (soft blob, 0.9 m, no occlude: nothing near the body is darkened), gone in 0.3 s',
      life: [0, 0.3],
      half: [0, 0.9],
      scale: [0, 0.6, 0.25, 1.0, 1, 1.1],
      color: [0, 0xffe8a8, 0.8, 0.3, 0xffd060, 0.5, 1, 0xff9e30, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      clamp: 1.0,
      tex: ART_GLOW,
    }),
    one({
      note: 'hot flash (medium and up): a small white-hot pop at the very centre of the core in the first 0.2 s, the hot foot flare of the opening frame (0.85 m: a point of heat with contrast, never a disc)',
      life: [0, 0.2],
      half: [0, 0.85],
      scale: [0, 0.7, 0.3, 1.0, 1, 1.1],
      color: [0, 0xffffff, 0.95, 0.4, 0xfff0c0, 0.6, 1, 0xffc860, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 1.2,
      clamp: 1.0,
      minTier: 1,
      tex: ART_GLOW,
    }),
    one({
      note: 'spokes: a hot hub with 14 thin spokes of light opening round the hero (starburst_spokes: real dark gaps between the spokes), spun a little, gone in 0.36 s',
      life: [0, 0.36],
      half: [0, 2.5],
      scale: [0, 0.3, 0.2, 0.95, 1, 1.1],
      color: [0, 0xfff4cc, 0, 0.06, 0xffe08a, 0.9, 0.5, 0xffc040, 0.5, 1, 0xff9020, 0],
      billboard: 'ground',
      rotation: { start: [0, 0], spin: 14 },
      attach: true,
      blend: 'add',
      bright: 1.4,
      clamp: 1.0,
      minTier: 1,
      tex: ART_SPOKES,
    }),
    {
      kind: 'surface',
      note: 'crown: a low wall of light shafts riding the ring outwards (shafts standing on the floor, flaring out, 0.9 m tall at most), gone with the ring; medium and up',
      life: 0.38,
      shape: { kind: 'cyl', rb: 2.8, rt: 3.3, h: 0.9, span: 360 },
      at: [0, -0.1, 0],
      scale: [[0, 0.2, 0.25, 0.55, 0.6, 0.86, 1, 1.0], [0, 0.55, 0.2, 1.0, 1, 0.8], [0, 0.2, 0.25, 0.55, 0.6, 0.86, 1, 1.0]],
      color: [0, 0xfff4cc, 0, 0.08, 0xffe28a, 1, 0.5, 0xffc040, 0.7, 1, 0xff9a30, 0],
      tile: [3, 1],
      blend: 'add',
      bright: 2.4,
      clamp: 1.2,
      soft: 0.04,
      minTier: 1,
      tex: ART_WALL_B,
    },
    one({
      note: 'flare: a four-point star pops at the chest (the hero guard dims it over the body), 0.26 s',
      life: [0, 0.26],
      half: [0, 1.3],
      scale: [0, 0.4, 0.25, 1.0, 1, 1.2],
      at: [0, 0.95, 0],
      color: [0, 0xffffff, 0.9, 0.4, 0xfff0b8, 0.5, 1, 0xffd070, 0],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      clamp: 1.0,
      tex: ART_STAR,
    }),
    one({
      note: 'afterglow (alpha): a warm gold pool left on the floor for ~0.9 s, the one soft thing that stays (1.5 m)',
      life: [0, 0.9],
      half: [0, 1.5],
      scale: [0, 0.7, 0.2, 1.0, 1, 1.05],
      color: [0, 0xe0a028, 0.5, 0.3, 0xd89820, 0.4, 0.7, 0xd08818, 0.2, 1, 0xc08010, 0],
      billboard: 'ground',
      attach: true,
      blend: 'alpha',
      tex: ART_DISC_WARM,
    }),
    // ---- sparks: gold #ffd36a / white lifting off the floor
    {
      kind: 'particle',
      note: 'rising glints: gold-white sparks lifting off the floor round the hero (halo + hair rays)',
      t0: 0.04,
      cycle: 0.5,
      max: 22,
      rate: [0, 70, 0.4, 45, 0.5, 0],
      life: [0, 1.0],
      shape: { kind: 'ellipse', radius: 1.7, edge: false },
      at: [0, 0.1, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.03, 0.5, 0.016],
      half: [0, 0.27],
      scale: [0, 0.5, 0.2, 1, 1, 0.3],
      color: [0, 0xffffff, 0, 0.12, 0xfff6d0, 1, 0.6, 0xffd36a, 0.8, 1, 0xffb030, 0],
      billboard: 'screen',
      rotation: { start: [0, 90], spin: 60, randomDir: true },
      blend: 'add',
      bright: 1.3,
      tex: ART_GLINT,
    },
    {
      kind: 'particle',
      note: 'pips: small round gold sparks thrown up faster from the rim of the ring, braking as they climb; medium and up',
      t0: 0.02,
      cycle: 0.5,
      max: 18,
      rate: [0, 50, 0.4, 30, 0.5, 0],
      life: [0, 0.8],
      shape: { kind: 'ellipse', radius: 2.4, edge: false },
      at: [0, 0.05, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.045],
      air: [0, 0.04],
      half: [0, 0.1],
      scale: [0, 0.8, 0.5, 1, 1, 0.2],
      color: [0, 0xffffff, 0, 0.1, 0xffe9a0, 1, 0.6, 0xffd36a, 0.7, 1, 0xffb030, 0],
      billboard: 'screen',
      blend: 'add',
      bright: 1.4,
      minTier: 1,
      tex: ART_PIP,
    },
    // ---- every 5th level (route.ts: rank 3): a bigger ring, a second ring a beat behind, a wider crown, more sparks
    one({
      note: 'milestone ring (alpha body) 5 m: it REPLACES the 3.5 m ring (maxRank on that one), so the two rims never stack into a white disc; a light body, so the inner floor stays clear',
      life: [0, 0.55],
      half: [0, 5.3],
      scale: [0, 0.1, 0.25, 0.52, 0.6, 0.85, 1, 1.0],
      color: [0, 0xd89018, 0, 0.3, 0xd89018, 0.28, 0.6, 0xd08818, 0.45, 0.85, 0xc88418, 0.25, 1, 0xb87810, 0],
      billboard: 'ground',
      attach: true,
      blend: 'alpha',
      minRank: LEVEL_UP_MILESTONE_RANK,
      tex: ART_RING_GLOW_BAND,
    }),
    one({
      note: 'milestone ring (add): the bigger white-gold crest, 5 m in 0.5 s (ring_glow_band_a: outer edge 0.94 of the half-width -> half 5.3)',
      life: [0, 0.5],
      half: [0, 5.3],
      scale: [0, 0.1, 0.25, 0.52, 0.6, 0.85, 1, 1.0],
      color: [0, 0xffffff, 0, 0.3, 0xfff2c8, 0.4, 0.5, 0xffd870, 0.85, 0.8, 0xffc040, 0.5, 1, 0xffa020, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 1.3,
      clamp: 1.0,
      occlude: 0.15,
      minRank: LEVEL_UP_MILESTONE_RANK,
      minTier: 1,
      tex: ART_RING_GLOW_BAND,
    }),
    one({
      note: 'milestone second ring: the same crest, smaller (4.4 m) and a beat behind the first; medium and up',
      t0: 0.14,
      life: [0, 0.45],
      half: [0, 4.7],
      scale: [0, 0.1, 0.25, 0.55, 0.6, 0.86, 1, 1.0],
      color: [0, 0xffffff, 0, 0.1, 0xfff0c0, 0.7, 0.5, 0xffd36a, 0.5, 1, 0xff9a30, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 1.2,
      clamp: 1.0,
      minRank: LEVEL_UP_MILESTONE_RANK,
      minTier: 1,
      tex: ART_RING_GLOW_BAND,
    }),
    {
      kind: 'surface',
      note: 'milestone crown: the shaft wall of the 5 m ring (<= 1.1 m tall), a beat behind the first crown; medium and up',
      t0: 0.04,
      life: 0.5,
      shape: { kind: 'cyl', rb: 4.1, rt: 4.8, h: 1.1, span: 360 },
      at: [0, -0.1, 0],
      scale: [[0, 0.2, 0.25, 0.52, 0.6, 0.85, 1, 1.0], [0, 0.5, 0.2, 1.0, 1, 0.8], [0, 0.2, 0.25, 0.52, 0.6, 0.85, 1, 1.0]],
      color: [0, 0xfff4cc, 0, 0.08, 0xffe28a, 0.8, 0.5, 0xffc040, 0.5, 1, 0xff9a30, 0],
      tile: [4, 1],
      uv: [[0, 0, 1, 0.1], [0, 0]],
      blend: 'add',
      bright: 1.4,
      clamp: 1.05,
      soft: 0.04,
      minRank: LEVEL_UP_MILESTONE_RANK,
      minTier: 1,
      tex: ART_WALL_A,
    },
    {
      kind: 'particle',
      note: 'milestone sparks: a second, wider flock of gold-white glints lifting a beat later',
      t0: 0.16,
      cycle: 0.6,
      max: 18,
      rate: [0, 50, 0.5, 30, 0.6, 0],
      life: [0, 1.1],
      shape: { kind: 'ellipse', radius: 2.8, edge: false },
      at: [0, 0.1, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.034, 0.6, 0.018],
      half: [0, 0.3],
      scale: [0, 0.5, 0.2, 1, 1, 0.3],
      color: [0, 0xffffff, 0, 0.12, 0xfff6d0, 1, 0.6, 0xffd36a, 0.8, 1, 0xffb030, 0],
      billboard: 'screen',
      rotation: { start: [0, 90], spin: 60, randomDir: true },
      blend: 'add',
      bright: 1.4,
      minRank: LEVEL_UP_MILESTONE_RANK,
      tex: ART_GLINT,
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------------- skill up













const SKILL_UP: FxSpec = {
  id: 'sk.gen.skillup',
  desc: 'Skill rank-up burst: orange-to-blue gradient column, smooth floor bands, and short gold spike fringe',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 1,
  dur: 1.0,
  follow: true,
  elements: [
    {
      kind: 'surface',
      note: 'aroundcylinder copy (add): narrow orange -> pale-blue streak column round the body (cylinder shell; the gradient is in the sprite)',
      life: 0.7,
      shape: { kind: 'cyl', rb: 0.6, rt: 0.52, h: 7, span: 360 },
      at: [0, -0.6, 0],
      color: [0, 0xffe8d0, 0, 0.07, 0xffe0c8, 0.55, 0.4, 0xa8c4ff, 0.45, 0.85, 0x90b0ff, 0],
      tile: [3, 1],
      uv: [[0, 0, 1, 0.3], [0, 0]],
      blend: 'add',
      bright: 1.05,
      occlude: 0.45,
      clamp: 0.9,
      soft: 0.1,
      tex: ART_SKILLUP_COLUMN,
    },
    {
      kind: 'surface',
      note: 'second, thinner shell turning back: more bright streaks inside the column',
      t0: 0.03,
      life: 0.62,
      shape: { kind: 'cyl', rb: 0.4, rt: 0.34, h: 5.5, span: 360 },
      at: [0, -0.6, 0],
      color: [0, 0xffe8d0, 0, 0.08, 0xffe4d0, 0.45, 0.45, 0xc0d4ff, 0.35, 0.85, 0xa8c4ff, 0],
      tile: [2, 1],
      uv: [[0, 0, 1, -0.3], [0, 0]],
      blend: 'add',
      bright: 1.2,
      occlude: 0.2,
      clamp: 1.1,
      soft: 0.1,
      tex: ART_SKILLUP_COLUMN,
      minTier: 1,
    },
    one({
      note: 'blue-white bubble at the feet (alpha body): deep-blue pool, the blue spot of the in-client column (blue on snow too)',
      life: [0, 0.65],
      half: [0, 0.85],
      scale: [0, 0.5, 0.25, 1.0, 1, 1.08],
      color: [0, 0x2c6cff, 0.55, 0.4, 0x2058ff, 0.4, 1, 0x1040c8, 0],
      billboard: 'ground',
      attach: true,
      blend: 'alpha',
      tex: ART_DISC_WARM,
    }),
    one({
      note: 'blue-white bubble (add): a hot pale-blue core',
      life: [0, 0.6],
      half: [0, 0.8],
      scale: [0, 0.5, 0.25, 1.0, 1, 1.05],
      color: [0, 0xffffff, 0.8, 0.3, 0xb8dcff, 0.6, 1, 0x5aa0ff, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      clamp: 1.0,
      minTier: 1,
      tex: ART_GLOW,
    }),
    one({
      note: 'skillaround: the orange band on the floor, smooth and glowing (alpha under-layer: saturated orange on snow too)',
      life: [0, 0.62],
      half: [0, 1.0],
      scale: [0, 0.35, 0.4, 0.9, 1, 1.05],
      color: [0, 0xf07a0c, 0.7, 0.35, 0xe86a08, 0.45, 1, 0xc85806, 0],
      billboard: 'ground',
      attach: true,
      blend: 'alpha',
      tex: ART_RING_GLOW_BAND,
    }),
    one({
      note: 'skillaround (add): the big ORANGE glowing band, #ffb468 -> #ff7f2b',
      life: [0, 0.6],
      half: [0, 1.0],
      scale: [0, 0.35, 0.4, 0.92, 1, 1.08],
      color: [0, 0xffb468, 1, 0.3, 0xff9030, 0.85, 0.68, 0xff7f2b, 0.4, 1, 0xff5a08, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 1.5,
      occlude: 0.2,
      clamp: 1.1,
      tex: ART_RING_GLOW_BAND,
    }),
    one({
      note: 'skillaround 2: the smaller BLUE band hugging the feet, #2090ff -> #52a9ff (alpha under-layer)',
      life: [0, 0.65],
      half: [0, 0.65],
      scale: [0, 0.35, 0.4, 0.9, 1, 1.08],
      color: [0, 0x1c5ce0, 0.7, 0.3, 0x1c5ce0, 0.5, 1, 0x1040b8, 0],
      billboard: 'ground',
      attach: true,
      blend: 'alpha',
      tex: ART_RING_GLOW_BAND,
    }),
    one({
      note: 'skillaround 2 (add): the BLUE glowing band',
      life: [0, 0.65],
      half: [0, 0.65],
      scale: [0, 0.35, 0.4, 0.9, 1, 1.08],
      color: [0, 0x6ab8ff, 1, 0.3, 0x2090ff, 0.9, 0.77, 0x2a78ff, 0.4, 1, 0x2060ff, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      bright: 1.5,
      occlude: 0.2,
      clamp: 1.1,
      tex: ART_RING_GLOW_BAND,
    }),
    {
      kind: 'surface',
      note: 'gold fringe: a short crown of thin spikes round the bubble (a low cone of ragged shafts), snaps out and is gone with the column',
      life: 0.55,
      shape: { kind: 'cyl', rb: 0.6, rt: 1.0, h: 0.55, span: 360 },
      at: [0, -0.06, 0],
      scale: [[0, 0.5, 0.12, 1.0, 1, 1.06], [0, 0.6, 0.12, 1.0, 1, 1.0], [0, 0.5, 0.12, 1.0, 1, 1.06]],
      color: [0, 0xffe0a0, 0, 0.08, 0xffc860, 1, 0.5, 0xffa030, 0.7, 1, 0xff7a18, 0],
      tile: [1, 1],
      blend: 'add',
      bright: 1.7,
      occlude: 0.2,
      clamp: 1.05,
      soft: 0.04,
      tex: ART_WALL_C,
    },
    {
      kind: 'particle',
      note: 'rising glints: warm at the feet, pale blue higher up',
      t0: 0.04,
      cycle: 0.55,
      max: 12,
      rate: [0, 24],
      life: [0, 0.6],
      shape: { kind: 'ellipse', radius: 0.7, edge: false },
      at: [0, 0.15, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.03],
      half: [0, 0.26],
      scale: [0, 0.6, 0.3, 1, 1, 0.4],
      color: [0, 0xffe0a0, 0, 0.2, 0xffc878, 1, 0.55, 0xd8e0ff, 0.8, 1, 0x92b6ff, 0],
      billboard: 'screen',
      rotation: { start: [0, 90], spin: 50, randomDir: true },
      blend: 'add',
      bright: 1.4,
      tex: ART_GLINT,
    },
  ],
};

export const levelSpecs: FxSpec[] = [LEVEL_UP, SKILL_UP];
