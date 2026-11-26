// Skill parameter resolution: rank-1 params × upgrade lines × talent skillMods × player stats × awakening.
// Pure resolveParams() assertions on the fixture skills (no stepping needed).

import { describe, expect, it } from 'vitest';
import type { ContentDB, StatMods, UpgradeLine, UpgradeStat } from '../../data/schema';
import { MAX_SKILL_RANK } from '../../data/schema';
import type { RunConfig } from '../run';
import { applySkillLine, rollLine } from '../skills';
import { newFinalParams, resolveParams, type FinalParams } from '../skills/params';
import { refreshStats } from '../stats';
import { StatusIdx, UPGRADE_STATS, type SkillInstance } from '../stores';
import type { World } from '../world';
import { dropSkills, giveSkill, makeWorld, player } from './helpers';

function world(config: Partial<RunConfig> = {}, content?: (c: ContentDB) => void): World {
  const w = makeWorld({ config, ...(content ? { content } : {}) });
  dropSkills(w);
  return w;
}

function resolve(w: World, s: SkillInstance): FinalParams {
  return resolveParams(player(w), s, newFinalParams());
}

/** give the hero extra permanent stat mods and recompute the stats */
function addStats(w: World, mods: StatMods): void {
  const p = player(w);
  p.fixed.push(mods);
  refreshStats(p, w.content, w.ix);
}

const line = (stat: UpgradeStat, mode: 'pct' | 'flat', value: number): { stat: UpgradeStat; mode: 'pct' | 'flat'; value: number } => ({ stat, mode, value });

// ---------------------------------------------------------------------------
// rank-1 baseline

describe('baseline resolution', () => {
  it('rank-1 parameters pass through unchanged for a fresh hero (stats are neutral)', () => {
    const w = world();
    const s = giveSkill(w, 'sword_arc');
    const fp = resolve(w, s);
    expect(fp.damage).toBeCloseTo(14, 6);
    expect(fp.cooldown).toBeCloseTo(0.8, 6);
    expect(fp.area).toBeCloseTo(2.6, 6);
    expect(fp.count).toBe(1);
    expect(fp.duration).toBe(0);
    expect(fp.speed).toBe(0);
    expect(fp.pierce).toBe(0);
    expect(fp.knockback).toBeCloseTo(0.8, 6);
    expect(fp.tick).toBe(0);
    expect(fp.range).toBeCloseTo(2.8, 6);
    expect(fp.angle).toBeCloseTo(2.0, 6);
    expect(fp.statusKind).toBe(-1);
    expect(fp.awakened).toBe(false);
    expect(fp.element).toBe(0); // physical
  });

  it('element, status and buff blocks are carried over', () => {
    const w = world();
    const chain = resolve(w, giveSkill(w, 'chain_lightning'));
    expect(chain.element).toBe(3); // lightning
    expect(chain.statusKind).toBe(StatusIdx.Stun);
    expect(chain.statusChance).toBeCloseTo(0.1, 6);
    expect(chain.statusDuration).toBeCloseTo(0.5, 6);
    expect(chain.statusPower).toBeCloseTo(1, 6);
    const buff = resolve(w, giveSkill(w, 'will_to_live'));
    expect(buff.buff).toEqual({ damage: 0.25, moveSpeed: 0.15, armor: 6 });
    expect(buff.heal).toBeCloseTo(25, 6);
    const pool = resolve(w, giveSkill(w, 'venom_pool'));
    expect(pool.statusKind).toBe(StatusIdx.Poison);
    expect(pool.element).toBe(5);
    const plain = resolve(w, giveSkill(w, 'lunge'));
    expect(plain.statusKind).toBe(-1);
    expect(plain.statusChance).toBe(0);
    expect(plain.buff).toBeNull();
  });

  it('every fixture skill resolves to finite, non-negative numbers', () => {
    const w = world();
    for (const def of w.content.skills) {
      const fp = resolve(w, giveSkill(w, def.id));
      for (const [k, v] of Object.entries(fp)) {
        if (typeof v === 'number') {
          expect(Number.isFinite(v), `${def.id}.${k}`).toBe(true);
          if (k !== 'statusKind') expect(v, `${def.id}.${k}`).toBeGreaterThanOrEqual(0);
        }
      }
      expect(fp.count, def.id).toBeGreaterThanOrEqual(1);
      expect(fp.cooldown, def.id).toBeGreaterThanOrEqual(0.1);
    }
  });
});

