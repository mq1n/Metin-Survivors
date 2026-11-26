// Conjurer outfit pieces (PieceSpec.build functions). Everything is authored in "reference units" measured on the conjurer anatomy
// (body scale 0.89) and multiplied by K = a.s / 0.89, so a bodyHeight recalibration scales the whole costume.
//   evoUnder  inner robe: closed, tight, straight sleeves, stand collar; shows at the hem, the neckline and the sleeve mouths
//   evoCoat   outer coat: loose A-line, open front (slit below the sash, V neck above), raised lapel + hem borders, solid bell sleeves
//   evoCollar shoulder capelet with a dipping hem
//   evoHat    tiered lacquered crown with side lappets, finial and front plate
//   evoApron  hanging front/back panels under the sash (skirt_f / skirt_b)
//   addRobeFolds  vertical pleats as a displacement of the body SDF, masked to the skirt
import { type Vec3, clamp01, vnorm } from '../../core/math.ts';
import { FnSdf, type Sdf } from '../../core/sdf/node.ts';
import { Offset, SmoothIntersect, SmoothSubtract, SmoothUnion, type UnionChild } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, RoundedBox } from '../../core/sdf/primitives.ts';
import { type Anatomy, type Ctx, Loft, type PieceEnv, Plate, type Station, clipMinus, limbBand, limbEnv, limbTube, slabY } from '../humanoid/index.ts';
import { sectorWedge } from '../humanoid/outfit/soft.ts';

const REF = 0.8899;
export const kOf = (a: Anatomy): number => a.s / REF;
const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

/** station in reference units -> world */
const st = (K: number, y: number, rx: number, rz: number, cz = 0, n = 2.4, cx = 0): Station => ({ y: y * K, rx: rx * K, rz: rz * K, cz: cz * K, cx: cx * K, n });

const BIG = 5;
const hugeBox = { min: [-BIG, -BIG, -BIG] as Vec3, max: [BIG, BIG, BIG] as Vec3 };

/** keep the part of the garment above a hem line whose height depends on the angle around the body axis (theta = 0 at the front, +X = +90 deg) */
function hemClip(hem: (theta: number) => number): Sdf {
  return new FnSdf((x, y, z) => hem(Math.atan2(x, z)) - y, hugeBox, 1.6);
}

/** thin region just above the hem line */
function hemBandRegion(hem: (theta: number) => number, width: number): Sdf {
  return new FnSdf((x, y, z) => {
    const h = hem(Math.atan2(x, z));
    return Math.max(y - (h + width), h - 0.01 - y);
  }, hugeBox, 1.7);
}

/** front opening half-width over height: a slit below the sash (widest at the hem) and a V neckline above it */
function openingWidth(o: { yMin: number; yApex: number; yTop: number; low: number; top: number }): (y: number) => number {
  return (y) => {
    if (y <= o.yApex) return 0.003 + (o.low - 0.003) * clamp01((o.yApex - y) / (o.yApex - o.yMin)) ** 1.4;
    return 0.003 + (o.top - 0.003) * clamp01((y - o.yApex) / (o.yTop - o.yApex)) ** 1.15;
  };
}
const openingCut = (w: (y: number) => number): Sdf => new FnSdf((x, y, z) => Math.max(Math.abs(x) - w(y), 0.012 - z), hugeBox, 1.9);
/** band of width `bw` hugging the outside of the opening edges (front only) */
const openingBand = (w: (y: number) => number, bw: number): Sdf => new FnSdf((x, y, z) => Math.max(Math.abs(x) - w(y) - bw, w(y) - Math.abs(x), 0.012 - z), hugeBox, 1.9);

interface Slice { sdf: Sdf; bone: string; w: number }

