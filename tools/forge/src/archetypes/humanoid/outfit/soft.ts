// Soft pieces: cloth, leather, fur and hanging parts (tunic, trousers, robe/coat, sash, boots, scarf, cape, tail, mantle...).
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../../core/math.ts';
import { Rng } from '../../../core/rng.ts';
import type { Sdf } from '../../../core/sdf/node.ts';
import { SmoothIntersect } from '../../../core/sdf/ops.ts';
import { Ellipsoid, HalfSpace, RoundCone, RoundedBox, Torus } from '../../../core/sdf/primitives.ts';
import { flatCone, tubeSegments } from '../../../core/sdf/shapes.ts';
import { Loft, type Station } from '../kit/loft.ts';
import { limbBand, limbEnv, limbTube, type LimbEnv } from '../kit/limbs.ts';
import { Plate } from '../kit/plate.ts';
import type { Side } from '../params.ts';
import { type PieceEnv, ridge, boxClip, clipMinus, cover, slabAxis, slabY } from './util.ts';

const BOTH = [1, -1] as Side[];
const L = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');
const TORSO = ['torso_', 'pec_', 'lat_', 'trap_', 'abs', 'clavicle_'];
const ARM = ['upper_arm_', 'biceps_', 'triceps_', 'elbow_', 'forearm_', 'flexor_'];
const LEG = ['thigh_', 'quad_', 'ham_', 'knee_', 'kneecap_', 'shin_', 'calf_'];
const FOOT = ['heel_', 'ankle_', 'midfoot_', 'ball_', 'toes_'];

/** garment tube along a limb, split at the joint so each half is skinned to its own bone */
function limbGarment(e: PieceEnv, env: LimbEnv, sx: Side, u0: number, u1: number, ext: number | ((u: number) => number), name: string, o: { w?: number; flat?: boolean; extra?: string[] } = {}): void {
  const um = env.uMid;
  const ranges: [number, number][] = u1 <= um + 0.04 || u0 >= um - 0.04 ? [[u0, u1]] : [[u0, um + 0.04], [um - 0.04, u1]];
  ranges.forEach(([a, b], k) => {
    const sdf = o.flat ? limbBand(env, a, b, ext) : limbTube(env, a, b, ext);
    e.ctx.add(`${e.spec.id}_${name}${k}_${L(sx)}`, sdf, env.bone((a + b) / 2, L(sx)), { tags: e.tag(e.mat, ...(o.extra ?? [])), w: o.w ?? 0.005 });
  });
}

/** tunic / shirt: torso cover + optional sleeves; collar variants */
export function tunic(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.007) * s;
  const y0 = a.pelvis[1] - e.n('hem', 0.1) * s;
  const yTop = a.torso[a.torso.length - 1]!.y - 0.012 * s;
  let clip: Sdf = slabY(y0, yTop);
  const collar = e.s('collar', 'crew');
  const stn = a.torso[a.torso.length - 3]!;
  const front = (stn.cz ?? 0) + stn.rz;
  if (collar === 'v') clip = clipMinus(clip, [new Ellipsoid([0, yTop + 0.01 * s, front + 0.012 * s], [0.04 * s, 0.1 * s, 0.05 * s])]);
  const sleeve = e.n('sleeve', 0);
  cover(e, TORSO, ext, { clip, trim: [slabY(y0, y0 + 0.012 * s)] });
  cover(e, ['glute_'], ext, { clip });
  if (sleeve > 0) {
    for (const sx of BOTH) {
      const env = limbEnv(a, sx, 'arm');
      cover(e, ['delt_'].map((x) => x), ext, { filter: (p) => p.name.endsWith(L(sx)), clip: boxClip([sx * 0.2 * s, a.torso[a.torso.length - 3]!.y, 0], [0.09 * s, 0.12 * s, 0.2 * s]) });
      cover(e, ARM.slice(0, 4), ext, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, 0, Math.min(sleeve, 0.54)), trim: [slabAxis(env, Math.min(sleeve, 0.54) - 0.012, Math.min(sleeve, 0.54))] });
      if (sleeve > 0.54) cover(e, ARM.slice(4), ext, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, 0.5, sleeve) });
    }
  }
}

