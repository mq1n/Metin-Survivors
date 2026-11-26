// Seeded splittable PRNG (xoshiro128**): determinism, fork independence, distribution quality, state save/restore.

import { describe, expect, it } from 'vitest';
import { createStreams, hashString, Rng, type RngState } from '../rng';

// ---------------------------------------------------------------------------
// independent reference implementations (standard algorithms, written from the published definitions)

function refSplitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** reference xoshiro128** (Blackman & Vigna) over an explicit 4-word state */
function refXoshiro(state: [number, number, number, number]): () => number {
  const s = Uint32Array.from(state);
  const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = Math.imul(rotl(Math.imul(s[1] as number, 5) >>> 0, 7), 9) >>> 0;
    const t = ((s[1] as number) << 9) >>> 0;
    s[2] = (s[2] as number) ^ (s[0] as number);
    s[3] = (s[3] as number) ^ (s[1] as number);
    s[1] = (s[1] as number) ^ (s[2] as number);
    s[0] = (s[0] as number) ^ (s[3] as number);
    s[2] = (s[2] as number) ^ t;
    s[3] = rotl(s[3] as number, 11);
    return result;
  };
}

function draw(r: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r.next());
  return out;
}

function drawU32(r: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r.nextU32());
  return out;
}

function chiSquare(counts: readonly number[], expected: number): number {
  let x = 0;
  for (const c of counts) x += ((c - expected) * (c - expected)) / expected;
  return x;
}

describe('hashString (FNV-1a 32)', () => {
  it('matches the published FNV-1a test vectors', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });

  it('is deterministic and returns an unsigned 32-bit integer', () => {
    for (const s of ['spawn', 'combat', 'cards', 'loot', 'metin', 'boss', 'ai', 'ünïcödé', 'x'.repeat(500)]) {
      const h = hashString(s);
      expect(h).toBe(hashString(s));
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
    expect(hashString('spawn')).not.toBe(hashString('combat'));
  });
});

