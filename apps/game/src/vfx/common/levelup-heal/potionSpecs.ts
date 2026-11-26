

//


// soft ellipse of fine streaks, no spikes) - then 15 hp_ring / sp_ring HOLLOW circles (0.08 m!) rising and swirling past the head over
// 0.79 s, visible together with the skirt (t0.1 - 0.4 in the in-client strip). autodrugup = the OTHER family: a low JAGGED fringe of

// r3 (blind critic of r2: "all four drug-ups are one jagged flame / grass-blade crown recoloured; the hollow rings only appear after the crown
// dies; the auto potions are thin flat ground rings with no fringe or dome, lost at game camera and on snow"):
//  - drug-up = SMOOTH frosted skirt: a billowing cloud band (vfx_cloudband_billow_a, soft puffy top, no blades) on cylinders round the legs,
//    a dense fine-streak veil (vfx_levelup_heal_body_streaks) in the same hue and a dark alpha body of the hue (colour on snow); the rings start
//    at t0 and are up past the head at t0.2 while the skirt is still there;
//  - auto potion = the jagged fringe: a low cone of ragged shafts (light00) + a SPLASH DOME of flame-like strands (vfx_splash_dome_top_a,
//    upright, 2.4 m) standing round the feet in the hue (with a dark alpha copy so it reads on snow), a bristling ground splash, rings.
import type { FxSpec, ParticleSpec, SurfaceSpec } from '../../spec/types';
import {
  ART_BODY_STREAKS, ART_BRISTLE, ART_CLOUDBAND, ART_GLINT, ART_RING_GRAIN, ART_RIM_BLUE, ART_RIM_RED, ART_SPLASH_DOME, ART_WALL_B, ART_WALL_C,
} from './art';
import { one } from './levelSpecs';

interface PotionSet {
  name: string;
  what: string;
  /** saturated additive hues of the two skirt passes */
  band: readonly [number, number];
  /** darker body of the same hue (alpha layer: what survives on snow) */
  body: number;
  /** ring colours: bright / mid / pale */
  ring: readonly [number, number, number];
  rim: typeof ART_RIM_RED;
  /** skirt shape: height, radius at the ankles / at the top, cloud tiles of the two passes, u scroll per life (each potion has its own silhouette and motion) */
  h: number;
  rb: number;
  rt: number;
  tiles: readonly [number, number];
  scroll: number;
}

const POTIONS: readonly PotionSet[] = [
  { name: 'red', what: 'HP potion', band: [0xff3a22, 0xff6a44], body: 0xb81010, ring: [0xff3a30, 0xff6a5a, 0xffb0a0], rim: ART_RIM_RED, h: 1.45, rb: 0.62, rt: 0.98, tiles: [2, 3], scroll: 0.5 },
  { name: 'blue', what: 'SP potion', band: [0x2c58ff, 0x4a88ff], body: 0x1020b8, ring: [0x3a58ff, 0x6a88ff, 0xb0c0ff], rim: ART_RIM_BLUE, h: 1.3, rb: 0.66, rt: 1.08, tiles: [3, 4], scroll: -0.6 },
  { name: 'green', what: 'speed potion', band: [0x28f040, 0x68ff38], body: 0x0c7a20, ring: [0x40d848, 0x80f070, 0xc8ffb8], rim: ART_RIM_RED, h: 1.65, rb: 0.56, rt: 0.88, tiles: [2, 3], scroll: 1.1 },
  { name: 'purple', what: 'attack-speed (dx) potion', band: [0xd838ff, 0xf068ff], body: 0x8018a8, ring: [0xe040ff, 0xf070ff, 0xffb8f4], rim: ART_RIM_BLUE, h: 1.4, rb: 0.6, rt: 1.0, tiles: [4, 5], scroll: -0.9 },
];

/** potion aura scale keys (pinch then flare) */
const DRUG_SCALE = [0, 0.92, 0.35, 0.86, 1, 1.1];
const SKIRT_LIFE = [0, 0.7, 0.3, 1.0, 1, 1.0];

