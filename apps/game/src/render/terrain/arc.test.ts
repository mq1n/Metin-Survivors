// PL-03a / PL-03b (A-07): the run light arc (PL-03b: the default afternoon -> golden hour -> crimson dusk values, 'the default arc' block). PL-04 (A-10): the land reacts to corruption ('the corruption tint' block). Pure maths and change detection: no GL. The renderer glue (zoneScene, atmosphere, terrain material)
// is covered in zonesCoreShader.test.ts; the co-op phase here runs the real host + guest worlds on the in-memory relay.
import { Color } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { content, RUN_LENGTH } from '../../data/loader';
import { CoopHarness } from '../../net/coop/harness';
import { openEssence } from '../../sim/cards';
import { gradePixel, gradeUniforms } from '../post';
import {
  CORRUPTION_MOOD,
  CORRUPTION_MOOD_LOW,
  CORRUPTION_MOOD_LOW_LIT,
  CORRUPTION_SETTLE_S,
  DEFAULT_ARC,
  HEAL,
  LIT,
  NO_SWITCHES,
  RunArc,
  applyCorruption,
  applyRelief,
  arcBase,
  arcKeys,
  cloneState,
  compileKeys,
  corruptionTintOf,
  evaluate,
  gradeSpecOf,
  healEnvelope,
  healSickness,
  litOf,
  medallionEmissive,
  pageArcSwitches,
  parseArcSwitches,
  reliefLift,
  sameState,
  sampleFrames,
  stepsToKeys,
  warmthOf,
  type ArcBiome,
  type ArcState,
  type ArcStep,
} from './arc';
import { DEFAULT_CORRUPTION, arcKeysOf, lookFor, resolveBiome, type ArcKey, type ZoneLook } from './look';

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;

const BIOME: ArcBiome = {
  fog: { color: '#aabbcc', near: 40, far: 160 },
  sun: { color: '#fff1d6', intensity: 2.4, dir: [-0.4, 0.8, 0.45] },
  ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.8 },
};

/** the shipped biome of a zone as the renderer builds it (content preset + the look's render-only override) */
function zoneBiome(id: string): ArcBiome {
  const z = content.zones.find((q) => q.id === id);
  if (!z) throw new Error(`no zone ${id}`);
  return resolveBiome(id, z.biome);
}

/** a copy of a shipped look carrying the given arc */
function withArc(id: string, arc: ArcKey[] | undefined, patch?: (l: ZoneLook) => void): ZoneLook {
  const l = structuredClone(lookFor(id));
  if (arc) l.arc = arc;
  else delete l.arc;
  // YA-04: the zone's own post grade is not part of what these tests measure. The default arc and the corruption mood are written against the preset's NEUTRAL grade
  // (a +.12 dusk split tone under a .2 cap, a +.25 highlight step read back as .25) and a zone that carries a grade of its own carries an arc of its own too, so the
  // default never runs over it; `patch` still sets a grade where a test wants one
  delete l.post;
  patch?.(l);
  return l;
}

const sampleTimes = [0, 0.016, 1, 59.5, 300, 600, 880, 899.9, 905, 1800];

describe('identity', () => {
  it('t = 0 is the identity of the default arc: every shipped zone gives back its own preset at t = 0 and under up=noarc at every t (HASH-EQ of the light)', () => {
    expect(DEFAULT_ARC[0]).toEqual({ t: 0 });
    for (const id of ZONES) {
      const look = withArc(id, undefined);
      const biome = zoneBiome(id);
      const base = arcBase(look, biome);
      expect(sameState(evaluate(look, 0, 0, biome), base), `${id} t=0`).toBe(true);
      // PL-04: a corrupted world is the one thing that moves a zone at t = 0; up=nocorr takes it away again
      expect(sameState(evaluate(look, 0, 1, biome), base), `${id} t=0 corruption 1`).toBe(false);
      expect(sameState(evaluate(look, 0, 1, biome, { switches: { noarc: false, nocorr: true } }), base), `${id} t=0 corruption 1, nocorr`).toBe(true);
      // the page switch forces the identity whatever the clock says (clean captures by the lanes that do not own the arc)
      const off = new RunArc(look, biome, { switches: { noarc: true, nocorr: false } });
      expect(off.identity, id).toBe(true);
      for (const t of sampleTimes) {
        expect(sameState(evaluate(look, t, 0, biome, { switches: { noarc: true, nocorr: false } }), base), `${id} noarc t=${t}`).toBe(true);
        expect(off.update(t, 0), `${id} noarc t=${t}`).toBe(false);
      }
      // up=noarc alone leaves the corruption tint on; up=noarc,nocorr is the full identity
      expect(off.update(300, 0.5), `${id} noarc, corruption .5`).toBe(true);
      const clean = new RunArc(look, biome, { switches: { noarc: true, nocorr: true } });
      for (const t of sampleTimes) expect(clean.update(t, 0.5), `${id} noarc,nocorr t=${t}`).toBe(false);
      // the default arc itself is not an identity any more: the run moves
      const arc = new RunArc(look, biome);
      expect(arc.identity, id).toBe(false);
      expect(arc.update(0, 0), `${id} t=0`).toBe(false);
      expect(arc.update(300, 0), `${id} t=300`).toBe(true);
    }
  });

  it('a shipped look carries no arc of its own, or one the renderer can run as written (zone lanes set them in stage B: sorted, opening on the identity key, inside the run)', () => {
    for (const id of ZONES) {
      const own = lookFor(id).arc ?? [];
      if (own.length === 0) {
        expect(arcKeysOf(lookFor(id)), id).toEqual([]);
        continue;
      }
      expect(arcKeysOf(lookFor(id)), id).toEqual(own);
      expect(own[0], id).toEqual({ t: 0 });
      expect(own[own.length - 1]!.t, id).toBeLessThanOrEqual(905);
    }
  });

  it('the base is the preset: colours exactly as Color.set(hex) puts them on the lights, the grade is the zone post grade', () => {
    const look = withArc('yeonmu', undefined, (l) => {
      l.post = { grade: { gain: [1.05, 1, 0.95], highlightTint: '#ffd08a', highlightAmt: 0.2, saturation: 1.08 } };
      l.haze = { ...(l.haze as NonNullable<ZoneLook['haze']>), color: '#e0e8f0', depth: 0.3, mist: 0.1 };
    });
    const b = arcBase(look, BIOME);
    expect(b.sun.intensity).toBe(2.4);
    expect(b.hemi.intensity).toBe(0.8);
    expect(b.fog.near).toBe(40);
    expect(b.fog.far).toBe(160);
    expect(`#${b.sun.color.getHexString()}`).toBe('#fff1d6');
    expect(`#${b.fog.color.getHexString()}`).toBe('#aabbcc');
    expect(`#${b.haze.color.getHexString()}`).toBe('#e0e8f0');
    expect(b.haze.depth).toBe(0.3);
    expect(b.haze.mist).toBe(0.1);
    expect(b.fill.shadowFill).toBe(look.fill.shadowFill);
    expect(b.poolGain).toBe(1);
    expect(b.medallionGlow).toBe(0);
    // the arc's grade is what the composite pass is fed for this zone
    expect(gradeUniforms(gradeSpecOf(b.grade))).toEqual(gradeUniforms(look.post?.grade));
    // a zone with no haze configures the atmosphere with white / 0 / 0
    const bare = arcBase(withArc('yeonmu', undefined, (l) => delete l.haze), BIOME);
    expect([`#${bare.haze.color.getHexString()}`, bare.haze.depth, bare.haze.mist]).toEqual(['#ffffff', 0, 0]);
    // and with no post the grade is the neutral one
    expect(gradeUniforms(gradeSpecOf(arcBase(withArc('yeonmu', undefined, (l) => delete l.post), BIOME).grade))).toEqual(gradeUniforms());
  });

  it('a key that names only t is the identity, at t = 0 and everywhere after', () => {
    const look = withArc('seori', [{ t: 0 }, { t: 450 }, { t: 900 }]);
    const base = arcBase(look, BIOME);
    for (const t of sampleTimes) expect(sameState(evaluate(look, t, 0, BIOME), base), `t=${t}`).toBe(true);
    expect(new RunArc(look, BIOME).identity).toBe(true);
  });

  it('t = 0 is the preset even when the zone arc is not an identity later (and when its first key sits after 0)', () => {
    const late = withArc('yeonmu', [{ t: 300, sun: { intensity: 9 } }, { t: 600, poolGain: 3 }]);
    const base = arcBase(late, BIOME);
    expect(sameState(evaluate(late, 0, 0, BIOME), base)).toBe(true);
    expect(evaluate(late, 300, 0, BIOME).sun.intensity).toBe(9);
    // the implicit key at t = 0 is the preset: halfway to the first key is halfway from the preset
    expect(evaluate(late, 150, 0, BIOME).sun.intensity).toBeCloseTo(2.4 + (9 - 2.4) * 0.5, 10);
  });
});

describe('keys', () => {
  const look = withArc('yeonmu', [
    { t: 0 },
    { t: 100, sun: { color: '#ff0000', intensity: 4.8 }, poolGain: 3, medallionGlow: 0.4, haze: { mist: 0.5 } },
    { t: 200, sun: { intensity: 1.2 }, poolGain: 1 },
  ]);

  it('smoothsteps between keys (0.15625 at a quarter, half at the middle) and holds the last key', () => {
    const at = (t: number): ArcState => evaluate(look, t, 0, BIOME);
    const base = arcBase(look, BIOME);
    expect(at(0).sun.intensity).toBe(2.4);
    expect(at(25).sun.intensity).toBeCloseTo(2.4 + (4.8 - 2.4) * 0.15625, 10);
    expect(at(50).sun.intensity).toBeCloseTo(3.6, 10);
    expect(at(75).sun.intensity).toBeCloseTo(2.4 + (4.8 - 2.4) * 0.84375, 10);
    expect(at(100).sun.intensity).toBe(4.8);
    // the second span runs from key 2 to key 3
    expect(at(150).sun.intensity).toBeCloseTo(3.0, 10);
    expect(at(200).sun.intensity).toBe(1.2);
    // clamped after the last key, however far
    for (const t of [200.01, 600, 905, 1e6]) expect(at(t).sun.intensity, `t=${t}`).toBe(1.2);
    // colours move in the working space too
    expect(at(50).sun.color.r).toBeCloseTo((base.sun.color.r + 1) / 2, 10);
    expect(at(50).sun.color.g).toBeCloseTo(base.sun.color.g / 2, 10);
    // pool gain is a plain smoothstep from 1 to 3 and back
    expect(at(50).poolGain).toBeCloseTo(2, 10);
    expect(at(100).poolGain).toBe(3);
    expect(at(150).poolGain).toBeCloseTo(2, 10);
    expect(at(200).poolGain).toBe(1);
    expect(at(50).medallionGlow).toBeCloseTo(0.2, 10);
    expect(at(50).haze.mist).toBeCloseTo((arcBase(look, BIOME).haze.mist + 0.5) / 2, 10);
  });

  it('a sub-field a key does not name keeps the preset value at that key', () => {
    const k100 = evaluate(look, 100, 0, BIOME);
    const base = arcBase(look, BIOME);
    expect(k100.hemi.intensity).toBe(base.hemi.intensity);
    expect(sameState({ ...k100, sun: base.sun, poolGain: base.poolGain, medallionGlow: 0, haze: base.haze }, base)).toBe(true);
    // key 3 names only the sun intensity and poolGain: its sun COLOUR is the preset's, not key 2's red
    const k200 = evaluate(look, 200, 0, BIOME);
    expect(k200.sun.color.r).toBe(base.sun.color.r);
    expect(k200.haze.mist).toBe(base.haze.mist);
    expect(k200.medallionGlow).toBe(0);
  });

  it('unsorted keys are sorted; a later key of the same t wins; keys without a finite t are dropped', () => {
    const l = withArc('yeonmu', [
      { t: 200, poolGain: 4 },
      { t: Number.NaN, poolGain: 7 },
      { t: 100, poolGain: 2 },
      { t: 100, poolGain: 3 },
    ]);
    expect(arcKeysOf(l).map((k) => k.t)).toEqual([100, 100, 200]);
    const at = (t: number): number => evaluate(l, t, 0, BIOME).poolGain;
    expect(at(100)).toBe(3);
    expect(at(150)).toBeCloseTo(3.5, 10);
    expect(at(999)).toBe(4);
    // before the first key the arc runs from the preset: 1 -> 2 (the first of the two keys at 100) is what t < 100 sees
    expect(at(50)).toBeCloseTo(1.5, 10);
  });

  it('refuses nonsense: NaN / malformed fields keep the preset, intensities are never negative, gains are capped', () => {
    const l = withArc('yeonmu', [
      { t: 0 },
      {
        t: 10,
        sun: { color: 'not a colour', intensity: -5 },
        hemi: { intensity: Number.NaN },
        fog: { near: 500, far: 10 },
        haze: { depth: 4, mist: -1 },
        poolGain: 99,
        medallionGlow: 5,
        grade: { gain: [1, Number.NaN, 1], contrast: Number.POSITIVE_INFINITY, saturation: 0.5 },
      },
    ]);
    const base = arcBase(l, BIOME);
    const s = evaluate(l, 10, 0, BIOME);
    expect(sameState({ ...s, sun: base.sun }, { ...base, sun: base.sun, poolGain: s.poolGain, medallionGlow: s.medallionGlow, fog: s.fog, haze: s.haze, grade: s.grade })).toBe(true);
    expect(s.sun.intensity).toBe(0);
    expect(s.sun.color.r).toBe(base.sun.color.r);
    expect(s.hemi.intensity).toBe(base.hemi.intensity);
    expect(s.fog.far).toBeGreaterThan(s.fog.near);
    expect(s.haze.depth).toBe(1);
    expect(s.haze.mist).toBe(0);
    expect(s.poolGain).toBe(8);
    expect(s.medallionGlow).toBe(1);
    expect(s.grade.gain).toEqual(base.grade.gain);
    expect(s.grade.contrast).toBe(base.grade.contrast);
    expect(s.grade.saturation).toBe(0.5);
    // non-finite clocks count as 0, never as NaN light
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY * -1, -3]) expect(sameState(evaluate(l, t, Number.NaN, BIOME), base), `t=${t}`).toBe(true);
  });

  it('blends the grade: gain, amounts and tints move together, the S-curve numbers stay the zone\'s', () => {
    const l = withArc(
      'yeonmu',
      [{ t: 0 }, { t: 100, grade: { gain: [1.2, 1, 0.8], highlightTint: '#ffa060', highlightAmt: 0.4, saturation: 1.2 } }],
      (z) => (z.post = { grade: { contrast: 1.1, highlightTint: '#ffffff', highlightAmt: 0 } }),
    );
    const mid = evaluate(l, 50, 0, BIOME).grade;
    expect(mid.gain[0]).toBeCloseTo(1.1, 10);
    expect(mid.gain[2]).toBeCloseTo(0.9, 10);
    expect(mid.highlightAmt).toBeCloseTo(0.2, 10);
    expect(mid.saturation).toBeCloseTo(1.1, 10);
    expect(mid.contrast).toBe(1.1);
    expect(mid.highlightTint.r).toBeLessThanOrEqual(1);
    const spec = gradeSpecOf(evaluate(l, 100, 0, BIOME).grade);
    expect(spec.highlightTint).toBe('#ffa060');
    expect(spec.gain).toEqual([1.2, 1, 0.8]);
  });
});

