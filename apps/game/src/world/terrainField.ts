// TerrainField — the shared, deterministic description of a zone's ground (owner: TERRAIN).
//
//   const field = createTerrainField(zone.biome, run.seed);
//   field.heightAt(x, z)            // O(1), bilinear on a baked 1 m grid (same triangulation as the render mesh)
//   field.walkable(x, z)            // terrain (cliff / deep water / outside arena) + static blockers
//   field.moveCircle(...)           // slide a circle (hero) along cliffs and blockers
//   field.surfaceAt(x, z)           // SURFACE.* (lava / shallow / ice / miasma / deep)
//   field.blockers, field.landmarks // static collision circles; named points (centre = Great Metin site)
//
// Pure TypeScript, no three.js, no DOM. The same (biome, seed) always yields bit-identical grids and placements.
import type { BiomePreset } from '../data/schema';
import {
  SURFACE,
  type Blocker,
  type Bridge,
  type Landmark,
  type PropPlacement,
  type RockKind,
  type RockPlacement,
  type Surface,
  type TreePlacement,
  type TreeSpecies,
  type WallKind,
  type WallPlacement,
  type ZoneLayout,
} from './layoutTypes';
import { dcos, dsin } from './kit/util';
import { propBlockers, PROP_DEFS } from './props';
import type { FreeOptions, ScatterContext, TerrainPlan } from './recipe';
import { archHeight } from './shapes';
import { distToSegment } from './noise';
import { hashString, zoneSeedSalt, WorldRng } from './rng';
import { TREE_DIMS } from './trees';
import { recipeFor } from './zones';

export { SURFACE } from './layoutTypes';
export type { Blocker, Landmark, ZoneLayout, Surface } from './layoutTypes';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Vec2Like {
  x: number;
  z: number;
}

/** Ground splat control maps (lazy, render only): layer weights 0..255, normalised so the 8 values sum to 255. */
export interface PaintMaps {
  /** texels per axis */
  res: number;
  /** metres per texel */
  texel: number;
  /** RGBA = layers 0..3 */
  w0: Uint8Array;
  /** RGBA = layers 4..7 */
  w1: Uint8Array;
}

export interface TerrainGrid {
  /** samples per axis (size / cell + 1) */
  n: number;
  /** metres between samples */
  cell: number;
  /** row-major [zIndex * n + xIndex]; x = -size/2 + xIndex*cell */
  heights: Float32Array;
  /**
   * ground WITHOUT bridge decks (render mesh, liquid depth, paint). Same array as `heights` when the zone has no
   * bridges; characters walk on `heights` (= bed + decks).
   */
  bed: Float32Array;
  /** SURFACE.* per node */
  surface: Uint8Array;
  /** 1 = terrain-blocked (too steep, deep water, outside the arena) */
  blocked: Uint8Array;
  /** metres inside the play area (signed distance negated) per node, > 0 inside */
  inside: Float32Array;
}

/** the sim `WorldEnv` hooks a field provides (sim/types.ts WorldEnv; ARCHITECTURE 7.1) */
export interface FieldEnv {
  arenaRadius: number;
  walkable: (x: number, z: number) => boolean;
  moveCircle: (x0: number, z0: number, x1: number, z1: number, r: number, out: Vec2Like) => boolean;
  surfaceAt: (x: number, z: number) => number;
  /** r6 U6: no static item's visual extent reaches into the disc, nor (with `view`) hides the body from the game camera (sim WorldEnv.clearOfStatics; metin fall sites) */
  clearOfStatics: (x: number, z: number, r: number, view?: { h: number; r: number; carpet?: number }) => boolean;
  /** r7 U7: the disc is open, level ground for a flat ground decal (sim WorldEnv.levelDisc; the metin rune carpet) */
  levelDisc: (x: number, z: number, r: number, dh: number) => boolean;
  /** r9 Z9: how far (m, summed) banners and roofs reach into a small metin's fight ring at (x, z) (sim WorldEnv.ringScore; 0 = clean) */
  ringScore: (x: number, z: number) => number;
  /** r9 ship: bad-ground samples (water, lava, cliff, steep) of a small metin's fight ring at (x, z) (sim WorldEnv.ringGround; 0 = open, level) */
  ringGround: (x: number, z: number) => number;
}

export interface TerrainField {
  readonly zoneId: string;
  readonly seed: number;
  /** side length of the square domain (m): x,z ∈ [-size/2, size/2] */
  readonly size: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** nominal play radius around the origin (m) */
  readonly arenaRadius: number;
  readonly grid: TerrainGrid;
  readonly layout: ZoneLayout;
  /** static collision circles (trees, rocks, props, walls) */
  readonly blockers: readonly Blocker[];
  readonly landmarks: readonly Landmark[];
  /** min/max ground height inside the arena */
  readonly heightRange: { min: number; max: number };
  /** Drop-in for sim `WorldEnv`: the arena, the point rule, hero circle movement (moveHero) and the surface ids (lava / miasma / shallow / ice) */
  readonly env: FieldEnv;
  /** diagnostics from the bake */
  readonly stats: { bakeMs: number; walkableFraction: number; reachableFraction: number; blockers: number };

  heightAt(x: number, z: number): number;
  /** ground height without bridge decks (what the terrain mesh draws) */
  bedHeightAt(x: number, z: number): number;
  /** unit surface normal (smooth, central differences) written into `out` */
  normalAt(x: number, z: number, out: Vec3Like): Vec3Like;
  /** radians from horizontal */
  slopeAt(x: number, z: number): number;
  /** true when a point may be stood on (terrain ok and not inside a static blocker) */
  walkable(x: number, z: number): boolean;
  /** same for a disc of radius r (hero/enemy body) */
  walkableCircle(x: number, z: number, r: number): boolean;
  /**
   * r6 U6: true when no static scatter item reaches with its VISUAL extent (`staticExtents`: prop half extent, rock half side,
   * tree crown, wall) into the disc of radius r. Collision circles are smaller than the drawn props; metin fall sites use this.
   * With `view` (a body of height h and foot radius r standing there), also no tall static's crown / roof / top covers that body
   * from the game camera (`viewExtents`).
   */
  clearOfStatics(x: number, z: number, r: number, view?: { h: number; r: number; carpet?: number }): boolean;
  /** r9 Z9: metres the banners and roofs reach into a small metin's 13 m fight ring at (x, z), summed (0 = a clean ring) */
  ringScore(x: number, z: number): number;
  /** r9 ship: bad-ground samples of a small metin's 13 m fight ring at (x, z) (0 = open, level ground) */
  ringGround(x: number, z: number): number;
  /**
   * r7 U7: true when the disc of radius r round (x, z) is open, level ground for a flat ground decal (the metin rune carpet): 16
   * points on its rim and 8 at half radius stand on walkable ground that is neither lava nor deep water, and none lies more than dh m
   * above or below the centre (a carpet draped over a bank edge or a cliff stretches its glyphs).
   */
  levelDisc(x: number, z: number, r: number, dh: number): boolean;
  /** SURFACE.* at the point */
  surfaceAt(x: number, z: number): Surface;
  /** > 0 inside the play area: metres to the boundary */
  insideBy(x: number, z: number): number;
  landmark(id: string): Landmark | undefined;
  /**
   * Moves a circle from (x0,z0) to (x1,z1): pushes out of blockers and slides along cliffs / water edges.
   * `out` receives the final position. Returns true if the target was reached unchanged.
   */
  moveCircle(x0: number, z0: number, x1: number, z1: number, r: number, out: Vec2Like): boolean;
  /** nearest walkable point within `maxR` (spiral search); false if none */
  nearestWalkable(x: number, z: number, maxR: number, out: Vec2Like, r?: number): boolean;
  /** calls `cb(blocker)` for every blocker whose circle might touch the disc (x,z,r) */
  blockersNear(x: number, z: number, r: number, cb: (b: Blocker) => void): void;
  /** lazily baked ground paint maps at the legacy 512 px / 1 m density (render only; cover, zone map, tools) */
  paint(): PaintMaps;
  /**
   * texels per axis of the maps the terrain splat draws with: the recipe's `paintRes` (zones core A1: 1024 = 0.5 m texels,
   * 2048 = 0.25 m), default 512 (= `paint()`, byte-identical to before)
   */
  readonly paintRes: number;
  /**
   * The splat maps at `paintRes`. Built on top of `paint()`: only the 2x2 child texels of a coarse cell whose corners differ
   * (road / plaza / rim / shadow edges) are evaluated by the recipe's paint function, the rest are the bilinear interpolation
   * of the coarse map (what the GPU would do anyway), so the bake stays close to the cost of the 512 px map.
   */
  paintFine(): PaintMaps;
  /**
   * `paintFine()` computed in slices of about `budgetMs` of work with a macrotask yield in between (the render side uses it
   * so a zone load never has one long main-thread block); resolves to the same maps.
   */
  paintFineAsync(budgetMs?: number): Promise<PaintMaps>;
}

/** Terrain steeper than this (rise/run ≈ 40°) is not walkable. */
export const MAX_WALK_SLOPE = 0.84;
export const FIELD_SIZE = 512;
export const FIELD_CELL = 1;
const PAINT_RES = 512;
/** zones core A1: the finest splat density a recipe may ask for (texels per axis over the domain) */
const PAINT_RES_MAX = 2048;
/** a coarse paint cell is refined when a corner texel bends by more than this (second difference of a layer weight, of 255) */
const PAINT_REFINE_CURV = 8;
/** ... or steps by more than this to its right / lower neighbour (a hard edge) */
const PAINT_REFINE_STEP = 80;
const HASH_CELL = 8;
/** width (m) of the ramp from a bridge deck down to the ground beside it (applyBridges and the exact deck height of `heightAt`) */
const BRIDGE_SHOULDER = 0.7;
/** zones core A4: coarse grid (cells per axis over the domain) that flags where a bridge strip may be, so `heightAt` only pays near one */
const DECK_N = 64;

// hero pocket escape (moveHero, REVERIFY-1, round 2). Plain wall contact is the circle rule (moveCircle) on every tick; moveHero only
// steps in where the circle rule would leave a hero for good, and then never against it.
//  - The WAYS OUT of a hero position are the 16 world directions that, held for TRAP_PATH of circle steps (of any of TRAP_STEP_SIZES:
//    the hero's own step varies, and a crack between cliff cells can pass one size and pin another), take it TRAP_REACH away. A TRAP
//    has none (the REVERIFY-1 notch between two rocks and a cliff cell: the circle rule's push-out accepts 0.15 R of blocker overlap,
//    its axis slides none, so it lets a hero in and never out). A DEAD END has them all within DEAD_SPAN (one way out, back; their mean
//    is its EXIT). A wall (ways over 180 degrees), a corner (135), a corridor, a crack open at both ends or open ground is neither.
//    A CONFINED spot has no way out of CONFINE_REACH (the walk-in trap scan's own bar: a nook, a stretch of rubble staircase). The
//    classes are pure functions of the position (memoised per field), so they cannot flip from one tick to the next.
//  - A circle step that would end in a trap is refused (the hero stays where it is): nobody walks into one.
//  - The ESCAPE walks a hero over a world-aligned lattice (ESC_H) to the nearest ROOMY node (disc + ROOMY_SLACK free, ROOMY_RUN runs,
//    no pocket). Every node is a point-walkable disc that reaches no further than ESC_TERRAIN_TOL into a cliff cell and the circle
//    rule's 0.15 R into a blocker, and no edge leads deeper (`escDepth`; an overlapping start only gets out): no rock is entered, no
//    non-walkable point crossed. It moves at least PULL_MIN per tick and never further than that or the step. It runs for a hero that
//    overlaps a cliff cell or a blocker (spawned there), stands in a trap, or is pinned (its circle step gains less than PIN_FRACTION
//    of the request) in a dead end pushing out of it (within ~78 degrees of the exit), in a confined spot pushing toward the roomy
//    ground (within ~105 degrees, ESC_ON_COS), or at the closed end of a narrow channel pushing across or out of it (`narrowEnd`, the
//    channel lane: its goal must also leave a free run of ESC_GO_ON along the push).
//  - The escape is MONOTONE. The lattice graph is a function of the field alone; a hero mid-escape stands exactly on a node of its
//    lane's lattice (ESC_OFF_X: no other code writes such a position), so the next search starts there and finds roomy ground strictly
//    fewer nodes away. Out of the trap, a hero whose step points away from that ground stops and takes only circle steps that end
//    outside every pocket: it never walks back in, and no tick undoes another (no 2-cycle).
//  - Only an overlapping start with no escape path keeps the old point rule (a position the circle rule never produces).
const TRAP_STEP_SIZES = [0.09, 0.06, 0.1, 0.075];
const TRAP_PATH = 1.28;
const TRAP_REACH = 0.6;
const CONFINE_REACH = 1.5;
const CONFINE_PATH = 2.5;
/** a dead end's ways out lie within this many steps of 22.5 degrees of each other (4: a 90 degree fan; a wall spans 8, a corner 6) */
const DEAD_SPAN = 4;
const POCKET_TRAP = 1;
const POCKET_DEAD_END = 2;
/** order of the way tests, relative to the way back (against the request): 0, +4, -4, +6, -6, +2, -2, +8, ... (at a wall the first answer) */
const TRAP_ORDER = [0, 4, 12, 6, 10, 2, 14, 8, 1, 15, 3, 13, 5, 11, 7, 9];
/** hero positions whose disc plus this much is free are open ground, never a pocket (the common case costs one disc test) */
const OPEN_SLACK = 0.25;
/** a roomy goal keeps this much clearance beyond the hero radius and has a free straight run of ROOMY_RUN in 2 of 8 directions */
const ROOMY_SLACK = 0.2;
const ROOMY_RUN = 1.5;
/** escape lattice: spacing (m); a path is at most ESC_HALF nodes, so it stays inside the +-ESC_HALF window round its start */
const ESC_H = 0.04;
const ESC_HALF = 150;
const ESC_N = 2 * ESC_HALF + 1;
/**
 * each lane's lattice is offset by these odd amounts (m), so a lattice node is a position only the escape writes: a hero standing
 * EXACTLY on one is mid-escape and walks on (the circle rule, a spawn or a probe never lands on one)
 */
