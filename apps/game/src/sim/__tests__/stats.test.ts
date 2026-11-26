// Player stat aggregation: class base + empire/meta + passives + spirit stones + trinkets + buffs, caps, race table, hp sync.

import { describe, expect, it } from 'vitest';
import type { ClassId, ContentDB, StatMods, TrinketDef } from '../../data/schema';
import { t } from '../__fixtures__/helpers';
import { classBaseMods, createStats, refreshStats } from '../stats';
import type { PlayerState } from '../stores';
import type { World } from '../world';
import { freezeSchedules, makeWorld, player, runTicks, type TestWorldOpts } from './helpers';

/** a world whose hero has ONLY the class base block (empire + meta mods removed), stats refreshed */
function bareHero(opts: TestWorldOpts = {}): { w: World; p: PlayerState } {
  const w = makeWorld(opts);
  const p = player(w);
  p.fixed = [];
  refreshStats(p, w.content, w.ix);
  p.hp = p.hpMax;
  return { w, p };
}

function refresh(w: World, p: PlayerState): void {
  refreshStats(p, w.content, w.ix);
}

function typeIdx(w: World, id: string): number {
  const i = w.ix.typeIndex.get(id);
  if (i === undefined) throw new Error(`unknown type ${id}`);
  return i;
}

function addTrinketDef(c: ContentDB, def: Pick<TrinketDef, 'id' | 'effect' | 'perRank' | 'slot'>): void {
  c.trinkets.push({ ...def, name: t('x', 'x'), desc: t('x', 'x'), icon: 'icon_x', maxRank: 3 });
}

describe('class base', () => {
  it('a bare warrior has exactly the class base block and neutral multipliers', () => {
    const { p } = bareHero();
    const s = p.stats;
    expect(s.maxHp).toBe(220);
    expect(s.armor).toBe(8);
    expect(s.moveSpeed).toBeCloseTo(5.6, 6);
    expect(s.regen).toBeCloseTo(0.4, 6);
    expect(s.critChance).toBeCloseTo(0.05, 6);
    expect(s.critMul).toBeCloseTo(1.5, 6);
    expect(s.damage).toBe(1);
    expect(s.cooldownMul).toBe(1);
    expect(s.area).toBe(1);
    expect(s.duration).toBe(1);
    expect(s.projectiles).toBe(0);
    expect(s.projSpeed).toBe(1);
    expect(s.pierce).toBe(0);
    expect(s.xpGain).toBe(1);
    expect(s.yeopGain).toBe(1);
    expect(s.pickupRadius).toBeCloseTo(3.2, 6);
    expect(s.luck).toBe(0);
    expect(s.revives).toBe(0);
    expect(s.lifesteal).toBe(0);
    expect(s.evasion).toBe(0);
    expect(s.thorns).toBe(0);
    expect(s.vsBoss).toBe(0);
    expect(Object.keys(s.vsRace)).toHaveLength(0);
    for (const r of s.resist) expect(r).toBe(0);
    for (const k of ['chainChance', 'chainDamage', 'stunChance', 'slowChance', 'poisonChance', 'critBurstRadius', 'critBurstDamage', 'shieldMax', 'shieldRegen'] as const) {
      expect(s[k]).toBe(0);
    }
    expect(p.hpMax).toBe(220);
    expect(p.statsDirty).toBe(false);
  });

  it('classBaseMods drops the three absolute fields and keeps the additive ones', () => {
    const w = makeWorld();
    const cls = w.ix.classes.get('warrior');
    if (!cls) throw new Error('warrior missing');
    expect(classBaseMods(cls)).toEqual({ critChance: 0.05, critDamage: 0, regen: 0.4 });
  });

  it('createStats() defaults match the documented neutral hero', () => {
    const s = createStats();
    expect(s.maxHp).toBe(100);
    expect(s.critMul).toBe(1.5);
    expect(s.cooldownMul).toBe(1);
    expect(s.resist).toHaveLength(8);
  });

  it('an unknown class id is a hard error', () => {
    const w = makeWorld();
    const p = player(w);
    p.classId = 'nope' as ClassId;
    expect(() => refresh(w, p)).toThrow(/unknown class/);
  });
});

