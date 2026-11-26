// LIQ-02 (S-ICE-03): the frozen mere's clear cool-blue sheet, added sky light and sparse sun glints (ICE_V2, Seori's path), all from QUALITY >= 1 on, where
// the sheet blends premultiplied so the light is ADDED and the bed (frost grain, hero ring and shadow, telegraphs) stays visible; the knobs come
// from LiquidLook.ice (A0-LOOK: sheen / sheenColor, the EXISTING glitter) with ICE_SHEEN_DEFAULTS when absent.
import { Color, type Mesh, type ShaderMaterial, type Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../../data/schema';
import { createTerrainField } from '../../../world/terrainField';
import { QUALITY_PROFILES } from '../../quality';
import { findLook } from '../look';
import type { ZoneContext } from '../zoneContext';
import { createLiquid, ICE_SHEEN_DEFAULTS, icePremultiplied, iceSheenParams, liquidRenderOrder } from './index';
import { ICE_FRAG } from './shaders';

function biome(id: string): BiomePreset {
  return {
    id,
    seed: 77,
    ground: [],
    trees: [],
    props: [],
    fog: { color: '#aabbcc', near: 40, far: 160 },
    sky: { top: '#223344', horizon: '#aabbcc', bottom: '#556677' },
    sun: { color: '#fff1d6', intensity: 2.4, dir: [-0.4, 0.8, 0.45] },
    ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.8 },
    relief: { height: 20, roughness: 0.5, features: [] },
  };
}

/** Seori's frozen mere at the given quality tier (the only zone with an ice look) */
function mere(tier: 'low' | 'medium' | 'high') {
  const b = biome('seori');
  const field = createTerrainField(b);
  const ctx = {
    core: { env: { sun: { color: new Color('#ffffff'), intensity: 1 }, hemi: { color: new Color('#aaaaaa'), intensity: 1 } } },
    assets: {},
    field,
    biome: b,
    quality: QUALITY_PROFILES[tier],
  } as unknown as ZoneContext;
  const sys = createLiquid(ctx);
  if (!sys) throw new Error('seori has an ice liquid');
  const mat = (sys.group.children[0] as Mesh).material as ShaderMaterial;
  return { sys, mat };
}

/** the fragment source as the GLSL preprocessor would see it for QUALITY q (only #if QUALITY >= n / #else / #endif are evaluated; every other condition counts as true) */
function preprocess(src: string, q: number): string {
  const out: string[] = [];
  const stack: Array<{ active: boolean; taken: boolean }> = [];
  const on = (): boolean => stack.every((s) => s.active);
  const cond = (c: string): boolean => {
    const m = /QUALITY\s*>=\s*(\d+)/.exec(c);
    return m ? q >= Number(m[1]) : true;
  };
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#if')) {
      const c = cond(t);
      stack.push({ active: c, taken: c });
    } else if (t.startsWith('#else')) {
      const top = stack[stack.length - 1]!;
      top.active = !top.taken;
    } else if (t.startsWith('#endif')) stack.pop();
    else if (on()) out.push(line);
  }
  return out.join('\n');
}

