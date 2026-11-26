// Combat core: damage to enemies (crit / race / boss / resist / status multipliers), kills, damage to the hero
// (armor, resist, evasion, i-frames, shield, thorns, lifesteal, revive, death), statuses and knockback.

import { describe, expect, it } from 'vitest';
import {
  applyStatus,
  elementOfRaces,
  healPlayer,
  hitEnemy,
  HurtKind,
  hurtPlayer,
  killEnemy,
  knockEnemy,
  newHitCtx,
  pushPlayer,
  type HitCtx,
} from '../combat';
import { HAZARD_IFRAMES, KNOCK_DECAY, PLAYER_IFRAMES } from '../constants';
import { HealSource, type SimEvent, type SimEventType } from '../events';
import { refreshStats } from '../stats';
import { ElementIdx, EnemyFlag, EnemyState, PickupKind, StatusBit, StatusIdx } from '../stores';
import type { StatMods } from '../../data/schema';
import type { World } from '../world';
import { METIN_ROW_TYPE } from '../enemies';
import {
  clearEnemies,
  collect,
  dropSkills,
  freezeEnemies,
  freezeSchedules,
  giveSkill,
  makeWorld,
  NO_INPUT,
  player,
  runTicks,
  spawn,
  typeOf,
  type TestWorldOpts,
} from './helpers';

// ---------------------------------------------------------------------------
// helpers

/** quiet world: schedules frozen, no enemies, no hero skills, crit off, no i-frames, empty event list */
function arena(opts: TestWorldOpts = {}): World {
  const w = makeWorld(opts);
  freezeSchedules(w);
  clearEnemies(w);
  dropSkills(w);
  const p = player(w);
  p.stats.critChance = 0;
  p.iframes = 0;
  w.bus.clear();
  return w;
}

/** an enemy with plenty of hp so hits never kill it */
function dummy(w: World, id = 'wolf', x = 10, z = 0, hp = 1000): number {
  const row = spawn(w, id, x, z);
  w.enemies.hp[row] = hp;
  w.enemies.hpMax[row] = hp;
  return row;
}

function ctx(over: Partial<HitCtx> = {}): HitCtx {
  return Object.assign(newHitCtx(), { player: 0 }, over);
}

function evs<T extends SimEventType>(w: World, type: T): Extract<SimEvent, { t: T }>[] {
  return w.events.filter((e): e is Extract<SimEvent, { t: T }> => e.t === type);
}

function addFixed(w: World, mods: StatMods): void {
  const p = player(w);
  p.fixed.push(mods);
  refreshStats(p, w.content, w.ix);
  p.stats.critChance = 0;
}

function pickupsOf(w: World, kind: PickupKind): { value: number; x: number; z: number }[] {
  const out: { value: number; x: number; z: number }[] = [];
  const P = w.pickups;
  for (let i = 0; i < P.count; i++) if (P.kind[i] === kind) out.push({ value: P.value[i] as number, x: P.x[i] as number, z: P.z[i] as number });
  return out;
}

const SRC_FAR = 100; // attacker position used where the source location does not matter

// ---------------------------------------------------------------------------

describe('hitEnemy: damage formula', () => {
  it('applies the base damage unchanged when nothing modifies it', () => {
    const w = arena();
    const row = dummy(w);
    const handle = w.enemies.id[row] as number;
    const dealt = hitEnemy(w, row, 7, ctx());
    expect(dealt).toBe(7);
    expect(w.enemies.hp[row]).toBeCloseTo(993, 3);
    expect(w.enemies.flash[row]).toBe(1);
    expect(w.tally.damageDealt).toBeCloseTo(7, 6);
    expect(w.enemies.lastHitter[row]).toBe(0);
    const [e] = evs(w, 'damage');
    expect(e).toMatchObject({ amount: 7, crit: false, killed: false, dot: false, boss: false, targetId: handle, player: 0, skill: -1, element: 0 });
  });

  it('feeds the skill damage meter of the global slot in ctx.skill', () => {
    const w = arena();
    const skill = giveSkill(w, 'sword_arc');
    const other = giveSkill(w, 'lightning_trio');
    const row = dummy(w, 'wolf', 30, 0); // out of every trigger range
    hitEnemy(w, row, 5, ctx({ skill: skill.slot }));
    hitEnemy(w, row, 3, ctx({ skill: skill.slot }));
    hitEnemy(w, row, 11, ctx({ skill: -1 }));
    expect(skill.damage).toBeCloseTo(8, 6);
    expect(other.damage).toBe(0);
    expect(w.tally.damageDealt).toBeCloseTo(19, 5);
    expect(evs(w, 'damage')[0]?.skill).toBe(skill.slot);
  });

  it('crit multiplies by stats.critMul and is reported on the event', () => {
    const w = arena();
    const p = player(w);
    p.stats.critChance = 1;
    p.stats.critMul = 2.5;
    const row = dummy(w);
    expect(hitEnemy(w, row, 10, ctx())).toBeCloseTo(25, 5);
    expect(evs(w, 'damage')[0]).toMatchObject({ crit: true });
    expect(w.enemies.hp[row]).toBeCloseTo(975, 3);
  });

  it('noCrit suppresses crits even at 100% chance', () => {
    const w = arena();
    const p = player(w);
    p.stats.critChance = 1;
    p.stats.critMul = 3;
    const row = dummy(w);
    expect(hitEnemy(w, row, 10, ctx({ noCrit: true }))).toBe(10);
    expect(evs(w, 'damage')[0]).toMatchObject({ crit: false });
  });

  it('crit chance 0 never crits and never consumes the combat rng stream', () => {
    const w = arena();
    const row = dummy(w);
    const before = w.rng.combat.getState();
    for (let i = 0; i < 200; i++) expect(hitEnemy(w, row, 1, ctx())).toBe(1);
    expect(w.rng.combat.getState()).toEqual(before);
  });

  it('crit frequency follows the crit chance', () => {
    const w = arena();
    const p = player(w);
    p.stats.critChance = 0.3;
    p.stats.critMul = 2;
    const row = dummy(w, 'wolf', 10, 0, 100000);
    const n = 3000;
    let crits = 0;
    for (let i = 0; i < n; i++) {
      const dmg = hitEnemy(w, row, 1, ctx());
      expect(dmg === 1 || dmg === 2).toBe(true);
      if (dmg === 2) crits++;
    }
    const sigma = Math.sqrt(n * 0.3 * 0.7);
    expect(Math.abs(crits - n * 0.3)).toBeLessThan(5 * sigma);
  });

  it('race bonus: damage × (1 + vsRace) only against enemies carrying that race tag', () => {
    const w = arena();
    addFixed(w, { vsRace: { animal: 0.5, fire: 0.25 } });
    const wolf = dummy(w, 'wolf', 10, 0);
    const lizard = dummy(w, 'ember_lizard', 12, 0);
    const imp = dummy(w, 'bomb_imp', 14, 0);
    expect(hitEnemy(w, wolf, 10, ctx())).toBeCloseTo(15, 5);
    expect(hitEnemy(w, lizard, 10, ctx())).toBeCloseTo(12.5, 5);
    expect(hitEnemy(w, imp, 10, ctx())).toBeCloseTo(10, 5);
  });

  it('boss bonus (tier 3 rows): damage × (1 + vsBoss) and the damage event is flagged boss', () => {
    const w = arena();
    addFixed(w, { vsBoss: 0.4 });
    const normal = dummy(w, 'bear', 10, 0);
    const king = dummy(w, 'bear', 14, 0);
    w.enemies.eliteTier[king] = 3;
    expect(hitEnemy(w, normal, 10, ctx())).toBeCloseTo(10, 5);
    expect(hitEnemy(w, king, 10, ctx())).toBeCloseTo(14, 5);
    const events = evs(w, 'damage');
    expect(events[0]?.boss).toBe(false);
    expect(events[1]?.boss).toBe(true);
  });

  it('enemy resist scales damage by (1 − resist) of the hit element; weakness (< 0) amplifies', () => {
    const w = arena();
    const fox = dummy(w, 'fox', 10, 0); // fire −0.2
    const lizard = dummy(w, 'ember_lizard', 14, 0); // fire 0.5, ice −0.2
    const rat = dummy(w, 'plague_rat', 18, 0); // poison 0.5
    expect(hitEnemy(w, fox, 10, ctx({ element: ElementIdx.Fire }))).toBeCloseTo(12, 5);
    expect(hitEnemy(w, fox, 10, ctx({ element: ElementIdx.Physical }))).toBeCloseTo(10, 5);
    expect(hitEnemy(w, fox, 10, ctx({ element: ElementIdx.Ice }))).toBeCloseTo(10, 5);
    expect(hitEnemy(w, lizard, 10, ctx({ element: ElementIdx.Fire }))).toBeCloseTo(5, 5);
    expect(hitEnemy(w, lizard, 10, ctx({ element: ElementIdx.Ice }))).toBeCloseTo(12, 5);
    expect(hitEnemy(w, lizard, 10, ctx({ element: ElementIdx.Physical }))).toBeCloseTo(10, 5);
    expect(hitEnemy(w, rat, 10, ctx({ element: ElementIdx.Poison }))).toBeCloseTo(5, 5);
    expect(hitEnemy(w, rat, 10, ctx({ element: ElementIdx.Fire }))).toBeCloseTo(10, 5);
  });

  it('resist above 100% still leaves a small positive hit (damage never turns into healing)', () => {
    const w = arena({
      content: (c) => {
        const wolf = c.enemies.find((e) => e.id === 'wolf');
        if (wolf) wolf.resist = { fire: 3 };
      },
    });
    const row = dummy(w);
    const dmg = hitEnemy(w, row, 10, ctx({ element: ElementIdx.Fire }));
    expect(dmg).toBeGreaterThanOrEqual(0.25);
    expect(dmg).toBeLessThan(5);
    expect(w.enemies.hp[row]).toBeLessThan(1000);
  });

  it('weaken adds its power to damage taken, freeze adds 20%; they stack with each other', () => {
    const w = arena();
    const weak = dummy(w, 'wolf', 10, 0);
    const frozen = dummy(w, 'wolf', 12, 0);
    const both = dummy(w, 'wolf', 14, 0);
    applyStatus(w, weak, StatusIdx.Weaken, 10, 0.3, -1, false);
    applyStatus(w, frozen, StatusIdx.Freeze, 10, 0, -1, false);
    applyStatus(w, both, StatusIdx.Weaken, 10, 0.5, -1, false);
    applyStatus(w, both, StatusIdx.Freeze, 10, 0, -1, false);
    expect(hitEnemy(w, weak, 10, ctx())).toBeCloseTo(13, 3);
    expect(hitEnemy(w, frozen, 10, ctx())).toBeCloseTo(12, 5);
    expect(hitEnemy(w, both, 10, ctx())).toBeCloseTo(10 * 1.5 * 1.2, 3);
  });

  it('every multiplier composes multiplicatively: crit × race × boss × resist × weaken × freeze', () => {
    const w = arena();
    const p = player(w);
    addFixed(w, { vsRace: { animal: 0.5 }, vsBoss: 0.2 });
    p.stats.critChance = 1;
    p.stats.critMul = 2;
    const fox = dummy(w, 'fox', 10, 0, 100000); // animal, fire resist −0.2
    w.enemies.eliteTier[fox] = 3;
    applyStatus(w, fox, StatusIdx.Weaken, 10, 0.3, -1, false);
    applyStatus(w, fox, StatusIdx.Freeze, 10, 0, -1, false);
    const dmg = hitEnemy(w, fox, 10, ctx({ element: ElementIdx.Fire }));
    expect(dmg).toBeCloseTo(10 * 2 * 1.5 * 1.2 * 1.2 * 1.3 * 1.2, 2);
  });

  it('never deals less than 0.25', () => {
    const w = arena();
    const row = dummy(w);
    expect(hitEnemy(w, row, 0.01, ctx())).toBeCloseTo(0.25, 6);
    expect(hitEnemy(w, row, 0, ctx())).toBeCloseTo(0.25, 6);
  });

  it('cannot hit Dying, Invuln or Phased rows: returns 0, no hp change, no event, no tally', () => {
    const w = arena();
    const dying = dummy(w, 'wolf', 10, 0);
    const invuln = dummy(w, 'wolf', 12, 0);
    const phased = dummy(w, 'wolf', 14, 0);
    w.enemies.state[dying] = EnemyState.Dying;
    w.enemies.flags[invuln] = EnemyFlag.Invuln;
    w.enemies.flags[phased] = EnemyFlag.Phased;
    for (const row of [dying, invuln, phased]) {
      expect(hitEnemy(w, row, 50, ctx())).toBe(0);
      expect(w.enemies.hp[row]).toBe(1000);
    }
    expect(evs(w, 'damage')).toHaveLength(0);
    expect(w.tally.damageDealt).toBe(0);
  });

  it('ownerless hits (player −1) skip crit / race / boss bonuses and do not set the last hitter', () => {
    const w = arena();
    const p = player(w);
    addFixed(w, { vsRace: { animal: 1 }, vsBoss: 1 });
    p.stats.critChance = 1;
    p.stats.critMul = 3;
    const row = dummy(w, 'wolf', 10, 0);
    w.enemies.eliteTier[row] = 3;
    w.enemies.lastHitter[row] = 0;
    expect(hitEnemy(w, row, 10, ctx({ player: -1 }))).toBe(10);
    expect(w.enemies.lastHitter[row]).toBe(0);
  });

  it('a metin row ignores race bonuses and enemy resist (metins are not creatures)', () => {
    const w = arena();
    addFixed(w, { vsRace: { animal: 1, metin: 1 } });
    const e = w.enemies;
    const row = e.alloc();
    e.type[row] = METIN_ROW_TYPE;
    e.flags[row] = EnemyFlag.Metin;
    e.state[row] = EnemyState.Static;
    e.hp[row] = 1000;
    e.hpMax[row] = 1000;
    e.radius[row] = 1.5;
    expect(hitEnemy(w, row, 10, ctx({ element: ElementIdx.Fire }))).toBe(10);
    expect(e.hp[row]).toBeCloseTo(990, 3);
    // statuses never stick to a metin
    applyStatus(w, row, StatusIdx.Stun, 5, 1, -1, false);
    applyStatus(w, row, StatusIdx.Burn, 5, 4, -1, false);
    expect(e.status[row]).toBe(0);
  });
});

