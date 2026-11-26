// Faceted crystal primitives: convex polytopes defined by planes (exact flat facets, 1-Lipschitz), so ice spikes/horns
// keep crisp planar faces and sharp edges instead of reading as smooth blobs.
import { type Aabb, type Vec3, basisFromDirSide, vadd, vcross, vdot, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Sdf } from '../../core/sdf/node.ts';
import { SmoothUnion } from '../../core/sdf/ops.ts';

export interface Plane {
  n: Vec3;
  /** point on the plane */
  p: Vec3;
}

/** Intersection of half-spaces (max of plane distances). Exact flat faces, hard edges. */
export class Convex extends Sdf {
  private nx: Float64Array;
  private ny: Float64Array;
  private nz: Float64Array;
  private o: Float64Array;
  constructor(planes: Plane[], private box: Aabb) {
    super();
    const n = planes.length;
    this.nx = new Float64Array(n);
    this.ny = new Float64Array(n);
    this.nz = new Float64Array(n);
    this.o = new Float64Array(n);
    planes.forEach((pl, i) => {
      const u = vnorm(pl.n);
      this.nx[i] = u[0];
      this.ny[i] = u[1];
      this.nz[i] = u[2];
      this.o[i] = vdot(u, pl.p);
    });
  }
  d(x: number, y: number, z: number): number {
    let m = -Infinity;
    const nx = this.nx, ny = this.ny, nz = this.nz, o = this.o;
    for (let i = 0; i < nx.length; i++) {
      const v = nx[i]! * x + ny[i]! * y + nz[i]! * z - o[i]!;
      if (v > m) m = v;
    }
    return m;
  }
  protected computeBounds(): Aabb {
    return this.box;
  }
}

export interface CrystalOpts {
  sides?: number;
  /** fraction of the length taken by the pyramid tip */
  tipFrac?: number;
  /** top radius of the prism as a fraction of the base radius */
  topFrac?: number;
  twist?: number;
  /** random facet irregularity (0 = regular) */
  jitter?: number;
  rng?: Rng;
  /** rotate the tip facets by this fraction of a face step (0 = aligned, 0.5 = offset gem cut) */
  tipRot?: number;
  /** apex offset sideways (fraction of the base radius) */
  lean?: Vec3;
  /** hint for the first facet direction */
  side?: Vec3;
}

/**
 * Hexagonal-ish crystal: prism tapering from `rBase` at `base` to `topFrac*rBase` at (1 - tipFrac)*len, then a faceted
 * pyramid to the apex. The base cap sits at `base` (bury it inside the host body).
 */
export function crystal(base: Vec3, dir: Vec3, len: number, rBase: number, o: CrystalOpts = {}): Convex {
  const sides = o.sides ?? 6;
  const tipFrac = o.tipFrac ?? 0.28;
  const topFrac = o.topFrac ?? 0.72;
  const jit = o.jitter ?? 0.08;
  const rng = o.rng ?? new Rng(1);
  const { x, y: u, z } = basisFromDirSide(dir, o.side ?? [1, 0, 0]);
  const L1 = len * (1 - tipFrac);
  const rTop = rBase * topFrac;
  const apexOff = o.lean ?? [0, 0, 0];
  const apex: Vec3 = vadd(vadd(base, vscale(u, len)), vadd(vadd(vscale(x, apexOff[0] * rBase), vscale(u, apexOff[1] * rBase)), vscale(z, apexOff[2] * rBase)));
  const planes: Plane[] = [];
  planes.push({ n: vscale(u, -1), p: vadd(base, vscale(u, -0.02 * len)) });
  const radial = (phi: number): Vec3 => vadd(vscale(x, Math.cos(phi)), vscale(z, Math.sin(phi)));
  const step = (Math.PI * 2) / sides;
  for (let i = 0; i < sides; i++) {
    const phi = (o.twist ?? 0) + step * (i + jit * (rng.next() - 0.5) * 2);
    const rd = radial(phi);
    const rb = rBase * (1 + jit * 0.6 * (rng.next() - 0.5));
    const rt = rTop * (1 + jit * 0.6 * (rng.next() - 0.5));
    const n = vnorm(vadd(vscale(rd, L1), vscale(u, rb - rt)));
    planes.push({ n, p: vadd(base, vscale(rd, rb)) });
    // pyramid facet over this face (optionally rotated for a gem cut)
    const phi2 = phi + step * (o.tipRot ?? 0);
    const rd2 = radial(phi2);
    const topPt = vadd(vadd(base, vscale(u, L1)), vscale(rd2, rt));
    const toApex = vsub(apex, topPt);
    // facet normal: perpendicular to the edge direction around the ring and to the slope toward the apex
    const tang = vnorm(vsub(radial(phi2 + 0.01), radial(phi2 - 0.01)));
    let nn = vnorm(vcross(tang, toApex));
    if (vdot(nn, rd2) < 0) nn = vscale(nn, -1);
    planes.push({ n: nn, p: topPt });
  }
  const r = rBase * 1.5;
  const box: Aabb = {
    min: [Math.min(base[0], apex[0]) - r, Math.min(base[1], apex[1]) - r, Math.min(base[2], apex[2]) - r],
    max: [Math.max(base[0], apex[0]) + r, Math.max(base[1], apex[1]) + r, Math.max(base[2], apex[2]) + r],
  };
  return new Convex(planes, box);
}
/**
 * A bent crystal horn: a chain of tapering faceted prisms along `path` (radius profile `r` per path point, last = tip).
 * Joined with a tiny blend so the knees stay crisp.
 */
