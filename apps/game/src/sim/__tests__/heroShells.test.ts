// Skill-logic M2 (DESIGN §4): hero shells inside hurtPlayer - ward (absorb order, end burst scaled by what it absorbed, cap 2x), thorns
// through ward and shield, lifesteal drain, steady, dodge charges, the veil (+ decoy), the War Oath save and the death clear.
// Lab world: one fixture selfBuff (will_to_live) patched into the shell under test, hero 0 alone on a quiet field.

import { describe, expect, it } from 'vitest';
import type { SkillDef, SkillParams, StatusKind } from '../../data/schema';
import { hitEnemy, hurtPlayer, HurtKind, newHitCtx, pushPlayer } from '../combat';
import { ElementIdx, EnemyState, ProjKind, StatusBit, UPGRADE_STATS, type PlayerState, type SkillInstance } from '../stores';
import { castNow } from '../skills';
import { spawnProjectile } from '../skills/common';
import type { CoopPlayerInit } from '../run';
import { resolveParams, wardAmount } from '../skills/params';
import type { World } from '../world';
import { clearEnemies, dropSkills, freezeEnemies, freezeSchedules, giveSkill, makeWorld, player, runTicks, spawn } from './helpers';

interface Lab {
  w: World;
  p: PlayerState;
  s: SkillInstance;
}

/** will_to_live turned into a shell skill: `params` merged over a zero-heal base, `patch` for the def itself */
function lab(params: Partial<SkillParams>, patch?: (d: SkillDef) => void, id = 'will_to_live'): Lab {
  const w = makeWorld({
    content: (c) => {
      const d = c.skills.find((x) => x.id === id) as SkillDef;
      d.params = { ...d.params, heal: 0, buff: undefined, ...params };
      d.trigger = { any: ['engaged'] };
      patch?.(d);
    },
  });
  freezeSchedules(w);
  clearEnemies(w);
  dropSkills(w, 0);
  const p = player(w);
  p.x = p.px = 0;
  p.z = p.pz = 0;
  p.stats.critChance = 0;
  // blows are exact: no armor / resist (a stats refresh would restore them, so tests that cast a buff set them again)
  p.stats.armor = 0;
  const s = giveSkill(w, id);
  s.cd = 0;
  return { w, p, s };
}

function cast(l: Lab): boolean {
  l.w.hash.rebuild(l.w.enemies);
  return castNow(l.w, l.p, l.s);
}

/** a melee blow from the east; iframes dropped so every call lands */
function blow(w: World, p: PlayerState, amount: number, kind: number = HurtKind.Melee, srcEnemy = 0): boolean {
  p.iframes = 0;
  return hurtPlayer(w, p.index, amount, 3, 0, ElementIdx.Physical, kind, srcEnemy);
}

const DUMMY_HP = 1e4; // float32 rows: 1e6 would round hits to 0.06

/** a dummy with big HP that never acts */
function dummy(w: World, x: number, z: number): number {
  const row = spawn(w, 'bear', x, z);
  w.enemies.hp[row] = DUMMY_HP;
  freezeEnemies(w);
  return row;
}

function hpLost(w: World, row: number): number {
  return DUMMY_HP - (w.enemies.hp[row] as number);
}

function markers(w: World, style: string): number[] {
  const P = w.projectiles;
  const out: number[] = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Marker && w.strings.name(P.style[i] as number) === style) out.push(i);
  return out;
}

const WARD = { shield: 10, burst: 4, power: 100, duration: 8, damage: 24, area: 2.2, cooldown: 24 } satisfies Partial<SkillParams>;

