// Tooling behind the generated families: the grade merge (spec/gen/gradeMerge.ts: g0..g3 converter families → one family with
// grade variants) and the TypeScript source writer (spec/gen/tsSource.ts). The merge is checked by what the RUNTIME makes of it:
// rank → grade band + rank gates → the elements of that grade's file.
import { describe, expect, it } from 'vitest';
import { BAND_END, BAND_START, alignElements, canon, mergeGradeFamilies, similarity } from '../spec/gen/gradeMerge';
import { evalLiteral, parseConverterOutput, tsLiteral } from '../spec/gen/tsSource';
import { gradeElement, gradeOf } from '../spec/host';
import { MAX_ELEMENTS, type ElementSpec, type FxSpec, type ParticleSpec, type SurfaceSpec } from '../spec/types';

const burst = (key: string, t0: number, z: number, extra: Partial<ParticleSpec> = {}): ParticleSpec =>
  ({
    kind: 'particle',
    key,
    note: `n ${key}`,
    t0,
    cycle: 0.5,
    max: 10,
    rate: [0, 1000],
    life: [0, 0.2, 0.15, 0],
    at: [0, 0.1, z],
    half: [0, 0.64],
    color: [0, 0xef0100, 0.8, 1, 0xfdaa6b, 0],
    billboard: 'stretch',
    blend: 'add',
    tex: { art: 'vfx_streak_needle_a', fallback: 'lensStreak' },
    ...extra,
  }) as ParticleSpec;

const disc = (key: string, t0: number, z: number, extra: Partial<ParticleSpec> = {}): ParticleSpec =>
  burst(key, t0, z, { billboard: 'ground', tex: { art: 'vfx_disc_glow_even_a', fallback: 'disc' }, shape: { kind: 'sphere', radius: 1 }, ...extra });

const ring = (key: string, extra: Partial<SurfaceSpec> = {}): SurfaceSpec =>
  ({ kind: 'surface', key, life: 0.217, shape: { kind: 'cyl', rb: 0.69, rt: 0.78, h: 0.24, span: 360 }, color: [0, 0xffa58c, 1], blend: 'add', tex: 'rays', ...extra }) as SurfaceSpec;

const spec = (id: string, elements: ElementSpec[], extra: Partial<FxSpec> = {}): FxSpec => ({ id, desc: id, behavior: 'meleeArc', ref: {}, size: 'radius', base: 3, dur: 1, elements, ...extra });

/** what the runtime plays at skill rank `rank` from a merged spec */
function playedAt(s: FxSpec, rank: number): ElementSpec[] {
  const g = gradeOf(rank);
  return (s.elements as ElementSpec[]).filter((e) => rank >= (e.minRank ?? 0) && rank <= (e.maxRank ?? 7)).map((e) => gradeElement(e, g));
}

const STRIP = new Set(['key', 'note', 'grade', 'minRank', 'maxRank']);
/** canonical text of an element without identity / bookkeeping fields */
const body = (e: ElementSpec): string => canon(Object.fromEntries(Object.entries(e).filter(([k]) => !STRIP.has(k))));

/** the grade file's elements, for comparison with playedAt */
const FIRST_RANK = [0, 3, 5, 7];

function expectPlays(merged: FxSpec, grades: (FxSpec | undefined)[], listOf: (s: FxSpec) => readonly ElementSpec[] = (s) => s.elements): void {
  for (let g = 0; g < 4; g++) {
    const orig = grades[g];
    const played = playedAt({ ...merged, elements: [...listOf(merged)] }, FIRST_RANK[g] as number).map(body);
    const want = (orig ? [...listOf(orig)] : []).map(body);
    expect(played, `grade g${g}`).toEqual(want);
  }
}

describe('grade bands', () => {
  it('match the host rank → band rule', () => {
    for (let g = 0; g < 4; g++) {
      expect(gradeOf(BAND_START[g] as number)).toBe(g);
      expect(gradeOf(BAND_END[g] as number)).toBe(g);
    }
  });
});

