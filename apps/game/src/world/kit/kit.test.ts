// World kit (C7) gates: determinism, bounds, isFree honoured through the real ScatterContext, no forbidden Math.* in
// the kit sources, and the throwaway demo recipe passing the TerrainField zone gates (zones REPORT §3.2 C7).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { BiomePreset } from '../../data/schema';
import { cpuNow, withinBudget } from '../../dev/perfBudget';
import { TREE_SPECIES, type PropPlacement, type RockKind, type RockPlacement, type TreePlacement, type WallPlacement } from '../layoutTypes';
import { PROP_DEFS } from '../props';
import type { ScatterContext, TerrainPlan } from '../recipe';
import { clearTerrainFieldCache, createTerrainField, SURFACE } from '../terrainField';
import { TREE_DIMS } from '../trees';
import * as kit from './index';

// Two extra registry ids in THIS test file only: the kit demo recipe and a flat test arena whose scatter() is set per test.
const hooks = vi.hoisted(() => ({ scatter: null as null | ((sc: ScatterContext) => void) }));
vi.mock('../zones', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../zones')>();
  const { kitDemoRecipe } = await import('./demo');
  const flat = {
    id: 'kittest',
    build: (): TerrainPlan => ({
      arenaRadius: 120,
      arenaSdf: (x, z) => Math.sqrt(x * x + z * z) - 120,
      height: () => 0,
      streams: [],
      bridges: [],
      landmarks: [{ id: 'centre', kind: 'centre', x: 0, z: 0, r: 6 }],
      groundLayers: [{ tex: 'tex_grass_a', scale: 5 }],
      cliffLayer: 0,
      cover: [],
      rockMaterials: ['tex_rock_mossy'],
      paint: (_x, _z, _h, _s, out) => {
        out[0] = 1;
      },
      scatter: (sc) => hooks.scatter?.(sc),
    }),
  };
  return { ...mod, recipeFor: (id: string) => (id === 'kitdemo' ? kitDemoRecipe : id === 'kittest' ? flat : mod.recipeFor(id)) };
});

function biome(id: string, seed = 1234): BiomePreset {
  return {
    id,
    seed,
    ground: [],
    trees: [],
    props: [],
    fog: { color: '#aabbcc', near: 40, far: 160 },
    sky: { top: '#223344', horizon: '#aabbcc', bottom: '#556677' },
    sun: { color: '#fff1d6', intensity: 2.4, dir: [0.4, 0.8, 0.3] },
    ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.8 },
    relief: { height: 20, roughness: 0.5, features: [] },
  };
}

/** bakes the flat test arena with `scatter` and returns the layout */
function flatBake(scatter: (sc: ScatterContext) => void, seed = 1234) {
  hooks.scatter = scatter;
  clearTerrainFieldCache();
  const f = createTerrainField(biome('kittest', seed));
  hooks.scatter = null;
  clearTerrainFieldCache();
  return f;
}

const dist = (ax: number, az: number, bx: number, bz: number): number => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

// ------------------------------------------------------------------------------------------------------- sources