/** trousers: tight (cover) or baggy tubes with a cinched ankle */
export function trousers(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const baggy = e.n('baggy', 0.4);
  const end = e.n('end', 0.97);
  const waist = a.spine[1] - 0.01 * s;
  cover(e, ['torso_pelvis', 'glute_'], 0.008 * s, { clip: slabY(a.pelvis[1] - 0.08 * s, waist), trim: [slabY(waist - 0.012 * s, waist)] });
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'leg');
    if (baggy < 0.2) {
      cover(e, LEG, 0.007 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, 0, end) });
    } else {
      const ext = (u: number): number => (0.014 + 0.032 * baggy * Math.sin(Math.min(u / 0.35, 1) * 1.4) * (1 - 0.65 * Math.max(0, (u - 0.62) / 0.38))) * s;
      limbGarment(e, env, sx, 0, end, ext, 'leg', { w: 0.01 });
    }
  }
}

/** belt / sash around the waist with optional hanging tails */
export function sash(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.02) * s;
  const hh = e.n('width', 0.038) * s;
  const ext = e.n('ext', 0.016) * s;
  for (const sh of torsoShellBand(a, y - hh, y + hh, ext)) e.ctx.add(`${e.spec.id}_band_${sh.bone}`, sh.sdf, sh.bone, { tags: e.tag(e.mat), w: 0.006 });
  e.ctx.mark(`${e.spec.id}_trim_top`, new SmoothIntersect([bandAll(a, ext + 0.003), slabY(y + hh - 0.01 * s, y + hh)], 0.001), [e.trimTag]);
  const front = frontZ(a, y);
  if (e.b('knot', true)) {
    e.ctx.add(`${e.spec.id}_knot`, new Ellipsoid([-0.06 * s, y - 0.004 * s, front + 0.012 * s], [0.032 * s, 0.03 * s, 0.022 * s]), 'spine', { tags: e.tag(e.mat), w: 0.006 });
    const tails = e.n('tails', 2);
    const rig = a.p.rig?.skirt;
    for (let i = 0; i < tails; i++) {
      const sx = i % 2 === 0 ? 1 : -1;
      const base: Vec3 = [-0.06 * s + sx * 0.012 * s, y - 0.01 * s, front + 0.014 * s];
      const tip: Vec3 = [-0.075 * s + sx * 0.035 * s, y - e.n('tail', 0.3) * s * (1 - 0.18 * i), front + 0.03 * s + 0.01 * s * i];
      e.ctx.add(`${e.spec.id}_tail${i}`, flatCone(base, tip, 0.026 * s, 0.021 * s, 0.4, [0, 0, 1]), rig ? 'skirt_f' : 'pelvis', { tags: e.tag(e.mat), w: 0.004 });
    }
  }
}

/** leather belt with a buckle plate */
export function belt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.025) * s;
  const hh = 0.022 * s;
  const ext = 0.013 * s;
  for (const sh of torsoShellBand(a, y - hh, y + hh, ext)) e.ctx.add(`${e.spec.id}_band_${sh.bone}`, sh.sdf, sh.bone, { tags: e.tag(e.mat), w: 0.004 });
  const front = frontZ(a, y);
  const buckle = new Plate({ o: [0, y, front + ext + 0.002 * s], nrm: [0, 0, 1], up: [0, 1, 0], hu: 0.036 * s, hv: 0.03 * s, R: 0.06 * s, t: 0.008 * s, round: 0.003 });
  e.ctx.add(`${e.spec.id}_buckle`, buckle, 'spine', { tags: e.tag(e.s('buckleMat', 'gold'), 'metal'), w: 0.002 });
  e.ctx.mark(`${e.spec.id}_trim`, buckle.rim(0.006 * s), [e.trimTag]);
  // pouches on the hips
  const pouches = e.n('pouches', 0);
  for (let i = 0; i < pouches; i++) {
    const sx = i % 2 === 0 ? 1 : -1;
    const c: Vec3 = [sx * (0.145 + 0.01 * i) * s, y - 0.045 * s, 0.03 * s + 0.045 * s * (i > 1 ? -1 : 1)];
    e.ctx.add(`${e.spec.id}_pouch${i}`, new RoundedBox(c, [0.026 * s, 0.032 * s, 0.022 * s], 0.01 * s), 'pelvis', { tags: e.tag(e.mat), w: 0.006 });
  }
}

function frontZ(a: PieceEnv['a'], y: number): number {
  const st = new Loft(a.torso).at(y);
  return st.cz + st.rz;
}

