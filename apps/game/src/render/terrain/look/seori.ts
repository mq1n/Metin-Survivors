import { decal } from '../terrainDecals';
import type { ZoneLook } from './types';


// #c3cbd4, gameplay-camera luma ~172 sat ~22), dark slate ridge corridors, wide soft grey gravel tracks, small pale glittering ice patches,
// hard readable cast shadows of a few big trees (sun 48.7 deg from the WNW), fog #aeb0ba, no falling-snow stickers, no water.
// Ground layers (recipe order, see world/zones/seori.ts): 0 snow · 1 snow (whiter) · 2 gravel · 3 slate (cliffs) · 4 ice patch ·
// 5 scoured earth · 6 hillshade (the snow tile graded cool: the lee flank of the hummocks) · 7 mire. Tree shadows are the zones-core crown
// shadows (shadow.trees below), not paint. Core1 round (2026-10-22): trails are narrow winding bands of tex_seori_trail_b, the boss pads are clean snow.
export const SEORI_LOOK: ZoneLook = {
  
  
  biome: {
    fog: { color: '#aeb0ba', near: 110, far: 400 },
    sky: { top: '#7f8aa0', horizon: '#aeb0ba', bottom: '#c7cad2' },
    sun: { color: '#fffbf4', intensity: 2.5, dir: [-0.6, 0.75, -0.28] },
    ambient: { sky: '#d6d0cc', ground: '#a8a4a4', intensity: 0.86 },
    particles: '',
    water: { color: '#dde5ee' },
  },
  style: {
    macroDark: '#c4d2ec',
    macroLight: '#f4f7ff',
    macroStrength: 0.4,
    macroScale: 62,
    saturation: 1.1,
    gain: 1.0,
    normal: 0.7,
    cliffTint: '#c8cad0',
    shoreWet: 0,
    lavaGlow: 0,
    sparkle: 0.6,
    // no calm blur: it smeared the tile detail into milky patches (round 1). The soft tonal patches come from the two snow layers
    // (same tile, two tints) and the macro noise; the tile itself carries the fine grain.
    calm: { amount: 0, scale: 46, normalCut: 0.5 },
    // slate corridors: never black, a cool scree band at the foot. Zones core A3 `onset` / `onsetNoise` / `cap: false` stay OFF here (the blind critic
    // preferred the START cliffs 2 : 1, see core/NOTES.md); only the snow cap layer is weakened (`cap` 0.6, core1 settle 2026-10-22): at full strength it painted pale
    // diagonal haze over the faces (the critic's 'smeared streaks'), at 0.6 the faces read as slate with their cracks and the snow stays on the ledges
    cliff: { stainAmp: 0.16, stainAspect: 5, strataAmp: 0.12, strataScale: 9, floor: 0.2, aoMin: 0.82, rimFill: 0.42, cap: 0.6, foot: { color: '#c8ccd4', width: 3.2 } },
    blend: { window: 0.34, heightK: 1.0, edgeNoise: 0.45, warp: 0.6 },
  },
  accent: { a: '#f3f5f9', b: '#d6dbe6', strength: 0.22, scale: 61 },
  
  fill: { sky: '#d6d4d6', ground: '#b0b0b4', intensity: 0.3, shadowTint: '#928f94', shadowFill: 0.1 },
  // crisp baked shadow edge; the dynamic (twig / card) shadows are dark blue-grey, not ink
  shadow: { intensity: 0.75, baked: 1.0, ao: 0.55, soft: 0.2, trees: { strength: 0.66, species: { bare: 0.6 }, edge: 1 } },
  // SO-02-redo: cloud shadows .12 / 200 m -> .20 / 70 m. Attempt 1's broad patches (110-150 m) laid one soft grey shade over the whole gameplay frame (lakeshore -5 luma, the crown
  // shadows lost contrast); 70 m patches are smaller than the frame's reach, so the shade has a lit edge the player can cross (speed 2 m/s) instead of a darker day.
  cloud: { strength: 0.2, scale: 70, speed: 2 },
  // SO-02-redo spindrift: low, fast, small-featured drifts of blown snow (mist .32, 10 m features, 6 m/s, only the lowest ~25 cm: exp(-y / .25), so the yurt walls, trunks and fences stay
  // clean). The hero keeps a wide free circle (clearRadius 12: no mist inside 6 m, full strength from 24 m): the drift lives toward the edges of the gameplay frame and in the distance, the
  // play area around the hero, its telegraphs and the baked cast shadows stay crisp (tries at .42 / clear 7 and .30 / clear 9 washed the yurt shadows and the spawn plaza out, and cancelled
  // the camp fire's glow). Attempt 1's 40 m mist (.14) was a uniform veil that only lifted the dark accents (gravel, felt, crown shadows) and never read on the snow; the haze colour is now a
  // blue-white brighter than the lit snow (#eef4ff), so the drift shows on the snow and on the ice. Only the terrain family is patched (applyAtmosphere): telegraphs, the hero, enemies and
  // pickups are never veiled. The depth haze (.1 over 40 m) takes the same cool white.
  haze: { color: '#eef4ff', depth: 0.1, range: 40, mist: 0.32, mistScale: 10, mistSpeed: 6, mistHeight: 0.25, clearRadius: 12 },
  // SO-02-redo: the lantern pools were invisible on white snow (albedo x pool is added as emissive: .2 on a ~.8 albedo is nothing). Lantern .2 -> .5 over 6 m in a golden amber
  // (#ffd47a: attempt 1's #ffc27a crossed pink on the blue-white snow), the plague braziers .4 -> .8 over 9 m (the shrine becomes a green island, no longer milky slush), the
  // fires x1.4 (the pilgrim camp's bonfire is now the centrepiece of the camp frame)
  pools: {
    stone_lantern: { color: '#ffd47a', intensity: 0.5, radius: 6, flicker: 0.05 },
    plague_brazier: { color: '#6dff96', intensity: 0.8, radius: 9, flicker: 0.18 },
    bonfire: { color: '#ffa050', intensity: 0.84, radius: 8, flicker: 0.2 },
    brazier: { color: '#ff9a48', intensity: 0.98, radius: 7, flicker: 0.2 },
  },
  decals: [
    // SO-03: the families that matter most come first (medium compiles / runs only the first two: it used to get frost glitter + frost scuffs on the ice and no snow detail).
    // 1) sastrugi: soft wind-carved ridges (2.7 m wavelength) along the gust direction on the open snow only; the ridge strength rides a wide, soft patch gate (no hard field
    // edge: a narrow gate made dark rims and puddle islands), and the shader fades them with the pixel footprint (no moire far out)
    decal({ kind: 'streak', cell: 2.7, density: 0.76, size: 0, a: '#ffffff', b: '#ffffff', layers: [1, 1, 0.15, 0, 0, 0, 0, 0], fade: [46, 100], patch: { scale: 31, lo: 0.1, hi: 0.62 }, seed: 3 }),
    
    decal({ kind: 'glint', cell: 0.7, density: 0.5, size: 0.12, a: '#ffffff', b: '#d8eaff', emissive: 2.2, layers: [0, 0, 0, 0, 1, 0, 0, 0], fade: [30, 75], patch: { scale: 5, lo: 0.2, hi: 0.5 }, seed: 1.3 }),
    // 3) broad cloudy tone blots (3-6 m) on the snow: the soft mottling of snow01 / snow02, never a sprinkle; the hollows lean blue
    decal({ kind: 'scuff', cell: 11, density: 0.55, size: 4.6, a: '#bccae6', b: '#f5f8ff', layers: [1, 1, 0.25, 0, 0, 0, 0, 0], opacity: 0.24, fade: [40, 90], seed: 5 }),
    // 4) pale frost scuffs on the ice (never dark smudges: the round-1 ice field read as soft dirt; seed = the old slot-1 default)
    decal({ kind: 'scuff', cell: 3.5, density: 0.6, size: 1.3, a: '#a9b4c8', b: '#cfd9ea', layers: [0, 0, 0, 0, 1, 0, 0, 0], opacity: 0.35, fade: [30, 60], seed: 4.47 }),
    
    decal({ kind: 'glint', cell: 0.55, density: 0.3, size: 0.045, a: '#ffffff', b: '#e6f0ff', emissive: 2.2, layers: [1, 1, 0.3, 0, 0, 0, 0, 0], fade: [24, 60], patch: { scale: 13, lo: 0.7, hi: 0.84 }, seed: 9 }),
    // 6) ... each over a faint grey grit smudge (the dark flecks of the arena shots), small and rare
    decal({ kind: 'scuff', cell: 13, density: 0.3, size: 1.5, a: '#9c9fa9', b: '#b8bbc5', layers: [1, 1, 0, 0, 0, 0, 0, 0], opacity: 0.3, fade: [30, 70], seed: 11 }),
  ],
  // (the procedural inlay seal that stood here is replaced by the frost medallion above: two ring patterns on one spot read as clutter)
  // A4: the frost-covered rune disc on the clearing centre (one non-tiling picture, lit as ground, under the decals)
  medallion: { tex: 'tex_seori_frost_medallion', radius: 8, rotation: 0.5, opacity: 0.96, feather: 0.9, tint: '#f6f8fc', relief: 0.3 },
  roughness: {
    tex_snow_fresh: 0.72,
    tex_snow_packed: 0.7,
    tex_ice_blue: 0.32,
    tex_rock_frozen: 0.8,
    tex_mud: 0.85,
    tex_seori_snow_a: 0.72,
    tex_seori_gravel: 0.9,
    tex_seori_gravel_b: 0.9,
    tex_seori_trail_b: 0.9,
    tex_seori_slate: 0.8,
    tex_seori_ice: 0.35,
  },
  // the frozen mere / ponds: a thin pale sheet over the ice-tile bed (the bed's grain and the glitter decal show through; a 0.6 sheet was a milky veil)
  liquidLook: { shade: 1, ice: { tint: '#d0dcea', opacity: 0.19, glitter: 1, crack: 0.35, frost: 0.22, rim: 0, tex: 'tex_seori_ice' } },
  
  trees: {
    broadleaf: { grade: [1.02, 1.04, 1.1], barkGrade: [0.62, 0.6, 0.62], translucency: 0.3, snow: 1, fol: ['tex_fol_seori_beech', null] },
    snowpine: { grade: [1, 1, 1.05], fol: ['tex_fol_seori_spruce', null] },
    bare: { grade: [0.75, 0.8, 0.95] },
  },
  // snow settles on the upper faces of every boulder, tor and spire (params: normal.y threshold, softness, strength, grain). The zones core A2
  // `rocks` look is OFF in Seori (SEORI_ROCKS_A2 below): the blind critic preferred the snow-capped START stones 4 : 0 (the A2 stones read
  // as zebra-striped slate with blue speck pixels along the silhouettes and an open rock shell round the hero)
  rockCaps: { tex_seori_slate: { params: [0.3, 0.26, 0.9, 0.45], color: [0.86, 0.9, 0.95] } },
  // the crisp default cut-out (a feathered ghost is a screen-door checker on non-MSAA tiers)
  occlusion: { radius: 2.8 },
  edge: { farSkirt: true, fogWall: 0.6, ringBase: 18 },
  post: { bloom: { threshold: 1.65, knee: 0.25, strength: 0.38 } },
  targets: {
    
    
    luma: [130, 215],
    sat: [0, 40],
    anchors: ['#aeb4c0', '#a8afbb'],
    anchorDE: 20,
    cliffLuma: 80,
    cliffDark: 0.03,
    waterLuma: [140, 255],
    waterSat: 90,
    hf: 7.5,
    
    roles: { field: { spawn: null } },
    void: 0.05,
    fine: 1.6,
  },
};

