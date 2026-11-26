// Small allocation-free helpers: visual RNG, colour packing, easing.

/** xorshift32 visual RNG. NOT the sim RNG — effects are cosmetic and may use any sequence. */
export class VRng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  seed(v: number): void {
    // spread arbitrary floats into a non-zero 32-bit state
    let h = (Math.floor(v * 4096) ^ 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
    this.s = (h ^ (h >>> 16)) >>> 0 || 1;
  }
  /** [0,1) */
  f(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  /** [a,b) */
  r(a: number, b: number): number {
    return a + (b - a) * this.f();
  }
  /** [-a,a) */
  s2(a: number): number {
    return (this.f() * 2 - 1) * a;
  }
  /** integer in [0,n) */
  i(n: number): number {
    return (this.f() * n) | 0;
  }
  /** stochastic rounding of a non-integer count */
  n(v: number): number {
    const b = Math.floor(v);
    return b + (this.f() < v - b ? 1 : 0);
  }
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0xRRGGBB + alpha 0..1 → packed little-endian RGBA8 (R lowest byte). */
export function rgba(hex: number, a = 1): number {
  const al = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0;
  return (((hex >> 16) & 255) | (((hex >> 8) & 255) << 8) | ((hex & 255) << 16) | (al << 24)) >>> 0;
}

/** Linear mix of two 0xRRGGBB colours. */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = (ar + (br - ar) * t + 0.5) | 0;
  const g = (ag + (bg - ag) * t + 0.5) | 0;
  const bl = (ab + (bb - ab) * t + 0.5) | 0;
  return (r << 16) | (g << 8) | bl;
}

/** Multiplies RGB by k (k>1 brightens toward white clamped). */
export function scaleHex(a: number, k: number): number {
  let r = ((a >> 16) & 255) * k;
  let g = ((a >> 8) & 255) * k;
  let b = (a & 255) * k;
  r = r > 255 ? 255 : r;
  g = g > 255 ? 255 : g;
  b = b > 255 ? 255 : b;
  return ((r + 0.5) << 16) | ((g + 0.5) << 8) | ((b + 0.5) | 0);
}

/** Parses '#rrggbb' / 'rrggbb' / number; returns -1 for anything else. */
export function parseColor(c: number | string | undefined | null): number {
  if (c === undefined || c === null) return -1;
  if (typeof c === 'number') return c < 0 ? -1 : c & 0xffffff;
  const s = c.charCodeAt(0) === 35 ? c.slice(1) : c;
  if (s.length !== 6) return -1;
  const v = parseInt(s, 16);
  return Number.isFinite(v) ? v : -1;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}