describe('empire and meta bonuses', () => {
  it('saehwa adds 10% max hp on top of the class base; the default world uses it', () => {
    const w = makeWorld();
    const p = player(w);
    expect(p.stats.maxHp).toBeCloseTo(242, 4);
    expect(p.hpMax).toBeCloseTo(242, 4);
    expect(p.hp).toBeCloseTo(242, 4);
  });

  it('chowon adds xp gain, jihae adds yeop gain and luck', () => {
    const chowon = player(makeWorld({ config: { empire: 'chowon' } })).stats;
    expect(chowon.xpGain).toBeCloseTo(1.1, 6);
    expect(chowon.maxHp).toBe(220);
    const jihae = player(makeWorld({ config: { empire: 'jihae' } })).stats;
    expect(jihae.yeopGain).toBeCloseTo(1.1, 6);
    expect(jihae.luck).toBeCloseTo(0.1, 6);
  });

  it('meta stat blocks are additive: flat maxHp before the % multiplier, armor flat, damage as a fraction', () => {
    const w = makeWorld({ config: { empire: 'chowon', meta: { stats: { maxHp: 30, maxHpPct: 0.1, armor: 4, damage: 0.2, moveSpeed: 0.1 } } } });
    const s = player(w).stats;
    expect(s.maxHp).toBeCloseTo((220 + 30) * 1.1, 4);
    expect(s.armor).toBe(12);
    expect(s.damage).toBeCloseTo(1.2, 6);
    expect(s.moveSpeed).toBeCloseTo(5.6 * 1.1, 5);
  });

  it('empire and meta max-hp percentages sum (not multiply)', () => {
    const w = makeWorld({ config: { meta: { stats: { maxHpPct: 0.2 } } } });
    expect(player(w).stats.maxHp).toBeCloseTo(220 * (1 + 0.1 + 0.2), 4);
  });
});

describe('passives: effect = perRank × power', () => {
  const cases: [id: string, power: number, check: (s: PlayerState['stats']) => void][] = [
    ['sovereign_blood', 3, (s) => expect(s.maxHp).toBeCloseTo(220 * (1 + 0.08 * 3), 4)],
    ['holy_armor', 2.7, (s) => expect(s.armor).toBeCloseTo(8 + 6 * 2.7, 4)],
    ['haste', 2, (s) => expect(s.moveSpeed).toBeCloseTo(5.6 * (1 + 0.04 * 2), 5)],
    [
      'fury',
      3,
      (s) => {
        expect(s.critChance).toBeCloseTo(0.05 + 0.03 * 3, 6);
        expect(s.critMul).toBeCloseTo(1.5 + 0.05 * 3, 6);
      },
    ],
    ['focus', 4, (s) => expect(s.cooldownMul).toBeCloseTo(1 - 0.04 * 4, 6)],
    ['eyes', 2, (s) => expect(s.area).toBeCloseTo(1 + 0.06 * 2, 6)],
    ['fortune', 2, (s) => expect(s.luck).toBeCloseTo(0.05 * 2, 6)],
    ['ghostly_grasp', 2, (s) => expect(s.pickupRadius).toBeCloseTo(3.2 * (1 + 0.12 * 2), 5)],
  ];

  for (const [id, power, check] of cases) {
    it(`${id} at power ${power}`, () => {
      const { w, p } = bareHero();
      p.passives.push({ id, rank: 2, power });
      refresh(w, p);
      check(p.stats);
    });
  }

  it('uses the accumulated rarity power, not the rank counter', () => {
    const { w, p } = bareHero();
    p.passives.push({ id: 'holy_armor', rank: 1, power: 1.35 + 1.7 + 2.6 });
    refresh(w, p);
    expect(p.stats.armor).toBeCloseTo(8 + 6 * 5.65, 4);
    p.passives[0]!.rank = 5; // rank alone changes nothing
    refresh(w, p);
    expect(p.stats.armor).toBeCloseTo(8 + 6 * 5.65, 4);
  });

  it('several passives stack additively and unknown ids are ignored', () => {
    const { w, p } = bareHero();
    p.passives.push({ id: 'sovereign_blood', rank: 1, power: 1 }, { id: 'holy_armor', rank: 1, power: 1 }, { id: 'not_a_passive', rank: 3, power: 3 });
    refresh(w, p);
    expect(p.stats.maxHp).toBeCloseTo(220 * 1.08, 4);
    expect(p.stats.armor).toBeCloseTo(14, 5);
  });

  it('percent bonuses from different sources share one multiplier (empire + passive + stone)', () => {
    const w = makeWorld(); // keeps the saehwa +10%
    const p = player(w);
    p.passives.push({ id: 'sovereign_blood', rank: 2, power: 2 });
    p.stones[3] = { id: 'life', level: 1 };
    refresh(w, p);
    expect(p.stats.maxHp).toBeCloseTo(220 * (1 + 0.1 + 0.16 + 0.06), 4);
  });
});

