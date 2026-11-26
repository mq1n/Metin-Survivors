import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../data/schema';
import { cpuMsPerCall, cpuNow, withinBudget } from '../dev/perfBudget';
import { clearTerrainFieldCache, createTerrainField, SURFACE, terrainFieldCacheSize, type TerrainField } from './terrainField';

function biome(id: string, seed = 1234): BiomePreset {
  return {
    id,
    seed,
    ground: [],
    trees: [],
    props: [],
    fog: { color: '#aabbcc', near: 40, far: 160 },
    sky: { top: '#223344', horizon: '#aabbcc', bottom: '#556677' },
    sun: { color: '#fff1d6', intensity: 2.4, dir: [0.4, 0.8, 0.3] },
    ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.8 },
    relief: { height: 20, roughness: 0.5, features: [] },
  };
}

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

describe('TerrainField', () => {
  for (const id of ZONES) {
    it(`${id}: bakes fast, deterministic, centre playable`, () => {
      // "bakes fast": 1500 ms of CPU time (not wall clock: under a loaded machine or a parallel test run the thread waits
      // for a core and the wall time doubles without the code getting any slower), repeated and scaled by the machine
      // speed only if the first attempt is over, see dev/perfBudget.ts. A real regression is slow on every attempt.
      const bake = withinBudget(
        () => {
          clearTerrainFieldCache();
          const t0 = cpuNow();
          const field: TerrainField = createTerrainField(biome(id));
          return { value: field, ms: cpuNow() - t0 };
        },
        { baseMs: 1500 },
      );
      expect(bake.ms, bake.log).toBeLessThanOrEqual(bake.budget);
      const f = bake.value;
      const c = f.landmark('centre');
      expect(c).toBeDefined();
      expect(f.walkable(0, 0)).toBe(true);
      expect(f.surfaceAt(0, 0)).toBe(SURFACE.GROUND);
      expect(f.stats.walkableFraction).toBeGreaterThan(0.6);
      expect(f.stats.reachableFraction).toBeGreaterThan(0.9);
      // blockers never sit inside the centre clearing
      let bad = 0;
      f.blockersNear(0, 0, (c?.r ?? 20) + 2, (b) => {
        if (Math.hypot(b.x, b.z) < (c?.r ?? 20) * 0.5) bad++;
      });
      expect(bad).toBe(0);
      clearTerrainFieldCache();
      const g = createTerrainField(biome(id));
      expect(Array.from(g.grid.heights.slice(1000, 1100))).toEqual(Array.from(f.grid.heights.slice(1000, 1100)));
      expect(g.layout.trees.length).toBe(f.layout.trees.length);
      expect(g.blockers.length).toBe(f.blockers.length);
    }, 60_000); // two bakes (plus retries when the machine is loaded): the 5 s default is a hang guard, not the performance gate
  }

  it('heightAt is continuous and outside the arena is blocked', () => {
    const f = createTerrainField(biome('yeonmu'));
    const a = f.heightAt(10.2, -7.7);
    const b = f.heightAt(10.21, -7.7);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
    expect(f.walkable(f.arenaRadius + 40, 0)).toBe(false);
    const out = { x: 0, z: 0 };
    expect(f.moveCircle(0, 0, 1, 0, 0.55, out)).toBe(true);
    expect(out.x).toBeCloseTo(1);
    // heightAt matches the grid exactly at nodes
    const n = f.grid.n;
    const i = 300;
    const j = 200;
    const x = -f.size / 2 + i * f.grid.cell;
    const z = -f.size / 2 + j * f.grid.cell;
    expect(f.heightAt(x, z)).toBeCloseTo(f.grid.heights[j * n + i] as number, 4);
  }, 60_000);

  it('query cost is small', () => {
    const f = createTerrainField(biome('yeonmu'));
    let acc = 0;
    // 200 000 heightAt + walkable queries cost ~5 ms of CPU; the gate (100 ms) catches a 20x regression such as an
    // allocation or a scan in the query path. CPU time over a timed batch (the 15 ms CPU-clock tick is far above one call).
    const q = withinBudget(
      () => ({
        value: 0,
        ms: cpuMsPerCall(() => {
          for (let i = 0; i < 200000; i++) {
            const x = (i % 400) - 200;
            const z = ((i * 7) % 400) - 200;
            acc += f.heightAt(x, z) + (f.walkable(x, z) ? 1 : 0);
          }
        }),
      }),
      { baseMs: 100 },
    );
    expect(acc).not.toBeNaN();
    expect(q.ms, q.log).toBeLessThanOrEqual(q.budget);
  }, 60_000);
});

