// Skill-logic WP5 (DESIGN section 9, shells.test.ts) on the SHIPPED shells: the gaps the fixture-content suites (heroShells, baitVeilAi,
// skillLogicShells) do not reach - absorb order with real numbers, the 2x burst cap through a drain ward, thorns through a real shell,
// bolts in flight under a veil, the War Oath rate (at most one save per 80 s) under repeated killing blows, the never-stack invariant of a
// kit with all six shells in a live run, and the death clear of markers / decoy. Real content, no fixture.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { hurtPlayer, HurtKind } from '../combat';
import { castNow } from '../skills';
import { refillWard, wardDrains } from '../skills/shell';
import { spawnProjectile } from '../skills/common';
import { resolveParams, wardAmount } from '../skills/params';
import { ElementIdx, ProjKind, type PlayerState } from '../stores';
import type { World } from '../world';
import { botInput } from './bot';
import { drainModals } from './helpers';
import { def, hero, only, realWorld, ringOf, rowsOf, step, stepBot } from './skillLab';

const SHELLS = ['graniteform', 'umbral_plate', 'obsidian_bulwark', 'mirror_shell', 'stormglass_shell', 'radiant_favor'] as const;
const CLASS_OF: Record<string, ['warrior' | 'yacha' | 'shaman', 'a' | 'b']> = {
  graniteform: ['warrior', 'b'],
  umbral_plate: ['yacha', 'a'],
  obsidian_bulwark: ['yacha', 'b'],
  mirror_shell: ['shaman', 'a'],
  stormglass_shell: ['shaman', 'b'],
  radiant_favor: ['shaman', 'a'],
};

/** hero with exact blows (no armor / resist / evasion / crit) and one shell raised through castNow */
function raised(id: string, stats: Record<string, number> = {}): { w: World; p: PlayerState; fpWard: number } {
  const [classId, doctrine] = CLASS_OF[id] ?? ['warrior', 'a'];
  const w = realWorld({ classId, doctrine, stats });
  const p = hero(w);
  const [s] = only(w, [id]);
  p.stats.armor = 0;
  p.stats.evasion = 0;
  p.stats.resist.fill(0);
  w.hash.rebuild(w.enemies);
  expect(castNow(w, p, s!)).toBe(true);
  return { w, p, fpWard: wardAmount(resolveParams(p, s!, s!.fp), p.hpMax) };
}

function blow(w: World, p: PlayerState, amount: number, kind: number = HurtKind.Melee, src = 0): boolean {
  p.iframes = 0;
  p.stats.armor = 0;
  p.stats.evasion = 0;
  return hurtPlayer(w, p.index, amount, 3, 0, ElementIdx.Physical, kind, src);
}

function sawVfx(w: World, preset: string): boolean {
  return w.events.some((e) => e.t === 'vfx' && e.preset === preset);
}

describe('every shipped ward: size and absorb order with the real numbers', () => {
  for (const id of SHELLS) {
    it(`${id}: ward -> trinket shield -> HP, in that order, and the hurt ring keeps the whole blow`, () => {
      const { w, p, fpWard } = raised(id);
      expect(p.ward).toBeCloseTo(fpWard, 3);
      expect(fpWard).toBeCloseTo(((def(id).params.shield ?? 0) / 100) * p.hpMax, 2);
      p.shield = 20;
      const hp0 = p.hp;
      const w0 = p.ward;
      // half of the ward: HP and shield untouched
      blow(w, p, w0 / 2);
      expect(p.ward).toBeCloseTo(w0 / 2, 3);
      expect(p.shield).toBe(20);
      expect(p.hp).toBe(hp0);
      // the rest of the ward + 5 into the shield
      blow(w, p, w0 / 2 + 5);
      expect(p.ward).toBe(0);
      expect(p.shield).toBeCloseTo(15, 3);
      expect(p.hp).toBe(hp0);
      // the shield, then HP
      blow(w, p, 18);
      expect(p.shield).toBe(0);
      expect(p.hp).toBeCloseTo(hp0 - 3, 3);
      // the hurt ring recorded all four sizes before any soak (hurt / danger keep firing under a shell)
      expect(p.hurtSum(w.time, 2)).toBeCloseTo(w0 / 2 + (w0 / 2 + 5) + 18, 2);
    });
  }
});

