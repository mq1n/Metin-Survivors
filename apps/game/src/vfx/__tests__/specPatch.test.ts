// Patch layer over generated skill families (spec/patch.ts): merge semantics, drop / add / replace, spec-wide defaults, grade
// variants, stale-key detection, determinism and purity. Pure data: no GPU, no host.
import { describe, expect, it } from 'vitest';
import { GEN as BASH_GEN } from '../skills/_gen/crushing_blow.gen';
import { PATCH as BASH_PATCH } from '../skills/warrior/crushing_blow.patch';
import {
  LUMA_UP_RATIO,
  MAX_ELEMENTS,
  PatchError,
  applyPatch,
  capCurve,
  checkPatch,
  fadeColorCurve,
  familyKeys,
  keyOf,
  lumaOf,
  peakLuma,
  recolorCurve,
  retint,
  retintCurve,
  scaleCurve,
  sizeBy,
  tintMul,
  tintMulCurve,
  type SkillPatch,
} from '../spec/patch';
import { MAX_ELEMENTS as TYPES_MAX_ELEMENTS, type FxSpec, type ParticleSpec, type SurfaceSpec } from '../spec/types';

const particle = (key: string, extra: Partial<ParticleSpec> = {}): ParticleSpec =>
  ({
    kind: 'particle',
    key,
    cycle: 0.5,
    max: 4,
    rate: [0, 100],
    life: [0, 0.4],
    half: [0, 0.6, 1, 0.9],
    color: [0, 0xff8040, 1, 1, 0xff8040, 0],
    billboard: 'ground',
    blend: 'add',
    tex: { art: 'vfx_disc_glow_even_a', fallback: 'disc' },
    shape: { kind: 'sphere', radius: 1, edge: true },
    ...extra,
  }) as ParticleSpec;

const surface = (key: string, extra: Partial<SurfaceSpec> = {}): SurfaceSpec =>
  ({ kind: 'surface', key, life: 0.3, shape: { kind: 'cyl', rb: 0.7, rt: 0.8, h: 0.2, span: 360 }, color: [0, 0xffa58c, 1], blend: 'add', tex: 'rays', ...extra }) as SurfaceSpec;

function family(): FxSpec[] {
  return [
    {
      id: 'sk.demo',
      desc: 'demo',
      behavior: 'meleeArc',
      ref: { family: 'demo', notes: 'base' },
      size: 'radius',
      base: 3,
      dur: 1,
      follow: true,
      elements: [
        particle('a#0', { grade: { g1: { color: [0, 0x2040ff, 1, 1, 0x2040ff, 0] }, g3: { shape: { kind: 'sphere', radius: 2 } } } }),
        particle('a#1', { billboard: 'stretch' }),
        surface('a#2'),
      ],
      impact: [particle('b#0'), particle('b#1')],
    },
    { id: 'sk.demo.cast', desc: 'cast', behavior: 'skyStrike', ref: {}, size: 'radius', base: 1, dur: 0.4, elements: [particle('c#0')] },
  ];
}

// the typed key table of that family (what a gen file exports as GEN_KEYS)
const KEYS = {
  'sk.demo': { 'a#0': 'particle', 'a#1': 'particle', 'a#2': 'surface', 'b#0': 'particle', 'b#1': 'particle' },
  'sk.demo.cast': { 'c#0': 'particle' },
} as const;
type Patch = SkillPatch<typeof KEYS>;

const snap = (v: unknown): string => JSON.stringify(v);

