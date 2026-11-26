
// Round 3: FRAME_TREES (every hero spot has its own big trees + pale boulders in the gameplay frame), the river pinches to a neck for a
// short humped stone bridge, no gate wall chain (boulder piles), the autumn track runs through its spot, greyer earth tints.
//
// Layout (metres, x east, z south; north = -z = top of the layout dump). Reminiscent of a1, not traced from its minimap:
//   - centre: the Great Metin site on a round paved plaza (r 24), flat to r 30, a wide beaten-earth village ground round it
//   - NE / NW: two big halls on a stone base (an adjoined pair + one more), houses along the east road, stone lights in pairs
//   - a tangle of wandering tracks (roadNetwork: 3.4-6.5 m wide, wear, junction clearings, round dead ends) between pockets
//   - four internal granite spines (ridge) split the plain into pockets; a raised hill shrine (plateau) NE, a pale boulder skirt
//   - a wide organic river from a cleft in the NW cliffs with a sandy shelf (riverProfile), two bridges + a ford, a pond
//   - sparse BIG trees in groves with empty lanes (clumpTrees, ~9 trees/ha), one rust-orange autumn grove, pale rim cliffs
//
// Determinism: everything that feeds heights / blockers uses only + - * / sqrt floor abs min max, noise.ts / rng.ts helpers
// and the kit's polynomial trig (dsin / dcos / datan2 / dirAt).
import type { Bridge, CoverSpec, GroundLayer, Landmark, RockKind, Stream, TreeSpecies } from '../layoutTypes';
import { Polyline, clamp, fbm, lerp, ridged, smoothPath, smoothstep } from '../noise';
import { hash2 } from '../rng';
import type { RecipeContext, ScatterContext, TerrainPlan, ZoneRecipe } from '../recipe';
import { bump, riverProfile, riverWidth, smax, terrace } from '../shapes';
import {
  Path2,
  avenue,
  clumpProps,
  clumpRocks,
  clumpTrees,
  dcos,
  dsin,
  fencedYard,
  gatePair,
  hayYard,
  patchNoise,
  ROCK_ASPECT,
  pillarRing,
  plateau,
  ridge,
  roadNetwork,
  roadSample,
  ruinCourt,
  smoothCurve,
  standingStoneRing,
  unit,
  yawToward,
  type Relief,
  type RoadPoint,
  type RoadSpec,
  type Vec2,
} from '../kit';

// ---------------------------------------------------------------------------------------------------------------------
// Ground tiles
//

// until then the layer keeps the old shared tile graded by `tint`. FINAL_TILES (read by look/yeonmu.ts) is true: the look grade is
// the one calibrated for the new tiles.

interface Tile {
  tex: string;
  scale: number;
  tint?: string;
}
type TileKey = 'grass' | 'dark' | 'road' | 'rock' | 'plaza' | 'shade' | 'sand' | 'rubble';

const OLD_TILES: Record<TileKey, Tile> = {
  grass: { tex: 'tex_grass_a', scale: 7, tint: '#f0d68c' },
  dark: { tex: 'tex_grass_b', scale: 6.5, tint: '#e2c286' },
  road: { tex: 'tex_dirt_path', scale: 6, tint: '#b8c4d0' },
  rock: { tex: 'tex_rock_mossy', scale: 9, tint: '#e4d4e4' },
  plaza: { tex: 'tex_plaza_tile', scale: 9, tint: '#a2b0c2' },
  shade: { tex: 'tex_dry_grass', scale: 6.5, tint: '#a8c0b4' },
  sand: { tex: 'tex_dirt_path', scale: 7, tint: '#e6ecf0' },
  rubble: { tex: 'tex_rock_mossy', scale: 5, tint: '#dccfd8' },
};
/** round 5: small carved-inset chevron bricks (tex_yeonmu_plaza_tile_b). YA-02: a warm sandstone tint (it was a cool lilac grey) */
const PLAZA_TILE: Tile = { tex: 'tex_yeonmu_plaza_tile_b', scale: 4.6, tint: '#e2d8ca' };
const NEW_TILES: Record<TileKey, Tile> = {
  grass: { tex: 'tex_yeonmu_grass', scale: 6.5 },
  // layer 1 was unused (weight 0: the crown shadows come from the baked light map, look.shadow.trees, core round 1). YA-02: it is the TWIN
  // of the plaza paving (same tile, scale and tint, so the two blend invisibly): the paving outside the medallion disc is painted on it,
  // which lets a decal family dress the paving without ever crossing the medallion (a decal mask is a layer weight)
  dark: PLAZA_TILE,
  
  road: { tex: 'tex_yeonmu_earth', scale: 7, tint: '#d8d8fa' },
  // granite wall (core round 1: tex_yeonmu_cliff_b, a cool grey face with strata, rust weathering streaks and lichen; the pale
  // tex_yeonmu_cliff_face read as one white monolith). The loose boulders use the same tile (look.rocks.tex)
  rock: { tex: 'tex_yeonmu_cliff_b', scale: 11, tint: '#f2f4f8' },
  plaza: PLAZA_TILE,
  // layer 5 = the tree SHADE layer on earth: the same earth tile at the same scale, cool and about half as bright
  shade: { tex: 'tex_yeonmu_earth', scale: 7, tint: '#a6a6c8' },
  // settle: the calm ripple tile again (the wet tile's dark pebble mottling read as dragged dirt smears on the pond beach), tint +14 %
  sand: { tex: 'tex_yeonmu_sand', scale: 6, tint: '#aeac9e' },
  // the scree / cap layer reuses the wall tile (one texture, 1 MB less than the old gravel tile)
  rubble: { tex: 'tex_yeonmu_cliff_b', scale: 6.5, tint: '#b4b6b4' },
};

const SHIPPED: TileKey[] = ['grass', 'dark', 'road', 'shade', 'rock', 'plaza', 'sand', 'rubble'];
/** true: the look grade is the one calibrated for the new tiles */
export const FINAL_TILES = true;
/** the tiles in use (look/yeonmu.ts keys roughness / rock caps by these ids) */
export const YEONMU_TILES: Record<TileKey, Tile> = Object.fromEntries(
  (Object.keys(OLD_TILES) as TileKey[]).map((k) => [k, SHIPPED.includes(k) ? NEW_TILES[k] : OLD_TILES[k]]),
) as Record<TileKey, Tile>;

const GRASS = 0;
const DARK = 1;
const ROAD = 2;
const ROCK = 3;
const PLAZA = 4;
const SHADE_E = 5;
const SAND = 6;
const RUBBLE = 7;

/** height-blend bias per layer (render-only): the earth shade layer wins its borders against the lit earth tile */
const LAYER_H: Partial<Record<TileKey, number>> = { shade: 0.28 };
const LAYERS: GroundLayer[] = (['grass', 'dark', 'road', 'rock', 'plaza', 'shade', 'sand', 'rubble'] as TileKey[]).map((k) => {
  const t = YEONMU_TILES[k];
  const l: GroundLayer = t.tint ? { tex: t.tex, scale: t.scale, tint: t.tint } : { tex: t.tex, scale: t.scale };
  const h = LAYER_H[k];
  if (h) l.h = h;
  return l;
});


const COVER: CoverSpec[] = [
  // short lawn tufts on the open grass, in clumps (about a third of the ground), natural spacing
  { tex: 'tex_fol_grass_1', density: 0.3, size: [0.5, 0.85], layers: [1, 0, 0, 0, 0, 0, 0, 0], tintVar: 0.25, far: true, clump: { scale: 11, lo: 0.57, hi: 0.68, seed: 5 }, jitter: 0.75, variants: 1, lean: 0.2, heightVar: 0.3, cards: 6 },
  // taller clumps under the groves and on the darker lawn
  { tex: 'tex_fol_grass_2', density: 0.22, size: [0.8, 1.2], layers: [0.7, 0, 0, 0, 0, 0, 0, 0.1], tint: '#b9cf82', tintVar: 0.3, clump: { scale: 8, lo: 0.56, hi: 0.67, seed: 6 }, jitter: 0.7, lean: 0.25, heightVar: 0.35, cards: 6 },
  // sun-dried tufts on the tan field patches (the old tex_fol_grass_3 carries a cut-stem artifact: grass_1 tinted golden)
  { tex: 'tex_fol_grass_1', density: 0.13, size: [0.45, 0.75], layers: [0, 0, 0.45, 0, 0, 0, 0, 0.25], tint: '#d8c675', tintVar: 0.3, clump: { scale: 9, lo: 0.5, hi: 0.62, seed: 7 }, jitter: 0.75, lean: 0.2, cards: 3 },
  // YA-02: small drifts of wild flowers, twice as many as before, in two tints (one draw each): warm white daisies and pale yellow ones in
  // separate drifts (own clump seeds), still never confetti
  { tex: 'tex_fol_flowers_1', density: 0.5, size: [0.35, 0.5], layers: [0.4, 0, 0, 0, 0, 0, 0, 0], tint: '#f4f1e6', tintVar: 0.12, clump: { scale: 6, lo: 0.52, hi: 0.64, seed: 11 }, jitter: 0.7, cards: 3 },
  { tex: 'tex_fol_flowers_1', density: 0.34, size: [0.32, 0.46], layers: [0.4, 0, 0, 0, 0, 0, 0, 0], tint: '#f1e08a', tintVar: 0.12, clump: { scale: 7, lo: 0.52, hi: 0.64, seed: 12 }, jitter: 0.7, cards: 3 },
];