describe('Rng determinism', () => {
  it('same seed gives the identical sequence', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    expect(drawU32(a, 5000)).toEqual(drawU32(b, 5000));
  });

  it('different seeds give different sequences', () => {
    const seqs = [0, 1, 2, 3, 1234, 0xffffffff].map((s) => drawU32(new Rng(s), 8).join(','));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('adjacent seeds are decorrelated (first outputs share no obvious structure)', () => {
    let equalFirst = 0;
    let prev = new Rng(0).nextU32();
    for (let s = 1; s < 500; s++) {
      const v = new Rng(s).nextU32();
      if (v === prev) equalFirst++;
      prev = v;
    }
    expect(equalFirst).toBe(0);
  });

  it('normalises the seed to uint32', () => {
    expect(new Rng(-1).seed).toBe(0xffffffff);
    expect(drawU32(new Rng(-1), 16)).toEqual(drawU32(new Rng(0xffffffff), 16));
    expect(drawU32(new Rng(2 ** 32 + 7), 16)).toEqual(drawU32(new Rng(7), 16));
  });

  it('the all-zero seed does not produce a stuck all-zero stream', () => {
    const r = new Rng(0);
    const vals = drawU32(r, 64);
    expect(new Set(vals).size).toBeGreaterThan(60);
  });

  it('seeds its state words from splitmix32 (replay compatibility)', () => {
    for (const seed of [0, 1, 42, 1234, 0xdeadbeef]) {
      const sm = refSplitmix32(seed);
      const expected = [sm(), sm(), sm(), sm()];
      const st = new Rng(seed).getState();
      expect([st.s0 >>> 0, st.s1 >>> 0, st.s2 >>> 0, st.s3 >>> 0]).toEqual(expected);
    }
  });

  it('is exactly xoshiro128** on a hand-checked state', () => {
    // state {1,2,3,4}: first output = rotl(2*5, 7) * 9 = 1280 * 9 = 11520
    const r = new Rng(0);
    r.setState({ s0: 1, s1: 2, s2: 3, s3: 4 });
    expect(r.nextU32()).toBe(11520);
  });

  it('matches a reference xoshiro128** over a long run from several seeds', () => {
    for (const seed of [1, 99, 1234, 0xcafef00d]) {
      const r = new Rng(seed);
      const st = r.getState();
      const ref = refXoshiro([st.s0 >>> 0, st.s1 >>> 0, st.s2 >>> 0, st.s3 >>> 0]);
      for (let i = 0; i < 3000; i++) {
        const got = r.nextU32();
        const want = ref();
        if (got !== want) throw new Error(`seed ${seed}: draw ${i}: got ${got}, want ${want}`);
      }
    }
  });
});

describe('Rng primitives', () => {
  it('nextU32 stays in [0, 2^32) and is an integer', () => {
    const r = new Rng(7);
    for (let i = 0; i < 20000; i++) {
      const v = r.nextU32();
      if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`bad u32 ${v}`);
    }
  });

  it('next() is in [0, 1) and equals nextU32 / 2^32', () => {
    const a = new Rng(9);
    const b = new Rng(9);
    for (let i = 0; i < 20000; i++) {
      const f = a.next();
      expect(f).toBe(b.nextU32() / 4294967296);
      if (!(f >= 0 && f < 1)) throw new Error(`next() out of range: ${f}`);
    }
  });

  it('int(n) is in [0, n) and int(1) is always 0', () => {
    const r = new Rng(11);
    for (const n of [1, 2, 3, 7, 10, 100, 1000]) {
      for (let i = 0; i < 2000; i++) {
        const v = r.int(n);
        if (!Number.isInteger(v) || v < 0 || v >= n) throw new Error(`int(${n}) = ${v}`);
      }
    }
    for (let i = 0; i < 100; i++) expect(r.int(1)).toBe(0);
  });

  it('intRange(lo, hi) is inclusive on both ends and covers every value', () => {
    const r = new Rng(12);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.intRange(-3, 4);
      if (!Number.isInteger(v) || v < -3 || v > 4) throw new Error(`intRange = ${v}`);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3, 4]);
    for (let i = 0; i < 100; i++) expect(r.intRange(5, 5)).toBe(5);
  });

  it('range(lo, hi) is in [lo, hi)', () => {
    const r = new Rng(13);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const v = r.range(-2.5, 7.5);
      if (v < -2.5 || v >= 7.5) throw new Error(`range = ${v}`);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(-2.4);
    expect(max).toBeGreaterThan(7.4);
  });

  it('chance(p): 0 never, 1 always, and the hit rate tracks p', () => {
    const r = new Rng(14);
    for (let i = 0; i < 1000; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
    for (const p of [0.05, 0.3, 0.5, 0.9]) {
      let hits = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) if (r.chance(p)) hits++;
      const sigma = Math.sqrt(n * p * (1 - p));
      expect(Math.abs(hits - n * p)).toBeLessThan(5 * sigma);
    }
  });

  it('angle() is in [0, 2π) and covers the circle', () => {
    const r = new Rng(15);
    const quadrants = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) {
      const a = r.angle();
      if (a < 0 || a >= Math.PI * 2) throw new Error(`angle = ${a}`);
      quadrants[Math.floor(a / (Math.PI / 2))]!++;
    }
    for (const q of quadrants) expect(Math.abs(q - 2000)).toBeLessThan(5 * Math.sqrt(8000 * 0.25 * 0.75));
  });

  it('sign() returns only ±1, roughly balanced', () => {
    const r = new Rng(16);
    let plus = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const s = r.sign();
      if (s !== 1 && s !== -1) throw new Error(`sign = ${s}`);
      if (s === 1) plus++;
    }
    expect(Math.abs(plus - n / 2)).toBeLessThan(5 * Math.sqrt(n * 0.25));
  });

  it('gauss() is standard normal (mean ≈ 0, variance ≈ 1) and finite', () => {
    const r = new Rng(17);
    const n = 40000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const g = r.gauss();
      if (!Number.isFinite(g)) throw new Error(`gauss = ${g}`);
      sum += g;
      sq += g * g;
    }
    const mean = sum / n;
    const variance = sq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });

  it('pick() returns members and reaches all of them', () => {
    const r = new Rng(18);
    const items = ['a', 'b', 'c', 'd'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(r.pick(items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(r.pick([42])).toBe(42);
  });

  it('shuffle() permutes in place, returns the same array and is deterministic', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = new Rng(19).shuffle(arr);
    expect(out).toBe(arr);
    expect([...arr].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const again = new Rng(19).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(again).toEqual(arr);
    expect(new Rng(20).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).not.toEqual(arr);
    expect(new Rng(1).shuffle([])).toEqual([]);
    expect(new Rng(1).shuffle(['x'])).toEqual(['x']);
  });

  it('shuffle() is uniform over all permutations of 5 elements (chi-square)', () => {
    const r = new Rng(21);
    const counts = new Map<string, number>();
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const key = r.shuffle([0, 1, 2, 3, 4]).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(120);
    // df = 119: the 0.1% critical value is ≈ 161
    expect(chiSquare([...counts.values()], n / 120)).toBeLessThan(161);
  });
});

describe('Rng uniformity', () => {
  it('int(10) passes a chi-square test for several seeds', () => {
    for (const seed of [1, 2, 3, 1234, 99999]) {
      const r = new Rng(seed);
      const counts = new Array<number>(10).fill(0);
      const n = 100000;
      for (let i = 0; i < n; i++) counts[r.int(10)]!++;
      // df = 9: the 0.1% critical value is ≈ 27.9
      expect(chiSquare(counts, n / 10)).toBeLessThan(27.9);
    }
  });

  it('next() has mean ≈ 0.5, variance ≈ 1/12 and a flat 20-bucket histogram', () => {
    const r = new Rng(31);
    const n = 100000;
    let sum = 0;
    let sq = 0;
    const buckets = new Array<number>(20).fill(0);
    for (let i = 0; i < n; i++) {
      const v = r.next();
      sum += v;
      sq += v * v;
      buckets[Math.floor(v * 20)]!++;
    }
    const mean = sum / n;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.005);
    expect(Math.abs(sq / n - mean * mean - 1 / 12)).toBeLessThan(0.003);
    // df = 19: the 0.1% critical value is ≈ 43.8
    expect(chiSquare(buckets, n / 20)).toBeLessThan(43.8);
  });

  it('every bit of nextU32 is set about half the time', () => {
    const r = new Rng(32);
    const n = 40000;
    const ones = new Array<number>(32).fill(0);
    for (let i = 0; i < n; i++) {
      const v = r.nextU32();
      for (let b = 0; b < 32; b++) if ((v >>> b) & 1) ones[b]!++;
    }
    for (let b = 0; b < 32; b++) expect(Math.abs(ones[b]! - n / 2)).toBeLessThan(5 * Math.sqrt(n * 0.25));
  });

  it('consecutive outputs are not correlated (lag-1 serial correlation ≈ 0)', () => {
    const r = new Rng(33);
    const n = 50000;
    let prev = r.next();
    let sxy = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      const cur = r.next();
      sx += prev;
      sy += cur;
      sxy += prev * cur;
      sxx += prev * prev;
      syy += cur * cur;
      prev = cur;
    }
    const cov = sxy / n - (sx / n) * (sy / n);
    const corr = cov / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
    expect(Math.abs(corr)).toBeLessThan(0.02);
  });
});