/** the garment cut into skinning slices: skirt sectors, hip band, spine, chest */
function slices(a: Anatomy, garment: Sdf, hemY: number): Slice[] {
  const hipY = a.side(1).hip[1];
  const waist = a.spine[1], chestY = a.chest[1];
  const out: Slice[] = [];
  if (a.p.rig?.skirt) {
    const sectors: [string, number][] = [['skirt_f', 0], ['skirt_b', Math.PI], ['skirt_l', Math.PI / 2], ['skirt_r', -Math.PI / 2]];
    for (const [bone, ang] of sectors) {
      const part = new SmoothIntersect([garment, sectorWedge(ang, (Math.PI / 4) * 1.4)], 0.004);
      out.push({ sdf: new SmoothIntersect([part, slabY(hemY - 0.5, hipY - 0.02)], 0.002), bone, w: 0.008 });
    }
  } else {
    out.push({ sdf: new SmoothIntersect([garment, slabY(hemY - 0.5, hipY - 0.02)], 0.002), bone: 'pelvis', w: 0.008 });
  }
  out.push({ sdf: new SmoothIntersect([garment, slabY(hipY - 0.05, waist + 0.03)], 0.002), bone: 'pelvis', w: 0.008 });
  out.push({ sdf: new SmoothIntersect([garment, slabY(waist - 0.04, chestY + 0.04)], 0.002), bone: 'spine', w: 0.008 });
  out.push({ sdf: new SmoothIntersect([garment, slabY(chestY - 0.04, 5)], 0.002), bone: 'chest', w: 0.008 });
  return out;
}

interface WrapCfg {
  stations: Station[];
  hem: (theta: number) => number;
  /** lowest hem height (world m) */
  yMin: number;
  open: ((y: number) => number) | null;
  /** raised border: width of the lapel band along the opening, of the hem band, and how far both stand off the cloth (m) */
  lapel: number;
  hemBand: number;
  raise: number;
  /** skin tags beyond the material */
  tag?: string;
}

/** loft garment: hem curve, front opening, raised borders, split into skinning slices and added to the body */
function wrap(e: PieceEnv, c: WrapCfg): void {
  const a = e.a;
  const loft = new Loft(c.stations, { cap: 0.01 });
  let g: Sdf = new SmoothIntersect([loft, hemClip(c.hem)], 0.003);
  if (c.open) g = clipMinus(g, [openingCut(c.open)], 0.006);
  const parts: UnionChild[] = [{ node: g, w: 0 }];
  const grown = c.raise > 0 ? new Offset(loft, c.raise) : null;
  if (grown && c.open && c.lapel > 0) {
    const band = new SmoothIntersect([grown, hemClip(c.hem), openingBand(c.open, c.lapel)], 0.003);
    parts.push({ node: band, w: 0.004 });
    e.ctx.mark(`${e.spec.id}_trim_lapel`, new SmoothIntersect([new Offset(loft, c.raise + 0.004), openingBand(c.open, c.lapel * 0.62), hemClip(c.hem)], 0.001), [e.trimTag]);
  }
  if (grown && c.hemBand > 0) {
    let hb: Sdf = new SmoothIntersect([grown, hemBandRegion(c.hem, c.hemBand)], 0.003);
    if (c.open) hb = clipMinus(hb, [openingCut(c.open)], 0.004);
    parts.push({ node: hb, w: 0.004 });
    e.ctx.mark(`${e.spec.id}_trim_hem`, new SmoothIntersect([new Offset(loft, c.raise + 0.004), hemBandRegion(c.hem, c.hemBand * 0.62)], 0.001), [e.trimTag]);
  }
  const garment: Sdf = parts.length === 1 ? g : new SmoothUnion(parts);
  for (const s of slices(a, garment, c.yMin)) {
    e.ctx.add(`${e.spec.id}_${s.bone}_${Math.round(s.sdf.bounds().min[1] * 100)}`, s.sdf, s.bone, { tags: e.tag(e.mat, s.bone.startsWith('skirt') ? 'skirt' : 'torso', ...(c.tag ? [c.tag] : [])), w: s.w });
  }
}

/**
 * Wide sleeve for one arm: a solid flared tube along the arm (radius = arm envelope + a growing offset) that stops above the wrist in a
 * rolled cuff band, so the hand and the inner robe's cuff come out of the open end. (A hollow thin shell breaks into shards at the crowd
 * voxel size.) The hanging cloth that makes the sleeve read as wide is authored separately (conjurer_cloth.ts). Split at the elbow
 * between the two arm bones.
 */
