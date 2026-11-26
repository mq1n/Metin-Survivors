// Deterministic helpers for world generation. Pure arithmetic only (no Math.sin/cos/exp/pow/log) in everything that
// feeds heights, walkability or blockers, so every JS engine (V8, JSC, SpiderMonkey) produces the same field and
// co-op host/guests agree bit-for-bit.

/** mulberry32: small, fast, good enough for layout scatter. */
export class WorldRng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** uniform [0,1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** pick an index by weights */
  weighted(weights: ArrayLike<number>): number {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += weights[i] as number;
    let r = this.next() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  /** derive an independent stream */
  fork(salt: number): WorldRng {
    return new WorldRng(hashInt(this.s ^ Math.imul(salt | 0, 0x85ebca6b)));
  }
}

/** 32-bit integer hash (lowbias32). */
export function hashInt(x: number): number {
  x = x | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** hash of a string → 32-bit seed (FNV-1a) */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Seed salt of a zone. The final name pass renamed every zone id; the salts stay pinned to the hashes of the original
 * ids so every zone keeps exactly the ground it had (terrain field, rivers, landmarks, scatter, grass tufts).
 */
const ZONE_SEED_SALT: Readonly<Record<string, number>> = { daeryeol: 0x5667ef8e, suryeon: 0xc1d13d54, seori: 0x3d89debe, yeonmu: 0x5fc0cb49 };

/** hashString(zoneId), except for the renamed zones whose original salt is pinned above */
export function zoneSeedSalt(zoneId: string): number {
  return ZONE_SEED_SALT[zoneId] ?? hashString(zoneId);
}

/** hash of an integer lattice point → [0,1) */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = hashInt(h);
  return h / 4294967296;
}
