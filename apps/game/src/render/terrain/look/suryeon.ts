import { BOULDER_TEX, RIM_TEX, SURYEON_TILES } from '../../../world/zones/suryeon';
import type { ZoneLook } from './types';


// cool teal-grey channels, calm ground with sparse big objects and long hard shadows. Round 1.
// SR-01 (upgrade stage 2): "the autumn valley" is an amber afternoon now (own art direction, not the threeway's green-grey fog): a
// low warm sun, an amber fog that starts further out, a dusty amber haze, a hint of drifting cloud shadow, a cool sky fill in the shade
// and the teal channels pre-compensated for the amber light. Spec deviations (fix round 1, all measured on blind stills): sun intensity
// 4.6 and ambient sky #adbccc at 0.85 (spec 2.9 and #b8b4a0: the amber sun keeps only 0.67 of a white sun's luma, so the first build's
// 3.4 left the field 12 % darker than before; the bluer fill cools the shade and lifts the blue the water needs), fog #a38864 60-230 m
// (spec #b49c7c 48-170: that was a flat beige wall over the top 45 % of the fly-in views), haze #c4a070 at .26 (spec #c9a77a at .3).
// SR-02 (ground cover and an olive-gold field): the accent patches the whole ground gold / olive-russet (a #f0cc78, b #b8a460 at .45: the
// spec's a #d9b46a / b #9a8a4a darkened the field 12 % and the road with it, so a lighter pair carries the same hue), the open lawn tile and
// tint are warm straw (world/zones/suryeon.ts) and a field of tex_fol_grass_2 seed-head clumps stands on it; cover.grade 1 / .96 / .86
// keeps the tufts out of the lime range under the amber light.
// SR-05 (upgrade stage 3, A-04 grade part + A-07 / A-10 colours + A-17; built 2026-11-06, fix round 1 the same night): the composite grade, the run arc, the corruption tint and the readability of the orcs, all values on the PL-01 / PL-03 /
// PL-04 contracts (no pass, no program, no asset). Spec deviations, all measured on blind stills / deterministic horde scenes: the grade's saturation is 1.09 with a warm white point and a contrast 1.05 (spec 1.04 / none: the teal shadow
// split pulls the mean HSV saturation of the stills down by 7-24 % and the contrast std by 8 %), its highlight tint is #ffc888 and its shadow amount .08 at t = 0 (the arc raises it to .10 / .12 where the light turns); the arc has two more
// keys (t780 golden hour, t900 holds the dusk: a single 600 -> 880 ramp is 80 % dusk at 800 s, a rust field); the dusk is a wine-rose air over a field that keeps its own hues AND an open shade (the crowd must not melt into it);
// the corruption names a deep indigo haze and a plum shadow tint (its amounts stay the PL-04 defaults); the orcs take a lighter readability style (rim up, darkening gone).
// Ground layers (recipe order, see world/zones/suryeon.ts): 0 grass · 1 dark grass · 2 road earth · 3 sandstone · 4 plaza tile · 5 sand.
// Texture ids come from SURYEON_TILES (the zone's own tex_suryeon_* tiles, one table shared with the recipe).
const T = SURYEON_TILES;

