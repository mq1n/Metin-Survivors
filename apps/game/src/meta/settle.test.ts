import { computeScore } from '@ms/shared/api';
import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { NOW, freshSave, makeRun } from './__fixtures__/testkit';
import { seededRng } from './rng';
import { content as realContent } from '../data/loader';
import { MAX_CURRENCY, newProfile } from './save';
import { CODEX_SHARDS_BASE, CODEX_SHARDS_BIG, codexPayout, rewardMultiplier, runStatsOf, scoreOf, settleRun, talentXpFor, zoneXpMultiplier } from './settle';
import type { RunResult } from '../sim/run';
import { CUMULATIVE_XP, pointsForXp, talentCap, xpForPoints } from './talents';
import type { MetaContent, MetaRng, SaveData } from './types';

const C = fixtureContent;
const T = C.balance.talentXp;
const always = (v: number): MetaRng => ({ next: () => v });

describe('talent XP', () => {
  it('sums BalanceConfig.talentXp terms × zone × difficulty', () => {
    const run = makeRun({ time: 600, kills: 500, elitesKilled: 10, metinsBroken: 4, bossesKilled: ['yeonmu_boss1', 'yeonmu_boss2'] });
    const x = talentXpFor(C, run);
    expect(x.time).toBeCloseTo(T.perMinute * 10);
    expect(x.kills).toBeCloseTo(T.perKill * 500);
    expect(x.elites).toBeCloseTo(T.perElite * 10);
    expect(x.bosses).toBeCloseTo(T.perBoss * 2);
    expect(x.metins).toBeCloseTo(T.perMetin * 4);
    expect(x.victory).toBe(0);
    expect(x.zoneMult).toBe(1);
    expect(x.difficultyMult).toBe(1);
    expect(x.total).toBe(Math.round(x.subtotal));
    expect(talentXpFor(C, { ...run, victory: true }).victory).toBe(T.victory);
  });

  it('later zones and hard mode pay more', () => {
    const base = talentXpFor(C, makeRun()).total;
    expect(zoneXpMultiplier(C, 'yeonmu')).toBe(1);
    expect(zoneXpMultiplier(C, 'seori')).toBeCloseTo(1.6);
    expect(talentXpFor(C, makeRun({ zone: 'seori' })).total).toBe(Math.round(base * 1.6));
    expect(talentXpFor(C, makeRun({ difficulty: 'hard' })).total).toBe(Math.round(base * C.balance.hard.reward));
  });

  it('caps run time at run length + overtime and ignores junk numbers', () => {
    expect(talentXpFor(C, makeRun({ time: 99999 })).time).toBeLessThan(T.perMinute * (900 + 301) / 60 + 1);
    const junk = talentXpFor(C, makeRun({ time: Number.NaN, kills: -5, elitesKilled: Infinity, metinsBroken: -1 }));
    expect(junk.total).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(junk.total)).toBe(true);
  });

  it('applies RunResult.rewardMul (hard mode × Run Options) to XP, Yeop and shards', () => {
    const base = makeRun({ yeopLeft: 1000, shards: 10 });
    const opts = makeRun({ yeopLeft: 1000, shards: 10, rewardMul: 1.5 });
    expect(rewardMultiplier(C, base)).toBe(1);
    expect(rewardMultiplier(C, opts)).toBe(1.5);
    expect(talentXpFor(C, opts)).toMatchObject({ difficultyMult: 1.5 });
    expect(talentXpFor(C, opts).total).toBe(Math.round(talentXpFor(C, base).subtotal * 1.5));
    const { save, summary } = settleRun(freshSave(), C, opts, always(0.99), NOW);
    expect(summary.bank).toMatchObject({ yeop: 1500, shards: 15 });
    // + the 5 shards of the Metin codex feat the default run unlocks (MT-04): the codex pays the same under any multiplier
    expect(save.bank).toEqual({ yeop: 1500, shards: 15 + 5 });
    // hard + options stack the way the sim reports it (rewardMul already contains the hard reward)
    const hardOpts = makeRun({ difficulty: 'hard', yeopLeft: 1000, rewardMul: C.balance.hard.reward * 1.4 });
    expect(settleRun(freshSave(), C, hardOpts, always(0.99), NOW).summary.bank.yeop).toBe(Math.round(1000 * C.balance.hard.reward * 1.4));
  });

  it('clamps a hostile or broken rewardMul (co-op results arrive over the network)', () => {
    const cap = (r: number): number => rewardMultiplier(C, makeRun({ rewardMul: r }));
    expect(cap(100)).toBe(2); // normal: at most ×2 from Run Options
    expect(rewardMultiplier(C, makeRun({ difficulty: 'hard', rewardMul: 100 }))).toBe(C.balance.hard.reward * 2);
    for (const bad of [Number.NaN, 0, -3, Infinity]) expect(cap(bad)).toBe(1);
    expect(rewardMultiplier(C, makeRun({ difficulty: 'hard', rewardMul: Number.NaN }))).toBe(C.balance.hard.reward);
  });
});

