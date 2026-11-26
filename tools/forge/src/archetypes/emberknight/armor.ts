// Ember plate: custom outfit pieces (PieceSpec.build) for the lacquered, ember-lit warrior-demon armour.
//   emberHelm  kabuto dome + brow band + nasal bar + flared cheek wings + stacked nape plates + two swept horns + a fan of flame blades
import { type Vec3, vadd, vnorm, vscale } from '../../core/math.ts';
import { Torus } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import { Plate } from '../humanoid/kit/plate.ts';
import { type PieceEnv, boxClip, cover } from '../humanoid/outfit/util.ts';
import { Shard } from '../ember/shard.ts';

const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

export interface HelmOpts {
  /** crest blade count and size */
  crest?: number;
  crestSize?: number;
  /** horn length multiplier (0 = none) */
  horns?: number;
}

/** kabuto-style demon helm over the head's cranium. Piece options (o): crest, crestSize, horns */
export function emberHelm(e: PieceEnv): void {
  const { a, ctx } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const ext = 0.014 * k;
  const brimY = sk[1] + 0.05 * k;
  const topY = sk[1] + 0.22 * k;
  const domeClip = boxClip([sk[0], (brimY + topY) / 2, sk[2]], [0.3 * k, (topY - brimY) / 2, 0.3 * k]);
  const brimTrim = boxClip([sk[0], brimY + 0.006 * k, sk[2]], [0.3 * k, 0.006 * k, 0.3 * k]);
  cover(e, ['cranium', 'forehead'], ext, { clip: domeClip, trim: [brimTrim], grip: 1.6, w: 0.005 });
  ctx.add(`${e.spec.id}_brim`, new Torus([sk[0], brimY + 0.002 * k, sk[2] - 0.01 * k], 0.1 * k, 0.0085 * k, [0, 1, -0.1]), 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
  // brow band (curved strip over the eyes) + nasal bar
  const brow = new Plate({ o: [sk[0], sk[1] + 0.034 * k, sk[2] + 0.1 * k], nrm: [0, 0.18, 1], up: [0, 1, 0.1], hu: 0.088 * k, hv: 0.017 * k, R: 0.092 * k, t: 0.013 * k, round: 0.004 * k, edgeThin: 0.7 });
  ctx.add(`${e.spec.id}_brow`, brow, 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
  ctx.mark(`${e.spec.id}_browTrim`, brow.rim(0.006 * k), [e.trimTag]);
  ctx.add(`${e.spec.id}_nasal`, new Plate({ o: [sk[0], sk[1] + 0.0 * k, sk[2] + 0.118 * k], nrm: [0, 0.08, 1], up: [0, 1, 0], hu: 0.013 * k, hv: 0.04 * k, R: 0, t: 0.011 * k, round: 0.004 * k, taper: 0.35 }), 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
  // flared cheek wings
  for (const sx of BOTH) {
    const p = new Plate({ o: [sk[0] + sx * 0.098 * k, sk[1] - 0.015 * k, sk[2] - 0.004 * k], nrm: [sx, 0.1, -0.25], up: [0, 1, 0], hu: 0.06 * k, hv: 0.058 * k, R: 0.07 * k, t: 0.011 * k, round: 0.004 * k, taper: -0.3, edgeThin: 0.7 });
    ctx.add(`${e.spec.id}_cheek_${L(sx)}`, p, 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
    ctx.mark(`${e.spec.id}_cheekTrim_${L(sx)}`, p.rim(0.006 * k), [e.trimTag]);
  }
  // nape plates flaring out behind the head
  for (let i = 0; i < 3; i++) {
    const y = brimY - 0.03 * k - i * 0.034 * k;
    const w = (0.098 + 0.016 * i) * k;
    const p = new Plate({ o: [0, y, sk[2] - 0.085 * k - 0.014 * k * i], nrm: [0, -0.1 * (i + 1), -1], up: [0, 1, 0], hu: w * 1.4, hv: 0.021 * k, R: 0.105 * k + 0.01 * k * i, t: 0.009 * k, round: 0.0035 * k, bow: 0.006 * k });
    ctx.add(`${e.spec.id}_nape${i}`, p, 'head', { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
    ctx.mark(`${e.spec.id}_napeTrim${i}`, p.rim(0.005 * k), [e.trimTag]);
  }
  // horns: sweep out of the temples, rise and hook forward like a crescent
  const hornLen = e.n('horns', 1);
  const horn = ctx.piece(e.s('hornMat', 'gold'));
  if (hornLen > 0) {
    for (const sx of BOTH) {
      const b: Vec3 = [sk[0] + sx * 0.075 * k, brimY + 0.01 * k, sk[2] + 0.03 * k];
      const m1: Vec3 = [sk[0] + sx * 0.15 * k * hornLen, brimY + 0.03 * k, sk[2] + 0.035 * k];
      const m2: Vec3 = [sk[0] + sx * 0.215 * k * hornLen, brimY + 0.1 * k * hornLen, sk[2] + 0.045 * k];
      const t: Vec3 = [sk[0] + sx * 0.2 * k * hornLen, brimY + 0.2 * k * hornLen, sk[2] + 0.09 * k];
      ctx.add(`${e.spec.id}_horn_${L(sx)}`, tube([b, m1, m2, t], [[0, 0.022 * k], [0.55, 0.015 * k], [1, 0.005 * k]], { segments: 7, w: 0.006 }), 'head', { tags: [horn.tag, 'horn'], w: 0.006, grip: 1.6 });
    }
  }
  // flame blade fan along the crown: tall broad faceted blades swept back
  const n = Math.round(e.n('crest', 5));
  const size = e.n('crestSize', 1);
  const flame = ctx.piece('flame');
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const lean = (t - 0.35) * 1.5;
    const baseY = brimY + 0.08 * k;
    const base: Vec3 = [sk[0], baseY + 0.03 * k * Math.cos(t * 3), sk[2] + 0.075 * k - 0.15 * k * t];
    const len = (0.17 + 0.17 * Math.sin(Math.PI * (0.15 + 0.7 * t))) * k * size;
    const dir = vnorm([0, Math.cos(lean * 0.9), -Math.sin(lean * 0.9)]);
    const tip = vadd(base, vscale(dir, len));
    ctx.add(`${e.spec.id}_flame${i}`, new Shard(base, tip, 0.03 * k * size, 0.0125 * k * size, { side: [1, 0, 0], tu: 0.007 * k, tv: 0.006 * k, root: 0.03 * k, bow: 0.04 * (i % 2 === 0 ? 1 : -1) }), 'head', { tags: [flame.tag], w: 0.008, grip: 1.6 });
  }
}
