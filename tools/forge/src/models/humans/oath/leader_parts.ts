// silver_vow_leader custom geometry: split battle skirt (panels with gaps so the legs read), flared sleeves, tall halo crown, open casting
// hand with real fingers, and the spell orb (rigid on its own bone, animated by the model's clips).
// All coordinates are WORLD rest metres (A-pose); the humanoid skeleton has identity rest rotations.
import { DEG, type Vec3, vadd, vdist, vnorm, vscale, vsub } from '../../../core/math.ts';
import { Offset, SmoothIntersect } from '../../../core/sdf/ops.ts';
import { RoundCone, Sphere, Torus, spindle } from '../../../core/sdf/primitives.ts';
import { tube } from '../../../core/sdf/shapes.ts';
import { type Anatomy, type Ctx, Loft, type PieceEnv, type Side, type Station, boxClip, clipMinus, cover, limbEnv, limbTube, slabAxis, slabY } from '../../../archetypes/humanoid/index.ts';
import { sectorWedge } from '../../../archetypes/humanoid/outfit/soft.ts';
import { handRef, hp, rigid } from '../../../archetypes/humans/kit.ts';

const L = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');
const smooth01 = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------- skirt
interface Panel {
  /** centre angle (deg, 0 = front, + = character's left) and half width (deg) */
  deg: number;
  half: number;
  /** hem position as a fraction of the hip -> ankle height (0 = hip, 1 = ankle) */
  hem: number;
}

const PANELS: Panel[] = [
  { deg: 31, half: 14, hem: 0.4 },
  { deg: -31, half: 14, hem: 0.4 },
  { deg: 66, half: 16, hem: 0.5 },
  { deg: -66, half: 16, hem: 0.5 },
  { deg: 100, half: 16, hem: 0.58 },
  { deg: -100, half: 16, hem: 0.58 },
  { deg: 134, half: 15, hem: 0.66 },
  { deg: -134, half: 15, hem: 0.66 },
  { deg: 180, half: 27, hem: 0.74 },
];

const skirtBone = (phi: number): string => {
  const c = Math.cos(phi), sn = Math.sin(phi);
  if (Math.abs(c) >= Math.abs(sn)) return c > 0 ? 'skirt_f' : 'skirt_b';
  return sn > 0 ? 'skirt_l' : 'skirt_r';
};

/**
 * Split battle skirt: a thin cloth shell that follows the hips and flares to the hem, cut into angular panels. The front opens
 * (short panels, wide gap), the back trails (long train), so the legs and boots read at game scale. Options: flare, thick, trim.
 */
export function battleSkirt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const T = new Loft(a.torso);
  const j = a.side(1);
  const waistY = a.spine[1] + e.n('top', 0.0) * s;
  const hipY = a.pelvis[1] - 0.02 * s;
  const ext = e.n('ext', 0.016) * s;
  const th = e.n('thick', 0.02) * s;
  const flare = e.n('flare', 1);
  const wst = T.at(waistY), hip = T.at(hipY);
  const at = (f: number): number => j.hip[1] - f * (j.hip[1] - j.ankle[1]);
  const prof = (d: number): Station[] => [
    { y: at(0.9), rx: hip.rx + ext + (0.17 * flare - d) * s, rz: hip.rz + ext + (0.125 * flare - d) * s, cz: -0.012 * s, n: 2.15 },
    { y: at(0.55), rx: hip.rx + ext + (0.09 * flare - d) * s, rz: hip.rz + ext + (0.065 * flare - d) * s, cz: -0.006 * s, n: 2.15 },
    { y: at(0.25), rx: hip.rx + ext + (0.04 * flare - d) * s, rz: hip.rz + ext + (0.028 * flare - d) * s, cz: -0.002 * s, n: 2.2 },
    { y: hipY, rx: hip.rx + ext - d, rz: hip.rz + ext - d, cz: hip.cz, n: 2.3 },
    { y: waistY, rx: wst.rx + ext - d, rz: wst.rz + ext - d, cz: wst.cz, n: 2.4 },
  ];
  const outer = new Loft(prof(0));
  const inner = new Loft(prof(th));
  const shell = clipMinus(outer, [inner], 0.004);
  const edge = e.n('edge', 4) * DEG;
  PANELS.forEach((p, i) => {
    const phi = p.deg * DEG, half = p.half * DEG;
    const hemY = at(p.hem);
    const part = new SmoothIntersect([shell, sectorWedge(phi, half), slabY(hemY, waistY + 0.004 * s)], 0.003);
    e.ctx.add(`${e.spec.id}_panel${i}`, part, skirtBone(phi), { tags: e.tag(e.mat, 'skirt'), w: 0.006 });
    const off = new Offset(part, 0.003);
    e.ctx.mark(`${e.spec.id}_hem${i}`, new SmoothIntersect([off, slabY(hemY - 0.01, hemY + 0.05 * s)], 0.001), [e.trimTag]);
    e.ctx.mark(`${e.spec.id}_edge${i}`, clipMinus(new SmoothIntersect([off, slabY(hemY, waistY)], 0.001), [sectorWedge(phi, half - edge)], 0.001), [e.trimTag]);
  });
}

