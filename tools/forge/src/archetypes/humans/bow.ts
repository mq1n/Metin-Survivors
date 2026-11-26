// Bow, arrow and quiver props with a bendable string.
//   addBow     recurved (or custom profile) limbs + riser + string halves + nocked arrow, all rigid to the bow hand (`wrist_x`)
//              except the string halves (bones string_u / string_l) and the arrow (bone `arrow`)
//   bowRig     the extra bones + the per-frame animation of the string / arrow from the draw hand
//   addQuiver  back quiver with fletched arrows
// Bow frame (hand frame at rest, see kit.ts `hp`): z = bow axis through the fist, m = toward the body centre = the belly (target) side,
// the string runs on the opposite side (-m, `d` below = distance from the grip toward the string).
import type { PoseCtx } from '../../core/anim/clip.ts';
import { type Vec3, qfromTo, qinv, qrotate, vadd, vcross, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy, Ctx } from '../humanoid/index.ts';
import { type HandN, type HandRef, ball, cylinder, frustum, handRef, hp, leaf, ring, rigid, rod } from './kit.ts';
import type { ExtraBone, HumanRig } from './rigx.ts';

/** limb profile point: z along the bow axis, d toward the string side, r limb radius (reference metres) */
export type BowProfile = readonly (readonly [number, number, number])[];

/** short recurved composite bow */
export const RECURVE: BowProfile = [[0, -0.02, 0.022], [0.15, 0, 0.0175], [0.3, 0.06, 0.0155], [0.44, 0.14, 0.0135], [0.55, 0.2, 0.012], [0.61, 0.225, 0.0115], [0.645, 0.208, 0.0105]];

export interface BowMats {
  wood: string;
  leather: string;
  cloth: string;
  metal: string;
  fletch: string;
}

export interface BowOpts {
  hand?: HandN;
  profile?: BowProfile;
  /** index of the profile point the string is tied to (default 5) */
  nockIdx?: number;
  /** arrow length from nock to tip (m) */
  arrow?: number;
  /** string radius (m) */
  string?: number;
  mats: BowMats;
}

export interface BowGeo {
  h: HandRef;
  tipU: Vec3;
  tipL: Vec3;
  /** string midpoint at rest (where the arrow is nocked) */
  nock: Vec3;
  /**
   * rest placement of the arrow's back end. The arrow lies parallel to the bow, beside it and well clear of the body at rest (the bind pose
   * hangs the hand beside the thigh); the animation moves the back end onto the string nock and aims the shaft.
   */
  arrowPivot: Vec3;
  /** rest direction of the arrow (back end -> head), unit */
  arrowDir: Vec3;
  /** palm centre of the bow hand at rest */
  grip: Vec3;
}

export function bowGeo(a: Anatomy, o: BowOpts): BowGeo {
  const h = handRef(a, o.hand ?? 'l');
  const s = a.s;
  const prof = o.profile ?? RECURVE;
  const [zt, dt] = prof[o.nockIdx ?? 5]!;
  const tipU = hp(h, -dt * s, 0, zt * s);
  const tipL = hp(h, -dt * s, 0, -zt * s);
  const nock = hp(h, -dt * s, 0, 0);
  return { h, tipU, tipL, nock, arrowPivot: hp(h, 0, 0.05 * s, -0.37 * s), arrowDir: [0, 0, 1], grip: h.palm };
}

