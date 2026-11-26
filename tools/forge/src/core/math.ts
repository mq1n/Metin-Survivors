// Small, allocation-friendly math helpers for the forge. Tuples keep authoring code terse;
// hot loops (SDF evaluation, meshing) use raw numbers instead.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x y z w
/** Column-major 4x4 (glTF / three.js layout). */
export type Mat4 = number[];

export const DEG = Math.PI / 180;
export const deg = (d: number): number => d * DEG;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const remap = (x: number, a0: number, a1: number, b0: number, b1: number): number => b0 + ((x - a0) / (a1 - a0)) * (b1 - b0);
export const fract = (x: number): number => x - Math.floor(x);

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vmul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const vdot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const vdist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const vnorm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vmin = (a: Vec3, b: Vec3): Vec3 => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
export const vmax = (a: Vec3, b: Vec3): Vec3 => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
/** mirror across the X=0 plane */
export const vmirror = (a: Vec3): Vec3 => [-a[0], a[1], a[2]];

// ---------------------------------------------------------------- quaternions
export const QIDENT: Quat = [0, 0, 0, 1];
export const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qnorm = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
export const qinv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export const qaxis = (axis: Vec3, angle: number): Quat => {
  const n = vnorm(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
};
export const qx = (a: number): Quat => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
export const qy = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
export const qz = (a: Quat[0]): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
/** Euler angles in radians, applied X then Y then Z in the *parent* frame (q = qz * qy * qx). */
export const qeuler = (x: number, y: number, z: number): Quat => qmul(qz(z), qmul(qy(y), qx(x)));
export const qrotate = (q: Quat, v: Vec3): Vec3 => {
  // v + 2w(q×v) + 2 q×(q×v)
  const [qx_, qy_, qz_, qw] = q;
  const tx = 2 * (qy_ * v[2] - qz_ * v[1]);
  const ty = 2 * (qz_ * v[0] - qx_ * v[2]);
  const tz = 2 * (qx_ * v[1] - qy_ * v[0]);
  return [v[0] + qw * tx + (qy_ * tz - qz_ * ty), v[1] + qw * ty + (qz_ * tx - qx_ * tz), v[2] + qw * tz + (qx_ * ty - qy_ * tx)];
};
export const qslerp = (a: Quat, b: Quat, t: number): Quat => {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb: Quat = b;
  if (cos < 0) {
    cos = -cos;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (cos > 0.9995) {
    return qnorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  }
  const th = Math.acos(cos);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
};
/** shortest-arc rotation taking unit vector a onto unit vector b */
export const qfromTo = (a: Vec3, b: Vec3): Quat => {
  const d = vdot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    // 180°: any perpendicular axis
    const ax: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return qaxis(vnorm(vcross(a, ax)), Math.PI);
  }
  const c = vcross(a, b);
  return qnorm([c[0], c[1], c[2], 1 + d]);
};

// ---------------------------------------------------------------- matrices (column-major)
export const m4identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const m4translation = (t: Vec3): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
export const m4fromQuat = (q: Quat, t: Vec3 = [0, 0, 0]): Mat4 => {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, t[0], t[1], t[2], 1];
};
export const m4mul = (a: Mat4, b: Mat4): Mat4 => {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  }
  return o;
};
/** inverse of a rigid (rotation + translation) matrix */
export const m4rigidInverse = (m: Mat4): Mat4 => {
  const r00 = m[0]!, r01 = m[4]!, r02 = m[8]!, r10 = m[1]!, r11 = m[5]!, r12 = m[9]!, r20 = m[2]!, r21 = m[6]!, r22 = m[10]!;
  const tx = m[12]!, ty = m[13]!, tz = m[14]!;
  return [r00, r01, r02, 0, r10, r11, r12, 0, r20, r21, r22, 0, -(r00 * tx + r10 * ty + r20 * tz), -(r01 * tx + r11 * ty + r21 * tz), -(r02 * tx + r12 * ty + r22 * tz), 1];
};
export const m4transformPoint = (m: Mat4, p: Vec3): Vec3 => [
  m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
  m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
  m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
];

/** Quaternion from an orthonormal basis (columns x,y,z). */
export const qfromBasis = (x: Vec3, y: Vec3, z: Vec3): Quat => {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qnorm(q);
};

/** Orthonormal basis whose Y axis follows `dir` and X axis is as close as possible to `side`. */
export const basisFromDirSide = (dir: Vec3, side: Vec3): { x: Vec3; y: Vec3; z: Vec3 } => {
  const y = vnorm(dir);
  let x = vsub(side, vscale(y, vdot(side, y)));
  if (vlen(x) < 1e-6) x = vcross(y, Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  x = vnorm(x);
  const z = vcross(x, y);
  return { x, y, z };
};

// ---------------------------------------------------------------- AABB
export interface Aabb {
  min: Vec3;
  max: Vec3;
}
export const aabbExpand = (b: Aabb, m: number): Aabb => ({ min: [b.min[0] - m, b.min[1] - m, b.min[2] - m], max: [b.max[0] + m, b.max[1] + m, b.max[2] + m] });
export const aabbUnion = (a: Aabb, b: Aabb): Aabb => ({ min: vmin(a.min, b.min), max: vmax(a.max, b.max) });
