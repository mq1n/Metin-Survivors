// Custom gear for the barbarian: horned bone cap + beard, fur mantle / shoulder pad / back pelt, rib-cage chest armour, a bone
// pauldron with horn spikes, spiked bracers, fur kilt with trophies, fur-cuffed boots, hump / jaw tusks, clay war paint.
// Design rule: at <= 5k tris a piece is either a BOLD simple form or it turns to polygon soup after decimation, so fur is a few chunky
// locks on a solid base, never dozens of tufts. Built in the model's `afterBody` / `afterOutfit` hooks; paint pieces are reserved with
// `ctx.piece(mat)` (one material per piece). World rest-pose metres, +Z forward, +X = left; sizes = reference metres x body scale.
import { type Vec3, vadd, vdot, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { type Ctx, Loft, Plate, boxClip, cover, limbEnv, makeEnv } from '../humanoid/index.ts';
import { handRef, hp, rigid } from '../humans/kit.ts';
import { curve, hornSdf, normalAt, ringPoint, skinProbe, spikeSdf, surfaceAlong, tuftSdf } from './barbarian-kit.ts';

const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

/**
 * Paint tags of every fur piece of the current build. Fur uses the material families `pelt` / `pelt2` (not `fur`: the shared humanoid
 * `fur` paint adds UNMASKED voronoi clumps that pebble the whole albedo); the model's paint hook adds masked strand layers over these tags.
 */
export const FUR_TAGS: string[] = [];
function furPiece(ctx: Ctx, mat: 'pelt' | 'pelt2'): { i: number; tag: string; trimTag: string } {
  const p = ctx.piece(mat, { trim: 'none' });
  FUR_TAGS.push(p.tag);
  return p;
}

// ------------------------------------------------------------------------------------------------ body additions (afterBody)
/** bunched trapezius hump behind the neck (the hunch reads in silhouette) + tusks jutting up from the lower jaw */
export function addBeastBody(ctx: Ctx, o: { hump?: number; tusks?: boolean } = {}): void {
  const a = ctx.a, s = a.s, nk = a.neck;
  FUR_TAGS.length = 0;
  const hk = o.hump ?? 1;
  ctx.add('hump', new Ellipsoid([0, nk[1] - 0.05 * s, nk[2] - 0.07 * s], [0.185 * s * hk, 0.115 * s * hk, 0.12 * s * hk]), 'chest', { tags: ['skin', 'back'], w: 0.07 });
  if (o.tusks !== false) {
    const k = s * a.hs, sk = a.skull;
    const bone = ctx.piece('bone', { trim: 'none' });
    const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
    for (const sx of BOTH) {
      ctx.late(`tusk_${L(sx)}`, hornSdf([H(sx * 0.031, -0.079, 0.078), H(sx * 0.036, -0.068, 0.097), H(sx * 0.031, -0.043, 0.109), H(sx * 0.027, -0.022, 0.106)], 0.0125 * k, 0.003 * k, 3), 'head', { tags: [bone.tag], w: 0.003 });
    }
  }
}

// ------------------------------------------------------------------------------------------------ head gear
/** horned bone skull-cap: dome over the cranium, fat fur-trimmed brow band, two thick curved horns */
export function addBoneHelm(ctx: Ctx, o: { horn?: number } = {}): void {
  const a = ctx.a, k = a.s * a.hs, sk = a.skull;
  const hk = o.horn ?? 1;
  const bone = ctx.piece('bone', { trim: 'none' });
  const cap = ctx.piece('plate', { trim: 'none' });
  const furA = furPiece(ctx, 'pelt');
  const band = ctx.piece('leather2', { trim: 'none' });
  const e = makeEnv(ctx, { id: 'bhelm', mat: 'plate' }, cap.i, 'plate');
  const bandY = sk[1] + 0.06 * k;
  cover(e, ['cranium'], 0.017 * k, {
    clip: boxClip([sk[0], (bandY + sk[1] + 0.25 * k) / 2, sk[2]], [0.3 * k, (sk[1] + 0.25 * k - bandY) / 2, 0.3 * k]), grip: 1.6, w: 0.006,
  });
  // fur trim: one fat ring round the rim (tilted a little up at the front so the brow stays free), leather strap below it
  ctx.add('helm_fur', new Torus([sk[0], bandY - 0.004 * k, sk[2] - 0.012 * k], 0.104 * k, 0.021 * k, [0, 1, -0.1]), 'head', { tags: [furA.tag], w: 0.006, grip: 1.6 });
  ctx.add('helm_strap', new Torus([sk[0], bandY - 0.022 * k, sk[2] - 0.012 * k], 0.098 * k, 0.0095 * k, [0, 1, -0.1]), 'head', { tags: [band.tag], w: 0.003, grip: 1.6 });
  // nasal boss: a small bone knob on the brow band
  ctx.add('helm_boss', new Ellipsoid([sk[0], bandY + 0.002 * k, sk[2] + 0.108 * k], [0.026 * k, 0.022 * k, 0.014 * k]), 'head', { tags: [bone.tag], w: 0.005, grip: 1.6 });
  // horns: out, forward and up like a bull's, thick at the root
  for (const sx of BOTH) {
    const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + sx * dx * k, sk[1] + dy * k, sk[2] + dz * k];
    const path = [H(0.066, 0.074, -0.014), H(0.122, 0.082, -0.01), H(0.174, 0.102, 0.006), H(0.2 * hk, 0.15 * hk, 0.03), H(0.194 * hk, 0.212 * hk, 0.054), H(0.166 * hk, 0.262 * hk, 0.07)];
    ctx.add(`helm_horn_${L(sx)}`, hornSdf(path, 0.038 * k, 0.0085 * k, 8), 'head', { tags: [bone.tag, 'hornTip'], w: 0.008, grip: 1.6 });
  }
}

