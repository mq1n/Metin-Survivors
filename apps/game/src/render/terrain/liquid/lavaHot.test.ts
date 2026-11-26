// LIQ-01 (D-LAVA-03): the flat lava's hot veins (an HDR term on the hottest flow lines only, in #ff7a2a's hue) and drifting darker
// cooling skins, both from QUALITY >= 1 on; the knobs come from LiquidLook.lava (A0-LOOK) with LAVA_HOT_DEFAULTS when absent.
import { Color, type Mesh, type ShaderMaterial, type Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../../data/schema';
import { createTerrainField } from '../../../world/terrainField';
import { QUALITY_PROFILES } from '../../quality';
import { findLook } from '../look';
import type { ZoneContext } from '../zoneContext';
import { createLiquid, LAVA_HOT_DEFAULTS, lavaHotParams } from './index';
import { LAVA_FRAG } from './shaders';

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

/** a Daeryeol lava system at the given quality tier (the only zone with a flat lava look) */
function lava(tier: 'low' | 'medium' | 'high') {
  const b = biome('daeryeol');
  const field = createTerrainField(b);
  const ctx = {
    core: { env: { sun: { color: new Color('#ffffff'), intensity: 1 }, hemi: { color: new Color('#aaaaaa'), intensity: 1 } } },
    assets: {},
    field,
    biome: b,
    quality: QUALITY_PROFILES[tier],
  } as unknown as ZoneContext;
  const sys = createLiquid(ctx);
  if (!sys) throw new Error('daeryeol has a lava liquid');
  const mat = (sys.group.children[0] as Mesh).material as ShaderMaterial;
  return { sys, mat };
}

/** the fragment source as the GLSL preprocessor would see it for QUALITY q (only #if QUALITY >= n / #if defined(..) && QUALITY >= n / #else / #endif are evaluated; every other condition counts as true) */
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

describe('LIQ-01 lavaHotParams', () => {
  it('low has neither hot veins nor skins, whatever the look says', () => {
    expect(lavaHotParams(undefined, 0)).toMatchObject({ hotHdr: 0, skin: 0 });
    expect(lavaHotParams({ hotHdr: 3, skin: 0.5, skinScale: 9 }, 0)).toMatchObject({ hotHdr: 0, skin: 0 });
  });

  it('absent fields take the defaults from medium up (hotHdr 1.6, skin 0.22, skinScale 6 m)', () => {
    expect(LAVA_HOT_DEFAULTS).toEqual({ hotHdr: 1.6, skin: 0.22, skinScale: 6 });
    for (const level of [1, 2]) {
      expect(lavaHotParams(undefined, level)).toEqual(LAVA_HOT_DEFAULTS);
      expect(lavaHotParams({ mode: 'flat' }, level)).toEqual(LAVA_HOT_DEFAULTS);
    }
  });

  it('a field of the look wins, an explicit 0 switches that part off, each field on its own', () => {
    expect(lavaHotParams({ hotHdr: 0 }, 1)).toEqual({ hotHdr: 0, skin: 0.22, skinScale: 6 });
    expect(lavaHotParams({ skin: 0 }, 2)).toEqual({ hotHdr: 1.6, skin: 0, skinScale: 6 });
    expect(lavaHotParams({ hotHdr: 2.4, skin: 0.4, skinScale: 9 }, 1)).toEqual({ hotHdr: 2.4, skin: 0.4, skinScale: 9 });
  });

  it('is clamped and ignores non-finite values', () => {
    expect(lavaHotParams({ hotHdr: 99, skin: 5, skinScale: 0.01 }, 1)).toEqual({ hotHdr: 4, skin: 0.6, skinScale: 1 });
    expect(lavaHotParams({ hotHdr: -3, skin: -1, skinScale: 400 }, 1)).toEqual({ hotHdr: 0, skin: 0, skinScale: 40 });
    expect(lavaHotParams({ hotHdr: Number.NaN, skin: Number.POSITIVE_INFINITY }, 1)).toEqual(LAVA_HOT_DEFAULTS);
  });
});

describe('LIQ-01 lava system', () => {
  it('Daeryeol still has the flat lava look the knobs hang on', () => {
    const l = findLook('daeryeol')?.liquidLook?.lava;
    expect(l?.mode).toBe('flat');
  });

  it('DY-04: the lava lights its banks (shore glow well above the START 0.3), but not into a wash (bloom + ACES turn 1.3 and up into a peach flood on medium / high)', () => {
    const glow = findLook('daeryeol')?.liquidLook?.lava?.shore?.glow ?? 0;
    expect(glow).toBeGreaterThanOrEqual(0.9);
    expect(glow).toBeLessThanOrEqual(1.3);
  });

  it('feeds the knobs to the surface material per tier and follows setQuality', () => {
    const { sys, mat } = lava('medium');
    expect(mat.defines.LAVA_FLAT).toBe('');
    expect(mat.defines.QUALITY).toBe(1);
    const hot = mat.uniforms.uLavaHot!.value as Vector4;
    // the knobs of Daeryeol's own look (DY-04 sets hotHdr / skin above the LIQ-01 defaults), resolved for this tier
    const own = lavaHotParams(findLook('daeryeol')?.liquidLook?.lava, 1);
    expect(hot.toArray()).toEqual([own.hotHdr, own.skin, own.skinScale, 0]);
    // the hot lines are #ff7a2a: orange, never white (linear: strong red, weak green, almost no blue)
    const tint = mat.uniforms.uLavaHotTint!.value as Color;
    const want = new Color('#ff7a2a');
    expect([tint.r, tint.g, tint.b]).toEqual([want.r, want.g, want.b]);
    expect(tint.g / tint.r).toBeLessThan(0.25);
    expect(tint.b / tint.r).toBeLessThan(0.05);

    sys.setQuality?.(QUALITY_PROFILES.low);
    expect(mat.defines.QUALITY).toBe(0);
    expect(hot.toArray()).toEqual([0, 0, 6, 0]);
    sys.setQuality?.(QUALITY_PROFILES.high);
    expect(mat.defines.QUALITY).toBe(2);
    expect(hot.toArray()).toEqual([own.hotHdr, own.skin, own.skinScale, 0]);
    sys.dispose();
  });

  it('low starts with the knobs at zero', () => {
    const { sys, mat } = lava('low');
    expect(mat.defines.QUALITY).toBe(0);
    expect((mat.uniforms.uLavaHot!.value as Vector4).toArray().slice(0, 2)).toEqual([0, 0]);
    sys.dispose();
  });
});

describe('LIQ-01 LAVA_FRAG', () => {
  const q0 = preprocess(LAVA_FRAG, 0);
  const q1 = preprocess(LAVA_FRAG, 1);

  it('low compiles none of the new code (no uniform, no extra noise lookup)', () => {
    expect(q0).not.toContain('uLavaHot');
    expect(q0).not.toContain('skinPlate');
    expect(q0).not.toContain('hotM');
    const lookups = (s: string): number => (s.match(/flowSample\(/g) ?? []).length;
    expect(lookups(q1)).toBeGreaterThan(lookups(q0));
  });

  it('medium and up add the hot lines (heat > 0.8) and the skins', () => {
    expect(q1).toContain('uniform vec4 uLavaHot');
    expect(q1).toContain('smoothstep(0.8, 0.92, heat)');
    expect(q1).toContain('uLavaHotTint');
    expect(q1).toContain('skinPlate');
  });

  it('keeps the saturated base palette at or below 1.0 linear (the HDR term is the only way past it)', () => {
    expect(q0).toContain('vec3 cRed = uCore * vec3(0.8, 0.6, 0.5);');
    expect(q0).toContain('vec3 cOrange = uCore * vec3(0.98, 1.9, 1.0);');
    expect(q0).toContain('vec3 cHot = vec3(0.92, 0.46, 0.012);');
  });

  it('the gain is applied only on a uniform branch that hotHdr = 0 skips', () => {
    expect(q1).toMatch(/if \(uLavaHot\.x > 0\.0\) col = mix\(col, uLavaHotTint/);
  });
});
