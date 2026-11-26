import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { freshSave } from './__fixtures__/testkit';
import { PITY_BONUS, PITY_GUARANTEE, dropGroupsFor, rollGearDrops, type DropInput } from './drops';
import { seededRng } from './rng';
import type { MetaRng } from './types';

const C = fixtureContent;
const always = (v: number): MetaRng => ({ next: () => v });

function input(over: Partial<DropInput> = {}): DropInput {
  return { zone: 'yeonmu', classId: 'warrior', difficulty: 'normal', victory: false, time: 700, bossesKilled: [], ...over };
}

describe('drop groups', () => {
  it('one group per boss kill, restricted to the class and the boss', () => {
    const g = dropGroupsFor(C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: 'boss', key: 'yeonmu_boss1', scale: 1 });
    expect(g[0]?.defs.map((d) => d.id)).toEqual(['yeonmu_armor_warrior', 'yeonmu_weapon_warrior']);
    const ninja = dropGroupsFor(C, input({ classId: 'ninja', bossesKilled: ['yeonmu_boss1'], time: 10 }));
    expect(ninja[0]?.defs.map((d) => d.id)).toEqual(['yeonmu_armor_ninja', 'yeonmu_weapon_ninja']);
  });

  it('killing the same boss twice rolls twice; other zones never leak in', () => {
    expect(dropGroupsFor(C, input({ bossesKilled: ['yeonmu_boss1', 'yeonmu_boss1'], time: 10 }))).toHaveLength(2);
    expect(dropGroupsFor(C, input({ bossesKilled: ['seori_boss1'], time: 10 }))).toHaveLength(0);
  });

  it('zone (jewelry) group needs a victory or a third of the run, and is halved on defeat', () => {
    expect(dropGroupsFor(C, input({ time: 100 }))).toHaveLength(0);
    const defeat = dropGroupsFor(C, input({ time: 450 }));
    expect(defeat).toHaveLength(1);
    expect(defeat[0]).toMatchObject({ kind: 'zone', scale: 0.5 });
    expect(defeat[0]?.defs.map((d) => d.id)).toEqual(['yeonmu_bracelet', 'yeonmu_earrings', 'yeonmu_necklace']);
    const win = dropGroupsFor(C, input({ victory: true, time: 900 }));
    expect(win.map((g) => `${g.kind}:${g.key}`)).toEqual(['boss:yeonmu_final', 'zone:yeonmu']);
    expect(win[1]?.scale).toBe(1);
  });
});

