// Custom outfit pieces for orcs / brutes (PieceSpec.build functions: `{ id, mat, build: furKilt, o: {...} }`). Each piece paints
// with ONE material family (its `mat`), so multi-material gear is split in two specs (e.g. harness + harnessStuds).
// Geometry follows the humanoid conventions: world rest pose, +Z forward, parts skinned to the bone that carries the surface.
import { type Vec3, vadd, vlerp, vnorm, vscale } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Ellipsoid, RoundCone, RoundedBox, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { type Anatomy, Loft, type PieceEnv, Plate, clipMinus, limbEnv } from '../humanoid/index.ts';
import { el, feather, horn, rc, spike } from './kit.ts';
import { plume } from './plumes.ts';

const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

/** point on the torso surface at height y: `u` in [-1,1] runs left-right across the front (u=0 centre, |u|=1 the flank), `back` selects the back */
export function torsoPoint(a: Anatomy, y: number, u: number, ext = 0, back = false): Vec3 {
  const st = new Loft(a.torso).at(y);
  const n = st.n;
  const x = st.cx + st.rx * u;
  const f = Math.max(0, 1 - Math.abs(u) ** n) ** (1 / n);
  const z = st.cz + (back ? -1 : 1) * st.rz * f;
  return [x, y, z + (back ? -ext : ext)];
}

const boneForY = (a: Anatomy, y: number): string => (y < a.spine[1] - 0.02 * a.s ? 'pelvis' : y < a.chest[1] ? 'spine' : 'chest');

/** sector bone for a skirt strip at angle phi (0 = front, +90 deg = left) */
function sectorBone(a: Anatomy, phi: number): string {
  if (!a.p.rig?.skirt) return 'pelvis';
  const c = Math.cos(phi), sn = Math.sin(phi);
  if (Math.abs(c) >= Math.abs(sn)) return c > 0 ? 'skirt_f' : 'skirt_b';
  return sn > 0 ? 'skirt_l' : 'skirt_r';
}

/**
 * hide / fur kilt: a ring of hanging strips below the belt. o: len, count, flare, fur (0/1 jagged fur tips), rows, back (0..1 back panel length factor)
 */