describe('settleRun', () => {
  it('banks the leftover Yeop + shards, grants class XP, updates stats, never mutates the input', () => {
    const s = freshSave();
    const before = structuredClone(s);
    const run = makeRun({ yeopLeft: 1200, shards: 6, bossesKilled: ['yeonmu_boss1'] });
    const { save, summary } = settleRun(s, C, run, always(0.999999), NOW + 5000);
    expect(s).toEqual(before);
    // 6 run shards + the codex feats this run unlocks (MT-04: a boss kill 10, a Metin broken 5; entering the zone is free)
    expect(save.bank).toEqual({ yeop: 1200, shards: 6 + 10 + 5 });
    expect(summary.bank).toMatchObject({ yeop: 1200, shards: 6, duplicateShards: 0, yeopTotal: 1200, shardsTotal: 21 });
    const xp = talentXpFor(C, run).total;
    expect(save.classes.warrior.xp).toBe(xp);
    expect(save.classes.ninja.xp).toBe(0);
    expect(summary.talentXp).toMatchObject({ total: xp, before: 0, after: xp, pointsBefore: 0, pointsAfter: pointsForXp(xp), available: pointsForXp(xp) });
    expect(save.stats).toMatchObject({ runs: 1, wins: 0, deaths: 1, kills: 500, elites: 10, bosses: 1, metins: 4, playTime: 600, yeopEarned: 1200 });
    expect(save.stats.bossKills).toEqual({ yeonmu_boss1: 1 });
    expect(save.stats.metinKinds).toEqual({ yeonmu_metin: 4 });
    expect(save.stats.classes.warrior).toMatchObject({ runs: 1, wins: 0 });
    expect(save.stats.zones.yeonmu?.normal).toMatchObject({ runs: 1, clears: 0, bestLevel: 30 });
    expect(save.profile.updated).toBe(NOW + 5000);
  });

  it('hard mode pays ×reward on Yeop and shards', () => {
    const { summary } = settleRun(freshSave(), C, makeRun({ difficulty: 'hard', yeopLeft: 1000, shards: 6 }), always(0.99), NOW);
    expect(summary.bank).toMatchObject({ yeop: 1500, shards: 9 });
  });

  it('score uses the shared formula and records only improve', () => {
    const run = makeRun({ bossesKilled: ['yeonmu_boss1'] });
    expect(scoreOf(run)).toBe(computeScore(runStatsOf(run), { victory: false, duration: 600, difficulty: 'normal' }));
    const first = settleRun(freshSave(), C, run, always(0.99), NOW);
    expect(first.summary.records).toEqual({ score: true, level: true, time: false });
    expect(first.save.stats.bestScore).toBe(first.summary.score);
    const worse = settleRun(first.save, C, makeRun({ kills: 10, level: 5, time: 100 }), always(0.99), NOW);
    expect(worse.summary.records).toEqual({ score: false, level: false, time: false });
    expect(worse.save.stats.bestScore).toBe(first.summary.score);
    const win1 = settleRun(worse.save, C, makeRun({ victory: true, time: 880 }), always(0.99), NOW);
    expect(win1.summary.records.time).toBe(true);
    const win2 = settleRun(win1.save, C, makeRun({ victory: true, time: 900 }), always(0.99), NOW);
    expect(win2.summary.records.time).toBe(false);
    const win3 = settleRun(win2.save, C, makeRun({ victory: true, time: 850 }), always(0.99), NOW);
    expect(win3.summary.records.time).toBe(true);
    expect(win3.save.stats.zones.yeonmu?.normal?.bestTime).toBe(850);
  });

  it('a victory unlocks the next zone, hard mode and codex entries; a defeat does not', () => {
    const lose = settleRun(freshSave(), C, makeRun({ bossesKilled: ['yeonmu_boss1'] }), always(0.99), NOW);
    expect(lose.summary.unlocks).toEqual({ zones: [], hard: [], codex: ['codex_enter_yeonmu', 'codex_boss', 'codex_metin'] });
    const win = settleRun(lose.save, C, makeRun({ victory: true, time: 900, bossesKilled: ['yeonmu_boss1', 'yeonmu_final'] }), always(0.99), NOW);
    expect(win.summary.unlocks.zones).toEqual(['suryeon']);
    expect(win.summary.unlocks.hard).toEqual(['yeonmu']);
    expect(win.summary.unlocks.codex).toEqual(['codex_clear_yeonmu']);
    expect(win.save.unlocks.zones).toEqual(['yeonmu', 'suryeon']);
    expect(win.save.stats).toMatchObject({ wins: 1, deaths: 1 });
    // clearing again unlocks nothing new
    const again = settleRun(win.save, C, makeRun({ victory: true, time: 900 }), always(0.99), NOW);
    expect(again.summary.unlocks).toEqual({ zones: [], hard: [], codex: [] });
  });

  it('hard clear counts for the hard codex entry', () => {
    const win = settleRun(freshSave(), C, makeRun({ victory: true, difficulty: 'hard' }), always(0.99), NOW);
    expect(win.save.stats.zones.yeonmu?.hard?.clears).toBe(1);
    expect(win.save.unlocks.codex).toContain('codex_hard_yeonmu');
  });

  it('rolls gear drops (auto-equip) and reports duplicate shards separately', () => {
    const run = makeRun({ bossesKilled: ['yeonmu_boss1'], shards: 2 });
    const first = settleRun(freshSave(), C, run, always(0), NOW);
    const ids = first.summary.drops.map((d) => d.gearId);
    expect(ids).toEqual(expect.arrayContaining(['yeonmu_weapon_warrior', 'yeonmu_armor_warrior']));
    expect(first.save.classes.warrior.gear.weapon).toBe('yeonmu_weapon_warrior');
    expect(first.summary.bank.duplicateShards).toBe(0);
    const second = settleRun(first.save, C, run, always(0), NOW);
    const dupes = second.summary.drops.filter((d) => !d.isNew);
    expect(dupes.length).toBeGreaterThan(0);
    expect(second.summary.bank.duplicateShards).toBe(dupes.reduce((a, d) => a + d.shards, 0));
    expect(second.summary.bank.shardsTotal).toBe(first.save.bank.shards + 2 + second.summary.bank.duplicateShards);
  });

  it('passes the loadout luck into drop chances', () => {
    const s = freshSave();
    s.classes.warrior.collection.push('yeonmu_necklace');
    s.classes.warrior.gear.necklace = 'yeonmu_necklace';
    s.classes.warrior.collection.push('yeonmu_earrings');
    s.classes.warrior.gear.earrings = 'yeonmu_earrings'; // luck 0.05
    const N = 3000;
    const count = (save: typeof s): number => {
      const rng = seededRng(5);
      let n = 0;
      for (let i = 0; i < N; i++) {
        const r = settleRun(save, C, makeRun({ bossesKilled: ['yeonmu_boss1'], time: 10 }), rng, NOW);
        if (r.summary.drops.some((d) => d.gearId === 'yeonmu_weapon_warrior')) n++;
      }
      return n / N;
    };
    // luck 0.05 → ≈ 0.3 × 1.05 = 0.315 (vs 0.3): same stream, so the lucky profile never gets fewer drops
    expect(count(s)).toBeGreaterThanOrEqual(count(freshSave()));
  }, 60_000); // 6 000 settleRun calls (~2.4 s alone): the 5 s default is too close under a loaded full-suite run

  it('pointsGained reflects crossing talent-point thresholds, and available counts spent points', () => {
    const s = freshSave();
    s.classes.warrior.xp = xpForPoints(3) - 10;
    const { summary } = settleRun(s, C, makeRun(), always(0.99), NOW);
    expect(summary.talentXp.pointsBefore).toBe(2);
    expect(summary.talentXp.pointsGained).toBeGreaterThan(0);
    expect(summary.talentXp.available).toBe(summary.talentXp.pointsAfter);
  });

  it('caps class points at 40 however much XP piles up', () => {
    const s = freshSave();
    s.classes.warrior.xp = xpForPoints(40);
    const { summary, save } = settleRun(s, C, makeRun({ victory: true }), always(0.99), NOW);
    expect(summary.talentXp.pointsAfter).toBe(40);
    expect(summary.talentXp.pointsGained).toBe(0);
    expect(save.classes.warrior.xp).toBeGreaterThan(xpForPoints(40));
  });

  it('run id is API-valid and deterministic per RNG; unknown zones still bank', () => {
    const a = settleRun(freshSave(), C, makeRun(), seededRng(9), NOW).summary.runId;
    const b = settleRun(freshSave(), C, makeRun(), seededRng(9), NOW).summary.runId;
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    const odd = settleRun(freshSave(), C, makeRun({ zone: 'atlantis', yeopLeft: 77 }), always(0.5), NOW);
    expect(odd.save.bank.yeop).toBe(77);
    expect(odd.summary.talentXp.zoneMult).toBe(1);
  });
});