describe('spirit stones: effect = perLevel × (level + 1)', () => {
  it('a +0 stone still gives one step', () => {
    const { w, p } = bareHero();
    p.stones[0] = { id: 'piercing', level: 0 };
    refresh(w, p);
    expect(p.stats.damage).toBeCloseTo(1.04, 6);
    expect(p.stats.pierce).toBe(1);
  });

  it('piercing +3 gives 4 steps of damage and pierce', () => {
    const { w, p } = bareHero();
    p.stones[0] = { id: 'piercing', level: 3 };
    refresh(w, p);
    expect(p.stats.damage).toBeCloseTo(1.16, 6);
    expect(p.stats.pierce).toBe(4);
  });

  it('deadly +2 adds crit chance; evasion +4 adds evasion; life +1 adds hp% and regen', () => {
    const { w, p } = bareHero();
    p.stones[1] = { id: 'deadly', level: 2 };
    p.stones[3] = { id: 'evasion', level: 4 };
    p.stones[4] = { id: 'life', level: 1 };
    refresh(w, p);
    expect(p.stats.critChance).toBeCloseTo(0.05 + 0.03 * 3, 6);
    expect(p.stats.evasion).toBeCloseTo(0.02 * 5, 6);
    expect(p.stats.maxHp).toBeCloseTo(220 * (1 + 0.03 * 2), 4);
    expect(p.stats.regen).toBeCloseTo(0.4 + 0.15 * 2, 6);
  });

  it('beast hunter feeds the race table (animals +6% per step)', () => {
    const { w, p } = bareHero();
    p.stones[2] = { id: 'beast_hunter', level: 1 };
    refresh(w, p);
    expect(p.stats.vsRace.animal).toBeCloseTo(0.12, 6);
    expect(p.raceMul[typeIdx(w, 'wolf')]).toBeCloseTo(1.12, 5);
    expect(p.raceMul[typeIdx(w, 'bomb_imp')]).toBe(1);
  });

  it('empty slots and unknown stones are ignored; removing a stone removes its bonus', () => {
    const { w, p } = bareHero();
    p.stones[0] = { id: 'piercing', level: 1 };
    p.stones[5] = { id: 'mystery', level: 4 };
    refresh(w, p);
    expect(p.stats.damage).toBeCloseTo(1.08, 6);
    p.stones[0] = null;
    refresh(w, p);
    expect(p.stats.damage).toBe(1);
    expect(p.stats.pierce).toBe(0);
  });
});