function bandAll(a: PieceEnv['a'], ext: number): Sdf {
  return new Loft(a.torso.map((q) => ({ y: q.y, rx: q.rx + ext, rz: q.rz + ext, cz: q.cz, n: q.n })));
}

function torsoShellBand(a: PieceEnv['a'], y0: number, y1: number, ext: number): { sdf: Sdf; bone: string }[] {
  const st: Station[] = a.torso.map((q) => ({ y: q.y, rx: q.rx + ext, rz: q.rz + ext, cz: q.cz, n: (q.n ?? 2) + 0.3 }));
  const out: { sdf: Sdf; bone: string }[] = [];
  const cuts: [number, number, string][] = [[-Infinity, a.spine[1] + 0.03 * a.s, 'pelvis'], [a.spine[1] - 0.03 * a.s, a.chest[1] + 0.04 * a.s, 'spine'], [a.chest[1] - 0.04 * a.s, Infinity, 'chest']];
  for (const [lo, hi, bone] of cuts) {
    const l = Math.max(lo, y0), h = Math.min(hi, y1);
    if (h - l < 0.004) continue;
    out.push({ sdf: new Loft(st, { range: [l, h] }), bone });
  }
  return out;
}

export { torsoShellBand };

/** long coat / robe: fitted upper body, flared skirt split into four swinging sectors, optional front slit, wide sleeves */
export function robe(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.012) * s;
  const hem = e.n('hem', 0.12) * s;
  const flare = e.n('flare', 1);
  const waist = a.spine[1] + 0.02 * s;
  const yTop = a.torso[a.torso.length - 3]!.y + 0.02 * s;
  const open = e.n('open', 0);
  // upper body
  const clip: Sdf = slabY(waist - 0.02 * s, yTop);
  const v = e.s('collar', 'crew');
  const stn = a.torso[a.torso.length - 3]!;
  const front = (stn.cz ?? 0) + stn.rz;
  const upClip = v === 'v' || open > 0 ? clipMinus(clip, [new Ellipsoid([0, yTop + 0.015 * s, front + 0.02 * s], [0.045 * s + open * 0.03 * s, 0.12 * s, 0.06 * s])]) : clip;
  cover(e, TORSO, ext, { clip: upClip, trim: [slabY(waist - 0.02 * s, waist - 0.008 * s)] });
  // skirt: loft from the waist to the hem; flare grows toward the hem
  const hipY = a.side(1).hip[1];
  const T = new Loft(a.torso);
  const wst = T.at(waist);
  const hp = T.at(a.pelvis[1] - 0.02 * s);
  const sk: Station[] = [
    { y: hem, rx: (0.26 * s) * flare + 0.02 * s, rz: (0.22 * s) * flare + 0.02 * s, cz: -0.005 * s, n: 2.15 },
    { y: hem + (hipY - hem) * 0.33, rx: (0.22 * s) * flare + 0.012 * s, rz: (0.19 * s) * flare + 0.012 * s, cz: -0.004 * s, n: 2.1 },
    { y: hem + (hipY - hem) * 0.7, rx: (0.195 * s) * Math.max(flare, 0.9) + 0.01 * s, rz: (0.15 * s) * Math.max(flare, 0.9) + 0.01 * s, cz: -0.002 * s, n: 2.2 },
    { y: a.pelvis[1] - 0.02 * s, rx: hp.rx + ext, rz: hp.rz + ext, cz: hp.cz, n: 2.3 },
    { y: waist, rx: wst.rx + ext, rz: wst.rz + ext, cz: wst.cz, n: 2.4 },
  ];
  const full = new Loft(sk);
  const slit = open > 0 ? clipMinus(full, [new RoundedBox([0, (hem + hipY) / 2 - 0.03 * s, 0.3 * s], [0.012 * s + open * 0.03 * s, (hipY - hem) / 2 + 0.05 * s, 0.14 * s], 0.01 * s)], 0.006) : full;
  const rig = a.p.rig?.skirt;
  if (rig) {
    const sectors: [string, number][] = [['skirt_f', 0], ['skirt_b', Math.PI], ['skirt_l', Math.PI / 2], ['skirt_r', -Math.PI / 2]];
    for (const [bone, ang] of sectors) {
      const part = new SmoothIntersect([slit, sectorWedge(ang, (Math.PI / 4) * 1.35)], 0.004);
      const low = new SmoothIntersect([part, slabY(hem - 0.01, hipY - 0.02 * s)], 0.002);
      e.ctx.add(`${e.spec.id}_skirt_${bone}`, low, bone, { tags: e.tag(e.mat, 'skirt'), w: 0.008 });
    }
    e.ctx.add(`${e.spec.id}_hipband`, new SmoothIntersect([slit, slabY(hipY - 0.03 * s, waist)], 0.002), 'pelvis', { tags: e.tag(e.mat), w: 0.006 });
  } else {
    e.ctx.add(`${e.spec.id}_skirt`, slit, 'pelvis', { tags: e.tag(e.mat, 'skirt'), w: 0.008 });
  }
  e.ctx.mark(`${e.spec.id}_trim_hem`, new SmoothIntersect([slit, slabY(hem - 0.01, hem + 0.022 * s)], 0.001), [e.trimTag]);
  if (open > 0) {
    // front edge trim along the slit
    for (const sx of BOTH) {
      const p0: Vec3 = [sx * (0.012 * s + open * 0.03 * s), hem, 0.2 * s];
      e.ctx.mark(`${e.spec.id}_trim_slit_${L(sx)}`, new SmoothIntersect([slit, new RoundedBox([p0[0], (hem + hipY) / 2, 0.2 * s], [0.01 * s, (hipY - hem) / 2 + 0.05 * s, 0.3 * s], 0.004)], 0.001), [e.trimTag]);
    }
  }
  // sleeves
  const sleeve = e.n('sleeve', 1);
  const wide = e.n('wide', 0);
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'arm');
    cover(e, ['delt_'], ext, { filter: (p) => p.name.endsWith(L(sx)), clip: boxClip([sx * 0.2 * s, a.torso[a.torso.length - 3]!.y, 0], [0.09 * s, 0.12 * s, 0.2 * s]) });
    const ex = (u: number): number => ext + wide * 0.045 * s * Math.min(Math.max((u - 0.25) / 0.5, 0), 1) ** 1.2;
    limbGarment(e, env, sx, 0.02, sleeve * 0.97, ex, 'sleeve', { w: 0.01 });
    if (wide > 0.2) {
      // hanging cuff: a drooping flare past the wrist
      const w = env.at(sleeve * 0.97);
      const tip: Vec3 = [w[0] + sx * 0.02 * s, w[1] - 0.16 * s * wide, w[2] + 0.03 * s];
      e.ctx.add(`${e.spec.id}_cuff_${L(sx)}`, new RoundCone(w, tip, env.r(sleeve * 0.97) + ex(sleeve * 0.97), 0.05 * s + 0.04 * s * wide), `forearm_${L(sx)}`, { tags: e.tag(e.mat, 'cuff'), w: 0.012 });
      e.ctx.mark(`${e.spec.id}_trim_cuff_${L(sx)}`, new SmoothIntersect([new RoundCone(w, tip, env.r(sleeve * 0.97) + ex(sleeve * 0.97) + 0.003, 0.053 * s + 0.04 * s * wide), boxClip([tip[0], tip[1], tip[2]], [0.3, 0.02 * s, 0.3])], 0.001), [e.trimTag]);
    }
  }
}

