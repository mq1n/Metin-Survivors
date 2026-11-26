// Shared chest construction kit: mitre-joined plank/stave slabs along a 2-D profile, chamfered frame bands, lid vault profile,
// lid skeleton + `open` clip and a small treasure mound. All parts are closed convex hulls (overlap is fine: hidden faces are
// culled by the build pipeline); every part is built group-0 and stamped with zone/bone by `Assembly`.
import { type ClipSpec, sampleClip } from '../../core/anim/clip.ts';
import { keyed } from '../../core/anim/curve.ts';
import type { HardMesh } from '../../core/hard/hardmesh.ts';
import { DEG } from '../../core/math.ts';
import { Skeleton } from '../../core/skin/skeleton.ts';
import type { ClipData } from '../../core/anim/clip.ts';
import { type Mat4, type V3, compose, hull, lerp, move, rotX } from './geom.ts';

export type V2 = [number, number];
/** maps (profile a, profile b, extrusion e) to model space */
export type Map3 = (a: number, b: number, e: number) => V3;

export interface StaveOpts {
  /** thickness from the polyline inwards (m) */
  t: number;
  /** extrusion range */
  e0: number;
  e1: number;
  /** outset of each segment above the polyline (scalar or per segment) */
  outset?: number | readonly number[];
  /** chamfer at the segment ends (planks: a V-groove between neighbours): depth and width along the surface */
  chamferT?: { depth: number; width: number };
  /** chamfer along the extrusion ends (straps) */
  chamferE?: number;
}

/**
 * One convex slab per segment of an outer polyline (outward = right of travel), mitre-joined at shared vertices so adjacent
 * slabs close without gaps on the inside and form a V where `chamferT` is set.
 */
export function polyStaves(poly: readonly V2[], o: StaveOpts, map: Map3): HardMesh[] {
  const n = poly.length, segs = n - 1;
  const tan: V2[] = [], nrm: V2[] = [];
  for (let i = 0; i < segs; i++) {
    const dx = poly[i + 1]![0] - poly[i]![0], dy = poly[i + 1]![1] - poly[i]![1];
    const l = Math.hypot(dx, dy) || 1;
    tan.push([dx / l, dy / l]);
    nrm.push([dy / l, -dx / l]);
  }
  const miter = (i: number): V2 => {
    if (i === 0) return nrm[0]!;
    if (i === n - 1) return nrm[segs - 1]!;
    const a = nrm[i - 1]!, b = nrm[i]!;
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    return [(a[0] + b[0]) / k, (a[1] + b[1]) / k];
  };
  const out: HardMesh[] = [];
  for (let i = 0; i < segs; i++) {
    const od = typeof o.outset === 'number' ? o.outset : (o.outset?.[i] ?? 0);
    const pa = poly[i]!, pb = poly[i + 1]!, ma = miter(i), mb = miter(i + 1), tg = tan[i]!;
    const at = (p: V2, m: V2, d: number): V2 => [p[0] + m[0] * d, p[1] + m[1] * d];
    // profile loops (2-D) for a given top depth reduction `r` (extrusion-end chamfer)
    const loops = (r: number): V2[] => {
      const pts: V2[] = [];
      const topA = at(pa, ma, od - r), topB = at(pb, mb, od - r);
      if (o.chamferT) {
        const { depth, width } = o.chamferT;
        pts.push([topA[0] + tg[0] * width, topA[1] + tg[1] * width], [topB[0] - tg[0] * width, topB[1] - tg[1] * width]);
        pts.push(at(pa, ma, od - depth - r * 0), at(pb, mb, od - depth - r * 0));
      } else {
        pts.push(topA, topB);
      }
      pts.push(at(pa, ma, -o.t), at(pb, mb, -o.t));
      return pts;
    };
    const full = loops(0);
    const pts3: V3[] = [];
    const ce = o.chamferE ?? 0;
    if (ce > 0) {
      const shrunk = loops(ce);
      for (const p of shrunk) { pts3.push(map(p[0], p[1], o.e0), map(p[0], p[1], o.e1)); }
      for (const p of full) { pts3.push(map(p[0], p[1], o.e0 + ce), map(p[0], p[1], o.e1 - ce)); }
    } else {
      for (const p of full) { pts3.push(map(p[0], p[1], o.e0), map(p[0], p[1], o.e1)); }
    }
    out.push(hull(pts3));
  }
  return out;
}

/**
 * Mitred rectangular frame band round a box of half extents (hx, hz): 4 chamfered slabs between y0 and y1, `outset` proud of the
 * box face and reaching `depth` into it. Chamfer `b` on the outer top / bottom edges.
 */
