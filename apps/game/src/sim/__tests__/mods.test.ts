// RS-01 run modifiers (w.mods): XP, yeop, elite chest chance, elite cadence, metin awakening, final boss HP and rage stack interval.
// Built at createWorld from zone.xpMul, balance.chest.eliteDrop, the hard multipliers (zone override first, hard only) and
// zone.final.hpMul, times the factors of active events (setEventMods / clearEventMods). Neutral by default.

import { afterEach, describe, expect, it } from 'vitest';
import { hashWorld } from '../../dev/soakCore';
import { CoopHarness } from '../../net/coop/harness';
import type { ContentDB, EnemyDef, MetinDef, ZoneDef } from '../../data/schema';
import { RAGE_STACK_EVERY, spawnBoss } from '../bosses';
import { killEnemy } from '../combat';
import { openLevelUp } from '../cards';
import { DT } from '../constants';
import { sweepDead } from '../enemies';
import { EVENT_MOD_MAX, EVENT_MOD_MIN, RUN_MOD_KEYS, type RunMods, type World } from '../world';
import { PickupKind } from '../stores';
import { MetinPhase, type BossState, type MetinState } from '../types';
import { botInput } from './bot';
import { drainModals, freezeEnemies, freezeSchedules, makeWorld, NO_INPUT, player, runTicks, spawn } from './helpers';

// ---------------------------------------------------------------------------
// helpers

const zoneOf = (c: ContentDB): ZoneDef => c.zones[0] as ZoneDef;
const enemyOf = (c: ContentDB, id: string): EnemyDef => c.enemies.find((e) => e.id === id) as EnemyDef;

const NEUTRAL: RunMods = { xp: 1, yeop: 1, eliteDrop: 0.12, eliteEvery: 1, awaken: 1, finalHp: 1, finalEnrage: 1 };

/** a hero that cannot die and cannot hurt anything (huge max hp from meta stats, no skills) */
const IMMORTAL = { meta: { stats: { maxHp: 1e9 } } } as const;

function quiet(over: Parameters<typeof makeWorld>[0] = {}): World {
  const w = makeWorld(over);
  freezeSchedules(w);
  return w;
}

/** kill a freshly spawned enemy of `id` and sweep it, leaving only the loot behind */
function killOne(w: World, id: string, tier = 0): void {
  const row = spawn(w, id, 40, 0, { tier });
  killEnemy(w, row, 0, -1, false);
  sweepDead(w);
}

function rowsOf(w: World, kind: PickupKind): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === kind) out.push(i);
  return out;
}

function values(w: World, kind: PickupKind): number[] {
  return rowsOf(w, kind).map((r) => w.pickups.value[r] as number);
}

// ---------------------------------------------------------------------------
// the base: where each field comes from

describe('w.mods base', () => {
  it('default content: every modifier is neutral (eliteDrop is the shipped 0.12), on normal and on hard', () => {
    expect(makeWorld().mods).toEqual(NEUTRAL);
    expect(makeWorld({ config: { difficulty: 'hard' } }).mods).toEqual(NEUTRAL);
  });

  it('zone.xpMul and zone.final.hpMul apply on both difficulties; balance.chest.eliteDrop sets the chest chance', () => {
    for (const difficulty of ['normal', 'hard'] as const) {
      const w = makeWorld({
        config: { difficulty },
        content: (c) => {
          zoneOf(c).xpMul = 1.3;
          zoneOf(c).final.hpMul = 0.8;
          c.balance.chest = { eliteDrop: 0.3 };
        },
      });
      expect(w.mods).toEqual({ ...NEUTRAL, xp: 1.3, finalHp: 0.8, eliteDrop: 0.3 });
    }
  });

  it('the hard multipliers apply on hard only; a zone override wins, a missing zone key falls back to balance.hard', () => {
    const content = (c: ContentDB): void => {
      c.balance.hard = { ...c.balance.hard, awakenMul: 0.6, eliteEveryMul: 0.8, finalEnrageMul: 0.7 };
      zoneOf(c).hard = { awakenMul: 0.5 };
    };
    expect(makeWorld({ content }).mods).toEqual(NEUTRAL);
    expect(makeWorld({ config: { difficulty: 'hard' }, content }).mods).toEqual({ ...NEUTRAL, awaken: 0.5, eliteEvery: 0.8, finalEnrage: 0.7 });
    // only the balance default, no zone override
    const bal = makeWorld({
      config: { difficulty: 'hard' },
      content: (c) => (c.balance.hard = { ...c.balance.hard, awakenMul: 0.6 }),
    });
    expect(bal.mods).toEqual({ ...NEUTRAL, awaken: 0.6 });
  });

  it('Run Options sliders fold into the difficulty multipliers, not into the modifiers', () => {
    const w = makeWorld({ config: { runOptions: { density: 3, health: 3, damage: 3, speed: 3 } } });
    expect(w.diff.reward).toBeGreaterThan(1);
    expect(w.mods).toEqual(NEUTRAL);
  });
});

