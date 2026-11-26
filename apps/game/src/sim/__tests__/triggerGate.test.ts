// Skill-logic M1 (DESIGN §4): the context trigger gate in updateSkills — every trigger kind on a scripted field, patience, minHp,
// the lockout, the lethal arm flag, Vigil, the HUD ring state, qaForceTriggers and determinism (an armed skill draws no RNG).

import { describe, expect, it } from 'vitest';
import type { SkillDef, TriggerSpec } from '../../data/schema';
import { spawnBoss } from '../bosses';
import { hurtPlayer, HurtKind } from '../combat';
import { hud } from '../hud';
import type { CoopPlayerInit } from '../run';
import { castNow, updateSkills } from '../skills';
import { spawnProjectile } from '../skills/common';
import { allyNeeds, gateOpen, heroCtx } from '../skills/trigger';
import { EnemyFlag, ProjKind, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { botInput } from './bot';
import { clearEnemies, dropSkills, freezeEnemies, freezeSchedules, giveSkill, makeWorld, player, runTicks, spawn } from './helpers';

const PARTNER: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

interface Lab {
  w: World;
  p: PlayerState;
  s: SkillInstance;
}

/** a quiet world with ONE gated selfBuff (the fixture's will_to_live) owned by hero 0 and ready (cd 0) */
function lab(trigger: TriggerSpec | undefined, patch?: (d: SkillDef) => void, coop = false): Lab {
  const w = makeWorld({
    config: coop ? { coop: [PARTNER] } : undefined,
    content: (c) => {
      const d = c.skills.find((x) => x.id === 'will_to_live') as SkillDef;
      if (trigger) d.trigger = trigger;
      patch?.(d);
    },
  });
  freezeSchedules(w);
  clearEnemies(w);
  for (let i = 0; i < w.players.length; i++) dropSkills(w, i);
  const p = player(w);
  p.x = p.px = 0;
  p.z = p.pz = 0;
  const s = giveSkill(w, 'will_to_live');
  s.cd = 0;
  return { w, p, s };
}

/** re-index the enemy hash and drop the per-tick ctx cache, then read the gate (no tick needed) */
function probe(w: World, p: PlayerState, s: SkillInstance): boolean {
  w.hash.rebuild(w.enemies);
  p.ctx.tick = -1;
  return gateOpen(w, p, s);
}

/** n wolves on a ring of radius r around (0, 0) */
function ring(w: World, n: number, r: number, opts: Parameters<typeof spawn>[4] = {}): number[] {
  const rows: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    rows.push(spawn(w, 'wolf', Math.sin(a) * r, Math.cos(a) * r, opts));
  }
  return rows;
}

function hurt(w: World, p: PlayerState, amount: number): void {
  p.iframes = 0;
  hurtPlayer(w, p.index, amount, 3, 0, 0, HurtKind.Melee);
}

