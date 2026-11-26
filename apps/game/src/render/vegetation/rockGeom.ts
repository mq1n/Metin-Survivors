// Procedural rock meshes. Every kind is built in a unit box (x,z in [-0.5,0.5], y in [0,1], flat bottom at y = 0) so the
// placement extents (sx, sy, sz) are the real size of the rock. Blob kinds (boulder, slab, spire, outcrop, pebbles) start
// from a welded cube-sphere lattice (no poles, no icosphere look), push it through a superellipsoid, low-frequency
// noise, soft-min cut planes (flat chiselled faces with softened edges), strata terraces and ridged crack grooves.
// Basalt bundles and crystal clusters are built from flat-shaded prisms. All variants come in two LODs.
// Zones core A2 (core builder A): `ledge` = a cliff-block rock with near-vertical faces and strong strata steps (rim risers),
// and the per-zone `RockOpts` (look.rocks.relief / rough): deeper crack grooves, crisper cut edges, surface roughness. The
// defaults (relief 1, rough 0) draw exactly the same random numbers and vertices as before.
import type { BufferGeometry } from 'three';
import type { RockKind } from '../../world/layoutTypes';
import { WorldRng } from '../../world/rng';
import { clamp, fbm3, MeshBuilder, ridge3, smoothstep, type V3 } from './geom';

export const ROCK_VARIANTS = 4;

/** Per-zone mesh knobs (look.rocks); absent = the meshes as they were before the zones core. */
export interface RockOpts {
  /** crack groove depth, groove width and cut-edge crispness multiplier (1 = as before; 2 = deep fractures) */
  relief?: number;
  /** surface roughness amplitude as a fraction of the radius (0 = smooth lumps as before; 0.03-0.06 = chipped stone) */
  rough?: number;
}

interface ResolvedOpts {
  relief: number;
  rough: number;
}

const DEFAULT_OPTS: ResolvedOpts = { relief: 1, rough: 0 };

function resolveOpts(o: RockOpts | undefined): ResolvedOpts {
  if (!o) return DEFAULT_OPTS;
  return { relief: Math.min(3, Math.max(0.25, o.relief ?? 1)), rough: Math.min(0.12, Math.max(0, o.rough ?? 0)) };
}

export interface RockSet {
  kind: RockKind;
  /** index = variant * 2 + lod */
  geos: BufferGeometry[];
  tris: number[];
}

/** unwelded intermediate mesh in raw (pre-normalisation) space */
interface Raw {
  p: V3[];
  crack: number[];
  glow: number[];
  idx: number[];
  texK: number;
}

const rawMesh = (texK: number): Raw => ({ p: [], crack: [], glow: [], idx: [], texK });

interface BlobParams {
  /** superellipsoid exponent: 2 = sphere, larger = boxier */
  p: number;
  bulge: number;
  freq: number;
  cuts: [number, number];
  cutLo: number;
  cutHi: number;
  /** probability-weight of near-vertical cut normals (cliff faces) */
  cliff: number;
  /** softness of the cut-plane edges (smooth-min width); default 0.16 */
  soft?: number;
  /** adds a nearly horizontal top cut */
  topCut: boolean;
  taper: number;
  bend: number;
  strata: number;
  strataFreq: number;
  crack: number;
  crackFreq: number;
  floor: number;
  texK: number;
}

type BlobKind = 'boulder' | 'slab' | 'spire' | 'outcrop' | 'ledge';

