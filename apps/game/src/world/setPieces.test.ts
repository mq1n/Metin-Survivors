// r8 Z8 (r7 judge MF2 / MF8): the zone set pieces stand in every run. Before r8 a forced put (a recipe's set piece, `prop(..., { force })`)
// still went through `isFree`, so the hero-spot and plaza discs laid first swallowed it: seori's ruined shrine, broken gate and both
// camps, suryeon's pagoda forecourt and camp tents, yeonmu's hall lights never spawned. Now the hero-spot reservations
// (`reserveSpot`) do not stop a forced put, the plaza is dressed before it is reserved, and the camps / yards retry a slot that meets an
// earlier body. This file pins it: every forced put of each zone is placed or placed a few metres along by its retry (one justified loss),
// the named set pieces exist on three run seeds, the QA spots stand clear of them, and the MF8 / MF9 placements hold their rules.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { BiomePreset, ZoneDef } from '../data/schema';
import zonesJson from '../data/content/zones.json';
import type { PropPlacement } from './layoutTypes';
import type { ScatterContext } from './recipe';
import { clearTerrainFieldCache, createTerrainField, type TerrainField } from './terrainField';
import { recipeFor } from './zones';
import { PROP_DEFS } from './props';

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;
type ZoneId = (typeof ZONES)[number];
const biome = (id: ZoneId): BiomePreset => ((zonesJson as unknown as ZoneDef[]).find((z) => z.id === id) as ZoneDef).biome as BiomePreset;
const field = (id: ZoneId, seed?: number): TerrainField => (seed === undefined ? createTerrainField(biome(id)) : createTerrainField(biome(id), seed));
const near = (f: TerrainField, id: string, x: number, z: number, r: number): PropPlacement[] => f.layout.props.filter((p) => p.id === id && Math.hypot(p.x - x, p.z - z) < r);

/**
 * Forced puts that may stay unplaced, with the reason (the r7 judge's rule: a drop that stays needs a written justification). Key: zone,
 * id and the attempt's position rounded to 0.1 m. None today: the slot searches (camp tents and racks, the forecourt ring, the hall
 * lights, the yard corners, daeryeol's gate standards) ask `sc.fits` before they put, so only a put that places is ever made.
 */
const JUSTIFIED: Record<string, string> = {};

afterAll(() => clearTerrainFieldCache());

describe('r8 Z8 forced set pieces (default run seed)', () => {
  for (const id of ZONES) {
    it(`${id}: every forced put is placed, or placed a few metres along by its retry, or justified`, () => {
      const recipe = recipeFor(id);
      const build = recipe.build;
      const failed: Array<{ id: string; x: number; z: number }> = [];
      let forced = 0;
      (recipe as { build: typeof build }).build = (ctx) => {
        const plan = build(ctx);
        const inner = plan.scatter;
        plan.scatter = (sc: ScatterContext) => {
          const prop = Object.getPrototypeOf(sc).prop as ScatterContext['prop'];
          sc.prop = function (this: ScatterContext, pid, x, z, yaw, scale, opts) {
            const r = prop.call(this, pid, x, z, yaw, scale, opts);
            if (opts?.force) {
              forced++;
              if (!r) failed.push({ id: pid, x, z });
            }
            return r;
          };
          inner(sc);
        };
        return plan;
      };
      let f: TerrainField;
      try {
        clearTerrainFieldCache();
        f = field(id);
      } finally {
        (recipe as { build: typeof build }).build = build;
        clearTerrainFieldCache();
      }
      expect(forced).toBeGreaterThan(50);
      // a failed attempt is covered when its retry placed the same id close by (tents 1.4-2.5 m, ring lights and racks <= 6 m)
      const covered = (d: { id: string; x: number; z: number }): boolean => near(f, d.id, d.x, d.z, d.id === 'stone_lantern' || d.id === 'weapon_rack' ? 6.5 : d.id === 'urn' ? 13 : 3.2).length > 0;
      const lost = failed.filter((d) => !covered(d)).map((d) => `${id} ${d.id} (${d.x.toFixed(1)}, ${d.z.toFixed(1)})`);
      expect(lost.filter((k) => !JUSTIFIED[k])).toEqual([]);
    }, 60_000);
  }
});