describe('trinkets', () => {
  it('lifesteal scales linearly with rank', () => {
    const { w, p } = bareHero();
    p.trinkets[0] = { id: 'lifesteal', rank: 2 };
    refresh(w, p);
    expect(p.stats.lifesteal).toBeCloseTo(0.024, 6);
    p.trinkets[0] = { id: 'lifesteal', rank: 3 };
    refresh(w, p);
    expect(p.stats.lifesteal).toBeCloseTo(0.036, 6);
  });

  it('stun chance scales with rank, duration does not', () => {
    const { w, p } = bareHero();
    p.trinkets[1] = { id: 'stun_chance', rank: 2 };
    refresh(w, p);
    expect(p.stats.stunChance).toBeCloseTo(0.06, 6);
    expect(p.stats.stunDuration).toBeCloseTo(0.6, 6);
    p.trinkets[1] = { id: 'stun_chance', rank: 3 };
    refresh(w, p);
    expect(p.stats.stunChance).toBeCloseTo(0.09, 6);
    expect(p.stats.stunDuration).toBeCloseTo(0.6, 6);
  });

  it('poison: chance and power scale with rank, duration does not', () => {
    const { w, p } = bareHero();
    p.trinkets[2] = { id: 'poison_chance', rank: 3 };
    refresh(w, p);
    expect(p.stats.poisonChance).toBeCloseTo(0.24, 6);
    expect(p.stats.poisonPower).toBeCloseTo(0.9, 6);
    expect(p.stats.poisonDuration).toBeCloseTo(3, 6);
  });

  it('thorns scale with rank and add to stat-block thorns', () => {
    const { w, p } = bareHero();
    p.fixed = [{ thorns: 0.1 }];
    p.trinkets[0] = { id: 'thorns', rank: 2 };
    refresh(w, p);
    expect(p.stats.thorns).toBeCloseTo(0.5 + 0.1, 6);
  });

  it('crit burst: radius is fixed, damage scales with rank', () => {
    const { w, p } = bareHero();
    p.trinkets[1] = { id: 'crit_burst', rank: 2 };
    refresh(w, p);
    expect(p.stats.critBurstRadius).toBeCloseTo(3, 6);
    expect(p.stats.critBurstDamage).toBeCloseTo(0.5, 6);
  });

  it('shield: amount and regen scale with rank', () => {
    const { w, p } = bareHero();
    p.trinkets[2] = { id: 'shield', rank: 2 };
    refresh(w, p);
    expect(p.stats.shieldMax).toBeCloseTo(24, 6);
    expect(p.stats.shieldRegen).toBeCloseTo(1.6, 6);
  });

  it('chain hit and slow effects (custom trinkets): rank 1 uses the def values, higher ranks never weaken, caps hold', () => {
    const content = (c: ContentDB): void => {
      addTrinketDef(c, { id: 'chain_t', slot: 'necklace', effect: 'chainHit', perRank: { chance: 0.1, damage: 0.5 } });
      addTrinketDef(c, { id: 'slow_t', slot: 'earring', effect: 'slowChance', perRank: { chance: 0.1, power: 0.3, duration: 2 } });
    };
    const { w, p } = bareHero({ content });
    p.trinkets[1] = { id: 'chain_t', rank: 1 };
    p.trinkets[2] = { id: 'slow_t', rank: 1 };
    refresh(w, p);
    expect(p.stats.chainChance).toBeCloseTo(0.1, 6);
    expect(p.stats.chainDamage).toBeCloseTo(0.5, 6);
    expect(p.stats.slowChance).toBeCloseTo(0.1, 6);
    expect(p.stats.slowPower).toBeCloseTo(0.3, 6);
    expect(p.stats.slowDuration).toBeCloseTo(2, 6);
    let lastChainDmg = p.stats.chainDamage;
    let lastSlowPower = p.stats.slowPower;
    for (const rank of [2, 3, 4]) {
      p.trinkets[1] = { id: 'chain_t', rank };
      p.trinkets[2] = { id: 'slow_t', rank };
      refresh(w, p);
      expect(p.stats.chainChance).toBeCloseTo(0.1 * rank, 6);
      expect(p.stats.slowChance).toBeCloseTo(0.1 * rank, 6);
      expect(p.stats.chainDamage).toBeGreaterThanOrEqual(lastChainDmg);
      expect(p.stats.slowPower).toBeGreaterThanOrEqual(lastSlowPower);
      lastChainDmg = p.stats.chainDamage;
      lastSlowPower = p.stats.slowPower;
    }
    p.trinkets[1] = { id: 'chain_t', rank: 50 };
    p.trinkets[2] = { id: 'slow_t', rank: 50 };
    refresh(w, p);
    // far beyond any real rank: the proc stats must be saturated below the raw linear value (and below certainty)
    expect(p.stats.chainChance).toBeLessThan(1);
    expect(p.stats.chainChance).toBeLessThan(0.1 * 50);
    expect(p.stats.slowChance).toBeLessThan(1);
    expect(p.stats.slowChance).toBeLessThan(0.1 * 50);
    expect(p.stats.slowPower).toBeLessThan(1);
    expect(p.stats.chainChance).toBeGreaterThan(0.3); // still a strong proc
  });

  it('proc chances are capped below certainty no matter the rank', () => {
    const { w, p } = bareHero();
    p.trinkets[1] = { id: 'stun_chance', rank: 40 };
    p.trinkets[2] = { id: 'poison_chance', rank: 40 };
    refresh(w, p);
    expect(p.stats.stunChance).toBeLessThan(1);
    expect(p.stats.stunChance).toBeGreaterThan(0.3);
    expect(p.stats.poisonChance).toBeLessThan(1);
    expect(p.stats.poisonChance).toBeGreaterThan(0.5);
  });

  it('removing a trinket resets its derived stats to 0; unknown trinkets are ignored', () => {
    const { w, p } = bareHero();
    p.trinkets[0] = { id: 'thorns', rank: 3 };
    p.trinkets[1] = { id: 'stun_chance', rank: 3 };
    p.trinkets[2] = { id: 'who_knows', rank: 3 };
    refresh(w, p);
    expect(p.stats.thorns).toBeGreaterThan(0);
    expect(p.stats.stunChance).toBeGreaterThan(0);
    p.trinkets[0] = null;
    p.trinkets[1] = null;
    refresh(w, p);
    expect(p.stats.thorns).toBe(0);
    expect(p.stats.stunChance).toBe(0);
    expect(p.stats.stunDuration).toBe(0);
  });

  it('refreshing twice never accumulates trinket effects', () => {
    const { w, p } = bareHero();
    p.trinkets[0] = { id: 'lifesteal', rank: 2 };
    p.trinkets[1] = { id: 'crit_burst', rank: 2 };
    p.trinkets[2] = { id: 'shield', rank: 2 };
    refresh(w, p);
    const before = { ls: p.stats.lifesteal, cb: p.stats.critBurstDamage, sh: p.stats.shieldMax };
    refresh(w, p);
    refresh(w, p);
    expect(p.stats.lifesteal).toBeCloseTo(before.ls, 9);
    expect(p.stats.critBurstDamage).toBeCloseTo(before.cb, 9);
    expect(p.stats.shieldMax).toBeCloseTo(before.sh, 9);
  });
});

