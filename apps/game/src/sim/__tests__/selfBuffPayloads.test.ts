// Skill-logic M3 (DESIGN §4): selfBuff payloads (party, base-kit nova, cost, mark, pulse) and the kill feed (stack, extend, refund,
// corpse ring). Every key defaults to the legacy behavior: the old selfBuff fixtures stay green in behaviors.test.

import { describe, expect, it } from 'vitest';
import type { SkillDef, SkillParams } from '../../data/schema';
import { hitEnemy, newHitCtx } from '../combat';
import type { CoopPlayerInit } from '../run';
import { castNow } from '../skills';
import { forParty, partyOut } from '../skills/common';
import { EnemyFlag, StatusBit, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { clearEnemies, collect, dropSkills, freezeEnemies, freezeSchedules, giveSkill, makeWorld, player, runTicks, spawn } from './helpers';

const PARTNER: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

interface Lab {
  w: World;
  p: PlayerState;
  s: SkillInstance;
}

/** will_to_live patched with extra params / fields; hero 0 owns it (cd 0); quiet field */
function lab(params: Partial<SkillParams>, patch?: (d: SkillDef) => void, coop = false, owner = 0): Lab {
  const w = makeWorld({
    config: coop ? { coop: [PARTNER] } : undefined,
    content: (c) => {
      const d = c.skills.find((x) => x.id === 'will_to_live') as SkillDef;
      d.params = { ...d.params, ...params };
      // a gated skill skips the legacy "any foe within 12 m" guard of an ungated selfBuff (castNow bypasses the gate itself)
      d.trigger = { any: ['engaged'] };
      patch?.(d);
    },
  });
  freezeSchedules(w);
  clearEnemies(w);
  for (let i = 0; i < w.players.length; i++) dropSkills(w, i);
  for (const q of w.players) {
    q.x = q.px = q.index * 6;
    q.z = q.pz = 0;
  }
  const p = player(w, owner);
  const s = giveSkill(w, 'will_to_live', 0, owner);
  s.cd = 0;
  return { w, p, s };
}

/** cast past the gate on a fresh enemy index (the hash is rebuilt once per step, tests spawn between steps) */
function cast(w: World, p: PlayerState, s: SkillInstance): boolean {
  w.hash.rebuild(w.enemies);
  return castNow(w, p, s);
}

/** a crit-free kill credited to hero `killer` */
function kill(w: World, row: number, killer = 0): void {
  const c = newHitCtx();
  c.player = killer;
  c.noCrit = true;
  hitEnemy(w, row, 1e9, c);
}

describe('party', () => {
  it('buff, heal and nothing else land on living allies within `party`, keyed by the CASTER slot; out of range and dead ones are skipped', () => {
    const { w, p, s } = lab({ party: 10, heal: 25 }, undefined, true);
    const ally = player(w, 1);
    ally.x = ally.px = 8;
    ally.hp = ally.hpMax * 0.5;
    p.hp = p.hpMax * 0.5;
    const hp0 = ally.hp;
    expect(cast(w, p, s)).toBe(true);
    expect(ally.buffs).toHaveLength(1);
    expect(ally.buffs[0]?.skillSlot).toBe(s.slot);
    expect(ally.buffs[0]?.mods).toEqual({ damage: 0.25, moveSpeed: 0.15, armor: 6 });
    expect(ally.hp).toBeCloseTo(hp0 + 25, 5);
    expect(p.buffs).toHaveLength(1);
    expect(ally.statsDirty).toBe(true);

    const far = lab({ party: 10, heal: 25 }, undefined, true);
    player(far.w, 1).x = 12;
    expect(cast(far.w, far.p, far.s)).toBe(true);
    expect(player(far.w, 1).buffs).toHaveLength(0);

    const dead = lab({ party: 10 }, undefined, true);
    player(dead.w, 1).x = 3;
    player(dead.w, 1).alive = false;
    expect(cast(dead.w, dead.p, dead.s)).toBe(true);
    expect(player(dead.w, 1).buffs).toHaveLength(0);
  });

  it('without `party` (or in solo) only the caster is buffed', () => {
    const { w, p, s } = lab({ heal: 25 }, undefined, true);
    player(w, 1).x = 2;
    expect(cast(w, p, s)).toBe(true);
    expect(player(w, 1).buffs).toHaveLength(0);
    const solo = lab({ party: 10 });
    expect(cast(solo.w, solo.p, solo.s)).toBe(true);
    expect(solo.p.buffs).toHaveLength(1);
  });

  it('forParty lists the holders in player INDEX order, the caster included, whoever casts', () => {
    const { w } = lab({}, undefined, true);
    const a = player(w, 0);
    const b = player(w, 1);
    a.x = 0;
    b.x = 4;
    expect(forParty(w, b, 10)).toBe(2);
    expect(partyOut.map((q) => q.index)).toEqual([0, 1]);
    expect(forParty(w, a, 3)).toBe(1);
    expect(forParty(w, a, 0)).toBe(1);
  });

  it('a recast replaces the stale ally buff of the same caster slot (no stacking)', () => {
    const { w, p, s } = lab({ party: 10, cooldown: 1, duration: 3 }, undefined, true);
    const ally = player(w, 1);
    ally.x = ally.px = 5;
    expect(cast(w, p, s)).toBe(true);
    runTicks(w, 4 * 60);
    expect(ally.buffs).toHaveLength(0);
    expect(cast(w, p, s)).toBe(true);
    expect(cast(w, p, s)).toBe(false); // window still up
    expect(ally.buffs).toHaveLength(1);
  });
});

describe('base-kit nova', () => {
  it('bursts at the cast for damage x novaDamage on creatures inside `nova` only', () => {
    const { w, p, s } = lab({ nova: 4, novaDamage: 1, damage: 40, knockback: 2 });
    const inside = spawn(w, 'bear', 3, 0);
    const outside = spawn(w, 'bear', 7, 0);
    const hp0 = w.enemies.hp[inside] as number;
    freezeEnemies(w);
    const events = collect(w, 0, ['damage']);
    expect(events).toHaveLength(0);
    expect(cast(w, p, s)).toBe(true);
    expect(w.enemies.hp[inside] as number).toBeLessThan(hp0);
    expect(w.enemies.hp[outside]).toBe(w.enemies.hpMax[outside]);
    // shoved away by the skill's own knockback
    expect(w.enemies.kvx[inside] as number).toBeGreaterThan(0);
  });

  it('a skill without `nova` and without an awakening does nothing of the kind', () => {
    const { w, p, s } = lab({ damage: 40 });
    const near = spawn(w, 'bear', 2, 0);
    freezeEnemies(w);
    cast(w, p, s);
    expect(w.enemies.hp[near]).toBe(w.enemies.hpMax[near]);
  });
});

describe('cost', () => {
  it('pays cost x max HP, never below 1 HP', () => {
    const { w, p, s } = lab({ cost: 12, heal: 0 });
    const before = p.hp;
    expect(cast(w, p, s)).toBe(true);
    expect(p.hp).toBeCloseTo(before - p.hpMax * 0.12, 5);
    const low = lab({ cost: 12, heal: 0 });
    low.p.hp = 5;
    cast(low.w, low.p, low.s);
    expect(low.p.hp).toBe(1);
    const free = lab({});
    free.p.hp = 50;
    cast(free.w, free.p, free.s);
    expect(free.p.hp).toBeGreaterThanOrEqual(50);
  });

  it('the trigger minHp keeps the gated skill shut while the hero is low', () => {
    const { w, p } = lab({ cost: 12, heal: 0 }, (d) => (d.trigger = { any: ['engaged'], minHp: 0.5 }));
    for (let i = 0; i < 5; i++) spawn(w, 'wolf', 3 + i * 0.2, 0);
    freezeEnemies(w);
    p.hp = p.hpMax * 0.45;
    runTicks(w, 60);
    expect(p.buffs).toHaveLength(0);
    expect(p.hp).toBeCloseTo(p.hpMax * 0.45, 3);
    p.hp = p.hpMax * 0.6;
    runTicks(w, 2);
    expect(p.buffs).toHaveLength(1);
    expect(p.hp).toBeLessThan(p.hpMax * 0.5);
  });
});

describe('mark', () => {
  const WEAK = { kind: 'weaken', chance: 1, duration: 9, power: 0.25 } as const;
  const marked = (w: World, rows: number[]): number[] => rows.filter((r) => ((w.enemies.status[r] as number) & StatusBit.Weaken) !== 0);

  it('brands the K toughest foes (elite tier, then HP, then row) with the skill status; weaker ones stay clean', () => {
    const { w, p, s } = lab({ mark: 3, range: 14, status: WEAK });
    const rows: number[] = [];
    // hp ladder 10..60 on plain wolves, plus an elite with LOW hp
    for (let i = 0; i < 6; i++) rows.push(spawn(w, 'wolf', 2 + i, 1));
    const elite = spawn(w, 'wolf', 3, -3, { tier: 1 });
    freezeEnemies(w);
    rows.forEach((r, i) => (w.enemies.hp[r] = 10 * (i + 1)));
    w.enemies.hp[elite] = 5;
    expect(cast(w, p, s)).toBe(true);
    // elite first, then the two highest-HP wolves (60, 50)
    expect(marked(w, [...rows, elite]).sort((a, b) => a - b)).toEqual([rows[4] as number, rows[5] as number, elite].sort((a, b) => a - b));
    expect(w.enemies.statP[(elite as number) * 8 + 7]).toBeCloseTo(0.25, 5);
  });

  it('is independent of spawn / row order and breaks HP ties by the lower row', () => {
    const run = (reverse: boolean): number[] => {
      const { w, p, s } = lab({ mark: 2, range: 14, status: WEAK });
      const xs = [3, 4, 5, 6];
      if (reverse) xs.reverse();
      const rows = xs.map((x) => spawn(w, 'wolf', x, 0));
      freezeEnemies(w);
      for (const r of rows) w.enemies.hp[r] = 100; // all tied
      cast(w, p, s);
      return rows.map((r, i) => (marked(w, [r]).length > 0 ? i : -1)).filter((i) => i >= 0);
    };
    // ties go to the lower row = the first spawned, so the first two spawned are marked either way
    expect(run(false)).toEqual([0, 1]);
    expect(run(true)).toEqual([0, 1]);
  });

  it('skips metin stones and anything beyond `range`; fewer foes than K marks them all', () => {
    const { w, p, s } = lab({ mark: 3, range: 6, status: WEAK });
    const a = spawn(w, 'wolf', 3, 0);
    const far = spawn(w, 'wolf', 12, 0);
    const stone = spawn(w, 'wolf', 2, 2);
    w.enemies.flags[stone] = (w.enemies.flags[stone] as number) | EnemyFlag.Metin;
    freezeEnemies(w);
    cast(w, p, s);
    expect(marked(w, [a, far, stone])).toEqual([a]);
  });

  it('draws no RNG (the status chance is not rolled)', () => {
    const { w, p, s } = lab({ mark: 4, range: 14, status: { ...WEAK, chance: 0.01 } });
    for (let i = 0; i < 4; i++) spawn(w, 'wolf', 3 + i, 0);
    freezeEnemies(w);
    const before = JSON.stringify(w.rng.combat.getState());
    cast(w, p, s);
    expect(JSON.stringify(w.rng.combat.getState())).toBe(before);
    expect(w.enemies.status.slice(0, 4).every((st) => ((st as number) & StatusBit.Weaken) !== 0)).toBe(true);
  });
});

describe('pulse', () => {
  it('bites the nearest foe every `pulse` s while the window is up and stops with it', () => {
    const { w, p, s } = lab({ pulse: 1.5, damage: 20, duration: 6, range: 8 });
    const target = spawn(w, 'bear', 4, 0);
    freezeEnemies(w);
    w.enemies.hp[target] = 1e9;
    w.enemies.hpMax[target] = 1e9;
    expect(cast(w, p, s)).toBe(true);
    const events = collect(w, 8 * 60, ['damage']).filter((e) => e.skill === s.slot);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.length).toBeLessThanOrEqual(4);
    expect(events.every((e) => e.targetId === (w.enemies.id[target] as number))).toBe(true);
  });

  it('waits (does not spend the pulse) while no foe is in reach', () => {
    const { w, p, s } = lab({ pulse: 1.5, damage: 20, duration: 6 });
    expect(cast(w, p, s)).toBe(true);
    runTicks(w, 4 * 60);
    const late = spawn(w, 'bear', 4, 0);
    freezeEnemies(w);
    w.enemies.hp[late] = 1e9;
    const events = collect(w, 30, ['damage']).filter((e) => e.skill === s.slot);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe('kill feed (hooks.onKill)', () => {
  it('stack: every kill grows the buff by `stack` up to +60 %, and the stats follow the scale', () => {
    const { w, p, s } = lab({ stack: 2, buff: { damage: 0.1 } });
    cast(w, p, s);
    runTicks(w, 2);
    const base = p.stats.damage;
    expect(base).toBeCloseTo(1.1, 6);
    for (let i = 0; i < 10; i++) kill(w, spawn(w, 'wolf', 30 + i, 0));
    runTicks(w, 2);
    expect(p.buffs[0]?.scale).toBeCloseTo(1.2, 6);
    expect(p.stats.damage).toBeCloseTo(1 + 0.1 * 1.2, 5);
    for (let i = 0; i < 60; i++) kill(w, spawn(w, 'wolf', 30 + (i % 20), 5));
    runTicks(w, 2);
    expect(p.buffs[0]?.scale).toBeCloseTo(1.6, 6);
    expect(p.stats.damage).toBeCloseTo(1 + 0.1 * 1.6, 5);
  });

  it('extend: every kill adds seconds to the window up to +50 % of the base duration; the recast guard follows', () => {
    const { w, p, s } = lab({ extend: 1, duration: 7 });
    cast(w, p, s);
    const left0 = p.buffs[0]?.left as number;
    kill(w, spawn(w, 'wolf', 30, 0));
    expect(p.buffs[0]?.left).toBeCloseTo(left0 + 1, 6);
    expect(s.aux).toBeCloseTo(w.time + left0 + 1, 5);
    for (let i = 0; i < 10; i++) kill(w, spawn(w, 'wolf', 30 + i, 3));
    expect(p.buffs[0]?.ext).toBeCloseTo(3.5, 6);
    expect(p.buffs[0]?.left).toBeCloseTo(left0 + 3.5, 6);
    expect(p.buffs[0]?.total).toBe(7);
  });

  it('extend and stack reach the allies copies of a party buff (keyed by the caster slot), but only the caster kills feed it', () => {
    const { w, p, s } = lab({ extend: 1, stack: 5, party: 10, duration: 7 }, undefined, true);
    const ally = player(w, 1);
    ally.x = ally.px = 4;
    cast(w, p, s);
    kill(w, spawn(w, 'wolf', 30, 0), 0);
    expect(ally.buffs[0]?.ext).toBeCloseTo(1, 6);
    expect(ally.buffs[0]?.scale).toBeCloseTo(1.05, 6);
    expect(p.buffs[0]?.scale).toBeCloseTo(1.05, 6);
    // the ally's own kill does not feed the shaman's skill
    kill(w, spawn(w, 'wolf', 31, 0), 1);
    expect(ally.buffs[0]?.ext).toBeCloseTo(1, 6);
  });

  it('refund: every kill takes seconds off the cooldown, capped at refundCap (35 %) of it per cycle; a fire resets the cap', () => {
    const { w, p, s } = lab({ refund: 1, cooldown: 18 });
    cast(w, p, s);
    expect(s.cd).toBeCloseTo(s.fp.cooldown, 6);
    const cd0 = s.cd;
    kill(w, spawn(w, 'wolf', 30, 0));
    expect(s.cd).toBeCloseTo(cd0 - 1, 6);
    for (let i = 0; i < 12; i++) kill(w, spawn(w, 'wolf', 30 + i, 4));
    expect(cd0 - s.cd).toBeCloseTo(cd0 * 0.35, 5);
    expect(s.refunded).toBeCloseTo(cd0 * 0.35, 5);
    // new cycle
    s.cd = 0;
    s.aux = 0;
    cast(w, p, s);
    expect(s.refunded).toBe(0);
  });

  it('refund never touches a ready skill or goes below zero', () => {
    const { w, s } = lab({ refund: 5, cooldown: 18 });
    runTicks(w, 1); // resolves s.fp
    s.cd = 0;
    kill(w, spawn(w, 'wolf', 30, 0));
    expect(s.cd).toBe(0);
    s.cd = 2;
    kill(w, spawn(w, 'wolf', 31, 0));
    expect(s.cd).toBe(0);
  });

  it('corpse ring: kills of a hero that owns a taunting planted summon are recorded newest-first; other heroes / skills record nothing', () => {
    const { w } = lab({ taunt: 7 }, (d) => (d.role = 'planted'));
    const r1 = spawn(w, 'wolf', 30, 4);
    const r2 = spawn(w, 'wolf', 31, 5);
    freezeEnemies(w);
    kill(w, r1);
    kill(w, r2);
    expect(w.corpses.count).toBe(2);
    const newest = w.corpses.at(0);
    expect(w.corpses.x[newest]).toBeCloseTo(31, 1);
    expect(w.corpses.z[newest]).toBeCloseTo(5, 1);
    expect(w.corpses.owner[newest]).toBe(0);
    const none = lab({ taunt: 7 });
    kill(none.w, spawn(none.w, 'wolf', 30, 4));
    expect(none.w.corpses.count).toBe(0);
  });

  it('a skill without refund / extend / stack / role leaves kills alone', () => {
    const { w, p, s } = lab({});
    cast(w, p, s);
    const cd = s.cd;
    kill(w, spawn(w, 'wolf', 30, 0));
    expect(s.cd).toBe(cd);
    expect(p.buffs[0]?.ext).toBeUndefined();
    expect(p.buffs[0]?.scale).toBeUndefined();
    expect(w.corpses.count).toBe(0);
  });
});

describe('SIM-11: selfBuff VFX caster attribution', () => {
  it('emits VfxEvent with player === p.index for both the buff preset and any cost .pay VFX in co-op', () => {
    const { w, p, s } = lab({ cost: 10, heal: 0 }, (d) => {
      d.vfx = 'sk.eagle_eye';
    }, true, 1);
    // co-locate both players so nearest-player proximity would be ambiguous
    player(w, 0).x = player(w, 0).px = 0;
    player(w, 0).z = player(w, 0).pz = 0;
    p.x = p.px = 0;
    p.z = p.pz = 0;

    w.bus.clear();
    expect(cast(w, p, s)).toBe(true);
    const vfx = w.events.filter((e) => e.t === 'vfx');
    const main = vfx.find((e) => e.preset === 'sk.eagle_eye');
    const pay = vfx.find((e) => e.preset === 'sk.will_to_live.pay');
    expect(main).toBeDefined();
    expect(main?.player).toBe(1);
    expect(pay).toBeDefined();
    expect(pay?.player).toBe(1);
  });
});