function wideSleeve(e: PieceEnv, sx: 1 | -1, K: number): void {
  const env = limbEnv(e.a, sx, 'arm');
  const n = L(sx);
  const mid = env.uMid;
  const ext = (u: number): number => (0.02 + 0.05 * clamp01((u - 0.3) / 0.6) ** 1.3) * K;
  const uEnd = 0.9;
  e.ctx.add(`${e.spec.id}_sleeveU_${n}`, limbTube(env, 0.0, mid + 0.04, ext), `upper_arm_${n}`, { tags: e.tag(e.mat), w: 0.01 });
  e.ctx.add(`${e.spec.id}_sleeveL_${n}`, limbBand(env, mid - 0.04, uEnd, ext, { edge: 0.006, round: 0.006 }), `forearm_${n}`, { tags: e.tag(e.mat, 'cuff'), w: 0.01 });
  // rolled cuff band at the mouth
  e.ctx.add(`${e.spec.id}_cuff_${n}`, limbBand(env, uEnd - 0.07, uEnd, (u) => ext(u) + 0.011 * K, { edge: 0.005, round: 0.006 }), `forearm_${n}`, { tags: e.tag(e.mat, 'cuff'), w: 0.006 });
  e.ctx.mark(`${e.spec.id}_trim_cuff_${n}`, limbBand(env, uEnd - 0.05, uEnd + 0.005, (u) => ext(u) + 0.014 * K), [e.trimTag]);
}

/** straight tube sleeve (inner robe) along the whole arm */
function tubeSleeve(e: PieceEnv, sx: 1 | -1, ext: number): void {
  const env = limbEnv(e.a, sx, 'arm');
  const n = L(sx);
  const mid = env.uMid;
  e.ctx.add(`${e.spec.id}_sleeveU_${n}`, limbTube(env, 0.02, mid + 0.04, ext), `upper_arm_${n}`, { tags: e.tag(e.mat), w: 0.01 });
  e.ctx.add(`${e.spec.id}_sleeveL_${n}`, limbTube(env, mid - 0.04, 0.985, ext * 1.15), `forearm_${n}`, { tags: e.tag(e.mat, 'cuff'), w: 0.01 });
}

/** loose A-line outer coat. o: hem (reference m of the back hem height), lift (front corner rise), flare, open (slit half width at the hem, ref m) */
export function evoCoat(e: PieceEnv): void {
  const { a } = e;
  const K = kOf(a);
  const hem = e.n('hem', 0.17);
  const lift = e.n('lift', 0.11);
  const flare = e.n('flare', 1);
  const hemFn = (th: number): number => (hem + lift * Math.max(0, Math.cos(th)) ** 1.6) * K;
  const yMin = hem * K - 0.02;
  const open = openingWidth({ yMin, yApex: a.spine[1] + 0.03 * K, yTop: a.neck[1] + 0.01 * K, low: e.n('open', 0.075) * K, top: 0.075 * K });
  const stations: Station[] = [
    st(K, hem - 0.04, 0.36 * flare, 0.285 * flare, -0.01, 2.1),
    st(K, hem + 0.12, 0.325 * flare, 0.255 * flare, -0.008, 2.15),
    st(K, 0.5, 0.255 * flare, 0.2 * flare, -0.004, 2.25),
    st(K, 0.78, 0.215, 0.168, -0.002, 2.35),
    st(K, 0.93, 0.19, 0.15, 0, 2.45),
    st(K, 1.03, 0.196, 0.15, 0.004, 2.55),
    st(K, 1.15, 0.2, 0.152, 0.008, 2.65),
    st(K, 1.26, 0.215, 0.145, 0.01, 2.7),
    st(K, 1.325, 0.19, 0.12, 0.01, 2.5),
    st(K, 1.36, 0.12, 0.092, 0.01, 2.3),
    { y: a.neck[1] + 0.012 * K, rx: 0.074 * K, rz: 0.078 * K, cz: 0.012 * K, n: 2.2 },
  ];
  wrap(e, { stations, hem: hemFn, yMin, open, lapel: 0.034 * K, hemBand: 0.05 * K, raise: 0.009 * K });
  for (const sx of BOTH) wideSleeve(e, sx, K);
}

