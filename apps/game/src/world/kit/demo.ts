// DEV ONLY — throwaway recipe that exercises the whole world kit (zones REPORT §3.2 C7 acceptance: "a throwaway recipe
// using the kit renders an irregular island layout in the terrain gallery"). It is NOT registered in world/zones/index.ts
// and nothing in the game imports it: kit.test.ts bakes it through the real TerrainField (vi.mock of the registry) and

// layers and cover so the Yeonmu look (look/yeonmu.ts) applies unchanged: "Yeonmu-like conditions".
//
// Layout: an organic archipelago (islandField, centre anchor island with the plaza) inside a mainland ring under the
// rim; bridges at the narrowest gaps (bridgeSites + connectIslands); wandering roads from the plaza over the bridges to
// each island's heart (roadNetwork, automatic junction + dead-end clearings); a rock spine with a pass (ridge), a raised
// plateau with a ramp and a graded switchback (plateau + switchback); groves, rim pines, boulder skirts (clump*); and the
// eight set-pieces on the island hearts.
import type { Bridge, CoverSpec, GroundLayer, Landmark } from '../layoutTypes';
import { fbm, lerp, ridged, smoothstep } from '../noise';
import type { RecipeContext, ScatterContext, TerrainPlan, ZoneRecipe } from '../recipe';
import {
  avenue,
  campFence,
  clumpProps,
  clumpRocks,
  angleOf,
  clumpTrees,
  connectIslands,
  dirAt,
  fencedYard,
  gatePair,
  hayYard,
  islandField,
  patchNoise,
  Path2,
  pillarRing,
  plateau,
  ridge,
  roadNetwork,
  roadSample,
  routeOnLand,
  ruinCourt,
  smoothCurve,
  standingStoneRing,
  switchback,
  unit,
  type BridgeSite,
  type IslandInfo,
  type Relief,
  type RoadSpec,
  type Vec2,
} from './index';

const R_ARENA = 188;


const FIELD_R = 186;
/** water level, island shore height, channel bed */
const L = -1.6;
const LAND = 0.5;
const BED = -3.8;
const PLAZA_R = 22;
const CENTRE_R = 28;
/** arc length (m) along the main road where the pagoda gate stands: its 5.5 m clearance must clear the occupied plaza disc */
const GATE_S = 15;

const GRASS = 0;
const MEADOW = 1;
const DIRT = 2;
const ROCK = 3;
const PLAZA = 4;
const DARK = 5;
const MUD = 6;
const DRY = 7;

// the Yeonmu ground layers and cover, verbatim (the Yeonmu look's decals are keyed by these layer indices)
const LAYERS: GroundLayer[] = [
  { tex: 'tex_grass_a', scale: 5.5 },
  { tex: 'tex_meadow', scale: 6.5 },
  { tex: 'tex_dirt_path', scale: 4.5 },
  { tex: 'tex_rock_mossy', scale: 7.5, tint: '#dcc8dc' },
  { tex: 'tex_plaza_tile', scale: 6 },
  { tex: 'tex_grass_b', scale: 5 },
  { tex: 'tex_mud', scale: 4 },
  { tex: 'tex_dry_grass', scale: 5 },
];
const COVER: CoverSpec[] = [
  { tex: 'tex_fol_grass_1', density: 1.2, size: [0.5, 0.85], layers: [0.28, 0.22, 0, 0, 0, 1, 0, 0.3], tintVar: 0.25, far: true },
  { tex: 'tex_fol_grass_2', density: 0.6, size: [0.8, 1.2], layers: [0, 0.05, 0, 0, 0, 1, 0, 0.2], tint: '#b9cf82', tintVar: 0.3 },
  { tex: 'tex_fol_grass_3', density: 0.8, size: [0.5, 0.8], layers: [0, 0, 0, 0, 0, 0, 0, 1], tint: '#e2c46e', tintVar: 0.3 },
  { tex: 'tex_fol_flowers_1', density: 0.24, size: [0.35, 0.55], layers: [0.02, 1, 0, 0, 0, 0, 0, 0] },
  { tex: 'tex_fol_flowers_2', density: 0.13, size: [0.35, 0.55], layers: [0.02, 0.8, 0, 0, 0, 0.03, 0, 0.08] },
  { tex: 'tex_fol_bush', density: 0.012, size: [1.1, 1.8], layers: [0.1, 0.06, 0, 0.35, 0, 1, 0, 0], tintVar: 0.2 },
];

