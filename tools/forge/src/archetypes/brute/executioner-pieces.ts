// Custom outfit pieces for the masked executioner (PieceSpec.build functions). Each piece paints with ONE material family
// (its `mat`); multi-material gear is split in two specs (leather apron + iron studs...). Geometry follows the humanoid
// conventions: world rest pose, +Z forward, parts skinned to the bone that carries the surface. Everything is chunky on
// purpose: at <= 5k triangles anything smaller than ~4 cm is lost in the decimation, so form carries the read and the
// painted texture carries the rest (stitches, stains, rust).
import { type Aabb, type Vec3, qaxis, qfromBasis, vadd, vcross, vdot, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Sdf } from '../../core/sdf/node.ts';
import { SmoothIntersect, SmoothSubtract } from '../../core/sdf/ops.ts';
import { Ellipsoid, HalfSpace, RoundCone, RoundedBox, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { type Anatomy, type Ctx, Loft, type PieceEnv, type Station, boxClip, cover, limbEnv, slabAxis, slabY } from '../humanoid/index.ts';

type Side = 1 | -1;
const BOTH = [1, -1] as Side[];
const L = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');
const smooth01 = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** add one part of a piece with the piece's paint tags */
const put = (e: PieceEnv, name: string, sdf: Sdf, bone: string, o: { w?: number; grip?: number; extra?: string[] } = {}): void => {
  e.ctx.add(`${e.spec.id}_${name}`, sdf, bone, { tags: e.tag(e.mat, ...(o.extra ?? [])), w: o.w ?? 0.005, grip: o.grip ?? 1.4 });
};

// ---------------------------------------------------------------------------------------------------------------------
// shared torso helpers

/** point on the torso surface at height y: `u` in [-1,1] runs left-right across the front (0 = centre), `back` selects the back */
export function torsoPoint(a: Anatomy, y: number, u: number, ext = 0, back = false): Vec3 {
  const st = new Loft(a.torso).at(y);
  const n = st.n;
  const x = st.cx + st.rx * u;
  const f = Math.max(0, 1 - Math.abs(u) ** n) ** (1 / n);
  const z = st.cz + (back ? -1 : 1) * st.rz * f;
  return [x, y, z + (back ? -ext : ext)];
}

/**
 * Solid chain links along a path: alternating flat / edge-on ovals. Hollow torus links decimate into see-through shards at this
 * triangle count, so the links are solid blobs that fuse with the body and the holes are painted (`linkhole`).
 */
function solidLinks(pts: Vec3[], major: number, minor: number, thick: number, outward: (p: Vec3) => Vec3): { sdf: Sdf; hole: Sdf | null; at: Vec3 }[] {
  const out: { sdf: Sdf; hole: Sdf | null; at: Vec3 }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!, p1 = pts[i + 1]!;
    const dir = vnorm(vsub(p1, p0));
    const mid = vlerp(p0, p1, 0.5);
    const n0 = outward(mid);
    const nrm = vnorm(vsub(n0, vscale(dir, vdot(n0, dir)))); // surface normal made perpendicular to the chain direction
    const side = vcross(dir, nrm);
    const flat = i % 2 === 0;
    // local x = chain direction (long axis), y = across, z = thickness axis (right-handed)
    const across: Vec3 = flat ? side : nrm;
    const q = qfromBasis(dir, across, vcross(dir, across));
    out.push({
      sdf: new Ellipsoid(mid, [major, minor, thick], q),
      hole: flat ? new Ellipsoid(mid, [major * 0.5, minor * 0.5, thick * 2.4], q) : null,
      at: mid,
    });
  }
  return out;
}

const boneForY = (a: Anatomy, y: number): string => (y < a.spine[1] - 0.02 * a.s ? 'pelvis' : y < a.chest[1] ? 'spine' : 'chest');

// ---------------------------------------------------------------------------------------------------------------------
// hood: stitched leather bag over the skull with a tight mask face, angry eye holes, stitched mouth, brow strap, ear flaps, cowl

/**
 * Hangman's hood. o: peak (0..1.5, length of the floppy crown peak), slant (eye-hole slant rad), flaps (0/1)
 */
