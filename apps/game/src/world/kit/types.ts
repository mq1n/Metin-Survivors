// World kit (C7) data types. The C0 (G0) signatures are kept verbatim; everything added at G1 is optional, so layout
// code written against the G0 scaffold still type-checks. Overview and usage: ./index.ts.
import type { FreeOptions } from '../recipe';
import type { PropPlacement, RockKind, RockPlacement, TreePlacement, TreeSpecies, WallKind, WallPlacement } from '../layoutTypes';

/** (x, z) in world metres */
export type Vec2 = readonly [number, number];

// ======================================================================================================== roads

export interface RoadSpec {
  /** control points (x, z) of the centre line; the kit smooths them and adds a seeded lateral wander (no CAD arcs) */
  pts: ReadonlyArray<Vec2>;
  
  width: [number, number];
  /** metres of lateral wander added to the centre line (default 6); it fades out towards both ends */
  wander?: number;
  /** metres per wander / width feature along the road (default 40) */
  wavelength?: number;
  /**
   * radius (m) of the round clearing at each dead end (0 = none, default 0). A pair sets the start and the end
   * separately (e.g. `[0, 9]`: no clearing where the road leaves a plaza, a 9 m clearing where it ends).
   */
  endClearing?: number | readonly [start: number, end: number];
  /**
   * graded road (switchbacks up a riser, a cut through a ridge): bench heights (m) at the start and the end, linear in
   * arc length. `sample()` then reports `grade` (bench height here) and `bench` (0..1 blend weight) for height().
   */
  grade?: readonly [start: number, end: number];
  /** graded roads only: metres of flat shoulder beside the track before the bench fades into the terrain (default 3) */
  bench?: number;
}

export interface RoadNetworkSpec {
  roads: ReadonlyArray<RoadSpec>;
  /** extra radius (m) of the beaten clearing where two roads meet (junctions are found automatically, default 3) */
  junctionClearing?: number;
  /** metres of worn verge just outside the track edge (default 1.2) */
  wear?: number;
  /** metres of soft grass fringe outside the verge (default 2) */
  fringe?: number;
  seed: number;
  /** `sample().d` is exact up to this many metres from a track edge and saturates there (default 16) */
  reach?: number;
  /** half width (m) of the soft transitions between track, verge and fringe (default 0.6) */
  soft?: number;
  /** amplitude (m) of the noise that wobbles every edge (default 0.6) */
  edgeNoise?: number;
  /**
   * an end point within this many metres of an EARLIER road's control line is snapped onto that road's wandered centre
   * (so a road that starts on another one stays joined after both wander; default 1.5)
   */
  snap?: number;
}

/** Paint weights of the road network at one point (all 0..1, soft edged), for a recipe's `paint()`. */
export interface RoadSample {
  /** track surface (includes the junction / dead-end clearings) */
  road: number;
  /** worn verge / edge wear */
  wear: number;
  /** outer grass fringe */
  fringe: number;
  /** junction / dead-end clearing (a subset of `road`) */
  clearing: number;
  /** signed distance (m) to the nearest (noise-wobbled) track edge, < 0 on the track; saturates at `reach` */
  d: number;
  /** graded roads: bench height (m) here (0 when no graded road is near) */
  grade?: number;
  /** graded roads: 0..1 weight to blend height() towards `grade` (`h = lerp(h, s.grade, s.bench)`) */
  bench?: number;
}

/** A point on a road centre line: position, unit tangent, half width (m). */
export interface RoadPoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
  hw: number;
}

/** A round beaten clearing of the network. */
export interface RoadClearing {
  x: number;
  z: number;
  r: number;
  kind: 'junction' | 'end';
}

export interface RoadNetwork {
  /** the smoothed, wandered centre lines (for props along roads, avenues, lanes kept clear) */
  readonly centres: ReadonlyArray<ReadonlyArray<Vec2>>;
  /** junction points (where clearings were added) */
  readonly junctions: ReadonlyArray<Vec2>;
  /** fills and returns `out` (reuse one object: paint() runs ~262k times) */
  sample(x: number, z: number, out: RoadSample): RoadSample;
  /** distance (m) to the nearest centre line (cheap: no width / wear maths); saturates at reach + max half width */
  distance(x: number, z: number): number;
  /** arc length (m) of each centre line */
  readonly lengths: ReadonlyArray<number>;
  /** every clearing (junctions + dead ends) */
  readonly clearings: ReadonlyArray<RoadClearing>;
  /** the saturation distance of `sample().d` */
  readonly reach: number;
  /** point, tangent and half width of road `road` at arc length `s` (clamped) */
  pointAt(road: number, s: number, out: RoadPoint): RoadPoint;
  /** like pointAt, moved `offset` m sideways (+ = left of travel = (tz, −tx)) */
  along(road: number, s: number, offset: number, out: RoadPoint): RoadPoint;
  /** every centre line as a clump lane: half = the road's widest half width + `extra` (default 2) */
  lanes(extra?: number): Array<{ pts: ReadonlyArray<Vec2>; half: number }>;
}

// ====================================================================================================== islands