describe('Rng.weighted', () => {
  it('draws indices proportionally to the weights', () => {
    const r = new Rng(41);
    const weights = [60, 25, 10, 4, 1];
    const counts = new Array<number>(weights.length).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) counts[r.weighted(weights)]!++;
    const total = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) {
      const p = weights[i]! / total;
      expect(Math.abs(counts[i]! - n * p)).toBeLessThan(5 * Math.sqrt(n * p * (1 - p)));
    }
  });

  it('never selects a zero-weight index', () => {
    const r = new Rng(42);
    const w = [0, 3, 0, 1, 0];
    for (let i = 0; i < 20000; i++) {
      const k = r.weighted(w);
      if (k !== 1 && k !== 3) throw new Error(`picked zero-weight index ${k}`);
    }
    for (let i = 0; i < 200; i++) expect(r.weighted([0, 0, 5])).toBe(2);
    for (let i = 0; i < 200; i++) expect(r.weighted([5, 0, 0])).toBe(0);
  });

  it('returns -1 when the total weight is zero or the list is empty', () => {
    const r = new Rng(43);
    expect(r.weighted([0, 0, 0])).toBe(-1);
    expect(r.weighted([])).toBe(-1);
  });

  it('accepts typed arrays and is deterministic', () => {
    const w = new Float32Array([1, 2, 3, 4]);
    const a = new Rng(44);
    const b = new Rng(44);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 500; i++) {
      seqA.push(a.weighted(w));
      seqB.push(b.weighted([1, 2, 3, 4]));
    }
    expect(seqA).toEqual(seqB);
    expect(Math.min(...seqA)).toBe(0);
    expect(Math.max(...seqA)).toBe(3);
  });

  it('consumes exactly one draw per call', () => {
    const a = new Rng(45);
    const b = new Rng(45);
    a.weighted([1, 2, 3]);
    b.next();
    expect(a.nextU32()).toBe(b.nextU32());
  });
});

