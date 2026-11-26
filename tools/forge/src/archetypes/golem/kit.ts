// Hard-surface kit for the golem archetype: convex hulls with a tight smooth-max bevel (carved glacier blocks, basalt columns,
// ice crystals, chipped corners), all as ordinary SDF nodes that drop into a `Ctx` / `Body`.
//
//   Hull            convex polytope = max over face planes, blended with `smax(w)` so every edge carries a ~w bevel
//   block()         off-axis slab: rotated, tapered / sheared frustum, jittered corners, chipped corners / edges
//   chunk()         faceted boulder: hull of a jittered point cloud (overhanging shoulder boulders, fists, knee blocks)
//   crystal()       hexagonal-ish ice crystal / spike: ring(s) + apex (icicles, crown spikes, horns)
//   column()        hexagonal basalt column with a jointed (tilted) top
//   groove()        thin rounded slot for `cut` (panel seams, finger grooves, eye slits)
import { type Aabb, type Quat, type Vec3, qeuler, qrotate, vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Sdf as SdfBase } from '../../core/sdf/node.ts';
import { RoundedBox } from '../../core/sdf/primitives.ts';

const DEG = Math.PI / 180;

/** euler degrees (x, y, z) -> quaternion (same convention as `qeuler`) */
export const qd = (x = 0, y = 0, z = 0): Quat => qeuler(x * DEG, y * DEG, z * DEG);

export interface Plane {
  n: Vec3;
  h: number;
}

/** convex polytope as the smooth intersection of half-spaces `n . p <= h` */
export class Hull extends SdfBase {
  private readonly pl: Float64Array;
  private readonly cnt: number;
  private readonly box: Aabb;
  constructor(
    planes: readonly Plane[],
    readonly w: number,
    bounds: Aabb,
  ) {
    super();
    this.cnt = planes.length;
    this.pl = new Float64Array(planes.length * 4);
    planes.forEach((p, i) => this.pl.set([p.n[0], p.n[1], p.n[2], p.h], i * 4));
    this.box = bounds;
  }

  d(x: number, y: number, z: number): number {
    const P = this.pl, n = this.cnt, w = this.w;
    let acc = P[0]! * x + P[1]! * y + P[2]! * z - P[3]!;
    for (let i = 1; i < n; i++) {
      const o = i * 4;
      const b = P[o]! * x + P[o + 1]! * y + P[o + 2]! * z - P[o + 3]!;
      const diff = acc > b ? acc - b : b - acc;
      if (diff >= w) {
        if (b > acc) acc = b;
      } else {
        const m = acc > b ? acc : b;
        const hh = (w - diff) / w;
        acc = m + (hh * hh * hh * w) / 6;
      }
    }
    return acc;
  }

  protected computeBounds(): Aabb {
    return this.box;
  }

  /** hull of a point set (planes through every supporting triple), bounds = the points' box; `chips` slices random vertices off */
  static fromPoints(pts: readonly Vec3[], w: number, o: { chips?: number; chipDepth?: [number, number]; seed?: string | number } = {}): Hull {
    const planes = hullPlanes(pts);
    const chips = o.chips ?? 0;
    if (chips > 0) {
      const rng = new Rng(o.seed ?? 'chips');
      const cen: Vec3 = [0, 0, 0];
      for (const p of pts) { cen[0] += p[0] / pts.length; cen[1] += p[1] / pts.length; cen[2] += p[2] / pts.length; }
      const [d0, d1] = o.chipDepth ?? [0.03, 0.08];
      const used = new Set<number>();
      for (let i = 0; i < chips; i++) {
        let vi = rng.int(0, pts.length - 1);
        for (let t = 0; t < pts.length && used.has(vi); t++) vi = (vi + 1) % pts.length;
        used.add(vi);
        const v = pts[vi]!;
        const nn = vnorm(vadd(vnorm(vsub(v, cen)), [rng.range(-0.35, 0.35), rng.range(-0.35, 0.35), rng.range(-0.35, 0.35)]));
        planes.push({ n: nn, h: vdot(nn, v) - rng.range(d0, d1) });
      }
    }
    return new Hull(planes, w, boxOf(pts, 0.002));
  }
}

function boxOf(pts: readonly Vec3[], pad: number): Aabb {
  const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i]!, p[i]!); mx[i] = Math.max(mx[i]!, p[i]!); }
  return { min: [mn[0] - pad, mn[1] - pad, mn[2] - pad], max: [mx[0] + pad, mx[1] + pad, mx[2] + pad] };
}