export function furKilt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/kilt${e.i}`);
  const len = e.n('len', 0.3) * s;
  const count = e.n('count', 12);
  const rows = e.n('rows', 1);
  const flare = e.n('flare', 0.3);
  const rest = a.pelvis[1] + e.n('top', 0.0) * s;
  const T = new Loft(a.torso);
  const hip = T.at(a.pelvis[1] - 0.02 * s);
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < count; i++) {
      const phi = ((i + 0.5 * (row % 2)) / count) * Math.PI * 2;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const rx = hip.rx + (0.022 + 0.014 * row) * s, rz = hip.rz + (0.024 + 0.014 * row) * s;
      const r = (rx * rz) / Math.hypot(rz * sp, rx * cp);
      const base: Vec3 = [sp * r, rest - 0.02 * s - row * 0.05 * s, hip.cz + cp * r];
      // front / back panels are longer than the sides (the legs need room to swing)
      const side = Math.abs(sp);
      const L0 = len * (1 - 0.35 * side) * (1 + 0.15 * rng.range(-1, 1)) * (cp < 0 ? e.n('back', 0.85) : 1) * (1 - 0.12 * row);
      const out = flare * L0;
      const tip: Vec3 = [sp * (r + out), base[1] - L0, hip.cz + cp * (r + out)];
      const w = ((Math.PI * 2) / count) * r * 0.62;
      const bone = sectorBone(a, phi);
      // a flat strip: flatCone squashed along the radial direction
      e.ctx.add(`${e.spec.id}_s${row}_${i}`, flatCone(base, tip, w, w * (e.b('fur', false) ? 0.2 : 0.5), 0.2 + 0.1 * rng.next(), [sp, 0, cp]), bone, { tags: e.tag(e.mat), w: 0.006 });
    }
  }
  // waist band
  const y = rest + 0.01 * s;
  const band = new Loft(a.torso.map((q) => ({ y: q.y, rx: q.rx + 0.026 * s, rz: q.rz + 0.026 * s, cz: q.cz, n: 2.3 })), { range: [y - 0.03 * s, y + 0.03 * s] });
  e.ctx.add(`${e.spec.id}_band`, band, 'pelvis', { tags: e.tag(e.mat), w: 0.005, grip: 1.3 });
}

/** crossed chest straps (X harness) + shoulder yoke; o: width, x (0/1 cross) */
export function harness(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const wid = e.n('width', 0.032) * s;
  const yTop = a.torso[a.torso.length - 3]!.y + 0.02 * s;
  const yBot = a.spine[1] - 0.04 * s;
  const ext = 0.012 * s;
  const strap = (sx: 1 | -1, name: string, back = false): void => {
    const pts: Vec3[] = [];
    const N = 7;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const y = yTop + (yBot - yTop) * t;
      const u = sx * (0.78 - 1.5 * t);
      pts.push(torsoPoint(a, y, u, ext, back));
    }
    const segs = tube(pts, [[0, wid], [1, wid]], { segments: N, w: wid * 0.5 });
    // the strap crosses bones; split by bone using clipped copies would be heavy - skin it to the chest, it hugs the torso
    e.ctx.add(`${e.spec.id}_${name}`, segs, 'chest', { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
  };
  strap(1, 'f_l');
  if (e.b('cross', true)) strap(-1, 'f_r');
  if (e.b('back', true)) {
    strap(1, 'b_l', true);
    strap(-1, 'b_r', true);
  }
  // belt
  const yb = a.spine[1] - 0.045 * s;
  const T = new Loft(a.torso.map((q) => ({ y: q.y, rx: q.rx + ext + 0.006 * s, rz: q.rz + ext + 0.006 * s, cz: q.cz, n: q.n })), { range: [yb - 0.03 * s, yb + 0.03 * s] });
  e.ctx.add(`${e.spec.id}_belt`, T, 'spine', { tags: e.tag(e.mat), w: 0.005, grip: 1.3 });
}

/** metal studs along the harness plus a boss: pair with `harness` (o: boss 0/1) */
export function harnessStuds(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const yTop = a.torso[a.torso.length - 3]!.y + 0.02 * s;
  const yBot = a.spine[1] - 0.04 * s;
  const ext = 0.02 * s;
  for (const sx of BOTH) {
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      const y = yTop + (yBot - yTop) * t;
      const p = torsoPoint(a, y, sx * (0.78 - 1.5 * t), ext);
      e.ctx.add(`${e.spec.id}_stud${sx}_${k}`, new Ellipsoid(p, [0.014 * s, 0.014 * s, 0.01 * s]), 'chest', { tags: e.tag(e.mat), w: 0.003, grip: 1.3 });
    }
  }
  const yb = a.spine[1] - 0.045 * s;
  const buckle = torsoPoint(a, yb, 0, ext + 0.008 * s);
  e.ctx.add(`${e.spec.id}_buckle`, new RoundedBox(buckle, [0.04 * s, 0.034 * s, 0.012 * s], 0.008 * s), 'spine', { tags: e.tag(e.mat), w: 0.003, grip: 1.3 });
  const boss = torsoPoint(a, a.chest[1] - 0.02 * s, 0, ext + 0.006 * s);
  if (e.b('boss', true)) e.ctx.add(`${e.spec.id}_boss`, new Ellipsoid(boss, [0.05 * s, 0.05 * s, 0.018 * s]), 'chest', { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
}

/** a skull / tusk trophy hanging at the belt (bone material) + loop of tusks round the neck; o: neck (0/1) skull (0/1) */
export function trophies(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const yb = a.spine[1] - 0.05 * s;
  if (e.b('skull', true)) {
    const c = torsoPoint(a, yb - 0.1 * s, 0.4, 0.05 * s);
    e.ctx.add(`${e.spec.id}_skull`, new Ellipsoid(c, [0.04 * s, 0.045 * s, 0.045 * s]), 'pelvis', { tags: e.tag(e.mat), w: 0.004 });
    e.ctx.add(`${e.spec.id}_skullJaw`, new Ellipsoid(vadd(c, [0, -0.04 * s, 0.01 * s]), [0.026 * s, 0.018 * s, 0.03 * s]), 'pelvis', { tags: e.tag(e.mat), w: 0.004 });
    e.ctx.add(`${e.spec.id}_cord`, rc(vadd(c, [0, 0.04 * s, -0.005 * s]), torsoPoint(a, yb, 0.4, 0.02 * s), 0.005 * s, 0.005 * s), 'pelvis', { tags: e.tag(e.mat), w: 0.003 });
  }
  if (e.b('neck', true)) {
    const nk = a.neck;
    const count = e.n('count', 9);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const ang = (t - 0.5) * 2.5; // across the front of the chest
      const x = Math.sin(ang) * 0.13 * s;
      const z = nk[2] + 0.075 * s + Math.cos(ang) * 0.075 * s - Math.abs(ang) * 0.015 * s;
      const drop = (0.07 - 0.06 * Math.abs(t - 0.5) * 2) * s;
      const base: Vec3 = [x, nk[1] - 0.04 * s - Math.abs(ang) * 0.02 * s, z];
      const tip: Vec3 = [x * 1.04, base[1] - 0.05 * s - drop * 0.7, z + 0.012 * s];
      e.ctx.add(`${e.spec.id}_tusk${i}`, horn(base, vlerp(base, tip, 0.5), tip, 0.014 * s, 0.003 * s, 0.006), 'chest', { tags: e.tag(e.mat), w: 0.004 });
    }
  }
}

/** big iron spike collar around the neck */
export function spikeCollar(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const nk = a.neck;
  const rr = a.r.neck * 1.35;
  e.ctx.add(`${e.spec.id}_ring`, new Torus([0, nk[1] + 0.012 * s, nk[2] + 0.004 * s], rr + 0.012 * s, 0.026 * s, [0, 1, 0.1]), 'neck', { tags: e.tag(e.mat), w: 0.005, grip: 1.3 });
  const n = e.n('spikes', 8);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const dx = Math.sin(ang), dz = Math.cos(ang);
    const b: Vec3 = [dx * (rr + 0.012 * s), nk[1] + 0.012 * s + dz * 0.01 * s, nk[2] + 0.004 * s + dz * (rr + 0.012 * s) * 0.9];
    const tip: Vec3 = [dx * (rr + 0.075 * s), b[1] + 0.045 * s, b[2] + dz * 0.06 * s];
    e.ctx.add(`${e.spec.id}_sp${i}`, spike(b, tip, 0.016 * s, 0.003 * s), 'neck', { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
  }
}

/** spiked wrist bracers: forearm cover plus a row of spikes along the outer edge; o: spikes, from */
export function spikedBracers(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const u0 = e.n('from', 0.62);
  const nsp = e.n('spikes', 3);
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'arm');
    const ext = 0.016 * s;
    // main cuff
    const p0 = env.at(u0), p1 = env.at(0.96);
    e.ctx.add(`${e.spec.id}_cuff_${L(sx)}`, rc(p0, p1, env.r(u0) + ext, env.r(0.96) + ext + 0.006 * s), `forearm_${L(sx)}`, { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
    e.ctx.add(`${e.spec.id}_rim0_${L(sx)}`, new Torus(p0, env.r(u0) + ext + 0.002 * s, 0.008 * s, env.dir(u0)), `forearm_${L(sx)}`, { tags: e.tag(e.mat), w: 0.003, grip: 1.3 });
    e.ctx.add(`${e.spec.id}_rim1_${L(sx)}`, new Torus(p1, env.r(0.96) + ext + 0.007 * s, 0.009 * s, env.dir(0.96)), `forearm_${L(sx)}`, { tags: e.tag(e.mat), w: 0.003, grip: 1.3 });
    for (let k = 0; k < nsp; k++) {
      const u = u0 + 0.06 + (k / Math.max(nsp - 1, 1)) * (0.9 - u0 - 0.06);
      const c = env.at(u);
      const rad = env.r(u) + ext;
      e.ctx.add(`${e.spec.id}_sp${k}_${L(sx)}`, spike(vadd(c, [sx * rad * 0.9, 0, 0]), vadd(c, [sx * (rad + 0.055 * s), 0.01 * s, -0.01 * s]), 0.016 * s, 0.003 * s), `forearm_${L(sx)}`, { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
    }
  }
}

/** shaggy fur collar + shoulder cape: dense overlapping tufts on the shoulders, back and chest; o: tufts, spread, drop */
export function furCollar(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/furc${e.i}`);
  const n = e.n('tufts', 34);
  const spread = e.n('spread', 1);
  const drop = e.n('drop', 1);
  const nk = a.neck;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rng.range(-0.08, 0.08);
    const row = i % 2;
    const rx = (0.15 + 0.02 * row) * s * spread, rz = (0.11 + 0.02 * row) * s;
    const bx = Math.sin(ang) * rx;
    const front = Math.cos(ang);
    const bz = nk[2] + front * rz - 0.005 * s;
    const by = nk[1] - 0.025 * s - row * 0.03 * s;
    const len = (0.085 + 0.04 * rng.next()) * s * drop * (front < -0.2 ? 1.5 : 1);
    const out = 0.035 * s * rng.range(0.7, 1.3);
    const base: Vec3 = [bx, by, bz];
    const tip: Vec3 = [bx + Math.sin(ang) * out, by - len, bz + front * out * 0.8 - (front < -0.2 ? 0.02 * s : 0)];
    const bone = Math.abs(bx) < 0.05 * s ? 'chest' : bx > 0 ? 'clavicle_l' : 'clavicle_r';
    e.ctx.add(`${e.spec.id}_t${i}`, new RoundCone(base, tip, 0.03 * s * (1 - 0.15 * row), 0.004 * s), bone, { tags: e.tag(e.mat, 'fur'), w: 0.012 });
  }
}