describe('ward grant', () => {
  it('sizes the ward from each HOLDER\'s max HP, with a marker row that follows the holder', () => {
    const l = lab(WARD);
    expect(cast(l)).toBe(true);
    const size = wardAmount(l.s.fp, l.p.hpMax);
    expect(size).toBeCloseTo(l.p.hpMax * 0.1, 5);
    expect(l.p.ward).toBeCloseTo(size, 5);
    expect(l.p.wardMax).toBeCloseTo(size, 5);
    expect(l.p.wardT).toBeCloseTo(8, 5);
    expect(l.p.wardSlot).toBe(l.s.slot);
    expect(l.p.wardOwner).toBe(0);
    const m = markers(l.w, 'sk.will_to_live.loop');
    expect(m).toHaveLength(1);
    expect(l.w.projectiles.anchor[m[0] as number]).toBe(0);
    expect(l.w.projectiles.skill[m[0] as number]).toBe(l.s.slot);
    // the marker follows the hero
    l.p.x = 5;
    runTicks(l.w, 2);
    expect(l.w.projectiles.x[markers(l.w, 'sk.will_to_live.loop')[0] as number]).toBeCloseTo(5, 3);
  });

  it('heal lines grow the ward (percent and flat); a ward skill with no base heal heals nothing', () => {
    const l = lab({ ...WARD, heal: 0 });
    const i = UPGRADE_STATS.indexOf('heal');
    l.s.upg[i] = { pct: 0.5, flat: 6 };
    l.p.hp = 10;
    cast(l);
    expect(l.p.hp).toBe(10);
    expect(l.p.ward).toBeCloseTo(l.p.hpMax * 0.1 * 1.5 + 6, 4);
  });

  it('never stacks: a bigger foreign ward stays, a smaller one is replaced (and bursts)', () => {
    const l = lab(WARD);
    const other = giveSkill(l.w, 'will_to_live'); // a second skill instance stands in for another ward skill
    resolveParams(l.p, other, other.fp);
    const row = dummy(l.w, 1, 0);
    const size = l.p.hpMax * 0.1;
    // a foreign ward worth more than this skill's: the cast leaves it alone
    l.p.ward = l.p.wardMax = size * 3;
    l.p.wardT = 5;
    l.p.wardSlot = other.slot;
    l.p.wardOwner = 0;
    cast(l);
    expect(l.p.wardSlot).toBe(other.slot);
    expect(l.p.ward).toBeCloseTo(size * 3, 5);
    expect(hpLost(l.w, row)).toBe(0);
    // a foreign ward worth less: replaced, and the old one bursts with what it had absorbed
    l.s.aux = 0;
    l.s.cd = 0;
    l.p.ward = size * 0.5;
    l.p.wardAbsorbed = 5;
    cast(l);
    expect(l.p.wardSlot).toBe(l.s.slot);
    expect(l.p.ward).toBeCloseTo(size, 5);
    expect(l.p.wardAbsorbed).toBe(0);
    expect(hpLost(l.w, row)).toBeCloseTo(24 + 5, 3); // damage + power x absorbed, from the old ward's own skill
  });
});

describe('ward absorb order', () => {
  it('armor -> ward -> trinket shield -> HP', () => {
    const l = lab(WARD);
    cast(l);
    l.p.shield = 5;
    const size = l.p.ward;
    l.p.hp = l.p.hpMax;
    const before = l.p.hp;
    // a blow bigger than ward + shield
    blow(l.w, l.p, size + 5 + 7);
    expect(l.p.ward).toBe(0);
    expect(l.p.shield).toBe(0);
    expect(l.p.hp).toBeCloseTo(before - 7, 3);
  });

  it('a blow the ward soaks leaves HP and the shield alone and reports "soaked by a ward" (result 3; 2 stays the trinket shield)', () => {
    const l = lab(WARD);
    cast(l);
    l.p.shield = 5;
    const hp = l.p.hp;
    const hits: number[] = [];
    l.p.iframes = 0;
    l.w.bus.clear();
    hurtPlayer(l.w, 0, 4, 3, 0, 0, HurtKind.Melee);
    for (const e of l.w.events) if (e.t === 'playerHit') hits.push(e.result);
    expect(hits).toEqual([3]);
    expect(l.p.hp).toBe(hp);
    expect(l.p.shield).toBe(5);
    expect(l.p.wardAbsorbed).toBeCloseTo(4, 5);
    expect(l.p.ward).toBeCloseTo(l.p.wardMax - 4, 5);
  });

  it('the hurt ring records the pre-ward amount (trigger kinds hurt / danger keep firing under a shell)', () => {
    const l = lab(WARD);
    cast(l);
    blow(l.w, l.p, 5);
    expect(l.p.hurtSum(l.w.time, 2)).toBeGreaterThanOrEqual(5 * 0.9);
  });
});

