// DA-01 Empire edicts: each empire bends one rule. The reroll / banish / skip budget of a run is
//   balance.{rerolls,banishes,skips}PerRun + meta (talent nodes) + the empire's edict,
// one bounded +1 per empire (Saehwa skips, Chowon rerolls, Jihae banishes), equal for every hero of that empire, solo and co-op.
// The edict is a run budget only: it is not a stat (RunStats / the plausibility ceiling never see it) and it draws no rng.

import { afterEach, describe, expect, it } from 'vitest';
import { content as realContent } from '../../data/loader';
import { resolveEdict, type ContentDB, type EmpireId } from '../../data/schema';
import { runStatsOf } from '../../meta/settle';
import { CoopHarness } from '../../net/coop/harness';
import { openEssence, openLevelUp } from '../cards';
import { hurtPlayer } from '../combat';
import type { CoopPlayerInit, MetaBonuses, RunConfig } from '../run';
import { createWorld, type World } from '../world';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { makeWorld, player, runTicks } from './helpers';

const EMPIRES: readonly EmpireId[] = ['saehwa', 'chowon', 'jihae'];
/** what DA-01 ships: one budget +1 per empire */
const EDICTS: Record<EmpireId, { rerolls: number; banishes: number; skips: number }> = {
  saehwa: { rerolls: 0, banishes: 0, skips: 1 },
  chowon: { rerolls: 1, banishes: 0, skips: 0 },
  jihae: { rerolls: 0, banishes: 1, skips: 0 },
};

/** fixture content carrying the shipped edicts (the fixture empires themselves have none) */
function withEdicts(c: ContentDB): void {
  for (const e of c.empires) e.edict = { ...EDICTS[e.id] };
}

const budgets = (w: World, i = 0): { rerolls: number; banishes: number; skips: number } => {
  const p = player(w, i);
  return { rerolls: p.rerolls, banishes: p.banishes, skips: p.skips };
};
const plus = (a: { rerolls: number; banishes: number; skips: number }, b: { rerolls?: number; banishes?: number; skips?: number }): { rerolls: number; banishes: number; skips: number } => ({
  rerolls: a.rerolls + (b.rerolls ?? 0),
  banishes: a.banishes + (b.banishes ?? 0),
  skips: a.skips + (b.skips ?? 0),
});

describe('real content: the shipped edicts', () => {
  it('Saehwa skips +1, Chowon rerolls +1, Jihae banishes +1, nothing else, each stat bonus kept', () => {
    for (const e of EMPIRES) {
      const def = realContent.empires.find((x) => x.id === e);
      expect(def, e).toBeDefined();
      expect(resolveEdict(def), e).toEqual(EDICTS[e]);
    }
    const by = (id: EmpireId): Record<string, number> => realContent.empires.find((x) => x.id === id)!.bonus as Record<string, number>;
    expect(by('saehwa')).toEqual({ maxHpPct: 0.1 });
    expect(by('chowon')).toEqual({ xpGain: 0.1 });
    expect(by('jihae')).toEqual({ yeopGain: 0.1, luck: 0.05 });
  });

  it('every class, every empire: a run starts with balance + the edict (solo)', () => {
    const bal = realContent.balance;
    const base = { rerolls: bal.rerollsPerRun, banishes: bal.banishesPerRun, skips: bal.skipsPerRun };
    for (const cls of realContent.classes) {
      for (const empire of EMPIRES) {
        const w = createWorld({ zone: 'yeonmu', difficulty: 'normal', classId: cls.id, doctrine: 'a', sex: 'm', empire, seed: 5, meta: { stats: {} } }, realContent);
        expect(budgets(w), `${cls.id} ${empire}`).toEqual(plus(base, EDICTS[empire]));
      }
    }
  });

  it('the edict text is in the picker description, in Turkish and English', () => {
    const word = { saehwa: ['Atla', 'Skip'], chowon: ['Yenile', 'Reroll'], jihae: ['Yasakla', 'Banish'] } as const;
    for (const e of realContent.empires) {
      expect(e.desc.tr, `${e.id} tr`).toContain('Ferman');
      expect(e.desc.tr, `${e.id} tr`).toContain(`+1 ${word[e.id][0]}`);
      expect(e.desc.en, `${e.id} en`).toContain('Edict');
      expect(e.desc.en, `${e.id} en`).toContain(`+1 ${word[e.id][1]}`);
    }
  });
});