export function stitchedHood(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const s = a.s;
  const sk = a.skull;
  const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
  const peak = e.n('peak', 1);
  const slant = e.n('slant', 0.5);

  // leather bag over the cranium + a floppy peak leaning back
  put(e, 'dome', new Ellipsoid(H(0, 0.03, -0.02), [0.104 * k, 0.1 * k, 0.117 * k]), 'head', { w: 0.01, grip: 1.6 });
  if (peak > 0) {
    put(e, 'peak', tube([H(0, 0.085, -0.06), H(0, 0.122, -0.092 - 0.02 * peak), H(0, 0.085 + 0.02 * peak, -0.135 - 0.07 * peak)], [[0, 0.062 * k], [0.55, 0.046 * k], [1, 0.021 * k]], { segments: 4, w: 0.02 * k }), 'head', { w: 0.012, grip: 1.6 });
  }
  // tight mask over the face: every facial part inflated by the leather thickness (brow ridge, nose, cheekbones, jaw stay readable)
  cover(e, ['face', 'jaw_', 'jawfill', 'chin', 'cheek_', 'nose_', 'brow_', 'lip_'], 0.015 * k, { w: 0.01, grip: 1.6, extra: ['mask'] });

  // raised leather rims around the eye holes (the holes themselves are cut below)
  for (const sx of BOTH) {
    put(e, `rim_${L(sx)}`, new Ellipsoid(H(sx * 0.034, 0.002, 0.098), [0.036 * k, 0.026 * k, 0.03 * k], qaxis([0, 0, 1], sx * slant)), 'head', { w: 0.008, grip: 1.6 });
  }
  // brow strap: a thick band buckled around the forehead
  put(e, 'strap', new Torus(H(0, 0.052, -0.014), 0.108 * k, 0.0135 * k, [0, 1, 0.14]), 'head', { w: 0.004, grip: 1.6 });
  // heavy centre seam down the back of the bag
  put(e, 'seam', new RoundCone(H(0, 0.125, -0.125), H(0, -0.045, -0.123), 0.011 * k, 0.012 * k), 'head', { w: 0.006, grip: 1.6, extra: ['thread'] });
  // stitched crossing seam over the left cheek / temple (diagonal, off-centre = menace)
  put(e, 'seam2', new RoundCone(H(0.052, 0.07, 0.06), H(0.082, -0.01, 0.04), 0.0095 * k, 0.0095 * k), 'head', { w: 0.006, grip: 1.6, extra: ['thread'] });
  // stitch bars across the carved mouth slit
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.0125;
    put(e, `stitch${i}`, new RoundCone(H(x, -0.052, 0.112), H(x, -0.079, 0.112), 0.0075 * k, 0.0075 * k), 'head', { w: 0.004, grip: 1.6, extra: ['thread'] });
  }
  // ear flaps hanging over the ears
  if (e.n('flaps', 1) > 0) {
    for (const sx of BOTH) {
      put(e, `flap_${L(sx)}`, flatCone(H(sx * 0.098, 0.035, 0.0), H(sx * 0.114, -0.085, -0.012), 0.044 * k, 0.03 * k, 0.28, [sx, 0, 0]), 'head', { w: 0.006, grip: 1.6 });
    }
  }

  // cowl: the bag narrows over the throat and flares onto the trapezius; a cinched rope ring ties it off
  const nk = a.neck;
  const cowl = new Loft([
    { y: sk[1] - 0.06 * k, rx: 0.1 * k, rz: 0.106 * k, cz: sk[2] - 0.018 * k, n: 2 },
    { y: a.head[1], rx: 0.114 * k, rz: 0.11 * k, cz: a.head[2] - 0.006 * k, n: 2 },
    { y: nk[1] + 0.075 * s, rx: 0.14 * s, rz: 0.118 * s, cz: nk[2] - 0.004 * s, n: 2.1 },
    { y: nk[1] + 0.005 * s, rx: 0.205 * s, rz: 0.15 * s, cz: nk[2] - 0.004 * s, n: 2.3 },
    { y: nk[1] - 0.045 * s, rx: 0.235 * s, rz: 0.168 * s, cz: nk[2] + 0.004 * s, n: 2.4 },
  ], { cap: 0.02 * s });
  put(e, 'cowl', cowl, 'neck', { w: 0.012, grip: 1.3 });
  put(e, 'rope', new Torus([0, nk[1] + 0.082 * s, nk[2] - 0.004 * s], 0.142 * s, 0.02 * s, [0, 1, 0.1]), 'neck', { w: 0.004, grip: 1.3 });
  put(e, 'knot', new Sphere([-0.02 * s, nk[1] + 0.07 * s, nk[2] + 0.128 * s], 0.032 * s), 'neck', { w: 0.006, grip: 1.3 });

  // floppy tail hanging from the back of the bag on the hair chain (swings with the head)
  const hc = a.layout.hair;
  if (hc) {
    const pts = hc.pts;
    const nb = hc.bones.length;
    for (let i = 0; i < nb; i++) {
      const p0 = i === 0 ? H(0, 0.055, -0.108) : pts[i]!;
      let p1 = pts[i + 1]!;
      if (i === nb - 1) p1 = vadd(p1, [0, -0.07 * k, -0.01 * k]);
      const rb = (0.047 - 0.008 * i) * k, rt = (0.04 - 0.008 * i) * k;
      put(e, `tail${i}`, flatCone(p0, p1, rb, rt, 0.34, [0, 0, 1]), hc.bones[i]!, { w: 0.006, grip: 1.5 });
    }
  }

  // carved holes: angry slanted eyes (inner corners low), a stitched slit mouth (paint marks the carved surfaces near black)
  for (const sx of BOTH) {
    e.ctx.cut(`${e.spec.id}_eye_${L(sx)}`, new Ellipsoid(H(sx * 0.034, 0.0, 0.108), [0.025 * k, 0.0145 * k, 0.05 * k], qaxis([0, 0, 1], sx * slant)), 'head', { tags: ['hoodhole'], w: 0.005 });
  }
  e.ctx.cut(`${e.spec.id}_mouth`, new Ellipsoid(H(0, -0.066, 0.106), [0.034 * k, 0.0085 * k, 0.032 * k]), 'head', { tags: ['hoodhole'], w: 0.004 });
}

