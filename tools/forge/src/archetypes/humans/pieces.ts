// Custom outfit pieces for the human enemies (use with `PieceSpec.build`, or `registerHumanPieces()` once for id lookup).
//   lamellarVest   horizontal rows of laced lacquer plates over the torso (+ optional shoulder yoke)
//   wrapHelm       cloth-wrapped cap: dome, diagonal wraps, knot and trailing tail
import { type Vec3, vlerp } from '../../core/math.ts';
import { SmoothIntersect } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, Torus } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import { type PieceEnv, boxClip, cover, slabY, torsoShell } from '../humanoid/index.ts';
import { rigid } from './kit.ts';

const TORSO = ['torso_', 'pec_', 'lat_', 'abs', 'clavicle_'];

/**
 * Lamellar vest: a conforming torso cover plus `rows` stacked bands that alternately protrude, so the silhouette reads as
 * laced plate rows (the paint adds scale lines and red lacing). Options: rows, low (m below the waist joint), ext, step.
 */
export function lamellarVest(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rows = e.n('rows', 7);
  const ext = e.n('ext', 0.012) * s;
  const step = e.n('step', 0.0045) * s;
  const y0 = a.spine[1] + e.n('low', -0.05) * s;
  const yTop = a.torso[a.torso.length - 3]!.y + e.n('top', 0.0) * s;
  const base = slabY(y0, yTop);
  cover(e, TORSO, ext, { clip: base, trim: [slabY(yTop - 0.01 * s, yTop), slabY(y0, y0 + 0.01 * s)], grip: 1.4, w: 0.006 });
  const pitch = (yTop - y0) / rows;
  for (let i = 0; i < rows; i++) {
    const yb = y0 + i * pitch;
    const k = ext + step * (1 + (i % 2));
    for (const sh of torsoShell(a, yb + pitch * 0.04, yb + pitch * 0.96, k, { n: 2.9 })) {
      e.ctx.add(`${e.spec.id}_row${i}_${sh.bone}`, sh.sdf, sh.bone, { tags: e.tag(e.mat, 'lames'), w: 0.003, grip: 1.4 });
    }
  }
  if (e.b('yoke', true)) {
    // shoulder straps / collar lames over the trapezius
    cover(e, ['trap_', 'clavicle_'], ext + 0.006 * s, { clip: boxClip([0, yTop + 0.02 * s, 0], [0.3 * s, 0.06 * s, 0.3 * s]), name: '_yoke', grip: 1.4, w: 0.006 });
  }
}

/**
 * Cloth-wrapped cap: a dome over the cranium, `wraps` diagonal cloth bands, a front knot and a trailing tail.
 * Options: wraps (3), tail (0.2 m), knotSide (+1 left / -1 right / 0 none), brim (m above the skull centre).
 */
export function wrapHelm(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const brimY = sk[1] + e.n('brim', 0.025) * k;
  cover(e, ['cranium'], 0.015 * k, {
    clip: boxClip([sk[0], (brimY + sk[1] + 0.2 * k) / 2, sk[2]], [0.3 * k, (sk[1] + 0.2 * k - brimY) / 2, 0.3 * k]),
    trim: [boxClip([sk[0], brimY + 0.006 * k, sk[2]], [0.3 * k, 0.006 * k, 0.3 * k])], grip: 1.5, w: 0.005,
  });
  const wraps = e.n('wraps', 3);
  for (let i = 0; i < wraps; i++) {
    const t = wraps === 1 ? 0 : i / (wraps - 1) - 0.5;
    const tilt = t * 0.9;
    // wraps circle the head, tilted so they cross at the front like a wound turban
    e.ctx.add(`${e.spec.id}_wrap${i}`, new Torus([sk[0], brimY + 0.026 * k + 0.012 * k * i, sk[2] - 0.006 * k], (0.101 - 0.005 * i) * k, 0.0125 * k, [Math.sin(tilt) * 0.5, 1, -0.08 + t * 0.5]), 'head', { tags: e.tag(e.mat, 'wrap'), w: 0.004, grip: 1.5 });
  }
  const knot = e.n('knotSide', 1);
  if (knot !== 0) {
    const c: Vec3 = [knot * 0.085 * k, brimY + 0.02 * k, sk[2] + 0.07 * k];
    e.ctx.add(`${e.spec.id}_knot`, new Ellipsoid(c, [0.024 * k, 0.02 * k, 0.02 * k]), 'head', { tags: e.tag(e.mat, 'wrap'), w: 0.006, grip: 1.5 });
    e.ctx.add(`${e.spec.id}_knotTail`, flatCone(c, [c[0] + knot * 0.03 * k, c[1] - 0.14 * k, c[2] + 0.01 * k], 0.02 * k, 0.012 * k, 0.3, [1, 0, 0]), 'head', { tags: e.tag(e.mat, 'strip'), w: 0.005 });
  }
  const tl = e.n('tail', 0.2);
  if (tl > 0) {
    const base: Vec3 = [0, brimY + 0.01 * k, sk[2] - 0.1 * k];
    const bone = a.layout.hair ? a.layout.hair.bones[0]! : 'head';
    e.ctx.add(`${e.spec.id}_tail`, flatCone(base, [0.01 * k, base[1] - tl * k * 1.1, base[2] - 0.05 * k], 0.04 * k, 0.025 * k, 0.28, [1, 0, 0]), bone, { tags: e.tag(e.mat, 'strip'), w: 0.006 });
  }
  void vlerp; void rigid; void RoundCone; void SmoothIntersect;
}