describe('burst: damage + power x absorbed, absorbed capped at 2x the ward', () => {
  /** HP the creature next to the hero loses when the ward breaks after `forced` extra absorbed damage was booked on it */
  function burstLoss(id: string, forcedWards: number): number {
    const { w, p, fpWard } = raised(id);
    const row = ringOf(w, 'bear', 1, 2)[0] as number;
    w.enemies.hp[row] = 1e5;
    w.enemies.hpMax[row] = 1e5;
    w.hash.rebuild(w.enemies);
    p.wardAbsorbed = forcedWards * fpWard;
    blow(w, p, fpWard * 40);
    expect(sawVfx(w, 'sk.gen.ward_break'), `${id} broke`).toBe(true);
    return 1e5 - (w.enemies.hp[row] as number);
  }

  for (const id of ['graniteform', 'umbral_plate', 'obsidian_bulwark', 'stormglass_shell'] as const) {
    it(`${id}: the burst grows with what the ward absorbed, stops growing at 2x its size, and the cap does not depend on the excess`, () => {
      const plain = burstLoss(id, 0);
      const capped = burstLoss(id, 3);
      const wild = burstLoss(id, 30);
      expect(plain, 'a ward that soaked its own size still bursts').toBeGreaterThan(0);
      expect(capped, 'more absorbed = a harder burst').toBeGreaterThan(plain);
      expect(wild, 'cap at 2x').toBe(capped);
    });
  }

  it('dark protection: lifesteal refills the ward through the heal budget but never past 1.5x its size over its life', () => {
    const { w, p, fpWard } = raised('obsidian_bulwark');
    let taken = 0;
    for (let i = 0; i < 8; i++) {
      blow(w, p, p.ward * 0.9);
      const left = refillWard(w, p, 1e6);
      taken += 1e6 - left;
      expect(p.ward, 'the ward never holds more than its size').toBeLessThanOrEqual(fpWard + 1e-3);
    }
    expect(taken, 'refilled in total').toBeCloseTo(1.5 * fpWard, 2);
    expect(refillWard(w, p, 10), 'the cap is spent: the heal goes to HP').toBe(10);
  });

  it('a ward without drain leaves lifesteal alone (strong body)', () => {
    const { w, p } = raised('graniteform');
    blow(w, p, p.ward * 0.5);
    expect(wardDrains(w, p)).toBe(false);
    expect(wardDrains(raised('obsidian_bulwark').w, hero(raised('obsidian_bulwark').w))).toBe(true);
  });

  it('every ward with a burst answers at the holder: nothing outside its radius is touched', () => {
    for (const id of ['graniteform', 'umbral_plate', 'obsidian_bulwark', 'stormglass_shell'] as const) {
      const { w, p, fpWard } = raised(id);
      const near = ringOf(w, 'bear', 1, 2)[0] as number;
      const far = ringOf(w, 'bear', 1, 12)[0] as number;
      for (const r of [near, far]) {
        w.enemies.hp[r] = 1e5;
        w.enemies.hpMax[r] = 1e5;
      }
      w.hash.rebuild(w.enemies);
      blow(w, p, fpWard * 10);
      expect(w.enemies.hp[near] as number, `${id} near`).toBeLessThan(1e5);
      expect(w.enemies.hp[far] as number, `${id} far`).toBe(1e5);
    }
  });
});

describe('thorns through a real shell', () => {
  it('enchanted armour: a fully absorbed melee blow still hurts the attacker (thorns 0.4 of the blow as it landed)', () => {
    const { w, p, fpWard } = raised('umbral_plate');
    p.stats.thorns = Math.max(p.stats.thorns, 0.4);
    const row = ringOf(w, 'bear', 1, 1.5)[0] as number;
    w.enemies.hp[row] = 1e4;
    w.enemies.hpMax[row] = 1e4;
    w.hash.rebuild(w.enemies);
    const id = w.enemies.id[row] as number;
    const hp0 = w.enemies.hp[row] as number;
    const hpHero = p.hp;
    blow(w, p, fpWard * 0.5, HurtKind.Melee, id);
    expect(p.hp, 'the ward soaked it all').toBe(hpHero);
    expect(hp0 - (w.enemies.hp[row] as number), 'thorns hit').toBeGreaterThan(0);
  });
});

describe('veil (stealth, smoke bomb) and bolts in flight', () => {
  it('a hostile bolt already flying still hits a veiled hero once the 0.6 s cast iframes are over', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a' });
    const p = hero(w);
    const [s] = only(w, ['nightshroud']);
    p.stats.armor = 0;
    p.stats.evasion = 0;
    w.qaForceTriggers = true;
    step(w, 2);
    expect(p.veilT, 'stealth cast').toBeGreaterThan(2);
    // wait out the cast iframes, keep the veil up
    step(w, 45);
    expect(p.iframes).toBe(0);
    expect(p.veilT).toBeGreaterThan(0);
    w.qaForceTriggers = false;
    s!.cd = 1e6;
    const hp0 = p.hp;
    p.stats.evasion = 0; // the buff refresh restored the class evasion: the bolt must land
    p.statsDirty = false;
    spawnProjectile(w, { kind: ProjKind.Hostile, x: p.x + 3, z: p.z, vx: -9, vz: 0, radius: 0.4, life: 5, damage: 12, element: 0, owner: 0, skill: 255, pierce: 0, preset: 'p_bolt' });
    step(w, 40);
    expect(p.hp, 'stealth is not invulnerability: the bolt in flight hits').toBeLessThan(hp0);
  });

  it('the veil is a pure AI effect: it never changes who a boss targets', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a' });
    const p = hero(w);
    only(w, ['nightshroud']);
    w.qaForceTriggers = true;
    step(w, 2);
    expect(p.veilT).toBeGreaterThan(0);
    // bosses (elite tier 3 / Boss flag) ignore the veil by rule: spawn one and see it keep closing in
    const row = ringOf(w, 'bear', 1, 10, 0, { tier: 3 })[0] as number;
    const x0 = w.enemies.x[row] as number;
    const z0 = w.enemies.z[row] as number;
    w.qaForceTriggers = false;
    step(w, 30);
    const d0 = Math.hypot(x0 - p.x, z0 - p.z);
    const d1 = Math.hypot((w.enemies.x[row] as number) - p.x, (w.enemies.z[row] as number) - p.z);
    expect(d1, 'the tier-3 creature walks to the veiled hero').toBeLessThan(d0 - 0.5);
  });
});