/** iron fittings of the hood: brow buckle, rivets along the cowl rope */
export function hoodHardware(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const s = a.s;
  const sk = a.skull;
  const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
  // buckle plate on the brow strap (off-centre, right side of the face)
  put(e, 'buckle', new RoundedBox(H(-0.052, 0.058, 0.1), [0.021 * k, 0.017 * k, 0.01 * k], 0.005 * k, qaxis([0, 1, 0], 0.5)), 'head', { w: 0.004, grip: 1.6 });
  put(e, 'boss', new Sphere(H(-0.058, 0.058, 0.108), 0.0105 * k), 'head', { w: 0.004, grip: 1.6 });
  // rivets around the strap
  for (let i = 0; i < 5; i++) {
    const th = 0.5 + i * 0.5;
    const sgn = i % 2 === 0 ? 1 : -1;
    const x = sgn * Math.sin(th) * 0.108 * k, z = Math.cos(th) * 0.108 * k * 0.95 - 0.014 * k;
    put(e, `rivet${i}`, new Sphere([sk[0] + x, sk[1] + 0.052 * k + 0.003 * z, sk[2] + z], 0.0085 * k), 'head', { w: 0.003, grip: 1.6 });
  }
  void s;
}

// ---------------------------------------------------------------------------------------------------------------------
// apron

class Panel extends Sdf {
  constructor(
    private p: {
      yTop: number;
      yBot: number;
      w: (y: number) => number;
      zc: (x: number, y: number) => number;
      t: number;
      hem: (x: number) => number;
      round: number;
      xmax: number;
      zmin: number;
      zmax: number;
      hemMax: number;
    },
  ) {
    super();
    this.lip = 1.6;
  }
  d(x: number, y: number, z: number): number {
    const p = this.p, r = p.round;
    const w = p.w(y);
    const zc = p.zc(x, y);
    const yb = p.yBot + p.hem(x);
    const qx = Math.abs(x) - w + r;
    const qz = Math.abs(z - zc) - p.t + r;
    const qy = Math.max(yb - y, y - p.yTop) + r;
    const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  }
  protected computeBounds(): Aabb {
    const p = this.p;
    return { min: [-p.xmax - 0.01, p.yBot - 0.01, p.zmin - p.t - 0.01], max: [p.xmax + 0.01, p.yTop + 0.01, p.zmax + p.t + 0.01] };
  }
}