// prod4 runtime-memory-net: what the memo keeps alive. A field is ~6 MB; the run seed is new every run, so a run's field must
// not outlive its run (it used to sit in a 6-entry strong memo: +1 field of JS/ArrayBuffer memory per menu -> run -> quit cycle).
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const nextJob = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function collect(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await nextJob(); // a WeakRef target is only released once the job that created / dereferenced it has ended
    gc();
  }
}

describe('terrain field memo', () => {
  it('a run-seeded field is shared while its run holds it and is collectable once the run is gone', async () => {
    clearTerrainFieldCache();
    let run: TerrainField | null = createTerrainField(biome('yeonmu'), 424242);
    expect(createTerrainField(biome('yeonmu'), 424242)).toBe(run); // e.g. the main-thread map fallback during the run
    expect(terrainFieldCacheSize()).toEqual({ strong: 0, runFields: 1 });
    const watch = new WeakRef(run);
    run = null;
    await collect();
    expect(watch.deref()).toBeUndefined(); // nothing of the memo keeps it
    expect(terrainFieldCacheSize()).toEqual({ strong: 0, runFields: 0 });
    // the next run of the same seed bakes a fresh field (and the memo works again)
    const again = createTerrainField(biome('yeonmu'), 424242);
    expect(createTerrainField(biome('yeonmu'), 424242)).toBe(again);
  }, 60_000);

  it('zone-default fields stay memoised, in a strong LRU of at most 4', () => {
    clearTerrainFieldCache();
    const a = createTerrainField(biome('yeonmu'));
    expect(createTerrainField(biome('yeonmu'))).toBe(a);
    for (const id of ['seori', 'suryeon', 'daeryeol']) createTerrainField(biome(id));
    expect(terrainFieldCacheSize().strong).toBe(4);
    expect(createTerrainField(biome('yeonmu'))).toBe(a); // still there
    createTerrainField(biome('fifth')); // evicts the oldest (yeonmu)
    expect(terrainFieldCacheSize().strong).toBe(4);
    expect(createTerrainField(biome('yeonmu'))).not.toBe(a);
    clearTerrainFieldCache();
    expect(terrainFieldCacheSize()).toEqual({ strong: 0, runFields: 0 });
  }, 60_000);
});

