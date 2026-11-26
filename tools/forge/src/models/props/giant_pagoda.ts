// prop_giant_pagoda — 61.85 m landmark (drawn once; landmark budget ≤ 8k tris, one 2048 albedo). An octagonal seven-storey
// timber pagoda on a two-stage granite podium whose upper stage carries a carved lotus-and-cloud frieze between pilasters,
// reached by a front stair split around a carved dragon ramp with ball-finial newels. Storeys diminish and change treatment on
// the way up (see TIERS): a lacquered ground hall with a studded door inside a colonnade of red pillars under a painted ring
// beam; a timber-lattice gallery; alternating tall/squat windows over a stone course; a red balustrade with gold medallions;
// stone courses and blind faces higher up. Every storey has recessed framed openings, corner posts, a dancheong lintel,
// modelled bracket sets (double on the lower storeys) under a painted rafter-end band, and a dark glazed-tile roof with
// upturned corners; the three lower roofs carry modelled hip ridges that sweep into upturned tails, the ground roof wind bells.
// A gilded finial mast (lotus base, inverted bowl, stacked rings, flame jewel) crowns it. Faces +Z; origin at the podium centre.
import type { Vec3 } from '../../core/math.ts';
import { clamp01, m4translation, smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { cap, circleShape, compose, mapBandSides, polyCorners, revolve, roofLoft, rotY, sweepSolid } from '../../archetypes/prop/kit.ts';
import { dancheong, fbm01, fract, gold, lacquer, line, lum, mixc, mulc, pickTex, plaster, rgb, stone, wood } from '../../archetypes/prop/mats.ts';
import { type Mat, type PropMesh, type Vec2, mapAuto, mapCylY } from '../../archetypes/prop/mesh.ts';
import type { Rgb } from '../../archetypes/prop/texlib.ts';

const STONE = 0, FRIEZE = 1, WALL = 2, TIMBER = 3, LACQ = 4, DAN = 5, TILE = 6, EDGE = 7, SOFFIT = 8, RAFTER = 9, LATTICE = 10, DOOR = 11,
  GOLD = 12, RIDGE = 13, RAIL = 14, CARVE = 15, BRK = 16;

const N = 8, PHASE = Math.PI / 8, TAU = Math.PI * 2;
const COS8 = Math.cos(Math.PI / N), SIN8 = Math.sin(Math.PI / N);
const HEIGHT = 61.85;
/** face 1 looks down +z (the entrance side) */
const FRONT = 1;

// ---------------------------------------------------------------------------------------------------------------------------------
// layout (shared by the geometry and the paint, which switches treatment per storey by height)

interface Opening { w: number; y0: number; y1: number; door?: boolean }
interface Tier {
  /** wall circumradius, wall height, eave overhang beyond the wall (ground storey: beyond the colonnade), roof rise */
  r: number; h: number; over: number; rise: number;
  /** bracket scale and kinds: corner sets double/single, mid-face sets 0 = none, 1 = single, 2 = double */
  s: number; dbl: boolean; mid: 0 | 1 | 2;
  thick: number; segs: number; lift: number; flare: number;
  /** opening per face (null = blind face) */
  win: (k: number) => Opening | null;
  base: 'gallery' | 'balustrade' | 'course' | 'none';
  post: number;
  /** modelled hip ridges + curled tip ornaments (hips: modelled hip ridges only; else painted hips); wind bells; proud window frames */
  ornate: boolean; hips: boolean; bells: boolean; proud: boolean;
}

const TIERS: Tier[] = [
  { r: 6.3, h: 5.9, over: 2.2, rise: 3.2, s: 1.15, dbl: true, mid: 1, thick: 0.46, segs: 4, lift: 1.3, flare: 1.0, base: 'none', post: LACQ, ornate: true, hips: false, bells: true, proud: true,
    win: (k) => (k === FRONT ? { w: 2.5, y0: 0, y1: 4.2, door: true } : { w: 2.1, y0: 1.2, y1: 4.0 }) },
  { r: 5.5, h: 4.6, over: 3.0, rise: 2.7, s: 0.95, dbl: true, mid: 0, thick: 0.4, segs: 3, lift: 1.15, flare: 0.9, base: 'gallery', post: LACQ, ornate: true, hips: false, bells: false, proud: true,
    win: (k) => (k === FRONT ? { w: 1.8, y0: 0.3, y1: 3.5, door: true } : { w: 2.0, y0: 1.0, y1: 3.3 }) },
  { r: 4.95, h: 4.2, over: 2.8, rise: 2.5, s: 0.85, dbl: true, mid: 0, thick: 0.38, segs: 3, lift: 1.05, flare: 0.82, base: 'course', post: TIMBER, ornate: false, hips: true, bells: false, proud: true,
    win: (k) => (k % 2 === 0 ? { w: 1.1, y0: 0.8, y1: 3.4 } : { w: 2.0, y0: 1.5, y1: 2.9 }) },
  { r: 4.45, h: 3.8, over: 2.55, rise: 2.3, s: 0.78, dbl: false, mid: 0, thick: 0.35, segs: 2, lift: 0.95, flare: 0.75, base: 'balustrade', post: LACQ, ornate: false, hips: false, bells: false, proud: false,
    win: (k) => (k === FRONT ? { w: 1.5, y0: 0.3, y1: 2.9, door: true } : { w: 1.6, y0: 0.95, y1: 2.8 }) },
  { r: 4.0, h: 3.5, over: 2.35, rise: 2.15, s: 0.72, dbl: false, mid: 0, thick: 0.33, segs: 2, lift: 0.88, flare: 0.7, base: 'course', post: TIMBER, ornate: false, hips: false, bells: false, proud: false,
    win: (k) => (k % 2 === 1 ? { w: 1.4, y0: 0.9, y1: 2.6 } : null) },
  { r: 3.6, h: 3.2, over: 2.15, rise: 2.0, s: 0.66, dbl: false, mid: 0, thick: 0.31, segs: 2, lift: 0.8, flare: 0.64, base: 'course', post: LACQ, ornate: false, hips: false, bells: false, proud: false,
    win: (k) => (k % 2 === 0 ? { w: 1.0, y0: 0.95, y1: 2.3 } : null) },
  { r: 3.25, h: 3.0, over: 2.3, rise: 2.9, s: 0.62, dbl: false, mid: 0, thick: 0.3, segs: 2, lift: 0.85, flare: 0.66, base: 'course', post: TIMBER, ornate: false, hips: false, bells: false, proud: false,
    win: (k) => (k % 2 === 1 ? { w: 1.2, y0: 0.85, y1: 2.3 } : null) },
];
/** ground-storey colonnade circumradius */
const RC = 8.7;
const PODIUM = 3.2;
const stackH = (t: Tier): number => (t.dbl ? 0.92 : 0.62) * t.s;
/** storey base heights (wall foot) and eave heights */
const LAYOUT = (() => {
  const base: number[] = [], eave: number[] = [];
  let y = PODIUM;
  for (const t of TIERS) {
    base.push(y);
    const y0 = y + t.h + stackH(t) + t.thick;
    eave.push(y0);
    y = y0 + t.rise;
  }
  return { base, eave, apex: y };
})();
const tierAt = (y: number): number => {
  for (let i = TIERS.length - 1; i >= 0; i--) if (y >= LAYOUT.base[i]! - 0.05) return i;
  return -1;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// octagon frame helpers

const faceAng = (k: number): number => PHASE + ((k + 0.5) * TAU) / N;
const cornerAng = (k: number): number => PHASE + (k * TAU) / N;
const faceN = (k: number): Vec3 => [Math.cos(faceAng(k)), 0, Math.sin(faceAng(k))];
const faceT = (k: number): Vec3 => [-Math.sin(faceAng(k)), 0, Math.cos(faceAng(k))];
/** point on face k of an octagon with circumradius r: s = metres along the face from its centre (toward corner k+1), d = depth behind the face plane */
const fpt = (r: number, k: number, s: number, y: number, d = 0): Vec3 => {
  const a = faceAng(k), nx = Math.cos(a), nz = Math.sin(a), ap = r * COS8 - d;
  return [nx * ap - nz * s, y, nz * ap + nx * s];
};
const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
const UP: Vec3 = [0, 1, 0], DOWN: Vec3 = [0, -1, 0];

/** quad with outward direction `out` (winding fixed up to face it) */
function quadO(m: PropMesh, mat: number, p: Vec3[], uv: Vec2[], out: Vec3): void {
  const [a, b, c, d] = p as [Vec3, Vec3, Vec3, Vec3];
  const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) m.quad(a, b, c, d, uv[0]!, uv[1]!, uv[2]!, uv[3]!, mat);
  else m.quad(a, d, c, b, uv[0]!, uv[3]!, uv[2]!, uv[1]!, mat);
}

/** wall-aware planar uv (tile = s metres) */
const uvAuto = (s: number) => (p: Vec3, n: Vec3): Vec2 => {
  if (Math.abs(n[1]) > 0.7) return [p[0] / s, p[2] / s];
  const l = Math.hypot(n[0], n[2]) || 1;
  return [(-n[2] * p[0] + n[0] * p[2]) / l / s, -p[1] / s];
};

/** box in the radial frame of angle `a` (x = tangent, y = up, z = radial out); c = centre, h = half sizes; faces from 'oilrtb' */
function rbox(m: PropMesh, mat: number, a: number, c: Vec3, h: Vec3, faces: string, uv: (p: Vec3, n: Vec3) => Vec2): void {
  const er: Vec3 = [Math.cos(a), 0, Math.sin(a)], et: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  const P = (sx: number, sy: number, sz: number): Vec3 => [c[0] + et[0] * sx * h[0] + er[0] * sz * h[2], c[1] + sy * h[1], c[2] + et[2] * sx * h[0] + er[2] * sz * h[2]];
  const f = (out: Vec3, pts: Vec3[]): void => quadO(m, mat, pts, pts.map((p) => uv(p, out)), out);
  if (faces.includes('o')) f(er, [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]);
  if (faces.includes('i')) f(neg(er), [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)]);
  if (faces.includes('l')) f(et, [P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)]);
  if (faces.includes('r')) f(neg(et), [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)]);
  if (faces.includes('t')) f(UP, [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)]);
  if (faces.includes('b')) f(DOWN, [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)]);
}

