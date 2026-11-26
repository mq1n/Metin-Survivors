// Nude body: torso (3 skinned loft pieces), arms with muscle masses, hands (palm, finger slab, thumb), legs, feet, head.
// Every part is tagged 'skin' (+ a region tag) so outfit layers can paint over it.
import { type Vec3, vadd, vdist, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Ellipsoid, RoundCone, RoundedBox } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import { smoothUnion } from '../../core/sdf/ops.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { type Ctx, frameBasis, frameQ } from './kit/ctx.ts';
import { Loft } from './kit/loft.ts';
import type { Side } from './params.ts';
import { buildHead } from './head.ts';

const rc = (a: Vec3, b: Vec3, ra: number, rb: number): Sdf => new RoundCone(a, b, ra, rb);
const el = (c: Vec3, r: Vec3, rot?: [number, number, number, number]): Sdf => new Ellipsoid(c, r, rot);

/** point at fraction t of a -> b plus a perpendicular-ish offset in world axes */
const P = (a: Vec3, b: Vec3, t: number, dx = 0, dy = 0, dz = 0): Vec3 => {
  const q = vlerp(a, b, t);
  return [q[0] + dx, q[1] + dy, q[2] + dz];
};

export interface BodyOpts {
  /** replace the default head */
  head?: (ctx: Ctx) => void;
  /** skip the individual fingers and merge the hand into a mitten (crowd LOD) */
  liteHands?: boolean;
}

