// Zones core C0 contract: render-only biome override, emissive layer selection, readability fallback, sky registry.
import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../../data/schema';
import type { GroundLayer } from '../../../world/layoutTypes';
import { zoneReadabilityStyle } from '../../zoneReadability';
import { SKY_STYLES, styleFor } from '../sky/styles';
import { emissiveLayerIndex } from '../terrainMaterial';
import {
  applyBiomeLook,
  DEFAULT_CORRUPTION,
  findLook,
  loopsOf,
  lookFor,
  NEUTRAL_GRADE,
  resolveBiome,
  resolveCorruption,
  resolveGrade,
} from './index';
import type { ArcKey, GradeSpec, LiquidLook, MedallionSpec, PoolSpec, ReadabilityLook, RockMatStyle, SealSpec, ZoneLook } from './index';

function biome(id: string): BiomePreset {
  return {
    id,
    seed: 7,
    ground: ['tex_grass_a'],
    trees: [],
    props: [],
    fog: { color: '#aabbcc', near: 40, far: 160 },
    sky: { top: '#223344', horizon: '#aabbcc', bottom: '#556677' },
    sun: { color: '#fff1d6', intensity: 2.4, dir: [0.4, 0.8, 0.3] },
    ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.8 },
    water: { level: 0, color: '#3f86a8', kind: 'water' },
    relief: { height: 20, roughness: 0.5, features: [] },
    particles: 'ambient.leaves',
  };
}

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

describe('look contract (C0)', () => {
  it('resolveBiome is the identity for a zone without a biome override', () => {
    for (const id of [...ZONES, 'unknown_zone']) {
      const b = biome(id);
      if (findLook(id)?.biome) continue; // a builder added an override: covered by the merge test below
      expect(resolveBiome(id, b)).toBe(b);
    }
  });

  it('applyBiomeLook merges field by field and never touches layout / sim data', () => {
    const b = biome('yeonmu');
    const r = applyBiomeLook(b, { fog: { color: '#b0bdd6', far: undefined }, sun: { intensity: 2 }, particles: '', water: { color: '#3b67ba' } });
    expect(r).not.toBe(b);
    expect(r.fog).toEqual({ color: '#b0bdd6', near: 40, far: 160 });
    expect(r.sun).toEqual({ color: '#fff1d6', intensity: 2, dir: [0.4, 0.8, 0.3] });
    expect(r.sky).toEqual(b.sky);
    expect(r.ambient).toEqual(b.ambient);
    expect(r.particles).toBe('');
    expect(r.water).toEqual({ level: 0, color: '#3b67ba', kind: 'water' });
    expect(r.seed).toBe(b.seed);
    expect(r.relief).toBe(b.relief);
    expect(r.ground).toBe(b.ground);
    // the input preset is not mutated
    expect(b.fog.color).toBe('#aabbcc');
    expect(b.particles).toBe('ambient.leaves');
    // no water in the preset: a tint override does not invent one
    const dry = { ...b, water: undefined };
    expect(applyBiomeLook(dry, { water: { color: '#000000' } }).water).toBeUndefined();
  });

  it('emissive ground layer: explicit flag first, legacy tex_lava_crust id second, opt-out with false', () => {
    const L = (tex: string, emissive?: boolean): GroundLayer => ({ tex, scale: 5, ...(emissive === undefined ? {} : { emissive }) });
    expect(emissiveLayerIndex([L('tex_ash'), L('tex_lava_crust')])).toBe(1);
    expect(emissiveLayerIndex([L('tex_ash'), L('tex_lava_crust'), L('tex_daeryeol_magma', true)])).toBe(2);
    expect(emissiveLayerIndex([L('tex_ash'), L('tex_lava_crust', false)])).toBe(-1);
    expect(emissiveLayerIndex([L('tex_grass_a'), L('tex_meadow')])).toBe(-1);
  });

  it('readability: look.readability wins, defaults otherwise, neutral for unknown zones', () => {
    for (const id of ZONES) {
      const own = findLook(id)?.readability;
      const s = zoneReadabilityStyle(id);
      if (own) expect(s).toBe(own);
      else expect(s.rimStrength).toBeGreaterThan(0);
    }
    expect(zoneReadabilityStyle('unknown_zone')).toEqual({ rim: '#ffffff', rimStrength: 0, desaturate: 0, darken: 0 });
  });

  it('sky styles: one registered per zone, unknown zones fall back to Yeonmu', () => {
    for (const id of ZONES) expect(SKY_STYLES[id]).toBeDefined();
    expect(styleFor('unknown_zone')).toBe(SKY_STYLES.yeonmu);
    expect(lookFor('unknown_zone')).toBe(lookFor('yeonmu'));
  });
});