export function crystalHorn(path: Vec3[], radii: number[], o: CrystalOpts & { w?: number } = {}): Sdf {
  const rng = o.rng ?? new Rng(7);
  const parts: Sdf[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!;
    const d = vsub(b, a);
    const len = Math.hypot(d[0], d[1], d[2]);
    const last = i === path.length - 2;
    // overlap segments a bit so the joints fuse
    const ext = last ? 1 : 1.12;
    const rA = radii[i]!, rB = radii[i + 1]!;
    parts.push(crystal(a, d, len * ext, rA, { sides: o.sides ?? 6, tipFrac: last ? 0.5 : 0.08, topFrac: Math.max(rB / rA, 0.05) * (last ? 1 : 1), jitter: o.jitter ?? 0.05, rng, tipRot: o.tipRot ?? 0, twist: (o.twist ?? 0) + i * 0.35, ...(o.side ? { side: o.side } : {}) }));
  }
  return new SmoothUnion(parts.map((node) => ({ node, w: o.w ?? 0.005 })));
}

export interface PrismOpts {
  sides?: number;
  /** squash of the cross-section along its second axis (1 = round, <1 = blade) */
  flat?: number;
  twist?: number;
  /** hint for the first cross-section axis (the squashed axis is the other one) */
  side?: Vec3;
  /** end chamfer as a fraction of the end radius (0 = hard flat caps) */
  bevelA?: number;
  bevelB?: number;
}

/**
 * Tapered polygonal prism from a to b (flat planar faces, chamfered ends): hard-surface limb / barrel / blade segment.
 * Every side face is an exact plane, so decimation keeps the facets and the silhouette stays crisp.
 */
export function prism(a: Vec3, b: Vec3, rA: number, rB: number, o: PrismOpts = {}): Convex {
  const sides = o.sides ?? 6;
  const flat = o.flat ?? 1;
  const { x, y: u, z } = basisFromDirSide(vsub(b, a), o.side ?? [1, 0, 0]);
  const step = (Math.PI * 2) / sides;
  const ringPt = (c: Vec3, r: number, i: number): Vec3 => {
    const phi = (o.twist ?? 0) + step * i;
    return vadd(c, vscale(vadd(vscale(x, Math.cos(phi)), vscale(z, Math.sin(phi) * flat)), r));
  };
  const planes: Plane[] = [{ n: vscale(u, -1), p: a }, { n: u, p: b }];
  const bA = (o.bevelA ?? 0.3) * rA, bB = (o.bevelB ?? 0.3) * rB;
  for (let i = 0; i < sides; i++) {
    const A0 = ringPt(a, rA, i), A1 = ringPt(a, rA, i + 1), B0 = ringPt(b, rB, i), B1 = ringPt(b, rB, i + 1);
    let n = vnorm(vcross(vsub(A1, A0), vsub(B0, A0)));
    const mid = vscale(vadd(A0, A1), 0.5);
    if (vdot(n, vsub(mid, a)) < 0) n = vscale(n, -1);
    planes.push({ n, p: A0 });
    if (bA > 0) {
      const nc = vnorm(vsub(n, u));
      planes.push({ n: nc, p: vsub(mid, vscale(nc, bA)) });
    }
    if (bB > 0) {
      const nc = vnorm(vadd(n, u));
      planes.push({ n: nc, p: vsub(vscale(vadd(B0, B1), 0.5), vscale(nc, bB)) });
    }
  }
  const r = Math.max(rA, rB) * 1.15;
  const box: Aabb = {
    min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
    max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
  };
  return new Convex(planes, box);
}