const BLOBS: Record<BlobKind, BlobParams> = {
  boulder: { p: 2.6, bulge: 0.2, freq: 1.3, cuts: [4, 6], cutLo: 0.78, cutHi: 0.92, cliff: 0.2, topCut: false, taper: 0.1, bend: 0, strata: 0, strataFreq: 0, crack: 0.5, crackFreq: 1.3, floor: -0.72, texK: 1 },
  slab: { p: 5, bulge: 0.1, freq: 1.1, cuts: [3, 4], cutLo: 0.82, cutHi: 0.95, cliff: 0.5, topCut: true, taper: 0.04, bend: 0, strata: 1, strataFreq: 3.2, crack: 0.6, crackFreq: 1.4, floor: -0.8, texK: 0.9 },
  spire: { p: 2.2, bulge: 0.14, freq: 1.7, cuts: [8, 10], cutLo: 0.5, cutHi: 0.74, cliff: 0.85, topCut: false, soft: 0.07, taper: 0.55, bend: 0.3, strata: 0.3, strataFreq: 5, crack: 0.6, crackFreq: 1.5, floor: -0.85, texK: 0.8 },
  outcrop: { p: 3.0, bulge: 0.32, freq: 1.0, cuts: [9, 11], cutLo: 0.58, cutHi: 0.86, cliff: 0.9, topCut: true, soft: 0.1, taper: 0.3, bend: 0, strata: 0.7, strataFreq: 3, crack: 0.8, crackFreq: 1.2, floor: -0.78, texK: 0.45 },
  // A2: a squared block: box-like superellipsoid, only near-vertical cuts (cliff 1) with narrow chiselled edges, a flat top, a
  // little taper, and bold strata steps so a stack of these reads as a ledged cliff wall instead of a pillow
  ledge: { p: 8, bulge: 0.07, freq: 1.6, cuts: [6, 8], cutLo: 0.74, cutHi: 0.9, cliff: 1, topCut: true, soft: 0.035, taper: 0.1, bend: 0, strata: 1.5, strataFreq: 3.2, crack: 0.9, crackFreq: 1.7, floor: -0.9, texK: 0.55 },
};

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0);
  return Math.min(a, b) - (h * h) / (4 * k);
}

/** asymmetric sawtooth ledge profile in [0,1] */
function ledge(t: number): number {
  const f = t - Math.floor(t);
  return f < 0.82 ? f / 0.82 : (1 - f) / 0.18;
}

function randNormal(r: WorldRng, cliff: number): V3 {
  const a = r.next() * Math.PI * 2;
  const ny = r.next() < cliff ? (r.next() - 0.5) * 0.5 : r.next() * 1.4 - 0.5;
  const s = Math.sqrt(Math.max(0, 1 - ny * ny));
  const l = Math.hypot(s, ny) || 1;
  return [(Math.cos(a) * s) / l, ny / l, (Math.sin(a) * s) / l];
}

