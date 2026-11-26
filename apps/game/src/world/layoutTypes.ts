// Data contract between the zone recipes (src/world/zones/*), TerrainField (sim + render) and the renderers
// (src/render/terrain, src/render/vegetation). Pure data, no three.js.

// ---------------------------------------------------------------------------
// Surface / hazard classification (baked 1 m grid, `TerrainField.surfaceAt`)

export const SURFACE = {
  /** ordinary ground */
  GROUND: 0,
  /** lava: damaging, walkable (the sim applies burn damage) */
  LAVA: 1,
  /** shallow water / ford: walkable, slows movement */
  SHALLOW: 2,
  /** frozen lake / ice sheet: walkable, low friction */
  ICE: 3,
  /** plague miasma / poison ground: walkable, damaging over time */
  MIASMA: 4,
  /** deep water: not walkable */
  DEEP: 5,
} as const;
export type Surface = (typeof SURFACE)[keyof typeof SURFACE];

// ---------------------------------------------------------------------------
// Vegetation

/** Procedural tree species implemented by render/vegetation (see TREE_SPECIES). */
export type TreeSpecies = 'pine' | 'broadleaf' | 'autumn' | 'snowpine' | 'bare' | 'charred';
export const TREE_SPECIES: readonly TreeSpecies[] = ['pine', 'broadleaf', 'autumn', 'snowpine', 'bare', 'charred'];

export interface TreePlacement {
  species: TreeSpecies;
  x: number;
  z: number;
  /** ground height at (x,z) */
  y: number;
  /** uniform scale; 1 = species' nominal height (pine 9 m, broadleaf 7 m, ...) */
  scale: number;
  yaw: number;
  /** variant/seed for the generator (0..65535) */
  seed: number;
}

/** Ground cover cards (grass tufts, flowers, shrubs) scattered by the renderer from the paint masks. */
export interface CoverSpec {
  /** foliage texture id (tex_fol_*) */
  tex: string;
  /** tufts per m² where the allowed layers are fully weighted */
  density: number;
  /** card size range (m, width = size, height = size * aspect) */
  size: [number, number];
  /** per-ground-layer density multiplier (index = groundLayers index; missing = 0) */
  layers: number[];
  /** colour multiplier (hex) applied on top of the texture */
  tint?: string;
  /** tint variation 0..1 */
  tintVar?: number;
  /** wind sway strength multiplier (default 1) */
  sway?: number;
  /** also draw at long range (cheap far card) — only for the main grass cover */
  far?: boolean;
  // ---- cover v2 (zones core C4, render-only). Every field is optional; a spec without any of them (and a zone look
  // without `cover.cards` / `cover.splay`) renders exactly as before (legacy crossed cards, uniform hash placement).
  /**
   * Macro-noise gate on tuft survival: clumps with empty lanes between them. The gate is smoothstep(lo, hi, n) of a
   * 2-octave value noise n (0..1, mean 0.5) with features of about `scale` metres; `density` is the density inside a full
   * clump. lo > hi inverts the gate (tufts only in the lanes, e.g. short grass between the tall clumps). Specs with the same
   * `seed` share one pattern (default: the spec index, i.e. independent patterns). Example: { scale: 9, lo: 0.5, hi: 0.62 }
   * keeps roughly a third of the allowed ground in soft-edged clumps.
   */
  clump?: { scale: number; lo: number; hi: number; seed?: number };
  /**
   * 0..1 jitter of one candidate per stratified grid cell (Poisson-like spacing, no overlapping pairs): 0.6-0.85 reads
   * natural, 0 is a strict grid. Absent = the legacy independent uniform points per cell.
   */
  jitter?: number;
  /** the texture is an atlas of [cols, rows] equal cells (a number n = an n x 1 strip); each tuft picks one cell */
  variants?: number | [number, number];
  /** maximum whole-tuft lean (pitch): sideways offset of the tuft top as a fraction of its height, random per tuft
   * (legacy constant 0.12) */
  lean?: number;
  /** ± fraction of extra per-tuft height variation on top of the size range (default 0) */
  heightVar?: number;
  /** cards per tuft for this spec, drawn as a splayed fan (wins over look.cover.cards; capped per quality tier) */
  cards?: number;
  /** outward splay of the fan cards from vertical, radians (wins over look.cover.splay; default 0.45 once a fan is on) */
  splay?: number;
  /**
   * 0..1 share of the fan cards that turn their painted face to the fixed-yaw gameplay camera (leaning away from it by the
   * splay) instead of leaning out on their own azimuth. Default 1: every tuft card we ship is painted as a side view, so
   * the tuft reads as painted and never as a top-down star; 0 = radial fan, 0.3-0.5 = mixed. Setting it turns the fan on.
   */
  face?: number;
}

// ---------------------------------------------------------------------------
// Rocks, props, walls, bridges