/** supporting planes of the convex hull of `pts` (O(n^4); fine for n <= ~24) */
export function hullPlanes(pts: readonly Vec3[]): Plane[] {
  const n = pts.length;
  const cen: Vec3 = [0, 0, 0];
  for (const p of pts) { cen[0] += p[0] / n; cen[1] += p[1] / n; cen[2] += p[2] / n; }
  const out: Plane[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const a = pts[i]!, b = pts[j]!, c = pts[k]!;
    let nr = vcross(vsub(b, a), vsub(c, a));
    const l = vlen(nr);
    if (l < 1e-9) continue;
    nr = vscale(nr, 1 / l);
    let h = vdot(nr, a);
    if (vdot(nr, cen) > h) { nr = vscale(nr, -1); h = -h; }
    let ok = true;
    for (let m = 0; m < n && ok; m++) if (vdot(nr, pts[m]!) > h + 1e-6) ok = false;
    if (!ok) continue;
    let dup = false;
    for (const q of out) if (vdot(q.n, nr) > 0.99995 && Math.abs(q.h - h) < 1e-5) { dup = true; break; }
    if (!dup) out.push({ n: nr, h });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ builders

export interface BlockOpts {
  /** euler degrees x, y, z about the centre */
  rot?: Vec3;
  /** top-face size multiplier (x, z): frustum slabs */
  top?: [number, number];
  /** bottom-face size multiplier (x, z) */
  bot?: [number, number];
  /** top-face shear (x, z metres) */
  shift?: [number, number];
  /** per-corner jitter (metres): non-planar faces, hand-cleaved look */
  jitter?: number;
  /** number of corner chips (a plane sliced off a random corner) and their depth range (metres) */
  chips?: number;
  chipDepth?: [number, number];
  seed?: string | number;
  /** bevel blend width (metres) */
  w?: number;
}

/** an off-axis slab: frustum + shear + jitter + chips, rotated about its centre */
export function block(c: Vec3, half: Vec3, o: BlockOpts = {}): Hull {
  const rng = new Rng(o.seed ?? 'block');
  const q = qd(...(o.rot ?? [0, 0, 0]));
  const top = o.top ?? [1, 1], bot = o.bot ?? [1, 1], sh = o.shift ?? [0, 0];
  const jit = o.jitter ?? 0;
  const loc: Vec3[] = [];
  const corners: { s: Vec3; p: Vec3 }[] = [];
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const k = sy > 0 ? top : bot;
    let p: Vec3 = [sx * half[0] * k[0] + (sy > 0 ? sh[0] : 0), sy * half[1], sz * half[2] * k[1] + (sy > 0 ? sh[1] : 0)];
    if (jit > 0) p = [p[0] + rng.range(-jit, jit), p[1] + rng.range(-jit, jit), p[2] + rng.range(-jit, jit)];
    loc.push(p);
    corners.push({ s: [sx, sy, sz], p });
  }
  const planesL = hullPlanes(loc);
  // chips: slice a corner / edge off with a plane
  const chips = o.chips ?? 0;
  const [d0, d1] = o.chipDepth ?? [0.03, 0.08];
  const used = new Set<number>();
  for (let i = 0; i < chips; i++) {
    let ci = rng.int(0, 7);
    for (let t = 0; t < 8 && used.has(ci); t++) ci = (ci + 3) % 8;
    used.add(ci);
    const cr = corners[ci]!;
    const kx = rng.range(0.4, 1.2), ky = rng.range(0.4, 1.2), kz = rng.range(0.4, 1.2);
    const edge = rng.next() < 0.4 ? Math.floor(rng.next() * 3) : -1; // -1 = corner chip, 0..2 = edge chip (axis dropped)
    let nl = vnorm([cr.s[0] * kx / half[0], cr.s[1] * ky / half[1], cr.s[2] * kz / half[2]]);
    if (edge >= 0) { nl = [...nl] as Vec3; nl[edge] = 0; nl = vnorm(nl); }
    planesL.push({ n: nl, h: vdot(nl, cr.p) - rng.range(d0, d1) });
  }
  // to world: n' = R n, h' = h + n' . c
  const planes: Plane[] = planesL.map((p) => {
    const nw = qrotate(q, p.n);
    return { n: nw, h: p.h + vdot(nw, c) };
  });
  const wpts = loc.map((p) => vadd(c, qrotate(q, p)));
  return new Hull(planes, o.w ?? 0.014, boxOf(wpts, 0.004));
}

export interface ChunkOpts {
  rot?: Vec3;
  /** number of cloud points (8..16: big facets) */
  n?: number;
  /** radial jitter 0..1 */
  jitter?: number;
  /** flatten the bottom (y < -flat * r) so the chunk sits like a slab */
  flatBottom?: number;
  flatTop?: number;
  seed?: string | number;
  w?: number;
}

/** faceted boulder: hull of a jittered fibonacci cloud, scaled to `radii` */
export function chunk(c: Vec3, radii: Vec3, o: ChunkOpts = {}): Hull {
  const rng = new Rng(o.seed ?? 'chunk');
  const n = o.n ?? 11;
  const q = qd(...(o.rot ?? [0, 0, 0]));
  const jit = o.jitter ?? 0.22;
  const pts: Vec3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    let y = 1 - (2 * (i + 0.5)) / n;
    if (o.flatBottom !== undefined) y = Math.max(y, -o.flatBottom);
    if (o.flatTop !== undefined) y = Math.min(y, o.flatTop);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i + rng.range(-0.25, 0.25);
    const k = 1 + rng.range(-jit, jit);
    pts.push(vadd(c, qrotate(q, [Math.cos(th) * r * radii[0] * k, y * radii[1] * k, Math.sin(th) * r * radii[2] * k])));
  }
  return Hull.fromPoints(pts, o.w ?? 0.016);
}

