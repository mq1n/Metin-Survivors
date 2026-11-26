// Shared outfit piece of the esoteric family (PieceSpec.build function: `{ id, mat, build: waistSash, o: {...} }`); the model-specific pieces
// live in ascetic_pieces.ts, zealot_pieces.ts and conjurer_pieces.ts. World rest pose, +Z forward, parts skinned to the bone that carries the surface.
import { Ellipsoid } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import { Loft, type PieceEnv } from '../humanoid/index.ts';
import { torsoShellBand } from '../humanoid/outfit/soft.ts';

/** skirt bone for a hanging panel (falls back to the pelvis on rigs without skirt bones) */
const skirtBone = (e: PieceEnv, which: 'f' | 'b' | 'l' | 'r'): string => (e.a.p.rig?.skirt ? `skirt_${which}` : 'pelvis');

/**
 * Waist sash: a wide wrapped band with a knot at one hip and two long tails hanging from it. o: y, width, ext, side (1 = left), tail
 */
export function waistSash(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.04) * s;
  const hh = e.n('width', 0.058) * s;
  const ext = e.n('ext', 0.024) * s;
  const side: 1 | -1 = e.n('side', 1) >= 0 ? 1 : -1;
  for (const sh of torsoShellBand(a, y - hh, y + hh, ext)) e.ctx.add(`${e.spec.id}_band_${sh.bone}`, sh.sdf, sh.bone, { tags: e.tag(e.mat), w: 0.006 });
  // second, thinner wrap over the top edge, slightly proud: reads as a layered fold
  for (const sh of torsoShellBand(a, y + hh * 0.35, y + hh + 0.02 * s, ext + 0.007 * s)) e.ctx.add(`${e.spec.id}_fold_${sh.bone}`, sh.sdf, sh.bone, { tags: e.tag(e.mat), w: 0.006 });
  const front = new Loft(a.torso).at(y);
  const kx = side * 0.1 * s, kz = front.cz + front.rz * 0.92;
  e.ctx.add(`${e.spec.id}_knot`, new Ellipsoid([kx, y - 0.004 * s, kz + 0.03 * s], [0.04 * s, 0.036 * s, 0.03 * s]), 'spine', { tags: e.tag(e.mat), w: 0.006 });
  const tl = e.n('tail', 0.5) * s;
  const bone = skirtBone(e, side === 1 ? 'l' : 'r');
  const fb = skirtBone(e, 'f');
  // two tails: a long one falling beside the thigh, a shorter one tucked in front
  e.ctx.add(`${e.spec.id}_tailA`, flatCone([kx + side * 0.012 * s, y - 0.02 * s, kz + 0.03 * s], [kx + side * 0.075 * s, y - tl, kz + 0.02 * s], 0.036 * s, 0.03 * s, 0.35, [1, 0, 0]), bone, { tags: e.tag(e.mat), w: 0.005 });
  e.ctx.add(`${e.spec.id}_tailB`, flatCone([kx - side * 0.016 * s, y - 0.02 * s, kz + 0.035 * s], [kx - side * 0.012 * s, y - tl * 0.7, kz + 0.06 * s], 0.032 * s, 0.028 * s, 0.35, [0, 0, 1]), fb, { tags: e.tag(e.mat), w: 0.005 });
  e.ctx.mark(`${e.spec.id}_trim_top`, new Loft(a.torso.map((q) => ({ y: q.y, rx: q.rx + ext + 0.002 * s, rz: q.rz + ext + 0.002 * s, cz: q.cz, n: (q.n ?? 2) + 0.3 })), { range: [y + hh - 0.012 * s, y + hh] }), [e.trimTag]);
}