/** wedge-shaped sector around the vertical axis centred on `ang` (0 = +Z front, +90° = +X), half-angle `half` */
export function sectorWedge(ang: number, half: number): Sdf {
  const nA: Vec3 = [Math.sin(ang + half + Math.PI / 2), 0, Math.cos(ang + half + Math.PI / 2)];
  const nB: Vec3 = [Math.sin(ang - half - Math.PI / 2), 0, Math.cos(ang - half - Math.PI / 2)];
  const hA = new HalfSpace([0, 0, 0], nA, 4);
  const hB = new HalfSpace([0, 0, 0], nB, 4);
  const dirx = Math.sin(ang), dirz = Math.cos(ang);
  const forward = new HalfSpace([-dirx * 0.02, 0, -dirz * 0.02], [-dirx, 0, -dirz], 4);
  return new SmoothIntersect([hA, hB, forward], 0.002);
}

/** wraps: bandage / leather strapping on forearms and shins */
export function wraps(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const where = e.s('where', 'forearm');
  const rings = e.n('rings', 5);
  for (const sx of BOTH) {
    if (where === 'forearm' || where === 'both') {
      const env = limbEnv(a, sx, 'arm');
      cover(e, ARM.slice(4), 0.007 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, env.uMid + 0.04, 0.96), trim: [slabAxis(env, 0.93, 0.96)] });
      for (let i = 0; i < rings; i++) {
        const u = env.uMid + 0.1 + (i / Math.max(rings - 1, 1)) * (0.96 - env.uMid - 0.15);
        ridge(e, ARM.slice(4), env, L(sx), u, 0.0052 * s, 0.0125 * s, `_ring${i}`);
      }
    }
    if (where === 'shin' || where === 'both') {
      const env = limbEnv(a, sx, 'leg');
      cover(e, ['shin_', 'calf_'], 0.007 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, env.uMid + 0.1, 0.93) });
      for (let i = 0; i < rings; i++) {
        const u = env.uMid + 0.14 + (i / Math.max(rings - 1, 1)) * (0.9 - env.uMid - 0.18);
        ridge(e, ['shin_', 'calf_'], env, L(sx), u, 0.0055 * s, 0.0125 * s, `_sring${i}`);
      }
    }
  }
}