export const SURYEON_LOOK: ZoneLook = {
  // sun elevation 48.5 deg from the north-north-west (shadows fall long to the south-east); the threeway's green-grey fog #62756a 30-140 m
  // veiled the top third of every frame and tinted the whole valley like a swamp: a darker, more saturated amber fog that starts at 60 m
  // and lets the far cliffs and the pagoda keep their silhouettes. (high tier: trees / rocks are drawn out to min(range, fog far + 8),
  // so far 230 reaches the tier's own 210 m cap, which no gameplay camera sees; medium and low stay at their 150 / 100 m caps)
  biome: {
    fog: { color: '#a38864', near: 60, far: 230 },
    sun: { color: '#ffc98e', intensity: 4.6, dir: [-0.62, 0.8, -0.22] },
    ambient: { sky: '#adbccc', ground: '#7a5c3c', intensity: 0.85 },
    particles: '',
    water: { color: '#4a9cc0' },
  },
  style: {
    macroDark: '#b4b88a',
    macroLight: '#f4efd2',
    macroStrength: 0.5,
    macroScale: 62,
    saturation: 0.74,
    gain: 2.2,
    normal: 0.85,
    cliffTint: '#f0e8d8',
    // SR-04 (redo): .3 -> .6, the sandstone / earth foot of a bank takes a damp, darker band (albedo x .75 instead of x .87 right at the waterline), so the
    // channel reads as water lapping at the stone rather than as a flat teal decal laid beside it
    shoreWet: 0.6,
    lavaGlow: 0,
    sparkle: 0,
    calm: { amount: 0, scale: 46, normalCut: 0 },
    // pale sandstone: never a black wall; the stain streaks stop smearing; a tan scree band at the foot
    cliff: { stainAmp: 0.1, stainAspect: 2.5, strataAmp: 0.36, strataScale: 4.5, floor: 0.24, aoMin: 0.68, rimFill: 0.12, foot: { color: '#a8946c', width: 1.8 }, onset: [0.12, 0.29], onsetNoise: 0.04, cap: false },
    // SR-03: soft field borders (was window .15, edgeNoise .5, warp .5: the lawn read as a felt cut-out with a hard wobbly rim against the earth)
    blend: { window: 0.38, heightK: 1.1, edgeNoise: 0.6, warp: 0.6 },
  },
  accent: { a: '#f0cc78', b: '#b8a460', strength: 0.45, scale: 54 },
  // (shade: sky fill #adbccc + fill #b4c0c8 + shadowTint #557488 give shadow / lit RGB .65 / .67 / .70 on dirt against .64 / .62 / .62 in the
  // green-grey light: a slightly cooler shade, not a teal one; the cool split of the grade is SR-05's)
  fill: { sky: '#b4c0c8', ground: '#74704a', intensity: 0.4, shadowTint: '#557488', shadowFill: 0.16 },
  // (core round 2: tree shadows .62 -> .72: the blind critic measured shadow/lit on dirt .71 against .61 one build earlier, wanted <= .65; the AO stays low)
  // (SR-04 tried trees edge 1 + capsule .15 and dropped it: the softer crowns melted the lobes and filled the light gaps, the crisper START crowns won
  // all 12 blind shadow stills, and no stair-step shows on this zone's grass, dirt or paving at gameplay scale)
  shadow: { intensity: 0.8, baked: 0.85, ao: 0.36, soft: 0.5, trees: { strength: 0.72 } },
  // SR-01: a hint of drifting cloud shadow (round 1 had none: against the green-grey sky fill the blotches read as pale green pools on the
  // sandstone; with the warm light they are soft amber-brown ones)
  cloud: { strength: 0.18, scale: 160, speed: 2.6 },
  haze: { color: '#c4a070', depth: 0.26, range: 34, mist: 0.0, mistScale: 70, mistSpeed: 1, mistHeight: 2, clearRadius: 14 },
  pools: {
    stone_lantern: { color: '#ffd08a', intensity: 0.26, radius: 5, flicker: 0.05 },
    lamp_post: { color: '#ffd890', intensity: 0.28, radius: 5.5, flicker: 0.05 },
    bonfire: { color: '#ffa860', intensity: 0.7, radius: 10, flicker: 0.2 },
    fire_brazier: { color: '#ffb070', intensity: 0.3, radius: 5.5, flicker: 0.2 },
    brazier: { color: '#ffb070', intensity: 0.3, radius: 5.5, flicker: 0.2 },
  },
  // Three decal families (the C0 kinds; four slots compile for up to four families, more than four compile six). The medium tier draws the
  // first TWO (terrainMaterial setQuality), low none, high all: so the leaf litter comes first, the existing sparse pebbles second (both
  // tiers keep what they had, the order only changed) and the road pebble drift third (high only). (core round 1 dropped the court-flagstone
  // 'cell' family: its pale per-stone patches read as stains on the paving.)
  decals: [
    // SR-03: fallen leaves on the lawn, the groves AND the road earth (it was the dark lawn under the groves only, a few and small): drifts
    // of russet and amber that the wind has pushed together, denser under the canopy; the camp clearings and the roads are not bare dirt now
    { kind: 'leaf', cell: 0.6, density: 0.22, size: 0.12, a: '#a8461e', b: '#e08a2a', layers: [0.55, 1, 1, 0, 0, 0.3], canopy: 3, fade: [30, 58], patch: { scale: 9, lo: 0.34, hi: 0.6 }, seed: 4.47 },
    // a few pebbles in the road earth and the sand, gathered in drifts
    { kind: 'pebble', cell: 0.9, density: 0.2, size: 0.085, a: '#85806f', b: '#b9b09c', layers: [0, 0, 0.35, 0.3, 0, 0.5], fade: [20, 40], patch: { scale: 8, lo: 0.45, hi: 0.7 }, seed: 1.3 },
    // SR-03 (high only): a loose pebble drift on the road earth, clustered in long patches
    { kind: 'pebble', cell: 0.55, density: 0.62, size: 0.075, a: '#766654', b: '#b8a88c', layers: [0, 0, 1, 0.2, 0, 0.2], fade: [26, 54], patch: { scale: 7, lo: 0.5, hi: 0.74 }, seed: 41 },
    // (round 1 had two soft scuff families here: they mottled the lawn into cloudy blotches and cost the 5th / 6th decal slot (+5 % GPU);
    
  ],
  // A4: the inlaid sun-star court seal on the court centre (one non-tiling picture, lit as ground, under the decals)
  medallion: { tex: 'tex_suryeon_court_medallion', radius: 8.8, rotation: 0.2, opacity: 1, feather: 0.14, tint: '#f4f0e8', relief: 0.4 },
  // (round 1 drew bronze strips / glyphs over the court paving: they read as scribbles, the court is plain stone now)
  roughness: { [T.road.tex]: 0.88, [T.rock.tex]: 0.88, [T.plaza.tex]: 0.8, [T.sand.tex]: 0.78, [T.cliff.tex]: 0.9 },
  // cool teal channels, a sand shelf instead of the cobble strip, no foam beads; a fine sun shimmer on the chop and a richer, wetter turquoise body since SR-04
  liquidLook: {
    // B2: the wet bank band lies in the terrain's shadows like the ground does (the sand-shelf veil that made width 0 necessary is fixed)
    shade: 1,
    water: {
      // width 0: the beach is painted into the ground (sand layer); the shader's sand-shelf overlay laid a dusty yellow veil over the
      // shallows and next to a shadowed bank (round 1 shots), so the bank is the bare terrain meeting the teal water
      shore: { color: '#a29672', width: 0, softness: 0.8 },
      // SR-04 (redo): glitter .05 -> .3 puts a fine sun shimmer on the ripples wherever the sun path is in view (the pow(N.H, 600) glint needs the
      // ripple normal near the sun half vector: that is the left half of the frame with this sun and camera, e.g. the road_gate pool; the
      // centre of a channel stays calm). foam .08 -> .10 only: .28 painted a flat beige patch at the boulders (the amber light tints the foam and the
      // shader caps it at about 24 % opacity), so the spec's .28 is not used
      foam: 0.1,
      glitter: 0.3,
      bedStones: 0.15,
      // SR-01 (fix round 1): the amber sun keeps only 27 % of its blue (linear), so a body colour that was teal under the green-grey light
      // rendered olive-khaki (hue 52-65 deg at the first build). The body colours are pre-compensated for the amber light: very blue in
      // hex, teal on screen (pure-water boxes at river_ring_w / bridge_n / road_gate: hue 164-176 deg, sat .26-.37 on high and medium; on low hue
      // 161-177, sat .29-.46: that tier has no tone-mapped composite); a cooler bed and a
      // higher clarity stop the warm terrain bed from showing through and yellowing the shallows
      // SR-04 (redo): the body colours lose red (deep #58 -> #46, shallow #88 -> #78 in R) and gain green / blue, clarity .36 -> .34: the same
      // teal-cyan family (hue 175 -> 179 deg) at the same luma, a cleaner, wetter turquoise (A-12: the water read as a dull carpet; water-pixel
      // median sat on high / medium .37 -> .50 at river_ring_w, .35 -> .47 at bridge_n and the wn channel, luma 85-89 both)
      deep: '#46b8f4',
      shallow: '#78ecfa',
      bed: '#a0b0b8',
      clarity: 0.34,
      taper: 30,
    },
  },
  // SR-02: the zone-wide cover multiplier is 1 (the spec densities are the real ones; .5 was a placeholder for an empty cover list)
  cover: { grade: [1, 0.96, 0.86], density: 1 },
  trees: {
    broadleaf: { grade: [1.12, 1.22, 0.95], barkGrade: [1.7, 1.55, 1.35], translucency: 0.5, fol: ['tex_fol_yeonmu_beech', 'tex_fol_broadleaf'] },
    pine: { grade: [0.96, 1.08, 0.94], barkGrade: [1.5, 1.4, 1.25] },
    autumn: { grade: [1.12, 1.04, 0.96], barkGrade: [1.6, 1.45, 1.25], translucency: 0.6, fol: ['tex_fol_yeonmu_autumn', null] },
  },
  occlusion: { radius: 2.8, feather: 1.1, minAlpha: 0.22 },
  edge: { farSkirt: true, fogWall: 0, ringBase: 18 },
  // A2: the loose granite stones keep their dark cracks and a warm grey (the cliff floor / aoMin lift made them pale chalk); the wall
  // chunks (outcrop / ledge, the sandstone tile) get a little more contrast and dirt; every kind its own mesh relief
  rocks: {
    relief: { boulder: 1.5, slab: 1.4, spire: 1.4, outcrop: 1.3, ledge: 1.25 },
    rough: { boulder: 0.035, slab: 0.025, spire: 0.025, outcrop: 0.012, ledge: 0.01 },
    kind: {
      boulder: { tint: '#c4bfb2', contrast: 1.2, dirt: 0.4, normal: 1.3, floor: 0.1, aoMin: 0.5, rimFill: 0.1 },
      slab: { tint: '#c4bfb2', contrast: 1.2, dirt: 0.4, normal: 1.3, floor: 0.1, aoMin: 0.5, rimFill: 0.1 },
      spire: { tint: '#c4bfb2', contrast: 1.2, dirt: 0.4, normal: 1.3, floor: 0.1, aoMin: 0.5, rimFill: 0.1 },
      outcrop: { contrast: 1.15, dirt: 0.3, normal: 1.25, aoMin: 0.58 },
      // the wall chunks stand in the baked shadow of the canyon: lifted so they read as pale stone, not as dark brown slabs
      ledge: { contrast: 1.1, dirt: 0.2, normal: 1.15, floor: 0.3, aoMin: 0.74, rimFill: 0.16 },
    },
  },
  rockCaps: {
    [BOULDER_TEX]: { params: [0.66, 0.22, 0.12, 0.7], color: [0.36, 0.4, 0.24] },
    [RIM_TEX]: { params: [0.7, 0.24, 0.1, 0.7], color: [0.42, 0.4, 0.26] },
  },
  // SR-05: the composite pass of this zone (medium / high; low has no pass): warm amber light, cool teal shade (highlights #ffc888 x .14, shadows #2e4a54 x .08) with the saturation 1.09, a warm white point
  
  // against the warm ground. Fix round 1: the first build ran the saturation at 1.12 (field sat 198 / 201 against 187 in the target frame and 182 / 191 at START: a lime tint on the lawn, the green-hue share of trees_w
  // 10 -> 14 %); 1.09 plus the warm gain brings it to 192 / 195 and lets the lawn lean amber like the target instead of green. The spec's #ffc070 / shadow x .14 are still not used at t = 0: arc.test.ts evaluates the
  // DEFAULT arc over the base grade of every zone that has none of its own (highlight lean b >= .55 g, shadow amount <= .2 after the dusk's +.12) and YA-04's relaxation of that test (`delete l.post`) is not landed
  // with this WP: #ffc888 / .08 passes with or without it, and the zone's own arc below raises the shadow split to .10 / .12 where the light turns.
  post: {
    bloom: { threshold: 1.55, knee: 0.25, strength: 0.42 },
    grade: { highlightTint: '#ffc888', highlightAmt: 0.14, shadowTint: '#2e4a54', shadowAmt: 0.08, saturation: 1.09, contrast: 1.05, gain: [1.04, 1, 0.96] },
  },
  // SR-05: the run arc as ABSOLUTE keys (they replace the default arc; a field a key does not name keeps the preset). t600 a deeper amber (the sun barely moves: the teal water needs its blue), t780 the golden hour (the
  // lantern pools wake, x2.6), t880 / 900 the blood dusk: a wine-rose air (haze #b0645a, fog #6a4454), violet shade, a rosier sun, the pools x3. The ground keeps its own hues: the telegraphs and gold elites stay readable.
  // Fix round 1 (dusk readability, the A-17 goal): the first dusk (hemi x .82, contrast 1.08, shadow split .16) cancelled the crowd lift exactly where the crowd is densest (arena / 880 s: the share of centre pixels
  // below luma 30 fell only 2-9 % against START, the dark-orc p10 rose 3-4 luma; the day frames fell 38-43 % and +13). Now the shade is open at dusk (hemi sky #b49cb4 / ground #84605a at x 1.12, sun 4.5, contrast 1.05, split
  // .11, gamma 1.10) and the golden hour carries a little more hemisphere (x .9 at t600, .96 at t780: every tier, low included): in deterministic 170-orc scenes (tools/horde2_eval.js, tools/crowd_metrics.py) the
  // centre share below luma 30 falls 47-50 % at 800 / 880 / 896 s and the dark-orc p10 rises +9..+16 over START on high; the rose air keeps its colour (haze / fog hue unchanged, a little less saturated:
  // the est_north view at 880 was a flat crimson wall).
  arc: [
    { t: 0 },
    { t: 600, sun: { color: '#ffc58a', intensity: 4.8 }, hemi: { intensity: 0.9 }, haze: { color: '#d4a066', depth: 0.3 }, fill: { shadowTint: '#46667c' }, grade: { highlightAmt: 0.16, shadowAmt: 0.1, saturation: 1.12, gain: [1.05, 1, 0.95] }, poolGain: 2 },
    { t: 780, sun: { color: '#ffbc80', intensity: 4.7 }, hemi: { intensity: 0.96 }, haze: { color: '#d6a068', depth: 0.3, mist: 0.02 }, fog: { color: '#a8825a' }, fill: { shadowTint: '#4c5a88' }, grade: { highlightTint: '#ffb460', highlightAmt: 0.18, shadowAmt: 0.12, saturation: 1.14, gain: [1.06, 1, 0.94] }, poolGain: 2.6 },
    { t: 880, sun: { color: '#ffae88', intensity: 4.5 }, hemi: { sky: '#b49cb4', ground: '#84605a', intensity: 1.12 }, fill: { shadowTint: '#563e7a', shadowFill: 0.2 }, haze: { color: '#b0645a', depth: 0.29, mist: 0.07 }, fog: { color: '#6a4454', near: 54, far: 205 }, grade: { highlightTint: '#ff9c7c', highlightAmt: 0.12, shadowTint: '#34244e', shadowAmt: 0.11, saturation: 1.02, contrast: 1.05, gamma: 1.1, gain: [1.02, 0.98, 0.98] }, poolGain: 3 },
    { t: 900, sun: { color: '#ffae88', intensity: 4.5 }, hemi: { sky: '#b49cb4', ground: '#84605a', intensity: 1.12 }, fill: { shadowTint: '#563e7a', shadowFill: 0.2 }, haze: { color: '#b0645a', depth: 0.29, mist: 0.07 }, fog: { color: '#6a4454', near: 54, far: 205 }, grade: { highlightTint: '#ff9c7c', highlightAmt: 0.12, shadowTint: '#34244e', shadowAmt: 0.11, saturation: 1.02, contrast: 1.05, gamma: 1.1, gain: [1.02, 0.98, 0.98] }, poolGain: 3 },
  ],
  // SR-05: the sickness takes the far air toward a deep indigo and the shade toward a plum bruise. Fix round 1: the first build named only the haze and the corruption was invisible at the gameplay camera (the lit grass
  // moved from #704b0d to #6d450e at corruption .85). The haze is deeper now (#3a2490) and the shadow tint is a BRIGHT plum (#a0569d): the grade's split tone is normalised to a fixed dark luma (arc.ts `gradeTintLuma`), so only
  // the hue ratios are bound by the PL-04 "no milky veil" tests (blue / luma <= ~2.4, which is why a bluer violet like #6c3eb8 fails them), but the baked-shadow fill and the bruise light of the hemispheres take the tint's own
  // brightness: the cliffs and shaded ground warm toward plum and the lawn's green / blue drain a little more (late scene at .85: lawn G -5, B -8, cliff R +8..+10, water R +4..+5 against the clean frame). The amounts
  // (desaturate, darken) stay the PL-04 defaults on purpose: arc.test.ts pins them for every zone (D.desaturate / D.darken), and desaturate .5 / darken .3 (lawn blue +17: a plainly sick world) fails 6 of its tests, so a stronger
  // gameplay-camera sickness is a PL-04 / arc.test.ts decision (the lead), not a look value
  corruption: { haze: '#3a2490', shadowTint: '#a0569d' },
  // SR-05 (A-17): the orcs are dark models: darken .12 -> 0 and desaturate .15 -> .03 stop the black mass, the rim .24 -> .36 keeps them off the ground (all four fields are required). The gold (tier 2) and the boss
  // rims are the crowd shader's own and stay far stronger (.95), so the elites still read gold on the more golden lawn
  readability: { rim: '#f6f0e6', rimStrength: 0.06, desaturate: 0.03, darken: 0 },
  targets: {
    // SR-01 re-base (autumn light, fix round 1): the amber sun saturates the field (mean HSV saturation 180 at the zonecheck spots, the
    // art-direction target frame measures 186) and shifts the lawn to olive-gold (#545017 shade) over russet road earth (#8f6233); luma
    
    // sat 113-135, is no longer the aim of this zone. SR-02's field band (.55-.65 = 140-166) sits below sat [150, 215]: SR-02 re-bases it.
    // SR-02 re-base (olive-gold field with gold seed-head clumps): zonecheck lawn clusters #846727 / #94752f / #8e702a (field luma 82-88, sat 185-189
    // = .73; the WP's .55-.65 is below what a lit warm surface reaches under the amber sun: see build/SR-02 notes), road earth unchanged
    // SR-05 re-base (the grade adds colour): zonecheck --still measures field luma 87.3 / 78.9 (START 88.2 / 79.6) and sat 192.4 / 195.1 (START 181.9 / 190.5; the first build 197.8 / 201.5), anchors dE 6.6 / 7.6 (START 3.2 / 5.3),
    // water sat 142 (START 133). The ceiling stays at 215 (fix round 1: the first build had loosened it to 222, which admits the lime lawn that reads above ~205 on the stills; the measurement has 20 of headroom), the floor moves up 145 -> 150
    luma: [56, 98],
    sat: [150, 215],
    anchors: ['#8a6c2a', '#8f6233'],
    anchorDE: 22,
    cliffLuma: 85,
    cliffDark: 0.03,
    waterLuma: [60, 140],
    hf: 7.5,
    void: 0.05,
    fine: 1.6,
  },
};
