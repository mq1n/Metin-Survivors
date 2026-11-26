// r6: a small metin's fall site must be clear over its whole footprint (centre + a ring of METIN_FOOT_R), not only at its centre point.
import { describe, expect, it } from 'vitest';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { footprintClear, METIN_FOOT_R } from '../metins';
import { createWorld } from '../world';

const world = (walkable: (x: number, z: number) => boolean) => createWorld(fixtureConfig({ seed: 7 }), cloneContent(), undefined, { walkable });

describe('r6 metin footprint clearance', () => {
  it('rejects a site whose centre is walkable but whose footprint touches a blocker', () => {
    // a 0.6 m prop blocker 1.3 m east of the site: the centre is free, the stone would stand in the prop
    const w = world((x, z) => Math.hypot(x - 1.3, z) > 0.6);
    expect(footprintClear(w, 0, 0, METIN_FOOT_R)).toBe(false);
    expect(footprintClear(w, -5, 0, METIN_FOOT_R)).toBe(true);
  });
  it('accepts open ground and rejects a blocked centre', () => {
    const w = world(() => true);
    expect(footprintClear(w, 3, 4, METIN_FOOT_R)).toBe(true);
    const w2 = world((x, z) => Math.hypot(x, z) > 0.3);
    expect(footprintClear(w2, 0, 0, METIN_FOOT_R)).toBe(false);
  });
});