describe('temporary buffs', () => {
  it('buff mods add to the stat blocks', () => {
    const { w, p } = bareHero();
    p.buffs.push({ skillSlot: 0, mods: { damage: 0.5, moveSpeed: 0.5, armor: 10 }, left: 5, total: 5 });
    refresh(w, p);
    expect(p.stats.damage).toBeCloseTo(1.5, 6);
    expect(p.stats.moveSpeed).toBeCloseTo(5.6 * 1.5, 5);
    expect(p.stats.armor).toBe(18);
  });

  it('buffs stack with passives additively', () => {
    const { w, p } = bareHero();
    p.passives.push({ id: 'haste', rank: 1, power: 1 });
    p.buffs.push({ skillSlot: 0, mods: { moveSpeed: 0.2 }, left: 5, total: 5 });
    refresh(w, p);
    expect(p.stats.moveSpeed).toBeCloseTo(5.6 * (1 + 0.04 + 0.2), 5);
  });

  it('an expired buff is removed during the step and the stats fall back', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    p.buffs.push({ skillSlot: 0, mods: { damage: 1, armor: 50 }, left: 1, total: 1 });
    p.statsDirty = true;
    runTicks(w, 1);
    expect(p.stats.damage).toBeCloseTo(2, 6);
    expect(p.stats.armor).toBe(58);
    runTicks(w, 65);
    expect(p.buffs).toHaveLength(0);
    expect(p.stats.damage).toBe(1);
    expect(p.stats.armor).toBe(8);
    expect(p.statsDirty).toBe(false);
  });

  it('statsDirty is honoured by the next step and cleared afterwards', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    p.passives.push({ id: 'holy_armor', rank: 1, power: 1 });
    p.statsDirty = true;
    expect(p.stats.armor).toBe(8);
    runTicks(w, 1);
    expect(p.stats.armor).toBe(14);
    expect(p.statsDirty).toBe(false);
  });
});

