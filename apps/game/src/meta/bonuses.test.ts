import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { freshSave } from './__fixtures__/testkit';
import { content } from '../data/loader';
import { createWorld } from '../sim/world';
import { FAVOUR_CAP, FAVOUR_PER_FAIL, bonusContextFor, computeMetaBonusDetail, computeMetaBonuses, favourFor } from './bonuses';
import { doctrineId, indexContent } from './content';
import { grantGear } from './gear';
import { seededRng } from './rng';
import { newProfile } from './save';
import { allocateTalent, xpForPoints } from './talents';
import type { SaveData } from './types';

const C = fixtureContent;

function gear(s: SaveData, id: string, cls: 'warrior' | 'ninja' = 'warrior'): SaveData {
  const r = grantGear(s, C, cls, id, true);
  if (!r.ok) throw new Error(r.reason);
  return r.save;
}

/** Saturates nodes in row-rank/column order until `n` points are spent. */
function fill(s: SaveData, key: 'a' | 'b', n: number): SaveData {
  let cur = s;
  let spent = 0;
  const tree = indexContent(C).trees.get(doctrineId('warrior', key));
  if (!tree) throw new Error('fixture');
  for (const rank of tree.byRank) {
    for (const node of rank) {
      while (spent < n) {
        const r = allocateTalent(cur, C, 'warrior', key, node.id);
        if (!r.ok) break;
        cur = r.save;
        spent++;
      }
    }
  }
  return cur;
}

