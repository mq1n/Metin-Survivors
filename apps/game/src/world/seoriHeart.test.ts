// ROCK-01-redo (S-CRYSTAL-06): the 8.5 m crystal heart of Seori's ice-spire field stands in every run. Its forced sc.rock call used to
// fall to the free test (rock() does not skip the hero-spot reservation that prop() skips), so the heart never spawned and the
// 'crystals' stills showed only the glacier-prop shards. It is now appended at the end of the scatter, straight into the layout, so
// nothing placed before it moves (no sc.rng draw), with the blocker rock() would have added; the QA 'crystals' hero spot moved 6 m south.
import { afterAll, describe, expect, it } from 'vitest';
import zonesJson from '../data/content/zones.json';
import type { BiomePreset, ZoneDef } from '../data/schema';
import { bakePools, POOL_RES } from '../render/terrain/bakePools';
import { clearTerrainFieldCache, createTerrainField, type TerrainField } from './terrainField';

const biome = ((zonesJson as unknown as ZoneDef[]).find((z) => z.id === 'seori') as ZoneDef).biome as BiomePreset;
const hearts = (f: TerrainField) => f.layout.rocks.filter((r) => r.kind === 'crystal' && r.sy >= 8);

afterAll(() => clearTerrainFieldCache());

describe('seori crystal heart', () => {
  for (const seed of [undefined, 77] as const) {
    it(`stands at the centre of the spire field and blocks (seed ${seed ?? 'zone'})`, () => {
      clearTerrainFieldCache();
      const f = seed === undefined ? createTerrainField(biome) : createTerrainField(biome, seed);
      const h = hearts(f);
      expect(h.length).toBe(1);
      const heart = h[0]!;
      expect([heart.x, heart.z]).toEqual([92, 92]);
      expect(heart.sy).toBe(8.5);
      // the ice material of the zone ('tex_ice_blue' = the 'ice' crystal style), appended last: nothing placed before it moved
      expect(f.layout.rockMaterials[heart.mat]).toBe('tex_ice_blue');
      expect(f.layout.rocks[f.layout.rocks.length - 1]).toBe(heart);
      // it blocks like any rock of its size: a collision circle of 0.82 x half its footprint
      const hit: number[] = [];
      f.blockersNear(92, 92, 0.5, (b) => {
        if (b.kind === 'rock' && b.x === 92 && b.z === 92) hit.push(b.r);
      });
      expect(hit.length).toBe(1);
      expect(hit[0]).toBeCloseTo(Math.max(heart.sx, heart.sz) * 0.5 * 0.82, 6);
      expect(f.walkable(92, 92)).toBe(false);
      expect(f.walkable(92, 92 + 4)).toBe(true);
      
      expect(f.walkable(92, 98)).toBe(true);
      // the ring round it (spires at r 13, gaps south and north) is still there
      const ring = f.layout.rocks.filter((r) => r.kind === 'spire' && Math.abs(Math.hypot(r.x - 92, r.z - 92) - 13) < 2.5);
      expect(ring.length).toBeGreaterThanOrEqual(5);
    }, 90_000);
  }

  it("lights the ground through pools['rock:crystal'] and bakes the same texture without it", () => {
    clearTerrainFieldCache();
    const f = createTerrainField(biome);
    const pool = { 'rock:crystal': { color: '#7fc4ff', intensity: 0.9, radius: 1.6 } };
    const lit = bakePools(f, pool);
    const dark = bakePools(f, {});
    const texel = f.size / POOL_RES;
    const at = (data: Uint8Array, x: number, z: number): number => {
      const i = Math.floor((x + f.size / 2) / texel);
      const j = Math.floor((z + f.size / 2) / texel);
      const o = (j * POOL_RES + i) * 4;
      return (data[o] as number) + (data[o + 1] as number) + (data[o + 2] as number);
    };
    // radius 1.6 x the 4.6 m footprint = 7.4 m round the heart: lit 5 m out (and 6 m out is the QA hero spot), dark 9 m out
    expect(at(lit, 92 + 5, 92)).toBeGreaterThan(0);
    expect(at(dark, 92 + 5, 92)).toBe(0);
    expect(at(lit, 92, 92 + 9)).toBeGreaterThanOrEqual(0);
    expect(at(lit, 92 - 40, 92 - 40)).toBe(at(dark, 92 - 40, 92 - 40));
  }, 90_000);
});