export function addBow(ctx: Ctx, a: Anatomy, o: BowOpts): void {
  const g = bowGeo(a, o);
  const { h } = g;
  const s = a.s;
  const prof = o.profile ?? RECURVE;
  const wood = ctx.piece(o.mats.wood), leather = ctx.piece(o.mats.leather), cloth = ctx.piece(o.mats.cloth), metal = ctx.piece(o.mats.metal), fletch = ctx.piece(o.mats.fletch);
  const P = (i: number, sg: number): Vec3 => hp(h, -prof[i]![1] * s, 0, sg * prof[i]![0] * s);
  for (const sg of [1, -1]) {
    for (let i = 0; i < prof.length - 1; i++) {
      rigid(ctx, `bow_limb${sg > 0 ? 'u' : 'l'}${i}`, rod(P(i, sg), P(i + 1, sg), prof[i]![2] * s, prof[i + 1]![2] * s), h.bone, [wood.tag], 0.004);
    }
  }
  // riser grip + tip caps
  rigid(ctx, 'bow_grip', cylinder(hp(h, 0.015 * s, 0, -0.08 * s), hp(h, 0.015 * s, 0, 0.08 * s), 0.0215 * s, 0.007), h.bone, [leather.tag], 0.004);
  const ni = o.nockIdx ?? 5;
  rigid(ctx, 'bow_tip_u', ball(P(ni, 1), 0.0105 * s), h.bone, [metal.tag], 0.003);
  rigid(ctx, 'bow_tip_l', ball(P(ni, -1), 0.0105 * s), h.bone, [metal.tag], 0.003);
  // string halves (animated by `bowRig`)
  const rs = (o.string ?? 0.0088) * s;
  rigid(ctx, 'bow_string_u', rod(g.tipU, g.nock, rs, rs), 'string_u', [cloth.tag], 0.002);
  rigid(ctx, 'bow_string_l', rod(g.tipL, g.nock, rs, rs), 'string_l', [cloth.tag], 0.002);
  // nocked arrow: shaft, head (two crossed leaves), two crossed fletching vanes at the back end
  const alen = (o.arrow ?? 0.74) * s;
  const ax = g.arrowDir;
  const p0 = g.arrowPivot;
  const p1 = vadd(p0, vscale(ax, alen));
  rigid(ctx, 'arrow_shaft', rod(p0, p1, 0.0072 * s, 0.0072 * s), 'arrow', [wood.tag], 0.002);
  rigid(ctx, 'arrow_head', leaf(p1, vadd(p1, vscale(ax, 0.075 * s)), 0.0145 * s, 0.0055 * s, [0, 1, 0]), 'arrow', [metal.tag], 0.002);
  rigid(ctx, 'arrow_head2', leaf(p1, vadd(p1, vscale(ax, 0.07 * s)), 0.0145 * s, 0.0055 * s, [1, 0, 0]), 'arrow', [metal.tag], 0.002);
  for (let k = 0; k < 2; k++) {
    const r: Vec3 = k === 0 ? [0, 1, 0] : [1, 0, 0];
    const face = vnorm(vcross(ax, r));
    rigid(ctx, `arrow_fletch${k}`, leaf(vadd(p0, vscale(ax, 0.025 * s)), vadd(p0, vscale(ax, 0.135 * s)), 0.02 * s, 0.0052 * s, face), 'arrow', [fletch.tag], 0.002);
  }
}

/** per-frame bow state supplied by the model's clips */
export interface BowState {
  /** 0 string at rest .. 1 string at the draw hand's knuckles (slightly negative / > 0 small values = the snap after release) */
  draw: number;
  /** arrow scale 0..1 (0 hides it inside the string) */
  arrow: number;
}

export type BowStateFn = (clip: string, t: number) => BowState;