export function buildBody(ctx: Ctx, opts: BodyOpts = {}): void {
  const a = ctx.a;
  const s = a.s;
  const mus = a.b.muscle;
  const fem = a.fem;
  const SK = (...t: string[]): { tags: string[] } => ({ tags: ['skin', ...t] });

  // ------------------------------------------------------------------ torso
  const T = a.torso;
  const yBot = T[0]!.y, yTop = T[T.length - 1]!.y;
  const ySpine = a.spine[1], yChest = a.chest[1];
  ctx.add('torso_pelvis', new Loft(T, { range: [yBot, ySpine + 0.04 * s], cap: 0.03 * s }), 'pelvis', { ...SK('torso', 'pelvis'), w: 0.02 });
  ctx.add('torso_spine', new Loft(T, { range: [ySpine - 0.05 * s, yChest + 0.045 * s] }), 'spine', { ...SK('torso'), w: 0.02 });
  ctx.add('torso_chest', new Loft(T, { range: [yChest - 0.05 * s, yTop], cap: 0.02 * s }), 'chest', { ...SK('torso', 'chest'), w: 0.02 });

  // glutes + groin mass
  ctx.both('glute', (sx) => el([sx * 0.07 * s, a.pelvis[1] - 0.045 * s, -0.062 * s], [0.082 * s, 0.085 * s, 0.075 * s]), 'pelvis', { ...SK('glute'), w: 0.04 });
  // pectorals (male: heavy plates, female: bust)
  const pecK = (1 - fem) * (0.7 + 0.6 * mus) + fem * (0.35 + 0.8 * a.b.bust);
  ctx.both('pec', (sx) => el(
    [sx * 0.078 * s * (1 - 0.1 * fem), yChest + (0.085 - 0.012 * fem) * s, a.chest[2] + (0.082 + 0.012 * fem * a.b.bust) * s],
    [0.088 * s * (0.8 + 0.25 * pecK), (0.066 - 0.01 * fem) * s * (0.8 + 0.2 * pecK), (0.046 + 0.012 * pecK + 0.02 * fem * a.b.bust) * s],
  ), 'chest', { ...SK('pec'), w: 0.04 });
  // lats / back mass and trapezius
  ctx.both('lat', (sx) => el([sx * 0.125 * s * a.b.chest, yChest + 0.0 * s, a.chest[2] - 0.05 * s], [0.06 * s, 0.11 * s, 0.05 * s * (0.7 + 0.4 * mus)]), 'chest', { ...SK('back'), w: 0.04 });
  ctx.both('trap', (sx) => rc([sx * 0.025 * s, a.neck[1] + 0.012 * s, a.neck[2] - 0.004 * s], [sx * 0.135 * s * a.b.shoulder, a.neck[1] - 0.02 * s, a.neck[2] - 0.006 * s], 0.038 * s * (0.8 + 0.4 * mus), 0.034 * s), 'chest', { ...SK('trap'), w: 0.04 });
  // abs hint (male)
  if (!fem) ctx.add('abs', el([0, a.spine[1] + 0.02 * s, a.spine[2] + 0.088 * s], [0.058 * s, 0.1 * s, 0.03 * s * (0.6 + 0.6 * mus)]), 'spine', { ...SK('torso'), w: 0.04 });

  // ------------------------------------------------------------------ neck
  const neckTop: Vec3 = [0, a.head[1] + 0.012 * s, a.head[2] - 0.004 * s];
  ctx.add('neck', tube([a.neck, P(a.neck, neckTop, 0.5, 0, 0, 0.006 * s), neckTop], [[0, a.r.neck * 1.12], [0.5, a.r.neck * 0.98], [1, a.r.neck * 0.92]], { segments: 3, w: 0.02 * s }), 'neck', { ...SK('neck'), w: 0.04 });

  // ------------------------------------------------------------------ arms
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    const j = a.side(sx);
    // clavicle + deltoid
    ctx.add(`clavicle_${n}`, rc([sx * 0.02 * s, j.clav[1] - 0.004 * s, j.clav[2] + 0.02 * s], [j.shoulder[0] - sx * 0.03 * s, j.shoulder[1] + 0.012 * s, j.shoulder[2] + 0.012 * s], 0.017 * s, 0.021 * s), `clavicle_${n}`, { ...SK('clavicle'), w: 0.03 });
    const dr = 0.056 * s * (1 + 0.28 * mus) * a.b.arms;
    ctx.add(`delt_${n}`, el([j.shoulder[0] + sx * 0.008 * s, j.shoulder[1] - 0.012 * s, j.shoulder[2] + 0.002 * s], [dr * 1.02, dr * 1.28, dr * 1.1]), `upper_arm_${n}`, { ...SK('delt'), w: 0.045 });
    // upper arm tube
    const ur = a.r.upperArm;
    ctx.add(`upper_arm_${n}`, tube([j.shoulder, vlerp(j.shoulder, j.elbow, 0.5), j.elbow], [[0, ur * 1.04], [0.3, ur * 1.1], [0.7, ur * 0.94], [1, a.r.elbow * 1.0]], { segments: 5, w: 0.02 * s }), `upper_arm_${n}`, { ...SK('arm'), w: 0.04 });
    // biceps (front) / triceps (back)
    const ua = vnorm(vsub(j.elbow, j.shoulder));
    const uaMid = vlerp(j.shoulder, j.elbow, 0.38);
    const uq = frameQ(ua, [sx, 0, 0]);
    ctx.add(`biceps_${n}`, new Ellipsoid(vadd(uaMid, [0, 0, 0.026 * s * (0.6 + 0.6 * mus)]), [ur * 0.82, 0.075 * s * a.b.arms, ur * 0.84 * (0.7 + 0.5 * mus)], uq), `upper_arm_${n}`, { ...SK('arm'), w: 0.035 });
    ctx.add(`triceps_${n}`, new Ellipsoid(vadd(P(j.shoulder, j.elbow, 0.45), [sx * 0.004 * s, 0, -0.026 * s * (0.6 + 0.6 * mus)]), [ur * 0.8, 0.075 * s * a.b.arms, ur * 0.82 * (0.7 + 0.5 * mus)], uq), `upper_arm_${n}`, { ...SK('arm'), w: 0.035 });
    // elbow
    ctx.add(`elbow_${n}`, new Ellipsoid(vadd(j.elbow, [0, 0, -0.006 * s]), [a.r.elbow * 1.0, a.r.elbow * 1.06, a.r.elbow * 1.06]), `forearm_${n}`, { ...SK('elbow'), w: 0.03 });
    // forearm
    const fr = a.r.forearm;
    ctx.add(`forearm_${n}`, tube([j.elbow, vlerp(j.elbow, j.wrist, 0.45), j.wrist], [[0, fr * 1.0], [0.2, fr * 1.12], [0.62, fr * 0.8], [1, a.r.wrist * 1.0]], { segments: 5, w: 0.02 * s }), `forearm_${n}`, { ...SK('forearm'), w: 0.04 });
    const fa = vnorm(vsub(j.wrist, j.elbow));
    const fq = frameQ(fa, [sx, 0, 0]);
    ctx.add(`flexor_${n}`, new Ellipsoid(vadd(P(j.elbow, j.wrist, 0.26), [-sx * 0.01 * s, 0, 0.008 * s]), [fr * 0.9, 0.07 * s, fr * 0.95 * (0.8 + 0.3 * mus)], fq), `forearm_${n}`, { ...SK('forearm'), w: 0.035 });
    buildHand(ctx, sx, !!opts.liteHands);
  }

  // ------------------------------------------------------------------ legs
  for (const sx of [1, -1] as Side[]) {
    const n = sx === 1 ? 'l' : 'r';
    const j = a.side(sx);
    const tr = a.r.thigh;
    const thighMid: Vec3 = P(j.hip, j.knee, 0.5, 0, 0, 0.012 * s);
    ctx.add(`thigh_${n}`, tube([vadd(j.hip, [0, 0.005 * s, 0]), thighMid, j.knee], [[0, tr * 0.98], [0.28, tr * 1.04], [0.7, tr * 0.8], [1, a.r.knee * 1.02]], { segments: 6, w: 0.025 * s }), `thigh_${n}`, { ...SK('leg'), w: 0.05 });
    const tq = frameQ(vsub(j.knee, j.hip), [sx, 0, 0]);
    ctx.add(`quad_${n}`, new Ellipsoid(vadd(P(j.hip, j.knee, 0.42), [0, 0, 0.026 * s]), [tr * 0.82, 0.14 * s, tr * 0.9 * (0.78 + 0.25 * mus)], tq), `thigh_${n}`, { ...SK('leg'), w: 0.04 });
    ctx.add(`ham_${n}`, new Ellipsoid(vadd(P(j.hip, j.knee, 0.38), [0, 0, -0.03 * s]), [tr * 0.8, 0.13 * s, tr * 0.78], tq), `thigh_${n}`, { ...SK('leg'), w: 0.04 });
    // knee: rounded joint block + kneecap
    ctx.add(`knee_${n}`, new Ellipsoid(vadd(j.knee, [0, 0.004 * s, 0.006 * s]), [a.r.knee * 0.98, a.r.knee * 1.08, a.r.knee * 1.05]), `shin_${n}`, { ...SK('knee'), w: 0.03 });
    ctx.add(`kneecap_${n}`, el(vadd(j.knee, [0, 0.004 * s, a.r.knee * 0.98]), [0.027 * s, 0.032 * s, 0.022 * s]), `shin_${n}`, { ...SK('knee'), w: 0.02 });
    // shin + calf
    const cr = a.r.calf;
    const shinMid: Vec3 = P(j.knee, j.ankle, 0.5, 0, 0, 0.004 * s);
    ctx.add(`shin_${n}`, tube([j.knee, shinMid, j.ankle], [[0, a.r.knee * 0.95], [0.25, cr * 0.95], [0.6, cr * 0.7], [1, a.r.ankle * 1.0]], { segments: 5, w: 0.02 * s }), `shin_${n}`, { ...SK('leg'), w: 0.04 });
    const sq = frameQ(vsub(j.ankle, j.knee), [sx, 0, 0]);
    ctx.add(`calf_${n}`, new Ellipsoid(vadd(P(j.knee, j.ankle, 0.3), [sx * -0.004 * s, 0, -0.026 * s]), [cr * 0.88, 0.115 * s, cr * 0.95 * (0.8 + 0.3 * mus)], sq), `shin_${n}`, { ...SK('leg', 'calf'), w: 0.04 });
    // foot
    buildFoot(ctx, sx);
  }

  (opts.head ?? buildHead)(ctx);
}