describe('createPlayer: budgets = balance + meta + edict', () => {
  it('adds the edict on top of balance and talent-node budgets (never replaces them)', () => {
    for (const empire of EMPIRES) {
      const meta: MetaBonuses = { stats: {}, rerolls: 2, banishes: 1, skips: 1 };
      const w = makeWorld({ content: withEdicts, config: { empire, meta } });
      const bal = w.balance;
      const base = { rerolls: bal.rerollsPerRun + 2, banishes: bal.banishesPerRun + 1, skips: bal.skipsPerRun + 1 };
      expect(budgets(w), empire).toEqual(plus(base, EDICTS[empire]));
    }
  });

  it('a missing edict, a missing key and an unknown empire change nothing', () => {
    const none = makeWorld();
    const base = budgets(none);
    expect(base).toEqual({ rerolls: none.balance.rerollsPerRun, banishes: none.balance.banishesPerRun, skips: none.balance.skipsPerRun });
    // empire def without an edict (the fixture)
    for (const empire of EMPIRES) expect(budgets(makeWorld({ config: { empire } })), empire).toEqual(base);
    // an edict with only one key
    const one = makeWorld({ content: (c) => void (c.empires[0]!.edict = { banishes: 2 }), config: { empire: 'saehwa' } });
    expect(budgets(one)).toEqual(plus(base, { banishes: 2 }));
    // an empire id the content does not know (a bad co-op payload): no edict, no throw
    const ghost = makeWorld({ content: withEdicts, config: { empire: 'ghost' as EmpireId } });
    expect(budgets(ghost)).toEqual(base);
  });

  it('is data only: the same seed draws the same random numbers with and without edicts (no rng consumed)', () => {
    const on = makeWorld({ content: withEdicts, config: { empire: 'chowon' } });
    const off = makeWorld({ config: { empire: 'chowon' } });
    for (const k of ['spawn', 'combat', 'cards', 'loot', 'metin', 'boss', 'ai'] as const) {
      expect([on.rng[k].nextU32(), on.rng[k].nextU32(), on.rng[k].nextU32()], k).toEqual([off.rng[k].nextU32(), off.rng[k].nextU32(), off.rng[k].nextU32()]);
    }
    // and the edict is not a stat: hp, damage, xp, yeop, luck are the same with or without it
    expect(on.players[0]!.hpMax).toBe(off.players[0]!.hpMax);
    expect(on.players[0]!.stats.xpGain).toBe(off.players[0]!.stats.xpGain);
    expect(on.players[0]!.stats.yeopGain).toBe(off.players[0]!.stats.yeopGain);
    expect(on.players[0]!.stats.luck).toBe(off.players[0]!.stats.luck);
  });

  it('does not depend on difficulty or on the Run Options (hard, every slider at its extreme)', () => {
    for (const empire of EMPIRES) {
      const normal = budgets(makeWorld({ content: withEdicts, config: { empire } }));
      const hard = budgets(makeWorld({ content: withEdicts, config: { empire, difficulty: 'hard' } }));
      const low = budgets(makeWorld({ content: withEdicts, config: { empire, runOptions: { density: 0.5, health: 0.5, damage: 0.5, speed: 0.5 } } }));
      const high = budgets(makeWorld({ content: withEdicts, config: { empire, difficulty: 'hard', runOptions: { density: 2, health: 2, damage: 2, speed: 2 } } }));
      expect(hard, `${empire} hard`).toEqual(normal);
      expect(low, `${empire} options min`).toEqual(normal);
      expect(high, `${empire} hard + options max`).toEqual(normal);
    }
  });

  it('is not in RunStats: the leaderboard / plausibility payload has the same keys and values whatever the edict', () => {
    const w = makeWorld({ content: withEdicts, config: { empire: 'chowon' } });
    const stats = runStatsOf(w.buildResult(true));
    expect(Object.keys(stats).sort()).toEqual(['bosses', 'elites', 'kills', 'level', 'metins', 'yeop']);
    const off = makeWorld({ config: { empire: 'chowon' } });
    expect(runStatsOf(off.buildResult(true))).toEqual(stats);
  });
});