describe('kills, tally and loot', () => {
  it('a killing blow: Dying state, hp 0, killed damage event, enemyDeath event, counters, xp gem', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 8, 3);
    const e = w.enemies;
    const handle = e.id[row] as number;
    const typeIdx = typeOf(w, 'wolf');
    expect(w.spawner.alive).toBe(1);
    const skill = giveSkill(w, 'sword_arc');
    w.bus.clear();
    const dealt = hitEnemy(w, row, 500, ctx({ skill: skill.slot }));
    expect(dealt).toBe(500); // overkill is reported in full
    expect(e.state[row]).toBe(EnemyState.Dying);
    expect(e.hp[row]).toBe(0);
    expect(evs(w, 'damage')[0]).toMatchObject({ killed: true, amount: 500, targetId: handle });
    const deaths = evs(w, 'enemyDeath');
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatchObject({ id: handle, type: typeIdx, tier: 0, killer: 0, skill: skill.slot, crit: false });
    expect(deaths[0]?.x).toBeCloseTo(8, 4);
    expect(deaths[0]?.z).toBeCloseTo(3, 4);
    expect(w.tally.kills).toBe(1);
    expect(player(w).kills).toBe(1);
    expect(w.spawner.alive).toBe(0);
    const gems = pickupsOf(w, PickupKind.Xp);
    expect(gems).toHaveLength(1);
    expect(gems[0]?.value).toBeCloseTo(1, 5); // wolf def.xp
  });

  it('a Dying row cannot be hit or killed again, so kills are counted once', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 8, 3);
    hitEnemy(w, row, 500, ctx());
    expect(hitEnemy(w, row, 500, ctx())).toBe(0);
    killEnemy(w, row, 0, -1, false);
    expect(w.tally.kills).toBe(1);
    expect(player(w).kills).toBe(1);
    expect(evs(w, 'enemyDeath')).toHaveLength(1);
    expect(w.spawner.alive).toBe(0);
  });

  it('the killing blow of a crit is flagged on enemyDeath', () => {
    const w = arena();
    const p = player(w);
    p.stats.critChance = 1;
    p.stats.critMul = 2;
    const row = spawn(w, 'wolf', 5, 5);
    hitEnemy(w, row, 12, ctx());
    expect(evs(w, 'enemyDeath')[0]?.crit).toBe(true);
  });

  it('elite and champion kills count as elites and drop bigger gems (1.5× / 1.25×) plus guaranteed yeop', () => {
    const w = arena();
    const elite = spawn(w, 'alpha_wolf', 6, 0, { tier: 1 });
    const champ = spawn(w, 'alpha_wolf', -6, 0, { tier: 2 });
    hitEnemy(w, elite, 1e6, ctx());
    hitEnemy(w, champ, 1e6, ctx());
    expect(w.tally.kills).toBe(2);
    expect(w.tally.elitesKilled).toBe(2);
    const gems = pickupsOf(w, PickupKind.Xp).map((g) => g.value).sort((a, b) => a - b);
    expect(gems[0]).toBeCloseTo(20 * 1.25, 4);
    expect(gems[1]).toBeCloseTo(20 * 1.5, 4);
    const yeop = pickupsOf(w, PickupKind.Yeop);
    expect(yeop).toHaveLength(2);
    for (const y of yeop) {
      expect(y.value).toBeGreaterThanOrEqual(12);
      expect(y.value).toBeLessThanOrEqual(25);
    }
  });

  it('plain enemies do not count as elites', () => {
    const w = arena();
    hitEnemy(w, spawn(w, 'wolf', 5, 5), 100, ctx());
    expect(w.tally.elitesKilled).toBe(0);
  });

  it('environment kills (killer −1) count for the run tally but not for any hero', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 5, 5);
    killEnemy(w, row, -1, -1, false);
    expect(w.tally.kills).toBe(1);
    expect(player(w).kills).toBe(0);
    expect(evs(w, 'enemyDeath')[0]).toMatchObject({ killer: -1, skill: -1 });
  });

  it('rewards scale with difficulty and corruption; noLoot suppresses drops', () => {
    const hard = arena({ config: { difficulty: 'hard' } });
    hitEnemy(hard, spawn(hard, 'wolf', 5, 5), 1e5, ctx());
    expect(pickupsOf(hard, PickupKind.Xp)[0]?.value).toBeCloseTo(1.5, 5);

    const corrupt = arena();
    corrupt.corruption = 0.4;
    hitEnemy(corrupt, spawn(corrupt, 'wolf', 5, 5), 1e5, ctx());
    expect(pickupsOf(corrupt, PickupKind.Xp)[0]?.value).toBeCloseTo(1.2, 5);

    const none = arena();
    none.noLoot = true;
    hitEnemy(none, spawn(none, 'wolf', 5, 5), 1e5, ctx());
    expect(none.pickups.count).toBe(0);
    expect(none.tally.kills).toBe(1);
  });

  it('dead rows are removed at the END of the tick and their handle stops resolving', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 20, 0);
    const handle = w.enemies.id[row] as number;
    hitEnemy(w, row, 500, ctx());
    expect(w.enemies.find(handle)).toBe(row); // still present until the sweep
    expect(w.enemies.count).toBe(1);
    w.step([NO_INPUT]);
    expect(w.enemies.find(handle)).toBe(-1);
    expect(w.enemies.count).toBe(0);
  });

  it('a damage-over-time kill emits enemyDeath during the tick and the row is gone afterwards', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 20, 0);
    const handle = w.enemies.id[row] as number;
    w.enemies.hp[row] = 3;
    applyStatus(w, row, StatusIdx.Poison, 3, 10, -1, false);
    const deaths = collect(w, 60, ['enemyDeath']);
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatchObject({ id: handle, killer: 0, skill: -1 });
    expect(w.enemies.find(handle)).toBe(-1);
    expect(w.tally.kills).toBe(1);
    expect(player(w).kills).toBe(1);
  });

  it('a hit by player 1 attributes the kill to that player (co-op)', () => {
    const w = arena({
      config: { coop: [{ classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } }] },
    });
    dropSkills(w, 1);
    const row = spawn(w, 'wolf', 20, 0);
    hitEnemy(w, row, 500, ctx({ player: 1 }));
    expect(player(w, 1).kills).toBe(1);
    expect(player(w, 0).kills).toBe(0);
    expect(evs(w, 'enemyDeath')[0]?.killer).toBe(1);
  });

  it('elementOfRaces maps race tags to hostile attack elements', () => {
    expect(elementOfRaces(['animal'])).toBe(ElementIdx.Physical);
    expect(elementOfRaces(['fire'])).toBe(ElementIdx.Fire);
    expect(elementOfRaces(['dragon'])).toBe(ElementIdx.Fire);
    expect(elementOfRaces(['ice'])).toBe(ElementIdx.Ice);
    expect(elementOfRaces(['undead'])).toBe(ElementIdx.Dark);
    expect(elementOfRaces(['devil'])).toBe(ElementIdx.Dark);
    expect(elementOfRaces(['esoteric'])).toBe(ElementIdx.Dark);
    expect(elementOfRaces(['insect'])).toBe(ElementIdx.Poison);
    expect(elementOfRaces(['animal', 'ice', 'fire'])).toBe(ElementIdx.Ice); // first matching tag wins
    expect(elementOfRaces([])).toBe(ElementIdx.Physical);
  });
});