// ---------------------------------------------------------------------------------------------------------------------
// Constants

/** water surface; plains never dip below it except in the carved river / pond */
const L = -2.6;
/** valley floor next to the river: a shelf a hand above the waterline */
const VALLEY = L + 0.45;
const R_ARENA = 188;
const PLAZA_R = 13.5;
/** radius of the carved medallion picture on the plaza centre (render/terrain/look/yeonmu.ts look.medallion.radius) */
const MEDALLION_R = 8.6;
const CENTRE_R = 18;
/** riverProfile reference half width: the river's own width comes from the signed edge distance (see riverDe) */
const RIVER_WC = 14;

const RIVER_CTRL: Array<[number, number]> = [
  [-128, -110], [-119, -99], [-106, -86], [-95, -70], [-90, -55], [-94, -42], [-100, -30], [-108, -19], [-117, -8], [-113, 3], [-103, 9], [-103, 20],
  [-110, 32], [-102, 43], [-91, 55], [-92, 70], [-103, 85], [-100, 100], [-88, 113], [-72, 119],
];
const POND = { x: -64, z: 119, rx: 26, rz: 15 };

const FORD = { id: 'ford_south', x: -92, z: 66 };
/** where the river narrows for the stone bridge */
const BRIDGE_NECK = { x: -108, z: 5 };

/** the QA / gallery spots (tools/qa spots.json): kept clear of boulders, shrubs and trees so the hero never stands inside one */
const SPOTS: Array<[number, number]> = [
  [23, -36], [84, 10], [0, -60], [-114, -30], [-86, 80], [-150, 40], [170, 34], [-60, -160], [-72, -98], [56, -116], [82, 118], [116, 54], [-22, 100], [30, 110], [-70, -90],
];

/** hero spots by name (tools/qa spots.json) */
const SPOT_AT: Record<string, [number, number]> = {
  hall_ne: [23, -36], hamlet: [84, 10], northgate: [0, -60], river: [-114, -30], pond: [-86, 80], rimcliff: [-150, 40], cliffeast: [170, 34],
  northrim1: [-60, -160], grove_nw: [-72, -98], autumn: [56, -116], paddies: [82, 118], orchard: [116, 54], meadow: [-22, 100],
  wide_plaza: [0, 0], wide_south: [30, 110],
};

/**
 * Big trees composed into the gameplay frame of each hero spot (the frame is about 32 x 18 m round the hero, the sun comes from the
 * west-north-west so the shadows fall to the right and down). [species, dx, dz, scale] relative to the spot: a tree stands 8-12 m to
 * the side (its whole crown + trunk + long shadow in view), never in front of the hero; the rust crown comes with a pale boulder pair.
 */
const FRAME_TREES: Record<string, Array<[TreeSpecies, number, number, number]>> = {
  hall_ne: [['broadleaf', 11, 2, 1.2], ['broadleaf', 9, -7, 1.05]],
  hamlet: [['broadleaf', 10.5, 3, 1.18], ['broadleaf', 0, -8, 1.05]],
  northgate: [['broadleaf', -9, -3, 1.2], ['autumn', 9.5, -5, 1.1]],
  river: [['broadleaf', -10.5, 2, 1.25], ['broadleaf', -3, -8, 1.05]],
  pond: [['broadleaf', 10.5, 2, 1.2], ['autumn', 3, -9, 1.05]],
  rimcliff: [['broadleaf', 9, 1, 1.2], ['broadleaf', -5, -8, 1.05]],
  cliffeast: [['broadleaf', -10.5, 2, 1.25], ['broadleaf', -2, -8, 1.05]],
  northrim1: [['broadleaf', -10.5, 3, 1.18], ['broadleaf', 7, 6, 1.05]],
  grove_nw: [['broadleaf', -10.5, 1, 1.3], ['broadleaf', 2, -8, 1.2], ['broadleaf', 11, -1, 1.18], ['autumn', 9, 9, 1.1]],
  autumn: [['autumn', -10, 1, 1.3], ['broadleaf', 11, -2, 1.18], ['autumn', 3, -9, 1.05]],
  paddies: [['broadleaf', -11, 1, 1.2], ['broadleaf', 8, -8, 1.05]],
  orchard: [['broadleaf', -11.5, 1, 1.2], ['broadleaf', 11, -1, 1.25], ['autumn', 0, -10, 1.12]],
  meadow: [['broadleaf', 12, 0, 1.2], ['broadleaf', -12, 4, 1.18]],
  // the two wide shots (zoom 30: about 44 x 24 m)
  wide_plaza: [['broadleaf', -29, 15, 1.15], ['autumn', 22, 8.5, 1.1]],
  wide_south: [['broadleaf', -17, 4, 1.25], ['broadleaf', 8, -13, 1.15]],
};

/** soft rolling hills (the rim and the ridges frame the plain; these only roughen it) */
const KNOLLS: Array<{ x: number; z: number; r: number; h: number }> = [
  { x: -58, z: -64, r: 30, h: 3.4 },
  { x: 126, z: 12, r: 28, h: 3.4 },
  { x: -38, z: 62, r: 26, h: 2.2 },
  { x: -142, z: -14, r: 32, h: 4.6 },
  { x: 30, z: -122, r: 28, h: 4.2 },
  { x: 142, z: 96, r: 28, h: 3.6 },
  { x: 22, z: 120, r: 24, h: 2.2 },
];

/** internal granite spines: [control points, crest height m, half width m] */
const RIDGES: Array<{ pts: Vec2[]; h: number; w: number }> = [
  { pts: [[-92, -16], [-76, -30], [-60, -45], [-44, -61], [-23, -69]], h: 10, w: 14 },
  { pts: [[100, -38], [121, -53], [141, -56], [159, -43]], h: 9, w: 13 },
  { pts: [[48, 52], [68, 67], [89, 75]], h: 8, w: 12 },
  { pts: [[-58, 48], [-49, 64], [-45, 79]], h: 7, w: 11 },
];

/** cliff vs foothill rim: [pseudo-angle centre, half width] of the softer wooded foothill sections */
const FOOT_ARCS: Array<[number, number]> = [
  [0.7, 0.34],
  [3.52, 0.2],
  [1.37, 0.17],
];

/** bays in the rim: [pseudo-angle centre, half width, push-out metres]; they give the hero spots of the zone a flat foot to stand on */
const RIM_BAYS: Array<[number, number, number]> = [
  [0.167, 0.13, 15],
  [2.727, 0.11, 10],
];

/** the hill shrine: a plateau with one ramp towards the plaza */
const SHRINE = { x: 104, z: -98, r: 15, h: 6.5 };

/** farm district (rotated plots), SE */
const FARM = { x: 90, z: 120, hu: 58, hv: 32, c: 0.955, sn: 0.2955, pu: 15, pv: 11 };

interface Boss {
  id: string;
  x: number;
  z: number;
  r: number;
}
const BOSSES: Boss[] = [
  { id: 'boss_meadow', x: -22, z: 100, r: 20 },
  { id: 'boss_orchard', x: 116, z: 54, r: 18 },
  { id: 'boss_ruins', x: -128, z: 50, r: 18 },
  { id: 'boss_north', x: -30, z: -124, r: 19 },
];

/** tree clump patches (paint darkens the lawn under the groves with the same noise) */
const GROVE = { scale: 44, lo: 0.78, hi: 1 };
const GROVE_SEED = 7701;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

const HALF_PI = 1.5707963;

/** monotonic pseudo angle in [0,4): 0 = +x (east), 1 = +z (south), 2 = -x, 3 = -z (north) */
function pseudoAngle(x: number, z: number): number {
  const p = x / (Math.abs(x) + Math.abs(z) + 1e-9);
  return z >= 0 ? 1 - p : 3 + p;
}

/** unit direction whose pseudo angle is `a` */
function pseudoDir(a: number, out: [number, number]): void {
  let x: number;
  let z: number;
  if (a <= 2) {
    x = 1 - a;
    z = 1 - Math.abs(x);
  } else {
    x = a - 3;
    z = -(1 - Math.abs(x));
  }
  const l = Math.sqrt(x * x + z * z) || 1;
  out[0] = x / l;
  out[1] = z / l;
}

const dist = (ax: number, az: number, bx: number, bz: number): number => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

/** Scalar field baked on a coarse grid (bilinear lookups); `FAR` outside the grid. */
class GridField {
  static readonly FAR = 1000;
  private readonly nx: number;
  private readonly nz: number;
  private readonly v: Float32Array;

  constructor(
    private readonly x0: number,
    private readonly z0: number,
    x1: number,
    z1: number,
    private readonly cell: number,
    fn: (x: number, z: number) => number,
  ) {
    this.nx = Math.ceil((x1 - x0) / cell) + 1;
    this.nz = Math.ceil((z1 - z0) / cell) + 1;
    this.v = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.v[j * this.nx + i] = fn(x0 + i * cell, z0 + j * cell);
  }