describe('caps and floors', () => {
  it('cooldown reduction is capped at caps.cooldown (50%)', () => {
    const { w, p } = bareHero();
    p.passives.push({ id: 'focus', rank: 5, power: 40 });
    refresh(w, p);
    expect(p.stats.cooldownMul).toBeCloseTo(0.5, 6);
  });

  it('negative cooldown reduction does not lengthen cooldowns; attackSpeed divides them', () => {
    const { w, p } = bareHero();
    p.fixed = [{ cooldown: -0.3 }];
    refresh(w, p);
    expect(p.stats.cooldownMul).toBe(1);
    p.fixed = [{ attackSpeed: 1 }];
    refresh(w, p);
    expect(p.stats.cooldownMul).toBeCloseTo(0.5, 6);
    p.fixed = [{ attackSpeed: 1, cooldown: 0.9 }]; // capped 0.5 reduction, then /2
    refresh(w, p);
    expect(p.stats.cooldownMul).toBeCloseTo(0.25, 6);
    p.fixed = [{ attackSpeed: -3 }]; // slow-down is bounded
    refresh(w, p);
    expect(p.stats.cooldownMul).toBeCloseTo(2, 6);
  });

  it('lifesteal (stat block + trinket) is capped at caps.lifesteal (15%)', () => {
    const { w, p } = bareHero();
    p.fixed = [{ lifesteal: 0.5 }];
    refresh(w, p);
    expect(p.stats.lifesteal).toBeCloseTo(0.15, 6);
    p.fixed = [{ lifesteal: 0.12 }];
    p.trinkets[0] = { id: 'lifesteal', rank: 3 }; // +0.036
    refresh(w, p);
    expect(p.stats.lifesteal).toBeCloseTo(0.15, 6);
    p.fixed = [{ lifesteal: 0.05 }];
    refresh(w, p);
    expect(p.stats.lifesteal).toBeCloseTo(0.086, 6); // below the cap: plain sum
  });

  it('evasion is capped at caps.evasion (60%) and never negative', () => {
    const { w, p } = bareHero();
    p.fixed = [{ evasion: 0.9 }];
    refresh(w, p);
    expect(p.stats.evasion).toBeCloseTo(0.6, 6);
    p.fixed = [{ evasion: -0.4 }];
    refresh(w, p);
    expect(p.stats.evasion).toBe(0);
  });

  it('crit chance is capped at caps.critChance (80%) and floored at 0', () => {
    const { w, p } = bareHero();
    p.fixed = [{ critChance: 2 }];
    refresh(w, p);
    expect(p.stats.critChance).toBeCloseTo(0.8, 6);
    p.fixed = [{ critChance: -2 }];
    refresh(w, p);
    expect(p.stats.critChance).toBe(0);
  });

  it('caps follow the balance config', () => {
    const { w, p } = bareHero({
      content: (c) => {
        c.balance.caps.critChance = 0.3;
        c.balance.caps.evasion = 0.2;
        c.balance.caps.cooldown = 0.25;
        c.balance.caps.lifesteal = 0.05;
      },
    });
    p.fixed = [{ critChance: 1, evasion: 1, cooldown: 1, lifesteal: 1 }];
    refresh(w, p);
    expect(p.stats.critChance).toBeCloseTo(0.3, 6);
    expect(p.stats.evasion).toBeCloseTo(0.2, 6);
    expect(p.stats.cooldownMul).toBeCloseTo(0.75, 6);
    expect(p.stats.lifesteal).toBeCloseTo(0.05, 6);
  });

  it('regeneration is limited to caps.regenPctPerSec of max hp per second', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    p.fixed = [{ regen: 100 }];
    p.statsDirty = true;
    runTicks(w, 1);
    expect(p.stats.regen).toBeGreaterThan(100);
    const cap = p.hpMax * w.balance.caps.regenPctPerSec; // hp / s
    p.hp = 1;
    const start = p.hp;
    runTicks(w, 120);
    const gained = p.hp - start;
    expect(gained).toBeGreaterThan(cap * 2 - 1.5);
    expect(gained).toBeLessThanOrEqual(cap * 2 + 0.01);
  });

  it('regeneration below the cap passes through unchanged', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    p.fixed = [{ regen: 3 }];
    p.statsDirty = true;
    runTicks(w, 1);
    p.hp = 1;
    runTicks(w, 180);
    // 3 hp/s for 3 s (class regen 0.4 is added to the 3 → 3.4 hp/s)
    const expected = 3.4 * 3;
    expect(p.hp - 1).toBeGreaterThan(expected - 1.5);
    expect(p.hp - 1).toBeLessThanOrEqual(expected + 0.01);
  });

  it('damage / area / duration / xp / yeop / projSpeed / speed / pickup range never collapse to zero or below', () => {
    const { w, p } = bareHero();
    p.fixed = [{ damage: -5, area: -5, duration: -5, xpGain: -5, yeopGain: -5, projSpeed: -5, moveSpeed: -5, pickupRadius: -5 }];
    refresh(w, p);
    for (const k of ['damage', 'area', 'duration', 'xpGain', 'yeopGain', 'projSpeed', 'moveSpeed', 'pickupRadius'] as const) {
      expect(p.stats[k]).toBeGreaterThan(0);
      expect(Number.isFinite(p.stats[k])).toBe(true);
    }
    expect(p.stats.moveSpeed).toBeGreaterThanOrEqual(1);
  });

  it('crit multiplier never drops below 1; max hp never below 1; armor / regen never negative', () => {
    const { w, p } = bareHero();
    p.fixed = [{ critDamage: -5, maxHp: -1000, armor: -100, regen: -5 }];
    refresh(w, p);
    expect(p.stats.critMul).toBe(1);
    expect(p.stats.maxHp).toBe(1);
    expect(p.stats.armor).toBe(0);
    expect(p.stats.regen).toBe(0);
  });

  it('elemental resistance is clamped to [-100%, +75%] and indexed by ElementIdx', () => {
    const { w, p } = bareHero();
    p.fixed = [{ resist: { fire: 0.9, ice: -3, lightning: 0.3, physical: 0.2 } }];
    refresh(w, p);
    expect(p.stats.resist[0]).toBeCloseTo(0.2, 6); // physical
    expect(p.stats.resist[1]).toBeCloseTo(0.75, 6); // fire (capped)
    expect(p.stats.resist[2]).toBeCloseTo(-1, 6); // ice (floored)
    expect(p.stats.resist[3]).toBeCloseTo(0.3, 6); // lightning
    expect(p.stats.resist[4]).toBe(0); // dark untouched
  });

  it('revives, projectiles and pierce are whole numbers (floored)', () => {
    const { w, p } = bareHero();
    p.fixed = [{ revives: 2.9, projectiles: 2.5, pierce: 1.4 }];
    refresh(w, p);
    expect(p.stats.revives).toBe(2);
    expect(p.stats.projectiles).toBe(2);
    expect(p.stats.pierce).toBe(1);
    p.fixed = [{ revives: -1 }];
    refresh(w, p);
    expect(p.stats.revives).toBe(0);
  });
});

