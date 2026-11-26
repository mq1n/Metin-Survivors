// ROCK-01: the light-pool bake. Prop pools (pools[<prop id>]) bake exactly what they always did (checked against a verbatim copy of the
// pre-ROCK-01 algorithm); a 'rock:<kind>' key lights every placed rock of that kind, radius = spec.radius x the rock footprint.
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { PropPlacement, RockKind, RockPlacement } from '../../world/layoutTypes';
import type { TerrainField } from '../../world/terrainField';
import type { PoolSpec } from './look/types';
import { bakePools, rockPoolKey } from './bakePools';

const RES = 64;
const SIZE = 64; // 1 m per texel

function rock(kind: RockKind, x: number, z: number, sx: number, sz = sx): RockPlacement {
  return { kind, x, z, y: 0, sx, sy: 2, sz, yaw: 0, seed: 1, mat: 0 };
}
function prop(id: string, x: number, z: number, scale = 1): PropPlacement {
  return { id, x, z, y: 0, yaw: 0, scale, seed: 1 };
}
function field(props: PropPlacement[], rocks: RockPlacement[]): TerrainField {
  return { size: SIZE, layout: { props, rocks } } as unknown as TerrainField;
}

/** the pre-ROCK-01 bakePools, verbatim (props only) */
function bakeOld(f: TerrainField, pools: Record<string, PoolSpec>, res: number): Uint8Array {
  const half = f.size / 2;
  const texel = f.size / res;
  const rgb = new Float32Array(res * res * 3);
  const flick = new Float32Array(res * res);
  const col = new Color();
  for (const p of f.layout.props) {
    const spec = pools[p.id];
    if (!spec) continue;
    col.set(spec.color);
    const r = spec.radius * p.scale;
    const i0 = Math.max(0, Math.floor((p.x - r + half) / texel));
    const i1 = Math.min(res - 1, Math.ceil((p.x + r + half) / texel));
    const j0 = Math.max(0, Math.floor((p.z - r + half) / texel));
    const j1 = Math.min(res - 1, Math.ceil((p.z + r + half) / texel));
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * texel;
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * texel;
        const t = Math.hypot(x - p.x, z - p.z) / r;
        if (t >= 1) continue;
        const skirt = (1 - t * t) * (1 - t * t);
        const core = 0.45 * Math.exp(-(t * 3.2) * (t * 3.2));
        const k = (skirt + core) * spec.intensity * 0.5;
        const o = j * res + i;
        rgb[o * 3] = (rgb[o * 3] as number) + col.r * k;
        rgb[o * 3 + 1] = (rgb[o * 3 + 1] as number) + col.g * k;
        rgb[o * 3 + 2] = (rgb[o * 3 + 2] as number) + col.b * k;
        flick[o] = Math.max(flick[o] as number, (spec.flicker ?? 0) * Math.min(1, skirt + core));
      }
    }
  }
  const data = new Uint8Array(res * res * 4);
  for (let o = 0; o < res * res; o++) {
    data[o * 4] = Math.round(Math.min(1, rgb[o * 3] as number) * 255);
    data[o * 4 + 1] = Math.round(Math.min(1, rgb[o * 3 + 1] as number) * 255);
    data[o * 4 + 2] = Math.round(Math.min(1, rgb[o * 3 + 2] as number) * 255);
    data[o * 4 + 3] = Math.round(Math.min(1, flick[o] as number) * 255);
  }
  return data;
}

const LANTERN: PoolSpec = { color: '#ffb060', intensity: 1.2, radius: 6, flicker: 0.3 };
const CRYSTAL: PoolSpec = { color: '#7fc4ff', intensity: 1, radius: 3 };

/** texel index of a world point (centre of the field is 0,0) */
const at = (x: number, z: number): number => (Math.floor(z + SIZE / 2) * RES + Math.floor(x + SIZE / 2)) * 4;
const lit = (d: Uint8Array): number => {
  let n = 0;
  for (let o = 0; o < RES * RES; o++) if ((d[o * 4] as number) + (d[o * 4 + 1] as number) + (d[o * 4 + 2] as number) > 0) n++;
  return n;
};

describe('rockPoolKey', () => {
  it('is rock:<kind>', () => {
    expect(rockPoolKey('crystal')).toBe('rock:crystal');
  });
});

describe('prop pools are unchanged', () => {
  const props = [prop('stone_lantern', -10, 4), prop('stone_lantern', -7, 6, 0.6), prop('brazier', 15, -12, 1.4), prop('barrel', 0, 0)];
  const pools = { stone_lantern: LANTERN, brazier: { color: '#ff7a30', intensity: 2, radius: 8, flicker: 0.6 } };

  it('a zone without rock keys bakes exactly the old texture', () => {
    const f = field(props, [rock('crystal', 20, 20, 1.2), rock('boulder', -20, -20, 3)]);
    expect(Array.from(bakePools(f, pools, RES))).toEqual(Array.from(bakeOld(f, pools, RES)));
  });

  it('rock keys with no matching rock add nothing', () => {
    const f = field(props, [rock('boulder', 20, 20, 3)]);
    expect(Array.from(bakePools(f, { ...pools, 'rock:crystal': CRYSTAL }, RES))).toEqual(Array.from(bakeOld(f, pools, RES)));
  });

  it('a rock pool far from the props leaves every prop texel alone', () => {
    const f = field(props, [rock('crystal', 28, 28, 1)]);
    const withRock = bakePools(f, { ...pools, 'rock:crystal': CRYSTAL }, RES);
    const old = bakeOld(f, pools, RES);
    // the crystal pool spans x,z in 25..31 (r 3); everything outside that box is the old texture
    for (let z = 0; z < RES; z++) {
      for (let x = 0; x < RES; x++) {
        const wx = x - SIZE / 2;
        const wz = z - SIZE / 2;
        if (wx >= 24 && wz >= 24) continue;
        for (let c = 0; c < 4; c++) expect(withRock[(z * RES + x) * 4 + c]).toBe(old[(z * RES + x) * 4 + c]);
      }
    }
  });

  it('a prop id never matches a rock key', () => {
    const f = field([prop('crystal', 0, 0)], []);
    expect(lit(bakePools(f, { 'rock:crystal': CRYSTAL }, RES))).toBe(0);
  });
});

