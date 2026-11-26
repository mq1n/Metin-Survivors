// ZoneMap (UI core C14): the raster is deterministic and DOM-free, the world frame matches the game camera, the HUD helpers
// map a HudSnapshot onto pips. The pixel numbers here are structural (no golden image): relief, water and objects must show.
import { describe, expect, it } from 'vitest';
import zones from '../../data/content/zones.json';
import type { ZoneDef } from '../../data/schema';
import { createTerrainField } from '../../world/terrainField';
import { headingOf, hudPips } from './ZoneMap';
import { rasterToWorld, renderZoneMap, texColour } from './zoneMapRender';
import { ringMarkup, roseMarkup, PIP_DEFS } from './zoneMapArt';
import { zoneMapKey } from './zoneMapLoader';

const defs = zones as unknown as ZoneDef[];
const yeonmu = defs.find((z) => z.id === 'yeonmu') as ZoneDef;

describe('renderZoneMap', () => {
  const field = createTerrainField(yeonmu.biome);
  field.paint();
  const opts = { res: 160, style: 'atlas' as const, water: yeonmu.biome.water?.color };

  it('is byte-identical on repeat and opaque', () => {
    const a = renderZoneMap(field, opts);
    const b = renderZoneMap(field, opts);
    expect(b.hash).toBe(a.hash);
    expect(a.rgba.length).toBe(160 * 160 * 4);
    let alphaOk = true;
    for (let i = 3; i < a.rgba.length; i += 4) if (a.rgba[i] !== 255) alphaOk = false;
    expect(alphaOk).toBe(true);
  });

  it('differs between styles and with objects off', () => {
    const atlas = renderZoneMap(field, opts);
    expect(renderZoneMap(field, { ...opts, style: 'minimap' }).hash).not.toBe(atlas.hash);
    expect(renderZoneMap(field, { ...opts, objects: false }).hash).not.toBe(atlas.hash);
  });

  it('covers the arena plus a margin, centred on the origin', () => {
    const r = renderZoneMap(field, opts);
    expect(r.span).toBeCloseTo((field.arenaRadius + 30) * 2, 6);
    const mid = rasterToWorld(r, 80, 80);
    expect(Math.abs(mid.x)).toBeLessThan(1e-6);
    expect(Math.abs(mid.z)).toBeLessThan(1e-6);
    // screen up = world -z: row 0 is the north edge
    expect(rasterToWorld(r, 0, 0)).toEqual({ x: -r.span / 2, z: -r.span / 2 });
  });

  it('paints water where the field has water (cool grey-teal), not warm ground colour', () => {
    const res = 256;
    const r = renderZoneMap(field, { ...opts, res, objects: false });
    const liquid = field.layout.liquid;
    expect(liquid?.kind).toBe('water');
    const { n, bed } = field.grid;
    const half = field.size / 2;
    let checked = 0;
    for (let j = 0; j < n && checked < 40; j += 5) {
      for (let i = 0; i < n && checked < 40; i += 5) {
        const x = -half + i;
        const z = -half + j;
        if ((liquid?.level ?? 0) - (bed[j * n + i] as number) > 2 && field.insideBy(x, z) > 8) {
          const px = Math.floor(((x - r.x0) / r.span) * res);
          const py = Math.floor(((z - r.z0) / r.span) * res);
          const o = (py * res + px) * 4;
          expect(r.rgba[o + 2] as number).toBeGreaterThanOrEqual(r.rgba[o] as number); // blue >= red
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe('helpers', () => {
  it('texColour knows shipped textures and guesses the rest', () => {
    expect(texColour('tex_grass_a')).toBe('#508038');
    expect(texColour('tex_unknown_lava_flow')).toBe('#7a3a26');
  });

  it('maps a HudSnapshot onto pips (metins always, boss only while alive)', () => {
    const pips = hudPips({
      metins: [
        { id: 4, x: 10, z: -3, awakened: true, hpFrac: 1, rune: '#fff' },
        { id: 5, x: -8, z: 2, awakened: false, hpFrac: 0.2, rune: '#fff' },
      ],
      boss: { id: 'tiger', hp: 100, hpMax: 200, phase: 1, enraged: false, final: false, x: 30, z: 40 },
    });
    expect(pips.map((p) => p.kind)).toEqual(['metin', 'metin', 'boss']);
    expect(pips[0]).toMatchObject({ x: 10, z: -3, awakened: true, id: 'm4' });
    expect(hudPips({ metins: [], boss: { id: 'x', hp: 0, hpMax: 10, phase: 0, enraged: false, final: false, x: 0, z: 0 } })).toEqual([]);
  });

  it('headings are clockwise from north (screen up = -z)', () => {
    expect(headingOf(0, -1)).toBeCloseTo(0, 6);
    expect(headingOf(1, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(headingOf(0, 1)).toBeCloseTo(Math.PI, 6);
    expect(headingOf(-1, 0)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('cache keys separate seed, style, res and preset', () => {
    const base = zoneMapKey(yeonmu.biome, { style: 'minimap', res: 1024 });
    expect(zoneMapKey(yeonmu.biome, { style: 'minimap', res: 1024 })).toBe(base);
    expect(zoneMapKey(yeonmu.biome, { style: 'atlas', res: 1024 })).not.toBe(base);
    expect(zoneMapKey(yeonmu.biome, { style: 'minimap', res: 512 })).not.toBe(base);
    expect(zoneMapKey(yeonmu.biome, { style: 'minimap', res: 1024, seed: 7 })).not.toBe(base);
    expect(zoneMapKey({ ...yeonmu.biome, ground: [...yeonmu.biome.ground, 'tex_ash'] }, { style: 'minimap', res: 1024 })).not.toBe(base);
  });
});

describe('vector art', () => {
  it('builds the ring once with four counter-rotated cuffs and the full pip set', () => {
    const ring = ringMarkup();
    expect(ringMarkup()).toBe(ring);
    for (const phi of [0, 90, 180, 270]) expect(ring).toContain(`id="zm-cf${phi}"`);
    expect(ring.length).toBeGreaterThan(10000);
    expect(roseMarkup()).toContain('zm-rose-gold');
    for (const kind of ['hero', 'ally', 'metin', 'boss', 'chest', 'start', 'heart', 'arena', 'poi', 'rim']) expect(PIP_DEFS).toContain(`id="zm-p-${kind}"`);
  });
});