const ESC_OFF_X = [0.013671875, 0.033203125];
const ESC_OFF_Z = [0.029296875, 0.009765625];
/** escape lanes (each on its own lattice, so a hero mid-escape keeps its lane's goal): out of a pocket, out of a channel end */
const LANE_POCKET = 0;
const LANE_CHANNEL = 1;
/** at most this many lattice nodes are searched per escape tick (a bound on the cost; the next tick's search needs no more) */
const ESC_MAX_NODES = 12000;
/** an escape node's disc may reach this far (m) into a cliff cell (the circle rule's 9 samples already let a disc reach about 0.05) */
const ESC_TERRAIN_TOL = 0.1;
/** the escape covers at least this much per tick (m), so a hero that has just started to move still gets out */
const PULL_MIN = 0.06;
/** 8-neighbour offsets of the escape lattice (axis first: a fixed order keeps the search deterministic) */
const ESC_DI = [1, 0, -1, 0, 1, -1, -1, 1];
const ESC_DJ = [0, 1, 0, -1, 1, 1, -1, -1];
/** pinned: the circle step gains less than this share of the request along it */
const PIN_FRACTION = 0.1;
/** a pinned hero in a dead end escapes when its step is within about 78 degrees of the exit */
const DEAD_EXIT_COS = 0.2;
/** an escape the hero is not forced into (dead end, confined spot, channel end, out of the trap) goes on only while the step is within about 105 degrees of its goal */
const ESC_ON_COS = -0.25;
/** ...and its first tick never goes backwards against the step (cos >= ESC_FIRST_COS): that would undo the hero's last move */
const ESC_FIRST_COS = -0.02;
/** narrowEnd: the hero creeps freely (CREEP_STEPS of CREEP_STEP, keeping CREEP_FREE of it as headway) in at most 3 neighbouring directions, */
/** its ways out lie within NARROW_SPAN (135 degrees), and the step points across or out of the channel (cos >= NARROW_COS with its axis) */
const CREEP_STEP = 0.06;
const CREEP_STEPS = 8;
const CREEP_FREE = 0.9;
const NARROW_SPAN = 6;
const NARROW_COS = -0.05;
/** the channel lane's goal has a free straight run (m) along the step, so the hero goes on from there */
const ESC_GO_ON = 1;
/** escape's answers: no roomy ground in reach, the hero walked the path, or the path leads away from the step (see ESC_ON_COS) */
const ESC_NONE = 0;
const ESC_MOVED = 1;
const ESC_DECLINED = 2;
/** slots of the per-field memos of the pocket tests (pure functions of the position, so a memo changes no answer) */
const MEMO_N = 1024;
function memoSlot(x: number, z: number): number {
  return (Math.imul(Math.floor(x * 4096) | 0, 73856093) ^ Math.imul(Math.floor(z * 4096) | 0, 19349663)) & (MEMO_N - 1);
}
/** the escape lane whose lattice (x,z) is exactly a node of (see ESC_OFF_X), or -1 */
function escLane(x: number, z: number): number {
  for (let lane = 0; lane < 2; lane++) {
    const ox = ESC_OFF_X[lane] as number;
    const oz = ESC_OFF_Z[lane] as number;
    if (x === Math.round((x - ox) / ESC_H) * ESC_H + ox && z === Math.round((z - oz) / ESC_H) * ESC_H + oz) return lane;
  }
  return -1;
}
/** escape scratch, shared by every field (the sim is single-threaded; each search stamps what it touches), allocated on first use */
let escScratch: { stamp: number; mark: Uint32Array; seen: Uint32Array; depth: Float64Array; prev: Int32Array; queue: Int32Array } | null = null;
const PROBE_COS = new Float64Array(16);
const PROBE_SIN = new Float64Array(16);
for (let k = 0; k < 16; k++) {
  PROBE_COS[k] = Math.cos((k * Math.PI) / 8);
  PROBE_SIN[k] = Math.sin((k * Math.PI) / 8);
}

// tree dimensions (trunk collision radius, canopy spacing) live in ./trees

// A baked field is ~6 MB of typed arrays (grid + lazily the paint maps), so what the memo keeps alive matters.
//   · Fields of the zone's DEFAULT seed (`seed === biome.seed`: the zone atlas / previews, the map worker, tools) are what
//     callers ask for again and again, in few distinct combinations: a small strong LRU keeps them.
//   · A field of any other seed is a run's own (the run seed is new every run, so nothing ever asks for it once the run is
//     over). It is only findable (a main-thread map fallback during the run gets the run's field instead of baking a twin)
//     while somebody else holds it - weakly - and is garbage as soon as the run session is. Before this, six such fields
//     (~36 MB) sat in the strong memo for the page's life and the JS heap climbed by a field per menu -> run -> quit cycle.
const STRONG_MAX = 4;
const cache = new Map<string, TerrainField>();
const runFields = new Map<string, WeakRef<TerrainField>>();
/** drops the key of a collected run field (unless a newer field has taken the key since) */
const runFieldGone =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<string>((key) => {
        if (runFields.get(key)?.deref() === undefined) runFields.delete(key);
      })
    : null;

/** Builds (or returns the memoised) field for a biome + seed. */
export function createTerrainField(biome: BiomePreset, seed: number = biome.seed): TerrainField {
  const key = `${biome.id}|${seed}|${hashString(JSON.stringify(biome))}`;
  const known = cache.get(key) ?? runFields.get(key)?.deref();
  if (known) return known;
  const f = bake(biome, seed);
  if (seed === biome.seed || typeof WeakRef !== 'function') {
    if (cache.size >= STRONG_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, f);
  } else {
    runFields.set(key, new WeakRef(f));
    runFieldGone?.register(f, key);
  }
  return f;
}

export function clearTerrainFieldCache(): void {
  cache.clear();
  runFields.clear();
}

/** Test hook: how many fields the memo still knows about (strong + weak entries whose field has not been collected). */
export function terrainFieldCacheSize(): { strong: number; runFields: number } {
  let alive = 0;
  for (const r of runFields.values()) if (r.deref() !== undefined) alive++;
  return { strong: cache.size, runFields: alive };
}

// ---------------------------------------------------------------------------------------------------------------------

function bake(biome: BiomePreset, seed: number): TerrainField {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const size = FIELD_SIZE;
  const cell = FIELD_CELL;
  const n = Math.round(size / cell) + 1;
  const half = size / 2;
  // The ground (heights, rivers, landmarks, paint) is fixed per zone: it derives from `biome.seed` only. The run seed
  // varies the random scatter (tree/rock/prop picks via `sc.rng`), so every run looks recognisably the same place.
  const zoneRng = new WorldRng((biome.seed ^ zoneSeedSalt(biome.id)) >>> 0);
  const rootRng = new WorldRng((seed ^ zoneSeedSalt(biome.id)) >>> 0);
  const recipe = recipeFor(biome.id);
  const plan = recipe.build({ biome, seed: biome.seed, size, rng: zoneRng.fork(1) });

  const heights = new Float32Array(n * n);
  const surface = new Uint8Array(n * n);
  const blocked = new Uint8Array(n * n);
  const inside = new Float32Array(n * n);

  // 1. heights + arena distance
  let hmin = Infinity;
  let hmax = -Infinity;
  for (let j = 0; j < n; j++) {
    const z = -half + j * cell;
    for (let i = 0; i < n; i++) {
      const x = -half + i * cell;
      const idx = j * n + i;
      const h = plan.height(x, z);
      heights[idx] = h;
      const sdf = plan.arenaSdf(x, z);
      inside[idx] = -sdf;
      if (sdf < 0) {
        if (h < hmin) hmin = h;
        if (h > hmax) hmax = h;
      }
    }
  }

  // 1b. bridges: decks are applied on top of the bed (recipes only describe the Bridge strips)
  let bed = heights;
  if (plan.bridges.length > 0) {
    bed = heights.slice();
    applyBridges(heights, bed, n, half, cell, plan.bridges);
  }

  // 2. surface class + terrain-blocked grid
  const lvl = plan.liquid;
  for (let j = 0; j < n; j++) {
    const z = -half + j * cell;
    for (let i = 0; i < n; i++) {
      const x = -half + i * cell;
      const idx = j * n + i;
      const h = heights[idx] as number;
      let s: Surface = SURFACE.GROUND;
      if (plan.surface) s = plan.surface(x, z, h);
      else if (lvl) s = defaultSurface(lvl.kind, lvl.level - h);
      surface[idx] = s;
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < n - 1 ? i + 1 : i;
      const j0 = j > 0 ? j - 1 : j;
      const j1 = j < n - 1 ? j + 1 : j;
      const gx = ((heights[j * n + i1] as number) - (heights[j * n + i0] as number)) / ((i1 - i0) * cell);
      const gz = ((heights[j1 * n + i] as number) - (heights[j0 * n + i] as number)) / ((j1 - j0) * cell);
      const steep = gx * gx + gz * gz > MAX_WALK_SLOPE * MAX_WALK_SLOPE;
      blocked[idx] = steep || s === SURFACE.DEEP || (inside[idx] as number) < 0.5 ? 1 : 0;
    }
  }

  const layout: ZoneLayout = {
    zone: biome.id,
    groundLayers: plan.groundLayers,
    cliffLayer: plan.cliffLayer,
    capLayer: plan.capLayer,
    cover: plan.cover,
    rockMaterials: plan.rockMaterials,
    liquid: plan.liquid,
    streams: plan.streams,
    trees: [],
    rocks: [],
    props: [],
    walls: [],
    bridges: plan.bridges,
    landmarks: plan.landmarks,
  };

  const impl = new FieldImpl(biome.id, seed, size, n, cell, plan, layout, heights, bed, surface, blocked, inside, { min: hmin, max: hmax });

  // 3. scatter placements (trees/rocks/props/walls) and derive blockers
  const sc = new Scatter(impl, plan, rootRng.fork(2));
  plan.scatter(sc);
  impl.finish(sc.finalizeBlockers());

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  impl.stats.bakeMs = t1 - t0;
  return impl;
}

/** Raises the deck strip of every bridge on top of the bed (`heights` is modified, `bed` keeps the ground). */
function applyBridges(heights: Float32Array, bed: Float32Array, n: number, half: number, cell: number, bridges: readonly Bridge[]): void {
  const shoulder = BRIDGE_SHOULDER;
  const tOut = { t: 0 };
  for (const b of bridges) {
    const hw = b.width * 0.5;
    const pad = hw + shoulder + 1;
    const i0 = Math.max(0, Math.floor((Math.min(b.x0, b.x1) - pad + half) / cell));
    const i1 = Math.min(n - 1, Math.ceil((Math.max(b.x0, b.x1) + pad + half) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(b.z0, b.z1) - pad + half) / cell));
    const j1 = Math.min(n - 1, Math.ceil((Math.max(b.z0, b.z1) + pad + half) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = -half + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * cell;
        const d = distToSegment(x, z, b.x0, b.z0, b.x1, b.z1, tOut);
        if (d > hw + shoulder) continue;
        const idx = j * n + i;
        const ground = bed[idx] as number;
        const deck = archHeight(tOut.t, b.yEnd, b.yMid);
        const k = d <= hw ? 1 : 1 - (d - hw) / shoulder;
        const v = ground + (deck - ground) * (k * k * (3 - 2 * k));
        if (v > (heights[idx] as number)) heights[idx] = v;
      }
    }
  }
}

/** flags the coarse cells (DECK_N per axis) that any bridge strip plus its shoulder can reach */
function markDeckCells(bridges: readonly Bridge[], size: number): Uint8Array {
  const cells = new Uint8Array(DECK_N * DECK_N);
  const half = size / 2;
  const k = DECK_N / size;
  for (const b of bridges) {
    const pad = b.width * 0.5 + BRIDGE_SHOULDER + 1;
    const i0 = Math.max(0, Math.floor((Math.min(b.x0, b.x1) - pad + half) * k));
    const i1 = Math.min(DECK_N - 1, Math.floor((Math.max(b.x0, b.x1) + pad + half) * k));
    const j0 = Math.max(0, Math.floor((Math.min(b.z0, b.z1) - pad + half) * k));
    const j1 = Math.min(DECK_N - 1, Math.floor((Math.max(b.z0, b.z1) + pad + half) * k));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * DECK_N + i] = 1;
  }
  return cells;
}

function defaultSurface(kind: 'water' | 'lava' | 'ice', depth: number): Surface {
  if (kind === 'lava') return depth > 0.05 ? SURFACE.LAVA : SURFACE.GROUND;
  if (kind === 'ice') return depth > 0.02 ? SURFACE.ICE : SURFACE.GROUND;
  if (depth > 1.1) return SURFACE.DEEP;
  if (depth > 0.12) return SURFACE.SHALLOW;
  return SURFACE.GROUND;
}

/**
 * r6 U6: share of a tree's crown radius that counts as its extent: a stone under the canopy either touches the low crown or is
 * hidden by it from the 55 deg game camera (the capture of a stone beside a broadleaf trunk showed only leaves)
 */
const CROWN_SHARE = 0.8;
/** r6 U6: spacing (m) of the wall discs and their radius */
const WALL_STEP = 0.5;
const WALL_R = 0.35;

/**
 * r6 U6: the visual ground extent of every static scatter item as (x, z, r) discs (`clearOfStatics`): a prop's nominal half
 * extent (PropDef.radius x scale, not its smaller collision footprint), a rock's half larger side, CROWN_SHARE of a tree's crown
 * (at least its trunk), a wall as WALL_R discs every WALL_STEP along the segment.
 */
function staticExtents(L: ZoneLayout): Float32Array {
  const out: number[] = [];
  // r6 ship 10-29: max(radius, reach) = the DRAWN half extent (house_small's roof corners reach 5.75 m against its 4.5 m radius)
  for (const p of L.props) { const def = PROP_DEFS[p.id]; out.push(p.x, p.z, Math.max(def?.radius ?? 1, def?.reach ?? 0) * p.scale); }
  for (const k of L.rocks) out.push(k.x, k.z, 0.5 * Math.max(k.sx, k.sz));
  for (const t of L.trees) {
    const d = TREE_DIMS[t.species];
    out.push(t.x, t.z, Math.max(d.trunkR, CROWN_SHARE * d.crownRadius) * t.scale);
  }
  for (const w of L.walls) {
    const n = Math.max(1, Math.ceil(Math.hypot(w.x1 - w.x0, w.z1 - w.z0) / WALL_STEP));
    for (let i = 0; i <= n; i++) out.push(w.x0 + ((w.x1 - w.x0) * i) / n, w.z0 + ((w.z1 - w.z0) * i) / n, WALL_R);
  }
  // r7 U7: bridges and docks: the deck, its rails / posts and the landing ramps are drawn statics too (the U6 capture put a dock
  // railing post on a rune carpet): discs of half the deck width plus BRIDGE_RAIL every WALL_STEP along the strip, past both ends
  for (const b of L.bridges) {
    const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
    const n = Math.max(1, Math.ceil((len + 2 * BRIDGE_LANDING) / WALL_STEP));
    const ux = len > 1e-6 ? (b.x1 - b.x0) / len : 0;
    const uz = len > 1e-6 ? (b.z1 - b.z0) / len : 0;
    for (let i = 0; i <= n; i++) {
      const s = -BRIDGE_LANDING + ((len + 2 * BRIDGE_LANDING) * i) / n;
      out.push(b.x0 + ux * s, b.z0 + uz * s, b.width * 0.5 + BRIDGE_RAIL);
    }
  }
  return new Float32Array(out);
}

/** r7 U7: a bridge's rails / posts stand this far (m) outside its deck half width */
const BRIDGE_RAIL = 0.45;
/** r7 U7: the drawn landing (ramp, end posts) reaches this far (m) past each end of the bridge strip */
const BRIDGE_LANDING = 1.5;