/** inner robe: tight, straight, longer than the coat in front; stand collar; narrow tube sleeves */
export function evoUnder(e: PieceEnv): void {
  const { a } = e;
  const K = kOf(a);
  const hem = e.n('hem', 0.05);
  const hemFn = (): number => hem * K;
  const stations: Station[] = [
    st(K, hem - 0.04, 0.3, 0.24, -0.008, 2.1),
    st(K, hem + 0.15, 0.27, 0.215, -0.006, 2.15),
    st(K, 0.5, 0.215, 0.17, -0.003, 2.25),
    st(K, 0.78, 0.17, 0.135, 0, 2.35),
    st(K, 0.93, 0.138, 0.108, 0.002, 2.45),
    st(K, 1.03, 0.14, 0.108, 0.004, 2.55),
    st(K, 1.15, 0.158, 0.116, 0.008, 2.65),
    st(K, 1.26, 0.178, 0.116, 0.01, 2.7),
    st(K, 1.325, 0.16, 0.1, 0.01, 2.5),
    st(K, 1.36, 0.1, 0.082, 0.01, 2.3),
    { y: a.neck[1] + 0.012 * K, rx: 0.07 * K, rz: 0.074 * K, cz: 0.012 * K, n: 2.2 },
  ];
  wrap(e, { stations, hem: hemFn, yMin: hem * K - 0.02, open: null, lapel: 0, hemBand: 0.05 * K, raise: 0.008 * K });
  for (const sx of BOTH) tubeSleeve(e, sx, 0.013 * K);
  // stand collar with a rolled rim
  const y0 = a.neck[1] - 0.014 * K;
  const col = new Loft([
    { y: y0, rx: 0.084 * K, rz: 0.088 * K, cz: 0.01 * K, n: 2.3 },
    { y: y0 + 0.05 * K, rx: 0.07 * K, rz: 0.076 * K, cz: 0.012 * K, n: 2.3 },
    { y: y0 + 0.09 * K, rx: 0.074 * K, rz: 0.08 * K, cz: 0.014 * K, n: 2.3 },
  ], { cap: 0.009 * K });
  const hole = new Loft([
    { y: y0 - 0.5, rx: 0.05 * K, rz: 0.054 * K, cz: 0.012 * K, n: 2.2 },
    { y: y0 + 0.2, rx: 0.054 * K, rz: 0.058 * K, cz: 0.014 * K, n: 2.2 },
  ], { cap: 0 });
  e.ctx.add(`${e.spec.id}_collar`, new SmoothSubtract(col, [{ node: hole, w: 0.004 }]), 'neck', { tags: e.tag(e.mat), w: 0.006 });
  e.ctx.mark(`${e.spec.id}_trim_collar`, new SmoothIntersect([col, slabY(y0 + 0.075 * K, 5)], 0.001), [e.trimTag]);
}

/**
 * Tiered lacquered crown: a headband, three flared drums stepping inward, a gold finial; side lappets hanging behind the cheeks. o: h (total
 * crown height, reference m), tiers
 */
