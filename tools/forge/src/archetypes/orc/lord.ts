// Orc lord (boss) kit: iron mask with tusks and glowing slits, spiked crown, huge layered pauldrons, fur mantle, trophy back-banner
// (pole, crossbar, skulls, horns, tattered cloth on the cape chain), skull belt, chains, and the two-hand great-axe animation style.
// Everything is a `PieceSpec.build` (or a helper for one) in world metres, +Z forward, +X = left; the shared orc / humanoid kit is only imported.
// Design rule for this boss: BOLD forms (the camera is 22 m away and the decimator eats anything thinner than ~3 cm): thick horns, slab plates,
// few big skulls / spikes instead of many small ones.
import { keyed, ramp } from '../../core/anim/curve.ts';
import { type Vec3, qaxis, vadd, vcross, vdot, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { type Anatomy, type Key, type LimbEnv, Loft, type PieceEnv, type Pose, Plate, V, basePose, limbEnv } from '../humanoid/index.ts';
import { type OrcStyle, type Special, gp, grip } from './anim.ts';
import { type Frame, Slab, horn, qBasis, rc, spike } from './kit.ts';
import { chopAxes, stance, sweepAxes } from './styles.ts';

const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

/** head-space helper: world point from head units (k = body scale x head scale), origin = skull centre */
function headSpace(a: Anatomy): { k: number; H: (dx: number, dy: number, dz: number) => Vec3 } {
  const k = a.s * a.hs;
  const sk = a.skull;
  return { k, H: (dx, dy, dz) => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k] };
}

/** z of the skin surface in front of (x, y), marching back from zHi (seats chains and plates on the bare chest exactly) */
function skinFront(e: PieceEnv, x: number, y: number, zHi: number, zLo: number): number {
  const parts = e.ctx.body.parts.filter((p) => p.stage === 'base' && p.tags?.includes('skin'));
  for (let z = zHi; z > zLo; z -= 0.01) {
    let d = Infinity;
    for (const p of parts) d = Math.min(d, p.sdf.d(x, y, z));
    if (d < 0.004) return z;
  }
  return zLo;
}

/** y of the skin surface below (x, z), marching down from yHi (seats fur tufts on the shoulders exactly) */
function skinTop(e: PieceEnv, x: number, z: number, yHi: number, yLo: number): number {
  const parts = e.ctx.body.parts.filter((p) => p.stage === 'base' && p.tags?.includes('skin'));
  for (let y = yHi; y > yLo; y -= 0.01) {
    let d = Infinity;
    for (const p of parts) d = Math.min(d, p.sdf.d(x, y, z));
    if (d < 0.004) return y;
  }
  return yLo;
}

