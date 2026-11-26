// r6 U6: metin spawn clearance on the REAL zone layouts. The Great Metin always falls at the arena centre (scale 2.4: foot about
// 3.8 m, shatter pieces 7.5 m p90 / 9.3 m max at 1.3 s), so no static item may reach within 8 m of it (on 11 run seeds per zone the
// nearest drawn edge is >= 9.75 m; the biome seed of suryeon keeps a rock spire at 8.55 m); the small stones fall where fallSiteClear allows (sim/metins.ts),
// which needs FieldEnv.clearOfStatics to see the drawn extents (a lantern draws 0.9 m round a 0.45 m collision circle) and must
// still leave most of the arena open so the falls never starve.
import { describe, expect, it } from 'vitest';
import type { BiomePreset, ZoneDef } from '../data/schema';
import zonesJson from '../data/content/zones.json';
import { createTerrainField } from './terrainField';
import { PROP_DEFS } from './props';
import { fallSiteClear, METIN_CARPET_DH, METIN_CARPET_R, METIN_CLEAR_R, METIN_FOOT_R, METIN_VIEW } from '../sim/metins';
import { Surface } from '../sim/constants';
import { TREE_DIMS } from './trees';

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;
const GREAT_RUBBLE = 8.0;
const SMALL_CLEAR = METIN_CLEAR_R;