// ---------------------------------------------------------------------------
// upgrade lines (applySkillLine)

describe('upgrade lines', () => {
  it('pct damage is additive across lines: (1 + Σpct)', () => {
    const w = world();
    const s = giveSkill(w, 'sword_arc');
    applySkillLine(s, line('damage', 'pct', 0.15));
    expect(resolve(w, s).damage).toBeCloseTo(14 * 1.15, 6);
    applySkillLine(s, line('damage', 'pct', 0.15));
    applySkillLine(s, line('damage', 'pct', 0.15));
    expect(resolve(w, s).damage).toBeCloseTo(14 * 1.45, 6);
  });

  it('flat damage is added to the base before the pct multiplier: (base + flat) × (1 + pct)', () => {
    const w = world();
    const s = giveSkill(w, 'sword_arc');
    applySkillLine(s, line('damage', 'flat', 4));
    expect(resolve(w, s).damage).toBeCloseTo(18, 6);
    applySkillLine(s, line('damage', 'pct', 0.15));
    expect(resolve(w, s).damage).toBeCloseTo(18 * 1.15, 6);
  });

  it('cooldown lines REDUCE: pct → × (1 − pct), flat → base − flat, capped at 75% reduction and a 0.1 s floor', () => {
    const w = world();
    const s = giveSkill(w, 'sword_arc'); // 0.8 s
    applySkillLine(s, line('cooldown', 'pct', 0.08));
    expect(resolve(w, s).cooldown).toBeCloseTo(0.8 * 0.92, 6);
    applySkillLine(s, line('cooldown', 'flat', 0.3));
    expect(resolve(w, s).cooldown).toBeCloseTo((0.8 - 0.3) * 0.92, 6);

    const capped = giveSkill(w, 'sword_arc');
    applySkillLine(capped, line('cooldown', 'pct', 0.9));
    expect(resolve(w, capped).cooldown).toBeCloseTo(0.8 * 0.25, 6);
    const floored = giveSkill(w, 'sword_arc');
    applySkillLine(floored, line('cooldown', 'flat', 5));
    expect(resolve(w, floored).cooldown).toBeCloseTo(0.1, 6);
  });

  it('tick lines REDUCE too (pct capped at 70%, floor 0.08 s); skills without a tick stay at 0', () => {
    const w = world();
    const spin = giveSkill(w, 'bladewheel'); // tick 0.3
    applySkillLine(spin, line('tick', 'pct', 0.1));
    expect(resolve(w, spin).tick).toBeCloseTo(0.27, 6);
    applySkillLine(spin, line('tick', 'flat', 0.1));
    expect(resolve(w, spin).tick).toBeCloseTo(0.2 * 0.9, 6);

    const capped = giveSkill(w, 'bladewheel');
    applySkillLine(capped, line('tick', 'pct', 0.95));
    expect(resolve(w, capped).tick).toBeCloseTo(0.3 * 0.3, 6);
    const floored = giveSkill(w, 'bladewheel');
    applySkillLine(floored, line('tick', 'flat', 1));
    expect(resolve(w, floored).tick).toBeCloseTo(0.08, 6);

    const noTick = giveSkill(w, 'sword_arc');
    applySkillLine(noTick, line('tick', 'pct', 0.1));
    expect(resolve(w, noTick).tick).toBe(0);
  });

  it('area / duration / speed / knockback / range lines scale with pct and add with flat', () => {
    const w = world();
    const arc = giveSkill(w, 'sword_arc');
    applySkillLine(arc, line('area', 'pct', 0.12));
    applySkillLine(arc, line('knockback', 'pct', 0.2));
    applySkillLine(arc, line('range', 'pct', 0.1));
    const fa = resolve(w, arc);
    expect(fa.area).toBeCloseTo(2.6 * 1.12, 6);
    expect(fa.knockback).toBeCloseTo(0.8 * 1.2, 6);
    expect(fa.range).toBeCloseTo(2.8 * 1.1, 6);

    const spin = giveSkill(w, 'bladewheel');
    applySkillLine(spin, line('duration', 'pct', 0.15));
    expect(resolve(w, spin).duration).toBeCloseTo(2.5 * 1.15, 6);
    applySkillLine(spin, line('duration', 'flat', 1));
    expect(resolve(w, spin).duration).toBeCloseTo((2.5 + 1) * 1.15, 6);

    const bolt = giveSkill(w, 'spirit_bolt');
    applySkillLine(bolt, line('speed', 'pct', 0.15));
    applySkillLine(bolt, line('area', 'flat', 0.2));
    applySkillLine(bolt, line('range', 'flat', 2));
    const fb = resolve(w, bolt);
    expect(fb.speed).toBeCloseTo(16 * 1.15, 6);
    expect(fb.area).toBeCloseTo(0.6, 6);
    expect(fb.range).toBeCloseTo(16, 6);
  });

  it('count: flat adds, pct adds pct × base (rounded), always ≥ 1', () => {
    const w = world();
    const arc = giveSkill(w, 'sword_arc');
    applySkillLine(arc, line('count', 'flat', 1));
    expect(resolve(w, arc).count).toBe(2);
    applySkillLine(arc, line('count', 'flat', 1));
    expect(resolve(w, arc).count).toBe(3);

    const cut = giveSkill(w, 'lightning_trio'); // base 2
    applySkillLine(cut, line('count', 'pct', 0.5));
    expect(resolve(w, cut).count).toBe(3);
    const small = giveSkill(w, 'sword_arc'); // base 1: +40% rounds back to 1
    applySkillLine(small, line('count', 'pct', 0.4));
    expect(resolve(w, small).count).toBe(1);
    const neg = giveSkill(w, 'sword_arc');
    applySkillLine(neg, line('count', 'flat', -5));
    expect(resolve(w, neg).count).toBe(1);
  });

  it('pierce is flat only (base + flat, rounded)', () => {
    const w = world();
    const bolt = giveSkill(w, 'spirit_bolt');
    applySkillLine(bolt, line('pierce', 'flat', 1));
    expect(resolve(w, bolt).pierce).toBe(1);
    const sword = giveSkill(w, 'aura_sword'); // base 1
    applySkillLine(sword, line('pierce', 'flat', 2));
    expect(resolve(w, sword).pierce).toBe(3);
  });

  it('statusChance / statusPower / heal lines', () => {
    const w = world();
    const chain = giveSkill(w, 'chain_lightning'); // stun chance 0.1
    applySkillLine(chain, line('statusChance', 'flat', 0.05));
    expect(resolve(w, chain).statusChance).toBeCloseTo(0.15, 6);
    const pct = giveSkill(w, 'chain_lightning');
    applySkillLine(pct, line('statusChance', 'pct', 0.5));
    expect(resolve(w, pct).statusChance).toBeCloseTo(0.1 + 0.5 * 0.1, 6);
    const all = giveSkill(w, 'chain_lightning');
    applySkillLine(all, line('statusChance', 'flat', 5));
    expect(resolve(w, all).statusChance).toBe(1); // clamped

    const aura = giveSkill(w, 'fury_aura'); // slow power 0.25
    applySkillLine(aura, line('statusPower', 'pct', 0.2));
    expect(resolve(w, aura).statusPower).toBeCloseTo(0.3, 6);
    applySkillLine(aura, line('statusPower', 'flat', 0.1));
    expect(resolve(w, aura).statusPower).toBeCloseTo(0.25 * 1.2 + 0.1, 6);

    const heal = giveSkill(w, 'will_to_live'); // heal 25
    applySkillLine(heal, line('heal', 'flat', 10));
    expect(resolve(w, heal).heal).toBeCloseTo(35, 6);
    applySkillLine(heal, line('heal', 'pct', 0.15));
    expect(resolve(w, heal).heal).toBeCloseTo(35 + 25 * 0.15, 6);

    // a skill without a status block ignores status lines
    const lunge = giveSkill(w, 'lunge');
    applySkillLine(lunge, line('statusChance', 'flat', 1));
    expect(resolve(w, lunge).statusChance).toBe(0);
    expect(resolve(w, lunge).statusKind).toBe(-1);
  });

  it('every UpgradeStat has an accumulator slot and the sim honours each of them', () => {
    const w = world();
    const s = giveSkill(w, 'chain_lightning');
    expect(s.upg.length).toBe(UPGRADE_STATS.length);
    for (const stat of UPGRADE_STATS) {
      const before = JSON.stringify(s.upg);
      applySkillLine(s, line(stat, 'pct', 0.1));
      expect(JSON.stringify(s.upg)).not.toBe(before);
    }
  });

  it('an unknown stat is ignored; lines never leak into another skill instance', () => {
    const w = world();
    const a = giveSkill(w, 'sword_arc');
    const b = giveSkill(w, 'sword_arc');
    const before = JSON.stringify(a.upg);
    applySkillLine(a, { stat: 'maxHp', mode: 'flat', value: 99 });
    applySkillLine(a, { stat: 'bogus', mode: 'pct', value: 1 });
    expect(JSON.stringify(a.upg)).toBe(before);
    applySkillLine(a, line('damage', 'pct', 1));
    expect(resolve(w, a).damage).toBeCloseTo(28, 6);
    expect(resolve(w, b).damage).toBeCloseTo(14, 6);
  });

  it('rollLine scales the base by the rarity multiplier; flat count / pierce are rounded (min 1)', () => {
    const pct: UpgradeLine = { stat: 'damage', base: 0.15, mode: 'pct' };
    expect(rollLine(pct, 2)).toEqual({ stat: 'damage', mode: 'pct', value: 0.3 });
    const cd: UpgradeLine = { stat: 'cooldown', base: 0.08, mode: 'pct' };
    expect(rollLine(cd, 3).value).toBeCloseTo(0.24, 9);
    const count: UpgradeLine = { stat: 'count', base: 1, mode: 'flat' };
    expect(rollLine(count, 0.4).value).toBe(1); // min 1
    expect(rollLine(count, 1).value).toBe(1);
    expect(rollLine(count, 2.2).value).toBe(2);
    expect(rollLine(count, 3.6).value).toBe(4);
    const pierce: UpgradeLine = { stat: 'pierce', base: 1, mode: 'flat' };
    expect(rollLine(pierce, 3.4).value).toBe(3);
    const heal: UpgradeLine = { stat: 'heal', base: 10, mode: 'flat' };
    expect(rollLine(heal, 1.5).value).toBeCloseTo(15, 9); // other flat lines are not rounded
    const lineFlatCd: UpgradeLine = { stat: 'cooldown', base: 0.5, mode: 'flat' };
    expect(rollLine(lineFlatCd, 1.5).value).toBeCloseTo(0.75, 9);
  });

  it('rolled lines apply end to end: roll → apply → resolved params', () => {
    const w = world();
    const s = giveSkill(w, 'spirit_bolt');
    const upgrades = s.def.upgrades;
    for (const u of upgrades) applySkillLine(s, rollLine(u, 1));
    const fp = resolve(w, s);
    expect(fp.damage).toBeCloseTo(12 * 1.15, 6); // pct damage 0.15
    expect(fp.cooldown).toBeCloseTo(0.9 * 0.92, 6); // pct cooldown 0.08
    expect(fp.count).toBe(2); // flat count 1
    expect(fp.pierce).toBe(1); // flat pierce 1
    expect(fp.speed).toBeCloseTo(16 * 1.15, 6); // pct speed 0.15
    expect(fp.area).toBeCloseTo(0.4 * 1.15, 6); // pct area 0.15
  });
});