/** what each island hosts (largest first after the centre island) */
type Role = 'ridge' | 'plateau' | 'farm' | 'camp' | 'ruin' | 'stones' | 'grove';
const ROLES: Role[] = ['ridge', 'plateau', 'farm', 'camp', 'ruin', 'stones'];

/** an island's heart inside the arena (most inland point, its distance to the coast) */
interface Isle {
  id: number;
  x: number;
  z: number;
  inner: number;
  area: number;
}

export const kitDemoRecipe: ZoneRecipe = {
  id: 'kitdemo',
  build(ctx: RecipeContext): TerrainPlan {
    const s = ctx.seed;
    const io = { d: 0, id: 0 };
    const rs = roadSample();

    // ---- islands + bridges --------------------------------------------------------------------------------------------
    const rimR = (x: number, z: number, r: number): number => {
      const k = 1 / (r + 1e-6);
      return 183 + 5 * fbm(x * k * 1.6 + 7.1, z * k * 1.6 - 3.3, s + 5, 3);
    };
    /** metres inside the walkable arena (rim foot) */
    const insideBy = (x: number, z: number): number => {
      const r = Math.sqrt(x * x + z * z);
      return rimR(x, z, r) - 5 - r;
    };
    const isl = islandField({ radius: FIELD_R, count: 16, gap: [11, 26], warp: 24, anchors: [{ x: 0, z: 0, r: 36 }], outside: 'land', seed: s + 101, grid: 2 });
    // bridges only where both ends stand inside the arena; the mainland ring under the rim is not a walkable connector
    const allSites = isl.bridgeSites({ maxSpan: 34 }).filter((b) => b.a !== -1 && insideBy(b.x0, b.z0) > 8 && insideBy(b.x1, b.z1) > 8);
    const { sites } = connectIslands(isl, allSites, { extra: 3, minArea: 600, ignore: [-1] });
    // island hearts INSIDE the arena (the field's own most-inland point may sit under the rim): 2 m scan
    const heart = new Map<number, Isle>();
    for (let j = -95; j <= 95; j++) {
      for (let i = -95; i <= 95; i++) {
        const x = i * 2;
        const z = j * 2;
        if (insideBy(x, z) < 20) continue;
        isl.sample(x, z, io);
        if (io.d >= 0 || io.id <= 0) continue;
        const h = heart.get(io.id);
        if (!h || -io.d > h.inner) heart.set(io.id, { id: io.id, x, z, inner: -io.d, area: (isl.islands[io.id] as IslandInfo).area });
      }
    }
    const others = [...heart.values()].filter((i) => i.area >= 600 && i.inner >= 9).sort((a, b) => b.area - a.area || a.id - b.id);
    const isleById = new Map<number, Isle>(others.map((i) => [i.id, i]));
    const role = new Map<number, Role>();
    others.forEach((i, k) => role.set(i.id, ROLES[k] ?? 'grove'));
    const islandOf = (r: Role): Isle | undefined => others.find((i) => role.get(i.id) === r);
    /** where the (first) bridge lands on each island: the road enters the island there */
    const entry = new Map<number, Vec2>();
    for (const b of sites) {
      if (!entry.has(b.a)) entry.set(b.a, [b.x0, b.z0]);
      if (!entry.has(b.b)) entry.set(b.b, [b.x1, b.z1]);
    }
    const entryDir = (i: Isle): [number, number] => {
      const e = entry.get(i.id);
      return e ? unit(e[0] - i.x, e[1] - i.z) : unit(-i.x, -i.z);
    };

    // ---- relief: a rock spine with a pass on the ridge island, a plateau with a ramp on the plateau island -------------
    const rolling = (x: number, z: number): number => 2.4 * fbm(x / 95, z / 95, s + 11, 3) + 0.7 * fbm(x / 30, z / 30, s + 12, 2);
    let spine: Relief | null = null;
    let spinePath: Path2 | null = null;
    let spineW = 0;
    const ri = islandOf('ridge');
    if (ri) {
      const [ex, ez] = entryDir(ri);
      const inner = ri.inner ?? 20;
      const off = inner * 0.5;
      const len = inner * 1.15;
      const cx = ri.x + ex * off;
      const cz = ri.z + ez * off;
      const pts: Vec2[] = [
        [cx - ez * len, cz + ex * len],
        [cx + ex * 3, cz + ez * 3],
        [cx + ez * len, cz - ex * len],
      ];
      spinePath = new Path2(smoothCurve(pts, 3));
      spineW = Math.max(9, inner * 0.42);
    }
    const pi = islandOf('plateau');
    let plat: Relief | null = null;
    let platR = 0;
    if (pi) {
      platR = Math.max(9, Math.min(16, pi.inner * 0.5));
      plat = plateau({ centre: [pi.x, pi.z], radius: platR, wobble: 2.5, height: 8, edge: 4.5, ramps: [{ dir: entryDir(pi), width: 7 }], seed: s + 301 });
    }
    const landMask = (d: number): number => 1 - smoothstep(-9, -3, d);
    /** ground before roads and bridges: shore / channel profile, rolling inland, plaza, spine, plateau */
    const ground = (x: number, z: number): number => {
      isl.sample(x, z, io);
      const d = io.d;
      const inland = smoothstep(2, 24, -d);
      let h = inland > 0 ? LAND + inland * Math.max(0, 1.4 + rolling(x, z)) : LAND;
      const wet = smoothstep(-3, 7, d);
      if (wet > 0) h = lerp(h, BED + 0.3 * fbm(x / 14, z / 14, s + 13, 2), wet);
      const r2 = x * x + z * z;
      if (r2 < 44 * 44) h = lerp(h, LAND, 1 - smoothstep(26, 40, Math.sqrt(r2)));
      const m = landMask(d);
      if (m > 0) {
        if (spine) h += spine.height(x, z) * m;
        if (plat) h += plat.height(x, z) * m;
      }
      return h;
    };

    // ---- roads: plaza → bridges → island hearts (+ a graded switchback up the plateau's back) -------------------------
    const roads: RoadSpec[] = [];
    const plazaEdge = (x: number, z: number): Vec2 => {
      const [ux, uz] = unit(x, z);
      return [ux * (PLAZA_R + 1), uz * (PLAZA_R + 1)];
    };
    for (const b of sites) {
      for (const [id, x, z, ox, oz] of [[b.a, b.x0, b.z0, b.x1, b.z1], [b.b, b.x1, b.z1, b.x0, b.z0]] as const) {
        if (id === 0) {
          roads.push({ pts: routeOnLand(isl, plazaEdge(x, z), [x, z], { inland: 5 }), width: [3.6, 6.5], wander: 3 });
          continue;
        }
        const I = isleById.get(id);
        if (I) {
          const big = role.get(id) === 'plateau' || role.get(id) === 'camp';
          roads.push({ pts: routeOnLand(isl, [x, z], [I.x, I.z], { inland: 5 }), width: big ? [3.4, 6] : [3, 5.5], wander: 4, wavelength: 34, endClearing: [0, 10] });
        } else {
          // no heart inside the arena: a short track onto the island
          const [ux, uz] = unit(x - ox, z - oz);
          roads.push({ pts: [[x, z], [x + ux * 12, z + uz * 12]], width: [3, 4.5], wander: 1.5, endClearing: [0, 6] });
        }
      }
    }
    // graded switchback up the plateau riser, on the first side (from the back round to the flanks) with room on the island
    let switchbackAt: Vec2 | null = null;
    if (pi && plat) {
      const [ex, ez] = entryDir(pi);
      const back = angleOf(-ex, -ez);
      for (const k of [0, 1, -1, 2, -2, 3, -3]) {
        const [dx, dz] = dirAt(back + k * 0.5);
        const a: Vec2 = [pi.x + dx * (platR + 4.5 + 13), pi.z + dz * (platR + 4.5 + 13)];
        const b: Vec2 = [pi.x + dx * (platR - 3), pi.z + dz * (platR - 3)];
        let ok = insideBy(a[0], a[1]) > 12;
        for (let k = 0; k <= 6 && ok; k++) {
          isl.sample(a[0] + ((b[0] - a[0]) * k) / 6, a[1] + ((b[1] - a[1]) * k) / 6, io);
          ok = io.d < -4 && io.id === pi.id;
        }
        if (!ok) continue;
        switchbackAt = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
        roads.push({ pts: switchback(a, b, { legs: 3, legWidth: 20, seed: s + 401 }), width: [3, 3.8], wander: 0.8, grade: [ground(a[0], a[1]), ground(b[0], b[1])], bench: 3.5, endClearing: [7, 0] });
        break;
      }
    }
    const net = roadNetwork({ roads, seed: s + 501, junctionClearing: 3, wear: 1.3, fringe: 2.2 });

    // the spine gets a pass wherever a road crosses it
    const passAt: Vec2[] = [];
    if (ri && spinePath) {
      const passes: Array<{ at: number; width: number }> = [];
      const along = { s: 0 };
      const pp = { x: 0, z: 0, tx: 0, tz: 0 };
      for (const c of net.centres) {
        for (const p of c) {
          if (spinePath.nearest(p[0], p[1], along) < 1.5 && !passes.some((q) => Math.abs(q.at - along.s) < 12)) {
            passes.push({ at: along.s, width: 10 });
            spinePath.at(along.s, pp);
            passAt.push([pp.x, pp.z]);
          }
        }
      }
      spine = ridge({ pts: spinePath.points(), height: 11, width: spineW, steep: 0.85, passes, seed: s + 201 });
    }

    // ---- bridges: kind / deck from the span, ends blended into the ground ---------------------------------------------
    const bridges: Bridge[] = sites.map((b: BridgeSite): Bridge => {
      const kind = b.span < 10 ? 'stone' : b.span < 18 ? 'wood' : 'rope';
      const yEnd = Math.max(ground(b.x0, b.z0), ground(b.x1, b.z1)) + 0.15;
      return { kind, x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, width: kind === 'stone' ? 5.5 : kind === 'wood' ? 4.4 : 3.2, yEnd, yMid: kind === 'rope' ? yEnd - 0.3 : yEnd + (kind === 'stone' ? 0.9 : 0.6) };
    });

    // ---- height ---------------------------------------------------------------------------------------------------------
    // bridge ends as flat arrays (height() runs 263k times: no per-call allocation)
    const endX = new Float64Array(bridges.length * 2);
    const endZ = new Float64Array(bridges.length * 2);
    const endY = new Float64Array(bridges.length * 2);
    bridges.forEach((b, k) => {
      endX[2 * k] = b.x0;
      endZ[2 * k] = b.z0;
      endX[2 * k + 1] = b.x1;
      endZ[2 * k + 1] = b.z1;
      endY[2 * k] = b.yEnd;
      endY[2 * k + 1] = b.yEnd;
    });
    const height = (x: number, z: number): number => {
      const r = Math.sqrt(x * x + z * z);
      let h = ground(x, z);
      net.sample(x, z, rs);
      if (rs.bench > 0) h = lerp(h, rs.grade, rs.bench);
      h -= 0.12 * rs.road;
      for (let k = 0; k < endX.length; k++) {
        const dx = x - (endX[k] as number);
        const dz = z - (endZ[k] as number);
        if (dx * dx + dz * dz < 81) h = lerp(h, endY[k] as number, 1 - smoothstep(3, 9, Math.sqrt(dx * dx + dz * dz)));
      }
      // the rim (its foot is never closer than 168 m)
      if (r > 160) {
        const rb = rimR(x, z, r);
        const t = smoothstep(rb - 10, rb + 16, r);
        if (t > 0) h += t * (30 + 10 * ridged(x / 30, z / 30, s + 21, 3)) + smoothstep(rb + 10, rb + 90, r) * 30;
      }
      return h;
    };

    // ---- landmarks ----------------------------------------------------------------------------------------------------
    const landmarks: Landmark[] = [
      { id: 'centre', kind: 'centre', x: 0, z: 0, r: CENTRE_R },
      { id: 'spawn', kind: 'spawn', x: 0, z: 0, r: 10 },
      { id: 'plaza', kind: 'poi', x: 0, z: 0, r: PLAZA_R },
    ];
    for (const i of others) landmarks.push({ id: `isle_${role.get(i.id)}_${i.id}`, kind: 'poi', x: i.x, z: i.z, r: Math.min(14, i.inner ?? 10) });
    bridges.forEach((b, k) => landmarks.push({ id: `bridge_${k}_${b.kind}`, kind: 'poi', x: (b.x0 + b.x1) * 0.5, z: (b.z0 + b.z1) * 0.5, r: 6 }));
    if (switchbackAt) landmarks.push({ id: 'switchback', kind: 'poi', x: switchbackAt[0], z: switchbackAt[1], r: 8 });
    passAt.forEach((p, k) => landmarks.push({ id: `ridge_pass_${k}`, kind: 'poi', x: p[0], z: p[1], r: 5 }));
    if (pi) {
      const [ex, ez] = entryDir(pi);
      landmarks.push({ id: 'plateau_ramp', kind: 'poi', x: pi.x + ex * (platR + 12), z: pi.z + ez * (platR + 12), r: 4 });
    }
    net.clearings.forEach((c, k) => landmarks.push({ id: `clearing_${c.kind}_${k}`, kind: 'poi', x: c.x, z: c.z, r: c.r }));
    // the main road: the longest one leaving the plaza (pagoda gate across it, a lantern avenue along it)
    let main = -1;
    let mainLen = 0;
    net.centres.forEach((c, k) => {
      const p = c[0] as Vec2;
      if (p[0] * p[0] + p[1] * p[1] < (PLAZA_R + 2) * (PLAZA_R + 2) && (net.lengths[k] as number) > mainLen) {
        main = k;
        mainLen = net.lengths[k] as number;
      }
    });
    if (main >= 0) {
      const rp = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
      net.pointAt(main, GATE_S, rp);
      landmarks.push({ id: 'main_gate', kind: 'poi', x: rp.x, z: rp.z, r: 6 });
      net.pointAt(main, Math.min(mainLen * 0.6, 44), rp);
      landmarks.push({ id: 'avenue', kind: 'poi', x: rp.x, z: rp.z, r: 6 });
    }

    // ---- paint --------------------------------------------------------------------------------------------------------
    const treeSeed = s + 701;
    const paint = (x: number, z: number, h: number, slope: number, out: Float32Array): void => {
      const r = Math.sqrt(x * x + z * z);
      const n1 = fbm(x / 58, z / 58, s + 31, 2);
      const n2 = fbm(x / 21, z / 21, s + 32, 2);
      const drift = fbm(x / 14, z / 14, s + 43, 2);
      let wGrass = 1;
      let wMeadow = smoothstep(0.02, 0.5, n1) * 1.4 * (0.35 + 1.3 * smoothstep(-0.15, 0.3, drift));
      let wDark = smoothstep(0.1, 0.55, -n1) * 0.8 + smoothstep(0.5, 0.62, patchNoise(x, z, 40, treeSeed)) * 2.2;
      let wDry = smoothstep(0.55, 0.8, n2 + 0.3 * n1) * 0.4;
      // shore: mud at the waterline, a pale sandy band just above it
      const shore = 1 - smoothstep(0.15, 1.2, Math.abs(h - (L + 0.15)));
      let wMud = shore * 2.4 + smoothstep(L - 0.3, L - 1.3, h) * 4;
      let wDirt = shore * 1.2 + (1 - smoothstep(0.3, 1.7, h - L)) * 0.9;
      net.sample(x, z, rs);
      wDirt += rs.road * 9 + rs.wear * 2.2;
      wMud += rs.wear * 0.7;
      wDry += rs.fringe * 1.6;
      wDark += rs.fringe * 0.5;
      const pm = 1 - smoothstep(PLAZA_R - 0.4, PLAZA_R + 0.4, r + 0.3 * n2);
      const wPlaza = 14 * pm;
      let wRock = 3 * (1 - smoothstep(0.3, 0.9, Math.abs(r - PLAZA_R - 0.8)));
      wRock += smoothstep(0.42, 0.8, slope) * 10;
      if (spine) wRock += 6 * spine.cliff(x, z);
      if (plat) wRock += 6 * plat.cliff(x, z);
      if (r > 160) wRock += smoothstep(-12, -2, r - rimR(x, z, r)) * (0.6 + 0.9 * smoothstep(-0.3, 0.5, n2)) * 2.2;
      const keep = (1 - rs.road) * (1 - pm) * (1 - Math.min(1, wRock * 0.12));
      wGrass *= keep;
      wMeadow *= keep;
      wDark *= keep;
      wDry *= keep;
      out[GRASS] = wGrass;
      out[MEADOW] = wMeadow;
      out[DARK] = wDark;
      out[DRY] = wDry;
      out[DIRT] = wDirt * (1 - pm);
      out[MUD] = wMud * (1 - pm) * (1 - rs.road);
      out[ROCK] = wRock;
      out[PLAZA] = wPlaza;
    };

    // ---- scatter ------------------------------------------------------------------------------------------------------
    const scatter = (sc: ScatterContext): void => {
      sc.occupy(0, 0, CENTRE_R + 1);
      const onLand = (x: number, z: number, inset: number): boolean => isl.sample(x, z, io).d < -inset;

      // island hearts: the eight set-pieces
      for (const i of others) {
        const rl = role.get(i.id) as Role;
        const [ex, ez] = entryDir(i);
        const seed = s + 1000 + i.id * 17;
        if (rl === 'stones') standingStoneRing(sc, { x: i.x, z: i.z, seed, radius: 9, count: 9, size: [2.6, 4.4], gapDir: [ex, ez], gapWidth: 7, focal: 'stele' });
        else if (rl === 'camp') campFence(sc, { x: i.x, z: i.z, seed, radius: 13, wall: 'palisade', gateDir: [ex, ez], inner: ['bonfire', 'orc_tent', 'orc_tent', 'weapon_rack', 'orc_tent', 'totem'], gatePost: 'war_banner' });
        else if (rl === 'ruin') ruinCourt(sc, { x: i.x, z: i.z, seed, size: [18, 14], dir: [ex, ez], focal: 'stele', decay: 0.55 });
        else if (rl === 'plateau') pillarRing(sc, { x: i.x, z: i.z, seed, radius: platR - 3.5, count: 10, prop: 'ruin_pillar', scale: [0.8, 1.1], gapDir: [ex, ez], gate: 'stone_gate', missing: 0.2 });
        else if (rl === 'farm') {
          const px = -ez;
          const pz = ex;
          fencedYard(sc, { x: i.x + px * 13 - ex * 2, z: i.z + pz * 13 - ez * 2, seed, size: [15, 13], dir: [-px, -pz], tree: 'autumn' });
          fencedYard(sc, { x: i.x - px * 12 - ex * 4, z: i.z - pz * 12 - ez * 4, seed: seed + 1, size: [14, 12], dir: [px, pz] });
          hayYard(sc, { x: i.x - ex * 16, z: i.z - ez * 16, seed: seed + 2, radius: 8, dir: [ex, ez] });
          clumpProps(sc, { cx: i.x - ex * 10, cz: i.z - ez * 10, radius: 22, spacing: 5, ids: ['haystack', 'haystack', 'crate', 'barrel'], max: 6, lanes: net.lanes(2.5), keep: (x, z) => onLand(x, z, 4), seed: seed + 3 });
        }
      }

      // the main road from the plaza: a pagoda gate across it and a lantern avenue along it; lanterns at the bridge heads
      const rp = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
      net.centres.forEach((c, k) => {
        const p = c[0] as Vec2;
        if (p[0] * p[0] + p[1] * p[1] >= (PLAZA_R + 2) * (PLAZA_R + 2)) return;
        net.pointAt(k, k === main ? GATE_S : 9, rp);
        if (k === main) gatePair(sc, { x: rp.x, z: rp.z, seed: s + 1201, dir: [rp.tx, rp.tz], width: 7, prop: 'pagoda_gate' });
        else gatePair(sc, { x: rp.x, z: rp.z, seed: s + 1202 + k, dir: [rp.tx, rp.tz], width: rp.hw * 2 + 1, prop: 'stone_lantern' });
      });
      if (main >= 0) avenue(sc, { pts: net.centres[main] as Vec2[], prop: 'stone_lantern', spacing: [10, 16], offset: 5.2, skip: 0.1, seed: s + 1301, start: GATE_S + 8 });
      bridges.forEach((b, k) => {
        if (b.kind === 'rope') return;
        const [ux, uz] = unit(b.x1 - b.x0, b.z1 - b.z0);
        gatePair(sc, { x: b.x0 - ux * 2.5, z: b.z0 - uz * 2.5, seed: s + 1401 + k, dir: [ux, uz], width: b.width + 0.6, prop: b.kind === 'stone' ? 'stone_lantern' : 'lamp_post' });
      });

      // boulder skirt at the spine foot, a few loose boulder clusters elsewhere
      if (spine && ri) {
        const sp = spine;
        clumpRocks(sc, { cx: ri.x, cz: ri.z, radius: (ri.inner ?? 20) * 2.2, spacing: 3.6, kind: 'boulder', size: [0.6, 2.4], max: 34, seed: s + 1501, lanes: net.lanes(1.5), keep: (x, z) => onLand(x, z, 3) && sp.height(x, z) < 1.6 && sp.distance(x, z) < spineW * 1.15 && sp.distance(x, z) > spineW * 0.55 });
      }
      clumpRocks(sc, { cx: 0, cz: 0, radius: FIELD_R, spacing: 5, patch: { scale: 26, lo: 0.9, hi: 1 }, kind: 'boulder', size: [0.7, 2.2], max: 40, seed: s + 1502, lanes: net.lanes(2), keep: (x, z) => onLand(x, z, 4) && x * x + z * z > 40 * 40 && insideBy(x, z) > 4 });

      // groves on the islands (empty lanes along the roads), pines and broadleaves on the mainland ring under the rim
      clumpTrees(sc, {
        cx: 0,
        cz: 0,
        radius: FIELD_R,
        spacing: 8.5,
        patch: { scale: 40, lo: 0.6, hi: 1 },
        lanes: net.lanes(3.5),
        keep: (x, z) => onLand(x, z, 4) && x * x + z * z > 42 * 42 && insideBy(x, z) > 3 && (!plat || plat.height(x, z) < 0.5) && (!spine || spine.height(x, z) < 0.8),
        species: ['broadleaf', 'broadleaf', 'pine', 'autumn'],
        scale: [0.9, 1.35],
        max: 220,
        seed: treeSeed,
      });
      clumpTrees(sc, {
        cx: 0,
        cz: 0,
        radius: R_ARENA + 10,
        spacing: 6.5,
        patch: { scale: 30, lo: 0.3, hi: 1 },
        lanes: net.lanes(3),
        // the rim foot and the lower rim slope (the walkable edge keeps a few metres clear)
        keep: (x, z) => {
          const ib = insideBy(x, z);
          return ib < 9 && ib > -12 && isl.sample(x, z, io).d < -3;
        },
        species: ['pine', 'pine', 'pine', 'broadleaf'],
        scale: [0.9, 1.45],
        max: 160,
        free: { margin: -30, maxSlope: 0.8 },
        seed: s + 702,
      });
    };

    return {
      arenaRadius: R_ARENA,
      arenaSdf(x, z) {
        const r = Math.sqrt(x * x + z * z);
        return r - (rimR(x, z, r) - 5);
      },
      height,
      liquid: { kind: 'water', level: L },
      streams: [],
      bridges,
      landmarks,
      groundLayers: LAYERS,
      cliffLayer: ROCK,
      capLayer: GRASS,
      cover: COVER,
      rockMaterials: ['tex_rock_mossy'],
      paint,
      scatter,
    };
  },
};
