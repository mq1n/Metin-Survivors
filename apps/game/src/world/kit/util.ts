// World kit (C7) shared helpers: deterministic trig stand-ins, smoothed paths with arc length, a baked scalar grid.
// Everything here obeys the recipe determinism rule (world/recipe.ts): only + − × ÷ sqrt floor abs min max and the
// helpers of noise.ts / rng.ts, so the same input gives the same bits on every JS engine (co-op host and guests agree).
import { hashInt } from '../rng';
import type { Vec2 } from './types';

export const TAU = 6.283185307179586;
export const PI = 3.141592653589793;
export const HALF_PI = 1.5707963267948966;

/** angle folded into [-PI, PI] */
function fold(a: number): number {
  return a - TAU * Math.floor(a / TAU + 0.5);
}

/** sin(a) (radians) as a polynomial: identical on every engine, |error| < 1e-7. */
export function dsin(a: number): number {
  let x = fold(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const s = x * x;
  return x * (1 + s * (-1 / 6 + s * (1 / 120 + s * (-1 / 5040 + s * (1 / 362880 - s / 39916800)))));
}

/** cos(a) (radians) as a polynomial (see dsin). */
export function dcos(a: number): number {
  return dsin(a + HALF_PI);
}

/** atan2(y, x) as a polynomial: identical on every engine, |error| < 2e-5 rad. */
export function datan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const mx = Math.max(ax, ay);
  if (mx < 1e-300) return 0;
  const t = Math.min(ax, ay) / mx;
  const s = t * t;
  let r = t * (0.99997726 + s * (-0.33262347 + s * (0.19354346 + s * (-0.11643287 + s * (0.05265332 - s * 0.0117212)))));
  if (ay > ax) r = HALF_PI - r;
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

/** Prop / rock yaw that turns the local +Z (a prop's front, a gate's passage) towards (dx, dz). */
export function yawToward(dx: number, dz: number): number {
  return datan2(dx, dz);
}

/** Unit vector (x, z) at angle `a` (radians, measured from +x towards +z). */
export function dirAt(a: number): [number, number] {
  return [dcos(a), dsin(a)];
}

/** (dx, dz) scaled to unit length; (0, 1) for a zero vector. */
export function unit(dx: number, dz: number): [number, number] {
  const l = Math.sqrt(dx * dx + dz * dz);
  return l > 1e-12 ? [dx / l, dz / l] : [0, 1];
}

/** Independent 32-bit sub-seed of `seed` for `salt` (kit modules never share a stream). */
export function subSeed(seed: number, salt: number): number {
  return hashInt((seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1));
}

// ------------------------------------------------------------------------------------------------------------ paths

/**
 * Centripetal Catmull-Rom through the control points (no cusps or loops on uneven spacing), resampled every `step` m
 * of arc length. The first and last control points are kept exactly.
 */
export function smoothCurve(ctrl: ReadonlyArray<Vec2>, step = 2): Vec2[] {
  const n = ctrl.length;
  if (n === 0) return [];
  if (n === 1) return [[(ctrl[0] as Vec2)[0], (ctrl[0] as Vec2)[1]]];
  const dense: Vec2[] = [];
  const P = (i: number): Vec2 => {
    if (i < 0) {
      const a = ctrl[0] as Vec2;
      const b = ctrl[1] as Vec2;
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    if (i > n - 1) {
      const a = ctrl[n - 1] as Vec2;
      const b = ctrl[n - 2] as Vec2;
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    return ctrl[i] as Vec2;
  };
  // knot spacing |Pi+1 − Pi|^0.5 (centripetal), guarded against coincident points
  const knot = (a: Vec2, b: Vec2): number => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    return Math.max(1e-4, Math.sqrt(Math.sqrt(dx * dx + dz * dz)));
  };
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const sx = p2[0] - p1[0];
    const sz = p2[1] - p1[1];
    const len = Math.sqrt(sx * sx + sz * sz);
    const k = Math.max(1, Math.ceil(len / Math.max(0.25, step * 0.5)));
    for (let q = 0; q < k; q++) {
      const t = t1 + ((t2 - t1) * q) / k;
      const a1x = ((t1 - t) * p0[0] + (t - t0) * p1[0]) / (t1 - t0);
      const a1z = ((t1 - t) * p0[1] + (t - t0) * p1[1]) / (t1 - t0);
      const a2x = ((t2 - t) * p1[0] + (t - t1) * p2[0]) / (t2 - t1);
      const a2z = ((t2 - t) * p1[1] + (t - t1) * p2[1]) / (t2 - t1);
      const a3x = ((t3 - t) * p2[0] + (t - t2) * p3[0]) / (t3 - t2);
      const a3z = ((t3 - t) * p2[1] + (t - t2) * p3[1]) / (t3 - t2);
      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
      const b1z = ((t2 - t) * a1z + (t - t0) * a2z) / (t2 - t0);
      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
      const b2z = ((t3 - t) * a2z + (t - t1) * a3z) / (t3 - t1);
      dense.push([((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1), ((t2 - t) * b1z + (t - t1) * b2z) / (t2 - t1)]);
    }
  }
  dense.push([(ctrl[n - 1] as Vec2)[0], (ctrl[n - 1] as Vec2)[1]]);
  return resample(dense, step);
}

/** Polyline resampled at a uniform arc-length `step` (first and last points kept; the last gap may be shorter). */
export function resample(pts: ReadonlyArray<Vec2>, step: number): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts.map((p) => [p[0], p[1]] as Vec2);
  let total = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    total += Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
  }
  const first = pts[0] as Vec2;
  const last = pts[n - 1] as Vec2;
  if (total < 1e-9) return [[first[0], first[1]], [last[0], last[1]]];
  const count = Math.max(1, Math.round(total / step));
  const ds = total / count;
  const out: Vec2[] = [[first[0], first[1]]];
  let seg = 1;
  let segStart = 0;
  let a = first;
  let b = pts[1] as Vec2;
  let segLen = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
  for (let k = 1; k < count; k++) {
    const s = ds * k;
    while (segStart + segLen < s && seg < n - 1) {
      segStart += segLen;
      seg++;
      a = pts[seg - 1] as Vec2;
      b = pts[seg] as Vec2;
      segLen = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    }
    const t = segLen > 1e-12 ? Math.min(1, Math.max(0, (s - segStart) / segLen)) : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push([last[0], last[1]]);
  return out;
}

/** A point on a path: position and unit tangent. */
export interface PathPoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/** Polyline with arc length: point / tangent at arc length s, nearest point and distance (bbox early-out). */
export class Path2 {
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** cumulative arc length per vertex (m) */
  readonly s: Float64Array;
  readonly n: number;
  readonly total: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  constructor(pts: ReadonlyArray<Vec2>) {
    const n = pts.length;
    this.n = n;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.s = new Float64Array(n);
    let acc = 0;
    let minX = 1e18;
    let maxX = -1e18;
    let minZ = 1e18;
    let maxZ = -1e18;
    for (let i = 0; i < n; i++) {
      const p = pts[i] as Vec2;
      this.x[i] = p[0];
      this.z[i] = p[1];
      if (i > 0) {
        const dx = p[0] - (this.x[i - 1] as number);
        const dz = p[1] - (this.z[i - 1] as number);
        acc += Math.sqrt(dx * dx + dz * dz);
      }
      this.s[i] = acc;
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    this.total = acc;
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
  }

  /** index i and fraction t of the segment i..i+1 that holds arc length s (clamped) */
  private locate(s: number, o: { i: number; t: number }): void {
    const n = this.n;
    if (n < 2) {
      o.i = 0;
      o.t = 0;
      return;
    }
    const c = s < 0 ? 0 : s > this.total ? this.total : s;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.s[mid] as number) <= c) lo = mid;
      else hi = mid;
    }
    const s0 = this.s[lo] as number;
    const seg = (this.s[lo + 1] as number) - s0;
    o.i = lo;
    o.t = seg > 1e-12 ? (c - s0) / seg : 0;
  }

  private readonly loc = { i: 0, t: 0 };

  /** position + unit tangent at arc length s (clamped to the path) */
  at(s: number, out: PathPoint): PathPoint {
    if (this.n === 1) {
      out.x = this.x[0] as number;
      out.z = this.z[0] as number;
      out.tx = 0;
      out.tz = 1;
      return out;
    }
    this.locate(s, this.loc);
    const i = this.loc.i;
    const t = this.loc.t;
    const ax = this.x[i] as number;
    const az = this.z[i] as number;
    const dx = (this.x[i + 1] as number) - ax;
    const dz = (this.z[i + 1] as number) - az;
    const l = Math.sqrt(dx * dx + dz * dz);
    out.x = ax + dx * t;
    out.z = az + dz * t;
    out.tx = l > 1e-12 ? dx / l : 0;
    out.tz = l > 1e-12 ? dz / l : 1;
    return out;
  }

  /** linear interpolation of a per-vertex value at arc length s */
  lerpAt(values: ArrayLike<number>, s: number): number {
    if (this.n === 1) return values[0] as number;
    this.locate(s, this.loc);
    const a = values[this.loc.i] as number;
    return a + ((values[this.loc.i + 1] as number) - a) * this.loc.t;
  }

  /**
   * Distance from (px, pz) to the polyline; `out.s` = arc length of the closest point. `cutoff`: points whose bbox
   * distance exceeds it return early with a value ≥ cutoff (out.s is then 0).
   */
  nearest(px: number, pz: number, out?: { s: number }, cutoff = Infinity): number {
    const bx = px < this.minX ? this.minX - px : px > this.maxX ? px - this.maxX : 0;
    const bz = pz < this.minZ ? this.minZ - pz : pz > this.maxZ ? pz - this.maxZ : 0;
    if (cutoff !== Infinity && bx * bx + bz * bz > cutoff * cutoff) {
      if (out) out.s = 0;
      return Math.sqrt(bx * bx + bz * bz);
    }
    const n = this.n;
    if (n === 1) {
      if (out) out.s = 0;
      const dx = px - (this.x[0] as number);
      const dz = pz - (this.z[0] as number);
      return Math.sqrt(dx * dx + dz * dz);
    }
    let best = 1e36;
    let bestS = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = this.x[i] as number;
      const az = this.z[i] as number;
      const dx = (this.x[i + 1] as number) - ax;
      const dz = (this.z[i + 1] as number) - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - px;
      const qz = az + dz * t - pz;
      const d2 = qx * qx + qz * qz;
      if (d2 < best) {
        best = d2;
        bestS = (this.s[i] as number) + ((this.s[i + 1] as number) - (this.s[i] as number)) * t;
      }
    }
    if (out) out.s = bestS;
    return Math.sqrt(best);
  }

  /** the vertices as (x, z) pairs */
  points(): Vec2[] {
    const out: Vec2[] = [];
    for (let i = 0; i < this.n; i++) out.push([this.x[i] as number, this.z[i] as number]);
    return out;
  }
}