describe('rolling', () => {
  it('chance per piece ≈ GearDef.source.chance (statistical, fresh profiles)', () => {
    const N = 6000;
    const rng = seededRng(7);
    let weapon = 0;
    let armor = 0;
    for (let i = 0; i < N; i++) {
      const r = rollGearDrops(freshSave(), C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), rng);
      for (const d of r.drops) {
        if (d.gearId === 'yeonmu_weapon_warrior') weapon++;
        if (d.gearId === 'yeonmu_armor_warrior') armor++;
      }
    }
    const p = 0.3;
    const tol = 4 * Math.sqrt((p * (1 - p)) / N);
    expect(Math.abs(weapon / N - p)).toBeLessThan(tol);
    expect(Math.abs(armor / N - p)).toBeLessThan(tol);
  });

  it('hard mode multiplies the chance by balance.hard.reward; luck scales it too', () => {
    const N = 6000;
    const count = (over: Partial<DropInput>): number => {
      const rng = seededRng(99);
      let n = 0;
      for (let i = 0; i < N; i++) {
        const r = rollGearDrops(freshSave(), C, input({ bossesKilled: ['yeonmu_boss1'], time: 10, ...over }), rng);
        if (r.drops.some((d) => d.gearId === 'yeonmu_weapon_warrior')) n++;
      }
      return n / N;
    };
    const tol = (p: number): number => 4 * Math.sqrt((p * (1 - p)) / N);
    expect(Math.abs(count({ difficulty: 'hard' }) - 0.3 * C.balance.hard.reward)).toBeLessThan(tol(0.45));
    expect(Math.abs(count({ luck: 1 }) - 0.6)).toBeLessThan(tol(0.6));
  });

  it('a new piece is granted and auto-equipped; the input save is untouched', () => {
    const s = freshSave();
    const r = rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), always(0));
    expect(r.drops.map((d) => d.gearId)).toEqual(['yeonmu_armor_warrior', 'yeonmu_weapon_warrior']);
    expect(r.drops.every((d) => d.isNew && d.autoEquipped && !d.guaranteed)).toBe(true);
    expect(r.save.classes.warrior.gear).toMatchObject({ armor: 'yeonmu_armor_warrior', weapon: 'yeonmu_weapon_warrior' });
    expect(s.classes.warrior.collection).toEqual([]);
    expect(r.pity).toEqual({ before: 0, after: 0 });
  });

  it('duplicates convert to shards and do not advance pity when nothing is left to find', () => {
    let s = rollGearDrops(freshSave(), C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), always(0)).save;
    s.classes.warrior.pity = 3;
    const r = rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), always(0));
    expect(r.drops).toHaveLength(2);
    expect(r.drops.every((d) => !d.isNew && d.shards > 0)).toBe(true);
    expect(r.save.bank.shards).toBe(r.drops.reduce((a, d) => a + d.shards, 0));
    expect(r.pity).toEqual({ before: 3, after: 3 });
    s = r.save;
    expect(s.classes.warrior.collection).toHaveLength(2);
  });

  it('a duplicate-only roll with unowned pieces left still counts as a miss', () => {
    const s = freshSave();
    s.classes.warrior.collection.push('yeonmu_weapon_warrior');
    // armor misses (0.999), weapon (index order: armor, weapon) — force only weapon hit by per-call values
    const seq = [0.999, 0.0];
    let i = 0;
    const rng: MetaRng = { next: () => seq[i++ % seq.length] as number };
    const r = rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), rng);
    expect(r.drops.map((d) => [d.gearId, d.isNew])).toEqual([['yeonmu_weapon_warrior', false]]);
    expect(r.pity.after).toBe(1);
  });

  it('pity: misses raise the chance, then the guarantee delivers a NEW piece and resets', () => {
    let s = freshSave();
    const miss = always(0.999999);
    for (let i = 0; i < PITY_GUARANTEE; i++) {
      const r = rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), miss);
      expect(r.drops).toHaveLength(0);
      expect(r.pity.after).toBe(i + 1);
      s = r.save;
    }
    expect(s.classes.warrior.pity).toBe(PITY_GUARANTEE);
    const g = rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), miss);
    expect(g.drops).toHaveLength(1);
    expect(g.drops[0]).toMatchObject({ isNew: true, guaranteed: true });
    expect(g.pity).toEqual({ before: PITY_GUARANTEE, after: 0 });
    expect(g.save.classes.warrior.pity).toBe(0);
  });

  it('pity bonus raises the effective chance linearly', () => {
    // chance 0.3 × (1 + PITY_BONUS × 5) = 0.6 → roll 0.55 hits only with 5 misses banked
    const s = freshSave();
    const rng = always(0.55);
    expect(rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), rng).drops).toHaveLength(0);
    s.classes.warrior.pity = 5;
    expect(0.3 * (1 + PITY_BONUS * 5)).toBeCloseTo(0.6);
    expect(rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), rng).drops).toHaveLength(2);
  });

  it('pity never exceeds the guarantee and a class eventually completes a boss set (seeded long run)', () => {
    const rng = seededRng(31337);
    let s = freshSave();
    let maxPity = 0;
    for (let i = 0; i < 300; i++) {
      const r = rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), rng);
      maxPity = Math.max(maxPity, r.pity.after);
      s = r.save;
    }
    expect(maxPity).toBeLessThanOrEqual(PITY_GUARANTEE);
    expect(s.classes.warrior.collection).toEqual(expect.arrayContaining(['yeonmu_armor_warrior', 'yeonmu_weapon_warrior']));
  });

  it('is deterministic for a given seed', () => {
    const run = (seed: number): string[] => {
      const rng = seededRng(seed);
      return rollGearDrops(freshSave(), C, input({ victory: true, time: 900, bossesKilled: ['yeonmu_boss1', 'yeonmu_boss2'] }), rng).drops.map((d) => d.gearId);
    };
    expect(run(5)).toEqual(run(5));
  });

  it('custom pity options are honoured', () => {
    const miss = always(0.999999);
    const s = freshSave();
    s.classes.warrior.pity = 2;
    const r = rollGearDrops(s, C, input({ bossesKilled: ['yeonmu_boss1'], time: 10 }), miss, { pityGuarantee: 2 });
    expect(r.drops).toHaveLength(1);
    expect(r.drops[0]?.guaranteed).toBe(true);
  });
});