describe('Rng.fork', () => {
  it('does not consume the parent stream', () => {
    const control = new Rng(77);
    const parent = new Rng(77);
    for (const label of ['spawn', 'combat', 'cards', 'x', 1, 2, 3, 0]) parent.fork(label);
    expect(drawU32(parent, 200)).toEqual(drawU32(control, 200));
  });

  it('does not depend on how far the parent has advanced (derives from the seed)', () => {
    const early = new Rng(77).fork('combat');
    const advanced = new Rng(77);
    drawU32(advanced, 1000);
    const late = advanced.fork('combat');
    expect(drawU32(late, 100)).toEqual(drawU32(early, 100));
  });

  it('is deterministic per (seed, label) and distinct across labels and seeds', () => {
    expect(drawU32(new Rng(5).fork('spawn'), 50)).toEqual(drawU32(new Rng(5).fork('spawn'), 50));
    const heads = new Set<string>();
    for (const label of ['spawn', 'combat', 'cards', 'loot', 'metin', 'boss', 'ai', 0, 1, 2, 'a', 'b']) {
      heads.add(drawU32(new Rng(5).fork(label), 4).join(','));
    }
    expect(heads.size).toBe(12);
    expect(drawU32(new Rng(5).fork('spawn'), 8)).not.toEqual(drawU32(new Rng(6).fork('spawn'), 8));
  });

  it('numeric labels are accepted and deterministic', () => {
    expect(drawU32(new Rng(5).fork(3), 20)).toEqual(drawU32(new Rng(5).fork(3), 20));
    expect(drawU32(new Rng(5).fork(3), 20)).not.toEqual(drawU32(new Rng(5).fork(4), 20));
  });

  it('a fork is not a copy of its parent and is itself forkable', () => {
    const parent = new Rng(5);
    const child = parent.fork('child');
    expect(drawU32(child, 20)).not.toEqual(drawU32(new Rng(5), 20));
    const g1 = new Rng(5).fork('child').fork('grand');
    const g2 = new Rng(5).fork('child').fork('grand');
    expect(drawU32(g1, 20)).toEqual(drawU32(g2, 20));
    expect(drawU32(new Rng(5).fork('child').fork('grand'), 20)).not.toEqual(drawU32(new Rng(5).fork('child'), 20));
  });

  it('sibling forks are statistically independent (no correlation, no matching outputs)', () => {
    const root = new Rng(2024);
    const a = root.fork('spawn');
    const b = root.fork('combat');
    const n = 20000;
    let sxy = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let same = 0;
    for (let i = 0; i < n; i++) {
      const x = a.next();
      const y = b.next();
      if (x === y) same++;
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
      syy += y * y;
    }
    const corr = (sxy / n - (sx / n) * (sy / n)) / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
    expect(same).toBe(0);
    expect(Math.abs(corr)).toBeLessThan(0.03);
  });

  it('each fork is uniform on its own', () => {
    const root = new Rng(2025);
    for (const label of ['spawn', 'combat', 'loot']) {
      const f = root.fork(label);
      const counts = new Array<number>(10).fill(0);
      const n = 50000;
      for (let i = 0; i < n; i++) counts[f.int(10)]!++;
      expect(chiSquare(counts, n / 10)).toBeLessThan(27.9);
    }
  });
});