/** boots / shoes: shin cover from `start` (u over the shin), foot cover with a flat sole, cuff roll, toe cap, upturned toe optional */
export function boots(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const start = e.n('start', 0.55);
  const ext = e.n('ext', 0.011) * s;
  const sole = new HalfSpace([0, 0.0005, 0], [0, -1, 0], 4);
  const toeUp = e.n('toeUp', 0);
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'leg');
    const u0 = env.uMid + (1 - env.uMid) * start;
    if (start < 0.98) {
      cover(e, ['shin_', 'calf_'], ext, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, u0, 1.0), trim: [slabAxis(env, u0, u0 + 0.012)] });
      ridge(e, ['shin_', 'calf_'], env, L(sx), u0 + 0.012, 0.011 * s, ext + 0.007 * s, '_cuff');
    }
    cover(e, FOOT, ext + 0.003 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: sole, name: '_foot', w: 0.005 });
    const j = a.side(sx);
    // toe cap + heel block
    e.ctx.add(`${e.spec.id}_toecap_${L(sx)}`, new Ellipsoid([j.ball[0], 0.03 * s, j.ball[2] + 0.055 * s], [a.r.footW * 1.1, 0.03 * s, 0.06 * s]), `toe_${L(sx)}`, { tags: e.tag(e.mat, 'toecap'), w: 0.006 });
    if (toeUp > 0) {
      e.ctx.add(`${e.spec.id}_toeup_${L(sx)}`, new RoundCone([j.ball[0], 0.04 * s, j.ball[2] + 0.07 * s], [j.ball[0], 0.04 * s + 0.06 * s * toeUp, j.toeTip[2] + 0.055 * s * toeUp], 0.03 * s, 0.009 * s), `toe_${L(sx)}`, { tags: e.tag(e.mat, 'toecap'), w: 0.012 });
    }
    e.ctx.add(`${e.spec.id}_heel_${L(sx)}`, new RoundedBox([j.heel[0], 0.014 * s, j.heel[2] - 0.012 * s], [a.r.footW * 0.85, 0.02 * s, 0.04 * s], 0.01 * s), `foot_${L(sx)}`, { tags: e.tag(e.mat, 'toecap'), w: 0.004 });
  }
}

/** open sandals / sole + straps (bare foot stays visible) */
export function sandals(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  for (const sx of BOTH) {
    const j = a.side(sx);
    const n = L(sx);
    const sole = new RoundedBox([j.ankle[0], 0.012 * s, (j.heel[2] + j.toeTip[2]) / 2], [a.r.footW * 1.12, 0.012 * s, (j.toeTip[2] - j.heel[2]) / 2 + 0.012 * s], 0.008 * s);
    e.ctx.add(`${e.spec.id}_sole_${n}`, new SmoothIntersect([sole, new HalfSpace([0, 0.0003, 0], [0, -1, 0], 4)], 0.002), `foot_${n}`, { tags: e.tag(e.mat), w: 0.004 });
    for (const [zz, r] of [[j.ball[2] - 0.03 * s, 0.06], [j.ankle[2] + 0.03 * s, 0.07], [j.ankle[2] - 0.01 * s, 0.07]] as [number, number][]) {
      e.ctx.add(`${e.spec.id}_strap${zz.toFixed(2)}_${n}`, new Torus([j.ankle[0], 0.05 * s, zz], a.r.footW * 1.0 + 0.012 * s, 0.006 * s, [0, 0, 1]), `foot_${n}`, { tags: e.tag(e.mat), w: 0.003 });
      void r;
    }
  }
}

