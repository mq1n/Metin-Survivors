// Zones core lane A (C1 C2 C3 C5 C6 C8): a look without the new knobs selects exactly the old shader (no feature define);
// each knob switches its own path on; C8 decal kinds; C5 occlusion state; C3 liquid bake options; C6 far field; C3 river
// profile (world/shapes.ts).
import { Color, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../data/schema';
import type { ZoneLayout } from '../../world/layoutTypes';
import { riverProfile, riverWidth } from '../../world/shapes';
import { createTerrainField } from '../../world/terrainField';
import { QUALITY_PROFILES } from '../quality';
import { applyArcAtmosphere, atmosphereUniforms, configureAtmosphere } from './atmosphere';
import { liquidBakeOptions } from './liquid';
import { lookFor } from './look';
import type { ZoneLook } from './look/types';
import { configureOcclusion, occlusionParams, occlusionRadius, setOcclusionQuality } from './occlusion';
import { buildFarSkirt } from './terrain';
import { decal, DECAL_KIND_ID, usesDecalsV2 } from './terrainDecals';
import { createTerrainMaterial, decalSlots, MAX_DECALS, setTerrainArc, terrainDefines } from './terrainMaterial';

/** a copy of a shipped look with every C1-C8 field removed (what every zone had before the zones core) */
function plainLook(): ZoneLook {
  const l = structuredClone(lookFor('yeonmu'));
  delete l.style.cliff;
  delete l.style.calm;
  delete l.style.blend;
  delete l.shadow.soft;
  delete l.liquidLook;
  delete l.occlusion;
  delete l.edge;
  delete l.medallion; // zones core A4 / A2 blocks (coreAShader.test.ts covers them)
  delete l.rocks;
  l.decals = l.decals.slice(0, 4);
  return l;
}

const layout = (h?: number): ZoneLayout => ({ groundLayers: [{ tex: 'tex_grass_a', scale: 5 }, { tex: 'tex_mud', scale: 4, ...(h === undefined ? {} : { h }) }] }) as unknown as ZoneLayout;

describe('terrain shader feature switch (C1 C2 C3 C8)', () => {
  it('a look without the new knobs compiles the old shader (4 decal slots, no feature define)', () => {
    expect(terrainDefines(plainLook(), layout())).toEqual({ DECALS: 4 });
  });

  it('each knob switches exactly its own path on', () => {
    const on = (patch: (l: ZoneLook) => void, h?: number): string[] => {
      const l = plainLook();
      patch(l);
      return Object.keys(terrainDefines(l, layout(h))).filter((k) => k !== 'DECALS').sort();
    };
    expect(on((l) => (l.style.cliff = {}))).toEqual(['CLIFF_V2']);
    expect(on((l) => (l.style.cliff = { foot: { color: '#8c877c', width: 4 } }))).toEqual(['CLIFF_FOOT', 'CLIFF_V2']);
    expect(on((l) => (l.style.cliff = { foot: { color: '#8c877c', width: 0 } }))).toEqual(['CLIFF_V2']);
    expect(on((l) => (l.style.calm = { amount: 0.6, scale: 40, normalCut: 0.5 }))).toEqual(['CALM']);
    expect(on((l) => (l.style.calm = { amount: 0, scale: 40, normalCut: 0.5 }))).toEqual([]);
    expect(on((l) => (l.style.blend = { window: 0.5 }))).toEqual(['BLEND_V2']);
    expect(on(() => undefined, 0.2)).toEqual(['BLEND_V2']);
    expect(on(() => undefined, 0)).toEqual([]);
    expect(on((l) => (l.liquidLook = { lava: { shore: { crackle: 0 } } }))).toEqual(['LAVA_SHORE']);
    expect(on((l) => (l.liquidLook = { water: { foam: 0.3 } }))).toEqual([]);
    expect(on((l) => l.decals.push(decal({ kind: 'glint', cell: 2, density: 0.1, size: 0.03, a: '#ffffff', b: '#cfe6ff', emissive: 1, layers: [1] })))).toEqual(['DECALS_V2']);
  });

  it('C8: more than 4 families compile 6 slots; the new kinds have their own ids', () => {
    const l = plainLook();
    expect(decalSlots(l)).toBe(4);
    l.decals.push(decal({ kind: 'scuff', cell: 3, density: 0.3, size: 1, a: '#d0d0d0', b: '#e8e8e8', layers: [1] }));
    expect(decalSlots(l)).toBe(MAX_DECALS);
    expect(terrainDefines(l, layout()).DECALS).toBe(6);
    expect(DECAL_KIND_ID.glint).toBe(8);
    expect(DECAL_KIND_ID.scuff).toBe(9);
    expect(DECAL_KIND_ID.ember).toBe(10);
    expect(DECAL_KIND_ID.fissure).toBe(11);
    expect(usesDecalsV2(plainLook().decals)).toBe(false);
    expect(usesDecalsV2(l.decals)).toBe(true);
  });
});

describe('occlusion (C5)', () => {
  it('a look overrides radius / rim / ghost, absent restores the defaults, the tier picks the path', () => {
    configureOcclusion({ radius: 3, feather: 0.6, minAlpha: 0.2 });
    expect(occlusionParams.value.x).toBe(3);
    expect(occlusionParams.value.y).toBeCloseTo(0.6);
    expect(occlusionParams.value.z).toBeCloseTo(0.2);
    configureOcclusion(undefined);
    expect(occlusionParams.value.x).toBe(0);
    expect(occlusionParams.value.y).toBe(-1);
    expect(occlusionParams.value.z).toBe(0);
    // the master switch (gallery ?fade=0) is never touched by a look
    expect(occlusionRadius.value).toBe(2.4);
    setOcclusionQuality(QUALITY_PROFILES.low);
    expect(occlusionParams.value.w).toBe(0);
    setOcclusionQuality(QUALITY_PROFILES.high);
    expect(occlusionParams.value.w).toBe(1);
  });
});

describe('liquid bake options (C3)', () => {
  it('defaults unchanged; a beach widens the shore decal; taper only for water', () => {
    expect(liquidBakeOptions('water', undefined)).toEqual({ surfaceQuads: 1, decalReach: 1.8, decalLift: 0.09 });
    expect(liquidBakeOptions('lava', { lava: { mode: 'flat' } })).toEqual({ surfaceQuads: 4, decalReach: 6, decalLift: 0.12 });
    const w = liquidBakeOptions('water', { water: { shore: { color: '#c9b48c', width: 3, softness: 0.6 }, taper: 20 } });
    expect(w.decalReach).toBeCloseTo(4.2);
    expect(w.taper).toBe(20);
  });
});

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

describe('far field (C6)', () => {
  it('a closed annulus around the domain, tucked under the edge, facing up, sinking outwards', () => {
    const field = createTerrainField(biome('yeonmu'));
    const geo = buildFarSkirt(field, field.seed);
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const half = field.size / 2;
    let up = 0;
    let innerOk = 0;
    let inner = 0;
    let outerLower = 0;
    let outer = 0;
    const K = 12;
    for (let v = 0; v < pos.count; v++) {
      if (nrm.getY(v) > 0) up++;
      const k = v % K;
      if (k === 0) {
        inner++;
        const x = pos.getX(v);
        const z = pos.getZ(v);
        const edge = field.bedHeightAt(Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, z)));
        if (Math.abs(pos.getY(v) - (edge - 0.4)) < 1e-3) innerOk++;
      }
      if (k === K - 1) {
        outer++;
        if (pos.getY(v) < pos.getY(v - (K - 1))) outerLower++;
      }
    }
    expect(up / pos.count).toBeGreaterThan(0.95);
    expect(innerOk).toBe(inner);
    expect(outerLower / outer).toBeGreaterThan(0.9);
    const bb = geo.boundingBox;
    expect(bb?.max.x).toBeGreaterThan(half + 300);
    expect(bb?.min.z).toBeLessThan(-half - 300);
  }, 20000);
});

