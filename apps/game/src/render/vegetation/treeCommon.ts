// Shared pieces of the procedural tree generators: generation context (seeded streams, builders, LOD rules), limb
// paths, leaf blobs and the foliage-card helpers.
import type { TreeSpecies } from '../../world/layoutTypes';
import { WorldRng } from '../../world/rng';
import type { TreeDims } from '../../world/trees';
import { add, cross, len, madd, mul, norm, perp, rotate, saturate, smoothstep, sub, MeshBuilder, type V3 } from './geom';
import { addCard, addTube, resample } from './tubes';

export const UP: V3 = [0, 1, 0];

/** Zone-derived look switches (bark choice, snow dusting). */
export interface TreeStyle {
  snowy: boolean;
}

export interface TreeGenInput {
  species: TreeSpecies;
  dims: TreeDims;
  seed: number;
  lod: 0 | 1;
  style: TreeStyle;
}

export interface TreeParts {
  bark: MeshBuilder;
  foliage: MeshBuilder;
}

/** Everything a species generator needs; skeleton randomness (`r`) is independent of LOD, card randomness (`rc`) too. */
export class TreeGen {
  readonly r: WorldRng;
  readonly rc: WorldRng;
  readonly bark = new MeshBuilder();
  readonly fol = new MeshBuilder();
  readonly lod: 0 | 1;
  readonly dims: TreeDims;
  readonly style: TreeStyle;
  /** total height after per-variant variation */
  H = 0;

  constructor(inp: TreeGenInput) {
    this.r = new WorldRng(inp.seed * 7919 + 13);
    this.rc = new WorldRng(inp.seed * 104729 + 7);
    this.lod = inp.lod;
    this.dims = inp.dims;
    this.style = inp.style;
  }

  /** sway weight: grows with height (the shader squares it) */
  sway = (p: V3): number => saturate(p[1] / this.H);

  /** bark tube; texture repeat is chosen from the average radius so the grain keeps its aspect. LOD1 keeps every second ring of branches. */
  tube(pts: V3[], radii: number[], o: { sides: number; ao: (p: V3, t: number) => number; flutter?: number; cap?: boolean; mask?: number; tint?: V3; noThin?: boolean; wobble?: (a: number, t: number) => number }): void {
    if (this.lod === 1 && !o.noThin && pts.length >= 5) {
      const keep = pts.map((_, i) => i % 2 === 0 || i === pts.length - 1);
      pts = pts.filter((_, i) => keep[i]);
      radii = radii.filter((_, i) => keep[i]);
    }
    const rAvg = (radii[0] as number) * 0.5 + (radii[radii.length - 1] as number) * 0.5;
    const circ = Math.max(0.12, rAvg * Math.PI * 2);
    const uRep = Math.max(1, Math.round(circ / 1.15));
    addTube(this.bark, {
      pts,
      radii,
      sides: o.sides,
      uRep,
      vPerM: uRep / circ,
      u0: this.rc.next(),
      v0: this.rc.next() * 4,
      ao: o.ao,
      sway: this.sway,
      flutter: o.flutter ?? 0,
      // default bark mask = thickness (trunks 1, twigs ~0): snow only settles on stout wood
      mask: o.mask ?? Math.min(1, rAvg * 7),
      tint: o.tint,
      cap: o.cap,
      wobble: o.wobble,
    });
  }

  /** a leaf card in the foliage mesh */
  card(c: V3, u: V3, v: V3, w: number, h: number, o: { nu?: number; nv?: number; bulge?: number; droop?: V3; anchor?: number; sel?: number; tint?: V3; normal: (p: V3) => V3; ao: (p: V3) => number; flutter?: number; flip?: boolean }): void {
    addCard(this.fol, {
      c,
      u,
      v,
      w,
      h,
      nu: o.nu ?? (this.lod === 0 ? 2 : 1),
      nv: o.nv ?? (this.lod === 0 ? 2 : 1),
      bulge: o.bulge ?? 0,
      droop: o.droop,
      anchor: o.anchor ?? 0.5,
      sel: o.sel ?? 0,
      tint: o.tint ?? [1, 1, 1],
      normal: o.normal,
      ao: o.ao,
      sway: this.sway,
      flutter: o.flutter ?? 0.7,
      flip: o.flip,
    });
  }
}

