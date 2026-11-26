// RNG helpers for the meta layer. Meta runs outside the sim, so non-deterministic randomness is allowed at runtime
// (`systemRng`), but every rolling function takes a `MetaRng` so tests (and replays) can inject a seeded stream.

import type { MetaRng } from './types';

/** mulberry32: tiny, fast, well-distributed 32-bit seeded generator. */
export function seededRng(seed: number): MetaRng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Runtime RNG: crypto when available (unbiased, unseeded), else Math.random. */
export const systemRng: MetaRng = {
  next(): number {
    const c: Crypto | undefined = globalThis.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return (buf[0] as number) / 4294967296;
    }
    return Math.random();
  },
};

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

/** URL-safe random id of `length` chars (matches the API's run id charset `[A-Za-z0-9_-]`). */
export function randomId(rng: MetaRng, length = 22): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ID_ALPHABET[Math.floor(rng.next() * ID_ALPHABET.length)];
  return out;
}

/** Index drawn proportionally to non-negative `weights`; -1 when the total is 0. */
export function weightedIndex(rng: MetaRng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) return -1;
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] as number;
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return i;
  }
  return weights.length - 1;
}