describe('applyPatch: scalars and defaults', () => {
  it('an empty patch returns the same specs, but for the display-space default of generated specs', () => {
    const f = family();
    expect(applyPatch(f, {})).toEqual(f.map((s) => ({ ...s, space: 'display' })));
    // the input is never mutated
    expect(f.some((s) => s.space !== undefined)).toBe(false);
  });

  it('generated specs blend in display space unless the gen file or the patch says otherwise; hand-made specs are left alone', () => {
    const f = family();
    (f[1] as FxSpec).space = 'linear';
    const hand: FxSpec = { id: 'sk.demo.explode', desc: 'hand', behavior: 'skyStrike', ref: {}, size: 'radius', base: 1, dur: 0.4, elements: [particle('h#0')] };
    const out = applyPatch(f, { addSpecs: [hand] });
    expect(out.map((s) => s.space)).toEqual(['display', 'linear', undefined]);
    // a patch flips a family back (set), or removes the field (then the spec falls back to its id-based default: linear for sk.demo)
    expect(applyPatch(family(), { specs: { 'sk.demo': { set: { space: 'linear' } } } })[0]?.space).toBe('linear');
    expect(applyPatch(family(), { specs: { 'sk.demo': { set: { space: undefined } } } })[0]).not.toHaveProperty('space');
    // a replaced spec is a hand-made one
    const rep = { ...hand, id: 'sk.demo.cast' } as FxSpec;
    expect(applyPatch(family(), { specs: { 'sk.demo.cast': { replace: rep } } })[1]).toBe(rep);
    // an element ported from a hand spec keeps its own space
    const ported = applyPatch(family(), { specs: { 'sk.demo': { add: [particle('p#0', { space: 'linear' })] } } })[0] as FxSpec;
    expect(ported.space).toBe('display');
    expect((ported.elements[3] as ParticleSpec).space).toBe('linear');
  });

  it('set merges FxSpec scalars, deep for ref, undefined removes', () => {
    const p: Patch = { specs: { 'sk.demo': { set: { base: 2.5, dur: 0.9, lift: 0.4, fadeOut: 0, occlude: 0.5, clamp: 1, space: 'display', castGap: 0.2, explode: 'generic', ref: { notes: 'patched' }, follow: undefined } } } };
    const out = applyPatch(family(), p)[0] as FxSpec;
    expect(out).toMatchObject({ base: 2.5, dur: 0.9, lift: 0.4, fadeOut: 0, occlude: 0.5, clamp: 1, space: 'display', castGap: 0.2, explode: 'generic' });
    expect(out.ref).toEqual({ family: 'demo', notes: 'patched' });
    expect('follow' in out).toBe(false);
    expect(out.id).toBe('sk.demo');
    expect(out.elements).toHaveLength(3);
  });

  it('keeps the field order of the spec and ends with elements / impact', () => {
    const out = applyPatch(family(), { specs: { 'sk.demo': { set: { lift: 0.2 } } } })[0] as FxSpec;
    const keys = Object.keys(out);
    expect(keys.slice(0, 7)).toEqual(['id', 'desc', 'behavior', 'ref', 'size', 'base', 'dur']);
    expect(keys.slice(-2)).toEqual(['elements', 'impact']);
  });

  it('each forces readability fields on every element and impact element, grade bands that carry the field too', () => {
    const f = family();
    {
      const e0 = f[0]?.elements[0] as ParticleSpec;
      e0.grade = { ...e0.grade, g2: { occlude: 0.1 } };
    }
    const out = applyPatch(f, { specs: { 'sk.demo': { each: { occlude: 0.6, clamp: 1, space: 'linear' } } } })[0] as FxSpec;
    for (const el of [...out.elements, ...(out.impact ?? [])]) expect(el).toMatchObject({ occlude: 0.6, clamp: 1, space: 'linear' });
    expect((out.elements[0] as ParticleSpec).grade?.g2?.occlude).toBe(0.6);
    expect((out.elements[0] as ParticleSpec).grade?.g1).toEqual({ color: [0, 0x2040ff, 1, 1, 0x2040ff, 0] });
    // the other spec is untouched
    expect((applyPatch(f, { specs: { 'sk.demo': { each: { occlude: 0.6 } } } })[1] as FxSpec).elements[0]).not.toHaveProperty('occlude');
  });
});