describe('race multiplier table', () => {
  const vsRace: StatMods = { vsRace: { animal: 0.25, fire: 0.5, devil: 0.1 } };

  it('has one entry per enemy type (creatures then bosses) = 1 + Σ vsRace of its tags', () => {
    const { w, p } = bareHero();
    p.fixed = [vsRace];
    refresh(w, p);
    expect(p.raceMul).toHaveLength(w.typeDefs.length);
    expect(p.raceMul[typeIdx(w, 'wolf')]).toBeCloseTo(1.25, 6); // animal
    expect(p.raceMul[typeIdx(w, 'jackal')]).toBeCloseTo(1.25, 6);
    expect(p.raceMul[typeIdx(w, 'ember_lizard')]).toBeCloseTo(1.5, 6); // fire
    expect(p.raceMul[typeIdx(w, 'bomb_imp')]).toBeCloseTo(1.1, 5); // devil
    expect(p.raceMul[typeIdx(w, 'spitter')]).toBe(1); // insect: no bonus
    expect(p.raceMul[typeIdx(w, 'boss_horyeong')]).toBeCloseTo(1.25, 6); // bosses are rows of the same table
  });

  it('a multi-race type collects every matching bonus', () => {
    const { w, p } = bareHero({
      content: (c) => {
        const wolf = c.enemies.find((e) => e.id === 'wolf');
        if (wolf) wolf.race = ['animal', 'fire'];
      },
    });
    p.fixed = [vsRace];
    refresh(w, p);
    expect(p.raceMul[typeIdx(w, 'wolf')]).toBeCloseTo(1.75, 6);
  });

  it('is rebuilt on every refresh (bonus removed → back to 1)', () => {
    const { w, p } = bareHero();
    p.fixed = [vsRace];
    refresh(w, p);
    expect(p.raceMul[typeIdx(w, 'wolf')]).toBeCloseTo(1.25, 6);
    p.fixed = [];
    refresh(w, p);
    for (const m of p.raceMul) expect(m).toBe(1);
  });

  it('race bonuses from several sources (meta + stone) add up', () => {
    const { w, p } = bareHero();
    p.fixed = [{ vsRace: { animal: 0.1 } }];
    p.stones[2] = { id: 'beast_hunter', level: 0 }; // +0.06
    refresh(w, p);
    expect(p.stats.vsRace.animal).toBeCloseTo(0.16, 6);
    expect(p.raceMul[typeIdx(w, 'fox')]).toBeCloseTo(1.16, 5);
  });

  it('vsBoss is a plain additive stat', () => {
    const { w, p } = bareHero();
    p.fixed = [{ vsBoss: 0.2 }];
    refresh(w, p);
    expect(p.stats.vsBoss).toBeCloseTo(0.2, 6);
  });
});