/** horned war helm: domed cap + brow band + nasal bar, brow spikes, spiked cheek guards, stacked nape plates, a central comb and two big swept horns; o: horn (length), comb (0/1) */
export function hornedHelm(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const hl = e.n('horn', 1);
  const T = { tags: e.tag(e.mat), w: 0.006, grip: 1.6 };
  const at = (x: number, y: number, z: number): Vec3 => [sk[0] + x * k, sk[1] + y * k, sk[2] + z * k];
  // cap over the cranium: simple ellipsoid shell offset
  const cap: Sdf = new Ellipsoid(at(0, 0.03, -0.03), [0.1 * k, 0.098 * k, 0.108 * k]);
  const cut: Sdf = new RoundedBox(at(0, -0.06, 0.04), [0.3 * k, 0.07 * k, 0.3 * k], 0.01 * k);
  e.ctx.add(`${e.spec.id}_cap`, clipMinus(cap, [cut], 0.006), 'head', T);
  e.ctx.add(`${e.spec.id}_band`, new Torus(at(0, 0.018, -0.012), 0.098 * k, 0.012 * k, [0, 1, -0.05]), 'head', { ...T, w: 0.004 });
  e.ctx.add(`${e.spec.id}_nasal`, rc(at(0, 0.03, 0.1), at(0, -0.045, 0.112), 0.011 * k, 0.013 * k), 'head', { ...T, w: 0.004 });
  for (const sx of BOTH) {
    // brow spike
    e.ctx.add(`${e.spec.id}_bspike_${L(sx)}`, spike(at(sx * 0.045, 0.026, 0.1), at(sx * 0.072, 0.072, 0.155), 0.015 * k, 0.003 * k), 'head', { ...T, w: 0.004 });
    // cheek guard + a spike on it
    const pl = new Plate({ o: at(sx * 0.102, -0.035, 0.02), nrm: [sx, -0.1, 0.25], up: [0, 1, 0], hu: 0.052 * k, hv: 0.058 * k, R: 0.075 * k, t: 0.012 * k, round: 0.004 * k, taper: -0.25 });
    e.ctx.add(`${e.spec.id}_cheek_${L(sx)}`, pl, 'head', { ...T, w: 0.004 });
    e.ctx.add(`${e.spec.id}_cspike_${L(sx)}`, spike(at(sx * 0.118, -0.04, 0.045), at(sx * 0.175, -0.06, 0.085), 0.015 * k, 0.003 * k), 'head', { ...T, w: 0.004 });
  }
  // nape guard: three stacked curved plates behind the head
  for (let i = 0; i < 3; i++) {
    const w = (0.092 + 0.014 * i) * k;
    const pl = new Plate({ o: [sk[0], sk[1] - (0.008 + 0.03 * i) * k, sk[2] - (0.075 + 0.006 * i) * k], nrm: [0, -0.1 * (i + 1), -1], up: [0, 1, 0], hu: w * 1.35, hv: 0.022 * k, R: (0.098 + 0.008 * i) * k, t: 0.009 * k, round: 0.003 * k, bow: 0.006 * k });
    e.ctx.add(`${e.spec.id}_nape${i}`, pl, 'head', { ...T, w: 0.003 });
  }
  // central comb from the brow over the crown to the nape
  if (e.b('comb', true)) e.ctx.add(`${e.spec.id}_comb`, flatCone(at(0, 0.1, 0.06), at(0, 0.115, -0.12), 0.034 * k, 0.022 * k, 0.18, [1, 0, 0]), 'head', T);
  // big swept ram horns
  for (const sx of BOTH) {
    const P: Vec3[] = [at(sx * 0.085, 0.045, 0.0), at(sx * 0.17 * hl, 0.08, -0.02), at(sx * 0.25 * hl, 0.2 * hl, 0.0), at(sx * 0.22 * hl, 0.36 * hl, 0.075)];
    e.ctx.add(`${e.spec.id}_horn_${L(sx)}`, tube(P, [[0, 0.038 * k], [0.45, 0.027 * k], [1, 0.005 * k]], { segments: 6, w: 0.01 }), 'head', { tags: e.tag(e.mat, 'horn'), w: 0.006, grip: 1.6 });
  }
}