describe('applyPatch: elements by key', () => {
  it('deep-merges objects, replaces curves and arrays, removes undefined', () => {
    const p: Patch = {
      specs: { 'sk.demo': { el: { 'a#0': { shape: { radius: 0.4 }, half: [0, 0.3], tex: { fallback: 'glow' }, minRank: 3, color: undefined } } } },
    };
    const el = (applyPatch(family(), p)[0] as FxSpec).elements[0] as ParticleSpec;
    expect(el.shape).toEqual({ kind: 'sphere', radius: 0.4, edge: true }); // merged, not replaced
    expect(el.half).toEqual([0, 0.3]); // curve replaced
    expect(el.tex).toEqual({ art: 'vfx_disc_glow_even_a', fallback: 'glow' }); // nested tex merged
    expect(el.minRank).toBe(3);
    expect('color' in el).toBe(false);
    expect(el.kind).toBe('particle');
    expect(keyOf(el)).toBe('a#0');
  });

  it('a string tex replaces an ArtTex object and back', () => {
    const f = family();
    const a = (applyPatch(f, { specs: { 'sk.demo': { el: { 'a#0': { tex: 'glow' } } } } })[0] as FxSpec).elements[0] as ParticleSpec;
    expect(a.tex).toBe('glow');
    const b = (applyPatch(f, { specs: { 'sk.demo': { el: { 'a#2': { tex: { art: 'vfx_x' } } } } } })[0] as FxSpec).elements[2] as SurfaceSpec;
    expect(b.tex).toEqual({ art: 'vfx_x' });
  });

  it('null drops an element (also from impact), the rest keeps its order', () => {
    const out = applyPatch(family(), { specs: { 'sk.demo': { el: { 'a#1': null, 'b#0': null } } } })[0] as FxSpec;
    expect(out.elements.map(keyOf)).toEqual(['a#0', 'a#2']);
    expect(out.impact?.map(keyOf)).toEqual(['b#1']);
  });

  it('a function edit gets the generated element (after each) and returns the partial', () => {
    const p: Patch = { specs: { 'sk.demo': { each: { occlude: 0.5 }, el: { 'a#0': (gen) => ({ rate: [0, (gen.rate[1] as number) * 2], max: gen.max + 1, bright: gen.occlude === 0.5 ? 2 : 1 }) } } } };
    const el = (applyPatch(family(), p)[0] as FxSpec).elements[0] as ParticleSpec;
    expect(el).toMatchObject({ rate: [0, 200], max: 5, bright: 2 });
  });

  it('never changes kind or key', () => {
    const p = { specs: { 'sk.demo': { el: { 'a#0': { kind: 'surface', key: 'x#9', max: 9 } } } } } as unknown as Patch;
    const el = (applyPatch(family(), p)[0] as FxSpec).elements[0] as ParticleSpec;
    expect(el.kind).toBe('particle');
    expect(keyOf(el)).toBe('a#0');
    expect(el.max).toBe(9);
  });

  it('sizeBy scales / caps the size curves of the element and of its grade bands', () => {
    const f = family();
    (f[0]?.elements[0] as ParticleSpec).grade = { g2: { half: [[0, 1], [0, 2]] } };
    const p: Patch = { specs: { 'sk.demo': { el: { 'a#0': sizeBy({ k: 0.5 }), 'a#2': sizeBy({ k: 2, max: 1.5 }) } } } };
    const out = applyPatch(f, p)[0] as FxSpec;
    const a = out.elements[0] as ParticleSpec;
    expect(a.half).toEqual([0, 0.3, 1, 0.45]);
    expect(a.grade?.g2?.half).toEqual([[0, 0.5], [0, 1]]);
    expect((out.elements[2] as SurfaceSpec).scale).toEqual([0, 1.5]);
  });

  it('curve helpers touch values only', () => {
    expect(scaleCurve([0, 1, 0.5, 2], 3)).toEqual([0, 3, 0.5, 6]);
    expect(capCurve([0, 1, 0.5, 2], 1.5)).toEqual([0, 1, 0.5, 1.5]);
    expect(recolorCurve([0, 0x112233, 0.5, 1, 0x445566, 0], 0xa8e4ff)).toEqual([0, 0xa8e4ff, 0.5, 1, 0xa8e4ff, 0]);
    expect(fadeColorCurve([0, 0x112233, 0.8, 1, 0x445566, 0.2], 2)).toEqual([0, 0x112233, 1, 1, 0x445566, 0.4]);
  });
});

describe('applyPatch: grade variants', () => {
  it('grade.gN merges into the existing band partial', () => {
    const p: Patch = { specs: { 'sk.demo': { el: { 'a#0': { grade: { g1: { bright: 2 }, g3: { shape: { radius: 3 } } } } } } } };
    const el = (applyPatch(family(), p)[0] as FxSpec).elements[0] as ParticleSpec;
    expect(el.grade?.g1).toEqual({ color: [0, 0x2040ff, 1, 1, 0x2040ff, 0], bright: 2 });
    expect(el.grade?.g3).toEqual({ shape: { kind: 'sphere', radius: 3 } });
  });

  it('a nested object in a band that does not override it merges with the inherited value (no shallow-replace trap)', () => {
    const p: Patch = { specs: { 'sk.demo': { el: { 'a#0': { grade: { g2: { shape: { radius: 5 } } } } } } } };
    const el = (applyPatch(family(), p)[0] as FxSpec).elements[0] as ParticleSpec;
    expect(el.grade?.g2).toEqual({ shape: { kind: 'sphere', radius: 5, edge: true } });
  });

  it('adds a new band, removes one with undefined, removes an inherited field with undefined', () => {
    const f = family();
    const add = (applyPatch(f, { specs: { 'sk.demo': { el: { 'a#1': { grade: { g2: { bright: 3 } } } } } } })[0] as FxSpec).elements[1] as ParticleSpec;
    expect(add.grade).toEqual({ g2: { bright: 3 } });
    const gone = (applyPatch(f, { specs: { 'sk.demo': { el: { 'a#0': { grade: { g1: undefined } } } } } })[0] as FxSpec).elements[0] as ParticleSpec;
    expect(gone.grade).toEqual({ g3: { shape: { kind: 'sphere', radius: 2 } } });
    const rm = (applyPatch(f, { specs: { 'sk.demo': { el: { 'a#0': { grade: { g2: { shape: undefined } } } } } } })[0] as FxSpec).elements[0] as ParticleSpec;
    expect(rm.grade?.g2).toEqual({ shape: undefined });
  });

  it('removing the last band drops the grade field', () => {
    const f = family();
    (f[0]?.elements[0] as ParticleSpec).grade = { g1: { bright: 2 } };
    const el = (applyPatch(f, { specs: { 'sk.demo': { el: { 'a#0': { grade: { g1: undefined } } } } } })[0] as FxSpec).elements[0] as ParticleSpec;
    expect('grade' in el).toBe(false);
  });
});