// ---------------------------------------------------------------------------------------------------------------- sleeves
/** fitted upper sleeve + a forearm sleeve flaring toward a trimmed cuff. Options: wide (cuff flare m), ext. */
export function flareSleeves(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const ext = e.n('ext', 0.011) * s;
  const wide = e.n('wide', 0.04) * s;
  const top = a.torso[a.torso.length - 3]!.y;
  for (const sx of [1, -1] as Side[]) {
    const n = L(sx);
    const env = limbEnv(a, sx, 'arm');
    cover(e, ['delt_'], ext, { filter: (p) => p.name.endsWith(n), clip: boxClip([sx * 0.2 * s, top, 0], [0.09 * s, 0.12 * s, 0.2 * s]) });
    e.ctx.add(`${e.spec.id}_sleeveU_${n}`, limbTube(env, 0.02, env.uMid + 0.05, ext, { w: 0.01 }), `upper_arm_${n}`, { tags: e.tag(e.mat), w: 0.01 });
    const flare = (u: number): number => ext + wide * smooth01((u - env.uMid - 0.05) / (0.9 - env.uMid - 0.05)) ** 1.4;
    const fa = limbTube(env, env.uMid - 0.04, 0.9, flare, { w: 0.01 });
    e.ctx.add(`${e.spec.id}_sleeveF_${n}`, fa, `forearm_${n}`, { tags: e.tag(e.mat), w: 0.01 });
    e.ctx.mark(`${e.spec.id}_cuff_${n}`, new SmoothIntersect([new Offset(fa, 0.003), slabAxis(env, 0.86, 0.91)], 0.001), [e.trimTag]);
  }
}

// ---------------------------------------------------------------------------------------------------------------- crown
/**
 * Tall flame crown: a tiara band carrying a fan of seven flat leaf blades (tallest at the front, a star from above), a jewel at the
 * centre blade and ear ornaments with short drops. Gems carry the `glow` tag (emissive). Options: rise (blade height scale).
 */
export function crown(e: PieceEnv, glow = true): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const id = e.spec.id;
  const rise = e.n('rise', 1);
  const gold = e.tag(e.mat, 'metal');
  const gem = glow ? e.tag(e.mat, 'metal', 'glow', 'gem') : gold;
  const y = sk[1] + 0.058 * k;
  const rb = 0.094 * k;
  const c0: Vec3 = [sk[0], y, sk[2] - 0.006 * k];
  e.ctx.add(`${id}_band`, new Torus(c0, rb, 0.0125 * k, [0, 1, -0.07]), 'head', { tags: gold, w: 0.003, grip: 1.6 });
  // fan of leaf blades around the front 200 degrees; each blade is a flat lens whose broad face looks outward
  const heights = [0.16, 0.13, 0.1, 0.072];
  const widths = [0.036, 0.031, 0.029, 0.025];
  for (let i = -3; i <= 3; i++) {
    const ai = Math.abs(i);
    const phi = i * 34 * DEG;
    const out: Vec3 = [Math.sin(phi), 0, Math.cos(phi)];
    const tan: Vec3 = [Math.cos(phi), 0, -Math.sin(phi)];
    const foot: Vec3 = [c0[0] + out[0] * rb, y - 0.004 * k, c0[2] + out[2] * rb];
    const h = heights[ai]! * k * rise;
    const tip: Vec3 = [foot[0] + out[0] * 0.014 * k, foot[1] + h, foot[2] + out[2] * 0.014 * k];
    e.ctx.add(`${id}_blade${i}`, spindle(foot, tip, [widths[ai]! * k, 0.0105 * k], tan), 'head', { tags: gold, w: 0.004, grip: 1.6 });
  }
  e.ctx.add(`${id}_jewel`, new Sphere([0, y + 0.03 * k, c0[2] + rb + 0.012 * k], 0.0195 * k), 'head', { tags: gem, w: 0.002, grip: 1.6 });
  for (const sx of [1, -1] as Side[]) {
    const ex = sx * 0.099 * k;
    e.ctx.add(`${id}_ear_${L(sx)}`, new Sphere([ex, sk[1] - 0.012 * k, sk[2] + 0.004 * k], 0.0115 * k), 'head', { tags: gold, w: 0.003, grip: 1.6 });
    e.ctx.add(`${id}_drop_${L(sx)}`, new RoundCone([ex, sk[1] - 0.02 * k, sk[2] + 0.004 * k], [sx * 0.1 * k, sk[1] - 0.07 * k, sk[2] + 0.008 * k], 0.0085 * k, 0.0125 * k), 'head', { tags: gold, w: 0.003, grip: 1.6 });
  }
}

// ---------------------------------------------------------------------------------------------------------------- hand
/** drop the body parts the stock builder adds that this model replaces (back lats make a slim armoured torso look like a barrel) */
export function trimBody(ctx: Ctx, drop: (name: string) => boolean): void {
  ctx.body.parts = ctx.body.parts.filter((p) => !drop(p.name));
}

