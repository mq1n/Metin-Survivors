// Hard pieces: plate / lacquer / metal armour built from clipped body offsets and curved plates, plus helms and ornaments.
import { type Vec3, vadd, vdot, vnorm, vscale, vsub } from '../../../core/math.ts';
import type { Sdf } from '../../../core/sdf/node.ts';
import { SmoothIntersect } from '../../../core/sdf/ops.ts';
import { Ellipsoid, HalfSpace, RoundCone, RoundedBox, Torus } from '../../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../../core/sdf/shapes.ts';
import { Loft } from '../kit/loft.ts';
import { limbBand, limbEnv } from '../kit/limbs.ts';
import { Plate } from '../kit/plate.ts';
import type { Side } from '../params.ts';
import { type PieceEnv, boxClip, clipMinus, cover, ridge, slabAxis, slabY } from './util.ts';

const BOTH = [1, -1] as Side[];
const L = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

const sectorAngles = (rigSkirt: boolean, phi: number): string => {
  if (!rigSkirt) return 'pelvis';
  const c = Math.cos(phi), sn = Math.sin(phi);
  if (Math.abs(c) >= Math.abs(sn)) return c > 0 ? 'skirt_f' : 'skirt_b';
  return sn > 0 ? 'skirt_l' : 'skirt_r';
};

/** layered shoulder guard: a convex cap plate over the deltoid plus stacked curved lames wrapping the upper arm (outer/top side) */
export function pauldron(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const lames = e.n('lames', 3);
  const size = e.n('size', 1);
  const spike = e.n('spike', 0);
  const side = e.s('side', 'both');
  for (const sx of BOTH) {
    if (side !== 'both' && side !== L(sx)) continue;
    const n = L(sx);
    const env = limbEnv(a, sx, 'arm');
    const sh = a.side(sx).shoulder;
    const topRaw: Vec3 = vnorm([sx * 0.62, 0.78, -0.02]);
    const normalAt = (u: number): Vec3 => {
      const d = env.dir(u);
      return vnorm(vsub(topRaw, vscale(d, vdot(topRaw, d))));
    };
    // cap
    const capR = env.r(0.05) + 0.02 * size * s;
    const capN = normalAt(0.05);
    const cap = new Plate({ o: vadd(env.at(0.05), vscale(capN, capR)), nrm: capN, up: env.dir(0.05), hu: capR * 1.45, hv: 0.066 * size * s, R: capR, t: 0.015 * s, round: 0.006 * s, edgeThin: 0.65 });
    e.ctx.add(`${e.spec.id}_cap_${n}`, cap, `clavicle_${n}`, { tags: e.tag(e.mat), w: 0.005, grip: 1.6 });
    e.ctx.mark(`${e.spec.id}_capTrim_${n}`, cap.rim(0.009 * s), [e.trimTag]);
    // ridge along the cap crown
    e.ctx.add(`${e.spec.id}_crown_${n}`, new RoundCone(vadd(env.at(-0.02), vscale(capN, capR + 0.012 * s)), vadd(env.at(0.17), vscale(capN, capR + 0.01 * s)), 0.011 * s * size, 0.008 * s * size), `clavicle_${n}`, { tags: e.tag(e.mat), w: 0.005, grip: 1.6 });
    // lames
    for (let i = 0; i < lames; i++) {
      const cu = (0.07 * size * s + i * 0.056 * size * s) / env.len + 0.1;
      const rr = env.r(cu) + (0.012 + 0.0042 * i) * size * s;
      const nn = normalAt(cu);
      const lame = new Plate({ o: vadd(env.at(cu), vscale(nn, rr)), nrm: nn, up: env.dir(cu), hu: rr * (1.38 - 0.1 * i), hv: 0.034 * size * s, R: rr, t: 0.011 * s, round: 0.0045 * s, edgeThin: 0.7 });
      e.ctx.add(`${e.spec.id}_lame${i}_${n}`, lame, env.bone(cu, n), { tags: e.tag(e.mat), w: 0.004, grip: 1.4 });
      e.ctx.mark(`${e.spec.id}_lameTrim${i}_${n}`, lame.rim(0.0075 * s), [e.trimTag]);
    }
    if (spike > 0) {
      const base: Vec3 = vadd(sh, vscale(capN, 0.075 * size * s));
      const tip: Vec3 = vadd(vadd(sh, vscale(capN, (0.075 + 0.17 * spike) * size * s)), [sx * 0.03 * s * spike, 0, -0.02 * s]);
      e.ctx.add(`${e.spec.id}_spike_${n}`, new RoundCone(base, tip, 0.022 * size * s, 0.003 * s), `clavicle_${n}`, { tags: e.tag(e.s('spikeMat', 'gold'), 'horn'), w: 0.008, grip: 1.5 });
    }
  }
}