/** hand: palm block, relaxed finger slab (3 segments curling toward the palm), fingertips, thumb, region marks for the finger gaps */
function buildHand(ctx: Ctx, sx: Side, lite: boolean): void {
  const a = ctx.a;
  const n = sx === 1 ? 'l' : 'r';
  const j = a.side(sx);
  const dir = vnorm(vsub(j.fingerTip, j.wrist));
  const hl = vdist(j.fingerTip, j.wrist);
  const k = hl / 0.185;
  // orthonormal hand frame: dir (fingers), M (palm normal, medial), F (thumb side, always world-forward)
  const M = vnorm(vsub([-sx, 0, 0], vscale(dir, -sx * dir[0])));
  const F = vnorm(vsub([0, 0, 1], vadd(vscale(dir, dir[2]), vscale(M, M[2]))));
  const at = (t: number, dm = 0, df = 0): Vec3 => [
    j.wrist[0] + dir[0] * hl * t + M[0] * dm + F[0] * df,
    j.wrist[1] + dir[1] * hl * t + M[1] * dm + F[1] * df,
    j.wrist[2] + dir[2] * hl * t + M[2] * dm + F[2] * df,
  ];
  const hw = a.r.palmW, ht = a.r.palmT;
  const q = frameQ(dir, M);
  // palm (wrist bone) and heel of the hand
  ctx.add(`palm_${n}`, new RoundedBox(at(0.3, 0, 0), [ht * 1.05, hl * 0.21, hw * 0.98], hw * 0.4, q), `wrist_${n}`, { tags: ['skin', 'hand'], w: 0.03 });
  ctx.add(`palm_heel_${n}`, new Ellipsoid(at(0.16, ht * 0.25, 0), [ht * 1.0, hl * 0.13, hw * 0.88], q), `wrist_${n}`, { tags: ['skin', 'hand'], w: 0.03 });
  ctx.add(`knuckles_${n}`, new Ellipsoid(at(0.5, -ht * 0.35, 0), [ht * 0.85, hl * 0.055, hw * 0.98], q), `fingers_${n}`, { tags: ['skin', 'hand'], w: 0.02 });
  if (lite) {
    // mitten: one tapered block for the fingers, a stub thumb
    const k0 = vlerp(at(0.55, ht * 0.4, 0), at(0.9, ht * 1.6, 0), 0.5);
    ctx.add(`mitten_${n}`, new RoundedBox(k0, [ht * 0.85, hl * 0.2, hw * 0.95], ht * 0.8, frameQ(dir, M)), `fingers_${n}`, { tags: ['skin', 'hand', 'fingers'], w: 0.012 });
    ctx.add(`thumb_${n}`, rc(at(0.2, ht * 0.3, hw * 0.75), at(0.42, ht * 1.8, hw * 1.1), hw * 0.32, hw * 0.24), `thumb_${n}`, { tags: ['skin', 'hand', 'thumb'], w: 0.02 });
    return;
  }
  // finger slab: 3 phalanx blocks, each rotated further toward the palm (relaxed half-fist)
  const lens = [0.046 * k, 0.03 * k, 0.026 * k];
  const th = [0.28, 0.95, 1.6];
  let cur = at(0.5, ht * 0.1, 0);
  const joints: Vec3[] = [cur];
  lens.forEach((len, i) => {
    const c = Math.cos(th[i]!), sn = Math.sin(th[i]!);
    const d: Vec3 = [dir[0] * c + M[0] * sn, dir[1] * c + M[1] * sn, dir[2] * c + M[2] * sn];
    const mid = vadd(cur, vscale(d, len * 0.5));
    const r: Vec3 = [ht * (0.85 - 0.05 * i), len * 0.58, hw * (0.97 - 0.04 * i)];
    ctx.add(`fingers${i}_${n}`, new RoundedBox(mid, r, Math.min(r[0], r[2]) * 0.85, frameQ(d, M)), `fingers_${n}`, { tags: ['skin', 'hand', 'fingers'], w: 0.012 });
    cur = vadd(cur, vscale(d, len));
    joints.push(cur);
  });
  const endD = vnorm(vsub(joints[3]!, joints[2]!));
  for (let f = 0; f < 4; f++) {
    const df = (f - 1.5) * hw * 0.485;
    const base: Vec3 = vadd(vsub(joints[2]!, vscale(endD, 0.004 * k)), vscale(F, df));
    const tip: Vec3 = vadd(vadd(joints[3]!, vscale(endD, 0.004 * k)), vscale(F, df));
    ctx.add(`fingertip${f}_${n}`, rc(base, tip, hw * 0.225, hw * 0.2), `fingers_${n}`, { tags: ['skin', 'hand', 'fingers', 'nail'], w: 0.008 });
  }
  // thumb: base on the forward side of the palm, tip curled over the index finger
  const tb = at(0.17, ht * 0.3, hw * 0.75);
  const tm = at(0.32, ht * 1.3, hw * 1.12);
  const tt = at(0.48, ht * 2.4, hw * 1.1);
  ctx.add(`thumb_${n}`, tube([tb, tm, tt], [[0, hw * 0.34], [0.5, hw * 0.29], [1, hw * 0.25]], { segments: 3, w: 0.01 }), `thumb_${n}`, { tags: ['skin', 'hand', 'thumb'], w: 0.02 });
  ctx.add(`thumbnail_${n}`, el(vadd(tt, vscale(F, 0.002)), [hw * 0.2, hw * 0.2, hw * 0.2]), `thumb_${n}`, { tags: ['skin', 'hand', 'thumb', 'nail'], w: 0.006 });
  // finger gap marks (paint only) along the back of the finger slab
  for (let g = 0; g < 3; g++) {
    const df = (g - 1) * hw * 0.485;
    const pts = joints.map((p) => vadd(vsub(p, vscale(M, ht * 0.8)), vscale(F, df)));
    ctx.mark(`gap${g}_${n}`, tube(pts, [[0, 0.0018], [1, 0.0018]], { segments: 3, w: 0.002 }), ['fingergap']);
  }
}

