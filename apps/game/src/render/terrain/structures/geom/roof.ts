// East-Asian curved roofs. A roof is a ring of eave corners plus matching ridge points; every eave edge becomes a face
//   P(u, v) = lerp(eave edge, ridge edge, v) with a dished slope (y = rise·v^sag), a flicked eave tip and eave corners
// that lift and flare outward (飞檐). Hip roofs, gable roofs with overhang and polygonal pagoda/lantern roofs are the same
// code with different corner / ridge lists. Faces carry the tile uv (metres), eave-tile discs, fascia, soffit and
// swept ridge / hip tiles.
import type { MeshBuilder, Paint, Vec2, Vec3 } from './builder';
import { KIND } from './kinds';
import { ellipsoid, tube } from './shapes';

export interface RoofCurve {
  /** ridge height above the eave line (m) */
  rise: number;
  /** slope dish exponent: y = rise·v^sag (1 straight, ~1.7 strongly concave) */
  sag: number;
  /** extra lift of the very eave edge (m) over `tipSpan` (fraction of the slope) */
  tip: number;
  tipSpan: number;
  /** extra lift of the eave corners (m); the lift follows |2u-1|^cornerPow along the edge and fades up the slope */
  corner: number;
  cornerPow: number;
  /** horizontal outward flare of the corners (m) */
  flare: number;
  /** slab thickness at the eave (m) */
  thick: number;
}

export const DEFAULT_CURVE: RoofCurve = { rise: 2, sag: 1.6, tip: 0.18, tipSpan: 0.14, corner: 0.7, cornerPow: 3, flare: 0.35, thick: 0.3 };

export interface RoofStyle {
  tile: Paint;
  /** soffit (underside) */
  under: Paint;
  /** eave board */
  fascia: Paint;
  /** round eave-tile ends */
  end: Paint;
  /** ridge / hip tiles */
  ridge: Paint;
}

export interface RoofSpec {
  /** eave corners (x, z), walking clockwise seen from +Y with +x right / +z toward the viewer (see roofRect) */
  corners: ReadonlyArray<Vec2>;
  /** ridge points above each corner (equal neighbours = hip apex) */
  ridge: ReadonlyArray<Vec2>;
  /** per edge i (corner i → i+1): build a slope (default all); false = open gable side */
  edges?: ReadonlyArray<boolean>;
  curve: RoofCurve;
  style: RoofStyle;
  /** quads along the eave edge / up the slope (default by edge length / 5) */
  nu?: number;
  nv?: number;
  /** ridge tile radius (0 = none) and hip tile radius */
  ridgeR?: number;
  hipR?: number;
  /** skip the soffit grid (roofs seen only from above, tiny roofs) */
  noUnder?: boolean;
  /** skip the eave-tile disc strip */
  noEnd?: boolean;
}

export interface RoofResult {
  /** point on the top surface of edge `i` at (u, v); v 0 = eave, 1 = ridge */
  point(i: number, u: number, v: number, out?: Vec3): Vec3;
  /** corner tips (eave corners after lift / flare) */
  tips: Vec3[];
  /** ridge height above the eave line */
  top: number;
}

/** rectangular hip (ridge < w) or gable (ridge = w) spec centred on the origin; w along x, d along z */
export function roofRect(w: number, d: number, ridgeLen: number): Pick<RoofSpec, 'corners' | 'ridge' | 'edges'> {
  const hw = w / 2;
  const hd = d / 2;
  const rl = ridgeLen / 2;
  const gable = ridgeLen >= w - 1e-6;
  return {
    corners: [
      [-hw, hd],
      [hw, hd],
      [hw, -hd],
      [-hw, -hd],
    ],
    ridge: [
      [-rl, 0],
      [rl, 0],
      [rl, 0],
      [-rl, 0],
    ],
    edges: gable ? [true, false, true, false] : [true, true, true, true],
  };
}

/** regular n-gon roof: eave radius R, ridge ring radius r0 (0 = pyramid); corner 0 sits at angle `a0` */
export function roofPoly(n: number, R: number, r0: number, a0 = 0): Pick<RoofSpec, 'corners' | 'ridge'> {
  const corners: Vec2[] = [];
  const ridge: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 - (i / n) * Math.PI * 2;
    corners.push([R * Math.cos(a), R * Math.sin(a)]);
    ridge.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
  }
  return { corners, ridge };
}

