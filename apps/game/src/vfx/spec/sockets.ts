// Body sockets for anchored skill elements (pure math, no three.js: runs in tests).
// A socket SET = 8 sockets × 8 floats [x, y, z, len, qx, qy, qz, qw] (world position, blade length for `weapon`, world
// orientation quaternion). Sets 0..3 = players (fed every frame by the render world from the skinned hero), sets
// 4..31 = per-instance stand-in bodies (galleries / compare strips). The GPU reads them from rows 2-3 of the anchor
// texture at texel `set × 8 + id`.
import type { SocketName, StandInPose, StandInSwing } from './types';

export const SOCKET_ID: Readonly<Record<SocketName, number>> = { root: 1, hand_r: 2, hand_l: 3, weapon: 4, head: 5, chest: 6 };
/** socket names in id order (index = id − 1) */
export const SOCKET_NAMES: readonly SocketName[] = ['root', 'hand_r', 'hand_l', 'weapon', 'head', 'chest'];
export const SOCKET_STRIDE = 8;
export const SOCKETS_PER_SET = 8;
export const SET_FLOATS = SOCKET_STRIDE * SOCKETS_PER_SET;
/** sets 0..PLAYER_SETS-1 belong to players, the rest are stand-ins */
export const PLAYER_SETS = 4;
export const SOCKET_SETS = 32;

export function isSocket(v: unknown): v is SocketName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SOCKET_ID, v);
}

/** anchor texel of a socket (row 2 = position, row 3 = quaternion) */
export function socketTexel(set: number, sock: SocketName): number {
  return set * SOCKETS_PER_SET + SOCKET_ID[sock];
}

// ------------------------------------------------------------------------------------------------ quaternions

/** rotates v (3 floats at v[vo]) by quaternion q (4 floats at q[qo]) into out[oo] */
export function qrot(q: ArrayLike<number>, qo: number, vx: number, vy: number, vz: number, out: Float32Array | number[], oo: number): void {
  const x = q[qo] as number, y = q[qo + 1] as number, z = q[qo + 2] as number, w = q[qo + 3] as number;
  // t = 2 q.xyz × v ; v' = v + w t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[oo] = vx + w * tx + (y * tz - z * ty);
  out[oo + 1] = vy + w * ty + (z * tx - x * tz);
  out[oo + 2] = vz + w * tz + (x * ty - y * tx);
}

/** quaternion of the rotation whose columns are the unit basis vectors X, Y, Z (written to out[o..o+3]) */
export function quatFromBasis(
  xx: number, xy: number, xz: number,
  yx: number, yy: number, yz: number,
  zx: number, zy: number, zz: number,
  out: Float32Array | number[], o: number,
): void {
  // matrix m[row][col]: m00 = xx, m10 = xy, m20 = xz (column X) …
  const m00 = xx, m01 = yx, m02 = zx;
  const m10 = xy, m11 = yy, m12 = zy;
  const m20 = xz, m21 = yz, m22 = zz;
  const tr = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  out[o] = qx;
  out[o + 1] = qy;
  out[o + 2] = qz;
  out[o + 3] = qw;
}

/** yaw (rotation about +Y, 0 = facing +Z) of a quaternion's forward axis */
export function quatYaw(q: ArrayLike<number>, qo: number): number {
  const x = q[qo] as number, y = q[qo + 1] as number, z = q[qo + 2] as number, w = q[qo + 3] as number;
  // forward = q * (0, 0, 1)
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz);
}

/** writes one socket entry: position, blade length, yaw-only orientation */
export function writeYawSocket(out: Float32Array, o: number, x: number, y: number, z: number, yaw: number, len = 0): void {
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = len;
  out[o + 4] = 0;
  out[o + 5] = Math.sin(yaw * 0.5);
  out[o + 6] = 0;
  out[o + 7] = Math.cos(yaw * 0.5);
}

// ------------------------------------------------------------------------------------------------ stand-in body

/** stand-in socket offsets in the caster frame (+Z forward, +Y up, −X right), metres: a ~2 m hero at the game's scale */
export const STAND_IN: Readonly<Record<Exclude<SocketName, 'weapon'>, readonly [number, number, number]>> = {
  root: [0, 0, 0],
  hand_r: [-0.3, 1.05, 0.25],
  hand_l: [0.3, 1.05, 0.2],
  head: [0, 1.8, 0.05],
  chest: [0, 1.4, 0.1],
};
export const STAND_IN_BLADE = 0.95;
/** default scripted slash: right-back → left-front in 0.32 s, blade slightly down */
export const STAND_IN_SWING: Required<StandInSwing> = { t0: 0, dur: 0.32, from: -120, to: 60, pitch: -12 };

const DEG = Math.PI / 180;

/**
 * Samples a pose track (`n` frames of `k` numbers at `fps`) at clip time `t` into out[0..k): linear between frames, the first / last frame held;
 * for k = 7 (position + quaternion) the quaternion takes the shortest arc and is renormalised.
 */
