// Keeps the skill report bench (benchSkills.ts, run by bench.run.ts `skills` / `survival`) alive: it covers the 31 designed skills, one run is
// deterministic, the counters are sane, and the defensive pick policy of the survival gate picks what it says. The numbers themselves are
// NOT asserted here (they are reported against their bands by `bun run apps/game/src/sim/__tests__/bench.run.ts skills`).

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { BENCH_SKILLS, BUILDS, DEFENSIVE_CARDS, SKILL_SPECS, median, pickDefensive, runSkillBench, runSurvival, skillReport, windowDps } from './bench';
import type { World } from '../world';
import { realWorld } from './skillLab';

describe('skill report bench', () => {
  it('has a band for every designed skill (shadow clone through the uplift row)', () => {
    expect(BENCH_SKILLS).toHaveLength(31);
    for (const id of BENCH_SKILLS) expect(content.skills.some((s) => s.id === id), id).toBe(true);
    for (const id of Object.keys(SKILL_SPECS)) expect(SKILL_SPECS[id]?.metrics.length, id).toBeGreaterThan(0);
  });

  it('a run is deterministic and its counters are sane', () => {
    const a = runSkillBench({ skill: 'graniteform', seed: 11, seconds: 90, warmup: 20 });
    const b = runSkillBench({ skill: 'graniteform', seed: 11, seconds: 90, warmup: 20 });
    expect(a.fires).toBe(b.fires);
    expect(a.totalDps).toBe(b.totalDps);
    expect(a.intakePerMin).toBe(b.intakePerMin);
    expect(a.fires).toBeGreaterThan(0);
    expect(a.uptime).toBeGreaterThan(0);
    expect(a.uptime).toBeLessThanOrEqual(1);
    expect(a.cut).toBeGreaterThanOrEqual(0);
    expect(a.cut).toBeLessThanOrEqual(1);
    expect(a.incomingPerMin).toBeGreaterThanOrEqual(a.intakePerMin - 1e-6);
    expect(a.snaps.length).toBeGreaterThanOrEqual(3);
    expect(Number.isFinite(windowDps(a, 30, 60, 'total'))).toBe(true);
  });

  it('the baseline run without the skill has no fires and no skill damage', () => {
    const r = runSkillBench({ skill: 'graniteform', seed: 11, seconds: 60, warmup: 20, absent: true });
    expect(r.fires).toBe(0);
    expect(r.dps).toBe(0);
    expect(r.uptime).toBe(0);
  });

  it('a skill report judges its metrics against the bands and names the preset it used', () => {
    const rep = skillReport('chilling_dread', [11], undefined, 70);
    expect(rep.rows.length).toBe(SKILL_SPECS.chilling_dread?.metrics.length);
    for (const row of rep.rows) {
      expect(row.target).toMatch(/^\d/);
      expect(typeof row.ok).toBe('boolean');
      expect(row.value).toContain('median');
    }
  });

  it('median ignores NaN and handles even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([Number.NaN, 5])).toBe(5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('survival gate harness', () => {
  it('lists the ten builds and a defensive set for each', () => {
    expect(BUILDS).toHaveLength(10);
    for (const [c, d] of BUILDS) {
      const ids = DEFENSIVE_CARDS[`${c}_${d}`];
      expect(ids, `${c}_${d}`).toBeDefined();
      for (const id of ids ?? []) expect(content.skills.find((s) => s.id === id)?.classId, id).toBe(c);
    }
  });

  it('pickDefensive takes a defensive NEW skill before a defensive upgrade before card 0', () => {
    const fake = { modal: null as unknown } as { modal: unknown };
    const w = fake as unknown as World;
    const card = (kind: 'newSkill' | 'skillUp' | 'newPassive', id: string) => ({ kind, id, rarity: 0, rank: 0, maxRank: 7, awakening: false, lines: [], amount: 0, slot: -1, replaces: null });
    fake.modal = { id: 1, kind: 'levelUp', player: 0, cards: [card('newPassive', 'x'), card('skillUp', 'chilling_dread'), card('newSkill', 'umbral_plate'), card('newSkill', 'unbinding_sigil')] as never, canReroll: false, canBanish: false, canSkip: false, rerolls: 0, banishes: 0, skips: 0, level: 2, source: '', free: false, awakened: false, waited: 0, result: null };
    expect(pickDefensive(w, DEFENSIVE_CARDS.yacha_a ?? [])).toBe(2);
    (fake.modal as { cards: unknown }).cards = [card('newPassive', 'x'), card('skillUp', 'chilling_dread'), card('newSkill', 'unbinding_sigil')];
    expect(pickDefensive(w, DEFENSIVE_CARDS.yacha_a ?? [])).toBe(1);
    (fake.modal as { cards: unknown }).cards = [card('newPassive', 'x'), card('newSkill', 'unbinding_sigil')];
    expect(pickDefensive(w, DEFENSIVE_CARDS.yacha_a ?? [])).toBe(0);
  });

  it('a survival run reports the build, the policy and what it owns', () => {
    const r = runSurvival('warrior', 'b', 11, 'defensive', content, 60);
    expect(r.build).toBe('warrior_b');
    expect(r.pick).toBe('defensive');
    expect(r.seconds).toBeGreaterThan(30);
  });
});