/** one solid beard mass forking into two thick braids, a drooping moustache */
export function addBeardAndMane(ctx: Ctx): void {
  const a = ctx.a, k = a.s * a.hs, sk = a.skull;
  const hair = ctx.piece('hair', { trim: 'none' });
  const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
  const e = makeEnv(ctx, { id: 'bbeard', mat: 'hair' }, hair.i, 'hair');
  // beard growth over the lower jaw (the mouth stays free)
  cover(e, ['jaw_', 'chin', 'jawfill'], 0.011 * k, { clip: boxClip(H(0, -0.125, 0.04), [0.2 * k, 0.055 * k, 0.2 * k]), name: '_jaw', w: 0.008, grip: 1.4 });
  ctx.add('beard_mass', new Ellipsoid(H(0, -0.122, 0.046), [0.062 * k, 0.046 * k, 0.046 * k]), 'head', { tags: [hair.tag], w: 0.012, grip: 1.4 });
  for (const sx of BOTH) {
    ctx.add(`beard_fork_${L(sx)}`, curve([H(sx * 0.03, -0.13, 0.05), H(sx * 0.042, -0.17, 0.064), H(sx * 0.046, -0.21, 0.068), H(sx * 0.04, -0.245, 0.062)], 0.04 * k, 0.013 * k, 4), 'head', { tags: [hair.tag], w: 0.012, grip: 1.4 });
    ctx.add(`must_${L(sx)}`, curve([H(sx * 0.004, -0.043, 0.097), H(sx * 0.03, -0.052, 0.094), H(sx * 0.052, -0.073, 0.082), H(sx * 0.058, -0.108, 0.072)], 0.0165 * k, 0.0065 * k, 3), 'head', { tags: [hair.tag], w: 0.006, grip: 1.4 });
  }
}