// ---------------------------------------------------------------------------
// event factors

describe('event factors (setEventMods / clearEventMods)', () => {
  it('a factor multiplies the base of its keys only', () => {
    const w = makeWorld({ content: (c) => (zoneOf(c).xpMul = 1.5) });
    w.setEventMods('goldenHour', { yeop: 2, eliteEvery: 0.5 });
    expect(w.mods).toEqual({ ...NEUTRAL, xp: 1.5, yeop: 2, eliteEvery: 0.5 });
    expect(w.hasEventMods('goldenHour')).toBe(true);
  });

  it('factors of different events stack; the same id replaces its own; clearing restores the base exactly', () => {
    const w = makeWorld({ content: (c) => (zoneOf(c).xpMul = 1.3) });
    w.setEventMods('a', { xp: 2, awaken: 0.5 });
    w.setEventMods('b', { xp: 1.5, awaken: 0.5 });
    expect(w.mods.xp).toBeCloseTo(1.3 * 2 * 1.5, 12);
    expect(w.mods.awaken).toBeCloseTo(0.25, 12);
    w.setEventMods('a', { xp: 4 }); // replaces a's factors: its awaken factor is gone
    expect(w.mods.xp).toBeCloseTo(1.3 * 4 * 1.5, 12);
    expect(w.mods.awaken).toBeCloseTo(0.5, 12);
    w.clearEventMods('a');
    expect(w.hasEventMods('a')).toBe(false);
    expect(w.mods.xp).toBeCloseTo(1.3 * 1.5, 12);
    w.clearEventMods('b');
    expect(w.mods.xp).toBe(1.3); // bit-exact, not 1.3 * 1.5 / 1.5
    expect(w.mods.awaken).toBe(1);
    w.clearEventMods('never-set'); // no-op
    expect(w.mods).toEqual({ ...NEUTRAL, xp: 1.3 });
  });

  it('keeps the same mods object (callers hold the reference) and ignores junk: non-finite factors, out-of-range values clamp', () => {
    const w = makeWorld();
    const ref = w.mods;
    w.setEventMods('x', { xp: Number.NaN, yeop: Infinity, eliteEvery: 0, awaken: -3, finalHp: 1e9, eliteDrop: 0 });
    expect(w.mods).toBe(ref);
    expect(ref.xp).toBe(1);
    expect(ref.yeop).toBe(1);
    expect(ref.eliteEvery).toBe(EVENT_MOD_MIN);
    expect(ref.awaken).toBe(EVENT_MOD_MIN);
    expect(ref.finalHp).toBe(EVENT_MOD_MAX);
    expect(ref.eliteDrop).toBe(0); // a chest-less event is allowed
    w.clearEventMods('x');
    expect(ref).toEqual(NEUTRAL);
  });

  it('covers every key of RunMods', () => {
    expect([...RUN_MOD_KEYS].sort()).toEqual(Object.keys(NEUTRAL).sort());
  });
});

// ---------------------------------------------------------------------------
// readers

