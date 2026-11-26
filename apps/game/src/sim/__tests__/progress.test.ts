// XP curve, level-up chains and modals, startLevel meta, defeat / victory flow and the RunResult.

import { describe, expect, it } from 'vitest';
import type { CoopPlayerInit } from '../run';
import { hitEnemy, HurtKind, hurtPlayer, newHitCtx } from '../combat';
import { DEFEAT_DELAY, DT, VICTORY_DELAY } from '../constants';
import { spawnXp } from '../pickups';
import { beginVictory, grantXp, xpToNext } from '../progress';
import type { World } from '../world';
import { clearEnemies, collect, freezeSchedules, giveSkill, makeWorld, NO_INPUT, player, runTicks, spawn, type TestWorldOpts } from './helpers';

const COOP: CoopPlayerInit[] = [{ classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } }];

/** no scheduled spawns, no enemies: the hero keeps its starting skills */
function quiet(opts: TestWorldOpts = {}): World {
  const w = makeWorld(opts);
  freezeSchedules(w);
  clearEnemies(w);
  w.bus.clear();
  return w;
}

/** reference curve written out by hand for the fixture balance: 6 + 4n + 0.55 n² */
const need = (n: number): number => 6 + 4 * n + 0.55 * n * n;

function lethal(w: World, pi = 0): void {
  const p = player(w, pi);
  p.iframes = 0;
  hurtPlayer(w, pi, 1e6, 100, 0, 0, HurtKind.Melee);
}