// ------------------------------------------------------------------------------------------------ chest
/** rib-cage armour: a segmented bone sternum plate and curved bone ribs wrapping the flanks, riding on the real muscle surface */
export function addRibArmor(ctx: Ctx): void {
  const a = ctx.a, s = a.s;
  const bone = ctx.piece('bone', { trim: 'none' });
  const probe = skinProbe(ctx);
  const T = new Loft(a.torso);
  const cy = a.chest[1];
  const ribs = [
    { dy: 0.112, end: 1.2, drop: 0.03, r: 0.0165 },
    { dy: 0.056, end: 1.5, drop: 0.042, r: 0.0175 },
    { dy: 0.0, end: 1.72, drop: 0.05, r: 0.0178 },
    { dy: -0.056, end: 1.86, drop: 0.054, r: 0.0175 },
    { dy: -0.112, end: 1.9, drop: 0.05, r: 0.0165 },
  ];
  const N = 7;
  for (const [ri, rb] of ribs.entries()) {
    for (const sx of BOTH) {
      const y0 = cy + rb.dy * s;
      const pts: Vec3[] = [];
      for (let q = 0; q <= N; q++) {
        const u = q / N;
        const phi = 0.17 + (rb.end - 0.17) * u;
        const y = y0 - rb.drop * s * u ** 1.3;
        const st = T.at(y);
        pts.push(surfaceAlong(probe, [st.cx, y, st.cz], [sx * Math.sin(phi), 0, Math.cos(phi)], 0.0135 * s));
      }
      const bn = y0 > a.spine[1] + 0.07 * s ? 'chest' : 'spine';
      ctx.add(`rib${ri}_${L(sx)}`, curve(pts, rb.r * s, 0.0125 * s, N), bn, { tags: [bone.tag], w: 0.008, grip: 1.4 });
    }
  }
  // sternum: three stacked plates (manubrium, body, xiphoid) following the chest curve
  const seg: { dy: number; hv: number; hu: number }[] = [{ dy: 0.14, hv: 0.045, hu: 0.04 }, { dy: 0.03, hv: 0.07, hu: 0.048 }, { dy: -0.105, hv: 0.055, hu: 0.038 }];
  const ctr: Vec3[] = [];
  for (const g of seg) {
    const y = cy + g.dy * s;
    const st = T.at(y);
    const p = surfaceAlong(probe, [st.cx, y, st.cz], [0, 0, 1], 0.013 * s);
    const nrm = normalAt(probe, p);
    ctr.push(p);
    ctx.add(`sternum_${ctr.length}`, new Plate({ o: p, nrm, up: [0, 1, 0], hu: g.hu * s, hv: g.hv * s, R: 0.12 * s, t: 0.024 * s, round: 0.01 * s, taper: ctr.length === 3 ? 0.55 : 0.12, edgeThin: 0.7 }), 'chest', { tags: [bone.tag], w: 0.007, grip: 1.4 });
  }
  const tipY = cy - 0.205 * s;
  const st = T.at(tipY);
  const tip = surfaceAlong(probe, [st.cx, tipY, st.cz], [0, 0, 1], 0.034 * s);
  ctx.add('xiphoid', spikeSdf(vlerp(ctr[2]!, tip, 0.2), tip, 0.024 * s, 0.007 * s), 'spine', { tags: [bone.tag], w: 0.006, grip: 1.4 });
}

// ------------------------------------------------------------------------------------------------ fur
/**
 * Fur mantle: a fat collar ring round the neck, fur stoles over both trapezius muscles (the right one, under the club, is bigger) with big
 * locks draped over the upper arms, and a row of locks across the shoulder blades. Everything is placed on the PROBED body surface so it
 * sticks out of the muscle instead of hiding inside it.
 */
