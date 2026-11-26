import { describe, expect, it } from 'vitest';
import { findLook } from './index';

// zones core B1 / B2: the per-zone knobs of the crown-silhouette tree shadows and the liquid shore shading stay in range
const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

describe('look.shadow.trees (B1)', () => {
  it('every zone that turns the crown shadows on gives knobs in range', () => {
    for (const id of ZONES) {
      const look = findLook(id);
      const t = look?.shadow.trees;
      expect(t, `${id}: B1 is on in all four zones`).toBeDefined();
      if (!t) continue;
      expect([undefined, 1024, 1536, 2048]).toContain(t.res);
      for (const [k, v] of Object.entries({ strength: t.strength, edge: t.edge === undefined ? undefined : Math.min(1, t.edge / 2), capsule: t.capsule, others: t.others })) {
        if (v !== undefined) expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(0);
        if (v !== undefined) expect(v, `${id}.${k}`).toBeLessThanOrEqual(1);
      }
      for (const [sp, m] of Object.entries(t.species ?? {})) expect(m, `${id}.species.${sp}`).toBeGreaterThanOrEqual(0);
      // the crown shadow has to reach the ground: baked shadows are scaled by shadow.baked in the terrain shader
      expect(look?.shadow.baked ?? 0, `${id}: shadow.baked`).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('look.liquidLook.shade (B2)', () => {
  it('is 0..1 and set in the zones with a bank layer (water, ice)', () => {
    for (const id of ZONES) {
      const s = findLook(id)?.liquidLook?.shade;
      if (s !== undefined) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
    for (const id of ['yeonmu', 'suryeon', 'seori']) expect(findLook(id)?.liquidLook?.shade, id).toBe(1);
  });
});