describe('talent cap on settlement (MT-02)', () => {
  const hardWin = (zone: string): RunResult => makeRun({ zone, difficulty: 'hard', victory: true });
  const xp44 = (): SaveData => {
    const s = freshSave();
    s.classes.warrior.xp = CUMULATIVE_XP[44] as number; // XP worth 44 points: the 41st..44th wait for the cap
    return s;
  };

  it('reports cap 40 and the first zone as the next cap goal on a profile without Hard clears', () => {
    const { summary, save } = settleRun(xp44(), C, makeRun({ victory: true }), always(0.99), NOW);
    expect(summary.talentXp).toMatchObject({ cap: 40, capBefore: 40, capNext: 'yeonmu', pointsBefore: 40, pointsAfter: 40, pointsGained: 0, available: 40 });
    expect(talentCap(save)).toBe(40);
  });

  it('a Normal clear, a Hard defeat and a repeat Hard clear of the same zone leave the cap alone', () => {
    let s = xp44();
    s = settleRun(s, C, makeRun({ victory: true }), always(0.99), NOW).save;
    expect(settleRun(s, C, makeRun({ difficulty: 'hard', victory: false }), always(0.99), NOW).summary.talentXp.cap).toBe(40);
    const first = settleRun(s, C, hardWin('yeonmu'), always(0.99), NOW);
    expect(first.summary.talentXp).toMatchObject({ capBefore: 40, cap: 42, capNext: 'suryeon' });
    const again = settleRun(first.save, C, hardWin('yeonmu'), always(0.99), NOW);
    expect(again.summary.talentXp).toMatchObject({ capBefore: 42, cap: 42, capNext: 'suryeon' });
  });

  it('a first Hard clear lifts the cap and pays the XP that piled up above the old one at once', () => {
    const first = settleRun(xp44(), C, hardWin('yeonmu'), always(0.99), NOW);
    expect(first.summary.talentXp).toMatchObject({ pointsBefore: 40, pointsAfter: 42, pointsGained: 2, available: 42, cap: 42 });
    const second = settleRun(first.save, C, hardWin('suryeon'), always(0.99), NOW);
    expect(second.summary.talentXp).toMatchObject({ pointsBefore: 42, pointsAfter: 44, pointsGained: 2, capBefore: 42, cap: 44, capNext: 'seori' });
    expect(second.save.stats.zones.suryeon?.hard?.clears).toBe(1);
  });

  it('reaches 48 after all four zones, names no further goal and keeps growing with the XP', () => {
    let s = xp44();
    let last = settleRun(s, C, hardWin('yeonmu'), always(0.99), NOW);
    for (const z of ['suryeon', 'seori', 'daeryeol']) {
      s = last.save;
      last = settleRun(s, C, hardWin(z), always(0.99), NOW);
    }
    expect(last.summary.talentXp).toMatchObject({ cap: 48, capBefore: 46, capNext: null });
    expect(last.summary.talentXp.pointsAfter).toBe(pointsForXp(last.save.classes.warrior.xp, 48));
    expect(last.summary.talentXp.pointsAfter).toBeGreaterThan(44);
    expect(last.summary.talentXp.pointsAfter).toBeLessThanOrEqual(48);
    // never beyond 48, however much XP piles up
    const huge = freshSave();
    huge.classes.warrior.xp = 5e8;
    const all = ['yeonmu', 'suryeon', 'seori', 'daeryeol'].reduce((cur, z) => settleRun(cur, C, hardWin(z), always(0.99), NOW).save, huge);
    expect(settleRun(all, C, hardWin('yeonmu'), always(0.99), NOW).summary.talentXp).toMatchObject({ cap: 48, pointsAfter: 48, pointsGained: 0 });
  });

  it('available clamps with the cap: points above it are not spendable until a Hard clear lifts it', () => {
    const s = xp44();
    s.classes.warrior.talents = { warrior_a: { r0c0: 40 } };
    expect(settleRun(s, C, makeRun(), always(0.99), NOW).summary.talentXp.available).toBe(0);
    expect(settleRun(s, C, hardWin('yeonmu'), always(0.99), NOW).summary.talentXp.available).toBe(2);
  });

  it('profiles without Hard clears settle exactly as before (points, available, XP)', () => {
    for (const xp of [0, 999, xpForPoints(12) - 1, xpForPoints(39), xpForPoints(40), xpForPoints(40) + 77_000, 2e6]) {
      const s = freshSave();
      s.classes.warrior.xp = xp;
      const { summary, save } = settleRun(s, C, makeRun({ victory: true }), always(0.99), NOW);
      const after = xp + summary.talentXp.total;
      expect(save.classes.warrior.xp).toBe(after);
      expect(summary.talentXp).toMatchObject({ cap: 40, pointsBefore: pointsForXp(xp), pointsAfter: pointsForXp(after), available: Math.min(40, pointsForXp(after)) });
      expect(pointsForXp(after)).toBeLessThanOrEqual(40);
    }
  });
});

