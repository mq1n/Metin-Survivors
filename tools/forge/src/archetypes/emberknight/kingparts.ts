// pyre_king parts (afterOutfit hooks): flame plume on the hair chain, throne-shard cape tiers on the cape chain, sun-disc belt boss.
// All parts are bone-bound SDFs on the humanoid Ctx; units metres scaled by a.s (body) / k = a.s * a.hs (head).
import { type Vec3, vadd, vlerp, vnorm, vscale } from '../../core/math.ts';
import { Ellipsoid, RoundedBox } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import { type Anatomy, type Ctx, Loft } from '../humanoid/index.ts';
import { type ShardStyle, headAt, shard } from '../ember/parts.ts';
import { Shard } from '../ember/shard.ts';
import { cylinder, handRef, hp, rigid } from './hand.ts';
import type { BuiltSword } from './sword.ts';

/** massive king crossguard over the flame sword's guard: a thick bar across the edges with a lava gem and two forward-hooked prongs (sw_* = sword mesh group) */
export function kingGuard(ctx: Ctx, a: Anatomy, sw: BuiltSword, tags: { gold: string; core: string }, o: { span?: number } = {}): void {
  const s = a.s;
  const h = handRef(a, 'r');
  const span = (o.span ?? 0.22) * s;
  const z = sw.baseZ - 0.03 * s;
  rigid(ctx, 'sw_kguard', new RoundedBox(hp(h, 0, 0, z), [span, 0.036 * s, 0.03 * s], 0.014 * s), h.bone, [tags.gold], 0.004);
  rigid(ctx, 'sw_kguardGem', new Ellipsoid(hp(h, 0, 0, z + 0.004 * s), [0.03 * s, 0.045 * s, 0.03 * s]), h.bone, [tags.core], 0.003);
  for (const sgn of [-1, 1]) {
    const b0 = hp(h, sgn * span * 0.92, 0, z);
    rigid(ctx, `sw_kguardTip${sgn}`, new Shard(b0, hp(h, sgn * span * 1.2, 0, z + 0.15 * s), 0.034 * s, 0.026 * s, { side: [0, 1, 0], tu: 0.005 * s, tv: 0.005 * s, root: 0.03 * s, round: 0.004 * s }), h.bone, [tags.gold], 0.004);
  }
}

/** flame plume: a fan of thick curved flame tongues rising behind the crown (hair1) and a mane flowing back off the nape (hair2) */
export function flamePlume(ctx: Ctx, tag: string, o: { size?: number; count?: number } = {}): void {
  const a = ctx.a;
  const hair = a.layout.hair;
  if (!hair) return;
  const H = headAt(ctx);
  const k = a.s * a.hs;
  const size = o.size ?? 1;
  const n = o.count ?? 5;
  const tongue = (name: string, bone: string, pts: Vec3[], r0: number): void => {
    ctx.add(name, tube(pts, [[0, r0], [0.35, r0 * 0.8], [0.7, r0 * 0.45], [1, 0.006 * k]], { segments: 7, w: 0.01 }), bone, { tags: [tag], w: 0.012, grip: 1.6 });
  };
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const c = 1 - Math.abs(t) * 1.3;
    const len = (0.3 + 0.24 * c) * size;
    const base = H(t * 0.15, 0.1, -0.055 - 0.02 * Math.abs(t));
    const p1 = H(t * 0.22, 0.1 + len * 0.42, -0.1 - len * 0.12);
    const p2 = H(t * 0.32, 0.1 + len * 0.72, -0.15 - len * 0.45);
    const tip = H(t * 0.42 + 0.03 * Math.sin(i * 2.3), 0.1 + len * 0.82 - 0.03, -0.2 - len * 0.95);
    tongue(`plume_up${i}`, hair.bones[0]!, [base, p1, p2, tip], (0.034 + 0.016 * c) * k * size);
  }
  const low = hair.bones[1] ?? hair.bones[0]!;
  for (let i = 0; i < 3; i++) {
    const t = i - 1;
    const base = H(t * 0.06, -0.02, -0.1);
    const p1 = H(t * 0.1, -0.03, -0.2);
    const p2 = H(t * 0.15, 0.0, -0.32);
    const tip = H(t * 0.2, 0.06 - 0.05 * Math.abs(t), -0.44 + 0.06 * Math.abs(t));
    tongue(`plume_low${i}`, low, [base, p1, p2, tip], (0.034 - 0.006 * Math.abs(t)) * k * size);
  }
}

