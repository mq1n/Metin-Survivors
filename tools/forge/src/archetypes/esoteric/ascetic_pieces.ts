// Ascetic (warrior monk) garments: gathered monk trousers with wrapped shins, a wide sash with knot and layered tails, front / back cloth
// panels, a diagonal shoulder drape with a flowing back end, forearm bracers, a prayer-bead loop and a brow band. PieceSpec.build functions
// (`{ id, mat, build: monkSash, o: {...} }`); every piece paints with ONE material family (its `mat`).
import { type Vec3, qfromBasis, vadd, vdist, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { SmoothIntersect } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundedBox, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import { Loft, type PieceEnv, boxClip, cover, limbEnv, limbTube, slabAxis, slabY } from '../humanoid/index.ts';
import { ridge } from '../humanoid/outfit/util.ts';
import { torsoShellBand } from '../humanoid/outfit/soft.ts';
import { beadLoop, panel } from './cloth.ts';

const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');
const TORSO = ['torso_', 'pec_', 'lat_', 'trap_', 'abs', 'clavicle_'];
const sstep = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

/** skirt bone for a hanging piece (falls back to the pelvis on rigs without skirt bones) */
const skirtBone = (e: PieceEnv, which: 'f' | 'b' | 'l' | 'r'): string => (e.a.p.rig?.skirt ? `skirt_${which}` : 'pelvis');

/**
 * Gathered monk trousers: full over the hips and thighs, narrowing below the knee to a cinched cuff with a puffed gather above it. The
 * garment is a variable-radius tube around each leg (so the legs read as legs, not as a sack). o: baggy, end (u of the cuff), puff
 */
export function monkTrousers(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const bag = e.n('baggy', 0.8);
  const end = e.n('end', 0.78);
  const puff = e.n('puff', 1);
  const waist = a.spine[1] - 0.012 * s;
  cover(e, ['torso_pelvis', 'glute_'], 0.014 * s, { clip: slabY(a.pelvis[1] - 0.1 * s, waist), trim: [slabY(waist - 0.012 * s, waist)], w: 0.008 });
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'leg');
    // breeches: fullest over the upper thigh, drawn in toward the knee and cuff
    const ext = (u: number): number => s * (0.011 + 0.03 * bag * sstep(u / 0.1) * (1 - sstep((u - 0.12) / 0.34)));
    const um = env.uMid;
    const ranges: [number, number][] = [[0.02, um + 0.05], [um - 0.04, end]];
    ranges.forEach(([u0, u1], k) => {
      e.ctx.add(`${e.spec.id}_leg${k}_${L(sx)}`, limbTube(env, u0, u1, ext, { w: 0.012 }), env.bone((u0 + u1) / 2, L(sx)), { tags: e.tag(e.mat), w: 0.008 });
    });
    // gather: a puffed ring of cloth just above the cuff, then the cuff band itself
    const at = (u: number): Vec3 => env.at(u);
    const r = (u: number): number => env.r(u) + ext(u);
    const uc = end - 0.035;
    if (puff > 0) e.ctx.add(`${e.spec.id}_puff_${L(sx)}`, new Torus(at(uc), r(uc) + 0.006 * s, 0.026 * s * puff, env.dir(uc)), `shin_${L(sx)}`, { tags: e.tag(e.mat), w: 0.008 });
    e.ctx.add(`${e.spec.id}_cuff_${L(sx)}`, new Torus(at(end), r(end) + 0.004 * s, 0.014 * s, env.dir(end)), `shin_${L(sx)}`, { tags: e.tag(e.mat), w: 0.004 });
  }
}

/** shin wraps below the trouser cuff: a smooth gaiter with a flared top, two bound bands and an ankle band. o: from (u of the top) */
export function shinWraps(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const u0 = e.n('from', 0.76);
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'leg');
    cover(e, ['shin_', 'calf_', 'ankle_'], 0.008 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, u0, 0.985), w: 0.005, grip: 1.2 });
    for (const [u, k] of [[u0 + 0.04, 1.1], [(u0 + 1) / 2 - 0.01, 0.9], [0.945, 1.1]] as [number, number][]) {
      ridge(e, ['shin_', 'calf_', 'ankle_'], env, L(sx), u, 0.0095 * s * k, 0.0155 * s, `_band${u.toFixed(2)}`);
    }
  }
}

/**
 * Wide waist sash: two wrapped layers, a big knot on the left hip and three tails of different length hanging from it (on the left skirt
 * bone so they swing). o: y, width, side (1 = left), tail
 */