/** appends a blob to `raw` (unit-ish space, y in about [-1,1]); returns nothing */
function addBlob(raw: Raw, prm: BlobParams, r: WorldRng, seed: number, N: number, place?: { c: V3; s: V3 }, opt: ResolvedOpts = DEFAULT_OPTS): void {
  const M = N + 1;
  const cutSoft = (prm.soft ?? 0.16) / Math.sqrt(opt.relief);
  const strataK = opt.relief > 1 ? Math.sqrt(opt.relief) : 1;
  const cuts: Array<{ n: V3; d: number }> = [];
  const nCuts = prm.cuts[0] + Math.floor(r.next() * (prm.cuts[1] - prm.cuts[0] + 1));
  if (prm.topCut) cuts.push({ n: [(r.next() - 0.5) * 0.35, 1, (r.next() - 0.5) * 0.35], d: 0.72 + r.next() * 0.2 });
  for (let i = 0; i < nCuts; i++) cuts.push({ n: randNormal(r, prm.cliff), d: prm.cutLo + r.next() * (prm.cutHi - prm.cutLo) });
  for (const c of cuts) {
    const l = Math.hypot(c.n[0], c.n[1], c.n[2]) || 1;
    c.n = [c.n[0] / l, c.n[1] / l, c.n[2] / l];
  }
  const ox = r.next() * 40;
  const oy = r.next() * 40;
  const oz = r.next() * 40;
  const welded = new Map<number, number>();
  const vert = (i: number, j: number, k: number): number => {
    const key = (i * M + j) * M + k;
    const hit = welded.get(key);
    if (hit !== undefined) return hit;
    let cx = (i / N) * 2 - 1;
    let cy = (j / N) * 2 - 1;
    let cz = (k / N) * 2 - 1;
    const pn = Math.pow(Math.pow(Math.abs(cx), prm.p) + Math.pow(Math.abs(cy), prm.p) + Math.pow(Math.abs(cz), prm.p), 1 / prm.p) || 1;
    cx /= pn;
    cy /= pn;
    cz /= pn;
    const R = 1 + prm.bulge * fbm3(cx * prm.freq + ox, cy * prm.freq + oy, cz * prm.freq + oz, seed, 3);
    let q: V3 = [cx * R, cy * R, cz * R];
    for (const c of cuts) {
      const h = q[0] * c.n[0] + q[1] * c.n[1] + q[2] * c.n[2];
      const d = smin(h, c.d, cutSoft) - h;
      q = [q[0] + c.n[0] * d, q[1] + c.n[1] * d, q[2] + c.n[2] * d];
    }
    if (prm.strata > 0) {
      const t = q[1] * prm.strataFreq + fbm3(q[0] * 0.8 + ox, q[2] * 0.8 + oz, 1.3, seed + 5, 2) * 0.7;
      const k2 = 1 + prm.strata * strataK * 0.12 * (ledge(t) - 0.5);
      q = [q[0] * k2, q[1], q[2] * k2];
    }
    const rid = ridge3(q[0] * prm.crackFreq + ox, q[1] * prm.crackFreq + oy, q[2] * prm.crackFreq + oz, seed + 9, 3);
    // (relief > 1: the groove starts earlier, so it is wider as well as deeper)
    const g = smoothstep(opt.relief > 1 ? 0.52 - 0.07 * (opt.relief - 1) : 0.52, 0.92, rid);
    const dig = 1 - prm.crack * 0.1 * opt.relief * g;
    q = [q[0] * dig, q[1] * dig, q[2] * dig];
    if (opt.rough > 0) {
      // chipped surface: a second, higher-frequency displacement (zero for the default meshes: no extra noise draws)
      const rr = fbm3(q[0] * 2.2 + ox, q[1] * 2.2 + oy, q[2] * 2.2 + oz, seed + 31, 2);
      const kr = 1 + opt.rough * (rr - 0.5) * 2;
      q = [q[0] * kr, q[1] * kr, q[2] * kr];
    }
    const t01 = clamp((q[1] + 1) / 2, 0, 1);
    if (prm.taper > 0) {
      const k3 = 1 - prm.taper * Math.pow(t01, 1.1);
      q = [q[0] * k3, q[1], q[2] * k3];
    }
    if (prm.bend !== 0) q = [q[0] + prm.bend * t01 * t01, q[1], q[2]];
    q = [q[0], Math.max(q[1], prm.floor), q[2]];
    if (place) q = [place.c[0] + q[0] * place.s[0], place.c[1] + q[1] * place.s[1], place.c[2] + q[2] * place.s[2]];
    const id = raw.p.length;
    raw.p.push(q);
    raw.crack.push(g);
    raw.glow.push(0);
    welded.set(key, id);
    return id;
  };
  // [fixed axis value, axes a and b]: a x b points outwards for every face
  const faces: Array<(a: number, b: number) => [number, number, number]> = [
    (a, b) => [N, a, b],
    (a, b) => [0, b, a],
    (a, b) => [b, N, a],
    (a, b) => [a, 0, b],
    (a, b) => [a, b, N],
    (a, b) => [b, a, 0],
  ];
  for (const f of faces) {
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const v00 = vert(...f(a, b));
        const v10 = vert(...f(a + 1, b));
        const v11 = vert(...f(a + 1, b + 1));
        const v01 = vert(...f(a, b + 1));
        raw.idx.push(v00, v10, v11, v00, v11, v01);
      }
    }
  }
}

/** hexagonal prism column (flat sides, chamfered slanted top) */
function addColumn(raw: Raw, cx: number, cz: number, rad: number, h: number, tilt: V3, r: WorldRng): void {
  const sides = 6;
  const rot = Math.PI / 6;
  const ring = (rr: number, y: number, k: number): V3 => {
    const a = rot + (k / sides) * Math.PI * 2;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    return [cx + x, y + tilt[0] * x + tilt[2] * z, cz + z];
  };
  const push = (p: V3, crack: number): number => {
    raw.p.push(p);
    raw.crack.push(crack);
    raw.glow.push(0);
    return raw.p.length - 1;
  };
  const jitter = (): number => (r.next() - 0.5) * 0.012;
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    const b0 = ring(rad, 0, k);
    const b1 = ring(rad, 0, k1);
    const t0 = ring(rad, h, k);
    const t1 = ring(rad, h, k1);
    const c0 = ring(rad * 0.9, h + 0.014, k);
    const c1 = ring(rad * 0.9, h + 0.014, k1);
    // side wall
    const a = push(b0, 0);
    const b = push(b1, 0);
    const c = push(t1, 0);
    const d = push(t0, 0);
    raw.idx.push(a, b, c, a, c, d);
    // chamfer
    const e = push(t0, 0.2);
    const f = push(t1, 0.2);
    const g = push([c1[0], c1[1] + jitter(), c1[2]], 0.2);
    const hh = push([c0[0], c0[1] + jitter(), c0[2]], 0.2);
    raw.idx.push(e, f, g, e, g, hh);
  }
  // top cap
  const top = push([cx, h + 0.014 + tilt[0] * 0, cz], 0.1);
  const ids: number[] = [];
  for (let k = 0; k < sides; k++) {
    const c0 = ring(rad * 0.9, h + 0.014, k);
    ids.push(push(c0, 0.1));
  }
  for (let k = 0; k < sides; k++) raw.idx.push(top, ids[(k + 1) % sides] as number, ids[k] as number);
}