describe('applyPatch: add / replace / specs', () => {
  it('add and impactAdd append hand-made elements after the generated ones', () => {
    const extra = particle('hand#ring', { max: 1 });
    const imp = surface('hand#flash');
    const out = applyPatch(family(), { specs: { 'sk.demo': { add: [extra], impactAdd: [imp] } } })[0] as FxSpec;
    expect(out.elements.map(keyOf)).toEqual(['a#0', 'a#1', 'a#2', 'hand#ring']);
    expect(out.impact?.map(keyOf)).toEqual(['b#0', 'b#1', 'hand#flash']);
  });

  it('impactAdd creates the impact list of a spec that had none', () => {
    const out = applyPatch(family(), { specs: { 'sk.demo.cast': { impactAdd: [particle('hand#x')] } } })[1] as FxSpec;
    expect(out.impact?.map(keyOf)).toEqual(['hand#x']);
    expect('impact' in (applyPatch(family(), {})[1] as FxSpec)).toBe(false);
  });

  it('replace swaps a whole spec', () => {
    const rep: FxSpec = { id: 'sk.demo.cast', desc: 'hand', behavior: 'skyStrike', ref: { family: 'x' }, size: 'radius', base: 1, dur: 0.3, elements: [particle('h#0')] };
    const out = applyPatch(family(), { specs: { 'sk.demo.cast': { replace: rep } } });
    expect(out[1]).toBe(rep);
    expect(out[0]?.id).toBe('sk.demo');
  });

  it('addSpecs appends specs, dropSpecs removes generated ones', () => {
    const comp: FxSpec = { id: 'sk.demo.explode', desc: 'boom', behavior: 'skyStrike', ref: {}, size: 'radius', base: 1, dur: 0.5, elements: [particle('e#0')] };
    const out = applyPatch(family(), { addSpecs: [comp], dropSpecs: ['sk.demo.cast'] });
    expect(out.map((s) => s.id)).toEqual(['sk.demo', 'sk.demo.explode']);
  });
});

describe('applyPatch: purity and determinism', () => {
  const patch = (): Patch => ({
    specs: {
      'sk.demo': { set: { lift: 0.3, ref: { notes: 'z' } }, each: { occlude: 0.5 }, el: { 'a#0': { half: [0, 1], grade: { g1: { bright: 2 } } }, 'a#1': null }, add: [particle('h#0')], impactAdd: [particle('h#1')] },
    },
    addSpecs: [{ id: 'sk.demo.x', desc: '', behavior: 'skyStrike', ref: {}, size: 'radius', base: 1, dur: 1, elements: [] }],
  });

  it('does not mutate the family or the patch', () => {
    const f = family();
    const p = patch();
    const f0 = snap(f);
    const p0 = snap(p);
    applyPatch(f, p);
    expect(snap(f)).toBe(f0);
    expect(snap(p)).toBe(p0);
  });

  it('output does not alias patch data that a later edit could change', () => {
    const f = family();
    const p = patch();
    const out = applyPatch(f, p);
    const el = (out[0] as FxSpec).elements[0] as ParticleSpec;
    (el.half as number[])[1] = 99;
    expect((p.specs?.['sk.demo']?.el?.['a#0'] as { half: number[] }).half).toEqual([0, 1]);
  });

  it('same inputs give identical JSON, however often and in whatever object-key order the patch was written', () => {
    const a = snap(applyPatch(family(), patch()));
    expect(snap(applyPatch(family(), patch()))).toBe(a);
    const reordered: Patch = { addSpecs: patch().addSpecs, specs: { 'sk.demo': { impactAdd: [particle('h#1')], add: [particle('h#0')], el: { 'a#1': null, 'a#0': { grade: { g1: { bright: 2 } }, half: [0, 1] } }, each: { occlude: 0.5 }, set: { ref: { notes: 'z' }, lift: 0.3 } } } };
    expect(snap(applyPatch(family(), reordered))).toBe(a);
  });
});

