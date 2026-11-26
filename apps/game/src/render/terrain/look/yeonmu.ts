import { FINAL_TILES, SUN_DIR, YEONMU_TILES } from '../../../world/zones/yeonmu';
import { decal } from '../terrainDecals';
import type { ZoneLook } from './types';


// framing the plateau, a sandy-shored river, hard cast shadows of a few big trees. Round 3: pale neutral granite (floor .34), lit
// tree crowns, greyer-tan earth, depth haze for the wide shots (the HUD camera is far: keep fog near >= 60), decal sand = tile sand.
// Ground layers (recipe order, see world/zones/yeonmu.ts): 0 grass · 1 unused (lawn tile, weight 0) · 2 road earth · 3 granite · 4 plaza tile ·

const T = YEONMU_TILES;

const F = FINAL_TILES;

// YA-01-redo END state and hand-offs (fix round 1; high tier, --time 90 --ui none lawn frames river / meadow / orchard, START = the file before YA-01-redo):
// - lawn luma 53.9 / 73.0 / 65.6 (START 53.7 / 64.3 / 57.0), plain std 22.9 / 24.9 / 25.3 (START 22.9 / 23.3 / 23.0), lit hue 64.3 / 67.8 / 69.1 (START 58.1 /
//   74.3 / 73.7), shade hue 77.3 / 75.7 / 75.8 (START 83.3 / 78.6 / 80.1), shade : lit luma .37 / .44 / .40 (START .36 / .41 / .37). Plaza paving 122 / 124 / 139
//   (high / medium / low, START 115 / 117 / 131), medallion 11-12 darker than the paving beside it (START 9-10), hero ring / paving dE76 on the plaza stills
//   43.8 / 43.9 / 37.9 (START 44.3 / 44.2 / 39.2), zonecheck yeonmu 13 PASS / 0 FAIL (orchard luma 63.9, floor 62), no program links after load.
// - NOT reached by the data of this file (WP lines "lawn luma 70-85 at all three", "local std >= 32", "shade hue 85-110"): the river frame's lawn lies mostly in
//   tree shade, the std and the shade hue are properties of a grade (a contrast curve and a split-tone on the lawn: YA-04), and every
//   exposure lever here (sun, hemisphere, gain) lifts the plaza paving by the same ~1.05 luma per lawn luma, which the hero ring cannot afford (low tier: dE76 37.9,
//   gate 39). The lawn-only lever is the PLAZA_TILE tint in world/zones/yeonmu.ts (YA-02's file, '#e2d8ca'; x.9 would give the key room for about +10 %): it needs
//   the lead's OK and a fieldhash walkHash check. YA-04 starts from the numbers above (its shade hue line: 75.7-77.3 now, band 85-110).
// - hand-offs: FEEL-01-redo (the gold ring and gold coins read less on the cream sand and paving: ring dE76 -1.3 on the low plaza still, -2.8 at e060 low; a dark
//   under-rim is the fix); YA-03's owner (this file re-tunes the river colours deep #3fa8ec / shallow #a6ece0); the atmosphere owner (the cloud field drifts by
//   wind(t) * t * speed, so the drift speeds up over a run; speed .8 here only damps it); SKY-02 / FEEL-04 (the establishing views keep a warm haze band at the far third).

