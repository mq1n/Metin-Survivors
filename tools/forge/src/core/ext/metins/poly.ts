// Convex polyhedron kit for crisp faceted hard-surface rocks/crystals: half-space clipping, Voronoi fracture, edge chamfers.
// Faces are outward-facing counter-clockwise polygons (flat shaded; vertices are NOT shared between faces).
// Used by the metin stones (archetypes/metin) — additive ext, no core semantics touched.
import type { Vec3 } from '../../math.ts';
import { vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../math.ts';
import type { Rng } from '../../rng.ts';

/** face classes (paint / glow rules): outer stone surface, inner fracture face (glows when it is exposed), edge chamfer */
export const CLS = { OUTER: 0, CRACK: 1, CHAMFER: 2 } as const;

export interface Face {
  pts: Vec3[];
  cls: number;
  /** index of the hull plane this outer face lies on (-1 none): decals/sigils bind to a plane */
  plane: number;
}

export interface Plane {
  n: Vec3;
  d: number;
  plane?: number;
}

const EPS = 1e-6;

const polyNormal = (pts: readonly Vec3[]): Vec3 => {
  let n: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < pts.length; i++) {
    const c = vcross(vsub(pts[i]!, pts[0]!), vsub(pts[i + 1]!, pts[0]!));
    n = vadd(n, c);
  }
  return n;
};

export const faceNormal = (f: Face): Vec3 => vnorm(polyNormal(f.pts));
export const faceArea = (f: Face): number => vlen(polyNormal(f.pts)) / 2;

function cleanPolygon(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-5) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0]!, b = out[out.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-5) out.pop();
    else break;
  }
  return out;
}

export class Poly {
  constructor(public faces: Face[]) {}

  clone(): Poly {
    return new Poly(this.faces.map((f) => ({ ...f, pts: f.pts.map((p) => [...p] as Vec3) })));
  }