describe('codex payouts (MT-04)', () => {
  const noMetin = { metinTypesBroken: [] as string[] };
  /** the fixture codex cut down to the entries a test names (codex_start stays: new profiles hold it) */
  const withCodex = (entries: { id: string; unlock: string }[]): MetaContent => {
    const c = structuredClone(C);
    c.story.codex = [c.story.codex[0] as (typeof c.story.codex)[number], ...entries.map((e) => ({ ...e, title: { tr: 'x', en: 'x' }, text: { tr: 'x', en: 'x' } }))];
    return c;
  };

  it('prices every unlock kind: 10 for clear / hard / boss, 5 for metin / class / level / wins / runs / kills, 0 for reveals', () => {
    const pay = (unlock: string, id = 'codex_x'): number => codexPayout({ id, unlock });
    expect(CODEX_SHARDS_BIG).toBe(10);
    expect(CODEX_SHARDS_BASE).toBe(5);
    for (const u of ['clear:yeonmu', 'hard:yeonmu', 'boss:yeonmu_boss1']) expect(pay(u), u).toBe(10);
    for (const u of ['metin:yeonmu_metin', 'class:ninja', 'level:70', 'wins:10', 'runs:50', 'kills:25000']) expect(pay(u), u).toBe(5);
    for (const u of ['', 'always', 'start', 'enter:yeonmu', 'zone:yeonmu', 'frobnicate:7', 'class:paladin', 'level:abc']) expect(pay(u), u).toBe(0);
    // bestiary pages open by discovery and pay nothing, whatever their rule
    for (const id of ['codex_enemy_wolf', 'codex_boss_boss_horyeong', 'codex_metin_metin_great_ebon', 'codex_metin_metin_lament']) {
      for (const u of ['enter:yeonmu', 'boss:boss_horyeong', 'metin:metin_lament']) expect(pay(u, id), `${id} ${u}`).toBe(0);
    }
  });

  it('pays each newly unlocked feat once, in content order, on top of the run shards', () => {
    const run = makeRun({ bossesKilled: ['yeonmu_boss1'], shards: 6 });
    const first = settleRun(freshSave(), C, run, always(0.999999), NOW);
    expect(first.summary.codexPaid).toEqual([
      { id: 'codex_boss', shards: 10 },
      { id: 'codex_metin', shards: 5 },
    ]);
    // entering the zone unlocked too, and paid nothing
    expect(first.summary.unlocks.codex).toEqual(['codex_enter_yeonmu', 'codex_boss', 'codex_metin']);
    expect(first.summary.bank).toMatchObject({ shards: 6, duplicateShards: 0, shardsTotal: 21 });
    expect(first.save.bank.shards).toBe(21);
    expect(first.save.stats.shardsEarned).toBe(21);
    // the same feats on a later settle pay nothing again; only the run shards bank
    let cur = first.save;
    for (let i = 1; i <= 3; i++) {
      const next = settleRun(cur, C, run, always(0.999999), NOW);
      expect(next.summary.codexPaid).toEqual([]);
      expect(next.summary.unlocks.codex).toEqual([]);
      expect(next.save.bank.shards).toBe(21 + 6 * i);
      cur = next.save;
    }
  });

  it('a defeat pays like a victory: feats follow the stats, not the outcome', () => {
    const lose = settleRun(freshSave(), C, makeRun({ classId: 'ninja', ...noMetin }), always(0.99), NOW);
    expect(lose.summary.victory).toBe(false);
    expect(lose.summary.codexPaid).toEqual([{ id: 'codex_class_ninja', shards: 5 }]);
    expect(lose.save.bank.shards).toBe(6 + 5);
  });

  it('a clear, a Hard clear and the third win pay 10, 10 and 5, each once', () => {
    const win = settleRun(freshSave(), C, makeRun({ victory: true, ...noMetin }), always(0.99), NOW);
    expect(win.summary.codexPaid).toEqual([{ id: 'codex_clear_yeonmu', shards: 10 }]);
    const hard = settleRun(win.save, C, makeRun({ victory: true, difficulty: 'hard', ...noMetin }), always(0.99), NOW);
    expect(hard.summary.codexPaid).toEqual([{ id: 'codex_hard_yeonmu', shards: 10 }]);
    const third = settleRun(hard.save, C, makeRun({ victory: true, ...noMetin }), always(0.99), NOW);
    expect(third.summary.codexPaid).toEqual([{ id: 'codex_wins3', shards: 5 }]);
    const fourth = settleRun(third.save, C, makeRun({ victory: true, ...noMetin }), always(0.99), NOW);
    expect(fourth.summary.codexPaid).toEqual([]);
  });

  it('is a flat bonus: hard mode and Run Options do not multiply it', () => {
    const plain = settleRun(freshSave(), C, makeRun({ victory: true, ...noMetin, shards: 0 }), always(0.99), NOW);
    const maxed = settleRun(freshSave(), C, makeRun({ victory: true, ...noMetin, shards: 0, difficulty: 'hard', rewardMul: C.balance.hard.reward * 2 }), always(0.99), NOW);
    expect(plain.summary.codexPaid).toEqual([{ id: 'codex_clear_yeonmu', shards: 10 }]);
    // a hard win clears the Hard rule, not the Normal one: still one 10-shard feat, and no run shards to multiply
    expect(maxed.summary.codexPaid).toEqual([{ id: 'codex_hard_yeonmu', shards: 10 }]);
    expect(maxed.summary.bank).toMatchObject({ shards: 0, shardsTotal: 10 });
  });

  it('pays nothing for reveals, bestiary pages and rules that never unlock, but still unlocks them', () => {
    const c = withCodex([
      { id: 'codex_enemy_wolf', unlock: 'enter:yeonmu' },
      { id: 'codex_boss_yeonmu_boss1', unlock: 'boss:yeonmu_boss1' },
      { id: 'codex_metin_yeonmu_metin', unlock: 'metin:yeonmu_metin' },
      { id: 'codex_lore_reveal', unlock: 'enter:yeonmu' },
      { id: 'codex_lore_garbage', unlock: 'frobnicate:7' },
    ]);
    const r = settleRun(freshSave(), c, makeRun({ bossesKilled: ['yeonmu_boss1'] }), always(0.99), NOW);
    expect(r.summary.unlocks.codex).toEqual(['codex_enemy_wolf', 'codex_boss_yeonmu_boss1', 'codex_metin_yeonmu_metin', 'codex_lore_reveal']);
    expect(r.summary.codexPaid).toEqual([]);
    expect(r.summary.bank.shardsTotal).toBe(6);
  });

  it('does not pay what the load already healed into the unlock list', () => {
    const s = freshSave();
    s.stats.bossKills.yeonmu_boss1 = 1;
    s.unlocks.codex.push('codex_boss'); // normalizeSave adds entries whose stats are met without paying
    const r = settleRun(s, C, makeRun({ ...noMetin }), always(0.99), NOW);
    expect(r.summary.codexPaid).toEqual([]);
    expect(r.save.bank.shards).toBe(6);
  });

  it('consumes no rng and leaves everything but the shards untouched (feature off = same draws)', () => {
    const counting = (): { rng: MetaRng; draws: () => number } => {
      let n = 0;
      return { rng: { next: () => ((n += 1), 0.4) }, draws: () => n };
    };
    const run = makeRun({ bossesKilled: ['yeonmu_boss1', 'yeonmu_final'], victory: true, shards: 2 });
    const on = counting();
    const off = counting();
    const a = settleRun(freshSave(), C, run, on.rng, NOW);
    const b = settleRun(freshSave(), withCodex([]), run, off.rng, NOW);
    expect(a.summary.codexPaid?.length).toBeGreaterThan(0);
    expect(b.summary.codexPaid).toEqual([]);
    expect(on.draws()).toBe(off.draws());
    expect(on.draws()).toBeGreaterThan(0);
    expect(a.summary.drops).toEqual(b.summary.drops);
    expect(a.summary.runId).toBe(b.summary.runId);
    expect(a.save.classes).toEqual(b.save.classes);
    expect(a.save.bank.shards - b.save.bank.shards).toBe((a.summary.codexPaid ?? []).reduce((n, c) => n + c.shards, 0));
  });

  it('clamps the bank at MAX_CURRENCY', () => {
    const s = freshSave();
    s.bank.shards = MAX_CURRENCY - 3;
    const r = settleRun(s, C, makeRun({ bossesKilled: ['yeonmu_boss1'], shards: 0 }), always(0.999999), NOW);
    expect(r.summary.codexPaid?.length).toBe(2);
    expect(r.save.bank.shards).toBe(MAX_CURRENCY);
    expect(r.summary.bank.shardsTotal).toBe(MAX_CURRENCY);
  });

  it('settles the same RunResult to the same payout on every profile (co-op host, guest, late join)', () => {
    const run = makeRun({
      bossesKilled: ['yeonmu_boss1'],
      players: [
        { index: 0, level: 30, kills: 500, yeop: 4000, alive: false },
        { index: 1, level: 12, kills: 90, yeop: 800, alive: true },
      ],
    });
    const host = settleRun(freshSave(), C, run, always(0.999999), NOW);
    const guest = settleRun(freshSave(), C, structuredClone(run), always(0.999999), NOW);
    expect(host.summary.codexPaid).toEqual([
      { id: 'codex_boss', shards: 10 },
      { id: 'codex_metin', shards: 5 },
    ]);
    expect(guest.summary.codexPaid).toEqual(host.summary.codexPaid);
    expect(guest.save.bank).toEqual(host.save.bank);
  });
});