export function frameBand(hx: number, hz: number, outset: number, depth: number, y0: number, y1: number, b: number, chamferTop = true, chamferBottom = true): HardMesh[] {
  const side = (a: number, c: number, mp: (s: number, p: number, y: number) => V3): HardMesh => {
    const P = (y: number, k: number): V3[] => [
      mp(-(a + outset - k), c + outset - k, y), mp(a + outset - k, c + outset - k, y),
      mp(a - depth, c - depth, y), mp(-(a - depth), c - depth, y),
    ];
    const pts: V3[] = [...P(y0 + (chamferBottom ? b : 0), 0), ...P(y1 - (chamferTop ? b : 0), 0)];
    if (chamferBottom) pts.push(...P(y0, b));
    if (chamferTop) pts.push(...P(y1, b));
    return hull(pts);
  };
  return [
    side(hx, hz, (s, p, y) => [s, y, p]),
    side(hx, hz, (s, p, y) => [-s, y, -p]),
    side(hz, hx, (s, p, y) => [p, y, s]),
    side(hz, hx, (s, p, y) => [-p, y, -s]),
  ];
}

// ------------------------------------------------------------------------------------------------ lid vault
export interface LidProfile {
  /** outer polyline in (z, y) from the front-bottom corner up the front wall, over the crown to the back-bottom corner (outward = right of travel) */
  poly: V2[];
  /** arc radius and centre (z = 0, y = cy) */
  radius: number;
  cy: number;
  /** index range of the arc vertices inside `poly` */
  arcFrom: number;
  arcTo: number;
}
/** vertical front wall, circular-arc crown split into `staves` facets, vertical back wall; y measured from the lid bottom */
export function lidProfile(depth: number, wall: number, rise: number, staves: number): LidProfile {
  const c = depth;
  const radius = (c * c / 4 + rise * rise) / (2 * rise);
  const cy = wall + rise - radius;
  const phiMax = Math.asin(c / 2 / radius);
  const poly: V2[] = [[-c / 2, 0]];
  for (let k = 0; k <= staves; k++) {
    const phi = -phiMax + (k / staves) * 2 * phiMax;
    poly.push([radius * Math.sin(phi), cy + radius * Math.cos(phi)]);
  }
  poly.push([c / 2, 0]);
  poly.reverse();
  return { poly, radius, cy, arcFrom: 1, arcTo: staves + 1 };
}

// ------------------------------------------------------------------------------------------------ skeleton + clip
export interface LidRig {
  skeleton: Skeleton;
  /** matrix applied to lid triangles for the fully open pose (AO / culling configuration) */
  openXf: Mat4;
  clips: ClipData[];
}

export function lidRig(hinge: V3, openDeg = 108): LidRig {
  const skeleton = new Skeleton([
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'lid', parent: 'root', pos: hinge },
  ]);
  const spec: ClipSpec = {
    name: 'open',
    duration: 0.9,
    loop: false,
    pose: (c) => {
      // anticipation dip, swing up with overshoot, settle
      const a = keyed(c.t, [[0, 0], [0.09, -3], [0.5, openDeg + 12], [0.7, openDeg - 5], [0.9, openDeg]], 'smooth');
      c.set('lid', -a * DEG, 0, 0);
    },
  };
  const openXf = compose(move(hinge[0], hinge[1], hinge[2]), rotX(-openDeg * DEG), move(-hinge[0], -hinge[1], -hinge[2]));
  return { skeleton, openXf, clips: [sampleClip(skeleton, spec)] };
}

// ------------------------------------------------------------------------------------------------ treasure
/** low faceted mound of loose coins in a box region (x, z extents, base y, peak height) built from stacked hexagonal discs */
export function coinHeap(cx: number, cz: number, rx: number, rz: number, y: number, peak: number, seed: number): HardMesh[] {
  const parts: HardMesh[] = [];
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // central mound: faceted dome
  const ring = (r: number, h: number, n: number, ph: number): V3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = ph + (i / n) * Math.PI * 2;
      const j = 0.85 + 0.3 * rnd();
      return [cx + Math.cos(a) * rx * r * j, y + h, cz + Math.sin(a) * rz * r * j] as V3;
    });
  const pts: V3[] = [...ring(0.95, 0, 9, 0.2), ...ring(0.72, peak * 0.62, 9, 0.5), ...ring(0.36, peak * 0.95, 7, 0.9), [cx, y + peak, cz]];
  parts.push(hull(pts));
  return parts;
}

/** a thin hexagonal coin disc lying with normal `n` (unit) at `c`, radius r, thickness t */
export function coinDisc(c: V3, n: V3, r: number, t: number): HardMesh {
  const u0: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const ux = n[1] * u0[2] - n[2] * u0[1], uy = n[2] * u0[0] - n[0] * u0[2], uz = n[0] * u0[1] - n[1] * u0[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const u: V3 = [ux / ul, uy / ul, uz / ul];
  const w: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const pts: V3[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    for (const h of [-t / 2, t / 2]) pts.push([c[0] + u[0] * x + w[0] * z + n[0] * h, c[1] + u[1] * x + w[1] * z + n[1] * h, c[2] + u[2] * x + w[2] * z + n[2] * h]);
  }
  return hull(pts);
}

export { lerp };