  static box(min: Vec3, max: Vec3): Poly {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const f = (...p: Vec3[]): Face => ({ pts: p, cls: CLS.OUTER, plane: -1 });
    return new Poly([
      f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
      f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]), // -z
      f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]), // +x
      f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
      f([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]), // +y
      f([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // -y
    ]);
  }

  /** intersection of half-spaces n·p <= d (a large box is clipped by every plane; planes must enclose a finite volume) */
  static fromPlanes(planes: readonly Plane[], reach = 40): Poly | null {
    let p: Poly | null = Poly.box([-reach, -reach, -reach], [reach, reach, reach]);
    for (const pl of planes) {
      p = p.clip(pl.n, pl.d, CLS.OUTER, pl.plane ?? -1);
      if (!p) return null;
    }
    return p;
  }

  /** keep n·p <= d; the new cut face gets `cls`/`plane`. Returns null if nothing is left. */
  clip(n: Vec3, d: number, cls: number, plane = -1): Poly | null {
    const out: Face[] = [];
    const cap: Vec3[] = [];
    let capExists = false;
    for (const f of this.faces) {
      const m = f.pts.length;
      const s = f.pts.map((p) => vdot(n, p) - d);
      if (s.every((v) => v <= EPS)) {
        out.push(f);
        if (s.every((v) => Math.abs(v) <= EPS)) capExists = true;
        for (let i = 0; i < m; i++) if (Math.abs(s[i]!) <= EPS) cap.push(f.pts[i]!);
        continue;
      }
      if (s.every((v) => v >= -EPS)) {
        for (let i = 0; i < m; i++) if (Math.abs(s[i]!) <= EPS) cap.push(f.pts[i]!);
        continue;
      }
      const poly: Vec3[] = [];
      for (let i = 0; i < m; i++) {
        const a = f.pts[i]!, b = f.pts[(i + 1) % m]!;
        const sa = s[i]!, sb = s[(i + 1) % m]!;
        if (sa <= EPS) poly.push(a);
        if (Math.abs(sa) <= EPS) cap.push(a);
        if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) {
          const t = sa / (sa - sb);
          const q: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          poly.push(q);
          cap.push(q);
        }
      }
      const cl = cleanPolygon(poly);
      if (cl.length >= 3 && vlen(polyNormal(cl)) > 1e-9) out.push({ pts: cl, cls: f.cls, plane: f.plane });
    }
    if (out.length === 0) return null;
    if (!capExists) {
      // unique cap points, ordered counter-clockwise about +n
      const uniq: Vec3[] = [];
      for (const p of cap) if (!uniq.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-5)) uniq.push(p);
      if (uniq.length >= 3) {
        let c: Vec3 = [0, 0, 0];
        for (const p of uniq) c = vadd(c, p);
        c = vscale(c, 1 / uniq.length);
        const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u = vnorm(vcross(ref, n));
        const v = vcross(n, u);
        uniq.sort((a, b) => Math.atan2(vdot(vsub(a, c), v), vdot(vsub(a, c), u)) - Math.atan2(vdot(vsub(b, c), v), vdot(vsub(b, c), u)));
        if (vlen(polyNormal(uniq)) > 1e-9) out.push({ pts: uniq, cls, plane });
      }
    }
    return new Poly(out);
  }

  /** all distinct vertices */
  vertices(): Vec3[] {
    const v: Vec3[] = [];
    for (const f of this.faces) for (const p of f.pts) if (!v.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-5)) v.push(p);
    return v;
  }

  centroid(): Vec3 {
    const v = this.vertices();
    let c: Vec3 = [0, 0, 0];
    for (const p of v) c = vadd(c, p);
    return v.length ? vscale(c, 1 / v.length) : c;
  }

  bounds(): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const f of this.faces) for (const p of f.pts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
    return { min, max };
  }

  /** map every point (e.g. translate / rotate / scale about a pivot). Winding is flipped for mirroring transforms. */
  map(fn: (p: Vec3) => Vec3, flip = false): Poly {
    return new Poly(this.faces.map((f) => ({ ...f, pts: flip ? f.pts.map(fn).reverse() : f.pts.map(fn) })));
  }

  translate(t: Vec3): Poly {
    return this.map((p) => [p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
  }

  /** unique edges shared by exactly two faces: [faceA, faceB, p, q] */
  edges(): { a: number; b: number; p: Vec3; q: Vec3 }[] {
    const key = (p: Vec3): string => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    const map = new Map<string, { f: number; p: Vec3; q: Vec3 }>();
    const out: { a: number; b: number; p: Vec3; q: Vec3 }[] = [];
    this.faces.forEach((f, fi) => {
      for (let i = 0; i < f.pts.length; i++) {
        const p = f.pts[i]!, q = f.pts[(i + 1) % f.pts.length]!;
        const rev = map.get(`${key(q)}|${key(p)}`);
        if (rev) { out.push({ a: rev.f, b: fi, p, q }); map.delete(`${key(q)}|${key(p)}`); }
        else map.set(`${key(p)}|${key(q)}`, { f: fi, p, q });
      }
    });
    return out;
  }

  /**
   * Chip the convex edges with small bevel planes. `size` is the average cut depth (m); each edge gets a random scale in
   * [1-jitter, 1+jitter] and is skipped with probability `skip`. Short or nearly-flat edges are left alone.
   */
  chamfer(size: number, rng: Rng, opts: { jitter?: number; skip?: number; minAngle?: number; clsOnly?: number[] } = {}): Poly {
    const jitter = opts.jitter ?? 0.5, skip = opts.skip ?? 0.12, minAng = Math.cos(((opts.minAngle ?? 22) * Math.PI) / 180);
    const cuts: { n: Vec3; d: number }[] = [];
    for (const e of this.edges()) {
      const fa = this.faces[e.a]!, fb = this.faces[e.b]!;
      if (opts.clsOnly && !(opts.clsOnly.includes(fa.cls) && opts.clsOnly.includes(fb.cls))) continue;
      const na = faceNormal(fa), nb = faceNormal(fb);
      if (vdot(na, nb) > minAng) continue;
      const h = size * (1 + (rng.next() * 2 - 1) * jitter);
      if (rng.next() < skip || vlen(vsub(e.q, e.p)) < h * 3.2) continue;
      const nm = vnorm(vadd(na, nb));
      cuts.push({ n: nm, d: vdot(nm, e.p) - h });
    }
    let p: Poly = this;
    for (const c of cuts) {
      const r = p.clip(c.n, c.d, CLS.CHAMFER, -1);
      if (r) p = r;
    }
    return p;
  }
}

/** plane for a prism side: horizontal direction angle `a` (rad, 0 = +x, pi/2 = +z), distance `r` at y=0, inward lean `tilt` (rad) going up */
export function sidePlane(a: number, r: number, tilt: number, plane: number, y0 = 0): Plane {
  const dh: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const n = vnorm([dh[0] * Math.cos(tilt), Math.sin(tilt), dh[2] * Math.cos(tilt)]);
  const p0: Vec3 = [dh[0] * r, y0, dh[2] * r];
  return { n, d: vdot(n, p0), plane };
}

/** plane for a roof / crown cut: horizontal direction `a`, slope angle `slope` above horizontal (pi/2 = vertical wall), passing through point `through` */
export function roofPlane(a: number, slope: number, through: Vec3, plane: number): Plane {
  const n = vnorm([Math.cos(a) * Math.cos(slope), Math.sin(slope), Math.sin(a) * Math.cos(slope)]);
  return { n, d: vdot(n, through), plane };
}

/** split a convex solid by the plane n·p = d into [below, above] with a crack of width `gap` (both halves get CRACK cut faces) */
export function splitPoly(p: Poly, n: Vec3, d: number, gap: number): [Poly | null, Poly | null] {
  const nn = vnorm(n);
  const below = p.clip(nn, d - gap / 2, CLS.CRACK, -1);
  const above = p.clip([-nn[0], -nn[1], -nn[2]], -(d + gap / 2), CLS.CRACK, -1);
  return [below, above];
}

/**
 * Voronoi fracture of a convex body. Cells are separated by `gap` (m, total width of the crack between neighbours) and
 * anisotropic: `aniso` weights Y distances (>1 = flatter, more horizontal slabs; <1 = tall columns).
 */
export function fracture(body: Poly, seeds: readonly Vec3[], gap: number, aniso = 1): Poly[] {
  const out: Poly[] = [];
  for (let i = 0; i < seeds.length; i++) {
    let cell: Poly | null = body.clone();
    for (let j = 0; j < seeds.length && cell; j++) {
      if (i === j) continue;
      const si = seeds[i]!, sj = seeds[j]!;
      const dv = vsub(sj, si);
      const n = vnorm([dv[0], dv[1] * aniso * aniso, dv[2]]);
      const mid = vscale(vadd(si, sj), 0.5);
      cell = cell.clip(n, vdot(n, mid) - gap / 2, CLS.CRACK, -1);
    }
    if (cell && cell.faces.length >= 4) out.push(cell);
  }
  return out;
}
