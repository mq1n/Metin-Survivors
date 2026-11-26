// Burning sword baked into the mesh (single skinned mesh rule). Modelled in the REST hand frame of the right hand: the blade runs
// along the grip axis +z in front of the fist, its flat faces look up / down, its edges look outward (-x) / inward (+x), so the IK-aimed
// hand (Hand.b = blade axis, Hand.e = edge direction = back of the hand) carries it edge first. Everything is stiff-skinned to wrist_r.
//   grip (wrapped) + pommel (cut-gem) + flame-wing guard + sinuous flamberge blade (centre fuller, hot edges) + flame tongues licking
//   off both edges (or swept-back fins off the spine only). Paint tags are reserved by the caller (steel / trim / leather / flame / core pieces).
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { smoothUnion } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, RoundedBox, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import type { Anatomy, Ctx } from '../humanoid/index.ts';
import { Shard } from '../ember/shard.ts';
import { type Curve, FlameBlade } from './blade.ts';
import { cylinder, handRef, hp, rigid } from './hand.ts';

export interface SwordSpec {
  /** blade length, half width / half thickness at the base (reference metres, x body scale) */
  length: number;
  halfW: number;
  halfT: number;
  width?: Curve;
  thick?: Curve;
  /** sinuous outline: amplitude (fraction of the half width), lobes along the blade, skew */
  wave?: { amp: number; cycles: number; skew?: number; phase?: number };
  /** serpentine centre line (m x s) and cycles */
  snake?: { amp: number; cycles: number };
  /** sabre bow at the tip (m x s) toward the spine side */
  bow?: number;
  /** grip behind / in front of the palm (reference metres) */
  gripBack: number;
  gripFront: number;
  /** guard half span (reference metres) */
  guard: number;
  /** how far the quillons curl up / toward the tip (1 = crescent flame wings, 0 = straight cross-guard) */
  guardCurl?: number;
  /** flame tongues per edge and their size multiplier (0 = none) */
  flames: number;
  flameSize: number;
  /** pommel radius multiplier */
  pommel?: number;
  /** edges that grow flame tongues: both (default) or only the spine (-edge side; the cutting edge leads the swing). Spine tongues lie
   *  in the blade plane and sweep back toward the tip like fins, so the silhouette reads as one sword, not a branch */
  flameSide?: 'both' | 'spine';
  /** tall flame tongue licking past the point (default true) */
  tipFlame?: boolean;
  /** hot-edge paint band on both edges (default) or only on the cutting edge */
  edgeSide?: 'both' | 'cutting';
  /** glowing lava fuller paint mark (default true) */
  lavaFuller?: boolean;
  /** how far the hot-edge band reaches over the blade faces (reference metres, default 0.002) */
  edgeBand?: number;
}

export interface SwordTags {
  steel: { tag: string; trimTag: string };
  trim: { tag: string; trimTag: string };
  leather: { tag: string; trimTag: string };
  flame: { tag: string };
  core: { tag: string };
  /** paint-only marks: the lava fuller and the hot edge bands */
  lava: string;
  hotEdge: string;
}

export interface BuiltSword {
  blade: FlameBlade;
  /** hand-frame metres (x body scale already applied) */
  length: number;
  tipZ: number;
  baseZ: number;
  pommelZ: number;
  /** world rest positions of the blade base / tip (for trail / VFX extras) */
  base: Vec3;
  tip: Vec3;
  /** spine-flame medial axes (world rest positions; base -> mid -> tip, base width) for core-to-rim flame paint */
  flames: FlameAxis[];
}

export interface FlameAxis {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  w: number;
}

/** flame tongue: a bent flattened cone (leaf) from base -> tip through a mid control point; `face` = flat-face normal */
export function flameTongue(base: Vec3, mid: Vec3, tip: Vec3, width: number, flat: number, face: Vec3): Sdf {
  const m1 = vlerp(base, mid, 0.62);
  const m2 = vlerp(mid, tip, 0.38);
  return smoothUnion(
    [
      flatCone(base, m1, width, width * 0.86, flat, face),
      flatCone(m1, mid, width * 0.86, width * 0.62, flat, face),
      flatCone(mid, m2, width * 0.62, width * 0.36, flat, face),
      flatCone(m2, tip, width * 0.36, width * 0.07, flat * 1.1, face),
    ],
    width * 0.5,
  );
}