/** shared apron geometry (leather panel + metal studs agree on where the panel is) */
function apronGeom(a: Anatomy, e: PieceEnv): {
  yTop: number; yBelt: number; yBot: number; t: number;
  zc: (x: number, y: number) => number; w: (y: number) => number; hem: (x: number) => number;
} {
  const s = a.s;
  const T = new Loft(a.torso);
  const t = 0.0115 * s;
  const gap = 0.008 * s;
  const off = gap + t;
  const yBelt = a.spine[1] - 0.025 * s;
  const yTop = a.chest[1] + e.n('top', -0.035) * s;
  const yBot = a.side(1).knee[1] + e.n('hem', 0.012) * s;
  const front = (x: number, y: number, ext: number): number => {
    const st = T.at(y);
    const ux = Math.min(Math.abs(x - st.cx) / (st.rx + ext), 0.995);
    return st.cz + (st.rz + ext) * Math.pow(Math.max(1 - Math.pow(ux, st.n), 0), 1 / st.n);
  };
  const zBelt = front(0, yBelt, off);
  // keyed centre-line z of the hanging part (x = 0): flares away from the belly to clear the thighs, falls back to the knees
  const keys: [number, number][] = [[yBelt, zBelt], [yBelt - 0.14 * s, zBelt + 0.03 * s], [yBelt - 0.3 * s, zBelt + 0.082 * s], [yBelt - 0.45 * s, zBelt + 0.104 * s], [yBot + 0.1 * s, zBelt + 0.108 * s], [yBot, zBelt + 0.1 * s]];
  const hang = (y: number): number => {
    if (y >= keys[0]![0]) return keys[0]![1];
    for (let i = 0; i < keys.length - 1; i++) {
      const k0 = keys[i]!, k1 = keys[i + 1]!;
      if (y >= k1[0]) return k0[1] + (k1[1] - k0[1]) * smooth01((k0[0] - y) / (k0[0] - k1[0]));
    }
    return keys[keys.length - 1]![1];
  };
  const w = (y: number): number => {
    if (y >= yBelt) return (0.205 + 0.012 * smooth01((yTop - y) / (yTop - yBelt))) * s * 1.0;
    return (0.217 + 0.06 * smooth01((yBelt - y) / (yBelt - yBot))) * s;
  };
  const zc = (x: number, y: number): number => {
    const m = smooth01((y - (yBelt - 0.05 * s)) / (0.1 * s)); // 1 above the belt (follows the torso), 0 below (hangs)
    const bib = front(x, y, off);
    const wy = w(y);
    const bow = (0.034 + 0.05 * (1 - m)) * s * Math.min((x / wy) * (x / wy), 1.2);
    return m * bib + (1 - m) * (hang(y) - bow);
  };
  const hem = (x: number): number => 0.034 * s * (0.5 + 0.5 * Math.sin(x * 15 / s + 0.9));
  return { yTop, yBelt, yBot, t, zc, w, hem };
}

/**
 * Heavy leather apron: curved bib below the pecs (follows the torso) hanging into a stiff panel to the knees that stands off
 * the thighs; scalloped hem, tattered strips, a stitched pocket patch. o: top (ref m relative to the chest joint), hem
 */
export function leatherApron(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const g = apronGeom(a, e);
  const panel = new Panel({ yTop: g.yTop, yBot: g.yBot, w: g.w, zc: g.zc, t: g.t, hem: g.hem, round: 0.007 * s, xmax: 0.3 * s, zmin: 0.0, zmax: 0.34 * s, hemMax: 0.034 * s });
  // bib + belt zone follow the torso, the hanging part swings on the front skirt bone
  const seam = g.yBelt - 0.02 * s;
  const upper = new SmoothIntersect([panel, slabY(seam, g.yTop + 0.05 * s, 0.001)], 0.002);
  const lower = new SmoothIntersect([panel, slabY(g.yBot - 0.1 * s, seam, 0.001)], 0.002);
  put(e, 'bib', upper, boneForY(a, g.yBelt + 0.05 * s), { w: 0.006, grip: 1.6 });
  put(e, 'skirt', lower, a.p.rig?.skirt ? 'skirt_f' : 'pelvis', { w: 0.006, grip: 1.8 });
  // dark border band (painted with the piece trim colour): the panel minus an inset copy of itself
  const inset = new Panel({ yTop: g.yTop - 0.018 * s, yBot: g.yBot + 0.03 * s, w: (y) => g.w(y) - 0.024 * s, zc: g.zc, t: g.t + 0.012 * s, hem: g.hem, round: 0.007 * s, xmax: 0.3 * s, zmin: 0.0, zmax: 0.34 * s, hemMax: 0.034 * s });
  e.ctx.mark(`${e.spec.id}_trim`, new SmoothSubtract(panel, [{ node: inset, w: 0.001 }]), [e.trimTag]);
  // tattered strips below the scalloped hem
  const rng = new Rng(`${a.p.seed}/apron${e.i}`);
  const nS = e.n('strips', 6);
  for (let i = 0; i < nS; i++) {
    const x = ((i + 0.5) / nS - 0.5) * 2 * g.w(g.yBot) * 0.9;
    const y0 = g.yBot + g.hem(x) + 0.012 * s;
    const len = (0.09 + 0.07 * rng.next()) * s;
    const z0 = g.zc(x, y0);
    put(e, `strip${i}`, flatCone([x, y0, z0], [x * 1.04 + rng.range(-0.012, 0.012) * s, y0 - len, z0 + 0.012 * s], 0.034 * s, 0.017 * s, 0.3, [0, 0, 1]), a.p.rig?.skirt ? 'skirt_f' : 'pelvis', { w: 0.005, grip: 1.8 });
  }
  // stitched pocket patch on the lower right thigh
  const px = -0.105 * s, py = g.yBelt - 0.3 * s;
  put(e, 'pocket', new RoundedBox([px, py, g.zc(px, py) + g.t + 0.008 * s], [0.058 * s, 0.056 * s, 0.01 * s], 0.006 * s), a.p.rig?.skirt ? 'skirt_f' : 'pelvis', { w: 0.004, grip: 1.8 });
  put(e, 'flap', new RoundedBox([px, py + 0.04 * s, g.zc(px, py) + g.t + 0.014 * s], [0.06 * s, 0.026 * s, 0.01 * s], 0.006 * s), a.p.rig?.skirt ? 'skirt_f' : 'pelvis', { w: 0.004, grip: 1.8 });
}