describe('MetaBonuses', () => {
  it('empty profile = empty bonuses; the empire bonus is reported in the breakdown but never in the run bonuses', () => {
    expect(computeMetaBonuses(freshSave(), C, { classId: 'warrior', doctrine: 'a' })).toEqual({ stats: {} });
    // the sim applies the empire from RunConfig.empire itself (sim/player.ts): MetaBonuses must not carry it a second time
    expect(computeMetaBonuses(freshSave(), C, { classId: 'warrior', doctrine: 'a', empire: 'saehwa' })).toEqual({ stats: {} });
    expect(computeMetaBonuses(freshSave(), C, { classId: 'warrior', doctrine: 'a', empire: 'jihae' }).stats).toEqual({});
    const d = computeMetaBonusDetail(freshSave(), C, { classId: 'warrior', doctrine: 'a', empire: 'jihae' });
    expect(d.breakdown.empire).toEqual({ yeopGain: 0.1, luck: 0.1 });
    expect(d.bonuses.stats).toEqual({});
  });

  it('applies only the chosen doctrine tree', () => {
    let s = freshSave();
    s.classes.warrior.xp = xpForPoints(10);
    for (let i = 0; i < 3; i++) s = (allocateTalent(s, C, 'warrior', 'a', 'r0c0') as { save: SaveData }).save;
    s = (allocateTalent(s, C, 'warrior', 'b', 'r0c1') as { save: SaveData }).save;
    expect(computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a' }).stats.damage).toBeCloseTo(0.03);
    expect(computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a' }).stats.maxHp).toBeUndefined();
    expect(computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'b' }).stats).toMatchObject({ maxHp: 5, armor: 0.5 });
    expect(computeMetaBonuses(s, C, { classId: 'ninja', doctrine: 'a' }).stats).toEqual({});
  });

  it('gear stats include +N blacksmith bonuses and stack with talents (the empire stays in the breakdown)', () => {
    let s = gear(freshSave(), 'yeonmu_weapon_warrior');
    s = gear(s, 'yeonmu_armor_warrior');
    s.classes.warrior.plus.yeonmu_weapon_warrior = 3;
    s.classes.warrior.plus.yeonmu_armor_warrior = 9;
    s.classes.warrior.xp = xpForPoints(3);
    for (let i = 0; i < 3; i++) s = (allocateTalent(s, C, 'warrior', 'a', 'r0c0') as { save: SaveData }).save;
    const d = computeMetaBonusDetail(s, C, { classId: 'warrior', doctrine: 'a', empire: 'saehwa' });
    const b = d.bonuses;
    expect(b.stats.damage).toBeCloseTo(0.08 + 0.02 * 3 + 0.03); // weapon +3 + talents
    expect(b.stats.armor).toBeCloseTo(6 + 1.5 * 9);
    expect(b.stats.maxHp).toBeCloseTo(20 + 6 * 9);
    expect(b.stats.maxHpPct).toBeUndefined();
    expect(d.breakdown.empire).toEqual({ maxHpPct: 0.1 });
  });

  it('merges nested vsRace entries from gear and talents', () => {
    let s = gear(freshSave(), 'yeonmu_necklace');
    s.classes.warrior.plus.yeonmu_necklace = 2;
    s.classes.warrior.xp = xpForPoints(10);
    for (const n of ['r0c0', 'r0c0', 'r0c0', 'r0c2', 'r0c2']) s = (allocateTalent(s, C, 'warrior', 'a', n) as { save: SaveData }).save;
    const b = computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a' });
    expect(b.stats.vsRace?.animal).toBeCloseTo(0.05 + 0.01 * 2);
    expect(b.stats.vsRace?.orc).toBeCloseTo(0.02);
  });

  it('maps talent effects and milestone skills; reports unmapped kinds', () => {
    let s = freshSave();
    s.classes.warrior.xp = xpForPoints(40);
    s = fill(s, 'a', 40);
    const d = computeMetaBonusDetail(s, C, { classId: 'warrior', doctrine: 'a' });
    expect(d.bonuses.startLevel).toBe(4); // 1 + value 1 × rank 3
    expect(d.bonuses.banishes).toBe(3);
    expect(d.bonuses.rerolls).toBeUndefined();
    expect(d.bonuses.skillMods).toEqual({ warrior_a1: { damage: expect.closeTo(0.15, 6), area: expect.closeTo(0.06, 6) } });
    expect(d.bonuses.extraSkills).toEqual(['warrior_a_ult10', 'warrior_a_ult30']);
    expect(d.breakdown.milestones).toEqual(['warrior_a@10', 'warrior_a@20', 'warrior_a@30']);
    expect(d.breakdown.unmappedEffects).toEqual([{ node: 'r1c2', kind: 'weirdUnknownKind' }]);
  });

  it('below the first milestone grants nothing extra', () => {
    let s = freshSave();
    s.classes.warrior.xp = xpForPoints(9);
    s = fill(s, 'a', 9);
    const b = computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a' });
    expect(b.extraSkills).toBeUndefined();
    expect(b.startLevel).toBeUndefined();
  });

  it('ignores equipped entries that are not owned, mismatched, or unknown', () => {
    const s = freshSave();
    s.classes.warrior.gear.weapon = 'yeonmu_weapon_warrior'; // not in collection
    s.classes.warrior.gear.armor = 'yeonmu_armor_ninja'; // wrong class
    s.classes.warrior.gear.helmet = 'ghost';
    expect(computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a' }).stats).toEqual({});
  });

  it('is pure and deterministic', () => {
    const s = gear(freshSave(), 'yeonmu_weapon_warrior');
    const snapshot = structuredClone(s);
    const a = computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a', empire: 'chowon' });
    const b = computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a', empire: 'chowon' });
    expect(a).toEqual(b);
    expect(s).toEqual(snapshot);
    // mutating the result must not corrupt content
    a.stats.damage = 99;
    expect(C.gear.find((g) => g.id === 'yeonmu_weapon_warrior')?.stats.damage).toBe(0.08);
    expect(C.empires.find((e) => e.id === 'chowon')?.bonus).toEqual({ xpGain: 0.1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// MT-01 - Sky Sovereign's Favour: every failed attempt at a zone makes the next one a little easier, until the first clear.

/** A copy of `s` with the given run / clear counts for one zone + difficulty. */
function withZone(s: SaveData, zone: string, runs: number, clears: number, difficulty: 'normal' | 'hard' = 'normal'): SaveData {
  const c = structuredClone(s);
  const entry = (c.stats.zones[zone] ??= {});
  entry[difficulty] = { runs, clears, bestScore: 0, bestTime: 0, bestLevel: 0 };
  return c;
}

const ctxAt = (zone: string, difficulty: 'normal' | 'hard' = 'normal') => ({ classId: 'warrior' as const, doctrine: 'a' as const, zone, difficulty });

describe("Sky Sovereign's Favour (MT-01)", () => {
  it('0 / 3 / 7 failed attempts give 0 / 9 / 15 % damage and max HP', () => {
    const base = freshSave();
    const at = (n: number) => computeMetaBonusDetail(withZone(base, 'daeryeol', n, 0), C, ctxAt('daeryeol'));
    // no attempts yet: nothing at all (no zero-valued keys either, the bonuses stay `{ stats: {} }`)
    expect(at(0).bonuses).toEqual({ stats: {} });
    expect(at(0).breakdown.favour).toEqual({});
    const three = at(3);
    expect(three.bonuses.stats.damage).toBeCloseTo(0.09, 9);
    expect(three.bonuses.stats.maxHpPct).toBeCloseTo(0.09, 9);
    expect(three.breakdown.favour).toEqual({ damage: expect.closeTo(0.09, 9), maxHpPct: expect.closeTo(0.09, 9) });
    const seven = at(7);
    expect(seven.bonuses.stats.damage).toBeCloseTo(0.15, 9);
    expect(seven.bonuses.stats.maxHpPct).toBeCloseTo(0.15, 9);
    // the exported helper (RP-01 / RP-02 read it) agrees with the stats
    expect([0, 3, 7].map((n) => favourFor(withZone(base, 'daeryeol', n, 0), 'daeryeol', 'normal'))).toEqual([0, expect.closeTo(0.09, 9), 0.15]);
  });

  it('is +3 % per failure up to the +15 % cap (five failures reach it, more change nothing)', () => {
    expect(FAVOUR_PER_FAIL).toBe(0.03);
    expect(FAVOUR_CAP).toBe(0.15);
    const base = freshSave();
    const f = (n: number) => favourFor(withZone(base, 'seori', n, 0), 'seori', 'normal');
    expect([1, 2, 3, 4, 5].map(f)).toEqual([0.03, 0.06, 0.09, 0.12, 0.15]);
    expect([6, 7, 40, 1e9].map(f)).toEqual([0.15, 0.15, 0.15, 0.15]);
  });

  it('is 0 after the first clear, however many attempts it took', () => {
    const base = freshSave();
    for (const [runs, clears] of [
      [4, 1],
      [8, 1],
      [2, 2],
    ] as const) {
      const s = withZone(base, 'suryeon', runs, clears);
      expect(favourFor(s, 'suryeon', 'normal')).toBe(0);
      expect(computeMetaBonuses(s, C, ctxAt('suryeon'))).toEqual({ stats: {} });
    }
  });

  it('other zones and the other difficulty are unaffected', () => {
    // 6 failed normal attempts at Seori: Seori normal has the full favour, nothing else does
    const s = withZone(freshSave(), 'seori', 6, 0);
    expect(favourFor(s, 'seori', 'normal')).toBe(0.15);
    expect(favourFor(s, 'seori', 'hard')).toBe(0);
    for (const z of ['yeonmu', 'suryeon', 'daeryeol', 'no_such_zone']) expect(favourFor(s, z, 'normal')).toBe(0);
    expect(computeMetaBonuses(s, C, ctxAt('yeonmu')).stats).toEqual({});
    expect(computeMetaBonuses(s, C, ctxAt('seori', 'hard')).stats).toEqual({});
    // hard counts its own attempts and its own first clear
    const h = withZone(withZone(freshSave(), 'seori', 9, 1), 'seori', 2, 0, 'hard');
    expect(favourFor(h, 'seori', 'normal')).toBe(0);
    expect(favourFor(h, 'seori', 'hard')).toBeCloseTo(0.06, 9);
    expect(computeMetaBonuses(h, C, ctxAt('seori', 'hard')).stats).toEqual({ damage: expect.closeTo(0.06, 9), maxHpPct: expect.closeTo(0.06, 9) });
  });

  it('without a zone and difficulty in the context there is no favour (armory sheet, settlement luck)', () => {
    const s = withZone(freshSave(), 'seori', 6, 0);
    expect(computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a' })).toEqual({ stats: {} });
    expect(computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a', zone: 'seori' })).toEqual({ stats: {} });
    expect(computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a', difficulty: 'normal' })).toEqual({ stats: {} });
  });

  it('adds on top of talents and gear, and the empire bonus stays out of the run bonuses', () => {
    let s = gear(freshSave(), 'yeonmu_weapon_warrior');
    s.classes.warrior.plus.yeonmu_weapon_warrior = 3;
    s.classes.warrior.xp = xpForPoints(3);
    for (let i = 0; i < 3; i++) s = (allocateTalent(s, C, 'warrior', 'a', 'r0c0') as { save: SaveData }).save;
    const before = computeMetaBonuses(s, C, { classId: 'warrior', doctrine: 'a', empire: 'saehwa' });
    const after = computeMetaBonusDetail(withZone(s, 'daeryeol', 4, 0), C, { ...ctxAt('daeryeol'), empire: 'saehwa' });
    expect(after.bonuses.stats.damage).toBeCloseTo((before.stats.damage ?? 0) + 0.12, 9);
    expect(after.bonuses.stats.maxHpPct).toBeCloseTo(0.12, 9); // the empire's +10 % is NOT in here
    expect(after.breakdown.empire).toEqual({ maxHpPct: 0.1 });
    expect(after.breakdown.talents.damage).toBeCloseTo(0.03, 9);
    expect(after.breakdown.gear.damage).toBeCloseTo(0.08 + 0.02 * 3, 9);
    // everything but the two favour stats is as without it
    expect({ ...after.bonuses, stats: { ...after.bonuses.stats, damage: 0, maxHpPct: 0 } }).toEqual({ ...before, stats: { ...before.stats, damage: 0, maxHpPct: 0 } });
  });

  it('survives damaged zone stats (negative, fractional, missing, non-finite) and never mutates the save', () => {
    const s = freshSave();
    const set = (rec: unknown): SaveData => {
      const c = structuredClone(s);
      c.stats.zones['seori'] = { normal: rec as never };
      return c;
    };
    expect(favourFor(set({ runs: -3, clears: 0 }), 'seori', 'normal')).toBe(0);
    expect(favourFor(set({ runs: Number.NaN, clears: 0 }), 'seori', 'normal')).toBe(0);
    expect(favourFor(set({ runs: Infinity, clears: 0 }), 'seori', 'normal')).toBe(0.15);
    expect(favourFor(set({ runs: 2.9, clears: 0 }), 'seori', 'normal')).toBeCloseTo(0.06, 9);
    expect(favourFor(set({ runs: 4 }), 'seori', 'normal')).toBeCloseTo(0.12, 9); // clears missing = none
    expect(favourFor(set({}), 'seori', 'normal')).toBe(0);
    expect(favourFor(s, 'seori', 'normal')).toBe(0);
    const w = withZone(s, 'seori', 4, 0);
    const snapshot = structuredClone(w);
    computeMetaBonuses(w, C, ctxAt('seori')).stats.damage = 99;
    expect(w).toEqual(snapshot);
  });

  it('bonusContextFor carries the selection (class, doctrine, empire, zone, difficulty) into the context', () => {
    const sel = { classId: 'ninja' as const, doctrine: 'b' as const, empire: 'jihae' as const, zone: 'seori', difficulty: 'hard' as const };
    expect(bonusContextFor(sel)).toEqual({ classId: 'ninja', doctrine: 'b', empire: 'jihae', zone: 'seori', difficulty: 'hard' });
    expect(bonusContextFor({ ...sel, empire: undefined })).not.toHaveProperty('empire');
  });
});

describe("Sky Sovereign's Favour reaches the hero once (real content, real world)", () => {
  const NOW = 1_700_000_000_000;
  const fresh = (): SaveData => newProfile(content, { now: NOW, rng: seededRng(3), name: 'Favour' });

  // chowon = an empire bonus that touches neither max HP nor damage, so the plain hero is the class base
  function hero(save: SaveData, zone: string, difficulty: 'normal' | 'hard', empire: 'chowon' | 'saehwa' = 'chowon', runOptions?: { density: number; health: number; damage: number; speed: number }) {
    const meta = computeMetaBonuses(save, content, { classId: 'warrior', doctrine: 'a', zone, difficulty, empire });
    const w = createWorld({ zone, difficulty, classId: 'warrior', doctrine: 'a', sex: 'm', empire, seed: 5, meta, ...(runOptions ? { runOptions } : {}) }, content);
    const p = w.players[0];
    if (!p) throw new Error('no hero');
    return { hpMax: p.hpMax, damage: p.stats.damage };
  }

  it('3 failures at the last zone = +9 % max HP and +9 % damage; a cleared zone = the plain hero', () => {
    const zone = content.zones[content.zones.length - 1]?.id ?? 'daeryeol';
    const set = (runs: number, clears: number): SaveData => {
      const s = fresh();
      s.stats.zones[zone] = { normal: { runs, clears, bestScore: 0, bestTime: 0, bestLevel: 0 } };
      return s;
    };
    const plain = hero(set(0, 0), zone, 'normal');
    const three = hero(set(3, 0), zone, 'normal');
    expect(three.hpMax).toBeCloseTo(plain.hpMax * 1.09, 6);
    expect(three.damage).toBeCloseTo(plain.damage + 0.09, 9);
    const capped = hero(set(30, 0), zone, 'normal');
    expect(capped.hpMax).toBeCloseTo(plain.hpMax * 1.15, 6);
    expect(capped.damage).toBeCloseTo(plain.damage + 0.15, 9);
    expect(hero(set(30, 1), zone, 'normal')).toEqual(plain);
    expect(hero(set(3, 0), zone, 'hard')).toEqual(hero(set(0, 0), zone, 'hard'));
  });

  it('Run Options at their maximum scale the enemies, not the hero: the favour is the same on top of them', () => {
    const zone = content.zones[1]?.id ?? 'suryeon';
    const max = { density: 3, health: 3, damage: 3, speed: 3 };
    const set = (runs: number): SaveData => {
      const s = fresh();
      s.stats.zones[zone] = { normal: { runs, clears: 0, bestScore: 0, bestTime: 0, bestLevel: 0 } };
      return s;
    };
    const plain = hero(set(0), zone, 'normal', 'chowon', max);
    const four = hero(set(4), zone, 'normal', 'chowon', max);
    expect(plain).toEqual(hero(set(0), zone, 'normal'));
    expect(four.hpMax).toBeCloseTo(plain.hpMax * 1.12, 6);
    expect(four.damage).toBeCloseTo(plain.damage + 0.12, 9);
  });

  it('the Saehwa +10 % and the favour add (1 + 0.10 + 0.09), the empire is not counted twice', () => {
    const zone = content.zones[0]?.id ?? 'yeonmu';
    const s = fresh();
    s.stats.zones[zone] = { normal: { runs: 3, clears: 0, bestScore: 0, bestTime: 0, bestLevel: 0 } };
    const base = content.classes.find((c) => c.id === 'warrior')?.base.maxHp ?? 0;
    expect(hero(s, zone, 'normal', 'saehwa').hpMax).toBeCloseTo(base * (1 + 0.1 + 0.09), 6);
  });
});
