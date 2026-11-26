import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../../data/schema';
import { createTerrainField } from '../../../world/terrainField';
import { bakeLiquid } from './bake';
import { liquidBakeOptions } from './index';

// zones core B2: the shore decal is draped over the terrain mesh. It must split every quad along the terrain's own diagonal
// (a to d), otherwise the two surfaces differ over twisted quads and half a decal quad sinks into the ground (the stray dark
// parallelograms next to bridge ends).
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

/** largest height (m) a decal triangle's centroid stands above / below the terrain mesh surface at that point, minus the lift */
function worstDeviation(field: ReturnType<typeof createTerrainField>, pos: Float32Array, idx: Uint32Array, lift: number): number {
  let worst = 0;
  for (let t = 0; t < idx.length; t += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let c = 0; c < 3; c++) {
      const v = (idx[t + c] as number) * 3;
      cx += pos[v] as number;
      cy += pos[v + 1] as number;
      cz += pos[v + 2] as number;
    }
    cx /= 3;
    cy /= 3;
    cz /= 3;
    const d = Math.abs(cy - lift - field.bedHeightAt(cx, cz));
    if (d > worst) worst = d;
  }
  return worst;
}

describe('liquid decal triangulation (B2)', () => {
  const field = createTerrainField(biome('yeonmu'));
  const level = field.layout.liquid?.level ?? 0;
  const opts = liquidBakeOptions('water', undefined);

  it('lies on the terrain mesh: its triangles are coplanar with the terrain triangles under them', () => {
    const bake = bakeLiquid(field, level, opts);
    expect(bake).not.toBeNull();
    const decal = (bake as NonNullable<typeof bake>).decal;
    expect(decal.index.length).toBeGreaterThan(600);
    // terrain triangles split a-d, so the decal surface IS the terrain surface lifted by decalLift (sub-millimetre)
    expect(worstDeviation(field, decal.positions, decal.index, opts.decalLift)).toBeLessThan(2e-3);
  });

  it('the pre-B2 split cut through the ground on twisted quads (what legacySplit keeps for before / after pairs)', () => {
    const bake = bakeLiquid(field, level, { ...opts, legacySplit: true });
    const decal = (bake as NonNullable<typeof bake>).decal;
    expect(worstDeviation(field, decal.positions, decal.index, opts.decalLift)).toBeGreaterThan(0.05);
  });

  it('the draped split is (a, d, b) (a, c, d) per quad, the surface keeps its old split', () => {
    const bake = bakeLiquid(field, level, opts) as NonNullable<ReturnType<typeof bakeLiquid>>;
    const q = 8; // TILE quads per decal tile edge
    const a = 0;
    // first quad of the first tile
    expect(Array.from(bake.decal.index.slice(0, 6))).toEqual([a, a + q + 2, a + 1, a, a + q + 1, a + q + 2]);
    // the flat liquid surface did not change
    const sq = bake.surface.index;
    expect(sq.length).toBeGreaterThan(0);
    const s0 = Array.from(sq.slice(0, 6));
    const b0 = s0[0] as number;
    const quads = (liquidBakeOptions('water', undefined).surfaceQuads as number) || 1;
    expect(s0).toEqual([b0, b0 + quads + 1, b0 + 1, b0 + 1, b0 + quads + 1, b0 + quads + 2]);
  });
});
