// Ice armour for the frost giant: faceted crown/helm, chunky pauldrons, forearm gauntlets, breastplate + collar.
// Everything is built from hewn lumps (`chunk`) and hexagonal crystals (`crystal`) so the surface is planar-faceted, not blobby.
// Parts are tagged 'ice' (paint) and the small glowing gems 'core' (emissive); `grip` keeps the plates rigid on their bone.
import { type Vec3, qfromBasis, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Rng } from '../../core/rng.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import type { Ctx, Side } from '../humanoid/index.ts';
import { chunk, crystal, el, frame, orient, surfaceAlong } from './kit.ts';

const ICE = ['ice'];

/** add one ice part: small blend keeps facets crisp, grip keeps the plate stiff on its bone */
function put(ctx: Ctx, name: string, sdf: Sdf, bone: string, tags: string[] = ICE, w = 0.006): void {
  ctx.add(name, sdf, bone, { tags, w, grip: 1.6 });
}

/** a crystal described relative to an anchor: offset (m), unit-ish axis, apothem / prism length / tip height (m) */
interface Spike {
  at: Vec3;
  axis: Vec3;
  r: number;
  len: number;
  tip: number;
  twist?: number;
}

function spikes(ctx: Ctx, rng: Rng, name: string, bone: string, origin: Vec3, list: Spike[], tags: string[] = ICE): void {
  list.forEach((sp, i) => {
    const base = vadd(origin, sp.at);
    put(ctx, `${name}_${i}`, crystal(base, sp.axis, { r: sp.r, len: sp.len, tip: sp.tip, twist: sp.twist ?? rng.range(0, 1), jit: { rng, tilt: 0.07, off: 0.1 }, taper: 0.1, round: 0.0015 }), bone, tags);
  });
}

/** ice crown / helm: faceted cap over the skull, a brow rim of shards, and a spray of crystal spikes; icicle beard under the chin */
export function addCrown(ctx: Ctx, rng: Rng): void {
  const a = ctx.a;
  const k = a.s * a.hs;
  const sk = a.skull;
  const C: Vec3 = [sk[0], sk[1] + 0.09 * k, sk[2] - 0.022 * k];
  put(ctx, 'helm_cap', chunk(C, [0.103 * k, 0.056 * k, 0.108 * k], rng, { planes: 10, cut: [0.74, 0.92] }), 'head', ['ice', 'helm'], 0.006);
  // brow rim: shards ringing the cap edge (front of the face stays open)
  const rim = 9;
  for (let i = 0; i < rim; i++) {
    const th = Math.PI * (0.62 + (1.76 * i) / (rim - 1)); // from the right temple, over the back, to the left temple (0 = front)
    const x = Math.sin(th) * 0.098 * k, z = Math.cos(th) * 0.106 * k - 0.022 * k;
    const c: Vec3 = [sk[0] + x, sk[1] + 0.066 * k, sk[2] + z];
    put(ctx, `helm_rim_${i}`, chunk(c, [0.032 * k, 0.026 * k, 0.03 * k], rng, { planes: 9, cut: [0.75, 0.95], rot: orient([x, 0.2, z - -0.012 * k]) }), 'head', ['ice', 'helm'], 0.006);
  }
  const O: Vec3 = [sk[0], sk[1], sk[2]];
  const h = (x: number, y: number, z: number): Vec3 => [x * k, y * k, z * k];
  spikes(ctx, rng, 'helm_spike', 'head', O, [
    { at: h(0, 0.1, -0.035), axis: [0, 1, -0.3], r: 0.03 * k, len: 0.1 * k, tip: 0.17 * k },
    { at: h(-0.045, 0.1, -0.005), axis: [-0.32, 1, -0.12], r: 0.025 * k, len: 0.07 * k, tip: 0.12 * k },
    { at: h(0.045, 0.1, -0.005), axis: [0.32, 1, -0.12], r: 0.025 * k, len: 0.07 * k, tip: 0.12 * k },
    { at: h(-0.082, 0.078, -0.025), axis: [-1, 0.55, -0.2], r: 0.021 * k, len: 0.05 * k, tip: 0.1 * k },
    { at: h(0.082, 0.078, -0.025), axis: [1, 0.55, -0.2], r: 0.021 * k, len: 0.05 * k, tip: 0.1 * k },
    { at: h(-0.05, 0.085, -0.08), axis: [-0.3, 0.7, -1], r: 0.022 * k, len: 0.06 * k, tip: 0.11 * k },
    { at: h(0.05, 0.085, -0.08), axis: [0.3, 0.7, -1], r: 0.022 * k, len: 0.06 * k, tip: 0.11 * k },
    { at: h(0, 0.06, 0.1), axis: [0, 0.45, 1], r: 0.016 * k, len: 0.035 * k, tip: 0.07 * k },
  ]);
  // icicle beard + jaw spikes
  spikes(ctx, rng, 'beard', 'head', O, [
    { at: h(0, -0.1, 0.07), axis: [0, -1, 0.25], r: 0.018 * k, len: 0.04 * k, tip: 0.08 * k },
    { at: h(-0.032, -0.092, 0.058), axis: [-0.25, -1, 0.15], r: 0.014 * k, len: 0.03 * k, tip: 0.065 * k },
    { at: h(0.032, -0.092, 0.058), axis: [0.25, -1, 0.15], r: 0.014 * k, len: 0.03 * k, tip: 0.065 * k },
    { at: h(-0.07, -0.06, 0.02), axis: [-1, -0.45, 0.2], r: 0.013 * k, len: 0.025 * k, tip: 0.055 * k },
    { at: h(0.07, -0.06, 0.02), axis: [1, -0.45, 0.2], r: 0.013 * k, len: 0.025 * k, tip: 0.055 * k },
  ]);
}