export function monkSash(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.045) * s;
  const hh = e.n('width', 0.062) * s;
  const ext = e.n('ext', 0.026) * s;
  const side: 1 | -1 = e.n('side', 1) >= 0 ? 1 : -1;
  for (const sh of torsoShellBand(a, y - hh, y + hh, ext)) e.ctx.add(`${e.spec.id}_band_${sh.bone}`, sh.sdf, sh.bone, { tags: e.tag(e.mat), w: 0.006 });
  for (const sh of torsoShellBand(a, y + hh * 0.2, y + hh + 0.022 * s, ext + 0.008 * s)) e.ctx.add(`${e.spec.id}_fold_${sh.bone}`, sh.sdf, sh.bone, { tags: e.tag(e.mat), w: 0.006 });
  const st = new Loft(a.torso).at(y);
  const kx = side * 0.118 * s, kz = st.cz + st.rz * 0.9;
  const kn: Vec3 = [kx, y - 0.006 * s, kz + 0.026 * s];
  // knot: a lumpy bundle
  e.ctx.add(`${e.spec.id}_knot`, new Ellipsoid(kn, [0.046 * s, 0.04 * s, 0.034 * s]), 'spine', { tags: e.tag(e.mat), w: 0.008 });
  e.ctx.add(`${e.spec.id}_knotB`, new Ellipsoid(vadd(kn, [side * 0.03 * s, -0.018 * s, 0.012 * s]), [0.03 * s, 0.026 * s, 0.026 * s]), 'spine', { tags: e.tag(e.mat), w: 0.008 });
  const tl = e.n('tail', 0.6) * s;
  const bone = skirtBone(e, side === 1 ? 'l' : 'r');
  const fb = skirtBone(e, 'f');
  const n: Vec3 = [side, 0, 0.3];
  // long tail: falls beside the thigh, kicks outward, forked end
  const tails: { top: Vec3; len: number; half: number; nrm: Vec3; bone: string; bow: number; down: Vec3 }[] = [
    { top: vadd(kn, [side * 0.05 * s, -0.02 * s, 0.0]), len: tl, half: 0.034 * s, nrm: n, bone, bow: 0.026 * s, down: [side * 0.12, -1, -0.04] },
    { top: vadd(kn, [side * 0.01 * s, -0.025 * s, 0.03 * s]), len: tl * 0.74, half: 0.032 * s, nrm: [side * 0.3, 0, 1], bone: fb, bow: 0.02 * s, down: [side * -0.06, -1, 0.05] },
    { top: vadd(kn, [side * 0.03 * s, -0.02 * s, 0.01 * s]), len: tl * 0.5, half: 0.03 * s, nrm: [side * 0.8, 0, 0.6], bone, bow: 0.016 * s, down: [side * 0.3, -1, 0.1] },
  ];
  tails.forEach((t, i) => {
    e.ctx.add(`${e.spec.id}_tail${i}`, panel({ top: t.top, len: t.len, half: t.half, nrm: t.nrm, R: 0.12 * s, t: 0.017 * s, taper: -0.15, bow: t.bow, down: t.down }), t.bone, { tags: e.tag(e.mat, 'strip'), w: 0.005 });
  });
  e.ctx.mark(`${e.spec.id}_trim_top`, new Loft(a.torso.map((q) => ({ y: q.y, rx: q.rx + ext + 0.0025 * s, rz: q.rz + ext + 0.0025 * s, cz: q.cz, n: (q.n ?? 2) + 0.3 })), { range: [y + hh - 0.012 * s, y + hh] }), [e.trimTag]);
}

/**
 * Cloth hanging from the sash: two overlapping front panels with a V gap (so the thighs show when the legs move) and one back panel,
 * swinging on the front / back skirt bones. o: len, half, y, gap, back
 */
