// ROCK-01: the crystal rock look. The knobs come from look.rocks (RockMatStyle) over per-style defaults; 'ice' gets the new glassy look, 'obsidian'
// and every stone rock keep the numbers they had (strict kind gate), and no variant adds a program: one program per crystal style, no defines.
import { Color, MeshStandardMaterial, ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { createCrystalMaterial, crystalKnobsFor, crystalMaterialFor, crystalStyleFor, punchColor } from './rockMaterials';
import { rockStyleFor, rockTune } from './rockStyle';

const lin = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

/** runs the material's shader patch on the real three standard shader and returns what it produced */
function compile(mat: ReturnType<typeof createCrystalMaterial>): { uniforms: Record<string, { value: unknown }>; fragmentShader: string; vertexShader: string } {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  (mat.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null);
  return shader;
}
const num = (u: { value: unknown } | undefined): number => (u as { value: number }).value;
const rimP = (u: { value: unknown } | undefined): { x: number; y: number; z: number } => (u as { value: { x: number; y: number; z: number } }).value;
const rgb = (u: { value: unknown } | undefined): number[] => {
  const c = (u as { value: Color }).value;
  return [c.r, c.g, c.b];
};

describe('crystalKnobsFor', () => {
  it('ice defaults are the ROCK-01 look when the zone look says nothing', () => {
    const k = crystalKnobsFor('ice');
    expect(k.translucency).toBe(0.4);
    expect(k.rimGlow).toBe(0.45);
    expect(k.emissive).toBe(0.25);
    expect(k.rimColor).toEqual(lin('#9fd6ff'));
    expect(k.emissiveColor).toEqual(lin('#7fc4ff'));
    expect(crystalKnobsFor('ice', null)).toEqual(k);
    expect(crystalKnobsFor('ice', {})).toEqual(k);
  });

  it('obsidian keeps the numbers it always had (no translucency, no inner emissive, the old rim)', () => {
    const k = crystalKnobsFor('obsidian');
    expect(k.translucency).toBe(0);
    expect(k.emissive).toBe(0);
    expect(k.rimGlow).toBe(0.5);
    expect(k.rimColor).toEqual([0.18, 0.07, 0.03]);
  });

  it('a look field replaces only its own default, colours are read as sRGB hex into linear', () => {
    const k = crystalKnobsFor('ice', { emissive: 0.4, rimColor: '#ffffff' });
    expect(k.emissive).toBe(0.4);
    expect(k.rimColor).toEqual([1, 1, 1]);
    expect(k.translucency).toBe(0.4);
    expect(k.rimGlow).toBe(0.45);
    expect(k.emissiveColor).toEqual(lin('#7fc4ff'));
  });

  it('values are clamped and a non-number falls back to the default; 0 switches a term off', () => {
    expect(crystalKnobsFor('ice', { translucency: 7, rimGlow: -1 })).toMatchObject({ translucency: 1, rimGlow: 0 });
    expect(crystalKnobsFor('ice', { emissive: 9 }).emissive).toBe(2);
    expect(crystalKnobsFor('ice', { translucency: Number.NaN }).translucency).toBe(0.4);
    expect(crystalKnobsFor('ice', { translucency: 0, emissive: 0, rimGlow: 0 })).toMatchObject({ translucency: 0, emissive: 0, rimGlow: 0 });
  });

  it('does not alias the shared default colours', () => {
    const a = crystalKnobsFor('ice');
    a.rimColor[0] = 99;
    expect(crystalKnobsFor('ice').rimColor[0]).not.toBe(99);
  });
});

describe('createCrystalMaterial', () => {
  it('ice: the patch applies to the standard shader and the knobs reach the uniforms', () => {
    const mat = createCrystalMaterial('ice');
    const s = compile(mat);
    expect(num(s.uniforms.uTrans)).toBe(0.4);
    expect(num(s.uniforms.uRimK)).toBe(0.45);
    expect(num(s.uniforms.uEmK)).toBe(0.25);
    // the old vertex-glow ember is replaced by the inner emissive on ice
    expect(num(s.uniforms.uAmount)).toBe(0);
    // the ice light colours go through punchColor (a richer hue of the same colour), the knobs keep the pale sRGB picks
    expect(rgb(s.uniforms.uRim)).toEqual(punchColor(lin('#9fd6ff')));
    expect(rimP(s.uniforms.uRimP).x).toBe(2.4);
    expect(rimP(s.uniforms.uRimP).y).toBe(0.8);
    expect(rimP(s.uniforms.uRimP).z).toBe(0.78);
    expect(rgb(s.uniforms.uEmis)).toEqual(punchColor(lin('#7fc4ff')));
    expect(s.fragmentShader).toContain('uniform float uTrans;');
    expect(s.fragmentShader).toContain('directionalLights[0]');
  });

  it('the zone look reaches the material through the function rocks.ts calls (SO-05 / SO-06 tune look.rocks.kind.crystal)', () => {
    const look = { all: { dirt: 0.3, emissive: 0.1 }, kind: { crystal: { emissive: 0.35, rimGlow: 0.6, translucency: 0.2, emissiveColor: '#ffffff' } } };
    const s = compile(crystalMaterialFor('tex_ice_blue', look));
    expect(num(s.uniforms.uEmK)).toBe(0.35);
    expect(num(s.uniforms.uRimK)).toBe(0.6);
    expect(num(s.uniforms.uTrans)).toBe(0.2);
    expect(rgb(s.uniforms.uEmis)).toEqual([1, 1, 1]);
    // rocks.all alone also reaches it (the kind entry is optional), and no look is the defaults
    expect(num(compile(crystalMaterialFor('tex_ice_blue', { all: { emissive: 0.4 } })).uniforms.uEmK)).toBe(0.4);
    expect(num(compile(crystalMaterialFor('tex_ice_blue', undefined)).uniforms.uEmK)).toBe(0.25);
    // the look cannot turn an ice zone into obsidian or back: the style still comes from the rock material id
    expect(crystalMaterialFor('tex_daeryeol_basalt', undefined).customProgramCacheKey()).toBe('rockCrystalobsidian');
    expect(crystalMaterialFor('tex_ice_blue', look).customProgramCacheKey()).toBe('rockCrystalice');
    // the cairns and the mere crystals of one zone share one material: one program for the layer (no per-knob variant)
    expect(crystalMaterialFor('tex_ice_blue', look).customProgramCacheKey()).toBe(crystalMaterialFor('tex_ice_blue', undefined).customProgramCacheKey());
  });

  it('obsidian keeps its old numbers: the new terms are zero and the glow ember is the old 0.35', () => {
    const s = compile(createCrystalMaterial('obsidian'));
    expect(num(s.uniforms.uTrans)).toBe(0);
    expect(num(s.uniforms.uEmK)).toBe(0);
    expect(num(s.uniforms.uRimK)).toBe(0.5);
    expect(num(s.uniforms.uAmount)).toBe(0.35);
    // the rim keeps its old exponent and gets no tip boost
    expect(rimP(s.uniforms.uRimP).x).toBe(2.2);
    expect(rimP(s.uniforms.uRimP).y).toBe(0);
    expect(rimP(s.uniforms.uRimP).z).toBe(1);
    // the obsidian light colours are not punched: the rim is the number it always was
    expect(rgb(s.uniforms.uRim)).toEqual([0.18, 0.07, 0.03]);
  });

  it('ice is a saturated glass blue: a cool hue, more saturated than the old grey-blue body that sank into the snow', () => {
    const sat = (c: Color): number => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / Math.max(c.r, c.g, c.b);
    const body = createCrystalMaterial('ice').color;
    const oldBody = new Color(0.42, 0.7, 0.9);
    expect(sat(body)).toBeGreaterThan(sat(oldBody) + 0.15);
    expect(body.b).toBeGreaterThan(body.g);
    expect(body.g).toBeGreaterThan(body.r);
  });

  it('the inner light is added after the lights and fades where the sun already lights the facet (glows in shade and tree shadow)', () => {
    const f = compile(createCrystalMaterial('ice')).fragmentShader;
    const inner = f.indexOf('vec3 rkInner');
    const end = f.indexOf('totalEmissiveRadiance += rkInner * mix(1.4, 0.8, rkLit)');
    const outgoing = f.indexOf('vec3 outgoingLight');
    // computed with the surface (before the lights), added once the direct light of the facet is known, before the output is assembled
    expect(inner).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(inner);
    expect(end).toBeLessThan(outgoing);
    // the sun share comes from the light the facet really received (n.l x the shadow map), normalised by the sun and the albedo
    expect(f).toContain('reflectedLight.directDiffuse');
    expect(f).toContain('rkLit');
    // shade / tree shadow (rkLit 0) glows stronger than a facet in full sun (rkLit 1), but the sun side keeps most of it: the r2 build faded it to
    // a quarter in the sun and the shards read as pale pastel at the snow's value in every daylight frame (critic r2); now the tips stay above the
    // bloom threshold in the sun too
    const mm = /rkInner \* mix\(([0-9.]+), ([0-9.]+), rkLit\)/.exec(f);
    expect(mm).not.toBeNull();
    expect(Number(mm?.[1])).toBeGreaterThan(Number(mm?.[2]) * 1.5);
    expect(Number(mm?.[2])).toBeGreaterThanOrEqual(0.5);
    // the inner light is one gradient (dim base -> bright tip), and no flat constant is added any more
    expect(f).not.toMatch(/totalEmissiveRadiance \+= uEmis \* \(uEmK/);
  });

  it('the gradient: a dim base, a shaft that stays azure (fourth power of the glow) and a tip that outshines it, tip colour paler than the base colour of the light', () => {
    const f = compile(createCrystalMaterial('ice')).fragmentShader;
    const m = /uEmK \* \(([0-9.]+) \+ ([0-9.]+) \* rkG2 \* rkG2\)/.exec(f);
    expect(m).not.toBeNull();
    const base = Number(m?.[1]);
    const tip = Number(m?.[2]);
    expect(base).toBeLessThan(0.5);
    expect(tip).toBeGreaterThan(base * 8);
    // the tip colour is the light colour mixed towards white (a cyan glow, not a white blob that melts into the snow)
    const w = /mix\(uEmis, vec3\(1\.0\), ([0-9.]+)\)/.exec(f);
    expect(w).not.toBeNull();
    expect(Number(w?.[1])).toBeGreaterThan(0);
    expect(Number(w?.[1])).toBeLessThanOrEqual(0.4);
  });

  it('one program per style: no defines, a style-only cache key, the same key whatever the knobs', () => {
    const a = createCrystalMaterial('ice');
    const b = createCrystalMaterial('ice', { emissive: 0.4, translucency: 0.1 });
    const o = createCrystalMaterial('obsidian');
    // no defines of our own: only the ones three's standard material carries
    expect(a.defines).toEqual(new MeshStandardMaterial().defines);
    expect(b.defines).toEqual(new MeshStandardMaterial().defines);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toBe(o.customProgramCacheKey());
    expect(a.name).toBe('rockCrystal');
  });

  it('keeps alpha-to-coverage and the occlusion fade (C5)', () => {
    const mat = createCrystalMaterial('ice');
    expect(mat.alphaToCoverage).toBe(true);
    expect(compile(mat).uniforms.uHeroView).toBeDefined();
  });
});

describe('strict kind gate', () => {
  it('the crystal knobs never reach the stone tuning of a rock group', () => {
    expect(rockTune({ translucency: 0.5, rimGlow: 0.5, rimColor: '#fff', emissive: 0.3, emissiveColor: '#fff' })).toBeNull();
  });

  it('the style of the crystal kind is separate from the other kinds', () => {
    const look = { kind: { crystal: { emissive: 0.4 }, boulder: { dirt: 0.2 } } };
    expect(rockStyleFor(look, 'crystal')).toEqual({ emissive: 0.4 });
    expect(rockStyleFor(look, 'boulder')).toEqual({ dirt: 0.2 });
    expect(rockStyleFor(look, 'slab')).toBeUndefined();
  });

  it('only basalt-like ids pick obsidian, Seori ice is ice', () => {
    expect(crystalStyleFor('tex_ice_blue')).toBe('ice');
    expect(crystalStyleFor('tex_seori_slate')).toBe('ice');
    expect(crystalStyleFor('tex_daeryeol_basalt')).toBe('obsidian');
  });
});

describe('punchColor', () => {
  it('keeps the hue and the brightest channel, drops the pale channels (c * c / max)', () => {
    const p = punchColor(lin('#7fc4ff'));
    const c = lin('#7fc4ff');
    expect(p[2]).toBeCloseTo(c[2], 6);
    expect(p[0]).toBeLessThan(c[0]);
    expect(p[1]).toBeLessThan(c[1]);
    // hue (ratio of the two lower channels to the peak) is the same colour squared: still cyan-azure, ordered b > g > r
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[0]);
    const sat = (v: readonly number[]): number => (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    expect(sat(p)).toBeGreaterThan(sat(c) + 0.1);
  });

  it('is the identity on white, black and a pure primary, and never produces NaN', () => {
    expect(punchColor([1, 1, 1])).toEqual([1, 1, 1]);
    expect(punchColor([0, 0, 1])).toEqual([0, 0, 1]);
    for (const v of punchColor([0, 0, 0])) expect(Number.isFinite(v)).toBe(true);
  });
});