describe('trinket procs on hit', () => {
  it('stun / slow / poison procs apply their statuses (chance 1)', () => {
    const w = arena();
    const p = player(w);
    p.stats.stunChance = 1;
    p.stats.stunDuration = 0.6;
    p.stats.slowChance = 1;
    p.stats.slowPower = 0.3;
    p.stats.slowDuration = 2;
    p.stats.poisonChance = 1;
    p.stats.poisonPower = 0.5;
    p.stats.poisonDuration = 3;
    const row = dummy(w);
    hitEnemy(w, row, 20, ctx());
    const e = w.enemies;
    expect((e.status[row] as number) & StatusBit.Stun).toBeTruthy();
    expect(e.statT[row * 8 + StatusIdx.Stun]).toBeCloseTo(0.6, 5);
    expect(e.statT[row * 8 + StatusIdx.Slow]).toBeCloseTo(2, 5);
    expect(e.statP[row * 8 + StatusIdx.Slow]).toBeCloseTo(0.3, 5);
    expect(e.statT[row * 8 + StatusIdx.Poison]).toBeCloseTo(3, 5);
    expect(e.statP[row * 8 + StatusIdx.Poison]).toBeCloseTo(0.5 * 20, 4); // dps = power × hit damage
  });

  it('procs do not fire on a killing blow or when noProc is set', () => {
    const w = arena();
    const p = player(w);
    p.stats.stunChance = 1;
    p.stats.stunDuration = 1;
    const a = dummy(w, 'wolf', 10, 0);
    const b = dummy(w, 'wolf', 12, 0, 5);
    hitEnemy(w, a, 20, ctx({ noProc: true }));
    expect(w.enemies.status[a]).toBe(0);
    hitEnemy(w, b, 20, ctx());
    expect(w.enemies.state[b]).toBe(EnemyState.Dying);
    expect(w.enemies.statT[b * 8 + StatusIdx.Stun]).toBe(0);
  });

  it('the stun proc is cut to 25% on bosses', () => {
    const w = arena();
    const p = player(w);
    p.stats.stunChance = 1;
    p.stats.stunDuration = 2;
    const king = dummy(w, 'bear', 10, 0);
    w.enemies.eliteTier[king] = 3;
    hitEnemy(w, king, 10, ctx());
    expect(w.enemies.statT[king * 8 + StatusIdx.Stun]).toBeCloseTo(0.5, 5);
  });

  it('chain hit: a second enemy near the target takes dmg × chainDamage, never the source, never recursively', () => {
    const w = arena();
    const p = player(w);
    p.stats.chainChance = 1;
    p.stats.chainDamage = 0.5;
    const a = dummy(w, 'wolf', 10, 0);
    const b = dummy(w, 'wolf', 13, 0);
    const far = dummy(w, 'wolf', 40, 0);
    w.hash.rebuild(w.enemies);
    w.bus.clear();
    hitEnemy(w, a, 20, ctx());
    expect(w.enemies.hp[a]).toBeCloseTo(980, 3);
    expect(w.enemies.hp[b]).toBeCloseTo(990, 3);
    expect(w.enemies.hp[far]).toBe(1000);
    expect(evs(w, 'damage')).toHaveLength(2); // exactly one chained hit, no recursion ping-pong
  });

  it('chain hit with no other enemy within 6 m does nothing extra', () => {
    const w = arena();
    const p = player(w);
    p.stats.chainChance = 1;
    p.stats.chainDamage = 1;
    const a = dummy(w, 'wolf', 10, 0);
    dummy(w, 'wolf', 25, 0);
    w.hash.rebuild(w.enemies);
    w.bus.clear();
    hitEnemy(w, a, 20, ctx());
    expect(evs(w, 'damage')).toHaveLength(1);
  });

  it('crit burst: crits splash dmg × burstDamage onto enemies inside the radius, excluding the target', () => {
    const w = arena();
    const p = player(w);
    p.stats.critChance = 1;
    p.stats.critMul = 2;
    p.stats.critBurstRadius = 3;
    p.stats.critBurstDamage = 0.25;
    const target = dummy(w, 'wolf', 10, 0);
    const near = dummy(w, 'wolf', 11.5, 1);
    const outside = dummy(w, 'wolf', 20, 0);
    w.hash.rebuild(w.enemies);
    hitEnemy(w, target, 10, ctx()); // 20 on a crit → burst 5
    expect(w.enemies.hp[target]).toBeCloseTo(980, 3);
    expect(w.enemies.hp[near]).toBeCloseTo(995, 3);
    expect(w.enemies.hp[outside]).toBe(1000);
  });

  it('crit burst needs a crit', () => {
    const w = arena();
    const p = player(w);
    p.stats.critChance = 0;
    p.stats.critBurstRadius = 3;
    p.stats.critBurstDamage = 0.5;
    const target = dummy(w, 'wolf', 10, 0);
    const near = dummy(w, 'wolf', 11, 0);
    w.hash.rebuild(w.enemies);
    hitEnemy(w, target, 10, ctx());
    expect(w.enemies.hp[near]).toBe(1000);
  });
});