/**
 * r6 U6: ground metres a point moves north (-z) per metre of height when it is projected along the game camera's view ray
 * (render/camera.ts: pitch 55 deg, fixed yaw, the camera south (+z) of its focus)
 */
const VIEW_LEAN = 1 / Math.tan((55 * Math.PI) / 180);
/** r6 U6: statics taller than this (m) can hide a standing small metin (about 2.9 m) from the game camera */
const VIEW_MIN_H = 3;
/** r6 U6: share of the crown radius that hides what stands behind it (the whole leafy crown: a 14 m broadleaf covered a stone 7.2 m off its axis) */
const VIEW_CROWN = 1.05;

/**
 * r6 U6: what tall statics can hide from the game camera. r7 U7: as (x, z, h0, h1, r, top) records (VIEW_REC floats): the part of an
 * item between the heights h0 and h1 above its base (x, z), half width r over its lower half and top x r over its upper half. A tree:
 * its crown from the crown base to 0.9 of its height, VIEW_CROWN of the crown radius, narrowing to VIEW_TOP_SHARE at the top; a prop
 * or rock taller than VIEW_MIN_H: the part above VIEW_MIN_H, 0.8 of its drawn half extent (a rock 0.4 of its larger side, narrowing
 * like a crown; a prop keeps its width: a banner's cloth and a hall's upper eave hang high). `viewHides` projects them through the
 * real perspective camera.
 */
function viewExtents(L: ZoneLayout): Float32Array {
  const out: number[] = [];
  for (const t of L.trees) {
    const d = TREE_DIMS[t.species];
    out.push(t.x, t.z, d.crownBase * t.scale, 0.9 * d.height * t.scale, VIEW_CROWN * d.crownRadius * t.scale, VIEW_TOP_SHARE);
  }
  for (const p of L.props) {
    const def = PROP_DEFS[p.id];
    const h = (def?.height ?? 0) * p.scale;
    if (def === undefined || h <= VIEW_MIN_H) continue;
    out.push(p.x, p.z, VIEW_MIN_H, h, 0.8 * Math.max(def.radius, def.reach ?? 0) * p.scale, 1);
  }
  for (const k of L.rocks) if (k.sy > VIEW_MIN_H) out.push(k.x, k.z, VIEW_MIN_H, k.sy, 0.4 * Math.max(k.sx, k.sz), VIEW_TOP_SHARE);
  return new Float32Array(out);
}

/** r7 U7: floats per `viewExtents` record */
const VIEW_REC = 6;
/**
 * r7 U7: a crown (or a rock's top) is widest in its lower half; over its upper half it keeps this share of its half width (a capsule
 * of the full width up to the top, magnified like the top by the perspective, refused 70 % of yeonmu's walkable fall area)
 */
const VIEW_TOP_SHARE = 0.55;
/**
 * r7 U7: the game camera (render/camera.ts: perspective, pitch 55 deg, distance 22 m at the default zoom, fixed yaw, south (+z) of
 * its focus): height and ground set-back of the camera above / behind the hero
 */
const CAM_H = 22 * Math.sin((55 * Math.PI) / 180);
const CAM_BACK = 22 * Math.cos((55 * Math.PI) / 180);
/**
 * r7 U7: the hero fights or walks up to a metin from about 7 m: the view test runs for the camera over the stone and over a hero
 * 7 m west, east or south of it, or 5 m south-west / south-east and 5 m out to the side ((dx, dz) offsets of the camera focus). The r6
 * rule projected along one parallel 55 deg ray; the real camera leans a tall item about 0.39 m sideways per metre of height when the
 * hero stands 7 m to the side, and up to 1.1 m north per metre when he stands 7 m south (the U6 critic's 1-4 residual sites per zone).
 * A hero north of the stone sees it more steeply than the camera over it, so no northern focus is needed.
 */
const VIEW_FOCI: ReadonlyArray<readonly [number, number]> = [[0, 0], [-7, 0], [7, 0], [0, 7], [-5, 5], [5, 5]];
const VIEW_HERO_R = 7;
/** r7 U7: an item's top is projected at most at this share of the camera height (a top level with the lens never reaches the ground) */
const VIEW_TOP = 0.85;
/** r7 U7: cell (m) of the grid over the view records (the camera test only reads the cells between the cameras and the stone) */
const VIEW_CELL = 8;

/**
 * r8 Z8: the carpet view body (`carpetHidden`): the camera over the stone and over a hero fighting it from 4 m south, west or east
 * ((dx, dz) offsets of the camera focus). The carpet is a flat decal that reads from close in, where the hero fights the stone; the
 * stone body keeps the wider VIEW_FOCI.
 */
const CARPET_FOCI: ReadonlyArray<readonly [number, number]> = [[0, 0], [0, 4], [-4, 0], [4, 0]];
/** r8 Z8: how far (m) sideways / south of a carpet the statics that can lean over it are looked for */
const CARPET_REACH = 16;
/** r8 ship: free ground radius (m) round each hero fight spot of a carpet (CARPET_FOCI 4 m south / west / east of the stone) */
const FIGHT_SPOT_R = 0.8;
/** r8 ship: the core (m) of a hero-spot reservation that a SMALL forced prop (placement radius <= SPOT_CORE_SMALL: a lantern, a crate, a
 *  barrel, a brazier, an urn) keeps out of; buildings, tents and landmarks still ignore the spot (Scatter.freeOf) */
const SPOT_CORE = 2.4;
const SPOT_CORE_SMALL = 1.6;
const spotCoreOf = (placementR: number): number => (placementR <= SPOT_CORE_SMALL ? SPOT_CORE : 0);
/** r8 Z8: floats per `carpetExtents` record */
const CARPET_REC = 5;
/** r9 Z9: a small metin's fight ring (m): the 13 m aura drawn round a fresh stone (render/fx/rings/metin.ts, the dashed ring) */
const RING_R = 13;
/** r9 Z9: tall statics that clutter a fight ring (`ringScore`): the banners (pole, arm and cloth) and the roofs (they hide the fight) */
const RING_BANNERS: ReadonlySet<string> = new Set(['banner_pole', 'war_banner']);
const RING_ROOFS: ReadonlySet<string> = new Set([
  'hall_tiled',
  'house_small',
  'pagoda_gate',
  'stone_gate',
  'broken_gate',
  'orc_tent',
  'yurt',
  'watchtower',
  'ruined_shrine',
  'snow_shrine',
  'giant_pagoda',
]);
/** r9 ship (Z9 critic): the tall small statics that still stood in rings (a frozen pine, stone lanterns, lamp posts): scored inside RING_SMALL_R */
const RING_SMALLS: ReadonlySet<string> = new Set(['frozen_tree', 'stone_lantern', 'lamp_post']);
const RING_SMALL_R = 8;
/**
 * r9 ship (Z9 critic must-fix: a moved site hung a third of its ring over the suryeon ravine, another ran into a daeryeol lava pit): the
 * fight ring's own ground (`ringGround`) is sampled on three circles (RING_GROUND_RINGS); a sample on blocked terrain (cliff, ravine, deep
 * water), lava, deep or shallow water, or more than RING_GROUND_DH m off the stone's height counts. The fall-site search never trades a site
 * for one whose ring has more of it (sim/metins.ts).
 */
const RING_GROUND_RINGS: ReadonlyArray<[number, number]> = [
  [4.5, 8],
  [8.5, 16],
  [12.5, 24],
];
const RING_GROUND_DH = 2;
/** r8 Z8: the lowest 0.4 m of an item stays inside its ground extent (staticExtents, METIN_CLEAR_R): the view body starts above it */
const CARPET_H0 = 0.4;

/**
 * r8 Z8: what can lean over a rune carpet in the game camera, as (x, z, h0, h1, r) records: every prop from CARPET_H0 to its height
 * with 0.75 of its drawn half extent (a lantern's cap, a lamp's bracket, a banner's arm and cloth), every rock taller than 0.8 m with
 * 0.4 of its larger side, every tree's trunk (1.5 x its radius, up to the crown) and crown (VIEW_CROWN of its radius), every wall
 * as discs every metre along it.
 */
function carpetExtents(L: ZoneLayout): Float32Array {
  const out: number[] = [];
  for (const p of L.props) {
    const def = PROP_DEFS[p.id];
    const h = (def?.height ?? 0) * p.scale;
    if (def === undefined || h <= CARPET_H0 + 0.2) continue;
    out.push(p.x, p.z, CARPET_H0, h, 0.75 * Math.max(def.radius, def.reach ?? 0) * p.scale);
  }
  for (const k of L.rocks) if (k.sy > 0.8) out.push(k.x, k.z, CARPET_H0, k.sy, 0.4 * Math.max(k.sx, k.sz));
  for (const t of L.trees) {
    const d = TREE_DIMS[t.species];
    out.push(t.x, t.z, CARPET_H0, d.crownBase * t.scale, 1.5 * d.trunkR * t.scale);
    out.push(t.x, t.z, d.crownBase * t.scale, 0.9 * d.height * t.scale, VIEW_CROWN * d.crownRadius * t.scale);
  }
  for (const w of L.walls) {
    if (w.height <= CARPET_H0 + 0.2) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(w.x1 - w.x0, w.z1 - w.z0)));
    for (let i = 0; i <= n; i++) out.push(w.x0 + ((w.x1 - w.x0) * i) / n, w.z0 + ((w.z1 - w.z0) * i) / n, CARPET_H0, w.height, WALL_R);
  }
  return new Float32Array(out);
}

/** r7 U7: `levelDisc` samples LEVEL_RIM points on the disc's rim and LEVEL_MID at half its radius */
const LEVEL_RIM = 16;
const LEVEL_MID = 8;

/** squared distance between the 2D segments a0-a1 and b0-b1 */
function segSegDist2(ax0: number, az0: number, ax1: number, az1: number, bx0: number, bz0: number, bx1: number, bz1: number): number {
  const ux = ax1 - ax0;
  const uz = az1 - az0;
  const vx = bx1 - bx0;
  const vz = bz1 - bz0;
  const wx = ax0 - bx0;
  const wz = az0 - bz0;
  const den = ux * vz - uz * vx;
  if (Math.abs(den) > 1e-9) {
    const s = (vx * wz - vz * wx) / den;
    const t = (ux * wz - uz * wx) / den;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return 0;
  }
  const pd = (px: number, pz: number, x0: number, z0: number, dx: number, dz: number): number => {
    const l2 = dx * dx + dz * dz;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / l2)) : 0;
    const ex = px - (x0 + dx * t);
    const ez = pz - (z0 + dz * t);
    return ex * ex + ez * ez;
  };
  return Math.min(pd(ax0, az0, bx0, bz0, vx, vz), pd(ax1, az1, bx0, bz0, vx, vz), pd(bx0, bz0, ax0, az0, ux, uz), pd(bx1, bz1, ax0, az0, ux, uz));
}

// ---------------------------------------------------------------------------------------------------------------------

class FieldImpl implements TerrainField {
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly grid: TerrainGrid;
  readonly arenaRadius: number;
  readonly landmarks: readonly Landmark[];
  readonly env: FieldEnv;
  readonly stats = { bakeMs: 0, walkableFraction: 0, reachableFraction: 0, blockers: 0 };
  blockers: readonly Blocker[] = [];
  private readonly half: number;
  private readonly invCell: number;
  private cellStart = new Int32Array(0);
  private cellItems = new Int32Array(0);
  private hashN = 0;
  private paintCache: PaintMaps | null = null;
  private paintFineCache: PaintMaps | null = null;
  private paintFinePending: Promise<PaintMaps> | null = null;
  readonly paintRes: number;
  /** A4: DECK_N x DECK_N flags of the coarse cells a bridge strip (plus its shoulder) can touch; null = no bridges */
  private readonly deckCells: Uint8Array | null;
  private readonly deckT = { t: 0 };

  constructor(
    readonly zoneId: string,
    readonly seed: number,
    readonly size: number,
    n: number,
    cell: number,
    private readonly plan: TerrainPlan,
    readonly layout: ZoneLayout,
    heights: Float32Array,
    bed: Float32Array,
    surface: Uint8Array,
    blocked: Uint8Array,
    inside: Float32Array,
    readonly heightRange: { min: number; max: number },
  ) {
    this.half = size / 2;
    this.invCell = 1 / cell;
    this.bounds = { minX: -this.half, maxX: this.half, minZ: -this.half, maxZ: this.half };
    this.grid = { n, cell, heights, bed, surface, blocked, inside };
    this.arenaRadius = plan.arenaRadius;
    this.landmarks = plan.landmarks;
    this.env = {
      arenaRadius: plan.arenaRadius,
      walkable: (x, z) => this.walkable(x, z),
      moveCircle: (x0, z0, x1, z1, r, out) => this.moveHero(x0, z0, x1, z1, r, out),
      surfaceAt: (x, z) => this.surfaceAt(x, z),
      clearOfStatics: (x, z, r, view) => this.clearOfStatics(x, z, r, view),
      levelDisc: (x, z, r, dh) => this.levelDisc(x, z, r, dh),
      ringScore: (x, z) => this.ringScore(x, z),
      ringGround: (x, z) => this.ringGround(x, z),
    };
    this.paintRes = normalisePaintRes(plan.paintRes);
    this.deckCells = plan.bridges.length > 0 ? markDeckCells(plan.bridges, size) : null;
  }