/** chunky shoulder armour: hewn dome over the deltoid plus a cluster of crystals fanning up / out / back */
export function addPauldron(ctx: Ctx, rng: Rng, sx: Side): void {
  const a = ctx.a;
  const s = a.s;
  const n = sx === 1 ? 'l' : 'r';
  const j = a.side(sx);
  const C: Vec3 = [j.shoulder[0] + sx * 0.03 * s, j.shoulder[1] + 0.04 * s, j.shoulder[2]];
  const tilt = qfromBasis([Math.cos(0.35), -sx * Math.sin(0.35), 0], [sx * Math.sin(0.35), Math.cos(0.35), 0], [0, 0, 1]);
  put(ctx, `pauldron_dome_${n}`, chunk(C, [0.15 * s, 0.105 * s, 0.14 * s], rng, { planes: 9, cut: [0.7, 0.9], rot: tilt }), `clavicle_${n}`, ['ice', 'pauldron'], 0.008);
  put(ctx, `pauldron_lower_${n}`, chunk([C[0] + sx * 0.05 * s, C[1] - 0.085 * s, C[2]], [0.125 * s, 0.085 * s, 0.12 * s], rng, { planes: 8, cut: [0.7, 0.9], rot: tilt }), `upper_arm_${n}`, ['ice', 'pauldron'], 0.008);
  const S = (x: number, y: number, z: number): Vec3 => [sx * x * s, y * s, z * s];
  spikes(ctx, rng, `pauldron_spike_${n}`, `clavicle_${n}`, C, [
    { at: S(0.04, 0.06, -0.01), axis: [sx * 0.3, 1, -0.1], r: 0.04 * s, len: 0.09 * s, tip: 0.13 * s },
    { at: S(0.1, 0.03, 0), axis: [sx * 1, 0.4, -0.1], r: 0.036 * s, len: 0.1 * s, tip: 0.12 * s },
    { at: S(0.0, 0.05, -0.08), axis: [sx * 0.1, 0.75, -1], r: 0.033 * s, len: 0.07 * s, tip: 0.11 * s },
    { at: S(0.05, 0.05, 0.08), axis: [sx * 0.4, 0.85, 0.7], r: 0.028 * s, len: 0.05 * s, tip: 0.09 * s },
    { at: S(0.11, -0.03, -0.06), axis: [sx * 1, 0.1, -0.7], r: 0.026 * s, len: 0.05 * s, tip: 0.09 * s },
  ], ['ice', 'pauldron']);
}