describe('checkPatch: stale keys and clashes', () => {
  const stale = (p: unknown): ReturnType<typeof checkPatch> => checkPatch(family(), p as Patch);

  it('a clean patch has no issues', () => {
    expect(stale({ specs: { 'sk.demo': { el: { 'a#0': { max: 2 }, 'b#1': null }, add: [particle('h#0')] } } })).toEqual([]);
  });

  it('flags element keys and spec ids the family no longer has', () => {
    const issues = stale({ specs: { 'sk.demo': { el: { 'gone#4': { max: 2 } } }, 'sk.nope': { set: { dur: 1 } } }, dropSpecs: ['sk.also.gone'] });
    expect(issues.map((i) => i.code).sort()).toEqual(['unknown-key', 'unknown-spec', 'unknown-spec']);
    expect(issues.find((i) => i.code === 'unknown-key')?.key).toBe('gone#4');
  });

  it('strict mode throws a PatchError listing them, lenient mode skips them', () => {
    const p = { specs: { 'sk.demo': { el: { 'gone#4': { max: 2 } } } } } as unknown as Patch;
    expect(() => applyPatch(family(), p, { strict: true })).toThrow(PatchError);
    expect(snap(applyPatch(family(), p))).toBe(snap(applyPatch(family(), {})));
  });

  it('flags unkeyed generated elements when the patch needs keys, duplicate keys, key clashes of added elements', () => {
    const f = family();
    delete (f[0]?.elements[1] as { key?: string }).key;
    expect(checkPatch(f, { specs: { 'sk.demo': { el: { 'a#0': { max: 2 } } } } }).map((i) => i.code)).toContain('unkeyed');
    const dup = family();
    (dup[0]?.elements[1] as { key?: string }).key = 'a#0';
    expect(checkPatch(dup, {}).map((i) => i.code)).toContain('duplicate-key');
    expect(stale({ specs: { 'sk.demo': { add: [particle('a#0')] } } }).map((i) => i.code)).toEqual(['duplicate-key']);
    expect(stale({ specs: { 'sk.demo': { add: [particle('h#0'), particle('h#0')] } } }).map((i) => i.code)).toEqual(['duplicate-key']);
    expect(stale({ addSpecs: [family()[0] as FxSpec] }).map((i) => i.code)).toEqual(['spec-clash']);
  });

  it('replace excludes every other operation and must keep the id', () => {
    const rep: FxSpec = { id: 'sk.demo.other', desc: '', behavior: 'skyStrike', ref: {}, size: 'radius', base: 1, dur: 1, elements: [] };
    expect(stale({ specs: { 'sk.demo.cast': { replace: rep } } }).map((i) => i.code)).toEqual(['replace-conflict']);
    expect(stale({ specs: { 'sk.demo.cast': { replace: { ...rep, id: 'sk.demo.cast' }, set: { dur: 1 } } } }).map((i) => i.code)).toEqual(['replace-conflict']);
  });

  it('flags results longer than the host compiles (elements and impact)', () => {
    const many = Array.from({ length: MAX_ELEMENTS }, (_, i) => particle(`m#${i}`));
    expect(stale({ specs: { 'sk.demo': { add: many } } }).map((i) => i.code)).toEqual(['too-many-elements']);
    expect(stale({ specs: { 'sk.demo': { impactAdd: many } } }).map((i) => i.code)).toEqual(['too-many-elements']);
    expect(stale({ specs: { 'sk.demo': { add: many, el: { 'a#0': null, 'a#1': null, 'a#2': null } } } })).toEqual([]);
  });

  it('warns when a patched base field is overridden by a grade band', () => {
    // (a luma-neutral recolour: the brightness check is its own warning, see 'luma-up' below)
    const w = stale({ specs: { 'sk.demo': { el: { 'a#0': { color: [0, 0xf08040, 1, 1, 0xf08040, 0] } } } } });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: 'band-shadow', level: 'warn', key: 'a#0' });
    // patching the band as well silences it
    expect(stale({ specs: { 'sk.demo': { el: { 'a#0': { color: [0, 0xf08040, 1, 1, 0xf08040, 0], grade: { g1: { color: [0, 0x2040f0, 1, 1, 0x2040f0, 0] } } } } } } })).toEqual([]);
  });
});

describe('familyKeys and the host limit', () => {
  it('lists every keyed element with its kind', () => {
    expect(familyKeys(family())).toEqual(KEYS);
  });

  it('MAX_ELEMENTS is the host compile limit: the one constant of spec/types.ts, 40 (host.ts reads it: specLimits.test.ts)', () => {
    expect(MAX_ELEMENTS).toBe(TYPES_MAX_ELEMENTS);
    expect(MAX_ELEMENTS).toBe(40);
  });

  it('checkPatch accepts exactly MAX_ELEMENTS elements per list and flags one more', () => {
    const stale = (p: unknown): ReturnType<typeof checkPatch> => checkPatch(family(), p as Patch);
    const fit = Array.from({ length: MAX_ELEMENTS - 3 }, (_, i) => particle(`f#${i}`));
    expect(stale({ specs: { 'sk.demo': { add: fit } } })).toEqual([]);
    expect(stale({ specs: { 'sk.demo': { add: [...fit, particle('f#x')] } } }).map((i) => i.code)).toEqual(['too-many-elements']);
    expect(stale({ specs: { 'sk.demo': { impactAdd: Array.from({ length: MAX_ELEMENTS - 2 }, (_, i) => particle(`g#${i}`)) } } })).toEqual([]);
  });
});