describe('hp follows max hp', () => {
  it('gaining max hp grants the same amount of current hp', () => {
    const { w, p } = bareHero();
    p.hp = 100;
    p.passives.push({ id: 'sovereign_blood', rank: 1, power: 1 }); // +8% of 220 = +17.6
    refresh(w, p);
    expect(p.hpMax).toBeCloseTo(237.6, 4);
    expect(p.stats.maxHp).toBeCloseTo(237.6, 4);
    expect(p.hp).toBeCloseTo(117.6, 3);
  });

  it('a full-hp hero stays full when max hp grows', () => {
    const { w, p } = bareHero();
    expect(p.hp).toBe(p.hpMax);
    p.passives.push({ id: 'sovereign_blood', rank: 2, power: 2 });
    refresh(w, p);
    expect(p.hp).toBeCloseTo(p.hpMax, 4);
  });

  it('losing max hp clamps current hp to the new maximum but never reduces a lower hp', () => {
    const { w, p } = bareHero();
    p.passives.push({ id: 'sovereign_blood', rank: 5, power: 5 });
    refresh(w, p);
    const big = p.hpMax;
    expect(big).toBeCloseTo(220 * 1.4, 3);
    p.hp = big - 5; // above the future max of 220
    p.passives.length = 0;
    refresh(w, p);
    expect(p.hpMax).toBe(220);
    expect(p.hp).toBe(220);
    // a damaged hero keeps its hp when the maximum drops
    p.passives.push({ id: 'sovereign_blood', rank: 5, power: 5 });
    refresh(w, p);
    p.hp = 100;
    p.passives.length = 0;
    refresh(w, p);
    expect(p.hp).toBe(100);
    expect(p.hpMax).toBe(220);
  });

  it('refreshing without changes is idempotent (no hp or stat drift)', () => {
    const { w, p } = bareHero();
    p.passives.push({ id: 'sovereign_blood', rank: 2, power: 2 }, { id: 'fury', rank: 1, power: 1 });
    p.hp = 150;
    refresh(w, p);
    const snap = { hp: p.hp, maxHp: p.stats.maxHp, crit: p.stats.critChance, mul: p.stats.cooldownMul };
    for (let i = 0; i < 5; i++) refresh(w, p);
    expect(p.hp).toBeCloseTo(snap.hp, 9);
    expect(p.stats.maxHp).toBeCloseTo(snap.maxHp, 9);
    expect(p.stats.critChance).toBeCloseTo(snap.crit, 9);
    expect(p.stats.cooldownMul).toBeCloseTo(snap.mul, 9);
    expect(p.statsDirty).toBe(false);
  });

  it('a new hero starts at full hp (hp == hpMax == stats.maxHp)', () => {
    const w = makeWorld({ config: { meta: { stats: { maxHp: 80, maxHpPct: 0.3 } } } });
    const p = player(w);
    expect(p.hpMax).toBeCloseTo(p.stats.maxHp, 6);
    expect(p.hp).toBeCloseTo(p.hpMax, 6);
    expect(p.stats.maxHp).toBeCloseTo((220 + 80) * (1 + 0.1 + 0.3), 3);
  });
});
