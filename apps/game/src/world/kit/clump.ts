// World kit (C7) clumped placement: blue-noise (Poisson-disc) points inside macro-noise patches minus kept-clear lanes,

// objects are sparse and grouped (2.8-18 objects/ha, trees 2-9.4/ha) with empty lanes between the groups; even jittered
// grids and rows read as cheap. Deterministic (see util.ts).
import type { PropPlacement, RockKind, RockPlacement, TreePlacement, TreeSpecies } from '../layoutTypes';
import { fbm, smoothstep } from '../noise';
import { PROP_DEFS } from '../props';
import type { ScatterContext } from '../recipe';
import { WorldRng } from '../rng';
import { TREE_DIMS } from '../trees';
import type { ClumpPropSpec, ClumpRockSpec, ClumpSpec, ClumpTreeSpec, Vec2 } from './types';
import { Path2, subSeed, TAU } from './util';

// Measured CDF of fbm(·, ·, seed, 3) (960k samples, symmetric about 0): maps the raw noise to an about uniform 0..1, so
// a patch window [lo, hi] keeps about (hi − lo) of the area.
const CDF_V = [0, 0.026, 0.0525, 0.0793, 0.1068, 0.1363, 0.1695, 0.2086, 0.2585, 0.3295, 0.4058, 0.65];
const CDF_P = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98, 1];

function cdfPos(v: number): number {
  if (v >= (CDF_V[CDF_V.length - 1] as number)) return 1;
  for (let k = 1; k < CDF_V.length; k++) {
    const b = CDF_V[k] as number;
    if (v <= b) {
      const a = CDF_V[k - 1] as number;
      const pa = CDF_P[k - 1] as number;
      return pa + ((CDF_P[k] as number) - pa) * ((v - a) / (b - a));
    }
  }
  return 1;
}

/**
 * The macro patch noise the clumps use (about uniform 0..1, `scale` m per patch). A recipe can paint the same patches
 * (darker grass under a grove, a scree tint round a boulder field) with the clump's `seed` and `patch.scale`.
 */
export function patchNoise(x: number, z: number, scale: number, seed: number): number {
  const v = fbm(x / scale + 0.31, z / scale - 0.17, subSeed(seed, 0x9a7c), 3);
  return v >= 0 ? cdfPos(v) : 1 - cdfPos(-v);
}

/** Poisson-disc points (min distance r) in the disc (cx, cz, R), Bridson's algorithm without trig. */
function poissonDisc(cx: number, cz: number, R: number, r: number, rng: WorldRng): Vec2[] {
  const cell = r * 0.7071067811865476;
  const x0 = cx - R;
  const z0 = cz - R;
  const n = Math.max(1, Math.ceil((2 * R) / cell) + 1);
  const grid = new Int32Array(n * n).fill(-1);
  const px: number[] = [];
  const pz: number[] = [];
  const active: number[] = [];
  const r2 = r * r;
  const cellOf = (v: number, v0: number): number => {
    const k = Math.floor((v - v0) / cell);
    return k < 0 ? 0 : k >= n ? n - 1 : k;
  };
  const fits = (x: number, z: number): boolean => {
    const ci = cellOf(x, x0);
    const cj = cellOf(z, z0);
    for (let j = Math.max(0, cj - 2); j <= Math.min(n - 1, cj + 2); j++) {
      for (let i = Math.max(0, ci - 2); i <= Math.min(n - 1, ci + 2); i++) {
        const q = grid[j * n + i] as number;
        if (q < 0) continue;
        const dx = (px[q] as number) - x;
        const dz = (pz[q] as number) - z;
        if (dx * dx + dz * dz < r2) return false;
      }
    }
    return true;
  };
  const add = (x: number, z: number): void => {
    const q = px.length;
    px.push(x);
    pz.push(z);
    grid[cellOf(z, z0) * n + cellOf(x, x0)] = q;
    active.push(q);
  };
  // first point: uniform in the disc (rejection from the square)
  for (let k = 0; k < 64; k++) {
    const u = rng.next() * 2 - 1;
    const v = rng.next() * 2 - 1;
    if (u * u + v * v > 1) continue;
    add(cx + u * R, cz + v * R);
    break;
  }
  while (active.length > 0) {
    const ai = rng.int(active.length);
    const p = active[ai] as number;
    let found = false;
    for (let k = 0; k < 30; k++) {
      // candidate in the annulus [r, 2r] round p (rejection from the square, no trig)
      const u = (rng.next() * 2 - 1) * 2 * r;
      const v = (rng.next() * 2 - 1) * 2 * r;
      const d2 = u * u + v * v;
      if (d2 < r2 || d2 > 4 * r2) continue;
      const x = (px[p] as number) + u;
      const z = (pz[p] as number) + v;
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > R * R) continue;
      if (!fits(x, z)) continue;
      add(x, z);
      found = true;
    }
    if (!found) {
      active[ai] = active[active.length - 1] as number;
      active.pop();
    }
  }
  const out: Vec2[] = [];
  for (let q = 0; q < px.length; q++) out.push([px[q] as number, pz[q] as number]);
  return out;
}