/** extra bones + animate hook for `HumanRig` */
export function bowRig(a: Anatomy, o: BowOpts, state: BowStateFn): Pick<HumanRig, 'extra' | 'animate'> {
  const g = bowGeo(a, o);
  const n = o.hand ?? 'l';
  const dn = n === 'l' ? 'r' : 'l';
  const extra: ExtraBone[] = [
    { name: 'string_u', parent: `wrist_${n}`, pos: g.tipU },
    { name: 'string_l', parent: `wrist_${n}`, pos: g.tipL },
    { name: 'arrow', parent: `wrist_${n}`, pos: g.arrowPivot },
  ];
  const strings: { bone: string; tip: Vec3; d0: Vec3; len0: number }[] = [g.tipU, g.tipL].map((tip, i) => ({
    bone: i === 0 ? 'string_u' : 'string_l', tip, d0: vnorm(vsub(g.nock, tip)), len0: vlen(vsub(g.nock, tip)),
  }));
  const animate = (c: PoseCtx, clip: string, full: PoseCtx, fullSk: Skeleton): void => {
    const st = state(clip, c.t);
    const w = fullSk.fk(full.pose);
    const iw = fullSk.idx(`wrist_${n}`);
    const Rw = w.rot[iw]!, pw = w.pos[iw]!, wr = fullSk.restPos(iw);
    const toWorld = (p: Vec3): Vec3 => vadd(pw, qrotate(Rw, vsub(p, wr)));
    const restNockW = toWorld(g.nock);
    const handW = w.pos[fullSk.idx(`fingers_${dn}`)]!;
    const nockW = vadd(restNockW, vscale(vsub(handW, restNockW), st.draw));
    const inv = qinv(Rw);
    for (const sb of strings) {
      const v = vsub(nockW, toWorld(sb.tip));
      const L = Math.max(vlen(v), 1e-4);
      c.setQ(sb.bone, qfromTo(sb.d0, qrotate(inv, vscale(v, 1 / L))));
      c.scale(sb.bone, [1, 1, L / sb.len0]);
    }
    // the arrow's back end sits on the nock; the shaft aims just beside the riser (clear of the bow hand) and the shaft is scaled with the arrow state
    const sideW = qrotate(Rw, [0, 1, 0]);
    c.move('arrow', ...vsub(qrotate(inv, vsub(nockW, pw)), vsub(g.arrowPivot, wr)));
    const toGrip = vnorm(vsub(vadd(toWorld(g.grip), vscale(sideW, 0.035 * a.s)), nockW));
    c.setQ('arrow', qfromTo(g.arrowDir, qrotate(inv, toGrip)));
    c.scale('arrow', Math.max(st.arrow, 0.001));
  };
  return { extra, animate };
}

export interface QuiverOpts {
  mats: { leather: string; cloth: string; fletch: string; wood: string; metal?: string };
  /** number of arrows */
  arrows?: number;
  /** quiver length (m) */
  len?: number;
  /** lean toward the shoulder (+1: the top above the character's right shoulder, -1 left) */
  side?: 1 | -1;
}

/** back quiver on the chest bone, arrows poking out of the top */
export function addQuiver(ctx: Ctx, a: Anatomy, o: QuiverOpts): void {
  const s = a.s;
  const side = o.side ?? 1;
  const leather = ctx.piece(o.mats.leather), cloth = ctx.piece(o.mats.cloth), fletch = ctx.piece(o.mats.fletch), wood = ctx.piece(o.mats.wood);
  const len = (o.len ?? 0.5) * s;
  const c = a.chest;
  // axis: bottom behind the opposite hip, top behind the shoulder
  const top: Vec3 = [-side * 0.1 * s, c[1] + 0.25 * s, c[2] - 0.15 * s];
  const dir = vnorm([side * 0.2, -1, -0.12]);
  const bot = vadd(top, vscale(dir, len));
  rigid(ctx, 'quiver_body', frustum(top, bot, 0.058 * s, 0.047 * s, 0.01), 'chest', [leather.tag], 0.006);
  rigid(ctx, 'quiver_rim', ring(top, dir, 0.056 * s, 0.0085 * s), 'chest', [cloth.tag], 0.004);
  const up = vscale(dir, -1);
  const n = o.arrows ?? 5;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + 0.4;
    const off: Vec3 = [Math.cos(ang) * 0.028 * s, 0, Math.sin(ang) * 0.028 * s];
    const base = vadd(vadd(top, off), vscale(up, -0.04 * s));
    const lenA = (0.14 + 0.03 * Math.sin(i * 2.3)) * s;
    const tip = vadd(base, vscale(vnorm(vadd(up, vscale(off, 4))), lenA));
    rigid(ctx, `quiver_arrow${i}`, rod(base, tip, 0.0078 * s, 0.0078 * s), 'chest', [wood.tag], 0.003);
    rigid(ctx, `quiver_fletch${i}`, leaf(vadd(base, vscale(vnorm(vsub(tip, base)), lenA * 0.45)), tip, 0.022 * s, 0.006 * s, [0, 0, 1]), 'chest', [fletch.tag], 0.003);
  }
}
