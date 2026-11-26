// Per-zone ART DIRECTION data for the terrain family (ground shading, procedural ground decals, lighting fill, haze, light
// pools, central seal). Layout (which ground layer where) lives in the zone recipes (src/world/zones); this file says how the
// shared terrain shader dresses that layout. One file per zone in this folder; `lookFor(zone)` resolves it.
//
// Everything here is render-only and may use any maths; nothing feeds the simulation.
//
// CONTRACT (zones core C0, 2026-10-13): every field added for the zone rebuild is OPTIONAL and its absence reproduces the
// look as it was before; each says which core item consumes it (C1 cliff, C2 calm ground, C3 liquids, C4 cover/trees,

// accepted and ignored. Zone builders own look/<zone>.ts and never edit data/content/zones.json: fog / sun / ambient / sky
// / particles go in `biome` (applied by resolveBiome in look/index.ts).
//
// CONTRACT (upgrade stage 2, A0-LOOK, 2026-10-28): the grade / run arc / corruption tint / extra ambient loops / lava, ice and
// crystal knobs / light-source flares each add OPTIONAL fields below (post, arc, corruption, ambientLoops, LiquidLook.lava +
// .ice, RockMatStyle, PoolSpec). A field whose consumer WP (named in its JSDoc) has not landed is accepted and ignored; the
// neutral value of an absent field is what `look/index.ts` exports (NEUTRAL_GRADE, DEFAULT_CORRUPTION, resolveGrade,
// resolveCorruption, loopsOf), so a consumer never writes its own fallback.
import type { BiomePreset } from '../../../data/schema';
import type { RockKind, TreeSpecies } from '../../../world/layoutTypes';
import type { CapStyle } from '../../vegetation/rockMaterials';
import type { TreeLook } from '../../vegetation/treeMaterials';



export interface CalmStyle {
  /** 0..1 share / strength of the calm patches */
  amount: number;
  
  scale: number;
  /** 0..1 normal-map strength removed inside a calm patch */
  normalCut: number;
}

/** Steep-face (cliff / rock wall) shading (C1). Every value defaults to today's shader constants. */
export interface CliffStyle {
  /** amplitude of the vertical rain-stain streaks */
  stainAmp?: number;
  /** vertical stretch of the stain noise (today 28:1; about 4:1 stops the smear) */
  stainAspect?: number;
  /** amplitude / metres per band of the horizontal strata */
  strataAmp?: number;
  strataScale?: number;
  /** minimum albedo luma 0..1 of a cliff face (faces never go black) */
  floor?: number;
  /** minimum baked AO 0..1 on steep faces */
  aoMin?: number;
  /** sky-coloured lift scaled by cliff weight (0 = none) */
  rimFill?: number;
  /** blend band at the cliff foot (grass / snow into rock) */
  foot?: { color: string; width: number };
  /**
   * A3: the slope band where the rock takes over, as `1 - normal.y` from the first rock to full rock (default [0.1, 0.27] =
   * 26..43 deg). Moving the start up (0.13 = 30 deg) keeps rock off the gentle lawn slopes.
   */
  onset?: [number, number];
  /**
   * A3: amplitude of the noise that shifts the onset (default 0.12, so rock flickers onto 16-26 deg lawn slopes); 0 = a clean
   * slope threshold, 0.03-0.05 = a little ragged
   */
  onsetNoise?: number;
  /**
   * A3: strength of the zone's cap layer (layout.capLayer) on up-facing steep ground: absent / true = as before, false / 0 = no
   * cap (the 25-43 deg slopes keep the cliff rock instead of turning into the cap tile), 0..1 = weaker
   */
  cap?: boolean | number;
}

/**
 * Material look of one group of rocks (zones core A2). Every field is optional; absent = the shading the rocks had before. The
 * floor / aoMin / rimFill lift of style.cliff also reaches the rocks (so a pale granite wall never goes black): a boulder that
 * should keep its dark cracks overrides it here.
 */