/** octagonal ring band between circumradii rIn..rOut, heights ya..yb; outer faces get band uv (u along the face in band heights, v 0..1 down) */
function ring(m: PropMesh, mat: number, rIn: number, rOut: number, ya: number, yb: number, parts: string, band = yb - ya, uOff = 0): void {
  for (let k = 0; k < N; k++) {
    const hi = rIn * SIN8, ho = rOut * SIN8, n = faceN(k);
    const bu = (s: number, y: number, hw: number): Vec2 => [(s + uOff + k * 2 * hw) / band, (yb - y) / band];
    if (parts.includes('o')) quadO(m, mat, [fpt(rOut, k, -ho, ya), fpt(rOut, k, ho, ya), fpt(rOut, k, ho, yb), fpt(rOut, k, -ho, yb)], [bu(-ho, ya, ho), bu(ho, ya, ho), bu(ho, yb, ho), bu(-ho, yb, ho)], n);
    if (parts.includes('i')) quadO(m, mat, [fpt(rIn, k, -hi, ya), fpt(rIn, k, hi, ya), fpt(rIn, k, hi, yb), fpt(rIn, k, -hi, yb)], [bu(hi, ya, hi), bu(-hi, ya, hi), bu(-hi, yb, hi), bu(hi, yb, hi)], neg(n));
    const capQ = (y: number, out: Vec3): void => {
      const pts = [fpt(rIn, k, -hi, y), fpt(rIn, k, hi, y), fpt(rOut, k, ho, y), fpt(rOut, k, -ho, y)];
      quadO(m, mat, pts, pts.map((p) => [p[0] / band, p[2] / band] as Vec2), out);
    };
    if (parts.includes('t')) capQ(yb, UP);
    if (parts.includes('b')) capQ(ya, DOWN);
  }
}

/** one octagon wall face from y0..y1 with an optional recessed, framed opening (frame proud of the wall when `proud`, else flush; jambs, back panel) */
function wallFace(m: PropMesh, r: number, k: number, y0: number, y1: number, op: Opening | null, frameMat: number, proud: boolean): void {
  const n = faceN(k), t = faceT(k), hw = r * SIN8;
  const U = (s: number, y: number): Vec2 => [s / 3 + k * 1.37, (70 - y) / 3];
  const rect = (mat: number, sA: number, yA: number, sB: number, yB: number, d: number, uv: (s: number, y: number) => Vec2): void => {
    if (sB - sA < 1e-4 || yB - yA < 1e-4) return;
    quadO(m, mat, [fpt(r, k, sA, yA, d), fpt(r, k, sB, yA, d), fpt(r, k, sB, yB, d), fpt(r, k, sA, yB, d)], [uv(sA, yA), uv(sB, yA), uv(sB, yB), uv(sA, yB)], n);
  };
  if (!op) {
    rect(WALL, -hw, y0, hw, y1, 0, U);
    return;
  }
  const fw = Math.min(0.26, op.w * 0.13), e = proud ? 0.08 : 0, depth = op.door ? 0.42 : 0.32;
  const a0 = -op.w / 2, a1 = op.w / 2, b0 = y0 + op.y0, b1 = y0 + op.y1;
  const A0 = a0 - fw, A1 = a1 + fw, B0 = op.door ? b0 : b0 - fw, B1 = b1 + fw;
  rect(WALL, -hw, y0, A0, y1, 0, U);
  rect(WALL, A1, y0, hw, y1, 0, U);
  rect(WALL, A0, y0, A1, B0, 0, U);
  rect(WALL, A0, B1, A1, y1, 0, U);
  const fu = (s: number, y: number): Vec2 => [s / 0.9, -y / 0.9];
  // frame front ring (proud by e)
  rect(frameMat, A0, B0, a0, B1, -e, fu);
  rect(frameMat, a1, B0, A1, B1, -e, fu);
  if (!op.door) rect(frameMat, a0, B0, a1, b0, -e, fu);
  rect(frameMat, a0, b1, a1, B1, -e, fu);
  // frame outer edges and jambs: strips between two depths along an edge of the opening
  const strip = (mat: number, pA: [number, number], pB: [number, number], dA: number, dB: number, out: Vec3): void => {
    const pts = [fpt(r, k, pA[0], pA[1], dA), fpt(r, k, pB[0], pB[1], dA), fpt(r, k, pB[0], pB[1], dB), fpt(r, k, pA[0], pA[1], dB)];
    quadO(m, mat, pts, pts.map((p) => [(p[0] + p[2]) / 0.9, -p[1] / 0.9] as Vec2), out);
  };
  if (proud) {
    strip(frameMat, [A0, B0], [A0, B1], -e, 0, neg(t));
    strip(frameMat, [A1, B0], [A1, B1], -e, 0, t);
    strip(frameMat, [A0, B1], [A1, B1], -e, 0, UP);
    if (!op.door) strip(frameMat, [A0, B0], [A1, B0], -e, 0, DOWN);
  }
  strip(frameMat, [a0, b0], [a0, b1], -e, depth, t);
  strip(frameMat, [a1, b0], [a1, b1], -e, depth, neg(t));
  strip(frameMat, [a0, b1], [a1, b1], -e, depth, DOWN);
  strip(op.door ? STONE : frameMat, [a0, b0], [a1, b0], -e, depth, UP);
  // back panel: lattice window or studded door, uv 0..1 (u left -> right seen from outside, v top -> bottom)
  rect(op.door ? DOOR : LATTICE, a0, b0, a1, b1, depth, (s, y) => [(a1 - s) / op.w, (b1 - y) / (b1 - b0)]);
}