export function addFurMantle(ctx: Ctx): void {
  const a = ctx.a, s = a.s, nk = a.neck;
  const furA = furPiece(ctx, 'pelt');
  const furB = furPiece(ctx, 'pelt2');
  const probe = skinProbe(ctx);
  const rng = new Rng('barb/mantle');
  const lock = (name: string, base: Vec3, tip: Vec3, r: number, bone: string, alt: boolean, bend: Vec3 = [0, 0, 0]): void => {
    ctx.add(name, tuftSdf(base, tip, r * s, 0.013 * s, bend), bone, { tags: [(alt ? furB : furA).tag], w: 0.015 * s });
  };
  ctx.add('mantle_collar', new Torus([0, nk[1] + 0.004 * s, nk[2] - 0.022 * s], 0.128 * s, 0.05 * s, [0, 1, 0.22]), 'chest', { tags: [furA.tag], w: 0.022 * s });
  for (const sx of BOTH) {
    const big = sx === -1;
    const sh = a.side(sx).shoulder;
    const x = sx * (big ? 0.225 : 0.205) * s;
    const top = surfaceAlong(probe, [x, nk[1] - 0.13 * s, nk[2] - 0.01 * s], [0, 1, 0], 0);
    ctx.add(`stole_${L(sx)}`, new Ellipsoid([top[0], top[1] + 0.004 * s, top[2]], [(big ? 0.17 : 0.15) * s, (big ? 0.085 : 0.07) * s, 0.14 * s]), `clavicle_${L(sx)}`, { tags: [(big ? furB : furA).tag], w: 0.022 * s });
    // locks draped over the outside of the upper arm
    const dzs = big ? [-0.1, -0.05, 0, 0.05, 0.1] : [-0.1, 0.0];
    for (const [i, dz] of dzs.entries()) {
      const base = surfaceAlong(probe, [sh[0], sh[1], sh[2] + dz * s], [sx, 0.42, 0], 0.016 * s);
      lock(`${L(sx)}_arm_lock${i}`, base, [base[0] + sx * 0.03 * s, base[1] - (0.19 + 0.04 * rng.next()) * s, base[2] + dz * 0.4 * s], big ? 0.046 : 0.04, `upper_arm_${L(sx)}`, i % 2 === 0, [sx * 0.012 * s, 0, 0]);
    }
  }
  // upper back: big locks across the shoulder blades (the pelt continues below them)
  for (let i = 0; i < 6; i++) {
    const x = (i / 5 - 0.5) * 0.42 * s;
    const base = surfaceAlong(probe, [x, nk[1] - 0.09 * s, nk[2] - 0.02 * s], [0, 0.12, -1], 0.02 * s);
    lock(`back_lock${i}`, base, [x * 1.08, base[1] - (0.2 + 0.04 * rng.next()) * s, base[2] - 0.045 * s], 0.048, 'chest', i % 2 === 1, [0, 0, -0.015 * s]);
  }
}

/** hanging pelt on the cape chain: a fat oval fur patch down the back and a ragged hem of big locks */
export function addFurPelt(ctx: Ctx): void {
  const a = ctx.a, s = a.s, nk = a.neck;
  const cape = a.layout.cape;
  if (!cape) return;
  const furA = furPiece(ctx, 'pelt');
  const furB = furPiece(ctx, 'pelt2');
  const probe = skinProbe(ctx);
  const T = new Loft(a.torso);
  const rng = new Rng('barb/pelt');
  const y0 = nk[1] - 0.3 * s;
  const st = T.at(y0);
  const o = surfaceAlong(probe, [0, y0, st.cz], [0, 0, -1], 0.0);
  ctx.add('pelt_pad', new Ellipsoid([o[0], o[1], o[2]], [0.2 * s, 0.17 * s, 0.065 * s]), cape.bones[0]!, { tags: [furA.tag], w: 0.02 * s });
  for (const sx of BOTH) {
    const side = surfaceAlong(probe, [sx * 0.15 * s, y0 + 0.04 * s, st.cz], [0, 0, -1], 0.0);
    ctx.add(`pelt_lobe_${L(sx)}`, new Ellipsoid([side[0], side[1], side[2]], [0.1 * s, 0.11 * s, 0.06 * s]), cape.bones[0]!, { tags: [furB.tag], w: 0.02 * s });
  }
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    const x = u * 0.4 * s;
    const base = surfaceAlong(probe, [x, y0 - 0.12 * s, st.cz], [0, 0, -1], 0.012 * s);
    const len = (0.24 - 0.06 * Math.abs(u * 2) ** 2) * s * rng.range(0.9, 1.15);
    const tip: Vec3 = [x * 1.05, base[1] - len, base[2] - 0.05 * s];
    const bn = cape.bones[Math.min(1, cape.bones.length - 1)]!;
    ctx.add(`pelt_lock${i}`, tuftSdf(base, tip, 0.052 * s, 0.014 * s, [0, 0, -0.012 * s]), bn, { tags: [(i % 2 === 0 ? furB : furA).tag], w: 0.014 * s });
  }
}