describe('ward end burst', () => {
  it('a broken ward bursts: damage + power x absorbed at the holder, the skill status rides along', () => {
    const status = { kind: 'stun' as StatusKind, chance: 1, duration: 0.8, power: 1 };
    const l = lab(WARD, (d) => {
      d.params = { ...d.params, status };
    });
    cast(l);
    const near = dummy(l.w, 2, 0);
    const far = spawn(l.w, 'bear', 9, 0);
    l.w.enemies.hp[far] = DUMMY_HP;
    const size = l.p.ward;
    blow(l.w, l.p, size + 10); // breaks it: absorbs `size`
    const expected = 24 + 1.0 * size;
    expect(hpLost(l.w, near)).toBeCloseTo(expected, 3);
    expect(hpLost(l.w, far)).toBe(0);
    expect(((l.w.enemies.status[near] as number) & StatusBit.Stun) !== 0).toBe(true);
    expect(l.p.ward).toBe(0);
    expect(l.p.wardSlot).toBe(-1);
    // the marker ends with the ward
    runTicks(l.w, 2);
    expect(markers(l.w, 'sk.will_to_live.loop')).toHaveLength(0);
  });

  it('an expiring ward bursts too, with the damage only when nothing was absorbed', () => {
    const l = lab(WARD);
    cast(l);
    const near = dummy(l.w, 2, 0);
    runTicks(l.w, 8 * 60 + 2);
    expect(l.p.ward).toBe(0);
    expect(hpLost(l.w, near)).toBeCloseTo(24, 3);
  });

  it('what a ward absorbed counts at most burstCap (2x) of its size', () => {
    const l = lab({ ...WARD, shield: 10 });
    l.s.def.params.drain = 1;
    cast(l);
    const near = dummy(l.w, 2, 0);
    const size = l.p.wardMax;
    // an absorbed total far beyond the cap (as drain refills would make it)
    l.p.wardAbsorbed = size * 2.5;
    l.p.ward = 1;
    blow(l.w, l.p, 50);
    const absorbedAtBreak = size * 2.5 + 1;
    expect(absorbedAtBreak).toBeGreaterThan(2 * size);
    expect(hpLost(l.w, near)).toBeCloseTo(24 + 2 * size, 3);
  });

  it('a skill without `burst` ends its ward quietly (Blessing)', () => {
    const l = lab({ ...WARD, burst: 0 });
    cast(l);
    const near = dummy(l.w, 2, 0);
    blow(l.w, l.p, l.p.ward + 3);
    expect(hpLost(l.w, near)).toBe(0);
  });

  it('a ward that breaks early reopens the selfBuff recast guard (the aether rhythm); the window end stays for a natural end', () => {
    const l = lab(WARD);
    cast(l);
    expect(l.s.aux).toBeGreaterThan(l.w.time + 7);
    blow(l.w, l.p, l.p.ward + 1);
    expect(l.s.aux).toBeLessThanOrEqual(l.w.time);
  });
});

describe('thorns through ward and shield', () => {
  it('a fully absorbed melee blow still triggers thorns (it used to be silent)', () => {
    const l = lab(WARD);
    cast(l);
    l.p.stats.thorns = 1;
    const row = dummy(l.w, 1, 0);
    const id = l.w.enemies.id[row] as number;
    blow(l.w, l.p, 4, HurtKind.Melee, id);
    expect(l.p.hp).toBe(l.p.hpMax);
    expect(hpLost(l.w, row)).toBeGreaterThan(0);
  });

  it('also through the trinket shield alone, and bit-identical to the old formula with no shield at all', () => {
    const a = lab(WARD);
    a.p.stats.thorns = 0.5;
    a.p.shield = 100;
    const ra = dummy(a.w, 1, 0);
    blow(a.w, a.p, 10, HurtKind.Melee, a.w.enemies.id[ra] as number);
    expect(hpLost(a.w, ra)).toBeGreaterThan(0);
    const b = lab(WARD);
    b.p.stats.thorns = 0.5;
    const rb = dummy(b.w, 1, 0);
    const hp = b.p.hp;
    blow(b.w, b.p, 10, HurtKind.Melee, b.w.enemies.id[rb] as number);
    const taken = hp - b.p.hp;
    expect(hpLost(b.w, rb)).toBeCloseTo((taken + 10 * 0.25) * 0.5, 3);
  });
});