export function monkAprons(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y0 = a.spine[1] + e.n('y', -0.06) * s;
  const len = e.n('len', 0.5) * s;
  const hu = e.n('half', 0.092) * s;
  const gap = e.n('gap', 0.012) * s;
  const T = new Loft(a.torso);
  const st = T.at(a.pelvis[1]);
  const zf = Math.max(st.cz + st.rz, 0.1 * s) + 0.04 * s;
  const zb = Math.max(st.rz - st.cz, 0.1 * s) + 0.04 * s;
  const R = 0.2 * s;
  const mk = (name: string, o: { top: Vec3; len: number; nrm: Vec3; half: number; bone: string; bow: number; taper?: number; t?: number; down?: Vec3 }): void => {
    const pl = panel({ top: o.top, len: o.len, half: o.half, nrm: o.nrm, R, t: o.t ?? 0.018 * s, taper: o.taper ?? 0.1, bow: o.bow, down: o.down ?? [0, -1, 0] });
    e.ctx.add(`${e.spec.id}_${name}`, pl, o.bone, { tags: e.tag(e.mat, 'strip'), w: 0.005 });
    e.ctx.mark(`${e.spec.id}_trim_${name}`, pl.rim(0.011 * s), [e.trimTag]);
  };
  const fb = skirtBone(e, 'f');
  // two front panels, the right-hand one (character's right, -x) lapping over
  mk('frontL', { top: [hu + gap, y0, zf - 0.012 * s], len: len * 0.94, half: hu, nrm: [0.28, 0, 1], bone: fb, bow: 0.04 * s });
  mk('frontR', { top: [-hu - gap, y0 - 0.012 * s, zf + 0.004 * s], len: len, half: hu, nrm: [-0.28, 0, 1], bone: fb, bow: 0.045 * s, t: 0.02 * s });
  mk('back', { top: [0, y0 - 0.01 * s, -zb], len: len * e.n('back', 1.1), half: hu * 1.25, nrm: [0, 0, -1], bone: skirtBone(e, 'b'), bow: 0.05 * s });
}

/**
 * Diagonal shoulder drape (kasaya): a thick cloth band from one shoulder across chest and back to the opposite hip, folded roll along
 * its lower edge, a cap over the carrying shoulder and a free end flowing down the back on the cape chain. o: side (1 = left shoulder), width, ext, flow
 */
export function kasaya(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const side: 1 | -1 = e.n('side', 1) >= 0 ? 1 : -1;
  const hw = e.n('width', 0.078) * s;
  const ext = e.n('ext', 0.02) * s;
  const topY = a.torso[a.torso.length - 3]!.y + 0.034 * s;
  const p0: Vec3 = [side * 0.12 * s, topY, 0];
  const p1: Vec3 = [-side * 0.17 * s, a.pelvis[1] + 0.045 * s, 0];
  const d = vnorm(vsub(p1, p0));
  const len = vdist(p0, p1);
  const q = qfromBasis([d[1], -d[0], 0], d, [0, 0, 1]);
  const mid = vlerp(p0, p1, 0.5);
  const band = new RoundedBox(mid, [hw, len / 2 + 0.1 * s, 1], 0.006, q);
  // the drape is a smooth lofted shell of the torso (no per-muscle jaggies at its edges) clipped to the diagonal band; a second, thicker
  // strip along its lower edge reads as the folded roll
  const perp: Vec3 = [d[1], -d[0], 0];
  const roll = new RoundedBox(vadd(mid, vscale(perp, -side * hw * 0.8)), [hw * 0.3, len / 2 + 0.08 * s, 1], 0.006, q);
  const yLo = a.pelvis[1] - 0.03 * s, yHi = topY + 0.02 * s;
  for (const sh of torsoShellBand(a, yLo, yHi, ext)) {
    e.ctx.add(`${e.spec.id}_drape_${sh.bone}`, new SmoothIntersect([sh.sdf, band], 0.007), sh.bone, { tags: e.tag(e.mat), w: 0.008 });
  }
  for (const sh of torsoShellBand(a, yLo, yHi, ext + 0.012 * s)) {
    e.ctx.add(`${e.spec.id}_roll_${sh.bone}`, new SmoothIntersect([sh.sdf, roll], 0.006), sh.bone, { tags: e.tag(e.mat), w: 0.006 });
  }
  // cap over the carrying shoulder, falling a hand's breadth down the upper arm
  const sh = a.side(side).shoulder;
  cover(e, ['delt_'], ext + 0.006 * s, {
    filter: (p) => p.name.endsWith(L(side)),
    clip: boxClip([sh[0] + side * 0.012 * s, sh[1] - 0.03 * s, sh[2]], [0.082 * s, 0.1 * s, 0.2 * s]),
    edge: 0.006, w: 0.006,
  });
  // flowing end down the back on the cape chain (two plates: upper on cape1, lower on cape2), or rigid on the chest without a cape rig
  const cape = a.layout.cape;
  const flow = e.n('flow', 0.62) * s;
  const top: Vec3 = [side * 0.105 * s, topY - 0.03 * s, a.spineZ(topY) - 0.1 * s];
  const lenU = flow * 0.5;
  const nrm: Vec3 = [side * 0.15, 0.1, -1];
  const down: Vec3 = [side * 0.05, -1, -0.12];
  const upper = panel({ top, len: lenU + 0.03 * s, half: 0.1 * s, nrm, R: 0.17 * s, t: 0.02 * s, taper: -0.08, down });
  const topL: Vec3 = vadd(top, vscale(vnorm(down), lenU));
  const lower = panel({ top: topL, len: flow - lenU, half: 0.115 * s, nrm: [side * 0.1, 0, -1], R: 0.2 * s, t: 0.019 * s, taper: 0.1, bow: 0.05 * s, down });
  e.ctx.add(`${e.spec.id}_flowU`, upper, cape ? cape.bones[0]! : 'chest', { tags: e.tag(e.mat, 'strip'), w: 0.006 });
  e.ctx.add(`${e.spec.id}_flowL`, lower, cape ? cape.bones[Math.min(1, cape.bones.length - 1)]! : 'chest', { tags: e.tag(e.mat, 'strip'), w: 0.006 });
  e.ctx.mark(`${e.spec.id}_trim_flow`, lower.rim(0.012 * s), [e.trimTag]);
}

