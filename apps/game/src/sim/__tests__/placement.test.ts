// RS-02a placeWalkable (sim/spawner.ts): a walkable point round an anchor for every run-event spawn (qa SOAK-3: a creature or shrine
// on blocked ground never moves / cannot be reached). Seeded; arena edge, deep water, lava and a blocker cluster.

import { describe, expect, it } from 'vitest';
import { Surface } from '../constants';
import { placeWalkable, spawnable, type Pos } from '../spawner';
import type { WorldEnv } from '../types';
import type { World } from '../world';
import { makeWorld } from './helpers';

const R = 150;
const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

function worldOf(env: WorldEnv, seed = 1234): World {
  return makeWorld({ env: { arenaRadius: R, ...env }, config: { seed } });
}

/** place once with a fresh world per seed */
function place(env: WorldEnv, cx: number, cz: number, rMin: number, rMax: number, seed: number): { ok: boolean; at: Pos; w: World } {
  const w = worldOf(env, seed);
  const at: Pos = { x: Number.NaN, z: Number.NaN };
  const ok = placeWalkable(w, cx, cz, rMin, rMax, at);
  return { ok, at, w };
}

const dist = (a: Pos, x: number, z: number): number => Math.hypot(a.x - x, a.z - z);

describe('placeWalkable on open ground', () => {
  it('lands on the ring round the anchor, inside the arena', () => {
    for (const seed of SEEDS) {
      const { ok, at, w } = place({}, 20, -10, 8, 12, seed);
      expect(ok).toBe(true);
      expect(spawnable(w, at.x, at.z)).toBe(true);
      expect(dist(at, 20, -10)).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(dist(at, 20, -10)).toBeLessThanOrEqual(12 + 1e-9);
      expect(Math.hypot(at.x, at.z)).toBeLessThanOrEqual(R - 1.5);
    }
  });

  it('is deterministic per seed, varies across seeds, and draws only from rng.spawn', () => {
    const a = place({}, 0, 0, 10, 14, 5);
    const b = place({}, 0, 0, 10, 14, 5);
    expect(a.at).toEqual(b.at);
    const distinct = new Set(SEEDS.map((s) => place({}, 0, 0, 10, 14, s).at.x.toFixed(3)));
    expect(distinct.size).toBeGreaterThan(100);
    const w = worldOf({});
    const before = JSON.stringify([w.rng.combat.getState(), w.rng.loot.getState(), w.rng.metin.getState(), w.rng.boss.getState(), w.rng.cards.getState(), w.rng.ai.getState()]);
    placeWalkable(w, 0, 0, 10, 14, { x: 0, z: 0 });
    expect(JSON.stringify([w.rng.combat.getState(), w.rng.loot.getState(), w.rng.metin.getState(), w.rng.boss.getState(), w.rng.cards.getState(), w.rng.ai.getState()])).toBe(before);
  });

  it('tolerates a swapped or zero ring', () => {
    const swapped = place({}, 0, 0, 14, 10, 3);
    expect(swapped.ok).toBe(true);
    expect(dist(swapped.at, 0, 0)).toBeLessThanOrEqual(14 + 1e-9);
    const zero = place({}, 5, 5, 0, 0, 3);
    expect(zero.ok).toBe(true);
    expect(dist(zero.at, 5, 5)).toBeLessThan(1e-9);
  });
});

describe('placeWalkable at the arena edge', () => {
  it('a hero on the rim gets points inside the arena, on the ring when the inner half has room', () => {
    for (const angle of [0, 0.7, 1.9, 3.1, 4.4, 5.5]) {
      const cx = Math.sin(angle) * (R - 0.6);
      const cz = Math.cos(angle) * (R - 0.6);
      for (const seed of SEEDS.slice(0, 60)) {
        const { ok, at, w } = place({}, cx, cz, 8, 12, seed);
        expect(ok).toBe(true);
        expect(Math.hypot(at.x, at.z)).toBeLessThanOrEqual(R - 1.5 + 1e-9);
        expect(spawnable(w, at.x, at.z)).toBe(true);
        expect(dist(at, cx, cz)).toBeLessThanOrEqual(12 + 1e-9);
      }
    }
  });

  it('a hero in the last metre of the arena (itself outside the spawn limit) still gets a point inside it', () => {
    // every point farther than 20 m from the centre is a wall except the hero's own spot: the ring is all outside the limit or blocked
    const env: WorldEnv = { walkable: (x, z) => Math.hypot(x, z) <= R - 1.5 };
    for (const seed of SEEDS.slice(0, 60)) {
      const { ok, at } = place(env, R - 0.5, 0, 10, 14, seed);
      expect(ok).toBe(true);
      expect(Math.hypot(at.x, at.z)).toBeLessThanOrEqual(R - 1.5 + 1e-9);
    }
  });
});

