import { DAERYEOL_TILES } from '../../../world/zones/daeryeol';
import { decal } from '../terrainDecals';
import type { ZoneLook } from './types';


// mud patches, narrow FLAT orange-yellow lava trenches between dark basalt walls, rust fog #85361c, sky #1f0000 -> #87381f.
// Round 1 (2026-10-19): calm ground (no ash eddies, no hairline cracks, no star specks), flat lava, never-black walls. Core round
// (2026-10-22, the settle's "r1 ground + r3 landmarks" merge on the round-3 layout): flat angular setts (codex tile, 15 per side), cracked-earth
// fields, molten magma skin on every lava edge, faceted basalt rocks (core A2), plaza medallion (core A4), neutral-bronze light (the
// violet-grey fill and teal sun of round 1 made the cobble read olive-grey and the red mobs blend in). Ground layers (recipe order, see
// world/zones/daeryeol.ts): 0 cobble · 1 earth (cracked fields) · 2 scorched clinker (pit cores, lip, scree) · 3 basalt (walls, banks)
// · 4 road setts · 5 burn scars · 6 molten skin (emissive).
// DY-01 (upgrade stage 2, D-ATMO-01 + D-LIGHT-04; built 2026-10-28, fix round 2026-10-29): smoky air, violet shadows, fires that pop. START had fog #85361c from 26 m and a
// .52 haze of #8a3a1e: half of every frame sat behind one brown-orange band and the braziers / flames / lava drowned in it. Now the air is a dark ember brown that only
// builds up past 60 m (fog) and past the hero's own distance (haze), the key is a warm amber, the hemisphere a slate-violet sky over a warm tan ground (the shadows
// read violet, the lit stone and the skin stay bronze: the first build's saturated red ground colour turned every vertical surface magenta), the terrain's own
// shadow fill is a blue-violet and the fire pools are stronger. Values only: no new pass, no new program, no asset.
// DY-02 (upgrade stage 3, D-GROUND-02; built 2026-10-29, fix round the same day): charcoal setts. The olive-brown cobble filled every frame, so the ground read as a flat brown carpet
// that competed with the red mobs. Now the stone is a darker charcoal-violet (saturation .56 -> .45, terrain gain 5 -> 4.5, macro / accent toward violet, bevel shading .7 -> .5): the dais,
// the braziers, the altar pool and the fire mobs separate from it. Values only: no new pass, no program, no asset, and NO new decal slot.
// The glowing-seam family (a `crack` decal in front of the cinders) is NOT in this file on purpose, the budget cannot carry it with values alone (medium <= +0.03 ms): (1) a second decal
// slot costs about +0.02 ms at medium by itself (START has ONE family; the tier renders min(2, n); crack slot off = +0.017 .. +0.021 at spawn / mid / late / riverA, one page, interleaved
// against START's slot layout); (2) the `crack` kind runs its 9-cell voronoi loop on every pixel whose layer mask passes and terrainDecals.ts applies the noise patch AFTER that test, so a
// sparse patch is not cheaper: seams on clinker + burn scars at fade 16-32 = +0.040 / +0.023 / +0.066 / +0.029 in total, the first build (earth + road, fade 22-44) +0.045 / +0.051 / +0.104 / +0.054

// `fissure` kind (cheap: patch + lava gate before its loop) draws parallel streaks on any slope.
// DY-03 (upgrade stage 3, B-POST-02 + D-READ-06; built 2026-11-06): the grade, the bloom, the run arc, the corruption tint and the readability of the fire family, all values on the PL-01 / PL-03 / PL-04 contracts (no new pass, no program, no asset).
// The spec's start grade (shadow tint #3a3a6a x .16, contrast 1.12) lifted the blacks of the dark setts into a milky lilac (frame luma up, saturation and the warm pools down) and bloom .8 / .8 added a veil on the lit stone:
// measured on stills, so the shadow tint is a deep violet at .05 (it only colours the darkest pixels), a contrast 1.14 about the pivot .03 and saturation 1.1 give the lava and the pools their depth, and the bloom threshold stays near the
// pipeline's (.86 / .75: the lava, braziers and fire VFX feed it, the plaza does not). The arc is its own key list (a zone `arc` replaces the default dusk): the embers / pools brighten through the afternoon and the last
// minutes turn the DISTANCE crimson (haze / fog) while the near ground stays charcoal-violet: a red sun on these setts made every ground the same rust and cut the contrast of the fire mobs and the red telegraphs.
// DY-04 (upgrade stage 3, D-LAVA-03 + D-PART-05; built 2026-11-06): the lava lights its banks and the air gets a second life. liquidLook.lava.shore.glow .3 -> 1.1 (the plan's 1.6-1.8 was written before the
// DY-03 composite pass: on medium / high the additive shore decal feeds the bloom and ACES, so 1.3 and up turned the whole bank into a peach wash that flooded the floor between the fire mobs; low has no pass
// and keeps the red-orange of the glow at any value), hotHdr 1.9 / skin .26 (LIQ-01 knobs), and look.ambientLoops ['ambient.smoke'] (AMB-02: 2-4 m wisps at alpha .06-.12, medium / high; low stays embers only).
// Values only: no new pass, no program, no asset (the smoke's sprites are already carried by the embers loop and the dust specs).
const T = DAERYEOL_TILES;