export function samplePose(arr: ArrayLike<number>, k: number, n: number, fps: number, t: number, out: Float32Array | number[]): void {
  const f = t <= 0 || n < 2 ? 0 : Math.min(t * fps, n - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, n - 1);
  const u = f - i0;
  const a = i0 * k, b = i1 * k;
  for (let c = 0; c < k; c++) out[c] = (arr[a + c] as number) + ((arr[b + c] as number) - (arr[a + c] as number)) * u;
  if (k === 7) {
    let dot = 0;
    for (let c = 3; c < 7; c++) dot += (arr[a + c] as number) * (arr[b + c] as number);
    if (dot < 0) for (let c = 3; c < 7; c++) out[c] = (arr[a + c] as number) + (-(arr[b + c] as number) - (arr[a + c] as number)) * u;
    const l = Math.hypot(out[3] as number, out[4] as number, out[5] as number, out[6] as number) || 1;
    for (let c = 3; c < 7; c++) out[c] = (out[c] as number) / l;
  }
}

const poseTmp = new Float32Array(7);








function applyPose(out: Float32Array, base: number, x: number, y: number, z: number, yaw: number, t: number, pose: StandInPose): void {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cw = Math.cos(yaw * 0.5), sw = Math.sin(yaw * 0.5);
  for (const name of SOCKET_NAMES) {
    const tr = name === 'root' ? undefined : pose.sockets[name];
    if (!tr) continue;
    samplePose(tr, 7, pose.n, pose.fps, t, poseTmp);
    const o = base + SOCKET_ID[name] * SOCKET_STRIDE;
    const lx = poseTmp[0] as number, ly = poseTmp[1] as number, lz = poseTmp[2] as number;
    const full = name === 'weapon' || pose.orient === 'bone';
    const qx = full ? (poseTmp[3] as number) : 0, qy = full ? (poseTmp[4] as number) : 0, qz = full ? (poseTmp[5] as number) : 0, qw = full ? (poseTmp[6] as number) : 1;
    out[o] = x + cy * lx + sy * lz;
    out[o + 1] = y + ly;
    out[o + 2] = z - sy * lx + cy * lz;
    out[o + 3] = name === 'weapon' ? (pose.bladeLen ?? STAND_IN_BLADE) : 0;
    out[o + 4] = cw * qx + sw * qz;
    out[o + 5] = cw * qy + sw * qw;
    out[o + 6] = cw * qz - sw * qx;
    out[o + 7] = cw * qw - sw * qy;
  }
}








export function standInSockets(out: Float32Array, base: number, x: number, y: number, z: number, yaw: number, t: number, mirror: number, swing?: StandInSwing, pose?: StandInPose): void {
  const m = mirror < 0 ? -1 : 1;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const put = (id: number, lx: number, ly: number, lz: number): void => {
    const o = base + id * SOCKET_STRIDE;
    writeYawSocket(out, o, x + cy * lx * m + sy * lz, y + ly, z - sy * lx * m + cy * lz, yaw);
  };
  for (const name of SOCKET_NAMES) {
    if (name === 'weapon' || name === 'hand_r') continue;
    const p = STAND_IN[name];
    put(SOCKET_ID[name], p[0], p[1], p[2]);
  }
  const sw = swing ?? STAND_IN_SWING;
  const t0 = sw.t0 ?? STAND_IN_SWING.t0, dur = Math.max(0.01, sw.dur ?? STAND_IN_SWING.dur);
  const a0 = (sw.from ?? STAND_IN_SWING.from) * DEG, a1 = (sw.to ?? STAND_IN_SWING.to) * DEG;
  const ph = (sw.pitch ?? STAND_IN_SWING.pitch) * DEG;
  let u = (t - t0) / dur;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  u = u * u * (3 - 2 * u);
  const th = (a0 + (a1 - a0) * u) * m;
  const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
  // hand on an arc around the chest, blade continuing outward
  const ch = STAND_IN.chest;
  const gx = ch[0] + 0.45 * st, gy = ch[1] - 0.25, gz = ch[2] + 0.45 * ct;
  // local (caster frame) blade axis Y, cutting edge Z (direction of travel), flat normal X = Y × Z
  const bx = st * cp, by = sp, bz = ct * cp;
  const dirS = (a1 >= a0 ? 1 : -1) * m;
  let ex = ct * dirS, ez = -st * dirS;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el;
  ez /= el;
  // Gram-Schmidt the edge against the blade (the blade pitches)
  const d = ex * bx + ez * bz;
  let zx = ex - d * bx, zy = -d * by, zz = ez - d * bz;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  const xx = by * zz - bz * zy, xy = bz * zx - bx * zz, xz = bx * zy - by * zx;
  // to world: rotate every axis by the caster yaw
  const W = (lx: number, lz: number): [number, number] => [cy * lx + sy * lz, -sy * lx + cy * lz];
  const [gwx, gwz] = W(gx, gz);
  const [Bx, Bz] = W(bx, bz);
  const [Zx, Zz] = W(zx, zz);
  const [Xx, Xz] = W(xx, xz);
  // grip = hand_r
  const ho = base + SOCKET_ID.hand_r * SOCKET_STRIDE;
  writeYawSocket(out, ho, x + gwx, y + gy, z + gwz, yaw);
  const wo = base + SOCKET_ID.weapon * SOCKET_STRIDE;
  out[wo] = x + gwx + Bx * STAND_IN_BLADE;
  out[wo + 1] = y + gy + by * STAND_IN_BLADE;
  out[wo + 2] = z + gwz + Bz * STAND_IN_BLADE;
  out[wo + 3] = STAND_IN_BLADE;
  quatFromBasis(Xx, xy, Xz, Bx, by, Bz, Zx, zy, Zz, out, wo + 4);
  if (pose) applyPose(out, base, x, y, z, yaw, t, pose);
}
