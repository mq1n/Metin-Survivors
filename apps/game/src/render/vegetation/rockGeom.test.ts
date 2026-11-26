// Zones core A2 (core builder A): the rock meshes. The default meshes (no look.rocks relief / roughness) must stay exactly what
// they were before the zones core (golden hashes taken from the pre-core generator), the new `ledge` kind is a unit-box block,
// and the per-zone relief / roughness knobs change the mesh deterministically.
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import type { RockKind } from '../../world/layoutTypes';
import { generateRocks, ROCK_VARIANTS } from './rockGeom';

/** FNV-1a over the float bits of position / normal / colour and the index of every variant and LOD */
function meshHash(geos: readonly BufferGeometry[]): string {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  let h = 2166136261;
  const mix = (v: number): void => {
    h ^= v & 0xffffffff;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (const g of geos) {
    for (const name of ['position', 'normal', 'color']) {
      const a = g.getAttribute(name);
      if (!a) continue;
      for (let i = 0; i < a.array.length; i++) {
        f32[0] = a.array[i] as number;
        mix(u32[0] as number);
      }
    }
    const idx = g.getIndex();
    if (idx) for (let i = 0; i < idx.array.length; i++) mix(idx.array[i] as number);
  }
  return h.toString(16);
}

/** hashes of generateRocks(kind) taken from the generator as it was before the zones core A2 changes (START copy) */
const GOLDEN: Record<string, string> = {
  boulder: 'e3e4ac12',
  slab: '61a1170b',
  spire: 'a52dd92e',
  outcrop: '6e057f20',
  basalt: 'eb78c65d',
  crystal: 'db666bf1',
  pebbles: '69dc005f',
};

describe('rock meshes: defaults are the pre-core meshes', () => {
  for (const kind of Object.keys(GOLDEN) as RockKind[]) {
    it(`${kind}: bit-identical without knobs, with explicit defaults too`, () => {
      expect(meshHash(generateRocks(kind).geos)).toBe(GOLDEN[kind]);
      expect(meshHash(generateRocks(kind, { relief: 1, rough: 0 }).geos)).toBe(GOLDEN[kind]);
      expect(meshHash(generateRocks(kind, {}).geos)).toBe(GOLDEN[kind]);
    });
  }
});

describe('ledge (cliff block)', () => {
  const set = generateRocks('ledge');
  it('has every variant in two LODs, LOD1 lighter, all finite', () => {
    expect(set.geos.length).toBe(ROCK_VARIANTS * 2);
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      expect(set.tris[v * 2 + 1] as number).toBeLessThan(set.tris[v * 2] as number);
      expect(set.tris[v * 2] as number).toBeGreaterThan(300);
    }
    for (const g of set.geos) for (const a of g.getAttribute('position').array) expect(Number.isFinite(a)).toBe(true);
  });

  it('fits the unit box with a flat bottom (x, z in [-0.5, 0.5], y in [0, 1])', () => {
    for (const g of set.geos) {
      g.computeBoundingBox();
      const b = g.boundingBox as NonNullable<typeof g.boundingBox>;
      expect(b.min.y).toBeCloseTo(0, 4);
      expect(b.max.y).toBeCloseTo(1, 4);
      expect(b.min.x).toBeGreaterThanOrEqual(-0.5001);
      expect(b.max.x).toBeLessThanOrEqual(0.5001);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5001);
      expect(b.max.z).toBeLessThanOrEqual(0.5001);
    }
  });

  it('has more near-vertical faces than a boulder (the point of a cliff block)', () => {
    const steepShare = (kind: RockKind): number => {
      const g = generateRocks(kind).geos[0] as BufferGeometry;
      const n = g.getAttribute('normal');
      let steep = 0;
      for (let i = 0; i < n.count; i++) if (Math.abs(n.getY(i)) < 0.35) steep++;
      return steep / n.count;
    };
    expect(steepShare('ledge')).toBeGreaterThan(steepShare('boulder'));
  });

  it('differs from the outcrop it replaces on the rim', () => {
    expect(meshHash(set.geos)).not.toBe(GOLDEN.outcrop);
  });
});

describe('per-zone relief / roughness', () => {
  it('relief and roughness change the mesh, deterministically', () => {
    for (const kind of ['boulder', 'slab', 'outcrop', 'ledge'] as const) {
      const base = meshHash(generateRocks(kind).geos);
      const deep = meshHash(generateRocks(kind, { relief: 2 }).geos);
      const rough = meshHash(generateRocks(kind, { rough: 0.04 }).geos);
      expect(deep).not.toBe(base);
      expect(rough).not.toBe(base);
      expect(meshHash(generateRocks(kind, { relief: 2 }).geos)).toBe(deep);
      expect(meshHash(generateRocks(kind, { rough: 0.04 }).geos)).toBe(rough);
    }
  });

  it('the vertex count and indices stay those of the default (same lattice, only displaced)', () => {
    const a = generateRocks('boulder');
    const b = generateRocks('boulder', { relief: 2.5, rough: 0.06 });
    expect(b.tris).toEqual(a.tris);
  });

  it('absurd values are clamped to a finite, bounded mesh', () => {
    const g = generateRocks('boulder', { relief: 99, rough: 9 }).geos[0] as BufferGeometry;
    for (const v of g.getAttribute('position').array) expect(Number.isFinite(v)).toBe(true);
    g.computeBoundingBox();
    const b = g.boundingBox as NonNullable<typeof g.boundingBox>;
    expect(b.max.x - b.min.x).toBeLessThan(1.5);
  });
});
