// Skill-logic WP5 (DESIGN section 9, triggers.test.ts) on the SHIPPED content: the trigger table of skills.json, kind by kind, for every gated skill;
// patience, the HUD ring, the QA cast path of tools/qa/shot.ts for ALL gated skills, an armed kit drawing no RNG, and determinism of real-content
// kits over 3600 ticks (solo and co-op). The fixture-content mechanics (every kind on a scripted field, minHp, lockout, lethal arm ...) live in
// triggerGate.test.ts; this file proves the real table.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { SkillDef, TriggerKind } from '../../data/schema';
import { hud } from '../hud';
import { gateOpen, isInsuranceSkill, isLethalSkill, kindOpen, ringState } from '../skills/trigger';
import { gatedSkills, hero, only, realWorld, ringOf, scriptKind, stateHash, step, stepBot, wound, PARTNER } from './skillLab';

const PLAIN: Exclude<TriggerKind, 'lethal'>[] = ['engaged', 'pinned', 'hurt', 'danger', 'elite', 'boss', 'volley', 'ally'];
/** the kinds one scripted field makes true (the sim's own definitions: a pin is also an engagement, a boss is also an elite) */
const IMPLIED: Record<string, TriggerKind[]> = { pinned: ['pinned', 'engaged'], boss: ['boss', 'elite'] };

const GATED = gatedSkills();

describe('the shipped trigger table', () => {
  it('27 skills carry a trigger, War Oath is the only lethal one, nothing else is gated', () => {
    expect(GATED.length).toBe(27);
    expect(GATED.filter((s) => s.trigger?.any.includes('lethal')).map((s) => s.id)).toEqual(['war_oath']);
    for (const id of ['blaze_familiars', 'unbinding_sigil', 'swordlight_ring', 'haunted_steel']) expect(content.skills.find((s) => s.id === id)?.trigger, id).toBeUndefined();
  });

  it('INSURANCE skills (the calm static HUD rim) are exactly War Oath and Cure: emergency kinds only, no patience fallback', () => {
    expect(GATED.filter((d) => isInsuranceSkill({ def: d } as never)).map((d) => d.id).sort()).toEqual(['mending_light', 'war_oath']);
  });

  it('the HUD slot of an armed insurance skill is calm, every other armed skill pulses, a cooling or active one is never calm', () => {
    for (const id of ['war_oath', 'mending_light', 'graniteform', 'second_wind']) {
      const d = content.skills.find((s) => s.id === id) as SkillDef;
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s] = only(w, [id]);
      const idx = hero(w).skills.indexOf(s!);
      step(w, 2);
      const slot = hud(w, 0).skills[idx];
      expect(slot?.state, `${id} armed`).toBe('armed');
      expect(slot?.calm, `${id} calm`).toBe(id === 'war_oath' || id === 'mending_light');
      s!.cd = 5;
      expect(hud(w, 0).skills[idx]?.calm, `${id} on its lockout`).toBe(false);
    }
  });

  for (const d of GATED) {
    const kinds = d.trigger?.any ?? [];
    it(`${d.id}: the gate opens for exactly its kinds [${kinds.join(', ')}] and for nothing else on an otherwise empty field`, () => {
      const lethal = isLethalSkill({ def: d } as never);
      for (const kind of PLAIN) {
        // 'ally' needs a partner; every other field is solo
        const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a', coop: kind === 'ally' ? [PARTNER] : undefined });
        const [s] = only(w, [d.id]);
        const p = hero(w);
        scriptKind(w, kind, d.trigger?.n ?? 5);
        const opens = kinds.some((k) => (IMPLIED[kind] ?? [kind]).includes(k));
        expect(gateOpen(w, p, s!), `${d.id} on a '${kind}' field`).toBe(opens && !lethal);
      }
      // an empty field opens nothing, whatever the patience says (the fallback needs an engagement)
      const w0 = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s0] = only(w0, [d.id]);
      s0!.armedT = 1e6;
      expect(gateOpen(w0, hero(w0), s0!), `${d.id} armed forever on an empty field`).toBe(false);
    });
  }

  it('spec.n: the pinned count of a skill that names one is exact (n opens it, n - 1 does not)', () => {
    for (const d of GATED.filter((s) => s.trigger?.n !== undefined && s.trigger.any.includes('pinned') && !s.trigger.any.includes('engaged'))) {
      const n = d.trigger?.n as number;
      const open = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [so] = only(open, [d.id]);
      scriptKind(open, 'pinned', n);
      expect(gateOpen(open, hero(open), so!), `${d.id} with ${n}`).toBe(true);
      const shut = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [ss] = only(shut, [d.id]);
      scriptKind(shut, 'pinned', n - 1);
      expect(gateOpen(shut, hero(shut), ss!), `${d.id} with ${n - 1}`).toBe(false);
    }
  });

  for (const d of GATED.filter((s) => (s.trigger?.patience ?? 0) > 0)) {
    const pat = d.trigger?.patience as number;
    it(`${d.id}: patience ${pat} s relaxes the gate to a plain engagement, not a second earlier`, () => {
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s] = only(w, [d.id]);
      ringOf(w, 'wild_dog', 4, 6); // engaged but not pinned: only the fallback can open it
      // the fixture of skills that list 'engaged' themselves opens at once: nothing to wait for
      if (d.trigger?.any.includes('engaged')) return;
      w.hash.rebuild(w.enemies);
      s!.armedT = pat - 0.05;
      expect(gateOpen(w, hero(w), s!)).toBe(false);
      s!.armedT = pat;
      expect(gateOpen(w, hero(w), s!)).toBe(true);
    });
  }

  it('skills without a patience never relax: engaged for ever is not a trigger', () => {
    for (const d of GATED.filter((s) => !s.trigger?.any.includes('engaged') && !(s.trigger?.patience ?? 0) && !isLethalSkill({ def: s } as never))) {
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s] = only(w, [d.id]);
      ringOf(w, 'wild_dog', 4, 6);
      w.hash.rebuild(w.enemies);
      s!.armedT = 1e6;
      expect(gateOpen(w, hero(w), s!), d.id).toBe(false);
    }
  });

  it('dark_covenant: minHp 0.5 is a hard block even when pinned and out of patience', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'b' });
    const [s] = only(w, ['dark_covenant']);
    scriptKind(w, 'pinned', 8);
    expect(gateOpen(w, hero(w), s!)).toBe(true);
    hero(w).hp = hero(w).hpMax * 0.45;
    s!.armedT = 1e6;
    expect(gateOpen(w, hero(w), s!)).toBe(false);
  });
});

