// Zone recipe interface: one per zone (src/world/zones/<id>.ts). A recipe is a pure, deterministic description of an
// arena: analytic heights, arena shape, ground paint, liquids and scattered placements.
//
// Determinism rule (co-op host/guests must agree): everything that feeds `height`, `surface`, `arenaSdf` and the
// placement positions uses only + − × ÷ sqrt floor abs min max and the helpers in noise.ts / rng.ts — no
// Math.sin/cos/exp/pow/log/atan2. (Visual-only yaw may be any number.)
import type { BiomePreset } from '../data/schema';
import type { WorldRng } from './rng';
import type {
  Blocker,
  Bridge,
  CoverSpec,
  GroundLayer,
  Landmark,
  Liquid,
  PropPlacement,
  RockKind,
  RockPlacement,
  Stream,
  Surface,
  TreePlacement,
  TreeSpecies,
  WallKind,
  WallPlacement,
  ZoneLayout,
} from './layoutTypes';

export interface RecipeContext {
  biome: BiomePreset;
  /** the zone's FIXED seed (= biome.seed): use it for every noise that shapes ground / rivers / landmarks */
  seed: number;
  /** side length of the square domain (m) */
  size: number;
  /** independent deterministic stream per concern: `rng.fork(1)` terrain, `fork(2)` scatter, ... */
  rng: WorldRng;
}

/** Everything a recipe contributes before heights are baked. */
export interface TerrainPlan {
  /** nominal play radius around the origin (m) — the sim clamps the hero to it */
  arenaRadius: number;
  /** signed distance (m) to the play-area boundary: < 0 inside. Outside is never walkable. */
  arenaSdf(x: number, z: number): number;
  /** analytic ground height (m), origin ≈ 0 */
  height(x: number, z: number): number;
  /** surface class override (lava/miasma/ice/water). Default derives from `liquid` + height. */
  surface?(x: number, z: number, h: number): Surface;
  liquid?: Liquid;
  streams: Stream[];
  bridges: Bridge[];
  landmarks: Landmark[];
  groundLayers: GroundLayer[];
  cliffLayer: number;
  capLayer?: number;
  cover: CoverSpec[];
  rockMaterials: string[];
  /**
   * Raw ground-layer weights (need not sum to 1; the baker normalises) at (x,z).
   * `slope` = radians from horizontal. `out.length` = groundLayers.length (≤ 8). Must be cheap (runs 262k times).
   */
  paint(x: number, z: number, h: number, slope: number, out: Float32Array): void;
  /**
   * Zones core A1 (render-only): texels per axis of the ground splat the terrain draws with, over the whole domain. 512 (the
   * default, absent) = 1 m texels as before; 1024 = 0.5 m, 2048 = 0.25 m (snapped to 512 * 2^k, at most 2048). The baker
   * evaluates `paint` at the finer texels only where the 512 px map changes (roads, plaza kerbs, rims, shadow lobes), so the
   * extra cost is a fraction of a full re-bake; GPU memory is res^2 * 8 bytes (1024: 8 MB). The cover mask, the zone map and
   * the tools keep the 512 px map.
   */
  paintRes?: number;
  /**
   * r8 Z8 (optional): true where a small metin's rune carpet must not lie: a ground ornament of the zone's own (yeonmu's carved plaza
   * medallion and kerb ring) or a glowing seam (daeryeol's molten lava skin and vent rims), so two ornamental rings never cross and no
   * lava glow flares over the runes. `levelDisc` refuses a disc any of whose sample points it marks.
   */
  carpetKeepOut?: (x: number, z: number) => boolean;
  /** Fills trees/rocks/props/walls after the height grid exists (queries via `sc`). */
  scatter(sc: ScatterContext): void;
}

export interface ZoneRecipe {
  id: string;
  build(ctx: RecipeContext): TerrainPlan;
}

export interface FreeOptions {
  /** inset from the arena boundary (m), default 3 */
  margin?: number;
  /** max slope (radians) , default 0.55 (~31°) */
  maxSlope?: number;
  /** allow SHALLOW/ICE/MIASMA surfaces (default false: GROUND only) */
  anySurface?: boolean;
}

/** Scatter API handed to `TerrainPlan.scatter`. All queries see the baked height/surface grids. */
export interface ScatterContext {
  readonly rng: WorldRng;
  readonly layout: ZoneLayout;
  readonly arenaRadius: number;
  heightAt(x: number, z: number): number;
  /** radians from horizontal */
  slopeAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
  /** > 0 inside the play area: distance (m) to the boundary */
  insideBy(x: number, z: number): number;
  /** terrain is suitable (inside by margin, slope ok, surface ok) */
  suitable(x: number, z: number, opts?: FreeOptions): boolean;
  /** no occupied circle overlaps the disc (x,z,r) */
  isFree(x: number, z: number, r: number): boolean;
  /** reserve space without producing a placement */
  occupy(x: number, z: number, r: number): void;
  /**
   * r8 Z8: reserve a hero / QA spot (and its camera corridor): scatter, `isFree` and unforced placements keep out of it like an
   * `occupy` disc, a forced set piece (`prop(..., { force })`) does not. Keep the spots themselves off the set pieces.
   */
  reserveSpot(x: number, z: number, r: number): void;
  /**
   * r9 Z9: reserve the disc of a forced set piece placed LATER in the recipe (its draws keep their order): the loose scatter, `isFree`
   * and unforced placements keep out of it, a forced put ignores it (and, unlike a hero spot, a small forced prop too). Draws nothing.
   */
  reserveSetPiece(x: number, z: number, r: number): void;
  /** place a tree if suitable and free (`spacing` = canopy clearance radius, default species-based). Returns success. */
  tree(species: TreeSpecies, x: number, z: number, scale?: number, spacing?: number, opts?: FreeOptions): TreePlacement | null;
  rock(kind: RockKind, x: number, z: number, sx: number, sy: number, sz: number, mat?: number, opts?: FreeOptions & { sink?: number; blocking?: boolean; force?: boolean }): RockPlacement | null;
  /** notify the scatter context after mutating a placed rock's final dimensions, yaw, or tilt */
  updateRock(p: RockPlacement, opts?: { blocking?: boolean; occupy?: boolean }): void;
  /**
   * place a structure (footprint blockers are added). `force` (a set piece) skips the suitability test; its free test sees every
   * placement and `occupy` disc before it but not the hero-spot reservations (`reserveSpot`).
   */
  prop(id: string, x: number, z: number, yaw?: number, scale?: number, opts?: FreeOptions & { force?: boolean }): PropPlacement | null;
  /** r8 Z8: true when `prop(id, x, z, yaw, scale, opts)` would place (the same tests, no side effects, no draw): a slot search asks before it puts */
  fits(id: string, x: number, z: number, scale?: number, opts?: FreeOptions & { force?: boolean }): boolean;
  wall(kind: WallKind, x0: number, z0: number, x1: number, z1: number, height?: number): WallPlacement;
  /** add a custom blocker */
  block(b: Blocker): void;
  /** rejection-sample `attempts` points inside a disc; calls `place(x,z)` for each accepted candidate */
  disc(cx: number, cz: number, radius: number, attempts: number, place: (x: number, z: number) => void): void;
}