describe('pickups.dropLoot reads xp, yeop and eliteDrop', () => {
  it('gem value = def.xp x tier bonus x mods.xp (zone.xpMul, events); other multipliers untouched', () => {
    const w = quiet({ content: (c) => (zoneOf(c).xpMul = 1.5) });
    const wolf = enemyOf(w.content, 'wolf');
    const alpha = enemyOf(w.content, 'alpha_wolf');
    killOne(w, 'wolf');
    killOne(w, 'alpha_wolf', 1);
    killOne(w, 'alpha_wolf', 2);
    const v = values(w, PickupKind.Xp);
    expect(v[0]).toBeCloseTo(wolf.xp * 1.5, 6);
    expect(v[1]).toBeCloseTo(alpha.xp * 1.5 * 1.5, 6);
    expect(v[2]).toBeCloseTo(alpha.xp * 1.25 * 1.5, 6);

    w.pickups.clear();
    w.xpGems = 0;
    w.setEventMods('a', { xp: 2 });
    w.setEventMods('b', { xp: 1.5 });
    killOne(w, 'wolf');
    expect(values(w, PickupKind.Xp)[0]).toBeCloseTo(wolf.xp * 1.5 * 2 * 1.5, 6);
    w.clearEventMods('a');
    w.clearEventMods('b');
    w.pickups.clear();
    killOne(w, 'wolf');
    expect(values(w, PickupKind.Xp)[0]).toBeCloseTo(wolf.xp * 1.5, 6);
  });

  it('yeop drops are scaled by mods.yeop while an event runs and not before or after', () => {
    const w = quiet({ content: (c) => (enemyOf(c, 'alpha_wolf').yeop = [40, 40]) });
    const coins = (): number[] => values(w, PickupKind.Yeop);
    for (let i = 0; i < 20; i++) killOne(w, 'alpha_wolf', 1); // elites always drop a coin
    expect(coins()).toHaveLength(20);
    for (const v of coins()) {
      expect(v).toBeGreaterThanOrEqual(40);
      expect(v).toBeLessThanOrEqual(41);
    }
    w.pickups.clear();
    w.setEventMods('goldenHour', { yeop: 2 });
    for (let i = 0; i < 20; i++) killOne(w, 'alpha_wolf', 1);
    expect(coins()).toHaveLength(20);
    for (const v of coins()) {
      expect(v).toBeGreaterThanOrEqual(80);
      expect(v).toBeLessThanOrEqual(82);
    }
    w.clearEventMods('goldenHour');
    w.pickups.clear();
    for (let i = 0; i < 20; i++) killOne(w, 'alpha_wolf', 1);
    expect(coins()).toHaveLength(20);
    for (const v of coins()) expect(v).toBeLessThanOrEqual(41);
  });

  it('the elite chest chance is mods.eliteDrop: balance.chest.eliteDrop, then event factors; only tier 1-2 elites roll it', () => {
    const chests = (w: World): number => rowsOf(w, PickupKind.Chest).length;
    const sure = quiet({ content: (c) => (c.balance.chest = { eliteDrop: 1 }) });
    for (let i = 0; i < 30; i++) killOne(sure, 'alpha_wolf', 1);
    expect(chests(sure)).toBe(30);
    for (let i = 0; i < 30; i++) killOne(sure, 'wolf', 0); // plain creatures never drop one
    expect(chests(sure)).toBe(30);

    const never = quiet({ content: (c) => (c.balance.chest = { eliteDrop: 0 }) });
    for (let i = 0; i < 60; i++) killOne(never, 'alpha_wolf', 2);
    expect(chests(never)).toBe(0);

    // an event factor on top of the default 0.12: x0 = none, then back to ~12 %, then x8 (the store holds 1200 pickups: clear it)
    const w = quiet({ config: { seed: 99 } });
    const batch = (n: number): number => {
      w.pickups.clear();
      w.xpGems = 0;
      for (let i = 0; i < n; i++) killOne(w, 'alpha_wolf', 1);
      return chests(w);
    };
    w.setEventMods('drought', { eliteDrop: 0 });
    expect(batch(100)).toBe(0);
    w.clearEventMods('drought');
    expect(Math.abs(batch(400) - 48)).toBeLessThanOrEqual(4 * Math.sqrt(400 * 0.12 * 0.88));
    w.setEventMods('windfall', { eliteDrop: 8 }); // 0.96 against the 12 % base
    expect(batch(100)).toBeGreaterThan(85);
  });

  it('a boss (tier 3) never drops a chest pickup, whatever eliteDrop says', () => {
    const w = quiet({ content: (c) => (c.balance.chest = { eliteDrop: 1 }) });
    killOne(w, 'boss_ork_chief', 3);
    expect(rowsOf(w, PickupKind.Chest)).toHaveLength(0);
  });
});