export const YEONMU_LOOK: ZoneLook = {
  // fog / sun / ambient are render-only overrides of zones.json (a1: fog #b0bdd6 50-200 m, sun elevation 48.5 deg)
  biome: {
    // YA-01-redo golden hour: a warm key against a light, near-neutral blue-grey hemisphere (the round-1 teal hemisphere turned every cast shadow on
    // sand olive and the river jade; this one keeps the sand shade brown at hue ~54 and the water blue), honey fog (near 70 keeps the HUD camera clear).
    // SPEC DEVIATIONS (each measured with one lever at a time, A/B server, high tier):
    // - sun #ffecc8, not #ffe3b4: the hero's gold ring stands on the plaza paving, and the warmer the key the more yellow the paving. At the same paving
    //   luma (118) the ring / paving dE76 at e060 is 34.0 with #ffe3b4 and 38.2 with #fff0d0 (START 45); the lit lawn stays at hue 66-69 deg.
    // - sun 5.0, not x1.05 = 2.89: a warm key takes light away (the spec values measured DARKER than the old light). Paving follows the lawn at ~1.05
    //   luma per luma (the same exposure lifts both), so the lawn lift is capped by the plaza (the low tier's paving is already 131 at START): fix round 1:
    //   4.8 -> 5.0 (+4 %) = lawn +1.5 luma (orchard 61.2 -> 63, the zonecheck floor 62 had 0.5 of margin), paving +2 (high / medium / low 122 / 124 / 139).
    // - hemisphere #cdd3dc (spec #d8dcc0): a trace of blue so the shade of the sand stays brown; intensity .9. Fix round 1 measured the levers that could
    //   move the shade (still frames, high): fill .7 -> .45 with shadowFill .3 / tint #4f7aa0 changed the shade hue by 0.0 and the shade : lit luma by -.01;
    //   a bluer sky #bccfe6 with an olive ground #6f8248 moved the lawn shade hue 76.1 -> 77.2 and the SAND shade hue 49.0 -> 52.7 (worse); the hemisphere
    //   intensity .78 deepened the river frame's shade (lawn luma 54 -> 50). None of them is kept: the lawn shade hue 85-110 / std >= 32 lines are carried by
    //   YA-04's grade (a split-tone and a contrast curve act on the lawn and not on the plaza's value; see the notes of the fix round).
    // - fog far 230 -> 270 and haze depth .32 -> .28 (fix round 1): the establishing views (the run-start fly-in) opened on a flat beige wall (the far
    //   third of the frame was one cream band); the trees and halls now keep their silhouette in the honey air. The gameplay camera sees < 100 m
    //   (fog 70 -> 270 = 15 % at 100 m instead of 19 %): the warm air round the hero is unchanged (the gameplay lawn frames measure the same).
    fog: { color: '#d6d2c0', near: 70, far: 270 },
    sun: { color: '#ffecc8', intensity: 5.0, dir: SUN_DIR },
    ambient: { sky: '#cdd3dc', ground: '#86744a', intensity: 0.9 },
    // a1 has no falling leaves: the drifting flat-leaf sprite is gone from this zone
    particles: '',
    water: { color: '#5496c4' },
  },
  style: {
    // YA-01-redo: the macro tint is OFF (strength .3 -> 0; spec .4 with warm #fff2b8 / #9fb07e). Macro and accent multiply EVERY layer, paving included:
    // a yellow multiplier takes blue out of the paving and costs the hero ring its contrast (plaza stills: dropping macro .3 + accent .25, with the gain
    // trimmed 1.17 -> 1.08 to keep the exposure, gave +2.2 dE76 and +3 lawn luma; round 1 had .85 strength with a gain of 3.9, which bleached the plaza).
    // At the 48 m gameplay frame a 52-60 m patch is a gradient, not a patch: the lawn's own light and shade come from the cloud and cast shadows.
    macroDark: '#b4c294',
    macroLight: '#fff4d4',
    macroStrength: 0,
    macroScale: 52,
    // .88 -> .94: a richer lime / gold lawn (the paving's chroma barely moves: ring / paving dE76 -.5)
    saturation: F ? 0.94 : 0.9,
    // 1.78 -> 1.08 with the 4.8 key (and no macro dimming): the meadow t90 frame goes 64 -> 72 luma (+12 %), the orchard 57 -> 66, the plaza paving 115 -> 120
    // (+5 %; high / medium / low 120 / 122 / 137, START 115 / 117 / 131: the same tier spread, no per-tier lever). Never the round-1 gain of 3.9.
    // Fix round 1: the key is 5.0 now (see biome), gain unchanged.
    gain: F ? 1.08 : 1.28,
    // .85 -> 1.0: a deviation of build 1 (+18 % ground normal strength; the spec does not ask for it, the build left no reason; recorded here in fix
    // round 1). It is a uniform, perf 0, and every pair of both rounds was judged with it. Fix round 1 tried 1.5 on the lawn: the plain lawn std stays
    // 24.3 (meadow) / 23.0 (orchard) (ctl 24.5 / 24.2), so the normal does not carry the std line, and 1.0 stays
    normal: 1.0,
    cliffTint: '#f0f2f7',
    shoreWet: 0.08,
    lavaGlow: 0,
    sparkle: 0,
    // no calm blur: the large tonal patches come from the layer weights (lawn / dark lawn / field) and every tile carries the same
    
    calm: { amount: 0, scale: 46, normalCut: 0 },
    // pale granite: never a black wall; the stain streaks stop smearing; a scree band at the foot
    // A3: the rock starts at 29 deg with a little ragged edge (no flicker on the 20-26 deg lawn slopes)
    cliff: { stainAmp: 0.1, stainAspect: 4, strataAmp: 0.2, strataScale: 9, floor: 0.3, aoMin: 0.8, rimFill: 0.12, foot: { color: '#8f9188', width: 2.2 }, onset: [0.12, 0.29], onsetNoise: 0.04 },
    // soft ragged borders between the tonal patches
    blend: { window: 0.42, heightK: 0.5, edgeNoise: 0.4, warp: 0.35 },
  },
  // YA-01-redo: off with the macro tint (same reason)
  accent: { a: '#ffeebc', b: '#bcd89c', strength: 0, scale: 52 },
  // YA-01-redo: warm key, cool fill. The slate shadow tint of the spec (#5f7898) at .2 (spec .22) and a bluer, stronger fill hemisphere (it lowers the
  // paving's chroma, the hero ring keeps its contrast; a cyan or green fill turns the shade on sand olive)
  fill: { sky: '#b0ccf6', ground: '#7a7a4e', intensity: 0.7, shadowTint: '#5f7898', shadowFill: 0.2 },
  // hard readable cast shadows of the trees and halls on the calm ground. B1: the trees throw their real crown silhouette (baked
  // 1.0: the painted lobes of r5 are gone); strength .72 puts the lawn shadow at 0.54 of the lit grass (a1: 0.52-0.63).
  // `others` keeps the rim / wall-block / hall baked shadows at the .32 they were tuned for; the loose boulders have their own knob (`rocks`)
  shadow: {
    intensity: 0.9,
    baked: 1.0,
    ao: 0.45,
    soft: 0.5,
    // YA-03 (A-13): one smoothing pass on the rasterised outline (the 0.25 m texel stair-steps on the bank sand next to the hero are gone) and a
    // faint soft capsule kept under each crown as a penumbra
    // YA-01-redo: strength .72 -> .8 (YA-03's smoothing keeps the outline clean). At .9 the shade of the river frame went darker than START (lawn luma 54.7 ->
    // 50.8, sand shade 68 -> 55) while the lit lawn rose; at .8 both stay at START (53.8 / 66) and the lit : shade ratio still grows with the brighter key
    trees: { strength: 0.8, others: 0.32, edge: 1, capsule: 0.15 },
    // settle: the loose boulders and slabs get a real cast shadow and a soft contact ring (they floated on the lit lawn: the old bake kept both
    // under the stone). Final darkness .78 x 1 (not scaled by `others`), the shadow is 2.6x as long as the old one, the AO halo reaches 2 m
    rocks: { reach: 2.6, width: 1.35, strength: 1.2, halo: 2, ao: 1.6 },
  },
  // YA-01-redo: drifting cloud shadows, strength .14 -> .22 (spec), but a SMALLER field than the spec's 220 m (110 m) and a slower drift (.8 m/s, spec 2):
  // (1) at 220 m a cloud bank spans several screens, so it reads as the light dimming, not as a shadow (round 2: a t / t+15 s pair changed the frame ~2 %);
  // at 110 m a cloud edge (sun and cloud in one 48 x 30 m frame) is in 54 % of the (spot, time) frames of the cloud model, 13 % are fully covered, and it drifts
  // across it in about a minute. (2) atmosphere.ts moves the field by wind(t) * t * speed and the wind angle swings +-.5 rad over ~126 s, so the sideways
  // drift grows to ~.025 * t * speed m/s (20 m/s at 400 s with speed 1): the speed is kept low so a late-run frame does not strobe (speed / scale .007
  // against the old .016). A covered patch is ~11 % darker in luma (only the sun's share is scaled).
  cloud: { strength: 0.22, scale: 110, speed: 0.8 },
  // YA-01-redo: golden air (#e8d2a4) in place of the cool lilac haze (depth .32 -> .28 in fix round 1: see the fog note in biome)
  haze: { color: '#e8d2a4', depth: 0.28, range: 38, mist: 0.0, mistScale: 70, mistSpeed: 1, mistHeight: 2, clearRadius: 14 },
  pools: {
    stone_lantern: { color: '#ffd08a', intensity: 0.26, radius: 5, flicker: 0.05 },
    lamp_post: { color: '#ffd890', intensity: 0.28, radius: 5.5, flicker: 0.05 },
  },
  // The first four families are the C0 kinds (the zones-core tests derive their "old look" from them); the C8 soft scuffs come after.
  decals: [
    // a few pebbles in the road earth, the sand and the scree, gathered in drifts
    // YA-01-redo fix round 1: the pebble / leaf / crack colours below are absolute colours mixed in after the terrain grade (see the medallion note):
    // x.7 (pebble, leaf) and x.65 (crack) of the START colours keep them at START's value against the ground under the 5.0 key (pebble #85806f / #b9b09c,
    // leaf #a8602c / #d8a844 at START). Both fade out at 38-40 m, so they only show in the lower third of the gameplay frame
    { kind: 'pebble', cell: 0.9, density: 0.2, size: 0.085, a: '#5d5950', b: '#827b6d', layers: [0, 0, 0.35, 0, 0, 0, 0.25, 1], fade: [20, 40], patch: { scale: 8, lo: 0.45, hi: 0.7 } },
    // fallen leaves only under the groves (dark lawn), a few and small
    { kind: 'leaf', cell: 0.6, density: 0.14, size: 0.08, a: '#753f1e', b: '#977530', layers: [0.3, 0, 0, 0, 0, 0.5, 0, 0], canopy: 3, fade: [20, 38], patch: { scale: 9, lo: 0.5, hi: 0.72 } },
    // the plaza flagstones: a faint per-stone value change (never a mosaic)
    { kind: 'cell', cell: 1.6, density: 0.16, size: 0, a: '#c9c0aa', b: '#f2ecde', layers: [0, 1, 0, 0, 1, 0, 0, 0], fade: [30, 70] },
    // YA-02: faint moss in the joints of the plaza paving, in patches (high only: medium renders the first two families). The paving outside the
    // medallion disc is layer 1, the twin of layer 4 (world/zones/yeonmu.ts), so the moss never crosses the carved picture. This takes the slot of
    // the faint river-sand ripples, the family whose removal changes the frames least (each family switched off in place at 6 spots: mean abs
    // pixel diff 0.03 at the river still, 0 elsewhere; the village-ground scuff 0.14, the plaza cell 1.8)
    // YA-01-redo fix round 1: moss #7c8a5a / #96a56b -> #515a3a / #626c45 (x.65): at the full colour the veins were thin LIME lines brighter than the paving
    // (1:1 crops of the plaza still and e060: tune/a1x/crop_veins_START_ctl_a1x.png), now dark olive joint moss like START's
    decal({ kind: 'crack', cell: 1.3, density: 0.055, size: 0.6, a: '#515a3a', b: '#626c45', layers: [0, 1, 0, 0, 0, 0, 0, 0], opacity: 0.5, fade: [26, 60], patch: { scale: 6, lo: 0.38, hi: 0.72 } }),
    // soft tonal blots (3-4 m) on the lawns: the "calm patches" that make the ground read as hand-painted, not sprinkled
    decal({ kind: 'scuff', cell: 8, density: 0.6, size: 3.4, a: '#b3bb84', b: '#f1efcc', layers: [1, 0, 0.2, 0, 0, 0, 0, 0], opacity: 0.32, fade: [40, 80] }),
    // wide pale / dark mottling of the beaten earth (tracks, village ground)
    decal({ kind: 'scuff', cell: 12, density: 0.55, size: 5, a: '#c3b48c', b: '#f6eed6', layers: [0, 0, 1, 0, 0, 0, 0.5, 0.4], opacity: 0.34, fade: [40, 90], seed: 7 }),
  ],
  // A4: the carved glyph medallion on the plaza centre (one non-tiling picture, lit as ground, under the decals)
  // YA-01-redo fix round 1: tint #d8dce4 -> #afb2b9 (x.81). The medallion colour (and every decal colour that is an absolute colour: crack, pebble, leaf)
  // is mixed into the albedo AFTER terrainGrade, so it never saw the gain cut (1.78 -> 1.08) but got the whole key (2.75 -> 5.0): the disc went from 10
  // darker than the paving to 15 brighter on every tier and bled the first frame of a run (low) and the hero ring's contrast. At x.81 (the 'DL' = medallion luma
  // minus the paving luma beside it, plaza stills high / medium / low) it is -11 again (START -9 .. -11); ring / paving dE76 on the plaza still 42.9 (START 42.9)
  medallion: { tex: 'tex_yeonmu_plaza_medallion', radius: 8.6, rotation: 0.35, opacity: 1, feather: 0.14, tint: '#afb2b9', relief: 0.4 },
  roughness: { [T.road.tex]: 0.88, [T.rock.tex]: 0.88, [T.plaza.tex]: 0.8, [T.sand.tex]: 0.78 },
  // the sandy shelf and soft foam the C3 river asks for (no cobble strip, no foam beads)
  liquidLook: {
    // B2: the bank layers (sand shelf, shore decal) lie in the terrain's shadows like the ground does
    shade: 1,
    water: {
      // the decal sand matches the terrain sand tile (a lighter decal left the dark bare tile showing as a thin outline at the waterline)
      shore: { color: '#9a8f70', width: 3.2, softness: 0.9 },
      // YA-03 (A-12): the river read as an opaque grey-blue carpet (water crop luma 77, sat .42, dull grey-blue from the bank to the channel). Fix round: the
      // spec's deep #2f7fbd renders a dark navy carpet (luma 58 / sat .70) and the first build's flat light azure (#68ceff) left no visible depth, so the deep
      // tone is #5cc4fc (a clear mid azure) over bright aqua shallows (#c0fcea, clarity .40: the sand bed shows through the first metres): the river crop
      // measures luma 91.5 / sat .57 with a 111 -> 86 luma and teal -> azure hue grade over the first 500 px from the bank (acceptance 90-105 / .5-.6).
      // Glints x3 (.9). Foam stays low (.25, was .35): at .35-.55 the obstacle foam round a rock in the pond fills a flat snow-white disc and the swash lace
      // reads as a rim; at .25 the lace stays a soft broken line and the disc a pale teal patch
      foam: 0.25,
      glitter: 0.9,
      bedStones: 0.15,
      // YA-01-redo: the warm key and the brighter hemisphere lifted YA-03's colours to luma 117 / sat .48 (YA-03 acceptance 90-105 / .5-.6): a deeper azure
      // over slightly deeper aqua shallows bring the river back to luma 100 / sat .58 (the water mask of compose / measure; START with YA-03: 94 / .55)
      deep: '#3fa8ec',
      shallow: '#a6ece0',
      bed: '#b9a98a',
      clarity: 0.4,
      taper: 30,
    },
  },
  // YA-01-redo: the ground cover (tufts, flowers) is a lit mesh: it gets the key without the terrain gain, so build 1 re-graded it for the golden key
  // ([.98, 1, .9] at START -> [1.04, 1.07, .94]); the same holds for the autumn / pine / bark grades below (the spec only says 'tree looks brighter'). Recorded in fix round 1
  cover: { grade: [1.04, 1.07, 0.94], density: 0.55 },
  trees: {
    // YA-01-redo: brighter crowns in the golden light, more light through the leaves (.5 -> .6)
    broadleaf: { grade: [1.28, 1.36, 1.0], barkGrade: [1.2, 1.15, 1.08], translucency: 0.6, fol: ['tex_fol_yeonmu_beech', 'tex_fol_broadleaf'] },
    pine: { grade: [1.06, 1.16, 0.96], barkGrade: [1.16, 1.08, 1.0] },
    // rust-orange rather than red with lime: the old red card alone (no lime lobes), graded towards amber, until the generated
    
    autumn: F
      ? { grade: [1.18, 1.08, 0.96], barkGrade: [1.26, 1.16, 1.06], translucency: 0.6, fol: ['tex_fol_yeonmu_autumn', null] }
      : { grade: [0.84, 1, 0.62], barkGrade: [0.86, 0.8, 0.74], translucency: 0.6, fol: ['tex_fol_autumn', null] },
  },
  // the cut round the hero leaves a ghost of the crown (never a hard bite out of it)
  occlusion: { radius: 2.8, feather: 1.1, minAlpha: 0.22 },
  edge: { farSkirt: true, fogWall: 0.6, ringBase: 18 },
  // granite caps: a faint grey-green dusting only on the up-facing faces (no moss green)
  rockCaps: { [T.rock.tex]: { params: [0.62, 0.22, 0.08, 0.7], color: [0.42, 0.43, 0.34] } },
  // A2: the loose boulders and slabs use the granite wall tile (tex_yeonmu_cliff_b) at 1.5x with their own tint / contrast / saturation / dirt
  // and keep their dark cracks (the cliff floor / aoMin lift made them pale chalk); the rim outcrops and ledges use it at the wall scale
  rocks: {
    tex: { boulder: 'tex_yeonmu_cliff_b', slab: 'tex_yeonmu_cliff_b' },
    relief: { boulder: 1.6, slab: 1.5, outcrop: 1.3, ledge: 1.25 },
    rough: { boulder: 0.04, slab: 0.03, outcrop: 0.012, ledge: 0.01 },
    kind: {
      boulder: { tint: '#f4f1ea', gain: 1.1, contrast: 1.15, dirt: 0.4, normal: 1.3, scale: 1.5, saturation: 0.75, floor: 0.1, aoMin: 0.5, rimFill: 0.1 },
      slab: { tint: '#f4f1ea', gain: 1.1, contrast: 1.15, dirt: 0.4, normal: 1.3, scale: 1.5, saturation: 0.75, floor: 0.1, aoMin: 0.5, rimFill: 0.1 },
      outcrop: { contrast: 1.15, dirt: 0.3, normal: 1.25, aoMin: 0.62 },
      // geo: the squared ledge blocks take their triplanar weights from the face normal (the vertical dotted seam of cliffeast)
      ledge: { contrast: 1.15, dirt: 0.3, normal: 1.25, aoMin: 0.62, geo: true },
    },
  },
  // YA-04 (A-02 / A-03 / A-07 / A-10): the composite pass of Yeonmu (high / medium; low has no composite pass and keeps the light presets only). The warm key
  // (YA-01-redo) lights the lawn, the grade splits the picture: warm lit surfaces, a cool teal fill in the shade, richer greens and a punchier sun / shade step.
  // SPEC DEVIATIONS (each measured on the A/B server, high tier, stills river / meadow / orchard / plaza, START = the file before YA-04):
  // - The split-tone weights act on LINEAR luma (the grade runs after the tone mapper, before the sRGB encode): a lit lawn is ~0.06-0.1 and a shaded one ~0.02, so
  //   `shadowAmt` (x (1 - l)^2) is nearly the same weight everywhere on the ground and `highlightAmt` (x l^2) is ~0 on any lawn (the spec's .12 changed nothing but
  //   the sand). The tint therefore acts as a teal fill that lifts the BLUE of the darks (relatively more in the shade, which has little blue of its own): the shade hue
  //   goes 76-77 deg -> ~97-111, the lit lawn keeps its hue (the highlight tint reaches the sand, the paving and the sun glints through `balance` .3).
  //   The spec's #2c4a5a (dark) darkened the whole frame (lawn luma -2 %), so the tint is a lighter teal #337478: the shade is lifted, not veiled.
  // - saturation 1.06 -> 1.18, contrast 1.08 -> 1.18 about a LOWER pivot (.18 -> .09 linear): the pivot sits on the lit lawn, so the S-curve brightens what the sun hits
  //   (sand, paving, glints) and deepens the cast shadows instead of dragging the whole lawn down (the spec's contrast about .18 lowered the lawn luma by ~4 %).
  //   gamma 1.05 lifts the mids a little, gain [1.02, 1.02, .99] keeps the lit lawn hue at 58-70 deg (a cooler gain turned it lime).
  //   Measured (high stills river / meadow / orchard, START -> now): lawn luma 54.6 / 71.6 / 62.7 -> 76 / 84 / 76, shade hue 77 / 76 / 77 -> 111 / 97 / 105, saturation of
  //   the water mask .56 -> .59, hero ring / paving dE76 on the plaza 43.6 -> 49.1 (the ring reads better on the warmer paving).
  // - bloom threshold .9 and vignette .36 as the spec (the pipeline's .92 / .34: a hair more glow on sun glints and sand, a hair more corner shade).
  post: {
    grade: {
      shadowTint: '#337478',
      shadowAmt: 0.16,
      highlightTint: '#ffd9a0',
      highlightAmt: 0.2,
      balance: 0.3,
      saturation: 1.18,
      contrast: 1.18,
      pivot: 0.09,
      gamma: 1.05,
      gain: [1.02, 1.02, 0.99],
    },
    bloom: { threshold: 1.55, knee: 0.25, strength: 0.42 },
    vignette: 0.36,
  },
  // YA-04: the run arc as ABSOLUTE keys (they replace the default arc, whose relative values were written for the preset's neutral light). t600 the afternoon: the sun and the
  // haze turn honey; t780 the golden hour (the lanterns wake, x2.6); t880 / 900 the Great Metin's dusk: an orange sun (#ffa874, not the spec's #ff8a5c: the amber sun keeps
  // only ~39 % of its green (linear), the spec's keeps 25 % and turned every lawn brown-red, the readable ground is the point of the final fight), x.9 of the key, a lilac
  // hemisphere and violet shadows, a rose haze (#c8746a, spec #c46a6a) and the spec's mauve fog #6e4a58. The grade follows (violet shadow tint, a salmon highlight tint) and
  // keeps the saturation: the lawn stays green, the telegraphs and the gold elites stay readable. The lanterns x3 (spec), the medallion's bright inlay +.4 (spec).
  arc: [
    { t: 0 },
    { t: 600, sun: { color: '#ffd29a' }, haze: { color: '#ecc98e' }, poolGain: 2 },
    { t: 780, sun: { color: '#ffbc84', intensity: 4.8 }, haze: { color: '#e0ad84', depth: 0.3 }, fill: { shadowTint: '#4c5a88' }, poolGain: 2.6 },
    {
      t: 880,
      sun: { color: '#ffa874', intensity: 4.5 },
      hemi: { sky: '#b49ab8', intensity: 0.85 },
      fill: { shadowTint: '#5a4a86', shadowFill: 0.24 },
      haze: { color: '#c8746a', depth: 0.32, mist: 0.04 },
      fog: { color: '#6e4a58' },
      grade: { highlightTint: '#ffb088', highlightAmt: 0.24, shadowTint: '#3a2a5a', shadowAmt: 0.22, saturation: 1.14, gain: [1.02, 0.99, 0.98] },
      poolGain: 3,
      medallionGlow: 0.4,
    },
    {
      t: 900,
      sun: { color: '#ffa874', intensity: 4.5 },
      hemi: { sky: '#b49ab8', intensity: 0.85 },
      fill: { shadowTint: '#5a4a86', shadowFill: 0.24 },
      haze: { color: '#c8746a', depth: 0.32, mist: 0.04 },
      fog: { color: '#6e4a58' },
      grade: { highlightTint: '#ffb088', highlightAmt: 0.24, shadowTint: '#3a2a5a', shadowAmt: 0.22, saturation: 1.14, gain: [1.02, 0.99, 0.98] },
      poolGain: 3,
      medallionGlow: 0.4,
    },
  ],
  // YA-04 (spec): the sickness takes the far air toward a grey-violet (#7a6a8e: it moves the honey haze only 35 % of the way) and the shade toward a bruised violet (#4e4270);
  // the amounts (15 % of the saturation, 10 % of the shadow fill) stay the PL-04 defaults
  corruption: { haze: '#7a6a8e', shadowTint: '#4e4270' },
  targets: {
    
    // stills measure luma 71 / 63 and sat 179 / 181 (a cloud shadow of the drifting clouds sits on the orchard at t = 0: the same lawn in sun is ~66).
    // The floor is the spec's 62, the ceiling keeps room above for YA-04's grade. The sat band is a drift guard: a lawn above ~205 is lime, not golden.
    
    // YA-04 re-base (the grade lifts the lawn and tints its shade teal): zonecheck --still measures meadow / orchard luma 83.0 / 75.1 (YA-01-redo 71 / 64) and sat 168.9 / 156.8
    // (YA-01-redo 179 / 181: the teal fill adds blue to the darks, which lowers the HSV saturation while the grade's saturation 1.18 raises the lit colour), anchors dE 3.1 / 8.6, water luma
    // 107.8, cliff luma 123.5. The floors keep ~10 % of room under the weakest spot (luma 75 -> 68, sat 157 -> 140), the ceiling is unchanged (a lawn above ~205 reads lime)
    luma: [68, 120],
    sat: [140, 205],
    anchors: ['#545d21', '#2c340e'],
    anchorDE: 22,
    cliffLuma: 85,
    cliffDark: 0.03,
    waterLuma: [70, 150],
    
    // (3.6-4.9x that crop), ours 0.105-0.114 (1.1-1.3x): the gate follows the gameplay camera
    hf: 7.5,
    void: 0.05,
    fine: 1.6,
  },
};