describe('LIQ-02 iceSheenParams', () => {
  it('low has no sheen, whatever the look says (and keeps the glitter value the shader never reads there)', () => {
    expect(iceSheenParams(undefined, 0).sheen).toBe(0);
    expect(iceSheenParams({ sheen: 0.9 }, 0).sheen).toBe(0);
  });

  it('absent fields take the defaults from medium up (sheen 0.35, #cfe6ff, glitter 0.25)', () => {
    expect(ICE_SHEEN_DEFAULTS).toEqual({ sheen: 0.35, sheenColor: '#cfe6ff', glitter: 0.25 });
    for (const level of [1, 2]) {
      expect(iceSheenParams(undefined, level)).toEqual(ICE_SHEEN_DEFAULTS);
      expect(iceSheenParams({ opacity: 0.2, crack: 0.3 }, level)).toEqual(ICE_SHEEN_DEFAULTS);
    }
  });

  it('a field of the look wins (the existing glitter knob included), an explicit 0 switches that part off', () => {
    expect(iceSheenParams({ glitter: 1 }, 1)).toEqual({ sheen: 0.35, sheenColor: '#cfe6ff', glitter: 1 });
    expect(iceSheenParams({ sheen: 0 }, 2).sheen).toBe(0);
    expect(iceSheenParams({ glitter: 0 }, 2).glitter).toBe(0);
    expect(iceSheenParams({ sheen: 0.6, sheenColor: '#aaccee', glitter: 0.5 }, 1)).toEqual({ sheen: 0.6, sheenColor: '#aaccee', glitter: 0.5 });
  });

  it('is clamped, ignores non-finite values and a malformed colour', () => {
    expect(iceSheenParams({ sheen: 9, glitter: 4 }, 1)).toMatchObject({ sheen: 1, glitter: 1 });
    expect(iceSheenParams({ sheen: -2, glitter: -1 }, 1)).toMatchObject({ sheen: 0, glitter: 0 });
    expect(iceSheenParams({ sheen: Number.NaN, glitter: Number.POSITIVE_INFINITY }, 1)).toEqual(ICE_SHEEN_DEFAULTS);
    expect(iceSheenParams({ sheenColor: 'blue' }, 1).sheenColor).toBe('#cfe6ff');
    expect(iceSheenParams({ sheenColor: '#fff' }, 1).sheenColor).toBe('#cfe6ff');
  });
});

describe('LIQ-02 icePremultiplied', () => {
  it('water always, the frozen mere with an ice look from medium up, nothing else', () => {
    expect(icePremultiplied('water', true, 0)).toBe(true);
    expect(icePremultiplied('water', false, 2)).toBe(true);
    expect(icePremultiplied('ice', true, 0)).toBe(false);
    expect(icePremultiplied('ice', true, 1)).toBe(true);
    expect(icePremultiplied('ice', true, 2)).toBe(true);
    // an ice without a look has no ICE_V2 path: it keeps the plain sheet on every tier
    expect(icePremultiplied('ice', false, 2)).toBe(false);
    expect(icePremultiplied('lava', true, 2)).toBe(false);
  });
});

describe('LIQ-02 liquidRenderOrder', () => {
  // the lowest ground marker order: the hero's large ring (groundRings -31); then telegraphs -20, the small ring -15 and the crowd's blob shadows -10
  const LOWEST_GROUND_MARKER = -31;

  it('the frozen mere is drawn UNDER every ground marker, its shore decal too (they were veiled by the sheet before)', () => {
    const o = liquidRenderOrder('ice');
    expect(o.surface).toBeLessThan(LOWEST_GROUND_MARKER);
    expect(o.shore).toBeLessThan(LOWEST_GROUND_MARKER);
    expect(o.surface).toBeLessThan(o.shore);
  });

  it('water and lava keep their order (a marker is drawn before a body the hero wades into)', () => {
    expect(liquidRenderOrder('water')).toEqual({ surface: -10, shore: -9 });
    expect(liquidRenderOrder('lava')).toEqual({ surface: -10, shore: -9 });
  });
});