describe('r6 U6 metin sites on the real zone layouts', () => {
  for (const id of ZONES) {
    it(`${id}: the Great Metin's centre site is clear of every drawn static item out to its rubble, and the small falls keep room`, () => {
      const zone = (zonesJson as unknown as ZoneDef[]).find((z) => z.id === id);
      expect(zone).toBeDefined();
      const f = createTerrainField((zone as ZoneDef).biome as BiomePreset);
      expect(f.env.clearOfStatics(0, 0, GREAT_RUBBLE)).toBe(true);
      // a prop's drawn extent counts, not its collision circle: right beside any placed prop the site is refused
      const p = f.layout.props[0];
      expect(p).toBeDefined();
      if (p) {
        const reach = (PROP_DEFS[p.id]?.radius ?? 1) * p.scale;
        expect(f.env.clearOfStatics(p.x + reach + SMALL_CLEAR - 0.1, p.z, SMALL_CLEAR)).toBe(false);
      }
      // open ground: a good share of the walkable sites inside the fall limit stays clear for a small stone, view check included
      // (2 m grid). r7 U7: the perspective camera (hero over the stone, 7 m W / E / S, 5 m SW / SE) and the level carpet ring keep
      // about 33 % of yeonmu, 30 % of suryeon (coast and cliffs), 39 % of seori and 52 % of daeryeol (the r6 parallel strip kept
      // 45-80 %, but missed 1-4 hidden sites per zone and laid carpets over cliff edges); the falls never starve: see the next test.
      // r8 Z8: + the carpet view body (no static leans over the 3.6 m rune carpet in the game camera, METIN_VIEW.carpet) and the zones'
      // carpet keep-outs (medallions, kerb rings, lava seams): about 24 % of yeonmu, 22 % of suryeon, 29 % of seori, 45 % of
      // daeryeol; the next test (every hero spot keeps a clear site within 45 m, nearly all within 25 m) is the starvation guard
      const limit = f.arenaRadius - 8;
      let walk = 0;
      let clear = 0;
      for (let x = -limit; x <= limit; x += 2)
        for (let z = -limit; z <= limit; z += 2) {
          if (Math.hypot(x, z) > limit || !f.env.walkable(x, z)) continue;
          walk++;
          if (f.env.clearOfStatics(x, z, SMALL_CLEAR, METIN_VIEW) && f.env.levelDisc(x, z, METIN_CARPET_R, METIN_CARPET_DH)) clear++;
        }
      expect(walk).toBeGreaterThan(1000);
      expect(clear / walk).toBeGreaterThan(0.2);
    });

    it(`${id}: the falls never starve: from every walkable hero spot a clear fall site lies within 45 m, from nearly all within 25 m`, () => {
      const zone = (zonesJson as unknown as ZoneDef[]).find((z) => z.id === id) as ZoneDef;
      const f = createTerrainField(zone.biome as BiomePreset);
      const world = { env: f.env, arenaRadius: f.arenaRadius, metins: [] } as unknown as Parameters<typeof fallSiteClear>[0];
      const limit = f.arenaRadius - 8;
      // the clear sites (fallSiteClear: foot ring, level carpet, drawn statics, camera) on a 2 m grid
      const n = Math.floor(limit / 2);
      const side = 2 * n + 1;
      const ok = new Uint8Array(side * side);
      const pts: Array<[number, number]> = [];
      for (let i = -n; i <= n; i++)
        for (let j = -n; j <= n; j++) {
          const x = i * 2;
          const z = j * 2;
          if (Math.hypot(x, z) > limit) continue;
          if (fallSiteClear(world, x, z)) {
            ok[(i + n) * side + (j + n)] = 1;
            pts.push([x, z]);
          }
        }
      let heroes = 0;
      let near = 0;
      let far = 0;
      for (let hx = -limit; hx <= limit; hx += 12)
        for (let hz = -limit; hz <= limit; hz += 12) {
          if (Math.hypot(hx, hz) > limit - 6 || !f.env.walkable(hx, hz) || f.env.surfaceAt(hx, hz) === Surface.Lava) continue;
          heroes++;
          let best = Infinity;
          for (const [x, z] of pts) {
            const d = Math.hypot(x - hx, z - hz);
            if (d >= 12 && d < best) best = d;
          }
          if (best <= 25) near++;
          if (best <= 45) far++;
        }
      expect(heroes).toBeGreaterThan(200);
      expect(far).toBe(heroes);
      expect(near / heroes).toBeGreaterThan(0.9);
    }, 60_000);
  }

  it('the level carpet ring: a flat open site passes, a site whose carpet rim falls off a bank edge or a cliff is refused', () => {
    for (const id of ZONES) {
      const zone = (zonesJson as unknown as ZoneDef[]).find((z) => z.id === id) as ZoneDef;
      const f = createTerrainField(zone.biome as BiomePreset);
      // r8 Z8: the Great Metin's own medallion is a carpet keep-out for the SMALL stones (TerrainPlan.carpetKeepOut): refused; the first
      // flat walkable site on the rings round it (every carpet sample within 0.3 m of the centre's height) passes
      expect(f.env.levelDisc(0, 0, METIN_CARPET_R, METIN_CARPET_DH), `${id} medallion`).toBe(false);
      let flat: [number, number] | null = null;
      for (let r = 24; r <= 60 && !flat; r += 4)
        for (let k = 0; k < 16 && !flat; k++) {
          const x = Math.round(r * Math.cos((k * Math.PI) / 8));
          const z = Math.round(r * Math.sin((k * Math.PI) / 8));
          if (!f.env.walkable(x, z)) continue;
          const h0 = f.heightAt(x, z);
          let ok = true;
          for (let a = 0; a < 16 && ok; a++) for (const d of [METIN_CARPET_R, METIN_CARPET_R / 2]) if (!f.env.walkable(x + Math.sin(a) * d, z + Math.cos(a) * d) || Math.abs(f.heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d) - h0) > 0.3) ok = false;
          if (ok) flat = [x, z];
        }
      expect(flat, `${id} flat site`).not.toBeNull();
      if (flat) expect(f.env.levelDisc(flat[0], flat[1], METIN_CARPET_R, METIN_CARPET_DH), `${id} flat @(${flat[0]}, ${flat[1]})`).toBe(true);
      // a walkable spot with a rise or drop of more than 2 m within the carpet radius is never a level carpet
      let edges = 0;
      for (let x = -150; x <= 150 && edges < 20; x += 3)
        for (let z = -150; z <= 150 && edges < 20; z += 3) {
          if (!f.env.walkable(x, z)) continue;
          const h0 = f.heightAt(x, z);
          if (Math.abs(f.heightAt(x + METIN_CARPET_R, z) - h0) < 2 && Math.abs(f.heightAt(x, z + METIN_CARPET_R) - h0) < 2) continue;
          edges++;
          expect(f.env.levelDisc(x, z, METIN_CARPET_R, METIN_CARPET_DH), `${id} edge @(${x}, ${z})`).toBe(false);
        }
      expect(edges, id).toBeGreaterThan(0);
    }
  }, 60_000);

  it('bridges and docks are drawn statics: no stone falls on a deck, its rails or its landing', () => {
    let decks = 0;
    for (const id of ZONES) {
      const zone = (zonesJson as unknown as ZoneDef[]).find((z) => z.id === id) as ZoneDef;
      const f = createTerrainField(zone.biome as BiomePreset);
      for (const b of f.layout.bridges) {
        decks++;
        const mx = (b.x0 + b.x1) / 2;
        const mz = (b.z0 + b.z1) / 2;
        const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) || 1;
        // the deck middle, a point 1 m outside the rail and a point 1 m past the end of the strip
        const nx = -(b.z1 - b.z0) / len;
        const nz = (b.x1 - b.x0) / len;
        expect(f.env.clearOfStatics(mx, mz, METIN_FOOT_R), `${id} deck`).toBe(false);
        expect(f.env.clearOfStatics(mx + nx * (b.width / 2 + 1), mz + nz * (b.width / 2 + 1), SMALL_CLEAR), `${id} rail`).toBe(false);
        expect(f.env.clearOfStatics(b.x1 + ((b.x1 - b.x0) / len) * 1, b.z1 + ((b.z1 - b.z0) / len) * 1, SMALL_CLEAR), `${id} landing`).toBe(false);
      }
    }
    expect(decks).toBeGreaterThan(0);
  }, 60_000);

  it('r8 Z8 the carpet view body: a waist-to-head-high prop just south of a site leans over the rune carpet (refused), one just north of it does not', () => {
    // the camera stands south (+z) of its focus, so an item between the camera and the carpet leans north onto it; an item north of the
    // carpet leans away from it. Items 1.5-3 m tall (haystacks, wells, racks, signposts) are below the stone-body view test (VIEW_MIN_H
    // 3 m), so the ground test and the stone view alone keep both sites; METIN_VIEW.carpet refuses only the first.
    let leaned = 0;
    let behind = 0;
    const stoneOnly = { h: METIN_VIEW.h, r: METIN_VIEW.r };
    for (const id of ZONES) {
      const zone = (zonesJson as unknown as ZoneDef[]).find((z) => z.id === id) as ZoneDef;
      const f = createTerrainField(zone.biome as BiomePreset);
      for (const p of f.layout.props) {
        const def = PROP_DEFS[p.id];
        const h = (def?.height ?? 0) * p.scale;
        if (!def || h < 1.5 || h > 3) continue;
        const gap = SMALL_CLEAR + Math.max(def.radius, def.reach ?? 0) * p.scale + 0.3;
        const north = p.z - gap; // the site north of the item: the item stands between it and the camera
        if (f.env.clearOfStatics(p.x, north, SMALL_CLEAR, stoneOnly) && !f.env.clearOfStatics(p.x, north, SMALL_CLEAR, METIN_VIEW)) leaned++;
        const south = p.z + gap; // the site south of the item: the item stands behind the carpet
        if (f.env.clearOfStatics(p.x, south, SMALL_CLEAR, stoneOnly) && f.env.clearOfStatics(p.x, south, SMALL_CLEAR, METIN_VIEW)) behind++;
      }
    }
    expect(leaned).toBeGreaterThan(3);
    expect(behind).toBeGreaterThan(3);
  }, 60_000);

  it('the view check: a stone just north of a lone tree hides under its crown (refused), one just south of it stands in front (kept)', () => {
    const zone = (zonesJson as unknown as ZoneDef[]).find((z) => z.id === 'yeonmu') as ZoneDef;
    const f = createTerrainField(zone.biome as BiomePreset);
    let checked = 0;
    for (const t of f.layout.trees) {
      const d = TREE_DIMS[t.species];
      const gap = SMALL_CLEAR + 0.8 * d.crownRadius * t.scale + 0.3;
      const north = f.env.clearOfStatics(t.x, t.z - gap, SMALL_CLEAR);
      const south = f.env.clearOfStatics(t.x, t.z + gap, SMALL_CLEAR);
      // only a tree whose both ground sites are free tests the camera rule alone (the crown sits at >= 2 m, so it shadows the north site)
      if (!north || !south || d.height * t.scale < 6) continue;
      expect(f.env.clearOfStatics(t.x, t.z - gap, SMALL_CLEAR, METIN_VIEW), `north of ${t.species} @(${t.x.toFixed(1)}, ${t.z.toFixed(1)})`).toBe(false);
      if (f.env.clearOfStatics(t.x, t.z + gap, SMALL_CLEAR, METIN_VIEW)) checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);
});