describe('drain', () => {
  it('lifesteal refills a drain ward first, through the heal budget, up to 1.5x its size over its life', () => {
    const l = lab({ ...WARD, drain: 1 });
    cast(l);
    const size = l.p.wardMax;
    const row = dummy(l.w, 1, 0);
    l.p.stats.lifesteal = 1;
    // wear the ward down by half, then steal
    blow(l.w, l.p, size * 0.5);
    expect(l.p.ward).toBeCloseTo(size * 0.5, 5);
    l.p.healBudget = 1e9;
    const hp = l.p.hp;
    const c = newHitCtx();
    c.player = 0;
    c.noCrit = true;
    hitEnemy(l.w, row, size * 0.3, c);
    expect(l.p.ward).toBeCloseTo(size * 0.8, 3);
    expect(l.p.hp).toBe(hp); // all of it went into the ward
    // more steals top the ward up to its size, the overflow heals
    l.p.hp = l.p.hpMax * 0.5;
    hitEnemy(l.w, row, size * 5, c);
    expect(l.p.ward).toBeCloseTo(size, 3);
    expect(l.p.hp).toBeGreaterThan(l.p.hpMax * 0.5);
  });

  it('the total refill is capped at drainCap x the ward size per ward', () => {
    const l = lab({ ...WARD, drain: 1 });
    cast(l);
    const size = l.p.wardMax;
    const row = dummy(l.w, 1, 0);
    l.p.stats.lifesteal = 1;
    l.p.healBudget = 1e9;
    const c = newHitCtx();
    c.player = 0;
    c.noCrit = true;
    let refilled = 0;
    for (let i = 0; i < 12; i++) {
      p_wear(l, size * 0.4);
      const before = l.p.ward;
      l.p.healBudget = 1e9;
      hitEnemy(l.w, row, size * 0.4, c);
      refilled += l.p.ward - before;
      if (l.p.ward <= 0) break;
    }
    expect(refilled).toBeLessThanOrEqual(1.5 * size + 1e-3);
  });

  it('the refill spends the heal budget', () => {
    const l = lab({ ...WARD, drain: 1 });
    cast(l);
    const row = dummy(l.w, 1, 0);
    l.p.stats.lifesteal = 1;
    blow(l.w, l.p, 6);
    l.p.healBudget = 2;
    const c = newHitCtx();
    c.player = 0;
    c.noCrit = true;
    hitEnemy(l.w, row, 100, c);
    expect(l.p.healBudget).toBe(0);
    expect(l.p.ward).toBeCloseTo(l.p.wardMax - 6 + 2, 3);
  });

  it('a ward without drain leaves lifesteal to HP only', () => {
    const l = lab(WARD);
    cast(l);
    const row = dummy(l.w, 1, 0);
    l.p.stats.lifesteal = 1;
    l.p.healBudget = 1e9;
    blow(l.w, l.p, 5);
    const w0 = l.p.ward;
    l.p.hp = l.p.hpMax * 0.5;
    const c = newHitCtx();
    c.player = 0;
    c.noCrit = true;
    hitEnemy(l.w, row, 10, c);
    expect(l.p.ward).toBe(w0);
    expect(l.p.hp).toBeGreaterThan(l.p.hpMax * 0.5);
  });
});

function p_wear(l: Lab, amount: number): void {
  blow(l.w, l.p, amount);
}

describe('mirror', () => {
  const MIRROR = { ...WARD, shield: 8, mirror: 4, burst: 3.5, area: 2.2, damage: 12 };

  it('the shell turns a hostile bolt entering `mirror` metres into a bolt of the caster (hostile 0, damage kept, never turns again)', () => {
    const l = lab(MIRROR);
    cast(l);
    expect(l.p.mirrorT).toBeGreaterThan(7);
    expect(l.p.mirrorR).toBeCloseTo(4, 5);
    const i = spawnProjectile(l.w, { kind: ProjKind.Hostile, x: 3, z: 0, vx: -6, vz: 0, radius: 0.3, life: 5, damage: 20, element: 0, owner: 0, skill: 255, pierce: 0, preset: 'p_bolt' });
    const P = l.w.projectiles;
    const handle = P.id[i] as number;
    const hp = l.p.hp;
    runTicks(l.w, 3);
    const row = P.find(handle);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(P.kind[row]).toBe(ProjKind.Bolt);
    expect(P.hostile[row]).toBe(0);
    expect(P.owner[row]).toBe(0);
    expect(P.vx[row]).toBeGreaterThan(0); // flying back out
    expect(l.p.hp).toBe(hp);
    expect(l.p.ward).toBe(l.p.wardMax);
  });

  it('the radius grows with the same area lines as the burst', () => {
    const l = lab(MIRROR);
    l.p.stats.area = 1.5;
    cast(l);
    expect(l.p.mirrorR).toBeCloseTo(4 * 1.5, 4);
  });

  it('a bolt outside the dome flies on and hurts; a broken ward drops the mirror', () => {
    const l = lab(MIRROR);
    cast(l);
    const out = spawnProjectile(l.w, { kind: ProjKind.Hostile, x: 7, z: 0, vx: -6, vz: 0, radius: 0.3, life: 5, damage: 20, element: 0, owner: 0, skill: 255, pierce: 0, preset: 'p_bolt' });
    const handle = l.w.projectiles.id[out] as number;
    runTicks(l.w, 3);
    expect(l.w.projectiles.kind[l.w.projectiles.find(handle)]).toBe(ProjKind.Hostile);
    blow(l.w, l.p, l.p.ward + 1);
    expect(l.p.mirrorT).toBe(0);
    expect(l.p.mirrorR).toBe(0);
  });
});