describe('mergeGradeFamilies', () => {
  const g0 = (): FxSpec => spec('sk.x', [disc('f0#0', 0, 1), burst('f0#1', 0, 1), ring('f0#2'), disc('f0#3', 0.05, 3), burst('f0#4', 0.05, 3), ring('f0#5', { life: 0.3 })]);

  it('identical grades merge into the plain spec: no bands, no gates', () => {
    const grades = [g0(), g0(), g0(), g0()].map((s, g) => ({ ...s, elements: s.elements.map((e) => ({ ...e, key: `f${g}#${s.elements.indexOf(e)}` }) as unknown as ElementSpec) }));
    const r = mergeGradeFamilies(grades.map((s) => [s]));
    const m = r.specs[0] as FxSpec;
    expect(m.elements).toHaveLength(6);
    expect(m.elements.every((e) => e.grade === undefined && e.minRank === undefined && e.maxRank === undefined)).toBe(true);
    expect(m.elements.map((e) => (e as { key?: string }).key)).toEqual(['f0#0', 'f0#1', 'f0#2', 'f0#3', 'f0#4', 'f0#5']);
    expect(r.warnings).toEqual([]);
  });

  it('changed fields become cumulative bands; every rank plays its own grade file', () => {
    const a = g0();
    const b = g0();
    const c = g0();
    const d = g0();
    (b.elements[0] as ParticleSpec).color = [0, 0x2040ff, 1, 1, 0x2040ff, 0];
    (c.elements[0] as ParticleSpec).color = [0, 0x2040ff, 1, 1, 0x2040ff, 0]; // same as g1: no g2 band for it
    (c.elements[1] as ParticleSpec).half = [0, 0.9];
    (d.elements[0] as ParticleSpec).color = [0, 0xff0000, 1];
    (d.elements[1] as ParticleSpec).half = [0, 0.9];
    (d.elements[1] as ParticleSpec).bright = 2;
    (d.elements[3] as ParticleSpec).at = [0, 0.1, 4.2]; // a burst that moves between grades
    const r = mergeGradeFamilies([[a], [b], [c], [d]]);
    const m = r.specs[0] as FxSpec;
    expect(m.elements).toHaveLength(6);
    const e0 = m.elements[0] as ParticleSpec;
    expect(Object.keys(e0.grade ?? {})).toEqual(['g1', 'g3']);
    expect(e0.grade?.g1).toEqual({ color: [0, 0x2040ff, 1, 1, 0x2040ff, 0] });
    expect((m.elements[1] as ParticleSpec).grade).toEqual({ g2: { half: [0, 0.9] }, g3: { bright: 2 } });
    expectPlays(m, [a, b, c, d]);
  });

  it('a field that vanishes in a higher grade is removed by an undefined band entry', () => {
    const a = g0();
    const b = g0();
    (a.elements[0] as ParticleSpec).jitter = [0.1, 0, 0.1];
    delete (b.elements[0] as { jitter?: unknown }).jitter;
    const r = mergeGradeFamilies([[a], [b], [b], [b]]);
    const e0 = (r.specs[0] as FxSpec).elements[0] as ParticleSpec;
    expect(e0.jitter).toEqual([0.1, 0, 0.1]);
    expect(e0.grade?.g1).toEqual({ jitter: undefined });
    expectPlays(r.specs[0] as FxSpec, [a, b, b, b]);
  });

  it('an element only the top grade has starts at P, one the top grade lost stops at G2 (rank gates)', () => {
    const a = g0();
    const dEls = [...g0().elements];
    dEls.splice(2, 1); // the ring of the first burst is gone at P
    dEls.push(burst('f3#extra', 0, 1, { billboard: 'screen', max: 3 })); // and a screen flash is new
    const d = spec('sk.x', dEls);
    const r = mergeGradeFamilies([[a], [a], [a], [d]]);
    const m = r.specs[0] as FxSpec;
    expect(m.elements).toHaveLength(7);
    const ringEl = m.elements.find((e) => (e as { key?: string }).key === 'f0#2') as ElementSpec;
    expect(ringEl.maxRank).toBe(BAND_END[2]);
    expect(ringEl.minRank).toBeUndefined();
    const extra = m.elements.find((e) => (e as { key?: string }).key === 'f3#extra') as ElementSpec;
    expect(extra.minRank).toBe(BAND_START[3]);
    expectPlays(m, [a, a, a, d]);
  });

  it('keeps three equal bursts apart even when their timing and position move per grade', () => {
    const mk = (shift: number): FxSpec =>
      spec('sk.x', [disc('k#0', 0, 1), burst('k#1', 0, 1), disc('k#2', 0.05 + shift, 3 + shift * 5), burst('k#3', 0.05 + shift, 3 + shift * 5), disc('k#4', 0.1 + shift, 5 + shift * 8), burst('k#5', 0.1 + shift, 5 + shift * 8)]);
    const r = mergeGradeFamilies([[mk(0)], [mk(0.02)], [mk(0.04)], [mk(0.07)]]);
    const m = r.specs[0] as FxSpec;
    expect(m.elements).toHaveLength(6);
    expect(m.elements.every((e) => e.minRank === undefined && e.maxRank === undefined)).toBe(true);
    expectPlays(m, [mk(0), mk(0.02), mk(0.04), mk(0.07)]);
  });

  it('a spec that exists only from a grade on is rank-gated from there; spec-level scalars and refs are merged', () => {
    const body0 = spec('sk.x', [disc('a#0', 0, 1)], { dur: 1, ref: { family: 'base', notes: 'g0' } });
    const body3 = spec('sk.x', [disc('b#0', 0, 1)], { dur: 1.4, ref: { family: 'high', notes: 'g3' } });
    const cast3 = spec('sk.x.cast', [burst('c#0', 0, 0), burst('c#1', 0.1, 0)], { behavior: 'skyStrike' });
    const r = mergeGradeFamilies([[body0], [body0], [body0], [body3, cast3]]);
    expect(r.specs.map((s) => s.id)).toEqual(['sk.x', 'sk.x.cast']);
    expect((r.specs[0] as FxSpec).dur).toBe(1.4);
    expect((r.specs[0] as FxSpec).ref.family).toBe('base');
    expect(r.specs[1]?.elements.map((e) => e.minRank)).toEqual([7, 7]);
  });

  it('merges the impact list the same way and reports scalar differences', () => {
    const a = spec('sk.x', [disc('a#0', 0, 1)], { impact: [ring('i#0')], impactGround: true });
    const d = spec('sk.x', [disc('a#0', 0, 1)], { impact: [ring('i#0', { color: [0, 0, 1] })], impactGround: false });
    const r = mergeGradeFamilies([[a], [a], [a], [d]]);
    const m = r.specs[0] as FxSpec;
    expect((m.impact?.[0] as SurfaceSpec).grade).toEqual({ g3: { color: [0, 0, 1] } });
    expect(r.warnings.some((w) => w.includes('impactGround'))).toBe(true);
    expect(m.impactGround).toBe(true);
  });

  it('keeps keys unique when a later grade brings an element whose key is taken', () => {
    const a = spec('sk.x', [disc('a#0', 0, 1)]);
    const d = spec('sk.x', [disc('a#0', 0, 1), burst('a#0', 0, 1, { billboard: 'screen' })]);
    const r = mergeGradeFamilies([[a], [a], [a], [d]]);
    const keys = (r.specs[0] as FxSpec).elements.map((e) => (e as { key?: string }).key);
    expect(new Set(keys).size).toBe(2);
    expect(keys[1]).toBe('a#0~g3');
  });

  it('is deterministic and does not mutate its input', () => {
    const grades = [[g0()], [g0()], [g0()], [g0()]];
    (grades[3]?.[0]?.elements[0] as ParticleSpec).max = 12;
    const before = JSON.stringify(grades);
    const a = JSON.stringify(mergeGradeFamilies(grades).specs);
    expect(JSON.stringify(grades)).toBe(before);
    expect(JSON.stringify(mergeGradeFamilies(grades).specs)).toBe(a);
  });
});