/** forearm bracer with flared cuff and ridge rings; optional elbow cop */
export function vambrace(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.013) * s;
  const u0 = e.n('from', 0.6);
  for (const sx of BOTH) {
    const n = L(sx);
    const env = limbEnv(a, sx, 'arm');
    const clip = slabAxis(env, u0, 0.97);
    cover(e, ['forearm_', 'flexor_'], ext, { filter: (p) => p.name.endsWith(n), clip, trim: [slabAxis(env, u0, u0 + 0.014), slabAxis(env, 0.955, 0.97)], grip: 1.3, w: 0.005 });
    for (const [u, k] of [[u0 + 0.05, 1], [0.93, 1.35]] as [number, number][]) ridge(e, ['forearm_', 'flexor_'], env, n, u, 0.0055 * s * k, ext + 0.007 * s * k, `_ring${u.toFixed(2)}`);
    // flared cuff over the back of the hand
    const fl = e.n('flare', 1);
    e.ctx.add(`${e.spec.id}_flare_${n}`, limbBand(env, 0.82, 0.995, (u) => ext + 0.004 * s + 0.03 * s * fl * ((u - 0.82) / 0.175) ** 2, { edge: 0.004 }), `forearm_${n}`, { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
    if (e.b('cop', false)) {
      const el = a.side(sx).elbow;
      e.ctx.add(`${e.spec.id}_cop_${n}`, new Ellipsoid(vadd(el, [sx * 0.012 * s, 0.002 * s, -0.026 * s]), [0.034 * s, 0.04 * s, 0.03 * s]), `forearm_${n}`, { tags: e.tag(e.mat), w: 0.006, grip: 1.3 });
    }
  }
}

/** shin guards with a knee cap */
export function greaves(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.014) * s;
  for (const sx of BOTH) {
    const n = L(sx);
    const env = limbEnv(a, sx, 'leg');
    const u0 = env.uMid + 0.06, u1 = 0.93;
    const clip = slabAxis(env, u0, u1);
    cover(e, ['shin_', 'calf_'], ext, { filter: (p) => p.name.endsWith(n), clip, trim: [slabAxis(env, u0, u0 + 0.014), slabAxis(env, u1 - 0.014, u1)], grip: 1.3, w: 0.005 });
    for (const [u, k] of [[u0 + 0.08, 1], [0.8, 1.2]] as [number, number][]) ridge(e, ['shin_', 'calf_'], env, n, u, 0.006 * s * k, ext + 0.007 * s * k, `_ring${u.toFixed(2)}`);
    // knee cop: curved plate on the front of the knee
    const kn = a.side(sx).knee;
    const kp = new Plate({ o: [kn[0], kn[1] + 0.004 * s, kn[2] + a.r.knee * 1.0 + 0.012 * s], nrm: [0, 0.05, 1], up: [0, 1, 0], hu: 0.048 * s * e.n('cop', 1), hv: 0.052 * s * e.n('cop', 1), R: 0.05 * s, t: 0.014 * s, round: 0.005, taper: 0.25 });
    if (e.n('cop', 1) > 0) {
      e.ctx.add(`${e.spec.id}_cop_${n}`, kp, `shin_${n}`, { tags: e.tag(e.mat), w: 0.004, grip: 1.4 });
      e.ctx.mark(`${e.spec.id}_copTrim_${n}`, kp.rim(0.008 * s), [e.trimTag]);
      if (e.n('copSpike', 0) > 0) e.ctx.add(`${e.spec.id}_copSpike_${n}`, new RoundCone([kn[0], kn[1] + 0.004 * s, kn[2] + a.r.knee + 0.025 * s], [kn[0], kn[1] + 0.02 * s, kn[2] + a.r.knee + 0.025 * s + 0.09 * s * e.n('copSpike', 0)], 0.016 * s, 0.002 * s), `shin_${n}`, { tags: e.tag(e.s('spikeMat', 'gold')), w: 0.006, grip: 1.4 });
    }
  }
}