/** iron rivets / studs along the apron's top edge and a hem ring (metal) */
export function apronStuds(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const g = apronGeom(a, e);
  const n = e.n('count', 7);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * 2 * g.w(g.yTop) * 0.82;
    const y = g.yTop - 0.03 * s;
    put(e, `top${i}`, new Ellipsoid([x, y, g.zc(x, y) + g.t + 0.002], [0.0165 * s, 0.0165 * s, 0.012 * s]), boneForY(a, y), { w: 0.003, grip: 1.6 });
  }
  // hem eyelets: big iron rings sewn into the corners of the hem
  for (const sx of BOTH) {
    const x = sx * g.w(g.yBot) * 0.82;
    const y = g.yBot + g.hem(x) + 0.05 * s;
    put(e, `eye_${L(sx)}`, new Torus([x, y, g.zc(x, y) + g.t + 0.004], 0.026 * s, 0.0085 * s, [0, 0, 1]), a.p.rig?.skirt ? 'skirt_f' : 'pelvis', { w: 0.003, grip: 1.8 });
  }
}

/** leather loincloth hanging behind the legs from under the belt: the part above the hips rides the pelvis, the hanging part swings on the rear skirt bone */
export function apronBack(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const t = 0.0115 * s;
  const yTop = a.spine[1] + 0.02 * s;
  const yBot = a.side(1).knee[1] + 0.075 * s;
  const seam = a.side(1).hip[1];
  const keys: [number, number][] = [[yTop, -0.146 * s], [seam + 0.1 * s, -0.152 * s], [seam - 0.1 * s, -0.168 * s], [seam - 0.3 * s, -0.158 * s], [yBot, -0.14 * s]];
  const zAt = (y: number): number => {
    if (y >= keys[0]![0]) return keys[0]![1];
    for (let i = 0; i < keys.length - 1; i++) {
      const k0 = keys[i]!, k1 = keys[i + 1]!;
      if (y >= k1[0]) return k0[1] + (k1[1] - k0[1]) * smooth01((k0[0] - y) / (k0[0] - k1[0]));
    }
    return keys[keys.length - 1]![1];
  };
  const w = (y: number): number => (0.2 + 0.035 * smooth01((yTop - y) / (yTop - yBot))) * s;
  const hem = (x: number): number => 0.03 * s * (0.5 + 0.5 * Math.sin((x * 13) / s + 0.4));
  const panel = new Panel({
    yTop, yBot, w, zc: (x, y) => zAt(y) - 0.012 * s + 0.045 * s * Math.min((x / w(y)) * (x / w(y)), 1.2), t, hem, round: 0.007 * s, xmax: 0.3 * s, zmin: -0.34 * s, zmax: 0.0, hemMax: 0.03 * s,
  });
  put(e, 'upper', new SmoothIntersect([panel, slabY(seam, yTop + 0.03 * s, 0.001)], 0.002), 'pelvis', { w: 0.006, grip: 1.6 });
  put(e, 'lower', new SmoothIntersect([panel, slabY(yBot - 0.1 * s, seam, 0.001)], 0.002), a.p.rig?.skirt ? 'skirt_b' : 'pelvis', { w: 0.006, grip: 1.8 });
}

// ---------------------------------------------------------------------------------------------------------------------
// straps / belt / chains

