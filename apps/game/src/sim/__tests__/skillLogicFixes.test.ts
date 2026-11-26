// Regressions of the skill-logic review (build/review/REVIEW.md): each test pins a defect the Opus critic proved with a probe.
// B1 orbiter free by handle, B2 War Oath vs its own window, M2 ward skills that wait for a foreign ward, M4 bait capacity + decoy
// refresh, M6 clone credit, m3 summon windows on the HUD ring, m4 boss rows skip the corpse ring, m5 replaced ward keeps its mirror,
// m6 dodge charges are authored on swallows_gait only, M3 stop-gap looks for damage sources.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { spawnBoss } from '../bosses';
import { hitEnemy, hurtPlayer, HurtKind, newHitCtx } from '../combat';
import { applySkillLine, castNow } from '../skills';
import { activeLeft } from '../skills/trigger';
import { CompanionRole, EnemyFlag, ProjKind } from '../stores';
import { MAX_BAITS, type World } from '../world';
import { PARTNER, hero, only, realWorld, ringOf, rowsOf, step, wound } from './skillLab';

function audit(w: World): { bad: number; orbiters: number } {
  const P = w.projectiles;
  let bad = 0;
  let orbiters = 0;
  for (let i = 0; i < P.count; i++) {
    if (P.find(P.id[i] as number) !== i) bad++;
    if (P.kind[i] === ProjKind.Familiar && P.role[i] === CompanionRole.Orbiter) orbiters++;
  }
  return { bad, orbiters };
}

function kill(w: World, row: number): void {
  const c = newHitCtx();
  c.player = 0;
  c.noCrit = true;
  hitEnemy(w, row, 1e9, c);
}

describe('B1: the Blaze Familiars orbiter frees surplus spirits by handle', () => {
  it('three spirits with interleaved rows drop to one in one tick: every row resolves by its own handle and exactly one orbiter is left', () => {
    for (const delay of [0, 9, 21, 40, 77]) {
      const w = realWorld({ classId: 'yacha', doctrine: 'b', seed: 5 });
      const p = hero(w);
      const [s] = only(w, ['blaze_familiars'], 0);
      ringOf(w, 'wild_dog', 10, 7);
      const e = w.enemies;
      for (let i = 0; i < e.count; i++) {
        e.hp[i] = 1e9;
        e.hpMax[i] = 1e9;
      }
      const run = (n: number): void => {
        for (let i = 0; i < n; i++) {
          p.iframes = 1e9;
          step(w, 1);
        }
      };
      run(30 + delay); // twins come and go: the rows shuffle
      p.buffs.push({ skillSlot: 999, mods: { projectiles: 2 }, left: 1 + (delay % 7) * 0.13, total: 2 });
      p.statsDirty = true;
      run(20); // three spirits are up
      expect(audit(w).orbiters).toBe(3);
      run(150); // the buff runs out: want 3 -> 1 in a single tick
      const a = audit(w);
      expect(a.bad, `delay ${delay}`).toBe(0);
      expect(a.orbiters, `delay ${delay}`).toBe(1);
      expect(s!.pets.length).toBeGreaterThanOrEqual(1);
      // no slot was freed twice: two fresh allocations never share a slot
      const P = w.projectiles;
      const r1 = P.alloc();
      const r2 = P.alloc();
      expect(r1).not.toBe(r2);
    }
  });
});

describe('B2: the War Oath saves even while its own kill-extended window is still up', () => {
  it('armed after a short lockout with a long window (cdr + attack speed + duration lines): the second killing blow is undone', () => {
    const w = realWorld({ classId: 'warrior', doctrine: 'a', stats: { cooldown: 0.3, attackSpeed: 0.2 } });
    const p = hero(w);
    const [s] = only(w, ['war_oath'], 7);
    for (let i = 0; i < 3; i++) applySkillLine(s!, { stat: 'duration', mode: 'pct', value: 0.12 } as never);
    step(w, 2);
    p.stats.evasion = 0;
    p.iframes = 0;
    p.hp = 5;
    hurtPlayer(w, 0, 1e6, 3, 0, 0, HurtKind.Melee);
    expect(p.alive).toBe(true);
    expect(s!.cd).toBeGreaterThan(1);
    // the horde keeps dying: each kill stretches the window (capped at +50 %)
    for (let k = 0; k < 40; k++) kill(w, ringOf(w, 'wild_dog', 1, 30)[0] as number);
    const lockout = s!.cd;
    const window = s!.aux - w.time;
    expect(window).toBeGreaterThan(lockout - 1); // the failing shape: the window outlasts (or nearly) the lockout
    let t = 0;
    while (s!.cd > 0 && t < 200 * 60) {
      step(w, 1);
      t++;
    }
    step(w, 2);
    expect(p.lethalSlot).toBe(s!.slot);
    p.iframes = 0;
    p.hp = 5;
    const revives = p.revivesUsed;
    hurtPlayer(w, 0, 1e6, 3, 0, 0, HurtKind.Melee);
    expect(p.alive).toBe(true);
    expect(p.revivesUsed).toBe(revives);
    expect(p.hp).toBeGreaterThan(5);
  });
});