describe('the shipped codex pays (MT-04)', () => {
  const fresh = (): SaveData => newProfile(realContent, { now: NOW, rng: seededRng(1), name: 'Real' });
  const payers = realContent.story.codex.filter((e) => codexPayout(e) > 0);

  it('pays a lifetime of 150 shards at most, only for lore feats: bestiary pages and reveals stay free', () => {
    const total = payers.reduce((n, e) => n + codexPayout(e), 0);
    for (const e of payers) expect(e.id.startsWith('codex_lore_'), e.id).toBe(true);
    for (const e of realContent.story.codex) if (/^codex_(enemy|boss|metin)_/.test(e.id)) expect(codexPayout(e), e.id).toBe(0);
    // 5 class feats (5 each) + 4 clears (10 each) + the 13 long-tail feats (4 Hard clears x 10, 9 milestones x 5)
    expect(payers.length).toBe(5 + 4 + 13);
    expect(total).toBe(5 * 5 + 4 * 10 + (4 * 10 + 9 * 5));
    expect(total).toBe(150);
    // T10 (PLAN 4): the codex stays under 15 % of a campaign's shards; the baseline campaigns earned 1,538 on average (2026-10-28)
    expect(total).toBeLessThanOrEqual(0.15 * 1538);
  });

  it('a first Hard clear pays the class feat (5) and the Hard feat (10), and nothing the second time', () => {
    const run = makeRun({ victory: true, difficulty: 'hard', metinTypesBroken: [] });
    const first = settleRun(fresh(), realContent, run, always(0.99), NOW);
    expect(first.summary.codexPaid).toEqual([
      { id: 'codex_lore_class_warrior', shards: 5 },
      { id: 'codex_lore_feat_hard_yeonmu', shards: 10 },
    ]);
    const again = settleRun(first.save, realContent, run, always(0.99), NOW);
    expect(again.summary.codexPaid).toEqual([]);
  });

  it('a milestone pays on the run that crosses it: kills, level, wins and runs', () => {
    const s = fresh();
    s.unlocks.codex = realContent.story.codex.filter((e) => !e.id.startsWith('codex_lore_feat_')).map((e) => e.id); // nothing else left to pay
    s.stats.kills = 24_700; // + the 500 kills of the run below
    s.stats.bestLevel = 49;
    s.stats.wins = 9;
    s.stats.runs = 49;
    const r = settleRun(s, realContent, makeRun({ victory: true, level: 50, metinTypesBroken: [] }), always(0.99), NOW);
    expect(r.summary.codexPaid).toEqual([
      { id: 'codex_lore_feat_wins_10', shards: 5 },
      { id: 'codex_lore_feat_kills_25k', shards: 5 },
      { id: 'codex_lore_feat_level_50', shards: 5 },
      { id: 'codex_lore_feat_runs_50', shards: 5 },
    ]);
  });
});
