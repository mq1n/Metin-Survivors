// Chest frame: planked hollow body (plinth + rim frames, groove-chamfered planks, floor, feet) and a faceted barrel-vault lid
// (staves + vertical-board end plates) on the `lid` bone. Style-specific hardware / paint is added by the chest models.
import { Assembly } from './assembly.ts';
import { type LidProfile, type V2, frameBand, lidProfile, polyStaves } from './chestKit.ts';
import { type V3, chamferBox, hull } from './geom.ts';

export interface FrameParams {
  /** body outer width (x) and depth (z) without the proud frame bands */
  W: number;
  D: number;
  /** height of the feet = y of the body bottom */
  feet: number;
  /** body height from the bottom of the plinth to the top of the rim */
  Hb: number;
  /** wall thickness */
  t: number;
  plinth: { h: number; out: number };
  rim: { h: number; out: number };
  /** planks per wall between the plinth and the rim */
  planks: number;
  /** V-groove chamfer between planks */
  groove: { depth: number; width: number };
  /** interior floor height (absolute y) */
  floorY: number;
  lid: { rise: number; wall: number; staves: number; t: number; plate: number; boards: number };
  /** foot block size (x, z) and inset from the body corner */
  foot: { size: number; inset: number };
}

export interface FrameZones {
  /** zone of plank k of wall w (0 front, 1 back, 2 right, 3 left) */
  plank(wall: number, k: number): number;
  frame: number;
  floor: number;
  foot: number;
  lidStave(k: number): number;
  lidPlate(side: number, k: number): number;
}

export interface FrameOut {
  /** body bottom / body top (lid bottom) */
  y0: number;
  y1: number;
  plinthTop: number;
  rimBottom: number;
  Wl: number;
  Dl: number;
  lid: LidProfile;
  hinge: V3;
}

/** clip a convex polygon to z in [lo, hi] (Sutherland-Hodgman against two vertical lines) */
function clipZ(poly: readonly V2[], lo: number, hi: number): V2[] {
  const clip = (pts: V2[], keep: (p: V2) => boolean, cut: (a: V2, b: V2) => V2): V2[] => {
    const out: V2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const ka = keep(a), kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) out.push(cut(a, b));
    }
    return out;
  };
  const atZ = (z: number) => (a: V2, b: V2): V2 => {
    const t = (z - a[0]) / (b[0] - a[0]);
    return [z, a[1] + (b[1] - a[1]) * t];
  };
  let pts = clip([...poly], (p) => p[0] >= lo - 1e-9, atZ(lo));
  pts = clip(pts, (p) => p[0] <= hi + 1e-9, atZ(hi));
  return pts;
}

export function buildFrame(asm: Assembly, p: FrameParams, zones: FrameZones): FrameOut {
  const hx = p.W / 2, hz = p.D / 2;
  const y0 = p.feet, y1 = p.feet + p.Hb;
  const plinthTop = y0 + p.plinth.h, rimBottom = y1 - p.rim.h;
  const ph = (rimBottom - plinthTop) / p.planks;
  const ys = Array.from({ length: p.planks + 1 }, (_, k) => plinthTop + ph * k);

  // ---- wall planks (outward = right of travel: walls facing -z / -x are traversed downward)
  const up: V2[] = ys.map((y) => [0, y] as V2);
  const dn: V2[] = [...up].reverse();
  const wallDefs: { a: number; poly: V2[]; map: (a: number, b: number, e: number) => V3; e0: number; e1: number; down: boolean }[] = [
    { a: hz, poly: up, map: (a, b, e) => [e, b, a], e0: -hx, e1: hx, down: false },
    { a: -hz, poly: dn, map: (a, b, e) => [e, b, a], e0: -hx, e1: hx, down: true },
    { a: hx, poly: up, map: (a, b, e) => [a, b, e], e0: -hz + p.t, e1: hz - p.t, down: false },
    { a: -hx, poly: dn, map: (a, b, e) => [a, b, e], e0: -hz + p.t, e1: hz - p.t, down: true },
  ];
  wallDefs.forEach((w, wi) => {
    const poly = w.poly.map(([, y]) => [w.a, y] as V2);
    const staves = polyStaves(poly, { t: p.t, e0: w.e0, e1: w.e1, chamferT: p.groove }, w.map);
    staves.forEach((m, i) => asm.add(m, zones.plank(wi, w.down ? p.planks - 1 - i : i)));
  });

  // ---- plinth / rim frames
  for (const m of frameBand(hx, hz, p.plinth.out, p.t, y0, plinthTop, 0.006, true, false)) asm.add(m, zones.frame);
  for (const m of frameBand(hx, hz, p.rim.out, p.t, rimBottom, y1, 0.006, true, true)) asm.add(m, zones.frame);

  // ---- floor and feet
  asm.add(chamferBox([0, p.floorY - 0.02, 0], [p.W - 2 * p.t + 0.01, 0.04, p.D - 2 * p.t + 0.01], 0), zones.floor);
  const fx = hx - p.foot.inset, fz = hz - p.foot.inset;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    asm.add(chamferBox([sx * fx, (y0 + 0.012) / 2, sz * fz], [p.foot.size, y0 + 0.012, p.foot.size], 0.009), zones.foot);
  }

  // ---- lid vault (bone 1): staves along x, vertical-board end plates
  const Wl = p.W + 2 * p.rim.out, Dl = p.D + 2 * p.rim.out;
  const lid = lidProfile(Dl, p.lid.wall, p.lid.rise, p.lid.staves);
  const xs = Wl / 2 - p.lid.plate;
  const lidMap = (a: number, b: number, e: number): V3 => [e, y1 + b, a];
  const staves = polyStaves(lid.poly, { t: p.lid.t, e0: -xs, e1: xs, chamferT: p.groove }, lidMap);
  staves.forEach((m, i) => asm.add(m, zones.lidStave(i), undefined, 1));
  const nb = p.lid.boards;
  const gb = Math.min(p.groove.depth, 0.006);
  for (const side of [1, -1]) {
    for (let k = 0; k < nb; k++) {
      const z0 = -Dl / 2 + (Dl * k) / nb, z1 = -Dl / 2 + (Dl * (k + 1)) / nb;
      const full = clipZ(lid.poly, z0, z1);
      const inset = clipZ(lid.poly, z0 + gb, z1 - gb);
      if (full.length < 3 || inset.length < 3) continue;
      const pts: V3[] = [];
      const xo = Wl / 2, xi = xs;
      for (const q of inset) pts.push([side * xo, y1 + q[1], q[0]]);
      for (const q of full) pts.push([side * (xo - gb), y1 + q[1], q[0]], [side * xi, y1 + q[1], q[0]]);
      // make sure the bottom chord is part of the hull (polygon is closed by y = 0)
      asm.add(hull(pts), zones.lidPlate(side > 0 ? 0 : 1, k), undefined, 1);
    }
  }
  return { y0, y1, plinthTop, rimBottom, Wl, Dl, lid, hinge: [0, y1, -Dl / 2] };
}