describe('spawner.ts reads eliteEvery', () => {
  /** times (s) of the elites spawned in `ticks` ticks; the field is frozen so the hero is never touched */
  function eliteTimes(w: World, ticks: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < ticks; i++) {
      freezeEnemies(w);
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'enemySpawn' && e.source === 5) out.push(w.time);
    }
    return out;
  }
  function eliteWorld(over: Parameters<typeof makeWorld>[0] = {}): World {
    const w = quiet({ ...over, config: { ...IMMORTAL, ...over.config } });
    w.time = 130; // band 1: an elite every 60 s
    w.spawner.eliteT = 60;
    return w;
  }

  it('default: one elite per 60 s of band 1', () => {
    const t = eliteTimes(eliteWorld(), 60 * 125);
    expect(t).toHaveLength(2);
    expect(t[0]).toBeCloseTo(130 + 60, 0);
    expect((t[1] as number) - (t[0] as number)).toBeCloseTo(60, 0);
  });

  it('eliteEvery 0.5 (event or hard) halves the interval; 2 doubles it', () => {
    const fast = eliteWorld();
    fast.setEventMods('goldenHour', { eliteEvery: 0.5 });
    const t = eliteTimes(fast, 60 * 125);
    expect(t.length).toBeGreaterThanOrEqual(4);
    expect(t[0]).toBeCloseTo(130 + 30, 0);
    expect((t[1] as number) - (t[0] as number)).toBeCloseTo(30, 0);

    const slow = eliteWorld();
    slow.setEventMods('lull', { eliteEvery: 2 });
    const s = eliteTimes(slow, 60 * 125);
    expect(s).toHaveLength(1);
    expect(s[0]).toBeCloseTo(130 + 120, 0);

    const hard = eliteWorld({
      config: { difficulty: 'hard' },
      content: (c) => (c.balance.hard = { ...c.balance.hard, eliteEveryMul: 0.5 }),
    });
    expect(eliteTimes(hard, 60 * 40)[0]).toBeCloseTo(130 + 30, 0);
    // the same content on normal is untouched
    const normal = eliteWorld({ content: (c) => (c.balance.hard = { ...c.balance.hard, eliteEveryMul: 0.5 }) });
    expect(eliteTimes(normal, 60 * 40)).toHaveLength(0);
  });

  it('an event factor takes effect on the countdown already running, and clearing it restores the pace', () => {
    const w = eliteWorld();
    const start = w.time;
    const t: number[] = [];
    const run = (secs: number): void => void t.push(...eliteTimes(w, Math.round(secs * 60)));
    run(10); // 50 s left at the normal pace
    w.setEventMods('goldenHour', { eliteEvery: 0.5 });
    run(10); // 20 s consumed -> 30 s left
    w.clearEventMods('goldenHour');
    run(29);
    expect(t).toHaveLength(0);
    run(2);
    expect(t).toHaveLength(1);
    expect((t[0] as number) - start).toBeCloseTo(10 + 10 + 30, 0);
  });

  it('a pending modal pauses the countdown whatever the factor says', () => {
    const w = eliteWorld();
    w.setEventMods('goldenHour', { eliteEvery: 0.05 });
    openLevelUp(w, player(w), 1);
    expect(w.modals.length).toBe(1);
    const t0 = w.time;
    const left = w.spawner.eliteT;
    runTicks(w, 600);
    expect(w.time).toBe(t0);
    expect(w.spawner.eliteT).toBe(left);
  });
});