// ------------------------------------------------------------------------------------------------------- baked grid

/** A scalar field baked on a regular grid (bilinear lookups; outside the grid the edge value is clamped). */
export interface BakedGrid {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly values: Float32Array;
  at(x: number, z: number): number;
  /** true when (x, z) lies inside the baked rectangle */
  covers(x: number, z: number): boolean;
}

/**
 * Bakes `fn` on a grid over [x0, x1] × [z0, z1] with `cell` m spacing (an expensive height / mask term evaluated once
 * per node instead of once per height + paint + surface + scatter query). Lookups are bilinear.
 */
export function bakeGrid(x0: number, z0: number, x1: number, z1: number, cell: number, fn: (x: number, z: number) => number): BakedGrid {
  const nx = Math.max(2, Math.ceil((x1 - x0) / cell) + 1);
  const nz = Math.max(2, Math.ceil((z1 - z0) / cell) + 1);
  const values = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = fn(x0 + i * cell, z0 + j * cell);
  const xMax = x0 + (nx - 1) * cell;
  const zMax = z0 + (nz - 1) * cell;
  return {
    x0,
    z0,
    cell,
    nx,
    nz,
    values,
    covers: (x, z) => x >= x0 && x <= xMax && z >= z0 && z <= zMax,
    at(x, z) {
      let fx = (x - x0) / cell;
      let fz = (z - z0) / cell;
      fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
      fz = fz < 0 ? 0 : fz > nz - 1 ? nz - 1 : fz;
      let i = Math.floor(fx);
      let j = Math.floor(fz);
      if (i >= nx - 1) i = nx - 2;
      if (j >= nz - 1) j = nz - 2;
      const tx = fx - i;
      const tz = fz - j;
      const o = j * nx + i;
      const a = (values[o] as number) + ((values[o + 1] as number) - (values[o] as number)) * tx;
      const b = (values[o + nx] as number) + ((values[o + nx + 1] as number) - (values[o + nx] as number)) * tx;
      return a + (b - a) * tz;
    },
  };
}