export const DAERYEOL_LOOK: ZoneLook = {
  // DY-01: fog #5a2818 60-280 m (was #85361c 26-214). It is also the colour of the abyss below the world edge (sky/index.ts mixes the fog into the rock floor there), so
  // a near-black fog turned the chasm into a flat black void; it starts late, so the plaza of a wide view stays clear and only the far field goes smoky.
  // Key light from the north-west, warm amber (#ffdcb4 1.74, was off-white 2.3), 44 deg. Hemisphere: slate sky over a warm tan ground, so vertical surfaces (heroes,
  // pillars) stay neutral-warm (red x1.3, green x1.3, blue x2 of START: blue was x1.9 and red x2.1 against green x.9 in the first build = magenta); the violet
  // lives in the shadows (fill + terrain shadow tint below)
  biome: {
    fog: { color: '#5a2818', near: 60, far: 280 },
    // a dark top over a deep ember horizon: the dome mixes the fog colour in at low elevations, so the far field and the horizon meet without a seam and the glow sits
    // behind the dark far silhouettes (the sky style: glow / clouds / rings are SKY-02's)
    sky: { top: '#2a1210', horizon: '#4c2214' },
    // ambient particles stay the zone default (drifting embers: the settle critic named the missing embers as the reason the open fields read murky)
    sun: { color: '#ffdcb4', intensity: 1.74, dir: [-0.55, 0.7, -0.44] },
    ambient: { sky: '#545a7c', ground: '#7c683a', intensity: 2.22 },
  },
  style: {
    // DY-02: charcoal-violet macro (was bronze #b4a096 / #efe0d4 at .42)
    macroDark: '#a496b8',
    macroLight: '#e8ddf2',
    macroStrength: 0.44,
    macroScale: 66,
    
    // luma 50-60; the lit cobble was hue 25-31 / sat .54 (too red). The greener cobble + road tint of the recipe, saturation .62 -> .56 and gain 4.5 -> 5
    // give hue 33-38 / sat .49-.53 / luma 51-59
    // DY-02: saturation .56 -> .45, gain 5 -> 4.5 (the terrain shader only: the rock meshes keep their own gain) = charcoal setts with a violet cast instead of olive-brown;
    // normal .7 -> .5 softens the bevel shading of the sett grid (the grid itself is the albedo of the tile: only a tile edit would calm it further)
    saturation: 0.45,
    gain: 4.5,
    normal: 0.5,
    cliffTint: '#b8aea0',
    shoreWet: 0,
    lavaGlow: 0.85,
    sparkle: 0,
    // walls never go black: a floor of dark purple-grey basalt, strata ripples kept soft, a scorched scree band at the foot
    cliff: { stainAmp: 0.07, stainAspect: 4, strataAmp: 0.18, strataScale: 9, floor: 0.08, aoMin: 0.74, rimFill: 0.2, foot: { color: '#44362f', width: 5 }, onset: [0.12, 0.29], onsetNoise: 0.04 },
    // soft ragged borders between the cobble and the mud patches
    blend: { window: 0.6, heightK: 0.5, edgeNoise: 0.4, warp: 0.5 },
    // no calm blur (round 2): the blurred patches read as airbrushed dust smears; the soft tonal patches come from the mud layer
    calm: { amount: 0, scale: 44, normalCut: 0 },
  },
  // DY-02: the accent patches lean violet too (was #d8c0b0 / #a89cb0 at .32)
  accent: { a: '#bcaec8', b: '#8a86b4', strength: 0.36, scale: 46 },
  // DY-01: violet fill over a warm ground; the terrain's own shadow fill (alb x tint x fill x (1 - sun)) is a blue-violet at .8, so every cast shadow and the unlit
  // side of the ground reads violet and the sunlit stone stays warm (the round-1 violet-grey fill turned the setts olive under a NEUTRAL key, under the amber key it is fine)
  fill: { sky: '#5c4c82', ground: '#8a5a30', intensity: 0.4, shadowTint: '#4448b4', shadowFill: 0.8 },
  // trees: core B1 crown-shaped shadows for the dead trees (the same value START carries)
  // DY-01: softer shadows (was .62 / .65 / .5): the pits (crater, ember court, slag flats) were the darkest spots of the zone. baked stays >= .5: shadowLook.test.ts
  // (the tree crown shadows are baked and reach the ground scaled by it)
  shadow: { intensity: 0.56, baked: 0.5, ao: 0.25, soft: 2.8, trees: { strength: 0.8 } },
  cloud: { strength: 0.2, scale: 130, speed: 3.4 },
  // DY-01: smoke that builds up with distance (was an orange veil: #8a3a1e depth .52 over 34 m: half of every frame): .45 over 70 m, so the top of a gameplay frame gets a
  // warm gradient and the far field / horizon an ember glow; low-lying mist doubled and 0.2 m lower
  haze: { color: '#5a2814', depth: 0.45, range: 70, mist: 0.1, mistScale: 55, mistSpeed: 2.2, mistHeight: 1.6, clearRadius: 12 },
  heroGlow: { color: '#ffe0bc', strength: 0.5, radius: 7.5 },
  // DY-01: stronger fire pools (brazier / altar x1.5, pillar x10, obelisk x3, lava rock x1.6): the fires carry the frame against the dark air, and the pits keep their luma
  pools: {
    fire_brazier: { color: '#ff9040', intensity: 0.82, radius: 6.5, flicker: 0.22 },
    brazier: { color: '#ff9040', intensity: 0.82, radius: 6.5, flicker: 0.22 },
    fire_altar: { color: '#ff6a1a', intensity: 1.65, radius: 11, flicker: 0.22 },
    lava_rock: { color: '#ff7a26', intensity: 0.7, radius: 2.8, flicker: 0.15 }, // r7 ship 10-30: 5 m -> 2.8 m, warmer orange (the U7 critic: a 10 m rose stain on the cobbles; heat should hug the rock's base)
    stone_lantern: { color: '#ffa860', intensity: 0.4, radius: 5, flicker: 0.08 },
    // the carved pillars spill a faint ember glow onto the paving so they sit in the ground, not on it
    lava_pillar: { color: '#ff7030', intensity: 0.8, radius: 7, flicker: 0.1 },
    obelisk: { color: '#ff6a28', intensity: 0.7, radius: 5.5, flicker: 0.1 },
  },
  // Decals (core round): the stepped 'scuff' stains, the black 'pebble' chips along the lava edge and the even cinder sprinkle of rounds 1-3
  // stay out. What is left is heat: sparse soft cinders gathered in drifts on the scorched clinker (the molten skin on the lava edge
  // is the emissive ground layer 7 of the recipe; the C8 `fissure` decal read as hairline scribbles on the banks and is out).
  decals: [
    decal({ kind: 'ember', cell: 1.1, density: 0.1, size: 0.05, a: '#ff6a1a', b: '#ffc060', emissive: 1.5, layers: [0, 0, 1, 0, 0, 0, 0, 0], fade: [16, 30], patch: { scale: 12, lo: 0.45, hi: 0.7 } }),
  ],
  roughness: { [T.cobble.tex]: 0.82, [T.earth.tex]: 0.92, [T.scorch.tex]: 0.9, [T.wall.tex]: 0.85 },
  // flat bright molten orange-yellow with slow low-frequency flow, no black plates, no white crackle halo, soft contact shade
  // DY-04 (D-LAVA-03): the shore glow .3 -> 1.1 (the lava throws a hot red-orange bounce up its banks and trench walls) and the vein / skin knobs of LIQ-01 a notch above their defaults
  // (hotHdr 1.6 -> 1.9, skin .22 -> .26: the glow lifts the banks, so the melt keeps its contrast with a few more dark cooling plates and hotter veins)
  liquidLook: {
    lava: { mode: 'flat', flowScale: 12, emissive: 1.0, shore: { glow: 1.1, crackle: 0 }, contactShade: 0, hotHdr: 1.9, skin: 0.26 },
  },
  // dead trees: plain dark oak bark (no charred bark with glowing ember specks, no black root discs), dark teal-black like the reference trunks
  trees: { bare: { bark: 'tex_bark_oak', ember: 0, grade: [0.5, 0.45, 0.42], barkGrade: [0.42, 0.37, 0.33] } },
  occlusion: { radius: 2.8, feather: 1.1, minAlpha: 0.22 },
  // fogWall 1.2 (was .6): the abyss below the world edge is the rock floor mixed .5 x fogWall into the fog colour (sky/index.ts), so it is a lit ember brown
  // (void gate 0.000: it is not the fog colour) instead of a black chasm; rim shots keep their void gate (<= .006)
  edge: { farSkirt: true, fogWall: 1.2, ringBase: 18 },
  // core A4: the ember dais on the plaza centre (one non-tiling picture, lit as ground, under the decals; its cracks glow a little)
  medallion: { tex: 'tex_daeryeol_dais_medallion', radius: 8.4, rotation: 0.3, opacity: 1, feather: 0.14, tint: '#f6efe8', emissive: 0.5, relief: 0.4 },
  // core A2: every rock kind on the dark fissured lava-rock tile with its own tint / contrast / dirt, deeper cracks and ledged rim blocks;
  // the column bundles ('basalt' kind) keep their prisms
  rocks: {
    tex: { boulder: 'tex_daeryeol_basalt', slab: 'tex_daeryeol_basalt', spire: 'tex_daeryeol_basalt', outcrop: 'tex_daeryeol_basalt', ledge: 'tex_daeryeol_basalt' },
    relief: { boulder: 1.5, slab: 1.4, spire: 1.4, outcrop: 1.3, ledge: 1.25 },
    rough: { boulder: 0.035, slab: 0.025, spire: 0.025, outcrop: 0.012, ledge: 0.01 },
    kind: {
      boulder: { gain: 6.4, tint: '#f0e4da', contrast: 1.2, dirt: 0.16, normal: 1.35, aoMin: 0.6, floor: 0.1 },
      slab: { gain: 6.4, tint: '#f0e4da', contrast: 1.2, dirt: 0.16, normal: 1.35, aoMin: 0.6, floor: 0.1 },
      spire: { gain: 5.4, tint: '#ece2da', contrast: 1.15, dirt: 0.25, normal: 1.3, aoMin: 0.55, floor: 0.08 },
      outcrop: { gain: 5.6, tint: '#e4d6d0', contrast: 1.15, dirt: 0.16, normal: 1.3, aoMin: 0.62, floor: 0.09 },
      ledge: { gain: 4.4, tint: '#d0c0c0', contrast: 1.08, dirt: 0.2, normal: 1.25, aoMin: 0.7, floor: 0.105, geo: true, cap: null },
    },
  },
  rockCaps: { [T.rock]: { params: [0.62, 0.22, 0.1, 0.7], color: [0.3, 0.24, 0.22] } },
  // DY-03: the composite pass of this zone (medium / high; low has no pass). Violet only in the darkest pixels (.05), a warm amber in the lights (.14), contrast 1.14 about a LOW pivot (.03: this ground sits at linear ~.02, so the default pivot .18 crushed the whole plaza by a third; at .03 the dark setts keep their luma and only the lit stone, pools and mobs gain), saturation 1.1: the pools,
  
  post: {
    bloom: { threshold: 1.45, knee: 0.25, strength: 0.5 },
    grade: { shadowTint: '#34185a', shadowAmt: 0.05, highlightTint: '#ffb878', highlightAmt: 0.14, contrast: 1.14, pivot: 0.03, saturation: 1.1 },
  },
  // DY-03: the run arc as ABSOLUTE keys (the keys replace the default dusk): t600 brighter embers (pool x1.8), t780 ember glow (x2.4, a violet-blue fill), t880 / 900 crimson air (haze #8a2018 .5, fog #4e1812, pool x3,
  // the medallion glows): the sun barely moves (a red key on charcoal setts = rust ground, the fire mobs lose their contrast)
  arc: [
    { t: 0 },
    { t: 600, sun: { color: '#ffd4a8', intensity: 1.78 }, haze: { color: '#64281a' }, poolGain: 1.8, medallionGlow: 0.15 },
    { t: 780, sun: { color: '#ffc89c', intensity: 1.7 }, fill: { shadowTint: '#4a38a0' }, haze: { color: '#6c2418', mist: 0.12 }, poolGain: 2.4, medallionGlow: 0.35 },
    {
      t: 880,
      sun: { color: '#ffbe94', intensity: 1.62 },
      hemi: { sky: '#58487a', ground: '#7c5038', intensity: 2.1 },
      fill: { shadowTint: '#4a2a9a', shadowFill: 0.88 },
      haze: { color: '#8a2018', depth: 0.5, mist: 0.14 },
      fog: { color: '#4e1812' },
      poolGain: 3,
      medallionGlow: 0.8,
    },
    {
      t: 900,
      sun: { color: '#ffbe94', intensity: 1.62 },
      hemi: { sky: '#58487a', ground: '#7c5038', intensity: 2.1 },
      fill: { shadowTint: '#4a2a9a', shadowFill: 0.88 },
      haze: { color: '#8a2018', depth: 0.5, mist: 0.14 },
      fog: { color: '#4e1812' },
      poolGain: 3,
      medallionGlow: 0.8,
    },
  ],
  // DY-03: the sickness takes the far air to a bruised dark violet (the corruption's own desaturate / darken / shadow tint stay the defaults)
  corruption: { haze: '#3e2a4a' },
  // DY-04 (D-PART-05, PL-02): the second ambient loop of the lava zone, slow low smoke wisps next to the drifting embers (biome.particles stays the zone's 'embers'). Medium / high only: the low tier
  // keeps the zone's first loop (embers) alone (app/simFeed.ts ambientLoopsForTier)
  ambientLoops: ['ambient.smoke'],
  // DY-03 (D-READ-06): the fire family goes darker and greyer on the dark ground (darken .25 -> .35, desaturate .15 -> .25) with a thin warm rim (.2 -> .22): the red dragon and the gold elites separate from their adds
  readability: { rim: '#ffd2a0', rimStrength: 0.06, desaturate: 0.25, darken: 0.35 },
  targets: {
    
    
    // DY-01 (fix round): the floor goes UP to 41 (START 38): the open fields measure 46 (ember court pit floor) .. 49 (field_nw), the dark spots (crater, slag flats) 41-42
    // DY-02 re-base: the charcoal setts are ~10 % darker (gain 4.5): the ember court pit floor measures 37.2 (START 43.2), field_nw 41.5 (START 50.1); the floor moves 41 -> 36 only as far as that needs
    luma: [36, 62],
    sat: [60, 175],
    anchors: ['#53453c', '#3b3236'],
    anchorDE: 22,
    // cliffedge frames half abyss and the black fissure channels of the basalt tile are 24 % of the ledge pixels (a texture property): the whole-frame gate 0.03 / 36 was
    // already red before DY-01 (START 0.102 / 32.4) and is NOT loosened here: DY-01 holds START as the not-worse ceiling (dark <= 0.102, void <= 0.124) and says where it
    // falls short (cliffedge: dark 0.093 vs 0.102 and void 0.000 vs 0.000 hold; luma 29 vs 32.4: the abyss rock tone is sky/zones, SKY-02's, and START's was propped up by the veil)
    // DY-02: the cliffedge frame is mostly ground, so the darker setts take it from 35.8 (START, already under 36) to 33.3: the floor follows (32); the dark share (0.107, START 0.108) and the void are not touched
    cliffLuma: 32,
    cliffDark: 0.03,
    waterLuma: [95, 200],
    waterSat: 255,
    // DY-03 re-base: hf 5 -> 5.4. The grade's contrast (1.14 about the pivot .03) sharpens the sett grid by ~4.5 % (ember court 5.02 -> 5.25, field_nw 4.89 -> 5.10 on the same tree, high, warrior
    // zonecheck set; START already sat at 5.02 on the ember court). Frame luma (36.7 / 40.8), cliff luma (34.4) and the cliff-edge dark share (.105 vs START .106) hold their floors: the low pivot keeps the dark ground
    hf: 5.4,
    void: 0.05,
    fine: 1.6,
    // riverA: the hero stands on the bank, the lava fills the lower-left of the frame
    roles: { water: { riverA: [0, 560, 1100, 520], lavafall: [0, 900, 480, 180] } },
  },
};