describe('typing (compile-time, asserted by tsc)', () => {
  it('compiles a patch typed against a key table', () => {
    const ok: Patch = { specs: { 'sk.demo': { el: { 'a#0': { half: [0, 1], shape: { radius: 1 } }, 'a#2': { life: 0.5, shape: { rb: 1 } } } } } };
    expect(ok).toBeTruthy();
    // @ts-expect-error unknown element key
    const badKey: Patch = { specs: { 'sk.demo': { el: { 'a#9': { half: [0, 1] } } } } };
    // @ts-expect-error unknown spec id
    const badSpec: Patch = { specs: { 'sk.nope': {} } };
    // @ts-expect-error a surface has no `rate`
    const badField: Patch = { specs: { 'sk.demo': { el: { 'a#2': { rate: [0, 1] } } } } };
    // @ts-expect-error a wrong value type
    const badValue: Patch = { specs: { 'sk.demo': { set: { dur: 'long' } } } };
    expect([badKey, badSpec, badField, badValue]).toHaveLength(4);
  });
});

describe('relative recolour helpers (C8)', () => {
  const apply = (f: FxSpec[], p: unknown): FxSpec[] => applyPatch(f, p as Patch);
  const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

  it('lumaOf is the Rec.709 luma of a display value, 0..1', () => {
    expect(lumaOf(0xffffff)).toBeCloseTo(1, 6);
    expect(lumaOf(0x000000)).toBe(0);
    expect(lumaOf(0x00ff00)).toBeCloseTo(0.7152, 4);
    expect(lumaOf(0xff0000)).toBeCloseTo(0.2126, 4);
    expect(lumaOf(0x0000ff)).toBeCloseTo(0.0722, 4);
  });

  it('retintCurve takes the hue of the target and KEEPS the luma of every key; times and alphas stay', () => {
    const c = [0, 0x266eff, 1, 0.5, 0x405060, 0.4, 1, 0x101820, 0];
    const out = retintCurve(c, 0xa8e4ff);
    expect(out).toHaveLength(c.length);
    for (let i = 0; i < c.length; i += 3) {
      expect(out[i]).toBe(c[i]);
      expect(out[i + 2]).toBe(c[i + 2]);
      expect(Math.abs(lumaOf(out[i + 1] as number) - lumaOf(c[i + 1] as number)), `key ${i / 3}`).toBeLessThan(0.006);
      // the hue is the target's: the channel order of the target (blue >= green >= red)
      const [r, g, b] = rgbOf(out[i + 1] as number);
      expect(b >= g && g >= r, `key ${i / 3} hue`).toBe(true);
    }
  });

  it('retintCurve keeps the luma where the hue would pass 255 too: it desaturates toward white instead of clipping', () => {
    // luma 0.94 in a pure blue hue (luma 0.0722) needs 13x: not representable, so white is mixed in
    const out = retintCurve([0, 0xf0f0f0, 1], 0x0000ff);
    expect(Math.abs(lumaOf(out[1] as number) - lumaOf(0xf0f0f0))).toBeLessThan(0.006);
    const [r, , b] = rgbOf(out[1] as number);
    expect(b).toBe(255);
    expect(r).toBeGreaterThan(200);
    // the absolute recolour of the same curve is NOT luma-preserving (the bug this helper replaces)
    expect(lumaOf(recolorCurve([0, 0x303030, 1], 0xa8e4ff)[1] as number)).toBeGreaterThan(3 * lumaOf(0x303030));
    // a black target hue gives a neutral grey of the generated luma
    expect(retintCurve([0, 0x808080, 1], 0x000000)[1]).toBe(0x808080);
  });

  it('tintMulCurve multiplies every channel (clamped to 255), alphas and times stay', () => {
    expect(tintMulCurve([0, 0x808040, 0.5, 1, 0xf0f0f0, 0], 0.5)).toEqual([0, 0x404020, 0.5, 1, 0x787878, 0]);
    expect(tintMulCurve([0, 0xc08040, 1], 2)).toEqual([0, 0xffff80, 1]);
    expect(tintMulCurve([0, 0x123456, 1], 1)).toEqual([0, 0x123456, 1]);
  });

  it('retint / tintMul edit the base colour and every band that carries one (a#0 has a base and a g1 colour)', () => {
    const f = family();
    const a0 = f[0]?.elements[0] as ParticleSpec;
    const out = apply(f, { specs: { 'sk.demo': { el: { 'a#0': tintMul(0.5) } } } })[0]?.elements[0] as ParticleSpec;
    expect(out.color).toEqual(tintMulCurve(a0.color, 0.5));
    expect(out.grade?.g1?.color).toEqual(tintMulCurve(a0.grade?.g1?.color as number[], 0.5));
    expect(out.grade?.g2).toBeUndefined();
    expect(out.grade?.g3?.shape).toEqual({ kind: 'sphere', radius: 2 }); // the rest of the bands is untouched
    const rt = apply(f, { specs: { 'sk.demo': { el: { 'a#0': retint(0xffffff) } } } })[0]?.elements[0] as ParticleSpec;
    for (const [i, v] of rt.color.entries()) if (i % 3 === 1) expect(Math.abs(lumaOf(v) - lumaOf(a0.color[i] as number))).toBeLessThan(0.006);
  });

  it("{ only: ['g3'] } edits the P band alone; a band without a colour takes the one it inherits (g3 of a#0 inherits the g1 colour)", () => {
    const f = family();
    const a0 = f[0]?.elements[0] as ParticleSpec;
    const out = apply(f, { specs: { 'sk.demo': { el: { 'a#0': tintMul(0.5, { only: ['g3'] }) } } } })[0]?.elements[0] as ParticleSpec;
    expect(out.color).toEqual(a0.color);
    expect(out.grade?.g1?.color).toEqual(a0.grade?.g1?.color);
    expect(out.grade?.g3?.color).toEqual(tintMulCurve(a0.grade?.g1?.color as number[], 0.5));
    expect(out.grade?.g3?.shape).toEqual({ kind: 'sphere', radius: 2 });
    // an element without bands: only ['g3'] creates the band
    const b0 = apply(f, { specs: { 'sk.demo': { el: { 'b#0': retint(0x00ff00, { only: ['g3'] }) } } } })[0]?.impact?.[0] as ParticleSpec;
    expect(b0.color).toEqual((f[0]?.impact?.[0] as ParticleSpec).color);
    expect(b0.grade?.g3?.color).toBeDefined();
    // surfaces work the same
    const s = apply(f, { specs: { 'sk.demo': { el: { 'a#2': tintMul(0.5) } } } })[0]?.elements[2] as SurfaceSpec;
    expect(s.color).toEqual(tintMulCurve([0, 0xffa58c, 1], 0.5));
  });
});