function potion(p: PotionSet): FxSpec {
  const skirt = (t0: number, life: number, k: number, a: Partial<SurfaceSpec> & Pick<SurfaceSpec, 'note' | 'blend' | 'tex' | 'color' | 'tile'>): SurfaceSpec => ({
    kind: 'surface',
    t0,
    life,
    shape: { kind: 'cyl', rb: p.rb * k, rt: p.rt * k, h: p.h, span: 360 },
    at: [0, -0.06, 0],
    scale: [DRUG_SCALE, SKIRT_LIFE, DRUG_SCALE],
    soft: 0.06,
    ...a,
  });
  const fade = (hex: number, a: number): number[] => [0, hex, 0, 0.14, hex, a, 0.62, hex, a * 0.8, 1, hex, 0];
  const sparkles: ParticleSpec = {
    kind: 'particle',
    note: 'hp_ring / sp_ring: tiny HOLLOW circles rising and swirling past the head, up together with the skirt (t0.1 - 0.4)',
    t0: 0.0,
    cycle: 0.4,
    max: 12,
    rate: [0, 40],
    life: [0.003, 0.62, 0.4, 0.5],
    shape: { kind: 'ellipse', radius: 0.5, edge: false },
    at: [0, 0.3, 0],
    dir: { y: [0, 100] },
    jitter: [0.03, 0, 0.03],
    vel: [0, 0.03, 0.5, 0.03],
    half: [0, 0.095],
    scale: [0, 0.6, 0.2, 1, 1, 0.7],
    color: [0, p.ring[0], 0, 0.12, p.ring[1], 1, 0.5, p.ring[1], 1, 1, p.ring[2], 0],
    billboard: 'screen',
    swirl: [0, 9.6, 0.166, -1.5],
    attach: true,
    blend: 'add',
    bright: 2.2,
    clamp: 1.5,
    tex: p.rim,
  };
  return {
    id: `sk.gen.potion_${p.name}`,
    desc: `Potion (${p.what}): a smooth frosted ${p.name} skirt round the legs from the feet to the hips (dark ${p.name} body under it), tiny hollow ${p.name} circles rising past the head together with it`,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.8,
    follow: true,
    elements: [
      skirt(0, 0.56, 1.03, {
        note: 'skirt alpha body: a DARK shade of the potion hue in the billowing cloud band, so the skirt stays saturated on stone and on snow',
        color: fade(p.body, 0.85),
        tile: [p.tiles[0], 0.44],
        uv: [[0, 0, 1, -0.3], [0, 0.28]],
        blend: 'alpha',
        tex: ART_CLOUDBAND,
      }),
      skirt(0.02, 0.54, 1.04, {
        note: 'dark fine-streak veil (alpha): the frosted grain of upellipse in a dark shade of the hue',
        color: fade(p.body, 0.6),
        tile: [5, 1],
        uv: [[0, 0, 1, 0.25], [0, 0]],
        blend: 'alpha',
        tex: ART_BODY_STREAKS,
      }),
      skirt(0, 0.56, 1, {
        note: '',
        color: fade(p.band[0], 0.95),
        tile: [p.tiles[0], 0.44],
        uv: [[0, 0, 1, p.scroll * 0.4], [0, 0.28]],
        blend: 'add',
        bright: 1.8,
        occlude: 0.3,
        clamp: 1.2,
        tex: ART_CLOUDBAND,
      }),
      skirt(0.04, 0.5, 1.02, {
        note: 'fine streaks standing in the skirt (add): the grain of the frosted band',
        color: fade(p.band[1], 0.7),
        tile: [5, 1],
        uv: [[0, 0, 1, p.scroll * 0.5], [0, 0]],
        blend: 'add',
        bright: 1.5,
        occlude: 0.15,
        clamp: 1.15,
        tex: ART_BODY_STREAKS,
      }),
      skirt(0.08, 0.5, 1.12, {
        note: 'potion aura second pass (add), a little wider and later: the second upellipse band',
        color: fade(p.band[1], 0.8),
        tile: [p.tiles[1], 0.44],
        uv: [[0, 0, 1, -p.scroll * 0.4], [0, 0.28]],
        blend: 'add',
        bright: 1.5,
        occlude: 0.2,
        clamp: 1.15,
        tex: ART_CLOUDBAND,
      }),
      one({
        note: 'contact ring: a thin grainy ring of the potion colour where the skirt meets the floor (the only floor part, no pool)',
        t0: 0.02,
        life: [0, 0.5],
        half: [0, 1.0],
        scale: [0, 0.55, 0.4, 0.95, 1, 1.2],
        color: [0, p.ring[1], 0.9, 0.5, p.ring[0], 0.55, 1, p.body, 0],
        billboard: 'ground',
        attach: true,
        blend: 'add',
        occlude: 0.25,
        clamp: 1.2,
        tex: ART_RING_GRAIN,
      }),
      sparkles,
      {
        kind: 'particle',
        note: 'a few bright glints among the circles',
        t0: 0.05,
        cycle: 0.4,
        max: 5,
        rate: [0, 14],
        life: [0, 0.45],
        shape: { kind: 'ellipse', radius: 0.45, edge: false },
        at: [0, 0.5, 0],
        dir: { y: [0, 100] },
        vel: [0, 0.03],
        half: [0, 0.14],
        scale: [0, 0.6, 0.3, 1, 1, 0.3],
        color: [0, 0xffffff, 0, 0.2, p.ring[2], 1, 1, p.ring[1], 0],
        billboard: 'screen',
        rotation: { start: [0, 90], spin: 60, randomDir: true },
        blend: 'add',
        tex: ART_GLINT,
        minTier: 1,
      },
    ],
  };
}