function buildBasalt(r: WorldRng): Raw {
  const raw = rawMesh(0.7);
  const rad = 0.14;
  const gap = 1.05;
  const dx = rad * Math.sqrt(3) * gap;
  const dz = rad * 1.5 * gap;
  const reach = 2.1;
  const cells: Array<{ x: number; z: number; d: number }> = [];
  for (let row = -2; row <= 2; row++) {
    for (let col = -2; col <= 2; col++) {
      const x = col * dx + (row & 1 ? dx / 2 : 0);
      const z = row * dz;
      const d = Math.hypot(x, z) / (dx * reach);
      if (d < 1 && (d < 0.45 || r.next() < 0.85 - d * 0.35)) cells.push({ x, z, d });
    }
  }
  for (const c of cells) {
    const h = clamp(1 - 0.62 * Math.pow(c.d, 1.15) - r.next() * 0.3, 0.2, 1);
    const tilt: V3 = [(r.next() - 0.5) * 0.5, 0, (r.next() - 0.5) * 0.5];
    addColumn(raw, c.x, c.z, rad * (0.94 + r.next() * 0.08), h, tilt, r);
  }
  return raw;
}

/** pointed hexagonal crystal; `dir` is the lean (unit y-up tilted) */
function addCrystal(raw: Raw, base: V3, dir: V3, len: number, rad: number, r: WorldRng): void {
  const sides = 6;
  // frame around dir
  const up = dir;
  const side: V3 = Math.abs(up[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const u: V3 = [up[1] * side[2] - up[2] * side[1], up[2] * side[0] - up[0] * side[2], up[0] * side[1] - up[1] * side[0]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  const ux: V3 = [u[0] / ul, u[1] / ul, u[2] / ul];
  const vx: V3 = [up[1] * ux[2] - up[2] * ux[1], up[2] * ux[0] - up[0] * ux[2], up[0] * ux[1] - up[1] * ux[0]];
  const rot = r.next() * 1.0;
  const at = (t: number, rr: number, k: number): V3 => {
    const a = rot + (k / sides) * Math.PI * 2;
    const ca = Math.cos(a) * rr;
    const sa = Math.sin(a) * rr;
    return [base[0] + up[0] * len * t + ux[0] * ca + vx[0] * sa, base[1] + up[1] * len * t + ux[1] * ca + vx[1] * sa, base[2] + up[2] * len * t + ux[2] * ca + vx[2] * sa];
  };
  const push = (p: V3, glow: number): number => {
    raw.p.push(p);
    raw.crack.push(0);
    raw.glow.push(glow);
    return raw.p.length - 1;
  };
  const tipT = 1;
  const shoulder = 0.72;
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    const a = push(at(0, rad * 0.9, k), 0.15);
    const b = push(at(0, rad * 0.9, k1), 0.15);
    const c = push(at(shoulder, rad, k1), 0.65);
    const d = push(at(shoulder, rad, k), 0.65);
    raw.idx.push(a, b, c, a, c, d);
    const e = push(at(shoulder, rad, k), 0.65);
    const f = push(at(shoulder, rad, k1), 0.65);
    const g = push(at(tipT, 0, 0), 1);
    raw.idx.push(e, f, g);
  }
}

function buildCrystals(r: WorldRng): Raw {
  const raw = rawMesh(0.8);
  const count = 5 + Math.floor(r.next() * 3);
  for (let i = 0; i < count; i++) {
    const main = i === 0;
    const az = r.next() * Math.PI * 2;
    const lean = main ? r.next() * 0.2 : 0.25 + r.next() * 0.6;
    const dir: V3 = [Math.cos(az) * Math.sin(lean), Math.cos(lean), Math.sin(az) * Math.sin(lean)];
    const dist = main ? 0 : 0.08 + r.next() * 0.16;
    const base: V3 = [Math.cos(az) * dist, 0, Math.sin(az) * dist];
    const len = main ? 1 : 0.3 + r.next() * 0.45;
    const rad = main ? 0.11 : 0.055 + r.next() * 0.035;
    addCrystal(raw, base, dir, len * 0.92, rad, r);
  }
  return raw;
}

function buildPebbles(r: WorldRng, seed: number, lod: number): Raw {
  const raw = rawMesh(2.4);
  const count = lod === 0 ? 4 : 3;
  const N = lod === 0 ? 3 : 2;
  const prm: BlobParams = { p: 2.4, bulge: 0.22, freq: 1.6, cuts: [1, 2], cutLo: 0.82, cutHi: 0.95, cliff: 0.2, topCut: true, taper: 0, bend: 0, strata: 0, strataFreq: 0, crack: 0, crackFreq: 1, floor: -0.55, texK: 2.4 };
  for (let i = 0; i < count; i++) {
    const a = r.next() * Math.PI * 2;
    const d = Math.sqrt(r.next()) * 0.32;
    const s = 0.1 + r.next() * 0.1;
    addBlob(raw, prm, r, seed + i * 13, N, { c: [Math.cos(a) * d, s * 0.55, Math.sin(a) * d], s: [s, s * 0.7, s * (0.8 + r.next() * 0.4)] });
  }
  return raw;
}

/** remaps `raw` into the unit box and emits a MeshBuilder with AO / tint vertex colours (welded meshes get smooth normals, per-face meshes stay flat) */
function finalize(raw: Raw, seed: number, texK: number, relief = 1): MeshBuilder {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of raw.p) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
    z0 = Math.min(z0, p[2]);
    z1 = Math.max(z1, p[2]);
  }
  const b = new MeshBuilder();
  const n: V3 = [0, 1, 0];
  for (let i = 0; i < raw.p.length; i++) {
    const p = raw.p[i] as V3;
    const x = (p[0] - x0) / (x1 - x0 || 1) - 0.5;
    const y = (p[1] - y0) / (y1 - y0 || 1);
    const z = (p[2] - z0) / (z1 - z0 || 1) - 0.5;
    const crack = raw.crack[i] as number;
    const ao = (0.5 + 0.5 * smoothstep(0, 0.28, y)) * (1 - Math.min(0.85, 0.42 * crack * relief)) * (0.9 + 0.1 * smoothstep(0.4, 1, y));
    const tn = fbm3(x * 2.2 + 3, y * 2.2, z * 2.2, seed + 77, 2);
    b.vertex([x, y, z], n, 0, 0, ao * (1 + 0.07 * tn), ao, ao * (1 - 0.07 * tn), 0, texK, 0, raw.glow[i] as number);
  }
  b.idx.push(...raw.idx);
  b.computeNormals();
  return b;
}