describe('M2: a ward skill waits while its caster holds a foreign ward it could not replace', () => {
  it('blessing and reflect locked into phase: reflect stays armed under blessing\'s ward and lands when it breaks', () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'a' });
    const p = hero(w);
    const [bl, rf] = only(w, ['radiant_favor', 'mirror_shell'], 0);
    ringOf(w, 'wild_dog', 3, 9);
    step(w, 2);
    wound(w, 0, 0.12);
    p.hp = p.hpMax;
    step(w, 4);
    // blessing took the hurt, its ward stands, reflect did not burn its cast into the rejected 8 % ward
    expect(bl!.cd).toBeGreaterThan(1);
    expect(p.wardSlot).toBe(bl!.slot);
    expect(rf!.cd).toBe(0);
    // the ward breaks: reflect (still armed on the same hurt window or a new blow) lands its own ward
    p.ward = 0.001;
    wound(w, 0, 0.12);
    p.hp = p.hpMax;
    step(w, 4);
    expect(p.wardSlot === rf!.slot || p.ward === 0).toBe(true);
    expect(rf!.cd).toBeGreaterThan(1);
    expect(p.wardSlot).toBe(rf!.slot);
  });
});

describe('M4: the bait list holds two full legions; the decoy lure is refreshed every tick', () => {
  it('MAX_BAITS covers a 12-knight legion plus a decoy', () => {
    expect(MAX_BAITS).toBeGreaterThanOrEqual(12 + 12 + 4);
  });

  it('a rank-P legion with count lines and kills raises every knight with a lure of its own', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'a' });
    const p = hero(w);
    const [s] = only(w, ['cursed_legion'], 7);
    for (let i = 0; i < 2; i++) applySkillLine(s!, { stat: 'count', mode: 'flat', value: 1 } as never);
    step(w, 2);
    for (let k = 0; k < 30; k++) {
      kill(w, ringOf(w, 'wild_dog', 1, 6)[0] as number);
      step(w, 4);
    }
    ringOf(w, 'wild_dog', 12, 6);
    step(w, 1);
    w.hash.rebuild(w.enemies);
    expect(castNow(w, p, s!)).toBe(true);
    step(w, 3);
    const P = w.projectiles;
    let knights = 0;
    for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Familiar && P.role[i] === CompanionRole.Knight) knights++;
    expect(knights).toBeGreaterThanOrEqual(9);
    expect(w.baits.count).toBeGreaterThanOrEqual(knights);
  });

  it('the stealth decoy bait is re-added every tick of the veil, so a starved list gets it back', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a' });
    const p = hero(w);
    const [s] = only(w, ['nightshroud'], 0);
    ringOf(w, 'wild_dog', 6, 3);
    w.hash.rebuild(w.enemies);
    for (let i = 0; i < MAX_BAITS; i++) w.addBait(40 + i, 40, 3, 30, 5000 + i); // the list is full of foreign lures
    expect(w.addBait(0, 0, 1, 1, 9999)).toBe(false);
    expect(castNow(w, p, s!)).toBe(true);
    const key = (0x80000000 | s!.slot) >>> 0;
    const has = (): boolean => {
      for (let i = 0; i < w.baits.count; i++) if (w.baits.key[i] === key) return true;
      return false;
    };
    expect(has()).toBe(false); // starved at the cast
    for (let i = 0; i < w.baits.count; i++) w.baits.left[i] = 0.01; // the foreign lures run out
    step(w, 2);
    expect(has()).toBe(true); // the decoy lure is back
  });
});

describe('M6: the clone is credited with the damage of its copies', () => {
  it('instant hits and copied zone ticks move from the copied skill to Shadow Clone', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a' });
    const p = hero(w);
    const [clone, poison, cloud] = only(w, ['shadow_clone', 'creeping_venom', 'noxious_pall'], 0);
    const rows = ringOf(w, 'wild_dog', 20, 3);
    for (const r of rows) {
      w.enemies.hp[r] = 1e7;
      w.enemies.hpMax[r] = 1e7;
    }
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    expect(castNow(w, p, clone!)).toBe(true);
    step(w, 1);
    for (let k = 0; k < 6; k++) {
      poison!.cd = 0;
      cloud!.cd = 0;
      step(w, 70);
      p.iframes = 1e9;
    }
    const total = w.tally.damageDealt;
    const booked = clone!.damage + poison!.damage + cloud!.damage + p.skills[0]!.damage;
    expect(clone!.damage).toBeGreaterThan(0);
    expect(booked).toBeCloseTo(total, 3); // moved, not duplicated or lost
  });
});