describe('party grant (co-op)', () => {
  const PARTNER: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

  function partyLab(party: number, heal = 0): Lab {
    const w = makeWorld({
      config: { coop: [PARTNER] },
      content: (c) => {
        const d = c.skills.find((x) => x.id === 'will_to_live') as SkillDef;
        d.params = { ...d.params, heal, buff: undefined, ...WARD, party };
        d.trigger = { any: ['engaged'] };
      },
    });
    freezeSchedules(w);
    clearEnemies(w);
    for (let i = 0; i < w.players.length; i++) dropSkills(w, i);
    const p = player(w);
    for (const q of w.players) {
      q.x = q.px = q.index * 6;
      q.z = q.pz = 0;
      q.stats.armor = 0;
    }
    const s = giveSkill(w, 'will_to_live');
    s.cd = 0;
    return { w, p, s };
  }

  it('every living ally in range gets a ward sized from ITS max HP, with its own marker; out of range gets none', () => {
    const l = partyLab(10);
    const ally = player(l.w, 1);
    ally.hpMax = ally.hp = 200;
    l.p.hpMax = l.p.hp = 100;
    cast(l);
    expect(l.p.ward).toBeCloseTo(10, 4);
    expect(ally.ward).toBeCloseTo(20, 4);
    expect(ally.wardSlot).toBe(l.s.slot);
    expect(ally.wardOwner).toBe(0);
    const anchors = markers(l.w, 'sk.will_to_live.loop').map((r) => l.w.projectiles.anchor[r]);
    expect(anchors.sort()).toEqual([0, 1]);

    const far = partyLab(10);
    player(far.w, 1).x = 30;
    cast(far);
    expect(player(far.w, 1).ward).toBe(0);
  });

  it('the cast heal of the caster is HealSource.CastSelf (5), an ally gets Skill (3): the heal route draws holy.heal only for the ally (recheck B2)', () => {
    const l = partyLab(10, 30);
    const ally = player(l.w, 1);
    l.p.hp = l.p.hpMax * 0.4;
    ally.hp = ally.hpMax * 0.4;
    cast(l);
    const heals = l.w.events.filter((e) => e.t === 'heal').map((e) => [e.player, e.source]);
    expect(heals).toContainEqual([0, 5]);
    expect(heals).toContainEqual([1, 3]);
    expect(heals.some((h) => h[0] === 0 && h[1] === 3)).toBe(false);
  });

  it('an ally ward bursts at the ally with the caster numbers; its early end leaves the caster window alone', () => {
    const l = partyLab(10);
    const ally = player(l.w, 1);
    cast(l);
    const near = dummy(l.w, 7, 0); // 1 m from the ally (x = 6)
    const aux = l.s.aux;
    blow(l.w, ally, ally.ward + 1);
    expect(ally.ward).toBe(0);
    expect(hpLost(l.w, near)).toBeGreaterThan(24 - 1e-3);
    expect(l.s.aux).toBe(aux);
    expect(l.p.ward).toBeGreaterThan(0);
  });
});

