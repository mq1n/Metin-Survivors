// DEV-only helpers shared by the procedural placeholder factory: deterministic RNG, hashing, value noise, easing.

export type Vec3 = readonly [number, number, number];
export type RGB = readonly [number, number, number];

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** FNV-1a 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG with a few helpers (mulberry32). */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** symmetric jitter: base * (1 ± amount) */
  jitter(base: number, amount: number): number {
    return base * (1 + (this.next() * 2 - 1) * amount);
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T;
  }
}

function hash3i(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1]. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = hash3i(xi, yi, zi, seed);
  const c100 = hash3i(xi + 1, yi, zi, seed);
  const c010 = hash3i(xi, yi + 1, zi, seed);
  const c110 = hash3i(xi + 1, yi + 1, zi, seed);
  const c001 = hash3i(xi, yi, zi + 1, seed);
  const c101 = hash3i(xi + 1, yi, zi + 1, seed);
  const c011 = hash3i(xi, yi + 1, zi + 1, seed);
  const c111 = hash3i(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Fractal value noise in [0,1]. */
export function fbm3(x: number, y: number, z: number, octaves = 3, seed = 0): number {
  let a = 0.5;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise3(x * f, y * f, z * f, seed + i * 17);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Periodic 2D value noise (period `p` lattice cells) for tileable textures. */
export function tileNoise2(x: number, y: number, p: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wrap = (n: number): number => ((n % p) + p) % p;
  const a = hash3i(wrap(xi), wrap(yi), 0, seed);
  const b = hash3i(wrap(xi + 1), wrap(yi), 0, seed);
  const c = hash3i(wrap(xi), wrap(yi + 1), 0, seed);
  const d = hash3i(wrap(xi + 1), wrap(yi + 1), 0, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function tileFbm2(x: number, y: number, period: number, octaves: number, seed = 0): number {
  let a = 0.5;
  let sum = 0;
  let norm = 0;
  let p = period;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += a * tileNoise2(x * f, y * f, p, seed + i * 31);
    norm += a;
    a *= 0.5;
    f *= 2;
    p *= 2;
  }
  return sum / norm;
}

export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function easeOut(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) * (1 - x);
}

/** piecewise-linear remap of u over [a,b] to 0..1 (clamped) */
export function seg(u: number, a: number, b: number): number {
  return clamp((u - a) / (b - a), 0, 1);
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Hermite spline through (t, v) keys (t ascending). Zero-velocity ends; interior tangents are finite differences, so
 * motion flows through keys but still overshoots a little for lively anticipation/follow-through. Clamped outside.
 */
export function curve(u: number, keys: readonly (readonly [number, number])[]): number {
  const n = keys.length;
  const first = keys[0] as readonly [number, number];
  const last = keys[n - 1] as readonly [number, number];
  if (u <= first[0]) return first[1];
  if (u >= last[0]) return last[1];
  let i = 0;
  while (i < n - 2 && u > (keys[i + 1] as readonly [number, number])[0]) i++;
  const k0 = keys[i] as readonly [number, number];
  const k1 = keys[i + 1] as readonly [number, number];
  const h = k1[0] - k0[0];
  const t = (u - k0[0]) / h;
  const tangent = (j: number): number => {
    if (j <= 0 || j >= n - 1) return 0;
    const a = keys[j - 1] as readonly [number, number];
    const b = keys[j + 1] as readonly [number, number];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  const m0 = tangent(i) * h;
  const m1 = tangent(i + 1) * h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * k0[1] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * k1[1] + (t3 - t2) * m1;
}