describe('m3: summon windows read active on the HUD ring', () => {
  it('thunder guardians: activeLeft is the idols\' remaining life; the permanent flame spirits are not a window', () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'b' });
    const p = hero(w);
    const [tg] = only(w, ['thunder_guardians'], 0);
    ringOf(w, 'wild_dog', 8, 5);
    w.hash.rebuild(w.enemies);
    expect(activeLeft(w, p, tg!)).toBe(0);
    w.qaForceTriggers = true;
    expect(castNow(w, p, tg!)).toBe(true);
    step(w, 5);
    const left = activeLeft(w, p, tg!);
    expect(left).toBeGreaterThan(5);
    expect(left).toBeLessThanOrEqual(14);

    const w2 = realWorld({ classId: 'yacha', doctrine: 'b' });
    const p2 = hero(w2);
    const [fs] = only(w2, ['blaze_familiars'], 0);
    step(w2, 5);
    expect(rowsOf(w2, ProjKind.Familiar).length).toBe(1);
    expect(activeLeft(w2, p2, fs!)).toBe(0);
  });
});

describe('m4: a boss kill never feeds the legion\'s corpse ring', () => {
  it('a normal kill pushes a corpse, a boss row does not', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'a' });
    only(w, ['cursed_legion'], 0);
    step(w, 2);
    kill(w, ringOf(w, 'wild_dog', 1, 6)[0] as number);
    expect(w.corpses.count).toBe(1);
    expect(spawnBoss(w, 'boss_horyeong', false, 0, 12)).not.toBeNull();
    const e = w.enemies;
    let boss = -1;
    for (let i = 0; i < e.count; i++) if (e.eliteTier[i] === 3) boss = i;
    expect(boss).toBeGreaterThanOrEqual(0);
    e.flags[boss] = (e.flags[boss] as number) & ~EnemyFlag.Invuln; // the boss intro is over
    kill(w, boss);
    expect(w.tally.kills).toBe(2); // the boss kill counted, the corpse ring did not grow
    expect(w.corpses.count).toBe(1);
  });
});

describe('m6: only swallows_gait authors dodge charges', () => {
  it('every shipped selfBuff with a base count above 1 is swallows_gait', () => {
    const multi = content.skills.filter((s) => s.behavior === 'selfBuff' && (s.params.count ?? 1) > 1).map((s) => s.id);
    expect(multi).toEqual(['swallows_gait']);
  });
});

describe('m5: a ward replaced by a bigger one keeps its mirror window', () => {
  it('reflect\'s dome survives the aether ward replacing its 8 % ward in co-op', () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'a', coop: [PARTNER] });
    const p = hero(w);
    const [rf] = only(w, ['mirror_shell'], 0);
    ringOf(w, 'wild_dog', 3, 9);
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    expect(castNow(w, p, rf!)).toBe(true);
    expect(p.mirrorT).toBeGreaterThan(5);
    const ally = hero(w, 1);
    const [aw] = only(w, ['stormglass_shell'], 0, 1);
    ally.x = p.x + 2;
    ally.z = p.z;
    w.hash.rebuild(w.enemies);
    expect(castNow(w, ally, aw!)).toBe(true);
    expect(p.wardSlot).toBe(aw!.slot); // the bigger ward replaced reflect's
    expect(p.mirrorT).toBeGreaterThan(5); // the dome stays up
  });
});

describe('M3 stop-gap is gone: the moments are drawn by their own sk.* specs', () => {
  const has = (w: World, preset: string): boolean => w.events.some((e) => e.t === 'vfx' && e.preset === preset);
  const hasLine = (w: World, preset: string): boolean => w.events.some((e) => e.t === 'vfx' && e.hasTarget && e.preset === preset);

  it('a ward that breaks bursts with its own sk.* moment and no generic vfx_nova next to it', () => {
    const w = realWorld({ classId: 'warrior', doctrine: 'b' });
    const p = hero(w);
    only(w, ['graniteform'], 0);
    ringOf(w, 'wild_dog', 6, 2);
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    step(w, 2);
    expect(p.ward).toBeGreaterThan(0);
    w.events.length = 0;
    p.ward = 0.001;
    wound(w, 0, 0.05);
    expect(has(w, 'sk.graniteform.shatter')).toBe(true);
    expect(has(w, 'sk.gen.ward_break')).toBe(true);
    expect(has(w, 'vfx_nova')).toBe(false);
  });

  it("the dragon's breath is the sk.wyrm_retinue.breath row (a spec draws it), not the plain gold stand-in", () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'a' });
    const p = hero(w);
    const [da] = only(w, ['wyrm_retinue'], 0);
    ringOf(w, 'wild_dog', 6, 6);
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    expect(castNow(w, p, da!)).toBe(true);
    step(w, 240);
    const names = w.strings.names;
    expect(names.includes('sk.wyrm_retinue.breath')).toBe(true);
    expect(names.includes('holy_dragon_breath')).toBe(false);
  });

  it('the idol arc is the sk.thunder_guardians.arc line alone (no chain.bolt twin)', () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'a' });
    const p = hero(w);
    const [tg] = only(w, ['thunder_guardians'], 0);
    ringOf(w, 'wild_dog', 6, 8);
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    expect(castNow(w, p, tg!)).toBe(true);
    let arcs = false;
    let bolts = false;
    for (let i = 0; i < 400; i++) {
      step(w, 1); // the event list is per tick
      arcs ||= hasLine(w, 'sk.thunder_guardians.arc');
      bolts ||= hasLine(w, 'chain.bolt');
    }
    expect(arcs).toBe(true);
    expect(bolts).toBe(false);
  });
});