/** fur kilt: two rows of ragged hide strips on the skirt sectors, a longer front apron, studded belt with skull buckle, hip trophies */
export function addFurKilt(ctx: Ctx): void {
  const a = ctx.a, s = a.s;
  const hide = ctx.piece('leather', { trim: 'none' });
  const furA = furPiece(ctx, 'pelt');
  const belt = ctx.piece('leather2', { trim: 'none' });
  const iron = ctx.piece('plate', { trim: 'none' });
  const bone = ctx.piece('bone', { trim: 'none' });
  const rng = new Rng('barb/kilt');
  const T = new Loft(a.torso);
  const sectorBone = (phi: number): string => {
    if (!a.p.rig?.skirt) return 'pelvis';
    const c = Math.cos(phi), sn = Math.sin(phi);
    if (Math.abs(c) >= Math.abs(sn)) return c > 0 ? 'skirt_f' : 'skirt_b';
    return sn > 0 ? 'skirt_l' : 'skirt_r';
  };
  const yb = a.spine[1] - 0.048 * s;
  const hip = T.at(a.pelvis[1] - 0.015 * s);
  const topY = yb - 0.012 * s;
  const rows = [{ n: 11, len: 0.34, off: 0, drop: 0 }, { n: 9, len: 0.26, off: 0.5, drop: 0.045 }];
  rows.forEach((row, ri) => {
    for (let i = 0; i < row.n; i++) {
      const phi = ((i + row.off) / row.n) * Math.PI * 2;
      const sn = Math.sin(phi), cs = Math.cos(phi);
      const rx = hip.rx + (0.03 + 0.012 * ri) * s, rz = hip.rz + (0.034 + 0.012 * ri) * s;
      const r = (rx * rz) / Math.hypot(rz * sn, rx * cs);
      const base: Vec3 = [sn * r, topY - row.drop * s, hip.cz + cs * r];
      const side = Math.abs(sn);
      const front = cs > 0.4;
      const len = row.len * s * (1 - 0.3 * side) * rng.range(0.85, 1.15) * (front ? 1.1 : cs < -0.4 ? 0.9 : 1);
      const flare = 0.3 + 0.1 * side;
      const tip: Vec3 = [sn * (r + flare * len), base[1] - len, hip.cz + cs * (r + flare * len)];
      const w = ((Math.PI * 2) / row.n) * r * 0.62;
      ctx.add(`kilt${ri}_${i}`, flatCone(base, tip, w, 0.02 * s, 0.3, [sn, 0, cs]), sectorBone(phi), { tags: [(i + ri) % 3 === 0 ? furA.tag : hide.tag], w: 0.008 });
    }
  });
  // front apron: three long tongues in the middle with bone beads
  for (const [i, dx] of [-0.065, 0, 0.065].entries()) {
    const z = hip.cz + hip.rz + 0.062 * s;
    const base: Vec3 = [dx * s, topY - 0.02 * s, z - 0.012 * s];
    const tip: Vec3 = [dx * s * 1.1, topY - (i === 1 ? 0.46 : 0.4) * s, z + 0.08 * s];
    ctx.add(`apron${i}`, flatCone(base, tip, 0.04 * s, 0.02 * s, 0.3, [0, 0, 1]), 'skirt_f', { tags: [hide.tag], w: 0.008 });
    ctx.add(`apron_bead${i}`, new Sphere(vlerp(base, tip, 0.55), 0.015 * s), 'skirt_f', { tags: [bone.tag], w: 0.004 });
  }
  // belt: wide leather band, studs, skull-plate buckle
  const ext = 0.026 * s;
  const st = a.torso.map((q) => ({ y: q.y, rx: q.rx + ext, rz: q.rz + ext, cz: q.cz, n: (q.n ?? 2) + 0.3 }));
  ctx.add('belt', new Loft(st, { range: [yb - 0.04 * s, yb + 0.038 * s] }), 'spine', { tags: [belt.tag], w: 0.005, grip: 1.3 });
  const bst = T.at(yb);
  for (let i = 0; i < 10; i++) {
    const phi = ((i + 0.5) / 10) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))) < 0.3) continue;
    const p = ringPoint({ ...bst, n: bst.n + 0.3 }, yb, phi, ext + 0.004 * s);
    ctx.add(`belt_stud${i}`, new Sphere(p, 0.0135 * s), 'spine', { tags: [iron.tag], w: 0.003, grip: 1.3 });
  }
  const bz = bst.cz + bst.rz + ext;
  ctx.add('buckle', new Plate({ o: [0, yb, bz + 0.004 * s], nrm: [0, 0, 1], up: [0, 1, 0], hu: 0.054 * s, hv: 0.045 * s, R: 0.09 * s, t: 0.016 * s, round: 0.007 * s }), 'spine', { tags: [bone.tag], w: 0.003, grip: 1.3 });
  ctx.add('buckle_boss', new Ellipsoid([0, yb, bz + 0.018 * s], [0.032 * s, 0.028 * s, 0.015 * s]), 'spine', { tags: [bone.tag], w: 0.003, grip: 1.3 });
  // trophies: a skull on a thong at the right hip, a bundle of curved tusks at the left hip
  const hipR: Vec3 = [-(hip.rx + 0.04 * s), yb - 0.03 * s, hip.cz + 0.03 * s];
  const skullC: Vec3 = [hipR[0] - 0.012 * s, hipR[1] - 0.17 * s, hipR[2] + 0.015 * s];
  ctx.add('skull_cord', new RoundCone(hipR, vadd(skullC, [0, 0.04 * s, 0]), 0.0095 * s, 0.0095 * s), 'skirt_r', { tags: [belt.tag], w: 0.003 });
  ctx.add('skull_cranium', new Ellipsoid(skullC, [0.05 * s, 0.054 * s, 0.058 * s]), 'skirt_r', { tags: [bone.tag], w: 0.004 });
  ctx.add('skull_jaw', new Ellipsoid(vadd(skullC, [0, -0.05 * s, 0.028 * s]), [0.033 * s, 0.022 * s, 0.034 * s]), 'skirt_r', { tags: [bone.tag], w: 0.004 });
  const hipL: Vec3 = [hip.rx + 0.04 * s, yb - 0.03 * s, hip.cz + 0.01 * s];
  for (let i = 0; i < 3; i++) {
    const b = vadd(hipL, [0.004 * s * i, -0.01 * s * i, 0.014 * s * (i - 1)]);
    const t = vadd(b, [(0.03 + 0.012 * i) * s, -(0.18 + 0.04 * i) * s, 0.03 * (i - 1) * s]);
    ctx.add(`tusk${i}`, hornSdf([b, vadd(vlerp(b, t, 0.5), [0.026 * s, 0, 0.01 * s]), t], 0.019 * s, 0.006 * s, 4), 'skirt_l', { tags: [bone.tag], w: 0.004 });
  }
}