export interface IslandFieldSpec {
  /** radius (m) around the origin that the field fills */
  radius: number;
  
  count: number;
  /** water / chasm gap width range (m) between neighbouring islands */
  gap: [number, number];
  /** domain-warp strength (m): 0 = convex cells, 20-40 = organic coasts */
  warp: number;
  /** islands pinned to a centre and minimum radius (e.g. the central pagoda island at the origin) */
  anchors?: ReadonlyArray<{ x: number; z: number; r: number }>;
  seed: number;
  /**
   * what lies beyond `radius`: 'water' (default; the archipelago ends in open water) or 'land' (a mainland ring: edge
   * islands merge into it and the channels end in coves under the rim)
   */
  outside?: 'water' | 'land';
  /** corner rounding (m) of the island outlines (default 0.2 × the mean island spacing) */
  round?: number;
  /** bake the field on a grid of this many metres for fast bilinear sampling (0 = exact every call, default 0; 1 is a good choice) */
  grid?: number;
}

export interface IslandSample {
  /** signed distance (m) to the nearest coast, < 0 on land */
  d: number;
  /** id of the island (or of the nearest island when in a gap); -1 = the mainland ring (outside: 'land') */
  id: number;
}

/** A narrow crossing between two islands: a bridge strip from (x0, z0) to (x1, z1) (both ends on land). */
export interface BridgeSite {
  a: number;
  b: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** water span (m) */
  span: number;
}

/** One island of the field (land inside `radius`). */
export interface IslandInfo {
  id: number;
  /** the most inland point (largest inscribed circle centre): the natural spot for a landmark */
  x: number;
  z: number;
  /** land area (m²) inside the field radius */
  area: number;
  /** radius (m) of the largest inscribed circle (how far `x, z` is from the coast) */
  inner?: number;
  /** centroid of the land (may fall in water for crescent islands) */
  cx?: number;
  cz?: number;
  /** generator seed point (anchors: the anchor centre) */
  seedX?: number;
  seedZ?: number;
}

export interface IslandField {
  readonly islands: ReadonlyArray<IslandInfo>;
  /** fills and returns `out` */
  sample(x: number, z: number, out: IslandSample): IslandSample;
  /** narrowest crossings between neighbouring islands, shortest first */
  bridgeSites(opts?: { minSpan?: number; maxSpan?: number; perPair?: number; sep?: number; landing?: number }): BridgeSite[];
  /** island id pairs whose land touches (never need a bridge), e.g. edge islands merged into the mainland ring (-1) */
  readonly links?: ReadonlyArray<readonly [number, number]>;
  /** mean distance (m) between island centres */
  readonly spacing?: number;
}

// ======================================================================================================= ridges

export interface RidgeSpec {
  /** spine control points (x, z) */
  pts: ReadonlyArray<Vec2>;
  /** crest height (m) above the surrounding ground */
  height: number;
  /** half width (m) at the foot */
  width: number;
  /** 0..1 flank steepness: 1 = rock walls (cliff layer), 0 = rolling hill */
  steep: number;
  /** passes cut through the ridge: arc-length position (m) along the spine and gap width (m) */
  passes?: ReadonlyArray<{ at: number; width: number }>;
  seed: number;
}

export interface PlateauSpec {
  centre: Vec2;
  /** top radius (m), noise-varied by `wobble` (m) */
  radius: number;
  wobble?: number;
  /** step height (m) */
  height: number;
  /** riser width (m) */
  edge: number;
  /** walkable ramps: unit direction from the centre and width (m) */
  ramps?: ReadonlyArray<{ dir: Vec2; width: number }>;
  seed: number;
  /** ramp gradient (rise / run, default 0.4; walkable is < 0.84) */
  rampGrade?: number;
}

/** Height relief shared by ridges and plateaus. */
export interface Relief {
  /** height (m) to ADD to the recipe's height() at (x, z) */
  height(x: number, z: number): number;
  /** 0..1 cliff weight (steep flank) for paint() */
  cliff(x: number, z: number): number;
  /** distance (m) to the spine (ridge, unsigned) / plateau top edge (signed, < 0 on the top) */
  distance(x: number, z: number): number;
}

// ======================================================================================================== clump

export interface ClumpSpec {
  /** disc to fill */
  cx: number;
  cz: number;
  radius: number;
  /** minimum spacing (m) between items (blue noise) */
  spacing: number;
  /**
   * macro-noise patches: metres per patch; keep where the patch noise (0..1, about uniformly distributed, so
   * hi − lo ≈ the kept share of the disc) is inside [lo, hi]
   */
  patch?: { scale: number; lo: number; hi: number };
  /** lanes kept empty (roads, combat lanes): centre lines and half width (m) */
  lanes?: ReadonlyArray<{ pts: ReadonlyArray<Vec2>; half: number }>;
  /** cap on accepted items */
  max?: number;
  seed: number;
  /** extra predicate (island interior, off the river, ...); points where it returns false are dropped */
  keep?: (x: number, z: number) => boolean;
}