describe('r8 Z8 named set pieces on three run seeds', () => {
  for (const seed of [undefined, 11, 31337]) {
    it(`seori (seed ${seed ?? 'zone'}): the shrine rise, both camps and the frozen trees`, () => {
      const f = field('seori', seed);
      expect(near(f, 'ruined_shrine', 105.3, -96.4, 1).length).toBe(1);
      expect(near(f, 'broken_gate', 73.7, -85.4, 1).length).toBe(1);
      // the ring pillars round the shrine-local (3, 0), the four plague lanterns on the mire's rim; r8 ship: no urn on the shrine ice
      expect(near(f, 'ruin_pillar', 89.2, -91.1, 19).length).toBeGreaterThanOrEqual(6);
      expect(near(f, 'plague_brazier', 87.9, -98, 13).length).toBe(4);
      expect(near(f, 'urn', 101.2, -88.2, 1).length).toBe(0);
      // the pilgrim camp's fire and its crates / barrels; the south camp: fire, two snow yurts (r8 ship), a crate and a barrel inside the fence
      expect(near(f, 'bonfire', 21, -71, 1).length).toBe(1);
      expect(near(f, 'crate', 22, -72, 15).length + near(f, 'barrel', 22, -72, 15).length).toBe(3);
      expect(near(f, 'bonfire', -24, 108, 1).length).toBe(1);
      expect(near(f, 'yurt', -24, 108, 12.5).length).toBe(2);
      expect(near(f, 'orc_tent', -24, 108, 12.5).length).toBe(0);
      expect(near(f, 'crate', -24, 108, 12.5).length + near(f, 'barrel', -24, 108, 12.5).length).toBe(2);
      expect(f.layout.props.filter((p) => p.id === 'frozen_tree').length).toBeGreaterThanOrEqual(4);
    }, 60_000);

    it(`suryeon (seed ${seed ?? 'zone'}): the pagoda forecourt and the camps`, () => {
      const f = field('suryeon', seed);
      // the forecourt: a loose ring of 7-8 lights (one slot may fall in the gap towards the landing), two braziers, two steles
      expect(near(f, 'stone_lantern', 0, -125, 21.5).length).toBeGreaterThanOrEqual(7);
      expect(near(f, 'brazier', 0, -125, 22).length).toBe(2);
      expect(near(f, 'stele', 0, -125, 22).length).toBe(2);
      // camps (east 17 m, west 15 m, north 12.5 m): fire, totem, racks, tents, banner poles on the gate posts (r8 ship: the r8 Z8 war standards
      // lost all 6 camp frames to the banner_pole and were put back), no war standard
      for (const [cx, cz, r, racks, minTents] of [[128, 57, 17, 3, 6], [-118, 32, 15, 2, 5], [116, -98, 12.5, 1, 3]] as const) {
        expect(near(f, 'bonfire', cx, cz, 1).length, `fire ${cx}`).toBe(1);
        expect(near(f, 'totem', cx, cz, r).length, `totem ${cx}`).toBe(1);
        expect(near(f, 'weapon_rack', cx, cz, r).length, `racks ${cx}`).toBe(racks);
        expect(near(f, 'orc_tent', cx, cz, r).length, `tents ${cx}`).toBeGreaterThanOrEqual(minTents);
        expect(near(f, 'banner_pole', cx, cz, r + 3).length, `standards ${cx}`).toBeGreaterThanOrEqual(3);
        expect(near(f, 'war_banner', cx, cz, r + 3).length, `war standards ${cx}`).toBe(0);
      }
      // the camp standards: one per gate post, never two on the post two gates share
      const posts = f.layout.props.filter((p) => p.id === 'banner_pole' && Math.hypot(p.x - 128, p.z - 57) < 20);
      for (const a of posts) expect(posts.filter((b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 0.5).length).toBe(0);
    }, 60_000);

    it(`yeonmu (seed ${seed ?? 'zone'}): the hall lights and the village dressing`, () => {
      const f = field('yeonmu', seed);
      // halls (15, -30), (21, -12.5), (-20.5, -11.5): hall 0 has two stair lights, the others one; urns on the stair flanks of halls 0 and 2
      expect(near(f, 'stone_lantern', 15, -30, 14).length).toBeGreaterThanOrEqual(2);
      expect(near(f, 'urn', 15, -30, 10).length + near(f, 'urn', -20.5, -11.5, 10).length).toBe(4);
      // the hay yards keep 2-4 stacks each (their stacks no longer meet each other)
      expect(near(f, 'haystack', 100, 108, 9).length).toBeGreaterThanOrEqual(2);
      expect(near(f, 'haystack', 68, 106, 9).length).toBeGreaterThanOrEqual(2);
    }, 60_000);

    it(`daeryeol (seed ${seed ?? 'zone'}): war standards at the pit gates, spires on the north rim, lava rocks in groups`, () => {
      const f = field('daeryeol', seed);
      expect(f.layout.props.filter((p) => p.id === 'war_banner').length).toBe(5); // the altar gate's south post stands on the dam landing (reserved)
      const spires = f.layout.props.filter((p) => p.id === 'obsidian_spire');
      expect(spires.length).toBeGreaterThanOrEqual(3);
      for (const p of spires) {
        expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual((PROP_DEFS.obsidian_spire?.rimOnly ?? 1) * f.arenaRadius);
        // north rim: behind the hero from the fixed south-side game camera
        expect(p.z).toBeLessThan(-60);
      }
      // MF9: no singletons: every lava rock has a group mate within 4 m
      const lava = f.layout.props.filter((p) => p.id === 'lava_rock');
      expect(lava.length).toBeGreaterThanOrEqual(12);
      for (const p of lava) expect(lava.some((q) => q !== p && Math.hypot(p.x - q.x, p.z - q.z) < 4), `lava rock (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(true);
    }, 60_000);
  }
});

describe('r8 Z8 QA hero spots stand off the set pieces', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../../../../.research/zones_core/spots.json');
  it.skipIf(!existsSync(file))('every walkable QA spot keeps 1.2 m from the nearest collision body', () => {
    const spots = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, number[]>>;
    for (const id of ZONES) {
      const f = field(id);
      for (const [name, s] of Object.entries(spots[id] ?? {})) {
        const [x, z] = s as [number, number];
        if (!f.walkable(x, z)) continue;
        let edge = Infinity;
        f.blockersNear(x, z, 8, (b) => {
          edge = Math.min(edge, Math.hypot(b.x - x, b.z - z) - b.r);
        });
        expect(edge, `${id} ${name} (${x}, ${z})`).toBeGreaterThanOrEqual(1.2);
      }
    }
  }, 60_000);
});

describe('r9 Z9 placement leftovers (r8 judge MF8)', () => {
  it('suryeon boss rings: both gap braziers stand on every ring, also on run seed 2802362286 (a cluster stone used to drop one)', () => {
    for (const seed of [undefined, 1234, 2802362286]) {
      const f = field('suryeon', seed);
      // the north (-62, -134), east (63, 104) and west (-62, 134) boss rings (zones/suryeon.ts BOSS_N / E / W): two braziers at 15 m
      // along the gap, 5.2 m off its axis
      for (const [bx, bz, gx0, gz0] of [[-62, -134, 0.7, 0.7], [63, 104, -0.7, -0.7], [-62, 134, 0.6, -0.8]] as const) {
        const l = Math.hypot(gx0, gz0);
        const [ux, uz] = [gx0 / l, gz0 / l];
        for (const sg of [-1, 1]) {
          const x = bx + ux * 15 - uz * sg * 5.2;
          const z = bz + uz * 15 + ux * sg * 5.2;
          expect(near(f, 'brazier', x, z, 0.5).length, `seed ${seed ?? 'zone'} brazier (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(1);
        }
      }
    }
  }, 60_000);

  it('seori: no banner pole before the broken gate (one stood in its road, one 6.5 m from metin site08); the south-camp gate banners face the camera', () => {
    for (const seed of [undefined, 1234]) {
      const f = field('seori', seed);
      expect(near(f, 'banner_pole', 73.7, -85.4, 14).length).toBe(0);
      const camp = near(f, 'banner_pole', -24, 108, 16);
      expect(camp.length).toBe(2);
      // yaw 0 / PI (render/camera.ts fixed yaw): the cloth faces the game camera, the arm points away from the gate
      for (const p of camp) expect(Math.abs(Math.sin(p.yaw))).toBeLessThan(1e-6);
      const [w, e] = [...camp].sort((a, b) => a.x - b.x);
      expect(Math.cos((w as PropPlacement).yaw)).toBeCloseTo(1);
      expect(Math.cos((e as PropPlacement).yaw)).toBeCloseTo(-1);
    }
  }, 60_000);

  it('daeryeol: the obsidian spires are 5.0-5.8 m and lean across the view, the lava-rock mates lean (no squash: r9 ship)', () => {
    const f = field('daeryeol', 1234);
    const spires = f.layout.props.filter((p) => p.id === 'obsidian_spire');
    expect(spires.length).toBeGreaterThanOrEqual(3);
    for (const p of spires) {
      expect(p.scale).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(p.scale).toBeLessThanOrEqual(0.58 + 1e-9);
      const tx = p.tiltX ?? 0;
      const tz = p.tiltZ ?? 0;
      expect(Math.hypot(tx, tz)).toBeGreaterThan(0.09);
      // the world lean direction (structures/index.ts: Euler YXZ (tiltX, yaw, tiltZ)): mostly east / west, never toward the camera (+z)
      const wx = -tz * Math.cos(p.yaw) + tx * Math.sin(p.yaw);
      const wz = tz * Math.sin(p.yaw) + tx * Math.cos(p.yaw);
      expect(Math.abs(wx)).toBeGreaterThan(Math.abs(wz));
    }
    const lava = f.layout.props.filter((p) => p.id === 'lava_rock');
    const mates = lava.filter((p) => p.tiltX !== undefined || p.tiltZ !== undefined);
    expect(mates.length).toBeGreaterThanOrEqual(6);
    for (const p of mates) {
      expect(p.squash).toBeUndefined();
      expect(Math.hypot(p.tiltX ?? 0, p.tiltZ ?? 0)).toBeGreaterThan(0.15);
    }
  }, 60_000);

  it('seori: every ice crystal leans and stretches on its own hash (no two alike)', () => {
    const f = field('seori', 1234);
    const ice = f.layout.props.filter((p) => p.id === 'ice_crystal');
    expect(ice.length).toBeGreaterThanOrEqual(4);
    for (const p of ice) expect(p.squash).toBeGreaterThanOrEqual(0.86 - 1e-9);
    const keys = new Set(ice.map((p) => `${p.squash?.toFixed(3)}|${p.tiltX?.toFixed(3)}`));
    expect(keys.size).toBe(ice.length);
  }, 60_000);
});