/**
 * Zones core A2 rock look for Seori, NOT applied (see the comment above `rockCaps`): frosted slate with its cracks, snow only on the tops
 * (weaker cap, higher threshold), the wall blocks on the ledged snowy cliff tile (tex_seori_cliff), each kind its own mesh relief. To try it
 * again: `rocks: SEORI_ROCKS_A2` in SEORI_LOOK, `'ledge'` for the corridor wall rocks in world/zones/seori.ts, and fix the blue speck pixels
 * (saturated blue along the silhouettes, 50-75 px per frame) and the hollow shell the ledge blocks make round the hero ring first.
 */
export const SEORI_ROCKS_A2: NonNullable<ZoneLook['rocks']> = {
  tex: { outcrop: 'tex_seori_cliff', ledge: 'tex_seori_cliff' },
  relief: { boulder: 1.5, slab: 1.4, spire: 1.4, outcrop: 1.3, ledge: 1.25 },
  rough: { boulder: 0.035, slab: 0.025, spire: 0.025, outcrop: 0.012, ledge: 0.01 },
  kind: {
    boulder: { contrast: 1.2, dirt: 0.4, normal: 1.3, aoMin: 0.5, floor: 0.1, gain: 0.8, cap: { params: [0.74, 0.2, 0.55, 0.6], color: [0.86, 0.9, 0.96] } },
    slab: { contrast: 1.2, dirt: 0.4, normal: 1.3, aoMin: 0.5, floor: 0.1, gain: 0.8, cap: { params: [0.74, 0.2, 0.55, 0.6], color: [0.86, 0.9, 0.96] } },
    spire: { contrast: 1.2, dirt: 0.4, normal: 1.3, aoMin: 0.5, floor: 0.1, gain: 0.8, cap: { params: [0.74, 0.2, 0.55, 0.6], color: [0.86, 0.9, 0.96] } },
    outcrop: { contrast: 1.15, dirt: 0.3, normal: 1.25, aoMin: 0.55, cap: { params: [0.74, 0.2, 0.55, 0.6], color: [0.86, 0.9, 0.96] } },
    ledge: { contrast: 1.15, dirt: 0.3, normal: 1.25, aoMin: 0.55, cap: { params: [0.74, 0.2, 0.55, 0.6], color: [0.86, 0.9, 0.96] } },
  },
};
