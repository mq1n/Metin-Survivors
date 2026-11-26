// r5 ship 10-29: PROP_DEFS flags read by the renderer and the placement rules every zone layout must keep.
import { describe, expect, it } from 'vitest';
import type { BiomePreset, ZoneDef } from '../data/schema';
import zonesJson from '../data/content/zones.json';
import { PROP_DEFS } from './props';
import { createTerrainField } from './terrainField';

describe('PROP_DEFS.occlude', () => {
  it('keeps the camera-facing banner out of the hero cut-out, buildings and tall props stay cut', () => {
    expect(PROP_DEFS.banner_pole?.occlude).toBe(false);
    for (const id of ['house_small', 'hall_tiled', 'pagoda_gate', 'stone_lantern', 'totem', 'obelisk']) expect(PROP_DEFS[id]?.occlude).not.toBe(false);
  });
  it('only uses the flag as an opt-out (true or absent = cut as before)', () => {
    for (const d of Object.values(PROP_DEFS)) expect(d.occlude === undefined || d.occlude === false).toBe(true);
  });
});

describe('PROP_DEFS.rimOnly', () => {
  it('marks the 10 m obsidian spire as a rim landmark', () => {
    expect(PROP_DEFS.obsidian_spire?.rimOnly).toBeGreaterThan(0.5);
    for (const d of Object.values(PROP_DEFS)) if (d.rimOnly !== undefined) expect(d.rimOnly).toBeLessThanOrEqual(1.2);
  });
  it('no zone layout places a rimOnly prop inside its rim', () => {
    const rim = Object.values(PROP_DEFS).filter((d) => d.rimOnly !== undefined);
    expect(rim.length).toBeGreaterThan(0);
    for (const z of zonesJson as unknown as ZoneDef[]) {
      const f = createTerrainField(z.biome as BiomePreset);
      for (const p of f.layout.props) {
        const lim = PROP_DEFS[p.id]?.rimOnly;
        if (lim === undefined) continue;
        expect(Math.hypot(p.x, p.z), `${z.id}: ${p.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(lim * f.arenaRadius - 1e-6);
      }
    }
  }, 60000);
});