/** step until `w.over` (max `limit` ticks); returns the number of steps taken */
function stepUntilOver(w: World, limit = 600): number {
  let n = 0;
  while (!w.over && n < limit) {
    w.step([NO_INPUT]);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------

describe('xpToNext', () => {
  it('follows base + growth·n + accel·n² of the balance curve (6, 4, 0.55 in the fixture)', () => {
    const w = quiet();
    expect(xpToNext(w, 1)).toBeCloseTo(10.55, 9);
    expect(xpToNext(w, 2)).toBeCloseTo(16.2, 9);
    expect(xpToNext(w, 3)).toBeCloseTo(22.95, 9);
    expect(xpToNext(w, 5)).toBeCloseTo(39.75, 9);
    expect(xpToNext(w, 10)).toBeCloseTo(101, 9);
    expect(xpToNext(w, 20)).toBeCloseTo(306, 9);
    expect(xpToNext(w, 50)).toBeCloseTo(1581, 9);
    expect(xpToNext(w, 0)).toBeCloseTo(6, 9);
  });

  it('is strictly increasing with the level', () => {
    const w = quiet();
    for (let n = 1; n < 120; n++) expect(xpToNext(w, n + 1)).toBeGreaterThan(xpToNext(w, n));
  });

  it('reads the curve from the content (custom curve) and never drops below 1', () => {
    const custom = quiet({ content: (c) => (c.balance.xpCurve = { base: 2, growth: 1, accel: 0 }) });
    expect(xpToNext(custom, 3)).toBe(5);
    const degenerate = quiet({ content: (c) => (c.balance.xpCurve = { base: -100, growth: 0, accel: 0 }) });
    expect(xpToNext(degenerate, 4)).toBe(1);
  });

  it('a new hero starts at level 1 with xp 0 and xpNext = xpToNext(1)', () => {
    const w = quiet();
    const p = player(w);
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
    expect(p.xpNext).toBeCloseTo(10.55, 9);
    expect(p.pendingLevels).toBe(0);
    expect(w.modals).toHaveLength(0);
  });
});

describe('grantXp', () => {
  it('below the threshold: xp accumulates and nothing else happens', () => {
    const w = quiet();
    const p = player(w);
    grantXp(w, p, 5);
    grantXp(w, p, 4);
    expect(p.xp).toBeCloseTo(9, 9);
    expect(p.level).toBe(1);
    expect(p.pendingLevels).toBe(0);
    expect(p.xpNext).toBeCloseTo(10.55, 9);
    expect(w.events).toHaveLength(0);
  });

  it('exactly the threshold: level 2, carry-over 0, one levelUp event', () => {
    const w = quiet();
    const p = player(w);
    grantXp(w, p, 10.55);
    expect(p.level).toBe(2);
    expect(p.xp).toBeCloseTo(0, 9);
    expect(p.pendingLevels).toBe(1);
    expect(p.xpNext).toBeCloseTo(16.2, 9);
    expect(w.events.filter((e) => e.t === 'levelUp')).toEqual([{ t: 'levelUp', player: 0, level: 2 }]);
  });

  it('a big grant chains several levels, keeps the remainder and reports every level in order', () => {
    const w = quiet();
    const p = player(w);
    grantXp(w, p, need(1) + need(2) + need(3) + 3);
    expect(p.level).toBe(4);
    expect(p.pendingLevels).toBe(3);
    expect(p.xp).toBeCloseTo(3, 6);
    expect(p.xpNext).toBeCloseTo(need(4), 9);
    const levels: number[] = [];
    for (const e of w.events) if (e.t === 'levelUp') levels.push(e.level);
    expect(levels).toEqual([2, 3, 4]);
  });

  it('matches a reference loop for a huge grant and always terminates', () => {
    const w = quiet();
    const p = player(w);
    const amount = 1_000_000;
    grantXp(w, p, amount);
    let level = 1;
    let rest = amount;
    while (rest >= need(level)) {
      rest -= need(level);
      level++;
    }
    expect(p.level).toBe(level);
    expect(p.pendingLevels).toBe(level - 1);
    expect(p.xp).toBeCloseTo(rest, 3);
    expect(p.xp).toBeLessThan(p.xpNext);
  });

  it('grants split into pieces give the same result as one grant', () => {
    const a = quiet();
    const b = quiet();
    grantXp(a, player(a), 300);
    for (let i = 0; i < 30; i++) grantXp(b, player(b), 10);
    expect(player(b).level).toBe(player(a).level);
    expect(player(b).xp).toBeCloseTo(player(a).xp, 6);
  });

  it('does not open modals by itself (that happens at the end of the next step)', () => {
    const w = quiet();
    grantXp(w, player(w), 50);
    expect(w.modals).toHaveLength(0);
  });

  it('an xp gem is multiplied by the hero xpGain stat when collected and can level the hero up', () => {
    const w = quiet();
    const p = player(w);
    p.stats.xpGain = 1.5;
    spawnXp(w, 0.5, 0.5, 4);
    const picked = collect(w, 120, ['pickup']);
    expect(picked).toHaveLength(1);
    expect(picked[0]?.value).toBeCloseTo(6, 4);
    expect(p.xp).toBeCloseTo(6, 4);
    expect(p.level).toBe(1);

    spawnXp(w, -0.5, 0.5, 6); // 6 × 1.5 = 9 → total 15 ≥ 10.55
    for (let i = 0; i < 120 && w.modals.length === 0; i++) w.step([NO_INPUT]);
    expect(p.level).toBe(2);
    expect(p.xp).toBeCloseTo(6 + 9 - 10.55, 3);
    expect(w.modal?.kind).toBe('levelUp');
    expect(w.modal?.level).toBe(2);
  });
});

describe('level-up modals', () => {
  it('pending level-ups open ONE levelUp modal at a time with the right level numbers', () => {
    const w = quiet();
    const p = player(w);
    grantXp(w, p, need(1) + need(2) + need(3) + 1); // level 4: three pending
    expect(p.pendingLevels).toBe(3);
    const seen: number[] = [];
    for (let round = 0; round < 3; round++) {
      w.step([NO_INPUT]);
      expect(w.modals).toHaveLength(1);
      const m = w.modal;
      expect(m?.kind).toBe('levelUp');
      expect(m?.player).toBe(0);
      seen.push(m?.level ?? -1);
      // more steps while the modal is open never open a second one
      for (let i = 0; i < 5; i++) w.step([NO_INPUT]);
      expect(w.modals).toHaveLength(1);
      expect(w.chooseCard(0)).toBe(true);
      expect(w.modals).toHaveLength(0);
    }
    expect(seen).toEqual([2, 3, 4]);
    w.step([NO_INPUT]);
    expect(w.modals).toHaveLength(0);
    expect(p.pendingLevels).toBe(0);
    expect(p.level).toBe(4);
  });

  it('the modal carries cardsPerLevel cards and the current reroll / banish / skip budgets', () => {
    const w = quiet();
    grantXp(w, player(w), need(1) + 1);
    w.step([NO_INPUT]);
    const m = w.modal;
    expect(m).not.toBeNull();
    expect(m?.cards).toHaveLength(w.balance.cardsPerLevel);
    expect(m).toMatchObject({ rerolls: 3, banishes: 2, skips: 2, canReroll: true, canBanish: true, canSkip: true, level: 2, player: 0 });
    for (const c of m?.cards ?? []) expect(['newSkill', 'skillUp', 'newPassive', 'passiveUp', 'heal', 'yeop']).toContain(c.kind);
  });

  it('the simulation is frozen while a modal is open (time, tick and events do not advance)', () => {
    const w = quiet();
    grantXp(w, player(w), 50);
    w.step([NO_INPUT]);
    expect(w.modal).not.toBeNull();
    const time = w.time;
    const tick = w.tick;
    for (let i = 0; i < 30; i++) {
      w.step([NO_INPUT]);
      expect(w.events).toHaveLength(0);
    }
    expect(w.time).toBe(time);
    expect(w.tick).toBe(tick);
    w.chooseCard(0);
    w.step([NO_INPUT]); // the next pending level opens its modal at the end of this tick
    expect(w.tick).toBe(tick + 1);
  });

  it('time resumes once every pending level has been answered', () => {
    const w = quiet();
    grantXp(w, player(w), need(1) + need(2) + 1);
    w.step([NO_INPUT]);
    w.chooseCard(0);
    w.step([NO_INPUT]);
    w.chooseCard(0);
    const t0 = w.time;
    runTicks(w, 10);
    expect(w.time).toBeCloseTo(t0 + 10 * DT, 9);
  });

  it('skip() answers the modal like a pick (no card applied) and the next level follows', () => {
    const w = quiet();
    const p = player(w);
    grantXp(w, p, need(1) + need(2) + 1);
    w.step([NO_INPUT]);
    expect(w.modal?.level).toBe(2);
    const skillsBefore = p.skills.length;
    expect(w.skip()).toBe(true);
    expect(p.skips).toBe(1);
    expect(p.skills.length).toBe(skillsBefore);
    w.step([NO_INPUT]);
    expect(w.modal?.level).toBe(3);
    expect(w.modal?.skips).toBe(1);
  });

  it('co-op: every hero has its own modal, but only one levelUp modal per hero at a time', () => {
    const w = quiet({ config: { coop: COOP } });
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    grantXp(w, p0, need(1) + 1); // 1 pending
    grantXp(w, p1, need(1) + need(2) + 1); // 2 pending
    w.step([NO_INPUT]);
    expect(w.modals.map((m) => [m.player, m.kind, m.level])).toEqual([
      [0, 'levelUp', 2],
      [1, 'levelUp', 2],
    ]);
    // answering one hero's modal leaves the other open; the frozen world opens nothing new
    expect(w.chooseCard(0, 1)).toBe(true);
    w.step([NO_INPUT]);
    expect(w.modals.map((m) => m.player)).toEqual([0]);
    expect(w.chooseCard(0, 0)).toBe(true);
    w.step([NO_INPUT]);
    expect(w.modals.map((m) => [m.player, m.level])).toEqual([[1, 3]]);
    expect(w.chooseCard(0, 1)).toBe(true);
    w.step([NO_INPUT]);
    expect(w.modals).toHaveLength(0);
    expect(p0.pendingLevels).toBe(0);
    expect(p1.pendingLevels).toBe(0);
  });

  it('a dead hero gets no level-up modal until it is alive again', () => {
    const w = quiet({ config: { coop: COOP } });
    const p1 = player(w, 1);
    p1.alive = false;
    grantXp(w, p1, need(1) + 1);
    w.step([NO_INPUT]);
    expect(w.modals).toHaveLength(0);
    expect(p1.pendingLevels).toBe(1);
    p1.alive = true;
    w.step([NO_INPUT]);
    expect(w.modals.map((m) => m.player)).toEqual([1]);
  });
});

describe('startLevel meta', () => {
  it('starting at level 4 queues the level-ups 2, 3 and 4 as sequential modals', () => {
    const w = makeWorld({ config: { meta: { stats: {}, startLevel: 4 } } });
    const p = player(w);
    expect(p.level).toBe(4);
    expect(p.xpNext).toBeCloseTo(need(4), 9);
    expect(w.modals).toHaveLength(1); // opened by the constructor
    const levels: number[] = [];
    for (let i = 0; i < 3; i++) {
      expect(w.modals).toHaveLength(1);
      levels.push(w.modal?.level ?? -1);
      expect(w.chooseCard(0)).toBe(true);
      w.step([NO_INPUT]);
    }
    expect(levels).toEqual([2, 3, 4]);
    expect(w.modals).toHaveLength(0);
    expect(p.pendingLevels).toBe(0);
    expect(p.level).toBe(4);
    expect(p.xp).toBe(0);
  });

  it('a fractional start level is floored; levels below 2 queue nothing', () => {
    const w = makeWorld({ config: { meta: { stats: {}, startLevel: 3.7 } } });
    expect(player(w).level).toBe(3);
    expect(w.modal?.level).toBe(2);
    for (const startLevel of [undefined, 1, 0, -5]) {
      const q = makeWorld({ config: { meta: { stats: {}, ...(startLevel === undefined ? {} : { startLevel }) } } });
      expect(player(q).level).toBe(1);
      expect(q.modals).toHaveLength(0);
      expect(player(q).pendingLevels).toBe(0);
    }
  });

  it('every hero gets its own start level (co-op meta)', () => {
    const w = makeWorld({ config: { coop: [{ ...COOP[0]!, meta: { stats: {}, startLevel: 3 } }] } });
    expect(player(w, 0).level).toBe(1);
    expect(player(w, 1).level).toBe(3);
    expect(w.modals.map((m) => [m.player, m.level])).toEqual([[1, 2]]);
  });
});

describe('defeat flow', () => {
  it('all heroes dead → defeat countdown → over, runEnd event and modal, victory false', () => {
    const w = quiet();
    const p = player(w);
    lethal(w);
    expect(p.alive).toBe(false);
    expect(w.over).toBe(false);

    const first = collect(w, 1, ['story']);
    expect(first).toEqual([{ t: 'story', kind: 'defeat', ref: w.zone.id }]);
    expect(w.endTimer).toBeCloseTo(DEFEAT_DELAY, 9);
    expect(w.over).toBe(false);

    const runEnds: boolean[] = [];
    let steps = 1;
    while (!w.over && steps < 400) {
      w.step([NO_INPUT]);
      steps++;
      for (const e of w.events) if (e.t === 'runEnd') runEnds.push(e.victory);
    }
    // 1.6 s of countdown ≈ 96 ticks
    expect(steps).toBeGreaterThanOrEqual(Math.round(DEFEAT_DELAY / DT));
    expect(steps).toBeLessThanOrEqual(Math.round(DEFEAT_DELAY / DT) + 3);
    expect(w.over).toBe(true);
    expect(w.victory).toBe(false);
    expect(runEnds).toEqual([false]);
    expect(w.result).not.toBeNull();
    expect(w.result?.victory).toBe(false);
    expect(w.modals).toHaveLength(1);
    expect(w.modal?.kind).toBe('runEnd');
    expect(w.modal?.result).toBe(w.result);
    expect(w.modal?.player).toBe(0);
  });

  it('a finished run is inert: step() only clears events; runEnd cannot be answered with a card', () => {
    const w = quiet();
    lethal(w);
    stepUntilOver(w);
    const time = w.time;
    const tick = w.tick;
    for (let i = 0; i < 20; i++) {
      w.step([NO_INPUT]);
      expect(w.events).toHaveLength(0);
    }
    expect(w.time).toBe(time);
    expect(w.tick).toBe(tick);
    expect(w.chooseCard(0)).toBe(false);
    expect(w.reroll()).toBe(false);
    expect(w.modal?.kind).toBe('runEnd');
  });

  it('the result is a defeat snapshot taken at the end of the countdown', () => {
    const w = quiet();
    lethal(w);
    stepUntilOver(w);
    const r = w.result;
    expect(r).not.toBeNull();
    expect(r?.victory).toBe(false);
    expect(r?.time).toBeCloseTo(w.time, 9);
    expect(r?.zone).toBe(w.zone.id);
    expect(r?.difficulty).toBe('normal');
    expect(r?.classId).toBe('warrior');
    expect(r?.doctrine).toBe('a');
    expect(r?.seed).toBe(1234);
    expect(r?.players).toEqual([{ index: 0, level: 1, kills: 0, yeop: 0, alive: false }]);
    expect(r?.talentXp).toBe(Math.round((w.time / 60) * w.balance.talentXp.perMinute));
  });

  it('co-op: the run continues while one hero lives and ends when the last one falls', () => {
    const w = quiet({ config: { coop: COOP } });
    lethal(w, 0);
    runTicks(w, 240);
    expect(w.over).toBe(false);
    expect(w.endTimer).toBeLessThan(0);
    expect(player(w, 0).alive).toBe(false);
    lethal(w, 1);
    const steps = stepUntilOver(w);
    expect(w.over).toBe(true);
    expect(steps).toBeGreaterThan(90);
    expect(w.result?.players.map((p) => p.alive)).toEqual([false, false]);
  });

  it('a revive keeps the run alive (no countdown)', () => {
    const w = quiet();
    const p = player(w);
    p.stats.revives = 1;
    lethal(w);
    expect(p.alive).toBe(true);
    runTicks(w, 300);
    expect(w.over).toBe(false);
    expect(w.endTimer).toBeLessThan(0);
    lethal(w);
    p.iframes = 0;
    lethal(w);
    expect(p.alive).toBe(false);
    expect(stepUntilOver(w)).toBeGreaterThan(90);
    expect(w.result?.victory).toBe(false);
  });

  it('level-up modals still open for living heroes during the countdown, and the run only ends after they are answered', () => {
    const w = quiet({ config: { coop: COOP } });
    lethal(w, 0);
    lethal(w, 1);
    expect(w.allDead()).toBe(true);
    w.step([NO_INPUT]);
    expect(w.endTimer).toBeCloseTo(DEFEAT_DELAY, 9);
    expect(w.over).toBe(false);
  });
});

describe('victory flow', () => {
  it('beginVictory starts the 3.2 s countdown; the run then ends as a victory', () => {
    const w = quiet();
    beginVictory(w);
    expect(w.endTimer).toBeCloseTo(VICTORY_DELAY, 9);
    expect(w.endVictory).toBe(true);
    const story = collect(w, 1, ['story']);
    expect(story.length).toBe(0); // beginVictory emitted its event before the step cleared the list
    const runEnds: boolean[] = [];
    let steps = 1;
    while (!w.over && steps < 400) {
      w.step([NO_INPUT]);
      steps++;
      for (const e of w.events) if (e.t === 'runEnd') runEnds.push(e.victory);
    }
    expect(steps).toBeGreaterThanOrEqual(Math.round(VICTORY_DELAY / DT));
    expect(steps).toBeLessThanOrEqual(Math.round(VICTORY_DELAY / DT) + 2);
    expect(w.over).toBe(true);
    expect(w.victory).toBe(true);
    expect(runEnds).toEqual([true]);
    expect(w.result?.victory).toBe(true);
    expect(w.modal?.kind).toBe('runEnd');
  });

  it('emits the victory story beat when it begins', () => {
    const w = quiet();
    w.bus.clear();
    beginVictory(w);
    expect(w.events).toEqual([{ t: 'story', kind: 'victory', ref: w.zone.id }]);
  });

  it('calling beginVictory again does not restart the countdown', () => {
    const w = quiet();
    beginVictory(w);
    runTicks(w, 100);
    const left = w.endTimer;
    beginVictory(w);
    expect(w.endTimer).toBe(left);
  });

  it('the hero dying during the victory countdown does not turn it into a defeat', () => {
    const w = quiet();
    beginVictory(w);
    runTicks(w, 10);
    lethal(w);
    stepUntilOver(w);
    expect(w.victory).toBe(true);
    expect(w.result?.victory).toBe(true);
  });

  it('victory adds the talent xp bonus', () => {
    const lost = quiet();
    const won = quiet();
    lost.time = 120;
    won.time = 120;
    expect(won.buildResult(true).talentXp - lost.buildResult(false).talentXp).toBe(won.balance.talentXp.victory);
  });
});

describe('RunResult contents', () => {
  function dressed(opts: TestWorldOpts = {}): World {
    const w = quiet(opts);
    w.time = 300; // 5 minutes
    w.tally.kills = 41;
    w.tally.elitesKilled = 3;
    w.tally.bossesKilled.push('boss_horyeong', 'boss_ork_chief');
    w.tally.metinsBroken = 4;
    w.tally.metinIds.push('metin_lament', 'metin_avarice', 'metin_lament', 'metin_avarice');
    w.tally.metinsAwakened = 1;
    w.tally.chestsOpened = 2;
    w.tally.damageDealt = 12345;
    w.tally.damageTaken = 678;
    w.maxCorruption = 0.7;
    const p = player(w);
    p.level = 9;
    p.yeopEarned = 500;
    p.yeop = 120;
    p.shards = 7;
    p.kills = 41;
    return w;
  }

  it('copies the run counters and the hero totals', () => {
    const w = dressed();
    const r = w.buildResult(false);
    expect(r).toMatchObject({
      victory: false,
      time: 300,
      kills: 41,
      elitesKilled: 3,
      level: 9,
      yeop: 500,
      yeopLeft: 120,
      shards: 7,
      metinsBroken: 4,
      metinTypesBroken: ['metin_lament', 'metin_avarice', 'metin_lament', 'metin_avarice'],
      metinsAwakened: 1,
      bossesKilled: ['boss_horyeong', 'boss_ork_chief'],
      chestsOpened: 2,
      maxCorruption: 0.7,
      damageTaken: 678,
      damageDealt: 12345,
      zone: w.zone.id,
      difficulty: 'normal',
      classId: 'warrior',
      doctrine: 'a',
      seed: 1234,
    });
    expect(r.players).toEqual([{ index: 0, level: 9, kills: 41, yeop: 500, alive: true }]);
  });

  it('yeop counts everything collected (spending on chests lowers yeopLeft only)', () => {
    const w = dressed();
    const p = player(w);
    p.yeopEarned = 900;
    p.yeop = 20; // spent 880 on chests
    const r = w.buildResult(false);
    expect(r.yeop).toBe(900);
    expect(r.yeopLeft).toBe(20);
  });

  it('talent xp = minutes·perMinute + kills·perKill + elites·perElite + bosses·perBoss + metins·perMetin (+ victory), rounded', () => {
    const w = dressed();
    const tx = w.balance.talentXp;
    const base = 5 * tx.perMinute + 41 * tx.perKill + 3 * tx.perElite + 2 * tx.perBoss + 4 * tx.perMetin;
    expect(base).toBeCloseTo(236.05, 6);
    expect(w.buildResult(false).talentXp).toBe(236);
    expect(w.buildResult(true).talentXp).toBe(Math.round(base + tx.victory));
    expect(w.buildResult(true).talentXp).toBe(536);
  });

  it('hard difficulty multiplies the talent xp by the reward factor', () => {
    const w = dressed({ config: { difficulty: 'hard' } });
    const base = 236.05;
    expect(w.buildResult(false).talentXp).toBe(Math.round(base * w.balance.hard.reward));
    expect(w.buildResult(false).talentXp).toBe(354);
    expect(w.buildResult(false).difficulty).toBe('hard');
  });

  it('damageBySkill is sorted by damage (descending), ranks are capped at 7 and every owned skill appears', () => {
    const w = dressed();
    const p = player(w);
    const [basic, starter] = p.skills;
    const extra = giveSkill(w, 'bladewheel');
    if (!basic || !starter) throw new Error('hero starts with two skills');
    basic.damage = 50;
    basic.rank = 2;
    starter.damage = 120;
    starter.rank = 4;
    extra.damage = 80;
    extra.rank = 9;
    const r = w.buildResult(false);
    expect(r.damageBySkill).toEqual([
      { skillId: starter.def.id, rank: 4, damage: 120 },
      { skillId: 'bladewheel', rank: 7, damage: 80 },
      { skillId: basic.def.id, rank: 2, damage: 50 },
    ]);
  });

  it('co-op: the same skill from several heroes is merged (damage summed, highest rank), level = highest hero level', () => {
    const w = dressed({ config: { coop: COOP } });
    const a = player(w, 0).skills.find((s) => s.def.id === 'sword_arc');
    const b = player(w, 1).skills.find((s) => s.def.id === 'sword_arc');
    if (!a || !b) throw new Error('both heroes own sword_arc');
    a.damage = 10;
    a.rank = 1;
    b.damage = 20;
    b.rank = 3;
    for (const s of [...player(w, 0).skills, ...player(w, 1).skills]) if (s !== a && s !== b) s.damage = 0;
    player(w, 1).level = 12;
    player(w, 1).yeopEarned = 40;
    player(w, 1).yeop = 5;
    player(w, 1).kills = 9;
    const r = w.buildResult(false);
    const arc = r.damageBySkill.filter((s) => s.skillId === 'sword_arc');
    expect(arc).toEqual([{ skillId: 'sword_arc', rank: 3, damage: 30 }]);
    expect(r.damageBySkill[0]?.skillId).toBe('sword_arc');
    expect(r.level).toBe(12);
    expect(r.yeop).toBe(540);
    expect(r.yeopLeft).toBe(125);
    expect(r.players).toEqual([
      { index: 0, level: 9, kills: 41, yeop: 500, alive: true },
      { index: 1, level: 12, kills: 9, yeop: 40, alive: true },
    ]);
  });

  it('the damage meter fills from real hits and the result mirrors it', () => {
    const w = quiet();
    const p = player(w);
    p.stats.critChance = 0;
    const arc = p.skills.find((s) => s.def.id === 'sword_arc');
    if (!arc) throw new Error('sword_arc missing');
    const row = spawn(w, 'wolf', 40, 0);
    w.enemies.hp[row] = 500;
    const c = Object.assign(newHitCtx(), { player: 0, skill: arc.slot });
    const dealt = hitEnemy(w, row, 14, c) + hitEnemy(w, row, 14, c) + hitEnemy(w, row, 20, c);
    expect(dealt).toBeCloseTo(48, 6);
    const r = w.buildResult(false);
    expect(r.damageDealt).toBeCloseTo(48, 5);
    expect(r.damageBySkill[0]).toMatchObject({ skillId: 'sword_arc', rank: 0 });
    expect(r.damageBySkill[0]?.damage).toBeCloseTo(48, 5);
    expect(r.damageBySkill.find((s) => s.skillId !== 'sword_arc')?.damage).toBe(0);
  });

  it('kills and elites of a real fight end up in the result', () => {
    const w = quiet();
    const p = player(w);
    p.stats.critChance = 0;
    const c = Object.assign(newHitCtx(), { player: 0 });
    for (let i = 0; i < 5; i++) hitEnemy(w, spawn(w, 'wolf', 40 + i, 0), 1e4, c);
    hitEnemy(w, spawn(w, 'alpha_wolf', 40, 5, { tier: 1 }), 1e4, c);
    const r = w.buildResult(false);
    expect(r.kills).toBe(6);
    expect(r.elitesKilled).toBe(1);
    expect(r.players[0]?.kills).toBe(6);
  });

  it('arrays in the result are copies: later tally changes do not leak into a finished result', () => {
    const w = dressed();
    const r = w.buildResult(false);
    w.tally.bossesKilled.push('boss_scarlet_wyrm');
    w.tally.metinIds.push('metin_great');
    expect(r.bossesKilled).toEqual(['boss_horyeong', 'boss_ork_chief']);
    expect(r.metinTypesBroken).toHaveLength(4);
  });

  it('is callable mid-run (a snapshot) and does not end the run', () => {
    const w = quiet();
    runTicks(w, 30);
    const r = w.buildResult(false);
    expect(r.time).toBeCloseTo(30 * DT, 9);
    expect(r.victory).toBe(false);
    expect(w.over).toBe(false);
    expect(w.result).toBeNull();
    expect(r.players[0]?.alive).toBe(true);
  });
});