// HZ-01 (qa SOAK-4): `field.env` is what app/run.ts spreads into the sim's WorldEnv, so it must carry every hook the sim reads and each
// hook must agree with the field it came from. The sim-level behaviour (damage, slow, slide) is in sim/__tests__/hazards.test.ts.
describe('field.env: the sim hooks', () => {
  const HAZARD_OF: Record<string, number[]> = {
    yeonmu: [SURFACE.SHALLOW],
    suryeon: [SURFACE.SHALLOW],
    seori: [SURFACE.ICE, SURFACE.MIASMA],
    daeryeol: [SURFACE.LAVA],
  };

  for (const id of ZONES) {
    it(`${id}: env carries arenaRadius, walkable, moveCircle and surfaceAt and they agree with the field`, () => {
      const f = createTerrainField(biome(id));
      // r6 U6: + clearOfStatics (metin fall sites keep the drawn props, rocks, trees and walls out of the stone and its rubble)
      // r7 U7: + levelDisc (the metin rune carpet lies on open, level ground)
      // r9 Z9: + ringScore (a small metin's fall site prefers a fight ring the banners and roofs reach least into); r9 ship: + ringGround (no move onto worse ground)
      expect(Object.keys(f.env).sort()).toEqual(['arenaRadius', 'clearOfStatics', 'levelDisc', 'moveCircle', 'ringGround', 'ringScore', 'surfaceAt', 'walkable']);
      expect(f.env.arenaRadius).toBe(f.arenaRadius);
      const counts = new Map<number, number>();
      let diff = 0;
      for (let z = -150; z <= 150; z += 2) {
        for (let x = -150; x <= 150; x += 2) {
          const s = f.env.surfaceAt(x, z);
          if (s !== f.surfaceAt(x, z) || f.env.walkable(x, z) !== f.walkable(x, z)) diff++;
          if (f.env.clearOfStatics(x, z, 2.6) !== f.clearOfStatics(x, z, 2.6)) diff++;
          if (f.walkableCircle(x, z, 0.6)) counts.set(s, (counts.get(s) ?? 0) + 1);
        }
      }
      expect(diff).toBe(0);
      // the zone's own hazards are reachable ground the sim can see (a hazard that never shows would be inert again)
      for (const s of HAZARD_OF[id] ?? []) expect(counts.get(s) ?? 0, `${id} surface ${s}`).toBeGreaterThan(20);
    }, 60_000);
  }

  it('deep water is not walkable and never stood on; lava is walkable ground that hurts', () => {
    const y = createTerrainField(biome('yeonmu'));
    let deep = 0;
    for (let z = -150; z <= 150; z += 1) {
      for (let x = -150; x <= 150; x += 1) {
        if (y.surfaceAt(x, z) !== SURFACE.DEEP) continue;
        deep++;
        expect(y.walkable(x, z)).toBe(false);
      }
    }
    expect(deep).toBeGreaterThan(100);
    const d = createTerrainField(biome('daeryeol'));
    let lavaWalkable = 0;
    for (let z = -150; z <= 150; z += 2) for (let x = -150; x <= 150; x += 2) if (d.surfaceAt(x, z) === SURFACE.LAVA && d.walkableCircle(x, z, 0.6)) lavaWalkable++;
    expect(lavaWalkable).toBeGreaterThan(100);
  }, 60_000);

  it('env.moveCircle never leaves a free hero inside terrain or a blocker (400 random steps per zone)', () => {
    for (const id of ZONES) {
      const f = createTerrainField(biome(id));
      let seed = 0x9e3779b9;
      const rnd = (): number => {
        seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
        return seed / 4294967296;
      };
      const out = { x: 0, z: 0 };
      let tried = 0;
      for (let i = 0; i < 4000 && tried < 400; i++) {
        const R = f.arenaRadius - 4;
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * R;
        const x0 = Math.cos(a) * r;
        const z0 = Math.sin(a) * r;
        if (!f.walkableCircle(x0, z0, 0.55)) continue;
        tried++;
        const b = rnd() * Math.PI * 2;
        const len = rnd() * 0.3; // one tick of a fast hero or a knockback
        f.env.moveCircle(x0, z0, x0 + Math.cos(b) * len, z0 + Math.sin(b) * len, 0.55, out);
        expect(f.walkableCircle(out.x, out.z, 0.55 * 0.85), `${id} (${x0.toFixed(1)}, ${z0.toFixed(1)}) -> (${out.x.toFixed(2)}, ${out.z.toFixed(2)})`).toBe(true);
        expect(Math.hypot(out.x - x0, out.z - z0)).toBeLessThanOrEqual(len + 1e-6 + 0.6);
      }
      expect(tried).toBe(400);
    }
  }, 120_000);

  it('moveCircle slides along a straight wall instead of stopping', () => {
    const f = createTerrainField(biome('seori'));
    // the south rim of the arena: a flat cliff face. Stand against it and push diagonally (into the wall and along it).
    const firstFree = (x: number): number => {
      let z = -f.arenaRadius;
      while (z < 0 && !f.walkableCircle(x, z, 0.6)) z += 0.02;
      return z;
    };
    let ok = false;
    for (let x = -60; x <= 60 && !ok; x += 1) {
      const face = [-4, -2, 0, 2, 4].map((dx) => firstFree(x + dx));
      if (Math.max(...face) - Math.min(...face) > 0.1 || Math.max(...face) >= 0) continue; // not one flat face
      const z0 = Math.max(...face) + 0.03;
      const out = { x: 0, z: 0 };
      const reached = f.moveCircle(x, z0, x + 0.09, z0 - 0.09, 0.6, out);
      expect(reached).toBe(false); // the diagonal target is inside the wall
      // the wall component is dropped, the along-wall component survives
      expect(out.x).toBeGreaterThan(x + 0.05);
      expect(f.walkableCircle(out.x, out.z, 0.6 * 0.85)).toBe(true);
      ok = true;
    }
    expect(ok, 'found a flat wall to push against').toBe(true);
  }, 60_000);
});