  at(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) return GridField.FAR;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const o = j * this.nx + i;
    const v = this.v;
    const a = (v[o] as number) + ((v[o + 1] as number) - (v[o] as number)) * tx;
    const b = (v[o + this.nx] as number) + ((v[o + this.nx + 1] as number) - (v[o + this.nx] as number)) * tx;
    return a + (b - a) * tz;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rim

const RIM_BINS = 512;

interface RimSample {
  /** boundary radius (m) */
  R: number;
  /** 1 = sheer cliff wall, 0 = wooded foothill */
  cliff: number;
  /** wall crest height (m) */
  crest: number;
}

/** Angular tables (indexed by pseudo angle) for the irregular boundary, its cliff/foothill mix and crest height. */
class Rim {
  private readonly R = new Float32Array(RIM_BINS);
  private readonly cliff = new Float32Array(RIM_BINS);
  private readonly crest = new Float32Array(RIM_BINS);
  readonly s: RimSample = { R: 0, cliff: 1, crest: 34 };

  constructor(seed: number) {
    const d: [number, number] = [0, 0];
    for (let k = 0; k < RIM_BINS; k++) {
      const a = ((k + 0.5) * 4) / RIM_BINS;
      pseudoDir(a, d);
      const [ux, uz] = d;
      let r = 166 + 22 * clamp(0.5 + 1.5 * fbm(ux * 1.2 + 4.4, uz * 1.2 - 2.2, seed + 5, 3), 0, 1) + 3 * fbm(ux * 4.1 - 7.7, uz * 4.1 + 1.9, seed + 6, 2);
      // north entrance notch for the rim gate
      const dn = Math.min(Math.abs(a - 3), 4 - Math.abs(a - 3));
      r += 11 * bump(dn, 0.1);
      for (const [ab, wb, pb] of RIM_BAYS) r += pb * bump(Math.min(Math.abs(a - ab), 4 - Math.abs(a - ab)), wb);
      this.R[k] = clamp(r, 156, R_ARENA);
      let foot = 0;
      for (const [ac, w] of FOOT_ARCS) {
        const da = Math.abs(a - ac);
        foot = Math.max(foot, 1 - smoothstep(w, w + 0.14, Math.min(da, 4 - da)));
      }
      this.cliff[k] = clamp(1 - foot + 0.2 * fbm(ux * 3 + 1.3, uz * 3 + 9.1, seed + 7, 2), 0, 1);
      this.crest[k] = 31 + 9 * (0.5 + 0.5 * fbm(ux * 2.2 + 8.8, uz * 2.2 - 4.4, seed + 8, 2));
    }
  }

