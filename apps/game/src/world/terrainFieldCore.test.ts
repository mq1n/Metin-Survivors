// Zones core A1 (finer ground paint) and A4 (exact bridge deck height) of the terrain field, on the four shipped zones.
import { describe, expect, it } from 'vitest';
import zones from '../data/content/zones.json';
import type { BiomePreset } from '../data/schema';
import { archHeight } from './shapes';
import { clearTerrainFieldCache, createTerrainField, normalisePaintRes, paintRefineStats, type PaintMaps, type TerrainField } from './terrainField';

const BIOMES = new Map<string, BiomePreset>((zones as unknown as Array<{ id: string; biome: BiomePreset }>).map((z) => [z.id, z.biome]));
const biome = (id: string): BiomePreset => BIOMES.get(id) as BiomePreset;
const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

function checksum(p: PaintMaps): number {
  let h = 2166136261;
  for (let i = 0; i < p.w0.length; i += 7) {
    h ^= (p.w0[i] as number) | ((p.w1[i] as number) << 8);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

describe('normalisePaintRes (the 512 * 2^k ladder)', () => {
  it('snaps down to the ladder and defaults to the legacy 512', () => {
    expect(normalisePaintRes(undefined)).toBe(512);
    expect(normalisePaintRes(Number.NaN)).toBe(512);
    expect(normalisePaintRes(100)).toBe(512);
    expect(normalisePaintRes(512)).toBe(512);
    expect(normalisePaintRes(700)).toBe(512);
    expect(normalisePaintRes(1024)).toBe(1024);
    expect(normalisePaintRes(1500)).toBe(1024);
    expect(normalisePaintRes(2048)).toBe(2048);
    expect(normalisePaintRes(99999)).toBe(2048);
  });
});

/** a field with the A1 knob switched on (the settle turned it off in the four shipped recipes: no visible gain for +14 MB per zone) */
function fineField(id: string): TerrainField {
  clearTerrainFieldCache();
  const f = createTerrainField(biome(id)) as TerrainField & { paintRes: number };
  Object.defineProperty(f, 'paintRes', { value: 1024, configurable: true, writable: true });
  return f;
}

describe('A1: the shipped zones keep the legacy 1 m paint (knob off after the settle)', () => {
  for (const id of ZONES) {
    it(`${id}: paintRes 512, paintFine() is paint()`, () => {
      clearTerrainFieldCache();
      const f = createTerrainField(biome(id));
      expect(f.paintRes).toBe(512);
      expect(f.paintFine()).toBe(f.paint());
    }, 60_000);
  }
});

describe('A1: ground paint at 0.5 m texels (knob on)', () => {
  for (const id of ZONES) {
    it(`${id}: paintRes 1024, weights sum to 255, finer than the legacy map and consistent with it`, () => {
      const f = fineField(id);
      expect(f.paintRes).toBe(1024);
      const coarse = f.paint();
      expect(coarse.res).toBe(512);
      const fine = f.paintFine();
      expect(fine.res).toBe(1024);
      expect(fine.texel).toBeCloseTo(f.size / 1024, 6);
      expect(fine.w0.length).toBe(1024 * 1024 * 4);
      for (let t = 0; t < 1024 * 1024; t += 97) {
        const o = t * 4;
        const sum = (fine.w0[o] as number) + (fine.w0[o + 1] as number) + (fine.w0[o + 2] as number) + (fine.w0[o + 3] as number) + (fine.w1[o] as number) + (fine.w1[o + 1] as number) + (fine.w1[o + 2] as number) + (fine.w1[o + 3] as number);
        expect(sum).toBe(255);
      }
      expect(f.paintFine()).toBe(fine); // cached
      expect(f.paint()).toBe(coarse);
      // the mean of the four children of a coarse texel is the coarse texel (the finer map only adds detail): average |diff| per layer weight
      let diff = 0;
      let n = 0;
      for (let j = 0; j < 512; j += 3) {
        for (let i = 0; i < 512; i += 3) {
          const c = (j * 512 + i) * 4;
          for (let k = 0; k < 4; k++) {
            let a0 = 0;
            let a1 = 0;
            for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
              const o = ((2 * j + dj) * 1024 + 2 * i + di) * 4 + k;
              a0 += fine.w0[o] as number;
              a1 += fine.w1[o] as number;
            }
            diff += Math.abs(a0 / 4 - (coarse.w0[c + k] as number)) + Math.abs(a1 / 4 - (coarse.w1[c + k] as number));
            n += 2;
          }
        }
      }
      expect(diff / n).toBeLessThan(2.5);
      // the bake only evaluated part of the child texels
      expect(paintRefineStats.evaluated).toBeGreaterThan(0);
      expect(paintRefineStats.interpolated).toBeGreaterThan(0);
    }, 120_000);
  }

  it('is deterministic and the sliced async bake gives the same maps', async () => {
    const a = fineField('daeryeol');
    const sync = a.paintFine();
    const b = fineField('daeryeol');
    const sliced = await b.paintFineAsync(0.4);
    expect(sliced.res).toBe(1024);
    expect(checksum(sliced)).toBe(checksum(sync));
    expect(Buffer.compare(Buffer.from(sliced.w0), Buffer.from(sync.w0))).toBe(0);
    expect(Buffer.compare(Buffer.from(sliced.w1), Buffer.from(sync.w1))).toBe(0);
    expect(await b.paintFineAsync()).toBe(sliced);
  }, 120_000);

  it('a field without the knob (512) keeps the legacy maps: paintFine() is paint()', async () => {
    clearTerrainFieldCache();
    const f = createTerrainField(biome('seori')) as TerrainField & { paintRes: number };
    Object.defineProperty(f, 'paintRes', { value: 512, configurable: true });
    expect(f.paintFine()).toBe(f.paint());
    expect(await f.paintFineAsync()).toBe(f.paint());
    expect(f.paint().res).toBe(512);
  }, 60_000);
});

describe('A4: bridge decks are exact under heightAt', () => {
  for (const id of ['yeonmu', 'suryeon', 'daeryeol']) {
    it(`${id}: the deck strip is at the arch height everywhere, nodes and far ground are the grid`, () => {
      clearTerrainFieldCache();
      const f = createTerrainField(biome(id));
      const bridges = f.layout.bridges;
      expect(bridges.length).toBeGreaterThan(0);
      for (const b of bridges) {
        const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
        const ux = (b.x1 - b.x0) / len;
        const uz = (b.z1 - b.z0) / len;
        const hw = b.width * 0.5;
        for (let k = 0; k <= 20; k++) {
          const s = (k / 20) * len;
          const deck = archHeight(s / len, b.yEnd, b.yMid);
          for (const lat of [0, hw * 0.5, hw * 0.97, -hw * 0.97, hw * 0.999]) {
            const x = b.x0 + ux * s - uz * lat;
            const z = b.z0 + uz * s + ux * lat;
            // never below the deck inside the strip (a 1 m bilinear grid dips towards the bed there), and never far above it
            expect(f.heightAt(x, z)).toBeGreaterThanOrEqual(deck - 1e-4);
            expect(f.heightAt(x, z)).toBeLessThan(deck + 0.6);
          }
          // on the centre line the walkable height is the deck, or the ground where that rises above it (the bridge ends)
          const ground = f.bedHeightAt(b.x0 + ux * s, b.z0 + uz * s);
          expect(f.heightAt(b.x0 + ux * s, b.z0 + uz * s)).toBeGreaterThanOrEqual(Math.max(deck, ground) - 1e-3);
        }
      }
      // at the grid nodes (anywhere) heightAt is the grid: the closed form agrees with the baked deck, nothing else changed
      const g = f.grid;
      let worst = 0;
      for (let t = 0; t < 4000; t++) {
        const i = (t * 37) % g.n;
        const j = (t * 61 + 13) % g.n;
        const x = -f.size / 2 + i * g.cell;
        const z = -f.size / 2 + j * g.cell;
        worst = Math.max(worst, Math.abs(f.heightAt(x, z) - (g.heights[j * g.n + i] as number)));
      }
      expect(worst).toBeLessThan(1e-4);
    }, 120_000);
  }

  it('the bilinear grid alone dips under the deck along the strip; the exact height (rings, decals, feet) does not', () => {
    // the 1 m grid holds the deck at its nodes only: between nodes (a diagonal strip's edge, the deck ends) it interpolates
    // towards the river bed. Measured against the grid sampled with the same triangulation as TerrainField.
    clearTerrainFieldCache();
    const f = createTerrainField(biome('yeonmu'));
    const g = f.grid;
    const gridAt = (x: number, z: number): number => {
      const u = x + f.size / 2;
      const v = z + f.size / 2;
      const i = Math.floor(u);
      const j = Math.floor(v);
      const fx = u - i;
      const fz = v - j;
      const o = j * g.n + i;
      const h00 = g.heights[o] as number;
      const h10 = g.heights[o + 1] as number;
      const h01 = g.heights[o + g.n] as number;
      const h11 = g.heights[o + g.n + 1] as number;
      return fx > fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    };
    let worstGrid = 0;
    let worstExact = 0;
    for (const b of f.layout.bridges) {
      const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
      const ux = (b.x1 - b.x0) / len;
      const uz = (b.z1 - b.z0) / len;
      const hw = b.width * 0.5;
      for (let k = 2; k < 100; k++) {
        const s = (k / 100) * len;
        for (const lat of [-hw * 0.9, hw * 0.9, hw * 0.5]) {
          const x = b.x0 + ux * s - uz * lat;
          const z = b.z0 + uz * s + ux * lat;
          const deck = archHeight(s / len, b.yEnd, b.yMid);
          worstGrid = Math.max(worstGrid, deck - gridAt(x, z));
          worstExact = Math.max(worstExact, deck - f.heightAt(x, z));
        }
      }
    }
    expect(worstGrid).toBeGreaterThan(0.02);
    expect(worstExact).toBeLessThan(1e-4);
  });

  it('a zone without bridges is untouched (no deck lookup at all)', () => {
    clearTerrainFieldCache();
    const f = createTerrainField(biome('seori'));
    expect(f.layout.bridges.length).toBe(0);
    const g = f.grid;
    const x = -f.size / 2 + 150.3;
    const z = -f.size / 2 + 200.6;
    const i = 150;
    const j = 200;
    const fx = 0.3;
    const fz = 0.6;
    const h00 = g.heights[j * g.n + i] as number;
    const h10 = g.heights[j * g.n + i + 1] as number;
    const h01 = g.heights[(j + 1) * g.n + i] as number;
    const h11 = g.heights[(j + 1) * g.n + i + 1] as number;
    const expected = fx > fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    expect(f.heightAt(x, z)).toBeCloseTo(expected, 4);
  });
});