describe('zone keys and the default arc', () => {
  const defaultArc: ArcStep[] = [{ t: 0 }, { t: 600, sun: { mul: 0.5 }, poolGain: 5 }];

  it('a zone with keys of its own ignores the default arc; one without runs the default arc', () => {
    const own = withArc('yeonmu', [{ t: 0 }, { t: 600, sun: { intensity: 4.8 } }]);
    const none = withArc('yeonmu', undefined);
    const empty = withArc('yeonmu', []);
    const opts = { defaultArc };
    expect(evaluate(own, 600, 0, BIOME, opts).sun.intensity).toBe(4.8);
    expect(evaluate(own, 600, 0, BIOME, opts).poolGain).toBe(1);
    expect(evaluate(none, 600, 0, BIOME, opts).sun.intensity).toBeCloseTo(1.2, 10);
    expect(evaluate(none, 600, 0, BIOME, opts).poolGain).toBe(5);
    // an empty arc is "no arc": the default applies
    expect(evaluate(empty, 600, 0, BIOME, opts).poolGain).toBe(5);
    // an injected empty default arc is the identity; without an injection the shipped DEFAULT_ARC runs (golden hour at 600 s: the sun gets brighter)
    expect(sameState(evaluate(none, 600, 0, BIOME, { defaultArc: [] }), arcBase(none, BIOME))).toBe(true);
    const goldenMul = DEFAULT_ARC.find((k) => k.t === 600)?.sun?.mul as number;
    expect(goldenMul).toBeGreaterThan(1);
    expect(evaluate(none, 600, 0, BIOME).sun.intensity).toBeCloseTo(2.4 * goldenMul, 10);
  });

  it('default steps are relative to the zone\'s own preset: the same step lands on a different value in every zone', () => {
    const step: ArcStep[] = [{ t: 0 }, { t: 100, sun: { toward: ['#ffc890', 0.25], mul: 1.05 }, haze: { toward: ['#e8b878', 0.2], mistAdd: 0.08 }, fog: { toward: ['#6a3a4a', 0.25] } }];
    const y = evaluate(withArc('yeonmu', undefined), 100, 0, zoneBiome('yeonmu'), { defaultArc: step });
    const d = evaluate(withArc('daeryeol', undefined), 100, 0, zoneBiome('daeryeol'), { defaultArc: step });
    const yb = zoneBiome('yeonmu');
    const db = zoneBiome('daeryeol');
    expect(y.sun.intensity).toBeCloseTo(yb.sun.intensity * 1.05, 10);
    expect(d.sun.intensity).toBeCloseTo(db.sun.intensity * 1.05, 10);
    expect(y.sun.color.getHex()).not.toBe(d.sun.color.getHex());
    expect(y.haze.mist - arcBase(lookFor('yeonmu'), yb).haze.mist).toBeCloseTo(0.08, 10);
  });

  it('stepsToKeys: "N % toward a colour" is a linear move to it (8-bit hex), multipliers are on the preset, absolutes stay', () => {
    const base = arcBase(withArc('yeonmu', undefined), BIOME);
    const keys = stepsToKeys(
      [
        { t: 0 },
        {
          t: 880,
          sun: { toward: ['#ff8a5c', 0.45], mul: 0.85 },
          hemi: { mul: 0.85 },
          fill: { shadowToward: ['#4a6890', 0.15], fillMul: 1.2 },
          haze: { toward: ['#b8566a', 0.35], depthMul: 1.5, mistAdd: 0.08 },
          fog: { toward: ['#6a3a4a', 0.25] },
          grade: { highlightToward: ['#ffb070', 0.6], highlightAmtAdd: 0.25, gainMul: [1.05, 1, 0.95], saturationMul: 0.9 },
          poolGain: 3,
          medallionGlow: 0.35,
        },
      ],
      base,
    );
    expect(keys[0]).toEqual({ t: 0 });
    const k = keys[1] as ArcKey;
    expect(k.sun?.intensity).toBeCloseTo(2.4 * 0.85, 10);
    expect(k.hemi?.intensity).toBeCloseTo(0.8 * 0.85, 10);
    expect(k.hemi?.sky).toBeUndefined();
    expect(k.poolGain).toBe(3);
    expect(k.medallionGlow).toBe(0.35);
    expect(k.haze?.mist).toBeCloseTo(base.haze.mist + 0.08, 10);
    expect(k.grade?.highlightAmt).toBeCloseTo(0.25, 10);
    expect(k.grade?.gain?.[0]).toBeCloseTo(1.05, 10);
    expect(k.grade?.saturation).toBeCloseTo(0.9, 10);
    // the colour is 45 % of the way (in linear light) from the preset sun to #ff8a5c
    const frames = compileKeys(keys, base);
    const sun = (frames[1] as { sun: ArcState['sun'] }).sun.color;
    const target = base.sun.color.clone().set('#ff8a5c');
    expect(sun.r).toBeCloseTo(base.sun.color.r + (target.r - base.sun.color.r) * 0.45, 2);
    expect(sun.g).toBeCloseTo(base.sun.color.g + (target.g - base.sun.color.g) * 0.45, 2);
    expect(sun.b).toBeCloseTo(base.sun.color.b + (target.b - base.sun.color.b) * 0.45, 2);
    // amount 0 / a malformed colour name nothing
    expect(stepsToKeys([{ t: 5, sun: { toward: ['#ffffff', 0] } }, { t: 6, sun: { toward: ['not-a-hex', 1] } }], base).map((q) => q.sun)).toEqual([{ color: '#fff1d6' }, {}]);
  });

  it('arcKeys: noarc yields no keys at all', () => {
    const l = withArc('yeonmu', [{ t: 0 }, { t: 5, poolGain: 3 }]);
    const b = arcBase(l, BIOME);
    expect(arcKeys(l, b)).toHaveLength(2);
    expect(arcKeys(l, b, { switches: { noarc: true, nocorr: false } })).toEqual([]);
    expect(arcKeys(l, b, { switches: { noarc: false, nocorr: true } })).toHaveLength(2);
  });
});