export interface CrystalOpts {
  sides?: number;
  /** fraction of the length where the prism turns into the pointed tip (0 = pure pyramid) */
  shoulder?: number;
  /** radius multiplier at the shoulder ring (taper of the prism part) */
  taper?: number;
  /** random phase / radius jitter */
  seed?: string | number;
  jitter?: number;
  /** base ring squash along one axis (flat blades) */
  flat?: number;
  w?: number;
}

/** pointed crystal from `base` to `tip` with a hex(ish) prism body */
export function crystal(base: Vec3, tip: Vec3, rad: number, o: CrystalOpts = {}): Hull {
  const rng = new Rng(o.seed ?? 'crystal');
  const sides = o.sides ?? 6;
  const ax = vsub(tip, base);
  const len = vlen(ax);
  const dir = vnorm(ax);
  const up: Vec3 = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const u = vnorm(vcross(up, dir)), v = vcross(dir, u);
  const sh = o.shoulder ?? 0.55;
  const tp = o.taper ?? 0.9;
  const ph = rng.range(0, Math.PI * 2);
  const jit = o.jitter ?? 0.08;
  const flat = o.flat ?? 1;
  const pts: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ph + (i / sides) * Math.PI * 2;
    const r0 = rad * (1 + rng.range(-jit, jit));
    const cu = Math.cos(a) * r0, cv = Math.sin(a) * r0 * flat;
    pts.push(vadd(base, vadd(vscale(u, cu), vscale(v, cv))));
    if (sh > 0) {
      const r1 = rad * tp * (1 + rng.range(-jit, jit));
      pts.push(vadd(vadd(base, vscale(dir, len * sh)), vadd(vscale(u, Math.cos(a) * r1), vscale(v, Math.sin(a) * r1 * flat))));
    }
  }
  pts.push(tip);
  return Hull.fromPoints(pts, o.w ?? 0.006);
}

export interface ColumnOpts {
  sides?: number;
  /** top-face tilt (euler degrees x, z) for jointed basalt tops */
  tilt?: [number, number];
  /** top radius multiplier */
  top?: number;
  seed?: string | number;
  w?: number;
  /** phase offset of the hexagon (radians) */
  phase?: number;
}

/** prism from `base` along `dir` for `len` metres (hexagonal basalt column) */
export function column(base: Vec3, dir: Vec3, len: number, rad: number, o: ColumnOpts = {}): Hull {
  const rng = new Rng(o.seed ?? 'column');
  const sides = o.sides ?? 6;
  const d = vnorm(dir);
  const up: Vec3 = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const u = vnorm(vcross(up, d)), v = vcross(d, u);
  const ph = o.phase ?? rng.range(0, Math.PI);
  const tilt = o.tilt ?? [0, 0];
  const top = o.top ?? 1;
  const pts: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ph + (i / sides) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    pts.push(vadd(base, vadd(vscale(u, ca * rad), vscale(v, sa * rad))));
    // top ring: radius * top, plus a height offset from the tilt (slope of the jointed top)
    const dz = (ca * rad * Math.tan(tilt[0] * DEG) + sa * rad * Math.tan(tilt[1] * DEG));
    pts.push(vadd(vadd(base, vscale(d, len + dz)), vadd(vscale(u, ca * rad * top), vscale(v, sa * rad * top))));
  }
  return Hull.fromPoints(pts, o.w ?? 0.01);
}

export interface Ring {
  /** ring centre */
  c: Vec3;
  rx: number;
  rz: number;
  /** polygon sides (default 6) */
  sides?: number;
  /** polygon yaw (degrees) */
  rot?: number;
  /** ring plane tilt about x / z (degrees) */
  tilt?: [number, number];
  /** radius jitter fraction per vertex */
  jit?: number;
}