describe('LIQ-02 ice system', () => {
  it('Seori still has the ice look the knobs hang on (glitter 1 is its own, sheen is left to the default)', () => {
    const ice = findLook('seori')?.liquidLook?.ice;
    expect(ice).toBeDefined();
    expect(ice?.glitter).toBe(1);
    expect(ice?.sheen).toBeUndefined();
  });

  it('feeds the knobs to the surface material per tier and follows setQuality', () => {
    const { sys, mat } = mere('medium');
    expect(mat.defines.ICE_V2).toBe('');
    expect(mat.defines.QUALITY).toBe(1);
    const sheen = mat.uniforms.uIceSheen!.value as Vector4;
    expect(sheen.x).toBeCloseTo(0.35, 6);
    const tint = mat.uniforms.uIceSheenTint!.value as Color;
    const want = new Color('#cfe6ff');
    expect([tint.r, tint.g, tint.b]).toEqual([want.r, want.g, want.b]);
    // the glitter is the look's own knob (Seori: 1), carried by uIceOpt.y as before
    expect((mat.uniforms.uIceOpt!.value as Vector4).y).toBe(1);

    expect(mat.premultipliedAlpha).toBe(true);
    sys.setQuality?.(QUALITY_PROFILES.low);
    expect(mat.defines.QUALITY).toBe(0);
    expect(sheen.x).toBe(0);
    expect(mat.premultipliedAlpha).toBe(false);
    sys.setQuality?.(QUALITY_PROFILES.high);
    expect(mat.defines.QUALITY).toBe(2);
    expect(sheen.x).toBeCloseTo(0.35, 6);
    expect(mat.premultipliedAlpha).toBe(true);
    sys.dispose();
  });

  it('low starts with the sheen at zero and the plain (non-premultiplied) sheet it always had', () => {
    const { sys, mat } = mere('low');
    expect(mat.defines.QUALITY).toBe(0);
    expect((mat.uniforms.uIceSheen!.value as Vector4).x).toBe(0);
    expect(mat.premultipliedAlpha).toBe(false);
    sys.dispose();
  });

  it('medium and high start premultiplied (the shader adds its sky light and glints on top of the sheet)', () => {
    for (const tier of ['medium', 'high'] as const) {
      const { sys, mat } = mere(tier);
      expect(mat.premultipliedAlpha).toBe(true);
      expect(mat.transparent).toBe(true);
      sys.dispose();
    }
  });

  it('the meshes carry the ice order on every tier: the sheet and its shore decal sit under the ground markers', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const { sys } = mere(tier);
      const [surface, shore] = sys.group.children as Mesh[];
      expect(surface!.renderOrder).toBe(liquidRenderOrder('ice').surface);
      expect(shore!.renderOrder).toBe(liquidRenderOrder('ice').shore);
      // the sheet still writes no depth: a marker drawn after it lands on the bed through the translucent sheet
      expect(((surface as Mesh).material as ShaderMaterial).depthWrite).toBe(false);
      sys.dispose();
    }
  });

  it('adds no define: the program set of the zone stays what the load-time warm-up already compiles', () => {
    const { sys, mat } = mere('high');
    expect(Object.keys(mat.defines).sort()).toEqual(['GRID_HALF', 'GRID_N', 'ICE_V2', 'MAX_FLOW', 'QUALITY', 'SD_RANGE', 'SHORE_SHADE'].sort());
    expect(mat.name).toBe('liquid_ice');
    sys.dispose();
  });
});