describe('kit sources', () => {
  it('use no engine trig / exp / pow / log / hypot / random and no ** (determinism rule)', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files).toEqual(expect.arrayContaining(['index.ts', 'roads.ts', 'islands.ts', 'ridges.ts', 'clump.ts', 'setpieces.ts', 'util.ts', 'types.ts', 'demo.ts']));
    const bad: string[] = [];
    const re = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|random)\b|\*\*/;
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      src.split('\n').forEach((line, i) => {
        if (re.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('polynomial trig matches the engine closely', () => {
    let err = 0;
    for (let i = 0; i < 20000; i++) {
      const a = i * 0.0137 - 137;
      err = Math.max(err, Math.abs(kit.dsin(a) - Math.sin(a)), Math.abs(kit.dcos(a) - Math.cos(a)));
      const y = Math.sin(i * 0.37) * 3;
      const x = Math.cos(i * 0.71) * 2;
      err = Math.max(err, Math.abs(kit.datan2(y, x) - Math.atan2(y, x)));
    }
    expect(err).toBeLessThan(2e-5);
    expect(kit.yawToward(1, 0)).toBeCloseTo(Math.PI / 2, 4);
    expect(kit.yawToward(0, 1)).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------------------------------------- roads

describe('roadNetwork', () => {
  const spec: kit.RoadNetworkSpec = {
    seed: 7,
    roads: [
      { pts: [[0, -27], [1, -50], [-3, -80], [-9, -112], [-4, -146], [0, -172]], width: [3, 7], endClearing: [0, 9] },
      { pts: [[27, 1], [58, -1], [92, 6], [124, 10], [150, 22], [168, 34]], width: [3, 7] },
      // starts ON road 1's control line (T junction), ends in a 8 m clearing
      { pts: [[92, 6], [104, 38], [96, 70], [78, 96], [74, 126]], width: [3, 5], endClearing: 8 },
      // crosses road 0 (X junction)
      { pts: [[-60, -60], [60, -60]], width: [4, 6] },
    ],
  };
  const net = kit.roadNetwork(spec);

  it('is deterministic', () => {
    const b = kit.roadNetwork(spec);
    expect(b.centres).toEqual(net.centres);
    expect(b.junctions).toEqual(net.junctions);
    expect(b.clearings).toEqual(net.clearings);
    const s1 = kit.roadSample();
    const s2 = kit.roadSample();
    for (let i = 0; i < 400; i++) {
      const x = ((i * 37) % 360) - 180;
      const z = ((i * 53) % 360) - 180;
      expect(b.sample(x, z, s2)).toEqual(net.sample(x, z, s1));
    }
  });

  it('wanders: no constant width, no straight CAD line', () => {
    const p = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
    const widths: number[] = [];
    for (let s = 0; s <= (net.lengths[3] as number); s += 3) widths.push(net.pointAt(3, s, p).hw * 2);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(Math.max(...widths)).toBeLessThanOrEqual(6 + 1e-9);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(0.5);
    // the straight control line (z = -60) is wandered sideways in the middle, kept at both ends
    const zs = (net.centres[3] as kit.Vec2[]).map((q) => q[1]);
    expect(Math.max(...zs.map((z) => Math.abs(z + 60)))).toBeGreaterThan(1.5);
    expect((net.centres[3] as kit.Vec2[])[0]).toEqual([-60, -60]);
  });

  it('finds the T and X junctions and adds dead-end clearings only where asked', () => {
    const near = (x: number, z: number, r: number): boolean => net.junctions.some((j) => dist(j[0], j[1], x, z) < r);
    expect(near(92, 6, 8)).toBe(true);
    const c0 = net.centres[0] as kit.Vec2[];
    const xz = c0.reduce((best, q) => (Math.abs(q[1] + 60) < Math.abs(best[1] + 60) ? q : best), c0[0] as kit.Vec2);
    expect(near(xz[0], xz[1], 8)).toBe(true);
    const ends = net.clearings.filter((c) => c.kind === 'end');
    expect(ends.length).toBe(2);
    expect(ends.some((c) => dist(c.x, c.z, 0, -172) < 1 && c.r === 9)).toBe(true);
    expect(ends.some((c) => c.r === 8)).toBe(true);
    // road 2 was snapped onto road 1's WANDERED centre: its first point lies on road 1, not on the raw control point
    const first = (net.centres[2] as kit.Vec2[])[0] as kit.Vec2;
    expect(new kit.Path2(net.centres[1] as kit.Vec2[]).nearest(first[0], first[1])).toBeLessThan(0.3);
  });

  it('paints track, wear, fringe and a continuous signed distance', () => {
    const s = kit.roadSample();
    const p = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
    net.pointAt(0, 60, p);
    net.sample(p.x, p.z, s);
    expect(s.road).toBeGreaterThan(0.95);
    expect(s.d).toBeLessThan(0);
    // walk across the road: weights stay in 0..1, the bands appear in order, d changes smoothly
    let prev = Number.NaN;
    let maxStep = 0;
    let sawWear = false;
    let sawFringe = false;
    for (let o = -12; o <= 12; o += 0.1) {
      net.along(0, 60, o, p);
      net.sample(p.x, p.z, s);
      for (const v of [s.road, s.wear, s.fringe, s.clearing]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      if (s.wear > 0.5) sawWear = true;
      if (s.fringe > 0.5) sawFringe = true;
      if (!Number.isNaN(prev)) maxStep = Math.max(maxStep, Math.abs(s.d - prev));
      prev = s.d;
    }
    expect(sawWear && sawFringe).toBe(true);
    expect(maxStep).toBeLessThan(0.35);
    // far away: nothing, and d saturates at reach
    net.sample(-200, 200, s);
    expect([s.road, s.wear, s.fringe, s.clearing]).toEqual([0, 0, 0, 0]);
    expect(s.d).toBe(net.reach);
    // a G0-shaped sample object (no grade / bench) still works
    const g0: kit.RoadSample = { road: 0, wear: 0, fringe: 0, clearing: 0, d: 0 };
    expect(net.sample(p.x, p.z, g0).d).toBeTypeOf('number');
  });

  it('switchback zig-zags between a and b and grades a walkable bench', () => {
    const pts = kit.switchback([0, 0], [0, 60], { legs: 4, legWidth: 24, seed: 3 });
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([0, 60]);
    const sides = pts.slice(1, -1).map((q) => Math.sign(q[0]));
    for (let i = 2; i < sides.length; i += 2) expect(sides[i]).toBe(-(sides[i - 1] as number));
    for (const q of pts) expect(Math.abs(q[0])).toBeLessThanOrEqual(12 * 1.16);
    const sb = kit.roadNetwork({ seed: 1, roads: [{ pts, width: [3, 4], wander: 1, grade: [0, 12] }] });
    const s = kit.roadSample();
    const p = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
    let last = -1;
    const L = sb.lengths[0] as number;
    for (let a = 0; a <= L; a += 2) {
      sb.pointAt(0, a, p);
      sb.sample(p.x, p.z, s);
      expect(s.bench).toBeGreaterThan(0.99);
      expect(s.grade).toBeGreaterThan(last - 0.6);
      last = s.grade as number;
    }
    expect(12 / L).toBeLessThan(0.84);
  });
});

// -------------------------------------------------------------------------------------------------------- islands

describe('islandField', () => {
  const spec: kit.IslandFieldSpec = { radius: 160, count: 16, gap: [10, 24], warp: 24, anchors: [{ x: 0, z: 0, r: 30 }], seed: 11 };
  const isl = kit.islandField(spec);
  const o = { d: 0, id: 0 };

  it('is deterministic (also with a baked grid)', () => {
    const b = kit.islandField(spec);
    const g = kit.islandField({ ...spec, grid: 1 });
    const o2 = { d: 0, id: 0 };
    let maxErr = 0;
    for (let i = 0; i < 2000; i++) {
      const x = ((i * 41) % 330) - 165;
      const z = ((i * 67) % 330) - 165;
      expect(b.sample(x, z, o2)).toEqual(isl.sample(x, z, o));
      maxErr = Math.max(maxErr, Math.abs(g.sample(x + 0.37, z - 0.61, o2).d - isl.sample(x + 0.37, z - 0.61, o).d));
    }
    expect(maxErr).toBeLessThan(0.6);
    expect(b.islands).toEqual(isl.islands);
    expect(b.bridgeSites()).toEqual(isl.bridgeSites());
  });

  it('pins the anchor island (centre and minimum radius)', () => {
    expect(isl.sample(0, 0, o).id).toBe(0);
    expect(o.d).toBeLessThan(-27);
    for (let k = 0; k < 32; k++) {
      const [ux, uz] = kit.dirAt((k / 32) * kit.TAU);
      const s = isl.sample(ux * 27, uz * 27, o);
      expect(s.d).toBeLessThan(0);
      expect(s.id).toBe(0);
    }
  });

  it('is an irregular archipelago: about `count` islands of varied size, separated by water', () => {
    const live = isl.islands.filter((i) => i.area > 300);
    expect(live.length).toBeGreaterThanOrEqual(10);
    expect(live.length).toBeLessThanOrEqual(18);
    const areas = live.map((i) => i.area);
    const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
    const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) * (b - mean), 0) / areas.length);
    expect(sd / mean).toBeGreaterThan(0.2);
    // every most-inland point is land of its own island
    for (const i of live) {
      isl.sample(i.x, i.z, o);
      expect(o.d).toBeLessThan(0);
      expect(o.id).toBe(i.id);
    }
    // water share inside the field: a network, not a flood
    let water = 0;
    let n = 0;
    for (let z = -150; z <= 150; z += 3) {
      for (let x = -150; x <= 150; x += 3) {
        if (x * x + z * z > 150 * 150) continue;
        n++;
        if (isl.sample(x, z, o).d > 0) water++;
      }
    }
    expect(water / n).toBeGreaterThan(0.15);
    expect(water / n).toBeLessThan(0.5);
  });

  it('finds bridge sites across narrow gaps and connects every island', () => {
    const sites = isl.bridgeSites({ maxSpan: 32 });
    expect(sites.length).toBeGreaterThan(5);
    for (let k = 0; k < sites.length; k++) {
      const b = sites[k] as kit.BridgeSite;
      if (k > 0) expect(b.span).toBeGreaterThanOrEqual((sites[k - 1] as kit.BridgeSite).span);
      expect(b.a).toBeLessThan(b.b);
      expect(b.span).toBeLessThanOrEqual(32);
      expect(isl.sample(b.x0, b.z0, o).d).toBeLessThan(0);
      expect(o.id).toBe(b.a);
      expect(isl.sample(b.x1, b.z1, o).d).toBeLessThan(0);
      expect(o.id).toBe(b.b);
      expect(isl.sample((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, o).d).toBeGreaterThan(0);
    }
    const { sites: chosen, unconnected } = kit.connectIslands(isl, sites, { minArea: 300, extra: 2 });
    expect(unconnected).toEqual([]);
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      while (parent.has(a) && parent.get(a) !== a) a = parent.get(a) as number;
      return a;
    };
    for (const b of chosen) parent.set(find(b.a), find(b.b));
    const roots = new Set(isl.islands.filter((i) => i.area >= 300).map((i) => find(i.id)));
    expect(roots.size).toBe(1);
  });

  it('routes roads on land', () => {
    const big = isl.islands.filter((i) => i.id !== 0).sort((a, b) => b.area - a.area)[0] as kit.IslandInfo;
    // the land point of that island farthest from its heart (at least 4 m inland): often round a bay
    let far: kit.Vec2 = [big.x, big.z];
    let fd = 0;
    for (let z = -160; z <= 160; z += 2) {
      for (let x = -160; x <= 160; x += 2) {
        isl.sample(x, z, o);
        if (o.id !== big.id || o.d > -4) continue;
        const dd = dist(x, z, big.x, big.z);
        if (dd > fd) {
          fd = dd;
          far = [x, z];
        }
      }
    }
    expect(fd).toBeGreaterThan(20);
    const inner = kit.routeOnLand(isl, [big.x, big.z], far, { inland: 2 });
    expect(inner[0]).toEqual([big.x, big.z]);
    expect(inner[inner.length - 1]).toEqual(far);
    for (let k = 1; k < inner.length; k++) {
      const a = inner[k - 1] as kit.Vec2;
      const b = inner[k] as kit.Vec2;
      for (let t = 0.1; t < 1; t += 0.1) expect(isl.sample(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, o).d).toBeLessThan(0);
    }
  });
});

// --------------------------------------------------------------------------------------------------------- relief

describe('ridge / plateau', () => {
  const pts: kit.Vec2[] = [[-60, 0], [0, 10], [60, 0]];
  const r = kit.ridge({ pts, height: 14, width: 18, steep: 0.9, passes: [{ at: 60, width: 10 }], seed: 5 });
  const slope = (f: (x: number, z: number) => number, x: number, z: number): number => {
    const e = 0.5;
    const gx = (f(x + e, z) - f(x - e, z)) / (2 * e);
    const gz = (f(x, z + e) - f(x, z - e)) / (2 * e);
    return Math.sqrt(gx * gx + gz * gz);
  };

  it('ridge: crest, rock walls, a walkable pass, nothing outside the footprint', () => {
    let crest = 0;
    let wallSlope = 0;
    for (let x = -60; x <= 60; x += 1) {
      for (let z = -40; z <= 50; z += 1) {
        const h = r.height(x, z);
        expect(h).toBeGreaterThanOrEqual(0);
        crest = Math.max(crest, h);
        const c = r.cliff(x, z);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        if (c > 0.6 && h > 2) wallSlope = Math.max(wallSlope, slope(r.height, x, z));
      }
    }
    expect(crest).toBeGreaterThan(14 * 0.75);
    expect(crest).toBeLessThan(14 * 1.45);
    expect(wallSlope).toBeGreaterThan(0.84);
    expect(r.height(0, 60)).toBe(0);
    expect(r.height(-130, 0)).toBe(0);
    // the pass at arc length 60 (about x = 0 on the spine) is cut to the floor
    expect(r.height(0, 9)).toBeLessThan(0.5);
    expect(r.distance(0, 30)).toBeGreaterThan(15);
    // a rolling hill (steep 0) of the same size stays walkable
    const hill = kit.ridge({ pts, height: 8, width: 30, steep: 0, seed: 5 });
    let hs = 0;
    for (let x = -50; x <= 50; x += 2) for (let z = -25; z <= 35; z += 1) hs = Math.max(hs, slope(hill.height, x, z));
    expect(hs).toBeLessThan(0.84);
  });

  it('plateau: flat top, cliff riser, walkable ramp', () => {
    const p = kit.plateau({ centre: [10, -5], radius: 20, height: 8, edge: 4, ramps: [{ dir: [0, 1], width: 7 }], seed: 3 });
    expect(Math.abs(p.height(10, -5) - 8)).toBeLessThan(0.4);
    expect(p.distance(10, -5)).toBeLessThan(-15);
    expect(p.height(10 + 60, -5)).toBe(0);
    let rampMax = 0;
    for (let z = -5; z <= 50; z += 0.5) rampMax = Math.max(rampMax, slope(p.height, 10, z));
    expect(rampMax).toBeLessThan(0.84);
    let riser = 0;
    let riserCliff = 0;
    for (let x = 10 + 15; x <= 10 + 30; x += 0.5) {
      riser = Math.max(riser, slope(p.height, x, -5));
      riserCliff = Math.max(riserCliff, p.cliff(x, -5));
    }
    expect(riser).toBeGreaterThan(0.84);
    expect(riserCliff).toBeGreaterThan(0.5);
    let rampCliff = 0;
    for (let z = 10; z <= 45; z += 0.5) rampCliff = Math.max(rampCliff, p.cliff(10, z));
    expect(rampCliff).toBeLessThan(0.2);
  });
});

// ---------------------------------------------------------------------------------------------------------- clump

describe('clumpPoints', () => {
  const lane: kit.Vec2[] = [[-80, 0], [80, 10]];
  const spec: kit.ClumpSpec = { cx: 5, cz: -3, radius: 70, spacing: 4, lanes: [{ pts: lane, half: 6 }], seed: 9 };

  it('blue noise inside the disc, lanes empty, deterministic, capped', () => {
    const pts = kit.clumpPoints(spec);
    expect(kit.clumpPoints(spec)).toEqual(pts);
    expect(pts.length).toBeGreaterThan(300);
    const path = new kit.Path2(lane);
    for (const [x, z] of pts) {
      expect(dist(x, z, 5, -3)).toBeLessThanOrEqual(70 + 1e-9);
      expect(path.nearest(x, z)).toBeGreaterThanOrEqual(6);
    }
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i] as kit.Vec2;
        const b = pts[j] as kit.Vec2;
        minD = Math.min(minD, dist(a[0], a[1], b[0], b[1]));
      }
    }
    expect(minD).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(kit.clumpPoints({ ...spec, max: 25 }).length).toBe(25);
    const keep = kit.clumpPoints({ ...spec, keep: (x) => x > 0 });
    expect(keep.every(([x]) => x > 0)).toBe(true);
  });

  it('the (sc, spec) call shape drops the points the scatter context holds occupied, and occupies nothing', () => {
    let free: kit.Vec2[] = [];
    let all: kit.Vec2[] = [];
    let occupiedAfter = 0;
    const f = flatBake((sc) => {
      sc.occupy(0, 0, 20);
      all = kit.clumpPoints({ cx: 0, cz: 0, radius: 60, spacing: 4, seed: 6 });
      free = kit.clumpPoints(sc, { cx: 0, cz: 0, radius: 60, spacing: 4, seed: 6 });
      occupiedAfter = sc.isFree(40, 40, 1) ? 1 : 0;
    });
    expect(f.layout.trees.length).toBe(0);
    expect(all.some(([x, z]) => dist(x, z, 0, 0) < 19)).toBe(true);
    expect(free.length).toBeGreaterThan(50);
    expect(free.length).toBeLessThan(all.length);
    for (const [x, z] of free) expect(dist(x, z, 0, 0)).toBeGreaterThanOrEqual(20 + 0.5 - 1e-9);
    expect(occupiedAfter).toBe(1);
  });

  it('macro patches keep about (hi − lo) of the area', () => {
    const all = kit.clumpPoints({ cx: 0, cz: 0, radius: 150, spacing: 5, seed: 4 }).length;
    const half = kit.clumpPoints({ cx: 0, cz: 0, radius: 150, spacing: 5, seed: 4, patch: { scale: 30, lo: 0.5, hi: 1 } }).length;
    expect(half / all).toBeGreaterThan(0.35);
    expect(half / all).toBeLessThan(0.65);
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = kit.patchNoise(((i * 7.3) % 900) - 450, ((i * 13.7) % 900) - 450, 25, 77);
      bins[Math.min(9, Math.floor(v * 10))] = (bins[Math.min(9, Math.floor(v * 10))] as number) + 1;
    }
    for (const b of bins) expect(b / 20000).toBeGreaterThan(0.04);
  });
});