/**
 * Open hand with real fingers (4 fingers fanned and slightly cupped + an extended thumb) replacing the stock mitten of one side.
 * Call from `hooks.afterBody` (liteHands: true provides the palm / heel / knuckle blocks this builds on). Fingers are deliberately
 * thick (>= 2.5 voxels) so the crowd decimation keeps them.
 */
export function openHand(ctx: Ctx, sx: Side, o: { splay?: number; curl?: number; thick?: number } = {}): void {
  const a = ctx.a;
  const n = L(sx);
  trimBody(ctx, (name) => name === `mitten_${n}` || name === `thumb_${n}`);
  const j = a.side(sx);
  const dir = vnorm(vsub(j.fingerTip, j.wrist));
  const hl = vdist(j.fingerTip, j.wrist);
  const M = vnorm(vsub([-sx, 0, 0], vscale(dir, -sx * dir[0])));
  const F = vnorm(vsub([0, 0, 1], vadd(vscale(dir, dir[2]), vscale(M, M[2]))));
  const at = (t: number, dm = 0, df = 0): Vec3 => [
    j.wrist[0] + dir[0] * hl * t + M[0] * dm + F[0] * df,
    j.wrist[1] + dir[1] * hl * t + M[1] * dm + F[1] * df,
    j.wrist[2] + dir[2] * hl * t + M[2] * dm + F[2] * df,
  ];
  const hw = a.r.palmW, ht = a.r.palmT;
  const splay = o.splay ?? 0.26, curl = o.curl ?? 0.2, thick = o.thick ?? 1;
  const lens = [0.97, 1.03, 0.96, 0.78];
  const dirOf = (c: number, sp: number): Vec3 => vnorm([
    dir[0] * Math.cos(c) + M[0] * Math.sin(c) + F[0] * Math.sin(sp),
    dir[1] * Math.cos(c) + M[1] * Math.sin(c) + F[1] * Math.sin(sp),
    dir[2] * Math.cos(c) + M[2] * Math.sin(c) + F[2] * Math.sin(sp),
  ]);
  for (let f = 0; f < 4; f++) {
    const df = (1.5 - f) * hw * 0.56;
    const sp = (1.5 - f) * splay;
    const len = 0.5 * hl * lens[f]! * 1.16;
    const p0 = at(0.5, -ht * 0.2, df);
    const p1 = vadd(p0, vscale(dirOf(curl * 0.6, sp), len * 0.6));
    const p2 = vadd(p1, vscale(dirOf(curl * 2.2, sp * 1.1), len * 0.42));
    ctx.add(`finger${f}_${n}`, tube([p0, p1, p2], [[0, hw * 0.29 * thick], [0.6, hw * 0.25 * thick], [1, hw * 0.2 * thick]], { segments: 2, w: 0.003 }), `fingers_${n}`, { tags: ['skin', 'hand', 'fingers'], w: 0.006 });
    ctx.mark(`nail${f}_${n}`, new Sphere(vadd(p2, vscale(M, hw * 0.08)), hw * 0.2), ['nail']);
  }
  const tb = at(0.14, ht * 0.1, hw * 0.95), tm = at(0.27, ht * 0.5, hw * 1.75), tt = at(0.4, ht * 0.9, hw * 2.45);
  ctx.add(`thumb_${n}`, tube([tb, tm, tt], [[0, hw * 0.36 * thick], [0.5, hw * 0.29 * thick], [1, hw * 0.22 * thick]], { segments: 2, w: 0.006 }), `thumb_${n}`, { tags: ['skin', 'hand', 'thumb'], w: 0.01 });
  ctx.mark(`thumbnail_${n}`, new Sphere(vadd(tt, vscale(M, hw * 0.08)), hw * 0.21), ['nail']);
}

// ---------------------------------------------------------------------------------------------------------------- orb
export interface OrbGeo {
  /** world rest position of the orb centre (bind pose: parked in free space beside the hand) */
  rest: Vec3;
  /** palm centre and wrist, world rest */
  palm: Vec3;
  wrist: Vec3;
  radius: number;
}

export function orbGeo(a: Anatomy, hand: 'l' | 'r'): OrbGeo {
  const h = handRef(a, hand);
  const s = a.s;
  // parked outward and below the hand: >= 10 cm from every cloth / body surface at rest (stiff weights would drag them otherwise)
  const rest = hp(h, -0.2 * s, -0.13 * s, 0.03 * s);
  return { rest, palm: h.palm, wrist: h.wrist, radius: 0.055 * s };
}

/** glowing core + two crossing rings, all rigid on bone `orb` (tags `glow` feed the emissive map) */
export function addOrb(ctx: Ctx, a: Anatomy, hand: 'l' | 'r', tags: string[]): void {
  const g = orbGeo(a, hand);
  const s = a.s;
  const c = g.rest;
  rigid(ctx, 'orb_core', new Sphere(c, g.radius), 'orb', tags, 0.003);
  rigid(ctx, 'orb_ringA', new Torus(c, 0.108 * s, 0.0125 * s, [0, 1, 0.25]), 'orb', tags, 0.003);
  rigid(ctx, 'orb_ringB', new Torus(c, 0.108 * s, 0.0125 * s, [1, 0.15, 0]), 'orb', tags, 0.003);
}