/** blue-noise points of the clump after the patch / lane / keep filters (generation order; no cap) */
function filtered(spec: ClumpSpec): Vec2[] {
  const spacing = Math.max(0.2, spec.spacing);
  const radius = Math.max(0, spec.radius);
  const pts = poissonDisc(spec.cx, spec.cz, radius, spacing, new WorldRng(subSeed(spec.seed, 0xb1)));
  const pick = new WorldRng(subSeed(spec.seed, 0xb2));
  const lanes = (spec.lanes ?? []).map((l) => ({ path: new Path2(l.pts), half: l.half }));
  const patch = spec.patch;
  const F = 0.04;
  const out: Vec2[] = [];
  for (const p of pts) {
    const x = p[0];
    const z = p[1];
    // one draw per point keeps the stream aligned whatever the filters decide
    const roll = pick.next();
    if (patch) {
      const n = patchNoise(x, z, patch.scale, spec.seed);
      const lo = patch.lo <= 0 ? 1 : smoothstep(patch.lo - F, patch.lo + F, n);
      const hi = patch.hi >= 1 ? 1 : 1 - smoothstep(patch.hi - F, patch.hi + F, n);
      if (roll >= lo * hi) continue;
    }
    let inLane = false;
    for (const l of lanes) {
      if (l.path.n === 0) continue;
      if (l.path.nearest(x, z, undefined, l.half + 0.01) < l.half) {
        inLane = true;
        break;
      }
    }
    if (inLane) continue;
    if (spec.keep && !spec.keep(x, z)) continue;
    out.push(p);
  }
  return out;
}