describe('HUD ring on the shipped skills', () => {
  it('every gated skill reads armed when ready with the gate shut, cooling after a fire, never armed without a trigger', () => {
    for (const d of GATED) {
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s] = only(w, [d.id]);
      const idx = hero(w).skills.indexOf(s!);
      step(w, 2);
      expect(hud(w, 0).skills[idx]?.state, `${d.id} ready and shut`).toBe('armed');
      s!.cd = 5;
      expect(ringState(s!, 0), `${d.id} on its lockout`).toBe('cooling');
    }
    for (const id of ['blaze_familiars', 'unbinding_sigil', 'swordlight_ring', 'haunted_steel']) {
      const d = content.skills.find((s) => s.id === id) as SkillDef;
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s] = only(w, [id]);
      expect(ringState(s!, 0), id).toBe('cooling');
    }
  });
});

describe('the QA cast path (tools/qa/shot.ts --cast / --castStep: cd 0 + World.qaForceTriggers)', () => {
  it('EVERY gated skill fires on the next ticks with the override on and a crowd in reach (the S4 builders measure casts this way)', () => {
    const missed: string[] = [];
    for (const d of GATED) {
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s] = only(w, [d.id]);
      hero(w).iframes = 1e9;
      w.qaForceTriggers = true;
      ringOf(w, 'wild_dog', 8, 3);
      s!.cd = 0;
      step(w, 12);
      // a fire starts the lockout (cd > 0) or, for the oath, leaves the skill spent; a window skill is active
      if (!(s!.cd > 0)) missed.push(d.id);
    }
    expect(missed, 'gated skills that did not fire under qaForceTriggers').toEqual([]);
  });

  it('without the override the same gated skills stay armed on an empty field (the override is the only difference)', () => {
    for (const d of GATED) {
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      const [s] = only(w, [d.id]);
      step(w, 12);
      expect(s!.cd, d.id).toBe(0);
    }
  });
});