// ---- A0-LOOK (upgrade stage 2): every new ZoneLook field is optional and neutral when absent ------------------------------------

/** the smallest legal look: only the fields ZoneLook already required before A0-LOOK (compile-time proof that every new field is optional) */
const BARE: ZoneLook = {
  style: {
    macroDark: '#808080',
    macroLight: '#a0a0a0',
    macroStrength: 0.2,
    macroScale: 40,
    saturation: 1,
    gain: 1,
    normal: 1,
    cliffTint: '#ffffff',
    shoreWet: 0,
    lavaGlow: 0,
    sparkle: 0,
  },
  fill: { sky: '#ffffff', ground: '#808080', intensity: 0, shadowTint: '#000000', shadowFill: 0 },
  shadow: { intensity: 1, baked: 1, ao: 1 },
  pools: {},
  decals: [],
};

/** every new field at once, typed: a rename or a shape change of the contract stops this file compiling */
const FULL: ZoneLook = {
  ...BARE,
  post: {
    bloom: { threshold: 0.9, strength: 0.4, knee: 0.5 },
    vignette: 0.3,
    grade: {
      lift: 0.02,
      gamma: 1.05,
      gain: [1.04, 1, 0.96],
      shadowTint: '#3a4a7a',
      shadowAmt: 0.2,
      highlightTint: '#ffd9a0',
      highlightAmt: 0.15,
      balance: 0.1,
      contrast: 1.1,
      pivot: 0.2,
      saturation: 1.08,
    },
  },
  arc: [
    { t: 0 },
    {
      t: 600,
      sun: { color: '#ffc890', intensity: 2.9 },
      hemi: { sky: '#ccd6ff', ground: '#6a5a40', intensity: 0.8 },
      fill: { shadowTint: '#4a6890', shadowFill: 0.3 },
      haze: { color: '#e8b878', depth: 0.3, mist: 0.2 },
      fog: { color: '#b0bdd6', near: 60, far: 200 },
      grade: { saturation: 1.05 },
      poolGain: 2,
      medallionGlow: 0.35,
    },
  ],
  corruption: { haze: '#6a5a7e', shadowTint: '#5b4a7a', desaturate: 0.2, darken: 0.12 },
  ambientLoops: ['ambient.embers', 'ambient.fireflies'],
  liquidLook: {
    ice: { glitter: 0.25, sheen: 0.35, sheenColor: '#cfe6ff' },
    lava: { hotHdr: 1.6, skin: 0.22, skinScale: 6 },
  },
  rocks: {
    kind: {
      crystal: { translucency: 0.5, rimGlow: 0.45, rimColor: '#9fd6ff', emissive: 0.25, emissiveColor: '#7fc4ff' },
    },
  },
  pools: { stone_lantern: { color: '#ffb060', intensity: 1, radius: 6, flare: 0.5, flareHeight: 1.4 } },
};