// ---------------------------------------------------------------------------
// talent skillMods (MetaBonuses.skillMods)

describe('talent skill modifiers', () => {
  const mods = { sword_arc: { damage: 0.1, cooldown: 0.2, area: 0.1, duration: 0.5, count: 0.5 }, lightning_trio: { count: 0.5 } };

  it('add to the upgrade lines additively (damage/area/duration) and reduce cooldowns', () => {
    const w = world({ meta: { stats: {}, skillMods: mods } });
    const s = giveSkill(w, 'sword_arc');
    expect(resolve(w, s).damage).toBeCloseTo(14 * 1.1, 6);
    expect(resolve(w, s).area).toBeCloseTo(2.6 * 1.1, 6);
    expect(resolve(w, s).cooldown).toBeCloseTo(0.8 * 0.8, 6);
    applySkillLine(s, line('damage', 'pct', 0.15));
    applySkillLine(s, line('cooldown', 'pct', 0.08));
    expect(resolve(w, s).damage).toBeCloseTo(14 * (1 + 0.15 + 0.1), 6);
    expect(resolve(w, s).cooldown).toBeCloseTo(0.8 * (1 - 0.28), 6);
    // base count 1 × (1 + 0.5) = 1.5 → rounds to 2
    expect(resolve(w, s).count).toBe(2);
    // the combined cooldown reduction is capped at 75%
    applySkillLine(s, line('cooldown', 'pct', 0.9));
    expect(resolve(w, s).cooldown).toBeCloseTo(0.8 * 0.25, 6);
  });

  it('are per skill id', () => {
    const w = world({ meta: { stats: {}, skillMods: mods } });
    const other = giveSkill(w, 'spirit_bolt');
    expect(resolve(w, other).damage).toBeCloseTo(12, 6);
    const cut = giveSkill(w, 'lightning_trio');
    expect(resolve(w, cut).count).toBe(3); // 2 + 0.5 × 2
    expect(resolve(w, cut).damage).toBeCloseTo(24, 6);
  });
});