describe('trigger kinds on a scripted field', () => {
  it('a skill without a trigger is always open and never arms', () => {
    const { w, p, s } = lab(undefined);
    expect(s.def.trigger).toBeUndefined();
    expect(probe(w, p, s)).toBe(true);
    runTicks(w, 5);
    expect(s.armedT).toBe(0);
  });

  it('pinned: >= 5 creatures within 4 m (centre distance), a spec.n overrides the count', () => {
    const { w, p, s } = lab({ any: ['pinned'] });
    ring(w, 4, 3);
    expect(probe(w, p, s)).toBe(false);
    spawn(w, 'wolf', 0, 3.9);
    expect(probe(w, p, s)).toBe(true);
    // a creature just outside 4 m does not count
    const { w: w2, p: p2, s: s2 } = lab({ any: ['pinned'] });
    ring(w2, 4, 3);
    spawn(w2, 'wolf', 0, 4.3);
    expect(probe(w2, p2, s2)).toBe(false);
    // spec.n = 7
    const { w: w3, p: p3, s: s3 } = lab({ any: ['pinned'], n: 7 });
    ring(w3, 6, 2);
    expect(probe(w3, p3, s3)).toBe(false);
    spawn(w3, 'wolf', 1, 1);
    expect(probe(w3, p3, s3)).toBe(true);
  });

  it('engaged: >= 4 creatures within 8 m', () => {
    const { w, p, s } = lab({ any: ['engaged'] });
    ring(w, 3, 7);
    expect(probe(w, p, s)).toBe(false);
    spawn(w, 'wolf', 7.5, 0);
    expect(probe(w, p, s)).toBe(true);
    const { w: w2, p: p2, s: s2 } = lab({ any: ['engaged'] });
    ring(w2, 6, 9);
    expect(probe(w2, p2, s2)).toBe(false);
  });

  it('metin stones, dying and spawning rows never count', () => {
    const { w, p, s } = lab({ any: ['engaged'] });
    const rows = ring(w, 4, 5);
    expect(probe(w, p, s)).toBe(true);
    w.enemies.flags[rows[0] as number] = (w.enemies.flags[rows[0] as number] as number) | EnemyFlag.Metin;
    expect(probe(w, p, s)).toBe(false);
  });

  it('elite: an elite (tier >= 1) within 10 m; boss: a boss within 14 m (and it reads as elite too)', () => {
    const { w, p, s } = lab({ any: ['elite'] });
    spawn(w, 'wolf', 0, 12, { tier: 1 });
    expect(probe(w, p, s)).toBe(false);
    spawn(w, 'wolf', 0, 9, { tier: 1 });
    expect(probe(w, p, s)).toBe(true);

    const b = lab({ any: ['boss'] });
    expect(spawnBoss(b.w, 'boss_horyeong', false, 0, 30)).not.toBeNull();
    expect(probe(b.w, b.p, b.s)).toBe(false);
    const row = b.w.enemies.find((b.w.bosses[0] as { enemy: number }).enemy);
    b.w.enemies.x[row] = 0;
    b.w.enemies.z[row] = 13;
    expect(probe(b.w, b.p, b.s)).toBe(true);
    // 13 m is beyond the elite radius (10) but a boss inside the boss radius still reads as an elite
    const e2 = lab({ any: ['elite'] });
    spawnBoss(e2.w, 'boss_horyeong', false, 0, 13);
    expect(probe(e2.w, e2.p, e2.s)).toBe(true);
  });

  it('volley: >= 2 hostile bolts within 8 m (player bolts and far bolts do not count)', () => {
    const { w, p, s } = lab({ any: ['volley'] });
    const bolt = (x: number, z: number, kind = ProjKind.Hostile): number =>
      spawnProjectile(w, { kind, x, z, vx: 0, vz: 0, radius: 0.3, life: 9, damage: 1, element: 0, owner: 0, skill: 255, pierce: 0, preset: 'p_bolt' });
    bolt(5, 0);
    bolt(30, 0);
    bolt(2, 2, ProjKind.Bolt);
    expect(probe(w, p, s)).toBe(false);
    bolt(0, 6);
    expect(probe(w, p, s)).toBe(true);
  });

  it('hurt: >= 6 % of max HP lost within 2 s, measured after armor and BEFORE a trinket shield', () => {
    const { w, p, s } = lab({ any: ['hurt'] });
    expect(probe(w, p, s)).toBe(false);
    // a shield soaks the whole blow, the ring still records it
    p.shield = 1e6;
    hurt(w, p, p.hpMax * 0.2);
    expect(p.hurtSum(w.time, 2)).toBeGreaterThan(0.06 * p.hpMax);
    expect(probe(w, p, s)).toBe(true);
    // 2.2 s later the window is empty
    runTicks(w, 132);
    expect(probe(w, p, s)).toBe(false);
  });

  it('hurt: two small blows add up inside the window', () => {
    const { w, p, s } = lab({ any: ['hurt'] });
    hurt(w, p, p.hpMax * 0.04);
    const first = p.hurtSum(w.time, 2);
    expect(first).toBeLessThan(0.06 * p.hpMax);
    expect(probe(w, p, s)).toBe(false);
    runTicks(w, 40);
    hurt(w, p, p.hpMax * 0.04);
    expect(probe(w, p, s)).toBe(true);
  });

  it('danger: HP <= 40 % (spec.hp overrides) or >= 25 % of max HP lost within 6 s', () => {
    const { w, p, s } = lab({ any: ['danger'] });
    p.hp = p.hpMax * 0.45;
    expect(probe(w, p, s)).toBe(false);
    p.hp = p.hpMax * 0.4;
    expect(probe(w, p, s)).toBe(true);
    const lo = lab({ any: ['danger'], hp: 0.25 });
    lo.p.hp = lo.p.hpMax * 0.3;
    expect(probe(lo.w, lo.p, lo.s)).toBe(false);
    const hi = lab({ any: ['danger'], hp: 0.55 });
    hi.p.hp = hi.p.hpMax * 0.5;
    expect(probe(hi.w, hi.p, hi.s)).toBe(true);
    // a big loss inside 6 s opens it even at high HP
    const loss = lab({ any: ['danger'] });
    hurt(loss.w, loss.p, loss.p.hpMax * 0.2);
    runTicks(loss.w, 120);
    hurt(loss.w, loss.p, loss.p.hpMax * 0.2);
    expect(loss.p.hurtSum(loss.w.time, 6)).toBeGreaterThanOrEqual(0.25 * loss.p.hpMax);
    loss.p.hp = loss.p.hpMax;
    expect(probe(loss.w, loss.p, loss.s)).toBe(true);
    runTicks(loss.w, 480);
    expect(probe(loss.w, loss.p, loss.s)).toBe(false);
  });

  it('ally: never in solo; in co-op a hurt or low ally within the skill party radius (12 m default)', () => {
    const solo = lab({ any: ['ally'] });
    expect(probe(solo.w, solo.p, solo.s)).toBe(false);
    expect(allyNeeds(solo.w, solo.p, 99)).toBe(false);

    const { w, p, s } = lab({ any: ['ally'] }, undefined, true);
    const ally = player(w, 1);
    ally.x = ally.px = 8;
    ally.z = ally.pz = 0;
    expect(probe(w, p, s)).toBe(false);
    ally.hp = ally.hpMax * 0.5;
    expect(probe(w, p, s)).toBe(true);
    // out of reach
    ally.x = ally.px = 20;
    expect(probe(w, p, s)).toBe(false);
    // the skill's party radius wins when > 0
    s.fp.party = 25;
    expect(probe(w, p, s)).toBe(true);
    // a dead ally never calls for help
    ally.alive = false;
    expect(probe(w, p, s)).toBe(false);
    ally.alive = true;
    // recently hurt (not low)
    ally.hp = ally.hpMax;
    s.fp.party = 0;
    ally.x = ally.px = 5;
    hurt(w, ally, ally.hpMax * 0.2);
    ally.hp = ally.hpMax;
    expect(probe(w, p, s)).toBe(true);
  });

  it('lethal never opens the plain gate: the skill is armed for the killing blow instead', () => {
    const { w, p, s } = lab({ any: ['lethal'] });
    ring(w, 8, 2);
    p.hp = 1;
    expect(probe(w, p, s)).toBe(false);
    runTicks(w, 3);
    expect(p.lethalSlot).toBe(s.slot);
    expect(s.cd).toBe(0);
    // castNow (the oath save) fires it past the gate and clears the arm flag
    expect(castNow(w, p, s)).toBe(true);
    expect(p.lethalSlot).toBe(-1);
    expect(s.cd).toBeCloseTo(s.fp.cooldown, 6);
    runTicks(w, 3);
    expect(p.lethalSlot).toBe(-1);
  });

  it('any-of: the gate opens when ANY listed kind is true', () => {
    const { w, p, s } = lab({ any: ['pinned', 'elite'] });
    expect(probe(w, p, s)).toBe(false);
    spawn(w, 'wolf', 0, 5, { tier: 1 });
    expect(probe(w, p, s)).toBe(true);
  });

  it('heroCtx is cached per tick and recomputed the next tick', () => {
    const { w, p } = lab({ any: ['engaged'] });
    ring(w, 5, 3);
    w.hash.rebuild(w.enemies);
    p.ctx.tick = -1;
    const c = heroCtx(w, p);
    expect(c.nPinned).toBe(5);
    expect(c.nEngaged).toBe(5);
    expect(c.tick).toBe(w.tick);
    expect(heroCtx(w, p)).toBe(c);
    clearEnemies(w);
    w.hash.rebuild(w.enemies);
    expect(heroCtx(w, p).nPinned).toBe(5);
    w.tick++;
    expect(heroCtx(w, p).nPinned).toBe(0);
  });
});

