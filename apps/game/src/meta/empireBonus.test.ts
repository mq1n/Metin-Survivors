// The empire bonus reaches a real run exactly ONCE (e2e audit P1-1: Saehwa "+10% max HP" gave a 384 HP warrior instead
// of 352; Chowon XP ×1.2 and Jihae Yeop ×1.2 / luck 0.10 instead of ×1.1 / 0.05). The run config is built the way the
// app does it — RunConfig.empire = the selection, RunConfig.meta = MetaService.bonusesFor({ classId, doctrine, empire }) —
// against the REAL content, with and without a geared / talented profile.

import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { resolveEdict, type ClassId, type EmpireId } from '../data/schema';
import { createWorld } from '../sim/world';
import { computeMetaBonusDetail, computeMetaBonuses } from './bonuses';
import { seededRng } from './rng';
import { newProfile } from './save';
import { allocateTalent, xpForPoints } from './talents';
import type { SaveData } from './types';

const NOW = 1_700_000_000_000;
const fresh = (): SaveData => newProfile(content, { now: NOW, rng: seededRng(3), name: 'Empire' });

function heroStats(save: SaveData, classId: ClassId, empire: EmpireId) {
  const meta = computeMetaBonuses(save, content, { classId, doctrine: 'a', empire });
  const w = createWorld({ zone: 'yeonmu', difficulty: 'normal', classId, doctrine: 'a', sex: 'm', empire, seed: 5, meta }, content);
  const p = w.players[0];
  if (!p) throw new Error('no hero');
  return { hpMax: p.hpMax, xpGain: p.stats.xpGain, yeopGain: p.stats.yeopGain, luck: p.stats.luck, fixed: p.fixed.length };
}

function bonus(id: EmpireId): Record<string, number> {
  const e = content.empires.find((x) => x.id === id);
  if (!e) throw new Error(`no empire ${id}`);
  return e.bonus as Record<string, number>;
}

describe('empire bonus in a real run', () => {
  const classes = content.classes.map((c) => c.id);

  it('applies each empire once on a fresh profile, for every class', () => {
    for (const classId of classes) {
      const cls = content.classes.find((c) => c.id === classId);
      if (!cls) throw new Error(classId);
      const base = cls.base.maxHp;
      const saehwa = heroStats(fresh(), classId, 'saehwa');
      expect(saehwa.hpMax, `${classId} saehwa hp`).toBeCloseTo(base * (1 + (bonus('saehwa').maxHpPct ?? 0)), 6);
      const chowon = heroStats(fresh(), classId, 'chowon');
      expect(chowon.hpMax, `${classId} chowon hp`).toBeCloseTo(base, 6);
      expect(chowon.xpGain, `${classId} chowon xp`).toBeCloseTo(1 + (bonus('chowon').xpGain ?? 0), 6);
      const jihae = heroStats(fresh(), classId, 'jihae');
      expect(jihae.yeopGain, `${classId} jihae yeop`).toBeCloseTo(1 + (bonus('jihae').yeopGain ?? 0), 6);
      expect(jihae.luck, `${classId} jihae luck`).toBeCloseTo(bonus('jihae').luck ?? 0, 6);
    }
  });

  it('warrior + Saehwa starts at 352 HP (320 base +10%), not 384', () => {
    const cls = content.classes.find((c) => c.id === 'warrior');
    if (cls?.base.maxHp !== 320 || bonus('saehwa').maxHpPct !== 0.1) return; // content retuned: the generic case above still guards it
    expect(heroStats(fresh(), 'warrior', 'saehwa').hpMax).toBeCloseTo(352, 6);
  });

  it('meta bonuses (talents / gear) still add on top of the single empire bonus', () => {
    // a Saehwa hero with +20% max HP from meta: (base) × (1 + 0.1 + 0.2), the empire counted once
    const cls = content.classes.find((c) => c.id === 'warrior');
    if (!cls) throw new Error('warrior');
    const w = createWorld(
      { zone: 'yeonmu', difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 5, meta: { stats: { maxHpPct: 0.2 } } },
      content,
    );
    expect(w.players[0]?.hpMax).toBeCloseTo(cls.base.maxHp * (1 + (bonus('saehwa').maxHpPct ?? 0) + 0.2), 6);
  });
});

// DA-01: the empire's edict is a run budget (one reroll / banish / skip more), read by the sim from the same RunConfig.empire as the stat bonus.
// It must not turn into a stat, and it must add to (never replace) the budgets a talent node grants.
describe('empire edict in a real run', () => {
  const budgets = (save: SaveData, classId: ClassId, empire: EmpireId): { rerolls: number; banishes: number; skips: number; metaRerolls: number } => {
    const meta = computeMetaBonuses(save, content, { classId, doctrine: 'a', empire });
    const w = createWorld({ zone: 'yeonmu', difficulty: 'normal', classId, doctrine: 'a', sex: 'm', empire, seed: 5, meta }, content);
    const p = w.players[0];
    if (!p) throw new Error('no hero');
    return { rerolls: p.rerolls, banishes: p.banishes, skips: p.skips, metaRerolls: meta.rerolls ?? 0 };
  };
  const edictOf = (id: EmpireId) => resolveEdict(content.empires.find((x) => x.id === id));

  /** a warrior profile that owns the doctrine A Reroll node (r3c2), reached the way a player does: rows 0-2 first */
  function rerollTalentProfile(): SaveData {
    let s = fresh();
    s.classes.warrior.xp = xpForPoints(40);
    for (let pass = 0; pass < 4; pass++) {
      for (const id of ['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2', 'r2c0', 'r2c1', 'r2c2', 'r3c2']) {
        const r = allocateTalent(s, content, 'warrior', 'a', id);
        if (r.ok) s = r.save;
      }
    }
    return s;
  }

  it('a fresh profile starts with balance + the edict, for every class and empire', () => {
    const bal = content.balance;
    for (const cls of content.classes) {
      for (const empire of ['saehwa', 'chowon', 'jihae'] as const) {
        const e = edictOf(empire);
        expect(budgets(fresh(), cls.id, empire), `${cls.id} ${empire}`).toMatchObject({
          rerolls: bal.rerollsPerRun + e.rerolls,
          banishes: bal.banishesPerRun + e.banishes,
          skips: bal.skipsPerRun + e.skips,
        });
      }
    }
  });

  it("adds to a talent node's budget instead of replacing it", () => {
    const save = rerollTalentProfile();
    const bal = content.balance;
    for (const empire of ['saehwa', 'chowon', 'jihae'] as const) {
      const b = budgets(save, 'warrior', empire);
      expect(b.metaRerolls, 'the Reroll talent node is owned').toBeGreaterThan(0);
      expect(b.rerolls, empire).toBe(bal.rerollsPerRun + b.metaRerolls + edictOf(empire).rerolls);
    }
  });

  it('is not a stat: the empire edict never shows in the meta bonuses or the breakdown', () => {
    const d = computeMetaBonusDetail(fresh(), content, { classId: 'warrior', doctrine: 'a', empire: 'chowon' });
    expect(d.bonuses.rerolls).toBeUndefined();
    expect(d.breakdown.empire).toEqual({ xpGain: 0.1 });
  });
});