// ------------------------------------------------------------- placers + set-pieces through the real ScatterContext

describe('placers and set-pieces (real ScatterContext)', () => {
  const R0 = 15;
  /** every placer once, packed round an occupied disc at the origin */
  const all = (sc: ScatterContext): Record<string, kit.SetPiece | TreePlacement[] | RockPlacement[] | PropPlacement[]> => {
    sc.occupy(0, 0, R0);
    return {
      stones: kit.standingStoneRing(sc, { x: 0, z: 0, seed: 4, radius: 19, count: 12, size: [2.5, 4], gapDir: [0, 1], gapWidth: 6, focal: 'stele' }),
      pillars: kit.pillarRing(sc, { x: 70, z: 0, seed: 5, radius: 14, count: 10, prop: 'ruin_pillar', gapDir: [-1, 0], gate: 'stone_gate', missing: 0.2 }),
      court: kit.ruinCourt(sc, { x: -70, z: 0, seed: 6, size: [18, 14], dir: [1, 0], decay: 0.6 }),
      camp: kit.campFence(sc, { x: 0, z: 70, seed: 7, radius: 13, wall: 'palisade', gateDir: [0, -1], inner: ['bonfire', 'orc_tent', 'orc_tent', 'weapon_rack'], gatePost: 'war_banner' }),
      gate: kit.gatePair(sc, { x: 0, z: -40, seed: 8, dir: [0, 1], width: 6, prop: 'pagoda_gate' }),
      lanterns: kit.gatePair(sc, { x: 20, z: -40, seed: 9, dir: [0, 1], width: 5, prop: 'stone_lantern' }),
      avenue: kit.avenue(sc, { pts: [[-90, -60], [-30, -70], [30, -62], [90, -75]], prop: 'stone_lantern', spacing: [8, 14], offset: 5, skip: 0.1, seed: 10 }),
      // straight through the occupied disc: every slot inside it must be refused
      avenueBlocked: kit.avenue(sc, { pts: [[-30, 3], [30, 3]], prop: 'stele', spacing: [4, 6], offset: 2, seed: 11, mode: 'pairs' }),
      hay: kit.hayYard(sc, { x: 60, z: 60, seed: 12, radius: 9, dir: [-1, 0] }),
      yard: kit.fencedYard(sc, { x: -60, z: 60, seed: 13, size: [16, 13], dir: [1, 0], tree: 'autumn' }),
      // the clumps last (they fill round the pieces)
      trees: kit.clumpTrees(sc, { cx: 0, cz: 0, radius: 60, spacing: 5, species: ['broadleaf', 'pine'], scale: [0.9, 1.2], seed: 1 }),
      rocks: kit.clumpRocks(sc, { cx: 0, cz: 0, radius: 40, spacing: 3, kind: 'boulder', size: [0.5, 2], seed: 2 }),
      props: kit.clumpProps(sc, { cx: 0, cz: 0, radius: 40, spacing: 4, ids: ['haystack', 'crate', 'barrel'], seed: 3 }),
    };
  };

  it('honour isFree, use only existing ids, and return exactly what they placed', () => {
    let out: ReturnType<typeof all> = {};
    const f = flatBake((sc) => {
      out = all(sc);
    });
    const L = f.layout;
    const placedProps = new Set<PropPlacement>();
    const placedRocks = new Set<RockPlacement>();
    const placedTrees = new Set<TreePlacement>();
    const placedWalls = new Set<WallPlacement>();
    for (const v of Object.values(out)) {
      if (Array.isArray(v)) {
        for (const p of v) {
          if ('species' in p) placedTrees.add(p);
          else if ('kind' in p) placedRocks.add(p);
          else placedProps.add(p);
        }
      } else {
        v.props.forEach((p) => placedProps.add(p));
        v.rocks.forEach((p) => placedRocks.add(p));
        v.trees.forEach((p) => placedTrees.add(p));
        v.walls.forEach((p) => placedWalls.add(p));
      }
    }
    // returned = registered in the layout, nothing else was added
    expect(placedProps.size).toBe(L.props.length);
    expect(placedRocks.size).toBe(L.rocks.length);
    expect(placedTrees.size).toBe(L.trees.length);
    expect(placedWalls.size).toBe(L.walls.length);
    for (const p of L.props) expect(placedProps.has(p)).toBe(true);
    expect(L.props.length).toBeGreaterThan(40);
    expect(L.walls.length).toBeGreaterThan(10);
    expect(L.trees.length).toBeGreaterThan(20);
    // ids / kinds exist
    const kinds: RockKind[] = ['boulder', 'slab', 'spire', 'outcrop', 'basalt', 'crystal', 'pebbles'];
    for (const p of L.props) expect(PROP_DEFS[p.id]).toBeDefined();
    for (const r of L.rocks) expect(kinds).toContain(r.kind);
    for (const t of L.trees) expect(TREE_SPECIES).toContain(t.species);
    // isFree: nothing overlaps the disc occupied before the placers ran
    for (const t of L.trees) expect(dist(t.x, t.z, 0, 0)).toBeGreaterThanOrEqual(R0 + TREE_DIMS[t.species].spacing * t.scale - 1e-6);
    for (const r of L.rocks) expect(dist(r.x, r.z, 0, 0)).toBeGreaterThanOrEqual(R0 + Math.max(r.sx, r.sz) * 0.5 * 0.8 - 1e-6);
    for (const p of L.props) expect(dist(p.x, p.z, 0, 0)).toBeGreaterThanOrEqual(R0 + (PROP_DEFS[p.id]?.radius ?? 0) * p.scale * 0.9 - 1e-6);
    for (const w of L.walls) {
      for (let t = 0; t <= 1; t += 0.05) expect(dist(w.x0 + (w.x1 - w.x0) * t, w.z0 + (w.z1 - w.z0) * t, 0, 0)).toBeGreaterThanOrEqual(R0 + 0.5);
    }
    const blocked = out.avenueBlocked as kit.SetPiece;
    for (const p of blocked.props) expect(Math.abs(p.x)).toBeGreaterThan(R0);
    // pieces stay round their centre
    for (const p of (out.camp as kit.SetPiece).props) expect(dist(p.x, p.z, 0, 70)).toBeLessThan(13 * 1.25 + 2);
    for (const w of (out.camp as kit.SetPiece).walls) expect(dist(w.x0, w.z0, 0, 70)).toBeLessThan(13 * 1.12);
    for (const r of (out.stones as kit.SetPiece).rocks) expect(dist(r.x, r.z, 0, 0)).toBeLessThan(19 * 1.08 + 0.01);
    expect((out.stones as kit.SetPiece).rocks.length).toBeGreaterThan(4);
    for (const p of (out.avenue as kit.SetPiece).props) expect(p.z).toBeLessThan(-50);
    expect((out.gate as kit.SetPiece).props.map((p) => p.id)).toEqual(['pagoda_gate']);
    expect((out.lanterns as kit.SetPiece).props.length).toBe(2);
    expect((out.pillars as kit.SetPiece).props.some((p) => p.id === 'stone_gate')).toBe(true);
  });

  it('are deterministic', () => {
    const a = flatBake((sc) => void all(sc));
    const b = flatBake((sc) => void all(sc));
    const strip = (f: typeof a) => ({ props: f.layout.props.map((p) => [p.id, p.x, p.z, p.scale, p.yaw]), rocks: f.layout.rocks.map((r) => [r.kind, r.x, r.z, r.sx, r.sy, r.sz, r.tiltX ?? 0]), walls: f.layout.walls.map((w) => [w.kind, w.x0, w.z0, w.x1, w.z1, w.height]), trees: f.layout.trees.map((t) => [t.species, t.x, t.z, t.scale]) });
    expect(strip(b)).toEqual(strip(a));
  });

  it('avenue never stands in a row: irregular spacing, mostly alternating sides', () => {
    // a 90 m loop: about 50 lanterns; inside / outside of the loop = the two sides
    const loop: kit.Vec2[] = [];
    for (let k = 0; k <= 24; k++) loop.push([90 * Math.cos((k / 24) * 2 * Math.PI), 90 * Math.sin((k / 24) * 2 * Math.PI)]);
    const f = flatBake((sc) => void kit.avenue(sc, { pts: loop, prop: 'stone_lantern', spacing: [8, 14], offset: 5, seed: 21 }));
    const ps = f.layout.props.slice().sort((p, q) => Math.atan2(p.z, p.x) - Math.atan2(q.z, q.x));
    expect(ps.length).toBeGreaterThan(30);
    const ang = ps.map((p) => Math.atan2(p.z, p.x));
    const gaps = ang.slice(1).map((a, i) => (a - (ang[i] as number)) * 90);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(2);
    const side = ps.map((p) => Math.sign(Math.sqrt(p.x * p.x + p.z * p.z) - 90));
    let flips = 0;
    for (let i = 1; i < side.length; i++) if (side[i] !== side[i - 1]) flips++;
    expect(flips / (side.length - 1)).toBeGreaterThan(0.55);
    expect(flips).toBeLessThan(side.length - 1);
  });
});

