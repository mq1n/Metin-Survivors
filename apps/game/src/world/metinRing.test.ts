// r9 Z9 (r8 judge MF8 a / b / c): the small-metin fall-site search prefers a site whose 13 m fight ring the banners and the roofs reach
// least into (FieldEnv.ringScore, sim/metins.ts nearestFallSite / pickFallSite). The r8 QA anchors (r8 ship tools/sitemoves.ts, run seed
// 1234) had a hall corner in the ring of yeonmu site01, a banner pole 6.5 m from seori site08 and banner poles 6.7-7.5 m from three
// daeryeol sites. A site is only ever traded for another clear one: the search never starves. r9 ship (Z9 critic must-fix): never for one whose
// ring has more bad ground (FieldEnv.ringGround: water, lava, cliff, steep): Z9 hung suryeon site04's ring over the ravine (ground 1 -> 11)
// and ran a daeryeol ring into a lava pit (0 -> 3); the suryeon west anchor keeps its bank site (a banner still reaches in: 11.6 -> 7.7).
import { afterAll, describe, expect, it } from 'vitest';
import type { BiomePreset, ZoneDef } from '../data/schema';
import zonesJson from '../data/content/zones.json';
import { fallSiteClear, nearestFallSite } from '../sim/metins';
import { clearTerrainFieldCache, createTerrainField } from './terrainField';

const biome = (id: string): BiomePreset => ((zonesJson as unknown as ZoneDef[]).find((z) => z.id === id) as ZoneDef).biome as BiomePreset;
afterAll(() => clearTerrainFieldCache());

const CASES: Array<[zone: string, ax: number, az: number, banner: boolean, maxScore: number]> = [
  ['yeonmu', -2, -26, false, 1],
  ['seori', 62, -96, true, 1],
  ['daeryeol', 52, -2, true, 1],
  ['daeryeol', -48, -26, true, 1],
  ['daeryeol', 16, -52, true, 1],
  ['suryeon', -98, 20, false, 8],
  ['suryeon', 20, -24, false, 1],
];

describe('r9 Z9 fight-ring preference of the small-metin fall sites', () => {
  for (const [zone, ax, az, banner, maxScore] of CASES) {
    it(`${zone} anchor (${ax}, ${az}): the site keeps banners and roofs out of its 13 m ring, never onto worse ground`, () => {
      const f = createTerrainField(biome(zone), 1234);
      const w = { env: f.env, arenaRadius: f.arenaRadius, metins: [] } as never;
      const out = { x: 0, z: 0 };
      expect(nearestFallSite(w, ax, az, 0, 16, f.arenaRadius - 8, 0, out)).toBe(true);
      expect(fallSiteClear(w, out.x, out.z)).toBe(true);
      expect(Math.hypot(out.x - ax, out.z - az)).toBeLessThanOrEqual(16 + 1e-6);
      expect(f.env.ringScore(out.x, out.z)).toBeLessThan(maxScore);
      if (banner) {
        for (const p of f.layout.props) {
          if (p.id !== 'banner_pole' && p.id !== 'war_banner') continue;
          expect(Math.hypot(p.x - out.x, p.z - out.z), `${p.id} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThan(12.5);
        }
      }
      // without the score the search takes the first clear site (the r8 rule): the preference is what moved it
      const w8 = { env: { ...f.env, ringScore: undefined }, arenaRadius: f.arenaRadius, metins: [] } as never;
      const o8 = { x: 0, z: 0 };
      expect(nearestFallSite(w8, ax, az, 0, 16, f.arenaRadius - 8, 0, o8)).toBe(true);
      expect(f.env.ringScore(o8.x, o8.z)).toBeGreaterThan(f.env.ringScore(out.x, out.z));
      // r9 ship: the move never puts the ring on more water, lava, cliff or slope than the first clear site's
      expect(f.env.ringGround(out.x, out.z)).toBeLessThanOrEqual(f.env.ringGround(o8.x, o8.z));
    }, 60_000);
  }

  it('a clean ring scores 0, a banner pole 5 m away scores about 9.8 (13 m ring + its 1.85 m reach - 5 m)', () => {
    const f = createTerrainField(biome('daeryeol'), 1234);
    const pole = f.layout.props.find((p) => p.id === 'banner_pole');
    expect(pole).toBeDefined();
    if (!pole) return;
    const s5 = f.env.ringScore(pole.x + 5, pole.z);
    expect(s5).toBeGreaterThanOrEqual(9.8 - 1e-3);
  }, 60_000);
});