// ------------------------------------------------------------------------------------------------ arms and shoulders
/** left bone pauldron: cap plate + stacked lames over the deltoid with two curved horn spikes; the right shoulder carries the fur pad */
export function addBonePauldrons(ctx: Ctx): void {
  const a = ctx.a, s = a.s;
  const bone = ctx.piece('bone', { trim: 'none' });
  const rim = ctx.piece('leather2', { trim: 'none' });
  const sx = 1 as const;
  const size = 1.4;
  const lames = 3;
  const env = limbEnv(a, sx, 'arm');
  const sh = a.side(sx).shoulder;
  const topRaw = vnorm([sx * 0.62, 0.78, -0.02]);
  const nrmAt = (u: number): Vec3 => {
    const d = env.dir(u);
    const k = vdot(topRaw, d);
    return vnorm(vsub(topRaw, vscale(d, k)));
  };
  const capR = env.r(0.05) + 0.022 * size * s;
  const capN = nrmAt(0.05);
  ctx.add('pauld_cap', new Plate({ o: vadd(env.at(0.05), vscale(capN, capR)), nrm: capN, up: env.dir(0.05), hu: capR * 1.45, hv: 0.07 * size * s, R: capR, t: 0.02 * s, round: 0.008 * s, edgeThin: 0.65 }), 'clavicle_l', { tags: [bone.tag], w: 0.006, grip: 1.6 });
  for (let i = 0; i < lames; i++) {
    const cu = (0.07 * size * s + i * 0.06 * size * s) / env.len + 0.1;
    const rr = env.r(cu) + (0.015 + 0.005 * i) * size * s;
    const nn = nrmAt(cu);
    ctx.add(`pauld_lame${i}`, new Plate({ o: vadd(env.at(cu), vscale(nn, rr)), nrm: nn, up: env.dir(cu), hu: rr * (1.4 - 0.1 * i), hv: 0.038 * size * s, R: rr, t: 0.016 * s, round: 0.006 * s, edgeThin: 0.7 }), env.bone(cu, 'l'), { tags: [bone.tag], w: 0.005, grip: 1.4 });
  }
  ctx.add('pauld_strap', new Torus(env.at(0.36), env.r(0.36) + 0.006 * s, 0.01 * s, env.dir(0.36)), 'upper_arm_l', { tags: [rim.tag], w: 0.003, grip: 1.3 });
  // horn spikes: a tall curved main horn and a shorter outer one
  const b0 = vadd(sh, vscale(capN, 0.07 * size * s));
  const horn = (name: string, path: Vec3[], r0: number): void => {
    ctx.add(name, hornSdf(path, r0 * size * s, 0.007 * s, 5), 'clavicle_l', { tags: [bone.tag], w: 0.007, grip: 1.6 });
  };
  horn('pauld_horn0', [b0, vadd(b0, [sx * 0.035 * s, 0.07 * s * size, -0.012 * s]), vadd(b0, [sx * 0.045 * s, 0.15 * s * size, 0.004 * s]), vadd(b0, [sx * 0.028 * s, 0.23 * s * size, 0.03 * s])], 0.032);
  horn('pauld_horn1', [vadd(b0, [sx * 0.02 * s, -0.01 * s, 0.03 * s]), vadd(b0, [sx * 0.085 * s, 0.02 * s, 0.04 * s]), vadd(b0, [sx * 0.135 * s, 0.075 * s * size, 0.04 * s]), vadd(b0, [sx * 0.15 * s, 0.135 * s * size, 0.03 * s])], 0.024);
}

