// r6 U6: a metin fall site must keep every static item's DRAWN extent out of the stone and its rubble, not only its collision
// circle (the r5 critic saw a fence end, stone lanterns and a boulder clip into metins). fallSiteClear = footprintClear (M6: the
// foot on spawnable ground) + WorldEnv.clearOfStatics at METIN_CLEAR_R; nearestFallSite is the no-draw fallback search.
import { describe, expect, it } from 'vitest';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { fallSiteClear, footprintClear, METIN_CARPET_DH, METIN_CARPET_R, METIN_CLEAR_R, METIN_FOOT_R, nearestFallSite, pickFallSite } from '../metins';
import type { WorldEnv } from '../types';
import { createWorld } from '../world';

// a stone lantern at (2.2, 0): collision circle r 0.45 (outside the M6 ring of 1.6 m), drawn half extent 0.9 m
const LANTERN = { x: 2.2, z: 0, collide: 0.45, drawn: 0.9 };
const env = (): WorldEnv => ({
  walkable: (x, z) => Math.hypot(x - LANTERN.x, z - LANTERN.z) > LANTERN.collide,
  clearOfStatics: (x, z, r) => Math.hypot(x - LANTERN.x, z - LANTERN.z) >= r + LANTERN.drawn,
});
const world = (e: WorldEnv) => createWorld(fixtureConfig({ seed: 11 }), cloneContent(), undefined, e);

describe('r6 U6 metin fall-site clearance', () => {
  it('rejects a site whose collision ring is free but whose stone or rubble would stand in a drawn prop', () => {
    const w = world(env());
    expect(footprintClear(w, 0, 0, METIN_FOOT_R)).toBe(true);
    expect(fallSiteClear(w, 0, 0)).toBe(false);
    // far enough that the lantern's drawn extent stays out of the stone and its rubble
    expect(fallSiteClear(w, -(METIN_CLEAR_R + LANTERN.drawn) + LANTERN.x - 0.05, 0)).toBe(true);
  });

  it('keeps the old rule when the field gives no clearOfStatics (flat test arenas)', () => {
    const w = world({ walkable: env().walkable });
    expect(fallSiteClear(w, 0, 0)).toBe(true);
  });

  it('nearestFallSite finds the nearest clear site without drawing a random number and honours keep / limit / sep', () => {
    const w = world(env());
    const before = JSON.stringify(w.rng);
    const out = { x: 99, z: 99 };
    expect(nearestFallSite(w, 0, 0, 1, 8, 100, 0, out)).toBe(true);
    expect(JSON.stringify(w.rng)).toBe(before);
    expect(fallSiteClear(w, out.x, out.z)).toBe(true);
    const d = Math.hypot(out.x, out.z);
    expect(d).toBeLessThanOrEqual(8 + 1e-6);
    // nothing on the 1 m ring is clear (the lantern's drawn extent + rubble reaches 3.5 m round it), so the first hit is farther out
    expect(d).toBeGreaterThan(1);
    // a keep predicate that refuses everything, or a limit that excludes every ring, finds nothing and leaves out untouched
    const o2 = { x: 7, z: 7 };
    expect(nearestFallSite(w, 0, 0, 1, 8, 100, 0, o2, () => false)).toBe(false);
    expect(o2).toEqual({ x: 7, z: 7 });
    expect(nearestFallSite(w, 50, 0, 1, 4, 10, 0, o2)).toBe(false);
  });

  it('is deterministic: the same query gives the same site', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    nearestFallSite(world(env()), 1, 1, 1, 8, 100, 0, a);
    nearestFallSite(world(env()), 1, 1, 1, 8, 100, 0, b);
    expect(a).toEqual(b);
  });
});

// r7 U7: the U6 follow-ups: the rune carpet needs open, level ground (WorldEnv.levelDisc at METIN_CARPET_R), and no fallback places
// a stone on an unchecked site (pickFallSite's old last resort was half the limit opposite the hero, unchecked)
describe('r7 U7 metin fall sites: level carpet ground and checked fallbacks', () => {
  it('fallSiteClear asks levelDisc for the carpet disc (radius, height tolerance) and refuses where it says no', () => {
    const asked: number[][] = [];
    const w = world({
      ...env(),
      // level ground only west of x = -10 (a bank edge runs north-south there)
      levelDisc: (x, z, r, dh) => {
        asked.push([r, dh]);
        return x < -10;
      },
    });
    expect(fallSiteClear(w, -20, 0)).toBe(true);
    expect(fallSiteClear(w, 20, 0)).toBe(false);
    expect(asked[0]).toEqual([METIN_CARPET_R, METIN_CARPET_DH]);
    // the carpet radius covers the drawn carpet (render/fx/rings/metin.ts: 0.28 x the 13 m aura)
    expect(METIN_CARPET_R).toBeGreaterThanOrEqual(0.28 * 13 - 0.05);
  });

  it('pickFallSite never returns an unchecked site: a lone clear patch far from the hero is found, an arena without one gives null', () => {
    // clear ground only in a 6 m patch 80 m east of the hero (every random try and both near sweeps fail)
    const patch = (x: number, z: number): boolean => Math.hypot(x - 80, z) < 6;
    const w = world({ arenaRadius: 150, walkable: () => true, clearOfStatics: (x, z) => patch(x, z) });
    expect(w.arenaRadius).toBe(150);
    const hero = w.players[0];
    expect(hero).toBeDefined();
    if (hero) {
      hero.x = 0;
      hero.z = 0;
    }
    const site = pickFallSite(w);
    expect(site).not.toBeNull();
    if (site) {
      expect(fallSiteClear(w, site.x, site.z)).toBe(true);
      expect(patch(site.x, site.z)).toBe(true);
    }
    const none = world({ arenaRadius: 150, walkable: () => true, clearOfStatics: () => false });
    expect(pickFallSite(none)).toBeNull();
  });
});