/** Options shared by the clumpTrees / clumpRocks / clumpProps item placement. */
export interface ClumpTreeSpec extends ClumpSpec {
  species: TreeSpecies | ReadonlyArray<TreeSpecies>;
  scale: [number, number];
  free?: FreeOptions;
  /** canopy clearance multiplier on the species spacing (default 1; > 1 thins) */
  gap?: number;
}

export interface ClumpRockSpec extends ClumpSpec {
  kind: RockKind;
  /** nominal rock size (m): the boulder height; other axes follow the kind's proportions */
  size: [number, number];
  mat?: number;
  free?: FreeOptions & { sink?: number; blocking?: boolean; force?: boolean };
}

export interface ClumpPropSpec extends ClumpSpec {
  ids: ReadonlyArray<string>;
  scale?: [number, number];
  free?: FreeOptions & { force?: boolean };
}

// ==================================================================================================== setpieces

/** What a set-piece placed (already registered in the ScatterContext: blockers, occupied discs). */
export interface SetPiece {
  props: PropPlacement[];
  rocks: RockPlacement[];
  trees: TreePlacement[];
  walls: WallPlacement[];
}

export interface PieceBase {
  x: number;
  z: number;
  seed: number;
  /** skip the terrain suitability test (slope / surface / margin) like hand-placed recipe props; isFree is always honoured (default true) */
  force?: boolean;
}

export interface StoneRingSpec extends PieceBase {
  radius: number;
  count: number;
  /** stone height range (m) */
  size: [number, number];
  /** 'spire' (default) or 'slab' (upright flat stones) */
  kind?: RockKind;
  mat?: number;
  /** open side: unit direction from the centre and gap width (m) */
  gapDir?: Vec2;
  gapWidth?: number;
  /** share of stones that lie toppled (0..1, default 0.15) */
  fallen?: number;
  /** prop at the centre (e.g. 'stele') */
  focal?: string;
  /** reserve the inside for later scatter (default true) */
  clearInside?: boolean;
}

export interface PillarRingSpec extends PieceBase {
  radius: number;
  count: number;
  /** PROP_DEFS id of the pillars ('lava_pillar', 'ruin_pillar', 'obelisk', 'stone_lantern', ...) */
  prop: string;
  scale?: [number, number];
  gapDir?: Vec2;
  gapWidth?: number;
  /** gate prop standing in the gap, passage along gapDir ('stone_gate', 'pagoda_gate', ...) */
  gate?: string;
  /** share of pillars missing (ruined ring, 0..1, default 0) */
  missing?: number;
  /** reserve the inside for later scatter (default false) */
  clearInside?: boolean;
}

export interface RuinCourtSpec extends PieceBase {
  /** court width (across `dir`) and depth (along `dir`) in m */
  size: [number, number];
  /** the court's front (entrance side) */
  dir: Vec2;
  /** prop at the centre (default 'stele'; '' = none) */
  focal?: string;
  wall?: WallKind;
  /** 0..1 how ruined (gaps in the walls, missing corner pillars, rubble), default 0.5 */
  decay?: number;
  /** corner pillar prop (default 'ruin_pillar'; '' = none) */
  pillar?: string;
  /** reserve the inside for later scatter (default true) */
  clearInside?: boolean;
}

export interface CampFenceSpec extends PieceBase {
  radius: number;
  wall: WallKind;
  gateDir: Vec2;
  gateWidth?: number;
  /** props inside: the first at the centre (e.g. 'bonfire'), the rest round an inner ring facing it (e.g. 'orc_tent') */
  inner?: ReadonlyArray<string>;
  /** prop on both gate posts (e.g. 'banner_pole', 'war_banner') */
  gatePost?: string;
  /** wall height (m), default by kind */
  height?: number;
}

export interface GatePairSpec extends PieceBase {
  /** the passage direction (the way through) */
  dir: Vec2;
  /** passage width (m) between the two flanking props */
  width: number;
  prop: string;
  scale?: number;
}

export interface AvenueSpec {
  pts: ReadonlyArray<Vec2>;
  prop: string;
  /** distance range (m) between consecutive props along the path */
  spacing: [number, number];
  /** lateral offset (m) from the centre line */
  offset: number;
  /** 0..1 chance to leave a slot empty (default 0) */
  skip?: number;
  seed: number;
  /** 'alternate' (default: sides alternate, sometimes repeat) or 'pairs' (both sides at each slot, independently jittered) */
  mode?: 'alternate' | 'pairs';
  scale?: [number, number];
  /** metres left free at the start / end of the path (default spacing[0] / 2) */
  start?: number;
  end?: number;
  force?: boolean;
}

export interface HayYardSpec extends PieceBase {
  radius: number;
  /** the yard's front (towards the road) */
  dir: Vec2;
}

export interface FencedYardSpec extends PieceBase {
  /** yard width (across `dir`) and depth (along `dir`) in m */
  size: [number, number];
  /** the yard's front (gate side) */
  dir: Vec2;
  /** house prop (default 'house_small'; '' = none) */
  house?: string;
  wall?: WallKind;
  /** a feature tree in a back corner of the yard */
  tree?: TreeSpecies;
}