export type RockKind =
  /** rounded river/field boulder */
  | 'boulder'
  /** flat tilted slab */
  | 'slab'
  /** tall narrow spire */
  | 'spire'
  /** cliff-face chunk used to roughen the arena rim (large, partly sunk) */
  | 'outcrop'
  /** squared cliff block with near-vertical faces and strata steps (rim risers, stacked into ledged walls; zones core A2) */
  | 'ledge'
  /** hexagonal basalt column bundle */
  | 'basalt'
  /** glowing/translucent ice or metin crystal cluster */
  | 'crystal'
  /** small scatter stones */
  | 'pebbles';

export interface RockPlacement {
  kind: RockKind;
  x: number;
  z: number;
  y: number;
  /** extents in metres (x = width, y = height, z = depth before yaw) */
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  /** variant seed (0..65535) */
  seed: number;
  /** index into ZoneLayout.rockMaterials */
  mat: number;
  /** metres buried below the ground */
  sink?: number;
  /** extra tilt (radians) about X/Z */
  tiltX?: number;
  tiltZ?: number;
}

/**
 * Structure / prop placement. `id` is a PROP_DEFS key (src/world/props.ts); the renderer resolves it to a Forge GLB
 * (`prop_<id>` in the model manifest) or to its procedural builder.
 */
export interface PropPlacement {
  id: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  scale: number;
  seed: number;
  /**
   * r9 Z9 (r8 judge MF8 e / f / h): optional draw-only variation, never the footprint: a lean (radians about the prop's own X / Z
   * after its yaw, like a tree's) and a height factor on top of `scale`. The obsidian spires lean, the lava-rock mates and the ice
   * crystals tilt and squash so a group no longer reads as one mesh copied.
   */
  tiltX?: number;
  tiltZ?: number;
  squash?: number;
}

export type WallKind = 'palisade' | 'fence' | 'stone_wall' | 'ruin_wall' | 'ice_wall';

/** Straight wall segment; rendered as instanced posts/planks/blocks, blocks movement along its length. */
export interface WallPlacement {
  kind: WallKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** wall height (m) */
  height: number;
  seed: number;
}

export type BridgeKind = 'wood' | 'rope' | 'stone';
/**
 * A bridge deck over water/lava. The recipe only lists the strip: TerrainField bakes the deck on top of the bed
 * (`grid.heights` = max(bed, deck) so heroes walk on it; `grid.bed` stays the ground for the render mesh / liquid depth).
 * Choose `yEnd` ≈ the bed height at both ends (blend your ground to it within ~4 m so the deck lands on solid ground).
 */
export interface Bridge {
  kind: BridgeKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  width: number;
  /** deck height at the ends / the middle (m) */
  yEnd: number;
  yMid: number;
}

// ---------------------------------------------------------------------------
// Ground splat layers

export interface GroundLayer {
  /** terrain/rock texture id (tex_*) */
  tex: string;
  /** world metres covered by one texture repeat */
  scale: number;
  /** colour multiplier (hex), default white */
  tint?: string;
  /** normal-map strength multiplier, default 1 */
  normal?: number;
  /**
   * the zone's glowing ground layer (lava crust; at most one, the first wins). Absent everywhere = the renderer falls back
   * to the texture id 'tex_lava_crust'; `false` opts that id out. Render-only.
   */
  emissive?: boolean;
  /** height-blend bias (C2, render-only): raises (> 0) or sinks (< 0) this layer in the splat height blend; default 0 */
  h?: number;
}

export interface Liquid {
  kind: 'water' | 'lava' | 'ice';
  /** world-space surface height (m) */
  level: number;
}

/** A flowing channel (river / lava river): drives flow-map direction + foam. */
export interface Stream {
  /** control points (x,z) — smoothed by the consumer */
  pts: Array<[number, number]>;
  halfWidth: number;
  /** m/s along the polyline direction */
  speed: number;
}

// ---------------------------------------------------------------------------
// Landmarks

export type LandmarkKind =
  /** play-field centre: Great Metin site; flat, hazard-free, blocker-free */
  | 'centre'
  /** player start (flat, hazard free) */
  | 'spawn'
  /** named point of interest (plaza, gate, camp, ruin, pillar ring...) */
  | 'poi'
  /** good boss-arena centre (open, round, flat) */
  | 'boss';

export interface Landmark {
  id: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  /** clear radius around the point (m) */
  r: number;
  yaw?: number;
}

// ---------------------------------------------------------------------------
// Blockers

export type BlockerKind = 'tree' | 'rock' | 'prop' | 'wall';

/** Static collision circle on XZ. */
export interface Blocker {
  x: number;
  z: number;
  r: number;
  kind: BlockerKind;
}

// ---------------------------------------------------------------------------
// Zone layout (what the recipe produces besides heights)

export interface ZoneLayout {
  zone: string;
  groundLayers: GroundLayer[];
  /** index of the layer drawn on steep faces (triplanar) */
  cliffLayer: number;
  /** optional layer that settles on up-facing steep surfaces (snow caps) */
  capLayer?: number;
  cover: CoverSpec[];
  rockMaterials: string[];
  liquid?: Liquid;
  streams: Stream[];
  trees: TreePlacement[];
  rocks: RockPlacement[];
  props: PropPlacement[];
  walls: WallPlacement[];
  bridges: Bridge[];
  landmarks: Landmark[];
}
