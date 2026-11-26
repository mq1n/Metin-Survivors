// Conjurer ritual staff: bamboo-knotted shaft, wrapped grip and an armillary head (two crossed gold rings around a glowing orb, a flame
// finial, jingle rings and a red tassel). Built as SDF parts skinned rigidly to the wrist bone through the orc kit weapon frame
// (weapon +Y along the haft). Two crossed rings so the head reads as a full circle from every camera angle.
import type { Vec3 } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import type { Ctx } from '../humanoid/index.ts';
import { type WFrame, rc, spike } from '../orc/kit.ts';
import type { PropTags } from './props.ts';

export interface StaffOpts {
  /** shaft length above the palm (m, reference scale) */
  top?: number;
  /** shaft length below the palm */
  bottom?: number;
}

export function evoStaff(ctx: Ctx, f: WFrame, t: PropTags, o: StaffOpts = {}): void {
  const s = f.s;
  const top = o.top ?? 1.12;
  const bottom = o.bottom ?? 0.55;
  const P = (x: number, y: number, z: number): Vec3 => f.p(x * s, y * s, z * s);
  const add = (name: string, sdf: Sdf, tags: string[], w = 0.004, grip = 1.5): void => {
    ctx.add(`prop_${name}`, sdf, f.bone, { tags, w, grip });
  };
  add('shaft', rc(P(0, -bottom, 0), P(0, top, 0), 0.0225 * s, 0.019 * s), t.haft);
  add('ferrule', rc(P(0, -bottom - 0.02, 0), P(0, -bottom + 0.07, 0), 0.027 * s, 0.026 * s), t.metal);
  add('foot', spike(P(0, -bottom - 0.01, 0), P(0, -bottom - 0.12, 0), 0.026 * s, 0.004 * s), t.metal, 0.005);
  add('wrap', rc(P(0, -0.15, 0), P(0, 0.17, 0), 0.03 * s, 0.03 * s), t.wrap, 0.003);
  for (const y of [0.44, 0.78]) add(`node${y}`, rc(P(0, y - 0.016, 0), P(0, y + 0.016, 0), 0.03 * s, 0.03 * s), t.metal, 0.003);
  // neck collar
  add('neck', rc(P(0, top - 0.06, 0), P(0, top + 0.07, 0), 0.032 * s, 0.024 * s), t.metal, 0.004);
  const yc = top + 0.2;
  const R = 0.105;
  const C = P(0, yc, 0);
  add('ringA', new Torus(C, R * s, 0.0145 * s, f.d(1, 0, 0)), t.metal, 0.004);
  add('ringB', new Torus(C, R * 0.92 * s, 0.0125 * s, f.d(0, 0, 1)), t.metal, 0.004);
  add('orb', new Sphere(C, 0.05 * s), t.glow, 0.004);
  // posts joining the neck to the lower ring and the orb to the finial
  add('postLo', rc(P(0, top + 0.05, 0), P(0, yc - R + 0.004, 0), 0.016 * s, 0.014 * s), t.metal, 0.004);
  add('finial', spike(P(0, yc + R - 0.006, 0), P(0, yc + R + 0.15, 0), 0.024 * s, 0.004 * s), t.metal, 0.005);
  add('crown', new Sphere(P(0, yc + R + 0.012, 0), 0.02 * s), t.metal, 0.004);
  // jingle rings hanging from the lower arc of ring A
  for (const sg of [1, -1]) add(`jingle${sg}`, new Torus(P(0, yc - R - 0.006, sg * 0.062), 0.028 * s, 0.009 * s, f.d(1, 0, 0)), t.metal, 0.003);
  // tassel
  add('tassel', flatCone(P(0, yc - R - 0.02, 0), P(0.02, yc - R - 0.33, -0.02), 0.022 * s, 0.045 * s, 0.4, [1, 0, 0]), t.cloth, 0.004);
}