  /** called after scatter: builds the blocker hash and bake statistics */
  finish(blockers: Blocker[]): void {
    this.blockers = blockers;
    const hn = Math.ceil(this.size / HASH_CELL);
    this.hashN = hn;
    const counts = new Int32Array(hn * hn + 1);
    const span = (b: Blocker): [number, number, number, number] => [
      this.hashIdx(b.x - b.r),
      this.hashIdx(b.x + b.r),
      this.hashIdx(b.z - b.r),
      this.hashIdx(b.z + b.r),
    ];
    for (const b of blockers) {
      const [x0, x1, z0, z1] = span(b);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) counts[cz * hn + cx + 1] = (counts[cz * hn + cx + 1] as number) + 1;
    }
    for (let i = 0; i < hn * hn; i++) counts[i + 1] = (counts[i + 1] as number) + (counts[i] as number);
    const items = new Int32Array(counts[hn * hn] as number);
    const fill = counts.slice(0, hn * hn);
    blockers.forEach((b, bi) => {
      const [x0, x1, z0, z1] = span(b);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = cz * hn + cx;
          items[fill[c] as number] = bi;
          fill[c] = (fill[c] as number) + 1;
        }
      }
    });
    this.cellStart = counts;
    this.cellItems = items;
    this.stats.blockers = blockers.length;
    this.computeStats();
  }

  private hashIdx(v: number): number {
    const i = Math.floor((v + this.half) / HASH_CELL);
    return i < 0 ? 0 : i >= this.hashN ? this.hashN - 1 : i;
  }

  private computeStats(): void {
    const { n, blocked } = this.grid;
    let walk = 0;
    let inArena = 0;
    for (let k = 0; k < n * n; k++) {
      if ((this.grid.inside[k] as number) > 0) {
        inArena++;
        if (!blocked[k]) walk++;
      }
    }
    this.stats.walkableFraction = inArena > 0 ? walk / inArena : 0;
    // flood fill from the centre over walkable() cells (1 m grid, 4-neighbour)
    const start = this.landmark('centre') ?? { x: 0, z: 0 };
    const seen = new Uint8Array(n * n);
    const q = new Int32Array(n * n);
    let qh = 0;
    let qt = 0;
    const si = Math.round((start.x + this.half) * this.invCell);
    const sj = Math.round((start.z + this.half) * this.invCell);
    q[qt++] = sj * n + si;
    seen[sj * n + si] = 1;
    let reach = 0;
    while (qh < qt) {
      const c = q[qh++] as number;
      reach++;
      const ci = c % n;
      const cj = (c - ci) / n;
      for (let d = 0; d < 4; d++) {
        const ni = ci + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const nj = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nc = nj * n + ni;
        if (seen[nc] || blocked[nc]) continue;
        const wx = -this.half + ni * this.grid.cell;
        const wz = -this.half + nj * this.grid.cell;
        if (this.insideBlocker(wx, wz)) continue;
        seen[nc] = 1;
        q[qt++] = nc;
      }
    }
    this.stats.reachableFraction = walk > 0 ? Math.min(1, reach / walk) : 0;
  }

  heightAt(x: number, z: number): number {
    const h = this.sample(this.grid.heights, x, z);
    const dc = this.deckCells;
    if (dc === null) return h;
    let ci = Math.floor(((x + this.half) / this.size) * DECK_N);
    let cj = Math.floor(((z + this.half) / this.size) * DECK_N);
    ci = ci < 0 ? 0 : ci >= DECK_N ? DECK_N - 1 : ci;
    cj = cj < 0 ? 0 : cj >= DECK_N ? DECK_N - 1 : cj;
    return dc[cj * DECK_N + ci] === 0 ? h : this.deckHeight(x, z, h);
  }

  /**
   * Zones core A4: the baked 1 m grid holds the deck at its nodes only, so between nodes (the outer metre of a deck strip, a
   * diagonal bridge's edge, the deck ends) bilinear interpolation dips towards the river bed and rings, decals and feet sink
   * under the paving there. Near a bridge the height is the deck's own closed form (the same formula applyBridges bakes into
   * the nodes) evaluated at the query point, never lower than the grid. Elsewhere `heightAt` is the grid as before.
   */
  private deckHeight(x: number, z: number, h: number): number {
    let best = h;
    const t = this.deckT;
    for (const b of this.layout.bridges) {
      const hw = b.width * 0.5;
      const d = distToSegment(x, z, b.x0, b.z0, b.x1, b.z1, t);
      if (d > hw + BRIDGE_SHOULDER) continue;
      const deck = archHeight(t.t, b.yEnd, b.yMid);
      const k = d <= hw ? 1 : 1 - (d - hw) / BRIDGE_SHOULDER;
      const ground = this.sample(this.grid.bed, x, z);
      const v = ground + (deck - ground) * (k * k * (3 - 2 * k));
      if (v > best) best = v;
    }
    return best;
  }

  bedHeightAt(x: number, z: number): number {
    return this.sample(this.grid.bed, x, z);
  }

  private sample(heights: Float32Array, x: number, z: number): number {
    const n = this.grid.n;
    let u = (x + this.half) * this.invCell;
    let v = (z + this.half) * this.invCell;
    const max = n - 1;
    u = u < 0 ? 0 : u > max ? max : u;
    v = v < 0 ? 0 : v > max ? max : v;
    let i = Math.floor(u);
    let j = Math.floor(v);
    if (i >= max) i = max - 1;
    if (j >= max) j = max - 1;
    const fx = u - i;
    const fz = v - j;
    const o = j * n + i;
    const h00 = heights[o] as number;
    const h10 = heights[o + 1] as number;
    const h01 = heights[o + n] as number;
    const h11 = heights[o + n + 1] as number;
    // split along the 00–11 diagonal (the render mesh uses the same triangulation)
    return fx > fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  normalAt(x: number, z: number, out: Vec3Like): Vec3Like {
    const e = 0.6;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const k = 1 / Math.sqrt(dx * dx + dz * dz + 4 * e * e);
    out.x = -dx * k;
    out.y = 2 * e * k;
    out.z = -dz * k;
    return out;
  }

  slopeAt(x: number, z: number): number {
    const e = 0.6;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.atan(Math.sqrt(dx * dx + dz * dz));
  }

  private nodeIndex(x: number, z: number): number {
    const { n } = this.grid;
    let i = Math.floor((x + this.half) * this.invCell + 0.5);
    let j = Math.floor((z + this.half) * this.invCell + 0.5);
    i = i < 0 ? 0 : i >= n ? n - 1 : i;
    j = j < 0 ? 0 : j >= n ? n - 1 : j;
    return j * n + i;
  }

  private insideBlocker(x: number, z: number): boolean {
    if (this.blockers.length === 0) return false;
    const c = this.hashIdx(z) * this.hashN + this.hashIdx(x);
    const s = this.cellStart[c] as number;
    const e = this.cellStart[c + 1] as number;
    for (let k = s; k < e; k++) {
      const b = this.blockers[this.cellItems[k] as number] as Blocker;
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz < b.r * b.r) return true;
    }
    return false;
  }

  walkable(x: number, z: number): boolean {
    if (this.grid.blocked[this.nodeIndex(x, z)]) return false;
    return !this.insideBlocker(x, z);
  }

  private terrainBlockedCircle(x: number, z: number, r: number): boolean {
    const blocked = this.grid.blocked;
    if (blocked[this.nodeIndex(x, z)]) return true;
    if (r < 0.3) return false;
    const d = r * 0.92;
    const d2 = d * 0.7071;
    return (
      blocked[this.nodeIndex(x + d, z)] === 1 ||
      blocked[this.nodeIndex(x - d, z)] === 1 ||
      blocked[this.nodeIndex(x, z + d)] === 1 ||
      blocked[this.nodeIndex(x, z - d)] === 1 ||
      blocked[this.nodeIndex(x + d2, z + d2)] === 1 ||
      blocked[this.nodeIndex(x - d2, z + d2)] === 1 ||
      blocked[this.nodeIndex(x + d2, z - d2)] === 1 ||
      blocked[this.nodeIndex(x - d2, z - d2)] === 1
    );
  }

  walkableCircle(x: number, z: number, r: number): boolean {
    if (this.terrainBlockedCircle(x, z, r)) return false;
    let ok = true;
    this.blockersNear(x, z, r, (b) => {
      const dx = x - b.x;
      const dz = z - b.z;
      const rr = b.r + r;
      if (dx * dx + dz * dz < rr * rr) ok = false;
    });
    return ok;
  }

  /** r6 U6: the scatter's (x, z, r) ground discs and (x, z0, z1, r) camera strips, built on the first query (the scatter fills the layout after the constructor) */
  private statics: Float32Array | null = null;
  private viewStatics: Float32Array | null = null;

  clearOfStatics(x: number, z: number, r: number, view?: { h: number; r: number; carpet?: number }): boolean {
    const s = this.statics ?? (this.statics = staticExtents(this.layout));
    for (let i = 0; i < s.length; i += 3) {
      const dx = x - (s[i] as number);
      const dz = z - (s[i + 1] as number);
      const rr = r + (s[i + 2] as number);
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    if (view === undefined || !(view.h > 0)) return true;
    if (this.viewHides(x, z, view.h, view.r)) return false;
    if (view.carpet === undefined || !(view.carpet > 0)) return true;
    // r8 ship (Z8 critic, v07: a ruin pillar block stood on the hero's fight spot 4 m south of a seori stone): the hero's own fight spots
    // (CARPET_FOCI: 4 m south, west and east of the stone) keep FIGHT_SPOT_R of ground free of every static's ground disc
    for (const [fx, fz] of CARPET_FOCI) {
      if (fx === 0 && fz === 0) continue;
      const hx = x + fx;
      const hz = z + fz;
      for (let i = 0; i < s.length; i += 3) {
        const dx = hx - (s[i] as number);
        const dz = hz - (s[i + 1] as number);
        const rr = FIGHT_SPOT_R + (s[i + 2] as number);
        if (dx * dx + dz * dz < rr * rr) return false;
      }
    }
    // r8 Z8: the rune carpet is a second view body (r7 judge MF9: a lantern cap, a lamp bracket, a pillar top or a banner arm leaned onto
    // the carpet rim in 9 of 20 U7 frames, because only the stone body was guarded)
    return !this.carpetHidden(x, z, view.carpet);
  }

  /** r9 Z9: the fight-ring clutter records (x, z of the drawn body, its reach + RING_R), built on the first query */
  private ringRecs: Float32Array | null = null;

  /**
   * r9 Z9 (r8 judge MF8 a / b / c): how far (m, summed over the items) the banners and the roofs reach into the 13 m fight ring of a small
   * metin falling at (x, z): a hall corner in the ring of yeonmu site01, a banner pole beside seori site08 and three in the daeryeol
   * rings. A roof is taken where the game camera draws it (half its height leaned north, VIEW_LEAN). 0 = a clean ring. The fall-site
   * search prefers the cleaner site near the one it found (sim/metins.ts); nothing is ever refused for it, so the falls cannot starve.
   */
  ringScore(x: number, z: number): number {
    let v = this.ringRecs;
    if (!v) {
      const out: number[] = [];
      for (const p of this.layout.props) {
        const def = PROP_DEFS[p.id];
        if (!def) continue;
        const roof = RING_ROOFS.has(p.id);
        const small = RING_SMALLS.has(p.id);
        if (!roof && !small && !RING_BANNERS.has(p.id)) continue;
        const lean = roof ? 0.5 * VIEW_LEAN * def.height * p.scale : 0;
        out.push(p.x, p.z - lean, (small ? RING_SMALL_R : RING_R) + Math.max(def.radius, def.reach ?? 0) * p.scale);
      }
      v = this.ringRecs = new Float32Array(out);
    }
    let score = 0;
    for (let i = 0; i < v.length; i += 3) {
      const d = (v[i + 2] as number) - Math.hypot(x - (v[i] as number), z - (v[i + 1] as number));
      if (d > 0) score += d;
    }
    return score;
  }

  /**
   * r9 ship (Z9 critic must-fix): how many of the 48 samples of a small metin's 13 m fight ring at (x, z) fall on bad ground: blocked terrain
   * (a cliff, the ravine, deep water), lava, deep or shallow water, or more than RING_GROUND_DH m off the stone's own height. The fall-site
   * search never moves a site onto a ring with more of it (sim/metins.ts); 0 = the whole ring stands on open, level ground.
   */
  ringGround(x: number, z: number): number {
    const h0 = this.heightAt(x, z);
    const blocked = this.grid.blocked;
    let bad = 0;
    for (const [rr, nn] of RING_GROUND_RINGS) {
      for (let k = 0; k < nn; k++) {
        const a = ((k + 0.5) / nn) * Math.PI * 2;
        const px = x + Math.sin(a) * rr;
        const pz = z + Math.cos(a) * rr;
        const sf = this.surfaceAt(px, pz);
        if (blocked[this.nodeIndex(px, pz)] === 1 || sf === SURFACE.LAVA || sf === SURFACE.DEEP || sf === SURFACE.SHALLOW || Math.abs(this.heightAt(px, pz) - h0) > RING_GROUND_DH) bad++;
      }
    }
    return bad;
  }

  /** r8 Z8: every static's upper part as (x, z, h0, h1, r) records (`carpetExtents`) filed per VIEW_CELL cell, built on the first query */
  private carpetGrid: { v: Float32Array; n: number; start: Int32Array; items: Int32Array } | null = null;

  private carpetIndex(): { v: Float32Array; n: number; start: Int32Array; items: Int32Array } {
    if (this.carpetGrid) return this.carpetGrid;
    const v = carpetExtents(this.layout);
    const n = Math.max(1, Math.ceil(this.size / VIEW_CELL));
    const half = this.size / 2;
    const cell = (q: number): number => Math.max(0, Math.min(n - 1, Math.floor((q + half) / VIEW_CELL)));
    const recs = v.length / CARPET_REC;
    const count = new Int32Array(n * n + 1);
    for (let i = 0; i < recs; i++) (count[cell(v[i * CARPET_REC + 1] as number) * n + cell(v[i * CARPET_REC] as number) + 1] as number)++;
    for (let c = 1; c <= n * n; c++) count[c] = (count[c] as number) + (count[c - 1] as number);
    const start = count.slice();
    const fill = count.slice();
    const items = new Int32Array(recs);
    for (let i = 0; i < recs; i++) {
      const c = cell(v[i * CARPET_REC + 1] as number) * n + cell(v[i * CARPET_REC] as number);
      items[fill[c] as number] = i;
      fill[c] = (fill[c] as number) + 1;
    }
    this.carpetGrid = { v, n, start, items };
    return this.carpetGrid;
  }

  /**
   * r8 Z8: true when a static's upper part, projected through the game camera (CARPET_FOCI: the camera over the stone and over a hero
   * fighting it 4 m south, west or east), lands on the flat rune carpet of radius rc round (x, z). The carpet lies on the ground, so an
   * item covers it only by leaning over it in the projection: a point at height y moves away from the camera by CAM_H / (CAM_H - y).
   * The item's band h0..h1 is a segment on the ground with the half width of its top (magnified like the top); items under or behind
   * the camera, or north of the carpet by more than their own width (their projection only moves further north), cannot cover it.
   */
  private carpetHidden(x: number, z: number, rc: number): boolean {
    const g = this.carpetIndex();
    const v = g.v;
    const half = this.size / 2;
    const i0 = Math.max(0, Math.floor((x - CARPET_REACH + half) / VIEW_CELL));
    const i1 = Math.min(g.n - 1, Math.floor((x + CARPET_REACH + half) / VIEW_CELL));
    const j0 = Math.max(0, Math.floor((z - rc - 4 + half) / VIEW_CELL));
    const j1 = Math.min(g.n - 1, Math.floor((z + CARPET_REACH + CAM_BACK + half) / VIEW_CELL));
    for (const [fx, fz] of CARPET_FOCI) {
      const cx = x + fx;
      const cz = z + fz + CAM_BACK;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * g.n + i;
          for (let q = g.start[c] as number; q < (g.start[c + 1] as number); q++) {
            const o = (g.items[q] as number) * CARPET_REC;
            const px = v[o] as number;
            const pz = v[o + 1] as number;
            const ri = v[o + 4] as number;
            if (pz >= cz - 0.5 || pz < z - rc - ri) continue;
            const h0 = v[o + 2] as number;
            const h1 = Math.min(v[o + 3] as number, VIEW_TOP * CAM_H);
            if (h1 <= h0) continue;
            const m0 = CAM_H / (CAM_H - h0);
            const m1 = CAM_H / (CAM_H - h1);
            const ax = cx + (px - cx) * m0;
            const az = cz + (pz - cz) * m0;
            const bx = cx + (px - cx) * m1;
            const bz = cz + (pz - cz) * m1;
            const ux = bx - ax;
            const uz = bz - az;
            const l2 = ux * ux + uz * uz;
            const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
            const ex = x - (ax + ux * t);
            const ez = z - (az + uz * t);
            const rr = rc + ri * m1;
            if (ex * ex + ez * ez < rr * rr) return true;
          }
        }
      }
    }
    return false;
  }

  levelDisc(x: number, z: number, r: number, dh: number): boolean {
    const h0 = this.heightAt(x, z);
    // r8 Z8: the zone's own ground ornaments and glowing seams (TerrainPlan.carpetKeepOut) are no place for a rune carpet either
    const keepOut = this.plan.carpetKeepOut;
    if (keepOut !== undefined && keepOut(x, z)) return false;
    for (let k = 0; k < LEVEL_RIM + LEVEL_MID; k++) {
      const rim = k < LEVEL_RIM;
      const a = rim ? (k / LEVEL_RIM) * Math.PI * 2 : ((k - LEVEL_RIM + 0.5) / LEVEL_MID) * Math.PI * 2;
      const d = rim ? r : r * 0.5;
      const px = x + Math.sin(a) * d;
      const pz = z + Math.cos(a) * d;
      if (!this.walkable(px, pz)) return false;
      const s = this.surfaceAt(px, pz);
      if (s === SURFACE.LAVA || s === SURFACE.DEEP) return false;
      if (Math.abs(this.heightAt(px, pz) - h0) > dh) return false;
      if (keepOut !== undefined && keepOut(px, pz)) return false;
    }
    return true;
  }

  /** r7 U7: the view records filed per VIEW_CELL cell (built on the first query, like `statics`) */
  private viewGrid: { n: number; start: Int32Array; items: Int32Array } | null = null;

  private viewIndex(): { n: number; start: Int32Array; items: Int32Array } {
    if (this.viewGrid) return this.viewGrid;
    const v = this.viewStatics ?? (this.viewStatics = viewExtents(this.layout));
    const n = Math.max(1, Math.ceil(this.size / VIEW_CELL));
    const half = this.size / 2;
    const cell = (q: number): number => Math.max(0, Math.min(n - 1, Math.floor((q + half) / VIEW_CELL)));
    const count = new Int32Array(n * n + 1);
    const recs = v.length / VIEW_REC;
    for (let i = 0; i < recs; i++) (count[cell(v[i * VIEW_REC + 1] as number) * n + cell(v[i * VIEW_REC] as number) + 1] as number)++;
    for (let c = 1; c <= n * n; c++) count[c] = (count[c] as number) + (count[c - 1] as number);
    const start = count.slice();
    const fill = count.slice();
    const items = new Int32Array(recs);
    for (let i = 0; i < recs; i++) {
      const c = cell(v[i * VIEW_REC + 1] as number) * n + cell(v[i * VIEW_REC] as number);
      items[fill[c] as number] = i;
      fill[c] = (fill[c] as number) + 1;
    }
    this.viewGrid = { n, start, items };
    return this.viewGrid;
  }

  /**
   * r7 U7: true when a tall static hides a body (height h, foot radius r) standing at (x, z) from the game camera, for the camera
   * over the body or over a hero near it (VIEW_FOCI). Each camera projects the body's axis and every tall item's crown / roof band
   * (h0..h1 of its axis, in a lower and an upper half) onto the ground along its own rays (a point at height y moves away from the
   * camera by CAM_H / (CAM_H - y), so a near crown also grows by that factor); the item hides the body when the ground segments come
   * closer than their projected half widths. Items behind the camera, or north of the body by more than their own reach, cannot cover it.
   */
  private viewHides(x: number, z: number, h: number, r: number): boolean {
    const v = this.viewStatics ?? (this.viewStatics = viewExtents(this.layout));
    const g = this.viewIndex();
    const half = this.size / 2;
    const reachX = VIEW_HERO_R + 14;
    const i0 = Math.max(0, Math.floor((x - reachX + half) / VIEW_CELL));
    const i1 = Math.min(g.n - 1, Math.floor((x + reachX + half) / VIEW_CELL));
    const j0 = Math.max(0, Math.floor((z - 6 + half) / VIEW_CELL));
    const j1 = Math.min(g.n - 1, Math.floor((z + VIEW_HERO_R + CAM_BACK + 2 + half) / VIEW_CELL));
    const mb = CAM_H / (CAM_H - Math.min(h, VIEW_TOP * CAM_H));
    for (const [fx, fz] of VIEW_FOCI) {
      const cx = x + fx;
      const cz = z + fz + CAM_BACK;
      // the body's axis on the ground: its foot (x, z) to its top's projection
      const bx1 = cx + (x - cx) * mb;
      const bz1 = cz + (z - cz) * mb;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * g.n + i;
          for (let q = g.start[c] as number; q < (g.start[c + 1] as number); q++) {
            const o = (g.items[q] as number) * VIEW_REC;
            const px = v[o] as number;
            const pz = v[o + 1] as number;
            if (pz >= cz - 0.5) continue; // under or behind the camera
            const h0 = v[o + 2] as number;
            const h1 = Math.min(v[o + 3] as number, VIEW_TOP * CAM_H);
            if (h1 <= h0) continue;
            const hm = (h0 + h1) / 2;
            const m0 = CAM_H / (CAM_H - h0);
            const mm = CAM_H / (CAM_H - hm);
            const m1 = CAM_H / (CAM_H - h1);
            const ri = v[o + 4] as number;
            // lower half: the full half width, magnified as at its top; upper half: `top` of it, magnified as at the item's top
            const ra = ri * mm + r * mb;
            const xm = cx + (px - cx) * mm;
            const zm = cz + (pz - cz) * mm;
            if (segSegDist2(cx + (px - cx) * m0, cz + (pz - cz) * m0, xm, zm, x, z, bx1, bz1) < ra * ra) return true;
            const rb = (v[o + 5] as number) * ri * m1 + r * mb;
            if (segSegDist2(xm, zm, cx + (px - cx) * m1, cz + (pz - cz) * m1, x, z, bx1, bz1) < rb * rb) return true;
          }
        }
      }
    }
    return false;
  }

  surfaceAt(x: number, z: number): Surface {
    return this.grid.surface[this.nodeIndex(x, z)] as Surface;
  }

  insideBy(x: number, z: number): number {
    return this.grid.inside[this.nodeIndex(x, z)] as number;
  }

  landmark(id: string): Landmark | undefined {
    return this.landmarks.find((l) => l.id === id);
  }

  blockersNear(x: number, z: number, r: number, cb: (b: Blocker) => void): void {
    if (this.blockers.length === 0) return;
    const x0 = this.hashIdx(x - r);
    const x1 = this.hashIdx(x + r);
    const z0 = this.hashIdx(z - r);
    const z1 = this.hashIdx(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * this.hashN + cx;
        const s = this.cellStart[c] as number;
        const e = this.cellStart[c + 1] as number;
        for (let k = s; k < e; k++) {
          const bi = this.cellItems[k] as number;
          // a blocker spanning several cells is reported from every one; de-duplicate by first-cell ownership
          const b = this.blockers[bi] as Blocker;
          const ox = Math.max(x0, this.hashIdx(b.x - b.r));
          const oz = Math.max(z0, this.hashIdx(b.z - b.r));
          if (cx === ox && cz === oz) cb(b);
        }
      }
    }
  }

  moveCircle(x0: number, z0: number, x1: number, z1: number, r: number, out: Vec2Like): boolean {
    let nx = x1;
    let nz = z1;
    // 1) push out of blocker circles (3 relaxation passes handle clusters)
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      this.blockersNear(nx, nz, r, (b) => {
        const dx = nx - b.x;
        const dz = nz - b.z;
        const rr = b.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2);
          if (d > 1e-5) {
            nx = b.x + (dx / d) * rr;
            nz = b.z + (dz / d) * rr;
          } else {
            nx = b.x + rr;
          }
          moved = true;
        }
      });
      if (!moved) break;
    }
    // 2) terrain: slide along cliffs / water edges
    if (this.terrainBlockedCircle(nx, nz, r)) {
      if (!this.terrainBlockedCircle(nx, z0, r) && this.walkableCircle(nx, z0, r)) {
        nz = z0;
      } else if (!this.terrainBlockedCircle(x0, nz, r) && this.walkableCircle(x0, nz, r)) {
        nx = x0;
      } else {
        nx = x0;
        nz = z0;
      }
    } else if (!this.walkableCircle(nx, nz, r * 0.85)) {
      // pushed into another blocker/terrain combination: fall back to the start of the move
      nx = x0;
      nz = z0;
    }
    out.x = nx;
    out.z = nz;
    return nx === x1 && nz === z1;
  }

  /**
   * Hero step for `WorldEnv.moveCircle` (REVERIFY-1; see the pocket escape notes at TRAP_STEP_SIZES): the circle rule of `moveCircle`,
   * except that a circle step ending in a trap is refused (the hero stays), and that a hero that overlaps a cliff cell or a blocker,
   * stands in a trap, or is pinned in a dead end, a confined spot or a narrow channel end pushing out of it walks the escape path
   * (`escape`). Only an overlapping start with no escape path keeps the point rule (target, then one axis at a time). Open ground, wall
   * contact, sliding, corners, corridors and cracks are the circle rule, tick for tick. A pure function of its arguments and the baked
   * field (its memos only remember answers): host, mirrors and client-side prediction get the same answer.
   */
  moveHero(x0: number, z0: number, x1: number, z1: number, r: number, out: Vec2Like): boolean {
    const reached = this.moveCircle(x0, z0, x1, z1, r, out);
    const rx = x1 - x0;
    const rz = z1 - z0;
    const req = Math.hypot(rx, rz);
    if (req < 1e-6) return reached;
    const px = out.x;
    const pz = out.z;
    const moved = px !== x0 || pz !== z0;
    const budget = Math.max(req, PULL_MIN);
    const ux = rx / req;
    const uz = rz / req;
    const overlap = this.terrainBlockedCircle(x0, z0, r) || !this.walkableCircle(x0, z0, r * 0.85);
    // a hero mid-escape (on a node of the escape lattice) walks on to roomy ground while it is still trapped (deeper than the escape
    // tolerates, or a trap) or while its step does not point away from that ground; otherwise it takes only a circle step that ends
    // outside every pocket, or stays (it never walks back in)
    const lane = escLane(x0, z0);
    if (lane >= 0) {
      const firm = lane === LANE_POCKET && (this.escDepth(x0, z0, r) > 0 || (!overlap && this.pocket(x0, z0, r, rx, rz) === POCKET_TRAP));
      if (this.escape(x0, z0, r, ux, uz, budget, out, !firm, lane) === ESC_MOVED) return false;
      if (moved && Math.hypot(px - x0, pz - z0) <= budget + 1e-9 && this.pocket(px, pz, r, rx, rz) === 0) return reached;
      out.x = x0;
      out.z = z0;
      return false;
    }
    let ahead = false;
    if (!overlap) {
      // the circle rule's end: open ground or no pocket (plain wall contact, sliding, corners, corridors, cracks)
      const kp = this.pocket(px, pz, r, rx, rz);
      if (kp === 0) {
        if ((px - x0) * ux + (pz - z0) * uz < PIN_FRACTION * req) {
          // pinned at the closed end of a narrow channel, pushing across or out of it: walk out to roomy ground (see narrowEnd)
          if (this.narrowEnd(x0, z0, r, ux, uz) && this.escape(x0, z0, r, ux, uz, budget, out, true, LANE_CHANNEL) === ESC_MOVED) return false;
          // pinned in a confined spot (no held direction takes the hero CONFINE_REACH away), pushing toward roomy ground: walk there
          if (this.confined(x0, z0, r, rx, rz) && this.escape(x0, z0, r, ux, uz, budget, out, true, LANE_POCKET) === ESC_MOVED) return false;
        }
        return reached;
      }
      const ks = moved ? this.pocket(x0, z0, r, rx, rz) : kp;
      if (kp === POCKET_TRAP && ks !== POCKET_TRAP) {
        // nobody walks into a trap
        out.x = x0;
        out.z = z0;
        return false;
      }
      // a dead end is a wall like any other unless the hero is pinned in it pushing out (the step within ~78 degrees of its exit, and
      // not away from the roomy ground the escape leads to)
      if (ks !== POCKET_TRAP) {
        if (ks === 0 || ux * this.exitX + uz * this.exitZ <= DEAD_EXIT_COS) return reached;
        if ((px - x0) * ux + (pz - z0) * uz >= PIN_FRACTION * req) return reached;
        ahead = true;
      }
    } else if (moved && Math.hypot(px - x0, pz - z0) <= budget + 1e-9 && this.pocket(px, pz, r, rx, rz) === 0) {
      // an overlapping start the circle rule takes out with an ordinary step (its end is a disc the circle rule accepts)
      return reached;
    }
    if (this.escape(x0, z0, r, ux, uz, budget, out, ahead, LANE_POCKET) === ESC_MOVED) return false;
    out.x = px;
    out.z = pz;
    if (!overlap) return reached; // a pocket with no roomy ground in reach: the circle rule's answer, never a point-rule move
    // an overlapping start (spawned inside a cliff cell / blocker cluster) with no escape path: the point rule
    out.x = x0;
    out.z = z0;
    if (this.walkable(x1, z1)) {
      out.x = x1;
      out.z = z1;
      return true;
    }
    if (this.walkable(x1, z0)) out.x = x1;
    else if (this.walkable(x0, z1)) out.z = z1;
    return false;
  }

  private readonly trapOut: Vec2Like = { x: 0, z: 0 };
  private readonly escOut: Vec2Like = { x: 0, z: 0 };
  /** the exit of the last dead end `pocket` found (unit vector: the mean of its ways out) */
  private exitX = 0;
  private exitZ = 0;
  /** `pocket` memo, direct-mapped by position: keys (x, z, r) x MEMO_N slots of 4, the class, the exit (2 per slot) */
  private readonly memo = new Float64Array(MEMO_N * 4).fill(NaN);
  private readonly memoV = new Uint8Array(MEMO_N);
  private readonly memoE = new Float64Array(MEMO_N * 2);
  /** `narrowEnd` memo (its part that does not depend on the request): keys (x, z, r), the channel axis, or NaN for no channel end */
  private readonly nmemo = new Float64Array(MEMO_N * 4).fill(NaN);
  private readonly nmemoA = new Float64Array(MEMO_N * 2);

  /**
   * The pocket class of a hero position (see TRAP_STEP_SIZES): 0 on open ground or where the ways out spread over more than DEAD_SPAN,
   * POCKET_TRAP with no way out, POCKET_DEAD_END with all of them within DEAD_SPAN (its exit in exitX / exitZ). The answer does not
   * depend on the order of the directions, only the cost does: the way back (against the request (rx,rz)) and the directions 90
   * degrees off it come first, and at a wall they answer at once.
   */
  private pocket(x: number, z: number, r: number, rx: number, rz: number): number {
    if (this.walkableCircle(x, z, r + OPEN_SLACK)) return 0;
    // a pure function of the position: a hero held against a wall asks about the same point every tick (memo, see MEMO_N)
    const m = this.memo;
    const slot = memoSlot(x, z) * 4;
    if (m[slot] === x && m[slot + 1] === z && m[slot + 2] === r) {
      const v = this.memoV[slot >> 2] as number;
      this.exitX = this.memoE[slot >> 1] as number;
      this.exitZ = this.memoE[(slot >> 1) + 1] as number;
      return v;
    }
    const v = this.pocketOf(x, z, r, rx, rz);
    m[slot] = x;
    m[slot + 1] = z;
    m[slot + 2] = r;
    this.memoV[slot >> 2] = v;
    this.memoE[slot >> 1] = this.exitX;
    this.memoE[(slot >> 1) + 1] = this.exitZ;
    return v;
  }

  /** `pocket` without the memo */
  private pocketOf(x: number, z: number, r: number, rx: number, rz: number): number {
    const o = this.trapOut;
    const k0 = (Math.round(Math.atan2(-rz, -rx) / (Math.PI / 8)) + 16) & 15;
    let ways = 0;
    let sx = 0;
    let sz = 0;
    for (let n = 0; n < 16; n++) {
      const k = (k0 + (TRAP_ORDER[n] as number)) & 15;
      if (!this.wayOut(x, z, r, k, o)) continue;
      // a way out: two of them more than DEAD_SPAN apart and this is no pocket
      for (let j = 0; j < 16; j++) {
        if (((ways >> j) & 1) === 0) continue;
        const d = (k - j + 16) & 15;
        if (d > DEAD_SPAN && d < 16 - DEAD_SPAN) return 0;
      }
      ways |= 1 << k;
      sx += PROBE_COS[k] as number;
      sz += PROBE_SIN[k] as number;
    }
    if (ways === 0) return POCKET_TRAP;
    const l = Math.hypot(sx, sz);
    this.exitX = sx / l;
    this.exitZ = sz / l;
    return POCKET_DEAD_END;
  }

  /**
   * The closed end of a narrow channel (a corner wedge, the end of a hero-wide alley, the bottom of a channel between cliff cells), the
   * request (ux,uz) pointing across or out of it (cos >= NARROW_COS with the channel's axis): from (x,z) the hero creeps freely
   * (CREEP_STEPS of CREEP_STEP keeping CREEP_FREE headway) in at most three neighbouring directions, and its ways out (`wayOut`) all lie
   * on that side (within NARROW_SPAN). A wall, a corner, or a crack with a way out at both ends is none.
   */
  private narrowEnd(x: number, z: number, r: number, ux: number, uz: number): boolean {
    const m = this.nmemo;
    const slot = memoSlot(x, z) * 4;
    if (!(m[slot] === x && m[slot + 1] === z && m[slot + 2] === r)) {
      const ok = this.narrowAxis(x, z, r);
      m[slot] = x;
      m[slot + 1] = z;
      m[slot + 2] = r;
      this.nmemoA[slot >> 1] = ok ? this.axisX : NaN;
      this.nmemoA[(slot >> 1) + 1] = ok ? this.axisZ : NaN;
    }
    const ax = this.nmemoA[slot >> 1] as number;
    const az = this.nmemoA[(slot >> 1) + 1] as number;
    // NaN (no channel end) fails the comparison
    return ux * ax + uz * az >= NARROW_COS;
  }

  /** the channel axis `narrowAxis` found (unit vector out of the channel) */
  private axisX = 0;
  private axisZ = 0;

  /** the part of `narrowEnd` that does not depend on the request: true at a closed channel end, its axis in axisX / axisZ */
  private narrowAxis(x: number, z: number, r: number): boolean {
    const o = this.trapOut;
    let free = 0;
    let sx = 0;
    let sz = 0;
    for (let k = 0; k < 16; k++) {
      const px = PROBE_COS[k] as number;
      const pz = PROBE_SIN[k] as number;
      let cx = x;
      let cz = z;
      let ok = true;
      for (let i = 0; i < CREEP_STEPS && ok; i++) {
        this.moveCircle(cx, cz, cx + px * CREEP_STEP, cz + pz * CREEP_STEP, r, o);
        if ((o.x - cx) * px + (o.z - cz) * pz < 0.5 * CREEP_STEP) ok = false;
        cx = o.x;
        cz = o.z;
      }
      if (!ok || (cx - x) * px + (cz - z) * pz < CREEP_FREE * CREEP_STEPS * CREEP_STEP) continue;
      if (free > 0) {
        // the free directions must lie within 45 degrees of the first one
        const d = (k - this.creepK + 16) & 15;
        if (d > 2 && d < 14) return false;
      } else this.creepK = k;
      free++;
      if (free > 3) return false;
      sx += px;
      sz += pz;
    }
    if (free === 0) return false;
    const l = Math.hypot(sx, sz);
    this.axisX = sx / l;
    this.axisZ = sz / l;
    // one-sided: no two ways out more than NARROW_SPAN apart (a crack open at both ends has ways both ways)
    let ways = 0;
    for (let k = 0; k < 16; k++) {
      if (!this.wayOut(x, z, r, k, o)) continue;
      for (let j = 0; j < 16; j++) {
        if (((ways >> j) & 1) === 0) continue;
        const d = (k - j + 16) & 15;
        if (d > NARROW_SPAN && d < 16 - NARROW_SPAN) return false;
      }
      ways |= 1 << k;
    }
    return ways !== 0;
  }

  /** the first free creep direction `narrowEnd` met (its others must lie within 45 degrees of it) */
  private creepK = 0;

  /**
   * Confined: no world direction, held for CONFINE_PATH of circle steps, takes the hero at (x,z) CONFINE_REACH away (a nook, a stretch
   * of a rubble staircase). The circle rule may still move it about; a hero pinned there and pushing toward roomy ground walks out.
   */
  private confined(x: number, z: number, r: number, rx: number, rz: number): boolean {
    const m = this.cmemo;
    const slot = memoSlot(x, z) * 4;
    if (m[slot] === x && m[slot + 1] === z && m[slot + 2] === r) return m[slot + 3] === 1;
    // the way back (against the request) first: at a wall it is the answer at once (the order changes the cost, not the answer)
    const k0 = (Math.round(Math.atan2(-rz, -rx) / (Math.PI / 8)) + 16) & 15;
    let v = true;
    for (let n = 0; n < 16 && v; n++) if (this.wayOut(x, z, r, (k0 + (TRAP_ORDER[n] as number)) & 15, this.trapOut, CONFINE_REACH, CONFINE_PATH)) v = false;
    m[slot] = x;
    m[slot + 1] = z;
    m[slot + 2] = r;
    m[slot + 3] = v ? 1 : 0;
    return v;
  }

  /** `confined` memo: keys (x, z, r), the answer */
  private readonly cmemo = new Float64Array(MEMO_N * 4).fill(NaN);

  /**
   * World direction k is a way out of (x,z): holding it, circle steps of one of TRAP_STEP_SIZES (the hero's own step varies with its
   * speed, and a crack between cliff cells can pass one step size and pin another) take the hero `reach` away within `path`.
   */
  private wayOut(x: number, z: number, r: number, k: number, o: Vec2Like, reach = TRAP_REACH, path = TRAP_PATH): boolean {
    const reach2 = reach * reach;
    for (let s = 0; s < TRAP_STEP_SIZES.length; s++) {
      const step = TRAP_STEP_SIZES[s] as number;
      const dx = (PROBE_COS[k] as number) * step;
      const dz = (PROBE_SIN[k] as number) * step;
      let cx = x;
      let cz = z;
      for (let i = Math.ceil(path / step); i > 0; i--) {
        this.moveCircle(cx, cz, cx + dx, cz + dz, r, o);
        // pinned: the circle rule is a function of the position, so this step size stays pinned
        if (o.x === cx && o.z === cz) break;
        cx = o.x;
        cz = o.z;
        const ex = cx - x;
        const ez = cz - z;
        const e2 = ex * ex + ez * ez;
        if (e2 >= reach2) return true;
        // the steps left cannot make up the distance (counting each as up to 1.5 times its length: a push-out adds a little)
        const left = (i - 1) * step * 1.5;
        if (left < reach && (reach - left) * (reach - left) > e2) break;
      }
    }
    return false;
  }

  /**
   * How much deeper than the escape allows the hero disc at (x,z) reaches: into a cliff cell beyond ESC_TERRAIN_TOL, into a blocker
   * beyond the circle rule's 0.15 R (0 for every disc the escape may use freely); Infinity when the centre is not point-walkable.
   */
  private escDepth(x: number, z: number, r: number): number {
    if (!this.walkable(x, z)) return Infinity;
    const t = this.terrainDepth(x, z, r) - ESC_TERRAIN_TOL;
    const b = this.blockerDepth(x, z, r) - 0.15 * r;
    return t > b ? (t > 0 ? t : 0) : b > 0 ? b : 0;
  }

  /**
   * The escape (see TRAP_STEP_SIZES): a breadth-first search from the hero over its lane's world-aligned lattice (ESC_H, ESC_OFF_X) for
   * the nearest roomy node (disc + ROOMY_SLACK free, ROOMY_RUN runs, no pocket; on the channel lane also a free run of ESC_GO_ON along
   * the step). An edge (8 neighbours) never leads deeper (`escDepth`), so every node on the way is a point-walkable disc reaching at
   * most ESC_TERRAIN_TOL into a cliff cell and 0.15 R into a blocker, or one no deeper than the overlapping start. With `ahead` (an
   * escape the hero is not forced into) a goal more than ~105 degrees off the step is ESC_DECLINED, and so, on the pocket lane, is a
   * first tick that would go backwards against the step. The hero walks the path node by node as far as `budget` reaches (the first
   * node is within 0.06 m, or straight to the second when the way is no deeper) and stops on
   * a node of it, so the next search, from that node, finds roomy ground strictly fewer nodes away; at the goal the rest of the step is
   * the circle rule's unless that ends in a trap. A path is at most ESC_HALF nodes, a search visits at most ESC_MAX_NODES nodes.
   * ESC_NONE when no roomy node is in reach. A one-entry memo answers a hero that stays put (the same question every tick).
   */
  private escape(x0: number, z0: number, r: number, ux: number, uz: number, budget: number, out: Vec2Like, ahead: boolean, lane: number): number {
    // a pure function of its arguments: a hero that stays put asks the same every tick (a one-entry memo)
    const k = this.escKey;
    if (k[0] === x0 && k[1] === z0 && k[2] === r && k[3] === ux && k[4] === uz && k[5] === budget && k[6] === (ahead ? 1 : 0) + 2 * lane) {
      if (this.escRes === ESC_MOVED) {
        out.x = k[7] as number;
        out.z = k[8] as number;
      }
      return this.escRes;
    }
    const o = this.escTo;
    const res = this.escapeOf(x0, z0, r, ux, uz, budget, o, ahead, lane);
    if (res === ESC_MOVED) {
      out.x = o.x;
      out.z = o.z;
    }
    k[0] = x0;
    k[1] = z0;
    k[2] = r;
    k[3] = ux;
    k[4] = uz;
    k[5] = budget;
    k[6] = (ahead ? 1 : 0) + 2 * lane;
    k[7] = o.x;
    k[8] = o.z;
    this.escRes = res;
    return res;
  }

  private readonly escKey = new Float64Array(9).fill(NaN);
  private escRes = ESC_NONE;
  private readonly escTo: Vec2Like = { x: 0, z: 0 };

  /** `escape` without the memo */
  private escapeOf(x0: number, z0: number, r: number, ux: number, uz: number, budget: number, out: Vec2Like, ahead: boolean, lane: number): number {
    const sc = (escScratch ??= {
      stamp: 0,
      mark: new Uint32Array(ESC_N * ESC_N),
      seen: new Uint32Array(ESC_N * ESC_N),
      depth: new Float64Array(ESC_N * ESC_N),
      prev: new Int32Array(ESC_N * ESC_N),
      queue: new Int32Array(ESC_N * ESC_N),
    });
    const { mark, seen, depth, prev, queue } = sc;
    const stamp = ++sc.stamp;
    const h = ESC_H;
    const offX = ESC_OFF_X[lane] as number;
    const offZ = ESC_OFF_Z[lane] as number;
    const ci = Math.round((x0 - offX) / h);
    const cj = Math.round((z0 - offZ) / h);
    const bi = ci - ESC_HALF;
    const bj = cj - ESC_HALF;
    const nodeDepth = (idx: number): number => {
      if (seen[idx] !== stamp) {
        seen[idx] = stamp;
        const a = idx % ESC_N;
        depth[idx] = this.escDepth((bi + a) * h + offX, (bj + (idx - a) / ESC_N) * h + offZ, r);
      }
      return depth[idx] as number;
    };
    let tail = 0;
    const d0 = this.escDepth(x0, z0, r);
    const seed = (a: number, b: number): void => {
      const idx = a + b * ESC_N;
      if (mark[idx] === stamp || !(nodeDepth(idx) <= d0)) return;
      mark[idx] = stamp;
      prev[idx] = -1;
      queue[tail++] = idx;
    };
    const onLane = escLane(x0, z0) === lane;
    if (onLane) seed(ESC_HALF, ESC_HALF);
    else {
      // off the lattice (the first escape tick): the corners of the lattice cell the hero stands in, if no deeper; the ones ahead of
      // the step first (the search keeps that order, so of equally short paths the one starting ahead wins)
      const a0 = Math.floor((x0 - offX) / h) - bi;
      const b0 = Math.floor((z0 - offZ) / h) - bj;
      const ea = ux >= 0 ? 1 : 0;
      const eb = uz >= 0 ? 1 : 0;
      const first = Math.abs(ux) >= Math.abs(uz);
      seed(a0 + ea, b0 + eb);
      if (first) {
        seed(a0 + ea, b0 + 1 - eb);
        seed(a0 + 1 - ea, b0 + eb);
      } else {
        seed(a0 + 1 - ea, b0 + eb);
        seed(a0 + ea, b0 + 1 - eb);
      }
      seed(a0 + 1 - ea, b0 + 1 - eb);
    }
    let goal = -1;
    // hop count of the queue's head: breadth-first, so a level ends at the tail as it stood when the level began
    let level = 0;
    let levelEnd = tail;
    for (let head = 0; head < tail && head < ESC_MAX_NODES; head++) {
      if (head === levelEnd) {
        level++;
        levelEnd = tail;
      }
      const idx = queue[head] as number;
      const a = idx % ESC_N;
      const b = (idx - a) / ESC_N;
      const x = (bi + a) * h + offX;
      const z = (bj + b) * h + offZ;
      if (this.walkableCircle(x, z, r + ROOMY_SLACK) && this.hasRun(x, z, r) && this.pocket(x, z, r, ux, uz) === 0) {
        // the channel lane ends where the step goes on: a free straight run of ESC_GO_ON along it
        let on = true;
        for (let d = 0.25; lane === LANE_CHANNEL && on && d <= ESC_GO_ON + 1e-9; d += 0.25) on = this.walkableCircle(x + ux * d, z + uz * d, r);
        if (on) {
          goal = idx;
          break;
        }
      }
      if (level >= ESC_HALF) continue;
      const da = depth[idx] as number;
      for (let d = 0; d < 8; d++) {
        const na = a + (ESC_DI[d] as number);
        const nb = b + (ESC_DJ[d] as number);
        if (na < 0 || nb < 0 || na >= ESC_N || nb >= ESC_N) continue;
        const nidx = na + nb * ESC_N;
        if (mark[nidx] === stamp || !(nodeDepth(nidx) <= da)) continue;
        mark[nidx] = stamp;
        prev[nidx] = idx;
        queue[tail++] = nidx;
      }
    }
    if (goal < 0) return ESC_NONE;
    if (ahead) {
      // only toward roomy ground the step does not point away from (within ~105 degrees of it)
      const ga = goal % ESC_N;
      const gx = (bi + ga) * h + offX - x0;
      const gz = (bj + (goal - ga) / ESC_N) * h + offZ - z0;
      if (ux * gx + uz * gz <= ESC_ON_COS * Math.hypot(gx, gz)) return ESC_DECLINED;
    }
    // the path, seed first (queue[] is free again: reuse it)
    let len = 0;
    for (let i = goal; i >= 0; i = prev[i] as number) queue[len++] = i;
    let cx = x0;
    let cz = z0;
    let left = budget;
    let at = -1;
    let k = len - 1;
    if (len >= 2 && !onLane) {
      // off the lattice: straight to the second node when the step reaches it and the way there is no deeper (no detour by the corner)
      const idx = queue[len - 2] as number;
      const a = idx % ESC_N;
      const x = (bi + a) * h + offX;
      const z = (bj + (idx - a) / ESC_N) * h + offZ;
      const d = Math.hypot(x - x0, z - z0);
      const lim = d0 > 0 ? d0 : 0;
      if (d <= left && this.escDepth(x0 + (x - x0) * 0.5, z0 + (z - z0) * 0.5, r) <= lim) {
        left -= d;
        cx = x;
        cz = z;
        at = idx;
        k = len - 3;
      }
    }
    for (; k >= 0; k--) {
      const idx = queue[k] as number;
      const a = idx % ESC_N;
      const x = (bi + a) * h + offX;
      const z = (bj + (idx - a) / ESC_N) * h + offZ;
      const d = Math.hypot(x - cx, z - cz);
      if (d > left) break;
      left -= d;
      cx = x;
      cz = z;
      at = idx;
    }
    if (at < 0) return ESC_NONE;
    // a pocket-lane escape the hero is not forced into never starts backwards against its step (it would undo the hero's last move);
    // the channel lane's first step runs along the channel, across the push, from the lattice node beside the hero
    if (ahead && !onLane && lane === LANE_POCKET && ux * (cx - x0) + uz * (cz - z0) < ESC_FIRST_COS * Math.hypot(cx - x0, cz - z0)) return ESC_DECLINED;
    out.x = cx;
    out.z = cz;
    if (at === goal && left > 1e-4) {
      // arrived: the rest of the step is the circle rule's, unless that ends in a trap
      const o = this.escOut;
      this.moveCircle(cx, cz, cx + ux * left, cz + uz * left, r, o);
      if (this.pocket(o.x, o.z, r, ux, uz) !== POCKET_TRAP) {
        out.x = o.x;
        out.z = o.z;
      }
    }
    return ESC_MOVED;
  }

  /** metres the hero disc at (x,z) reaches into the nearest blocked grid cell (0 when it reaches none) */
  private terrainDepth(x: number, z: number, r: number): number {
    const { n, cell, blocked } = this.grid;
    const lo = (v: number): number => Math.min(n - 1, Math.max(0, Math.floor((v + this.half) * this.invCell + 0.5)));
    const i0 = lo(x - r);
    const i1 = lo(x + r);
    const j0 = lo(z - r);
    const j1 = lo(z + r);
    let best = r * r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (blocked[j * n + i] !== 1) continue;
        const dx = Math.max(Math.abs(x - (-this.half + i * cell)) - cell * 0.5, 0);
        const dz = Math.max(Math.abs(z - (-this.half + j * cell)) - cell * 0.5, 0);
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
    }
    return r - Math.sqrt(best);
  }

  /** metres the hero disc at (x,z) reaches into the deepest blocker it overlaps (0 when none) */
  private blockerDepth(x: number, z: number, r: number): number {
    let m = 0;
    this.blockersNear(x, z, r, (b) => {
      const d = b.r + r - Math.hypot(x - b.x, z - b.z);
      if (d > m) m = d;
    });
    return m;
  }

  /** at least two of 8 directions have a disc-free straight run of ROOMY_RUN from (x,z) (0.25 m samples) */
  private hasRun(x: number, z: number, r: number): boolean {
    let runs = 0;
    for (let k = 0; k < 16; k += 2) {
      const dx = PROBE_COS[k] as number;
      const dz = PROBE_SIN[k] as number;
      let ok = true;
      for (let d = 0.25; d <= ROOMY_RUN; d += 0.25) {
        if (!this.walkableCircle(x + dx * d, z + dz * d, r)) {
          ok = false;
          break;
        }
      }
      if (ok && ++runs >= 2) return true;
    }
    return false;
  }

  nearestWalkable(x: number, z: number, maxR: number, out: Vec2Like, r = 0.5): boolean {
    if (this.walkableCircle(x, z, r)) {
      out.x = x;
      out.z = z;
      return true;
    }
    for (let ring = 1; ring * 1.5 <= maxR; ring++) {
      const rad = ring * 1.5;
      const steps = Math.max(8, Math.round(rad * 2.2));
      for (let k = 0; k < steps; k++) {
        // evenly spaced directions without trig: rotate a unit vector by a precomputed small step
        const t = (k / steps) * 4;
        const f = t - Math.floor(t);
        const q = Math.floor(t) & 3;
        // square-ish ring parametrisation normalised to the circle
        let dx = q === 0 ? 1 - 2 * f : q === 1 ? -1 : q === 2 ? -1 + 2 * f : 1;
        let dz = q === 0 ? 1 : q === 1 ? 1 - 2 * f : q === 2 ? -1 : -1 + 2 * f;
        const l = Math.sqrt(dx * dx + dz * dz);
        dx /= l;
        dz /= l;
        const px = x + dx * rad;
        const pz = z + dz * rad;
        if (this.walkableCircle(px, pz, r)) {
          out.x = px;
          out.z = pz;
          return true;
        }
      }
    }
    return false;
  }

  paint(): PaintMaps {
    if (!this.paintCache) this.paintCache = bakePaint(this, this.plan);
    return this.paintCache;
  }

  paintFine(): PaintMaps {
    if (this.paintRes <= PAINT_RES) return this.paint();
    if (!this.paintFineCache) {
      const g = refinePaint(this, this.plan, this.paint(), this.paintRes);
      let r = g.next();
      while (!r.done) r = g.next();
      this.paintFineCache = r.value;
    }
    return this.paintFineCache;
  }

  paintFineAsync(budgetMs = 8): Promise<PaintMaps> {
    if (this.paintRes <= PAINT_RES) return Promise.resolve(this.paint());
    if (this.paintFineCache) return Promise.resolve(this.paintFineCache);
    this.paintFinePending ??= (async () => {
      const g = refinePaint(this, this.plan, this.paint(), this.paintRes);
      const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      let t = now();
      for (;;) {
        const r = g.next();
        if (r.done) {
          this.paintFineCache = r.value;
          return r.value;
        }
        if (now() - t >= budgetMs) {
          await yieldToMain();
          t = now();
        }
      }
    })();
    return this.paintFinePending;
  }
}