describe('A0-LOOK contract: neutral values for absent fields', () => {
  it('NEUTRAL_GRADE is the identity grade (lift 0, gamma 1, gain 1, amounts 0, balance 0, contrast 1, pivot 0.18, saturation 1)', () => {
    expect(NEUTRAL_GRADE).toEqual({
      lift: 0,
      gamma: 1,
      gain: [1, 1, 1],
      shadowTint: '#ffffff',
      shadowAmt: 0,
      highlightTint: '#ffffff',
      highlightAmt: 0,
      balance: 0,
      contrast: 1,
      pivot: 0.18,
      saturation: 1,
    });
    expect(Object.isFrozen(NEUTRAL_GRADE)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_GRADE.gain)).toBe(true);
  });

  it('resolveGrade: nothing / null / {} give the neutral grade; every field of a partial grade falls back on its own', () => {
    for (const g of [undefined, null, {}] as const) expect(resolveGrade(g)).toEqual(NEUTRAL_GRADE);
    const part: GradeSpec = { gamma: 1.1, gain: [1.1, 1, 0.9], shadowTint: '#102030', shadowAmt: 0.25 };
    expect(resolveGrade(part)).toEqual({ ...NEUTRAL_GRADE, gamma: 1.1, gain: [1.1, 1, 0.9], shadowTint: '#102030', shadowAmt: 0.25 });
    // an explicit 0 is a value, not an absence
    expect(resolveGrade({ saturation: 0, contrast: 0, pivot: 0, gamma: 0.0001 })).toMatchObject({ saturation: 0, contrast: 0, pivot: 0, gamma: 0.0001 });
    // a non-finite number is treated as absent (it would poison a shader uniform)
    expect(resolveGrade({ lift: Number.NaN, contrast: Infinity })).toMatchObject({ lift: 0, contrast: 1 });
    // a gain with a non-finite channel falls back to the identity gain
    expect(resolveGrade({ gain: [1, Number.NaN, 1] }).gain).toEqual([1, 1, 1]);
  });

  it('resolveGrade returns fresh objects: no caller can edit the neutral grade or a look through the result', () => {
    const a = resolveGrade(undefined);
    expect(a).not.toBe(NEUTRAL_GRADE);
    expect(a.gain).not.toBe(NEUTRAL_GRADE.gain);
    a.gain[0] = 9;
    a.lift = 9;
    expect(NEUTRAL_GRADE.gain).toEqual([1, 1, 1]);
    expect(NEUTRAL_GRADE.lift).toBe(0);
    const spec: GradeSpec = { gain: [1.2, 1.1, 1] };
    const b = resolveGrade(spec);
    b.gain[1] = 5;
    expect(spec.gain).toEqual([1.2, 1.1, 1]);
    expect(resolveGrade(undefined).gain).toEqual([1, 1, 1]);
  });

  it('DEFAULT_CORRUPTION is {desaturate 0.15, darken 0.10, shadowTint #5b4a7a, haze #6a5a7e}', () => {
    expect(DEFAULT_CORRUPTION).toEqual({ desaturate: 0.15, darken: 0.1, shadowTint: '#5b4a7a', haze: '#6a5a7e' });
    expect(Object.isFrozen(DEFAULT_CORRUPTION)).toBe(true);
  });

  it('resolveCorruption: nothing / null / {} give the default tint; a partial look overrides only what it names', () => {
    for (const c of [undefined, null, {}] as const) {
      const r = resolveCorruption(c);
      expect(r).toEqual(DEFAULT_CORRUPTION);
      expect(r).not.toBe(DEFAULT_CORRUPTION);
    }
    expect(resolveCorruption({ haze: '#335533', desaturate: 0.4 })).toEqual({ ...DEFAULT_CORRUPTION, haze: '#335533', desaturate: 0.4 });
    // 0 turns a channel off, it is not "absent"
    expect(resolveCorruption({ desaturate: 0, darken: 0 })).toEqual({ ...DEFAULT_CORRUPTION, desaturate: 0, darken: 0 });
    expect(resolveCorruption({ darken: Number.NaN }).darken).toBe(DEFAULT_CORRUPTION.darken);
  });

  it('loopsOf: [] for a look without ambientLoops (and for no look); a list is copied, de-duplicated, empties dropped', () => {
    expect(loopsOf(BARE)).toEqual([]);
    expect(loopsOf(undefined)).toEqual([]);
    expect(loopsOf({ ambientLoops: [] })).toEqual([]);
    const src = ['ambient.embers', '', 'ambient.fireflies', 'ambient.embers'];
    const out = loopsOf({ ambientLoops: src });
    expect(out).toEqual(['ambient.embers', 'ambient.fireflies']);
    expect(out).not.toBe(src);
    expect(src).toHaveLength(4);
    // the helper never folds in BiomeLook.particles (the caller spawns that one itself)
    expect(loopsOf({ ambientLoops: ['a'], biome: { particles: 'ambient.leaves' } })).toEqual(['a']);
    expect(loopsOf(FULL)).toEqual(['ambient.embers', 'ambient.fireflies']);
  });

  it('a look that carries none of the new fields resolves neutral through every helper (the four shipped looks too)', () => {
    for (const id of ZONES) {
      const bare: ZoneLook = { ...lookFor(id), post: undefined, arc: undefined, corruption: undefined, ambientLoops: undefined };
      expect(resolveGrade(bare.post?.grade)).toEqual(NEUTRAL_GRADE);
      expect(resolveCorruption(bare.corruption)).toEqual(DEFAULT_CORRUPTION);
      expect(loopsOf(bare)).toEqual([]);
      expect(bare.arc ?? []).toEqual([]);
    }
  });

  it('the contract has the exact field names and shapes of the spec (compile-time: this file must typecheck)', () => {
    const k = FULL.arc?.[1] as ArcKey;
    expect(Object.keys(k).sort()).toEqual(['fill', 'fog', 'grade', 'haze', 'hemi', 'medallionGlow', 'poolGain', 'sun', 't']);
    expect(Object.keys(FULL.post ?? {}).sort()).toEqual(['bloom', 'grade', 'vignette']);
    expect(Object.keys(FULL.post?.grade ?? {}).sort()).toEqual(
      ['balance', 'contrast', 'gain', 'gamma', 'highlightAmt', 'highlightTint', 'lift', 'pivot', 'saturation', 'shadowAmt', 'shadowTint'].sort(),
    );
    expect(Object.keys(FULL.corruption ?? {}).sort()).toEqual(['darken', 'desaturate', 'haze', 'shadowTint']);
    const pool: PoolSpec | undefined = FULL.pools.stone_lantern;
    expect(pool?.flare).toBe(0.5);
    expect(pool?.flareHeight).toBe(1.4);
    const liq: LiquidLook | undefined = FULL.liquidLook;
    expect(liq?.ice?.glitter).toBe(0.25); // the existing knob, reused: the contract only adds sheen / sheenColor
    expect(liq?.ice?.sheen).toBe(0.35);
    expect(liq?.lava?.skinScale).toBe(6);
    const crystal: RockMatStyle | undefined = FULL.rocks?.kind?.crystal;
    expect(crystal?.rimColor).toBe('#9fd6ff');
  });

  it('no sealGlow, no ZoneLook.ambient, ReadabilityLook keeps all four fields required (compile-time guards)', () => {
    // @ts-expect-error ZoneLook has no `ambient`: BiomeLook.ambient is ambient LIGHT and ambient loops are `ambientLoops`
    const a: ZoneLook = { ...BARE, ambient: ['x'] };
    // @ts-expect-error no sealGlow: the medallion glows through MedallionSpec.emissive + ArcKey.medallionGlow
    const m: MedallionSpec = { tex: 'tex_x', radius: 4, sealGlow: 1 };
    // @ts-expect-error no sealGlow on SealSpec either (its own `glow` exists)
    const s: SealSpec = { radius: 4, color: '#fff', glow: 0, wear: 0, opacity: 1, sealGlow: 1 };
    // @ts-expect-error ReadabilityLook rim / rimStrength / desaturate / darken are all required
    const r: ReadabilityLook = { rim: '#ffffff' };
    // a second ice glitter knob would be a redeclaration
    // @ts-expect-error LiquidLook.ice.glitter exists already: there is no iceGlitter
    const i: LiquidLook = { ice: { iceGlitter: 0.3 } };
    expect([a, m, s, r, i]).toHaveLength(5);
  });
});
