// Re-exports of the core math plus a few humanoid helpers (kept local so core stays untouched).
import { type Quat, type Vec3, qmul, qrotate, vadd, vnorm, vscale, vsub } from '../../core/math.ts';

export * from '../../core/math.ts';

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** point at `t` along a -> b */
export const along = (a: Vec3, b: Vec3, t: number): Vec3 => lerp3(a, b, t);

/** a + dir * dist (dir need not be unit) */
export const offs = (a: Vec3, dir: Vec3, dist: number): Vec3 => vadd(a, vscale(vnorm(dir), dist));

/** component-wise add of a plain triple */
export const add3 = (a: Vec3, x: number, y: number, z: number): Vec3 => [a[0] + x, a[1] + y, a[2] + z];

/** rotate `v` by quaternion `q` then translate by `t` */
export const xf = (q: Quat, v: Vec3, t: Vec3): Vec3 => vadd(qrotate(q, v), t);

/** unit direction from a to b */
export const dirTo = (a: Vec3, b: Vec3): Vec3 => vnorm(vsub(b, a));

export { qmul };