/** a macrotask boundary without the 4 ms floor browsers put on nested setTimeout(0) (MessageChannel where it exists) */
function yieldToMain(): Promise<void> {
  if (typeof MessageChannel === 'function') {
    return new Promise<void>((res) => {
      const c = new MessageChannel();
      c.port1.onmessage = (): void => {
        c.port1.close();
        res();
      };
      c.port2.postMessage(0);
    });
  }
  return new Promise<void>((res) => setTimeout(res, 0));
}

/** a recipe's `paintRes` snapped down to the 512 * 2^k ladder (512 when absent or not a number), capped at PAINT_RES_MAX */
export function normalisePaintRes(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= PAINT_RES) return PAINT_RES;
  let r = PAINT_RES;
  while (r * 2 <= Math.min(v, PAINT_RES_MAX) + 1e-6) r *= 2;
  return r;
}

/** evaluates the recipe's paint function at (x,z) and writes the 8 normalised layer weights (bytes summing to 255) at texel `o` */
function paintTexel(f: FieldImpl, plan: TerrainPlan, x: number, z: number, layers: number, raw: Float32Array, w0: Uint8Array, w1: Uint8Array, o: number): void {
  const h = f.bedHeightAt(x, z);
  const sx = (f.bedHeightAt(x + 0.6, z) - f.bedHeightAt(x - 0.6, z)) / 1.2;
  const sz = (f.bedHeightAt(x, z + 0.6) - f.bedHeightAt(x, z - 0.6)) / 1.2;
  const slope = Math.atan(Math.sqrt(sx * sx + sz * sz));
  raw.fill(0);
  plan.paint(x, z, h, slope, raw);
  let sum = 0;
  for (let k = 0; k < layers; k++) {
    const v = raw[k] as number;
    sum += v > 0 ? v : 0;
  }
  if (sum <= 1e-6) {
    raw[0] = 1;
    sum = 1;
  }
  let acc = 0;
  // largest-remainder style rounding so the 8 bytes sum to 255
  let maxK = 0;
  let maxV = -1;
  for (let k = 0; k < 8; k++) {
    const v = k < layers ? Math.max(0, raw[k] as number) / sum : 0;
    const b = Math.round(v * 255);
    acc += b;
    if (v > maxV) {
      maxV = v;
      maxK = k;
    }
    if (k < 4) w0[o + k] = b;
    else w1[o + k - 4] = b;
  }
  const diff = 255 - acc;
  if (diff !== 0) {
    if (maxK < 4) w0[o + maxK] = (w0[o + maxK] as number) + diff;
    else w1[o + maxK - 4] = (w1[o + maxK - 4] as number) + diff;
  }
}