export function curvedRoof(b: MeshBuilder, s: RoofSpec): RoofResult {
  const n = s.corners.length;
  const c = s.curve;
  let cx = 0;
  let cz = 0;
  for (const q of s.corners) {
    cx += q[0];
    cz += q[1];
  }
  cx /= n;
  cz /= n;
  const cornerSpan = 0.55;

  const point = (i: number, u: number, v: number, out: Vec3 = [0, 0, 0]): Vec3 => {
    const A = s.corners[i] as Vec2;
    const B = s.corners[(i + 1) % n] as Vec2;
    const RA = s.ridge[i] as Vec2;
    const RB = s.ridge[(i + 1) % n] as Vec2;
    let x = (A[0] + (B[0] - A[0]) * u) * (1 - v) + (RA[0] + (RB[0] - RA[0]) * u) * v;
    let z = (A[1] + (B[1] - A[1]) * u) * (1 - v) + (RA[1] + (RB[1] - RA[1]) * u) * v;
    const edge = Math.abs(2 * u - 1);
    const sp = Math.pow(edge, c.cornerPow);
    const w = v < cornerSpan ? (1 - v / cornerSpan) ** 2 : 0;
    const tp = v < c.tipSpan ? c.tip * (1 - v / c.tipSpan) ** 2 : 0;
    const y = c.rise * Math.pow(v, c.sag) + tp + c.corner * sp * w;
    if (c.flare !== 0 && sp * w > 0) {
      const dx = x - cx;
      const dz = z - cz;
      const l = Math.hypot(dx, dz) || 1;
      x += (dx / l) * c.flare * sp * w;
      z += (dz / l) * c.flare * sp * w;
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  };

  const tips: Vec3[] = [];
  for (let i = 0; i < n; i++) tips.push(point(i, 0, 0));

  for (let i = 0; i < n; i++) {
    if (s.edges && s.edges[i] === false) continue;
    const A = s.corners[i] as Vec2;
    const B = s.corners[(i + 1) % n] as Vec2;
    const RA = s.ridge[i] as Vec2;
    const RB = s.ridge[(i + 1) % n] as Vec2;
    const eaveLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const ridgeLen = Math.hypot(RB[0] - RA[0], RB[1] - RA[1]);
    const run = Math.hypot((A[0] + B[0]) / 2 - (RA[0] + RB[0]) / 2, (A[1] + B[1]) / 2 - (RA[1] + RB[1]) / 2);
    const slope = Math.hypot(run, c.rise) * 1.04;
    const nu = s.nu ?? Math.max(4, Math.min(12, Math.ceil(eaveLen / 1.3)));
    const nv = s.nv ?? 5;
    const tmp: Vec3 = [0, 0, 0];
    // samples cluster toward the corners where the eave curve lives
    const warp = (u: number): number => 0.5 + 0.5 * Math.sin((u * 2 - 1) * (Math.PI / 2));

    // top surface; slope samples also cluster toward the eave where the tip flick lives
    const vw = (v: number): number => Math.pow(v, 1.5);
    b.grid(nu, nv, (u, v, out) => {
      const q = point(i, warp(u), vw(v), tmp);
      out[0] = q[0];
      out[1] = q[1];
      out[2] = q[2];
    }, s.style.tile, {
      uv: (u, v) => [(warp(u) - 0.5) * (eaveLen + (ridgeLen - eaveLen) * vw(v)), slope * vw(v)],
      // the tile field is darker toward the eave overhang and warmer near the ridge
      shade: (_u, v) => 0.92 + 0.12 * vw(v),
    });

    // fascia (eave board) + round tile ends along the eave line
    const endH = s.noEnd ? 0 : 0.17;
    const th = Math.max(0.05, c.thick - endH);
    const edgeLen = (u: number): number => warp(u) * eaveLen;
    b.grid(nu, 1, (u, v, out) => {
      const q = point(i, warp(u), 0, tmp);
      out[0] = q[0];
      out[1] = q[1] - endH - th * (1 - v);
      out[2] = q[2];
    }, s.style.fascia, { uv: (u, v) => [edgeLen(u), v * th] });
    if (!s.noEnd) {
      b.grid(nu, 1, (u, v, out) => {
        const q = point(i, warp(u), 0, tmp);
        out[0] = q[0];
        out[1] = q[1] - endH * (1 - v);
        out[2] = q[2];
      }, { ...s.style.end, k: KIND.tileEnd }, { uv: (u, v) => [edgeLen(u), v * endH] });
    }

    // soffit: coarse, seen only from below
    if (!s.noUnder) {
      b.grid(Math.max(2, Math.ceil(nu / 2)), 2, (u, v, out) => {
        const q = point(i, warp(u), v * 0.55, tmp);
        out[0] = q[0];
        out[1] = q[1] - c.thick * (1 - v * 0.8);
        out[2] = q[2];
      }, s.style.under, {
        flip: true,
        uv: (u, v) => [edgeLen(u), v * slope * 0.55],
        shade: (_u, v) => 0.7 + 0.3 * v,
      });
    }
  }

  // hip / rake tiles on the corner edges, ridge tile on the ridge edges
  if (s.hipR && s.hipR > 0) {
    for (let i = 0; i < n; i++) {
      const A = s.ridge[i] as Vec2;
      const hasEdge = (e: number): boolean => !s.edges || s.edges[((e % n) + n) % n] !== false;
      // corner i is shared by edge i (u = 0) and edge i-1 (u = 1); build once from the lower numbered existing one
      if (!hasEdge(i) && !hasEdge(i - 1)) continue;
      const cn = s.corners[i] as Vec2;
      if (Math.hypot(cn[0] - A[0], cn[1] - A[1]) < 0.05) continue;
      const path: Vec3[] = [];
      const steps = 4;
      for (let k = 0; k <= steps; k++) {
        const q = hasEdge(i) ? point(i, 0, k / steps) : point((i - 1 + n) % n, 1, k / steps);
        path.push([q[0], q[1] + s.hipR * 0.55, q[2]]);
      }
      tube(b, path, (t) => s.hipR! * (1.1 - 0.35 * t), 5, s.style.ridge, { caps: false });
    }
  }
  if (s.ridgeR && s.ridgeR > 0) {
    // the ridge line is shared by two slopes (front + back): draw it once, from the first slope that has one
    for (let i = 0; i < n; i++) {
      if (s.edges && s.edges[i] === false) continue;
      const RA = s.ridge[i] as Vec2;
      const RB = s.ridge[(i + 1) % n] as Vec2;
      if (Math.hypot(RB[0] - RA[0], RB[1] - RA[1]) < 0.3) continue;
      const path: Vec3[] = [];
      for (let k = 0; k <= 2; k++) {
        const q = point(i, k / 2, 1);
        path.push([q[0], q[1] + s.ridgeR * 0.5, q[2]]);
      }
      tube(b, path, s.ridgeR, 6, s.style.ridge, { caps: false });
      break;
    }
  }
  return { point, tips, top: c.rise };
}

/** small upturned tail ornament at an eave tip: curls up and slightly outward */
export function eaveTail(b: MeshBuilder, tip: Vec3, out: Vec2, size: number, p: Paint): void {
  const l = Math.hypot(out[0], out[1]) || 1;
  const dx = out[0] / l;
  const dz = out[1] / l;
  const path: Vec3[] = [
    [tip[0], tip[1], tip[2]],
    [tip[0] + dx * 0.22 * size, tip[1] + 0.32 * size, tip[2] + dz * 0.22 * size],
    [tip[0] + dx * 0.42 * size, tip[1] + 0.68 * size, tip[2] + dz * 0.42 * size],
  ];
  tube(b, path, (t) => 0.08 * size * (1 - 0.7 * t), 4, p);
}

/** ridge-end ornament (鸱吻): a thick body rising from the ridge and curling inward; `dir` = +1 / -1 along x */
export function chiwen(b: MeshBuilder, base: Vec3, dir: number, size: number, p: Paint, accent: Paint): void {
  const k = size;
  const x = (t: number): number => base[0] - dir * t * k;
  const path: Vec3[] = [
    [x(0), base[1] - 0.05 * k, base[2]],
    [x(0.0), base[1] + 0.55 * k, base[2]],
    [x(0.25), base[1] + 1.1 * k, base[2]],
    [x(0.65), base[1] + 1.1 * k, base[2]],
    [x(0.8), base[1] + 0.88 * k, base[2]],
  ];
  tube(b, path, (t) => k * (0.2 - 0.13 * t * t - 0.02 * t), 5, p);
  // pearl held in the curl
  b.at(x(0.78), base[1] + 0.78 * k, base[2]);
  ellipsoid(b, 0.1 * k, 0.1 * k, 0.1 * k, accent, { rings: 3, segs: 6 });
  b.pop();
}