describe('statuses on enemies', () => {
  it('applyStatus sets the bit, the timer and the power; the longest / strongest wins on re-application', () => {
    const w = arena();
    const row = dummy(w);
    const e = w.enemies;
    applyStatus(w, row, StatusIdx.Slow, 2, 0.3, 4, false);
    expect((e.status[row] as number) & StatusBit.Slow).toBeTruthy();
    expect(e.statT[row * 8]).toBeCloseTo(2, 6);
    expect(e.statP[row * 8]).toBeCloseTo(0.3, 6);
    expect(e.statSkill[row * 8]).toBe(4);
    applyStatus(w, row, StatusIdx.Slow, 1, 0.1, 5, false); // shorter and weaker: no downgrade
    expect(e.statT[row * 8]).toBeCloseTo(2, 6);
    expect(e.statP[row * 8]).toBeCloseTo(0.3, 6);
    applyStatus(w, row, StatusIdx.Slow, 5, 0.6, 6, false);
    expect(e.statT[row * 8]).toBeCloseTo(5, 6);
    expect(e.statP[row * 8]).toBeCloseTo(0.6, 6);
  });

  it('a non-positive duration applies nothing; skill −1 is stored as 255', () => {
    const w = arena();
    const row = dummy(w);
    applyStatus(w, row, StatusIdx.Burn, 0, 5, -1, false);
    applyStatus(w, row, StatusIdx.Burn, -1, 5, -1, false);
    expect(w.enemies.status[row]).toBe(0);
    applyStatus(w, row, StatusIdx.Burn, 1, 5, -1, false);
    expect(w.enemies.statSkill[row * 8 + StatusIdx.Burn]).toBe(255);
  });

  it('statuses expire on schedule and clear their bit, timer and power', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 40, 0);
    applyStatus(w, row, StatusIdx.Slow, 1, 0.5, -1, false);
    applyStatus(w, row, StatusIdx.Weaken, 2, 0.4, -1, false);
    runTicks(w, 30);
    const e = w.enemies;
    expect((e.status[row] as number) & StatusBit.Slow).toBeTruthy();
    runTicks(w, 35);
    expect((e.status[row] as number) & StatusBit.Slow).toBe(0);
    expect(e.statT[row * 8 + StatusIdx.Slow]).toBe(0);
    expect(e.statP[row * 8 + StatusIdx.Slow]).toBe(0);
    expect((e.status[row] as number) & StatusBit.Weaken).toBeTruthy();
    runTicks(w, 60);
    expect(e.status[row]).toBe(0);
  });

  it('slow multiplies move speed by (1 − power), capped at −80%', () => {
    const w = arena();
    const slow = dummy(w, 'wolf', 30, 0);
    const crawl = dummy(w, 'wolf', -30, 0);
    const free = dummy(w, 'wolf', 0, 30);
    applyStatus(w, slow, StatusIdx.Slow, 10, 0.5, -1, false);
    applyStatus(w, crawl, StatusIdx.Slow, 10, 0.95, -1, false);
    const e = w.enemies;
    runTicks(w, 2);
    expect(e.speed[slow]! / e.baseSpeed[slow]!).toBeCloseTo(0.5, 4);
    expect(e.speed[crawl]! / e.baseSpeed[crawl]!).toBeCloseTo(0.2, 4);
    expect(e.speed[free]! / e.baseSpeed[free]!).toBeCloseTo(1, 4);
  });

  it('a slowed enemy actually travels proportionally less distance', () => {
    const w = arena();
    const slow = dummy(w, 'wolf', 30, 0);
    const free = dummy(w, 'wolf', -30, 0);
    applyStatus(w, slow, StatusIdx.Slow, 10, 0.5, -1, false);
    const e = w.enemies;
    const baseSlow = e.baseSpeed[slow] as number;
    const baseFree = e.baseSpeed[free] as number;
    runTicks(w, 60);
    const movedSlow = 30 - (e.x[slow] as number);
    const movedFree = (e.x[free] as number) + 30;
    expect(movedSlow).toBeCloseTo(baseSlow * 0.5, 1);
    expect(movedFree).toBeCloseTo(baseFree, 1);
  });

  it('stun and freeze stop movement entirely (state Stunned), then movement resumes', () => {
    const w = arena();
    const stun = dummy(w, 'wolf', 20, 0);
    const freeze = dummy(w, 'wolf', -20, 0);
    applyStatus(w, stun, StatusIdx.Stun, 1, 1, -1, false);
    applyStatus(w, freeze, StatusIdx.Freeze, 1, 0, -1, false);
    const e = w.enemies;
    runTicks(w, 2);
    expect(e.state[stun]).toBe(EnemyState.Stunned);
    expect(e.state[freeze]).toBe(EnemyState.Stunned);
    const sx = e.x[stun] as number;
    const fx = e.x[freeze] as number;
    runTicks(w, 40);
    expect(e.x[stun]).toBe(sx);
    expect(e.x[freeze]).toBe(fx);
    runTicks(w, 40); // statuses expired after 1 s
    expect(e.state[stun]).not.toBe(EnemyState.Stunned);
    runTicks(w, 30);
    expect(Math.abs(e.x[stun] as number)).toBeLessThan(sx);
    expect(Math.abs(e.x[freeze] as number)).toBeLessThan(Math.abs(fx));
  });

  it('a stunned enemy next to the hero does not attack until the stun ends', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 0, 1.1);
    w.enemies.hp[row] = 1e4;
    applyStatus(w, row, StatusIdx.Stun, 2, 1, -1, false);
    const early = collect(w, 110, ['playerHit']);
    expect(early).toHaveLength(0);
    const late = collect(w, 240, ['playerHit']);
    expect(late.length).toBeGreaterThan(0);
  });

  it('stunning an enemy in mid wind-up cancels the attack', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 0, 1.1);
    const e = w.enemies;
    e.hp[row] = 1e4;
    let windup = false;
    for (let i = 0; i < 200 && !windup; i++) {
      w.step([NO_INPUT]);
      if (e.state[row] === EnemyState.Windup) windup = true;
      expect(w.events.some((ev) => ev.t === 'playerHit')).toBe(false);
    }
    expect(windup).toBe(true);
    applyStatus(w, row, StatusIdx.Stun, 1, 1, -1, false);
    const hits = collect(w, 40, ['playerHit']);
    expect(hits).toHaveLength(0);
    expect(e.state[row]).toBe(EnemyState.Stunned);
  });

  it('fear is recorded like the other statuses (duration, expiry)', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 40, 0);
    applyStatus(w, row, StatusIdx.Fear, 0.5, 0, -1, false);
    expect((w.enemies.status[row] as number) & StatusBit.Fear).toBeTruthy();
    expect(w.enemies.statT[row * 8 + StatusIdx.Fear]).toBeCloseTo(0.5, 6);
    runTicks(w, 40);
    expect((w.enemies.status[row] as number) & StatusBit.Fear).toBe(0);
  });

  it('bosses cut stun / freeze / fear durations to 25%; other statuses are unaffected', () => {
    const w = arena();
    const row = dummy(w, 'bear', 40, 0);
    const e = w.enemies;
    w.enemies.eliteTier[row] = 3;
    const cases: [number, number][] = [
      [StatusIdx.Stun, 0.25],
      [StatusIdx.Freeze, 0.25],
      [StatusIdx.Fear, 0.25],
      [StatusIdx.Slow, 1],
      [StatusIdx.Poison, 1],
      [StatusIdx.Burn, 1],
      [StatusIdx.Bleed, 1],
      [StatusIdx.Weaken, 1],
    ];
    for (const [kind] of cases) applyStatus(w, row, kind, 4, 0.5, -1, true);
    for (const [kind, factor] of cases) expect(e.statT[row * 8 + kind]).toBeCloseTo(4 * factor, 5);
    // a regular enemy keeps the full duration
    const normal = dummy(w, 'bear', -40, 0);
    applyStatus(w, normal, StatusIdx.Stun, 4, 1, -1, false);
    expect(e.statT[normal * 8 + StatusIdx.Stun]).toBeCloseTo(4, 6);
  });

  it('skill statuses roll once per hit by chance; DoT power is a fraction of the hit damage', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 40, 0, 1e5);
    const e = w.enemies;
    hitEnemy(w, row, 20, ctx({ statusKind: StatusIdx.Burn, statusChance: 1, statusPower: 0.5, statusDuration: 2 }));
    expect(e.statT[row * 8 + StatusIdx.Burn]).toBeCloseTo(2, 5);
    expect(e.statP[row * 8 + StatusIdx.Burn]).toBeCloseTo(10, 4); // 0.5 × 20 dmg per second
    hitEnemy(w, row, 20, ctx({ statusKind: StatusIdx.Slow, statusChance: 1, statusPower: 0.3, statusDuration: 2 }));
    expect(e.statP[row * 8 + StatusIdx.Slow]).toBeCloseTo(0.3, 5); // slow power is a plain fraction
    e.status[row] = 0;
    e.statT.fill(0, row * 8, row * 8 + 8);
    e.statP.fill(0, row * 8, row * 8 + 8);
    hitEnemy(w, row, 20, ctx({ statusKind: StatusIdx.Burn, statusChance: 0, statusPower: 0.5, statusDuration: 2 }));
    expect(e.status[row]).toBe(0);
  });

  it('status chance 0.5 applies on about half of the hits', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 40, 0, 1e5);
    const e = w.enemies;
    let applied = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      e.status[row] = 0;
      hitEnemy(w, row, 1, ctx({ statusKind: StatusIdx.Slow, statusChance: 0.5, statusPower: 0.3, statusDuration: 1 }));
      if (((e.status[row] as number) & StatusBit.Slow) !== 0) applied++;
    }
    expect(Math.abs(applied - n / 2)).toBeLessThan(5 * Math.sqrt(n * 0.25));
  });

  it('a killing blow does not apply a status', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 40, 0);
    hitEnemy(w, row, 500, ctx({ statusKind: StatusIdx.Burn, statusChance: 1, statusPower: 1, statusDuration: 3 }));
    expect(w.enemies.statT[row * 8 + StatusIdx.Burn]).toBe(0);
  });
});