/** deterministic Fisher-Yates shuffle (in place) */
function shuffle<T>(a: T[], rng: WorldRng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

/**
 * Blue-noise points inside macro patches minus lanes. `clumpPoints(spec)` needs no ScatterContext and occupies nothing;
 * `clumpPoints(sc, spec)` (the G0 call shape of the other clump placers) also drops the points the scatter context
 * reports as not free (a 0.5 m disc), still occupying nothing.
 */
export function clumpPoints(spec: ClumpSpec): Vec2[];
export function clumpPoints(sc: ScatterContext, spec: ClumpSpec): Vec2[];
export function clumpPoints(a: ClumpSpec | ScatterContext, b?: ClumpSpec): Vec2[] {
  const spec = b ?? (a as ClumpSpec);
  const sc = b ? (a as ScatterContext) : null;
  let pts = filtered(spec);
  if (sc) pts = pts.filter((p) => sc.isFree(p[0], p[1], 0.5));
  if (spec.max === undefined || pts.length <= spec.max) return pts;
  return shuffle(pts, new WorldRng(subSeed(spec.seed, 0xb3))).slice(0, Math.max(0, Math.floor(spec.max)));
}

const SPECIES_ERR = (s: string): Error => new Error(`world/kit clumpTrees: unknown species "${s}"`);

/** Clumped trees through the ScatterContext (honours suitable / isFree; returns what was placed). */
export function clumpTrees(sc: ScatterContext, spec: ClumpTreeSpec): TreePlacement[] {
  const list: ReadonlyArray<TreeSpecies> = typeof spec.species === 'string' ? [spec.species] : spec.species;
  for (const s of list) if (!TREE_DIMS[s]) throw SPECIES_ERR(s);
  if (list.length === 0) return [];
  const rng = new WorldRng(subSeed(spec.seed, 0xb4));
  const pts = shuffle(filtered(spec), new WorldRng(subSeed(spec.seed, 0xb3)));
  const max = spec.max ?? Infinity;
  const gap = spec.gap ?? 1;
  const out: TreePlacement[] = [];
  for (const [x, z] of pts) {
    if (out.length >= max) break;
    const species = list[rng.int(list.length)] as TreeSpecies;
    const scale = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * rng.next();
    const t = sc.tree(species, x, z, scale, TREE_DIMS[species].spacing * gap, spec.free);
    if (t) out.push(t);
  }
  return out;
}

/** Rock proportions (x : y : z) per kind for a nominal size of 1 m. */
export const ROCK_ASPECT: Readonly<Record<RockKind, readonly [number, number, number]>> = {
  boulder: [1.3, 1, 1.15],
  slab: [1.7, 0.55, 1.2],
  spire: [0.7, 2.4, 0.65],
  outcrop: [1.5, 1, 1.1],
  ledge: [1.8, 0.8, 1.2],
  basalt: [1, 1.7, 1],
  crystal: [0.8, 1.7, 0.8],
  pebbles: [1.4, 0.45, 1],
};

/** Clumped rocks (boulder clusters at a cliff foot, scree): sizes skewed small (a few big, many small). */
export function clumpRocks(sc: ScatterContext, spec: ClumpRockSpec): RockPlacement[] {
  const aspect = ROCK_ASPECT[spec.kind];
  if (!aspect) throw new Error(`world/kit clumpRocks: unknown rock kind "${spec.kind}"`);
  const rng = new WorldRng(subSeed(spec.seed, 0xb5));
  const pts = shuffle(filtered(spec), new WorldRng(subSeed(spec.seed, 0xb3)));
  const max = spec.max ?? Infinity;
  const out: RockPlacement[] = [];
  for (const [x, z] of pts) {
    if (out.length >= max) break;
    const u = rng.next();
    const s = spec.size[0] + (spec.size[1] - spec.size[0]) * u * u;
    const jx = 0.85 + 0.3 * rng.next();
    const jy = 0.85 + 0.3 * rng.next();
    const jz = 0.85 + 0.3 * rng.next();
    const tilt = rng.next() - 0.5;
    const tilt2 = rng.next() - 0.5;
    const r = sc.rock(spec.kind, x, z, s * aspect[0] * jx, s * aspect[1] * jy, s * aspect[2] * jz, spec.mat ?? 0, spec.free);
    if (!r) continue;
    if (spec.kind === 'slab') {
      r.tiltX = tilt * 0.36;
      r.tiltZ = tilt2 * 0.36;
    } else if (spec.kind === 'spire' || spec.kind === 'basalt') {
      r.tiltX = tilt * 0.16;
      r.tiltZ = tilt2 * 0.16;
    }
    out.push(r);
  }
  return out;
}

/** Clumped props by PROP_DEFS id (haystacks, crates, urns...). */
export function clumpProps(sc: ScatterContext, spec: ClumpPropSpec): PropPlacement[] {
  for (const id of spec.ids) if (!PROP_DEFS[id]) throw new Error(`world/kit clumpProps: unknown prop "${id}"`);
  if (spec.ids.length === 0) return [];
  const rng = new WorldRng(subSeed(spec.seed, 0xb6));
  const pts = shuffle(filtered(spec), new WorldRng(subSeed(spec.seed, 0xb3)));
  const max = spec.max ?? Infinity;
  const sc0 = spec.scale ?? [1, 1];
  const out: PropPlacement[] = [];
  for (const [x, z] of pts) {
    if (out.length >= max) break;
    const id = spec.ids[rng.int(spec.ids.length)] as string;
    const scale = sc0[0] + (sc0[1] - sc0[0]) * rng.next();
    const yaw = rng.next() * TAU;
    const p = sc.prop(id, x, z, yaw, scale, spec.free);
    if (p) out.push(p);
  }
  return out;
}