// ----------------------------------------------------------------------------------- the demo recipe as a real zone

describe('kit demo recipe (TerrainField gates)', () => {
  it('bakes fast, deterministic, centre playable, irregular archipelago with bridges', () => {
    // the zone gate is 1500 ms of CPU time (dev/perfBudget.ts: CPU time, so a loaded machine or the parallel test run does
    // not move it; scaled by the machine speed only when over, 4 attempts); the demo is also allowed 2.5× a real Yeonmu
    // bake measured right before it (a kit-built zone must cost about what a hand-built one does)
    const cpuBake = (id: string) => {
      clearTerrainFieldCache();
      const t0 = cpuNow();
      const field = createTerrainField(biome(id, 7101));
      return { value: field, ms: cpuNow() - t0 };
    };
    const yeonmu = cpuBake('yeonmu').ms;
    const bake = withinBudget(() => cpuBake('kitdemo'), { baseMs: Math.max(1500, 2.5 * yeonmu) });
    expect(bake.ms, bake.log).toBeLessThanOrEqual(bake.budget);
    const f = bake.value;
    expect(f.landmark('centre')).toBeDefined();
    expect(f.walkable(0, 0)).toBe(true);
    expect(f.surfaceAt(0, 0)).toBe(SURFACE.GROUND);
    expect(f.stats.walkableFraction).toBeGreaterThan(0.6);
    expect(f.stats.reachableFraction).toBeGreaterThan(0.9);
    let bad = 0;
    f.blockersNear(0, 0, 30, (b) => {
      if (Math.sqrt(b.x * b.x + b.z * b.z) < 14) bad++;
    });
    expect(bad).toBe(0);
    expect(f.layout.bridges.length).toBeGreaterThanOrEqual(8);
    expect(f.landmarks.filter((l) => l.id.startsWith('isle_')).length).toBeGreaterThanOrEqual(8);
    // there is deep water between the islands (not walkable), so the bridges carry the reachability
    let deep = 0;
    for (let z = -150; z <= 150; z += 4) for (let x = -150; x <= 150; x += 4) if (f.surfaceAt(x, z) === SURFACE.DEEP) deep++;
    expect(deep).toBeGreaterThan(200);
    clearTerrainFieldCache();
    const g = createTerrainField(biome('kitdemo', 7101));
    expect(Array.from(g.grid.heights.slice(100000, 100400))).toEqual(Array.from(f.grid.heights.slice(100000, 100400)));
    expect(g.layout.props.map((p) => [p.id, p.x, p.z])).toEqual(f.layout.props.map((p) => [p.id, p.x, p.z]));
    expect(g.blockers.length).toBe(f.blockers.length);
    clearTerrainFieldCache();
  }, 60_000); // three-plus bakes: the 5 s default is a hang guard that a loaded machine can trip, not a performance gate
});