describe('createStreams', () => {
  const NAMES = ['spawn', 'combat', 'cards', 'loot', 'metin', 'boss', 'ai'] as const;

  it('creates 7 distinct deterministic streams per seed', () => {
    const a = createStreams(1234);
    const b = createStreams(1234);
    const heads = new Set<string>();
    for (const name of NAMES) {
      expect(drawU32(a[name], 30)).toEqual(drawU32(b[name], 30));
      heads.add(drawU32(createStreams(1234)[name], 4).join(','));
    }
    expect(heads.size).toBe(NAMES.length);
  });

  it('streams are forks of the run seed (spawn = Rng(seed).fork("spawn"))', () => {
    const s = createStreams(555);
    const root = new Rng(555);
    for (const name of NAMES) expect(drawU32(s[name], 25)).toEqual(drawU32(root.fork(name), 25));
  });

  it('consuming one stream never perturbs another', () => {
    const quiet = createStreams(31337);
    const busy = createStreams(31337);
    for (let i = 0; i < 5000; i++) busy.combat.next();
    for (let i = 0; i < 77; i++) busy.spawn.chance(0.5);
    for (const name of NAMES) {
      if (name === 'combat' || name === 'spawn') continue;
      expect(drawU32(busy[name], 50)).toEqual(drawU32(quiet[name], 50));
    }
  });

  it('different run seeds yield different streams', () => {
    for (const name of NAMES) {
      expect(drawU32(createStreams(1)[name], 8)).not.toEqual(drawU32(createStreams(2)[name], 8));
    }
  });
});

describe('Rng.getState / setState', () => {
  it('restoring a saved state replays the same values', () => {
    const r = new Rng(99);
    drawU32(r, 37);
    const saved = r.getState();
    const expected = drawU32(r, 100);
    r.setState(saved);
    expect(drawU32(r, 100)).toEqual(expected);
  });

  it('a state can be transplanted into another instance (even with a different seed)', () => {
    const a = new Rng(99);
    drawU32(a, 500);
    const b = new Rng(12345);
    b.setState(a.getState());
    expect(drawU32(b, 200)).toEqual(drawU32(a, 200));
  });

  it('getState returns a snapshot, not a live view', () => {
    const r = new Rng(5);
    const st = r.getState();
    const before = { ...st };
    drawU32(r, 10);
    expect(st).toEqual(before);
    const mutated = r.getState();
    mutated.s0 = 0;
    mutated.s1 = 0;
    mutated.s2 = 0;
    mutated.s3 = 0;
    const control = new Rng(5);
    drawU32(control, 10);
    expect(drawU32(r, 20)).toEqual(drawU32(control, 20));
  });

  it('state words are 32-bit integers and survive a JSON round trip', () => {
    const r = new Rng(2718);
    drawU32(r, 123);
    const st = r.getState();
    for (const v of [st.s0, st.s1, st.s2, st.s3]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2147483648);
      expect(v).toBeLessThanOrEqual(4294967295);
    }
    const restored = new Rng(0);
    restored.setState(JSON.parse(JSON.stringify(st)) as RngState);
    expect(drawU32(restored, 50)).toEqual(drawU32(r, 50));
  });

  it('signed and unsigned encodings of the same state behave identically', () => {
    const r = new Rng(404);
    drawU32(r, 9);
    const st = r.getState();
    const signed: RngState = { s0: st.s0 | 0, s1: st.s1 | 0, s2: st.s2 | 0, s3: st.s3 | 0 };
    const unsigned: RngState = { s0: st.s0 >>> 0, s1: st.s1 >>> 0, s2: st.s2 >>> 0, s3: st.s3 >>> 0 };
    const a = new Rng(1);
    const b = new Rng(1);
    a.setState(signed);
    b.setState(unsigned);
    expect(drawU32(a, 100)).toEqual(drawU32(b, 100));
  });

  it('setState does not change the root seed, so forks stay the same', () => {
    const r = new Rng(808);
    const before = drawU32(r.fork('x'), 20);
    drawU32(r, 100);
    r.setState({ s0: 9, s1: 8, s2: 7, s3: 6 });
    expect(r.seed).toBe(808);
    expect(drawU32(r.fork('x'), 20)).toEqual(before);
  });

  it('helpers built on next() resume identically after a restore', () => {
    const r = new Rng(606);
    r.int(10);
    const saved = r.getState();
    const run = (g: Rng): unknown[] => [g.int(1000), g.chance(0.5), g.range(1, 2), g.pick(['a', 'b', 'c']), g.weighted([1, 2, 3]), g.gauss(), g.sign(), g.angle()];
    const first = run(r);
    r.setState(saved);
    expect(run(r)).toEqual(first);
  });
});

describe('Rng pure-function sanity', () => {
  it('draw() helper consumes nothing but next()', () => {
    const a = new Rng(3);
    const b = new Rng(3);
    expect(draw(a, 10)).toEqual(Array.from({ length: 10 }, () => b.nextU32() / 4294967296));
  });
});