describe('metins.ts reads awaken', () => {
  /** a quiet world with one stone on the ground (sorrow: awakenAfter 45 s), the hero cannot die and hurts nothing */
  function stoneWorld(over: Parameters<typeof makeWorld>[0] = {}): { w: World; m: MetinState } {
    const w = makeWorld({
      ...over,
      config: { ...IMMORTAL, ...over.config },
      content: (c) => {
        const z = zoneOf(c);
        z.metins.types = ['metin_lament'];
        z.metins.interval = [1e6, 1e6];
        for (const d of c.metins) d.swarm.every = 1e9;
        over.content?.(c);
      },
    });
    w.spawner.acc = -1e9;
    w.spawner.eliteT = 1e9;
    w.spawner.nextBoss = w.spawner.bosses.length;
    player(w).skills.length = 0;
    w.metinSys.nextFallAt = 0;
    runTicks(w, 1);
    const m = w.metins[0] as MetinState;
    for (let i = 0; i < 600 && m.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
    expect(m.phase).toBe(MetinPhase.Alive);
    return { w, m };
  }
  /** the stone's age when it awakens */
  function awakensAt(w: World, m: MetinState): number {
    for (let i = 0; i < 60 * 120 && m.phase === MetinPhase.Alive; i++) w.step([NO_INPUT]);
    expect(m.phase).toBe(MetinPhase.Awakened);
    return m.age;
  }

  it('default 45 s; hard muls scale it on hard only; an event factor applies to a stone already standing', () => {
    const a = stoneWorld();
    expect(awakensAt(a.w, a.m)).toBeCloseTo(45, 0);

    const hardContent = (c: ContentDB): void => void (c.balance.hard = { ...c.balance.hard, awakenMul: 0.6 });
    const h = stoneWorld({ config: { difficulty: 'hard' }, content: hardContent });
    expect(awakensAt(h.w, h.m)).toBeCloseTo(27, 0);
    const n = stoneWorld({ content: hardContent });
    expect(awakensAt(n.w, n.m)).toBeCloseTo(45, 0);

    const e = stoneWorld();
    runTicks(e.w, 60 * 10);
    e.w.setEventMods('rain', { awaken: 0.5 });
    expect(awakensAt(e.w, e.m)).toBeCloseTo(22.5, 0); // age 22.5 s >= 45 x 0.5
    const late = stoneWorld();
    runTicks(late.w, 60 * 30); // already past 22.5 s when the factor arrives: it awakens at once
    late.w.setEventMods('rain', { awaken: 0.5 });
    expect(awakensAt(late.w, late.m)).toBeLessThan(31);
    const slow = stoneWorld();
    slow.w.setEventMods('calm', { awaken: 2 });
    expect(awakensAt(slow.w, slow.m)).toBeCloseTo(90, 0);
  });

  it('the Great Metin never awakens, however small the factor', () => {
    const w = makeWorld({ config: IMMORTAL });
    w.setEventMods('x', { awaken: EVENT_MOD_MIN });
    w.time = w.zone.final.at - 0.05;
    let guard = 0;
    while (!w.metins.some((m) => m.great && m.phase === MetinPhase.Alive) && guard++ < 1200) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    const great = w.metins.find((m) => m.great) as MetinState;
    expect(great.phase).toBe(MetinPhase.Alive);
    great.def.awakenAfter = 1;
    for (let i = 0; i < 60 * 10; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    expect(great.phase).toBe(MetinPhase.Alive);
  });
});

describe('bosses.ts reads finalHp and finalEnrage', () => {
  function immortal(over: Parameters<typeof makeWorld>[0] = {}): World {
    return makeWorld({ ...over, config: { ...IMMORTAL, ...over.config } });
  }
  function hpMaxOf(w: World, b: BossState): number {
    return w.enemies.hpMax[w.enemies.find(b.enemy)] as number;
  }
  /** play until the final boss has emerged from the Great Metin (the real path) */
  function emerge(w: World): BossState {
    w.time = w.zone.final.at - 0.05;
    let guard = 0;
    while (!w.bosses.some((b) => b.final) && guard++ < 1500) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    const boss = w.bosses.find((b) => b.final);
    if (!boss) throw new Error('the final boss never emerged');
    return boss;
  }
  /** seconds from the first enrage to the first rage stack */
  function stackGap(w: World, boss: BossState): number {
    boss.age = boss.def.enrageAfter - DT * 0.5;
    for (let i = 0; i < 4 && !boss.enraged; i++) w.step([NO_INPUT]);
    expect(boss.enraged).toBe(true);
    expect(boss.rageStacks).toBe(0);
    const t0 = w.time;
    for (let i = 0; i < 60 * 60 && boss.rageStacks === 0; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    expect(boss.rageStacks).toBe(1);
    return w.time - t0;
  }

  it('final boss HP = def.hp x hpScale x mods.finalHp (zone.final.hpMul, events); ordinary bosses ignore it', () => {
    const base = immortal();
    const plain = spawnBoss(base, base.zone.final.boss, true, 10, 10) as BossState;
    const expected = plain.def.hp * base.hpScale();
    expect(hpMaxOf(base, plain)).toBeCloseTo(expected, 6);

    const zoned = immortal({ content: (c) => (zoneOf(c).final.hpMul = 0.8) });
    const z = spawnBoss(zoned, zoned.zone.final.boss, true, 10, 10) as BossState;
    expect(hpMaxOf(zoned, z)).toBeCloseTo(expected * 0.8, 6);

    const evented = immortal();
    evented.setEventMods('x', { finalHp: 1.5 });
    const ev = spawnBoss(evented, evented.zone.final.boss, true, 10, 10) as BossState;
    expect(hpMaxOf(evented, ev)).toBeCloseTo(expected * 1.5, 6);

    // an ordinary boss (same def, not final) and a boss spawned before the factor are not scaled
    const o = spawnBoss(evented, evented.zone.final.boss, false, -10, -10) as BossState;
    expect(hpMaxOf(evented, o)).toBeCloseTo(expected, 6);
    const w = immortal({ content: (c) => (zoneOf(c).final.hpMul = 2) });
    const sched = spawnBoss(w, zoneOf(w.content).bosses[0]?.boss as string, false, 10, 10) as BossState;
    expect(hpMaxOf(w, sched)).toBeCloseTo(sched.def.hp * w.hpScale(), 6);
  });

  it('the rage stack interval is RAGE_STACK_EVERY x mods.finalEnrage on the final boss', () => {
    const gap = (finalEnrage: number | null): number => {
      const w = immortal();
      if (finalEnrage !== null) w.setEventMods('x', { finalEnrage });
      return stackGap(w, emerge(w));
    };
    expect(gap(null)).toBeCloseTo(RAGE_STACK_EVERY, 0);
    expect(gap(0.5)).toBeCloseTo(RAGE_STACK_EVERY * 0.5, 0);
    expect(gap(2)).toBeCloseTo(RAGE_STACK_EVERY * 2, 0);

    const hardContent = (c: ContentDB): void => void (c.balance.hard = { ...c.balance.hard, finalEnrageMul: 0.5 });
    const h = immortal({ config: { difficulty: 'hard' }, content: hardContent });
    expect(stackGap(h, emerge(h))).toBeCloseTo(RAGE_STACK_EVERY * 0.5, 0);
    const n = immortal({ content: hardContent });
    expect(stackGap(n, emerge(n))).toBeCloseTo(RAGE_STACK_EVERY, 0);
  }, 60_000);

  it('the factor is read at each stack: clearing it mid-fight returns to the normal interval', () => {
    const w = immortal();
    const boss = emerge(w);
    w.setEventMods('x', { finalEnrage: 0.25 });
    stackGap(w, boss); // first stack after 3 s
    const t0 = w.time;
    w.clearEventMods('x');
    // the next stack was already scheduled at the old pace (3 s), the one after that uses 12 s
    for (let i = 0; i < 60 * 60 && boss.rageStacks < 3; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    expect(boss.rageStacks).toBe(3);
    expect(w.time - t0).toBeCloseTo(RAGE_STACK_EVERY * 0.25 + RAGE_STACK_EVERY, 0);
  }, 60_000);

  it('an ordinary boss enrages once and never stacks, factor or not', () => {
    const w = immortal();
    w.setEventMods('x', { finalEnrage: EVENT_MOD_MIN });
    w.time = 179.9;
    let guard = 0;
    while (w.bosses.length === 0 && guard++ < 600) w.step([NO_INPUT]);
    const boss = w.bosses[0] as BossState;
    expect(boss.final).toBe(false);
    boss.age = boss.def.enrageAfter - DT * 0.5;
    for (let i = 0; i < 60 * 30; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    expect(boss.enraged).toBe(true);
    expect(boss.rageStacks).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// neutrality and the whole-run edges

describe('defaults reproduce the sim exactly', () => {
  /** a bot-played run: same seed, same inputs; returns the state hash */
  function play(w: World, seconds: number, mid?: (w: World, sec: number) => void): string {
    for (let i = 0; i < seconds * 60; i++) {
      drainModals(w);
      if (i % 600 === 0) mid?.(w, i / 60);
      w.step([botInput(w, w.tick)]);
    }
    return hashWorld(w);
  }

  it('all-1 factors, set and cleared during a 150 s bot run, leave the state hash (every rng stream included) identical', () => {
    const plain = play(makeWorld({ config: { seed: 4242 } }), 150);
    const factored = play(makeWorld({ config: { seed: 4242 } }), 150, (w, sec) => {
      if (sec === 0) w.setEventMods('neutral', { xp: 1, yeop: 1, eliteDrop: 1, eliteEvery: 1, awaken: 1, finalHp: 1, finalEnrage: 1 });
      if (sec === 60) w.clearEventMods('neutral');
    });
    expect(factored).toBe(plain);
  });

  it('explicit data that equals the defaults (eliteDrop 0.12, xpMul 1, hpMul 1, hard muls 1) changes nothing', () => {
    const plain = play(makeWorld({ config: { seed: 77, difficulty: 'hard' } }), 90);
    const explicit = play(
      makeWorld({
        config: { seed: 77, difficulty: 'hard' },
        content: (c) => {
          c.balance.chest = { eliteDrop: 0.12 };
          c.balance.hard = { ...c.balance.hard, awakenMul: 1, eliteEveryMul: 1, finalEnrageMul: 1 };
          zoneOf(c).xpMul = 1;
          zoneOf(c).final.hpMul = 1;
        },
      }),
      90,
    );
    expect(explicit).toBe(plain);
  });

  it('a real factor does change the run (the hash test above can fail)', () => {
    const plain = play(makeWorld({ config: { seed: 4242 } }), 60);
    const boosted = play(makeWorld({ config: { seed: 4242 } }), 60, (w, sec) => {
      if (sec === 0) w.setEventMods('x', { xp: 3 });
    });
    expect(boosted).not.toBe(plain);
  });
});

describe('edges: death, run end', () => {
  it('modifiers survive the hero dying, and a finished run still accepts set / clear', () => {
    const w = makeWorld();
    w.setEventMods('x', { xp: 2, eliteEvery: 0.5 });
    const p = player(w);
    p.hp = 0;
    p.alive = false;
    runTicks(w, 120);
    expect(w.allDead()).toBe(true);
    expect(w.mods.xp).toBe(2);
    w.over = true;
    w.setEventMods('y', { yeop: 2 });
    runTicks(w, 5);
    w.clearEventMods('x');
    w.clearEventMods('y');
    expect(w.mods).toEqual(NEUTRAL);
  });
});

// ---------------------------------------------------------------------------
// co-op: the host owns the modifiers, the effects reach the guest through the state it already mirrors

describe('co-op', () => {
  let h: CoopHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) (h as CoopHarness).tick();
  };

  it('xpMul and a host-side event factor reach the guest hero through the mirrored xp; a reconnect resyncs it', async () => {
    h = await CoopHarness.create({
      guests: 1,
      latencyMs: 30,
      enemies: 0,
      tough: true,
      content: (c) => (zoneOf(c).xpMul = 2),
    });
    const hw = h.hostWorld;
    const mw = h.guestWorlds[0] as World;
    run(60);
    expect(hw.mods.xp).toBe(2);
    const wolfXp = enemyOf(hw.content, 'wolf').xp;
    const guestHero = hw.players[1] as ReturnType<typeof player>;
    const mirrored = mw.players[0] as ReturnType<typeof player>;

    const killAtHero = (n: number): void => {
      const hero = hw.players[0] as ReturnType<typeof player>;
      for (let i = 0; i < n; i++) {
        const row = spawn(hw, 'wolf', hero.x + 0.5, hero.z, { tier: 0 });
        killEnemy(hw, row, 0, -1, false);
      }
    };
    const xp0 = guestHero.xp;
    killAtHero(1);
    run(90);
    // zone.xpMul 2: the gem is worth 2 x wolf.xp (the partner collects it too: shared xp, own xpGain)
    expect(guestHero.xp - xp0).toBeCloseTo(wolfXp * 2 * guestHero.stats.xpGain, 4);
    expect(Math.abs(mirrored.xp - guestHero.xp)).toBeLessThanOrEqual(0.5); // the wire carries whole xp points

    const xp1 = guestHero.xp;
    hw.setEventMods('goldenHour', { xp: 1.5 });
    killAtHero(1);
    run(90);
    expect(guestHero.xp - xp1).toBeCloseTo(wolfXp * 2 * 1.5 * guestHero.stats.xpGain, 4);
    expect(Math.abs(mirrored.xp - guestHero.xp)).toBeLessThanOrEqual(0.5); // the wire carries whole xp points

    // a guest that drops and comes back (late join) sees the host's numbers again
    hw.clearEventMods('goldenHour');
    h.transports[1]?.drop();
    run(60 * 3);
    await h.reconnect(1);
    run(120);
    await h.settle(100);
    expect(Math.abs(mirrored.xp - guestHero.xp)).toBeLessThanOrEqual(0.5); // the wire carries whole xp points
    expect(mirrored.level).toBe(guestHero.level);
  }, 60_000);
});