export interface PrismOpts {
  w?: number;
  seed?: string | number;
  chips?: number;
  chipDepth?: [number, number];
}

/** polygon ring points (irregular polygon in a tilted horizontal plane) */
export function ringPoints(r: Ring, rng: Rng): Vec3[] {
  const sides = r.sides ?? 6;
  const q = qd(...(r.tilt ? [r.tilt[0], 0, r.tilt[1]] as Vec3 : [0, 0, 0] as Vec3));
  const out: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((r.rot ?? 0) * DEG) + (i / sides) * Math.PI * 2 + rng.range(-0.06, 0.06) * (r.jit ? 1 : 0);
    const k = 1 + (r.jit ? rng.range(-r.jit, r.jit) : 0);
    out.push(vadd(r.c, qrotate(q, [Math.cos(a) * r.rx * k, 0, Math.sin(a) * r.rz * k])));
  }
  return out;
}

/** hull of two polygon rings: tapered / twisted / sheared irregular slabs (limbs, torso layers, flagstones) */
export function prism(a: Ring, b: Ring, o: PrismOpts = {}): Hull {
  const rng = new Rng(o.seed ?? 'prism');
  const pts = [...ringPoints(a, rng), ...ringPoints(b, rng)];
  return Hull.fromPoints(pts, o.w ?? 0.012, { ...(o.chips ? { chips: o.chips } : {}), ...(o.chipDepth ? { chipDepth: o.chipDepth } : {}), seed: o.seed ?? 'prism' });
}

/** thin rounded slot for `cut` / paint marks: centre, half extents, euler degrees */
export function groove(c: Vec3, half: Vec3, rot: Vec3 = [0, 0, 0], round = 0.004): Sdf {
  return new RoundedBox(c, half, round, qd(...rot));
}

/** the character's LEFT side is authored (+x); the right side mirrors positions across x = 0 */
export type Side = 1 | -1;
export const SIDES = [1, -1] as const;
export const mirrorX = (v: Vec3, sx: Side): Vec3 => [v[0] * sx, v[1], v[2]];
/** euler degrees mirrored across x = 0 (yaw / roll flip) */
export const mirrorRot = (r: Vec3, sx: Side): Vec3 => (sx === 1 ? r : [r[0], -r[1], -r[2]]);

export interface FlagOpts {
  /** polygon yaw (deg) at the bottom / top ring */
  rot?: [number, number];
  sides?: number;
  /** top ring radius multiplier */
  taper?: number;
  /** ring tilt about x / z (deg) */
  tilt?: [number, number];
  /** top ring shear (x, z metres) */
  shift?: [number, number];
  chips?: number;
  jit?: number;
  seed: string;
  w?: number;
}

/** irregular flagstone between heights y0 < y1 around (cx, cz) with radii (rx, rz): twisted / sheared / tilted / chipped */
export function flagstone(y0: number, y1: number, cx: number, cz: number, rx: number, rz: number, o: FlagOpts): Hull {
  const sd = o.sides ?? 5;
  const tp = o.taper ?? 1;
  const sh = o.shift ?? [0, 0];
  return prism(
    { c: [cx + sh[0], y1, cz + sh[1]], rx: rx * tp, rz: rz * tp, sides: sd, rot: o.rot?.[1] ?? 0, ...(o.tilt ? { tilt: o.tilt } : {}), jit: o.jit ?? 0.06 },
    { c: [cx, y0, cz], rx, rz, sides: sd, rot: o.rot?.[0] ?? 0, ...(o.tilt ? { tilt: [-o.tilt[0], -o.tilt[1]] as [number, number] } : {}), jit: o.jit ?? 0.06 },
    { ...(o.chips ? { chips: o.chips, chipDepth: [0.04, 0.1] as [number, number] } : {}), seed: o.seed, w: o.w ?? 0.012 },
  );
}

/** `flagstone` for the character's right/left side: x, yaw and shear mirror, the seed is suffixed by the side */
export function flagstoneSide(sx: Side, y0: number, y1: number, cx: number, cz: number, rx: number, rz: number, o: FlagOpts): Hull {
  return flagstone(y0, y1, cx * sx, cz, rx, rz, {
    ...o,
    seed: `${o.seed}${sx === 1 ? 'l' : 'r'}`,
    ...(o.rot ? { rot: [o.rot[0] * sx, o.rot[1] * sx] as [number, number] } : {}),
    ...(o.tilt ? { tilt: [o.tilt[0], o.tilt[1] * sx] as [number, number] } : {}),
    ...(o.shift ? { shift: [o.shift[0] * sx, o.shift[1]] as [number, number] } : {}),
  });
}
