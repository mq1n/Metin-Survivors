// Regression tests for UI-02: Hard-clear talent caps (40..48) in outer Hero/Armory/Character badges and RunEnd TalentBar.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { newProfile } from '../../meta/save';
import { settleRun } from '../../meta/settle';
import {
  MAX_TALENT_CAP,
  MAX_TALENT_POINTS,
  allocateTalent,
  availablePoints,
  pointsForXp,
  spentTotal,
  talentCap,
  treeView,
  xpForPoints,
} from '../../meta/talents';
import type { SaveData } from '../../meta/types';
import type { RunResult } from '../../sim/run';
import { TalentBar, talentBarFrame, talentBarModel } from './RunEnd';
import { installTestDom, type TestDomEnv } from '../testDom';

const ZONE_IDS = content.zones.slice(0, 4).map((z) => z.id);

function spendLegalPoints(base: SaveData, count: number): SaveData {
  let save = structuredClone(base);
  let remaining = count;
  for (const key of ['a', 'b'] as const) {
    while (remaining > 0) {
      const view = treeView(content, save.classes.warrior, 'warrior', key, talentCap(save));
      const next = view?.nodes.find((n) => n.canAllocate);
      if (!next) break;
      const res = allocateTalent(save, content, 'warrior', key, next.node.id);
      if (!res.ok) break;
      save = res.save;
      remaining--;
    }
  }
  return save;
}

function withHardClears(base: SaveData, hardZones: number): SaveData {
  const save = structuredClone(base);
  for (let i = 0; i < hardZones; i++) {
    const zid = ZONE_IDS[i]!;
    save.stats.zones[zid] = {
      ...save.stats.zones[zid],
      hard: { runs: 1, clears: 1, bestTime: 600, bestScore: 100000, bestLevel: 25 },
    };
  }
  return save;
}

function makeHardRun(zone: string, over: Partial<RunResult> = {}): RunResult {
  return {
    seed: 101,
    zone,
    difficulty: 'hard',
    classId: 'warrior',
    doctrine: 'a',
    victory: true,
    time: 720,
    level: 28,
    kills: 1200,
    elitesKilled: 8,
    bossesKilled: [],
    metinsBroken: 4,
    metinsAwakened: 0,
    chestsOpened: 2,
    damageDealt: 500_000,
    damageTaken: 200,
    yeop: 1500,
    yeopLeft: 1500,
    shards: 10,
    talentXp: 0,
    damageBySkill: [],
    players: [{ index: 0, level: 28, kills: 1200, yeop: 1500, alive: true }],
    ...over,
  } as unknown as RunResult;
}

