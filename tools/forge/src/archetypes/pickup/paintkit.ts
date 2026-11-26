// Paint helpers shared by the pickup models: colour mixing (linear), seeded noise / grain, small hash utilities.
import { Noise } from '../../core/noise.ts';
import { type Rgb, mixRgb, rgb } from '../../core/paint/painter.ts';

export { mixRgb, rgb };
export type { Rgb };

/** deterministic [0,1) hash of an integer (plank ids, facet ids, ...) */
export function hash1(n: number): number {
  let h = (n | 0) * 374761393 + 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** value multiply in linear space */
export function mul(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** write into `out` */
export function set(out: Rgb, c: Rgb): void {
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
}

/** out = mix(a, b, t) without allocating */
export function setMix(out: Rgb, a: Rgb, b: Rgb, t: number): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** out *= k (value) */
export function scaleOut(out: Rgb, k: number): void {
  out[0] *= k; out[1] *= k; out[2] *= k;
}

/** shift towards a tint: out = mix(out, tint, t) */
export function tintOut(out: Rgb, tint: Rgb, t: number): void {
  out[0] += (tint[0] - out[0]) * t;
  out[1] += (tint[1] - out[1]) * t;
  out[2] += (tint[2] - out[2]) * t;
}

/** noise bundle with the helpers the painters use */
export class Grain {
  readonly n: Noise;
  constructor(seed: number | string) {
    this.n = new Noise(seed);
  }
  /** smooth noise in ~[-1,1] */
  at(x: number, y: number, z: number): number {
    return this.n.noise(x, y, z);
  }
  /** fbm in ~[-1,1] */
  fbm(x: number, y: number, z: number, octaves = 3): number {
    return this.n.fbm(x, y, z, { octaves });
  }
  /** wood-like streaks: long along `axis` (0 x, 1 y, 2 z), fine across */
  streak(x: number, y: number, z: number, axis: 0 | 1 | 2, across = 60, along = 4): number {
    const sx = axis === 0 ? along : across, sy = axis === 1 ? along : across, sz = axis === 2 ? along : across;
    return this.n.fbm(x * sx, y * sy, z * sz, { octaves: 2 });
  }
}