/** forearm gauntlet: a thick hewn sleeve of ice from elbow to wrist with a knuckle guard and crystals along the outer edge */
export function addGauntlet(ctx: Ctx, rng: Rng, sx: Side): void {
  const a = ctx.a;
  const s = a.s;
  const n = sx === 1 ? 'l' : 'r';
  const j = a.side(sx);
  const dir = vnorm(vsub(j.wrist, j.elbow));
  const len = Math.hypot(...vsub(j.wrist, j.elbow));
  const fr = a.r.forearm;
  const fm = frame(dir, [sx, 0, 0]);
  const q = qfromBasis(fm.x, fm.y, fm.z);
  const mid = vlerp(j.elbow, j.wrist, 0.56);
  put(ctx, `gauntlet_${n}`, chunk(mid, [fr * 1.72, len * 0.6, fr * 1.62], rng, { planes: 9, cut: [0.72, 0.92], rot: q }), `forearm_${n}`, ['ice', 'gauntlet'], 0.008);
  // the fist itself is a hewn block of ice (hero shape): wider than the hand, with big knuckle crystals below
  const gd = vadd(j.wrist, vscale(dir, 0.06 * s));
  put(ctx, `gauntlet_fist_${n}`, chunk(gd, [0.125 * s, 0.108 * s, 0.105 * s], rng, { planes: 9, cut: [0.72, 0.92], rot: q }), `wrist_${n}`, ['ice', 'gauntlet'], 0.008);
  // crystals: outer edge pointing out/back, knuckle spikes pointing forward/down
  const out = fm.x;
  const back: Vec3 = [0, 0.15, -1];
  const mk = (u: number, off: number, ax: Vec3, r: number, l: number, t: number): Spike => ({ at: vadd(vsub(vlerp(j.elbow, j.wrist, u), mid), vscale(out, off)), axis: ax, r, len: l, tip: t });
  spikes(ctx, rng, `gauntlet_spike_${n}`, `forearm_${n}`, mid, [
    mk(0.18, fr * 1.5, vadd(vscale(out, 1), vscale(back, 0.6)) as Vec3, 0.03 * s, 0.07 * s, 0.1 * s),
    mk(0.45, fr * 1.5, vadd(vscale(out, 1), vscale(back, 0.8)) as Vec3, 0.034 * s, 0.09 * s, 0.12 * s),
    mk(0.74, fr * 1.45, vadd(vscale(out, 1), vscale(back, 0.5)) as Vec3, 0.028 * s, 0.06 * s, 0.09 * s),
  ], ['ice', 'gauntlet']);
  const kn = vadd(j.wrist, vscale(dir, 0.07 * s));
  spikes(ctx, rng, `gauntlet_knuckle_${n}`, `wrist_${n}`, kn, [
    { at: [0, 0, 0.06 * s], axis: vnorm([sx * 0.1, -0.35, 1]), r: 0.032 * s, len: 0.05 * s, tip: 0.11 * s },
    { at: [sx * 0.06 * s, 0, 0.05 * s], axis: vnorm([sx * 0.55, -0.3, 0.9]), r: 0.027 * s, len: 0.045 * s, tip: 0.09 * s },
    { at: [-sx * 0.06 * s, 0, 0.05 * s], axis: vnorm([-sx * 0.35, -0.3, 1]), r: 0.027 * s, len: 0.045 * s, tip: 0.09 * s },
  ], ['ice', 'gauntlet']);
}

