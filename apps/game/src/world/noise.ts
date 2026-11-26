// Seeded 2D gradient noise built from integer hashes and + − × ÷ only (no trig), so results are identical on all
// JS engines. Range of `noise2` ≈ [-1, 1]; `fbm` is normalised to ≈ [-1, 1].
import { hashInt } from './rng';

// 8 unit-ish gradient directions (components pre-scaled, no runtime normalisation needed).
const GX = [1, -1, 1, -1, 0.7071, -0.7071, 0.7071, -0.7071];
const GZ = [0, 0, 0.0001, -0.0001, 0.7071, 0.7071, -0.7071, -0.7071];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Perlin-style gradient noise at (x,z) for a given integer seed. */
export function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const s = Math.imul(seed | 0, 0x9e3779b1);
  const g00 = hashInt(Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ s) & 7;
  const g10 = hashInt(Math.imul(ix + 1, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ s) & 7;
  const g01 = hashInt(Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz + 1, 0x165667b1) ^ s) & 7;
  const g11 = hashInt(Math.imul(ix + 1, 0x27d4eb2d) ^ Math.imul(iz + 1, 0x165667b1) ^ s) & 7;
  const n00 = (GX[g00] as number) * fx + (GZ[g00] as number) * fz;
  const n10 = (GX[g10] as number) * (fx - 1) + (GZ[g10] as number) * fz;
  const n01 = (GX[g01] as number) * fx + (GZ[g01] as number) * (fz - 1);
  const n11 = (GX[g11] as number) * (fx - 1) + (GZ[g11] as number) * (fz - 1);
  const u = fade(fx);
  const v = fade(fz);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.41;
}

/** Fractal Brownian motion, normalised to ≈[-1,1]. */
export function fbm(x: number, z: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq + i * 17.31, z * freq - i * 9.77, seed + i * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal in [0,1]: sharp crests (mountains, crystal ridges). */
export function ridged(x: number, z: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq + i * 23.1, z * freq + i * 5.3, seed + i * 211));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Cellular (worley) F1 distance in cell units, with the id of the nearest feature point hashed to [0,1). */
export function worley(x: number, z: number, seed: number, out: { d: number; id: number }): void {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let best = 1e9;
  let id = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cz = iz + dz;
      const h = hashInt(Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cz, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1));
      const px = cx + (h & 0xffff) / 65536;
      const pz = cz + (h >>> 16) / 65536;
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < best) {
        best = d;
        id = h;
      }
    }
  }
  out.d = Math.sqrt(best);
  out.id = id / 4294967296;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Distance from point to segment (ax,az)-(bx,bz); optionally returns the segment parameter t in `tOut.t`. */
export function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  tOut?: { t: number },
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (tOut) tOut.t = t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

/** Polyline helper: min distance + arc-length position of the closest point. */
export class Polyline {
  readonly lengths: number[] = [0];
  readonly total: number;

  constructor(readonly pts: ReadonlyArray<readonly [number, number]>) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as readonly [number, number];
      const b = pts[i] as readonly [number, number];
      acc += Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
      this.lengths.push(acc);
    }
    this.total = acc;
  }

  private readonly tmp = { t: 0 };

  /** returns the distance to the polyline; `along` receives the arc length of the closest point (m). */
  distance(px: number, pz: number, along?: { s: number }): number {
    let best = 1e18;
    let bestS = 0;
    const pts = this.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as readonly [number, number];
      const b = pts[i] as readonly [number, number];
      const d = distToSegment(px, pz, a[0], a[1], b[0], b[1], this.tmp);
      if (d < best) {
        best = d;
        bestS = (this.lengths[i - 1] as number) + ((this.lengths[i] as number) - (this.lengths[i - 1] as number)) * this.tmp.t;
      }
    }
    if (along) along.s = bestS;
    return best;
  }
}

/** Catmull-Rom subdivision of a control polyline into `perSeg` points per segment (smooth rivers/roads). */
export function smoothPath(ctrl: ReadonlyArray<readonly [number, number]>, perSeg = 8): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)] as readonly [number, number];
    const p1 = ctrl[i] as readonly [number, number];
    const p2 = ctrl[i + 1] as readonly [number, number];
    const p3 = ctrl[Math.min(n - 1, i + 2)] as readonly [number, number];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push([(ctrl[n - 1] as readonly [number, number])[0], (ctrl[n - 1] as readonly [number, number])[1]]);
  return out;
}