export interface RockMatStyle {
  /** colour multiplier on the stone (sRGB hex; '#ffffff' = none): the per-zone boulder tint */
  tint?: string;
  /** luminance multiplier replacing the built-in 0.9 (2.8 for the near-black basalt ids) */
  gain?: number;
  /** albedo contrast about mid grey (1 = as before; 1.3 = crisper cracks and grain) */
  contrast?: number;
  /** colour saturation of the stone (1 = as before; 0.6 = greyer, for a warm tile on a neutral granite zone) */
  saturation?: number;
  /** 0..1 darkening of the crevices and the base (low vertex AO) plus vertical rain streaks */
  dirt?: number;
  /** normal-map strength (0.9 as before) */
  normal?: number;
  /** texture repeats multiplier (1 = as before; 1.6 = a finer grain) */
  scale?: number;
  /** up-facing cap (moss / snow / ash) of this group, replacing look.rockCaps / the id guess (null = no cap at all) */
  cap?: CapStyle | null;
  /** minimum albedo luma / minimum vertex AO / sky-coloured rim lift of this group, replacing style.cliff's (0 = no lift) */
  floor?: number;
  aoMin?: number;
  rimFill?: number;
  /**
   * triplanar weights from the face normal (screen-space derivatives) instead of the interpolated vertex normal: for squared blocks
   * ('ledge') whose smooth normals blend two faces over a 0.4 m strip and smear the vertical projection along it (a dotted seam).
   * Default off.
   */
  geo?: boolean;
  /**
   * ROCK-01 (kind 'crystal' only, strict gate): 0..1 fake translucency, a view-dependent wrap light so a crystal lights through
   * its thin edges. Absent = none (today's shading); ROCK-01 reads 0.4 for 'crystal' when the field is absent.
   */
  translucency?: number;
  /** ROCK-01 (kind 'crystal' only): 0..1 strength of the fresnel rim glow (absent = none; ROCK-01 default 0.45 for 'crystal') */
  rimGlow?: number;
  /** ROCK-01: colour of the rim glow (sRGB hex; ROCK-01 default '#9fd6ff') */
  rimColor?: string;
  /**
   * ROCK-01 (kind 'crystal' only): 0..2 inner light (absent = none; ROCK-01 default 0.25; values are clamped to 0..2; the glow is strongest at the
   * tips, which is where the bloom picks it up). The body colour of the ice style (a saturated azure) is fixed in the
   * material: translucency, rimGlow, rimColor, emissive and emissiveColor are the knobs of the look.
   */
  emissive?: number;
  /** ROCK-01: colour of the inner emissive (sRGB hex; ROCK-01 default '#7fc4ff') */
  emissiveColor?: string;
}

/** The rocks of a zone: own texture per kind, material look, mesh relief (zones core A2). */
export interface RockLook {
  /** texture id per rock kind; wins over layout.rockMaterials[placement.mat] (a boulder tile apart from the cliff-face tile) */
  tex?: Partial<Record<RockKind, string>>;
  /** every rock group */
  all?: RockMatStyle;
  /** per kind, over `all` */
  kind?: Partial<Record<RockKind, RockMatStyle>>;
  /** mesh relief: crack groove depth / width and cut-edge crispness multiplier (1 = as before, 2 = deep fractures); one number or per kind */
  relief?: number | Partial<Record<RockKind, number>>;
  /** mesh surface roughness as a fraction of the radius (0 = smooth lumps as before, 0.03-0.06 = chipped stone); one number or per kind */
  rough?: number | Partial<Record<RockKind, number>>;
}

/** Splat border softness (C2): replaces the shader constants 0.34 (window) and 0.9 (height gain). */
export interface BlendStyle {
  window?: number;
  heightK?: number;
  /** 0..1 noise breakup of the borders */
  edgeNoise?: number;
  /**
   * A1: multiplier of the wobble the splat lookup is displaced by (today up to 0.9 m at 53 m and 0.25 m at 13 m scale, i.e. 1).
   * The painted shapes (plaza discs, kerbs, road edges) hold their outline at 0.3-0.6: this is what makes them read carved instead of
   * airbrushed (the finer `paintRes` splat alone changed no visible pixel and is off in the shipped zones); 0 = no wobble (hard geometric edges)
   */
  warp?: number;
}