/** spiked bracers: bone thorns along the outer forearm, an elbow spike */
export function addSpikedBracers(ctx: Ctx): void {
  const a = ctx.a, s = a.s;
  const bone = ctx.piece('bone', { trim: 'none' });
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'arm');
    const el = a.side(sx).elbow;
    for (let k = 0; k < 3; k++) {
      const u = env.uMid + 0.14 + k * 0.2;
      const c = env.at(u);
      const rad = env.r(u) + 0.014 * s;
      const ang = k % 2 === 0 ? 0.2 : -0.4;
      const out: Vec3 = vnorm([sx * Math.cos(ang), Math.sin(ang), -0.3 * (k % 2 === 0 ? 1 : -0.6)]);
      const len = (0.085 - 0.01 * k) * s;
      ctx.add(`bracer_spike${k}_${L(sx)}`, spikeSdf(vadd(c, vscale(out, rad * 0.75)), vadd(c, vscale(out, rad + len)), 0.024 * s, 0.006 * s), `forearm_${L(sx)}`, { tags: [bone.tag], w: 0.005, grip: 1.3 });
    }
    ctx.add(`elbow_spike_${L(sx)}`, spikeSdf(vadd(el, [sx * 0.012 * s, 0.0, -0.04 * s]), vadd(el, [sx * 0.03 * s, 0.03 * s, -0.125 * s]), 0.03 * s, 0.007 * s), `forearm_${L(sx)}`, { tags: [bone.tag], w: 0.007, grip: 1.3 });
  }
}

// ------------------------------------------------------------------------------------------------ legs
/** big fur cuffs at the boot tops: one fat ring and a few locks hanging over the front / outside */
export function addBootCuffs(ctx: Ctx, start = 0.5): void {
  const a = ctx.a, s = a.s;
  const furA = furPiece(ctx, 'pelt');
  const furB = furPiece(ctx, 'pelt2');
  const rng = new Rng('barb/cuff');
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'leg');
    const u0 = env.uMid + (1 - env.uMid) * start;
    const c = env.at(u0);
    const r = env.r(u0) + 0.012 * s;
    ctx.add(`cuff_ring_${L(sx)}`, new Torus(c, r, 0.026 * s, [0, 1, 0]), `shin_${L(sx)}`, { tags: [furA.tag], w: 0.01 * s });
    for (let i = 0; i < 5; i++) {
      const phi = -1.5 + i * 0.75 + rng.range(-0.1, 0.1) + (sx === 1 ? 0.3 : -0.3);
      const sn = Math.sin(phi), cs = Math.cos(phi);
      const base: Vec3 = [c[0] + sn * r, c[1] - 0.005 * s, c[2] + cs * r];
      const tip: Vec3 = [base[0] + sn * 0.05 * s, base[1] - 0.1 * s * rng.range(0.85, 1.15), base[2] + cs * 0.05 * s];
      ctx.add(`cuff_lock_${L(sx)}${i}`, tuftSdf(base, tip, 0.03 * s, 0.01 * s, [sn * 0.01 * s, 0, cs * 0.01 * s]), `shin_${L(sx)}`, { tags: [(i % 2 === 0 ? furB : furA).tag], w: 0.01 * s });
    }
  }
}