export function evoHat(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const y0 = sk[1] + e.n('base', 0.045) * k;
  const H = e.n('h', 0.27) * k;
  const rx0 = 0.098 * k, rz0 = 0.112 * k;
  const cz0 = sk[2] - 0.016 * k;
  const add = (name: string, sdf: Sdf, extra: string[] = []): void => {
    e.ctx.add(`${e.spec.id}_${name}`, sdf, 'head', { tags: e.tag(e.mat, ...extra), w: 0.005, grip: 2 });
  };
  // headband + three drums: each drum widens upward (flower-pot) and the next steps in
  const tiers: [number, number, number, number, number][] = [
    // [y from, y to, rx bottom, rx top, tier id]
    [0.0, 0.3, 1.0, 1.07, 0],
    [0.3, 0.62, 0.8, 0.93, 1],
    [0.62, 0.92, 0.58, 0.7, 2],
  ];
  for (const [f0, f1, r0, r1, id] of tiers) {
    const lo = y0 + f0 * H, hi = y0 + f1 * H;
    const loft = new Loft([
      { y: lo, rx: rx0 * r0, rz: rz0 * r0, cz: cz0, n: 2.35 },
      { y: lo + (hi - lo) * 0.5, rx: rx0 * (r0 + (r1 - r0) * 0.35), rz: rz0 * (r0 + (r1 - r0) * 0.35), cz: cz0, n: 2.35 },
      { y: hi, rx: rx0 * r1, rz: rz0 * r1, cz: cz0, n: 2.35 },
    ], { cap: 0.006 * k });
    add(`tier${id}`, loft);
    // gold rim at the top edge of each drum
    e.ctx.mark(`${e.spec.id}_trim_t${id}`, new SmoothIntersect([loft, slabY(hi - 0.018 * k, hi + 0.01)], 0.001), [e.trimTag]);
  }
  // crown cap + finial (a flame-like gold jewel); the tip stays wider than a voxel so decimation keeps the crown top (the model height)
  const yTop = y0 + 0.92 * H;
  add('cap', new Ellipsoid([sk[0], yTop, cz0], [rx0 * 0.5, 0.04 * k, rz0 * 0.5]), []);
  const fin0: Vec3 = [sk[0], yTop + 0.012 * k, cz0], fin1: Vec3 = [sk[0], yTop + 0.094 * k, cz0 - 0.014 * k];
  e.ctx.add(`${e.spec.id}_finial`, new RoundCone(fin0, fin1, 0.024 * k, 0.011 * k), 'head', { tags: e.tag(e.mat), w: 0.004, grip: 2 });
  e.ctx.mark(`${e.spec.id}_trim_finial`, new RoundCone(fin0, fin1, 0.026 * k, 0.013 * k), [e.trimTag]);
  // front plate on the lowest drum
  e.ctx.add(`${e.spec.id}_plate`, new RoundedBox([sk[0], y0 + 0.15 * H, cz0 + rz0 * 1.03], [0.036 * k, 0.11 * H, 0.008 * k], 0.005 * k), 'head', { tags: e.tag(e.mat), w: 0.003, grip: 2 });
  e.ctx.mark(`${e.spec.id}_trim_plate`, new RoundedBox([sk[0], y0 + 0.15 * H, cz0 + rz0 * 1.03 + 0.003 * k], [0.028 * k, 0.09 * H, 0.008 * k], 0.004 * k), [e.trimTag]);
  // side lappets: hung behind the cheekbones with the front edge flaring out, so they frame the head without touching (or shading) the face
  for (const sx of BOTH) {
    const o: Vec3 = [sx * rx0, y0 - 0.075 * k, cz0 - 0.045 * k];
    const pl = new Plate({ o, nrm: vnorm([sx, 0, -0.1]), up: [0, 1, 0], hu: 0.06 * k, hv: 0.075 * k, R: 0.1 * k, t: 0.012 * k, round: 0.004 * k, taper: 0.35, edgeThin: 0.8 });
    add(`lappet_${L(sx)}`, pl);
    e.ctx.mark(`${e.spec.id}_trim_lappet_${L(sx)}`, pl.rim(0.007 * k), [e.trimTag]);
  }
}

/**
 * Shoulder capelet (cloud collar): a short cone over the shoulders whose hem scallops into four lobes (front and back long, the two side
 * lobes shorter) with notches between them, edged by a raised border.
 */
export function evoCollar(e: PieceEnv): void {
  const { a } = e;
  const K = kOf(a);
  // lobe profile: 1 at the lobe centres (front, back, left, right), 0 in the notches
  const lobe = (th: number): number => (0.5 + 0.5 * Math.cos(4 * th)) ** 0.85 * (0.62 + 0.38 * Math.cos(th) ** 2);
  const hemFn = (th: number): number => (1.255 - 0.115 * lobe(th)) * K;
  const cape = new Loft([
    st(K, 1.1, 0.25, 0.2, 0.004, 2.3),
    st(K, 1.2, 0.238, 0.18, 0.006, 2.4),
    st(K, 1.29, 0.222, 0.158, 0.008, 2.5),
    st(K, 1.345, 0.155, 0.118, 0.01, 2.4),
    { y: a.neck[1] + 0.006 * K, rx: 0.088 * K, rz: 0.092 * K, cz: 0.012 * K, n: 2.2 },
  ], { cap: 0.008 * K });
  const shape: Sdf = new SmoothIntersect([cape, hemClip(hemFn)], 0.004);
  const border = new SmoothIntersect([new Offset(cape, 0.007 * K), hemBandRegion(hemFn, 0.026 * K)], 0.003);
  e.ctx.add(`${e.spec.id}_cape`, new SmoothUnion([{ node: shape, w: 0 }, { node: border, w: 0.004 }]), 'chest', { tags: e.tag(e.mat), w: 0.008, grip: 3 });
  e.ctx.mark(`${e.spec.id}_trim_hem`, new SmoothIntersect([new Offset(cape, 0.01 * K), hemBandRegion(hemFn, 0.016 * K)], 0.001), [e.trimTag]);
}