describe('the edict budget is spendable exactly as many times as granted', () => {
  it('Chowon: one more reroll than the balance (level-up and essence), then it is refused', () => {
    const w = makeWorld({ content: withEdicts, config: { empire: 'chowon' } });
    const total = w.balance.rerollsPerRun + 1;
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    expect(m.rerolls).toBe(total);
    for (let i = 0; i < total; i++) expect(w.reroll(), `reroll ${i + 1}`).toBe(true);
    expect(p.rerolls).toBe(0);
    expect(m.canReroll).toBe(false);
    expect(w.reroll()).toBe(false);
    // the same budget serves essence offers
    const w2 = makeWorld({ content: withEdicts, config: { empire: 'chowon' } });
    const e = openEssence(w2, player(w2), 'metin_avarice', false);
    expect(e.rerolls).toBe(total);
  });

  it('Saehwa: one more skip, spent on a level-up and an essence offer, then refused', () => {
    const w = makeWorld({ content: withEdicts, config: { empire: 'saehwa' } });
    const total = w.balance.skipsPerRun + 1;
    const p = player(w);
    for (let i = 0; i < total; i++) {
      openLevelUp(w, p, 2 + i);
      expect(w.skip(), `skip ${i + 1}`).toBe(true);
      expect(w.modals, `skip ${i + 1} closes the offer`).toHaveLength(0);
    }
    expect(p.skips).toBe(0);
    const m = openLevelUp(w, p, 9);
    expect(m.canSkip).toBe(false);
    expect(w.skip()).toBe(false);
    expect(w.modals).toHaveLength(1);
  });

  it('Jihae: one more banish, then refused', () => {
    const w = makeWorld({ content: withEdicts, config: { empire: 'jihae' } });
    const total = w.balance.banishesPerRun + 1;
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    expect(m.banishes).toBe(total);
    let done = 0;
    for (let guard = 0; guard < 60 && done < total; guard++) {
      const idx = m.cards.findIndex((c) => c.id !== '');
      if (idx < 0) break;
      expect(w.banish(idx), `banish ${done + 1}`).toBe(true);
      done++;
    }
    expect(done).toBe(total);
    expect(p.banishes).toBe(0);
    expect(m.canBanish).toBe(false);
    expect(w.banish(0)).toBe(false);
    expect(p.banished.size).toBe(total);
  });

  it('a budget the edict does not grant stays at the balance value (the edict is one rule, not a bundle)', () => {
    const w = makeWorld({ content: withEdicts, config: { empire: 'jihae' } });
    const bal = w.balance;
    expect(player(w).rerolls).toBe(bal.rerollsPerRun);
    expect(player(w).skips).toBe(bal.skipsPerRun);
  });

  it('pause, death and revive do not touch the budget (it is a run budget, set once)', () => {
    const w = makeWorld({ content: withEdicts, config: { empire: 'chowon', meta: { stats: { revives: 1, maxHpPct: 5 } } } });
    const p = player(w);
    const start = budgets(w);
    const m = openLevelUp(w, p, 2);
    const frozen = w.tick;
    runTicks(w, 300); // paused behind the offer
    expect(w.tick).toBe(frozen);
    expect(budgets(w)).toEqual(start);
    expect(m.rerolls).toBe(start.rerolls);
    w.chooseCard(0);
    hurtPlayer(w, 0, 1e9, 0, 0, 0, 0); // down: a revive, or the run ends
    runTicks(w, 60);
    expect(budgets(w)).toEqual(start);
  });
});

