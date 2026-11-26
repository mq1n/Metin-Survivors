// Yeti: hunched knuckle-walking ape-giant. Hooks for the humanoid pipeline:
//   head      ape head: sloped skull, brow bar, deep tiny eyes, broad flat muzzle, underbite jaw with short tusks
//   afterBody trapezius hump, rigid clenched fists (replace the humanoid hands), and the geometric fur coat:
//             rows of shaggy locks laid over the shoulders, back, arms, legs and head so the silhouette is fur, not a smooth blob.
import { type Vec3, qfromBasis, vadd, vdot, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { pathPoint } from '../../core/sdf/shapes.ts';
import type { Ctx, Side } from '../humanoid/index.ts';
import { Coat, type Ray, spotsOf } from './fur.ts';
import { crystal, el, frame, rbox, rc, surfaceAlong } from './kit.ts';

const DOWN: Vec3 = [0, -1, 0];

export interface YetiOpts {
  /** lock length multiplier (1 = default) */
  furLen?: number;
  /** ring density multiplier */
  furDensity?: number;
  tusks?: boolean;
}

// ------------------------------------------------------------------------------------------------ head

export function yetiHead(opts: YetiOpts = {}): (ctx: Ctx) => void {
  return (ctx) => {
    const a = ctx.a;
    const k = a.s * a.hs;
    const sk = a.skull;
    const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
    const S = (...t: string[]): { tags: string[]; w?: number } => ({ tags: ['skin', 'head', ...t] });
    const B = (...t: string[]): { tags: string[]; w?: number } => ({ tags: ['skin', 'bare', 'head', ...t] });
    // cranium: long, low, with a crest (fur-covered)
    ctx.add('cranium', el(H(0, 0.024, -0.026), [0.09 * k, 0.09 * k, 0.106 * k]), 'head', { ...S('skull'), w: 0.03 });
    ctx.add('crest', el(H(0, 0.072, -0.03), [0.022 * k, 0.034 * k, 0.084 * k]), 'head', { ...S('skull'), w: 0.03 });
    ctx.add('forehead', el(H(0, 0.036, 0.04), [0.072 * k, 0.052 * k, 0.052 * k]), 'head', { ...S('skull'), w: 0.03 });
    // heavy brow bar across the face with swept-back outer ends
    ctx.add('brow_bar', rc(H(-0.054, 0.03, 0.09), H(0.054, 0.03, 0.09), 0.026 * k, 0.026 * k), 'head', { ...B('brow'), w: 0.02 });
    for (const sx of [1, -1] as Side[]) {
      const n = sx === 1 ? 'l' : 'r';
      ctx.add(`brow_${n}`, rc(H(sx * 0.054, 0.03, 0.09), H(sx * 0.09, 0.02, 0.052), 0.026 * k, 0.018 * k), 'head', { ...B('brow'), w: 0.02 });
      ctx.add(`cheek_${n}`, el(H(sx * 0.07, -0.04, 0.05), [0.032 * k, 0.042 * k, 0.048 * k]), 'head', { ...S('cheek'), w: 0.03 });
    }
    // face mass + broad flat muzzle
    ctx.add('face', el(H(0, -0.03, 0.062), [0.07 * k, 0.07 * k, 0.07 * k]), 'head', { ...B('face'), w: 0.03 });
    ctx.add('muzzle', el(H(0, -0.054, 0.1), [0.07 * k, 0.044 * k, 0.042 * k]), 'head', { ...B('muzzle'), w: 0.025 });
    ctx.add('nose', el(H(0, -0.034, 0.134), [0.04 * k, 0.025 * k, 0.02 * k]), 'head', { tags: ['skin', 'bare', 'head', 'nose'], w: 0.015 });
    ctx.add('lip_up', el(H(0, -0.076, 0.124), [0.058 * k, 0.015 * k, 0.026 * k]), 'head', { ...B('lip'), w: 0.012 });
    // underbite jaw
    const chin: Vec3 = H(0, -0.12, 0.1);
    for (const sx of [1, -1] as Side[]) {
      ctx.add(`jaw_${sx === 1 ? 'l' : 'r'}`, rc(H(sx * 0.064, -0.034, -0.03), chin, 0.032 * k, 0.032 * k), 'head', { ...S('jaw'), w: 0.025 });
    }
    ctx.add('chin', el(H(0, -0.112, 0.106), [0.058 * k, 0.036 * k, 0.044 * k]), 'head', { ...B('chin'), w: 0.02 });
    ctx.add('jawfill', el(H(0, -0.07, 0.03), [0.062 * k, 0.05 * k, 0.07 * k]), 'head', { ...S('jaw'), w: 0.03 });
    ctx.add('lip_dn', el(H(0, -0.1, 0.126), [0.046 * k, 0.013 * k, 0.022 * k]), 'head', { ...B('lip'), w: 0.012 });
    ctx.cut('mouth', el(H(0, -0.094, 0.126), [0.056 * k, 0.017 * k, 0.036 * k]), 'head', { tags: ['skin', 'bare', 'head', 'lipline'], w: 0.004 });
    for (const sx of [1, -1] as Side[]) {
      const n = sx === 1 ? 'l' : 'r';
      ctx.cut(`nostril_${n}`, el(H(sx * 0.019, -0.043, 0.148), [0.0092 * k, 0.0066 * k, 0.012 * k]), 'head', { tags: ['skin', 'bare', 'head', 'nostril'], w: 0.004 });
      // tiny deep-set eyes under the brow
      ctx.cut(`socket_${n}`, el(H(sx * 0.038, 0.006, 0.108), [0.028 * k, 0.019 * k, 0.03 * k]), 'head', { tags: ['skin', 'bare', 'head', 'lid'], w: 0.006 });
      ctx.late(`eye_${n}`, el(H(sx * 0.038, 0.006, 0.1), [0.0165 * k, 0.0135 * k, 0.0125 * k]), 'head', { tags: ['eye', 'glow'], w: 0.002 });
      ctx.add(`ear_${n}`, el(H(sx * 0.095, -0.012, -0.012), [0.014 * k, 0.034 * k, 0.026 * k]), 'head', { ...S('ear'), w: 0.015 });
      if (opts.tusks !== false) {
        ctx.late(`tusk_${n}`, rc(H(sx * 0.042, -0.108, 0.13), H(sx * 0.048, -0.05, 0.142), 0.0175 * k, 0.004 * k), 'head', { tags: ['tusk'], w: 0.002 });
        ctx.late(`tooth_up_${n}`, rc(H(sx * 0.016, -0.08, 0.138), H(sx * 0.016, -0.1, 0.139), 0.0095 * k, 0.0045 * k), 'head', { tags: ['tusk'], w: 0.002 });
        ctx.late(`tooth_up2_${n}`, rc(H(sx * 0.038, -0.08, 0.134), H(sx * 0.038, -0.098, 0.135), 0.009 * k, 0.0045 * k), 'head', { tags: ['tusk'], w: 0.002 });
        ctx.late(`tooth_dn_${n}`, rc(H(sx * 0.022, -0.106, 0.134), H(sx * 0.022, -0.09, 0.136), 0.0085 * k, 0.004 * k), 'head', { tags: ['tusk'], w: 0.002 });
      }
    }
  };
}

// ------------------------------------------------------------------------------------------------ fists

/** remove the humanoid hand parts (palm / knuckle / mitten / thumb): the yeti has rigid clenched fists on the wrist bone */
function dropDefaultHands(ctx: Ctx): void {
  ctx.body.parts = ctx.body.parts.filter((p) => !/^(palm|palm_heel|knuckles|mitten|thumb|fingers\d|fingertip\d)_/.test(p.name));
}

/** rigid clenched fist (wrist bone): back of the hand, four fat curled fingers with knuckle bumps, thumb, in the rest-pose hand frame */
function addFist(ctx: Ctx, sx: Side): void {
  const a = ctx.a;
  const j = a.side(sx);
  const n = sx === 1 ? 'l' : 'r';
  const dir = vnorm(vsub(j.fingerTip, j.wrist));
  const hl = vlen(vsub(j.fingerTip, j.wrist));
  const M = frame(dir, [-sx, 0, 0]).x; // palm side (medial)
  const F0 = vnorm(vsub([0, 0, 1], vscale(dir, dir[2])));
  const F = vnorm(vsub(F0, vscale(M, vdot(M, F0)))); // thumb side (forward)
  const s = a.s;
  const w = 0.082 * s; // half width (along F)
  const t = 0.072 * s; // half thickness (along M)
  const at = (u: number, dm = 0, df = 0): Vec3 => [
    j.wrist[0] + dir[0] * hl * u + M[0] * dm + F[0] * df,
    j.wrist[1] + dir[1] * hl * u + M[1] * dm + F[1] * df,
    j.wrist[2] + dir[2] * hl * u + M[2] * dm + F[2] * df,
  ];
  const q = qfromBasis(M, dir, F);
  const W = `wrist_${n}`;
  // wrist pad + back of the hand
  ctx.add(`fist_heel_${n}`, el(at(0.12, 0, 0), [t * 0.95, hl * 0.17, w * 0.85], q), W, { tags: ['skin', 'bare', 'hand'], w: 0.02 });
  ctx.add(`fist_back_${n}`, rbox(at(0.4, -t * 0.28, 0), [t * 0.78, hl * 0.28, w * 0.97], t * 0.5, q), W, { tags: ['skin', 'bare', 'hand'], w: 0.02 });
  // four fat curled fingers: capsules running medially across the lower front, each with a knuckle bump on the back edge
  for (let f = 0; f < 4; f++) {
    const df = (f - 1.5) * w * 0.5;
    const sh = 1 - 0.06 * Math.abs(f - 1.5);
    const r = w * 0.255 * sh;
    ctx.add(`fist_finger${f}_${n}`, rc(at(0.74, -t * 0.5, df), at(0.76, t * 0.82, df * 0.95), r, r * 0.88), W, { tags: ['skin', 'bare', 'hand', 'fingers'], w: 0.008 });
    ctx.add(`fist_knuckle${f}_${n}`, el(at(0.8, -t * 0.62, df), [t * 0.34 * sh, hl * 0.07, w * 0.2], q), W, { tags: ['skin', 'bare', 'hand', 'knuckle'], w: 0.008 });
  }
  // thumb laid across the front of the fingers
  ctx.add(`fist_thumb_${n}`, rc(at(0.28, t * 0.45, w * 0.92), at(0.62, t * 0.9, w * 0.6), t * 0.4, t * 0.3), W, { tags: ['skin', 'bare', 'hand', 'thumb'], w: 0.012 });
}

// ------------------------------------------------------------------------------------------------ body + fur

export function yetiBody(opts: YetiOpts = {}): (ctx: Ctx) => void {
  const kLen = opts.furLen ?? 1;
  const kDens = opts.furDensity ?? 1;
  return (ctx) => {
    const a = ctx.a;
    const s = a.s;
    dropDefaultHands(ctx);
    for (const p of ctx.body.parts) if (/^(heel|midfoot|ball|toes)_[lr]$/.test(p.name)) p.tags = [...(p.tags ?? []), 'bare'];
    // ---- shoulder / trapezius hump: the highest mass of the silhouette, sitting behind the sunk head
    const nk = a.neck, ch = a.chest;
    ctx.add('hump', el([0, nk[1] + 0.05 * s, (nk[2] + ch[2]) * 0.5 - 0.02 * s], [0.2 * s, 0.13 * s, 0.2 * s]), 'chest', { tags: ['skin', 'back'], w: 0.07 });
    ctx.add('nape', el([0, nk[1] + 0.02 * s, nk[2] - 0.06 * s], [0.17 * s, 0.14 * s, 0.15 * s]), 'neck', { tags: ['skin', 'back'], w: 0.05 });
    for (const sx of [1, -1] as Side[]) addFist(ctx, sx);

    // ---- fur coat
    const base = ctx.body.sdf(true);
    const coat = new Coat(ctx, base, new Rng('yeti-fur'), kLen, kDens);
    const cnt = (n: number): number => coat.count(n);

    for (const sx of [1, -1] as Side[]) {
      const n = sx === 1 ? 'l' : 'r';
      const j = a.side(sx);
      // upper arm sleeve: rows get longer toward the elbow
      coat.rings(`ua_${n}`, `upper_arm_${n}`, j.shoulder, j.elbow, sx, [
        { u: 0.16, len: 0.17 * s, w: 0.036 * s }, { u: 0.48, len: 0.19 * s, w: 0.035 * s }, { u: 0.8, len: 0.21 * s, w: 0.034 * s },
      ], 9, 0.34);
      // forearm: long fringe toward the fist
      coat.rings(`fa_${n}`, `forearm_${n}`, j.elbow, j.wrist, sx, [
        { u: 0.18, len: 0.17 * s, w: 0.034 * s }, { u: 0.52, len: 0.19 * s, w: 0.032 * s }, { u: 0.86, len: 0.22 * s, w: 0.031 * s },
      ], 8, 0.34, 0.8, { tags: ['fur', 'furdark'] });
      // thigh + shin
      coat.rings(`th_${n}`, `thigh_${n}`, j.hip, j.knee, sx, [
        { u: 0.12, len: 0.18 * s, w: 0.038 * s }, { u: 0.52, len: 0.19 * s, w: 0.036 * s },
      ], 10, 0.32);
      coat.rings(`sh_${n}`, `shin_${n}`, j.knee, j.ankle, sx, [
        { u: 0.28, len: 0.15 * s, w: 0.032 * s }, { u: 0.8, len: 0.18 * s, w: 0.031 * s },
      ], 8, 0.3, 0.8, { tags: ['fur', 'furdark'] });
      // shoulder mantle: locks draped over the deltoid dome, flowing back and down
      const rays: Ray[] = [];
      for (const el_ of [1.15, 0.7, 0.3]) {
        const m = cnt(el_ > 1 ? 4 : 7);
        for (let i = 0; i < m; i++) {
          const az = -0.5 + (2.9 * (i + 0.5)) / m; // front-outward ... outward ... back
          rays.push({ o: j.shoulder, dir: [sx * Math.cos(az) * Math.cos(el_), Math.sin(el_), -Math.sin(az) * Math.cos(el_)] });
        }
      }
      for (const sp of spotsOf(base, rays)) {
        const g = vnorm(vadd(vadd([sx * 0.2, 0, -0.25], vscale(sp.n, 0.32)), vscale(DOWN, 1.0)));
        coat.lock(`mantle_${n}`, `upper_arm_${n}`, sp, { dir: g, len: 0.17 * s, w: 0.036 * s, curl: 0.9 });
      }
    }

    // torso: rings along the spine path; rays around the (bent) axis
    const path: Vec3[] = [a.pelvis, a.spine, a.chest, [0, nk[1] + 0.02 * s, nk[2] - 0.04 * s]];
    const torsoRows: { t: number; len: number; w: number; count: number }[] = [
      { t: 0.08, len: 0.18 * s, w: 0.04 * s, count: 12 }, { t: 0.3, len: 0.19 * s, w: 0.04 * s, count: 12 },
      { t: 0.5, len: 0.21 * s, w: 0.042 * s, count: 12 }, { t: 0.68, len: 0.22 * s, w: 0.044 * s, count: 12 }, { t: 0.86, len: 0.21 * s, w: 0.044 * s, count: 10 },
    ];
    const torsoBone = (p: Vec3): string => (p[1] < a.spine[1] ? 'pelvis' : p[1] < a.chest[1] ? 'spine' : 'chest');
    torsoRows.forEach((row, ri) => {
      const o = pathPoint(path, row.t);
      const D = vnorm(vsub(pathPoint(path, Math.min(1, row.t + 0.05)), pathPoint(path, Math.max(0, row.t - 0.05))));
      const dors = vnorm([0, D[2], -D[1]]); // up/back side
      const rays: Ray[] = [];
      const c = cnt(row.count);
      for (let i = 0; i < c; i++) {
        const phi = (Math.PI * 2 * (i + 0.5 + (ri % 2) * 0.5)) / c;
        rays.push({ o, dir: [Math.cos(phi), Math.sin(phi) * dors[1], Math.sin(phi) * dors[2]] });
      }
      for (const sp of spotsOf(base, rays)) {
        const g = vnorm(vadd(vadd(vscale(D, -0.6), vscale(sp.n, 0.34)), vscale(DOWN, 0.55)));
        coat.lock('torso', torsoBone, sp, { dir: g, len: row.len * 0.9, w: row.w, curl: 0.95 });
      }
    });

    // head: crest tuft, cheek ruff and a mane swept back over the neck
    const sk = a.skull;
    const k = a.s * a.hs;
    const headRays: Ray[] = [];
    const ho: Vec3 = [sk[0], sk[1] - 0.01 * k, sk[2] - 0.03 * k];
    for (let i = 0; i < 12; i++) {
      const phi = Math.PI * (0.12 + (1.76 * i) / 11); // from the front-left cheek, over the back, to the front-right
      headRays.push({ o: ho, dir: [Math.sin(phi) * 0.95, 0.3 * Math.cos(phi * 2) - 0.1, -Math.cos(phi) * 0.6 + 0.15] });
    }
    for (let i = 0; i < 4; i++) headRays.push({ o: ho, dir: [(i - 1.5) * 0.35, 1, -0.2 + 0.05 * i] }); // crown
    for (const sp of spotsOf(base, headRays)) {
      const g = vnorm(vadd(vadd([0, 0, -0.85], vscale(sp.n, 0.28)), vscale(DOWN, 0.42)));
      coat.lock('mane', 'head', sp, { dir: g, len: 0.17 * s, w: 0.03 * s });
    }

    addIce(ctx, base, new Rng('yeti-ice'));
  };
}

/** the horned / spiked silhouette: two swept ice horns on the skull, crystal spikes over the shoulders and up the hunched back (added after the fur so nothing grows on them) */
function addIce(ctx: Ctx, base: Sdf, rng: Rng): void {
  const a = ctx.a;
  const s = a.s;
  const k = s * a.hs;
  const sk = a.skull;
  const put = (name: string, bone: string, at: Vec3, axis: Vec3, r: number, len: number, tip: number, i: number): void => {
    ctx.add(name, crystal(at, axis, { r, len, tip, twist: i * 0.8, jit: { rng, tilt: 0.07 }, round: 0.0015 }), bone, { tags: ['ice', 'crystal'], w: 0.006, grip: 1.6 });
  };
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    const j = a.side(sx);
    // horns: base on the skull side above the brow, sweeping up-out-back
    put(`horn_${n}`, 'head', [sk[0] + sx * 0.066 * k, sk[1] + 0.07 * k, sk[2] + 0.012 * k], vnorm([sx * 0.62, 0.78, -0.34]), 0.022 * k, 0.085 * k, 0.12 * k, 0);
    put(`horn2_${n}`, 'head', [sk[0] + sx * 0.05 * k, sk[1] + 0.082 * k, sk[2] - 0.05 * k], vnorm([sx * 0.25, 0.8, -0.75]), 0.016 * k, 0.05 * k, 0.08 * k, 1);
    // shoulder crystals fanning up / out / back
    const sh = j.shoulder;
    const S = (x: number, y: number, z: number): Vec3 => [sh[0] + sx * x * s, sh[1] + y * s, sh[2] + z * s];
    put(`shcr_up_${n}`, `clavicle_${n}`, S(0.05, 0.1, -0.03), vnorm([sx * 0.35, 1, -0.3]), 0.034 * s, 0.1 * s, 0.19 * s, 2);
    put(`shcr_out_${n}`, `clavicle_${n}`, S(0.12, 0.07, 0.03), vnorm([sx * 1, 0.55, -0.05]), 0.03 * s, 0.09 * s, 0.16 * s, 3);
    put(`shcr_back_${n}`, `clavicle_${n}`, S(0.06, 0.09, -0.11), vnorm([sx * 0.3, 0.7, -1]), 0.028 * s, 0.08 * s, 0.15 * s, 4);
  }
  // dorsal row over the hump: cast from inside the torso up/back onto the surface
  const nk = a.neck, ch = a.chest;
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const o: Vec3 = [0, ch[1] + (nk[1] - ch[1]) * (0.2 + 0.75 * t) - 0.02 * s, ch[2] + (nk[2] - ch[2]) * (0.2 + 0.75 * t) - 0.05 * s];
    const hit = surfaceAlong(base, o, [0, 0.8, -0.55], 0.6 * s);
    if (!hit) continue;
    const sz = 0.75 + 0.5 * Math.sin(Math.PI * (0.15 + 0.7 * t));
    put(`dorsal_${i}`, 'chest', vsub(hit.p, [0, 0.02 * s, -0.01 * s]), vnorm([0, 1, -0.45 - 0.15 * t]), 0.03 * s * sz, 0.09 * s * sz, 0.17 * s * sz, 5 + i);
  }
}