describe('rock-kind pools', () => {
  const pools = { 'rock:crystal': CRYSTAL };

  it('light the ground under a rock of that kind and only within radius x footprint', () => {
    const f = field([], [rock('crystal', 5, -7, 1.5, 1)]);
    const d = bakePools(f, pools, RES);
    const R = 3 * 1.5; // radius x the larger horizontal size
    expect(d[at(5, -7) + 2]).toBeGreaterThan(0);
    expect(d[at(5, -7) + 0]).toBeGreaterThan(0);
    // blue-dominant (the pool colour is #7fc4ff)
    expect(d[at(5, -7) + 2] as number).toBeGreaterThan(d[at(5, -7) + 0] as number);
    expect(d[at(5 + R - 1.5, -7) + 2]).toBeGreaterThan(0);
    expect(d[at(5 + R + 1.5, -7) + 2]).toBe(0);
    expect(d[at(5, -7 + R + 1.5) + 2]).toBe(0);
    // the centre is the brightest texel and the skirt falls off
    expect(d[at(5, -7) + 2] as number).toBeGreaterThan(d[at(5 + 3, -7) + 2] as number);
    expect(d[at(5 + 3, -7) + 2] as number).toBeGreaterThanOrEqual(d[at(5 + 4, -7) + 2] as number);
  });

  it('only the keyed kind lights', () => {
    const f = field([], [rock('boulder', 5, 5, 3), rock('slab', -9, 9, 3), rock('spire', 9, -9, 2)]);
    expect(lit(bakePools(f, pools, RES))).toBe(0);
    expect(lit(bakePools(f, { 'rock:boulder': CRYSTAL }, RES))).toBeGreaterThan(0);
  });

  it('a bigger rock casts a bigger pool', () => {
    const small = lit(bakePools(field([], [rock('crystal', 0, 0, 0.8)]), pools, RES));
    const big = lit(bakePools(field([], [rock('crystal', 0, 0, 2.4)]), pools, RES));
    expect(big).toBeGreaterThan(small * 3);
  });

  it('the pools of a cluster add up (clamped at 1) and the flicker amplitude follows the spec', () => {
    const one = bakePools(field([], [rock('crystal', 0, 0, 1)]), { 'rock:crystal': { ...CRYSTAL, flicker: 0.5 } }, RES);
    const three = bakePools(field([], [rock('crystal', 0, 0, 1), rock('crystal', 1, 0, 0.7), rock('crystal', 0, 1, 0.7)]), { 'rock:crystal': { ...CRYSTAL, flicker: 0.5 } }, RES);
    expect(three[at(0, 0) + 2] as number).toBeGreaterThanOrEqual(one[at(0, 0) + 2] as number);
    expect(three[at(1, 1) + 2] as number).toBeGreaterThan(one[at(1, 1) + 2] as number);
    expect(one[at(0, 0) + 3]).toBeGreaterThan(0);
    expect(one[at(0, 0) + 3] as number).toBeLessThanOrEqual(Math.round(0.5 * 255));
    const hot = bakePools(field([], [rock('crystal', 0, 0, 1), rock('crystal', 0.2, 0, 1), rock('crystal', 0, 0.2, 1), rock('crystal', 0.2, 0.2, 1)]), { 'rock:crystal': { ...CRYSTAL, intensity: 6 } }, RES);
    expect(hot[at(0, 0) + 2]).toBe(255);
  });

  it('rock pools and prop pools add on the same texels', () => {
    const p = prop('stone_lantern', 0, 0);
    const props = bakePools(field([p], []), { stone_lantern: LANTERN, ...pools }, RES);
    const both = bakePools(field([p], [rock('crystal', 1, 0, 1)]), { stone_lantern: LANTERN, ...pools }, RES);
    expect(both[at(1, 0) + 2] as number).toBeGreaterThan(props[at(1, 0) + 2] as number);
  });

  it('a zero radius or an empty rock list is a no-op', () => {
    expect(lit(bakePools(field([], [rock('crystal', 0, 0, 1)]), { 'rock:crystal': { ...CRYSTAL, radius: 0 } }, RES))).toBe(0);
    expect(lit(bakePools(field([], []), pools, RES))).toBe(0);
  });

  it('a rock at the edge of the domain stays inside the texture', () => {
    const f = field([], [rock('crystal', 31.5, -31.5, 2), rock('crystal', -40, 40, 2)]);
    const d = bakePools(f, pools, RES);
    expect(d.length).toBe(RES * RES * 4);
    expect(d[at(31, -31) + 2]).toBeGreaterThan(0);
  });
});