function bakePaint(f: FieldImpl, plan: TerrainPlan): PaintMaps {
  const res = PAINT_RES;
  const texel = f.size / res;
  const w0 = new Uint8Array(res * res * 4);
  const w1 = new Uint8Array(res * res * 4);
  const layers = Math.min(8, plan.groundLayers.length);
  const raw = new Float32Array(layers);
  const half = f.size / 2;
  for (let j = 0; j < res; j++) {
    const z = -half + (j + 0.5) * texel;
    for (let i = 0; i < res; i++) {
      const x = -half + (i + 0.5) * texel;
      paintTexel(f, plan, x, z, layers, raw, w0, w1, (j * res + i) * 4);
    }
  }
  return { res, texel, w0, w1 };
}

/**
 * Which coarse bilinear cells (i..i+1, j..j+1) a finer map must evaluate: those with a corner texel whose weights bend
 * (second difference along x or y above PAINT_REFINE_CURV in some layer) or jump (step between neighbours above
 * PAINT_REFINE_STEP). Linear ramps (lawn / dirt gradients) interpolate exactly, so only real edges and creases pay.
 */
function refineMask(s0: Uint8Array, s1: Uint8Array, sres: number): Uint8Array {
  const curv = new Uint8Array(sres * sres);
  for (let j = 1; j < sres - 1; j++) {
    for (let i = 1; i < sres - 1; i++) {
      const o = (j * sres + i) * 4;
      let m = 0;
      for (let k = 0; k < 8; k++) {
        const arr = k < 4 ? s0 : s1;
        const kk = k < 4 ? k : k - 4;
        const c = arr[o + kk] as number;
        const dx = Math.abs((arr[o - 4 + kk] as number) - 2 * c + (arr[o + 4 + kk] as number));
        const dz = Math.abs((arr[o - sres * 4 + kk] as number) - 2 * c + (arr[o + sres * 4 + kk] as number));
        const st = Math.max(Math.abs((arr[o + 4 + kk] as number) - c), Math.abs((arr[o + sres * 4 + kk] as number) - c));
        const v = Math.max(dx, dz, st > PAINT_REFINE_STEP ? 255 : 0);
        if (v > m) m = v;
      }
      curv[j * sres + i] = m > 255 ? 255 : m;
    }
  }
  const cells = sres - 1;
  const need = new Uint8Array(cells * cells);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const o = j * sres + i;
      const m = Math.max(curv[o] as number, curv[o + 1] as number, curv[o + sres] as number, curv[o + sres + 1] as number);
      need[j * cells + i] = m > PAINT_REFINE_CURV ? 1 : 0;
    }
  }
  return need;
}