describe("checkPatch warns 'luma-up' (C8)", () => {
  const lumaWarns = (fam: FxSpec[], p: unknown): string[] => checkPatch(fam, p as Patch).filter((i) => i.code === 'luma-up').map((i) => `${i.spec} ${i.key}`);

  it('peakLuma is bright x the highest luma x alpha over the colour keys, per grade (bands merge cumulatively)', () => {
    const a0 = family()[0]?.elements[0] as ParticleSpec;
    expect(peakLuma(a0, 0)).toBeCloseTo(lumaOf(0xff8040), 6);
    expect(peakLuma(a0, 1)).toBeCloseTo(lumaOf(0x2040ff), 6);
    expect(peakLuma(a0, 3)).toBeCloseTo(lumaOf(0x2040ff), 6); // g3 changes the shape only: it inherits g1's colour
    expect(peakLuma({ ...a0, bright: 2, color: [0, 0xffffff, 0.5, 1, 0xffffff, 0] }, 0)).toBeCloseTo(1, 6);
  });

  it('an absolute recolour that raises the luma above 1.5x warns, with the ratio and the helper to use', () => {
    const white = [0, 0xffffff, 1, 1, 0xffffff, 0];
    const w = checkPatch(family(), { specs: { 'sk.demo': { el: { 'a#0': { color: white, grade: { g1: { color: white } } } } } } } as Patch);
    const l = w.filter((i) => i.code === 'luma-up');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ level: 'warn', spec: 'sk.demo', key: 'a#0' });
    expect(l[0]?.message).toMatch(/peak luma at g1 is 1\.00 = 3\.6x the generated 0\.28/);
    expect(l[0]?.message).toContain('retint');
    expect(LUMA_UP_RATIO).toBe(1.5);
  });

  it('the relative helpers do not warn (retint keeps the luma, tintMul up to the ratio), tintMul above it does', () => {
    expect(lumaWarns(family(), { specs: { 'sk.demo': { el: { 'a#0': retint(0xffffff) } } } })).toEqual([]);
    expect(lumaWarns(family(), { specs: { 'sk.demo': { el: { 'a#0': tintMul(1.4) } } } })).toEqual([]);
    expect(lumaWarns(family(), { specs: { 'sk.demo': { el: { 'a#0': tintMul(1.7) } } } })).toEqual(['sk.demo a#0']);
    expect(lumaWarns(family(), { specs: { 'sk.demo': { el: { 'a#0': tintMul(0.3), 'b#0': tintMul(0.5) } } } })).toEqual([]);
  });

  it('bright counts, grade bands count, untouched / added / dimmed / invisible elements do not warn', () => {
    expect(lumaWarns(family(), { specs: { 'sk.demo': { el: { 'a#1': { bright: 2 } } } } })).toEqual(['sk.demo a#1']);
    expect(lumaWarns(family(), { specs: { 'sk.demo': { el: { 'a#0': { grade: { g1: { color: [0, 0xffffff, 1, 1, 0xffffff, 0] } } } } } } })).toEqual(['sk.demo a#0']);
    expect(lumaWarns(family(), { specs: { 'sk.demo': { add: [particle('h#0', { color: [0, 0xffffff, 1] })], each: { occlude: 0.5, clamp: 1 } } } })).toEqual([]);
    // an alpha above 1 is clamped by the shader: it adds no light, so it does not warn
    expect(lumaWarns(family(), { specs: { 'sk.demo': { el: { 'a#1': { color: [0, 0xff8040, 3, 1, 0xff8040, 0] } } } } })).toEqual([]);
    // a generated element below the visibility floor is not compared
    const dim = family();
    (dim[0]?.elements[1] as ParticleSpec).color = [0, 0x050505, 1];
    expect(lumaWarns(dim, { specs: { 'sk.demo': { el: { 'a#1': { color: [0, 0xffffff, 1] } } } } })).toEqual([]);
  });

  it('a warning is not an error: strict apply does not throw and the patch still applies', () => {
    const p = { specs: { 'sk.demo': { el: { 'a#1': { bright: 3 } } } } } as unknown as Patch;
    expect(checkPatch(family(), p).every((i) => i.level === 'warn')).toBe(true);
    expect(() => applyPatch(family(), p, { strict: true })).not.toThrow();
  });

  describe('the bash P discs (judge r3 C8 / B4; skill phase 0 re-tuned bash.patch.ts with the relative helpers)', () => {
    const DISCS = ['gyeoksantau_triple#0', 'gyeoksantau_triple#4', 'gyeoksantau_triple#5', 'gyeoksantau_triple#9', 'gyeoksantau_triple#10', 'gyeoksantau_triple#14'];
    const disc = (fam: readonly FxSpec[], k: string): ParticleSpec => fam[0]?.elements.find((e) => keyOf(e) === k) as ParticleSpec;
    // the patch of round 3, frozen here: P discs at 2/3 size recoloured with the ABSOLUTE display colour 0xa8e4ff (recolorCurve)
    const absoluteDisc = (gen: ParticleSpec): { grade: { g3: { half: ParticleSpec['half']; color: number[] } } } => ({
      grade: { g3: { half: scaleCurve(gen.half as readonly number[], 0.67) as ParticleSpec['half'], color: recolorCurve(gen.grade?.g3?.color ?? gen.color, 0xa8e4ff) } },
    });
    const OLD_BASH_PATCH = { specs: { 'sk.crushing_blow': { el: Object.fromEntries(DISCS.map((k) => [k, absoluteDisc])) } } } as never;

    it('the OLD absolute patch lights the regenerated P discs up to 2.3x (peak luma at g3): it warns on the two dim ones, #4 and #9', () => {
      const warned = checkPatch(BASH_GEN, OLD_BASH_PATCH).filter((i) => i.code === 'luma-up');
      expect(warned.map((i) => i.key).sort()).toEqual(['gyeoksantau_triple#4', 'gyeoksantau_triple#9']);
      const patched = applyPatch(BASH_GEN, OLD_BASH_PATCH);
      const ratio = peakLuma(disc(patched, 'gyeoksantau_triple#4'), 3) / peakLuma(disc(BASH_GEN, 'gyeoksantau_triple#4'), 3);
      expect(ratio).toBeGreaterThan(2.0);
      expect(ratio).toBeLessThan(2.6);
      expect(warned[0]?.message).toContain('at g3');
    });

    it('with retint the same recolour keeps the generated light: no warning, the colour is still the pale cyan hue', () => {
      const fixed = { specs: { 'sk.crushing_blow': { el: Object.fromEntries(DISCS.map((k) => [k, retint(0xa8e4ff, { only: ['g3'] })])) } } } as never;
      expect(checkPatch(BASH_GEN, fixed).filter((i) => i.code === 'luma-up')).toEqual([]);
      const out = disc(applyPatch(BASH_GEN, fixed), 'gyeoksantau_triple#10');
      const c = (out.grade?.g3?.color as number[])[1] as number;
      const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
      expect(b >= g && g > r).toBe(true);
      expect(peakLuma(out, 3)).toBeCloseTo(peakLuma(disc(BASH_GEN, 'gyeoksantau_triple#10'), 3), 2);
    });

    it('the repo bash.patch is relative: no luma-up warning against the regenerated bash.gen.ts, every element at every grade within 2 % of the generated peak luma, READABLE on the spec', () => {
      expect(checkPatch(BASH_GEN, BASH_PATCH).filter((i) => i.code === 'luma-up')).toEqual([]);
      const patched = applyPatch(BASH_GEN, BASH_PATCH)[0] as FxSpec;
      const gen = BASH_GEN[0] as FxSpec;
      for (const g of [0, 1, 2, 3] as const) {
        gen.elements.forEach((e, i) => {
          const a = peakLuma(e, g);
          const b = peakLuma(patched.elements[i] as ParticleSpec, g);
          if (a > 0.02) expect(b / a, `${keyOf(e)} at g${g}`).toBeLessThan(1.02);
        });
      }
      expect(patched.elements.length).toBeLessThanOrEqual(TYPES_MAX_ELEMENTS);
      expect([patched.occlude, patched.clamp]).toEqual([0.5, 1]);
      const c = (disc([patched], 'gyeoksantau_triple#10').grade?.g3?.color as number[])[1] as number;
      expect([(c >> 16) & 255, (c >> 8) & 255, c & 255].every((v, i, a) => i === 0 || v >= (a[0] as number))).toBe(true); // pale cyan hue: g, b >= r
    });
  });
});