describe('the gate inside updateSkills', () => {
  it('a gated skill waits armed, fires when the trigger turns true, and its cooldown is the lockout', () => {
    const { w, p, s } = lab({ any: ['pinned'] });
    const rows = ring(w, 3, 3);
    freezeEnemies(w);
    runTicks(w, 60);
    expect(s.cd).toBe(0);
    expect(s.armedT).toBeCloseTo(1, 1);
    expect(p.buffs.length).toBe(0);
    for (let i = 0; i < 3; i++) freezeEnemies(w), spawn(w, 'wolf', 0.5 + i * 0.3, 0.5);
    freezeEnemies(w);
    expect(rows.length).toBe(3);
    runTicks(w, 2);
    expect(p.buffs.length).toBe(1);
    expect(s.cd).toBeCloseTo(s.fp.cooldown, 1);
    expect(s.armedT).toBe(0);
    // lockout: even a pinned field does not recast before the cooldown is over
    const left = s.cd;
    runTicks(w, 60);
    expect(s.cd).toBeCloseTo(left - 1, 1);
  });

  it('patience relaxes the gate to engaged after patience seconds armed (x trig.patienceMul)', () => {
    const { w, p, s } = lab({ any: ['pinned'], patience: 3 });
    ring(w, 4, 6); // engaged (4 within 8 m) but not pinned
    freezeEnemies(w);
    runTicks(w, 150);
    expect(p.buffs.length).toBe(0);
    runTicks(w, 40);
    expect(p.buffs.length).toBe(1);

    const slow = lab({ any: ['pinned'], patience: 3 });
    slow.w.trig.patienceMul = 2;
    ring(slow.w, 4, 6);
    freezeEnemies(slow.w);
    runTicks(slow.w, 330);
    expect(slow.p.buffs.length).toBe(0);
    runTicks(slow.w, 60);
    expect(slow.p.buffs.length).toBe(1);

    // patience 0 / absent = never, however long it waits
    const never = lab({ any: ['pinned'] });
    ring(never.w, 4, 6);
    freezeEnemies(never.w);
    runTicks(never.w, 1200);
    expect(never.p.buffs.length).toBe(0);
    void s;
  });

  it('patience needs the hero engaged: an empty field never fires the fallback', () => {
    const { w, p } = lab({ any: ['pinned'], patience: 1 });
    runTicks(w, 300);
    expect(p.buffs.length).toBe(0);
  });

  it('minHp is a hard block, also against the patience fallback', () => {
    const { w, p } = lab({ any: ['pinned'], patience: 1, minHp: 0.5 });
    ring(w, 6, 2);
    freezeEnemies(w);
    p.hp = p.hpMax * 0.4;
    runTicks(w, 240);
    expect(p.buffs.length).toBe(0);
    p.hp = p.hpMax * 0.6;
    runTicks(w, 3);
    expect(p.buffs.length).toBe(1);
  });

  it('qaForceTriggers opens every gate (QA / test override), the plain cooldown applies', () => {
    const { w, p, s } = lab({ any: ['lethal'], minHp: 0.9 });
    p.hp = p.hpMax * 0.2;
    ring(w, 2, 5);
    freezeEnemies(w);
    runTicks(w, 30);
    expect(p.buffs.length).toBe(0);
    w.qaForceTriggers = true;
    runTicks(w, 2);
    expect(p.buffs.length).toBe(1);
    expect(s.cd).toBeGreaterThan(0);
  });

  it('the QA cast path (tools/qa/shot.ts --cast): cd 0 on the target + qaForceTriggers makes a gated skill auto-cast on the next tick', () => {
    const { w, p, s } = lab({ any: ['lethal'], minHp: 0.99 });
    const other = giveSkill(w, 'sword_arc');
    // the page.evaluate of --cast / --castStep: qaForceTriggers on, target cd 0, every other skill held
    w.qaForceTriggers = true;
    for (const k of p.skills) {
      if (k.def.id === 'will_to_live') k.cd = 0;
      else k.cd = Math.max(k.cd, 30);
    }
    p.hp = p.hpMax * 0.1; // the gate (a never-opening lethal kind, minHp .99) would stay shut without the override
    expect(other.cd).toBeGreaterThanOrEqual(30);
    runTicks(w, 2);
    expect(p.buffs).toHaveLength(1);
    expect(s.cd).toBeGreaterThan(0);
  });

  it('a gated selfBuff does not need a foe nearby (the legacy 12 m guard only protects ungated buffs)', () => {
    const gated = lab({ any: ['danger'] });
    gated.p.hp = gated.p.hpMax * 0.3;
    runTicks(gated.w, 3);
    expect(gated.p.buffs.length).toBe(1);
    const legacy = lab(undefined);
    runTicks(legacy.w, 30);
    expect(legacy.p.buffs.length).toBe(0);
  });

  it('armedT resets on a fire and the HUD ring walks cooling -> armed -> active -> cooling', () => {
    const { w, p, s } = lab({ any: ['pinned'] });
    s.cd = 1;
    runTicks(w, 2);
    expect(hud(w, 0).skills[0]?.state).toBe('cooling');
    runTicks(w, 70);
    const armed = hud(w, 0).skills[0];
    expect(armed?.state).toBe('armed');
    expect(armed?.activeLeft).toBe(0);
    expect(s.armedT).toBeGreaterThan(0);
    ring(w, 6, 2);
    freezeEnemies(w);
    runTicks(w, 2);
    const active = hud(w, 0).skills[0];
    expect(active?.state).toBe('active');
    expect(active?.activeLeft).toBeGreaterThan(6);
    expect(active?.activeLeft).toBeLessThanOrEqual(7);
    expect(s.armedT).toBe(0);
    runTicks(w, 8 * 60);
    expect(p.buffs.length).toBe(0);
    expect(hud(w, 0).skills[0]?.state).toBe('cooling');
  });

  it('an ungated skill never reads armed in the HUD', () => {
    const { w } = lab(undefined);
    runTicks(w, 5);
    const slot = hud(w, 0).skills[0];
    expect(slot?.state).toBe('cooling');
    expect(slot?.activeLeft).toBe(0);
  });

  it('a skill that is ready but whose cast declines keeps cd 0 (retried next tick)', () => {
    const { w, s } = lab({ any: ['engaged'] });
    ring(w, 4, 5);
    freezeEnemies(w);
    s.aux = w.time + 100; // window pretends to be up: cast() declines
    runTicks(w, 10);
    expect(s.cd).toBe(0);
  });
});