/** diagnostics of the last `refinePaint` (tests, tools): child texels the recipe evaluated vs interpolated */
export const paintRefineStats = { evaluated: 0, interpolated: 0 };

/**
 * Zones core A1: doubles the density of `src` (one level of the 512 * 2^k ladder) until `target`. A child texel takes the
 * bilinear interpolation of the four coarse texels around it (exactly what the GPU filter would draw from the coarse map)
 * unless the coarse map bends or steps there (refineMask): the recipe's paint function is then evaluated
 * at the child's own centre, so road / plaza / kerb / rim / shadow edges gain the finer shape. Deterministic.
 */
function* refinePaint(f: FieldImpl, plan: TerrainPlan, src: PaintMaps, target: number): Generator<void, PaintMaps, void> {
  const layers = Math.min(8, plan.groundLayers.length);
  const raw = new Float32Array(layers);
  const half = f.size / 2;
  let cur = src;
  paintRefineStats.evaluated = 0;
  paintRefineStats.interpolated = 0;
  while (cur.res < target) {
    const sres = cur.res;
    const res = sres * 2;
    const texel = f.size / res;
    const w0 = new Uint8Array(res * res * 4);
    const w1 = new Uint8Array(res * res * 4);
    const s0 = cur.w0;
    const s1 = cur.w1;
    const cells = sres - 1;
    const need = refineMask(s0, s1, sres);
    const acc = new Float32Array(8);
    for (let J = 0; J < res; J++) {
      // child centre in coarse texel coordinates: (J + 0.5) / 2 - 0.5 = J / 2 - 0.25 (an even child sits 0.25 right of a coarse centre)
      const vj = J / 2 - 0.25;
      let j0 = Math.floor(vj);
      if (j0 < 0) j0 = 0;
      else if (j0 > sres - 2) j0 = sres - 2;
      const fj = Math.min(1, Math.max(0, vj - j0));
      const z = -half + (J + 0.5) * texel;
      for (let I = 0; I < res; I++) {
        const ui = I / 2 - 0.25;
        let i0 = Math.floor(ui);
        if (i0 < 0) i0 = 0;
        else if (i0 > sres - 2) i0 = sres - 2;
        const fi = Math.min(1, Math.max(0, ui - i0));
        const o = (J * res + I) * 4;
        if (need[j0 * cells + i0]) {
          paintTexel(f, plan, -half + (I + 0.5) * texel, z, layers, raw, w0, w1, o);
          paintRefineStats.evaluated++;
          continue;
        }
        paintRefineStats.interpolated++;
        const a = (j0 * sres + i0) * 4;
        const b = a + 4;
        const c = a + sres * 4;
        const d = c + 4;
        const wa = (1 - fi) * (1 - fj);
        const wb = fi * (1 - fj);
        const wc = (1 - fi) * fj;
        const wd = fi * fj;
        let sum = 0;
        let maxK = 0;
        let maxV = -1;
        for (let k = 0; k < 8; k++) {
          const arr = k < 4 ? s0 : s1;
          const kk = k < 4 ? k : k - 4;
          const v = Math.round((arr[a + kk] as number) * wa + (arr[b + kk] as number) * wb + (arr[c + kk] as number) * wc + (arr[d + kk] as number) * wd);
          acc[k] = v;
          sum += v;
          if (v > maxV) {
            maxV = v;
            maxK = k;
          }
        }
        acc[maxK] = (acc[maxK] as number) + (255 - sum);
        for (let k = 0; k < 4; k++) {
          w0[o + k] = acc[k] as number;
          w1[o + k] = acc[k + 4] as number;
        }
      }
      // a slice boundary for paintFineAsync (rows are about a millisecond of work)
      yield;
    }
    cur = { res, texel, w0, w1 };
  }
  return cur;
}