/** Curved limb path: `up` bends the heading towards +Y per unit length (negative droops), `wob` adds irregularity. */
export function limbPath(r: WorldRng, start: V3, dir: V3, length: number, steps: number, up: number, wob: number): V3[] {
  const pts: V3[] = [start];
  let d = norm(dir);
  let p = start;
  const step = length / steps;
  for (let i = 0; i < steps; i++) {
    d = norm([d[0] + (r.next() - 0.5) * wob, d[1] + up * step + (r.next() - 0.5) * wob * 0.6, d[2] + (r.next() - 0.5) * wob]);
    p = madd(p, d, step);
    pts.push(p);
  }
  return pts;
}

/** radius profile r1 + (r0 - r1) (1 - t)^power over `n` points */
export function taper(n: number, r0: number, r1: number, power = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r1 + (r0 - r1) * Math.pow(1 - i / (n - 1), power));
  return out;
}

/** radius at arc fraction t of a path with `taper` params (for sub-branch start radii) */
export function radiusAt(r0: number, r1: number, power: number, t: number): number {
  return r1 + (r0 - r1) * Math.pow(1 - t, power);
}

/** point and unit tangent at fraction t along a polyline */
export function pointAt(pts: V3[], t: number): { p: V3; d: V3 } {
  const f = Math.min(pts.length - 1.0001, Math.max(0, t * (pts.length - 1)));
  const k = Math.floor(f);
  const a = pts[k] as V3;
  const b = pts[k + 1] as V3;
  const fr = f - k;
  return { p: [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr, a[2] + (b[2] - a[2]) * fr], d: norm(sub(b, a)) };
}

/** random unit vector */
export function randUnit(r: WorldRng): V3 {
  const z = r.next() * 2 - 1;
  const a = r.next() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return [Math.cos(a) * s, z, Math.sin(a) * s];
}

/** unit vector perpendicular to `d`, uniformly random around it */
export function randPerp(r: WorldRng, d: V3): V3 {
  const a = perp(d);
  return rotate(a, d, r.next() * Math.PI * 2);
}

/** a card basis (u,v) whose plane contains `along` (card v = along) and is rolled by `roll` about it */
export function basisAlong(along: V3, ref: V3, roll: number): { u: V3; v: V3 } {
  const lat = norm(cross(ref, along));
  const u = len(lat) < 0.2 ? perp(along) : rotate(lat, along, roll);
  return { u, v: along };
}

export interface Blob {
  c: V3;
  r: number;
  /** foliage colour multiplier shared by the lobe (autumn hue patches) */
  tint: V3;
  /** texture slot weights: probability of slot 1 */
  alt: number;
}

/**
 * Fills a leaf lobe with outward-facing cards (a loose shell), with lobe-spherical normals blended with the crown's
 * so the whole crown shades like one soft form.
 */
export function emitBlob(g: TreeGen, b: Blob, crownC: V3, crownR: number, count: number, size: [number, number], bulge: number): void {
  const rc = g.rc;
  const out = norm(sub(b.c, crownC));
  const normalFn = (p: V3): V3 => {
    const a = norm(sub(p, b.c));
    const c = norm(sub(p, crownC));
    const n = add(add(mul(a, 0.55), mul(c, 0.55)), mul(UP, 0.28));
    return norm(n);
  };
  const aoFn = (p: V3): number => {
    const dc = len(sub(p, crownC)) / crownR;
    const inner = smoothstep(0.18, 1.0, dc);
    const low = 0.72 + 0.28 * smoothstep(-0.9, 0.9, (p[1] - b.c[1]) / b.r);
    return (0.4 + 0.6 * inner) * low;
  };
  for (let i = 0; i < count; i++) {
    const rnd = randUnit(rc);
    const d = norm(add(mul(out, 0.7), rnd));
    const shell = b.r * (0.35 + 0.65 * Math.sqrt(rc.next()));
    const c = madd(b.c, d, shell);
    // card faces outwards; its roll is random
    const nrm = norm(add(d, mul(UP, 0.2)));
    const uAxis = randPerp(rc, nrm);
    const vAxis = norm(cross(nrm, uAxis));
    const sz = b.r * (size[0] + (size[1] - size[0]) * rc.next());
    const tint: V3 = [b.tint[0] * (0.94 + rc.next() * 0.12), b.tint[1] * (0.94 + rc.next() * 0.12), b.tint[2] * (0.94 + rc.next() * 0.12)];
    g.card(c, uAxis, vAxis, sz, sz * 0.97, { bulge: sz * bulge, sel: rc.next() < b.alt ? 1 : 0, tint, normal: normalFn, ao: aoFn, flip: rc.next() < 0.5 });
  }
}

/** variant seed → deterministic range helper on the skeleton stream */
export function range(r: WorldRng, a: number, b: number): number {
  return a + (b - a) * r.next();
}

export { resample };