/** Liquid look knobs (C3). Undefined knobs keep today's constants; one liquid kind per zone. */
export interface LiquidLook {
  /**
   * B2: how much the terrain's own shadow lies on what the liquid system draws ON the bank (the sand shelf of the surface, the
   * sand / wet band of the shore decal, the hoarfrost): 0 / absent = today (always sunlit, a bright dusty veil over shadowed
   * banks), 1 = exactly like the ground under it (the baked sun visibility and AO of the light map at the zone's own
   * `shadow.baked` / `shadow.ao`, the dynamic sun shadow, the zone's shadow fill).
   */
  shade?: number;
  /** debug / before-after pairs only: lay the shore decal out with the pre-B2 triangulation (stray dark quads next to bridge ends) */
  legacyDecalSplit?: boolean;
  water?: {
    /** sandy / wet band along the bank instead of the cobble strip */
    shore?: { color: string; width: number; softness: number };
    /** 0..1 soft foam streaks (no beads) */
    foam?: number;
    /** 0..1 cap of the sun glitter */
    glitter?: number;
    /** 0..1 painted bed stones (0 removes the crack-bed pattern) */
    bedStones?: number;
    /** colours (sRGB hex) and light extinction per metre */
    deep?: string;
    shallow?: string;
    bed?: string;
    clarity?: number;
    /** metres over which the river source / ends taper */
    taper?: number;
  };
  ice?: {
    tint?: string;
    /** 0..1 (1 = opaque slab as today) */
    opacity?: number;
    glitter?: number;
    crack?: number;
    frost?: number;
    /** hairline rim strength (0 = none) */
    rim?: number;
    /** albedo texture id (default 'tex_ice_blue') */
    tex?: string;
    /**
     * LIQ-02 (S-ICE-03): 0..1 cool fresnel sky sheen on the sheet (absent = none; LIQ-02 default 0.35 on QUALITY >= 1). The sun
     * glitter is the EXISTING `glitter` above: no second knob.
     */
    sheen?: number;
    /** LIQ-02: colour of the sheen (sRGB hex; LIQ-02 default '#cfe6ff') */
    sheenColor?: string;
  };
  lava?: {
    /** 'crust' = today's plates; 'flat' = bright molten orange-yellow with slow low-frequency flow */
    mode?: 'flat' | 'crust';
    flowScale?: number;
    emissive?: number;
    shore?: { glow?: number; crackle?: number };
    /** 0..1 soft contact shade on the banks */
    contactShade?: number;
    /**
     * LIQ-01 (D-LAVA-03), 'flat' mode: HDR gain on the hottest flow lines only (heat > 0.8 -> x (1 + hotHdr), tinted, never
     * white; the base colour stays <= 1.0 linear). Absent = none; LIQ-01 default 1.6 on QUALITY >= 1, 0 on low.
     */
    hotHdr?: number;
    /** LIQ-01: 0..1 coverage of the drifting darker cooling skins (absent = none; LIQ-01 default 0.22 on QUALITY >= 1) */
    skin?: number;
    /** LIQ-01: metres per cooling-skin feature (LIQ-01 default 6) */
    skinScale?: number;
  };
}

/** Zone-wide ground cover tuning (C4); per-spec placement knobs live in CoverSpec (world/layoutTypes.ts). */
export interface CoverLook {
  /** colour multiplier on every cover card */
  grade?: [number, number, number];
  /** density multiplier on every cover spec */
  density?: number;
  /** cards per tuft (today 2 crossed; 3+ splayed reads less like a star from the 55° camera) */
  cards?: number;
  /** card splay / pitch (radians) */
  splay?: number;
}

/** Camera-to-hero occlusion cut-out (C5); default radius 2.4 m. */
export interface OcclusionLook {
  radius?: number;
  /** metres of soft rim */
  feather?: number;
  /** 0..1 minimum opacity kept inside the cut */
  minAlpha?: number;
}

/** World-edge closure (C6). */
export interface EdgeLook {
  /** far-field annulus (domain edge to ~600 m) in the zone rock colour fading into fog; false = off */
  farSkirt?: boolean;
  /** 0..1 strength of a fog wall closing the horizon */
  fogWall?: number;
  /** backdrop ring foot height (m) relative to the default */
  ringBase?: number;
}

/** Gameplay readability of rank-and-file enemies on this zone's ground (same shape as crowd CrowdZoneStyle). */
export interface ReadabilityLook {
  /** `#rrggbb` rim colour for tier-0 enemies */
  rim: string;
  rimStrength: number;
  desaturate: number;
  darken: number;
}

/** Partial override of the zone's BiomePreset (data/content/zones.json), render-only; see resolveBiome. */
export interface BiomeLook {
  fog?: Partial<BiomePreset['fog']>;
  sky?: Partial<BiomePreset['sky']>;
  sun?: Partial<BiomePreset['sun']>;
  ambient?: Partial<BiomePreset['ambient']>;
  /** ambient particle preset id ('' = none) */
  particles?: string;
  /** water tint only (level and kind are layout / sim data) */
  water?: { color?: string };
}