// ---------------------------------------------------------------------------
// player stat modifiers → resolveParams

/** which behaviors receive +projectiles from the player stats */
const COUNT_LIKE = new Set(['projectile', 'homingProjectile', 'skyStrike', 'orbit', 'summon', 'chain']);
const PROJ_LIKE = new Set(['projectile', 'homingProjectile']);

describe('player stat modifiers', () => {
  it('+damage multiplies the damage of every skill', () => {
    const w = world();
    addStats(w, { damage: 0.5 });
    expect(player(w).stats.damage).toBeCloseTo(1.5, 6);
    for (const def of w.content.skills) {
      const fp = resolve(w, giveSkill(w, def.id));
      expect(fp.damage, def.id).toBeCloseTo(def.params.damage * 1.5, 6);
    }
  });

  it('damage stats and upgrade lines multiply: (base + flat) × (1 + pct) × stat', () => {
    const w = world();
    const s = giveSkill(w, 'sword_arc');
    applySkillLine(s, line('damage', 'pct', 0.15));
    addStats(w, { damage: 0.5 });
    expect(resolve(w, s).damage).toBeCloseTo(14 * 1.15 * 1.5, 6);
  });

  it('+area multiplies the area of every skill (floor 0.2)', () => {
    const w = world();
    addStats(w, { area: 0.25 });
    for (const def of w.content.skills) {
      const fp = resolve(w, giveSkill(w, def.id));
      expect(fp.area, def.id).toBeCloseTo(Math.max(0.2, def.params.area * 1.25), 6);
    }
    const w2 = world();
    addStats(w2, { area: -0.99 });
    expect(player(w2).stats.area).toBeCloseTo(0.3, 6); // stat floor
    expect(resolve(w2, giveSkill(w2, 'will_to_live')).area).toBeCloseTo(0.2, 6); // base 0 area still floors at 0.2
  });

  it('+duration multiplies durations', () => {
    const w = world();
    addStats(w, { duration: 0.5 });
    expect(resolve(w, giveSkill(w, 'bladewheel')).duration).toBeCloseTo(2.5 * 1.5, 6);
    expect(resolve(w, giveSkill(w, 'venom_pool')).duration).toBeCloseTo(4.5 * 1.5, 6);
    expect(resolve(w, giveSkill(w, 'will_to_live')).duration).toBeCloseTo(7 * 1.5, 6);
    expect(resolve(w, giveSkill(w, 'sword_arc')).duration).toBe(0);
  });

  it('cooldown stat reduces, attackSpeed divides, both cap sensibly', () => {
    const w = world();
    addStats(w, { cooldown: 0.2 });
    expect(resolve(w, giveSkill(w, 'arc_of_might')).cooldown).toBeCloseTo(9 * 0.8, 6);
    const w2 = world();
    addStats(w2, { attackSpeed: 0.25 });
    expect(resolve(w2, giveSkill(w2, 'arc_of_might')).cooldown).toBeCloseTo(9 / 1.25, 6);
    const w3 = world();
    addStats(w3, { cooldown: 0.2, attackSpeed: 0.25 });
    expect(resolve(w3, giveSkill(w3, 'arc_of_might')).cooldown).toBeCloseTo((9 * 0.8) / 1.25, 6);
    // BalanceConfig.caps.cooldown = 0.5
    const w4 = world();
    addStats(w4, { cooldown: 0.9 });
    expect(player(w4).stats.cooldownMul).toBeCloseTo(0.5, 6);
    expect(resolve(w4, giveSkill(w4, 'arc_of_might')).cooldown).toBeCloseTo(4.5, 6);
    // and they stack with upgrade lines and the 0.1 s floor
    const s = giveSkill(w4, 'sword_arc');
    applySkillLine(s, line('cooldown', 'pct', 0.5));
    expect(resolve(w4, s).cooldown).toBeCloseTo(0.8 * 0.5 * 0.5, 6);
    applySkillLine(s, line('cooldown', 'flat', 0.75));
    expect(resolve(w4, s).cooldown).toBeCloseTo(0.1, 6);
  });

  it('+projectiles adds to count only for projectile / homing / skyStrike / orbit / summon / chain', () => {
    const w = world();
    addStats(w, { projectiles: 2 });
    for (const def of w.content.skills) {
      const fp = resolve(w, giveSkill(w, def.id));
      const expected = def.params.count + (COUNT_LIKE.has(def.behavior) ? 2 : 0);
      expect(fp.count, `${def.id} (${def.behavior})`).toBe(expected);
    }
  });

  it('+pierce only helps bolts; +projSpeed only helps bolts and orbitals', () => {
    const w = world();
    addStats(w, { pierce: 2, projSpeed: 0.5 });
    for (const def of w.content.skills) {
      const fp = resolve(w, giveSkill(w, def.id));
      const pierce = def.params.pierce + (PROJ_LIKE.has(def.behavior) ? 2 : 0);
      const speed = def.params.speed * (PROJ_LIKE.has(def.behavior) || def.behavior === 'orbit' ? 1.5 : 1);
      expect(fp.pierce, `${def.id} pierce`).toBe(pierce);
      expect(fp.speed, `${def.id} speed`).toBeCloseTo(speed, 6);
    }
  });

  it('stats do not leak into knockback / tick / range / angle / heal / status', () => {
    const w = world();
    const baseline = world();
    addStats(w, { damage: 1, area: 1, duration: 1, projectiles: 3, pierce: 2, projSpeed: 1, cooldown: 0.3, attackSpeed: 0.5 });
    for (const def of w.content.skills) {
      const a = resolve(w, giveSkill(w, def.id));
      const b = resolve(baseline, giveSkill(baseline, def.id));
      for (const k of ['knockback', 'tick', 'range', 'angle', 'heal', 'statusChance', 'statusPower', 'statusDuration'] as const) {
        expect(a[k], `${def.id}.${k}`).toBeCloseTo(b[k], 9);
      }
    }
  });

  it('passives, spirit stones and timed buffs feed the same stats', () => {
    const w = world();
    const p = player(w);
    const s = giveSkill(w, 'spirit_bolt');
    p.passives.push({ id: 'eyes', rank: 2, power: 2 }); // area +6% per rank
    p.stones[0] = { id: 'piercing', level: 1 }; // (damage +4%, pierce +1) × (level + 1)
    refreshStats(p, w.content, w.ix);
    let fp = resolve(w, s);
    expect(fp.area).toBeCloseTo(0.4 * 1.12, 6);
    expect(fp.damage).toBeCloseTo(12 * 1.08, 6);
    expect(fp.pierce).toBe(2);
    p.buffs.push({ skillSlot: -1, mods: { damage: 0.5, projectiles: 1 }, left: 5, total: 5 });
    refreshStats(p, w.content, w.ix);
    fp = resolve(w, s);
    expect(fp.damage).toBeCloseTo(12 * (1.08 + 0.5), 6);
    expect(fp.count).toBe(2);
    p.buffs.length = 0;
    refreshStats(p, w.content, w.ix);
    expect(resolve(w, s).count).toBe(1);
  });

  it('empire / meta stat bonuses at world creation are part of the stats too', () => {
    const w = world({ meta: { stats: { damage: 0.2, area: 0.1, projectiles: 1 } } });
    const fp = resolve(w, giveSkill(w, 'aura_sword'));
    expect(fp.damage).toBeCloseTo(20 * 1.2, 6);
    expect(fp.area).toBeCloseTo(0.45 * 1.1, 6);
    expect(fp.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// awakening (rank 7)

describe('awakening parameters', () => {
  it('rank 7 is MAX_SKILL_RANK; ranks below it are never awakened', () => {
    expect(MAX_SKILL_RANK).toBe(7);
    const w = world();
    for (let rank = 0; rank <= 6; rank++) {
      const s = giveSkill(w, 'sword_arc', rank);
      const fp = resolve(w, s);
      expect(fp.awakened).toBe(false);
      expect(fp.echo).toBe(0);
      expect(fp.damage).toBeCloseTo(14, 6);
    }
    expect(resolve(w, giveSkill(w, 'sword_arc', 7)).awakened).toBe(true);
  });

  interface Expect {
    id: string;
    /** resolved numeric fields that differ from rank 6, with their awakened values */
    changed: Partial<Record<keyof FinalParams, number>>;
  }
  const AWAKENED: Expect[] = [
    { id: 'sword_arc', changed: { damage: 14 * 1.35, echo: 0.25 } },
    { id: 'spirit_bolt', changed: { damage: 12 * 1.25, explode: 1.8 } },
    { id: 'lightning_trio', changed: { count: 3, nova: 3.5 } },
    { id: 'bladewheel', changed: { duration: 2.5 * 1.4, tick: 0.3 * 0.7 } },
    { id: 'fury_aura', changed: { damage: 12 * 1.3, area: 3.4 * 1.3, statusPower: 0.25 * 1.5 } },
    { id: 'lunge', changed: { damage: 30 * 1.2, echo: 0.35 } },
    { id: 'aura_sword', changed: { pierce: 4, speed: 17 * 1.3 } },
    { id: 'war_leap', changed: { cooldown: 7 * 0.7, area: 3.4 * 1.25 } },
    { id: 'soul_crash', changed: { count: 4, damage: 22 * 1.2 } },
    { id: 'sky_blades', changed: { count: 6, explode: 3.5 } },
    { id: 'chain_lightning', changed: { count: 8, statusChance: 0.25 } },
    { id: 'sword_circle', changed: { count: 5, range: 2.8 * 1.3 } },
    { id: 'frost_cleave', changed: { range: 6 * 1.4, statusChance: 0.32 } },
    { id: 'phantom_blades', changed: { count: 4, tick: 0.7 * 0.7 } },
    { id: 'soul_beam', changed: { duration: 2.5 * 1.4, tick: 0.15 * 0.75, damage: 12 * 1.2 } },
    { id: 'arc_of_might', changed: { echo: 0.5, knockback: 3.5 * 1.3 } },
    { id: 'will_to_live', changed: { heal: 40, duration: 7 * 1.5, cooldown: 18 * 0.8 } },
    { id: 'venom_pool', changed: { duration: 4.5 * 1.5, explode: 4.5 } },
  ];

  it('covers every fixture skill', () => {
    const w = world();
    expect(new Set(AWAKENED.map((a) => a.id))).toEqual(new Set(w.content.skills.map((d) => d.id)));
  });

  it.each(AWAKENED)('$id: rank 7 changes exactly the awakening fields', ({ id, changed }) => {
    const w = world();
    const base = resolve(w, giveSkill(w, id, 6));
    const awk = resolve(w, giveSkill(w, id, 7));
    expect(base.awakened).toBe(false);
    expect(awk.awakened).toBe(true);
    for (const [k, v] of Object.entries(changed) as [keyof FinalParams, number][]) {
      expect(awk[k] as number, `${id}.${String(k)}`).toBeCloseTo(v, 6);
    }
    for (const k of Object.keys(base) as (keyof FinalParams)[]) {
      if (k in changed || k === 'awakened' || k === 'novaDamage') continue;
      expect(awk[k], `${id}.${String(k)} must be unchanged`).toEqual(base[k]);
    }
  });

  it('every generic awakening key is honoured, after the upgrade lines', () => {
    const w = world({}, (c) => {
      const def = c.skills.find((d) => d.id === 'phantom_blades');
      if (!def) throw new Error('phantom_blades missing');
      def.params.status = { kind: 'poison', chance: 0.2, duration: 3, power: 0.4 };
      def.params.heal = 5;
      def.awaken.params = {
        damageMul: 2, areaMul: 1.5, countAdd: 3, cooldownMul: 0.5, durationMul: 2, pierceAdd: 2, speedMul: 2, knockbackMul: 3,
        rangeMul: 1.5, statusChanceAdd: 0.3, statusPowerMul: 2, healAdd: 7, tickMul: 0.5, echo: 0.6, nova: 4, novaDamage: 0.9, explode: 2.5,
      };
    });
    const s = giveSkill(w, 'phantom_blades', 7);
    applySkillLine(s, line('damage', 'pct', 0.5));
    const fp = resolve(w, s);
    expect(fp.damage).toBeCloseTo(14 * 1.5 * 2, 6);
    expect(fp.area).toBeCloseTo(1.3 * 1.5, 6);
    expect(fp.count).toBe(5);
    expect(fp.cooldown).toBeCloseTo(14 * 0.5, 6);
    expect(fp.duration).toBeCloseTo(20, 6);
    expect(fp.pierce).toBe(2);
    expect(fp.speed).toBeCloseTo(13, 6);
    expect(fp.knockback).toBeCloseTo(0.9, 6);
    expect(fp.tick).toBeCloseTo(0.35, 6);
    expect(fp.range).toBeCloseTo(13.5, 6);
    expect(fp.statusChance).toBeCloseTo(0.5, 6);
    expect(fp.statusPower).toBeCloseTo(0.8, 6);
    expect(fp.heal).toBeCloseTo(12, 6);
    expect(fp.echo).toBeCloseTo(0.6, 6);
    expect(fp.nova).toBeCloseTo(4, 6);
    expect(fp.novaDamage).toBeCloseTo(0.9, 6);
    expect(fp.explode).toBeCloseTo(2.5, 6);
    expect(fp.awakened).toBe(true);
  });

  it('nova damage defaults to 60% when the awakening does not name it; clamps keep the numbers sane', () => {
    const w = world();
    expect(resolve(w, giveSkill(w, 'lightning_trio', 7)).novaDamage).toBeCloseTo(0.6, 6);
    const w2 = world({}, (c) => {
      const def = c.skills.find((d) => d.id === 'sword_arc');
      if (def) def.awaken.params = { cooldownMul: 0.01, areaMul: 0.001, tickMul: 0.001 };
    });
    const fp = resolve(w2, giveSkill(w2, 'sword_arc', 7));
    expect(fp.cooldown).toBeCloseTo(0.1, 6); // floor
    expect(fp.area).toBeCloseTo(0.2, 6); // floor
    expect(fp.tick).toBe(0); // no tick to scale
  });

  it('awakening multiplies the player stats rather than replacing them', () => {
    const w = world();
    addStats(w, { damage: 0.5, area: 0.5 });
    const fp = resolve(w, giveSkill(w, 'fury_aura', 7));
    expect(fp.damage).toBeCloseTo(12 * 1.5 * 1.3, 6);
    expect(fp.area).toBeCloseTo(3.4 * 1.5 * 1.3, 6);
  });
});