/** bracket cluster (dougong) standing on a beam at radius `rad` (wall surface) and angle `a`: block, crosswise arm and an outward
 * cantilever; `dbl` adds a wider second arm and a longer cantilever. Only faces that can be seen are emitted. */
function bracket(m: PropMesh, a: number, rad: number, yb: number, s: number, reach: number, dbl: boolean): void {
  const er: Vec3 = [Math.cos(a), 0, Math.sin(a)];
  const P = (rr: number, y: number): Vec3 => [er[0] * rr, y, er[2] * rr];
  const armUV = (yTop: number, h: number) => (p: Vec3, n: Vec3): Vec2 => {
    const along = Math.abs(n[1]) > 0.7 ? p[0] * er[2] - p[2] * er[0] : Math.abs(n[0] * er[0] + n[2] * er[2]) > 0.7 ? -p[0] * er[2] + p[2] * er[0] : p[0] * er[0] + p[2] * er[2];
    return [along / h, Math.abs(n[1]) > 0.7 ? (p[0] * er[0] + p[2] * er[2]) / h : (yTop - p[1]) / h];
  };
  const hb = 0.16 * s, ha = 0.15 * s;
  rbox(m, BRK, a, P(rad + 0.2 * s, yb + hb), [0.26 * s, hb, 0.26 * s], 'ob', armUV(yb + 2 * hb, 2 * hb));
  const y1 = yb + 2 * hb + ha;
  rbox(m, BRK, a, P(rad + 0.2 * s, y1), [0.75 * s, ha, 0.17 * s], 'olrb', armUV(y1 + ha, 2 * ha));
  rbox(m, BRK, a, P(rad + reach / 2, y1), [0.2 * s, ha, reach / 2], 'olrb', armUV(y1 + ha, 2 * ha));
  if (dbl) {
    const y2 = y1 + 2 * ha;
    rbox(m, BRK, a, P(rad + 0.45 * s, y2), [1.15 * s, ha, 0.17 * s], 'olrb', armUV(y2 + ha, 2 * ha));
    rbox(m, BRK, a, P(rad + reach * 0.66, y2), [0.2 * s, ha, reach * 0.66], 'olrb', armUV(y2 + ha, 2 * ha));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// paint

/** relief shading over a base material: height field H(u, v) in the material's uv, light from the upper left, dark crevices */
function relief(name: string, base: Mat, H: (u: number, v: number) => number, depthDark = 0.42): Mat {
  return {
    name,
    shade(t) {
      const c = base.shade(t);
      const u = t.uv[0], v = t.uv[1];
      const e = Math.max(0.01, t.fp * 1.2);
      const h = H(u, v);
      const du = (H(u + e, v) - H(u - e, v)) / (2 * e), dv = (H(u, v + e) - H(u, v - e)) / (2 * e);
      const lit = Math.max(0.35, Math.min(1.6, 1 + 0.018 * (du * 0.55 + dv * 1.0)));
      return mulc(c, lit * (1 - depthDark + depthDark * h));
    },
  };
}

const sm = smoothstep;
/** podium frieze (uv: u in band heights along the face, v 0..1 down): fillets, a running cloud scroll above a row of upright lotus petals */
const friezeH = (u: number, v: number): number => {
  let h = Math.max(1 - sm(0.07, 0.1, v), sm(0.9, 0.93, v)) * 0.95;
  // lotus petals (lower half)
  const pu = fract(u / 0.36) - 0.5, py = (0.86 - v) / 0.3;
  if (py > -0.05 && py < 1.05) {
    const wdt = 0.4 * Math.sqrt(Math.max(0, 1 - py * py)) * (1 - 0.3 * py);
    const d = Math.abs(pu) - wdt;
    const petal = 1 - sm(-0.05, 0.01, d);
    const rib = 1 - 0.35 * (1 - sm(0.0, 0.05, Math.abs(pu)));
    h = Math.max(h, 0.85 * petal * rib);
  }
  // running cloud scroll (upper half): a wave with spiral curls at alternate crests
  const cu = u / 0.95;
  const wave = 0.36 + 0.1 * Math.sin(cu * TAU);
  h = Math.max(h, 0.8 * (1 - sm(0.03, 0.05, Math.abs(v - wave))));
  const ccu = (fract(cu + 0.25) - 0.5) * 0.95, ccv = v - 0.33;
  const rr = Math.hypot(ccu, ccv);
  if (rr < 0.16) {
    const ang = Math.atan2(ccv, ccu) / TAU;
    const sp = Math.abs(fract(rr / 0.055 - ang) - 0.5);
    h = Math.max(h, 0.75 * sm(0.18, 0.3, sp) * (1 - sm(0.13, 0.16, rr)));
  }
  return h;
};

/** stair ramp carving (uv: u 0..1 across, v metres along): a coiling dragon body with scales among cloud discs */
const dragonH = (u: number, v: number): number => {
  const x = 0.5 + 0.26 * Math.sin(v * 1.35 + 0.6);
  const d = Math.abs(u - x);
  let h = 0;
  const body = 1 - sm(0.09, 0.12, d);
  if (body > 0) {
    const sc = Math.abs(fract(v * 7 + (u - x) * 4) - 0.5) + Math.abs(fract((u - x) * 9) - 0.5) * 0.4;
    h = body * (0.75 + 0.25 * sm(0.15, 0.35, sc)) * (0.85 + 0.15 * Math.cos((d / 0.11) * 1.4));
  }
  // dorsal fins
  const fin = 1 - sm(0.0, 0.03, Math.abs(u - x - 0.12) - 0.04 * fract(v * 3));
  h = Math.max(h, 0.6 * fin * (d < 0.2 ? 1 : 0));
  // clouds
  const cu = fract(v * 0.6) - 0.5, cside = u < x ? 0.15 : 0.85;
  const cr = Math.hypot((u - cside) * 1.2, cu * 0.9);
  if (cr < 0.15) h = Math.max(h, 0.55 * (1 - sm(0.1, 0.15, cr)) * (0.6 + 0.4 * sm(0.03, 0.06, Math.abs(cr - 0.07))));
  // border fillets
  return Math.max(h, 1 - sm(0.04, 0.07, Math.min(u, 1 - u)));
};

const PLASTER_BASE = rgb('#d9ccb0');
function wallPaint(): Mat {
  const base = plaster('wall-plaster', { color: '#d9ccb0', dirt: 0.45 });
  // ground hall boards, then whitewash and red-ochre storeys alternating (breaks the stacked-copy read)
  const tints: Rgb[] = ['#7a3222', '#e8dcc2', '#b4603f', '#eadfc8', '#a9573b', '#e4d8bf', '#b25c3d'].map(rgb);
  const boardT = pickTex('tex_wood_lacquer_red', 'tex_wood_beam_dark');
  const grime = rgb('#4b3d2e'), moss = rgb('#59683c');
  return {
    name: 'wall',
    shade(t) {
      const ti = Math.max(0, tierAt(t.p[1]));
      const yl = t.p[1] - LAYOUT.base[ti]!, hT = TIERS[ti]!.h + stackH(TIERS[ti]!);
      let c: Rgb;
      if (ti === 0) {
        // ground hall: vertical lacquered boards with dark seams, faded and grimy
        const s = boardT ? t.tex(boardT, 0.6) : [0.4, 0.1, 0.08] as Rgb;
        c = mulc(mixc(tints[0]!, mulc(s, 0.9), 0.45), 0.85 + 0.3 * fbm01(t, 1.5, 3, 2.2));
        c = mixc(c, rgb('#1d120d'), line(fract(t.uv[0] * 3 / 0.42) - 0.5, 0.04, 0.03) * 0.7);
      } else {
        // storey tint relative to the plaster base colour (alternating warm / cool whitewash)
        const tint = tints[ti]!;
        c = base.shade(t);
        c = [(c[0] * tint[0]) / PLASTER_BASE[0], (c[1] * tint[1]) / PLASTER_BASE[1], (c[2] * tint[2]) / PLASTER_BASE[2]];
      }
      // soot/rain stains running down from the lintel, damp and moss at the foot, overall darkening toward the eaves
      const streak = sm(0.55, 0.85, fbm01(t, 2.6, 3, 4.4) * 0.6 + 0.4 * (0.5 + 0.5 * t.noise.fbm(t.p[0] * 3.1 + t.p[2] * 3.1, t.p[1] * 0.25, 0, { octaves: 2 })));
      c = mixc(c, mulc(grime, 1.2), 0.68 * streak * sm(0.15, 0.9, yl / hT));
      c = mixc(c, moss, 0.4 * (1 - sm(0.0, 0.9, yl)) * sm(0.4, 0.75, fbm01(t, 4, 3, 1.7)));
      if (ti > 0) {
        // per-face whitewash drift and a dark lacquered dado with a gold rule along the foot of every plaster wall
        const face = Math.floor((((Math.atan2(t.p[2], t.p[0]) - PHASE) / TAU) * N + N * 4) % N);
        c = mulc(c, 0.9 + 0.12 * ((face * 7) % 5) / 4);
        const dado = 1 - sm(0.78, 0.8, yl);
        if (dado > 0) {
          let dc = mulc(rgb('#4a1a13'), 0.75 + 0.45 * fbm01(t, 5, 3, 6.2));
          dc = mixc(dc, rgb('#1d0f0b'), line(fract(t.uv[0] * 3 / 0.5) - 0.5, 0.03, 0.02) * 0.6);
          c = mixc(c, dc, dado);
        }
        c = mixc(c, rgb('#b98d3e'), line(yl - 0.8, 0.025, 0.012) * 0.85);
      }
      c = mulc(c, 0.5 + 0.5 * clamp01(1.2 - yl / hT * 0.8));
      return c;
    },
  };
}

function slateTile(): Mat {
  const T = pickTex('tex_roof_tile');
  const dark = rgb('#1e2125'), light = rgb('#6f757b'), moss = rgb('#56652c'), bleach = rgb('#a5a299'), rust = rgb('#5a4636');
  return {
    name: 'tile',
    shade(t) {
      const s = T ? t.tex(T, 1) : ([0.35, 0.35, 0.35] as Rgb);
      const l = clamp01((lum(s) - 0.04) / 0.32);
      let c = mixc(dark, light, sm(0.05, 0.95, l));
      // per-storey hue drift + broad weathering so the seven roofs are not cloned
      const ti = Math.max(0, tierAt(t.p[1] - 1.5));
      c = mixc(c, mulc(rust, 0.9 + 0.2 * l), 0.12 + 0.06 * (ti % 3));
      c = mulc(c, 0.78 + 0.44 * fbm01(t, 0.32, 3, 4.2 + ti));
      c = mixc(c, mulc(bleach, 0.6 + 0.5 * l), 0.4 * sm(0.55, 0.85, fbm01(t, 0.45, 3, 9.1)));
      // lichen and moss in the tile channels, heavier on the lower storeys and up-facing patches
      const mk = sm(0.48, 0.78, fbm01(t, 1.7, 4, 2.7) + (1 - t.ao) * 0.35) * (0.75 - ti * 0.07);
      c = mixc(c, mulc(moss, 0.7 + 0.5 * l), clamp01(mk) * 0.75);
      // water streaks down the slope
      const wsk = sm(0.6, 0.9, 0.5 + 0.5 * t.noise.fbm(t.p[0] * 2.2 - t.p[2] * 1.3, t.p[1] * 0.4, t.p[2] * 2.2 + t.p[0] * 1.3, { octaves: 2 }));
      c = mulc(c, 1 - 0.25 * wsk);
      // painted hip ridge where u crosses a polygon corner (upper storeys have no modelled ridges)
      const d = Math.abs(fract(t.uv[0] / 2 + 0.5) - 0.5) * 2;
      const aa = Math.max(0.01, t.fp * 1.2);
      const capK = 1 - sm(0.13 - aa, 0.13 + aa, d);
      if (capK > 0) {
        const cc = mixc(rgb('#3b3d40'), rgb('#cfc8b8'), line(d, 0.03, aa));
        c = mixc(c, mulc(cc, 0.85 + 0.25 * fbm01(t, 20, 2, 8.8)), capK);
      }
      return c;
    },
  };
}

/** eave fascia: round end tiles with a lotus boss alternating with drip tiles over a dark board; u in tile units (metres via tpm), v 0..1 down */
function eaveEdge(): Mat {
  const head = rgb('#4f5257'), boss = rgb('#7d7b74'), board = rgb('#1c1714'), drip = rgb('#3c3f44');
  return {
    name: 'eave-edge',
    shade(t) {
      const um = t.uv[0] / Math.max(1e-4, t.tpm), v = t.uv[1];
      const P = 0.34;
      const aa = Math.max(0.03, (t.mpt / P) * 1.5);
      const cx = fract(um / P) - 0.5, cy = (v - 0.45) * 1.0;
      const d = Math.hypot(cx, cy);
      let c = mulc(board, 0.9 + 0.3 * fbm01(t, 20, 2, 1.3));
      const disc = 1 - sm(0.36 - aa, 0.36 + aa, d);
      c = mixc(c, mulc(head, 0.8 + 0.35 * fbm01(t, 25, 2, 5.1)), disc);
      c = mixc(c, mulc(boss, 0.85 + 0.3 * fbm01(t, 30, 2, 2.2)), (1 - sm(0.16 - aa, 0.16 + aa, d)) * disc);
      c = mixc(c, mulc(head, 0.45), line(d - 0.26, 0.03, aa) * disc);
      // triangular drip tiles between the discs
      const dx = Math.abs(fract(um / P) - 0.0 - (fract(um / P) > 0.5 ? 1 : 0)) * 2;
      const tri = 1 - sm(-aa, aa, dx - (1 - v) * 0.5);
      c = mixc(c, mulc(drip, 0.8 + 0.3 * fbm01(t, 22, 2, 7.7)), tri * (1 - disc) * (v > 0.35 ? 1 : 0));
      return c;
    },
  };
}

/** eave underside: green boards with dark-red rafters running in from the eave every 0.34 m */
function soffitPaint(): Mat {
  const board = rgb('#244a3e'), raf = rgb('#4a2219'), edge = rgb('#c9b98f');
  return {
    name: 'soffit',
    shade(t) {
      const um = t.uv[0] / Math.max(1e-4, t.tpm);
      const aa = Math.max(0.02, (t.mpt / 0.34) * 1.5);
      const x = Math.abs(fract(um / 0.34) - 0.5);
      const isR = 1 - sm(0.2 - aa, 0.2 + aa, x);
      let c = mixc(mulc(board, 0.8 + 0.35 * fbm01(t, 6, 3, 1.1)), mulc(raf, 0.8 + 0.4 * fbm01(t, 12, 2, 2.4)), isR);
      c = mixc(c, edge, line(x - 0.2, 0.012, aa) * 0.5);
      return c;
    },
  };
}

/** rafter-end band under the eave: round rafter ends painted with concentric rings (green, white, red, gold boss) in deep shadow */
function rafterEnds(): Mat {
  const shadow = rgb('#120c0a'), wood0 = rgb('#3a2418'), green = rgb('#1f6e52'), white = rgb('#ddd3b8'), red = rgb('#9c2c1d'), goldc = rgb('#d0a043'), blue = rgb('#1f4f8c');
  return {
    name: 'rafter-ends',
    shade(t) {
      const P = 0.34;
      const aa = Math.max(0.03, (t.mpt / P) * 1.6);
      const cx = (fract(t.uv[0] / P) - 0.5) * 1.0, cy = (t.uv[1] - 0.5) * 0.98;
      const d = Math.hypot(cx, cy);
      let c = shadow;
      const k = (r: number): number => 1 - sm(r - aa, r + aa, d);
      c = mixc(c, mulc(wood0, 0.8 + 0.4 * fbm01(t, 30, 2, 1.1)), k(0.44));
      c = mixc(c, (Math.floor(t.uv[0] / P) & 1) ? blue : green, k(0.37));
      c = mixc(c, white, k(0.25));
      c = mixc(c, red, k(0.17));
      c = mixc(c, goldc, k(0.07));
      return mulc(c, 0.75 + 0.3 * fbm01(t, 3, 2, 6.6));
    },
  };
}

/** window lattice (uv 0..1): aged paper behind dark bars; the pattern changes with the storey */
function latticePaint(): Mat {
  const paper = rgb('#a88f66'), bar = rgb('#1c120c'), rim = rgb('#2a1a12');
  return {
    name: 'lattice',
    shade(t) {
      const ti = Math.max(0, tierAt(t.p[1]));
      const u = t.uv[0], v = t.uv[1];
      const aa = Math.max(0.006, t.fp * 1.2);
      let bars = 0;
      if (ti <= 1) {
        // vertical slats with a crossed band at mid height
        bars = line(fract(u * 9) - 0.5, 0.11, aa * 9);
        if (v > 0.38 && v < 0.62) bars = Math.max(line(fract((u + v) * 7) - 0.5, 0.1, aa * 7), line(fract((u - v) * 7) - 0.5, 0.1, aa * 7));
        bars = Math.max(bars, line(v - 0.38, 0.012, aa), line(v - 0.62, 0.012, aa));
      } else if (ti % 2 === 0) {
        bars = Math.max(line(fract((u + v) * 5) - 0.5, 0.09, aa * 5), line(fract((u - v) * 5) - 0.5, 0.09, aa * 5));
      } else {
        bars = Math.max(line(fract(u * 6) - 0.5, 0.1, aa * 6), line(fract(v * 7) - 0.5, 0.1, aa * 7));
      }
      let c = mixc(mulc(paper, 0.75 + 0.4 * fbm01(t, 8, 2, 3.3)), bar, clamp01(bars) * 0.92);
      // torn paper patches show the dark interior
      c = mixc(c, mulc(bar, 0.6), 0.8 * sm(0.72, 0.8, fbm01(t, 5, 3, 9.4)) * (1 - clamp01(bars)));
      const edge = Math.min(u, 1 - u, v, 1 - v);
      c = mixc(c, rim, 1 - sm(0.03, 0.05, edge));
      // shade from the head of the recess
      return mulc(c, 0.68 + 0.32 * sm(0.0, 0.5, v));
    },
  };
}

/** studded double door (uv 0..1): faded lacquer planks, gold studs, ring pulls, a lattice transom */
function doorPaint(): Mat {
  const lac = rgb('#7a2a1d'), dark = rgb('#24110c'), goldc = rgb('#e0b050');
  return {
    name: 'door',
    shade(t) {
      const u = t.uv[0], v = t.uv[1];
      const aa = Math.max(0.006, t.fp * 1.2);
      let c = mulc(lac, 0.75 + 0.45 * fbm01(t, 6, 3, 2.9));
      c = mixc(c, dark, line(fract(u * 8) - 0.5, 0.03, aa * 8) * 0.6);
      if (v < 0.2) {
        const bars = Math.max(line(fract(u * 10) - 0.5, 0.1, aa * 10), line(fract(v * 12) - 0.5, 0.1, aa * 12));
        c = mixc(mulc(rgb('#3a2c20'), 0.8), dark, bars);
      }
      c = mixc(c, dark, Math.max(line(u - 0.5, 0.012, aa), line(v - 0.2, 0.012, aa)));
      // studs: 6 rows x 4 per leaf
      const lu = fract(u * 2), sx = Math.abs(fract(lu * 4) - 0.5), sy = Math.abs(fract((v - 0.24) * 8) - 0.5);
      if (v > 0.24 && v < 0.98) c = mixc(c, mulc(goldc, 0.8 + 0.4 * fbm01(t, 40, 2, 1.7)), 1 - sm(0.08, 0.08 + aa * 6, Math.hypot(sx * 0.25, sy * 0.125) * 4));
      // ring pulls
      const rp = Math.min(Math.hypot(u - 0.44, v - 0.58), Math.hypot(u - 0.56, v - 0.58));
      c = mixc(c, goldc, line(rp - 0.035, 0.008, aa));
      return mixc(c, dark, (1 - sm(0.0, 0.25, v)) * 0.45);
    },
  };
}

/** balustrades (uv: u metres/0.44 along the face, v 0..1 down): timber lattice on the galleries, red lacquer with gold medallions on the balustrade storey */
function railPaint(): Mat {
  const red = rgb('#8e2219'), dred = rgb('#4e110c'), goldc = rgb('#d6a646'), green = rgb('#1c6a54'), tim = rgb('#7a634a'), timD = rgb('#1e1510');
  return {
    name: 'rail',
    shade(t) {
      const ti = Math.max(0, tierAt(t.p[1]));
      const aa = Math.max(0.01, t.fp * 1.5);
      const um = t.uv[0] * 0.44, v = t.uv[1];
      if (ti === 3) {
        let c = mulc(mixc(red, dred, 0.35 * fbm01(t, 9, 3, 4.1)), 0.85 + 0.3 * fbm01(t, 30, 2, 1.7));
        c = mixc(c, goldc, Math.max(line(v - 0.1, 0.05, aa), line(v - 0.9, 0.05, aa)));
        const cell = fract(um / 1.2) - 0.5;
        const dia = (Math.abs(cell) * 1.2) / 0.36 + (Math.abs(v - 0.5) * 0.44) / 0.16;
        c = mixc(c, goldc, 1 - sm(1 - aa * 4, 1 + aa * 4, dia));
        c = mixc(c, green, 1 - sm(0.55 - aa * 4, 0.55 + aa * 4, dia));
        return c;
      }
      // timber balustrade: top rail, bottom rail, balusters with a swastika-free key lattice between
      let c = mulc(tim, 0.75 + 0.45 * fbm01(t, 10, 3, 2.2));
      const rails = Math.max(line(v - 0.08, 0.08, aa), line(v - 0.92, 0.08, aa));
      const bal = line(fract(um / 0.55) - 0.5, 0.06, aa * 2);
      const lat = v > 0.2 && v < 0.8 ? Math.max(line(fract((um / 0.55) * 2 + v * 1.6) - 0.5, 0.07, aa * 4), line(fract((um / 0.55) * 2 - v * 1.6) - 0.5, 0.07, aa * 4)) : 0;
      const solid = clamp01(Math.max(rails, bal, lat));
      c = mixc(mulc(timD, 0.8), c, solid);
      return c;
    },
  };
}

function ridgePaint(): Mat {
  const a = rgb('#34363a'), b = rgb('#7d7c78'), mortar = rgb('#cfc7b4');
  return {
    name: 'ridge',
    shade(t) {
      let c = mixc(a, b, 0.25 + 0.5 * fbm01(t, 3, 3, 5.5));
      c = mixc(c, mortar, 0.5 * sm(0.62, 0.8, fbm01(t, 9, 2, 1.4)) * clamp01(t.n[1]));
      c = mixc(c, rgb('#5a6a30'), 0.35 * sm(0.6, 0.85, fbm01(t, 4, 3, 7.1)));
      return mixc(c, mulc(b, 1.4), t.edge * 0.6);
    },
  };
}

/** bracket sets (uv: u along the member in member heights, v 0..1 across): faded green-teal with white/red outline rules and small
 * red-white blossoms, grimed in the crevices */
function bracketPaint(): Mat {
  const green = rgb('#237060'), dgreen = rgb('#15463a'), white = rgb('#d8cfb4'), red = rgb('#9a2b1d'), blue = rgb('#20497a');
  return {
    name: 'brackets',
    shade(t) {
      const aa = Math.max(0.02, t.fp * 1.4);
      const u = t.uv[0], v = fract(t.uv[1]);
      let c = mulc(mixc(green, dgreen, 0.4 * fbm01(t, 8, 3, 2.4)), 0.85 + 0.3 * fbm01(t, 25, 2, 7.3));
      c = mixc(c, mulc(white, 0.8), Math.max(line(v - 0.08, 0.035, aa), line(v - 0.92, 0.035, aa)) * 0.8);
      c = mixc(c, red, Math.max(line(v - 0.2, 0.03, aa), line(v - 0.8, 0.03, aa)) * 0.7);
      const cu = fract(u / 2.4) - 0.5, d = Math.hypot(cu * 2.4, (v - 0.5) * 1.2);
      c = mixc(c, blue, 1 - sm(0.3 - aa, 0.3 + aa, d));
      c = mixc(c, white, line(d - 0.2, 0.05, aa));
      c = mixc(c, red, 1 - sm(0.12 - aa, 0.12 + aa, d));
      return mulc(c, 0.7 + 0.3 * t.ao);
    },
  };
}

function aged(name: string, m: Mat, k: number): Mat {
  return {
    name,
    shade(t) {
      const c = m.shade(t);
      const g = lum(c);
      const d = mixc(c, [g, g, g], 0.22 * k);
      return mulc(d, (0.72 + 0.32 * fbm01(t, 2.2, 3, 3.3)) * (1 - 0.25 * k * (1 - t.ao)));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------

const stoneMat = stone('podium', { tex: ['tex_stone_block_wall'], dark: '#45423b', light: '#a2998a', moss: 0.5, dirt: 0.65, wear: 0.75, k: 0.5 });

export const prop: PropDef = {
  id: 'prop_giant_pagoda',
  // 1880 target -> xatlas lands just under a 2048 atlas edge
  size: 1880,
  crease: 40,
  aoShort: 0.55,
  aoLong: 6,
  rays: 12,
  aoGain: 1.8,
  shadowTint: [0.42, 0.4, 0.46],
  mats: [
    stoneMat,
    relief('frieze', stoneMat, friezeH, 0.45),
    wallPaint(),
    wood('timber', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#1c120c', light: '#5a3c27', vertical: true, wear: 0.45, dirt: 0.3 }),
    lacquer('lacquer', { color: '#7a281d', under: '#36221a', vertical: true, wear: 1.1, dirt: 0.55 }),
    aged('dancheong', dancheong('dancheong-raw'), 1),
    slateTile(),
    eaveEdge(),
    soffitPaint(),
    rafterEnds(),
    latticePaint(),
    doorPaint(),
    gold('gold'),
    ridgePaint(),
    railPaint(),
    relief('carving', stone('ramp', { tex: ['tex_stone_block_wall', 'tex_plaza_tile'], dark: '#5a564d', light: '#b2aa98', moss: 0.3, dirt: 0.4, wear: 0.8, k: 0.25, keep: 0 }), dragonH, 0.5),
    bracketPaint(),
  ],
  build(m) {
    const auto = mapAuto(2.2);
    const xfP = rotY(PHASE);
    // ---- podium: lower terrace + upper stage with moulded base, carved frieze band between pilasters, cornice
    m.add(revolve([[13.3, 0], [13.05, 0.38], [13.05, 0.98], [13.4, 1.08], [13.4, 1.25], [11.6, 1.25], [11.6, 1.45], [11.35, 1.62]], N), STONE, auto, xfP);
    m.add(revolve([[11.35, 1.62], [11.35, 2.72]], N), FRIEZE, mapBandSides(2.72, 1.1), xfP);
    m.add(revolve([[11.35, 2.72], [11.72, 2.86], [11.72, PODIUM], [5.9, PODIUM]], N), STONE, auto, xfP);
    const stUV = uvAuto(1.6);
    for (let k = 0; k < N; k++) {
      rbox(m, STONE, cornerAng(k), [Math.cos(cornerAng(k)) * 11.42, 2.17, Math.sin(cornerAng(k)) * 11.42], [0.34, 0.55, 0.2], 'olr', stUV);
      if (k !== FRONT) rbox(m, STONE, faceAng(k), [Math.cos(faceAng(k)) * (11.35 * COS8 + 0.08), 2.17, Math.sin(faceAng(k)) * (11.35 * COS8 + 0.08)], [0.26, 0.55, 0.12], 'olr', stUV);
    }
    // ---- front stair: two flights either side of a carved dragon ramp, cheek walls with ball-finial newels
    {
      const zTop = 11.35 * COS8 - 0.05, steps = 9, run = 0.5, rise = PODIUM / steps;
      const zBot = zTop + steps * run;
      for (const [x0, x1] of [[-3.2, -1.0], [1.0, 3.2]] as [number, number][]) {
        for (let i = 0; i < steps; i++) {
          const yT = PODIUM - i * rise, za = zTop + i * run, zb = za + run;
          quadO(m, STONE, [[x0, yT, za], [x1, yT, za], [x1, yT, zb], [x0, yT, zb]], [[x0, za], [x1, za], [x1, zb], [x0, zb]].map(([a, b]) => [a! / 1.6, b! / 1.6] as Vec2), UP);
          quadO(m, STONE, [[x0, yT - rise, zb], [x1, yT - rise, zb], [x1, yT, zb], [x0, yT, zb]], [[x0 / 1.6, (yT - rise) / 1.6], [x1 / 1.6, (yT - rise) / 1.6], [x1 / 1.6, yT / 1.6], [x0 / 1.6, yT / 1.6]], [0, 0, 1]);
        }
      }
      // dragon ramp: sloped carved slab raised over the step line, with side faces
      const rampT = (z: number): number => PODIUM + 0.18 - ((z - zTop) / (zBot - zTop)) * PODIUM;
      const L = Math.hypot(zBot - zTop, PODIUM);
      quadO(m, CARVE, [[-1.0, rampT(zTop), zTop], [1.0, rampT(zTop), zTop], [1.0, rampT(zBot), zBot], [-1.0, rampT(zBot), zBot]], [[0, 0], [1, 0], [1, L], [0, L]], [0, 0.8, 0.6]);
      for (const sx of [-1, 1]) {
        const x = sx * 1.0;
        quadO(m, STONE, [[x, rampT(zTop), zTop], [x, rampT(zBot), zBot], [x, 0, zBot], [x, PODIUM - 0.5, zTop]], [[zTop / 1.6, 0], [zBot / 1.6, 2], [zBot / 1.6, 2.1], [zTop / 1.6, 0.3]], [sx, 0, 0]);
        // cheek walls
        const xa = sx * 3.2, xb = sx * 3.85, cT = (z: number): number => rampT(z) + 0.75;
        const top = [[xa, cT(zTop), zTop], [xb, cT(zTop), zTop], [xb, cT(zBot), zBot], [xa, cT(zBot), zBot]] as Vec3[];
        quadO(m, STONE, top, top.map((p) => [p[0] / 1.6, p[2] / 1.6] as Vec2), [0, 0.8, 0.6]);
        for (const [xx, out] of [[xb, sx], [xa, -sx]] as [number, number][]) {
          const side = [[xx, 0, zTop], [xx, 0, zBot], [xx, cT(zBot), zBot], [xx, cT(zTop), zTop]] as Vec3[];
          quadO(m, STONE, side, side.map((p) => [p[2] / 1.6, -p[1] / 1.6] as Vec2), [out, 0, 0]);
        }
        const end = [[xa, 0, zBot], [xb, 0, zBot], [xb, cT(zBot), zBot], [xa, cT(zBot), zBot]] as Vec3[];
        quadO(m, STONE, end, end.map((p) => [p[0] / 1.6, -p[1] / 1.6] as Vec2), [0, 0, 1]);
        // newel post + ball finial
        const nx = sx * 3.52, nz = zBot - 0.25;
        rbox(m, STONE, Math.PI / 2, [nx, 0.75, nz], [0.36, 0.75, 0.36], 'oilrt', stUV);
        m.add(revolve([[0, 0], [0.28, 0.12], [0.24, 0.48], [0, 0.62]], 6), STONE, mapCylY(nx, nz, 0.3, 0.8), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, nx, 1.5, nz, 1]);
      }
    }

    // ---- storeys
    for (let i = 0; i < TIERS.length; i++) {
      const T = TIERS[i]!, y = LAYOUT.base[i]!, y0 = LAYOUT.eave[i]!;
      const soffitY = y0 - T.thick, yb = soffitY - stackH(T);
      // the wall runs up to the soffit behind the bracket sets (no see-through gap under the eave)
      const wallTop = soffitY;
      // wall faces with openings
      for (let k = 0; k < N; k++) wallFace(m, T.r, k, y, wallTop, T.win(k), i === 0 ? LACQ : TIMBER, T.proud);
      // corner posts (upper storeys; the ground storey has the colonnade)
      const uvP = uvAuto(1.2);
      if (i > 0) {
        for (let k = 0; k < N; k++) {
          const a = cornerAng(k);
          rbox(m, T.post, a, [Math.cos(a) * (T.r - 0.04), (y + y + T.h) / 2, Math.sin(a) * (T.r - 0.04)], [0.22 * T.s + 0.04, T.h / 2, 0.16], 'olr', uvP);
        }
      }
      // dancheong lintel under the brackets
      const linH = 0.42 + 0.14 * T.s;
      ring(m, DAN, T.r, T.r + 0.16, (i === 0 ? soffitY : y + T.h) - linH, i === 0 ? soffitY : y + T.h, 'o', linH, i * 3.1);
      // base treatment
      if (T.base === 'gallery' || T.base === 'balustrade') {
        const rd = T.r + (T.base === 'gallery' ? 1.0 : 0.85);
        ring(m, TIMBER, T.r, rd, y - 0.7, y + 0.16, 'ot', 0.86);
        const rh = T.base === 'gallery' ? 0.85 : 0.75;
        ring(m, RAIL, rd - 0.1, rd - 0.02, y + 0.16, y + 0.16 + rh, 'oit', rh);
        for (let k = 0; k < N; k++) {
          const a = cornerAng(k);
          rbox(m, T.base === 'gallery' ? TIMBER : LACQ, a, [Math.cos(a) * (rd - 0.06), y + 0.16 + rh / 2 + 0.05, Math.sin(a) * (rd - 0.06)], [0.11, rh / 2 + 0.05, 0.11], 'olrti', uvP);
        }
      } else if (T.base === 'course') {
        ring(m, STONE, T.r, T.r + 0.3, y - 0.5, y + 0.38, 'ot', 0.88);
      }
      // ground storey colonnade: corner pillars on square stone bases carrying a painted ring beam
      let bracketR = T.r;
      if (i === 0) {
        bracketR = RC;
        const beamTop = yb, beamH = 0.75;
        ring(m, DAN, RC - 0.28, RC + 0.28, beamTop - beamH, beamTop, 'oib', beamH, 0.7);
        for (let k = 0; k < N; k++) {
          const a = cornerAng(k), px = Math.cos(a) * RC, pz = Math.sin(a) * RC;
          const ph = beamTop - beamH - y;
          m.add(revolve([[0.4, 0], [0.33, 0.35], [0.31, ph - 0.3], [0.36, ph]], N), LACQ, mapCylY(px, pz, 0.34, 1.2), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, px, y, pz, 1]);
          rbox(m, STONE, a, [px, y + 0.18, pz], [0.55, 0.2, 0.55], 'oilrt', stUV);
        }
      }
      // bracket clusters: corners always, mid-face on the lower storeys
      const reach = T.over * 0.62;
      for (let k = 0; k < N; k++) {
        bracket(m, cornerAng(k), bracketR - 0.05, yb, T.s, reach, T.dbl);
        if (T.mid) bracket(m, faceAng(k), bracketR * COS8 - 0.02, yb, T.s * (T.mid === 2 ? 1 : 0.9), reach * 0.9, T.mid === 2);
      }
      // roof
      const R = (i === 0 ? RC : T.r) + T.over;
      const top = i < TIERS.length - 1 ? TIERS[i + 1]!.r : 0.55;
      const edgeLen = 2 * R * SIN8;
      const rf = roofLoft(m, {
        corners: polyCorners(N, R, PHASE),
        stages: [{ f: 1, corners: polyCorners(N, top, PHASE) }],
        y0, rise: T.rise, q: 1.55, rings: 3, segs: T.segs,
        lift: T.lift, flare: T.flare, reach: 0.5, thick: T.thick,
        soffit: R - T.r + T.flare, soffitFlat: true,
        tile: edgeLen / 2,
        mats: { top: TILE, fascia: EDGE, under: SOFFIT },
      });
      // rafter-end band hung under the soffit, set back from the fascia (the four lower roofs; higher up it is out of sight)
      if (i < 4) {
        const pts = rf.eave;
        let u = 0;
        const bandH = 0.3 * Math.max(0.8, T.s);
        for (let j = 0; j < pts.length; j++) {
          const a = pts[j]!, b = pts[(j + 1) % pts.length]!;
          const inA = 0.28 / Math.hypot(a[0], a[2]), inB = 0.28 / Math.hypot(b[0], b[2]);
          const A: Vec3 = [a[0] * (1 - inA), a[1] - T.thick, a[2] * (1 - inA)], B: Vec3 = [b[0] * (1 - inB), b[1] - T.thick, b[2] * (1 - inB)];
          const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
          const mid: Vec3 = [(A[0] + B[0]) / 2, 0, (A[2] + B[2]) / 2];
          quadO(m, RAFTER, [[A[0], A[1] - bandH, A[2]], [B[0], B[1] - bandH, B[2]], B, A], [[u, 1], [u + len, 1], [u + len, 0], [u, 0]], mid);
          u += len;
        }
      }
      // hip ridges sweeping on past the eave corner into upturned tails (lower roofs), wind bells (ground roof)
      for (let c = 0; c < N; c++) {
        const path = rf.hips[c]!;
        const a = cornerAng(c);
        const tip = path[0]!;
        if (T.ornate || T.hips) {
          cap(m, RIDGE, path.map((p) => [p[0], p[1] + 0.16 * T.s, p[2]] as Vec3), 0.24 * T.s, mapAuto(1), 3);
          const o: Vec3 = [Math.cos(a), 0, Math.sin(a)], S = T.s * (T.ornate ? 1.3 : 1.0);
          // tapered, curling tail: ridge -> out over the corner -> up
          const tail: Vec3[] = [
            [tip[0] - o[0] * 0.3, tip[1] + 0.14 * T.s, tip[2] - o[2] * 0.3],
            [tip[0] + o[0] * 0.35 * S, tip[1] + 0.22 * S, tip[2] + o[2] * 0.35 * S],
            [tip[0] + o[0] * 0.62 * S, tip[1] + 0.6 * S, tip[2] + o[2] * 0.62 * S],
            [tip[0] + o[0] * 0.55 * S, tip[1] + 1.15 * S, tip[2] + o[2] * 0.55 * S],
          ];
          m.add(sweepSolid(circleShape(0.22 * T.s, 3), tail, { scale: (f) => 1 - 0.8 * f }), RIDGE, mapAuto(1));
        }
        if (T.bells) {
          const bx = tip[0] - Math.cos(a) * 0.35, bz = tip[2] - Math.sin(a) * 0.35, by = tip[1] - T.thick - 0.75;
          m.add(revolve([[0, 0], [0.24, 0.03], [0.12, 0.4], [0.02, 0.72]], 5), GOLD, mapCylY(bx, bz, 0.2, 0.6), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, bx, by, bz, 1]);
        }
      }
    }

    // ---- finial mast: lotus base, inverted bowl, stacked rings, flame jewel (scaled to finish at HEIGHT)
    {
      const y0 = LAYOUT.apex - 0.35;
      const H = HEIGHT - y0;
      const sp: [number, number][] = [[0, 0], [1.5, 0], [1.6, 0.04], [1.15, 0.09], [0.55, 0.12], [0.72, 0.135], [0.88, 0.18], [0.72, 0.235], [0.22, 0.25]];
      let yy = 0.27;
      for (let k = 0; k < 4; k++) {
        const rr = 0.75 - k * 0.08;
        sp.push([0.2, yy], [rr, yy + 0.03], [0.2, yy + 0.07]);
        yy += 0.11;
      }
      sp.push([0.14, yy], [0.36, yy + 0.06], [0.3, yy + 0.12], [0.08, yy + 0.2], [0, 1]);
      m.add(revolve(sp.map(([r, h]) => [r, h * H] as [number, number]), N), GOLD, mapCylY(0, 0, 0.6, 1.2), compose(m4translation([0, y0, 0]), rotY(PHASE)));
    }
  },
};