/** bone knee caps with a thorn, held by a leather strap: breaks up the long bare thighs */
export function addKneeGuards(ctx: Ctx): void {
  const a = ctx.a, s = a.s;
  const bone = ctx.piece('bone', { trim: 'none' });
  const strap = ctx.piece('leather2', { trim: 'none' });
  for (const sx of BOTH) {
    const kn = a.side(sx).knee, rk = a.r.knee, bn = `shin_${L(sx)}`;
    const c: Vec3 = [kn[0], kn[1] + 0.006 * s, kn[2] + rk * 0.85];
    ctx.add(`kneecap_${L(sx)}`, new Ellipsoid(c, [0.062 * s, 0.068 * s, 0.04 * s]), bn, { tags: [strap.tag], w: 0.01 * s, grip: 1.4 });
    ctx.add(`kneestrap_${L(sx)}`, new Torus([kn[0], kn[1] - 0.012 * s, kn[2]], rk * 1.1, 0.013 * s, [0, 1, 0]), bn, { tags: [strap.tag], w: 0.004 * s, grip: 1.3 });
    ctx.add(`kneespike_${L(sx)}`, spikeSdf([c[0], c[1] + 0.01 * s, c[2] + 0.025 * s], [c[0] + sx * 0.004 * s, c[1] + 0.06 * s, c[2] + 0.105 * s], 0.026 * s, 0.007 * s), bn, { tags: [bone.tag], w: 0.006, grip: 1.3 });
  }
}

// ------------------------------------------------------------------------------------------------ war paint (paint-only marks, tag `ink`)
/** clay war paint: claw stripes under the eyes, rings round the upper arms (colour = `skin.mark`) */
export function addWarPaint(ctx: Ctx): void {
  const a = ctx.a, s = a.s, k = s * a.hs, sk = a.skull;
  const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
  // face surface (the face ellipsoid of buildHumanHead): z at (x, y), sunk 4 mm so the stripe grazes the skin
  const face = (x: number, y: number): Vec3 => {
    const q = 1 - (x / 0.074) ** 2 - ((y + 0.032) / 0.08) ** 2;
    return H(x, y, 0.018 + 0.07 * Math.sqrt(Math.max(q, 0)) - 0.004 / a.hs);
  };
  for (const sx of BOTH) {
    for (let i = 0; i < 3; i++) {
      const x0 = sx * (0.024 + 0.014 * i), x1 = sx * (0.045 + 0.016 * i);
      const pts: Vec3[] = [face(x0, -0.018 - 0.004 * i), face((x0 + x1) / 2, -0.04 - 0.004 * i), face(x1, -0.064 - 0.004 * i)];
      ctx.mark(`wp_cheek${i}_${L(sx)}`, tube(pts, [[0, 0.0048 * k], [1, 0.0038 * k]], { segments: 2, w: 0.002 }), ['ink']);
    }
    const env = limbEnv(a, sx, 'arm');
    for (const u of [0.3, 0.47]) ctx.mark(`wp_arm${Math.round(u * 100)}_${L(sx)}`, new Torus(env.at(u), env.r(u) - 0.003 * s, 0.0075 * s, env.dir(u)), ['ink']);
  }
}

/** knuckle spikes on the back of the hanging left fist (rigid to the wrist bone): a spiked knuckle-duster silhouette */
export function addFistSpikes(ctx: Ctx): void {
  const a = ctx.a, s = a.s;
  const bone = ctx.piece('bone', { trim: 'none' });
  const h = handRef(a, 'l');
  const kn = a.side(1).knuckle;
  const yk = kn[1] - h.palm[1];
  for (let i = 0; i < 3; i++) {
    const z = (0.034 - i * 0.034) * s;
    rigid(ctx, `fist_spike${i}`, spikeSdf(hp(h, -0.02 * s, yk, z), hp(h, -0.105 * s, yk - 0.012 * s, z + 0.004 * s), 0.022 * s, 0.006 * s), h.bone, [bone.tag], 0.004 * s);
  }
}