export interface ZoneTargets {
  /** open-field shots (role 'field'): mean luma [lo, hi] */
  luma?: [number, number];
  /** open-field shots: mean HSV saturation [lo, hi] */
  sat?: [number, number];
  /** sRGB hex colours that must each lie within `anchorDE` (ΔE76, default 14) of a dominant colour of the field shots */
  anchors?: string[];
  anchorDE?: number;
  /** cliff crops (role 'cliff'): minimum mean luma */
  cliffLuma?: number;
  /** cliff crops: maximum share of pixels with luma < 10 (default 0.03) */
  cliffDark?: number;
  /** liquid crops (role 'water'): mean luma [lo, hi] and maximum saturation */
  waterLuma?: [number, number];
  waterSat?: number;
  
  hf?: number;
  /** edge shots (role 'edge'): maximum share of the lower 60 % of the frame that is featureless fog / void (default 0.05) */
  void?: number;
  /** hero shots (role 'hero'): maximum pixel-scale / 2-4 px energy ratio round the hero (screen-door dither) */
  fine?: number;
  /** per-role { spot name: crop box [x, y, w, h] | null (whole frame) } replacing the spots_meta.json defaults */
  roles?: Partial<Record<'field' | 'cliff' | 'water' | 'edge' | 'hero', Record<string, [number, number, number, number] | null>>>;
}

/** Colour grading of the splat shader (was style.ts). */
export interface TerrainStyle {
  /** large-scale colour variation multiplies albedo by lerp(dark, light, noise) */
  macroDark: string;
  macroLight: string;
  macroStrength: number;
  /** metres per repeat of the large-scale macro noise */
  macroScale: number;
  saturation: number;
  /** albedo multiplier applied after grading (dark textures such as basalt) */
  gain: number;
  /** multiplies layer normal-map strength */
  normal: number;
  /** extra tint on cliff faces */
  cliffTint: string;
  /** ground darkening / saturation boost just above a water line (0..1) */
  shoreWet: number;
  /** emissive glow strength of the lava crust layer and lava shore light (0 = none) */
  lavaGlow: number;
  /** emissive glint strength (snow / ice sparkle) */
  sparkle: number;
  /** C2: calm macro patches (absent = none) */
  calm?: CalmStyle;
  /** C1: steep-face shading (absent = today's constants) */
  cliff?: CliffStyle;
  /** C2: splat border softness (absent = today's constants) */
  blend?: BlendStyle;
}

/**
 * Procedural ground decal family evaluated per pixel by the terrain shader (no geometry, no draw calls). Each slot scatters
 * one decal per jittered grid cell (`cell` metres), gated by `density` and by the weight of the ground layers listed in
 * `layers`, so e.g. leaf litter only lands on grass and cracks only on the dry earth layers.
 */
export type DecalKind =
  /** small shaded stones with a contact shadow */
  | 'pebble'
  /** lens-shaped leaf / petal / flake with a mid-rib */
  | 'leaf'
  /** short scratch / hairline crack segments */
  | 'scratch'
  /** continuous crack network (voronoi cell borders); `density` = crack width in cell units, `size` = fraction of the borders that crack (0 = all); `emissive` makes it glow */
  | 'crack'
  /** tiny dots (flowers, embers, glints); `emissive` > 0 makes them glow and flicker */
  | 'speck'
  /** wind-aligned ridges (sastrugi / dune ripples); `density` = relief amplitude, `cell` = wavelength */
  | 'streak'
  /** per-cell brightness/tint patches (weathered flagstones, stain blotches); `density` = amplitude */
  | 'cell';