describe('an armed kit draws no RNG and does not move the world', () => {
  it('a whole class kit of gated skills, ready and shut, leaves the combat / loot streams untouched for 600 ticks', () => {
    for (const [classId, doctrine] of [['ninja', 'a'], ['shaman', 'b'], ['warrior', 'b']] as const) {
      const ids = GATED.filter((s) => s.classId === classId && (s.doctrine === doctrine || s.doctrine === undefined) && s.role === undefined).map((s) => s.id);
      const a = realWorld({ classId, doctrine, seed: 3 });
      const b = realWorld({ classId, doctrine, seed: 3 });
      only(a, ids);
      only(b, []);
      step(a, 600);
      step(b, 600);
      expect(a.rng.combat.next(), `${classId}_${doctrine} combat stream`).toBe(b.rng.combat.next());
      const world = (w: typeof a): number[] => [hero(w).hp, hero(w).x, hero(w).z, hero(w).xp, w.enemies.count, w.projectiles.count, w.tally.damageTaken];
      expect(world(a), `${classId}_${doctrine} world`).toEqual(world(b));
    }
  });
});

describe('determinism with real-content kits', () => {
  const KITS: ['ninja' | 'yacha' | 'shaman', 'a' | 'b'][] = [['ninja', 'a'], ['yacha', 'a'], ['shaman', 'b']];
  for (const [classId, doctrine] of KITS) {
    it(`${classId}_${doctrine}: two same-seed worlds with every gated and role skill of the class stay bit-identical over 3600 ticks`, () => {
      const ids = content.skills.filter((s) => s.classId === classId && (s.doctrine === doctrine || s.doctrine === undefined) && (s.trigger !== undefined || s.role !== undefined)).map((s) => s.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);
      const mk = () => {
        const w = realWorld({ classId, doctrine, seed: 21, live: true, stats: { armor: 40, regen: 3 } });
        only(w, ids, 2);
        return w;
      };
      const a = mk();
      const b = mk();
      let at = 0;
      for (let chunk = 0; chunk < 12; chunk++) {
        stepBot(a, 300, at);
        stepBot(b, 300, at);
        at += 300;
        expect(stateHash(a), `${classId}_${doctrine} at ${(at / 60).toFixed(0)} s`).toBe(stateHash(b));
      }
      expect(a.rng.combat.next()).toBe(b.rng.combat.next());
    });
  }

  it('a co-op pair (shaman_b + warrior_b) with party wards, coil and legion stays bit-identical over 3600 ticks', () => {
    const mk = () => {
      const w = realWorld({ classId: 'shaman', doctrine: 'b', seed: 5, live: true, coop: [PARTNER], stats: { armor: 40, regen: 3 } });
      only(w, ['stormglass_shell', 'thunder_guardians', 'mending_light', 'tailwind', 'surging_arms'], 1, 0);
      only(w, ['graniteform', 'warfever', 'war_oath', 'cursed_legion'], 1, 1);
      return w;
    };
    const a = mk();
    const b = mk();
    for (let chunk = 0; chunk < 12; chunk++) {
      stepBot(a, 300, chunk * 300);
      stepBot(b, 300, chunk * 300);
      expect(stateHash(a), `co-op at ${(chunk + 1) * 5} s`).toBe(stateHash(b));
    }
  });
});

// Regression (review M1): the ring used to keep 8 blows, but PLAYER_IFRAMES = 0.55 s lets about eleven blows (and a 0.25 s hazard up to 24)
// fall inside the 6 s danger window, so a loss of 33 % of max HP in small blows read 24 % and the danger kind (lossFrac 25 %) stayed shut.
describe('the hurt ring window', () => {
  it('danger opens on a 33 % loss within 6 s made of eleven 3 % blows (the ring holds every blow of the window)', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a' });
    const [s] = only(w, ['nightshroud']);
    const p = hero(w);
    step(w, 3);
    p.stats.armor = 0;
    const HP = p.hpMax;
    for (let i = 0; i < 11; i++) {
      p.stats.armor = 0;
      wound(w, 0, 0.03);
      step(w, 33);
      p.hp = HP;
    }
    p.hp = HP * 0.7;
    expect(p.hurtSum(w.time, 6) / HP).toBeGreaterThanOrEqual(0.25);
    expect(kindOpen(w, p, s!, 'danger')).toBe(true);
  });
});