describe('Vigil (the standing bonus of an owned context skill)', () => {
  it('adds the skill vigil mods to the stats as soon as the skill is owned and drops them with it', () => {
    const w = makeWorld({
      content: (c) => {
        const d = c.skills.find((x) => x.id === 'will_to_live') as SkillDef;
        d.trigger = { any: ['danger'] };
        d.vigil = { armor: 4, regen: 0.5 };
      },
    });
    freezeSchedules(w);
    clearEnemies(w);
    dropSkills(w);
    const p = player(w);
    runTicks(w, 2);
    const armor0 = p.stats.armor;
    const regen0 = p.stats.regen;
    giveSkill(w, 'will_to_live');
    runTicks(w, 2);
    expect(p.stats.armor).toBeCloseTo(armor0 + 4, 6);
    expect(p.stats.regen).toBeCloseTo(regen0 + 0.5, 6);
    dropSkills(w);
    p.statsDirty = true;
    runTicks(w, 2);
    expect(p.stats.armor).toBeCloseTo(armor0, 6);
  });
});

describe('gate determinism', () => {
  it('an armed (gate shut) skill draws no RNG and does not shift the combat stream', () => {
    const run = (withSkill: boolean): unknown => {
      const { w } = lab({ any: ['pinned'] });
      if (!withSkill) dropSkills(w);
      ring(w, 3, 6); // engaged, never pinned: the skill stays armed
      freezeEnemies(w);
      runTicks(w, 240);
      return [w.rng.combat.getState(), w.rng.ai.getState(), w.rng.spawn.getState()];
    };
    expect(run(true)).toEqual(run(false));
  });

  it('two same-seed worlds with a gated skill stay bit-identical over 1800 ticks (bot driven)', () => {
    const play = (): string => {
      const w = makeWorld({
        content: (c) => {
          const d = c.skills.find((x) => x.id === 'will_to_live') as SkillDef;
          d.trigger = { any: ['pinned', 'hurt'], patience: 4 };
        },
      });
      giveSkill(w, 'will_to_live');
      const p = player(w);
      for (let t = 0; t < 1800 && !w.over; t++) {
        while (w.modal && w.modal.kind !== 'runEnd') w.chooseCard(0, w.modal.player);
        w.step([botInput(w, t)]);
      }
      return JSON.stringify([p.x, p.z, p.hp, w.enemies.count, w.tally.kills, w.tally.damageDealt, w.tally.damageTaken, w.rng.combat.getState()]);
    };
    expect(play()).toBe(play());
  });

  it('gate evaluation reads state only: calling the gate any number of times changes nothing', () => {
    const { w, p, s } = lab({ any: ['pinned', 'hurt', 'danger', 'elite', 'boss', 'volley', 'ally'] });
    ring(w, 6, 3);
    spawn(w, 'wolf', 0, 8, { tier: 1 });
    freezeEnemies(w);
    w.hash.rebuild(w.enemies);
    const before = JSON.stringify([w.rng.combat.getState(), p.hp, s.cd, s.armedT, w.enemies.count]);
    for (let i = 0; i < 50; i++) {
      p.ctx.tick = -1;
      gateOpen(w, p, s);
    }
    expect(JSON.stringify([w.rng.combat.getState(), p.hp, s.cd, s.armedT, w.enemies.count])).toBe(before);
    updateSkills(w);
  });
});