export interface DecalSpec {
  kind: DecalKind;
  /** grid cell edge in metres (streak: wavelength) */
  cell: number;
  /** 0..1 chance that a cell holds a decal (see DecalKind for the exceptions) */
  density: number;
  /** decal radius / half length in metres; keep <= 0.45 * cell so shapes stay inside their cell */
  size: number;
  /** colour range (sRGB hex); every decal picks mix(a, b, hash) */
  a: string;
  b: string;
  /** emissive strength of the decal colour (0 = only lit by the scene) */
  emissive?: number;
  /** per ground-layer weight 0..1 (index = groundLayers index; missing = 0) */
  layers: number[];
  /** density multiplier from baked occlusion: dens *= 1 + (1 - ao) * canopy (leaf litter under trees) */
  canopy?: number;
  /** metres from the camera at which the decal starts / finishes fading out (default 26 / 48) */
  fade?: [number, number];
  /** opacity of the decal colour over the ground (default 1) */
  opacity?: number;
  /** gates the decal by a large-scale noise so it clusters in patches (drifts of leaves, cinder fields, stained areas) */
  patch?: { scale: number; lo: number; hi: number };
  /** crack only: domain-warp strength in cell units (meandering fissures, per-crack width, hot core + glow halo when
   * emissive); 0 / missing = straight voronoi borders */
  warp?: number;
  seed?: number;
}

/** A light source baked into the ground "light pool" texture (warm lantern pools, brazier glows). */
export interface PoolSpec {
  /** sRGB hex colour of the glow */
  color: string;
  /** radiance multiplier at the centre (albedo * color * intensity is added as emissive) */
  intensity: number;
  /**
   * metres to the end of the falloff; times the prop's scale for a prop id. For a rock-kind key (`pools['rock:crystal']`, ROCK-01) it is
   * a MULTIPLE of the rock's footprint (the larger of its two horizontal sizes in metres): radius 1.6 gives about 7.4 m round a 4.6 m
   * crystal and 1.6 m round a 1 m shard; radius 3 would give a 13.8 m pool round the 4.6 m one
   */
  radius: number;
  /** 0..1 flicker amplitude (0 = steady) */
  flicker?: number;
  /**
   * PL-05 (S-LIGHT-05): brightness of the additive billboard glow drawn at the emitter (render/terrain/flares.ts). Absent = PL-05's
   * built-in table for the prop id (stone_lantern, brazier, bonfire, lava_pillar, ...); 0 = no flare for this emitter.
   */
  flare?: number;
  /** PL-05: metres above the prop's base where the flare sits (absent = the built-in table's height for the prop id) */
  flareHeight?: number;
}

/**
 * Procedural ritual seal inlaid on the ground (rings, rune band, interlaced rings, spokes) centred on a landmark. Drawn as an
 * aged inlay: thin strips in chiselled grooves whose value follows the ground (`contrast`), partly lost (`wear`), partly
 * buried under dirt / snow (`cover`); leaves and pebbles from the decal families lie on top.
 */
export interface SealSpec {
  /** landmark id the seal is centred on (default 'centre') */
  landmark?: string;
  /** outer radius (m) */
  radius: number;
  /** inlay hue (sRGB hex); only its hue/saturation matter, the value comes from the ground and `contrast` */
  color: string;
  /** emissive strength of the inlay (0 = none); breathes in patches along the strips */
  glow: number;
  /** 0..1 how much of the inlay fell out (empty, dark groove) */
  wear: number;
  /** 0..1 overall opacity */
  opacity: number;
  /** number of rune glyph cells around the band (default 16) */
  ticks?: number;
  /** inlay strip half width (m, default 0.03) */
  line?: number;
  /** inlay value relative to the ground: 0 = same value, 0.2 = 20 % brighter, negative = darker (default 0.15) */
  contrast?: number;
  /** 0..1 strength of the dirt / snow filling the grooves (line hidden) (default 0.35) */
  cover?: number;
  /** 0..1 smoothness of the inlay (roughness drop: metal sheen) (default 0.5) */
  metal?: number;
  /** bevel strength of the groove lip (normal tilt, default 0.6) */
  relief?: number;
  /** stone frame just outside `radius`: width (m) of two courses of kerb blocks (default 0 = none) */
  band?: number;
  /** kerb block value relative to the ground (default -0.1) */
  bandTone?: number;
  /** kerb block length along the ring (m, default 0.9) */
  bandBlock?: number;
  /** cut-stone colour of the kerb blocks (sRGB hex, default '#a8a296') and how much it replaces the ground texture (default 0.7) */
  bandColor?: string;
  bandMix?: number;
}

/**
 * B1: crown-silhouette tree shadows. Every tree's leaf cards (cut by the card texture's alpha) and trunk are projected along
 * the zone's sun into the baked light map, so the ground shows the crown's own outline at the crown's own size, starting at
 * the trunk. The light map is baked finer for it (`res`), the terrain horizon / AO keep their 1 m grid. Painted tree
 * shadows in a zone recipe and `shadow.baked < 1` double / dim it: a zone that turns this on leaves the shadow to it.
 */