describe('damage over time (poison / burn / bleed)', () => {
  it('ticks every 0.5 s for dps × 0.5 and flags the damage events as dot', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 40, 0, 1e5);
    applyStatus(w, row, StatusIdx.Poison, 3, 10, -1, false);
    const dots = collect(w, 200, ['damage']).filter((e) => e.dot);
    expect(dots.length).toBeGreaterThanOrEqual(5);
    expect(dots.length).toBeLessThanOrEqual(6);
    for (const d of dots) {
      expect(d.amount).toBeGreaterThanOrEqual(5);
      expect(d.amount).toBeLessThan(5.2);
      expect(d.element).toBe(ElementIdx.Poison);
      expect(d.crit).toBe(false);
      expect(d.killed).toBe(false);
    }
    const total = dots.reduce((a, d) => a + d.amount, 0);
    expect(total).toBeGreaterThan(10 * 3 - 5.5);
    expect(total).toBeLessThan(10 * 3 + 0.5);
    expect(w.enemies.hp[row]).toBeCloseTo(1e5 - total, -1);
    expect(w.tally.damageDealt).toBeCloseTo(total, 3);
  });

  it('element follows the status: burn = fire, bleed = physical', () => {
    const w = arena();
    const burn = dummy(w, 'wolf', 40, 0, 1e5);
    const bleed = dummy(w, 'wolf', -40, 0, 1e5);
    applyStatus(w, burn, StatusIdx.Burn, 2, 6, -1, false);
    applyStatus(w, bleed, StatusIdx.Bleed, 2, 6, -1, false);
    const dots = collect(w, 40, ['damage']).filter((e) => e.dot);
    const byTarget = new Map<number, number>();
    for (const d of dots) byTarget.set(d.targetId, d.element);
    expect(byTarget.get(w.enemies.id[burn] as number)).toBe(ElementIdx.Fire);
    expect(byTarget.get(w.enemies.id[bleed] as number)).toBe(ElementIdx.Physical);
  });

  it('concurrent DoTs add their dps into one tick and use the strongest one for the element', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 40, 0, 1e5);
    applyStatus(w, row, StatusIdx.Poison, 3, 4, -1, false);
    applyStatus(w, row, StatusIdx.Burn, 3, 6, -1, false);
    const dots = collect(w, 40, ['damage']).filter((e) => e.dot);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.amount).toBeGreaterThanOrEqual(5);
    expect(dots[0]?.amount).toBeLessThan(5.2);
    expect(dots[0]?.element).toBe(ElementIdx.Fire);
  });

  it('enemy resist applies to DoT ticks (poison-resistant rat, fire-weak fox)', () => {
    const w = arena();
    const rat = dummy(w, 'plague_rat', 40, 0, 1e5);
    const fox = dummy(w, 'fox', -40, 0, 1e5);
    applyStatus(w, rat, StatusIdx.Poison, 2, 10, -1, false);
    applyStatus(w, fox, StatusIdx.Burn, 2, 10, -1, false);
    const dots = collect(w, 40, ['damage']).filter((e) => e.dot);
    const ratTick = dots.find((d) => d.targetId === (w.enemies.id[rat] as number));
    const foxTick = dots.find((d) => d.targetId === (w.enemies.id[fox] as number));
    expect(ratTick?.amount).toBeGreaterThanOrEqual(2.5);
    expect(ratTick?.amount).toBeLessThan(2.65);
    expect(foxTick?.amount).toBeGreaterThanOrEqual(6);
    expect(foxTick?.amount).toBeLessThan(6.25);
  });

  it('DoT damage is credited to the originating skill and the last hitter', () => {
    const w = arena();
    const skill = giveSkill(w, 'sword_arc');
    const row = dummy(w, 'wolf', 40, 0, 1e5);
    w.enemies.lastHitter[row] = 0;
    applyStatus(w, row, StatusIdx.Bleed, 2, 8, skill.slot, false);
    const dots = collect(w, 90, ['damage']).filter((e) => e.dot);
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) {
      expect(d.skill).toBe(skill.slot);
      expect(d.player).toBe(0);
    }
    expect(skill.damage).toBeCloseTo(
      dots.reduce((a, d) => a + d.amount, 0),
      3,
    );
  });

  it('a DoT that kills credits the last hitter with the kill', () => {
    const w = arena();
    const row = spawn(w, 'wolf', 40, 0);
    w.enemies.hp[row] = 4;
    w.enemies.lastHitter[row] = 0;
    applyStatus(w, row, StatusIdx.Burn, 3, 10, -1, false);
    const events = collect(w, 60, ['damage', 'enemyDeath']);
    const killing = events.find((e) => e.t === 'damage' && e.killed);
    expect(killing).toBeDefined();
    expect(events.some((e) => e.t === 'enemyDeath')).toBe(true);
    expect(player(w).kills).toBe(1);
  });

  it('DoT stops when the status expires', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 40, 0, 1e5);
    applyStatus(w, row, StatusIdx.Poison, 1, 10, -1, false);
    const ticks = collect(w, 70, ['damage']).filter((e) => e.dot).length;
    expect(ticks).toBeGreaterThanOrEqual(1);
    expect(ticks).toBeLessThanOrEqual(2);
    const later = collect(w, 120, ['damage']).filter((e) => e.dot).length;
    expect(later).toBe(0);
  });
});

describe('knockback', () => {
  it('sets a velocity of impulse / mass × KNOCK_DECAY away from the source', () => {
    const w = arena();
    const wolf = dummy(w, 'wolf', 5, 0); // mass 1
    knockEnemy(w, wolf, 2, 0, 0, false);
    expect(w.enemies.kvx[wolf]).toBeCloseTo(2 * KNOCK_DECAY, 4);
    expect(w.enemies.kvz[wolf]).toBeCloseTo(0, 6);
    const jackal = dummy(w, 'jackal', 0, -4); // mass 0.6, pushed along −z
    knockEnemy(w, jackal, 2, 0, 0, false);
    expect(w.enemies.kvz[jackal]).toBeCloseTo(-(2 / 0.6) * KNOCK_DECAY, 3);
  });

  it('scales with 1/mass: heavier enemies fly less far', () => {
    const w = arena();
    const light = dummy(w, 'wolf', 5, 20); // mass 1
    const heavy = dummy(w, 'bear', 5, -20); // mass 3
    const elder = dummy(w, 'elder_bear', 5, 40); // mass 6
    knockEnemy(w, light, 3, -5, 20, false);
    knockEnemy(w, heavy, 3, -5, -20, false);
    knockEnemy(w, elder, 3, -5, 40, false);
    const e = w.enemies;
    expect((e.kvx[light] as number) / (e.kvx[heavy] as number)).toBeCloseTo(3, 4);
    expect((e.kvx[light] as number) / (e.kvx[elder] as number)).toBeCloseTo(6, 4);
  });

  it('the travelled distance is about impulse / mass meters', () => {
    const w = arena();
    const light = dummy(w, 'wolf', 5, 20);
    const heavy = dummy(w, 'bear', 5, -20);
    const e = w.enemies;
    applyStatus(w, light, StatusIdx.Stun, 20, 1, -1, false); // keep the AI from walking
    applyStatus(w, heavy, StatusIdx.Stun, 20, 1, -1, false);
    const x0 = e.x[light] as number;
    const h0 = e.x[heavy] as number;
    knockEnemy(w, light, 4, -5, 20, false);
    knockEnemy(w, heavy, 4, -5, -20, false);
    runTicks(w, 120);
    const dLight = (e.x[light] as number) - x0;
    const dHeavy = (e.x[heavy] as number) - h0;
    expect(dLight).toBeGreaterThan(4 * 0.95);
    expect(dLight).toBeLessThan(4 * 1.15);
    expect(dLight / dHeavy).toBeGreaterThan(2.8);
    expect(dLight / dHeavy).toBeLessThan(3.2);
  });

  it('mass is floored at 0.3', () => {
    const w = arena({
      content: (c) => {
        const jackal = c.enemies.find((e) => e.id === 'jackal');
        if (jackal) jackal.mass = 0.05;
      },
    });
    const row = dummy(w, 'jackal', 5, 0);
    knockEnemy(w, row, 1, 0, 0, false);
    expect(w.enemies.kvx[row]).toBeCloseTo((1 / 0.3) * KNOCK_DECAY, 3);
  });

  it('bosses take only 12% of the knockback', () => {
    const w = arena();
    const normal = dummy(w, 'bear', 5, 20);
    const king = dummy(w, 'bear', 5, -20);
    w.enemies.eliteTier[king] = 3;
    knockEnemy(w, normal, 3, -5, 20, false);
    knockEnemy(w, king, 3, -5, -20, true);
    const e = w.enemies;
    expect(e.kvx[normal]).toBeCloseTo((3 / 3) * KNOCK_DECAY, 4);
    expect(e.kvx[king]).toBeCloseTo((3 / 3) * 0.12 * KNOCK_DECAY, 4);
  });

  it('charging / leaping enemies resist it (×0.3)', () => {
    const w = arena();
    const walking = dummy(w, 'wolf', 5, 20);
    const dashing = dummy(w, 'wolf', 5, -20);
    const leaping = dummy(w, 'wolf', 5, 40);
    w.enemies.state[dashing] = EnemyState.Dash;
    w.enemies.state[leaping] = EnemyState.Leap;
    for (const [row, z] of [[walking, 20], [dashing, -20], [leaping, 40]] as const) knockEnemy(w, row, 2, -5, z, false);
    const e = w.enemies;
    expect(e.kvx[dashing]).toBeCloseTo((e.kvx[walking] as number) * 0.3, 4);
    expect(e.kvx[leaping]).toBeCloseTo((e.kvx[walking] as number) * 0.3, 4);
  });

  it('impulses add as vectors and the speed is capped at 42 m/s', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 5, 5);
    knockEnemy(w, row, 2, -5, 5, false);
    knockEnemy(w, row, 1, -5, 5, false);
    expect(w.enemies.kvx[row]).toBeCloseTo(3 * KNOCK_DECAY, 3);
    knockEnemy(w, row, 1, 15, 5, false); // opposite direction partially cancels
    expect(w.enemies.kvx[row]).toBeCloseTo(2 * KNOCK_DECAY, 3);

    const big = dummy(w, 'wolf', 3, 4);
    knockEnemy(w, big, 50, 0, 0, false); // direction (0.6, 0.8)
    const e = w.enemies;
    expect(Math.hypot(e.kvx[big] as number, e.kvz[big] as number)).toBeCloseTo(42, 3);
    expect(e.kvx[big]).toBeCloseTo(42 * 0.6, 3);
    expect(e.kvz[big]).toBeCloseTo(42 * 0.8, 3);
  });

  it('pushes along +z when the source sits exactly on the enemy', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 5, 5);
    knockEnemy(w, row, 1, 5, 5, false);
    expect(w.enemies.kvx[row]).toBeCloseTo(0, 6);
    expect(w.enemies.kvz[row]).toBeCloseTo(KNOCK_DECAY, 4);
  });

  it('hits apply ctx.knock (not on a killing blow, and 12% on bosses)', () => {
    const w = arena();
    const row = dummy(w, 'wolf', 5, 0);
    const king = dummy(w, 'bear', 5, 20);
    w.enemies.eliteTier[king] = 3;
    hitEnemy(w, row, 5, ctx({ knock: 2, sx: 0, sz: 0 }));
    hitEnemy(w, king, 5, ctx({ knock: 3, sx: 0, sz: 20 }));
    expect(w.enemies.kvx[row]).toBeCloseTo(2 * KNOCK_DECAY, 4);
    expect(w.enemies.kvx[king]).toBeCloseTo((3 / 3) * 0.12 * KNOCK_DECAY, 4);
    const dead = spawn(w, 'wolf', 8, 0);
    hitEnemy(w, dead, 500, ctx({ knock: 2, sx: 0, sz: 0 }));
    expect(w.enemies.kvx[dead]).toBe(0);
  });

  it('pushPlayer adds impulse × KNOCK_DECAY away from the point (+z when on top of it)', () => {
    const w = arena();
    const p = player(w);
    p.x = 4;
    p.z = 0;
    pushPlayer(p, 0, 0, 2);
    expect(p.kvx).toBeCloseTo(2 * KNOCK_DECAY, 4);
    expect(p.kvz).toBeCloseTo(0, 6);
    p.kvx = 0;
    p.kvz = 0;
    pushPlayer(p, 4, 0, 1);
    expect(p.kvz).toBeCloseTo(KNOCK_DECAY, 4);
  });
});