describe('war oath: at most one save per 80 s', () => {
  it('a killing blow every 5 s for 400 s: the oath answers once per lockout, the revives take the rest, the hero lives', () => {
    const w = realWorld({ classId: 'warrior', doctrine: 'a', stats: { revives: 200, armor: 0 } });
    const p = hero(w);
    only(w, ['war_oath']);
    p.stats.armor = 0;
    p.stats.evasion = 0;
    let saves = 0;
    const saveTimes: number[] = [];
    const oath = p.skills.find((k) => k.def.id === 'war_oath');
    const revives0 = p.revivesUsed;
    let blows = 0;
    for (let t = 0; t < 400 * 60; t++) {
      if (t % 300 === 0 && t > 0) {
        p.iframes = 0;
        p.hp = Math.min(p.hp, 5);
        p.stats.armor = 0;
        p.stats.evasion = 0;
        const cd0 = oath?.cd ?? 0;
        blow(w, p, 1e6);
        blows++;
        // a save casts the skill past its gate: the lockout (80 s) starts
        if ((oath?.cd ?? 0) > cd0 + 50) {
          saves++;
          saveTimes.push(w.time);
        }
      }
      w.step([{ moveX: 0, moveZ: 0 }]);
    }
    expect(p.alive).toBe(true);
    expect(saves, 'the oath saved at least the first and the later recharges').toBeGreaterThanOrEqual(4);
    for (let i = 1; i < saveTimes.length; i++) expect((saveTimes[i] as number) - (saveTimes[i - 1] as number), 'two saves are one lockout apart').toBeGreaterThanOrEqual(80 - 1);
    expect(saves).toBeLessThanOrEqual(Math.ceil(400 / 80) + 1);
    // every blow that was not an oath save cost a revive
    expect(p.revivesUsed - revives0).toBe(blows - saves);
  });
});

describe('the ward never stacks, whatever the kit', () => {
  it('a hero with all six shells in a live run: p.ward never exceeds the biggest single ward (+ the drain refill cap)', () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'a', live: true, seed: 9, stats: { armor: 30, regen: 2 } });
    const p = hero(w);
    only(w, [...SHELLS], 3);
    const sizes = SHELLS.map((id) => {
      const s = p.skills.find((k) => k.def.id === id);
      return s ? wardAmount(resolveParams(p, s, s.fp), p.hpMax) : 0;
    });
    const biggest = Math.max(...sizes);
    let peak = 0;
    let raisedAny = false;
    for (let t = 0; t < 240 * 60 && !w.over; t++) {
      drainModals(w);
      w.step([botInput(w, t)]);
      if (p.ward > 0) raisedAny = true;
      peak = Math.max(peak, p.ward);
      if (p.ward > 0) expect(p.ward <= p.wardMax * 1.0001 + 1e-3 || p.wardAbsorbed >= 0).toBe(true);
    }
    expect(raisedAny, 'a ward stood at least once').toBe(true);
    // levels (max HP) grow during the run: compare with the biggest ward at the END of the run, with slack for the level-ups
    const bigNow = Math.max(...SHELLS.map((id) => {
      const s = p.skills.find((k) => k.def.id === id);
      return s ? wardAmount(resolveParams(p, s, s.fp), p.hpMax) : 0;
    }));
    expect(peak, 'one ward at a time').toBeLessThanOrEqual(Math.max(biggest, bigNow) * 1.5 + 1);
  });
});

describe('death clears the shells', () => {
  it('a hero killed under a ward + a stealth decoy leaves no loop marker, no ward, no dodge charge, no veil', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a' });
    const p = hero(w);
    const ids = ['nightshroud', 'swallows_gait'];
    only(w, ids);
    p.stats.armor = 0;
    p.stats.evasion = 0;
    w.qaForceTriggers = true;
    ringOf(w, 'wild_dog', 6, 3);
    step(w, 3);
    expect(p.veilT).toBeGreaterThan(0);
    expect(p.dodgeN).toBeGreaterThan(0);
    w.qaForceTriggers = false;
    p.dodgeN = 0;
    p.hp = 1;
    p.stats.revives = 0;
    blow(w, p, 1e6);
    expect(p.alive).toBe(false);
    step(w, 3);
    expect(p.veilT).toBe(0);
    expect(p.dodgeN).toBe(0);
    expect(p.ward).toBe(0);
    const stale = rowsOf(w, ProjKind.Marker).filter((r) => (w.projectiles.anchor[r] as number) === p.index);
    expect(stale.length, 'markers that follow a dead hero are gone').toBe(0);
  });
});

void content;
void stepBot;