/** gloves: hand cover (fingers gloved) + cuff */
export function gloves(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.006) * s;
  for (const sx of BOTH) {
    cover(e, ['palm_', 'palm_heel_', 'knuckles_', 'fingers', 'thumb_'], ext, { filter: (p) => p.name.endsWith(L(sx)), w: 0.004 });
    const env = limbEnv(a, sx, 'arm');
    const cuff = e.n('cuff', 0.16);
    if (cuff > 0) cover(e, ARM.slice(4), ext + 0.003 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, 1 - cuff, 1.0), trim: [slabAxis(env, 1 - cuff, 1 - cuff + 0.015)] });
  }
}

/** scarf: neck wrap + trailing panels on the scarf chain */
export function scarf(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ch = a.layout.scarf;
  const nk = a.neck;
  e.ctx.add(`${e.spec.id}_wrap1`, new Torus([0, nk[1] + 0.045 * s, nk[2] + 0.004 * s], a.r.neck * 1.1 + 0.012 * s, 0.021 * s, [0, 1, 0.12]), 'neck', { tags: e.tag(e.mat), w: 0.008 });
  e.ctx.add(`${e.spec.id}_wrap2`, new Torus([0, nk[1] + 0.02 * s, nk[2]], a.r.neck * 1.14 + 0.02 * s, 0.02 * s, [0, 1, -0.1]), 'neck', { tags: e.tag(e.mat), w: 0.008 });
  if (!ch) return;
  const wid = e.n('width', 0.05) * s;
  ch.bones.forEach((bn, i) => {
    const p0 = ch.pts[i]!, p1 = ch.pts[i + 1]!;
    const taper = 1 - 0.18 * i;
    e.ctx.add(`${e.spec.id}_panel${i}`, flatCone(p0, p1, wid * taper, wid * (taper - 0.1), 0.14, [1, 0, 0].map((x, k) => (k === 0 ? 0 : k === 1 ? 1 : 0)) as Vec3), bn, { tags: e.tag(e.mat, 'strip'), w: 0.006 });
  });
  // trailing second strip (offset sideways)
  ch.bones.forEach((bn, i) => {
    const sh: Vec3 = [0.04 * s, 0.0, 0.0];
    const p0 = vadd(ch.pts[i]!, sh), p1 = vadd(ch.pts[i + 1]!, [0.055 * s, 0, 0]);
    e.ctx.add(`${e.spec.id}_panelB${i}`, flatCone(p0, p1, wid * 0.8, wid * 0.65, 0.14, [0, 1, 0]), bn, { tags: e.tag(e.mat, 'strip'), w: 0.006 });
  });
}

/** cape: yoke over the shoulders + hanging panels on the cape chain */
export function cape(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ch = a.layout.cape;
  const nk = a.neck;
  const wid = e.n('width', 0.2) * s;
  const yoke = new Loft([
    { y: nk[1] - 0.02 * s, rx: 0.17 * s, rz: 0.1 * s, cz: nk[2] - 0.02 * s, n: 2.4 },
    { y: nk[1] - 0.1 * s, rx: 0.2 * s, rz: 0.12 * s, cz: nk[2] - 0.05 * s, n: 2.6 },
  ]);
  e.ctx.add(`${e.spec.id}_yoke`, new SmoothIntersect([yoke, new HalfSpace([0, 0, nk[2] + 0.02 * s], [0, 0, -1], 4)], 0.004), 'chest', { tags: e.tag(e.mat), w: 0.01 });
  if (!ch) return;
  ch.bones.forEach((bn, i) => {
    const p0 = ch.pts[i]!, p1 = ch.pts[i + 1]!;
    const k0 = wid * (1 + 0.28 * i), k1 = wid * (1 + 0.28 * (i + 1));
    e.ctx.add(`${e.spec.id}_panel${i}`, flatCone(p0, p1, k0, k1, 0.05, [0, 0, 1]), bn, { tags: e.tag(e.mat, 'cape'), w: 0.012 });
  });
  const last = ch.pts[ch.pts.length - 1]!;
  e.ctx.mark(`${e.spec.id}_trim_hem`, new SmoothIntersect([flatCone(ch.pts[ch.pts.length - 2]!, last, wid * (1 + 0.28 * (ch.bones.length - 1)) + 0.003, wid * (1 + 0.28 * ch.bones.length) + 0.003, 0.06, [0, 0, 1]), boxClip([0, last[1] + 0.03 * s, last[2]], [1, 0.05 * s, 1])], 0.001), [e.trimTag]);
}