/** thigh guards: front half-shell plates */
export function cuisse(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.014) * s;
  for (const sx of BOTH) {
    const n = L(sx);
    const env = limbEnv(a, sx, 'leg');
    const j = a.side(sx);
    const front = new HalfSpace([0, 0, j.hip[2] + 0.012 * s], [0, 0, -1], 4);
    const clip: Sdf = new SmoothIntersect([slabAxis(env, e.n('from', 0.12), e.n('to', 0.46)), front], 0.002);
    cover(e, ['thigh_', 'quad_'], ext, { filter: (p) => p.name.endsWith(n), clip, trim: [slabAxis(env, e.n('to', 0.46) - 0.014, e.n('to', 0.46))], grip: 1.3, w: 0.005 });
  }
}

/** point on the torso front surface at height y, lateral x (the loft ellipse), pushed out by `ext` */
function torsoFront(parts: { sdf: Sdf }[], x: number, y: number, ext: number): Vec3 {
  for (let z = 0.28; z > -0.1; z -= 0.002) {
    let d = Infinity;
    for (const p of parts) d = Math.min(d, p.sdf.d(x, y, z));
    if (d < ext) return [x, y, z];
  }
  return [x, y, 0];
}

/** breastplate: cover over chest + belly with a scooped neckline and raised rim, optional waist lames, centre ridge, emblem boss and an X harness */
export function cuirass(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.017) * s;
  const style = e.s('style', 'plate');
  const y0 = a.spine[1] + e.n('low', -0.035) * s;
  const yTop = a.torso[a.torso.length - 3]!.y + 0.01 * s;
  const T = new Loft(a.torso);
  const fy = a.chest[1] + 0.02 * s;
  const neck = e.n('neck', 0.55);
  const TORSO = ['torso_', 'pec_', 'lat_', 'abs'];
  const skinParts = e.ctx.body.parts.filter((p) => p.stage === 'base' && p.tags?.includes('skin') && TORSO.some((pre) => p.name.startsWith(pre)));
  const cutFront = torsoFront(skinParts, 0, yTop, ext)[2];
  let clip: Sdf = slabY(y0, yTop + 0.03 * s);
  if (neck > 0) clip = clipMinus(clip, [new Ellipsoid([0, yTop + 0.03 * s, cutFront + 0.012 * s], [(0.062 + 0.03 * neck) * s, (0.05 + 0.1 * neck) * s, 0.1 * s])], 0.012 * s);
  cover(e, TORSO, ext, { clip, trimEdge: 0.011 * s, grip: 1.4, w: 0.006, lip: { h: 0.007 * s, w: 0.015 * s } });
  const pecExt = e.n('pec', 0) * s;
  if (pecExt > 0) cover(e, ['pec_'], ext + pecExt, { clip: new SmoothIntersect([clip, new HalfSpace([0, 0, a.chest[2] + 0.02 * s], [0, 0, -1], 4)], 0.002), name: '_pec', grip: 1.4, w: 0.012 });
  const bands = e.n('bands', 0);
  for (let i = 0; i < bands; i++) {
    const yb = y0 - 0.002 * s - i * 0.034 * s;
    cover(e, ['torso_', 'glute_'], ext + (0.005 - 0.0012 * i) * s, { clip: slabY(yb - 0.036 * s, yb), name: `_band${i}`, trim: [slabY(yb - 0.012 * s, yb)], grip: 1.3, w: 0.005 });
  }
  const front = T.at(fy).cz + T.at(fy).rz + ext;
  if (e.b('ridge', style !== 'leather')) {
    e.ctx.add(`${e.spec.id}_ridge`, new RoundCone([0, a.chest[1] + 0.12 * s, front - 0.004 * s], [0, y0 + 0.02 * s, T.at(y0).cz + T.at(y0).rz + ext - 0.004 * s], 0.011 * s, 0.009 * s), 'chest', { tags: e.tag(e.mat), w: 0.008, grip: 1.4 });
  }
  const emblem = e.n('emblem', 0);
  if (emblem > 0) {
    const ey = a.chest[1] - 0.01 * s;
    const ez = T.at(ey).cz + T.at(ey).rz + ext + 0.012 * s;
    const pl = new Plate({ o: [0, ey, ez], nrm: [0, 0.04, 1], up: [0, 1, 0], hu: 0.055 * s * emblem, hv: 0.05 * s * emblem, R: 0.1 * s, t: 0.014 * s, round: 0.012 * s * emblem });
    e.ctx.add(`${e.spec.id}_emblem`, pl, 'chest', { tags: e.tag(e.s('emblemMat', 'gold'), 'metal'), w: 0.004, grip: 1.4 });
    e.ctx.add(`${e.spec.id}_boss`, new Ellipsoid([0, ey, ez + 0.012 * s], [0.026 * s * emblem, 0.026 * s * emblem, 0.014 * s]), 'chest', { tags: e.tag(e.s('emblemMat', 'gold'), 'metal'), w: 0.006, grip: 1.4 });
    e.ctx.mark(`${e.spec.id}_emblemTrim`, pl.rim(0.008 * s), [e.trimTag]);
  }
  if (e.b('straps', false)) {
    // X harness: two flat straps following the chest surface, crossing over the sternum, with a gold buckle
    const yA = yTop - 0.012 * s, yB = y0 + 0.045 * s;
    const strapMat = e.s('strapMat', e.mat);
    for (const sx of BOTH) {
      const pts: Vec3[] = [];
      const n = 7;
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const x = sx * (0.07 - 0.1 * f) * s * a.b.chest;
        const y = yA + (yB - yA) * f;
        const p = torsoFront(skinParts, x, y, ext + 0.004 * s);
        pts.push(p);
      }
      for (let k = 0; k < n; k++) e.ctx.add(`${e.spec.id}_strap${k}_${L(sx)}`, flatCone(pts[k]!, pts[k + 1]!, 0.017 * s, 0.017 * s, 0.3, [0, 0, 1]), 'chest', { tags: e.tag(strapMat), w: 0.003, grip: 1.3 });
    }
    const bp = torsoFront(skinParts, 0, (yA + yB) / 2 + 0.01 * s, ext + 0.01 * s);
    e.ctx.add(`${e.spec.id}_buckle`, new Ellipsoid(bp, [0.022 * s, 0.022 * s, 0.009 * s]), 'chest', { tags: e.tag('gold', 'metal'), w: 0.003, grip: 1.4 });
  }
}

