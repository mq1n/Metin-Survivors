import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../data/schema';
import { cpuNow, withinBudget } from '../../dev/perfBudget';
import { createTerrainField } from '../../world/terrainField';
import { bakeLight } from './bakeLight';

// Every test bakes (or reuses) a whole Yeonmu field first, then a few 512² light maps. The vitest default of 5 s is a hang
// guard, and a parallel run on a busy machine can eat it, so each test states its own; the performance gate is the CPU-time
// budget on the first test (dev/perfBudget.ts), not a timeout.
const HANG_GUARD_MS = 60_000;

function biome(id: string): BiomePreset {
  return {
    id,
    seed: 77,
    ground: [],
    trees: [],
    props: [],
    fog: { color: '#aabbcc', near: 40, far: 160 },
    sky: { top: '#223344', horizon: '#aabbcc', bottom: '#556677' },
    sun: { color: '#fff1d6', intensity: 2.4, dir: [-0.4, 0.8, 0.45] },
    ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.8 },
    relief: { height: 20, roughness: 0.5, features: [] },
  };
}

describe('bakeLight', () => {
  it('produces a full RGBA texture with shadowed and lit texels', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: -0.4, y: 0.8, z: 0.45 };
    // one 512² light bake costs ~60 ms of CPU; the gate is 1000 ms (an accidental per-texel scan would blow through it)
    const bake = withinBudget(
      () => {
        const t0 = cpuNow();
        const out = bakeLight(field, sun, 512);
        return { value: out, ms: cpuNow() - t0 };
      },
      { baseMs: 1000 },
    );
    expect(bake.ms, bake.log).toBeLessThanOrEqual(bake.budget);
    const baked = bake.value;
    expect(baked.data.length).toBe(512 * 512 * 4);
    let shadowed = 0;
    let lit = 0;
    let alphaOff = 0;
    for (let o = 0; o < 512 * 512; o++) {
      const v = baked.data[o * 4] as number;
      if (v < 150) shadowed++;
      if (v > 240) lit++;
      if (baked.data[o * 4 + 3] !== 255) alphaOff++;
    }
    // without the C1 foot option the alpha channel stays 255 everywhere (counted, not one expect per texel)
    expect(alphaOff).toBe(0);
    expect(lit).toBeGreaterThan(512 * 512 * 0.3);
    expect(shadowed).toBeGreaterThan(200);
    const again = bakeLight(field, sun, 512);
    expect(Array.from(again.data.slice(40000, 40100))).toEqual(Array.from(baked.data.slice(40000, 40100)));
  }, HANG_GUARD_MS);

  it('C2 soft: blurs the baked sun visibility and AO, defaults reproduce the hard bake', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: -0.4, y: 0.8, z: 0.45 };
    const hard = bakeLight(field, sun, 512);
    expect(Array.from(bakeLight(field, sun, 512, { soft: 0 }).data)).toEqual(Array.from(hard.data));
    const soft = bakeLight(field, sun, 512, { soft: 3 });
    // total variation of the visibility channel drops; the mean stays about the same; B (liquid) is untouched
    let tvHard = 0;
    let tvSoft = 0;
    let sumHard = 0;
    let sumSoft = 0;
    let liquidSame = true;
    for (let j = 0; j < 512; j++) {
      for (let i = 1; i < 512; i++) {
        const o = (j * 512 + i) * 4;
        tvHard += Math.abs((hard.data[o] as number) - (hard.data[o - 4] as number));
        tvSoft += Math.abs((soft.data[o] as number) - (soft.data[o - 4] as number));
        sumHard += hard.data[o] as number;
        sumSoft += soft.data[o] as number;
        if (hard.data[o + 2] !== soft.data[o + 2]) liquidSame = false;
      }
    }
    expect(tvSoft).toBeLessThan(tvHard * 0.8);
    expect(Math.abs(sumSoft - sumHard) / sumHard).toBeLessThan(0.02);
    expect(liquidSame).toBe(true);
  }, HANG_GUARD_MS);

  it('C1 foot: bakes a cliff-foot band into alpha only when asked', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: -0.4, y: 0.8, z: 0.45 };
    const foot = bakeLight(field, sun, 512, { footWidth: 4 });
    let band = 0;
    let full = 0;
    for (let o = 0; o < 512 * 512; o++) {
      const a = foot.data[o * 4 + 3] as number;
      if (a > 128) band++;
      if (a === 255) full++;
    }
    // a band at the foot of the rim cliffs: present, but a small share of the domain
    expect(band).toBeGreaterThan(500);
    expect(band).toBeLessThan(512 * 512 * 0.2);
    expect(full).toBeLessThan(512 * 512 * 0.2);
  }, HANG_GUARD_MS);

  it('settle rocks knob: a longer shadow and an AO halo for the loose stones only, absent = the bake as it was', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: -0.4, y: 0.8, z: 0.45 };
    const plain = bakeLight(field, sun, 512);
    const same = bakeLight(field, sun, 512, {});
    expect(Array.from(same.data.slice(40000, 40400))).toEqual(Array.from(plain.data.slice(40000, 40400)));
    const knob = bakeLight(field, sun, 512, { rocks: { reach: 3, width: 1.3, strength: 1.2, halo: 2, ao: 1.5 } });
    let darker = 0;
    let lighter = 0;
    for (let o = 0; o < 512 * 512; o++) {
      const a = plain.data[o * 4] as number;
      const b = knob.data[o * 4] as number;
      if (b < a) darker++;
      if (b > a) lighter++;
    }
    // loose rocks only ever add shadow (the min of the old and the new buffer); the wall blocks and every other texel stay
    expect(darker).toBeGreaterThan(50);
    expect(lighter).toBe(0);
  }, HANG_GUARD_MS);

  it('trees darken the texels they shade', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: 0, y: 1, z: 0.0001 };
    const baked = bakeLight(field, sun, 512);
    const tree = field.layout.trees[0];
    if (!tree) return;
    const k = 512 / field.size;
    const i = Math.floor((tree.x + field.size / 2) * k);
    const j = Math.floor((tree.z + field.size / 2) * k);
    const ao = baked.data[(j * 512 + i) * 4 + 1] as number;
    expect(ao).toBeLessThan(250);
  }, HANG_GUARD_MS);
});