describe('slot packing (the host compiles MAX_ELEMENTS = 40 elements per list)', () => {
  // two grades whose elements share nothing: the plain merge is the sum of both, over the limit
  const LOW = Math.floor(MAX_ELEMENTS / 2) + 4;
  const HIGH = LOW + 2;
  const lowEls = (n = LOW): ElementSpec[] => Array.from({ length: n }, (_, i) => disc(`lo#${i}`, i * 0.01, i));
  const highEls = (n = HIGH): ElementSpec[] => Array.from({ length: n }, (_, i) => burst(`hi#${i}`, i * 0.02, i, { billboard: 'screen', color: [0, 0xff0000, 1] }));

  it('grades whose elements share nothing reuse the slots of the grade below instead of exceeding the host limit', () => {
    expect(LOW + HIGH).toBeGreaterThan(MAX_ELEMENTS);
    const lo = spec('sk.x', lowEls());
    const hi = spec('sk.x', highEls());
    const r = mergeGradeFamilies([[lo], [lo], [lo], [hi]]);
    const m = r.specs[0] as FxSpec;
    expect(m.elements).toHaveLength(HIGH); // not LOW + HIGH
    expect(r.stats['sk.x']?.elements.packed).toBe(true);
    expect(r.warnings.some((w) => w.includes('packed'))).toBe(true);
    expectPlays(m, [lo, lo, lo, hi]);
  });

  it('a merge that fits the limit is NOT packed any more (22 elements: 10 + 12 stay separate, the old limit of 16 packed them)', () => {
    const lo = spec('sk.x', lowEls(10));
    const hi = spec('sk.x', highEls(12));
    const r = mergeGradeFamilies([[lo], [lo], [lo], [hi]]);
    const m = r.specs[0] as FxSpec;
    expect(m.elements).toHaveLength(22);
    expect(r.stats['sk.x']?.elements.packed).toBeUndefined();
    expectPlays(m, [lo, lo, lo, hi]);
  });

  it('does not pack while the plain merge fits', () => {
    const lo = spec('sk.x', lowEls(4));
    const hi = spec('sk.x', highEls(4));
    const r = mergeGradeFamilies([[lo], [lo], [lo], [hi]]);
    expect((r.specs[0] as FxSpec).elements).toHaveLength(8);
    expect(r.stats['sk.x']?.elements.packed).toBeUndefined();
  });
});

