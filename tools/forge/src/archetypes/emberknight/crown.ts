// Ember king crown (PieceSpec.build): a conforming gold circlet with a raised lip over the brow, a ring of tall faceted prongs
// (centre tallest, leaning outward), small spikes between them and a cut lava gem in a gold bezel on the brow.
// Piece options (o): prongs (default 7), tall (prong length multiplier), y (band bottom above the skull centre, head units).
// Part names crown_prong* / crown_spike* / crown_gem / crown_bezel are meshed in the king's head group.
import { type Vec3, vadd, vnorm, vscale } from '../../core/math.ts';
import { Ellipsoid, Torus } from '../../core/sdf/primitives.ts';
import { type PieceEnv, boxClip, cover } from '../humanoid/outfit/util.ts';
import { Shard } from '../ember/shard.ts';

export function emberCrown(e: PieceEnv): void {
  const { a, ctx } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const n = Math.max(3, Math.round(e.n('prongs', 7)));
  const tall = e.n('tall', 1);
  const y0 = sk[1] + e.n('y', 0.04) * k;
  const bh = 0.055 * k;
  const ext = 0.016 * k;
  const tags = e.tag(e.mat);
  cover(e, ['cranium', 'forehead'], ext, { clip: boxClip([sk[0], y0 + bh / 2, sk[2]], [0.3 * k, bh / 2, 0.3 * k]), grip: 1.6, w: 0.004, lip: { h: 0.007 * k, w: 0.009 * k }, name: 'band' });
  // cranium cross-section at band height (ellipse around the skull centre, slightly behind it)
  const rx = 0.1 * k + ext, rz = 0.112 * k + ext, cz = sk[2] - 0.008 * k;
  const ring = (ang: number, y: number, inset = 0): Vec3 => [sk[0] + Math.sin(ang) * (rx - inset), y, cz + Math.cos(ang) * (rz - inset)];
  const outward = (ang: number): Vec3 => [Math.sin(ang), 0, Math.cos(ang)];
  const tangent = (ang: number): Vec3 => [Math.cos(ang), 0, -Math.sin(ang)];
  const span = 1.95;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const ang = 2 * span * t;
    const front = Math.cos(ang * 0.85);
    const len = (0.12 + 0.2 * front * front) * k * tall * (i % 2 === 0 ? 1 : 0.82);
    const base = ring(ang, y0 + bh * 0.55, 0.006 * k);
    const dir = vnorm(vadd([0, 1, 0], vscale(outward(ang), 0.3 + 0.1 * Math.abs(t))));
    const tip = vadd(base, vscale(dir, len));
    const wu = (0.034 + 0.01 * front) * k;
    ctx.add(`crown_prong${i}`, new Shard(base, tip, wu, 0.013 * k, { side: tangent(ang), tu: 0.004 * k, tv: 0.0035 * k, root: 0.035 * k, round: 0.0025 * k }), 'head', { tags, w: 0.004, grip: 1.6 });
    if (i < n - 1) {
      const am = ang + span / (n - 1);
      const b2 = ring(am, y0 + bh * 0.7, 0.006 * k);
      const t2 = vadd(b2, vscale(vnorm(vadd([0, 1, 0], vscale(outward(am), 0.45))), 0.065 * k * tall));
      ctx.add(`crown_spike${i}`, new Shard(b2, t2, 0.017 * k, 0.011 * k, { side: tangent(am), tu: 0.003 * k, tv: 0.003 * k, root: 0.02 * k, round: 0.002 * k }), 'head', { tags, w: 0.004, grip: 1.6 });
    }
  }
  // brow gem in a gold bezel
  const gc = ring(0, y0 + bh * 0.42, -0.004 * k);
  ctx.add('crown_bezel', new Torus(gc, 0.03 * k, 0.0075 * k, [0, 0.12, 1]), 'head', { tags, w: 0.003, grip: 1.6 });
  ctx.add('crown_gem', new Ellipsoid(vadd(gc, [0, 0, 0.004 * k]), [0.026 * k, 0.032 * k, 0.017 * k]), 'head', { tags: [ctx.piece(e.s('gemMat', 'core')).tag], w: 0.003, grip: 1.6 });
}
