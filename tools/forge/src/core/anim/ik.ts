import { type Quat, type Vec3, basisFromDirSide, qfromBasis, qinv, qmul, qrotate, vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../math.ts';

/**
 * Analytic two-bone IK. Returns the middle joint position for a chain root -> mid -> end of lengths l1, l2 reaching for
 * `target`, bending toward `pole` (a direction). The target is clamped to the reachable range; `reach` reports whether it was.
 */
export function twoBoneIK(root: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3): { mid: Vec3; end: Vec3; clamped: boolean } {
  const to = vsub(target, root);
  let d = vlen(to);
  const dir = d > 1e-9 ? vscale(to, 1 / d) : ([0, -1, 0] as Vec3);
  const maxD = (l1 + l2) * 0.9995, minD = Math.abs(l1 - l2) + 1e-4;
  let clamped = false;
  if (d > maxD) { d = maxD; clamped = true; }
  if (d < minD) { d = minD; clamped = true; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  // pole component perpendicular to the chain axis
  let perp = vsub(pole, vscale(dir, vdot(pole, dir)));
  if (vlen(perp) < 1e-6) perp = vcross(dir, [1, 0, 0]);
  perp = vnorm(perp);
  const mid = vadd(vadd(root, vscale(dir, a)), vscale(perp, h));
  const end = vadd(root, vscale(dir, d));
  return { mid, end, clamped };
}

/**
 * World rotation that takes a bone whose rest direction is `restDir` (side hint `restSide`) onto `newDir` (side `newSide`).
 * Both frames are orthonormalised, so twist is controlled by the side vectors.
 */
export function aimQuat(restDir: Vec3, restSide: Vec3, newDir: Vec3, newSide: Vec3): Quat {
  const b0 = basisFromDirSide(restDir, restSide);
  const b1 = basisFromDirSide(newDir, newSide);
  return qmul(qfromBasis(b1.x, b1.y, b1.z), qinv(qfromBasis(b0.x, b0.y, b0.z)));
}

/** convert a desired world rotation of a bone into its local rotation given the parent's world rotation */
export const localFromWorld = (parentWorld: Quat, world: Quat): Quat => qmul(qinv(parentWorld), world);

export { qrotate };
