// Tapered tube (trunk / branch) and curved leaf-card emitters on top of MeshBuilder.
import { add, cross, dot, len, madd, mul, norm, perp, sub, type MeshBuilder, type V3 } from './geom';

export interface TubeSpec {
  pts: V3[];
  /** radius at every point (same length as pts) */
  radii: number[];
  sides: number;
  /** integer texture repeats around the circumference (keeps the seam closed) */
  uRep: number;
  /** v per metre along the tube (texture grain follows the trunk) */
  vPerM: number;
  u0?: number;
  v0?: number;
  /** ambient occlusion multiplier at a point on the axis (0..1) */
  ao: (p: V3, t: number) => number;
  /** sway weight 0..1 for a world-space (tree-local) point */
  sway: (p: V3) => number;
  /** high-frequency flutter weight along the tube (0 for trunks) */
  flutter?: number;
  /** extra aData.z value (ember / snow mask for bark) */
  mask?: number;
  tint?: V3;
  /** close the last ring with a flat cap (broken limbs) */
  cap?: boolean;
  /** radius multiplier by angle (radians) and path fraction: gnarled / lumpy trunks */
  wobble?: (a: number, t: number) => number;
}

/** Emits a tube along `pts` using parallel-transport frames; returns the first ring's vertex index. */
export function addTube(b: MeshBuilder, s: TubeSpec): number {
  const n = s.pts.length;
  const sides = s.sides;
  const tint = s.tint ?? [1, 1, 1];
  const flutter = s.flutter ?? 0;
  const mask = s.mask ?? 0;
  const first = b.vertexCount;
  let frameN: V3 | null = null;
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const p = s.pts[i] as V3;
    const pPrev = s.pts[Math.max(0, i - 1)] as V3;
    const pNext = s.pts[Math.min(n - 1, i + 1)] as V3;
    const tan = norm(sub(pNext, pPrev));
    if (frameN === null) frameN = perp(tan);
    else frameN = norm(sub(frameN, mul(tan, dot(frameN, tan))));
    const fn = frameN;
    const fb = cross(tan, fn);
    if (i > 0) arc += len(sub(p, pPrev));
    const r = s.radii[i] as number;
    const r1 = s.radii[Math.min(n - 1, i + 1)] as number;
    const r0 = s.radii[Math.max(0, i - 1)] as number;
    const seg = len(sub(pNext, pPrev)) || 1;
    const slope = (r1 - r0) / seg;
    const t = n > 1 ? i / (n - 1) : 0;
    const ao = s.ao(p, t);
    const sw = s.sway(p);
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rad: V3 = [fn[0] * ca + fb[0] * sa, fn[1] * ca + fb[1] * sa, fn[2] * ca + fb[2] * sa];
      const pos = madd(p, rad, r * (s.wobble ? s.wobble(a, t) : 1));
      const nrm = norm(madd(rad, tan, -slope));
      b.vertex(pos, nrm, (s.u0 ?? 0) + (k / sides) * s.uRep, (s.v0 ?? 0) + arc * s.vPerM, ao * tint[0], ao * tint[1], ao * tint[2], sw, flutter, mask, 0);
    }
  }
  const stride = sides + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = first + i * stride + k;
      b.quad(a, a + 1, a + stride + 1, a + stride);
    }
  }
  if (s.cap) {
    // flat, darkened end face (broken / sawn limbs); duplicated ring so the cap carries its own normal
    const last = s.pts[n - 1] as V3;
    const tan = norm(sub(last, s.pts[n - 2] as V3));
    const ao = s.ao(last, 1) * 0.5;
    const sw = s.sway(last);
    const ctr = b.vertex(last, tan, 0.5, 0.5, ao * tint[0], ao * tint[1], ao * tint[2], sw, flutter, mask, 0);
    const ring = first + (n - 1) * stride;
    const capFirst = b.vertexCount;
    for (let k = 0; k <= sides; k++) {
      const o = (ring + k) * 3;
      const a = (k / sides) * Math.PI * 2;
      b.vertex([b.pos[o] as number, b.pos[o + 1] as number, b.pos[o + 2] as number], tan, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, ao * tint[0], ao * tint[1], ao * tint[2], sw, flutter, mask, 0);
    }
    for (let k = 0; k < sides; k++) b.tri(ctr, capFirst + k, capFirst + k + 1);
  }
  return first;
}