describe('the default arc (PL-03b): afternoon -> golden hour -> crimson dusk at the Great Metin', () => {
  const at = (id: string, t: number, c = 0): ArcState => evaluate(withArc(id, undefined), t, c, zoneBiome(id));
  const baseOf = (id: string): ArcState => arcBase(withArc(id, undefined), zoneBiome(id));
  const step = (t: number): ArcStep => DEFAULT_ARC.find((k) => k.t === t) as ArcStep;
  const lin = (hex: string): Color => new Color().set(hex);
  /** `c` sits `amt` of the way (linear light, like the shader blends it) from `from` to `to[0]` */
  const expectToward = (c: Color, from: Color, to: readonly [string, number], what: string): void => {
    const target = lin(to[0]);
    for (const ch of ['r', 'g', 'b'] as const) expect(c[ch], `${what} ${ch}`).toBeCloseTo(from[ch] + (target[ch] - from[ch]) * to[1], 2);
  };
  const redness = (c: Color): number => c.r / Math.max(c.b, 1e-3);
  /** green over red of a light colour: the lower, the redder (an amber -> rose-red move lowers it, which r / b does not see) */
  const greenness = (c: Color): number => c.g / Math.max(c.r, 1e-3);
  const lum = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const dist = (a: Color, b: Color): number => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

  it('has the keys of the plan: the preset at 0, the afternoon at 600, the golden hour at 780, crimson dusk at 880, the same dusk held at 900', () => {
    expect(DEFAULT_ARC.map((k) => k.t)).toEqual([0, 600, 780, 880, 900]);
    expect(step(0)).toEqual({ t: 0 });
    expect({ ...step(900), t: 880 }).toEqual(step(880));
  });

  it('afternoon (t = 600): the sun at least 25 % toward #ffc890 and a touch brighter, the haze toward #e8b878, the shadow fill toward #4a6890, a warm grade, the lanterns stir; the medallion waits', () => {
    const k = step(600);
    expect(k.sun?.toward?.[0]).toBe('#ffc890');
    expect(k.sun?.toward?.[1]).toBeGreaterThanOrEqual(0.25);
    expect(k.sun?.mul).toBeGreaterThanOrEqual(1.05);
    expect(k.sun?.mul).toBeLessThanOrEqual(1.1);
    expect(k.haze?.toward?.[0]).toBe('#e8b878');
    expect(k.haze?.toward?.[1]).toBeGreaterThanOrEqual(0.2);
    expect(k.fill?.shadowToward?.[0]).toBe('#4a6890');
    for (const id of ZONES) {
      const b = baseOf(id);
      const s = at(id, 600);
      expect(s.sun.intensity, id).toBeCloseTo(b.sun.intensity * (k.sun?.mul as number), 10);
      expectToward(s.sun.color, b.sun.color, k.sun?.toward as [string, number], `${id} sun`);
      expectToward(s.haze.color, b.haze.color, k.haze?.toward as [string, number], `${id} haze`);
      expectToward(s.fill.shadowTint, b.fill.shadowTint, k.fill?.shadowToward as [string, number], `${id} fill`);
      expect(s.poolGain, id).toBe(2);
      expect(s.medallionGlow, id).toBe(0);
      expect(s.fog.color.getHex(), id).toBe(b.fog.color.getHex());
      expect(s.haze.mist, id).toBe(b.haze.mist);
      // the grade turns warm: the red gain goes up, the blue gain down, the highlights lean to the warm tint
      expect(s.grade.gain[0], id).toBeGreaterThan(b.grade.gain[0]);
      expect(s.grade.gain[2], id).toBeLessThan(b.grade.gain[2]);
      expect(s.grade.highlightAmt, id).toBeGreaterThan(b.grade.highlightAmt);
      // the shadow tint of the grade is already the dusk violet, at the zone's own (zero) amount: nothing to see yet, nothing to veil later
      expect(lum(s.grade.shadowTint), `${id} shadow tint`).toBeLessThan(0.05);
      expect(s.grade.shadowAmt, id).toBe(b.grade.shadowAmt);
    }
  });

  it('golden hour (t = 780): amber sun, warm air, violet shadows, the lanterns lit, the medallion starts to glow; it is not yet the dusk (the water keeps its blue)', () => {
    const k = step(780);
    expect(k.sun?.toward?.[0]).toBe('#ffb868');
    expect(k.sun?.toward?.[1]).toBeGreaterThanOrEqual(0.4);
    expect(k.poolGain).toBeGreaterThanOrEqual(2);
    expect(k.poolGain).toBeLessThanOrEqual(3);
    expect(k.medallionGlow).toBeGreaterThan(0.2);
    expect(k.medallionGlow).toBeLessThan(0.5);
    for (const id of ZONES) {
      const b = baseOf(id);
      const s = at(id, 780);
      const m = at(id, 600);
      const d = at(id, 880);
      expectToward(s.sun.color, b.sun.color, k.sun?.toward as [string, number], `${id} sun`);
      expect(s.poolGain, id).toBe(3);
      expect(s.medallionGlow, id).toBe(0.3);
      // the sun is as bright as the zone drew it (the dusk is the dimmer one); the air is warm, not crimson yet
      expect(s.sun.intensity, id).toBeCloseTo(b.sun.intensity, 10);
      expect(greenness(s.haze.color), `${id} haze warmer (greener, less rose) than the dusk`).toBeGreaterThan(greenness(d.haze.color));
      // 800 s is still mostly the golden hour: the sun colour is nearer to it than to the dusk
      expect(dist(at(id, 800).sun.color, s.sun.color), id).toBeLessThan(dist(at(id, 800).sun.color, d.sun.color));
      expect(dist(m.sun.color, s.sun.color), `${id} the golden hour is not the afternoon`).toBeGreaterThan(0.003);
    }
  });

  it('crimson dusk (t = 880): a rose-red sun at x0.8-0.95, hemisphere x0.8-0.95, crimson air with mist, a plum fog, a near neutral grade, visible lantern pools and a glowing medallion', () => {
    const k = step(880);
    expect(k.sun?.toward?.[0]).toBe('#ff7a78');
    expect(k.sun?.toward?.[1]).toBeGreaterThanOrEqual(0.35);
    expect(k.sun?.mul).toBeGreaterThanOrEqual(0.8);
    expect(k.sun?.mul).toBeLessThanOrEqual(0.95);
    expect(k.hemi?.mul).toBeGreaterThanOrEqual(0.8);
    expect(k.hemi?.mul).toBeLessThanOrEqual(0.95);
    expect(k.haze?.toward?.[0]).toBe('#c04a6a');
    expect(k.haze?.toward?.[1]).toBeGreaterThanOrEqual(0.25);
    expect(k.haze?.mistAdd).toBeGreaterThanOrEqual(0.04);
    expect(k.haze?.mistAdd).toBeLessThanOrEqual(0.08);
    expect(k.fog?.toward?.[0]).toBe('#5a3050');
    expect(k.fog?.toward?.[1]).toBeGreaterThanOrEqual(0.2);
    // the lantern pools: x3 left them invisible, x8 is the clamp (a bright snow ground blows out above ~x5)
    expect(k.poolGain).toBeGreaterThanOrEqual(3.5);
    expect(k.poolGain).toBeLessThanOrEqual(6);
    // the medallion glow is at the clamp (the shader's own mask keeps it to the bright parts of the picture)
    expect(k.medallionGlow).toBeGreaterThanOrEqual(0.9);
    expect(k.medallionGlow).toBeLessThanOrEqual(1);
    for (const id of ZONES) {
      const b = baseOf(id);
      const s = at(id, 880);
      expect(s.sun.intensity, id).toBeCloseTo(b.sun.intensity * (k.sun?.mul as number), 10);
      expect(s.hemi.intensity, id).toBeCloseTo(b.hemi.intensity * (k.hemi?.mul as number), 10);
      expectToward(s.sun.color, b.sun.color, k.sun?.toward as [string, number], `${id} sun`);
      expectToward(s.haze.color, b.haze.color, k.haze?.toward as [string, number], `${id} haze`);
      expectToward(s.fog.color, b.fog.color, k.fog?.toward as [string, number], `${id} fog`);
      expect(s.haze.mist, id).toBeCloseTo(b.haze.mist + (k.haze?.mistAdd as number), 10);
      expect(s.poolGain, id).toBe(k.poolGain);
      expect(s.medallionGlow, id).toBe(k.medallionGlow);
      // the fog distances are the zone's own (the horizon does not move)
      expect([s.fog.near, s.fog.far], id).toEqual([b.fog.near, b.fog.far]);
      // the highlights lean warm: tint red >= green >= blue, and more of it than the zone's own grade
      expect(s.grade.highlightAmt, id).toBeGreaterThan(b.grade.highlightAmt);
      const h = s.grade.highlightTint;
      expect(h.r, id).toBeGreaterThanOrEqual(h.g);
      expect(h.g, id).toBeGreaterThanOrEqual(h.b);
      // ... but it is a rose, not an orange: the highlight keeps its blue (b >= 0.55 g) and the grade gain stays within 5 % of the zone's
      // (the first build's orange sun + orange grade turned every ground the same rust: red telegraphs lost ~60 % of their contrast)
      expect(h.b, `${id} highlight tint is not orange`).toBeGreaterThanOrEqual(0.55 * h.g);
      for (let c = 0; c < 3; c++) expect(Math.abs((s.grade.gain[c] as number) - (b.grade.gain[c] as number)), `${id} gain ${c}`).toBeLessThanOrEqual(0.05);
      expect(s.grade.saturation, id).toBeGreaterThanOrEqual(b.grade.saturation * 0.9);
      expect(s.grade.saturation, id).toBeLessThanOrEqual(b.grade.saturation * 1.05);
      expect(greenness(s.sun.color), `${id} sun redder than its preset`).toBeLessThan(greenness(b.sun.color));
      // the dusk grade tints the shadows with a DARK violet (a pale tint lifts the blacks into a milky veil: seen on live pairs); the zones grade from a neutral white tint, so the move must be a full one
      const sh = s.grade.shadowTint;
      expect(lum(sh), `${id} shadow tint luma`).toBeLessThan(0.05);
      expect(s.grade.shadowAmt, id).toBeGreaterThan(b.grade.shadowAmt);
      expect(s.grade.shadowAmt, id).toBeLessThanOrEqual(0.2);
    }
  });

  it('no milky veil on the way: the split-tone grade never lifts a dark pixel more than 5 % above the zone\'s own grade, on every zone at every clock from 0 to 1000 s (the r1 bug: a shadow tint travelling white -> violet lifted blacks +48..+146 % at 650-800 s)', () => {
    for (const id of ZONES) {
      const base = baseOf(id);
      const u0 = gradeUniforms(gradeSpecOf(base.grade));
      for (const px of [0.01, 0.02, 0.05]) {
        const ref = gradePixel([px, px, px], u0);
        for (let t = 0; t <= 1000; t += 5) {
          const g = gradePixel([px, px, px], gradeUniforms(gradeSpecOf(at(id, t).grade)));
          // the veil is a grey lift: the luma of a dark pixel stays within 5 %, no single channel gains more than 0.004 absolute (the violet / warm cast of the tint)
          const l = (v: number[]): number => 0.2126 * (v[0] as number) + 0.7152 * (v[1] as number) + 0.0722 * (v[2] as number);
          expect(l(g), `${id} dark ${px} luma t=${t}`).toBeLessThanOrEqual(l(ref) * 1.05 + 3e-4);
          for (let c = 0; c < 3; c++) expect(g[c] as number, `${id} dark ${px} ch ${c} t=${t}`).toBeLessThanOrEqual((ref[c] as number) * 1.05 + 0.004);
        }
      }
      // a mid tone moves by at most 10 % (the warm highlight lean), and every pixel stays finite
      const midRef = gradePixel([0.1, 0.1, 0.1], u0);
      for (let t = 0; t <= 1000; t += 5) {
        const g = gradePixel([0.1, 0.1, 0.1], gradeUniforms(gradeSpecOf(at(id, t).grade)));
        for (let c = 0; c < 3; c++) {
          expect(Number.isFinite(g[c]), `${id} t=${t}`).toBe(true);
          expect(g[c] as number, `${id} mid ch ${c} t=${t}`).toBeLessThanOrEqual((midRef[c] as number) * 1.1 + 1e-4);
        }
      }
    }
  });

  it('the shadow tint is the dusk violet whenever its amount is raised: the root of the veil (an amount ramping on a pale tint)', () => {
    for (const id of ZONES) {
      const base = baseOf(id);
      for (let t = 0; t <= 1000; t += 5) {
        const g = at(id, t).grade;
        if (g.shadowAmt > base.grade.shadowAmt + 1e-9) expect(lum(g.shadowTint), `${id} t=${t}: tint luma while amount ${g.shadowAmt}`).toBeLessThan(0.05);
        expect(g.shadowAmt, `${id} t=${t}`).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('the air adds no veil of its own: the mist rises by at most 0.08 and the haze depth never moves; the exposure never drops more than 12 % below the zone\'s (the plaza keeps its depth for the medallion and the telegraphs)', () => {
    for (const id of ZONES) {
      const b = baseOf(id);
      for (let t = 0; t <= 1000; t += 5) {
        const s = at(id, t);
        expect(s.haze.mist - b.haze.mist, `${id} t=${t}`).toBeLessThanOrEqual(0.08 + 1e-9);
        expect(s.haze.depth, `${id} t=${t}`).toBe(b.haze.depth);
        expect(s.sun.intensity, `${id} t=${t}`).toBeGreaterThanOrEqual(b.sun.intensity * 0.88);
        expect(s.hemi.intensity, `${id} t=${t}`).toBeGreaterThanOrEqual(b.hemi.intensity * 0.88);
      }
    }
  });

  it('is relative to the preset: the same arc lands on a different light in every zone, and every value stays valid', () => {
    const suns = new Set<number>();
    for (const id of ZONES) {
      const biome = zoneBiome(id);
      const b = baseOf(id);
      suns.add(at(id, 905).sun.color.getHex());
      for (const t of [0, 1, 150, 400, 599, 600, 601, 740, 879, 880, 905, 5000]) {
        const s = at(id, t);
        const nums = [s.sun.intensity, s.hemi.intensity, s.fill.shadowFill, s.haze.depth, s.haze.mist, s.fog.near, s.fog.far, s.poolGain, s.medallionGlow, s.grade.saturation, ...s.grade.gain, s.sun.color.r, s.haze.color.g, s.fog.color.b];
        for (const v of nums) expect(Number.isFinite(v), `${id} t=${t}`).toBe(true);
        expect(s.sun.intensity, `${id} t=${t}`).toBeGreaterThan(0);
        expect(s.haze.depth, `${id} t=${t}`).toBeLessThanOrEqual(1);
        expect(s.haze.mist, `${id} t=${t}`).toBeLessThanOrEqual(1);
        expect(s.fog.far, `${id} t=${t}`).toBeGreaterThan(s.fog.near);
        // the light never strays far from what the zone was drawn for
        expect(s.sun.intensity, `${id} t=${t}`).toBeGreaterThan(b.sun.intensity * 0.66);
        expect(s.sun.intensity, `${id} t=${t}`).toBeLessThan(b.sun.intensity * 1.34);
        expect(s.fog.near, `${id} t=${t}`).toBe(biome.fog.near);
      }
    }
    expect(suns.size).toBe(ZONES.length);
  });

  it('holds from 880 s on: 880, 899.9, 900, 905, 1800 s and an overshooting clock are one state', () => {
    for (const id of ZONES) {
      const dusk = at(id, 880);
      for (const t of [899.9, 900, 905, 1800, 1e9]) expect(sameState(at(id, t), dusk), `${id} t=${t}`).toBe(true);
    }
  });

  it('moves smoothly and one way: no jump between two clock steps, the lantern pools / glow / mist only rise, the sun peaks in the afternoon (600 s)', () => {
    for (const id of ZONES) {
      const b = baseOf(id);
      let prev = at(id, 0);
      let peak = prev.sun.intensity;
      let peakT = 0;
      for (let t = 1; t <= 1000; t++) {
        const s = at(id, t);
        expect(Math.abs(s.sun.intensity - prev.sun.intensity), `${id} t=${t}`).toBeLessThan(b.sun.intensity * 0.02);
        expect(dist(s.sun.color, prev.sun.color), `${id} t=${t}`).toBeLessThan(0.02);
        expect(dist(s.haze.color, prev.haze.color), `${id} t=${t}`).toBeLessThan(0.02);
        expect(dist(s.fog.color, prev.fog.color), `${id} t=${t}`).toBeLessThan(0.02);
        expect(s.poolGain, `${id} t=${t}`).toBeGreaterThanOrEqual(prev.poolGain);
        expect(s.medallionGlow, `${id} t=${t}`).toBeGreaterThanOrEqual(prev.medallionGlow);
        expect(s.haze.mist, `${id} t=${t}`).toBeGreaterThanOrEqual(prev.haze.mist);
        if (s.sun.intensity > peak) {
          peak = s.sun.intensity;
          peakT = t;
        }
        prev = s;
      }
      expect(peakT, id).toBeGreaterThan(300);
      expect(peakT, id).toBeLessThanOrEqual(640);
    }
  });

  it('three distinct moods: the afternoon (400 s), the late run (800 s) and the final (905 s) differ and redden in that order', () => {
    for (const id of ZONES) {
      const b = baseOf(id);
      const m = at(id, 400);
      const l = at(id, 800);
      const f = at(id, 905);
      // the lantern pools and the medallion stir in the afternoon, wake in the late run and are fully up at the end
      expect(m.poolGain, id).toBeGreaterThan(1.2);
      expect(m.poolGain, id).toBeLessThan(l.poolGain);
      expect(l.poolGain, id).toBeGreaterThan(2.2);
      expect(l.poolGain, id).toBeLessThan(f.poolGain);
      expect(f.poolGain, id).toBe(step(880).poolGain);
      expect(m.medallionGlow, id).toBe(0);
      expect(l.medallionGlow, id).toBeGreaterThan(0.2);
      expect(l.medallionGlow, id).toBeLessThan(f.medallionGlow);
      expect(f.medallionGlow, id).toBe(step(880).medallionGlow);
      // every channel of the look moves between the moods
      expect(dist(m.sun.color, l.sun.color), `${id} sun`).toBeGreaterThan(0.004);
      expect(dist(l.sun.color, f.sun.color), `${id} sun`).toBeGreaterThan(0.004);
      expect(dist(m.haze.color, f.haze.color), `${id} haze`).toBeGreaterThan(0.004);
      expect(dist(b.fog.color, f.fog.color), `${id} fog`).toBeGreaterThan(0.004);
      // the afternoon is already not the preset: a warmer sun / haze and a warm grade
      const away = dist(b.sun.color, m.sun.color) + dist(b.haze.color, m.haze.color) + Math.abs(m.grade.gain[0] - b.grade.gain[0]) * 3;
      expect(away, `${id}: the afternoon is already not the preset`).toBeGreaterThan(0.02);
      expect(greenness(l.sun.color), id).toBeLessThan(greenness(m.sun.color));
      expect(greenness(f.sun.color), id).toBeLessThanOrEqual(greenness(l.sun.color));
      expect(f.sun.intensity, id).toBeLessThan(l.sun.intensity);
      expect(l.sun.intensity, id).toBeLessThan(m.sun.intensity);
      // the golden hour holds at 800 s: its haze is nearer to the golden hour's than to the dusk's crimson
      expect(dist(l.haze.color, at(id, 780).haze.color), `${id} the dusk haze is the last act`).toBeLessThan(dist(l.haze.color, f.haze.color));
    }
  });

  it('a zone with a look.arc of its own keeps it: the default never mixes in', () => {
    const own = withArc('yeonmu', [{ t: 0 }, { t: 900, poolGain: 2 }]);
    const s = evaluate(own, 905, 0, zoneBiome('yeonmu'));
    const b = arcBase(own, zoneBiome('yeonmu'));
    expect(s.poolGain).toBe(2);
    expect(s.medallionGlow).toBe(0);
    expect(s.sun.intensity).toBe(b.sun.intensity);
    expect(sameState(s, evaluate(own, 905, 0, zoneBiome('yeonmu'), { defaultArc: DEFAULT_ARC }))).toBe(true);
  });

  it('the medallion at 905 s: base emissive + the dusk glow, clamped, so a spec that is already bright cannot turn the whole disc white', () => {
    const glow = step(880).medallionGlow as number;
    for (const id of ZONES) {
      const base = lookFor(id).medallion?.emissive;
      const e = medallionEmissive(base, at(id, 905).medallionGlow);
      expect(e, id).toBeGreaterThanOrEqual(Math.min(1, base ?? 0));
      expect(e, id).toBeLessThanOrEqual(1);
      expect(e, id).toBeCloseTo(Math.min(1, (base ?? 0) + glow), 10);
      // r1: +0.35 was a darker disc with no glow; the dusk glow is at the clamp on every zone
      expect(e, id).toBeGreaterThanOrEqual(0.9);
      // the afternoon leaves the spec exactly as authored
      expect(medallionEmissive(base, at(id, 400).medallionGlow), id).toBe(medallionEmissive(base, 0));
    }
  });

  it('pause, death, revive and the run end: only the clock moves the arc; a repeated clock is free, so is everything past 900 s; a clock that goes back lands on the earlier phase exactly', () => {
    const look = withArc('daeryeol', undefined);
    const biome = zoneBiome('daeryeol');
    const step880PoolGain = (DEFAULT_ARC.find((k) => k.t === 880) as ArcStep).poolGain;
    const arc = new RunArc(look, biome);
    expect(arc.update(0, 0)).toBe(false);
    expect(arc.update(700, 0)).toBe(true);
    // paused / a modal / the death screen: the clock stands still, nothing is written
    for (let i = 0; i < 5; i++) expect(arc.update(700, 0)).toBe(false);
    // the clock runs into the hold: the first call at the dusk applies, the next ones (death screen, results) do not
    expect(arc.update(890, 0)).toBe(true);
    expect(arc.update(900, 0)).toBe(false);
    expect(arc.update(905, 0)).toBe(false);
    expect(arc.update(4000, 0)).toBe(false);
    expect(arc.state.poolGain).toBe(step880PoolGain);
    // a resync that lands a little behind (a guest) or a new run (clock back to 0) is the pure function again
    expect(arc.update(850, 0)).toBe(true);
    expect(sameState(arc.state, evaluate(look, 850, 0, biome))).toBe(true);
    expect(arc.update(0, 0)).toBe(true);
    expect(sameState(arc.state, arc.base)).toBe(true);
    // a world that has not started (NaN / negative clock) is the preset
    expect(arc.update(Number.NaN, 0)).toBe(false);
    expect(arc.update(-30, 0)).toBe(false);
  });

  it('?up=noarc keeps the preset at the dusk on every zone (the clean captures of the other lanes)', () => {
    for (const id of ZONES) {
      const off = new RunArc(withArc(id, undefined), zoneBiome(id), { switches: { noarc: true, nocorr: true } });
      expect(off.update(905, 1)).toBe(false);
      expect(sameState(off.state, off.base), id).toBe(true);
    }
  });
});

describe('medallion glow', () => {
  it('adds to MedallionSpec.emissive and clamps to 0..1', () => {
    expect(medallionEmissive(0.3, 0.35)).toBeCloseTo(0.65, 10);
    expect(medallionEmissive(0.8, 0.35)).toBe(1);
    expect(medallionEmissive(undefined, 0.35)).toBeCloseTo(0.35, 10);
    expect(medallionEmissive(0, 0)).toBe(0);
    expect(medallionEmissive(0.3, -2)).toBe(0);
    expect(medallionEmissive(Number.NaN, Number.NaN)).toBe(0);
    for (const id of ZONES) {
      const l = lookFor(id);
      expect(medallionEmissive(l.medallion?.emissive, 0), id).toBe(Math.min(1, Math.max(0, l.medallion?.emissive ?? 0)));
    }
  });

  it('the arc\'s medallionGlow reaches the output state', () => {
    const l = withArc('yeonmu', [{ t: 0 }, { t: 100, medallionGlow: 0.35 }]);
    expect(evaluate(l, 0, 0, BIOME).medallionGlow).toBe(0);
    expect(evaluate(l, 100, 0, BIOME).medallionGlow).toBe(0.35);
    expect(evaluate(l, 900, 0, BIOME).medallionGlow).toBe(0.35);
  });
});

describe('RunArc (per-frame change detection)', () => {
  const moving = withArc('yeonmu', [{ t: 0 }, { t: 100, sun: { intensity: 4.8 } }, { t: 200, poolGain: 3 }]);

  it('reports a change only when the state moved; a repeated clock (pause, a modal) is free', () => {
    const arc = new RunArc(moving, BIOME);
    expect(arc.identity).toBe(false);
    expect(arc.update(0, 0)).toBe(false); // t = 0 is the preset
    expect(arc.update(10, 0)).toBe(true);
    expect(arc.state.sun.intensity).toBeGreaterThan(2.4);
    expect(arc.update(10, 0)).toBe(false);
    expect(arc.update(10 + 1 / 60, 0)).toBe(true);
    // past the last key everything holds: the first call at the end applies, the next ones do not
    expect(arc.update(300, 0)).toBe(true);
    expect(arc.update(301, 0)).toBe(false);
    expect(arc.update(905, 0)).toBe(false);
    expect(arc.state.poolGain).toBe(3);
  });

  it('gradeDirty is set only when the grade itself moved', () => {
    const l = withArc('yeonmu', [{ t: 0 }, { t: 100, sun: { intensity: 4.8 } }, { t: 200, grade: { saturation: 0.8 } }]);
    const arc = new RunArc(l, BIOME);
    expect(arc.update(50, 0)).toBe(true);
    expect(arc.gradeDirty).toBe(false);
    expect(arc.update(150, 0)).toBe(true);
    expect(arc.gradeDirty).toBe(true);
  });

  it('the corruption input is clamped to 0..1, non-finite counts as 0, and up=nocorr forces 0', () => {
    const arc = new RunArc(moving, BIOME);
    arc.update(5, 0.4);
    expect(arc.corruption).toBe(0.4);
    arc.update(5, 7);
    expect(arc.corruption).toBe(1);
    arc.update(5, Number.NaN);
    expect(arc.corruption).toBe(0);
    arc.update(5, -2);
    expect(arc.corruption).toBe(0);
    const off = new RunArc(moving, BIOME, { switches: { noarc: false, nocorr: true } });
    off.update(5, 1);
    expect(off.corruption).toBe(0);
    // PL-04: an arc with no keys is silent only while the world is clean; corruption alone moves the light, and healing puts it back exactly
    const quiet = new RunArc(withArc('yeonmu', undefined), BIOME, { defaultArc: [] });
    expect(quiet.update(300, 0)).toBe(false);
    expect(quiet.update(300, 0.5)).toBe(true);
    expect(quiet.update(300, 0.5)).toBe(false);
    expect(quiet.update(300, 0)).toBe(true);
    expect(sameState(quiet.state, quiet.base)).toBe(true);
    expect(quiet.update(300, 0)).toBe(false);
  });

  it('up=noarc forces the identity whatever the keys say (the corruption tint is its own switch: nocorr)', () => {
    const arc = new RunArc(moving, BIOME, { switches: { noarc: true, nocorr: true } });
    expect(arc.identity).toBe(true);
    for (const t of sampleTimes) expect(arc.update(t, 0.5), `t=${t}`).toBe(false);
    expect(sameState(arc.state, arc.base)).toBe(true);
    const tinted = new RunArc(moving, BIOME, { switches: { noarc: true, nocorr: false } });
    expect(tinted.identity).toBe(true);
    for (const t of sampleTimes) expect(tinted.update(t, 0), `t=${t}`).toBe(false);
    expect(tinted.update(50, 0.5)).toBe(true);
    expect(tinted.state.sun.intensity).toBe(2.4);
  });

  it('follows a dev eval that replaces look.arc mid-run (the array identity changes: recompiled by itself)', () => {
    const l = withArc('yeonmu', undefined);
    const arc = new RunArc(l, BIOME, { defaultArc: [] });
    expect(arc.update(500, 0)).toBe(false);
    l.arc = [{ t: 0 }, { t: 1000, poolGain: 3 }];
    expect(arc.update(500, 0)).toBe(true);
    expect(arc.state.poolGain).toBeCloseTo(2, 10);
    l.arc = undefined;
    expect(arc.update(500, 0)).toBe(true);
    expect(arc.state.poolGain).toBe(1);
  });

  it('is a pure function of (look, clock): two evaluators and a fresh one agree on every clock, in any order', () => {
    const a = new RunArc(moving, BIOME);
    const b = new RunArc(moving, BIOME);
    for (const t of [250, 0, 33, 120, 99.9, 700, 100]) {
      a.update(t, 0);
      b.update(t, 0);
      expect(sameState(a.state, b.state), `t=${t}`).toBe(true);
      expect(sameState(a.state, evaluate(moving, t, 0, BIOME)), `t=${t}`).toBe(true);
    }
  });

  it('sampleFrames writes into the target without allocating states and never returns NaN', () => {
    const base = arcBase(moving, BIOME);
    const frames = compileKeys(arcKeysOf(moving), base);
    const out = cloneState(base);
    for (let t = -5; t < 400; t += 7.3) {
      expect(sampleFrames(frames, base, t, out)).toBe(out);
      expect(Number.isFinite(out.sun.intensity) && Number.isFinite(out.poolGain) && Number.isFinite(out.sun.color.r)).toBe(true);
    }
  });
});

describe('the page switches (DEV / VITE_QA_HOOKS only)', () => {
  it('?up=noarc,nocorr turns both on; one word turns one on; case, encoding and several up= pairs are handled', () => {
    expect(parseArcSwitches('?up=noarc,nocorr', true)).toEqual({ noarc: true, nocorr: true });
    expect(parseArcSwitches('?up=noarc', true)).toEqual({ noarc: true, nocorr: false });
    expect(parseArcSwitches('?zone=yeonmu&up=nocorr&q=high', true)).toEqual({ noarc: false, nocorr: true });
    expect(parseArcSwitches('?up=NoArc%2CNoCorr', true)).toEqual({ noarc: true, nocorr: true });
    expect(parseArcSwitches('?up=nobeacon&up=noarc', true)).toEqual({ noarc: true, nocorr: false });
    expect(parseArcSwitches('?up=nobeacon', true)).toBe(NO_SWITCHES);
    expect(parseArcSwitches('?up=noarcs,xnocorr', true)).toBe(NO_SWITCHES);
    expect(parseArcSwitches('?up=%E0%A4%A', true)).toBe(NO_SWITCHES);
    expect(parseArcSwitches('', true)).toBe(NO_SWITCHES);
    expect(parseArcSwitches(undefined, true)).toBe(NO_SWITCHES);
  });

  it('a plain production build ignores them whatever the URL says', () => {
    expect(parseArcSwitches('?up=noarc,nocorr', false)).toBe(NO_SWITCHES);
  });

  it('the page of a test (no location) has no switches', () => {
    expect(pageArcSwitches()).toBe(NO_SWITCHES);
  });
});

describe('the corruption tint (PL-04): the land reacts to the corruption of the world', () => {
  const M = CORRUPTION_MOOD;
  const D = DEFAULT_CORRUPTION;
  const NOCORR = { noarc: false, nocorr: true } as const;
  const at = (id: string, t: number, c: number, opts?: Parameters<typeof evaluate>[4]): ArcState => evaluate(withArc(id, undefined), t, c, zoneBiome(id), opts);
  /** the zone's corruption tint as the arc builds it (with the warmth of its preset key light) */
  const tintOf = (id: string): ReturnType<typeof corruptionTintOf> => corruptionTintOf(lookFor(id), arcBase(withArc(id, undefined), zoneBiome(id)).sun.color);
  const warmOf = (id: string): number => tintOf(id).warmth;
  /** the saturation boost and the split-tone amount a zone takes at full corruption (a deep gold key light: less boost, more violet) */
  const satBoostOf = (id: string): number => M.satBoost * (1 - M.warmSatCut * warmOf(id));
  const shadowAmtOf = (id: string): number => M.gradeShadowAmt * (1 + M.warmShadowAmt * warmOf(id));
  /** the factor on the baked shadow fill at corruption c: thinned by `darken`, or (a warm-key zone) lifted by `warmFillLift` */
  const fillFactor = (id: string, c: number, darken = D.darken): number => (1 - warmOf(id)) * (1 - darken * c) + warmOf(id) * (1 + M.warmFillLift * c);
  const lin = (hex: string): Color => new Color().set(hex);
  const lerpC = (a: Color, b: Color, s: number): [number, number, number] => [a.r + (b.r - a.r) * s, a.g + (b.g - a.g) * s, a.b + (b.b - a.b) * s];
  const expectColor = (c: Color, want: readonly [number, number, number], what: string): void => {
    expect(c.r, `${what} r`).toBeCloseTo(want[0], 5);
    expect(c.g, `${what} g`).toBeCloseTo(want[1], 5);
    expect(c.b, `${what} b`).toBeCloseTo(want[2], 5);
  };
  const lum = (r: readonly number[]): number => 0.2126 * (r[0] as number) + 0.7152 * (r[1] as number) + 0.0722 * (r[2] as number);
  const lumC = (c: Color): number => lum([c.r, c.g, c.b]);
  /** how far the hue (r, g, b over their sum) of `c` is from the hue of `to` */
  const hueDist = (c: Color, to: Color): number => {
    const a = c.r + c.g + c.b;
    const b = to.r + to.g + to.b;
    return Math.hypot(c.r / a - to.r / b, c.g / a - to.g / b, c.b / a - to.b / b);
  };
  /** the composite pass's saturation block (after the grade): mix(luma, rgb, sat) */
  const saturate = (r: readonly number[], sat: number): number[] => {
    const l = lum(r);
    return r.map((v) => l + (v - l) * sat);
  };
  const chroma = (r: number[]): number => Math.hypot((r[0] as number) - lum(r), (r[1] as number) - lum(r), (r[2] as number) - lum(r));
  /** the states' channels the corruption writes (everything else must stay the arc's) */
  const restoreCorruptionChannels = (s: ArcState, arc: ArcState): ArcState => {
    const rest = cloneState(s);
    rest.grade.saturation = arc.grade.saturation;
    rest.grade.contrast = arc.grade.contrast;
    rest.grade.gain = [arc.grade.gain[0], arc.grade.gain[1], arc.grade.gain[2]];
    rest.grade.shadowTint.copy(arc.grade.shadowTint);
    rest.grade.shadowAmt = arc.grade.shadowAmt;
    rest.hemi.sky.copy(arc.hemi.sky);
    rest.hemi.ground.copy(arc.hemi.ground);
    rest.hemi.intensity = arc.hemi.intensity;
    rest.zoneFill.sky.copy(arc.zoneFill.sky);
    rest.zoneFill.ground.copy(arc.zoneFill.ground);
    rest.sun.color.copy(arc.sun.color);
    rest.fill.shadowTint.copy(arc.fill.shadowTint);
    rest.fill.shadowFill = arc.fill.shadowFill;
    rest.haze.color.copy(arc.haze.color);
    rest.haze.depth = arc.haze.depth;
    rest.fog.color.copy(arc.fog.color);
    rest.fog.near = arc.fog.near;
    rest.fog.far = arc.fog.far;
    return rest;
  };

  it('c = 0 is the identity, bit for bit: the arc alone, on every zone at every clock; a clean world writes nothing', () => {
    for (const id of ZONES) {
      const biome = zoneBiome(id);
      for (const t of sampleTimes) {
        expect(sameState(at(id, t, 0), at(id, t, 1, { switches: NOCORR })), `${id} t=${t}`).toBe(true);
        expect(sameState(at(id, t, 0, { switches: { noarc: true, nocorr: false } }), arcBase(withArc(id, undefined), biome)), `${id} noarc t=${t}`).toBe(true);
      }
      // applyCorruption itself: c = 0 / NaN / negative never touches a state
      const s = at(id, 700, 0);
      const before = cloneState(s);
      for (const c of [0, -1, Number.NaN]) applyCorruption(s, c, corruptionTintOf(lookFor(id)));
      expect(sameState(s, before), id).toBe(true);
    }
  });

  it('the zone\'s own fill hemisphere is part of the state: the preset colours at c = 0, on every clock', () => {
    for (const id of ZONES) {
      const look = lookFor(id);
      const base = arcBase(withArc(id, undefined), zoneBiome(id));
      expectColor(base.zoneFill.sky, lin(look.fill.sky).toArray() as [number, number, number], `${id} fill sky`);
      expectColor(base.zoneFill.ground, lin(look.fill.ground).toArray() as [number, number, number], `${id} fill ground`);
      for (const t of [0, 400, 800, 905]) {
        const s = at(id, t, 0);
        expectColor(s.zoneFill.sky, lin(look.fill.sky).toArray() as [number, number, number], `${id} t=${t} fill sky`);
        expectColor(s.zoneFill.ground, lin(look.fill.ground).toArray() as [number, number, number], `${id} t=${t} fill ground`);
      }
    }
  });

  it('full corruption, by the numbers (t = 0: the preset): a violet split tone and bruised shadows, the lit colour kept, the far air cold and deep', () => {
    for (const id of ZONES) {
      const base = arcBase(withArc(id, undefined), zoneBiome(id));
      const tint = tintOf(id);
      const s = at(id, 0, 1);
      // the grade: the lit colour is NOT taken away (the saturation of the grade rises: the violet split tone pulls toward grey and this puts it back)
      expect(s.grade.saturation, `${id} saturation`).toBeCloseTo(base.grade.saturation * (1 - D.desaturate * M.gradeSatShare + satBoostOf(id)), 10);
      expect(s.grade.saturation, `${id} the lit colour is kept`).toBeGreaterThan(base.grade.saturation);
      expect(s.grade.contrast, `${id} contrast`).toBeCloseTo(base.grade.contrast + M.contrast, 10);
      for (let i = 0; i < 3; i++) expect(s.grade.gain[i] as number, `${id} gain ${i}`).toBeCloseTo((base.grade.gain[i] as number) * (1 + M.gain), 10);
      // a violet split tone on the shadows: an amount ADDED, at a DARK tint (no veil), bluer than green
      expect(s.grade.shadowAmt, `${id} split-tone amount`).toBeCloseTo(base.grade.shadowAmt + shadowAmtOf(id), 10);
      expect(lumC(tint.gradeTint), `${id} tint luma`).toBeCloseTo(M.gradeTintLuma, 6);
      expect(tint.gradeTint.b, `${id} violet`).toBeGreaterThan(tint.gradeTint.g * 1.5);
      if (base.grade.shadowAmt === 0) expectColor(s.grade.shadowTint, tint.gradeTint.toArray() as [number, number, number], `${id} split tone tint`);
      // the baked shadows of the ground: toward the bruise, a little thinner
      expect(s.fill.shadowFill, `${id} fill`).toBeCloseTo(base.fill.shadowFill * fillFactor(id, 1), 10);
      // (YA-04: the zone's own corruption shadow tint when it has one, the PL-04 default otherwise)
      expectColor(s.fill.shadowTint, lerpC(base.fill.shadowTint, tint.shadowTint, 1), `${id} shadow tint`);
      // the light that fills the shadows: hue toward the bruise, brightness kept (hemisphere intensity + 10 %)
      for (const [name, a, b] of [
        ['hemi sky', base.hemi.sky, s.hemi.sky],
        ['hemi ground', base.hemi.ground, s.hemi.ground],
        ['fill sky', base.zoneFill.sky, s.zoneFill.sky],
        ['fill ground', base.zoneFill.ground, s.zoneFill.ground],
      ] as const) {
        expect(lumC(b), `${id} ${name} brightness`).toBeCloseTo(lumC(a), 6);
        // (a light that is already the bruise's hue, Daeryeol's violet fill, only loses its share of colour)
        expect(hueDist(b, tint.bruise) < hueDist(a, tint.bruise) || hueDist(a, tint.bruise) < 0.08, `${id} ${name} hue moved toward the bruise`).toBe(true);
      }
      expect(s.hemi.intensity, `${id} hemisphere`).toBeCloseTo(base.hemi.intensity * (1 + M.hemiBoost), 10);
      // the key light keeps its exposure
      expect(s.sun.intensity).toBe(base.sun.intensity);
      // the far air: colour toward the sick haze and DARKER (never a lighter veil), the fog closer, the haze a little thicker, the mist the zone's
      expect(lumC(s.haze.color), `${id} haze brightness`).toBeCloseTo(lumC(base.haze.color) * (1 - M.hazeDeepen), 6);
      expect(lumC(s.fog.color), `${id} fog brightness`).toBeCloseTo(lumC(base.fog.color) * (1 - M.fogDeepen), 6);
      expect(hueDist(s.haze.color, tint.haze), `${id} haze hue`).toBeLessThan(hueDist(base.haze.color, tint.haze));
      expect(hueDist(s.fog.color, tint.haze), `${id} fog hue`).toBeLessThan(hueDist(base.fog.color, tint.haze));
      expect(s.fog.near, `${id} fog near`).toBeCloseTo(base.fog.near * (1 - M.fogNear), 10);
      expect(s.fog.far, `${id} fog far`).toBeCloseTo(Math.max(s.fog.near + 1, base.fog.far * (1 - M.fogFar)), 10);
      expect(s.haze.depth, `${id} haze depth`).toBeCloseTo(Math.min(1, base.haze.depth + M.hazeDepth), 10);
      expect(s.haze.mist, `${id} mist`).toBe(base.haze.mist);
      // the lantern pools, the medallion and the grade's lift / gamma / highlights are the arc's
      expect(s.poolGain).toBe(base.poolGain);
      expect(s.medallionGlow).toBe(base.medallionGlow);
      expect(s.grade.highlightAmt).toBe(base.grade.highlightAmt);
      expect(s.grade.lift).toBe(base.grade.lift);
      expect(s.grade.gamma).toBe(base.grade.gamma);
    }
  });

  it('a warm key light stays golden: a pale one turns toward the bruise (the more golden the sun, the less it is turned), its exposure never moves', () => {
    const turned = (id: string): number => {
      const base = arcBase(withArc(id, undefined), zoneBiome(id));
      const s = at(id, 0, 1);
      expect(s.sun.intensity).toBe(base.sun.intensity);
      return hueDist(base.sun.color, tintOf(id).bruise) - hueDist(s.sun.color, tintOf(id).bruise);
    };
    // Seori's sun is nearly white: it turns; Suryeon's is a deep gold: it does not
    expect(turned('seori')).toBeGreaterThan(0.002);
    expect(turned('suryeon')).toBe(0);
    for (const id of ZONES) expect(turned(id), id).toBeGreaterThanOrEqual(0);
  });

  it('half corruption is half way: the amounts and brightness changes are linear in c, the hues move one way', () => {
    for (const id of ZONES) {
      const base = arcBase(withArc(id, undefined), zoneBiome(id));
      const full = at(id, 0, 1);
      const tint = tintOf(id);
      let prevSkyDist = Infinity;
      let prevFogDist = Infinity;
      for (const c of [0, 0.25, 0.5, 0.75, 1]) {
        const s = at(id, 0, c);
        expect(s.grade.saturation, `${id} sat c=${c}`).toBeCloseTo(base.grade.saturation * (1 - D.desaturate * M.gradeSatShare * c + satBoostOf(id) * c), 10);
        expect(s.grade.shadowAmt, `${id} amount c=${c}`).toBeCloseTo(base.grade.shadowAmt + shadowAmtOf(id) * c, 10);
        expect(s.grade.contrast, `${id} contrast c=${c}`).toBeCloseTo(base.grade.contrast + M.contrast * c, 10);
        expect(s.fill.shadowFill, `${id} fill c=${c}`).toBeCloseTo(base.fill.shadowFill * fillFactor(id, c), 10);
        expectColor(s.fill.shadowTint, lerpC(base.fill.shadowTint, full.fill.shadowTint, c), `${id} shadow tint c=${c}`);
        expect(s.fog.near, `${id} fog near c=${c}`).toBeCloseTo(base.fog.near * (1 - M.fogNear * c), 10);
        expect(lumC(s.fog.color), `${id} fog brightness c=${c}`).toBeCloseTo(lumC(base.fog.color) * (1 - M.fogDeepen * c), 6);
        expect(lumC(s.haze.color), `${id} haze brightness c=${c}`).toBeCloseTo(lumC(base.haze.color) * (1 - M.hazeDeepen * c), 6);
        expect(s.hemi.intensity, `${id} hemisphere c=${c}`).toBeCloseTo(base.hemi.intensity * (1 + M.hemiBoost * c), 10);
        const skyDist = hueDist(s.hemi.sky, tint.bruise);
        const fogDist = hueDist(s.fog.color, tint.haze);
        expect(skyDist).toBeLessThanOrEqual(prevSkyDist + 1e-9);
        expect(fogDist).toBeLessThanOrEqual(prevFogDist + 1e-9);
        prevSkyDist = skyDist;
        prevFogDist = fogDist;
      }
    }
  });

  it('composes multiplicatively with the arc: at 0 / 400 / 600 / 800 / 905 s the corrupted state is the arc state with exactly the corruption channels changed', () => {
    for (const id of ZONES) {
      for (const t of [0, 400, 600, 800, 905]) {
        const arc = at(id, t, 0);
        const s = at(id, t, 0.6);
        // the channels follow the formulas ON TOP of what the arc made of the light
        expect(s.grade.saturation, `${id} t=${t}`).toBeCloseTo(arc.grade.saturation * (1 - D.desaturate * M.gradeSatShare * 0.6 + satBoostOf(id) * 0.6), 10);
        expect(s.grade.shadowAmt, `${id} t=${t}`).toBeCloseTo(arc.grade.shadowAmt + shadowAmtOf(id) * 0.6, 10);
        expect(s.grade.contrast, `${id} t=${t}`).toBeCloseTo(arc.grade.contrast + M.contrast * 0.6, 10);
        expect(s.fill.shadowFill, `${id} t=${t}`).toBeCloseTo(arc.fill.shadowFill * fillFactor(id, 0.6), 10);
        expectColor(s.fill.shadowTint, lerpC(arc.fill.shadowTint, tintOf(id).shadowTint, 0.6), `${id} t=${t} shadow tint`);
        expect(s.fog.near, `${id} t=${t}`).toBeCloseTo(arc.fog.near * (1 - M.fogNear * 0.6), 10);
        expect(s.hemi.intensity, `${id} t=${t}`).toBeCloseTo(arc.hemi.intensity * (1 + M.hemiBoost * 0.6), 10);
        expect(s.sun.intensity, `${id} t=${t}`).toBe(arc.sun.intensity);
        // the split-tone tint is a WEIGHTED blend: the arc's own tint keeps its share, so a pale tint at a small amount never lifts the blacks
        if (arc.grade.shadowAmt > 0) {
          const w = (shadowAmtOf(id) * 0.6) / (arc.grade.shadowAmt + shadowAmtOf(id) * 0.6);
          expectColor(s.grade.shadowTint, lerpC(arc.grade.shadowTint, tintOf(id).gradeTint, w), `${id} t=${t} grade tint`);
        }
        // and nothing else moved: the sun's exposure, haze mist, the grade's lift / gamma / pivot / balance / highlights, the lantern pools, the medallion
        expect(sameState(restoreCorruptionChannels(s, arc), arc), `${id} t=${t}: only the corruption channels differ`).toBe(true);
      }
    }
  });

  it('no milky veil: at full corruption the grade never lifts a dark pixel by more than 2 levels, never lifts anything below the S-curve pivot by more than 5 %, and the shadows turn violet (every zone, 0 .. 905 s)', () => {
    for (const id of ZONES) {
      for (const t of [0, 300, 600, 700, 800, 880, 905]) {
        const u0 = gradeUniforms(gradeSpecOf(at(id, t, 0).grade));
        const u1 = gradeUniforms(gradeSpecOf(at(id, t, 1).grade));
        for (const px of [0.005, 0.01, 0.02, 0.05, 0.1, 0.15]) {
          const ref = gradePixel([px, px, px], u0);
          const g = gradePixel([px, px, px], u1);
          expect(lum(g), `${id} t=${t} px ${px} luma`).toBeLessThanOrEqual(lum(ref) * 1.05 + 0.002);
          // the lift is hue, not light: the blacks turn aubergine (the blue of the tint, at most 0.01 linear = the very darkest pixels), never grey
          for (let c = 0; c < 3; c++) expect(g[c] as number, `${id} t=${t} px ${px} ch ${c}`).toBeLessThanOrEqual((ref[c] as number) * 1.1 + 0.01);
          expect(Math.min(g[0] as number, g[1] as number), `${id} t=${t} px ${px}: red and green do not rise (no grey lift)`).toBeLessThanOrEqual(Math.max(ref[0] as number, ref[1] as number) * 1.05 + 0.002);
          if (px >= 0.01) expect((g[2] as number) - (g[1] as number), `${id} t=${t} px ${px}: bluer than before`).toBeGreaterThan((ref[2] as number) - (ref[1] as number));
        }
      }
    }
  });

  it('telegraphs, the hero ring and the pickups stay readable at full corruption on the dusk of every zone: the colour is kept (not drained), the light within 15 %, red stays red, gold stays gold', () => {
    const redTelegraph = [0.8, 0.1, 0.08];
    const gold = [0.9, 0.7, 0.2];
    const ring = [0.9, 0.55, 0.15];
    for (const id of ZONES) {
      for (const t of [0, 800, 905]) {
        const clean = at(id, t, 0);
        const dirty = at(id, t, 1);
        const uc = gradeUniforms(gradeSpecOf(clean.grade));
        const ud = gradeUniforms(gradeSpecOf(dirty.grade));
        for (const px of [redTelegraph, gold, ring]) {
          const a = saturate(gradePixel([px[0] as number, px[1] as number, px[2] as number], uc), uc.saturation);
          const b = saturate(gradePixel([px[0] as number, px[1] as number, px[2] as number], ud), ud.saturation);
          expect(lum(b) / lum(a), `${id} t=${t} luma`).toBeGreaterThan(0.85);
          expect(lum(b) / lum(a), `${id} t=${t} luma`).toBeLessThan(1.15);
          // never a grey film: at least as colourful as before, within a quarter more
          expect(chroma(b) / chroma(a), `${id} t=${t} chroma`).toBeGreaterThan(0.95);
          expect(chroma(b) / chroma(a), `${id} t=${t} chroma`).toBeLessThan(1.3);
          // the hue stays: the dominant channel stays the dominant one and the order of the channels is kept
          expect(b[0], `${id} t=${t} r`).toBeGreaterThan(b[1] as number);
          expect(b[1], `${id} t=${t} g`).toBeGreaterThan(b[2] as number);
        }
        // the exposure of the key light and the pools never move
        expect(dirty.sun.intensity).toBe(clean.sun.intensity);
        expect(dirty.poolGain).toBe(clean.poolGain);
        expect(dirty.medallionGlow).toBe(clean.medallionGlow);
      }
    }
  });

  it('a zone with a look.corruption of its own overrides the default for the fields it names; an explicit 0 turns a channel off; nonsense falls back', () => {
    const base = arcBase(withArc('yeonmu', undefined), zoneBiome('yeonmu'));
    const own = withArc('yeonmu', undefined, (l) => {
      l.corruption = { desaturate: 0.4, haze: '#335533' };
    });
    const s = evaluate(own, 0, 1, zoneBiome('yeonmu'));
    expect(s.grade.saturation).toBeCloseTo(base.grade.saturation * (1 - 0.4 * M.gradeSatShare + M.satBoost), 10);
    expect(s.fill.shadowFill).toBeCloseTo(base.fill.shadowFill * (1 - D.darken), 10);
    // the haze and the fog turn toward ITS haze colour, not the default one
    expect(hueDist(s.haze.color, lin('#335533'))).toBeLessThan(hueDist(base.haze.color, lin('#335533')));
    expect(hueDist(s.haze.color, lin(D.haze))).toBeGreaterThan(hueDist(evaluate(withArc('yeonmu', undefined), 0, 1, zoneBiome('yeonmu')).haze.color, lin(D.haze)));
    expectColor(s.fill.shadowTint, lin(D.shadowTint).toArray() as [number, number, number], 'default shadow tint');
    // a zone's own bruise hue drives the baked shadows, the hemispheres and the split tone
    const violet = withArc('yeonmu', undefined, (l) => {
      l.corruption = { shadowTint: '#3a6a3a' };
    });
    const v = evaluate(violet, 0, 1, zoneBiome('yeonmu'));
    expectColor(v.fill.shadowTint, lin('#3a6a3a').toArray() as [number, number, number], 'own shadow tint');
    expect(v.grade.shadowTint.g, 'a green bruise: the split tone is green').toBeGreaterThan(v.grade.shadowTint.b);

    const off = withArc('yeonmu', undefined, (l) => {
      l.corruption = { desaturate: 0, darken: 0 };
    });
    const o = evaluate(off, 0, 1, zoneBiome('yeonmu'));
    expect(o.grade.saturation).toBeCloseTo(base.grade.saturation * (1 + M.satBoost), 10);
    expect(o.fill.shadowFill).toBe(base.fill.shadowFill);
    // desaturate 0: the shadow-side light keeps its colour (only the hue moves)
    expect(o.hemi.sky.r + o.hemi.sky.g + o.hemi.sky.b).toBeGreaterThan(0);

    const junk = corruptionTintOf({ corruption: { desaturate: Number.NaN, darken: 7, shadowTint: 'nope', haze: '' } });
    expect(junk.desaturate).toBe(D.desaturate);
    expect(junk.darken).toBe(1);
    expectColor(junk.shadowTint, lin(D.shadowTint).toArray() as [number, number, number], 'junk shadow tint');
    expectColor(junk.haze, lin(D.haze).toArray() as [number, number, number], 'junk haze');
    const neg = corruptionTintOf({ corruption: { desaturate: -3 } });
    expect(neg.desaturate).toBe(0);
    // every state value stays finite and in range for the harshest tint a zone could name
    const harsh = withArc('daeryeol', undefined, (l) => {
      l.corruption = { desaturate: 1, darken: 1, shadowTint: '#ffffff', haze: '#000000' };
    });
    for (const t of [0, 800, 905]) {
      const h = evaluate(harsh, t, 1, zoneBiome('daeryeol'));
      for (const col of [h.hemi.sky, h.hemi.ground, h.zoneFill.sky, h.zoneFill.ground, h.haze.color, h.fog.color, h.sun.color, h.grade.shadowTint, h.fill.shadowTint]) {
        for (const v2 of [col.r, col.g, col.b]) {
          expect(Number.isFinite(v2)).toBe(true);
          expect(v2).toBeGreaterThanOrEqual(0);
        }
      }
      expect(h.fog.far).toBeGreaterThan(h.fog.near);
      expect(h.grade.saturation).toBeGreaterThan(0);
    }
  });

  it('is smoothed over 2 s: a jump of the corruption eases in (95 % after 2 s, exact after the settle) and heals back the same way; a steady world costs nothing', () => {
    expect(CORRUPTION_SETTLE_S).toBe(2);
    const look = withArc('yeonmu', undefined);
    const arc = new RunArc(look, zoneBiome('yeonmu'));
    const dt = 1 / 60;
    arc.update(100, 0, dt);
    expect(arc.corruption).toBe(0);
    // the world is suddenly fully corrupt (a swarm awakens): the first frame moves only a little
    arc.update(100, 1, dt);
    expect(arc.corruption).toBeGreaterThan(0);
    expect(arc.corruption).toBeLessThan(0.06);
    let prev = arc.corruption;
    for (let i = 1; i < 120; i++) {
      expect(arc.update(100, 1, dt), `frame ${i}`).toBe(true);
      expect(arc.corruption, `frame ${i}`).toBeGreaterThan(prev);
      expect(arc.corruption, `frame ${i}`).toBeLessThan(1);
      prev = arc.corruption;
    }
    expect(arc.corruption).toBeCloseTo(0.95, 6); // 120 frames = 2 s
    expect(arc.gradeDirty).toBe(true); // the split tone moves: the composite pass is fed
    for (let i = 0; i < 480; i++) arc.update(100, 1, dt);
    expect(arc.corruption).toBe(1);
    expect(sameState(arc.state, at('yeonmu', 100, 1))).toBe(true);
    // settled: the same clock and corruption are free again
    expect(arc.update(100, 1, dt)).toBe(false);
    // the last metin breaks: the land heals the same way and lands on the clean arc exactly
    arc.update(100, 0, dt);
    for (let i = 1; i < 120; i++) arc.update(100, 0, dt);
    expect(arc.corruption).toBeCloseTo(0.05, 6);
    for (let i = 0; i < 480; i++) arc.update(100, 0, dt);
    expect(arc.corruption).toBe(0);
    expect(sameState(arc.state, at('yeonmu', 100, 0))).toBe(true);
    expect(arc.update(100, 0, dt)).toBe(false);
  });

  it('smoothing edge cases: the first value is taken as is (a late joiner), dt 0 holds, no / bad dt snaps, a hitch converges without overshoot, the frame rate does not matter, up=nocorr stays 0', () => {
    const look = withArc('daeryeol', undefined);
    const biome = zoneBiome('daeryeol');
    // a guest that joins in a corrupted world does not fade the land in from clean
    const late = new RunArc(look, biome);
    late.update(500, 0.8, 1 / 60);
    expect(late.corruption).toBe(0.8);
    // a paused frame (dt 0) holds; a clock that did not move and no dt snaps (tests, evaluate)
    late.update(500, 0.2, 0);
    expect(late.corruption).toBe(0.8);
    late.update(500, 0.2);
    expect(late.corruption).toBe(0.2);
    late.update(500, 0.9, Number.NaN);
    expect(late.corruption).toBe(0.9);
    late.update(500, 0.1, -1);
    expect(late.corruption).toBe(0.1);
    // a long hitch (a hidden tab, 12 s) lands on the target, never beyond it
    late.update(500, 1, 12);
    expect(late.corruption).toBe(1);
    late.update(500, 0, 12);
    expect(late.corruption).toBe(0);
    // 60 / 30 / 144 Hz reach the same corruption after one second
    const reach = (hz: number): number => {
      const a = new RunArc(look, biome);
      a.update(10, 0, 1 / hz);
      for (let i = 0; i < hz; i++) a.update(10, 1, 1 / hz);
      return a.corruption;
    };
    expect(reach(30)).toBeCloseTo(reach(60), 9);
    expect(reach(144)).toBeCloseTo(reach(60), 9);
    // up=nocorr: nothing to follow
    const off = new RunArc(look, biome, { switches: NOCORR });
    for (let i = 0; i < 200; i++) expect(off.update(0, 1, 1 / 60), `frame ${i}`).toBe(false); // t = 0: the arc itself is the preset
    expect(off.corruption).toBe(0);
    // the corruption follows its own clock: pausing the run clock (a modal) does not freeze the healing
    const paused = new RunArc(look, biome);
    paused.update(200, 0, 1 / 60);
    for (let i = 0; i < 30; i++) paused.update(200, 1, 1 / 60);
    expect(paused.corruption).toBeGreaterThan(0.4);
  });

  it('a dev eval that replaces look.corruption is picked up by the running evaluator', () => {
    const look = withArc('seori', undefined);
    const arc = new RunArc(look, zoneBiome('seori'));
    arc.update(100, 1);
    const before = arc.state.grade.saturation;
    expect(arc.update(100, 1)).toBe(false);
    look.corruption = { desaturate: 0.5 };
    expect(arc.update(100, 1)).toBe(true);
    expect(arc.state.grade.saturation).toBeLessThan(before);
    expect(arc.state.grade.saturation).toBeCloseTo(at('seori', 100, 0).grade.saturation * (1 - 0.5 * M.gradeSatShare + M.satBoost), 10);
  });

  it('it is uniforms only: the evaluator and the tint touch no three scene object, and the renderer hands the frame time to the arc and the fill hemisphere its colours', async () => {
    const { readFileSync } = await import('node:fs');
    const zoneScene = readFileSync(new URL('./zoneScene.ts', import.meta.url), 'utf8');
    expect(zoneScene).toMatch(/arc\.update\(run\.time, run\.corruption, dt\)/);
    // low (no composite pass) is told, so the channels it draws take the stronger share; the pass can come and go with the tier
    expect(zoneScene).toMatch(/arc\.composite = asPostPipeline\(core\.composer\)\?\.active === true/);
    // the zone's own fill hemisphere takes the corrupted colours (a light colour is a uniform: no program changes), never a new light
    expect(zoneScene).toMatch(/fill\.color\.copy\(s\.zoneFill\.sky\)/);
    expect(zoneScene).toMatch(/fill\.groundColor\.copy\(s\.zoneFill\.ground\)/);
    // no material, define or program is created for the corruption (global rule 7): arc.ts has no GL object at all
    const arcSrc = readFileSync(new URL('./arc.ts', import.meta.url), 'utf8');
    expect(arcSrc).not.toMatch(/new (ShaderMaterial|MeshStandardMaterial|Material|WebGLRenderTarget|Mesh|HemisphereLight|DirectionalLight)\b/);
    expect(arcSrc).not.toMatch(/\bdefines\b|needsUpdate/);
    // a plain build carries no tuning hook (the mood numbers are constants)
    expect(arcSrc).not.toMatch(/URLSearchParams\(location|TEMP-TUNE/);
    // the host and the guest both feed the arc from the world the HUD reads (the mirror carries it)
    const run = readFileSync(new URL('../../app/run.ts', import.meta.url), 'utf8');
    expect(run).toMatch(/clock\.corruption = this\.world\.corruption/);
  });
});

describe('the relief pulse (PL-04): a metin break heals the land, on the run clock, as the player looks back at the world after the Metin Essence offer', () => {
  const DT = 1 / 60;
  const NOCORR = { noarc: false, nocorr: true } as const;
  /** an arc on a zone, settled at corruption `c0` (3 s of frames on a RUNNING clock), from the late-run clock 800 s */
  const settled = (id: string, c0: number, opts: ConstructorParameters<typeof RunArc>[2] = {}, t = 800): RunArc => {
    const a = new RunArc(withArc(id, undefined), zoneBiome(id), opts);
    a.update(t, c0, DT);
    for (let i = 0; i < 180; i++) a.update(t + (i + 1) * DT, c0, DT);
    return a;
  };
  /**
   * one frame of `dt` (the frame time) fed with `c`; the run clock moves by `run` (default: by dt, the sim ran). `run` 0 is a frame behind an
   * offer / the pause menu: the sim stands still, the renderer keeps drawing. The pulse ages on the clock, never on dt.
   */
  const step = (a: RunArc, c: number, dt = DT, run = dt): boolean => a.update(a.time + run, c, dt);
  /** frames fed with `c` (the run clock moving by `run` per frame, default one frame); returns the highest pulse level seen */
  const feed = (a: RunArc, c: number, frames: number, run = DT): number => {
    let peak = 0;
    for (let i = 0; i < frames; i++) {
      step(a, c, DT, run);
      peak = Math.max(peak, a.relief);
    }
    return peak;
  };
  const plain = (id: string, c: number, t = 800, composite = true): ArcState => {
    const a = new RunArc(withArc(id, undefined), zoneBiome(id));
    a.composite = composite;
    a.update(t, c);
    return a.state;
  };

  it('the envelope: 0 before / after / for nonsense, a smooth rise to 1 over attackS, a smooth monotone fall back to 0 over decayS, never above 1', () => {
    for (const age of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, HEAL.attackS + HEAL.decayS, 99]) expect(healEnvelope(age), `age ${age}`).toBe(0);
    expect(healEnvelope(HEAL.attackS)).toBe(1);
    let prev = 0;
    for (let age = 0; age <= HEAL.attackS; age += HEAL.attackS / 20) {
      const e = healEnvelope(age);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(e).toBeLessThanOrEqual(1);
      prev = e;
    }
    prev = 1;
    for (let k = 0; k <= 40; k++) {
      const e = healEnvelope(HEAL.attackS + (HEAL.decayS * k) / 40);
      expect(e).toBeLessThanOrEqual(prev + 1e-12);
      expect(e).toBeGreaterThanOrEqual(0);
      prev = e;
    }
    // a plateau-ish peak: still more than 90 % a fifth of the way down, half at the middle of the fall, about gone in the last fifth
    expect(healEnvelope(HEAL.attackS + HEAL.decayS * 0.2)).toBeGreaterThan(0.85);
    expect(healEnvelope(HEAL.attackS + HEAL.decayS * 0.5)).toBeCloseTo(0.5, 6);
    expect(healEnvelope(HEAL.attackS + HEAL.decayS * 0.9)).toBeLessThan(0.03);
  });

  it('the sickness gate: a healthy land has nothing to be relieved of, a sick one pulses in full', () => {
    expect(healSickness(0)).toBe(0);
    expect(healSickness(HEAL.sickLow)).toBe(0);
    expect(healSickness(HEAL.sickFull)).toBe(1);
    expect(healSickness(1)).toBe(1);
    expect(healSickness(0.2)).toBeGreaterThan(0);
    expect(healSickness(0.2)).toBeLessThan(1);
  });

  it('fires on a metin break (-0.06 at 0.9): the pulse peaks at 1 within a fraction of a second, the land is clearly lighter and clearer, then it is gone', async () => {
    // the sim's break lowers the corruption by exactly HEAL.breakDrop (sim/metins.ts); if that number moves the pulse must be retuned
    const metins = (await import('node:fs')).readFileSync(new URL('../../sim/metins.ts', import.meta.url), 'utf8');
    expect(metins).toMatch(new RegExp(`w\\.corruption = Math\\.max\\(0, w\\.corruption - ${HEAL.breakDrop}\\)`));
    for (const id of ZONES) {
      const a = settled(id, 0.9);
      expect(a.relief, `${id} settled`).toBe(0);
      const calm = cloneState(a.state);
      // the break: the sim's corruption drops by exactly 0.06 in one tick
      step(a, 0.84);
      expect(a.relief, `${id} first frame of the pulse`).toBeLessThan(0.1);
      let peak = 0;
      let peakState = cloneState(a.state);
      for (let i = 0; i < 30; i++) {
        step(a, 0.84);
        if (a.relief > peak) {
          peak = a.relief;
          peakState = cloneState(a.state);
        }
      }
      expect(peak, `${id} peak`).toBeGreaterThan(0.99);
      // at the peak: more light (exposure, key light, hemispheres), the air pushed back, the sickness half lifted
      const H = HEAL;
      // (the tint's own 3 % of exposure is lifted with the sickness, so the net lift is a little under H.gain)
      expect(peakState.grade.gain[0] as number, `${id} exposure`).toBeGreaterThan((calm.grade.gain[0] as number) * (1 + H.gain * 0.6));
      expect(peakState.sun.intensity, `${id} key light`).toBeGreaterThan(calm.sun.intensity * (1 + H.sun * 0.8));
      expect(peakState.hemi.intensity, `${id} hemisphere`).toBeGreaterThan(calm.hemi.intensity * (1 + H.hemi * 0.45));
      expect(peakState.fog.far, `${id} fog far`).toBeGreaterThan(calm.fog.far * (1 + H.fogFar * 0.9));
      expect(peakState.fog.near, `${id} fog near`).toBeGreaterThan(calm.fog.near * (1 + H.fogNear * 0.9));
      expect(peakState.haze.depth, `${id} haze`).toBeLessThan(calm.haze.depth * 0.5);
      expect(peakState.grade.shadowAmt, `${id} the violet split tone is lifted`).toBeLessThan(calm.grade.shadowAmt - 0.05);
      expect(peakState.grade.saturation, `${id} colour comes back`).toBeGreaterThan(calm.grade.saturation * 0.95);
      // ... and it eases out: gone after attack + decay, the land lands on the plain tint of the new, lower corruption exactly
      feed(a, 0.84, Math.ceil((HEAL.attackS + HEAL.decayS) * 60) + 600);
      expect(a.relief, `${id} after`).toBe(0);
      expect(a.corruption).toBe(0.84);
      expect(sameState(a.state, plain(id, 0.84, a.time)), `${id} lands on the plain state`).toBe(true);
      expect(step(a, 0.84, DT, 0), `${id} steady again: free`).toBe(false);
    }
  });

  it('the pulse is a real beat in the pixels: through the real grade a lit pixel moves by several 8-bit levels at the peak (the r2 check: a plain break moved the ground 0.3-1.2 levels, inside the noise)', () => {
    /** the composite pass's grade + saturation on one linear pixel, in 8-bit display levels (sRGB) */
    const shown = (g: ArcState['grade'], px: readonly [number, number, number]): number[] => {
      const c = gradePixel([px[0], px[1], px[2]], gradeUniforms(gradeSpecOf(g)));
      const l = 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
      return c.map((v) => {
        const lin = Math.min(1, Math.max(0, l + (v - l) * g.saturation));
        return 255 * (lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055);
      });
    };
    const maxDiff = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number))));
    const lit = [0.18, 0.15, 0.1] as const;
    const mid = [0.05, 0.05, 0.05] as const;
    for (const id of ZONES) {
      const a = settled(id, 0.9);
      const calm = cloneState(a.state);
      step(a, 0.84);
      feed(a, 0.84, 12);
      expect(a.relief, id).toBeGreaterThan(0.99);
      // a lit pixel and a mid-shade pixel at the peak vs the calm frame
      expect(maxDiff(shown(calm.grade, lit), shown(a.state.grade, lit)), `${id} lit`).toBeGreaterThan(5);
      expect(maxDiff(shown(calm.grade, mid), shown(a.state.grade, mid)), `${id} shade`).toBeGreaterThan(2);
      // the plain 0.06 step alone (no pulse), settled, is below one level on the same pixel
      const steady = settled(id, 0.84);
      expect(maxDiff(shown(calm.grade, lit), shown(steady.state.grade, lit)), `${id} the plain step`).toBeLessThan(1.5);
    }
  });

  it('never on the natural decay (0.004 / s), never on an awakening (+0.08) or any rise, never on a drop under 0.03', () => {
    const a = settled('suryeon', 1);
    // 90 s of decay at 0.004 / s, frame by frame: 1 -> 0.64
    let c = 1;
    for (let i = 0; i < 90 * 60; i++) {
      c -= 0.004 * DT;
      step(a, c);
      expect(a.relief, `decay frame ${i}`).toBe(0);
    }
    // an awakening: +0.08 in one frame, and then a rise of any size
    const b = settled('daeryeol', 0.4);
    for (const up of [0.08, 0.2, 0.5]) {
      step(b, Math.min(1, 0.4 + up));
      expect(b.relief, `rise ${up}`).toBe(0);
      feed(b, 0.4, 600);
    }
    // a small step down (a mere 0.02) is not a break
    const d = settled('yeonmu', 0.9);
    expect(feed(d, 0.88, 120)).toBe(0);
    // ... a step of the threshold is
    const e = settled('yeonmu', 0.9);
    expect(feed(e, 0.9 - HEAL.minDrop - 1e-9, 60)).toBeGreaterThan(0.99);
  });

  it('scales with the land, not with the drop: a healthy land (<= 0.08) does not pulse, a half-sick one pulses part way, a sick one in full; corruption 0 is the identity', () => {
    expect(feed(settled('seori', 0.07), 0, 60)).toBe(0);
    expect(feed(settled('seori', 0.05), 0, 60)).toBe(0);
    const mid = feed(settled('seori', 0.22), 0.16, 60);
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.9);
    expect(feed(settled('seori', 0.9), 0.84, 60)).toBeGreaterThan(0.99);
    // two breaks in one frame (a drop of 0.12) are still one pulse that peaks at 1
    expect(feed(settled('seori', 0.9), 0.78, 60)).toBeGreaterThan(0.99);
    expect(feed(settled('seori', 0.9), 0.78, 60)).toBeLessThanOrEqual(1);
    // corruption 0 is the identity whatever the pulse machinery does
    const z = settled('yeonmu', 0);
    expect(feed(z, 0, 300)).toBe(0);
    expect(sameState(z.state, plain('yeonmu', 0, z.time))).toBe(true);
  });

  it('the drop is summed over a short window, so the ramp a co-op guest sees (the mirror interpolates the corruption between two snapshots) pulses exactly once, at any snapshot spacing', () => {
    // a break as the guest's mirror shows it: -0.06 as a linear ramp over `frames` frames (4 = one 15 Hz snapshot, 12 = a late one), in 8-bit steps
    for (const frames of [1, 2, 4, 6, 12]) {
      const a = settled('yeonmu', 0.9);
      const from = Math.round(0.9 * 255) / 255;
      let starts = 0;
      let prev = 0;
      let peak = 0;
      for (let i = 1; i <= frames; i++) {
        step(a, Math.round((from - (0.06 * i) / frames) * 255) / 255);
        if (a.relief > 0 && prev === 0) starts++;
        prev = a.relief;
        peak = Math.max(peak, a.relief);
      }
      const end = Math.round((from - 0.06) * 255) / 255;
      for (let i = 0; i < 60 * 3; i++) {
        step(a, end);
        if (a.relief > 0 && prev === 0) starts++;
        prev = a.relief;
        peak = Math.max(peak, a.relief);
      }
      expect(peak, `${frames} frames`).toBeGreaterThan(0.99);
      expect(starts, `${frames} frames: one pulse`).toBe(1);
      feed(a, end, 600);
      expect(a.relief).toBe(0);
    }
    // slow falls are not breaks: -0.06 over 1 s (0.06 / s), -0.03 over 0.5 s, the natural decay
    for (const [drop, secs] of [
      [0.06, 1],
      [0.03, 0.5],
      [0.12, 3],
    ] as const) {
      const a = settled('suryeon', 0.9);
      let peak = 0;
      const n = Math.round(secs * 60);
      for (let i = 1; i <= n; i++) {
        step(a, 0.9 - (drop * i) / n);
        peak = Math.max(peak, a.relief);
      }
      expect(peak, `-${drop} over ${secs} s`).toBe(0);
    }
    // a step just under the threshold is not a break, a step at it is
    expect(feed(settled('yeonmu', 0.9), 0.9 - HEAL.minDrop + 0.002, 60)).toBe(0);
  });

  it('edge cases: the first call (a late joiner), a jump of the run clock (a resync), no / bad dt never fire; a paused frame (dt 0) holds the pulse; up=nocorr never fires', () => {
    const look = withArc('yeonmu', undefined);
    const biome = zoneBiome('yeonmu');
    // a late joiner's first frame in a corrupted world is the plain state (no pulse)
    const late = new RunArc(look, biome);
    late.update(500, 0.9, DT);
    expect(late.relief).toBe(0);
    // a resync: the run clock jumps by 2 s (a guest back from a hidden tab: the mirror re-seats its playback clock) while the corruption drops by 0.5
    const hitch = settled('yeonmu', 0.9);
    hitch.update(hitch.time + 2, 0.4, DT);
    expect(hitch.relief).toBe(0);
    feed(hitch, 0.4, 30);
    expect(hitch.relief).toBe(0);
    // ... a clock that goes back (a new run, a re-seated mirror) is no break either
    const back = settled('yeonmu', 0.9);
    back.update(back.time - 200, 0.4, DT);
    expect(back.relief).toBe(0);
    feed(back, 0.4, 30);
    expect(back.relief).toBe(0);
    // no dt (tests, evaluate) / NaN / negative never create a pulse
    const nodt = settled('yeonmu', 0.9);
    nodt.update(800, 0.5);
    nodt.update(800, 0.1, Number.NaN);
    nodt.update(800, 0.9, -1);
    nodt.update(800, 0.5, -1);
    expect(nodt.relief).toBe(0);
    // paused: dt 0 holds the pulse at its level; frames resume it
    const p = settled('yeonmu', 0.9);
    step(p, 0.84);
    feed(p, 0.84, 6);
    const lvl = p.relief;
    expect(lvl).toBeGreaterThan(0.1);
    for (let i = 0; i < 100; i++) step(p, 0.84, 0, 0);
    expect(p.relief).toBe(lvl);
    feed(p, 0.84, 400);
    expect(p.relief).toBe(0);
    // up=nocorr: the fed value never counts (target 0)
    const off = settled('yeonmu', 0.9, { switches: NOCORR });
    expect(feed(off, 0.2, 120)).toBe(0);
    // a metin breaking while the run clock does not move (an offer open) is detected, and WAITS: no pulse until the clock moves
    const q = settled('yeonmu', 0.9);
    step(q, 0.84, DT, 0);
    expect(feed(q, 0.84, 600, 0), 'the pulse waits behind the offer').toBe(0);
    expect(feed(q, 0.84, 12)).toBeGreaterThan(0.99);
  });

  it('a second break during a pulse never lowers it: it jumps to the peak (or the level it has) and decays from there; the next one after the end starts fresh', () => {
    const a = settled('daeryeol', 0.9);
    step(a, 0.84);
    feed(a, 0.84, 24); // 0.4 s in: past the peak, on the way down
    const mid = a.relief;
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    step(a, 0.78);
    expect(a.relief).toBeGreaterThanOrEqual(mid - 1e-9);
    const peak = feed(a, 0.78, 20);
    expect(peak).toBeGreaterThan(0.99);
    expect(peak).toBeLessThanOrEqual(1);
    feed(a, 0.78, 600);
    expect(a.relief).toBe(0);
    step(a, 0.72);
    expect(feed(a, 0.72, 20)).toBeGreaterThan(0.99);
  });

  it('on low (no composite pass) the key light and the hemispheres carry the lift twice as hard, and the same pulse fires', () => {
    const lowArc = settled('yeonmu', 0.9);
    lowArc.composite = false;
    step(lowArc, 0.9);
    const calm = cloneState(lowArc.state);
    step(lowArc, 0.84);
    feed(lowArc, 0.84, 12);
    expect(lowArc.relief).toBeGreaterThan(0.99);
    // (net of the tint's own hemisphere boost / key-light dimming that the pulse lifts with the sickness)
    const hiArc = settled('yeonmu', 0.9);
    const hiCalm = cloneState(hiArc.state);
    step(hiArc, 0.84);
    feed(hiArc, 0.84, 12);
    const lowSun = lowArc.state.sun.intensity / calm.sun.intensity;
    const lowHemi = lowArc.state.hemi.intensity / calm.hemi.intensity;
    expect(lowSun).toBeGreaterThan(1.1);
    expect(lowHemi).toBeGreaterThan(1.1);
    expect(lowSun, 'sun lifts harder than on medium / high').toBeGreaterThan(hiArc.state.sun.intensity / hiCalm.sun.intensity + 0.05);
    expect(lowHemi, 'hemisphere lifts harder than on medium / high').toBeGreaterThan(hiArc.state.hemi.intensity / hiCalm.hemi.intensity + 0.05);
    // applyRelief itself: e = 0 / NaN / negative never touch a state
    const s = plain('seori', 0.7);
    const before = cloneState(s);
    for (const e of [0, -1, Number.NaN]) applyRelief(s, e);
    expect(sameState(s, before)).toBe(true);
    applyRelief(s, 1);
    expect(sameState(s, before)).toBe(false);
  });

  it('THE RUN CLOCK TIMES THE PULSE (the r1 must-fix): a break opens the Metin Essence offer in the same tick and the sim stands still behind it, so the pulse waits at its start there and plays when the clock moves', () => {
    for (const id of ZONES) {
      const a = settled(id, 0.9);
      // the break: -0.06 and, in the same tick, the offer opens: the run clock stands still while the renderer keeps drawing (20 s of frames)
      step(a, 0.84, DT, 0);
      let behind = a.relief;
      for (let i = 0; i < 20 * 60; i++) {
        step(a, 0.84, DT, 0);
        behind = Math.max(behind, a.relief);
      }
      expect(behind, `${id}: nothing of the pulse plays behind the offer`).toBe(0);
      // the tint itself settled into the lower value behind it (the land is the plain 0.84 state, not a lifted one)
      expect(a.corruption, id).toBe(0.84);
      expect(sameState(a.state, plain(id, 0.84, a.time)), `${id}: the plain state waits`).toBe(true);
      // the player picks: the sim runs again and the pulse plays in RUN time - a rise to the peak, a fall to the plain state, once
      let t = 0;
      let peak = 0;
      let peakAt = -1;
      let end = -1;
      for (let i = 0; i < 400 && end < 0; i++) {
        step(a, 0.84);
        t += DT;
        if (a.relief > peak) {
          peak = a.relief;
          peakAt = t;
        }
        if (peak > 0 && a.relief === 0) end = t;
      }
      expect(peak, `${id} peak after the pick`).toBeGreaterThan(0.99);
      expect(peakAt, `${id} the peak comes within the attack`).toBeLessThanOrEqual(HEAL.attackS + 2 * DT);
      expect(end, `${id} the whole beat is attack + decay of run time`).toBeGreaterThan(HEAL.attackS + HEAL.decayS - 2 * DT);
      expect(end).toBeLessThan(HEAL.attackS + HEAL.decayS + 2 * DT);
      expect(sameState(a.state, plain(id, 0.84, a.time)), `${id} lands on the plain state`).toBe(true);
    }
  });

  it('the pulse holds again when a second offer opens mid-pulse (the XP of the break levels the hero up), and resumes where it stopped', () => {
    const a = settled('yeonmu', 0.9);
    step(a, 0.84);
    feed(a, 0.84, 30); // 0.5 s of run time: past the peak, on the way down
    const mid = a.relief;
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    // a level-up offer: 5 s of frames, the clock stands still: the level does not move at all (not by a bit)
    for (let i = 0; i < 300; i++) {
      step(a, 0.84, DT, 0);
      expect(a.relief, `frame ${i}`).toBe(mid);
    }
    feed(a, 0.84, 6);
    expect(a.relief).toBeLessThan(mid);
    expect(a.relief).toBeGreaterThan(0);
    feed(a, 0.84, 100);
    expect(a.relief).toBe(0);
  });

  it('the pulse ages by the run clock, not by the frame count: 144 fps over a 60 Hz sim (frames with no tick) and 20 fps (several ticks a frame) play the same beat of run time', () => {
    const beat = (fps: number): number => {
      const a = settled('seori', 0.9);
      const dt = 1 / fps;
      let acc = 0;
      let clock = a.time;
      // the sim ticks at 60 Hz inside the render frames, the clock is the sim's
      const frame = (): void => {
        acc += dt;
        while (acc >= DT - 1e-12) {
          clock += DT;
          acc -= DT;
        }
        a.update(clock, 0.84, dt);
      };
      frame(); // detects the break
      const t0 = clock;
      let started = false;
      let ended = -1;
      for (let i = 0; i < 20 * fps && ended < 0; i++) {
        frame();
        if (a.relief > 0) started = true;
        if (started && a.relief === 0) ended = clock - t0;
      }
      return ended;
    };
    // (the drop is fed at the first frame of each run: HEAL's detection needs a settled land first, so settle at 0.9 then drop)
    for (const fps of [20, 30, 60, 144]) {
      const ended = beat(fps);
      expect(ended, `${fps} fps`).toBeGreaterThan(HEAL.attackS + HEAL.decayS - 0.1);
      expect(ended, `${fps} fps`).toBeLessThan(HEAL.attackS + HEAL.decayS + 0.1);
    }
  });

  it('a jump of the run clock (a guest resync, a restart) is never a break and never skips the pulse ahead; a normal frame (<= 0.25 s) is none of these', () => {
    // a pulse in flight: the clock jumps by 30 s (a mirror that re-seated its playback clock): the level is where it was
    const a = settled('daeryeol', 0.9);
    step(a, 0.84);
    feed(a, 0.84, 24);
    const lvl = a.relief;
    expect(lvl).toBeGreaterThan(0.3);
    a.update(a.time + 30, 0.84, DT);
    expect(a.relief, 'no skip ahead').toBeCloseTo(lvl, 12);
    // the clock stepping back is a restart: no skip, no aging
    a.update(a.time - 500, 0.84, DT);
    expect(a.relief).toBeCloseTo(lvl, 12);
    // the biggest honest frame (RenderCore clamps dt to 0.25 s; the sim catches up 15 ticks) still ages the pulse
    const b = settled('daeryeol', 0.9);
    step(b, 0.84);
    feed(b, 0.84, 24);
    const before = b.relief;
    b.update(b.time + 0.25, 0.84, 0.25);
    expect(b.relief).toBeLessThan(before);
    // a break in the very frame the clock jumps is not a break; the frame after (a normal one) with a fresh break is
    const c = settled('yeonmu', 0.9);
    c.update(c.time + 1, 0.84, DT);
    expect(c.relief).toBe(0);
    feed(c, 0.84, 120);
    expect(c.relief).toBe(0);
    step(c, 0.78);
    expect(feed(c, 0.78, 12)).toBeGreaterThan(0.99);
    expect(HEAL.maxJump).toBeGreaterThan(0.25);
  });

  it('a deep gold zone (Suryeon) is relieved less: it lifts less of its sickness and takes back most of the saturation lift - an amber land does not need more orange (the r1 critic: near-pure orange at +0.3 s)', () => {
    expect(reliefLift(1, 0)).toBe(HEAL.relief);
    expect(reliefLift(1, 1)).toBeCloseTo(HEAL.relief * (1 - HEAL.warmRelief), 12);
    expect(reliefLift(0.5, 1)).toBeCloseTo(0.5 * HEAL.relief * (1 - HEAL.warmRelief), 12);
    expect(reliefLift(0, 1)).toBe(0);
    // applyRelief: the saturation lift is the plain one for a pale sun, a quarter of it at warmth 1, and e = 0 / bad warmth never break it
    const s0 = plain('seori', 0.7);
    const sat0 = s0.grade.saturation;
    const lift = (w: number): number => {
      const s = cloneState(s0);
      applyRelief(s, 1, true, w);
      return s.grade.saturation / sat0 - 1;
    };
    expect(lift(0)).toBeCloseTo(HEAL.saturation, 12);
    expect(lift(1)).toBeCloseTo(HEAL.saturation * (1 - HEAL.warmSat), 12);
    expect(lift(5)).toBeCloseTo(lift(1), 12);
    expect(lift(-3)).toBeCloseTo(lift(0), 12);
    // the real zones: the whole frame's saturation lift at the peak is smaller in Suryeon than in Yeonmu
    const peakGain = (id: string): number => {
      const a = settled(id, 0.9);
      const calm = cloneState(a.state);
      step(a, 0.84);
      feed(a, 0.84, 12);
      expect(a.relief, id).toBeGreaterThan(0.99);
      return a.state.grade.saturation / calm.grade.saturation;
    };
    expect(peakGain('suryeon')).toBeLessThan(peakGain('yeonmu'));
    expect(peakGain('suryeon')).toBeLessThan(1.05);
    // and the pulse is still a real beat there (the pixel test above covers every zone)
    const sg = settled('suryeon', 0.9);
    const calm = cloneState(sg.state);
    step(sg, 0.84);
    feed(sg, 0.84, 12);
    expect(sg.state.sun.intensity).toBeGreaterThan(calm.sun.intensity * 1.02);
    expect(sg.state.grade.shadowAmt).toBeLessThan(calm.grade.shadowAmt - 0.03);
  });

  it('it is uniforms only and pure: the same feed gives the same pulse on any machine (no clock, no random), and the arc source has none of either', async () => {
    const run = (): number[] => {
      const a = settled('seori', 0.9);
      const out: number[] = [];
      step(a, 0.84);
      for (let i = 0; i < 120; i++) {
        step(a, 0.84);
        out.push(a.relief);
      }
      return out;
    };
    expect(run()).toEqual(run());
    const { readFileSync } = await import('node:fs');
    const arcSrc = readFileSync(new URL('./arc.ts', import.meta.url), 'utf8');
    expect(arcSrc).not.toMatch(/Math\.random|Date\.now|performance\.now/);
  });
});