/** apron suspenders: wide leather straps from the bib corners over the shoulders, crossing in an X on the back. o: width */
export function apronStraps(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const wid = e.n('width', 0.036) * s;
  const ext = 0.017 * s;
  const frontPlane = new HalfSpace([0, 0, a.chest[2] + 0.02 * s], [0, 0, -1], 4);
  const backPlane = new HalfSpace([0, 0, a.chest[2] + 0.02 * s], [0, 0, 1], 4);
  const yb = a.chest[1] - 0.03 * s;
  const shoulderY = a.neck[1] - 0.025 * s;
  const part = ['torso_', 'pec_', 'trap_', 'lat_', 'abs', 'clavicle_', 'delt_'];
  const band = (p0: Vec3, p1: Vec3, hw: number): Sdf => {
    const mid = vlerp(p0, p1, 0.5);
    const d = vsub(p1, p0);
    const len = Math.hypot(d[0], d[1]);
    const ang = Math.atan2(d[0], d[1]); // rotation about Z that turns +Y toward -X / +X
    return new RoundedBox([mid[0], mid[1], 0.0], [hw, len / 2, 2], 0.003, qaxis([0, 0, 1], -ang));
  };
  for (const sx of BOTH) {
    // front: bib corner -> shoulder top (over the bare pec); back: shoulder -> opposite hip (X crossing)
    const f0: Vec3 = [sx * 0.182 * s, yb, 0], f1: Vec3 = [sx * 0.15 * s, shoulderY + 0.02 * s, 0];
    cover(e, part, ext, { clip: new SmoothIntersect([band(f0, f1, wid * 0.5), frontPlane], 0.004), name: `_f${L(sx)}`, w: 0.005, grip: 1.5 });
    const b0: Vec3 = [sx * 0.15 * s, shoulderY + 0.02 * s, 0], b1: Vec3 = [-sx * 0.17 * s, a.spine[1] + 0.02 * s, 0];
    cover(e, part, ext, { clip: new SmoothIntersect([band(b0, b1, wid * 0.5), backPlane], 0.004), name: `_b${L(sx)}`, w: 0.005, grip: 1.5 });
  }
  // the straps run over the shoulder: bridge the front / back halves with a short tube on the trapezius
  for (const sx of BOTH) {
    const p0: Vec3 = [sx * 0.152 * s, shoulderY + 0.02 * s, a.chest[2] + 0.06 * s], p1: Vec3 = [sx * 0.152 * s, shoulderY + 0.035 * s, a.chest[2] - 0.045 * s];
    put(e, `bridge_${L(sx)}`, new RoundCone(p0, p1, wid * 0.44, wid * 0.44), 'chest', { w: 0.006, grip: 1.5 });
  }
}

/** big iron ring where the back straps cross + hooks (metal) */
export function strapHardware(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const yc = (a.chest[1] + a.spine[1]) / 2 + 0.03 * s;
  const c = torsoPoint(a, yc, 0, 0.034 * s, true);
  put(e, 'ring', new Torus(c, 0.048 * s, 0.014 * s, [0, 0, 1]), 'chest', { w: 0.004, grip: 1.5 });
  for (const sx of BOTH) {
    const p = torsoPoint(a, a.chest[1] - 0.03 * s, sx * 0.9, 0.034 * s);
    put(e, `bibring_${L(sx)}`, new Torus([p[0], p[1] + 0.02 * s, p[2]], 0.026 * s, 0.0105 * s, [0, 0, 1]), 'chest', { w: 0.004, grip: 1.5 });
  }
}