describe('hurtPlayer: damage mitigation', () => {
  function hurtOnce(armor: number, amount: number, element = ElementIdx.Physical, resist = 0): { taken: number; ok: boolean; w: World } {
    const w = arena();
    const p = player(w);
    p.stats.armor = armor;
    p.stats.resist[element] = resist;
    p.hp = p.hpMax = 1000;
    const ok = hurtPlayer(w, 0, amount, SRC_FAR, 0, element, HurtKind.Melee);
    return { taken: 1000 - p.hp, ok, w };
  }

  it('armor reduces damage by armor / (armor + K), K = 100 in the fixture balance', () => {
    const cases: [armor: number, amount: number, taken: number][] = [
      [0, 20, 20],
      [100, 20, 10], // 50%
      [8, 6, 6 * (100 / 108)], // the warrior's base armor against a wolf bite
      [25, 50, 40], // 20%
      [50, 30, 20], // 33.3%
      [300, 40, 10], // 75%
      [900, 100, 10], // 90%
    ];
    for (const [armor, amount, taken] of cases) {
      const r = hurtOnce(armor, amount);
      expect(r.ok).toBe(true);
      expect(r.taken).toBeCloseTo(taken, 4);
    }
  });

  it('K comes from the balance config', () => {
    const w = arena({ content: (c) => (c.balance.armorK = 50) });
    const p = player(w);
    p.stats.armor = 50;
    p.hp = p.hpMax = 1000;
    hurtPlayer(w, 0, 40, SRC_FAR, 0, ElementIdx.Physical, HurtKind.Melee);
    expect(1000 - p.hp).toBeCloseTo(20, 4);
  });

  it('a hit always deals at least 1', () => {
    expect(hurtOnce(0, 0.4).taken).toBeCloseTo(1, 6);
    expect(hurtOnce(200, 1.5).taken).toBeCloseTo(1, 6); // 0.5 after armor
    expect(hurtOnce(0, 0).taken).toBeCloseTo(1, 6);
  });

  it('elemental resist multiplies on top of armor; negative resist amplifies', () => {
    expect(hurtOnce(0, 40, ElementIdx.Fire, 0.5).taken).toBeCloseTo(20, 4);
    expect(hurtOnce(100, 40, ElementIdx.Fire, 0.5).taken).toBeCloseTo(10, 4);
    expect(hurtOnce(0, 40, ElementIdx.Ice, -0.5).taken).toBeCloseTo(60, 4);
  });

  it('only the hit element is resisted', () => {
    const w = arena();
    const p = player(w);
    p.stats.armor = 0;
    p.stats.resist[ElementIdx.Fire] = 0.75;
    p.hp = p.hpMax = 1000;
    hurtPlayer(w, 0, 40, SRC_FAR, 0, ElementIdx.Physical, HurtKind.Melee);
    expect(1000 - p.hp).toBeCloseTo(40, 4);
    p.iframes = 0;
    hurtPlayer(w, 0, 40, SRC_FAR, 0, ElementIdx.Fire, HurtKind.Melee);
    expect(1000 - p.hp).toBeCloseTo(50, 4);
  });

  it('bookkeeping: hp, flash, sinceHit, damageTaken, tally and the playerHit event', () => {
    const w = arena();
    const p = player(w);
    p.stats.armor = 0;
    p.hp = p.hpMax = 200;
    p.sinceHit = 50;
    p.x = 1;
    p.z = 2;
    expect(hurtPlayer(w, 0, 30, 7, 9, ElementIdx.Dark, HurtKind.Projectile)).toBe(true);
    expect(p.hp).toBeCloseTo(170, 4);
    expect(p.flash).toBe(1);
    expect(p.sinceHit).toBe(0);
    expect(p.damageTaken).toBeCloseTo(30, 4);
    expect(w.tally.damageTaken).toBeCloseTo(30, 4);
    expect(evs(w, 'playerHit')).toHaveLength(1);
    expect(evs(w, 'playerHit')[0]).toMatchObject({ player: 0, result: 0, x: 1, z: 2, srcX: 7, srcZ: 9, element: ElementIdx.Dark });
    expect(evs(w, 'playerHit')[0]?.amount).toBeCloseTo(30, 4);
    expect(evs(w, 'playerHit')[0]?.hp).toBeCloseTo(170, 4);
  });

  it('a dead hero cannot be hurt; an unknown player index is ignored', () => {
    const w = arena();
    const p = player(w);
    p.alive = false;
    expect(hurtPlayer(w, 0, 50, 0, 0, 0, HurtKind.Melee)).toBe(false);
    expect(hurtPlayer(w, 3, 50, 0, 0, 0, HurtKind.Melee)).toBe(false);
    expect(w.events).toHaveLength(0);
  });
});

describe('hurtPlayer: i-frames', () => {
  it('a hit grants 0.55 s of invulnerability (melee and projectile)', () => {
    for (const kind of [HurtKind.Melee, HurtKind.Projectile]) {
      const w = arena();
      const p = player(w);
      p.stats.armor = 0;
      p.hp = p.hpMax = 500;
      expect(hurtPlayer(w, 0, 10, SRC_FAR, 0, 0, kind)).toBe(true);
      expect(p.iframes).toBeCloseTo(PLAYER_IFRAMES, 6);
      expect(PLAYER_IFRAMES).toBeCloseTo(0.55, 6);
      expect(hurtPlayer(w, 0, 10, SRC_FAR, 0, 0, kind)).toBe(false);
      expect(p.hp).toBeCloseTo(490, 4);
      expect(evs(w, 'playerHit')).toHaveLength(1);
      runTicks(w, 32); // 0.533 s: still protected
      expect(hurtPlayer(w, 0, 10, SRC_FAR, 0, 0, kind)).toBe(false);
      runTicks(w, 2); // 0.567 s: vulnerable again
      expect(hurtPlayer(w, 0, 10, SRC_FAR, 0, 0, kind)).toBe(true);
      expect(p.hp).toBeCloseTo(480, 3);
    }
  });

  it('hazard ticks grant only 0.25 s', () => {
    const w = arena();
    const p = player(w);
    p.stats.armor = 0;
    p.hp = p.hpMax = 500;
    expect(hurtPlayer(w, 0, 10, SRC_FAR, 0, 0, HurtKind.Hazard)).toBe(true);
    expect(p.iframes).toBeCloseTo(HAZARD_IFRAMES, 6);
    expect(HAZARD_IFRAMES).toBeCloseTo(0.25, 6);
    runTicks(w, 14);
    expect(hurtPlayer(w, 0, 10, SRC_FAR, 0, 0, HurtKind.Hazard)).toBe(false);
    runTicks(w, 2);
    expect(hurtPlayer(w, 0, 10, SRC_FAR, 0, 0, HurtKind.Hazard)).toBe(true);
  });

  it('manual i-frames (dash / leap / revive style) block everything', () => {
    const w = arena();
    const p = player(w);
    p.hp = p.hpMax = 500;
    p.iframes = 0.3;
    expect(hurtPlayer(w, 0, 400, SRC_FAR, 0, 0, HurtKind.Melee)).toBe(false);
    expect(p.hp).toBe(500);
    expect(w.events).toHaveLength(0);
  });
});

describe('hurtPlayer: evasion', () => {
  it('evasion 100% cancels the hit: no damage, 0.25 s i-frames, playerHit with result 1', () => {
    const w = arena();
    const p = player(w);
    p.stats.evasion = 1;
    p.hp = p.hpMax = 300;
    expect(hurtPlayer(w, 0, 99, 5, 6, ElementIdx.Fire, HurtKind.Melee)).toBe(false);
    expect(p.hp).toBe(300);
    expect(p.iframes).toBeCloseTo(0.25, 6);
    expect(p.damageTaken).toBe(0);
    expect(w.tally.damageTaken).toBe(0);
    expect(evs(w, 'playerHit')[0]).toMatchObject({ result: 1, amount: 0, srcX: 5, srcZ: 6 });
  });

  it('evasion 0 never rolls the combat rng', () => {
    const w = arena();
    const p = player(w);
    p.hp = p.hpMax = 100000;
    const before = w.rng.combat.getState();
    for (let i = 0; i < 100; i++) {
      p.iframes = 0;
      hurtPlayer(w, 0, 1, SRC_FAR, 0, 0, HurtKind.Melee);
    }
    expect(w.rng.combat.getState()).toEqual(before);
  });

  it('the dodge rate follows the evasion stat', () => {
    const w = arena();
    const p = player(w);
    p.stats.evasion = 0.3;
    p.stats.armor = 0;
    p.hp = p.hpMax = 1e9;
    const n = 3000;
    let dodged = 0;
    for (let i = 0; i < n; i++) {
      p.iframes = 0;
      w.bus.clear();
      if (!hurtPlayer(w, 0, 1, SRC_FAR, 0, 0, HurtKind.Melee)) dodged++;
    }
    expect(Math.abs(dodged - n * 0.3)).toBeLessThan(5 * Math.sqrt(n * 0.3 * 0.7));
  });
});