/** hanging plate skirt (tassets / lamellar) in a ring below the waist, swinging with the skirt sector bones */
export function tassets(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rig = !!a.p.rig?.skirt;
  const len = e.n('len', 0.22) * s;
  const count = e.n('count', 9);
  const flare = e.n('flare', 0.35);
  const rows = e.n('rows', 1);
  const T = new Loft(a.torso);
  const top = a.spine[1] - 0.03 * s;
  const st = T.at(top);
  const hipSt = T.at(a.pelvis[1] - 0.04 * s);
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < count; i++) {
      const phi = ((i + 0.5 * (row % 2)) / count) * Math.PI * 2;
      const cphi = Math.cos(phi), sphi = Math.sin(phi);
      // ellipse radius at this angle (hips are wider than deep)
      const rx = hipSt.rx + (0.012 + 0.012 * row) * s, rz = hipSt.rz + (0.012 + 0.012 * row) * s;
      const r = (rx * rz) / Math.hypot(rz * sphi, rx * cphi);
      const dir: Vec3 = [sphi, 0, cphi];
      const c: Vec3 = [dir[0] * r, top - len * 0.5 * (1 + 0.25 * row), st.cz + dir[2] * r];
      const nrm: Vec3 = vnorm([dir[0], -flare, dir[2]]);
      const arc = ((Math.PI * 2) / count) * r * 0.54;
      const p = new Plate({ o: c, nrm, up: [0, 1, 0], hu: arc, hv: len * 0.5 * (1 + 0.25 * row), R: r * 0.9, t: 0.011 * s, round: 0.0035, taper: -0.1, bow: 0.012 * s });
      const bone = sectorAngles(rig, phi);
      e.ctx.add(`${e.spec.id}_p${row}_${i}`, p, bone, { tags: e.tag(e.mat), w: 0.003, grip: 1.2 });
      e.ctx.mark(`${e.spec.id}_trim${row}_${i}`, p.rim(0.007 * s), [e.trimTag]);
    }
  }
  // waist band holding them
  const band = new Loft(a.torso.map((q) => ({ y: q.y, rx: q.rx + 0.02 * s, rz: q.rz + 0.02 * s, cz: q.cz, n: 2.4 })), { range: [top - 0.012 * s, top + 0.03 * s] });
  e.ctx.add(`${e.spec.id}_band`, band, 'spine', { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
}

/** standing collar / gorget around the neck */
export function collar(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const hgt = e.n('height', 0.06) * s;
  const flare = e.n('flare', 0.02) * s;
  const nk = a.neck;
  const y0 = nk[1] - 0.025 * s;
  const rr = a.r.neck;
  const lo = new Loft([
    { y: y0, rx: rr * 1.5 + 0.03 * s, rz: rr * 1.3 + 0.03 * s, cz: nk[2], n: 2.3 },
    { y: nk[1] + hgt * 0.5, rx: rr * 1.25 + 0.012 * s, rz: rr * 1.2 + 0.012 * s, cz: nk[2], n: 2.2 },
    { y: nk[1] + hgt, rx: rr * 1.12 + 0.014 * s + flare, rz: rr * 1.12 + 0.014 * s + flare, cz: nk[2], n: 2.1 },
  ]);
  const cutter = new Ellipsoid([0, nk[1] + hgt * 0.4, nk[2] + 0.09 * s], [0.04 * s + e.n('open', 0) * 0.03 * s, 0.12 * s, 0.07 * s]);
  const sdf = e.n('open', 0) > 0 ? clipMinus(lo, [cutter], 0.006) : lo;
  e.ctx.add(`${e.spec.id}_collar`, sdf, 'neck', { tags: e.tag(e.mat), w: 0.006, grip: 1.3 });
  e.ctx.mark(`${e.spec.id}_trim`, new SmoothIntersect([lo, boxClip([0, nk[1] + hgt - 0.006 * s, nk[2]], [1, 0.012 * s, 1])], 0.001), [e.trimTag]);
}

/** helmets: 'cap' (skullcap), 'kabuto' (cap + neck guard + cheek plates + crest), 'crown' (circlet with spikes) */
export function helm(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const style = e.s('style', 'kabuto');
  const ext = 0.013 * k;
  const brimY = sk[1] + e.n('brim', 0.02) * k;
  if (style !== 'crown') {
    cover(e, ['cranium'], ext, { clip: boxClip([sk[0], (brimY + sk[1] + 0.2 * k) / 2, sk[2]], [0.3 * k, (sk[1] + 0.2 * k - brimY) / 2, 0.3 * k]), trim: [boxClip([sk[0], brimY + 0.007 * k, sk[2]], [0.3 * k, 0.007 * k, 0.3 * k])], grip: 1.6, w: 0.005 });
    e.ctx.add(`${e.spec.id}_brim`, new Torus([sk[0], brimY + 0.002 * k, sk[2] - 0.012 * k], 0.098 * k, 0.0085 * k, [0, 1, -0.08]), 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
  }
  if (style === 'kabuto') {
    // neck guard: stacked curved plates behind the head
    for (let i = 0; i < 3; i++) {
      const y = brimY - 0.028 * k - i * 0.03 * k;
      const w = (0.092 + 0.012 * i) * k;
      const p = new Plate({ o: [0, y, sk[2] - 0.075 * k - 0.004 * k * i], nrm: [0, -0.06 * (i + 1), -1], up: [0, 1, 0], hu: w * 1.35, hv: 0.02 * k, R: 0.098 * k + 0.008 * k * i, t: 0.008 * k, round: 0.003, bow: 0.006 * k });
      e.ctx.add(`${e.spec.id}_nape${i}`, p, 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
    }
    // cheek guards
    for (const sx of BOTH) {
      const p = new Plate({ o: [sx * 0.092 * k, brimY - 0.06 * k, sk[2] + 0.0 * k], nrm: [sx, -0.05, 0.12], up: [0, 1, 0], hu: 0.045 * k, hv: 0.05 * k, R: 0.07 * k, t: 0.008 * k, round: 0.003, taper: -0.2 });
      e.ctx.add(`${e.spec.id}_cheek_${L(sx)}`, p, 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
      e.ctx.mark(`${e.spec.id}_cheekTrim_${L(sx)}`, p.rim(0.006 * k), [e.trimTag]);
    }
  }
  if (e.b('crest', style === 'kabuto')) {
    const sp = e.n('crestSize', 1);
    // curved horns / crest fan
    for (const sx of BOTH) {
      const base: Vec3 = [sx * 0.035 * k, brimY + 0.07 * k, sk[2] + 0.05 * k];
      const mid: Vec3 = [sx * 0.08 * k * sp, brimY + 0.14 * k * sp, sk[2] + 0.07 * k];
      const tip: Vec3 = [sx * 0.13 * k * sp, brimY + 0.2 * k * sp, sk[2] + 0.02 * k];
      e.ctx.add(`${e.spec.id}_horn_${L(sx)}`, tube([base, mid, tip], [[0, 0.016 * k], [0.6, 0.011 * k], [1, 0.0025 * k]], { segments: 3, w: 0.006 }), 'head', { tags: e.tag(e.s('crestMat', 'gold'), 'horn'), w: 0.006, grip: 1.6 });
    }
    e.ctx.add(`${e.spec.id}_fin`, flatCone([0, brimY + 0.07 * k, sk[2] + 0.03 * k], [0, brimY + 0.16 * k * sp, sk[2] - 0.05 * k], 0.026 * k, 0.012 * k, 0.16, [1, 0, 0]), 'head', { tags: e.tag(e.s('crestMat', 'gold'), 'horn'), w: 0.006, grip: 1.6 });
  }
  if (style === 'crown') {
    const y = sk[1] + 0.055 * k;
    e.ctx.add(`${e.spec.id}_circlet`, new Torus([sk[0], y, sk[2] - 0.006 * k], 0.095 * k, 0.0085 * k, [0, 1, -0.06]), 'head', { tags: e.tag(e.mat, 'metal'), w: 0.003, grip: 1.6 });
    const nsp = e.n('spikes', 7);
    for (let i = 0; i < nsp; i++) {
      const ang = (i / (nsp - 1) - 0.5) * 2.6;
      const bx = Math.sin(ang) * 0.095 * k, bz = sk[2] - 0.006 * k + Math.cos(ang) * 0.095 * k;
      const h = (0.035 + 0.03 * Math.cos(ang * 1.4)) * k * e.n('tall', 1);
      e.ctx.add(`${e.spec.id}_spike${i}`, new RoundCone([bx, y, bz], [bx * 1.02, y + h, bz + Math.cos(ang) * 0.01 * k], 0.0085 * k, 0.0022 * k), 'head', { tags: e.tag(e.mat, 'metal'), w: 0.004, grip: 1.6 });
    }
    e.ctx.mark(`${e.spec.id}_trim`, new Torus([sk[0], y, sk[2] - 0.006 * k], 0.095 * k, 0.0105 * k, [0, 1, -0.06]), [e.trimTag]);
  }
}

/** spiked horns / bone tusks on the head (wolfman, orc-like) */
export function horns(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const len = e.n('len', 1);
  for (const sx of BOTH) {
    const base: Vec3 = [sx * 0.05 * k, sk[1] + 0.085 * k, sk[2] + 0.01 * k];
    const mid: Vec3 = [sx * 0.09 * k, sk[1] + 0.13 * k * len, sk[2] - 0.01 * k];
    const tip: Vec3 = [sx * 0.07 * k, sk[1] + 0.2 * k * len, sk[2] + 0.04 * k];
    e.ctx.add(`${e.spec.id}_horn_${L(sx)}`, tube([base, mid, tip], [[0, 0.02 * k], [0.55, 0.013 * k], [1, 0.003 * k]], { segments: 3, w: 0.006 }), 'head', { tags: e.tag(e.mat, 'horn'), w: 0.008, grip: 1.6 });
  }
}

/** knuckle / back-of-hand plates + wrist guard (gauntlets) */
export function gauntlets(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.01) * s;
  for (const sx of BOTH) {
    const n = L(sx);
    const env = limbEnv(a, sx, 'arm');
    cover(e, ['palm_', 'knuckles_'], ext, { filter: (p) => p.name.endsWith(n), grip: 1.3, w: 0.004 });
    cover(e, ['forearm_', 'flexor_'], ext + 0.004 * s, { filter: (p) => p.name.endsWith(n), clip: slabAxis(env, 0.74, 0.99), trim: [slabAxis(env, 0.74, 0.755), slabAxis(env, 0.975, 0.99)], grip: 1.3, w: 0.005 });
    const j = a.side(sx);
    for (let f = 0; f < 4; f++) {
      const cdir = vnorm(vsub(j.fingerTip, j.wrist));
      const p0 = vadd(j.knuckle, [0, 0, (f - 1.5) * a.r.palmW * 0.485]);
      e.ctx.add(`${e.spec.id}_nk${f}_${n}`, new RoundCone(vadd(p0, vscale(cdir, -0.006 * s)), vadd(p0, vscale(cdir, 0.02 * s)), 0.011 * s, 0.008 * s), `fingers_${n}`, { tags: e.tag(e.mat), w: 0.003, grip: 1.3 });
    }
  }
}

/** a raised ornament plate on the back (banner socket, dragon backpiece) */
export function backpiece(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const T = new Loft(a.torso);
  const y = a.chest[1] + 0.06 * s;
  const z = T.at(y).cz - T.at(y).rz - 0.02 * s;
  const sz = e.n('size', 1);
  const p = new Plate({ o: [0, y + 0.06 * s * sz, z], nrm: [0, 0.08, -1], up: [0, 1, 0], hu: 0.1 * s * sz, hv: 0.12 * s * sz, R: 0.14 * s, t: 0.012 * s, round: 0.004, taper: 0.5 });
  e.ctx.add(`${e.spec.id}_plate`, p, 'chest', { tags: e.tag(e.mat), w: 0.004, grip: 1.4 });
  e.ctx.mark(`${e.spec.id}_trim`, p.rim(0.009 * s), [e.trimTag]);
  const spikes = e.n('spikes', 0);
  for (let i = 0; i < spikes; i++) {
    const t = spikes === 1 ? 0 : (i / (spikes - 1) - 0.5) * 2;
    const base: Vec3 = [t * 0.07 * s * sz, y + 0.17 * s * sz - Math.abs(t) * 0.03 * s, z - 0.005 * s];
    e.ctx.add(`${e.spec.id}_spike${i}`, new RoundCone(base, [t * 0.12 * s * sz, base[1] + (0.12 - 0.04 * Math.abs(t)) * s * sz, z - 0.03 * s], 0.015 * s, 0.002 * s), 'chest', { tags: e.tag(e.s('spikeMat', 'gold'), 'horn'), w: 0.006, grip: 1.4 });
  }
}

export const ARMOR = { pauldron, vambrace, greaves, cuisse, cuirass, tassets, collar, helm, horns, gauntlets, backpiece };
void RoundedBox;