export interface TreeShadowLook {
  /** texels per axis of the baked light map over the 512 m domain: 1024 = 0.5 m (today), 1536 = 0.33 m, 2048 = 0.25 m (default) */
  res?: number;
  /** darkness of full leaf cover, 0..1 (default 0.62), then scaled by `shadow.baked` in the terrain shader */
  strength?: number;
  /** per-species multiplier on `strength` (thin bare crowns throw a lighter shadow), e.g. { bare: 0.6 } */
  species?: Partial<Record<TreeSpecies, number>>;
  /** extra smoothing passes on the rasterised outline, ~1 texel (0.25 m at 2048) each (default 0: the leaf outlines are anti-aliased as drawn) */
  edge?: number;
  /** strength of today's soft capsule kept under the silhouette as a penumbra (default 0 = none) */
  capsule?: number;
  /** multiplier on the ambient occlusion stamped under each crown (default 1, 0 = none) */
  ao?: number;
  /**
   * share of the other baked sun shadows (terrain horizon, rocks, props, walls) that is kept, 0..1 (default 1). `shadow.baked`
   * scales every baked shadow alike: a zone that tuned it low to tame the old tree capsules sets `baked` 1 for the crown
   * silhouettes and `others` to the old value to keep the rest as it was.
   */
  others?: number;
}

/** Contact shadow of the loose rocks (bakeLight RockShadowBake): every field optional, absent = as before. */
export interface RockShadowLook {
  /** multiplier on the length of the cast shadow */
  reach?: number;
  /** multiplier on the width of the cast shadow */
  width?: number;
  /** multiplier on the strength of the cast shadow (capped at full) */
  strength?: number;
  /** metres the AO halo grows beyond the rock's footprint */
  halo?: number;
  /** multiplier on the strength of the AO halo (capped at full) */
  ao?: number;
}

/**
 * Zones core A4: a non-tiling picture laid on the ground round a landmark (the plaza centre): one texture mapped to the disc of
 * `radius` (the image's inscribed circle), cut round by the shader, lit as ground, under the decals and the seal. Opaque RGB or
 * with an alpha channel. Absent = no medallion.
 */
export interface MedallionSpec {
  /** manifest texture id (a single non-tiling image, e.g. tex_yeonmu_plaza_medallion) */
  tex: string;
  /** landmark the disc is centred on (default 'centre'); `at` overrides it */
  landmark?: string;
  at?: [number, number];
  /** disc radius in metres */
  radius: number;
  /** turn of the picture (radians, default 0 = its top towards the top of the screen) */
  rotation?: number;
  /** 0..1 opacity over the ground (default 1) */
  opacity?: number;
  /** metres of soft edge (default 0.12) */
  feather?: number;
  /** colour multiplier (sRGB hex, default none) */
  tint?: string;
  /** per ground-layer weight 0..1 that lets the disc show (default 1 on every layer) */
  layers?: number[];
  /** glow of the bright parts of the picture (0 = none, e.g. inlaid runes) */
  emissive?: number;
  /** 0..1 relief: the picture's brightness tilts the ground normal (default 0.35) */
  relief?: number;
}

/**
 * Colour grade of the composite pass (PL-01, A-02 / B-POST-02). Every field optional; an absent field is the identity (see
 * NEUTRAL_GRADE in look/index.ts), so a spec only names what it changes. Applied after tone mapping, before saturation / vignette:
 * `c = pow(max(c * gain + lift * (1 - c), 0), 1 / gamma)`, then a split tone by luma and a soft S-curve about `pivot`.
 */