describe('river profile (C3, world/shapes.ts)', () => {
  it('deep core, shallow sand shelf, soft dry bank, never negative', () => {
    const w = 8;
    expect(riverProfile(0, w, 4, 3)).toBeCloseTo(1.6);
    // on the shelf (inside the bank top) the water is shallow
    const shelf = riverProfile(w - 1.5, w, 4, 3);
    expect(shelf).toBeGreaterThan(0.05);
    expect(shelf).toBeLessThan(0.45);
    expect(riverProfile(w + 4.1, w, 4, 3)).toBe(0);
    let prev = Infinity;
    for (let d = 0; d <= w + 5; d += 0.25) {
      const v = riverProfile(d, w, 4, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(riverProfile(-3, w, 4, 3)).toBe(riverProfile(3, w, 4, 3));
  });

  it('noise-varied width is deterministic, bounded and actually varies', () => {
    const a: number[] = [];
    for (let s = 0; s < 300; s += 5) a.push(riverWidth(s, 6, 0.4, 60, 1234));
    const b: number[] = [];
    for (let s = 0; s < 300; s += 5) b.push(riverWidth(s, 6, 0.4, 60, 1234));
    expect(b).toEqual(a);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(6 * 0.35);
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.8);
  });
});

// PL-03a: the run light arc reaches the terrain through uniforms only (no define, no new program): the pool gain is the shared
// atmosphere uniform, the shadow tint / fill and the medallion glow are written into the material's own uniforms.
describe('run light arc plumbing (PL-03a)', () => {
  const arcLayout = layout();
  const mk = (look: ZoneLook): ReturnType<typeof createTerrainMaterial> =>
    createTerrainMaterial({
      layers: { layers: 2, albedo: null, normal: null, size: 8 } as never,
      splat0: null as never,
      splat1: null as never,
      noise: null as never,
      light: null as never,
      pools: null as never,
      layout: arcLayout,
      look,
      sealAt: null,
      size: 256,
      medallion: {} as never,
      medallionAt: { x: 0, z: 0 },
    });
  interface FakeShader {
    uniforms: Record<string, { value: never }>;
    vertexShader: string;
    fragmentShader: string;
  }
  /** what three hands onBeforeCompile, reduced to the markers the patch looks for */
  const compile = (m: ReturnType<typeof createTerrainMaterial>): FakeShader => {
    const s: FakeShader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>\n#include <fog_vertex>\nvoid main() {}',
      fragmentShader: 'void main() {\n#include <map_fragment>\n#include <emissivemap_fragment>\n}',
    };
    (m.material.onBeforeCompile as (sh: never, r: never) => void)(s as never, null as never);
    return s;
  };
  const glowLook = (emissive: number | undefined): ZoneLook => {
    const l = plainLook();
    l.medallion = { tex: 'tex_x', radius: 8, emissive } as NonNullable<ZoneLook['medallion']>;
    return l;
  };

  it('adds no define and no program: the same feature set, the same program cache key, the pool gain is a uniform', () => {
    const look = glowLook(0.3);
    const m = mk(look);
    expect(Object.keys(m.material.defines as object).sort()).toEqual(['LAYERS', 'Q_ANTITILE', 'Q_DECOR', ...Object.keys(terrainDefines(look, arcLayout))].sort());
    expect(m.material.customProgramCacheKey()).toBe('terrain-splat-2');
    const s = compile(m);
    expect(s.fragmentShader).toContain('uniform float uPoolGain;');
    expect(s.fragmentShader).toContain('gEmissive += alb * pl.rgb * (2.0 * flick * uPoolGain);');
    // the shared object: one write per frame reaches the terrain (and any later material that wants the gain)
    expect(s.uniforms.uPoolGain).toBe(atmosphereUniforms.uPoolGain);
    expect(atmosphereUniforms.uPoolGain.value).toBe(1);
    m.dispose();
  });

  it('setArc: uMedalB.z = MedallionSpec.emissive + the glow, clamped to 1; the shadow fill follows; null restores the look', () => {
    const look = glowLook(0.3);
    look.fill = { ...look.fill, shadowTint: '#102030', shadowFill: 0.12 };
    const m = mk(look);
    const u = compile(m).uniforms as unknown as { uMedalB: { value: Vector4 }; uShadowTint: { value: Vector3 }; uShadowParams: { value: Vector3 } };
    expect(u.uMedalB.value.z).toBeCloseTo(0.3, 10);
    const tint = new Color('#4a6890');
    m.setArc({ shadowTint: tint, shadowFill: 0.4, medallionGlow: 0.35 });
    expect(u.uMedalB.value.z).toBeCloseTo(0.65, 10);
    expect(u.uShadowParams.value.x).toBeCloseTo(0.4, 10);
    expect([u.uShadowTint.value.x, u.uShadowTint.value.y, u.uShadowTint.value.z]).toEqual([tint.r, tint.g, tint.b]);
    // the rest of the medallion / shadow vectors are untouched
    expect(u.uShadowParams.value.y).toBe(look.shadow.baked);
    expect(u.uMedalB.value.x).toBe(1);
    m.setArc({ shadowTint: tint, shadowFill: 0.4, medallionGlow: 0.9 });
    expect(u.uMedalB.value.z).toBe(1);
    m.setArc(null);
    const base = new Color('#102030');
    expect(u.uMedalB.value.z).toBeCloseTo(0.3, 10);
    expect(u.uShadowParams.value.x).toBeCloseTo(0.12, 10);
    expect([u.uShadowTint.value.x, u.uShadowTint.value.y, u.uShadowTint.value.z]).toEqual([base.r, base.g, base.b]);
    m.dispose();
  });

  it('a medallion with no emissive of its own still glows with the arc (0 + glow)', () => {
    const m = mk(glowLook(undefined));
    const u = compile(m).uniforms as unknown as { uMedalB: { value: Vector4 } };
    expect(u.uMedalB.value.z).toBe(0);
    m.setArc({ shadowTint: new Color(), shadowFill: 0, medallionGlow: 0.35 });
    expect(u.uMedalB.value.z).toBeCloseTo(0.35, 10);
    m.dispose();
  });

  it('setTerrainArc reaches the live material, a material built later starts from the pushed state, dispose forgets it', () => {
    const tint = new Color('#4a6890');
    const a = mk(glowLook(0.1));
    const ua = compile(a).uniforms as unknown as { uMedalB: { value: Vector4 } };
    setTerrainArc({ shadowTint: tint, shadowFill: 0.2, medallionGlow: 0.5 });
    expect(ua.uMedalB.value.z).toBeCloseTo(0.6, 10);
    // the terrain builds a new material (a layer rebuild): it starts on the arc, not on the look
    const b = mk(glowLook(0.1));
    a.dispose();
    const ub = compile(b).uniforms as unknown as { uMedalB: { value: Vector4 }; uShadowParams: { value: Vector3 } };
    expect(ub.uMedalB.value.z).toBeCloseTo(0.6, 10);
    expect(ub.uShadowParams.value.x).toBeCloseTo(0.2, 10);
    setTerrainArc(null);
    expect(ub.uMedalB.value.z).toBeCloseTo(0.1, 10);
    b.dispose();
    // a disposed material is not driven any more, and a new one after a null starts on its look
    setTerrainArc({ shadowTint: tint, shadowFill: 0.2, medallionGlow: 0.5 });
    expect(ub.uMedalB.value.z).toBeCloseTo(0.1, 10);
    setTerrainArc(null);
    const c = mk(glowLook(0.1));
    const uc = compile(c).uniforms as unknown as { uMedalB: { value: Vector4 } };
    expect(uc.uMedalB.value.z).toBeCloseTo(0.1, 10);
    c.dispose();
  });

  it('atmosphere: configureAtmosphere resets the pool gain, applyArcAtmosphere writes haze colour / depth / mist and the gain', () => {
    const look = lookFor('yeonmu');
    configureAtmosphere(look);
    expect(atmosphereUniforms.uPoolGain.value).toBe(1);
    const h0 = atmosphereUniforms.uHaze.value.clone();
    const c0 = atmosphereUniforms.uHazeColor.value.clone();
    applyArcAtmosphere({ color: new Color('#b8566a'), depth: 0.6, mist: 0.3 }, 3);
    expect(atmosphereUniforms.uPoolGain.value).toBe(3);
    expect(atmosphereUniforms.uHaze.value.x).toBeCloseTo(0.6, 10);
    expect(atmosphereUniforms.uHaze.value.w).toBeCloseTo(0.3, 10);
    // range / camera distance are not the arc's
    expect(atmosphereUniforms.uHaze.value.y).toBe(h0.y);
    expect(atmosphereUniforms.uHaze.value.z).toBe(h0.z);
    expect(atmosphereUniforms.uHazeColor.value.equals(c0)).toBe(false);
    configureAtmosphere(look);
    expect(atmosphereUniforms.uPoolGain.value).toBe(1);
    expect(atmosphereUniforms.uHaze.value.x).toBeCloseTo(look.haze?.depth ?? 0, 10);
    expect(atmosphereUniforms.uHaze.value.w).toBeCloseTo(look.haze?.mist ?? 0, 10);
    expect(atmosphereUniforms.uHazeColor.value.equals(c0)).toBe(true);
  });
});
