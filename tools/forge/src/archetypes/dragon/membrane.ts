// Wing membrane: an explicit triangulated sheet stretched between the wing bones. The same triangles give
//  (1) the SDF (thick rounded triangles, unioned into the body),
//  (2) analytic skin weights (barycentric blend of the corner bones: the membrane really stretches between finger bones),
//  (3) paint coordinates (panel id, u across the fan, v along the fingers) for veins and membrane gradients.
import type { Aabb, Vec3 } from '../../core/math.ts';
import { vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Sdf } from '../../core/sdf/node.ts';
import type { Anatomy } from './anatomy.ts';

export type WeightList = [string, number][];

export interface MemVert {
  p: Vec3;
  w: WeightList;
  /** u: 0..1 across the fan wedge (finger a -> finger b), v: 0 at the wrist .. 1 at the trailing edge */
  u: number;
  v: number;
  panel: number;
}

export interface MemTri {
  a: MemVert;
  b: MemVert;
  c: MemVert;
}

/** Rounded thick triangle: unsigned distance to the triangle minus `r`. */
export class ThickTriangle extends Sdf {
  private ab: Vec3;
  private ac: Vec3;
  private d00: number;
  private d01: number;
  private d11: number;
  constructor(
    public a: Vec3,
    public b: Vec3,
    public c: Vec3,
    public r: number,
  ) {
    super();
    this.ab = vsub(b, a);
    this.ac = vsub(c, a);
    this.d00 = dot(this.ab, this.ab);
    this.d01 = dot(this.ab, this.ac);
    this.d11 = dot(this.ac, this.ac);
  }
  d(x: number, y: number, z: number): number {
    return closest(this.a, this.ab, this.ac, this.d00, this.d01, this.d11, x, y, z).dist - this.r;
  }
  protected computeBounds(): Aabb {
    const { a, b, c, r } = this;
    return {
      min: [Math.min(a[0], b[0], c[0]) - r, Math.min(a[1], b[1], c[1]) - r, Math.min(a[2], b[2], c[2]) - r],
      max: [Math.max(a[0], b[0], c[0]) + r, Math.max(a[1], b[1], c[1]) + r, Math.max(a[2], b[2], c[2]) + r],
    };
  }
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** closest point on triangle (a, a+ab, a+ac) to p (Ericson): distance + barycentric (wa, wb, wc) */
function closest(a: Vec3, ab: Vec3, ac: Vec3, d00: number, d01: number, d11: number, x: number, y: number, z: number): { dist: number; wa: number; wb: number; wc: number } {
  const apx = x - a[0], apy = y - a[1], apz = z - a[2];
  const d1 = ab[0] * apx + ab[1] * apy + ab[2] * apz;
  const d2 = ac[0] * apx + ac[1] * apy + ac[2] * apz;
  let v: number, w: number;
  if (d1 <= 0 && d2 <= 0) { v = 0; w = 0; }
  else {
    const bpx = apx - ab[0], bpy = apy - ab[1], bpz = apz - ab[2];
    const d3 = ab[0] * bpx + ab[1] * bpy + ab[2] * bpz;
    const d4 = ac[0] * bpx + ac[1] * bpy + ac[2] * bpz;
    if (d3 >= 0 && d4 <= d3) { v = 1; w = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); w = 0; }
      else {
        const cpx = apx - ac[0], cpy = apy - ac[1], cpz = apz - ac[2];
        const d5 = ab[0] * cpx + ab[1] * cpy + ab[2] * cpz;
        const d6 = ac[0] * cpx + ac[1] * cpy + ac[2] * cpz;
        if (d6 >= 0 && d5 <= d6) { v = 0; w = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { v = 0; w = d2 / (d2 - d6); }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / (d4 - d3 + (d5 - d6)); v = 1 - w; }
            else {
              const den = 1 / (va + vb + vc);
              v = vb * den; w = vc * den;
            }
          }
        }
      }
    }
  }
  const qx = a[0] + ab[0] * v + ac[0] * w, qy = a[1] + ab[1] * v + ac[1] * w, qz = a[2] + ab[2] * v + ac[2] * w;
  return { dist: Math.hypot(x - qx, y - qy, z - qz), wa: 1 - v - w, wb: v, wc: w };
}

const mixWL = (a: WeightList, b: WeightList, t: number): WeightList => {
  const m = new Map<string, number>();
  for (const [k, w] of a) m.set(k, (m.get(k) ?? 0) + w * (1 - t));
  for (const [k, w] of b) m.set(k, (m.get(k) ?? 0) + w * t);
  return [...m.entries()].filter(([, w]) => w > 1e-4);
};