/** wide leather belt with keeper loops and two pouches. o: y (ref m relative to the spine joint), height */
export function wideBelt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.025) * s;
  const hh = e.n('height', 0.052) * s;
  const ext = e.n('ext', 0.052) * s;
  const st: Station[] = a.torso.map((q) => ({ y: q.y, rx: q.rx + ext, rz: q.rz + ext, cz: q.cz ?? 0, n: (q.n ?? 2) + 0.2 }));
  put(e, 'band', new Loft(st, { range: [y - hh, y + hh], cap: 0.012 * s }), 'spine', { w: 0.006, grip: 1.6 });
  // lower lip: a second narrower band stitched under the main one (reads as a doubled belt)
  const st2: Station[] = a.torso.map((q) => ({ y: q.y, rx: q.rx + ext + 0.008 * s, rz: q.rz + ext + 0.008 * s, cz: q.cz ?? 0, n: (q.n ?? 2) + 0.2 }));
  put(e, 'lip', new Loft(st2, { range: [y - hh - 0.001, y - hh + 0.026 * s], cap: 0.008 * s }), 'spine', { w: 0.005, grip: 1.6 });
  // hip pouches (leather) + a hanging flap behind
  const T = new Loft(a.torso);
  const stz = T.at(y);
  for (const [sx, zc, w] of [[1, 0.06, 1], [-1, -0.075, 0.9]] as [Side, number, number][]) {
    const c: Vec3 = [sx * (stz.rx + ext + 0.03 * s), y - 0.08 * s, stz.cz + zc * s];
    const pb = a.p.rig?.skirt ? (sx === 1 ? 'skirt_l' : 'skirt_r') : 'pelvis';
    put(e, `pouch_${L(sx)}`, new RoundedBox(c, [0.034 * s * w, 0.06 * s, 0.05 * s * w], 0.012 * s), pb, { w: 0.006, grip: 1.5 });
    put(e, `pouchflap_${L(sx)}`, new RoundedBox([c[0] + sx * 0.004 * s, y - 0.032 * s, c[2]], [0.038 * s * w, 0.026 * s, 0.054 * s * w], 0.01 * s), pb, { w: 0.006, grip: 1.5 });
  }
}

/** belt hardware (metal): a big square buckle plate with a boss, hip rings */
export function beltHardware(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.025) * s;
  const ext = e.n('ext', 0.052) * s;
  const T = new Loft(a.torso);
  const st = T.at(y);
  const zf = st.cz + st.rz + ext;
  put(e, 'plate', new RoundedBox([0, y, zf + 0.004 * s], [0.07 * s, 0.056 * s, 0.015 * s], 0.008 * s), 'spine', { w: 0.004, grip: 1.6 });
  put(e, 'boss', new Ellipsoid([0, y, zf + 0.019 * s], [0.036 * s, 0.036 * s, 0.018 * s]), 'spine', { w: 0.004, grip: 1.6 });
  for (const sx of BOTH) {
    const c: Vec3 = [sx * (st.rx + ext + 0.002 * s), y + 0.0, st.cz + 0.02 * s];
    put(e, `hipring_${L(sx)}`, new Torus(c, 0.03 * s, 0.01 * s, [1, 0, 0]), 'spine', { w: 0.004, grip: 1.6 });
  }
}

/** heavy iron chain: a bandolier across the bare chest and a loop hanging from the belt on the left hip (metal). o: major / minor / thick (link semi-axes, ref m) */
export function chainSwag(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const major = e.n('major', 0.046) * s, minor = e.n('minor', 0.03) * s, thick = e.n('thick', 0.0115) * s;
  const T = new Loft(a.torso);
  const outward = (p: Vec3): Vec3 => {
    const st = T.at(p[1]);
    return vnorm([(p[0] - st.cx) / (st.rx * st.rx), 0, (p[2] - st.cz) / (st.rz * st.rz)]);
  };
  const yTop = a.torso[a.torso.length - 3]!.y;
  const yBot = a.spine[1] - 0.06 * s;
  // bandolier: from the right shoulder, across the chest, to the left hip
  const pts: Vec3[] = [];
  const M = e.n('bandCount', 8);
  for (let i = 0; i <= M; i++) {
    const t = i / M;
    pts.push(torsoPoint(a, yTop + (yBot - yTop) * t, -0.74 + 1.52 * t, 0.018 * s));
  }
  solidLinks(pts, major, minor, thick, outward).forEach((l, i) => {
    put(e, `band${i}`, l.sdf, boneForY(a, l.at[1]), { w: 0.004, grip: 1.5 });
    if (l.hole) e.ctx.mark(`${e.spec.id}_bandhole${i}`, l.hole, ['linkhole']);
  });
  // waist swag: a loop of chain hanging from the belt on the left hip
  const yw = a.spine[1] - 0.02 * s;
  const st = T.at(yw);
  const swag: Vec3[] = [];
  const N = e.n('swagCount', 5);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ang = 0.3 + t * 0.85; // radians around from the front toward the left hip
    const sag = Math.sin(t * Math.PI) * 0.17 * s;
    const rx = st.rx + 0.075 * s, rz = st.rz + 0.075 * s;
    swag.push([Math.sin(ang) * rx, yw - 0.02 * s - sag, st.cz + Math.cos(ang) * rz * 0.95]);
  }
  const sb = a.p.rig?.skirt ? 'skirt_l' : 'pelvis';
  solidLinks(swag, major * 0.9, minor * 0.9, thick * 0.95, outward).forEach((l, i) => {
    put(e, `swag${i}`, l.sdf, sb, { w: 0.004, grip: 1.5 });
    if (l.hole) e.ctx.mark(`${e.spec.id}_swaghole${i}`, l.hole, ['linkhole']);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// bracers, boots

/** iron studs / spikes on the leather bracers: a row of low cones along the outer face of each forearm */
export function bracerStuds(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const n = e.n('count', 4);
  const ext = e.n('ext', 0.024) * s;
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'arm');
    for (let i = 0; i < n; i++) {
      const u = 0.58 + (i / Math.max(n - 1, 1)) * 0.3;
      const c = env.at(u);
      const rad = env.r(u) + ext;
      const out: Vec3 = [sx, 0.12, 0.08];
      const nv = vnorm(out);
      const base = vadd(c, vscale(nv, rad - 0.004 * s));
      const tip = vadd(c, vscale(nv, rad + 0.05 * s));
      put(e, `stud${i}_${L(sx)}`, new RoundCone(base, tip, 0.021 * s, 0.0045 * s), `forearm_${L(sx)}`, { w: 0.004, grip: 1.5 });
    }
  }
}

