// Paint-only decorations: glowing rune lines (emissive) and skin tattoos. These add no geometry, only marks that the paint
// stage turns into albedo / emissive pixels.
import { type Vec3, vadd, vscale } from '../../../core/math.ts';
import { RoundCone } from '../../../core/sdf/primitives.ts';
import { tube } from '../../../core/sdf/shapes.ts';
import { Rng } from '../../../core/rng.ts';
import { limbEnv } from '../kit/limbs.ts';
import { Loft } from '../kit/loft.ts';
import type { Side } from '../params.ts';
import type { PieceEnv } from './util.ts';

const BOTH = [1, -1] as Side[];
const L = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

/** spiralling rune strokes along the sleeves (and a chest sigil): tag 'rune' */
export function runes(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/runes`);
  const arms = e.b('arms', true);
  const strokes = e.n('strokes', 7);
  if (arms) {
    for (const sx of BOTH) {
      const env = limbEnv(a, sx, 'arm');
      for (let i = 0; i < strokes; i++) {
        const u = 0.42 + (i / strokes) * 0.52;
        const ang0 = rng.range(0, Math.PI * 2);
        const pts: Vec3[] = [];
        const span = rng.range(0.9, 1.7);
        for (let k = 0; k <= 5; k++) {
          const ang = ang0 + (k / 5) * span;
          const uu = u + (k / 5) * 0.03;
          const c = env.at(uu);
          const r = env.r(uu) + 0.01 * s;
          // build a ring offset in the plane perpendicular to the arm axis (approximate with world axes)
          pts.push(vadd(c, [Math.cos(ang) * r, 0, Math.sin(ang) * r * 1.0]));
        }
        e.ctx.mark(`${e.spec.id}_arm${i}_${L(sx)}`, tube(pts, [[0, 0.0045 * s], [1, 0.0045 * s]], { segments: 5, w: 0.002 }), ['rune']);
      }
      // long line down the outer forearm
      const a0 = env.at(env.uMid + 0.06), a1 = env.at(0.95);
      e.ctx.mark(`${e.spec.id}_line_${L(sx)}`, new RoundCone(vadd(a0, [sx * (env.r(0.6) + 0.01 * s), 0, 0]), vadd(a1, [sx * (env.r(0.9) + 0.01 * s), 0, 0]), 0.0045 * s, 0.0045 * s), ['rune']);
    }
  }
  if (e.b('chest', true)) {
    const T = new Loft(a.torso);
    const y = a.chest[1] + 0.02 * s;
    const z = T.at(y).cz + T.at(y).rz + 0.02 * s;
    const mk = (p0: Vec3, p1: Vec3): void => {
      e.ctx.mark(`${e.spec.id}_sig${p0[0].toFixed(3)}${p1[1].toFixed(3)}`, new RoundCone(p0, p1, 0.0045 * s, 0.0045 * s), ['rune']);
    };
    mk([0, y + 0.08 * s, z], [0, y - 0.07 * s, z]);
    mk([-0.05 * s, y + 0.03 * s, z], [0.05 * s, y + 0.03 * s, z]);
    mk([-0.04 * s, y - 0.02 * s, z], [0, y + 0.08 * s, z]);
    mk([0.04 * s, y - 0.02 * s, z], [0, y + 0.08 * s, z]);
  }
  void vscale;
}

/** a dragon-coil tattoo band on the upper arms: tag 'ink' (painted dark, no geometry) */
export function tattoo(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const side = e.s('side', 'l');
  for (const sx of BOTH) {
    if (side !== 'both' && side !== L(sx)) continue;
    const env = limbEnv(a, sx, 'arm');
    const pts: Vec3[] = [];
    for (let k = 0; k <= 10; k++) {
      const u = 0.06 + (k / 10) * 0.42;
      const c = env.at(u);
      const ang = k * 0.95;
      const r = env.r(u) + 0.003 * s;
      pts.push(vadd(c, [Math.cos(ang) * r, Math.sin(ang * 0.5) * 0.0, Math.sin(ang) * r]));
    }
    e.ctx.mark(`${e.spec.id}_coil_${L(sx)}`, tube(pts, [[0, 0.007 * s], [0.5, 0.0055 * s], [1, 0.002 * s]], { segments: 10, w: 0.004 }), [e.trimTag, 'ink']);
  }
}

export const MAGIC = { runes, tattoo };