/** forearm bracers: leather sleeve from below the elbow to the wrist with a flared elbow cuff, two straps and a wrist band. o: from */
export function bracers(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const u0 = e.n('from', 0.575);
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'arm');
    cover(e, ['forearm_', 'flexor_'], 0.012 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, u0, 0.975, 0.004), w: 0.005, grip: 1.2 });
    ridge(e, ['forearm_', 'flexor_'], env, L(sx), u0 + 0.012, 0.012 * s, 0.024 * s, '_cuffTop');
    ridge(e, ['forearm_', 'flexor_'], env, L(sx), u0 + 0.11, 0.008 * s, 0.0185 * s, '_strapA');
    ridge(e, ['forearm_', 'flexor_'], env, L(sx), u0 + 0.215, 0.008 * s, 0.0185 * s, '_strapB');
    ridge(e, ['forearm_', 'flexor_'], env, L(sx), 0.955, 0.012 * s, 0.022 * s, '_wrist');
  }
}

/** prayer-bead loop hanging from the neck over the chest (cord + big beads) plus a collar of beads behind the neck. o: cord, bead, beads, drop, sag */
export function mala(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const r = e.n('bead', 0.036) * s;
  beadLoop(e, { r: e.n('cord', 0.017) * s, bead: r, beads: Math.round(e.n('beads', 7)), drop: e.n('drop', 0.27) * s, spread: e.n('spread', 0.7), clear: e.n('clear', 0.03) * s, y: e.n('y', 0.03) * s });
  for (let i = 0; i < 3; i++) {
    const ang = Math.PI * (0.66 + 0.68 * (i / 2));
    const x = Math.sin(ang) * 0.115 * s, z = a.neck[2] + Math.cos(ang) * 0.1 * s;
    e.ctx.add(`${e.spec.id}_bk${i}`, new Sphere([x, a.neck[1] + 0.012 * s, z], r * 0.9), 'neck', { tags: e.tag(e.mat, 'bead'), w: 0.002, grip: 1.3 });
  }
}

/** forehead band with a raised plate, a gem and two trailing tails (rigid on the head). o: plate (size), tails (0/1) */
export function browBand(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const y = sk[1] + 0.046 * k;
  const ring = new Torus([sk[0], y, sk[2] - 0.006 * k], 0.093 * k, 0.0135 * k, [0, 1, -0.07]);
  e.ctx.add(`${e.spec.id}_ring`, ring, 'head', { tags: e.tag(e.mat), w: 0.004, grip: 1.5 });
  e.ctx.mark(`${e.spec.id}_trim`, new Torus([sk[0], y, sk[2] - 0.006 * k], 0.093 * k, 0.016 * k, [0, 1, -0.07]), [e.trimTag]);
  const pk = e.n('plate', 1);
  if (pk > 0) {
    e.ctx.add(`${e.spec.id}_plate`, new RoundedBox([sk[0], y + 0.004 * k, sk[2] + 0.089 * k], [0.03 * k * pk, 0.034 * k * pk, 0.01 * k], 0.006 * k), 'head', { tags: e.tag(e.s('plateMat', 'gold')), w: 0.003, grip: 1.6 });
    e.ctx.add(`${e.spec.id}_gem`, new Sphere([sk[0], y + 0.004 * k, sk[2] + 0.101 * k], 0.012 * k * pk), 'head', { tags: e.tag(e.s('plateMat', 'gold')), w: 0.002, grip: 1.6 });
  }
  if (e.b('tails', true)) {
    const base: Vec3 = [0.006 * k, y - 0.004 * k, sk[2] - 0.098 * k];
    for (const sx of BOTH) {
      e.ctx.add(`${e.spec.id}_tail_${L(sx)}`, flatCone(base, [sx * 0.06 * k, y - 0.25 * k, sk[2] - 0.2 * k], 0.03 * k, 0.026 * k, 0.32, [1, 0, 0]), 'head', { tags: e.tag(e.mat), w: 0.006 });
    }
  }
}