/** boot straps + iron toe caps: two buckled leather bands round each shin (hugging the boot) and a heavy toe plate */
export function bootGear(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rShin = (t: number): number => (t < 0.25 ? a.r.knee + (a.r.calf - a.r.knee) * (t / 0.25) : a.r.calf + (a.r.ankle - a.r.calf) * ((t - 0.25) / 0.75));
  for (const sx of BOTH) {
    const j = a.side(sx);
    const axis = vnorm(vsub(j.ankle, j.knee));
    for (const t of [0.4, 0.74]) {
      const c = vlerp(j.knee, j.ankle, t);
      const R = rShin(t) + 0.021 * s;
      put(e, `band${t}_${L(sx)}`, new Torus(c, R, 0.0135 * s, axis), `shin_${L(sx)}`, { w: 0.004, grip: 1.5 });
      put(e, `buckle${t}_${L(sx)}`, new RoundedBox([c[0], c[1], c[2] + R + 0.002 * s], [0.02 * s, 0.017 * s, 0.01 * s], 0.004 * s), `shin_${L(sx)}`, { w: 0.003, grip: 1.5 });
    }
    put(e, `toe_${L(sx)}`, new Ellipsoid([j.ball[0], 0.034 * s, j.ball[2] + 0.062 * s], [a.r.footW * 1.15, 0.036 * s, 0.075 * s]), `toe_${L(sx)}`, { w: 0.005, grip: 1.5 });
  }
}

/** apron ties behind the waist: a fat knot and two hanging tails (cloth), a colour accent that reads from the back */
export function apronTies(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.025) * s;
  const ext = e.n('ext', 0.052) * s;
  const st = new Loft(a.torso).at(y);
  const bz = st.cz - st.rz - ext; // back surface of the belt
  const tb = a.p.rig?.skirt ? 'skirt_b' : 'pelvis';
  put(e, 'knot', new Ellipsoid([0.025 * s, y - 0.004 * s, bz - 0.012 * s], [0.042 * s, 0.034 * s, 0.026 * s]), 'spine', { w: 0.006, grip: 1.5 });
  put(e, 'tailA', flatCone([0.03 * s, y - 0.02 * s, bz - 0.018 * s], [0.085 * s, y - 0.36 * s, bz - 0.05 * s], 0.032 * s, 0.038 * s, 0.3, [0, 0, 1]), tb, { w: 0.005, grip: 1.8 });
  put(e, 'tailB', flatCone([0.01 * s, y - 0.02 * s, bz - 0.018 * s], [-0.06 * s, y - 0.26 * s, bz - 0.045 * s], 0.03 * s, 0.032 * s, 0.3, [0, 0, 1]), tb, { w: 0.005, grip: 1.8 });
}

/** paint-only ash war bands round the upper arms (marks carry no geometry): 3 on the left arm, 2 on the right */
export function warPaint(ctx: Ctx, a: Anatomy): void {
  const s = a.s;
  for (const [sx, us] of [[1, [0.1, 0.2, 0.3]], [-1, [0.16, 0.28]]] as [Side, number[]][]) {
    const env = limbEnv(a, sx, 'arm');
    us.forEach((u, i) => ctx.mark(`warband${i}_${L(sx)}`, new Torus(env.at(u), env.r(u), 0.011 * s, env.dir(u)), ['warpaint']));
  }
}

void boxClip;
void slabAxis;