export interface GradeSpec {
  /** lifts the blacks: `c * gain + lift * (1 - c)` (0 = none) */
  lift?: number;
  /** midtone power, `pow(c, 1 / gamma)` (1 = none; above 1 brightens the mids) */
  gamma?: number;
  /** per-channel multiplier [r, g, b] (1,1,1 = none): the warm / cool white point */
  gain?: [number, number, number];
  /** sRGB hex the shadows are pushed toward by `shadowAmt * (1 - luma)^2` */
  shadowTint?: string;
  /** 0..1 strength of the shadow tint (0 = none, which also makes `shadowTint` inert) */
  shadowAmt?: number;
  /** sRGB hex the highlights are pushed toward by `highlightAmt * luma^2` */
  highlightTint?: string;
  /** 0..1 strength of the highlight tint (0 = none, which also makes `highlightTint` inert) */
  highlightAmt?: number;
  /** -1..1 shifts the split point between shadow and highlight toning (0 = centred) */
  balance?: number;
  /** soft S-curve strength about `pivot` (1 = none; above 1 = punchier) */
  contrast?: number;
  /** linear value the S-curve turns about (0.18 = mid grey) */
  pivot?: number;
  /** colour saturation multiplier (1 = none) */
  saturation?: number;
}

/**
 * PL-01: per-zone post-processing override (the composite pass; low has none, its mood comes from the light presets). Absent
 * fields keep the pipeline's current constants (today's pixels).
 */
export interface PostLook {
  /** bloom of the HDR scene (absent = the pipeline's current values, each field on its own) */
  bloom?: {
    /** luminance (linear HDR) above which pixels bloom */
    threshold?: number;
    /** strength of the bloom added back to the scene */
    strength?: number;
    /** width of the soft knee round the threshold */
    knee?: number;
  };
  /** 0..1 vignette strength (absent = the pipeline's current vignette) */
  vignette?: number;
  /** colour grade (absent = NEUTRAL_GRADE) */
  grade?: GradeSpec;
}

/**
 * PL-03a / PL-03b (A-07): one key of a zone's 15-minute run arc. The renderer smoothsteps between keys by run clock; past the
 * last key the last values hold. A sub-field a key does not name keeps the zone's own preset value at that key (the arc is
 * relative to the preset: a key with only `t` is the identity). The sun DIRECTION never changes (the shadows are baked).
 */
export interface ArcKey {
  /** run clock in seconds (0..905; keys sorted ascending) */
  t: number;
  /** the directional light */
  sun?: {
    /** sRGB hex */
    color?: string;
    /** light intensity */
    intensity?: number;
  };
  /** the hemisphere (ambient) light */
  hemi?: {
    /** sky colour, sRGB hex */
    sky?: string;
    /** ground colour, sRGB hex */
    ground?: string;
    /** light intensity */
    intensity?: number;
  };
  /** ZoneLook.fill: the light that fills shadow */
  fill?: {
    /** sRGB hex added inside baked shadows */
    shadowTint?: string;
    /** strength of that tint */
    shadowFill?: number;
  };
  /** ZoneLook.haze: atmospheric perspective and ground mist */
  haze?: {
    /** sRGB hex */
    color?: string;
    /** 0..1 strength of the depth haze */
    depth?: number;
    /** 0..1 ground mist density */
    mist?: number;
  };
  /** scene fog */
  fog?: {
    /** sRGB hex */
    color?: string;
    /** metres where the fog starts */
    near?: number;
    /** metres where the fog is full */
    far?: number;
  };
  /** colour grade at this key (fields absent here are the zone's PostLook.grade) */
  grade?: GradeSpec;
  /** multiplier on the baked light-pool emissive (lantern and brazier pools get brighter at dusk; 1 = as baked) */
  poolGain?: number;
  /** ADDED to MedallionSpec.emissive (uMedalB.z, clamped <= 1 by the renderer): only the bright parts of the medallion picture glow */
  medallionGlow?: number;
}

/**
 * PL-04 (A-10): how the world looks at full corruption (corruption 0..1 blends toward it). Every field optional; an absent
 * field is the one in DEFAULT_CORRUPTION (look/index.ts), so a zone with no `corruption` still reacts.
 */
export interface CorruptionLook {
  /** sRGB hex the haze colour moves toward (at 0.35 of the corruption) */
  haze?: string;
  /** sRGB hex the shadow tint moves toward */
  shadowTint?: string;
  /** 0..1 saturation lost at full corruption */
  desaturate?: number;
  /** 0..1 shadow-fill (light that fills shadow) lost at full corruption */
  darken?: number;
}