describe('placeWalkable next to deep water and lava', () => {
  // x > 0 is a deep lake; a lava stream runs along z in [10, 16] on the dry side
  const surfaceAt = (x: number, z: number): number => (x > 0 ? Surface.Deep : z >= 10 && z <= 16 ? Surface.Lava : Surface.Ground);

  it('never returns a point in the water or the lava, whichever side the ring is mostly on', () => {
    for (const [cx, cz] of [
      [-0.5, 0],
      [-3, 8],
      [-10, 12],
      [-1, 18],
    ] as const) {
      for (const seed of SEEDS) {
        const { ok, at } = place({ surfaceAt }, cx, cz, 6, 12, seed);
        expect(ok).toBe(true);
        expect(surfaceAt(at.x, at.z)).toBe(Surface.Ground);
        expect(dist(at, cx, cz)).toBeLessThanOrEqual(12 + 1e-9);
      }
    }
  });

  it('a hero on a thin strip of land (the rest deep water) gets the strip: the search steps towards the hero', () => {
    // dry land only inside |x| <= 1.2 (an 2.4 m wide causeway along z)
    const strip: WorldEnv = { surfaceAt: (x) => (Math.abs(x) <= 1.2 ? Surface.Ground : Surface.Deep) };
    let closer = 0;
    for (const seed of SEEDS) {
      const { ok, at, w } = place(strip, 0, 30, 8, 12, seed);
      expect(ok).toBe(true);
      expect(spawnable(w, at.x, at.z)).toBe(true);
      expect(Math.abs(at.x)).toBeLessThanOrEqual(1.2);
      expect(dist(at, 0, 30)).toBeLessThanOrEqual(12 + 1e-9);
      if (dist(at, 0, 30) < 8) closer++;
    }
    // the random ring (24 tries) almost never hits a 2.4 m strip, so the walk toward the hero is what finds the point
    expect(closer).toBeGreaterThan(0);
  });

  it('a hero standing in lava has no walkable anchor: false, the point is the anchor', () => {
    const lava: WorldEnv = { surfaceAt: () => Surface.Lava };
    const { ok, at } = place(lava, 4, -6, 8, 12, 9);
    expect(ok).toBe(false);
    expect(at).toEqual({ x: 4, z: -6 });
  });
});

describe('placeWalkable inside a blocker cluster', () => {
  // a field of blockers: everything within 45 m of (30, 0) is blocked, except a 2.5 m pocket round the hero at (30, 0)
  const cluster: WorldEnv = {
    walkable: (x, z) => {
      const d = Math.hypot(x - 30, z);
      return d <= 2.5 || d > 45;
    },
  };

  it('steps from the candidate towards the hero until walkable: the point is in the hero pocket (closer than the ring)', () => {
    for (const seed of SEEDS) {
      const { ok, at, w } = place(cluster, 30, 0, 8, 12, seed);
      expect(ok).toBe(true);
      expect(spawnable(w, at.x, at.z)).toBe(true);
      expect(dist(at, 30, 0)).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });

  it('a blocker cluster smaller than the ring does not matter: the ring point is used as is', () => {
    const small: WorldEnv = { walkable: (x, z) => Math.hypot(x - 30, z) > 3 || Math.hypot(x - 30, z) < 0.5 };
    for (const seed of SEEDS) {
      const { ok, at, w } = place(small, 30, 0, 8, 12, seed);
      expect(ok).toBe(true);
      expect(spawnable(w, at.x, at.z)).toBe(true);
      expect(dist(at, 30, 0)).toBeGreaterThanOrEqual(8 - 1e-9);
    }
  });

  it('works together with an arena-edge anchor and a cluster (the walk ends at the anchor itself)', () => {
    const edge: WorldEnv = { walkable: (x, z) => Math.hypot(x - (R - 1), z) <= 0.4 };
    const { ok, at } = place(edge, R - 1, 0, 8, 12, 4);
    expect(ok).toBe(true);
    expect(dist(at, R - 1, 0)).toBeLessThanOrEqual(0.4 + 1e-9);
  });
});