  sample(a: number): RimSample {
    const f = a * (RIM_BINS / 4) - 0.5;
    const i0 = Math.floor(f);
    const t = f - i0;
    const j0 = (i0 + RIM_BINS) & (RIM_BINS - 1);
    const j1 = (j0 + 1) & (RIM_BINS - 1);
    const s = this.s;
    s.R = (this.R[j0] as number) + ((this.R[j1] as number) - (this.R[j0] as number)) * t;
    s.cliff = (this.cliff[j0] as number) + ((this.cliff[j1] as number) - (this.cliff[j0] as number)) * t;
    s.crest = (this.crest[j0] as number) + ((this.crest[j1] as number) - (this.crest[j0] as number)) * t;
    return s;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pads: building / arena sites flattened into the terrain

interface Pad {
  x: number;
  z: number;
  r0: number;
  r1: number;
  y: number;
}

/** a placed structure: position, yaw and the unit vector of its front (+Z in prop space) */
interface Spot {
  x: number;
  z: number;
  yaw: number;
  fx: number;
  fz: number;
}

function spot(x: number, z: number, fx: number, fz: number): Spot {
  const [ux, uz] = unit(fx, fz);
  return { x, z, yaw: yawToward(ux, uz), fx: ux, fz: uz };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sun
//

// zones core round (B1) the shadow is the crown silhouette itself, projected along this sun into the baked light map
// (look.shadow.trees, render/terrain/treeShadow.ts); the lobed masks painted into the 1 m paint texel (rounds 5-6) are gone.

/** direction towards the sun (look.biome.sun.dir): the shadows fall to the right and towards the camera */
export const SUN_DIR: [number, number, number] = [-0.6, 0.75, -0.25];

// ---------------------------------------------------------------------------------------------------------------------

export const yeonmuRecipe: ZoneRecipe = {
  id: 'yeonmu',
  build(ctx: RecipeContext): TerrainPlan {
    const s = ctx.seed;
    const rim = new Rim(s);
    rim.sample(3);
    const gateRim = spot(0, -(rim.s.R - 8.5), 0, 1);

    // --- river + pond: signed edge distance (< 0 in the water body) ------------------------------------------------------
    const riverPoly = new Polyline(smoothPath(RIVER_CTRL, 10));
    const along = { s: 0 };
    const riverLen = riverPoly.total;
    const riverDe = new GridField(-198, -182, 0, 172, 1.5, (x, z) => {
      const d = riverPoly.distance(x, z, along);
      // wide organic river: noise-varied half width 3-12 m, opening up into the pond at the end
      const widen = 1 + 1.2 * smoothstep(0.76, 1, along.s / riverLen);
      // the river pinches to a neck where the west road crosses it (a short, humped bridge instead of a long slab)
      const neck = 1 - 0.14 * (1 - smoothstep(5, 30, dist(x, z, BRIDGE_NECK.x, BRIDGE_NECK.z)));
      // round 5: a real river (about 16-30 m of water, a1's is wide), not a creek: the bridge spans water
      const w = riverWidth(along.s, 12.6, 0.4, 46, s + 61) * widen * neck;
      const px = (x - POND.x) / POND.rx;
      const pz = (z - POND.z) / POND.rz;
      const pr = Math.sqrt(px * px + pz * pz) * (1 + 0.22 * fbm(x / 14, z / 14, s + 62, 3));
      // metres: scale the ellipse parameter by the local radius (the old min(rx, rz) understated the x extent 1.7x: a 12 m sand shore)
      const prad = Math.sqrt(px * px * POND.rx * POND.rx + pz * pz * POND.rz * POND.rz) / Math.sqrt(px * px + pz * pz + 1e-6);
      return Math.min(d - w, (pr - 1) * Math.min(prad, POND.rx));
    });

    // --- roads: a tangle of wandering tracks (indices are referenced below) ----------------------------------------------
    const R = { north: 0, east: 1, south: 2, west: 3, ne: 4, autumn: 5, farm: 6, orchard: 7, loop: 8, nw: 9, pond: 10, meadow: 11, ruins: 12 } as const;
    const roads: RoadSpec[] = [
      { pts: [[0, -17], [4, -58], [-4, -92], [-14, -124], [-8, -152], [gateRim.x, gateRim.z + 7]], width: [4, 7.6], wander: 8.5, wavelength: 30 },
      { pts: [[17, 1], [58, -2], [86, 8], [120, 12], [150, 26], [170, 36]], width: [3.8, 7.2], wander: 7, wavelength: 32, endClearing: [0, 9] },
      { pts: [[1, 17], [-3, 60], [6, 92], [-2, 126], [14, 160]], width: [3.8, 7], wander: 7, wavelength: 34, endClearing: [0, 8] },
      { pts: [[-17, 1], [-60, 5], [-92, 4], [-124, 6], [-150, 22], [-165, 38]], width: [3.6, 6.6], wander: 6, wavelength: 34, endClearing: [0, 8] },
      { pts: [[11, -14], [44, -44], [66, -72], [84, -90], [98, -98]], width: [3.4, 5.2], wander: 3.5, wavelength: 34, endClearing: [0, 6] },
      { pts: [[66, -72], [57, -92], [56, -116], [41, -129], [18, -131], [-6, -126]], width: [3, 4.4], wander: 3, wavelength: 30, endClearing: [0, 6] },
      { pts: [[6, 92], [36, 106], [62, 114], [88, 120]], width: [3.4, 5.2], wander: 3.5, wavelength: 34, endClearing: [0, 8] },
      { pts: [[86, 8], [100, 26], [110, 38]], width: [3.2, 4.8], wander: 2.5, wavelength: 30 },
      { pts: [[88, 120], [106, 104], [122, 86], [118, 73]], width: [3, 4.4], wander: 3, wavelength: 30 },
      { pts: [[-4, -92], [-30, -101], [-60, -104], [-86, -100], [-106, -96], [-128, -92], [-146, -76]], width: [3.2, 4.8], wander: 3.5, wavelength: 34, endClearing: [0, 8] },
      { pts: [[-60, 5], [-68, 30], [-73, 52], [-76, 64]], width: [3, 4.4], wander: 3, wavelength: 30, endClearing: [0, 7] },
      { pts: [[-3, 60], [-12, 74], [-20, 82]], width: [3.2, 4.8], wander: 2.5, wavelength: 28 },
      { pts: [[-124, 6], [-131, 30], [-128, 50]], width: [3, 4.2], wander: 2, wavelength: 26, endClearing: [0, 9] },
    ];
    const net = roadNetwork({ roads, seed: s + 501, junctionClearing: 3.2, wear: 1.4, fringe: 2.4, edgeNoise: 0.7 });
    const rs = roadSample();
    const rp: RoadPoint = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };

    // --- relief: internal granite spines (passes where a road crosses) + the hill shrine plateau ---------------------------
    const ridges: Relief[] = RIDGES.map((def, i) => {
      const spine = new Path2(smoothCurve(def.pts, 3));
      const o = { s: 0 };
      const passes: Array<{ at: number; width: number }> = [];
      for (const c of net.centres) {
        for (const p of c) {
          if (spine.nearest(p[0], p[1], o) < 2 && !passes.some((q) => Math.abs(q.at - o.s) < 14)) passes.push({ at: o.s, width: 11 });
        }
      }
      return ridge({ pts: def.pts, height: def.h, width: def.w, steep: 0.86, passes, seed: s + 201 + i * 13 });
    });
    const shrineRamp = unit(-0.8, 0.6);
    const shrine = plateau({ centre: [SHRINE.x, SHRINE.z], radius: SHRINE.r, wobble: 2.4, height: SHRINE.h, edge: 4.6, ramps: [{ dir: shrineRamp, width: 7.5 }], rampGrade: 0.38, seed: s + 301 });

    // --- plains -------------------------------------------------------------------------------------------------------
    const plains = (x: number, z: number, r: number): number => {
      const k = lerp(0.28, 1, smoothstep(24, 100, r)) * (1 + 0.5 * smoothstep(110, 175, r));
      let h = (2.7 * fbm(x / 118, z / 118, s + 11, 3) + 0.75 * fbm(x / 36, z / 36, s + 12, 2)) * k + 0.9 * smoothstep(30, 90, r);
      for (const kn of KNOLLS) {
        const dx = x - kn.x;
        const dz = z - kn.z;
        if (dx * dx + dz * dz < kn.r * kn.r) h += kn.h * bump(Math.sqrt(dx * dx + dz * dz), kn.r);
      }
      return smax(h, L + 0.9, 0.6);
    };
    /** plains + the flat centre */
    const ground0 = (x: number, z: number, r: number): number => {
      const h = plains(x, z, r);
      const cw = 1 - smoothstep(20, 46, r);
      return cw > 0 ? lerp(h, 0, cw) : h;
    };
    const valleyH = (x: number, z: number): number => VALLEY + 0.14 * fbm(x / 25, z / 25, s + 63, 2);

    // --- bridges: found where a road crosses the river ------------------------------------------------------------------
    const bridges: Bridge[] = [];
    const crossing = (road: number, kind: 'stone' | 'wood', width: number): void => {
      const len = net.lengths[road] as number;
      let a = -1;
      let b = -1;
      for (let sPos = 0; sPos <= len; sPos += 1) {
        net.pointAt(road, sPos, rp);
        if (riverDe.at(rp.x, rp.z) < 0.5) {
          if (a < 0) a = sPos;
          b = sPos;
        }
      }
      if (a < 0) return;
      net.pointAt(road, Math.max(0, a - 3.5), rp);
      const x0 = rp.x;
      const z0 = rp.z;
      net.pointAt(road, Math.min(len, b + 3.5), rp);
      const yEnd = VALLEY + 0.2;
      bridges.push({ kind, x0, z0, x1: rp.x, z1: rp.z, width, yEnd, yMid: yEnd + (kind === 'stone' ? 2.1 : 1.0) });
    };
    crossing(R.west, 'stone', 5.2);
    crossing(R.nw, 'wood', 5);

    // --- village layout (shared by heights, paint and scatter) ----------------------------------------------------------
    // round 5: the halls stand round the plaza (an arc from the NW over the north road to the NE and the east street), 26-39 m out
    // (the two flanking halls stand just outside the plaza disc, so the wide plaza frame has a hall roof in each top corner)
    const halls: Spot[] = [spot(15, -30, -0.3, 0.95), spot(21, -12.5, -0.86, 0.5), spot(-20.5, -11.5, 0.87, 0.5)];
    const houses: Spot[] = [];
    /** a building beside road `road` at arc length sPos and lateral offset off (+ = left of travel), its front towards the road */
    const beside = (road: number, sPos: number, off: number, yawJit: number): Spot => {
      net.along(road, sPos, off, rp);
      const nx = rp.tz;
      const nz = -rp.tx;
      const sg = off >= 0 ? 1 : -1;
      const fx = -nx * sg;
      const fz = -nz * sg;
      const c = dcos(yawJit);
      const sn = dsin(yawJit);
      return spot(rp.x, rp.z, fx * c - fz * sn, fx * sn + fz * c);
    };
    // the east street: irregular spacing, both sides, jittered yaw (a hamlet, not a row)
    for (const [sPos, off, jit] of [[36, 12, 0.18], [46, -12.5, -0.24], [58, 13, 0.3], [70, -10.5, 0.12], [86, 12, -0.2], [94, -13.5, 0.26]] as const) houses.push(beside(R.east, sPos, off, jit));
    // two small houses on the south side of the plaza (the village rings it: halls north, houses south)
    houses.push(spot(17.5, 17, -0.4, -0.92));
    houses.push(spot(-15, 20, 0.33, -0.94));
    houses.push(spot(-33, 17, 0.88, -0.47));
    houses.push(spot(-24, 40, 0.4, -0.92));
    const farmHouses: Spot[] = [spot(40, 116, 0.7, -0.7), spot(56, 132, 0.2, -0.98)];
    const gateNorth = ((): Spot => {
      net.pointAt(R.north, 34, rp);
      return spot(rp.x, rp.z, -rp.tx, -rp.tz);
    })();

    const pads: Pad[] = [];
    const addPad = (x: number, z: number, r0: number, r1: number): void => {
      pads.push({ x, z, r0, r1, y: ground0(x, z, Math.sqrt(x * x + z * z)) });
    };
    for (const h of halls) addPad(h.x, h.z, 9.5, 16);
    for (const h of houses) addPad(h.x, h.z, 5.5, 10.5);
    for (const h of farmHouses) addPad(h.x, h.z, 5.5, 10.5);
    addPad(gateNorth.x, gateNorth.z, 8, 13);
    addPad(gateRim.x, gateRim.z, 8, 14);
    for (const b of BOSSES) addPad(b.x, b.z, b.r + 1, b.r + 15);

    // --- height ---------------------------------------------------------------------------------------------------------
    const rimRise = (x: number, z: number, u: number, c: number, crest: number): number => {
      if (u < -12) return 0;
      // gullies cut back into the sheer sections (the foot only ever moves outwards, so no walkable ground is lost)
      const gully = c * 4 * ridged(x / 13, z / 13, s + 26, 2);
      const uu = u + 3.5 * fbm(x / 17, z / 17, s + 22, 2) - gully;
      const wc = smoothstep(-5, 7, uu);
      const wf = smoothstep(-9, 16, uu);
      const cr = ridged(x / 24, z / 24, s + 23, 2);
      let rise = lerp(crest * 0.55 * wf, crest * wc, c) * (0.9 + 0.2 * cr);
      // strata benches: the sheer sections climb in ledges instead of one smooth curtain
      if (c > 0.05 && rise > 1.5) rise = lerp(rise, terrace(rise, 6.5 + 2 * cr, 0.45), c * 0.8);
      rise += c * wc * 1.3 * fbm(x / 8, z / 8, s + 24, 2);
      // fine chiselled relief on the sheer faces so a wall is never a few big flat planes
      rise += c * wc * smoothstep(1.5, 6, rise) * 1.1 * (ridged(x / 4.2, z / 4.2, s + 27, 2) - 0.45);
      if (u > 10) {
        rise += smoothstep(10, 120, u) * 62;
        rise += smoothstep(16, 90, u) * 40 * ridged(x / 64, z / 64, s + 25, 3);
      }
      return rise;
    };

    const height = (x: number, z: number): number => {
      const r = Math.sqrt(x * x + z * z);
      const rsm = rim.sample(pseudoAngle(x, z));
      const u = r - rsm.R;
      let h: number;
      if (u > 46) {
        h = 1.2 + 0.4 * fbm(x / 70, z / 70, s + 13, 2);
      } else {
        h = ground0(x, z, r);
        for (let i = 0; i < ridges.length; i++) h += (ridges[i] as Relief).height(x, z);
        h += shrine.height(x, z);
        const de = riverDe.at(x, z);
        if (de < 46) {
          const dc = de > 0 ? de : 0;
          h = lerp(h, valleyH(x, z), 1 - smoothstep(5, 46, dc));
          h -= riverProfile(Math.max(0, RIVER_WC + de), RIVER_WC, 4.5, 3.6, 2.8);
          const fx = x - FORD.x;
          const fz = z - FORD.z;
          if (fx * fx + fz * fz < 169) h = lerp(h, Math.max(h, L - 0.5), 1 - smoothstep(7, 13, Math.sqrt(fx * fx + fz * fz)));
          for (const b of bridges) {
            // the bake raises the deck; the ground only has to meet yEnd at both ends
            for (const [ex, ez] of [[b.x0, b.z0], [b.x1, b.z1]] as const) {
              const bx = x - ex;
              const bz = z - ez;
              if (bx * bx + bz * bz < 64) h = lerp(h, b.yEnd, 1 - smoothstep(3, 8, Math.sqrt(bx * bx + bz * bz)));
            }
          }
        }
        net.sample(x, z, rs);
        h -= 0.1 * rs.road;
        for (const p of pads) {
          const dx = x - p.x;
          const dz = z - p.z;
          if (dx * dx + dz * dz < p.r1 * p.r1) h = lerp(h, p.y, 1 - smoothstep(p.r0, p.r1, Math.sqrt(dx * dx + dz * dz)));
        }
        if (u > 30) h = lerp(h, 1.2 + 0.4 * fbm(x / 70, z / 70, s + 13, 2), smoothstep(30, 46, u));
      }
      return h + rimRise(x, z, u, rsm.cliff, rsm.crest);
    };

    // --- landmarks ------------------------------------------------------------------------------------------------------
    const landmarks: Landmark[] = [
      { id: 'centre', kind: 'centre', x: 0, z: 0, r: CENTRE_R },
      { id: 'spawn', kind: 'spawn', x: 0, z: 0, r: 10 },
      { id: 'plaza', kind: 'poi', x: 0, z: 0, r: PLAZA_R },
      { id: 'gate_north', kind: 'poi', x: gateNorth.x, z: gateNorth.z, r: 9, yaw: gateNorth.yaw },
      { id: 'gate_rim', kind: 'poi', x: gateRim.x, z: gateRim.z, r: 10, yaw: 0 },
      ...bridges.map((b, i): Landmark => ({ id: i === 0 ? 'bridge' : 'bridge_wood', kind: 'poi', x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, r: i === 0 ? 14 : 12, yaw: HALF_PI })),
      { id: FORD.id, kind: 'poi', x: FORD.x, z: FORD.z, r: 11 },
      { id: 'hill_shrine', kind: 'poi', x: SHRINE.x, z: SHRINE.z, r: 14, yaw: yawToward(-shrineRamp[0], -shrineRamp[1]) },
      { id: 'grove_pine', kind: 'poi', x: -140, z: 8, r: 26 },
      { id: 'hamlet_east', kind: 'poi', x: 84, z: 6, r: 22 },
      { id: 'terraces', kind: 'poi', x: FARM.x, z: FARM.z, r: 34 },
      ...BOSSES.map((b): Landmark => ({ id: b.id, kind: 'boss', x: b.x, z: b.z, r: b.r })),
    ];

    const stream: Stream = { pts: RIVER_CTRL, halfWidth: 7.5, speed: 1.1 };

    // --- ground paint ---------------------------------------------------------------------------------------------------
    const yards = [...halls.map((h) => ({ x: h.x, z: h.z, r: 9 })), ...houses.map((h) => ({ x: h.x, z: h.z, r: 5.5 })), ...farmHouses.map((h) => ({ x: h.x, z: h.z, r: 6 }))];

    const paint = (x: number, z: number, h: number, slope: number, out: Float32Array): void => {
      const r = Math.sqrt(x * x + z * z);
      const n1 = fbm(x / 58, z / 58, s + 31, 2);
      const n2 = fbm(x / 21, z / 21, s + 32, 2);
      const n3 = fbm(x / 44, z / 44, s + 34, 2);
      // large soft tonal patches (30-60 m): lawn, darker lawn, tan dry ground
      let wGrass = 1;
      // (round 4: the dark-lawn and tan-field patches are fewer and softer: the lit lawn stays one olive, no cloudy blotches)
      // (round 5: layer 1 is the tree SHADE layer, painted from the crown outlines below; the lawn itself stays one olive)
      let wDark = 0;
      let wField = smoothstep(0.48, 0.78, n3) * 0.34 + smoothstep(0.74, 0.94, n2 + 0.3 * n1) * 0.12;
      for (const b of BOSSES) {
        const bd = dist(x, z, b.x, b.z);
        if (bd < b.r + 14) wField *= smoothstep(b.r - 4, b.r + 14, bd);
      }
      let wRoad = 0;
      let wSand = 0;
      let wRock = 0;
      let wRub = 0;

      // the village ground: a wide beaten-earth blot round the plaza, soft and uneven at the edge
      const vg = 1 - smoothstep(21, 44, r + 11 * fbm(x / 38, z / 38, s + 35, 2));
      // YA-02: the lawn comes in to the plaza (audit-A target yeonmu_plaza): ragged lawn tongues reach the kerb and fill the first ~30 m round
      // it, the beaten earth keeps the halls' yards and the roads (never an even green ring: the tongue noise opens and closes it)
      const lawnRing = smoothstep(PLAZA_R, PLAZA_R + 3, r) * (1 - smoothstep(PLAZA_R + 18, PLAZA_R + 36, r));
      wRoad += vg * 4.6 * (1 - 0.85 * lawnRing);
      wField += vg * 0.9 * (1 - 0.85 * lawnRing);
      // grass tongues creep into the village ground (never one flat earth field) and darker olive-brown clouds break up the rest
      const n5 = fbm(x / 30, z / 30, s + 38, 2);
      const n6 = fbm(x / 41, z / 41, s + 39, 2);
      wGrass += vg * 3.2 * smoothstep(0.38, 0.62, n5);
      const earthCloud = smoothstep(0.34, 0.66, n6);
      const nLawn = (fbm(x / 9, z / 9, s + 48, 2) + 0.35 * fbm(x / 3.6, z / 3.6, s + 49, 2)) / 1.35;
      wGrass += lawnRing * 20 * smoothstep(-0.3, 0.1, nLawn);
      for (const yd of yards) {
        const dx = x - yd.x;
        const dz = z - yd.z;
        if (dx * dx + dz * dz < (yd.r + 6) * (yd.r + 6)) wRoad += 3 * (1 - smoothstep(yd.r - 2, yd.r + 4, Math.sqrt(dx * dx + dz * dz) + 1.8 * n2));
      }

      // river: sandy shelf and beach, wet dark lawn behind it
      const de = riverDe.at(x, z);
      let nearWater = 0;
      if (de < 28) {
        nearWater = (1 - smoothstep(L + 0.35, L + 1.3, h)) * (1 - smoothstep(0, 4, de));
        // the beach is the wet shelf at the waterline (by height, not by distance: the valley floor beside the river is lawn)
        wSand += ((1 - smoothstep(L + 0.02, L + 0.26 + 0.1 * n2, h)) + nearWater * smoothstep(0.18, 0.45, slope)) * (1 - smoothstep(-2.6, 0.2, de + 0.6 * n2)) * 9;
      }

      // farm district: plots of tilled earth / lawn / dry field with thin bunds, soft at the edge
      let farmM = 0;
      const fdx = x - FARM.x;
      const fdz = z - FARM.z;
      if (fdx * fdx + fdz * fdz < (FARM.hu + 10) * (FARM.hu + 10)) {
        // plot grid warped by noise: irregular outlines, not a chessboard
        const fu = fdx * FARM.c + fdz * FARM.sn + 3.2 * fbm(x / 19, z / 19, s + 36, 2);
        const fv = -fdx * FARM.sn + fdz * FARM.c + 3.2 * fbm(x / 19, z / 19, s + 37, 2);
        farmM = (1 - smoothstep(0.78, 1, Math.abs(fu) / FARM.hu)) * (1 - smoothstep(0.78, 1, Math.abs(fv) / FARM.hv));
        if (farmM > 0) {
          const pu = (fu + FARM.hu) / FARM.pu;
          const pv = (fv + FARM.hv) / FARM.pv;
          const roll = hash2(Math.floor(pu), Math.floor(pv), s);
          const bund = 1 - smoothstep(0.25, 0.8, Math.min(Math.abs(pu - Math.floor(pu + 0.5)) * FARM.pu, Math.abs(pv - Math.floor(pv + 0.5)) * FARM.pv));
          const fm = farmM * farmM;
          const k = 6 * fm;
          if (roll < 0.26) wField += k;
          else if (roll < 0.62) wGrass += k;
          else if (roll < 0.8) wRoad += k * 0.5;
          else {
            wGrass += k * 0.7;
            wField += k * 0.3;
          }
          wRoad += bund * 2.2 * fm;
        }
      }

      // roads: wide pale wandering tracks, worn verge, soft tan fringe
      net.sample(x, z, rs);
      const roadM = rs.road;
      wRoad += roadM * 9 + rs.wear * 1.7;
      wField += rs.fringe * 0.9;

      // plaza: one calm paved disc; the beaten earth creeps into the paving from the rim in ragged tongues (a worn edge, never a ring)
      const pm = 1 - smoothstep(PLAZA_R - 0.16, PLAZA_R + 0.16, r + 0.5 * n2);
      let pWorn = 0;
      // YA-02: and some of the tongues are lawn / moss rather than earth, reaching a little deeper into the paving
      let pMoss = 0;
      if (pm > 0) {
        const n4 = fbm(x / 5, z / 5, s + 44, 2) + 0.3 * fbm(x / 2.2, z / 2.2, s + 45, 2);
        pWorn = smoothstep(0.36, 0.64, n4) * smoothstep(PLAZA_R - 1.7, PLAZA_R - 0.3, r) * 0.8;
        const n8 = fbm(x / 4, z / 4, s + 50, 2) + 0.3 * fbm(x / 1.7, z / 1.7, s + 51, 2);
        pMoss = smoothstep(-0.05, 0.3, n8) * smoothstep(PLAZA_R - 4.0, PLAZA_R - 0.4, r) * smoothstep(-0.2, 0.2, fbm(x / 13, z / 13, s + 52, 2));
      }
      // plaza kerb (settle): a BROKEN course of worn stones on the rim, not a ring: its width wanders 0.9-2.6 m, its centre wobbles, and
      // beaten earth shows through the gaps (the earth tongues above are the same worn edge seen from inside)
      const kn = fbm(x / 6.5, z / 6.5, s + 46, 2);
      const kg = fbm(x / 2.4, z / 2.4, s + 47, 2);
      const kHalf = 0.45 + 0.85 * smoothstep(-0.3, 0.3, kn);
      const kd = Math.abs(r + 0.35 * n2 + 0.5 * kn - (PLAZA_R + 0.5));
      const curb = (1 - smoothstep(kHalf * 0.55, kHalf, kd)) * (1 - roadM);
      const kStone = smoothstep(-0.4, -0.02, kg);
      // rock: steep faces, the granite spines, the plateau risers and the foot of the rim walls
      wRock += smoothstep(0.42, 0.8, slope) * 10 + smoothstep(14, 36, h) * 3;
      for (let i = 0; i < ridges.length; i++) wRock += 6 * (ridges[i] as Relief).cliff(x, z);
      wRock += 6 * shrine.cliff(x, z);
      if (r > 120) {
        const rsm = rim.sample(pseudoAngle(x, z));
        const u = r - rsm.R;
        // round 4: the lawn runs right up to the foot (saturated olive, not greyed over 14 m); only the last 5 m are granite / scree
        wRock += smoothstep(-5.5, -0.5, u) * (0.7 + 0.8 * smoothstep(-0.3, 0.5, n2)) * 2.6;
        wRub += smoothstep(-8, -5, u) * (1 - smoothstep(-4, -1.5, u)) * 0.55;
      }
      // talus on the mid slopes: only on the steep flanks (a pale flagstone strip across a gentle lawn slope read as a paved path)
      wRub += smoothstep(0.3, 0.42, slope) * (1 - smoothstep(0.5, 0.66, slope)) * 1.2;

      // the waterline bank is sand, never granite (steep carved banks read as a hard rock edge)
      wRock *= 1 - 0.95 * nearWater;
      wRub *= 1 - 0.9 * nearWater;
      const keep = (1 - roadM) * (1 - pm) * (1 - Math.min(1, wRock * 0.12));
      out[GRASS] = wGrass * keep;
      out[DARK] = wDark * keep;
      // the tan dry patches are earth (the road tile) in soft clouds on the lawn
      const earthPatch = wField * keep;
      out[ROAD] = wRoad * (1 - pm) + 14 * pm * pWorn * (1 - pMoss) + earthPatch;
      // soft darker earth clouds on the village ground and the roads (shade layer at a partial weight)
      out[SHADE_E] = (wRoad * (1 - pm) + earthPatch) * earthCloud * 0.32;
      out[SAND] = wSand * (1 - pm);
      out[ROCK] = wRock;
      out[RUBBLE] = wRub * (1 - pm);
      // the paving: the medallion disc (and its feather) on the plaza layer, the rest on its twin (layer 1)
      const paving = 14 * pm * (1 - pWorn) * (1 - 0.7 * pMoss);
      const twin = smoothstep(MEDALLION_R + 0.8, MEDALLION_R + 2.2, r);
      out[PLAZA] = paving * (1 - twin);
      out[DARK] = paving * twin;
      out[GRASS] = (out[GRASS] as number) + 10 * pm * pMoss;
      if (curb > 0.01) {
        for (let k = 0; k < out.length; k++) out[k] = (out[k] as number) * (1 - curb);
        out[RUBBLE] = (out[RUBBLE] as number) + 14 * curb * kStone;
        out[ROAD] = (out[ROAD] as number) + 14 * curb * (1 - kStone);
      }
    };

    // --- scatter --------------------------------------------------------------------------------------------------------
    const scatter = (sc: ScatterContext): void => {
      const rng = sc.rng;
      const put = (id: string, x: number, z: number, yaw: number, scale = 1): void => {
        sc.prop(id, x, z, yaw, scale, { force: true });
      };
      // two lamp posts on the plaza rim frame the first screen (placed before the plaza is reserved)
      put('lamp_post', 14.2, -6.8, 0.1);
      put('lamp_post', -13.4, 8.4, -0.2);
      sc.occupy(0, 0, PLAZA_R + 1);
      /**
       * One pale boulder group: a big stone with 0-3 smaller ones against it. Every stone has its own shape (boulder or flat slab),
       * proportions, size, yaw and tilt, so a group is never a mirrored pair or one mesh repeated. The footprint used for the free
       * check is the stone's rough radius; the visible extents are set afterwards.
       */
      const rockGroup = (x: number, z: number, size: number, n: number): void => {
        let a = rng.next() * 6.28;
        // the four generated boulder variants are dealt out so no two stones of one group share a mesh
        const v0 = rng.int(4);
        // each new stone leans against the previous one (a chain, never a ring round the big stone), its size a random fraction of it
        let px = x;
        let pz = z;
        let prev = size;
        for (let i = 0; i < n; i++) {
          const big = i === 0;
          const q = big ? size : Math.max(0.6, prev * (i === 1 ? 0.5 + rng.next() * 0.34 : 0.42 + rng.next() * 0.3));
          let sx = x;
          let sz = z;
          if (!big) {
            a += 1.2 + rng.next() * 2.4;
            const d = prev * (0.85 + rng.next() * 0.35) + q * 0.55;
            sx = px + dcos(a) * d;
            sz = pz + dsin(a) * d;
          }
          // a flat slab only for stones of some size (a small slab reads as a white cube chip)
          const kind: RockKind = !big && q > 1.0 && rng.next() < 0.3 ? 'slab' : 'boulder';
          const asp = ROCK_ASPECT[kind] as readonly [number, number, number];
          const p = sc.rock(kind, sx, sz, q * 1.15, q * 0.8, q * 1.15, 0, { force: true, sink: q * 0.12 });
          if (!p) continue;
          p.sx = q * asp[0] * (0.7 + rng.next() * 0.8);
          p.sy = q * asp[1] * (0.55 + rng.next() * 0.7);
          p.sz = q * asp[2] * (0.7 + rng.next() * 0.7);
          p.tiltX = (rng.next() - 0.5) * 0.4;
          p.tiltZ = (rng.next() - 0.5) * 0.4;
          p.seed = rng.int(16384) * 4 + ((v0 + i) % 4);
          sc.updateRock(p);
          if (i < 2) {
            px = sx;
            pz = sz;
            prev = q;
          }
        }
      };
      // a frame tree + (the rust crowns: a group of three, every third beech: a pair) pale boulders at its foot, as in the a1 reference
      let frameN = 0;
      const frameTree = (species: TreeSpecies, x: number, z: number, scale: number): void => {
        const t = sc.tree(species, x, z, scale, 1.5, { margin: 5 });
        frameN++;
        if (!t || (species !== 'autumn' && frameN % 3 !== 0)) return;
        const a = rng.next() * 6.28;
        const d = 3.0 * scale + rng.next() * 1.3;
        const rust = species === 'autumn';
        rockGroup(x + dcos(a) * d, z + dsin(a) * d, rust ? 1.25 + rng.next() * 0.6 : 0.85 + rng.next() * 0.5, rust ? 3 : 2);
      };
      // the boss-arena spots (and rimcliff, next to the ruins arena) get their frame trees before the arenas are reserved (a few trunks on the arena edge, 11-12 m out)
      for (const name of ['meadow', 'orchard', 'rimcliff']) {
        const at = SPOT_AT[name] as [number, number];
        for (const [species, dx, dz, sc2] of FRAME_TREES[name] as Array<[TreeSpecies, number, number, number]>) frameTree(species, at[0] + dx, at[1] + dz, sc2);
      }
      for (const b of BOSSES) sc.occupy(b.x, b.z, b.id === 'boss_orchard' ? b.r - 1 : b.r + 3);
      const lanes = net.lanes(3.6);

      // gates: the north gate across the trunk road, the rim gate at the notch
      gatePair(sc, { x: gateNorth.x, z: gateNorth.z, seed: s + 1201, dir: [gateNorth.fx, gateNorth.fz], width: 7, prop: 'pagoda_gate' });
      put('pagoda_gate', gateRim.x, gateRim.z, gateRim.yaw);
      // the gate stands between two boulder groups of different size (no wall chain, never a mirrored pair)
      for (const [sg, size, n, back] of [[-1, 2.3, 3, 2.5], [1, 1.35, 1, 0.5]] as const) {
        const lx = gateNorth.fz * sg;
        const lz = -gateNorth.fx * sg;
        rockGroup(gateNorth.x + lx * 9.8 - gateNorth.fx * back, gateNorth.z + lz * 9.8 - gateNorth.fz * back, size, n);
      }

      // buildings
      for (const h of halls) put('hall_tiled', h.x, h.z, h.yaw);
      for (const h of houses) put('house_small', h.x, h.z, h.yaw);
      for (const h of farmHouses) put('house_small', h.x, h.z, h.yaw);

      // stone lights in front of the halls (a pair at the first, singles at the others), urns on the steps' flanks
      halls.forEach((h, i) => {
        const { fx, fz } = h;
        const sides = i === 0 ? [-1, 1] : [i % 2 === 0 ? 1 : -1];
        for (const sg of sides) {
          // r8 Z8: same draws as before; a light whose spot lies in a neighbouring hall (hall 0's right light stood 1.2 m into hall 1's
          // plinth and was dropped in every run) moves in towards the stair axis (5.4 m) instead of vanishing
          const j1 = rng.next();
          const j2 = rng.next();
          const yaw = h.yaw + (rng.next() - 0.5) * 0.3;
          // r8 ship (Z8 critic, s15): no 3.4 m fallback (it stood the light on the stair front where the hero stands): such a light is dropped
          for (const [ox, oz] of [[7.4 + j1, 7.4 + j2], [5.4 + j1, 5.4 + j2]] as const) {
            const lx = h.x + fx * 9.4 + fz * sg * ox;
            const lz = h.z + fz * 9.4 - fx * sg * oz;
            if (!sc.fits('stone_lantern', lx, lz, 1, { force: true })) continue;
            sc.prop('stone_lantern', lx, lz, yaw, 1, { force: true });
            break;
          }
        }
        if (i !== 1) for (const sg of [-1, 1]) put('urn', h.x + fx * 8 + fz * sg * (4.4 + rng.next() * 0.6), h.z + fz * 8 - fx * sg * (4.4 + rng.next() * 0.6), rng.next() * 6.28);
      });
      put('banner_pole', (halls[1] as Spot).x + 6.5, (halls[1] as Spot).z + 9.5, 0.4);
      // stone lights flanking every road where it leaves the plaza. r8 Z8: not the NE road: it leaves between halls 0 and 1, whose
      // r6 13 x 9 m plinths cover both lantern spots (footprints 0.8 / 1.2 m into the plinth; the pair was dropped in every run)
      for (const road of [R.north, R.east, R.south, R.west]) {
        net.pointAt(road, 4, rp);
        gatePair(sc, { x: rp.x, z: rp.z, seed: s + 1210 + road, dir: [rp.tx, rp.tz], width: rp.hw * 2 + 1.2, prop: 'stone_lantern' });
      }

      // a lamp post at the plaza edge facing each hall cluster. r8 Z8: the east one (24, -8) stood 1.2 m inside hall 1's plinth and was
      // dropped in every run; the plaza-rim lamp at (14.2, -6.8) faces that hall
      put('lamp_post', -9, -19, 0.3);

      // irregular rows of lights along the trunk roads (alternating sides, never fence posts)
      avenue(sc, { pts: net.centres[R.east] as Vec2[], prop: 'lamp_post', spacing: [15, 24], offset: 5, skip: 0.12, seed: s + 1301, start: 30, end: 96 });
      avenue(sc, { pts: net.centres[R.north] as Vec2[], prop: 'stone_lantern', spacing: [13, 20], offset: 5.4, skip: 0.15, seed: s + 1302, start: 40, end: 120 });
      avenue(sc, { pts: net.centres[R.south] as Vec2[], prop: 'stone_lantern', spacing: [16, 24], offset: 5.2, skip: 0.2, seed: s + 1303, start: 32, end: 78 });
      avenue(sc, { pts: net.centres[R.west] as Vec2[], prop: 'stone_lantern', spacing: [16, 24], offset: 5.2, skip: 0.2, seed: s + 1304, start: 32, end: 80 });

      // wells, signposts at the junctions
      put('well', -14, -52, 0.5);
      put('well', 46, 99, 1.2);
      net.pointAt(R.north, 52, rp);
      put('signpost', rp.x + rp.tz * 4.6, rp.z - rp.tx * 4.6, 0.4);
      net.pointAt(R.east, 74, rp);
      put('signpost', rp.x - rp.tz * 4.6, rp.z + rp.tx * 4.6, -0.5);
      net.pointAt(R.south, 66, rp);
      put('signpost', rp.x + rp.tz * 4.6, rp.z - rp.tx * 4.6, 0.8);
      net.pointAt(R.west, 40, rp);
      put('signpost', rp.x - rp.tz * 4.6, rp.z + rp.tx * 4.6, -0.2);

      // hamlet clutter beside the east street: fenced yards behind the houses, hay, a few crates
      {
        const a = beside(R.east, 61, -24, 0.2);
        fencedYard(sc, { x: a.x, z: a.z, seed: s + 1401, size: [15, 13], dir: [a.fx, a.fz], house: '', tree: 'broadleaf' });
        const b = beside(R.east, 84, 24, -0.15);
        hayYard(sc, { x: b.x, z: b.z, seed: s + 1402, radius: 8, dir: [b.fx, b.fz] });
        for (const h of houses.slice(0, 6)) {
          const sg = rng.next() < 0.5 ? 1 : -1;
          const id = rng.next() < 0.5 ? 'barrel' : 'crate';
          // r8 Z8: 4.6 -> 5.4 m beside the house (the r7 house clearance, radius 5, swallowed the crate at 4.6-5.0 m)
          put(id, h.x + h.fz * sg * (5.4 + rng.next()), h.z - h.fx * sg * (5.4 + rng.next()), rng.next() * 6.28);
        }
      }
      // farm: two fenced yards, a hay yard and loose stacks at the field edge
      fencedYard(sc, { x: 62, z: 138, seed: s + 1411, size: [16, 13], dir: [0.1, -0.99], house: 'house_small', tree: 'autumn' });
      fencedYard(sc, { x: 90, z: 128, seed: s + 1412, size: [16, 11], dir: [-0.2, -0.97], house: '' });
      hayYard(sc, { x: 100, z: 108, seed: s + 1413, radius: 8, dir: [-0.5, 0.86] });
      hayYard(sc, { x: 68, z: 106, seed: s + 1415, radius: 7, dir: [0.4, 0.9] });
      clumpProps(sc, { cx: FARM.x, cz: FARM.z, radius: 56, spacing: 12, ids: ['haystack', 'haystack', 'crate'], max: 6, lanes, seed: s + 1414, keep: (x, z) => riverDe.at(x, z) > 20 });

      // hill shrine: a ring of stone lights on the plateau, the pagoda gate on the ramp, the stele in the middle
      pillarRing(sc, { x: SHRINE.x, z: SHRINE.z, seed: s + 1421, radius: SHRINE.r - 4.5, count: 8, prop: 'stone_lantern', scale: [0.95, 1.1], gapDir: shrineRamp, gapWidth: 8, gate: 'pagoda_gate', missing: 0.12 });
      put('stele', SHRINE.x - shrineRamp[0] * 2, SHRINE.z - shrineRamp[1] * 2, yawToward(shrineRamp[0], shrineRamp[1]));

      // west bank: a ruined court away from the boss arena; north: a ring of standing stones off the arena
      ruinCourt(sc, { x: -146, z: -18, seed: s + 1431, size: [18, 14], dir: [0.97, 0.2], focal: 'stele', decay: 0.55 });
      standingStoneRing(sc, { x: -30, z: -154, seed: s + 1432, radius: 9, count: 8, size: [2.4, 4.2], gapDir: [0.2, 0.98], gapWidth: 7, focal: 'stele' });

      // the gameplay frame of every hero spot gets its own big trees (placed first, so the groves below grow round them)
      for (const [name, list] of Object.entries(FRAME_TREES)) {
        if (name === 'meadow' || name === 'orchard' || name === 'rimcliff') continue;
        const at = SPOT_AT[name] as [number, number];
        for (const [species, dx, dz, sc2] of list) frameTree(species, at[0] + dx, at[1] + dz, sc2);
      }
      // the QA spots stay clear of the loose boulders and trees below (r8 Z8: hero-spot reservations)
      for (const [sx, sz] of SPOTS) sc.reserveSpot(sx, sz, 6.5);

      // --- rim: outcrops roughen the cliff faces, a pale boulder skirt at the foot -------------------------------------
      const rimXY = (a: number, u: number): [number, number] => {
        const d: [number, number] = [0, 0];
        pseudoDir(a, d);
        const rr = rim.sample(a).R + u;
        return [d[0] * rr, d[1] * rr];
      };
      // Round 4: ONE unbroken granite wall. Two rows of outcrops run all round the rim, each stone lying along the rim tangent and
      // overlapping its neighbours by about half (the free check sees a small footprint, the visible extents are set afterwards),
      // the back row taller than the front row so no gap and no isolated monolith shows. Heights vary along the wall.
      const tan: [number, number] = [0, 0];
      const rimRow = (u0: number, uSpan: number, w: [number, number], h: [number, number], dep: [number, number], stepK: number, kind: RockKind = 'outcrop', alt?: { kind: RockKind; share: number }): void => {
        let a = rng.next() * 0.03;
        while (a < 4) {
          const smp = rim.sample(a);
          const wd = rng.range(w[0], w[1]);
          const [x, z] = rimXY(a, u0 + rng.next() * uSpan);
          const step = (wd * stepK) / (1.5708 * smp.R);
          if (dist(x, z, gateRim.x, gateRim.z) > 9) {
            const sheer = smp.cliff > 0.5;
            const hh = rng.range(h[0], h[1]) * (sheer ? 1 : 0.5);
            // (a hash, not the rng: the layout after the rim stays what it was) part of the squared ledge blocks are outcrop lumps
            const kd = alt && hash2(Math.floor(a * 4096), 95, s) < alt.share ? alt.kind : kind;
            const p = sc.rock(kd, x, z, 3, hh, 3, 0, { force: true, sink: hh * 0.45 });
            if (p) {
              const [x0, z0] = rimXY(a - 0.005, 0);
              const [x1, z1] = rimXY(a + 0.005, 0);
              const [tx, tz] = unit(x1 - x0, z1 - z0);
              tan[0] = tx;
              tan[1] = tz;
              p.sx = wd * (sheer ? 1 : 0.7);
              p.sz = rng.range(dep[0], dep[1]);
              p.yaw = yawToward(-tz, tx) + (rng.next() - 0.5) * 0.5;
              p.tiltX = (rng.next() - 0.5) * 0.1;
              p.tiltZ = (rng.next() - 0.5) * 0.1;
              sc.updateRock(p);
            }
          }
          a += step;
        }
      };
      // A2: the front row is squared 'ledge' blocks (near-vertical faces, strata steps), the taller back row stays outcrop lumps
      rimRow(-4.5, 2.5, [8, 15], [4.5, 10], [5, 8], 0.52, 'ledge', { kind: 'outcrop', share: 0.4 });
      rimRow(-0.5, 3.5, [10, 19], [11, 19], [6, 10], 0.56);
      // pale scree boulders at the foot: groups of different size along the whole wall, irregular spacing (a1: white boulders at the grey cliff foot)
      {
        let a = rng.next() * 0.1;
        while (a < 4) {
          const smp = rim.sample(a);
          const [x, z] = rimXY(a, -rng.range(4.5, 11));
          const big = rng.next() < 0.25;
          rockGroup(x, z, big ? rng.range(2.3, 3.5) : rng.range(0.9, 2.0), big ? 2 + rng.int(3) : 1 + rng.int(3));
          a += rng.range(7, 21) / (1.5708 * smp.R);
        }
      }
      // boulders at the feet of the internal spines
      for (let i = 0; i < RIDGES.length; i++) {
        const def = RIDGES[i] as (typeof RIDGES)[number];
        const rg = ridges[i] as Relief;
        const mid = def.pts[Math.floor(def.pts.length / 2)] as Vec2;
        clumpRocks(sc, { cx: mid[0], cz: mid[1], radius: 52, spacing: 3.8, kind: 'boulder', size: [0.9, 2.8], max: 12, seed: s + 1510 + i, lanes, keep: (x, z) => rg.height(x, z) < 1.8 && rg.distance(x, z) < def.w * 1.35 && rg.distance(x, z) > def.w * 0.5 });
      }

      // placement filter shared by trees and loose rocks: off the roads, plaza, yards, farm, bosses and the river
      const landOk = (x: number, z: number, pad = 0): boolean => {
        if (x * x + z * z < 24 * 24 || riverDe.at(x, z) < 7) return false;
        if (net.distance(x, z) < 6.5) return false;
        for (const b of BOSSES) if (dist(x, z, b.x, b.z) < b.r + 4 + pad) return false;
        if (dist(x, z, SHRINE.x, SHRINE.z) < SHRINE.r + 12) return false;
        for (const yd of yards) if (dist(x, z, yd.x, yd.z) < yd.r + 2) return false;
        const fdx = x - FARM.x;
        const fdz = z - FARM.z;
        const fu = Math.abs(fdx * FARM.c + fdz * FARM.sn);
        const fv = Math.abs(-fdx * FARM.sn + fdz * FARM.c);
        return !(fu < FARM.hu * 0.8 && fv < FARM.hv * 0.8);
      };
      // loose boulder clusters on the open plain
      clumpRocks(sc, { cx: 0, cz: 0, radius: 170, spacing: 6, patch: { scale: 26, lo: 0.86, hi: 1 }, kind: 'boulder', size: [0.8, 2.4], max: 36, seed: s + 1520, lanes, keep: (x, z) => landOk(x, z, 4) && sc.insideBy(x, z) > 20 });
      // river stones: sparse, rounded, never near a crossing
      clumpRocks(sc, {
        cx: -104, cz: -10, radius: 150, spacing: 9, kind: 'boulder', size: [0.5, 1.5], max: 22, seed: s + 1521, free: { anySurface: true },
        keep: (x, z) => {
          const de = riverDe.at(x, z);
          return de > 1 && de < 6 && dist(x, z, FORD.x, FORD.z) > 16 && !bridges.some((b) => dist(x, z, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) < 18);
        },
      });

      // --- trees: sparse and BIG, in groves with empty lanes -------------------------------------------------------------
      // the autumn grove: rust-orange crowns among beeches (the three in the frame of the autumn spot are FRAME_TREES), north-east
      clumpTrees(sc, { cx: 56, cz: -118, radius: 26, spacing: 12, species: ['autumn', 'broadleaf', 'broadleaf'], scale: [1.55, 2.1], max: 5, lanes, seed: s + 1601, keep: (x, z) => landOk(x, z) && sc.insideBy(x, z) > 12 });
      // the beech grove under the north-west cliffs
      clumpTrees(sc, { cx: -72, cz: -98, radius: 30, spacing: 10.5, species: ['broadleaf'], scale: [1.35, 1.8], max: 10, lanes, seed: s + 1602, keep: (x, z) => landOk(x, z) });
      // a few orchard crowns at the arena rim (inside the first screen of the orchard spot, never over the fight)
      for (const [dx, dz, sc2] of [[20.5, -8, 1.75], [-17.5, -14, 1.7], [-3, 21.5, 1.65], [15.5, 17, 1.8]] as Array<[number, number, number]>) sc.tree('broadleaf', 116 + dx, 54 + dz, sc2, undefined, { margin: 4 });
      // the orchard round the east boss arena: a loose lattice of broadleaf and autumn crowns
      clumpTrees(sc, { cx: 116, cz: 54, radius: 40, spacing: 8.2, species: ['broadleaf', 'broadleaf', 'broadleaf', 'autumn'], scale: [1.5, 2.0], max: 22, lanes, seed: s + 1603, keep: (x, z) => landOk(x, z, -5) && dist(x, z, 116, 54) > 17 });
      // groves over the open plain (patch windows keep ~22 % of the ground; the lawn under them is painted darker)
      clumpTrees(sc, { cx: 0, cz: 0, radius: 172, spacing: 10, patch: GROVE, lanes, species: ['broadleaf', 'broadleaf', 'broadleaf', 'broadleaf'], scale: [1.4, 1.9], max: 40, seed: GROVE_SEED, keep: (x, z) => landOk(x, z) && sc.insideBy(x, z) > 14 });
      // solitary feature trees on the lawn near the halls and the fields
      for (const [species, x, z, scale] of [
        ['broadleaf', -23, -3, 1.95], ['broadleaf', -22, 17, 2.05], ['broadleaf', 27, 21, 2.0], ['broadleaf', -50, -8, 2.0], ['broadleaf', 22, 62, 1.95], ['broadleaf', -62, 40, 1.9], ['autumn', 74, -34, 1.9], ['broadleaf', 70, 40, 1.9], ['broadleaf', -20, 66, 1.85],
      ] as Array<[TreeSpecies, number, number, number]>) {
        if (landOk(x, z)) sc.tree(species, x, z, scale, undefined, { margin: 8 });
      }
      // the wooded foothills of the rim: pines and a few beeches, gathered in patches
      clumpTrees(sc, {
        cx: 0, cz: 0, radius: R_ARENA + 6, spacing: 6, patch: { scale: 30, lo: 0.4, hi: 1 }, lanes, species: ['pine', 'pine', 'pine', 'broadleaf'], scale: [1.0, 1.5], max: 130, seed: s + 1604, free: { margin: -40, maxSlope: 0.78 },
        keep: (x, z) => {
          const ib = sc.insideBy(x, z);
          if (ib > 18 || ib < -14 || riverDe.at(x, z) < 8) return false;
          const a = pseudoAngle(x, z);
          return rim.sample(a).cliff < 0.62 || ib > 6;
        },
      });
    };

    return {
      arenaRadius: R_ARENA,
      arenaSdf(x, z) {
        const r = Math.sqrt(x * x + z * z);
        return r - rim.sample(pseudoAngle(x, z)).R;
      },
      height,
      liquid: { kind: 'water', level: L },
      streams: [stream],
      bridges,
      landmarks,
      groundLayers: LAYERS,
      cliffLayer: ROCK,
      capLayer: RUBBLE,
      cover: COVER,
      rockMaterials: [(YEONMU_TILES.rock as Tile).tex],
      paint,
      // zones core A1 `paintRes` (0.5 m splat texels) is OFF: the blind critic saw no difference (8 of 10 pairs SAME) for +14 MB per zone
      // r8 Z8 (r7 judge MF9): a small metin's rune carpet stays off the Great Metin's carved medallion (r 8.6). r8 ship: no longer off the
      // whole plaza (r 13.5 + 1.2: it pushed the plaza fall sites into the house rows, roofs over the fight ring, v01 / v02 lost; the Z8
      // critic: "keep the plaza sites and let the carpet lie on the paving")
      carpetKeepOut: (x, z) => x * x + z * z < 9.0 * 9.0,
      scatter,
    };
  },
};