interface AutoSet {
  name: 'red' | 'blue';
  ring: readonly [number, number];
  body: number;
  sparks: readonly [number, number, number];
  rim: typeof ART_RIM_RED;
}

const AUTO_POTIONS: readonly AutoSet[] = [
  { name: 'red', ring: [0xff6a18, 0xff2a10], body: 0xa81408, sparks: [0xff6a20, 0xff4a10, 0xff2a30], rim: ART_RIM_RED },
  { name: 'blue', ring: [0x2a9cff, 0x1068ff], body: 0x0c30b0, sparks: [0x3a8aff, 0x4a78ff, 0x4a58ff], rim: ART_RIM_BLUE },
];

function autoPotion(p: AutoSet): FxSpec {
  // potion ground ring: a ring flaring out at the foot (r 1.29 -> 0.74), the scale keys of the mesh animation
  const DRUG_LINE = [0, 0.7, 0.33, 0.55, 0.67, 0.8, 1, 1];
  const fringe = (t0: number, life: number, hex: number, tile: number, tex: SurfaceSpec['tex'], blend: 'add' | 'alpha', note: string, k: number, h: number, bright: number): SurfaceSpec => ({
    kind: 'surface',
    note,
    t0,
    life,
    // a LOW jagged fringe: narrow at the ankles, opening to ~1.1 m radius at the tips of the shafts (the light00 fringe of the foot)
    shape: { kind: 'cyl', rb: 0.5 * k, rt: 1.1 * k, h, span: 360 },
    at: [0, -0.06, 0],
    scale: [DRUG_LINE, [0, 0.75, 0.4, 1.0, 1, 1.0], DRUG_LINE],
    color: [0, hex, 0, 0.1, hex, blend === 'alpha' ? 0.85 : 1, 0.55, hex, blend === 'alpha' ? 0.7 : 0.85, 1, hex, 0],
    tile: [tile, 1],
    uv: [[0, 0, 1, 0.35], [0, 0]],
    blend,
    ...(blend === 'add' ? { bright, occlude: 0.3, clamp: 1.3 } : {}),
    soft: 0.05,
    tex,
  });
  return {
    id: `sk.gen.potion_auto_${p.name}`,
    desc: `Auto potion (${p.name}): a low jagged ${p.name} fringe of fire-like light streaks and a flame-strand splash dome standing round the feet (dark ${p.name} copy under it), a bristling ground splash, hollow circles bursting up`,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.8,
    follow: true,
    elements: [
      one({
        note: 'splash dome (alpha copy): dark flame strands of the dome so the fringe keeps its hue on snow',
        life: [0, 0.5],
        half: [[0, 1.2], [0, 0.58]],
        scale: [0, 0.5, 0.25, 1.0, 1, 1.08],
        at: [0, 0.5, 0],
        color: [0, p.body, 0.1, 0.12, p.body, 0.85, 0.55, p.body, 0.7, 1, p.body, 0],
        billboard: 'upright',
        attach: true,
        blend: 'alpha',
        tex: ART_SPLASH_DOME,
      }),
      one({
        note: 'splash dome (add): the flame-strand dome standing round the feet (the splash dome on the blue auto potion)',
        life: [0, 0.46],
        half: [[0, 1.2], [0, 0.58]],
        scale: [0, 0.5, 0.25, 1.0, 1, 1.08],
        at: [0, 0.5, 0],
        color: [0, p.ring[0], 0, 0.1, p.ring[0], 1, 0.5, p.ring[1], 0.8, 1, p.ring[1], 0],
        billboard: 'upright',
        attach: true,
        blend: 'add',
        bright: 2.0,
        occlude: 0.2,
        clamp: 1.3,
        tex: ART_SPLASH_DOME,
      }),
      fringe(0, 0.44, p.body, 3, ART_WALL_B, 'alpha', 'light00 fringe, alpha copy: the dark ragged shafts (the fringe stays dark red / blue on snow)', 1.04, 0.95, 0),
      fringe(0, 0.46, p.ring[1], 2, ART_WALL_B, 'add', 'the jagged fringe of fire-like streaks round the foot', 1, 0.95, 3.0),
      fringe(0.05, 0.4, p.ring[0], 3, ART_WALL_C, 'add', 'potion ground ring second pass: a lower, denser ragged fringe a beat later', 0.9, 0.6, 3.0),
      one({
        note: 'ground splash: a bristling ring of the potion colour where the fringe lands',
        life: [0, 0.5],
        half: [0, 1.3],
        scale: [0, 0.45, 0.3, 1.0, 1, 1.12],
        color: [0, p.ring[0], 0.7, 0.45, p.ring[1], 0.45, 1, p.body, 0],
        billboard: 'ground',
        rotation: { start: [0, 0], spin: 60 },
        attach: true,
        blend: 'add',
        bright: 1.2,
        occlude: 0.25,
        clamp: 1.15,
        tex: ART_BRISTLE,
      }),
      {
        kind: 'particle',
        note: 'hp_ring: tiny hollow circles bursting up and out round the body, from the first frame',
        t0: 0.0,
        cycle: 0.4,
        max: 12,
        rate: [0, 44],
        life: [0, 0.62],
        shape: { kind: 'sphere', radius: 0.5, edge: true },
        at: [0, 0.55, 0],
        adv: 'outer',
        dir: { y: [0, 140, 0.3, 60] },
        jitter: [0.01, 0.01, 0.01],
        vel: [0, 0.012],
        half: [0, 0.095],
        scale: [0, 0.5, 0.2, 1, 1, 0.6],
        color: [0, p.sparks[0], 0, 0.1, p.sparks[0], 1, 0.4, p.sparks[1], 1, 1, p.sparks[2], 0],
        air: [0, 0.03],
        billboard: 'screen',
        swirl: [0, 15],
        attach: true,
        blend: 'add',
        bright: 2.2,
        clamp: 1.5,
        tex: p.rim,
      },
    ],
  };
}

export const potionSpecs: FxSpec[] = [...POTIONS.map(potion), ...AUTO_POTIONS.map(autoPotion)];