export const FLAMBERGE_WIDTH: Curve = [[0, 0.82], [0.1, 1], [0.55, 0.9], [0.8, 0.62], [0.94, 0.26], [1, 0.02]];
export const FLAMBERGE_THICK: Curve = [[0, 1], [0.5, 0.88], [0.9, 0.62], [1, 0.4]];

export function addFlameSword(ctx: Ctx, a: Anatomy, spec: SwordSpec, tg: SwordTags): BuiltSword {
  const s = a.s;
  const h = handRef(a, 'r');
  const bone = h.bone;
  const edge = h.edge;
  const R = (v: number): number => v * s;

  // ---- grip: wrapped leather with two ring collars, pommel with a cut gem + spike
  const zg0 = -R(spec.gripBack), zg1 = R(spec.gripFront);
  const rg = R(0.021);
  rigid(ctx, 'sw_grip', cylinder(hp(h, 0, 0, zg0), hp(h, 0, 0, zg1), rg, rg * 0.92, 0.005), bone, [tg.leather.tag], 0.004);
  for (const z of [zg0 + R(0.06), zg1 - R(0.045)]) {
    rigid(ctx, `sw_ring${z.toFixed(3)}`, cylinder(hp(h, 0, 0, z - R(0.011)), hp(h, 0, 0, z + R(0.011)), rg * 1.28, rg * 1.28, 0.004), bone, [tg.trim.tag], 0.004);
  }
  const pk = spec.pommel ?? 1;
  const pc = hp(h, 0, 0, zg0 - R(0.028) * pk);
  rigid(ctx, 'sw_pommel', new Ellipsoid(pc, [R(0.034) * pk, R(0.034) * pk, R(0.03) * pk]), bone, [tg.trim.tag], 0.004);
  rigid(ctx, 'sw_pommelGem', new Sphere(vadd(pc, [0, 0, -R(0.026) * pk]), R(0.019) * pk), bone, [tg.core.tag], 0.002);
  rigid(ctx, 'sw_pommelSpike', new Shard(vadd(pc, [0, 0, -R(0.03) * pk]), vadd(pc, [0, 0, -R(0.1) * pk]), R(0.017) * pk, R(0.013) * pk, { tu: R(0.003), tv: R(0.003), root: R(0.01), round: 0.002 }), bone, [tg.trim.tag], 0.004);

  // ---- guard: boss block + two flame-wing quillons curling toward the blade tip, with a small down-hook each
  const gz = zg1 + R(0.022);
  const gc = hp(h, 0, 0, gz);
  rigid(ctx, 'sw_guardBoss', new RoundedBox(gc, [R(0.046), R(0.03), R(0.026)], R(0.012)), bone, [tg.trim.tag], 0.004);
  for (const sgn of [-1, 1]) {
    const x = (m: number): number => sgn * R(m);
    const gk = spec.guardCurl ?? 1;
    const p0 = hp(h, x(0.03), 0, gz - R(0.004)), p1 = hp(h, x(0.115), R(0.012) * gk, gz - R(0.012)), p2 = hp(h, x(spec.guard * 0.92), R(0.03) * gk, gz + R(0.07) * gk);
    const p3 = hp(h, x(spec.guard), R(0.062) * gk, gz + R(0.15) * gk);
    rigid(ctx, `sw_wing${sgn}`, tube([p0, p1, p2, p3], [[0, R(0.02)], [0.5, R(0.015)], [1, R(0.005)]], { segments: 5, w: 0.006 }), bone, [tg.trim.tag], 0.004);
    // lower claw
    const q2 = hp(h, x(spec.guard * 0.8), -R(0.026), gz + R(0.05));
    rigid(ctx, `sw_claw${sgn}`, tube([p1, q2], [[0, R(0.013)], [1, R(0.004)]], { segments: 3, w: 0.004 }), bone, [tg.trim.tag], 0.004);
  }
  // blade collar (ricasso)
  const bz0 = gz + R(0.026);
  rigid(ctx, 'sw_ricasso', new RoundedBox(hp(h, 0, 0, bz0 + R(0.012)), [R(spec.halfW * 0.78), R(spec.halfT * 1.5), R(0.014)], R(0.006)), bone, [tg.trim.tag], 0.004);

  // ---- blade
  const L = R(spec.length);
  const blade = new FlameBlade({
    base: hp(h, 0, 0, bz0 + R(0.01)),
    axis: [0, 0, 1],
    across: edge,
    length: L,
    halfW: R(spec.halfW),
    halfT: R(spec.halfT),
    width: spec.width ?? FLAMBERGE_WIDTH,
    thick: spec.thick ?? FLAMBERGE_THICK,
    ...(spec.wave ? { waveW: spec.wave } : {}),
    ...(spec.snake ? { waveC: { amp: R(spec.snake.amp), cycles: spec.snake.cycles } } : {}),
    bow: -R(spec.bow ?? 0),
    round: Math.max(0.004, R(0.0036)),
  });
  rigid(ctx, 'sw_blade', blade, bone, [tg.steel.tag], 0.003);
  if (spec.lavaFuller ?? true) ctx.mark('sw_fuller', blade.fuller(0.06, 0.9, R(0.005)), [tg.lava]);
  blade.edges(0.1, 0.97, R(spec.edgeBand ?? 0.002), spec.edgeSide === 'cutting' ? 'right' : 'both').forEach((e, i) => ctx.mark(`sw_edge${i}`, e, [tg.hotEdge]));

  // ---- flame tongues
  const nF = spec.flames;
  const flames: FlameAxis[] = [];
  if (spec.flameSide === 'spine') {
    // slender flames off the spine, in the blade plane, rooted inside the blade and swept back toward the point, each with a
    // small forked lick so the outline reads as fire rather than a leaf / fin
    const out = vscale(blade.U, -1);
    const at = (p: Vec3, o: number, a: number, sz: number): Vec3 => vadd(vadd(p, vscale(out, R(o) * sz)), vscale(blade.A, R(a) * sz));
    for (let i = 0; i < nF; i++) {
      const t = nF === 1 ? 0.3 : 0.16 + (0.44 * i) / (nF - 1);
      const sz = spec.flameSize * (1 - 0.16 * i);
      const root = blade.at(t, -0.55);
      const mid = at(root, 0.11, 0.035, sz), tip = at(root, 0.165, 0.215, sz);
      const w = R(0.032) * sz;
      rigid(ctx, `sw_flame${i}`, flameTongue(root, mid, tip, w, 0.32, blade.V), bone, [tg.flame.tag], 0.01);
      const lb = vlerp(root, mid, 0.5), lm = at(lb, 0.05, -0.012, sz), lt = at(lb, 0.095, 0.03, sz);
      rigid(ctx, `sw_flameLick${i}`, flameTongue(lb, lm, lt, w * 0.5, 0.32, blade.V), bone, [tg.flame.tag], 0.01);
      flames.push({ a: root, b: mid, c: tip, w }, { a: lb, b: lm, c: lt, w: w * 0.5 });
    }
  } else {
    // licking off both edges, swept toward the tip, alternating up / down out of the blade plane
    for (const sgn of [-1, 1] as const) {
      for (let i = 0; i < nF; i++) {
        const t = nF === 1 ? 0.5 : 0.16 + (0.7 * i) / (nF - 1) + (sgn === 1 ? 0.035 : -0.02);
        const sz = spec.flameSize * (1.12 - 0.6 * Math.abs(t - 0.45)) * (1 + 0.14 * Math.sin(i * 2.7 + sgn));
        const root = blade.at(t, sgn * 0.82);
        const out = vnorm(vadd(vscale(blade.U, sgn), [0, i % 2 === 0 ? 0.55 : -0.45, 0]));
        const axis = blade.A;
        const mid = vadd(vadd(root, vscale(out, R(0.075) * sz)), vscale(axis, R(0.09) * sz));
        const tip = vadd(vadd(root, vscale(out, R(0.1) * sz)), vscale(axis, R(0.22) * sz));
        const face: Vec3 = vnorm(vsub([0, i % 2 === 0 ? 1 : -1, 0], vscale(out, 0.2)));
        rigid(ctx, `sw_flame${sgn}_${i}`, flameTongue(root, mid, tip, R(0.021) * sz, 0.5, face), bone, [tg.flame.tag], 0.01);
      }
    }
  }
  // one tall tongue at the tip (a licking spear of flame past the point)
  if (nF > 0 && (spec.tipFlame ?? true)) {
    const tipP = blade.at(1);
    rigid(ctx, 'sw_flameTip', flameTongue(blade.at(0.9), vadd(tipP, vscale(blade.A, R(0.04))), vadd(tipP, vscale(blade.A, R(0.2 * spec.flameSize))), R(0.024) * spec.flameSize, 0.55, [0, 1, 0]), bone, [tg.flame.tag], 0.01);
  }
  void RoundCone;
  return { blade, length: L, tipZ: bz0 + R(0.01) + L, baseZ: bz0 + R(0.01), pommelZ: zg0 - R(0.06), base: blade.at(0), tip: blade.at(1), flames };
}