describe('steady', () => {
  it('pushes are ignored while the shell stands, and work again after it', () => {
    const l = lab({ ...WARD, steady: 1 });
    cast(l);
    expect(l.p.steadyT).toBeGreaterThan(7);
    pushPlayer(l.p, 5, 0, 6);
    expect(l.p.kvx).toBe(0);
    expect(l.p.kvz).toBe(0);
    runTicks(l.w, 8 * 60 + 2);
    expect(l.p.steadyT).toBe(0);
    pushPlayer(l.p, 5, 0, 6);
    expect(l.p.kvx).not.toBe(0);
  });

  it('a broken ward takes the steady with it', () => {
    const l = lab({ ...WARD, steady: 1 });
    cast(l);
    blow(l.w, l.p, l.p.ward + 1);
    expect(l.p.steadyT).toBe(0);
    pushPlayer(l.p, 5, 0, 6);
    expect(l.p.kvx).not.toBe(0);
  });
});

describe('dodge charges', () => {
  const dodgeLab = (): Lab => lab({ count: 2, duration: 4, damage: 0, area: 2, cooldown: 18 });

  it('a selfBuff with a base count above 1 grants that many charges; the next non-hazard blows are slipped', () => {
    const l = dodgeLab();
    cast(l);
    expect(l.p.dodgeN).toBe(2);
    expect(l.p.dodgeT).toBeCloseTo(4, 5);
    const hp = l.p.hp;
    const evs: number[] = [];
    for (let i = 0; i < 2; i++) {
      l.w.bus.clear();
      expect(blow(l.w, l.p, 20)).toBe(false);
      for (const e of l.w.events) if (e.t === 'playerHit') evs.push(e.result);
    }
    expect(l.p.hp).toBe(hp);
    expect(l.p.dodgeN).toBe(0);
    expect(l.p.dodgeT).toBe(0);
    expect(evs).toEqual([1, 1]);
    // the third lands
    expect(blow(l.w, l.p, 20)).toBe(true);
    expect(l.p.hp).toBeLessThan(hp);
  });

  it('hazard ticks do not spend a charge and are not slipped', () => {
    const l = dodgeLab();
    cast(l);
    const hp = l.p.hp;
    expect(blow(l.w, l.p, 10, HurtKind.Hazard)).toBe(true);
    expect(l.p.hp).toBeLessThan(hp);
    expect(l.p.dodgeN).toBe(2);
  });

  it('the charges run out with the window', () => {
    const l = dodgeLab();
    cast(l);
    runTicks(l.w, 4 * 60 + 2);
    expect(l.p.dodgeN).toBe(0);
    expect(blow(l.w, l.p, 5)).toBe(true);
  });

  it('a legacy selfBuff (count 1) grants none', () => {
    const l = lab({ duration: 4 });
    cast(l);
    expect(l.p.dodgeN).toBe(0);
  });

  it('a slipped blow gives the 0.25 s iframes and a dodge_hop event', () => {
    const l = dodgeLab();
    cast(l);
    l.p.iframes = 0;
    l.w.bus.clear();
    hurtPlayer(l.w, 0, 9, 3, 0, 0, HurtKind.Melee);
    expect(l.p.iframes).toBeCloseTo(0.25, 5);
    expect(l.w.events.some((e) => e.t === 'vfx' && e.preset === 'sk.gen.dodge_hop')).toBe(true);
  });
});