describe('LIQ-02 ICE_FRAG', () => {
  const q0 = preprocess(ICE_FRAG, 0);
  const q1 = preprocess(ICE_FRAG, 1);

  it('low compiles none of the new code (no uniform, no layering, no glint hash)', () => {
    expect(q0).not.toContain('uIceSheen');
    expect(q0).not.toContain('iceOver');
    expect(q0).not.toContain('iceHash');
  });

  it('medium and up add the sheen and the glints, each on a uniform branch that a 0 knob skips', () => {
    expect(q1).toContain('uniform vec4 uIceSheen;');
    expect(q1).toContain('uniform vec3 uIceSheenTint;');
    expect(q1).toMatch(/if \(sheen > 0\.001\)/);
    expect(q1).toMatch(/if \(gl > 0\.001\)/);
    expect(q1).toContain('iceHash(');
  });

  it('the glitter is gated by the existing knob (uIceOpt.y) and never lands on a frost patch', () => {
    expect(q1).toContain('float gl = uIceOpt.y;');
    expect(q1).toMatch(/step\(h4, gl\)/);
    expect(q1).toContain('(1.0 - frostP)');
  });

  it('the sheen strength keeps the frosted rim intact and melts into the waterline', () => {
    expect(q1).toContain('float sn = sheen * (1.0 - rimV) * edge;');
  });

  it('the sheet blends premultiplied from medium up: the sky light and glints are ADDED, only low keeps the plain output', () => {
    expect(q1).toContain('vec3 iceAdd = vec3(0.0);');
    expect(q1).toContain('gl_FragColor.rgb = gl_FragColor.rgb * gl_FragColor.a + iceOut(iceAdd) * iceFogI;');
    expect(q1).toMatch(/iceAdd \+= skyRefl \* sn/);
    expect(q1).toMatch(/iceAdd \+= mix\(uSunColor/);
    for (const gone of ['iceAdd', 'iceOut', 'iceFogI']) expect(q0).not.toContain(gone);
    expect(q0).toContain('gl_FragColor = vec4(col, alpha);');
  });

  it('the glints are not painted over the bed (no cover): the star adds light only', () => {
    expect(q1).not.toMatch(/iceOver\([^;]*glint/);
  });

  it('veil budget: at the top-down game camera the sheen buries almost nothing of the bed; only grazing views and the shore lip cover it', () => {
    const cover = /float kOver = (clamp\(sn \* \([^;]*\), 0\.0, 0\.7\));/.exec(q1);
    expect(cover).not.toBeNull();
    const fn = new Function('sn', 'graze', 'lip', 'clamp', `return ${cover![1]!};`) as (sn: number, graze: number, lip: number, c: (v: number, a: number, b: number) => number) => number;
    const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
    const grazeOf = (ndv: number): number => Math.pow(1 - ndv, 1.5);
    const sn = ICE_SHEEN_DEFAULTS.sheen;
    // the game camera looks down about 55 degrees: ndv ~ 0.82; the establishing shots look across at about 20 degrees: ndv ~ 0.35
    const interior = fn(sn, grazeOf(0.82), 0, clamp);
    const establishing = fn(sn, grazeOf(0.35), 0, clamp);
    const lipCover = fn(sn, grazeOf(0.82), 1, clamp);
    expect(interior).toBeLessThan(0.05);
    expect(establishing).toBeGreaterThan(interior * 4);
    expect(lipCover).toBeGreaterThan(0.2);
    expect(fn(1, 1, 1, clamp)).toBeLessThanOrEqual(0.7);
    // the sheet keeps about the same translucency (look opacity 0.19): total cover in the interior of the mere at the game camera
    const extra = /alpha = min\(alpha \+ sn \* ([0-9.]+) \*/.exec(q1);
    expect(extra).not.toBeNull();
    const alpha = 0.19 + sn * Number(extra![1]);
    const total = 1 - (1 - alpha) * (1 - interior);
    expect(1 - total).toBeGreaterThan(0.75);
  });

  it('the non-ICE_V2 legacy path is untouched', () => {
    expect(ICE_FRAG).toContain('vec3 base = vec3(0.21, 0.43, 0.45) * mix(vec3(1.0), drift * 2.2, 0.25)');
    expect(ICE_FRAG).toContain('float alpha = mix(0.4, 0.97, smoothstep(0.0, 3.5, sd)) * edge;');
  });

  it('iceOver is the exact "reflection over sheet over bed" composite of NormalBlending', () => {
    const m = /void iceOver\(inout vec3 col, inout float alpha, vec3 c, float k\) \{([\s\S]*?)\n\}/.exec(q1);
    expect(m).not.toBeNull();
    // the GLSL scalar statements are valid JS once the type keyword is a `let`: run the shader's own text per channel
    const body = m![1]!.replace(/float a2/, 'let a2');
    const over = new Function('col', 'alpha', 'c', 'k', 'max', `${body}\nreturn [col, alpha];`) as (col: number, alpha: number, c: number, k: number, max: (a: number, b: number) => number) => [number, number];
    const run = (col: number, alpha: number, c: number, k: number): [number, number] => over(col, alpha, c, k, Math.max);
    // sequential NormalBlending over a bed colour B: sheet (col, alpha), then the reflection (c, k)
    const blend = (B: number, col: number, alpha: number, c: number, k: number): number => (B * (1 - alpha) + col * alpha) * (1 - k) + c * k;
    for (const [B, col, alpha, c, k] of [
      [0.8, 0.6, 0.19, 1.4, 0.3],
      [0.1, 0.9, 0.5, 0.2, 0.8],
      [0.5, 0.5, 0.0, 3.0, 0.05],
      [0.3, 0.7, 0.19, 2.5, 1.0],
    ] as const) {
      const [col2, alpha2] = run(col, alpha, c, k);
      expect(B * (1 - alpha2) + col2 * alpha2).toBeCloseTo(blend(B, col, alpha, c, k), 9);
    }
    // k = 0 leaves the sheet alone; a thin sheet (alpha 0) takes the reflection's colour at its coverage
    const [c1, a1] = run(0.6, 0.19, 9, 0);
    expect(c1).toBeCloseTo(0.6, 9);
    expect(a1).toBeCloseTo(0.19, 9);
    const [c2, a2] = run(0.6, 0, 1.5, 0.4);
    expect(a2).toBeCloseTo(0.4, 9);
    expect(c2).toBeCloseTo(1.5, 9);
  });
});