/** Evaluates a quadratic-ish curve through control points: Catmull-Rom resample to `count` points. */
export function resample(ctrl: V3[], count: number): V3[] {
  if (ctrl.length < 3) {
    const out: V3[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      out.push(add(mul(ctrl[0] as V3, 1 - t), mul(ctrl[ctrl.length - 1] as V3, t)));
    }
    return out;
  }
  const out: V3[] = [];
  const segs = ctrl.length - 1;
  for (let i = 0; i < count; i++) {
    const f = (i / (count - 1)) * segs;
    const k = Math.min(segs - 1, Math.floor(f));
    const t = f - k;
    const p0 = ctrl[Math.max(0, k - 1)] as V3;
    const p1 = ctrl[k] as V3;
    const p2 = ctrl[k + 1] as V3;
    const p3 = ctrl[Math.min(ctrl.length - 1, k + 2)] as V3;
    const t2 = t * t;
    const t3 = t2 * t;
    const c = (a: number, bb: number, cc: number, d: number): number =>
      0.5 * (2 * bb + (-a + cc) * t + (2 * a - 5 * bb + 4 * cc - d) * t2 + (-a + 3 * bb - 3 * cc + d) * t3);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}

export interface CardSpec {
  /** centre of the card quad */
  c: V3;
  /** unit axes of the card plane (u = width direction, v = height direction; the texture's up is +v) */
  u: V3;
  v: V3;
  w: number;
  h: number;
  /** grid cells along u / v (1 = plain quad) */
  nu: number;
  nv: number;
  /** push of the card centre along its normal (pillow) in metres */
  bulge: number;
  /** vertical sag (metres, along `droop`) applied as b² towards the far edge (drooping boughs) */
  droop?: V3;
  /** where the card's v=0 edge sits: 0 = centred on c, 0.5 = starts at c and extends along +v */
  anchor: number;
  /** foliage texture slot (0/1) written to aData.z */
  sel: number;
  tint: V3;
  /** vertex normal for a position on the card */
  normal: (p: V3) => V3;
  ao: (p: V3) => number;
  sway: (p: V3) => number;
  flutter: number;
  /** mirror the texture horizontally */
  flip?: boolean;
}

/** Emits a (curved) leaf card; returns nothing, triangles go into `b`. */
export function addCard(b: MeshBuilder, s: CardSpec): void {
  const nu = s.nu;
  const nv = s.nv;
  const n = norm(cross(s.u, s.v));
  const first = b.vertexCount;
  for (let j = 0; j <= nv; j++) {
    const fv = j / nv;
    for (let i = 0; i <= nu; i++) {
      const fu = i / nu;
      const a = fu - 0.5;
      const bb = fv - s.anchor;
      // pillow: strongest in the middle, zero on the rim
      const pil = (1 - (a * 2) * (a * 2)) * (1 - (fv * 2 - 1) * (fv * 2 - 1));
      let p = add(s.c, add(mul(s.u, a * s.w), mul(s.v, bb * s.h)));
      p = madd(p, n, s.bulge * pil);
      if (s.droop) p = madd(p, s.droop, fv * fv);
      const ao = s.ao(p);
      const uu = s.flip ? 1 - fu : fu;
      b.vertex(p, s.normal(p), uu, fv, ao * s.tint[0], ao * s.tint[1], ao * s.tint[2], s.sway(p), s.flutter, s.sel, 0);
    }
  }
  const stride = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = first + j * stride + i;
      b.quad(a, a + 1, a + stride + 1, a + stride);
    }
  }
}