/** tail on the tail chain: furry tapered tube */
export function tail(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ch = a.layout.tail;
  if (!ch) return;
  const r0 = e.n('r', 0.05) * s;
  const segs = tubeSegments(ch.pts, [[0, r0], [0.5, r0 * 0.9], [0.85, r0 * 0.7], [1, r0 * 0.25]], { segments: ch.bones.length * 2 });
  segs.forEach((sg, i) => {
    const bone = ch.bones[Math.min(Math.floor((i / segs.length) * ch.bones.length), ch.bones.length - 1)]!;
    e.ctx.add(`${e.spec.id}_seg${i}`, sg.sdf, bone, { tags: e.tag(e.mat, 'fur', 'tail'), w: 0.02 * s });
  });
  const tip = ch.pts[ch.pts.length - 1]!;
  e.ctx.mark(`${e.spec.id}_tip`, new Ellipsoid(tip, [0.09 * s, 0.09 * s, 0.09 * s]), [e.trimTag]);
}

/** fur mantle: rings of drooping tufts around the shoulders / neck */
export function mantle(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/mantle${e.i}`);
  const rings = e.n('rings', 3);
  const nk = a.neck;
  const spread = e.n('spread', 1);
  const base = e.n('base', 0.2) * s * spread;
  for (let r = 0; r < rings; r++) {
    const count = 15 + r * 4;
    const rad = (0.1 + 0.045 * r) * s * spread + 0.02 * s;
    const y = nk[1] - 0.012 * s - r * 0.045 * s;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1) + r * 0.2;
      const rr = rad * (1 + 0.1 * Math.cos(ang * 2));
      const bx = Math.sin(ang) * rr * 1.0, bz = Math.cos(ang) * rr * 0.72 + nk[2];
      const drop = (0.09 + 0.03 * r) * s * rng.range(0.8, 1.25);
      const out = 0.045 * s * rng.range(0.7, 1.2);
      const b: Vec3 = [bx, y + 0.01 * s, bz];
      const t: Vec3 = [bx * 1.0 + Math.sin(ang) * out, y - drop, bz + Math.cos(ang) * out * 0.8];
      const bone = bx > 0 ? 'clavicle_l' : 'clavicle_r';
      e.ctx.add(`${e.spec.id}_tuft${r}_${i}`, new RoundCone(b, t, 0.027 * s * (1 - 0.1 * r), 0.004 * s), Math.abs(bx) < 0.04 * s ? 'chest' : bone, { tags: e.tag(e.mat, 'fur'), w: 0.012 });
    }
  }
  void base;
}

/** headband / cloth hair-wrap with trailing knot tails */
export function headband(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const y = sk[1] + 0.045 * k;
  e.ctx.add(`${e.spec.id}_ring`, new Torus([sk[0], y, sk[2] - 0.008 * k], 0.094 * k, 0.0105 * k, [0, 1, -0.06]), 'head', { tags: e.tag(e.mat), w: 0.004, grip: 1.5 });
  e.ctx.mark(`${e.spec.id}_trim`, new Torus([sk[0], y, sk[2] - 0.008 * k], 0.094 * k, 0.0125 * k, [0, 1, -0.06]), [e.trimTag]);
  if (e.b('tails', true)) {
    const bone = a.layout.hair ? a.layout.hair.bones[0]! : 'head';
    const base: Vec3 = [0.012 * k, y, sk[2] - 0.098 * k];
    for (const sx of BOTH) {
      e.ctx.add(`${e.spec.id}_tail_${L(sx)}`, flatCone(base, [sx * 0.045 * k, y - 0.17 * k, sk[2] - 0.15 * k], 0.026 * k, 0.02 * k, 0.32, [1, 0, 0]), bone, { tags: e.tag(e.mat), w: 0.006 });
    }
  }
}

/** face mask / veil over the lower face */
export function mask(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const clip = boxClip([sk[0], sk[1] - 0.075 * k, sk[2] + 0.05 * k], [0.2 * k, 0.062 * k, 0.2 * k]);
  cover(e, ['face', 'jaw_', 'jawfill', 'chin', 'cheek_', 'nose_', 'lip_'], e.n('ext', 0.005) * k, { clip, trim: [boxClip([sk[0], sk[1] - 0.0125 * k, sk[2] + 0.05 * k], [0.2 * k, 0.006 * k, 0.2 * k])], w: 0.006 });
}

/** soft hood + cowl: dome around the skull with an open face, falling into a cowl over the shoulders */
export function hood(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const dome = new Ellipsoid([sk[0], sk[1] + 0.008 * k, sk[2] - 0.016 * k], [0.106 * k, 0.122 * k, 0.118 * k]);
  const faceCut = new Ellipsoid([sk[0], sk[1] - 0.034 * k, sk[2] + 0.1 * k], [0.064 * k, 0.082 * k, 0.07 * k]);
  const browCut = new Ellipsoid([sk[0], sk[1] + 0.02 * k, sk[2] + 0.12 * k], [0.07 * k, 0.045 * k, 0.07 * k]);
  const cowl = new Loft([
    { y: sk[1] - 0.04 * k, rx: 0.1 * k, rz: 0.1 * k, cz: sk[2] - 0.016 * k, n: 2 },
    { y: a.neck[1] + 0.01 * k, rx: 0.115 * k + 0.02 * k, rz: 0.1 * k, cz: a.neck[2] - 0.01 * k, n: 2.2 },
    { y: a.neck[1] - 0.06 * k, rx: 0.17 * k, rz: 0.12 * k, cz: a.neck[2] - 0.015 * k, n: 2.4 },
  ]);
  const body = clipMinus(dome, [faceCut, browCut], 0.006);
  e.ctx.add(`${e.spec.id}_dome`, body, 'head', { tags: e.tag(e.mat), w: 0.008, grip: 1.4 });
  const cw = clipMinus(cowl, [new Ellipsoid([sk[0], sk[1] - 0.0 * k, sk[2] + 0.12 * k], [0.14 * k, 0.15 * k, 0.1 * k])], 0.008);
  e.ctx.add(`${e.spec.id}_cowl`, cw, 'neck', { tags: e.tag(e.mat), w: 0.01 });
  e.ctx.mark(`${e.spec.id}_trim`, new SmoothIntersect([dome, new Ellipsoid([sk[0], sk[1] - 0.034 * k, sk[2] + 0.1 * k], [0.072 * k, 0.09 * k, 0.078 * k])], 0.001), [e.trimTag]);
}

/** hanging paper talismans / tassels from the sash */
export function talismans(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const n = e.n('count', 4);
  const y = a.spine[1] + e.n('y', -0.03) * s;
  const front = frontZ(a, y);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = (t - 0.5) * 2.2;
    const px = Math.sin(ang) * (0.15 * s), pz = front * Math.cos(ang) * 0.9 + 0.012 * s;
    const len = (0.1 + 0.03 * ((i * 7) % 3)) * s;
    const p = new Plate({ o: [px, y - 0.022 * s - len * 0.5, pz], nrm: [Math.sin(ang), 0, Math.cos(ang)], up: [0, 1, 0], hu: 0.021 * s, hv: len * 0.5, t: 0.006 * s, round: 0.002, R: 0.0, bow: 0 });
    e.ctx.add(`${e.spec.id}_slip${i}`, p, a.p.rig?.skirt ? 'skirt_f' : 'pelvis', { tags: e.tag(e.mat, 'strip'), w: 0.002 });
    e.ctx.mark(`${e.spec.id}_ink${i}`, new SmoothIntersect([p, boxClip([px, y - 0.022 * s - len * 0.5, pz], [0.012 * s, len * 0.36, 0.05 * s])], 0.001), [e.trimTag]);
  }
}

/** necklace / prayer beads */
export function beads(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const n = e.n('count', 18);
  const nk = a.neck;
  const R = e.n('R', 0.1) * s;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const x = Math.sin(ang) * R, z = Math.cos(ang) * R * 0.8 + nk[2];
    const drop = Math.max(0, Math.cos(ang)) * 0.12 * s;
    e.ctx.add(`${e.spec.id}_bead${i}`, new Ellipsoid([x, nk[1] - 0.025 * s - drop, z + 0.01 * s], [0.0105 * s, 0.0105 * s, 0.0105 * s]), 'chest', { tags: e.tag(e.mat, 'bead'), w: 0.002 });
  }
}

export const SOFT = { tunic, trousers, sash, belt, robe, wraps, boots, sandals, gloves, scarf, cape, tail, mantle, headband, mask, hood, talismans, beads };
void vlerp; void vnorm; void vscale; void vsub; void Plate;