describe('co-op: every hero gets the edict of its own empire', () => {
  const inits = (empires: readonly EmpireId[]): CoopPlayerInit[] =>
    empires.map((empire) => ({ classId: 'warrior', doctrine: 'a', sex: 'm', empire, meta: { stats: {} } }));

  it('CoopPlayerInit.empire reaches createPlayer: a mixed party, each +1 on its own budget', () => {
    const cfg: RunConfig = fixtureConfig({ empire: 'saehwa', coop: inits(['chowon', 'jihae', 'saehwa']) });
    const c = cloneContent();
    withEdicts(c);
    const w = createWorld(cfg, c, cfg.meta);
    const bal = w.balance;
    const base = { rerolls: bal.rerollsPerRun, banishes: bal.banishesPerRun, skips: bal.skipsPerRun };
    expect(w.players).toHaveLength(4);
    expect(budgets(w, 0)).toEqual(plus(base, EDICTS.saehwa));
    expect(budgets(w, 1)).toEqual(plus(base, EDICTS.chowon));
    expect(budgets(w, 2)).toEqual(plus(base, EDICTS.jihae));
    expect(budgets(w, 3)).toEqual(plus(base, EDICTS.saehwa)); // the same empire twice: each hero its own +1, nothing shared
  });

  it('spending one hero\'s edict budget leaves the others alone', () => {
    const cfg: RunConfig = fixtureConfig({ empire: 'chowon', coop: inits(['chowon']) });
    const c = cloneContent();
    withEdicts(c);
    const w = createWorld(cfg, c, cfg.meta);
    const start = budgets(w, 1);
    openLevelUp(w, player(w, 0), 2);
    expect(w.reroll(0)).toBe(true);
    expect(budgets(w, 0).rerolls).toBe(start.rerolls - 1);
    expect(budgets(w, 1)).toEqual(start);
  });

  let h: CoopHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) (h as CoopHarness).tick();
  };

  it('host + two guests through the real session: the offers each hero sees carry its own budgets, also after a guest reconnects (late keyframe)', async () => {
    // the harness lobby is host Saehwa, guest Chowon, guest Jihae
    h = await CoopHarness.create({ guests: 2, latencyMs: 30, enemies: 0, tough: true, content: withEdicts });
    const hw = h.hostWorld;
    const bal = hw.balance;
    const base = { rerolls: bal.rerollsPerRun, banishes: bal.banishesPerRun, skips: bal.skipsPerRun };
    run(120);
    expect(budgets(hw, 0)).toEqual(plus(base, EDICTS.saehwa));
    expect(budgets(hw, 1)).toEqual(plus(base, EDICTS.chowon));
    expect(budgets(hw, 2)).toEqual(plus(base, EDICTS.jihae));

    const seen = (guest: number, player: number): { rerolls: number; banishes: number; skips: number } => {
      openLevelUp(hw, hw.players[player]!, 2);
      run(40);
      const m = h!.guestWorlds[guest]!.modal;
      expect(m, `guest ${guest} sees its offer`).not.toBeNull();
      const out = { rerolls: m!.rerolls, banishes: m!.banishes, skips: m!.skips };
      expect(h!.guestWorlds[guest]!.chooseCard(0)).toBe(true);
      run(60);
      expect(hw.modals).toHaveLength(0);
      return out;
    };
    expect(seen(0, 1)).toEqual(plus(base, EDICTS.chowon));
    expect(seen(1, 2)).toEqual(plus(base, EDICTS.jihae));

    // the Chowon guest spends a reroll, drops and comes back: the resync keyframe shows the spent budget, not a fresh one
    openLevelUp(hw, hw.players[1]!, 3);
    run(40);
    const gw = h.guestWorlds[0]!;
    expect(gw.reroll()).toBe(true);
    run(40);
    expect(gw.chooseCard(0)).toBe(true);
    run(60);
    expect(budgets(hw, 1).rerolls).toBe(base.rerolls + EDICTS.chowon.rerolls - 1);
    await h.reconnect(1);
    run(120);
    expect(seen(0, 1).rerolls).toBe(base.rerolls + EDICTS.chowon.rerolls - 1);
  }, 60_000);
});