interface Ray {
  pts: [Vec3, Vec3, Vec3];
  w: [WeightList, WeightList, WeightList];
}

export interface Membrane {
  side: 'l' | 'r';
  tris: MemTri[];
  /** thickness (metres) */
  thickness: number;
}

/** Build one wing's membrane in the bind pose: three fan wedges between four finger rays + an inner panel down to the hip. Panels sag between the bones (camber). */
export function buildMembrane(a: Anatomy, sx: 1 | -1): Membrane {
  const s = a.s;
  const side = sx === 1 ? 'l' : 'r';
  const m = (v: Vec3): Vec3 => (sx === 1 ? v : [-v[0], v[1], v[2]]);
  const w = a.wing;
  const W = m(w.W), K1 = m(w.K1), T1 = m(w.T1), K2 = m(w.K2), T2 = m(w.T2), T3 = m(w.T3), T4 = m(w.T4), H = m(w.H), S = m(w.S), E = m(w.E);
  const M3 = vlerp(W, T3, 0.5);
  const M4 = vlerp(W, T4, 0.5);
  const n = (b: string): string => `${b}_${side}`;
  const fore: WeightList = [[n('wing_fore'), 1]];
  const ray1: Ray = { pts: [W, K1, T1], w: [fore, [[n('wing_f1a'), 0.5], [n('wing_f1b'), 0.5]], [[n('wing_f1b'), 1]]] };
  const ray2: Ray = { pts: [W, K2, T2], w: [fore, [[n('wing_f2a'), 0.5], [n('wing_f2b'), 0.5]], [[n('wing_f2b'), 1]]] };
  const ray3: Ray = { pts: [W, M3, T3], w: [fore, [[n('wing_f3'), 1]], [[n('wing_f3'), 1]]] };
  const ray4: Ray = { pts: [W, M4, T4], w: [fore, [[n('wing_f4'), 1]], [[n('wing_f4'), 1]]] };

  const tris: MemTri[] = [];
  const NA = 12;
  const cam = 0.34 * s;
  let panel = 0;
  const camber = (p: Vec3, k: number): Vec3 => [p[0], p[1] - cam * k, p[2]];

  // ---- fan wedges about the wrist: rows = wrist / knuckle ring / trailing arc. Pointed cusps at the finger tips (sin^0.7), sagging panels between bones.
  const wedge = (ra: Ray, rb: Ray, bow: number): void => {
    const arc: MemVert[] = [];
    const ring: MemVert[] = [];
    const wrist: MemVert[] = [];
    const tipMid = vlerp(ra.pts[2], rb.pts[2], 0.5);
    const inward = vnorm(vsub(W, tipMid));
    for (let i = 0; i <= NA; i++) {
      const u = i / NA;
      const sag = Math.pow(Math.sin(Math.PI * u), 0.6);
      const bell = Math.sin(Math.PI * u);
      const pleat = Math.sin(Math.PI * 3 * u) * 0.07 * s;
      const tip = camber(vadd(vlerp(ra.pts[2], rb.pts[2], u), vadd(vscale(inward, bow * s * sag), [0, pleat * 0.8, 0])), bell * 0.45);
      const kn = camber(vadd(vlerp(ra.pts[1], rb.pts[1], u), vadd(vscale(inward, bow * s * sag * 0.35), [0, pleat, 0])), bell);
      arc.push({ p: tip, w: mixWL(ra.w[2], rb.w[2], u), u, v: 1, panel });
      ring.push({ p: kn, w: mixWL(ra.w[1], rb.w[1], u), u, v: 0.5, panel });
      wrist.push({ p: W, w: fore, u, v: 0, panel });
    }
    for (let i = 0; i < NA; i++) {
      tris.push({ a: wrist[i]!, b: ring[i]!, c: ring[i + 1]! });
      tris.push({ a: ring[i]!, b: arc[i]!, c: arc[i + 1]! });
      tris.push({ a: ring[i]!, b: arc[i + 1]!, c: ring[i + 1]! });
    }
    panel++;
  };
  wedge(ray1, ray2, 1.4);
  wedge(ray2, ray3, 1.25);
  wedge(ray3, ray4, 1.1);

  // ---- inner region: fan from the elbow over the boundary W -> M4 -> T4 -> (arc) -> H -> S
  const body: WeightList = [['spine', 1]];
  const pelvis: WeightList = [['pelvis', 1]];
  const chest: WeightList = [['chest', 1]];
  const f4: WeightList = [[n('wing_f4'), 1]];
  const poly: MemVert[] = [
    { p: W, w: fore, u: 0, v: 0, panel },
    { p: M4, w: f4, u: 0, v: 0.5, panel },
    { p: T4, w: f4, u: 0, v: 1, panel },
  ];
  const NB = 7;
  const mid = vlerp(T4, H, 0.5);
  const inward = vnorm(vsub(E, mid));
  for (let i = 1; i < NB; i++) {
    const u = i / NB;
    poly.push({ p: camber(vadd(vlerp(T4, H, u), vscale(inward, 0.8 * s * Math.pow(Math.sin(Math.PI * u), 0.7))), 0.4 * Math.sin(Math.PI * u)), w: mixWL(f4, pelvis, Math.min(1, u * 1.15)), u, v: 1, panel });
  }
  poly.push({ p: H, w: pelvis, u: 1, v: 1, panel });
  poly.push({ p: vlerp(H, S, 0.34), w: mixWL(pelvis, body, 0.9), u: 1, v: 0.66, panel });
  poly.push({ p: vlerp(H, S, 0.67), w: mixWL(body, chest, 0.6), u: 1, v: 0.33, panel });
  poly.push({ p: S, w: chest, u: 1, v: 0, panel });
  const apex: MemVert = { p: E, w: [[n('wing_arm'), 0.6], [n('wing_fore'), 0.4]], u: 0.5, v: 0, panel };
  for (let i = 0; i < poly.length - 1; i++) tris.push({ a: apex, b: poly[i]!, c: poly[i + 1]! });
  // the humerus-forearm notch: fill the triangle (S, E, W) so the leading edge is a clean bone line
  tris.push({ a: poly[poly.length - 1]!, b: apex, c: poly[0]! });
  return { side, tris, thickness: 0.09 * s };
}

