// Ascetic weapon: a long monk spear with a ridged leaf blade, two curved side blades, an iron socket with a horse-hair tassel and an iron-shod
// butt. Authored in the orc-kit weapon frame (+Y along the haft, +Z = edge side, +X = flat normal), skinned rigidly to the wrist bone. The
// right palm sits at weapon y = 0 (leather grip), the guide hand holds the second grip at y ~ 0.5.
import { type Vec3 } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { RoundCone } from '../../core/sdf/primitives.ts';
import { type Ctx } from '../humanoid/index.ts';
import { type Frame, type WFrame, Slab, frameOf, rc, spike } from '../orc/kit.ts';
import { strip } from './cloth.ts';

/** paint tags per prop material, as returned by the orc kit's `propTags(ctx, mats)` */
export interface SpearTags {
  metal: string[];
  haft: string[];
  wrap: string[];
  cloth: string[];
}

const TAU = Math.PI * 2;

/** smooth half-width profile over u in 0..1 */
function prof(p: readonly (readonly [number, number])[], t: number): number {
  if (t <= p[0]![0]) return p[0]![1];
  const last = p[p.length - 1]!;
  if (t >= last[0]) return last[1];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i]!, b = p[i + 1]!;
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0] || 1);
      const s = u * u * (3 - 2 * u);
      return a[1] + (b[1] - a[1]) * (0.3 * u + 0.7 * s);
    }
  }
  return last[1];
}

/**
 * Monk spear (~2.46 m with the blade). o: size, tassel (0/1)
 */
export function monkSpear(ctx: Ctx, f: WFrame, t: SpearTags, o: { size?: number; tassel?: number } = {}): void {
  const s = f.s * (o.size ?? 1);
  const P = (x: number, y: number, z: number): Vec3 => f.p(x * s, y * s, z * s);
  const add = (name: string, sdf: Sdf, tags: string[], w = 0.004, grip = 1.5): void => {
    ctx.add(`prop_${name}`, sdf, f.bone, { tags, w, grip });
  };
  // ---- shaft: tapered, chunky enough to read from the game camera (2.46 m butt to tip: long enough to read as a spear when held upright,
  // short enough that the rest-pose spear does not shrink the painter's turnaround sheet)
  add('shaft', rc(P(0, -0.45, 0), P(0, 1.15, 0), 0.0275 * s, 0.0215 * s), t.haft);
  add('buttCap', rc(P(0, -0.5, 0), P(0, -0.4, 0), 0.034 * s, 0.032 * s), t.metal);
  add('buttSpike', spike(P(0, -0.48, 0), P(0, -0.62, 0), 0.03 * s, 0.005 * s), t.metal, 0.005);
  // leather-wrapped grips under both hands
  add('wrapR', rc(P(0, -0.17, 0), P(0, 0.15, 0), 0.0335 * s, 0.0335 * s), t.wrap, 0.003);
  add('wrapL', rc(P(0, 0.35, 0), P(0, 0.64, 0), 0.0335 * s, 0.0335 * s), t.wrap, 0.003);
  for (const y of [0.82, 1.02]) add(`collar${y}`, rc(P(0, y - 0.022, 0), P(0, y + 0.022, 0), 0.034 * s, 0.034 * s), t.metal, 0.003);
  // ---- socket
  add('socket', rc(P(0, 1.07, 0), P(0, 1.28, 0), 0.04 * s, 0.03 * s), t.metal, 0.004);
  add('socketRing', rc(P(0, 1.24, 0), P(0, 1.29, 0), 0.046 * s, 0.046 * s), t.metal, 0.003);
  // The blade plane is turned 45 deg about the shaft: in the rest pose (spear level, forward) one flat faces up-outward and the other
  // down-inward, so the Painter's top/right and left views each see a flat (a flat facing straight down is never painted). In the idle
  // hold (back of the hand outward) the painted down-inward flat faces front-left, toward the 3/4 portrait camera.
  const k = Math.SQRT1_2;
  const f0 = frameOf(f);
  const fr: Frame = { o: f0.o, x: f.d(k, 0, -k), y: f.d(0, 1, 0), z: f.d(k, 0, k) };
  // ---- leaf blade, ridged (diamond section)
  const yb = 1.26, L = 0.58;
  const hwp: [number, number][] = [[0, 0.034], [0.1, 0.066], [0.34, 0.078], [0.62, 0.056], [0.86, 0.026], [1, 0.0]];
  const hw = (y: number): number => prof(hwp, (y - yb) / L);
  const n = 11;
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const y = yb + (L * i) / n;
    left.push([y * s, hw(y) * s]);
    if (i > 0 && i < n) right.push([y * s, -hw(y) * s]);
  }
  const outline: [number, number][] = [...left, ...right.reverse()];
  add('blade', new Slab(fr, outline, (y, z) => {
    const w = hw(y / s) * s;
    const k = 1 - Math.min(1, Math.abs(z) / Math.max(w, 1e-3));
    return (0.006 + 0.021 * k) * s;
  }, 0.003 * s, 0.03 * s), t.metal, 0.005);
  // ---- side blades: crescents sweeping out of the socket and curling toward the tip
  for (const sg of [1, -1]) {
    const cr: [number, number][] = ([
      [1.22, 0.03], [1.24, 0.1], [1.29, 0.17], [1.38, 0.218], [1.5, 0.222], [1.6, 0.19], [1.53, 0.178], [1.45, 0.165], [1.37, 0.125], [1.31, 0.075], [1.29, 0.03],
    ] as [number, number][]).map(([y, z]) => [y * s, z * s * sg] as [number, number]);
    add(`crescent${sg}`, new Slab(fr, cr, (y, z) => {
      const e = Math.hypot((y / s - 1.22) * 0.5, Math.abs(z / s) - 0.03);
      return (0.019 - 0.012 * Math.min(1, e / 0.22)) * s;
    }, 0.003 * s, 0.022 * s), t.metal, 0.005);
  }
  // ---- tassel: a mane of red horse-hair strips streaming back from the socket ring
  if ((o.tassel ?? 1) > 0) {
    const m = 9;
    for (let i = 0; i < m; i++) {
      const ang = (i / m) * TAU;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      const base = P(cx * 0.036, 1.1, cz * 0.036);
      const lenK = 0.78 + 0.22 * Math.sin(i * 2.3 + 1);
      const tip = P(cx * 0.1, 1.1 - 0.3 * lenK, cz * 0.1);
      // flat face tangent to the ring
      const fac = f.d(-cz, 0, cx);
      ctx.add(`prop_tassel${i}`, strip(base, tip, 0.02 * s, 0.008 * s, 0.4, fac), f.bone, { tags: t.cloth, w: 0.004, grip: 1.5 });
    }
    ctx.add('prop_tasselKnot', new RoundCone(P(0, 1.1, 0), P(0, 1.05, 0), 0.047 * s, 0.045 * s), f.bone, { tags: t.cloth, w: 0.004, grip: 1.5 });
  }
}