/** hanging panels under the sash: a long front tabard and a shorter back panel, pointed at the hem, skinned to the skirt bones */
export function evoApron(e: PieceEnv): void {
  const { a } = e;
  const K = kOf(a);
  const top = a.spine[1] - 0.02 * K;
  const len = e.n('len', 0.62) * K;
  const half = e.n('half', 0.085) * K;
  const sk = !!a.p.rig?.skirt;
  const sides: { z: number; lenK: number; bone: string }[] = [
    { z: 0.158 * K, lenK: 1, bone: 'skirt_f' },
    { z: -0.14 * K, lenK: 0.82, bone: 'skirt_b' },
  ];
  for (const [i, sd] of sides.entries()) {
    const L1 = len * sd.lenK;
    const front = i === 0;
    const o: Vec3 = [0, top - L1 / 2, sd.z + (front ? 0.07 : -0.065) * K];
    const pl = new Plate({ o, nrm: [0, 0.07 * (front ? 1 : -1), front ? 1 : -1], up: [0, 1, 0], hu: half, hv: L1 / 2, R: front ? 0.2 * K : -0.2 * K, t: 0.014 * K, round: 0.005 * K, taper: -0.5, bow: 0.02 * K, edgeThin: 0.8 });
    e.ctx.add(`${e.spec.id}_${front ? 'front' : 'back'}`, pl, sk ? sd.bone : 'pelvis', { tags: e.tag(e.mat, 'skirt'), w: 0.006, grip: 2.5 });
    e.ctx.mark(`${e.spec.id}_trim_${front ? 'front' : 'back'}`, pl.rim(0.009 * K), [e.trimTag]);
  }
}

/** vertical pleats: a displacement of the body SDF masked to the skirt volume, heavier toward the hem (the staff and strips stay straight) */
export function addRobeFolds(ctx: Ctx, a: Anatomy, o: { amp?: number; count?: number; flare?: number } = {}): void {
  const K = kOf(a);
  const amp = (o.amp ?? 0.0075) * K;
  const n = o.count ?? 15;
  const hipY = a.side(1).hip[1];
  const yHem = 0.12 * K;
  // skirt radius over height: wide at the hem, narrowing to the hip
  const skirtR = (y: number): number => (0.18 + 0.17 * (o.flare ?? 1) * clamp01((hipY - y) / (hipY - yHem))) * K;
  ctx.body.displace({
    eval: (x, y, z) => {
      if (y > hipY - 0.02 || y < yHem) return 0;
      const rho = Math.hypot(x, z);
      const R = skirtR(y);
      if (rho < 0.17 * K || rho > R + 0.05) return 0;
      const th = Math.atan2(x, z);
      const hem = clamp01((hipY - y) / (hipY - 0.15));
      const inner = clamp01((rho - 0.17 * K) / (0.06 * K));
      const outer = 1 - clamp01((rho - R) / 0.05);
      const mask = inner * outer * clamp01((hipY - 0.02 - y) / 0.12) * clamp01((y - yHem) / 0.06);
      return mask * (0.3 + 0.7 * hem) * (Math.sin(n * th + 2.2 * y) * 0.7 + Math.sin(n * 0.5 * th + 1.3) * 0.3);
    },
    lip: 2 * n * 0.3 + 1,
  }, amp);
}