/** Closest membrane triangle to p: distance + interpolated weights/coordinates. */
export function sampleMembrane(mem: Membrane, p: Vec3): { dist: number; w: WeightList; u: number; v: number; panel: number } {
  let best = Infinity;
  let out: { dist: number; w: WeightList; u: number; v: number; panel: number } | null = null;
  for (const t of mem.tris) {
    const ab = vsub(t.b.p, t.a.p), ac = vsub(t.c.p, t.a.p);
    const c = closest(t.a.p, ab, ac, dot(ab, ab), dot(ab, ac), dot(ac, ac), p[0], p[1], p[2]);
    if (c.dist < best) {
      best = c.dist;
      const m = new Map<string, number>();
      for (const [vert, k] of [[t.a, c.wa], [t.b, c.wb], [t.c, c.wc]] as const) for (const [bn, bw] of vert.w) m.set(bn, (m.get(bn) ?? 0) + bw * k);
      out = {
        dist: c.dist,
        w: [...m.entries()],
        u: t.a.u * c.wa + t.b.u * c.wb + t.c.u * c.wc,
        v: t.a.v * c.wa + t.b.v * c.wb + t.c.v * c.wc,
        panel: t.a.panel,
      };
    }
  }
  return out!;
}

/** Both wings' membranes with a one-point cache (skin weighting asks every bone for the same point in a row). */
export class MembraneSet {
  private lx = NaN;
  private ly = NaN;
  private lz = NaN;
  private last: { dist: number; w: Map<string, number> } = { dist: Infinity, w: new Map() };
  constructor(readonly wings: Membrane[]) {}
  at(x: number, y: number, z: number): { dist: number; w: Map<string, number> } {
    if (x === this.lx && y === this.ly && z === this.lz) return this.last;
    this.lx = x; this.ly = y; this.lz = z;
    const mem = this.wings[x >= 0 ? 0 : 1]!;
    const r = sampleMembrane(mem, [x, y, z]);
    this.last = { dist: r.dist, w: new Map(r.w) };
    return this.last;
  }
  bones(): string[] {
    const s = new Set<string>();
    for (const m of this.wings) for (const t of m.tris) for (const v of [t.a, t.b, t.c]) for (const [b] of v.w) s.add(b);
    return [...s];
  }
}

/**
 * Skin-weight source for one bone over the membrane: d = -tau ln(w), so the core's weight rule exp(-d/tau) reproduces the analytic
 * barycentric weight exactly wherever the membrane is the nearest surface (it is >> beyond `cutoff`, leaving the other sources alone).
 */
export class MembraneWeightField extends Sdf {
  constructor(
    private set: MembraneSet,
    private bone: string,
    private tau: number,
    private cutoff: number,
  ) {
    super();
  }
  d(x: number, y: number, z: number): number {
    const r = this.set.at(x, y, z);
    if (r.dist > this.cutoff) return 1e3;
    const w = r.w.get(this.bone) ?? 0;
    return w < 1e-3 ? 1e3 : -this.tau * Math.log(w);
  }
  protected computeBounds(): Aabb {
    return { min: [-20, -2, -20], max: [20, 20, 20] };
  }
}