describe('veil', () => {
  /** arc_of_might (a shockwave) with a veil, as smoke_bomb will be */
  const veilLab = (extra: Partial<SkillParams> = {}): Lab => lab({ veil: 1.5, damage: 20, area: 5, duration: 0.55, range: 4, cooldown: 12, ...extra }, undefined, 'arc_of_might');

  it('finishCast veils the caster of any behavior: veilT, 0.6 s iframes, a follow marker for exactly the veil', () => {
    const l = veilLab();
    dummy(l.w, 2, 0);
    expect(cast(l)).toBe(true);
    expect(l.p.veilT).toBeGreaterThan(1.4);
    expect(l.p.iframes).toBeGreaterThanOrEqual(0.6 - 1e-6);
    const m = markers(l.w, 'sk.gen.veil_ring');
    expect(m).toHaveLength(1);
    expect(l.w.projectiles.anchor[m[0] as number]).toBe(0);
    expect(l.w.projectiles.life[m[0] as number]).toBeCloseTo(1.5, 3);
    runTicks(l.w, 95);
    expect(l.p.veilT).toBe(0);
    expect(markers(l.w, 'sk.gen.veil_ring')).toHaveLength(0);
  });

  it('veil scales with duration over base duration (the hero duration stat lengthens it)', () => {
    const l = veilLab();
    dummy(l.w, 2, 0);
    l.p.stats.duration = 1.2;
    expect(cast(l)).toBe(true);
    expect(l.p.veilT).toBeCloseTo(1.5 * 1.2, 4);
  });

  it('a decoy (taunt) leaves a stationary marker and a bait at the cast point, and bursts when the veil ends', () => {
    const l = veilLab({ taunt: 6, veil: 3, duration: 5, area: 3, damage: 30, knockback: 1.5 });
    const row = dummy(l.w, 2, 0);
    l.w.enemies.state[row] = EnemyState.Move; // not Recover: knock applies
    expect(cast(l)).toBe(true);
    expect(l.p.decoySlot).toBe(l.s.slot);
    expect(l.p.decoyX).toBe(0);
    expect(l.w.baits.count).toBe(1);
    expect(l.w.baits.r[0]).toBeCloseTo(6, 5);
    expect(l.w.baits.left[0]).toBeCloseTo(3, 5);
    const decoy = markers(l.w, 'sk.arc_of_might.decoy');
    expect(decoy).toHaveLength(1);
    expect(l.w.projectiles.anchor[decoy[0] as number]).toBe(255);
    const before = l.w.enemies.hp[row] as number;
    // walk the hero away: the decoy stays
    l.p.x = 9;
    runTicks(l.w, 3 * 60 + 2);
    expect(l.p.decoySlot).toBe(-1);
    expect(l.w.baits.count).toBe(0);
    expect(before - (l.w.enemies.hp[row] as number)).toBeCloseTo(30, 3);
    expect(markers(l.w, 'sk.arc_of_might.decoy')).toHaveLength(0);
  });

  it('a second cast pops the older decoy first (no leaked decoy slot)', () => {
    const l = veilLab({ taunt: 6, veil: 3, duration: 5, area: 3, damage: 30 });
    const row = dummy(l.w, 2, 0);
    cast(l);
    l.s.aux = 0;
    const hp = l.w.enemies.hp[row] as number;
    cast(l);
    expect(hp - (l.w.enemies.hp[row] as number)).toBeCloseTo(30, 3);
    expect(l.p.decoySlot).toBe(l.s.slot);
  });
});

describe('war oath', () => {
  const OATH = { damage: 60, cooldown: 80, area: 4, duration: 15, heal: 20, power: 30, nova: 5, novaDamage: 1, knockback: 4 } satisfies Partial<SkillParams>;
  const oathLab = (): Lab => {
    const l = lab(OATH, (d) => {
      d.trigger = { any: ['lethal'] };
      d.params = { ...d.params, buff: { damage: 0.35 } };
    });
    // arm it the way updateSkills does
    l.p.hp = l.p.hpMax * 0.1;
    runTicks(l.w, 2);
    expect(l.p.lethalSlot).toBe(l.s.slot);
    return l;
  };

  it('the killing blow is undone: HP rises to power% + heal, the hero is untouchable, the nova hurls everything, the skill is spent', () => {
    const l = oathLab();
    const row = dummy(l.w, 2, 0);
    l.w.enemies.state[row] = EnemyState.Move;
    const hp0 = l.w.enemies.hp[row] as number;
    p_clear(l);
    const alive = blow(l.w, l.p, 1e6);
    expect(alive).toBe(false);
    expect(l.p.alive).toBe(true);
    expect(l.p.hp).toBeCloseTo(l.p.hpMax * 0.3 + 20, 3);
    expect(l.p.iframes).toBeGreaterThan(2.4);
    expect(l.p.buffs.some((b) => b.skillSlot === l.s.slot)).toBe(true);
    expect(hp0 - (l.w.enemies.hp[row] as number)).toBeGreaterThan(0);
    expect(l.s.cd).toBeGreaterThan(70);
    expect(l.p.lethalSlot).toBe(-1);
    expect(markers(l.w, 'sk.will_to_live.guard')).toHaveLength(1);
    // the guard holds against the next blows
    expect(blow2(l.w, l.p, 1e6)).toBe(false);
    expect(l.p.alive).toBe(true);
  });

  it('it beats the revives (they stay unspent) and is consumed once: the next killing blow takes the revive, then death', () => {
    const l = oathLab();
    l.p.stats.revives = 1;
    p_clear(l);
    blow(l.w, l.p, 1e6);
    expect(l.p.revivesUsed).toBe(0);
    // guard over, the oath on its lockout (the oath buff refreshed the stats: set the revive again)
    runTicks(l.w, 3 * 60);
    l.p.stats.revives = 1;
    l.p.hp = 3;
    blow(l.w, l.p, 1e6);
    expect(l.p.revivesUsed).toBe(1);
    expect(l.p.alive).toBe(true);
  });

  it('only a LETHAL blow spends it', () => {
    const l = oathLab();
    p_clear(l);
    l.p.hp = l.p.hpMax;
    blow(l.w, l.p, 5);
    expect(l.s.cd).toBeLessThanOrEqual(0);
    expect(l.p.lethalSlot).toBe(l.s.slot);
  });

  it('with the skill on its lockout nothing saves the hero', () => {
    const l = oathLab();
    p_clear(l);
    blow(l.w, l.p, 1e6);
    runTicks(l.w, 3 * 60);
    l.p.hp = 5;
    blow(l.w, l.p, 1e6);
    expect(l.p.alive).toBe(false);
  });

  it('a ward soaks first: the oath only answers what gets through', () => {
    const l = oathLab();
    l.p.ward = 1e6;
    l.p.wardMax = 1e6;
    l.p.wardT = 5;
    p_clear(l);
    blow(l.w, l.p, 500);
    expect(l.s.cd).toBeLessThanOrEqual(0);
  });
});