describe('the corruption mood tables (PL-04)', () => {
  const M = CORRUPTION_MOOD;
  const warmOf = (id: string): number => corruptionTintOf(lookFor(id), arcBase(withArc(id, undefined), zoneBiome(id)).sun.color).warmth;
  const L = CORRUPTION_MOOD_LOW;
  const full = (id: string, composite: boolean, c = 1): ArcState => {
    const a = new RunArc(withArc(id, undefined), zoneBiome(id));
    a.composite = composite;
    a.update(0, c);
    return a.state;
  };
  const lumC = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  it('the tables are frozen: a dev eval or a test cannot leave them changed for the rest of a session', () => {
    expect(Object.isFrozen(M)).toBe(true);
    expect(Object.isFrozen(L)).toBe(true);
    expect(Object.isFrozen(HEAL)).toBe(true);
    expect(() => {
      (M as { satBoost: number }).satBoost = 9;
    }).toThrow();
    expect(M.satBoost).toBe(0.2);
  });

  it('low has the same hues and a stronger share of every channel it draws: the hemisphere colours, the key light, the baked shadows, the air', () => {
    expect(L.hemiSkyMix).toBeGreaterThan(M.hemiSkyMix);
    expect(L.hemiGroundMix).toBeGreaterThan(M.hemiGroundMix);
    // (the hemisphere's brightness boost is the one channel low takes LESS of: the lit land must get darker, not lighter, with no grade to carry the shade)
    expect(L.hemiBoost).toBeLessThan(M.hemiBoost);
    expect(L.sunMix).toBeGreaterThan(M.sunMix);
    expect(L.sunDim).toBeGreaterThan(M.sunDim);
    expect(L.fogDeepen).toBeGreaterThan(M.fogDeepen);
    expect(L.hazeDepth).toBeGreaterThan(M.hazeDepth);
    expect(L.shadowLift).toBeGreaterThan(M.shadowLift);
    expect(L.shadowLiftMax).toBeGreaterThan(0);
    for (const id of ZONES) {
      const base = arcBase(withArc(id, undefined), zoneBiome(id));
      const hi = full(id, true);
      const lo = full(id, false);
      // the baked shadows are LIFTED on low (the violet reaches the ground), thinned where the grade carries them
      expect(lo.fill.shadowFill, `${id} lift`).toBeGreaterThan(base.fill.shadowFill);
      expect(lo.fill.shadowFill, `${id} lift is capped`).toBeLessThanOrEqual(base.fill.shadowFill + L.shadowLiftMax + 1e-9);
      // (a warm-key zone lifts its baked fill on every tier, `warmFillLift`: the violet fill is what bruises the shade of a gold-lit land)
      if (warmOf(id) === 0) expect(hi.fill.shadowFill, `${id} thin`).toBeLessThan(base.fill.shadowFill);
      else expect(hi.fill.shadowFill, `${id} warm lift`).toBeGreaterThan(base.fill.shadowFill);
      expect(lo.hemi.intensity, `${id} hemisphere`).toBeLessThan(hi.hemi.intensity);
      expect(lo.sun.intensity, `${id} key light dims`).toBeLessThan(base.sun.intensity);
      expect(hi.sun.intensity, `${id} key light kept on medium / high`).toBe(base.sun.intensity);
      expect(lo.fog.far, `${id} fog`).toBeLessThan(hi.fog.far);
      expect(lo.haze.depth, `${id} haze`).toBeGreaterThan(hi.haze.depth);
      expect(lumC(lo.fog.color), `${id} fog darker`).toBeLessThan(lumC(hi.fog.color));
      // c = 0 is the identity on low too
      expect(sameState(full(id, false, 0), base), `${id} c=0`).toBe(true);
    }
  });

  it('LOW keeps the lit colour of a zone under a strong coloured key light (Yeonmu, Suryeon) and gives the ambient-lit zones the full low mood (the r1 low pairs: a mauve-grey film on the green and gold zones)', () => {
    const tintOf = (id: string): ReturnType<typeof corruptionTintOf> => {
      const base = arcBase(withArc(id, undefined), zoneBiome(id));
      return corruptionTintOf(lookFor(id), base.sun.color, base.sun.intensity);
    };
    expect(tintOf('yeonmu').lit).toBeGreaterThan(0.99);
    expect(tintOf('suryeon').lit).toBeGreaterThan(0.99);
    expect(tintOf('seori').lit).toBe(0);
    expect(tintOf('daeryeol').lit).toBe(0);
    // no lit colour to protect: the plain low table, the very object
    expect(tintOf('seori').low).toBe(L);
    expect(tintOf('daeryeol').low).toBe(L);
    const LL = CORRUPTION_MOOD_LOW_LIT;
    for (const id of ['yeonmu', 'suryeon']) for (const k of Object.keys(LL) as (keyof typeof LL)[]) expect(tintOf(id).low[k], `${id} ${k}`).toBeCloseTo(LL[k], 10);
    expect(Object.isFrozen(LL)).toBe(true);
    expect(Object.isFrozen(tintOf('yeonmu').low)).toBe(true);
    // the softer table: the key light is turned / dimmed far less, the hemisphere is DIMMED (the shade deepens; the plain low brightens it a touch), the baked shadows lift less
    expect(LL.sunMix).toBeLessThan(L.sunMix);
    expect(LL.sunDim).toBeLessThan(L.sunDim / 4);
    expect(LL.hemiBoost).toBeLessThan(0);
    expect(LL.hemiSkyMix).toBeLessThan(L.hemiSkyMix);
    expect(LL.hemiGroundMix).toBeLessThan(L.hemiGroundMix);
    expect(LL.shadowLift).toBeLessThan(L.shadowLift);
    expect(LL.shadowLiftMax).toBeLessThan(L.shadowLiftMax);
    // ... and it is still more than nothing: the air closes in harder than on medium / high, the shade takes the violet
    expect(LL.fogFar).toBeGreaterThan(M.fogFar);
    expect(LL.hemiSkyMix).toBeGreaterThan(M.hemiSkyMix);
    // on the real zones: Suryeon's and Yeonmu's sun keeps (almost) all of its light on low, Seori's dims by the plain low share
    for (const id of ZONES) {
      const base = arcBase(withArc(id, undefined), zoneBiome(id));
      const lo = full(id, false);
      const dim = 1 - lo.sun.intensity / base.sun.intensity;
      expect(dim, `${id} sun dim`).toBeCloseTo(tintOf(id).low.sunDim, 10);
      // the shade deepens on every zone (a lit zone more than it brightens)
      expect(lo.hemi.intensity / base.hemi.intensity, id).toBeCloseTo(1 + tintOf(id).low.hemiBoost, 10);
    }
    expect(1 - full('yeonmu', false).sun.intensity / arcBase(withArc('yeonmu', undefined), zoneBiome('yeonmu')).sun.intensity).toBeLessThan(0.03);
    // the key light of Yeonmu (a pale-ish sun that the plain low table turned toward the violet) stays closer to its own colour
    const yoBase = arcBase(withArc('yeonmu', undefined), zoneBiome('yeonmu'));
    const soft = cloneState(yoBase);
    const plainLow = cloneState(yoBase);
    const yt = tintOf('yeonmu');
    applyCorruption(soft, 1, yt, false);
    applyCorruption(plainLow, 1, { ...yt, low: L }, false);
    const off = (c: Color): number => Math.hypot(c.r - yoBase.sun.color.r, c.g - yoBase.sun.color.g, c.b - yoBase.sun.color.b);
    expect(off(soft.sun.color)).toBeLessThan(off(plainLow.sun.color) * 0.5);
    expect(off(soft.sun.color)).toBeGreaterThan(0);
    expect(soft.sun.intensity).toBeGreaterThan(plainLow.sun.intensity);
    // medium / high do not read the table at all
    const hiSoft = cloneState(yoBase);
    const hiPlain = cloneState(yoBase);
    applyCorruption(hiSoft, 1, yt, true);
    applyCorruption(hiPlain, 1, { ...yt, low: L }, true);
    expect(sameState(hiSoft, hiPlain)).toBe(true);
  });

  it('litOf: 0 for a pale or dim key light, 1 under a strong chromatic one, a smoothstep between (and a table in between); a bad intensity is 0', () => {
    const gold = new Color(1, 0.839, 0.578); // chroma 1 - 0.578
    expect(litOf(new Color(1, 1, 1), 5)).toBe(0);
    expect(litOf(gold, 0)).toBe(0);
    expect(litOf(gold, Number.NaN)).toBe(0);
    expect(litOf(gold, 1.3 / (1 - 0.578) - 0.05)).toBe(0);
    expect(litOf(gold, 1.9 / (1 - 0.578) + 0.05)).toBe(1);
    let prev = 0;
    for (let i = 0; i <= 20; i++) {
      const v = litOf(gold, 2 + i * 0.25);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(LIT.from).toBeLessThan(LIT.to);
    const mid = corruptionTintOf(lookFor('yeonmu'), gold, ((LIT.from + LIT.to) / 2) / (1 - 0.578));
    expect(mid.lit).toBeCloseTo(0.5, 5);
    expect(mid.low.sunDim).toBeGreaterThan(CORRUPTION_MOOD_LOW_LIT.sunDim);
    expect(mid.low.sunDim).toBeLessThan(L.sunDim);
    expect(mid.low.sunDim).toBeCloseTo((CORRUPTION_MOOD_LOW_LIT.sunDim + L.sunDim) / 2, 5);
    // no key light given: the plain low table
    expect(corruptionTintOf(lookFor('yeonmu')).low).toBe(L);
  });

  it('a change of the pass (the quality tier moves at run time) re-evaluates the state by itself', () => {
    const a = new RunArc(withArc('yeonmu', undefined), zoneBiome('yeonmu'));
    a.update(0, 1);
    const hi = cloneState(a.state);
    expect(a.update(0, 1)).toBe(false);
    a.composite = false;
    expect(a.update(0, 1)).toBe(true);
    expect(sameState(a.state, hi)).toBe(false);
    expect(a.update(0, 1)).toBe(false);
    a.composite = true;
    expect(a.update(0, 1)).toBe(true);
    expect(sameState(a.state, hi)).toBe(true);
  });

  it('a deep gold key light (Suryeon) takes less of the saturation boost and more of the violet split tone; the other zones keep the plain mood', () => {
    const warm = (id: string): number => corruptionTintOf(lookFor(id), arcBase(withArc(id, undefined), zoneBiome(id)).sun.color).warmth;
    expect(warm('suryeon')).toBeGreaterThan(0.99);
    for (const id of ['yeonmu', 'seori', 'daeryeol']) expect(warm(id), id).toBe(0);
    const sg = full('suryeon', true);
    const sgBase = arcBase(withArc('suryeon', undefined), zoneBiome('suryeon'));
    // the lit colour still rises a little but far less than the plain boost; the shadows take more of the violet
    expect(sg.grade.saturation / sgBase.grade.saturation).toBeCloseTo(1 - DEFAULT_CORRUPTION.desaturate * M.gradeSatShare + M.satBoost * (1 - M.warmSatCut), 10);
    expect(sg.grade.saturation / sgBase.grade.saturation).toBeLessThan(1 - DEFAULT_CORRUPTION.desaturate * M.gradeSatShare + M.satBoost * 0.8);
    expect(sg.grade.saturation / sgBase.grade.saturation).toBeGreaterThan(1 - 0.15 * M.gradeSatShare);
    expect(sg.grade.shadowAmt - sgBase.grade.shadowAmt).toBeCloseTo(M.gradeShadowAmt * (1 + M.warmShadowAmt), 10);
    const yo = full('yeonmu', true);
    const yoBase = arcBase(withArc('yeonmu', undefined), zoneBiome('yeonmu'));
    expect(yo.grade.shadowAmt - yoBase.grade.shadowAmt).toBeCloseTo(M.gradeShadowAmt, 10);
  });

  it('warmthOf is a smoothstep of the linear chroma between 0.55 and 0.72: 0 for a pale or amber sun, 1 for a deep gold', () => {
    expect(warmthOf(new Color(1, 1, 1))).toBe(0);
    expect(warmthOf(new Color(1, 0.8, 0.7))).toBe(0); // chroma 0.3
    expect(warmthOf(new Color(1, 0.3, 0.1))).toBe(1); // chroma 0.9
    const mid = warmthOf(new Color(1, 0.5, 0.36)); // chroma 0.64
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    expect(warmthOf(new Color(0, 0, 0))).toBe(0);
  });
});

describe('co-op: a guest evaluates the host\'s phase', () => {
  let h: CoopHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });
  const look = withArc('yeonmu', [{ t: 0 }, { t: RUN_LENGTH, sun: { intensity: 4.8 }, poolGain: 3, medallionGlow: 0.35 }]);

  const run = (n: number): void => {
    for (let i = 0; i < n; i++) (h as CoopHarness).tick();
  };

  it('the mirrored clock the HUD timer shows drives the same arc: within a network delay of the host, exact at the same clock', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    run(60 * 20);
    expect(hw.time).toBeGreaterThan(19);
    const lag = hw.time - gw.time;
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThan(0.5);
    const host = evaluate(look, hw.time, hw.corruption, BIOME);
    const guest = evaluate(look, gw.time, gw.corruption, BIOME);
    // 0.5 s of lag on a 900 s transition is at most a 0.0004 smoothstep step of the sun
    expect(Math.abs(host.sun.intensity - guest.sun.intensity)).toBeLessThan(0.002);
    expect(Math.abs(host.poolGain - guest.poolGain)).toBeLessThan(0.002);
    // the same clock gives the same state, whoever reads it
    expect(sameState(evaluate(look, hw.time, 0, BIOME), evaluate(look, hw.time, 0, BIOME))).toBe(true);
    const live = new RunArc(look, BIOME);
    live.update(gw.time, gw.corruption);
    expect(sameState(live.state, guest)).toBe(true);
  });

  it('a guest that dropped and came back (late join / resync) lands on the host\'s phase again', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    run(60 * 10);
    await h.reconnect(1);
    run(60 * 10);
    expect(hw.time).toBeGreaterThan(19);
    expect(Math.abs(hw.time - gw.time)).toBeLessThan(1.5);
    const host = evaluate(look, hw.time, 0, BIOME);
    const guest = evaluate(look, gw.time, 0, BIOME);
    expect(Math.abs(host.sun.intensity - guest.sun.intensity)).toBeLessThan(0.01);
  });

  it('the default dusk (PL-03b): a guest that joins late or resyncs at the lantern hour lands on the phase of the host, and the hold past 880 s is the same state on every screen', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    const dusk = withArc('yeonmu', undefined);
    run(60);
    // the host is deep into a long run (the clock the HUD timer shows); the guest drops, comes back and takes the host's clock in the resync
    hw.time = 868;
    hw.tick = 868 * 60;
    await h.reconnect(1);
    run(60 * 4);
    expect(hw.time).toBeGreaterThan(871);
    expect(Math.abs(hw.time - gw.time)).toBeLessThan(1.5);
    let host = evaluate(dusk, hw.time, hw.corruption, BIOME);
    let guest = evaluate(dusk, gw.time, gw.corruption, BIOME);
    expect(host.poolGain).toBeGreaterThan(2.5);
    // 1.5 s of lag on the 100 s transition (780 -> 880 s) is a rounding error of the look
    expect(Math.abs(host.poolGain - guest.poolGain)).toBeLessThan(0.1);
    expect(Math.abs(host.sun.intensity - guest.sun.intensity)).toBeLessThan(0.1);
    // past 880 s host and guest are in the same held state: the dusk needs no clock accuracy at all
    hw.time = 890;
    hw.tick = 890 * 60;
    await h.reconnect(1);
    run(60 * 4);
    expect(gw.time).toBeGreaterThan(880);
    host = evaluate(dusk, hw.time, 0, BIOME);
    guest = evaluate(dusk, gw.time, 0, BIOME);
    expect(sameState(host, guest)).toBe(true);
  });

  it('world corruption reaches the mirror, so the corruption input of PL-04 is the same number on every screen', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    run(120);
    h.hostWorld.corruption = 0.62;
    run(120);
    // snapshots carry corruption in 8 bits
    expect(gw.corruption).toBeCloseTo(h.hostWorld.corruption, 2);
    expect(gw.corruption).toBeGreaterThan(0);
  });

  it('PL-04: the land of the guest is tinted like the host\'s: the HUD gauge value, the mirrored world and the host agree, so the evaluated state does', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    const dusk = withArc('yeonmu', undefined);
    run(120);
    hw.corruption = 0.62;
    run(180);
    // the number the guest's HUD gauge shows is the mirrored world's, and it is the host's (8-bit snapshot)
    expect(gw.hud(0).corruption).toBe(gw.corruption);
    expect(gw.corruption).toBeCloseTo(hw.corruption, 2);
    expect(hw.hud(0).corruption).toBe(hw.corruption);
    const host = evaluate(dusk, hw.time, hw.corruption, BIOME);
    const guest = evaluate(dusk, gw.time, gw.corruption, BIOME);
    expect(guest.grade.saturation).toBeCloseTo(host.grade.saturation, 3);
    expect(guest.grade.shadowAmt).toBeCloseTo(host.grade.shadowAmt, 3);
    expect(guest.fog.near).toBeCloseTo(host.fog.near, 1);
    expect(guest.fill.shadowFill).toBeCloseTo(host.fill.shadowFill, 3);
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(guest.haze.color[ch]).toBeCloseTo(host.haze.color[ch], 3);
      expect(guest.fill.shadowTint[ch]).toBeCloseTo(host.fill.shadowTint[ch], 3);
    }
    // and the tint is really on, not a zero on both screens
    expect(guest.grade.shadowAmt).toBeGreaterThan(evaluate(dusk, gw.time, 0, BIOME).grade.shadowAmt);
  });

  it('PL-04: a guest that joins late (or resyncs) in a corrupted world sees the same tint at once: its evaluator takes the mirrored value as is, no fade-in from clean', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    run(60);
    hw.corruption = 0.9;
    run(60);
    await h.reconnect(1);
    run(60 * 3);
    expect(gw.corruption).toBeCloseTo(hw.corruption, 2);
    expect(gw.corruption).toBeGreaterThan(0.5);
    const look = withArc('yeonmu', undefined);
    const guestArc = new RunArc(look, BIOME);
    guestArc.update(gw.time, gw.corruption, 1 / 60); // the first frame the late joiner renders
    expect(guestArc.corruption).toBeCloseTo(gw.corruption, 10);
    const hostArc = new RunArc(look, BIOME);
    hostArc.update(hw.time, hw.corruption);
    expect(guestArc.state.grade.saturation).toBeCloseTo(hostArc.state.grade.saturation, 3);
    expect(guestArc.state.grade.shadowAmt).toBeCloseTo(hostArc.state.grade.shadowAmt, 3);
  });
  it('PL-04: a metin break pulses on the guest too: the drop of the mirrored world.corruption (the HUD gauge value) starts the same relief beat as on the host', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    const dusk = withArc('yeonmu', undefined);
    const hostArc = new RunArc(dusk, BIOME);
    const guestArc = new RunArc(dusk, BIOME);
    const dt = 1 / 60;
    let hostPeak = 0;
    let guestPeak = 0;
    let hostFirst = -1;
    let guestFirst = -1;
    const step = (i: number): void => {
      h?.tick();
      hostArc.update(hw.time, hw.corruption, dt);
      guestArc.update(gw.time, gw.corruption, dt);
      hostPeak = Math.max(hostPeak, hostArc.relief);
      guestPeak = Math.max(guestPeak, guestArc.relief);
      if (hostFirst < 0 && hostArc.relief > 0) hostFirst = i;
      if (guestFirst < 0 && guestArc.relief > 0) guestFirst = i;
    };
    for (let i = 0; i < 60; i++) step(i);
    hw.corruption = 0.9;
    for (let i = 60; i < 60 + 60 * 4; i++) step(i);
    // the mirrored number is the host's within the 8-bit snapshot step, and a settled land has no pulse yet
    expect(gw.corruption).toBeCloseTo(hw.corruption, 2);
    expect(hostPeak).toBe(0);
    expect(guestPeak).toBe(0);
    // a rise (an awakening) does not pulse anywhere
    hw.corruption = 0.98;
    for (let i = 300; i < 360; i++) step(i);
    expect(hostPeak).toBe(0);
    expect(guestPeak).toBe(0);
    // the break: the host's corruption drops by 0.06 in one tick; the guest sees it through the next snapshot
    hw.corruption -= 0.06;
    for (let i = 360; i < 360 + 60 * 3; i++) step(i);
    expect(hostPeak).toBeGreaterThan(0.99);
    expect(guestPeak).toBeGreaterThan(0.95);
    // the guest's beat starts within a network delay of the host's (30 ms + the snapshot step: a few frames)
    expect(guestFirst).toBeGreaterThanOrEqual(hostFirst);
    expect(guestFirst - hostFirst).toBeLessThanOrEqual(12);
    // and both land on the same, plain, lower tint afterwards
    for (let i = 0; i < 60 * 4; i++) step(i + 1000);
    expect(hostArc.relief).toBe(0);
    expect(guestArc.relief).toBe(0);
    expect(guestArc.state.grade.shadowAmt).toBeCloseTo(hostArc.state.grade.shadowAmt, 3);
    expect(guestArc.state.fog.far).toBeCloseTo(hostArc.state.fog.far, 1);
  });

  it('PL-04 (the r1 must-fix): a break that opens the Metin Essence offer for every hero holds the pulse on the host AND the guest (the mirrored clock stands still too) until the offers are answered, then both play it', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0];
    if (!gw) throw new Error('no guest');
    const dusk = withArc('yeonmu', undefined);
    const hostArc = new RunArc(dusk, BIOME);
    const guestArc = new RunArc(dusk, BIOME);
    const dt = 1 / 60;
    let hostPeak = 0;
    let guestPeak = 0;
    const step = (): void => {
      h?.tick();
      hostArc.update(hw.time, hw.corruption, dt);
      guestArc.update(gw.time, gw.corruption, dt);
      hostPeak = Math.max(hostPeak, hostArc.relief);
      guestPeak = Math.max(guestPeak, guestArc.relief);
    };
    for (let i = 0; i < 60; i++) step();
    hw.corruption = 0.9;
    for (let i = 0; i < 60 * 4; i++) step();
    expect(hostPeak).toBe(0);
    expect(guestPeak).toBe(0);
    // the break, exactly as sim/metins.ts onMetinRowDied does it: corruption - 0.06 and an essence offer for every living hero, in the same tick
    hw.corruption -= 0.06;
    for (const p of hw.players) openEssence(hw, p, 'metin_lament', false);
    expect(hw.modals.length).toBeGreaterThan(0);
    const timeAtBreak = hw.time;
    // the offers stay open for 8 s (a player reading the cards): the host sim, hence the host clock and the guest's mirrored clock, stand still
    for (let i = 0; i < 60 * 8; i++) step();
    expect(hw.modals.length, 'the offers are still open').toBeGreaterThan(0);
    expect(hw.time, 'the host clock stands still').toBe(timeAtBreak);
    expect(Math.abs(gw.time - hw.time), 'the mirrored clock stalls at the host clock').toBeLessThan(0.5);
    expect(gw.corruption).toBeCloseTo(hw.corruption, 2);
    expect(hostArc.corruption, 'the host land eased into the new tint behind the offer').toBeCloseTo(hw.corruption, 3);
    expect(hostPeak, 'nothing of the pulse behind the offer (host)').toBe(0);
    expect(guestPeak, 'nothing of the pulse behind the offer (guest)').toBe(0);
    // the offers are answered: the sim runs again, and both screens play the beat
    for (let k = 0; k < hw.players.length; k++) for (let n = 0; n < 8 && hw.modals.some((m) => m.player === k); n++) hw.chooseCard(0, k);
    expect(hw.modals.length).toBe(0);
    for (let i = 0; i < 60 * 4; i++) step();
    expect(hw.time).toBeGreaterThan(timeAtBreak + 3);
    expect(hostPeak).toBeGreaterThan(0.99);
    expect(guestPeak).toBeGreaterThan(0.95);
    expect(hostArc.relief).toBe(0);
    expect(guestArc.relief).toBe(0);
  });
});