function buildFoot(ctx: Ctx, sx: Side): void {
  const a = ctx.a;
  const s = a.s;
  const n = sx === 1 ? 'l' : 'r';
  const j = a.side(sx);
  const fw = a.r.footW;
  const ank = j.ankle;
  // heel + ankle block (foot bone)
  ctx.add(`heel_${n}`, el([ank[0], 0.05 * s, ank[2] - 0.026 * s], [fw * 0.78, 0.05 * s, 0.05 * s]), `foot_${n}`, { tags: ['skin', 'foot'], w: 0.03 });
  ctx.add(`ankle_${n}`, el([ank[0], ank[1] + 0.005 * s, ank[2]], [a.r.ankle * 1.08, a.r.ankle * 1.12, a.r.ankle * 1.1]), `foot_${n}`, { tags: ['skin', 'foot'], w: 0.03 });
  ctx.add(`midfoot_${n}`, rc([ank[0], 0.06 * s, ank[2] + 0.02 * s], [j.ball[0], 0.045 * s, j.ball[2] - 0.035 * s], fw * 0.72, fw * 0.8), `foot_${n}`, { tags: ['skin', 'foot'], w: 0.03 });
  // forefoot / toes (toe bone)
  ctx.add(`ball_${n}`, el([j.ball[0], 0.03 * s, j.ball[2] - 0.004 * s], [fw * 0.98, 0.028 * s, 0.05 * s]), `toe_${n}`, { tags: ['skin', 'foot', 'toes'], w: 0.025 });
  ctx.add(`toes_${n}`, el([j.ball[0] + sx * 0.003 * s, 0.022 * s, (j.ball[2] + j.toeTip[2]) * 0.5 + 0.006 * s], [fw * 0.9, 0.02 * s, (j.toeTip[2] - j.ball[2]) * 0.5 + 0.02 * s]), `toe_${n}`, { tags: ['skin', 'foot', 'toes'], w: 0.02 });
  void smoothUnion;
  void vscale;
}
