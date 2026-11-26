// The liquid's white `uLight` stand-in (a 1 x 1 DataTexture bound until the terrain has baked its light map) is a GL texture of its
// own: it has to be released when the real map takes its place and when the system goes (prod4 runtime-memory-net: the menu's
// renderer.info.memory.textures grew by one per menu -> run -> quit cycle in every zone whose liquidLook has `shade`).
import { Color, DataTexture, RGBAFormat, UnsignedByteType, type Mesh, type PerspectiveCamera, type ShaderMaterial, type Texture, type Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../../data/schema';
import { createTerrainField } from '../../../world/terrainField';
import type { QualityProfile } from '../../quality';
import { bakedLightRef } from '../bakedLightRef';
import type { ZoneContext } from '../zoneContext';
import { createLiquid } from './index';

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

function setup() {
  const b = biome('yeonmu'); // liquidLook.shade = 1, a river: the stand-in path
  const field = createTerrainField(b);
  const ctx = {
    core: { env: { sun: { color: new Color('#ffffff'), intensity: 1 }, hemi: { color: new Color('#aaaaaa'), intensity: 1 } } },
    assets: {},
    field,
    biome: b,
    quality: { tier: 'medium' } as QualityProfile,
  } as unknown as ZoneContext;
  const sys = createLiquid(ctx);
  if (!sys) throw new Error('yeonmu has a liquid');
  const surface = sys.group.children[0] as Mesh;
  const uLight = (): Texture => (surface.material as ShaderMaterial).uniforms.uLight!.value as Texture;
  const disposed = new Map<Texture, number>();
  const watch = (t: Texture): void => {
    t.addEventListener('dispose', () => disposed.set(t, (disposed.get(t) ?? 0) + 1));
  };
  const step = (): void => sys.update(1 / 60, {} as PerspectiveCamera, {} as Vector3);
  return { field, sys, uLight, disposed, watch, step };
}

describe('liquid light-map stand-in', () => {
  it('is released when the baked light map takes its place, and not again on dispose', () => {
    const { field, sys, uLight, disposed, watch, step } = setup();
    const standIn = uLight();
    expect((standIn.image as { width: number }).width).toBe(1); // the 1 x 1 white placeholder
    watch(standIn);
    step();
    expect(uLight()).toBe(standIn); // no baked map yet: still bound, not disposed
    expect(disposed.get(standIn) ?? 0).toBe(0);
    const real = new DataTexture(new Uint8Array(16), 2, 2, RGBAFormat, UnsignedByteType);
    watch(real);
    bakedLightRef(field).tex = real;
    step();
    expect(uLight()).toBe(real);
    expect(disposed.get(standIn)).toBe(1);
    step();
    sys.dispose();
    expect(disposed.get(standIn)).toBe(1); // once
    expect(disposed.get(real) ?? 0).toBe(0); // the terrain owns the baked map
    bakedLightRef(field).tex = null;
  });

  it('is released by dispose() when the light map never came', () => {
    const { sys, uLight, disposed, watch } = setup();
    const standIn = uLight();
    watch(standIn);
    sys.dispose();
    expect(disposed.get(standIn)).toBe(1);
  });
});