void Sphere; void el; void vnorm; void vscale;

/** shaman mantle: a full feather cape - an upright ruff round the back of the neck plus overlapping rows of broad curved feathers draped over the shoulders, chest and back; o: rows, count, len, spread, wide, ruff */
export function featherMantle(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/fm${e.i}`);
  const nk = a.neck;
  const rows = e.n('rows', 3);
  const n = e.n('count', 12);
  const lenK = e.n('len', 1);
  const spread = e.n('spread', 1);
  const wide = e.n('wide', 1);
  const ruff = e.n('ruff', 0);
  const boneOf = (x: number): string => (Math.abs(x) < 0.06 * s ? 'chest' : x > 0 ? 'clavicle_l' : 'clavicle_r');
  // upright ruff behind and beside the head (the front stays open for the face)
  for (let i = 0; i < ruff; i++) {
    const t = ruff === 1 ? 0.5 : i / (ruff - 1);
    const ang = (70 + 220 * t) * (Math.PI / 180);
    const sa = Math.sin(ang), ca = Math.cos(ang);
    const base: Vec3 = [sa * 0.09 * s, nk[1] - 0.005 * s, nk[2] + ca * 0.075 * s - 0.01 * s];
    const len = (0.17 + 0.07 * (0.5 - 0.5 * ca) + 0.03 * rng.next()) * s * lenK;
    e.ctx.add(`${e.spec.id}_r${i}`, plume(base, [sa * 0.55, 1, ca * 0.3 - 0.1], len, 0.05 * s * wide, 0.016 * s, [sa, 0, ca], [sa, -0.2, ca], 0.3, 0.3), boneOf(base[0]), { tags: e.tag(e.mat), w: 0.006 });
  }
  // draped rows: each feather lies along the shoulder / back / chest surface and droops at the tip
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < n; i++) {
      const ang = ((i + 0.5 * (row % 2)) / n) * Math.PI * 2;
      const sa = Math.sin(ang), ca = Math.cos(ang);
      const rx = (0.125 + 0.05 * row) * s * spread, rz = (0.08 + 0.034 * row) * s;
      const base: Vec3 = [sa * rx, nk[1] - 0.02 * s - row * 0.045 * s, nk[2] + ca * rz * 0.9 - 0.01 * s];
      const len = (0.17 + 0.06 * rng.next() + 0.045 * row) * s * lenK * (Math.abs(sa) > 0.5 ? 1.25 : ca < -0.3 ? 1.1 : 0.8);
      const dir = vnorm([sa * 0.85, -0.5 - 0.15 * row, ca * 0.5]);
      e.ctx.add(`${e.spec.id}_f${row}_${i}`, plume(base, dir, len, 0.055 * s * wide * (1 + 0.08 * row), 0.018 * s, [sa, 0.9, ca], [0, -1, 0], 0.22, 0.3), boneOf(base[0]), { tags: e.tag(e.mat), w: 0.006 });
    }
  }
}

/** feather headdress: bone band + a fan of broad curved feathers rising from the back of the head in two tiers; o: count, len */
export function featherCrest(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const n = e.n('count', 9);
  const len = e.n('len', 1);
  e.ctx.add(`${e.spec.id}_band`, new Torus([sk[0], sk[1] + 0.03 * k, sk[2] - 0.01 * k], 0.093 * k, 0.012 * k, [0, 1, -0.12]), 'head', { tags: e.tag(e.mat), w: 0.004, grip: 1.6 });
  for (let tier = 0; tier < 2; tier++) {
    const m = tier === 0 ? n : Math.max(3, n - 3);
    for (let i = 0; i < m; i++) {
      const t = m === 1 ? 0 : i / (m - 1) - 0.5;
      const at = Math.abs(t);
      const base: Vec3 = [t * 0.15 * k, sk[1] + (0.075 - at * 0.05 - tier * 0.012) * k, sk[2] - (0.07 + tier * 0.01) * k];
      const L = (tier === 0 ? 0.44 : 0.3) * k * len * (1 - 0.6 * at);
      e.ctx.add(`${e.spec.id}_f${tier}_${i}`, plume(base, [t * 1.8, 0.95 - at * 0.9, -0.5 - at * 0.2], L, 0.06 * k, 0.021 * k, [0, 0.4, -1], [t * 0.8, -0.3, -1], 0.3, 0.3), 'head', { tags: e.tag(e.mat), w: 0.006, grip: 1.6 });
    }
  }
}

/** war-banner pole strapped to the back: pole, brackets, crossbar, finial (+ hanging trophies); pair with `backBanner` for the cloth. o: h (pole top above the neck), bar (crossbar half width), trophy */
export function backPole(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const nk = a.neck;
  const z = nk[2] - e.n('z', 0.25) * s;
  const top = nk[1] + e.n('h', 0.62) * s;
  const bot = a.chest[1] - 0.32 * s;
  const r = e.n('r', 0.022) * s;
  const bar = e.n('bar', 0.27) * s;
  e.ctx.add(`${e.spec.id}_pole`, rc([0, bot, z], [0, top, z], r, r * 0.9), 'chest', { tags: e.tag(e.mat), w: 0.005, grip: 1.5 });
  // brackets strapping the pole to the harness
  for (const y of [nk[1] - 0.02 * s, a.chest[1] - 0.12 * s]) {
    e.ctx.add(`${e.spec.id}_br${Math.round(y * 1000)}`, rc([0, y, z + 0.02 * s], [0, y, nk[2] - 0.12 * s], r * 1.5, r * 1.3), 'chest', { tags: e.tag(e.mat), w: 0.005, grip: 1.5 });
  }
  const yb = top - 0.07 * s;
  e.ctx.add(`${e.spec.id}_bar`, rc([-bar, yb, z], [bar, yb, z], r * 0.8, r * 0.8), 'chest', { tags: e.tag(e.mat), w: 0.005, grip: 1.5 });
  for (const sx of BOTH) e.ctx.add(`${e.spec.id}_end${sx}`, new Sphere([sx * bar, yb, z], r * 1.5), 'chest', { tags: e.tag(e.mat), w: 0.005, grip: 1.5 });
  e.ctx.add(`${e.spec.id}_fin`, spike([0, top - 0.03 * s, z], [0, top + 0.16 * s, z], r * 1.9, r * 0.25), 'chest', { tags: e.tag(e.mat), w: 0.005, grip: 1.5 });
  if (e.b('trophy', false)) {
    // skulls hung on the pole top and horns lashed to the bar
    e.ctx.add(`${e.spec.id}_skull`, el([0, top + 0.01 * s, z + 0.03 * s], [0.06 * s, 0.065 * s, 0.07 * s]), 'chest', { tags: e.tag(e.mat), w: 0.006, grip: 1.5 });
    for (const sx of BOTH) {
      e.ctx.add(`${e.spec.id}_horn${sx}`, horn([sx * bar * 0.6, yb + 0.02 * s, z], [sx * bar * 1.1, yb + 0.1 * s, z - 0.02 * s], [sx * bar * 1.3, yb + 0.26 * s, z - 0.02 * s], 0.026 * s, 0.005 * s), 'chest', { tags: e.tag(e.mat), w: 0.006, grip: 1.5 });
    }
  }
}

/** tattered banner cloth hanging from the `backPole` crossbar on the cape chain (needs rig.capeBones >= 2). o: h, bar, len, tatters */
export function backBanner(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const nk = a.neck;
  const ch = a.layout.cape;
  if (!ch) return;
  const z = nk[2] - e.n('z', 0.25) * s - 0.03 * s;
  const top = nk[1] + e.n('h', 0.62) * s - 0.1 * s;
  const len = e.n('len', 0.95) * s;
  const w = e.n('bar', 0.27) * s * 0.88;
  const sp = e.n('spread', 0.12);
  const bottom = top - len;
  const nb = ch.bones.length;
  // the cloth hangs straight down; each section follows its cape bone (pivots near the neck / mid back)
  for (let i = 0; i < nb; i++) {
    const y0 = top - (len * i) / nb, y1 = top - (len * (i + 1)) / nb;
    const k0 = w * (1 + sp * i), k1 = w * (1 + sp * (i + 1));
    e.ctx.add(`${e.spec.id}_sec${i}`, flatCone([0, y0, z], [0, y1, z], k0, k1, 0.06, [0, 0, 1]), ch.bones[i]!, { tags: e.tag(e.mat), w: 0.01, grip: 1.3 });
  }
  const tat = e.n('tatters', 4);
  const fork = e.n('fork', 0);
  const wl = w * (1 + sp * nb);
  const last = ch.bones[nb - 1]!;
  const rng = new Rng(`${a.p.seed}/banner${e.i}`);
  if (fork > 0) {
    // swallow tail: two long tails at the sides with a short notch between them
    for (const sx of BOTH) e.ctx.add(`${e.spec.id}_tail${sx}`, flatCone([sx * wl * 0.5, bottom + 0.03 * s, z], [sx * wl * 0.56, bottom - fork * s, z - 0.012 * s], wl * 0.5, 0.01 * s, 0.06, [0, 0, 1]), last, { tags: e.tag(e.mat), w: 0.008, grip: 1.3 });
  } else {
    for (let i = 0; i < tat; i++) {
      const x = ((i + 0.5) / tat - 0.5) * 2 * wl * 0.92;
      const dl = (0.12 + 0.1 * rng.next()) * s;
      e.ctx.add(`${e.spec.id}_tat${i}`, flatCone([x, bottom + 0.02 * s, z], [x * 1.02, bottom - dl, z - 0.01 * s], (wl / tat) * 0.95, 0.008 * s, 0.06, [0, 0, 1]), last, { tags: e.tag(e.mat), w: 0.008, grip: 1.3 });
    }
  }
  // emblem disc on the cloth
  if (e.b('emblem', true)) e.ctx.add(`${e.spec.id}_emb`, new Ellipsoid([0, top - len * 0.32, z - 0.012 * s], [w * 0.38, w * 0.38, 0.012 * s]), ch.bones[0]!, { tags: e.tag(e.mat, 'emblem'), w: 0.006, grip: 1.3 });
}