function p_clear(l: Lab): void {
  l.p.iframes = 0;
}

function blow2(w: World, p: PlayerState, amount: number): boolean {
  return hurtPlayer(w, p.index, amount, 3, 0, ElementIdx.Physical, HurtKind.Melee);
}

describe('death and display', () => {
  it('dying ends every shell without a burst', () => {
    const l = lab({ ...WARD, steady: 1 });
    cast(l);
    const row = dummy(l.w, 2, 0);
    l.p.dodgeN = 2;
    l.p.dodgeT = 5;
    l.p.veilT = 2;
    l.p.hp = 1;
    l.p.stats.revives = 0;
    l.p.ward = 0.5; // sliver: the blow breaks it (burst), then kills; a hazard tick is never dodged
    blow(l.w, l.p, 1e6, HurtKind.Hazard);
    expect(l.p.alive).toBe(false);
    expect([l.p.ward, l.p.wardSlot, l.p.steadyT, l.p.dodgeN, l.p.veilT]).toEqual([0, -1, 0, 0, 0]);
    expect(hpLost(l.w, row)).toBeGreaterThan(0); // the break itself burst before the kill
    const l2 = lab({ ...WARD });
    cast(l2);
    const row2 = dummy(l2.w, 2, 0);
    l2.p.hp = 0.5;
    l2.p.ward = 0; // no ward left to break
    l2.p.wardSlot = l2.s.slot;
    l2.p.wardT = 5;
    l2.p.hp = 1;
    l2.p.stats.revives = 0;
    blow(l2.w, l2.p, 1e6, HurtKind.Hazard);
    expect(l2.p.alive).toBe(false);
    expect(hpLost(l2.w, row2)).toBe(0);
  });

  it('the HUD shield is trinket shield + ward', () => {
    const l = lab(WARD);
    cast(l);
    l.p.shield = 7;
    expect(l.w.hud(0).shield).toBeCloseTo(7 + l.p.ward, 5);
  });

  it('two same-seed worlds with a live ward, drain and dodge stay identical', () => {
    const run = (): string => {
      const l = lab({ ...WARD, drain: 1, steady: 1 });
      cast(l);
      for (let i = 0; i < 5; i++) spawn(l.w, 'wolf', 2 + i, 1);
      l.p.stats.lifesteal = 0.3;
      let h = 0;
      for (let t = 0; t < 900; t++) {
        l.w.step([{ moveX: 0, moveZ: 0 }]);
        h = (h * 31 + Math.round(l.p.hp * 100) + Math.round(l.p.ward * 100) + l.w.enemies.count) | 0;
      }
      return `${h}:${l.p.hp.toFixed(3)}:${l.p.ward.toFixed(3)}`;
    };
    expect(run()).toBe(run());
  });
});