export interface ThroneOpts {
  size?: number;
}

/** throne-shard cape: tier 1 rises behind the shoulders like a throne back (cape1), tiers 2 / 3 hang down the cape in overlapping blades (cape2 / cape3) */
export function throneCape(ctx: Ctx, st: ShardStyle, o: ThroneOpts = {}): void {
  const a = ctx.a;
  const ch = a.layout.cape;
  if (!ch) return;
  const s = a.s;
  const size = o.size ?? 1;
  const P = ch.pts;
  const bone = (i: number): string => ch.bones[Math.min(i, ch.bones.length - 1)]!;
  // tier 1: three blades per side, rising up and outward behind the shoulders
  for (const sx of [1, -1]) {
    for (let j = 0; j < 3; j++) {
      const x = sx * (0.07 + 0.075 * j) * s;
      const base: Vec3 = [x, P[0]![1] - (0.07 + 0.02 * j) * s, P[0]![2] - (0.035 - 0.012 * j) * s];
      const dir = vnorm([sx * (0.3 + 0.45 * j), 1, -0.36 - 0.04 * j]);
      const len = (0.62 - 0.12 * j) * s * size;
      shard(ctx, `throne1_${j}_${sx === 1 ? 'l' : 'r'}`, bone(0), base, vadd(base, vscale(dir, len)), (0.05 - 0.006 * j) * s * size, 0.02 * s * size, st, { side: [1, 0, 0], tu: 0.006 * s, tv: 0.005 * s, root: 0.05 * s, w: 0.006, grip: 30, bow: 0.05 * sx });
    }
  }
  // tier 2 / 3: rows of downward blades over the cape, splaying outward
  const row = (tier: number, i0: number, count: number, half: number, lenM: number, wM: number): void => {
    const p0 = P[i0]!, p1 = P[i0 + 1] ?? P[i0]!;
    for (let j = 0; j < count; j++) {
      const t = count === 1 ? 0 : j / (count - 1) - 0.5;
      const base = vadd(vlerp(p0, p1, 0.15), [2 * t * half * s, 0, -0.045 * s]);
      const dir = vnorm([1.1 * t, -1, -0.28]);
      const len = lenM * s * size * (1 - 0.35 * Math.abs(t));
      shard(ctx, `throne${tier}_${j}`, bone(i0), base, vadd(base, vscale(dir, len)), wM * s * size, 0.018 * s * size, st, { side: [1, 0, 0], tu: 0.006 * s, tv: 0.005 * s, root: 0.03 * s, w: 0.006, grip: 30 });
    }
  };
  row(2, 1, 5, 0.17, 0.34, 0.05);
  row(3, 2, 4, 0.15, 0.4, 0.052);
}

/** sun-disc belt boss: a thick gold disc on the belt front with alternating long / short rays and a domed lava boss */
export function sunDisc(ctx: Ctx, gold: string, core: string, o: { y?: number; size?: number; rays?: number } = {}): void {
  const a = ctx.a;
  const s = a.s;
  const size = o.size ?? 1;
  const y = a.spine[1] + (o.y ?? -0.025) * s;
  const st = new Loft(a.torso).at(y);
  const z0 = st.cz + st.rz + 0.008 * s;
  const R = 0.07 * s * size;
  const c: Vec3 = [0, y, z0 + 0.012 * s];
  ctx.add('sun_disc', cylinder([0, y, z0 - 0.012 * s], [0, y, z0 + 0.016 * s], R, R * 0.96, 0.006 * s), 'spine', { tags: [gold], w: 0.003, grip: 30 });
  ctx.add('sun_boss', new Ellipsoid(vadd(c, [0, 0, 0.008 * s]), [0.034 * s * size, 0.034 * s * size, 0.02 * s]), 'spine', { tags: [core], w: 0.002, grip: 30 });
  const n = o.rays ?? 12;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + Math.PI / n;
    const d: Vec3 = [Math.sin(ang), Math.cos(ang), 0];
    const long = i % 2 === 0;
    const base = vadd(c, vscale(d, R * 0.85));
    const tip = vadd(base, vscale(d, (long ? 0.065 : 0.038) * s * size));
    shard(ctx, `sun_ray${i}`, 'spine', base, tip, (long ? 0.022 : 0.016) * s * size, 0.009 * s * size, { tag: gold }, { side: [-d[1], d[0], 0], tu: 0.003 * s, tv: 0.003 * s, root: 0.02 * s, w: 0.003, grip: 30 });
  }
}
