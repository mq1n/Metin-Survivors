// Curved flat plumes (feathers, rags, pennants) for the shaman / commander pieces: two flat cones through base -> mid -> tip so the
// blade droops instead of being a straight spindle. Pure geometry helpers, world metres.
import { type Vec3, vadd, vnorm, vscale } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { SmoothUnion } from '../../core/sdf/ops.ts';
import { flatCone } from '../../core/sdf/shapes.ts';

/** flat curved feather / rag: widest near the middle; `facing` = the normal of the broad face; `tipK` = tip half width as a fraction of `halfW` */
export function curvedFeather(base: Vec3, mid: Vec3, tip: Vec3, halfW: number, halfT: number, facing: Vec3 = [0, 0, 1], tipK = 0.1): Sdf {
  const flat = Math.min(1, halfT / halfW);
  return new SmoothUnion([
    { node: flatCone(base, mid, halfW * 0.62, halfW, flat, facing), w: halfT * 1.4 },
    { node: flatCone(mid, tip, halfW, halfW * tipK, flat, facing), w: halfT * 1.4 },
  ]);
}

/**
 * plume from `base` along `dir` for `len`, drooping toward `bend` (a direction; `droop` = tip offset as a fraction of len).
 * `facing` is the normal of the broad face (kept flat to the surface the plume lies on).
 */
export function plume(base: Vec3, dir: Vec3, len: number, halfW: number, halfT: number, facing: Vec3, bend: Vec3 = [0, -1, 0], droop = 0.3, tipK = 0.1): Sdf {
  const d = vnorm(dir), b = vnorm(bend);
  const mid = vadd(vadd(base, vscale(d, len * 0.52)), vscale(b, len * droop * 0.22));
  const tip = vadd(vadd(base, vscale(d, len)), vscale(b, len * droop));
  return curvedFeather(base, mid, tip, halfW, halfT, facing, tipK);
}