export interface ZoneLook {
  style: TerrainStyle;
  /** warm/cool patch breakup multiplied over the albedo (hue variety on top of the brightness macro) */
  accent?: { a: string; b: string; strength: number; scale: number };
  /** light that fills shadow: extra hemisphere (all lit materials) + tint added inside baked shadows on the ground */
  fill: {
    sky: string;
    ground: string;
    /** extra hemisphere light intensity (0 = none) */
    intensity: number;
    /** colour added (as emissive * albedo) where the baked sun visibility is low */
    shadowTint: string;
    shadowFill: number;
  };
  shadow: {
    /** dynamic sun shadow darkness 0..1 (1 = three's default) */
    intensity: number;
    /** 0..1 strength of the baked tree/prop/terrain shadows on the ground (1 = full) */
    baked: number;
    /** 0..1 strength of the baked ambient occlusion (1 = full) */
    ao: number;
    /** C2: metres of blur on the baked sun visibility and AO (absent / 0 = today's hard bake) */
    soft?: number;
    /** B1: tree shadows projected from the real crown geometry (absent = the soft capsule per tree, as before) */
    trees?: TreeShadowLook;
    /** settle: longer / stronger contact shadows and an AO halo under the loose rocks (absent = the bake as it was; see bakeLight RockShadowBake) */
    rocks?: RockShadowLook;
  };
  /** large soft shadows drifting over the ground (zone-wide, on every material that calls applyAtmosphere) */
  cloud?: { strength: number; scale: number; speed: number };
  /** atmospheric perspective + drifting ground mist on every material that calls applyAtmosphere */
  haze?: {
    /** sRGB hex */
    color: string;
    /** 0..1 strength of the focus-relative depth haze (things farther than the hero fade towards `color`) */
    depth: number;
    /** metres beyond the focus distance at which the depth haze reaches full strength */
    range: number;
    /** 0..1 ground mist density (noise-modulated, low lying) */
    mist: number;
    /** metres per mist feature */
    mistScale: number;
    mistSpeed: number;
    /** metres above the ground over which the mist thins out */
    mistHeight: number;
    /** metres around the hero kept free of mist */
    clearRadius: number;
  };
  /** soft light on the ground around the hero (helps the hero read on dark / busy ground) */
  heroGlow?: { color: string; strength: number; radius: number };
  /** light-emitting props by PROP_DEFS id */
  pools: Record<string, PoolSpec>;
  /** up to 4 procedural decal families */
  decals: DecalSpec[];
  /** central seal */
  seal?: SealSpec;
  /** A4: a non-tiling picture (medallion) on the plaza centre */
  medallion?: MedallionSpec;
  /** perceptual roughness per ground texture id (default 0.95) */
  roughness?: Record<string, number>;
  /** emissive ground layer (lava crust) only glows between these layer weights (smoothstep) */
  emitCap?: [number, number];
  /** C3: liquid look knobs */
  liquidLook?: LiquidLook;
  /** C4: zone-wide ground cover tuning */
  cover?: CoverLook;
  /** C4: per-species tree look override merged over the global species table (render/vegetation/trees.ts) */
  trees?: Partial<Record<TreeSpecies, Partial<TreeLook>>>;
  /** C5: camera-to-hero occlusion cut-out */
  occlusion?: OcclusionLook;
  /** C6: world-edge closure */
  edge?: EdgeLook;
  /** rock cap style by rock material id (wins over the id-substring guess `capStyleFor`) */
  rockCaps?: Record<string, CapStyle>;
  /** A2: the zone's rocks: texture per kind, material look, mesh relief (absent = the rocks as before) */
  rocks?: RockLook;
  /** enemy readability on this ground (wins over render/zoneReadability.ts defaults) */
  readability?: ReadabilityLook;
  /** render-only override of the zone biome (fog / sky / sun / ambient / particles / water tint) */
  biome?: BiomeLook;
  /** PL-01: bloom / vignette / colour grade of this zone's composite pass (absent = the pipeline's defaults and NEUTRAL_GRADE) */
  post?: PostLook;
  /** PL-03a / PL-03b: the run arc as keys by run clock (absent = the renderer's default arc, relative to this zone's preset) */
  arc?: ArcKey[];
  /** PL-04: the corrupted-world tint (absent = DEFAULT_CORRUPTION) */
  corruption?: CorruptionLook;
  /**
   * PL-02: ambient VFX loop ids spawned IN ADDITION to `biome.particles` (embers + fireflies, ...); absent = none. Not
   * `biome.ambient`, which is the ambient LIGHT. Read it through `loopsOf(look)`.
   */
  ambientLoops?: string[];
  /** palette / surface gates for tools/qa/zonecheck.ts */
  targets?: ZoneTargets;
}