const RES: Record<BlobKind, [number, number]> = { boulder: [10, 5], slab: [9, 5], spire: [9, 5], outcrop: [11, 6], ledge: [12, 6] };

export function generateRocks(kind: RockKind, rockOpts?: RockOpts): RockSet {
  const opt = resolveOpts(rockOpts);
  const set: RockSet = { kind, geos: [], tris: [] };
  const salt = kind.length * 977 + kind.charCodeAt(0) * 31;
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    for (const lod of [0, 1] as const) {
      const seed = 500 + v * 4813 + salt;
      // the skeleton of LOD0 and LOD1 must match: same rng stream, different lattice resolution
      const r = new WorldRng(seed);
      let raw: Raw;
      let texK: number;
      if (kind === 'basalt') {
        raw = buildBasalt(r);
        texK = 0.7;
      } else if (kind === 'crystal') {
        raw = buildCrystals(r);
        texK = 0.8;
      } else if (kind === 'pebbles') {
        raw = buildPebbles(r, seed, lod);
        texK = 2.4;
      } else {
        const prm = BLOBS[kind as BlobKind];
        raw = rawMesh(prm.texK);
        addBlob(raw, prm, r, seed, RES[kind as BlobKind][lod], undefined, opt);
        texK = prm.texK;
      }
      const mb = finalize(raw, seed, texK, kind === 'basalt' || kind === 'crystal' || kind === 'pebbles' ? 1 : opt.relief);
      set.tris.push(mb.triangleCount);
      set.geos.push(mb.toGeometry());
    }
  }
  return set;
}