describe('UI-02: Hard-clear talent caps (40..48) across badges and RunEnd TalentBar', () => {
  let dom: TestDomEnv;

  beforeEach(() => {
    dom = installTestDom();
  });

  afterEach(() => {
    render(null, dom.body as unknown as Element);
    dom.restore();
  });

  it('outer UI badges (HeroSelect, Armory, Character) pass talentCap(save) rather than defaulting to 40', () => {
    const uiDir = resolve(__dirname, '..');
    const heroSrc = readFileSync(resolve(uiDir, 'screens/HeroSelect.tsx'), 'utf8');
    const armorySrc = readFileSync(resolve(uiDir, 'screens/armory/Armory.tsx'), 'utf8');
    const charSrc = readFileSync(resolve(uiDir, 'screens/armory/Character.tsx'), 'utf8');

    // Every availablePoints(...) call in these files must pass a 2nd argument (cap)
    for (const [name, src] of [
      ['HeroSelect.tsx', heroSrc],
      ['Armory.tsx', armorySrc],
      ['Character.tsx', charSrc],
    ] as const) {
      const calls = [...src.matchAll(/availablePoints\(([^)]+)\)/g)];
      expect(calls.length, `${name} should call availablePoints`).toBeGreaterThan(0);
      for (const m of calls) {
        expect(m[1], `${name} call availablePoints(${m[1]}) must pass cap`).toContain(',');
      }
      expect(src).toContain('talentCap(save)');
    }
  });

  it('caps 40, 42, 44, 46, and 48 report consistent earned/available points and TalentBar spans', () => {
    for (let hardZones = 0; hardZones <= 4; hardZones++) {
      const expectedCap = MAX_TALENT_POINTS + hardZones * 2;
      let save = withHardClears(newProfile(content), hardZones);
      expect(talentCap(save)).toBe(expectedCap);

      // Give enough XP for expectedCap points and legally spend the base 40
      save.classes.warrior.xp = xpForPoints(expectedCap, MAX_TALENT_CAP);
      save = spendLegalPoints(save, MAX_TALENT_POINTS);
      expect(spentTotal(save.classes.warrior)).toBe(MAX_TALENT_POINTS);

      const cap = talentCap(save);
      expect(availablePoints(save.classes.warrior, cap)).toBe(expectedCap - MAX_TALENT_POINTS);
      // Without cap argument (the old bug), every cap > 40 wrongly returned 0!
      if (expectedCap > MAX_TALENT_POINTS) {
        expect(availablePoints(save.classes.warrior)).toBe(0);
      }

      // Verify TalentBar frame math right below the cap (expectedCap - 1 -> expectedCap) has a real non-zero XP span
      const midFrame = talentBarFrame(expectedCap - 0.5, expectedCap);
      expect(midFrame.points).toBe(expectedCap - 1);
      expect(midFrame.capped).toBe(false);
      expect(midFrame.frac).toBeCloseTo(0.5, 5);
      expect(midFrame.span).toBe(xpForPoints(expectedCap, expectedCap) - xpForPoints(expectedCap - 1, expectedCap));
      expect(midFrame.span).toBeGreaterThan(0);

      // And at the exact cap
      const maxFrame = talentBarFrame(expectedCap, expectedCap);
      expect(maxFrame.points).toBe(expectedCap);
      expect(maxFrame.capped).toBe(true);
      expect(maxFrame.frac).toBe(1);
    }
  });

  it('first Hard clear unlocks banked XP above 40 and RunEnd TalentBar displays 42 / 42 and +2 gained', () => {
    // Reproduce the exact UI-02 report flow: XP banked for 42 points, 40 spent, 0 Hard clears -> first Hard victory!
    let save = newProfile(content);
    const xp42 = xpForPoints(42, MAX_TALENT_CAP);
    save.classes.warrior.xp = xp42;
    save = spendLegalPoints(save, 40);
    expect(talentCap(save)).toBe(40);
    expect(pointsForXp(save.classes.warrior.xp, 40)).toBe(40);
    expect(availablePoints(save.classes.warrior, talentCap(save))).toBe(0);

    const settled = settleRun(save, content, makeHardRun(ZONE_IDS[0]!));
    const tx = settled.summary.talentXp;
    expect(tx.capBefore).toBe(40);
    expect(tx.cap).toBe(42);
    expect(tx.pointsBefore).toBe(40);
    expect(tx.pointsAfter).toBe(42);
    expect(tx.pointsGained).toBe(2);
    expect(tx.available).toBe(2);
    expect(availablePoints(settled.save.classes.warrior, talentCap(settled.save))).toBe(2);

    // Model animates cleanly from 40 -> 42 (NOT stuck at 40/40!)
    const model = talentBarModel(tx);
    expect(model.capBefore).toBe(40);
    expect(model.cap).toBe(42);
    expect(model.p0).toBe(40);
    expect(model.p1).toBe(42);
    expect(model.gained).toBe(2);

    // Render TalentBar skipped=true and inspect actual DOM output
    const host = dom.document.createElement('div');
    dom.body.appendChild(host);
    render(
      h(TalentBar, {
        before: tx.before,
        after: tx.after,
        pointsBefore: tx.pointsBefore,
        pointsAfter: tx.pointsAfter,
        pointsGained: tx.pointsGained,
        capBefore: tx.capBefore,
        cap: tx.cap,
        skipped: true,
        delay: 0,
        label: 'Warrior',
      }),
      host as unknown as Element,
    );
    dom.flushEffects();

    const maxLabel = host.querySelector('.ms-re-points-max')?.textContent ?? '';
    const lineText = host.querySelector('.ms-re-points-line')?.textContent ?? '';
    const gainedChip = host.querySelector('.ms-re-points-chip')?.textContent ?? '';
    expect(maxLabel).toContain('/ 42');
    expect(maxLabel).not.toContain('/ 40');
    expect(lineText).toContain('42');
    expect(gainedChip).toContain('2');
  });

  it('first Hard clear with partial banked XP above 40 (e.g. 41.4 pts) shows 41 / 42 and +1 even with 0 run XP', () => {
    const xp41 = xpForPoints(41, 42);
    const xp42 = xpForPoints(42, 42);
    const banked = Math.round(xp41 + (xp42 - xp41) * 0.4);
    const model = talentBarModel({
      before: banked,
      after: banked,
      pointsBefore: 40,
      pointsAfter: 41,
      pointsGained: 1,
      capBefore: 40,
      cap: 42,
    });
    expect(model.p0).toBe(40);
    expect(model.p1).toBeCloseTo(41.4, 3);
    expect(model.gained).toBe(1);
    expect(model.nextXp).toBe(xp42);

    const finalFrame = talentBarFrame(model.p1, model.cap);
    expect(finalFrame.points).toBe(41);
    expect(finalFrame.capped).toBe(false);
    expect(finalFrame.span).toBe(xp42 - xp41);
  });
});