describe('hurtPlayer: shield', () => {
  it('absorbs damage first; a fully absorbed hit reports result 2 and leaves hp alone', () => {
    const w = arena();
    const p = player(w);
    p.stats.armor = 0;
    p.hp = p.hpMax = 100;
    p.shield = 30;
    expect(hurtPlayer(w, 0, 20, SRC_FAR, 0, 0, HurtKind.Melee)).toBe(true);
    expect(p.shield).toBeCloseTo(10, 5);
    expect(p.hp).toBe(100);
    expect(p.shieldCd).toBe(4);
    expect(p.iframes).toBeCloseTo(PLAYER_IFRAMES, 6);
    expect(evs(w, 'playerHit')[0]).toMatchObject({ result: 2, amount: 0 });
    expect(p.damageTaken).toBe(0);
  });

  it('overflow goes to hp; the event and counters carry only the hp damage', () => {
    const w = arena();
    const p = player(w);
    p.stats.armor = 0;
    p.hp = p.hpMax = 100;
    p.shield = 10;
    hurtPlayer(w, 0, 50, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(p.shield).toBe(0);
    expect(p.hp).toBeCloseTo(60, 4);
    expect(evs(w, 'playerHit')[0]).toMatchObject({ result: 0 });
    expect(evs(w, 'playerHit')[0]?.amount).toBeCloseTo(40, 4);
    expect(p.damageTaken).toBeCloseTo(40, 4);
    expect(w.tally.damageTaken).toBeCloseTo(40, 4);
  });

  it('armor is applied before the shield', () => {
    const w = arena();
    const p = player(w);
    p.stats.armor = 100;
    p.hp = p.hpMax = 100;
    p.shield = 10;
    hurtPlayer(w, 0, 40, SRC_FAR, 0, 0, HurtKind.Melee); // 20 after armor → 10 shield + 10 hp
    expect(p.shield).toBe(0);
    expect(p.hp).toBeCloseTo(90, 4);
  });

  it('shield only exists with a shield trinket: it is dropped without one and regenerates after the 4 s delay', () => {
    const w = arena();
    const p = player(w);
    p.shield = 15;
    runTicks(w, 1);
    expect(p.shield).toBe(0); // no shieldMax → no shield

    p.trinkets[2] = { id: 'shield', rank: 2 }; // 24 max, 1.6 / s
    p.statsDirty = true;
    p.stats.armor = 0;
    runTicks(w, 60);
    expect(p.stats.shieldMax).toBeCloseTo(24, 4);
    expect(p.shield).toBeGreaterThan(1.4);
    expect(p.shield).toBeLessThan(1.8);
    hurtPlayer(w, 0, 1, SRC_FAR, 0, 0, HurtKind.Melee); // min damage 1: absorbed
    const afterHit = p.shield;
    expect(p.shieldCd).toBe(4);
    runTicks(w, 120); // 2 s into the 4 s delay
    expect(p.shield).toBeCloseTo(afterHit, 6);
    runTicks(w, 150); // delay over (4.5 s after the hit)
    expect(p.shield).toBeGreaterThan(afterHit + 0.5);
    runTicks(w, 60 * 40);
    expect(p.shield).toBeCloseTo(24, 4); // capped at shieldMax
  });
});

describe('hurtPlayer: thorns', () => {
  function thornsHit(thorns: number, kind: number, withSource: boolean, amount = 20): { reflected: number; w: World; row: number } {
    const w = arena();
    const p = player(w);
    p.stats.armor = 0;
    p.stats.thorns = thorns;
    p.hp = p.hpMax = 500;
    const row = dummy(w, 'wolf', 1, 0, 1000);
    const handle = withSource ? (w.enemies.id[row] as number) : 0;
    hurtPlayer(w, 0, amount, 1, 0, ElementIdx.Physical, kind, handle);
    return { reflected: 1000 - (w.enemies.hp[row] as number), w, row };
  }

  it('melee hits reflect damage proportional to the thorns stat onto the attacker', () => {
    const a = thornsHit(0.5, HurtKind.Melee, true);
    const b = thornsHit(1, HurtKind.Melee, true);
    expect(a.reflected).toBeGreaterThanOrEqual(0.5 * 20); // at least thorns × the damage taken
    expect(a.reflected).toBeLessThanOrEqual(0.5 * 20 * 1.5);
    expect(b.reflected / a.reflected).toBeCloseTo(2, 2);
    const ev = evs(a.w, 'damage');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ player: 0, skill: -1, crit: false });
  });

  it('no thorns stat → nothing reflected', () => {
    expect(thornsHit(0, HurtKind.Melee, true).reflected).toBe(0);
  });

  it('projectile and hazard hits are not reflected', () => {
    expect(thornsHit(1, HurtKind.Projectile, true).reflected).toBe(0);
    expect(thornsHit(1, HurtKind.Hazard, true).reflected).toBe(0);
  });

  it('needs a living source enemy', () => {
    expect(thornsHit(1, HurtKind.Melee, false).reflected).toBe(0);
    const w = arena();
    const p = player(w);
    p.stats.thorns = 1;
    p.hp = p.hpMax = 500;
    const row = dummy(w, 'wolf', 1, 0);
    const stale = w.enemies.id[row] as number;
    w.enemies.free(row);
    expect(() => hurtPlayer(w, 0, 20, 1, 0, 0, HurtKind.Melee, stale)).not.toThrow();
  });

  it('reflected damage can kill the attacker (kill credited to the hero)', () => {
    const w = arena();
    const p = player(w);
    p.stats.armor = 0;
    p.stats.thorns = 1;
    p.hp = p.hpMax = 500;
    const row = spawn(w, 'wolf', 1, 0);
    w.enemies.hp[row] = 3;
    hurtPlayer(w, 0, 20, 1, 0, 0, HurtKind.Melee, w.enemies.id[row] as number);
    expect(w.enemies.state[row]).toBe(EnemyState.Dying);
    expect(w.tally.kills).toBe(1);
    expect(p.kills).toBe(1);
  });
});

describe('lifesteal', () => {
  function readyHero(maxHp = 242): { w: World; row: number } {
    const w = arena();
    const p = player(w);
    p.stats.regen = 0;
    if (maxHp !== 242) {
      p.stats.maxHp = maxHp;
      p.hpMax = maxHp;
    }
    const row = dummy(w, 'wolf', 40, 0, 1e8);
    return { w, row };
  }

  it('heals dmg × lifesteal, limited by the per-second budget (5% of max hp), and emits a heal event', () => {
    const { w, row } = readyHero();
    const p = player(w);
    p.stats.lifesteal = 0.1;
    runTicks(w, 120); // fill the budget (cap = 5% of max hp = 12.1)
    expect(p.healBudget).toBeCloseTo(p.hpMax * 0.05, 4);
    w.bus.clear();
    p.hp = 100;
    hitEnemy(w, row, 100, ctx()); // wants 10, budget 12.1
    expect(p.hp).toBeCloseTo(110, 3);
    const heal = evs(w, 'heal');
    expect(heal).toHaveLength(1);
    expect(heal[0]).toMatchObject({ player: 0, source: HealSource.Lifesteal });
    expect(heal[0]?.amount).toBeCloseTo(10, 3);
    hitEnemy(w, row, 100, ctx()); // wants 10, only 2.1 left
    expect(p.hp).toBeCloseTo(112.1, 3);
    hitEnemy(w, row, 100, ctx()); // budget exhausted
    expect(p.hp).toBeCloseTo(112.1, 3);
  });

  it('no heal at full hp, and the budget is not consumed', () => {
    const { w, row } = readyHero();
    const p = player(w);
    p.stats.lifesteal = 0.5;
    runTicks(w, 120);
    const budget = p.healBudget;
    p.hp = p.hpMax;
    hitEnemy(w, row, 100, ctx());
    expect(p.healBudget).toBe(budget);
    expect(evs(w, 'heal')).toHaveLength(0);
  });

  it('is rate-limited over time: never more than 5% max hp per second no matter how hard we hit', () => {
    const { w, row } = readyHero();
    const p = player(w);
    p.stats.lifesteal = 0.1;
    p.hp = 1;
    const start = p.hp;
    const seconds = 5;
    for (let i = 0; i < seconds * 60; i++) {
      w.step([NO_INPUT]);
      hitEnemy(w, row, 1000, ctx()); // would heal 100 per hit
    }
    const healed = p.hp - start;
    const limit = p.hpMax * 0.05 * seconds;
    expect(healed).toBeLessThanOrEqual(limit + 1e-3);
    expect(healed).toBeGreaterThan(limit * 0.95);
  });

  it('a larger hp pool scales the budget', () => {
    const { w, row } = readyHero(2000);
    const p = player(w);
    p.stats.lifesteal = 0.1;
    runTicks(w, 120);
    p.hp = 100;
    hitEnemy(w, row, 600, ctx()); // wants 60, budget 100
    expect(p.hp).toBeCloseTo(160, 3);
  });

  it('the lifesteal cap (15%) applies through the stat pipeline', () => {
    const w = arena({ config: { meta: { stats: { lifesteal: 0.5, maxHp: 10000 } } } });
    const p = player(w);
    p.stats.regen = 0;
    p.stats.critChance = 0;
    expect(p.stats.lifesteal).toBeCloseTo(0.15, 6);
    const row = dummy(w, 'wolf', 40, 0, 1e5);
    runTicks(w, 120);
    p.hp = 100;
    hitEnemy(w, row, 100, ctx());
    expect(p.hp).toBeCloseTo(115, 3);
  });

  it('a dead hero is not healed', () => {
    const { w, row } = readyHero();
    const p = player(w);
    p.stats.lifesteal = 0.5;
    runTicks(w, 120);
    p.alive = false;
    p.hp = 0;
    hitEnemy(w, row, 100, ctx());
    expect(p.hp).toBe(0);
  });
});

