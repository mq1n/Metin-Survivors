
// zone recipes — wandering roads, organic island fields, ridge spines and plateaus, clumped placement and composed
// set-pieces — so the recipes stop hand-rolling polar / CAD-like layouts.
//
// STATUS G1 (C7 landed): every function is implemented (./roads.ts, ./islands.ts, ./ridges.ts, ./clump.ts,
// ./setpieces.ts, helpers in ./util.ts, types in ./types.ts; tests in ./kit.test.ts; a throwaway demo recipe that uses
// all of it in ./demo.ts). The G0 signatures are unchanged; G1 only ADDED optional fields and extra exports.
//
//   import { roadNetwork, roadSample, islandField, connectIslands, ridge, plateau, clumpTrees, avenue, ... } from '../kit';
//
//   roads  : const net = roadNetwork({ seed, roads: [{ pts: [[0, -27], [6, -90], [-4, -160]], width: [3, 7], endClearing: [0, 9] }] });
//            const rs = roadSample();  paint(): net.sample(x, z, rs) → rs.road / rs.wear / rs.fringe / rs.clearing / rs.d
//            graded switchback: { pts: switchback(a, b, { legs: 4, legWidth: 26, seed }), width: [3, 4], wander: 1, grade: [0, 12] }
//            height(): h = lerp(h, rs.grade, rs.bench)
//   islands: const isl = islandField({ radius: 170, count: 16, gap: [10, 24], warp: 26, anchors: [{ x: 0, z: 0, r: 34 }], seed, grid: 1 });
//            isl.sample(x, z, o) → o.d (< 0 land) / o.id;  const { sites } = connectIslands(isl, isl.bridgeSites(), { extra: 3 })
//   relief : const sp = ridge({ pts, height: 14, width: 20, steep: 0.9, passes: [{ at: 60, width: 9 }], seed });  h += sp.height(x, z)
//            const pl = plateau({ centre: [90, -40], radius: 26, height: 9, edge: 5, ramps: [{ dir: [0, 1], width: 7 }], seed })
//   clump  : clumpTrees(sc, { cx, cz, radius: 60, spacing: 7, patch: { scale: 45, lo: 0.45, hi: 1 }, lanes: net.lanes(3),
//            species: ['broadleaf', 'pine'], scale: [0.9, 1.3], seed })
//   pieces : standingStoneRing / pillarRing / ruinCourt / campFence / gatePair / avenue / hayYard / fencedYard (sc, {...})
//
// Determinism rule (world/recipe.ts): everything here feeds heights / paint / arenaSdf / placement positions, so the
// implementations use only + − × ÷ sqrt floor abs min max and the helpers in noise.ts / rng.ts / shapes.ts (and the
// polynomial dsin / dcos / datan2 of ./util.ts) — never the engine's trig / exp / pow / log (kit.test.ts scans the
// sources). Same seed → same output on every JS engine. Set-pieces compose existing PROP_DEFS ids (world/props.ts),
// RockKinds and WallKinds only — no new 3D models.

export * from './types';
export { roadNetwork, roadSample, switchback } from './roads';
export { islandField, connectIslands, routeOnLand } from './islands';
export { ridge, plateau } from './ridges';
export { clumpPoints, clumpTrees, clumpRocks, clumpProps, patchNoise, ROCK_ASPECT } from './clump';
export {
  standingStoneRing,
  pillarRing,
  ruinCourt,
  campFence,
  gatePair,
  avenue,
  hayYard,
  fencedYard,
  polarPoint,
  angleOf,
  GATE_PROPS,
  WALL_HEIGHT,
} from './setpieces';
export { dsin, dcos, datan2, yawToward, dirAt, unit, subSeed, smoothCurve, resample, Path2, bakeGrid, TAU } from './util';
export type { PathPoint, BakedGrid } from './util';

/** Kept for G0 compatibility: no kit function throws it any more (C7 landed). */
export class KitPending extends Error {
  constructor(fn: string) {
    super(`world/kit: ${fn}() is a G0 signature; the implementation lands with core item C7 (G1)`);
    this.name = 'KitPending';
  }
}