// ---------------------------------------------------------------------------------------------------------------------

const OCC_CELL = 4;
/** hero body height above ground (m) used when projecting tilted rock geometry onto the collision plane */
const ROCK_HERO_H = 1.8;

/**
 * Derive collision circle(s) for a rock from its FINAL placement dimensions, yaw, tilt and sink.
 * Uses deterministic dcos/dsin so host and co-op guests produce identical blockers.
 */
export function rockBlockers(p: RockPlacement, explicitBlocking: boolean | undefined, out: Blocker[]): void {
  const blocking = explicitBlocking ?? (p.kind !== 'pebbles' && p.kind !== 'outcrop' && p.kind !== 'ledge' && p.sy > 0.7);
  if (!blocking || !(p.sx > 0) || !(p.sy > 0) || !(p.sz > 0)) return;
  const sink = p.sink ?? 0;
  const yTop = p.sy < ROCK_HERO_H + sink ? p.sy : ROCK_HERO_H + sink;
  if (yTop <= 0.05) return;

  const hx = p.sx * 0.5;
  const hz = p.sz * 0.5;
  const tx = p.tiltX ?? 0;
  const tz = p.tiltZ ?? 0;
  const cxT = tx === 0 ? 1 : dcos(tx);
  const sxT = tx === 0 ? 0 : dsin(tx);
  const czT = tz === 0 ? 1 : dcos(tz);
  const szT = tz === 0 ? 0 : dsin(tz);

  // Project local box [-hx, hx] x [0, yTop] x [-hz, hz] under Rx(tiltX) * Rz(tiltZ) onto yaw-local XZ.
  const ux = czT;
  const uy = -szT;
  const vx = szT * sxT;
  const vy = czT * sxT;
  const vz = cxT;
  const offX = 0.5 * uy * yTop;
  const offZ = 0.5 * vy * yTop;
  const rx = Math.abs(ux) * hx + 0.5 * Math.abs(uy) * yTop;
  const rz = Math.abs(vx) * hx + 0.5 * Math.abs(vy) * yTop + Math.abs(vz) * hz;

  const cy = dcos(p.yaw);
  const sy = dsin(p.yaw);
  const emit = (lx: number, lz: number, r: number): void => {
    out.push({ x: p.x + lx * cy + lz * sy, z: p.z - lx * sy + lz * cy, r, kind: 'rock' });
  };

  const longH = Math.max(rx, rz);
  const shortH = Math.min(rx, rz);
  if (longH <= shortH * 1.25) {
    emit(offX, offZ, Math.max(shortH, longH * 0.92));
    return;
  }
  const r = Math.max(0.25, shortH * 0.95);
  const span = Math.max(0, longH - r);
  const n = Math.min(6, Math.max(2, Math.ceil(longH / Math.max(0.25, shortH))));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const delta = t * span;
    if (rx >= rz) emit(offX + delta, offZ, r);
    else emit(offX, offZ + delta, r);
  }
}

interface TrackedRock {
  p: RockPlacement;
  explicitBlocking: boolean | undefined;
  occR: number;
}

class Scatter implements ScatterContext {
  readonly layout: ZoneLayout;
  readonly arenaRadius: number;
  readonly blockers: Blocker[] = [];
  private readonly rockEntries: TrackedRock[] = [];
  private readonly rockByPlacement = new Map<RockPlacement, TrackedRock>();
  private readonly occ: number[][];
  private readonly occN: number;
  private readonly occ_x: number[] = [];
  private readonly occ_z: number[] = [];
  private readonly occ_r: number[] = [];
  /** r8 Z8: 1 = a hero-spot reservation (`reserveSpot`): a forced set piece does not see it */
  private readonly occ_spot: number[] = [];
  private readonly half: number;

  constructor(
    private readonly f: FieldImpl,
    plan: TerrainPlan,
    readonly rng: WorldRng,
  ) {
    this.layout = f.layout;
    this.arenaRadius = plan.arenaRadius;
    this.half = f.size / 2;
    this.occN = Math.ceil(f.size / OCC_CELL);
    this.occ = Array.from({ length: this.occN * this.occN }, () => []);
    // landmarks reserve their clear radius for scatter (props inside a landmark are placed with `force`)
  }

  heightAt(x: number, z: number): number {
    return this.f.heightAt(x, z);
  }

  slopeAt(x: number, z: number): number {
    return this.f.slopeAt(x, z);
  }

  surfaceAt(x: number, z: number): Surface {
    return this.f.surfaceAt(x, z);
  }

  insideBy(x: number, z: number): number {
    return this.f.insideBy(x, z);
  }

  suitable(x: number, z: number, opts?: FreeOptions): boolean {
    const margin = opts?.margin ?? 3;
    if (this.f.insideBy(x, z) < margin) return false;
    if (this.f.slopeAt(x, z) > (opts?.maxSlope ?? 0.55)) return false;
    const s = this.f.surfaceAt(x, z);
    if (s !== SURFACE.GROUND && !(opts?.anySurface && s !== SURFACE.DEEP && s !== SURFACE.LAVA)) return false;
    return true;
  }

  private cellOf(v: number): number {
    const i = Math.floor((v + this.half) / OCC_CELL);
    return i < 0 ? 0 : i >= this.occN ? this.occN - 1 : i;
  }

  isFree(x: number, z: number, r: number): boolean {
    return this.freeOf(x, z, r, false);
  }

  /**
   * `isFree`; with `skipSpots` the hero-spot reservations (`reserveSpot`) do not count (r8 Z8: the free test of a forced set piece), except
   * their core of `spotCore` m (r8 ship, Z8 critic s14 / s15 / s16: forced lanterns and crates stood on the hero spots; a small forced
   * prop keeps out of the spot's core, a building or a landmark still ignores the spot, which stands off it instead)
   */
  private freeOf(x: number, z: number, r: number, skipSpots: boolean, spotCore = 0): boolean {
    const x0 = this.cellOf(x - r - 4);
    const x1 = this.cellOf(x + r + 4);
    const z0 = this.cellOf(z - r - 4);
    const z1 = this.cellOf(z + r + 4);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.occ[cz * this.occN + cx] as number[];
        for (let k = 0; k < list.length; k++) {
          const o = list[k] as number;
          // r9 Z9: a set-piece reservation (kind 2) only keeps the loose scatter off; a forced put ignores it
          if (skipSpots && this.occ_spot[o] === 2) continue;
          const spot = skipSpots && this.occ_spot[o] === 1;
          if (spot && !(spotCore > 0)) continue;
          const dx = x - (this.occ_x[o] as number);
          const dz = z - (this.occ_z[o] as number);
          const rr = r + (spot ? Math.min(spotCore, this.occ_r[o] as number) : (this.occ_r[o] as number));
          if (dx * dx + dz * dz < rr * rr) return false;
        }
      }
    }
    return true;
  }

  occupy(x: number, z: number, r: number): void {
    this.addDisc(x, z, r, 0);
  }

  reserveSpot(x: number, z: number, r: number): void {
    this.addDisc(x, z, r, 1);
  }

  /**
   * r9 Z9 (r8 judge MF8 i): keeps the loose scatter (rocks, trees, unforced props) off the disc where a forced set piece will stand
   * later, so the set piece's draws stay where they were in the recipe order (the suryeon boss-ring braziers after the ring's rock
   * clusters: a cluster stone 1.31 m off the north brazier dropped it on 1 of 40 run seeds). A forced put ignores it. Draws nothing.
   */
  reserveSetPiece(x: number, z: number, r: number): void {
    this.addDisc(x, z, r, 2);
  }

  private addDisc(x: number, z: number, r: number, spot: number): void {
    const id = this.occ_x.length;
    this.occ_x.push(x);
    this.occ_z.push(z);
    this.occ_r.push(r);
    this.occ_spot.push(spot);
    const x0 = this.cellOf(x - r);
    const x1 = this.cellOf(x + r);
    const z0 = this.cellOf(z - r);
    const z1 = this.cellOf(z + r);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) (this.occ[cz * this.occN + cx] as number[]).push(id);
  }

  tree(species: TreeSpecies, x: number, z: number, scale = 1, spacing?: number, opts?: FreeOptions): TreePlacement | null {
    const sp = (spacing ?? TREE_DIMS[species].spacing) * scale;
    if (!this.suitable(x, z, opts) || !this.isFree(x, z, sp)) return null;
    const p: TreePlacement = {
      species,
      x,
      z,
      y: this.f.heightAt(x, z),
      scale,
      yaw: this.rng.next() * 6.2831853,
      seed: this.rng.int(65536),
    };
    this.layout.trees.push(p);
    this.occupy(x, z, sp);
    this.blockers.push({ x, z, r: TREE_DIMS[species].trunkR * scale, kind: 'tree' });
    return p;
  }

  rock(kind: RockKind, x: number, z: number, sx: number, sy: number, sz: number, mat = 0, opts?: FreeOptions & { sink?: number; blocking?: boolean; force?: boolean }): RockPlacement | null {
    const rad = Math.max(sx, sz) * 0.5;
    if (!opts?.force && !this.suitable(x, z, { maxSlope: 0.9, ...opts })) return null;
    if (!this.isFree(x, z, rad * 0.8)) return null;
    const p: RockPlacement = {
      kind,
      x,
      z,
      y: this.f.heightAt(x, z),
      sx,
      sy,
      sz,
      yaw: this.rng.next() * 6.2831853,
      seed: this.rng.int(65536),
      mat,
      sink: opts?.sink ?? 0.12 * sy,
    };
    this.layout.rocks.push(p);
    const occR = rad * 0.8;
    this.occupy(x, z, occR);
    const entry: TrackedRock = { p, explicitBlocking: opts?.blocking, occR };
    this.rockEntries.push(entry);
    this.rockByPlacement.set(p, entry);
    return p;
  }

  updateRock(p: RockPlacement, opts?: { blocking?: boolean; occupy?: boolean }): void {
    const entry = this.rockByPlacement.get(p);
    if (!entry) return;
    if (opts?.blocking !== undefined) entry.explicitBlocking = opts.blocking;
    if (opts?.occupy === true) {
      const occR = Math.max(p.sx, p.sz) * 0.5 * 0.8;
      if (occR > entry.occR) {
        this.occupy(p.x, p.z, occR);
        entry.occR = occR;
      }
    }
  }

  /** merge non-rock blockers with rock blockers derived from every rock's finalized dimensions, yaw and tilt */
  finalizeBlockers(): Blocker[] {
    const out = this.blockers.slice();
    for (let i = 0; i < this.rockEntries.length; i++) {
      const entry = this.rockEntries[i] as TrackedRock;
      rockBlockers(entry.p, entry.explicitBlocking, out);
    }
    return out;
  }

  fits(id: string, x: number, z: number, scale = 1, opts?: FreeOptions & { force?: boolean }): boolean {
    const def = PROP_DEFS[id];
    if (!def) throw new Error(`unknown prop "${id}"`);
    if (!opts?.force && !this.suitable(x, z, { maxSlope: 0.45, ...opts })) return false;
    return this.freeOf(x, z, def.radius * scale * 0.9, opts?.force === true, spotCoreOf(def.radius * scale));
  }

  prop(id: string, x: number, z: number, yaw?: number, scale = 1, opts?: FreeOptions & { force?: boolean }): PropPlacement | null {
    const def = PROP_DEFS[id];
    if (!def) throw new Error(`unknown prop "${id}"`);
    if (!opts?.force && !this.suitable(x, z, { maxSlope: 0.45, ...opts })) return null;
    const rad = def.radius * scale * 0.9;
    // r8 Z8: a forced set piece does not see the hero-spot reservations (the spots move off the set pieces instead): the r7 judge
    // measured seori dropping its ruined shrine, broken gate and both camps in every run to the QA spot discs laid first
    if (!this.freeOf(x, z, rad, opts?.force === true, spotCoreOf(def.radius * scale))) return null;
    const p: PropPlacement = {
      id,
      x,
      z,
      y: this.f.heightAt(x, z),
      yaw: yaw ?? this.rng.next() * 6.2831853,
      scale,
      seed: this.rng.int(65536),
    };
    this.layout.props.push(p);
    this.occupy(x, z, rad);
    propBlockers(p, this.blockers);
    return p;
  }

  wall(kind: WallKind, x0: number, z0: number, x1: number, z1: number, height = 2.4): WallPlacement {
    const w: WallPlacement = { kind, x0, z0, x1, z1, height, seed: this.rng.int(65536) };
    this.layout.walls.push(w);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(len / 0.9));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.blockers.push({ x: x0 + dx * t, z: z0 + dz * t, r: 0.55, kind: 'wall' });
    }
    return w;
  }

  block(b: Blocker): void {
    this.blockers.push(b);
  }

  disc(cx: number, cz: number, radius: number, attempts: number, place: (x: number, z: number) => void): void {
    for (let i = 0; i < attempts; i++) {
      // uniform in disc without trig: rejection from the square
      const u = this.rng.next() * 2 - 1;
      const v = this.rng.next() * 2 - 1;
      if (u * u + v * v > 1) continue;
      place(cx + u * radius, cz + v * radius);
    }
  }
}