/** breastplate: two pec slabs, a belly row, a crystal keel down the sternum and a spiked collar ring */
export function addBreastplate(ctx: Ctx, rng: Rng): void {
  const a = ctx.a;
  const s = a.s;
  const base = ctx.body.sdf(true);
  const onFront = (x: number, y: number): { p: Vec3; n: Vec3 } | null => {
    const hit = surfaceAlong(base, [x, y, -0.05 * s], [0, 0, 1], 0.6 * s);
    return hit ? { p: hit.p, n: base.grad(hit.p[0], hit.p[1], hit.p[2], 0.012) } : null;
  };
  const yc = a.chest[1];
  const slabs: { x: number; y: number; r: Vec3; name: string }[] = [
    { x: -0.088 * s, y: yc + 0.1 * s, r: [0.1 * s, 0.085 * s, 0.05 * s], name: 'pec_r' },
    { x: 0.088 * s, y: yc + 0.1 * s, r: [0.1 * s, 0.085 * s, 0.05 * s], name: 'pec_l' },
    { x: -0.07 * s, y: yc - 0.06 * s, r: [0.085 * s, 0.07 * s, 0.04 * s], name: 'abs_r' },
    { x: 0.07 * s, y: yc - 0.06 * s, r: [0.085 * s, 0.07 * s, 0.04 * s], name: 'abs_l' },
    { x: 0, y: yc - 0.19 * s, r: [0.1 * s, 0.06 * s, 0.036 * s], name: 'abs_c' },
  ];
  for (const sl of slabs) {
    const hit = onFront(sl.x, sl.y);
    if (!hit) continue;
    const c = vadd(hit.p, vscale(hit.n, sl.r[2] * 0.55));
    put(ctx, `plate_${sl.name}`, chunk(c, sl.r, rng, { planes: 8, cut: [0.72, 0.92], rot: orient(hit.n) }), 'chest', ['ice', 'plate'], 0.008);
  }
  // sternum keel: three stacked crystals
  for (let i = 0; i < 3; i++) {
    const y = yc + (0.18 - i * 0.11) * s;
    const hit = onFront(0, y);
    if (!hit) continue;
    const base0 = vsub(hit.p, vscale(hit.n, 0.01 * s));
    put(ctx, `keel_${i}`, crystal(base0, vnorm(vadd(vscale(hit.n, 1), [0, 0.25 - i * 0.2, 0])), { r: (0.03 - i * 0.004) * s, len: 0.035 * s, tip: (0.07 - i * 0.01) * s, twist: i, jit: { rng, tilt: 0.06 }, round: 0.0015 }), 'chest', ['ice', 'plate']);
  }
  // glowing core gem in the sternum
  const g = onFront(0, yc + 0.04 * s);
  if (g) ctx.late('core_chest', el(vadd(g.p, vscale(g.n, 0.012 * s)), [0.02 * s, 0.028 * s, 0.012 * s]), 'chest', { tags: ['core'], w: 0.002 });
  // collar: crystal ring at the base of the neck
  const nk = a.neck;
  const ring = 9;
  for (let i = 0; i < ring; i++) {
    const th = (Math.PI * 2 * i) / ring + 0.2;
    const ax = vnorm([Math.sin(th) * 0.8, 1.0, Math.cos(th) * 0.8 - 0.1]);
    const sh = (i % 3 === 0 ? 1.25 : 1) * (Math.cos(th) < -0.3 ? 1.2 : 1);
    const c: Vec3 = [nk[0] + Math.sin(th) * 0.115 * s, nk[1] - 0.04 * s, nk[2] + Math.cos(th) * 0.095 * s - 0.01 * s];
    put(ctx, `collar_${i}`, crystal(c, ax, { r: 0.02 * s * sh, len: 0.035 * s * sh, tip: 0.065 * s * sh, twist: i, jit: { rng, tilt: 0.08 }, round: 0.0012 }), 'chest', ['ice', 'plate']);
  }
}