describe('healPlayer', () => {
  it('caps at max hp, reports the gained amount with its source, and skips dead heroes', () => {
    const w = arena();
    const p = player(w);
    p.hp = p.hpMax - 10;
    healPlayer(w, p, 25, HealSource.Pickup);
    expect(p.hp).toBe(p.hpMax);
    expect(evs(w, 'heal')[0]).toMatchObject({ player: 0, source: HealSource.Pickup });
    expect(evs(w, 'heal')[0]?.amount).toBeCloseTo(10, 4);
    w.bus.clear();
    healPlayer(w, p, 25, HealSource.Pickup); // already full
    expect(w.events).toHaveLength(0);
    p.alive = false;
    p.hp = 0;
    healPlayer(w, p, 50, HealSource.Card);
    expect(p.hp).toBe(0);
  });

  it('ignores non-positive amounts and keeps regen heals silent', () => {
    const w = arena();
    const p = player(w);
    p.hp = 50;
    healPlayer(w, p, 0, HealSource.Card);
    healPlayer(w, p, -5, HealSource.Card);
    expect(p.hp).toBe(50);
    healPlayer(w, p, 10, HealSource.Regen);
    expect(p.hp).toBe(60);
    expect(w.events).toHaveLength(0);
  });
});

describe('player death and revive', () => {
  it('lethal damage without revives: hp 0, alive false, death clip, playerDeath event', () => {
    const w = arena();
    const p = player(w);
    p.x = 3;
    p.z = -2;
    p.vx = 4;
    p.hp = p.hpMax = 100;
    expect(hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee)).toBe(true);
    expect(p.hp).toBe(0);
    expect(p.alive).toBe(false);
    expect(p.dead).toBe(true);
    expect(p.clip).toBe('death');
    expect(p.vx).toBe(0);
    expect(evs(w, 'playerDeath')).toHaveLength(1);
    expect(evs(w, 'playerDeath')[0]).toMatchObject({ player: 0, x: 3, z: -2 });
    expect(evs(w, 'playerRevive')).toHaveLength(0);
    const hit = evs(w, 'playerHit')[0];
    expect(hit?.hp).toBe(0);
  });

  it('a revive consumes one charge, restores 50% hp, grants 3 s of i-frames and emits playerRevive', () => {
    const w = arena();
    const p = player(w);
    p.stats.revives = 1;
    p.hp = p.hpMax;
    hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(p.alive).toBe(true);
    expect(p.revivesUsed).toBe(1);
    expect(p.hp).toBeCloseTo(p.hpMax * 0.5, 4);
    expect(p.iframes).toBe(3);
    expect(evs(w, 'playerDeath')).toHaveLength(0);
    expect(evs(w, 'playerRevive')).toHaveLength(1);
    expect(evs(w, 'playerRevive')[0]).toMatchObject({ player: 0, left: 0 });
  });

  it('i-frames after a revive protect for 3 s, then the next lethal hit is final', () => {
    const w = arena();
    const p = player(w);
    p.stats.revives = 1;
    hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(p.alive).toBe(true);
    runTicks(w, 170); // 2.83 s
    expect(hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee)).toBe(false);
    expect(p.alive).toBe(true);
    runTicks(w, 14); // 3.07 s
    w.bus.clear();
    expect(hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee)).toBe(true);
    expect(p.alive).toBe(false);
    expect(evs(w, 'playerDeath')).toHaveLength(1);
    expect(p.revivesUsed).toBe(1);
  });

  it('two revives are spent one at a time and report the charges left', () => {
    const w = arena();
    const p = player(w);
    p.stats.revives = 2;
    hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(evs(w, 'playerRevive')[0]?.left).toBe(1);
    p.iframes = 0;
    w.bus.clear();
    hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(evs(w, 'playerRevive')[0]?.left).toBe(0);
    expect(p.revivesUsed).toBe(2);
    expect(p.alive).toBe(true);
    p.iframes = 0;
    w.bus.clear();
    hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(p.alive).toBe(false);
    expect(evs(w, 'playerDeath')).toHaveLength(1);
  });

  it('the revive shockwave shoves nearby enemies away without hurting them', () => {
    const w = arena();
    const p = player(w);
    p.stats.revives = 1;
    const near = dummy(w, 'wolf', 3, 0);
    const far = dummy(w, 'wolf', 20, 0);
    w.hash.rebuild(w.enemies);
    hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(w.enemies.kvx[near]).toBeGreaterThan(10);
    expect(w.enemies.kvx[far]).toBe(0);
    expect(w.enemies.hp[near]).toBe(1000);
  });

  it('revives from the stat pipeline (meta) are honoured', () => {
    const w = arena({ config: { meta: { stats: { revives: 1 } } } });
    const p = player(w);
    expect(p.stats.revives).toBe(1);
    hurtPlayer(w, 0, 1e6, SRC_FAR, 0, 0, HurtKind.Melee);
    expect(p.alive).toBe(true);
  });
});

describe('enemy attacks on the hero (integration)', () => {
  it('a wolf bite = def.damage × armor reduction (warrior base armor 8 → ×100/108)', () => {
    const w = arena();
    spawn(w, 'wolf', 0, 1.0);
    const hits = collect(w, 240, ['playerHit']);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.amount).toBeCloseTo(6 * (100 / 108), 3);
    expect(hits[0]?.result).toBe(0);
    expect(hits[0]?.element).toBe(ElementIdx.Physical);
    expect(hits[0]?.srcZ).toBeCloseTo(1.0, 1);
    const p = player(w);
    expect(p.hp).toBeLessThan(p.hpMax);
  });

  it('the attack multiplier of the attack entry applies (alpha wolf bite ×1.2)', () => {
    const w = arena();
    spawn(w, 'alpha_wolf', 0, 1.3);
    const hits = collect(w, 240, ['playerHit']);
    expect(hits[0]?.amount).toBeCloseTo(12 * 1.2 * (100 / 108), 3);
  });

  it('enemy damage grows with run time (enemyDamagePerMin) and hard difficulty', () => {
    const timed = arena();
    timed.time = 120; // 2 minutes: 1 + 0.09 × 2
    spawn(timed, 'wolf', 0, 1.0);
    const t = collect(timed, 240, ['playerHit']);
    expect(t[0]?.amount).toBeCloseTo(6 * 1.18 * (100 / 108), 3);

    const hard = arena({ config: { difficulty: 'hard' } });
    spawn(hard, 'wolf', 0, 1.0);
    const h = collect(hard, 240, ['playerHit']);
    expect(h[0]?.amount).toBeCloseTo(6 * 1.4 * (100 / 108), 3);
  });

  it('enemy hp scales with run time and difficulty at spawn', () => {
    const timed = arena();
    timed.time = 120;
    const a = spawn(timed, 'wolf', 30, 0);
    expect(timed.enemies.hp[a]).toBeCloseTo(20 * (1 + 0.16 * 2), 3);
    const hard = arena({ config: { difficulty: 'hard' } });
    const b = spawn(hard, 'wolf', 30, 0);
    expect(hard.enemies.hp[b]).toBeCloseTo(20 * 1.6, 3);
  });

  it('thorns reflect enemy bites back at the biter', () => {
    const w = arena();
    const p = player(w);
    p.stats.thorns = 1;
    const row = spawn(w, 'wolf', 0, 1.0);
    w.enemies.hp[row] = 1000;
    w.enemies.hpMax[row] = 1000;
    collect(w, 240, ['playerHit']);
    expect(w.enemies.hp[row]).toBeLessThan(1000);
  });

  it('hits are spaced by the hero i-frames: never two playerHit events closer than 0.55 s', () => {
    const w = arena();
    spawn(w, 'jackal', 0, 0.9); // 0.9 s attack cooldown
    spawn(w, 'jackal', 0.4, 0.9);
    spawn(w, 'wolf', -0.4, 1.0);
    const p = player(w);
    p.hp = p.hpMax = 1e6;
    p.stats.regen = 0;
    const times: number[] = [];
    for (let i = 0; i < 600; i++) {
      w.step([NO_INPUT]);
      if (w.events.some((e) => e.t === 'playerHit')) times.push(w.time);
    }
    expect(times.length).toBeGreaterThan(3);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThan(0.54);
  });
});

describe('skill hits end to end (stats.damage × crit × race on a real swing)', () => {
  /** hero with sword_arc facing a frozen wolf 1.5 m ahead; returns the first non-DoT skill damage event */
  function swing(prepare: (w: World) => void): { amount: number; crit: boolean; skill: number; arcSlot: number } {
    const w = arena();
    const arc = giveSkill(w, 'sword_arc');
    const row = spawn(w, 'wolf', 0, 1.5);
    w.enemies.hp[row] = 1e5;
    w.enemies.hpMax[row] = 1e5;
    freezeEnemies(w);
    prepare(w);
    const hits = collect(w, 90, ['damage']);
    const first = hits.find((h) => h.skill === arc.slot && !h.dot);
    if (!first) throw new Error('the sword arc never hit the wolf');
    return { amount: first.amount, crit: first.crit, skill: first.skill, arcSlot: arc.slot };
  }

  it('a plain swing deals the skill base damage (14)', () => {
    const r = swing(() => undefined);
    expect(r.amount).toBeCloseTo(14, 4);
    expect(r.crit).toBe(false);
    expect(r.skill).toBe(r.arcSlot);
  });

  it('stats.damage multiplies the skill damage', () => {
    const r = swing((w) => {
      player(w).stats.damage = 1.5;
    });
    expect(r.amount).toBeCloseTo(21, 4);
  });

  it('a forced crit multiplies by critMul on top of stats.damage', () => {
    const r = swing((w) => {
      const p = player(w);
      p.stats.damage = 1.5;
      p.stats.critChance = 1;
      p.stats.critMul = 2;
    });
    expect(r.amount).toBeCloseTo(42, 4);
    expect(r.crit).toBe(true);
  });

  it('race bonus stacks with stats.damage and crit (animal +50%)', () => {
    const r = swing((w) => {
      addFixed(w, { vsRace: { animal: 0.5 } });
      const p = player(w);
      p.stats.damage = 1.5;
      p.stats.critChance = 1;
      p.stats.critMul = 2;
    });
    expect(r.amount).toBeCloseTo(14 * 1.5 * 2 * 1.5, 3);
  });
});