/** a skull trophy centred at `c`, facing `fwd` (up = `up`); radius `r` = cranium half width. Eye sockets and the nose cavity are carved. */
function skull(e: PieceEnv, name: string, c: Vec3, r: number, bone: string, fwd: Vec3, up: Vec3 = [0, 1, 0], horns = 0): void {
  const z = vnorm(fwd);
  const x = vnorm([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const P = (dx: number, dy: number, dz: number): Vec3 => [c[0] + x[0] * dx * r + y[0] * dy * r + z[0] * dz * r, c[1] + x[1] * dx * r + y[1] * dy * r + z[1] * dz * r, c[2] + x[2] * dx * r + y[2] * dy * r + z[2] * dz * r];
  const q = qBasis(y, x);
  const T = e.tag(e.mat, 'skull');
  const put = (n: string, sdf: Sdf, w = 0.006): void => { e.ctx.add(`${e.spec.id}_${name}_${n}`, sdf, bone, { tags: T, w, grip: 1.5 }); };
  put('cran', new Ellipsoid(P(0, 0.12, -0.06), [0.86 * r, 0.94 * r, 1.0 * r], q), 0.01);
  put('brow', rc(P(-0.52, 0.06, 0.64), P(0.52, 0.06, 0.64), 0.15 * r, 0.15 * r), 0.01);
  put('face', new Ellipsoid(P(0, -0.34, 0.5), [0.52 * r, 0.42 * r, 0.42 * r], q), 0.012);
  for (const sx of BOTH) put(`cheek${sx}`, new Ellipsoid(P(sx * 0.52, -0.22, 0.52), [0.2 * r, 0.17 * r, 0.22 * r], q), 0.008);
  put('jaw', new Ellipsoid(P(0, -0.7, 0.4), [0.4 * r, 0.14 * r, 0.36 * r], q), 0.01);
  for (const sx of BOTH) e.ctx.cut(`${e.spec.id}_${name}_eye${sx}`, new Ellipsoid(P(sx * 0.37, 0.0, 0.8), [0.2 * r, 0.17 * r, 0.22 * r], q), bone, { w: 0.004 });
  // teeth: a short comb along the upper jaw
  for (let i = 0; i < 6; i++) {
    const tx = (i - 2.5) * 0.15;
    put(`tooth${i}`, rc(P(tx, -0.5, 0.88 - Math.abs(tx) * 0.5), P(tx, -0.74, 0.88 - Math.abs(tx) * 0.5), 0.05 * r, 0.04 * r), 0.002);
  }
  e.ctx.cut(`${e.spec.id}_${name}_nose`, new Ellipsoid(P(0, -0.26, 0.9), [0.1 * r, 0.17 * r, 0.16 * r], q), bone, { w: 0.004 });
  if (horns > 0) {
    for (const sx of BOTH) put(`horn${sx}`, horn(P(sx * 0.7, 0.4, -0.05), P(sx * 1.25, 0.55, -0.1), P(sx * 1.45, 1.15 * horns, 0.0), 0.2 * r, 0.03 * r), 0.01);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// head pieces

/** iron faceplate: a thick curved plate from the brow to the upper lip with slanted eye slits (glowing eyes behind), a heavy brow bar, a beak nose, cheek horns and a head strap */
export function lordMask(e: PieceEnv): void {
  const { a } = e;
  const { k, H } = headSpace(a);
  const T = e.tag(e.mat, 'metal');
  const put = (name: string, sdf: Sdf, w = 0.004): void => { e.ctx.add(`${e.spec.id}_${name}`, sdf, 'head', { tags: T, w, grip: 1.8 }); };
  const plate = new Plate({ o: H(0, 0.012, 0.158), nrm: [0, 0.02, 1], up: [0, 1, 0], hu: 0.108 * k, hv: 0.062 * k, R: 0.118 * k, t: 0.028 * k, round: 0.009 * k, taper: -0.3, edgeThin: 0.85 });
  put('plate', plate, 0.004);
  e.ctx.mark(`${e.spec.id}_trim`, plate.rim(0.01 * k), [e.trimTag]);
  for (const sx of BOTH) {
    const n = L(sx);
    // brow bar: heavy, sloping down toward the nose (angry V)
    put(`brow_${n}`, rc(H(sx * 0.098, 0.078, 0.108), H(sx * 0.012, 0.052, 0.178), 0.022 * k, 0.028 * k), 0.008);
    // slanted eye slit carved through the plate
    e.ctx.cut(`${e.spec.id}_slit_${n}`, new Ellipsoid(H(sx * 0.05, 0.022, 0.16), [0.048 * k, 0.0125 * k, 0.06 * k], qaxis([0, 0, 1], sx * 0.36)), 'head', { w: 0.004 });
  }
  // beak nose ridge down the centre
  put('nose', rc(H(0, 0.06, 0.184), H(0, -0.044, 0.2), 0.015 * k, 0.027 * k), 0.008);
  // strap round the head behind the ears
  const strap = tube([H(-0.1, 0.02, 0.09), H(-0.11, 0.02, -0.02), H(-0.092, 0.02, -0.108), H(0, 0.02, -0.13), H(0.092, 0.02, -0.108), H(0.11, 0.02, -0.02), H(0.1, 0.02, 0.09)], [[0, 0.014 * k], [1, 0.014 * k]], { segments: 10, w: 0.006 });
  put('strap', strap, 0.004);
  // glowing eyes sit behind the slits (emissive via the 'glow' tag)
  for (const sx of BOTH) {
    e.ctx.late(`${e.spec.id}_glow_${L(sx)}`, new Ellipsoid(H(sx * 0.05, 0.022, 0.118), [0.044 * k, 0.011 * k, 0.026 * k], qaxis([0, 0, 1], sx * 0.36)), 'head', { tags: ['eye', 'glow'], w: 0.002 });
  }
}

/** spiked crown: a slim curved circlet with seven bold, front-weighted tines and a glowing jewel (sits above the mask so the face stays open) */
export function lordCrown(e: PieceEnv): void {
  const { a } = e;
  const { k, H } = headSpace(a);
  const T = e.tag(e.mat, 'metal');
  const put = (name: string, sdf: Sdf, w = 0.004): void => { e.ctx.add(`${e.spec.id}_${name}`, sdf, 'head', { tags: T, w, grip: 1.8 }); };
  const yb = 0.1;
  const rx = 0.098, rz = 0.114, cz = -0.026;
  const ring = (r: number, ry: number, y: number): Sdf => new Xform(new Torus([0, 0, 0], 1, r, [0, 1, 0]), H(0, y, cz), [0, 0, 0, 1], [rx * k, ry * k, rz * k]);
  put('band', ring(0.17, 0.13, yb), 0.004);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const phi = (i / n) * Math.PI * 2;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const front = 0.5 + 0.5 * cp;
    const h = 0.07 + 0.11 * front;
    const base = H(sp * rx, yb + 0.012, cz + cp * rz);
    const tip = H(sp * (rx + 0.02 + 0.04 * h), yb + 0.012 + h, cz + cp * (rz + 0.01 + 0.03 * h));
    put(`tine${i}`, spike(base, tip, 0.034 * k, 0.004 * k), 0.008);
  }
  put('jewel', new Sphere(H(0, yb + 0.004, cz + rz + 0.014), 0.02 * k), 0.003);
  e.ctx.late(`${e.spec.id}_gem`, new Sphere(H(0, yb + 0.004, cz + rz + 0.022), 0.012 * k), 'head', { tags: ['glow', e.trimTag], w: 0.002 });
}

/** big curved lower tusks jutting past the faceplate */
export function lordTusks(e: PieceEnv): void {
  const { a } = e;
  const { k, H } = headSpace(a);
  const T = e.tag(e.mat, 'tusk');
  for (const sx of BOTH) {
    const t = horn(H(sx * 0.036, -0.09, 0.1), H(sx * 0.062, -0.078, 0.178), H(sx * 0.074, -0.0, 0.222), 0.029 * k, 0.003 * k, 0.014);
    e.ctx.add(`${e.spec.id}_tusk_${L(sx)}`, t, 'head', { tags: T, w: 0.01, grip: 1.8 });
    e.ctx.add(`${e.spec.id}_fang_${L(sx)}`, rc(H(sx * 0.024, -0.064, 0.108), H(sx * 0.026, -0.104, 0.118), 0.0095 * k, 0.002 * k), 'head', { tags: T, w: 0.004, grip: 1.8 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// shoulders

interface PauldronFrame {
  env: LimbEnv;
  capR: number;
  capN: Vec3;
  capC: Vec3;
  normalAt: (u: number) => Vec3;
}

function pauldronFrame(a: Anatomy, sx: 1 | -1, size: number): PauldronFrame {
  const s = a.s;
  const env = limbEnv(a, sx, 'arm');
  const topRaw: Vec3 = vnorm([sx * 0.58, 0.8, -0.04]);
  const normalAt = (u: number): Vec3 => {
    const d = env.dir(u);
    return vnorm(vsub(topRaw, vscale(d, vdot(topRaw, d))));
  };
  const capR = env.r(0.05) + 0.026 * size * s;
  const capN = normalAt(0.05);
  return { env, capR, capN, capC: vadd(env.at(0.05), vscale(capN, capR)), normalAt };
}

/** layered pauldrons: a thick dome cap with a crest ridge and two stout spikes, stepped lames down the upper arm */
export function lordPauldron(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const size = e.n('size', 1.3);
  const lames = e.n('lames', 2);
  for (const sx of BOTH) {
    const n = L(sx);
    const { env, capR, capN, normalAt } = pauldronFrame(a, sx, size);
    const cap = new Plate({ o: vadd(env.at(0.05), vscale(capN, capR)), nrm: capN, up: env.dir(0.05), hu: capR * 1.5, hv: 0.075 * size * s, R: capR, t: 0.02 * size * s, round: 0.007 * size * s, edgeThin: 0.6 });
    e.ctx.add(`${e.spec.id}_cap_${n}`, cap, `clavicle_${n}`, { tags: e.tag(e.mat), w: 0.005, grip: 1.7 });
    e.ctx.mark(`${e.spec.id}_capTrim_${n}`, cap.rim(0.01 * size * s), [e.trimTag]);
    // crest ridge along the cap
    e.ctx.add(`${e.spec.id}_crest_${n}`, rc(vadd(env.at(-0.04), vscale(capN, capR + 0.014 * size * s)), vadd(env.at(0.22), vscale(capN, capR + 0.012 * size * s)), 0.02 * size * s, 0.014 * size * s), `clavicle_${n}`, { tags: e.tag(e.mat), w: 0.006, grip: 1.7 });
    // stepped lames down the arm
    for (let i = 0; i < lames; i++) {
      const cu = (0.08 * size * s + i * 0.07 * size * s) / env.len + 0.1;
      const rr = env.r(cu) + (0.014 + 0.005 * i) * size * s;
      const nn = normalAt(cu);
      const lame = new Plate({ o: vadd(env.at(cu), vscale(nn, rr)), nrm: nn, up: env.dir(cu), hu: rr * (1.4 - 0.1 * i), hv: 0.04 * size * s, R: rr, t: 0.014 * size * s, round: 0.006 * size * s, edgeThin: 0.65 });
      e.ctx.add(`${e.spec.id}_lame${i}_${n}`, lame, env.bone(cu, n), { tags: e.tag(e.mat), w: 0.004, grip: 1.5 });
      e.ctx.mark(`${e.spec.id}_lameTrim${i}_${n}`, lame.rim(0.008 * size * s), [e.trimTag]);
    }
    // two stout spikes along the crest: leaning outward and slightly back
    [[0.02, 0.1], [0.17, 0.125]].forEach(([u, len], i) => {
      const base = vadd(env.at(u!), vscale(capN, capR + 0.004 * size * s));
      const dir = vnorm([capN[0] + sx * 0.3, capN[1], capN[2] - 0.12]);
      const tip = vadd(base, vscale(dir, len! * size * s));
      e.ctx.add(`${e.spec.id}_sp${i}_${n}`, spike(base, tip, 0.03 * size * s, 0.004 * s), `clavicle_${n}`, { tags: e.tag(e.mat, 'horn'), w: 0.008, grip: 1.7 });
    });
  }
}

/** fur mantle: two rings of broad overlapping fur leaves seated on the trapezius, a collar that frames the head and sits under the pauldrons */
export function lordMantle(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/lmantle`);
  const nk = a.neck;
  const lenK = e.n('len', 1);
  const rings = [
    { n: 16, rx: 0.34, rz: 0.27, len: 0.11, out: 0.05, w: 0.052, lift: 0 },
    { n: 20, rx: 0.52, rz: 0.32, len: 0.14, out: 0.08, w: 0.06, lift: 0.01 },
  ];
  rings.forEach((rg, row) => {
    for (let i = 0; i < rg.n; i++) {
      const ang = ((i + 0.5 * (row % 2)) / rg.n) * Math.PI * 2 + rng.range(-0.04, 0.04);
      const sa = Math.sin(ang), ca = Math.cos(ang);
      const x = sa * rg.rx, z = nk[2] + ca * rg.rz - 0.04 * s;
      const y = skinTop(e, x, z, nk[1] + 0.5 * s, nk[1] - 0.6 * s) + rg.lift * s - 0.01 * s;
      const back = ca < -0.15;
      const len = rg.len * (back ? 1.3 : 1) * rng.range(0.85, 1.15) * s * lenK;
      const out = rg.out * s * rng.range(0.8, 1.2);
      const radial = vnorm([sa * 0.9, 0, ca]);
      const base: Vec3 = [x, y, z];
      const tip: Vec3 = [x + radial[0] * out, y - len, z + radial[2] * out];
      const bone = Math.abs(x) < 0.1 * s ? 'chest' : x > 0 ? 'clavicle_l' : 'clavicle_r';
      e.ctx.add(`${e.spec.id}_t${row}_${i}`, flatCone(base, tip, rg.w * s, 0.012 * s, 0.5, radial), bone, { tags: e.tag(e.mat, 'fur'), w: 0.012 });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// trophy back-banner

interface BannerFrame {
  z: number;
  yTop: number;
  yBar: number;
  bar: number;
  r: number;
  yBot: number;
}

function bannerFrame(e: PieceEnv): BannerFrame {
  const { a } = e;
  const s = a.s;
  const nk = a.neck;
  const yTop = nk[1] + e.n('h', 0.4) * s;
  return { z: nk[2] - e.n('z', 0.3) * s, yTop, yBar: yTop - 0.14 * s, bar: e.n('bar', 0.24) * s, r: e.n('r', 0.028) * s, yBot: a.chest[1] - 0.36 * s };
}

/** leather / wood part of the banner pole: shaft, crossbar and the lashings round the torso */
export function lordPole(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const { z, yTop, yBar, bar, r, yBot } = bannerFrame(e);
  const T = e.tag(e.mat);
  const put = (name: string, sdf: Sdf, bone = 'chest', w = 0.006): void => { e.ctx.add(`${e.spec.id}_${name}`, sdf, bone, { tags: T, w, grip: 1.6 }); };
  put('shaft', rc([0, yBot, z], [0, yTop, z], r, r * 0.9));
  put('bar', rc([-bar, yBar, z], [bar, yBar, z], r * 0.85, r * 0.85));
  // lashings: wide straps round the torso, tied back to the pole
  const T0 = a.torso;
  const lo = new Loft(T0);
  for (const [yy, bone] of [[a.chest[1] + 0.2 * s, 'chest'], [a.chest[1] - 0.12 * s, 'chest']] as [number, string][]) {
    const band = new Loft(T0.map((q) => ({ y: q.y, rx: q.rx + 0.03 * s, rz: q.rz + 0.03 * s, cz: q.cz, n: q.n })), { range: [yy - 0.03 * s, yy + 0.03 * s] });
    put(`lash${Math.round(yy * 100)}`, band, bone, 0.006);
    const st = lo.at(yy);
    put(`tie${Math.round(yy * 100)}`, rc([0, yy, st.cz - st.rz - 0.02 * s], [0, yy, z + r * 0.6], 0.034 * s, 0.028 * s), bone, 0.01);
  }
}

/** iron fittings of the banner pole: spear finial, spiked bar ends, collars */
export function lordPoleIron(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const { z, yTop, yBar, bar, r } = bannerFrame(e);
  const T = e.tag(e.mat, 'metal');
  const put = (name: string, sdf: Sdf, w = 0.005): void => { e.ctx.add(`${e.spec.id}_${name}`, sdf, 'chest', { tags: T, w, grip: 1.6 }); };
  put('fin', spike([0, yTop - 0.02 * s, z], [0, yTop + 0.17 * s, z], r * 2.0, r * 0.22), 0.006);
  put('finBase', new Ellipsoid([0, yTop - 0.03 * s, z], [r * 2.0, r * 1.5, r * 2.0]), 0.005);
  put('collar', new Torus([0, yBar - 0.035 * s, z], r * 1.45, r * 0.55, [0, 1, 0]), 0.004);
  put('collar2', new Torus([0, yBar + 0.035 * s, z], r * 1.45, r * 0.55, [0, 1, 0]), 0.004);
  for (const sx of BOTH) {
    put(`endCap${sx}`, new Ellipsoid([sx * bar, yBar, z], [r * 1.5, r * 1.6, r * 1.6]), 0.005);
    put(`endSpike${sx}`, spike([sx * (bar + r), yBar, z], [sx * (bar + 0.2 * s), yBar + 0.012 * s, z], r * 1.4, r * 0.18), 0.005);
  }
}

/** bone trophies: lashed horns on the crossbar ends and a big skull emblem on the cloth */
export function lordTrophies(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const { z, yBar, bar, r } = bannerFrame(e);
  const T = e.tag(e.mat);
  for (const sx of BOTH) {
    const n = L(sx);
    e.ctx.add(`${e.spec.id}_horn_${n}`, horn([sx * bar * 0.45, yBar + r * 0.8, z - r], [sx * bar * 0.95, yBar + 0.06 * s, z - 0.02 * s], [sx * bar * 1.15, yBar + 0.16 * s, z - 0.04 * s], 0.042 * s, 0.006 * s), 'chest', { tags: T, w: 0.008, grip: 1.6 });
  }
  // emblem skull on the cloth, facing backward
  skull(e, 'emblem', [0, yBar - 0.5 * s, z - 0.11 * s], 0.075 * s, 'chest', [0, 0, -1], [0, 1, 0], 0.8);
}

/** tattered war cloth hanging from the crossbar: slab panels (the top one rigid on the chest, the lower ones follow the cape bones) ending in ragged tails */
export function lordBanner(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ch = a.layout.cape;
  if (!ch) return;
  const { z, yBar, bar } = bannerFrame(e);
  const zc = z - 0.08 * s;
  const W = bar * e.n('width', 0.85);
  const Ln = e.n('len', 0.55) * s;
  const top = yBar - 0.05 * s;
  const T = e.tag(e.mat);
  const rng = new Rng(`${a.p.seed}/lbanner`);
  // slab frame: outline (ly = height below the top edge, lz = x across), thickness along world z
  const frame: Frame = { o: [0, top, zc], x: [0, 0, 1], y: [0, 1, 0], z: [1, 0, 0] };
  const wAt = (ly: number): number => W * (1 + 0.14 * (-ly / Ln));
  const half = (): number => 0.022 * s;
  const panel = (name: string, y0: number, y1: number, bone: string): void => {
    const outline: [number, number][] = [[y0, -wAt(y0)], [y0, wAt(y0)], [y1, wAt(y1)], [y1, -wAt(y1)]];
    e.ctx.add(`${e.spec.id}_${name}`, new Slab(frame, outline, half, 0.006 * s, 0.03 * s), bone, { tags: T, w: 0.01, grip: 1.3 });
  };
  panel('top', 0, -Ln * 0.36, 'chest');
  panel('mid', -Ln * 0.33, -Ln * 0.68, ch.bones[0]!);
  // ragged hem: pointed tails of random length
  const lastBone = ch.bones[Math.min(1, ch.bones.length - 1)]!;
  const nt = e.n('tatters', 5);
  const y0 = -Ln * 0.65, yb = -Ln;
  const hem: [number, number][] = [[y0, -wAt(y0)], [y0, wAt(y0)]];
  const wl = wAt(yb);
  for (let i = 0; i < nt; i++) {
    const xr = wl - (i * 2 * wl) / nt, xl = wl - ((i + 1) * 2 * wl) / nt;
    const dl = (0.12 + 0.2 * rng.next()) * s;
    hem.push([yb + 0.04 * s, xr], [yb - dl, (xr + xl) / 2], [yb + 0.04 * s, xl]);
  }
  e.ctx.add(`${e.spec.id}_hem`, new Slab(frame, hem, half, 0.006 * s, 0.03 * s), lastBone, { tags: T, w: 0.01, grip: 1.3 });
}

// ---------------------------------------------------------------------------------------------------------------------
// waist and chest

/** broad studded belt: leather band with plate studs */
export function lordBelt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = 0.026 * s;
  const yb = a.spine[1] - 0.045 * s;
  const T0 = a.torso;
  const band = new Loft(T0.map((q) => ({ y: q.y, rx: q.rx + ext, rz: q.rz + ext, cz: q.cz, n: q.n })), { range: [yb - 0.062 * s, yb + 0.062 * s] });
  e.ctx.add(`${e.spec.id}_belt`, band, 'spine', { tags: e.tag(e.mat), w: 0.006, grip: 1.4 });
  const st = new Loft(T0, { range: [yb - 0.01, yb + 0.01] }).at(yb);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const ph = (i / n) * Math.PI * 2;
    const sp = Math.sin(ph), cp = Math.cos(ph);
    const rx = st.rx + ext + 0.005 * s, rz = st.rz + ext + 0.005 * s;
    const r = (rx * rz) / Math.hypot(rz * sp, rx * cp);
    e.ctx.add(`${e.spec.id}_stud${i}`, new Ellipsoid([sp * r, yb, st.cz + cp * r], [0.02 * s, 0.02 * s, 0.02 * s]), 'spine', { tags: e.tag(e.mat, 'stud'), w: 0.003, grip: 1.4 });
  }
}

/** iron belt plate: a heavy rounded plate on the belt front */
export function lordBeltIron(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = 0.026 * s;
  const yb = a.spine[1] - 0.045 * s;
  const st = new Loft(a.torso, { range: [yb - 0.01, yb + 0.01] }).at(yb);
  const front = st.cz + st.rz + ext;
  const T = e.tag(e.mat, 'metal');
  const plate = new Plate({ o: [0, yb, front + 0.01 * s], nrm: [0, 0, 1], up: [0, 1, 0], hu: 0.13 * s, hv: 0.105 * s, R: 0.2 * s, t: 0.024 * s, round: 0.009 * s, taper: -0.2, edgeThin: 0.7 });
  e.ctx.add(`${e.spec.id}_plate`, plate, 'spine', { tags: T, w: 0.005, grip: 1.5 });
  e.ctx.mark(`${e.spec.id}_trim`, plate.rim(0.012 * s), [e.trimTag]);
}

/** broad leather bandolier strap across the bare chest, right shoulder to left hip: flat slab segments lying on the skin, with an iron boss */
export function lordStrap(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const T0 = new Loft(a.torso);
  const yTop = a.torso[a.torso.length - 3]!.y;
  const yBot = a.spine[1] - 0.06 * s;
  const W = e.n('width', 0.075) * s;
  const onSkin = (u: number, y: number): Vec3 => {
    const st = T0.at(y);
    const x = st.cx + st.rx * u;
    return [x, y, skinFront(e, x, y, st.cz + st.rz + 0.35 * s, st.cz - 0.1 * s)];
  };
  const M = 8;
  const pts: Vec3[] = [];
  for (let kk = 0; kk <= M; kk++) {
    const t = kk / M;
    pts.push(onSkin(-0.6 + 1.4 * t, yTop + (yBot - yTop) * t));
  }
  const T = e.tag(e.mat);
  for (let kk = 0; kk < M; kk++) {
    const A = pts[kk]!, B = pts[kk + 1]!;
    const along = vnorm(vsub(B, A));
    const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const mid = vscale(vadd(A, B), 0.5);
    const st = T0.at(mid[1]);
    const radial: Vec3 = vnorm([(mid[0] - st.cx) / (st.rx * st.rx), 0, (mid[2] - st.cz) / (st.rz * st.rz)]);
    const nrm = vnorm(vsub(radial, vscale(along, vdot(radial, along))));
    const frame: Frame = { o: vadd(A, vscale(nrm, 0.012 * s)), x: nrm, y: vcross(along, nrm), z: along };
    const hw = W / 2, ov = 0.012 * s;
    const outline: [number, number][] = [[-hw, -ov], [hw, -ov], [hw, len + ov], [-hw, len + ov]];
    e.ctx.add(`${e.spec.id}_seg${kk}`, new Slab(frame, outline, () => 0.014 * s, 0.005 * s, 0.03 * s), 'chest', { tags: T, w: 0.006, grip: 1.4 });
  }
  const c = pts[M >> 1]!;
  e.ctx.add(`${e.spec.id}_boss`, new Ellipsoid([c[0], c[1], c[2] + 0.028 * s], [0.052 * s, 0.052 * s, 0.03 * s]), 'chest', { tags: e.tag('plate2', 'metal'), w: 0.005, grip: 1.4 });
}

// ---------------------------------------------------------------------------------------------------------------------
// great-axe animation style (OrcStyle): carry, overhead chop, wide sweep and the three boss specials. Chest frame, reference metres.
type V3 = [number, number, number];

/** rotate v about the unit axis by ang (Rodrigues) */
function rotAbout(v: V3, axis: V3, ang: number): V3 {
  const c = Math.cos(ang), sn = Math.sin(ang), d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const cr: V3 = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return [v[0] * c + cr[0] * sn + axis[0] * d * (1 - c), v[1] * c + cr[1] * sn + axis[1] * d * (1 - c), v[2] * c + cr[2] * sn + axis[2] * d * (1 - c)];
}

/** great-axe haft direction at `elev` above the horizontal (rad; > pi/2 = head tipping back) swung `yaw` toward +X; `roll` turns the main bit about the haft */
function axe(elev: number, yaw = 0, roll = 0): { b: V3; edge: V3 } {
  const { b, edge } = chopAxes(elev, yaw);
  return roll === 0 ? { b, edge } : { b, edge: rotAbout(edge, b, roll) };
}

const TAU = Math.PI * 2;

/** stride curve of the planted-foot gait (reference metres): z travel, lift and toe pitch at cycle phase ph */
function footAt(sweep: number, duty: number, lift: number, ph: number): { z: number; y: number; pitch: number } {
  const f = ph - Math.floor(ph);
  if (f < duty) {
    const u = f / duty;
    return { z: sweep * 0.5 - sweep * u, y: 0, pitch: (u > 0.55 ? ramp(u, 0.55, 1, 'smooth') : 0) * 0.8 };
  }
  const u = (f - duty) / (1 - duty);
  const e = u * u * (3 - 2 * u);
  return { z: -sweep * 0.5 + sweep * (e * 0.7 + u * 0.3), y: lift * Math.sin(Math.PI * Math.pow(u, 0.85)), pitch: keyed(u, [[0, 0.7], [0.3, 0.2], [1, -0.3]], 'smooth') };
}

/** decaying shake after an impact at `t0` (amp in metres of root travel) */
function quake(P: Pose, t: number, t0: number, amp: number): void {
  if (t < t0) return;
  const d = t - t0, k = Math.exp(-5 * d);
  P.root = [P.root[0] + amp * 0.35 * k * Math.sin(d * 51), P.root[1] + amp * k * Math.cos(d * 37), P.root[2]];
  P.sp = [P.sp[0] + 0.06 * k * Math.sin(d * 29 + 1), P.sp[1], P.sp[2] + 0.05 * k * Math.sin(d * 41)];
  P.head = [P.head[0] + 0.05 * k * Math.cos(d * 33), P.head[1], P.head[2]];
}

/** two-hand great axe: heavy upright carry, overhead chop, wide sweep, ground slam (special1), charge (special2, loops) and war cry (special3); `s` = body scale (for the procedural charge) */
export function greatAxeStyle(s: number): OrcStyle {
  // carry: both hands on the haft in front of the right ribs, the haft leaning back over the right shoulder with the broad bit swung outward,
  // so the axe frames the head from behind and the face stays clear from the front
  const c0 = axe(2.0, 0.8, Math.PI / 2);
  const idle: Pose = Object.assign(basePose(), stance(0.2, 0.1, 0.1), {
    sp: [0.08, -0.1, 0] as V3,
    head: [-0.12, 0.05, 0] as V3,
    hip: [0, 0.08, 0] as V3,
    r: grip(V(-0.23, -0.1, 0.26), c0.b, c0.edge, 1),
  });
  // ---- attack: overhead chop. Rear back with the head high behind, hold, then crash down through the front to a low, edge-down finish.
  const up = axe(2.05, -0.05);
  const peak = axe(2.3, -0.1);
  const smash = axe(-0.3, 0.05);
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.5, ease: 'out', p: { r: gp(V(-0.2, 0.2, 0.2), up.b, up.edge), sp: [-0.2, -0.3, 0.04], hip: [0, -0.3, 0], head: [-0.28, 0, 0], root: V(0, 0.03, -0.1), fl: V(0.24, 0, 0.02), fr: V(-0.24, 0, -0.26) } },
    { t: 0.62, ease: 'smooth', p: { r: gp(V(-0.18, 0.3, 0.12), peak.b, peak.edge), sp: [-0.32, -0.38, 0.05], root: V(0, 0.07, -0.12) } },
    { t: 0.76, ease: 'in', p: { r: gp(V(-0.1, -0.1, 0.55), smash.b, smash.edge), sp: [0.5, 0.35, -0.05], hip: [0, 0.42, 0], head: [0.2, 0, 0], root: V(0, -0.28, 0.24), fl: V(0.26, 0, 0.34), fr: V(-0.24, 0, -0.1) } },
    { t: 1.0, ease: 'smooth', p: { root: V(0, -0.3, 0.26), sp: [0.54, 0.38, 0] } },
    { t: 1.7, ease: 'smooth', p: { ...idle } },
  ];
  // ---- attack2: wide horizontal sweep from the right across the front to the left, torso twisting through it
  const w0 = sweepAxes(-0.2, 0.15, 1);
  const s0 = sweepAxes(0.2, 0.0, 1);
  const s1 = sweepAxes(0.9, -0.05, 1);
  const attack2: Key[] = [
    { t: 0, p: {} },
    { t: 0.55, ease: 'out', p: { r: gp(V(-0.34, 0.0, 0.06), w0.b, w0.edge), sp: [0.06, -0.95, 0.06], hip: [0, -0.5, 0], head: [0, 0.35, 0], root: V(0, -0.06, -0.1), fl: V(0.26, 0, 0.1), fr: V(-0.26, 0, -0.2) } },
    { t: 0.68, ease: 'smooth', p: { sp: [0.1, -1.05, 0.06], hip: [0, -0.56, 0] } },
    { t: 0.82, ease: 'in', p: { r: gp(V(-0.08, -0.04, 0.5), s0.b, s0.edge), sp: [0.2, 0.2, -0.04], hip: [0, 0.3, 0], head: [0.1, -0.1, 0], root: V(0, -0.14, 0.16), fl: V(0.26, 0, 0.3), fr: V(-0.26, 0, -0.06) } },
    { t: 1.0, ease: 'out', p: { r: gp(V(0.14, -0.06, 0.42), s1.b, s1.edge), sp: [0.22, 0.95, 0], hip: [0, 0.55, 0] } },
    { t: 1.8, ease: 'smooth', p: { ...idle } },
  ];
  // ---- special1: ground slam. Crouch, leap with the axe held high, land on both feet and drive the head into the ground; the whole body shakes.
  const hi = axe(2.1, 0);
  const apex = axe(2.35, 0);
  const slam = axe(-0.55, 0);
  const special1: Special = {
    dur: 2.4, hit: 1.22,
    keys: [
      { t: 0, p: {} },
      { t: 0.5, ease: 'out', p: { r: gp(V(-0.2, 0.12, 0.22), hi.b, hi.edge), sp: [-0.18, 0, 0], head: [-0.2, 0, 0], root: V(0, -0.22, 0), fl: V(0.3, 0, 0.1), fr: V(-0.3, 0, -0.1) } },
      { t: 0.92, ease: 'out', p: { r: gp(V(-0.16, 0.38, 0.1), apex.b, apex.edge), sp: [-0.32, 0, 0], head: [-0.35, 0, 0], root: V(0, 0.3, 0), fl: V(0.26, 0.26, 0.05), fr: V(-0.26, 0.22, -0.05) } },
      { t: 1.22, ease: 'in', p: { r: gp(V(-0.1, -0.14, 0.6), slam.b, slam.edge), sp: [0.56, 0, 0], head: [0.25, 0, 0], root: V(0, -0.36, 0.1), fl: V(0.34, 0, 0.26), fr: V(-0.34, 0, 0.18) } },
      { t: 1.5, ease: 'smooth', p: { root: V(0, -0.38, 0.1) } },
      { t: 2.4, ease: 'smooth', p: { ...idle } },
    ],
    extra: (P, t) => { quake(P, t, 1.22, 0.07); return P; },
  };
  // ---- special2: charge. A procedural, loopable lunge: deep lean, head low, axe trailing over the shoulder, long driving stride.
  const trail = axe(2.0, -0.18);
  const T2 = 0.62;
  const special2: Special = {
    dur: T2, loop: true,
    keys: [{ t: 0, p: {} }],
    extra: (P, t) => {
      const u = (t / T2) % 1;
      const fl = footAt(1.2, 0.4, 0.32, u), fr = footAt(1.2, 0.4, 0.32, u + 0.5);
      const ph = (u - 0.2) * TAU * 2;
      P.fl = [0.1 * s, fl.y * s, fl.z * s];
      P.fr = [-0.1 * s, fr.y * s, fr.z * s];
      P.fpl = fl.pitch; P.fpr = fr.pitch;
      P.root = [0.035 * s * Math.sin(u * TAU), -0.3 * s - 0.05 * s * Math.cos(ph), 0.12 * s];
      P.sp = [0.62 + 0.05 * Math.sin(ph), 0.22 * Math.sin(u * TAU), 0.05 * Math.cos(u * TAU)];
      P.hip = [0.1, -0.3 * Math.sin(u * TAU), 0.09 * Math.sin(u * TAU)];
      P.head = [-0.5, -0.12 * Math.sin(u * TAU), 0.03 * Math.sin(u * TAU)];
      P.r = { ...P.r, ...gp(V(-0.18, 0.02 + 0.03 * Math.sin(ph), 0.26), trail.b, trail.edge, 1) } as Pose['r'];
      return P;
    },
  };
  // ---- special3: war cry. Gather, then rear up with the axe raised overhead in both hands, head thrown back, chest heaving.
  const cry = axe(0.35, 1.35, 0.0);
  const special3: Special = {
    dur: 2.5,
    keys: [
      { t: 0, p: {} },
      { t: 0.5, ease: 'smooth', p: { sp: [0.3, 0, 0], head: [0.3, 0, 0], root: V(0, -0.14, 0.04), r: gp(V(-0.2, -0.2, 0.36), axe(0.9, 0.2).b, axe(0.9, 0.2).edge), fl: V(0.3, 0, 0.1), fr: V(-0.3, 0, -0.1) } },
      { t: 0.95, ease: 'out', p: { sp: [-0.34, 0, 0], head: [-0.6, 0, 0], root: V(0, 0.06, -0.04), shr: 0.1, shl: 0.1, r: gp(V(-0.34, 0.5, 0.1), cry.b, cry.edge), fl: V(0.32, 0, 0.0), fr: V(-0.32, 0, -0.06) } },
      { t: 1.9, ease: 'smooth', p: { sp: [-0.3, 0, 0] } },
      { t: 2.5, ease: 'smooth', p: { ...idle } },
    ],
    extra: (P, t) => {
      const k = ramp(t, 0.8, 1.0, 'smooth') * (1 - ramp(t, 1.8, 2.3, 'smooth'));
      const heave = Math.sin(t * 17) * k;
      P.sp = [P.sp[0] + 0.06 * heave, P.sp[1], P.sp[2] + 0.025 * Math.sin(t * 11) * k];
      P.head = [P.head[0] - 0.04 * heave, P.head[1] + 0.05 * Math.sin(t * 13) * k, P.head[2]];
      P.root = [P.root[0], P.root[1] + 0.014 * heave, P.root[2]];
      return P;
    },
  };
  return {
    cfg: { twoHand: 0.26 },
    idle,
    run: { r: gp(V(-0.2, 0.0, 0.26), axe(1.75, -0.1).b, axe(1.75, -0.1).edge) },
    attack, attackDur: 1.7, attackHit: 0.76,
    attack2, attack2Dur: 1.8, attack2Hit: 0.82,
    specials: { special1, special2, special3 },
    weight: 1.7,
    breath: 1.2,
    gait: {
      walk: { T: 1.6, duty: 0.7, sweep: 0.62, lift: 0.12, stomp: 0.07, lean: 0.06, sway: 0.04, roll: 0.06, bob: 0.025 },
      run: { T: 0.95, duty: 0.5, sweep: 0.95, lift: 0.22, stomp: 0.09, lean: 0.3, sway: 0.05, roll: 0.09, bob: 0.045 },
    },
  };
}