describe('alignment', () => {
  it('never matches a different kind, billboard or shape kind', () => {
    expect(similarity(disc('a', 0, 0), ring('b'))).toBe(0);
    expect(similarity(disc('a', 0, 0), burst('b', 0, 0))).toBe(0);
    expect(similarity(disc('a', 0, 0), disc('b', 0, 0, { shape: { kind: 'box' } }))).toBe(0);
    expect(similarity(disc('a', 0, 0), disc('b', 0.3, 5))).toBeGreaterThan(1);
  });

  it('is order-preserving and skips an inserted element', () => {
    const prev = [disc('a', 0, 0), burst('b', 0, 0), ring('c')];
    const next = [disc('a', 0, 0), burst('x', 0, 0, { billboard: 'screen' }), burst('b', 0, 0), ring('c')];
    expect(alignElements(prev, next)).toEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
  });
});

describe('tsLiteral', () => {
  const sample = {
    id: 'sk.x',
    s: "it's a 'quote'\nand a newline",
    n: [0, -0, 0.07227, 1e-7, 3],
    color: [0, 0x67b6ff, 0.78, 1, 0x000a0b, 0],
    nested: { a: 1, 'odd-key': { deep: [[0, 1], [0, 2]] }, u: undefined, none: null, t: true },
    list: [{ kind: 'x', v: [1, 2, 3] }, { kind: 'y' }],
    long: Array.from({ length: 70 }, (_, i) => i / 8),
    empty: [],
    obj: {},
  };

  it('reads back to the same value, colour curves in hex', () => {
    const text = tsLiteral(sample);
    const back = evalLiteral<typeof sample>(text);
    expect(canon(back)).toBe(canon({ ...sample, n: [0, 0, 0.07227, 1e-7, 3] }));
    expect(text).toContain('color: [0, 0x67b6ff, 0.78, 1, 0x000a0b, 0]');
    expect('u' in back.nested).toBe(true); // undefined is written out (band removal marker)
    expect(back.nested.u).toBeUndefined();
    expect(text).toContain("'odd-key'");
  });

  it('is deterministic and wraps long numeric curves between pairs', () => {
    const a = tsLiteral(sample, 2);
    expect(tsLiteral(sample, 2)).toBe(a);
    const longLine = a.split('\n').filter((l) => l.length > 130);
    expect(longLine).toEqual([]);
  });

  it('reads converter stdout (object literals with comments)', () => {
    const out = parseConverterOutput<{ id: string; v: number[] }>("  // ---- sk.a: x\n  {\n    id: 'sk.a', // trailing\n    v: [0, 1],\n  },\n  {\n    id: 'sk.b', v: [2],\n  },\n  // end");
    expect(out.map((o) => o.id)).toEqual(['sk.a', 'sk.b']);
  });

  it('rejects non-finite numbers', () => {
    expect(() => tsLiteral({ a: Number.NaN })).toThrow();
  });
});
