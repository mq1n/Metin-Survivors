// Seeded, splittable, allocation-free PRNG (xoshiro128**).
// The sim NEVER touches Math.random / Date: every random decision goes through an Rng stream so that
// the co-op host, replays and the headless autoplayer are bit-for-bit deterministic.

/** splitmix32: used to expand seeds into xoshiro state words. */
function splitmix32(a: number): () => number {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** FNV-1a 32-bit hash of a string (stream labels). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface RngState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  /** root seed this stream descends from (for `fork`) */
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const sm = splitmix32(this.seed);
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /**
   * Derive an independent child stream from this stream's seed and a label. Does NOT consume this stream, so
   * adding or removing rolls in one system never perturbs another system's sequence.
   */
  fork(label: string | number): Rng {
    const l = typeof label === 'number' ? label >>> 0 : hashString(label);
    const sm = splitmix32((this.seed ^ Math.imul(l, 0x9e3779b1)) >>> 0);
    return new Rng(sm());
  }

  /** uniform uint32 */
  nextU32(): number {
    const s1 = this.s1;
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return r;
  }

  /** uniform float in [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** uniform integer in [0, n) */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** uniform integer in [lo, hi] inclusive */
  intRange(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** uniform float in [lo, hi) */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** uniform angle in [0, 2π) */
  angle(): number {
    return this.next() * 6.283185307179586;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** standard normal (Box–Muller, one value per call) */
  gauss(): number {
    let u = 0;
    while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * this.next());
  }

  pick<T>(arr: ArrayLike<T>): T {
    return arr[this.int(arr.length)] as T;
  }

  /** index drawn proportionally to `weights` (non-negative); -1 if all zero */
  weighted(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i] as number;
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** in-place Fisher–Yates */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = t;
    }
    return arr;
  }

  getState(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }

  setState(s: RngState): void {
    this.s0 = s.s0 | 0;
    this.s1 = s.s1 | 0;
    this.s2 = s.s2 | 0;
    this.s3 = s.s3 | 0;
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** Named streams used by the world. Each is an independent fork of the run seed. */
export interface RngStreams {
  spawn: Rng;
  combat: Rng;
  cards: Rng;
  loot: Rng;
  metin: Rng;
  boss: Rng;
  ai: Rng;
}

export function createStreams(seed: number): RngStreams {
  const root = new Rng(seed);
  return {
    spawn: root.fork('spawn'),
    combat: root.fork('combat'),
    cards: root.fork('cards'),
    loot: root.fork('loot'),
    metin: root.fork('metin'),
    boss: root.fork('boss'),
    ai: root.fork('ai'),
  };
}
