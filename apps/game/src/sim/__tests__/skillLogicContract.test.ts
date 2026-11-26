// WP0 contract of the skill-logic redesign (DESIGN §6 WP0): schema keys, loader validation, params scaling, store fields,
// world lists (baits, corpse ring, qaForceTriggers) and the companions.ts stubs. Nothing here changes behaviour: the current
// content must load and resolve exactly as before; the new keys only matter once a skill declares them.

import { describe, expect, it } from 'vitest';
import type { ContentDB, SkillDef } from '../../data/schema';
import { DEFAULT_TRIGGERS, MAX_SKILL_RANK, resolveTriggers } from '../../data/schema';
import { content as realContent, validateContent } from '../../data/loader';
import { SchedKind } from '../scheduler';
import { applySkillLine } from '../skills';
import { dispatchMimic, endMarker, queueMimic, roleCast, roleTag, roleUpdate, spawnMarker } from '../skills/companions';
import { newFinalParams, resolveParams, wardAmount } from '../skills/params';
import { refreshStats } from '../stats';
import { CompanionRole, EnemyStore, HURT_RING, PlayerState, ProjectileStore, ProjKind, TRAIL_LEN, ZoneStore } from '../stores';
import { BaitList, CORPSE_RING, CorpseRing, MAX_BAITS } from '../world';
import { cloneContent } from '../__fixtures__/content';
import { dropSkills, giveSkill, makeWorld, player, runTicks } from './helpers';

function errorsOf(db: ContentDB): string[] {
  return validateContent(db).errors;
}

/** a clone of the real content with `fn` applied to the skill `id` */
function realWith(id: string, fn: (s: SkillDef) => void, balance?: (b: ContentDB['balance']) => void): string[] {
  const db = JSON.parse(JSON.stringify(realContent)) as ContentDB;
  const s = db.skills.find((x) => x.id === id);
  if (!s) throw new Error(`no skill ${id}`);
  fn(s);
  balance?.(db.balance);
  return errorsOf(db);
}

describe('trigger config', () => {
  it('resolveTriggers() with nothing is the in-code default, as a fresh deep copy', () => {
    const t = resolveTriggers();
    expect(t).toEqual(DEFAULT_TRIGGERS);
    expect(t.pinned).not.toBe(DEFAULT_TRIGGERS.pinned);
    t.pinned.n = 99;
    expect(DEFAULT_TRIGGERS.pinned.n).toBe(5);
  });

  it('balance.triggers overrides one level deep and keeps the rest of the defaults', () => {
    const t = resolveTriggers({ pinned: { n: 7 }, bait: false, refundCap: 0.2 });
    expect(t.pinned).toEqual({ n: 7, r: 4 });
    expect(t.bait).toBe(false);
    expect(t.refundCap).toBe(0.2);
    expect(t.engaged).toEqual({ n: 4, r: 8 });
    expect(t.mimic).toEqual({ cap: 3, window: 0.5 });
  });

  it('the design thresholds are the defaults', () => {
    expect(DEFAULT_TRIGGERS).toMatchObject({
      pinned: { n: 5, r: 4 },
      engaged: { n: 4, r: 8 },
      hurt: { frac: 0.06, window: 2 },
      danger: { hp: 0.4, lossFrac: 0.25, window: 6 },
      elite: { r: 10 },
      boss: { r: 14 },
      volley: { n: 2, r: 8 },
      ally: { r: 12, hp: 0.55 },
      refundCap: 0.35,
      extendCap: 0.5,
      stackCap: 0.6,
      veilRepick: 16,
      lethalGuard: 2.5,
      bait: true,
    });
  });

  it('every world carries its resolved config', () => {
    const w = makeWorld();
    expect(w.trig).toEqual(DEFAULT_TRIGGERS);
    const w2 = makeWorld({ content: (c) => (c.balance.triggers = { bait: false, elite: { r: 12 } }) });
    expect(w2.trig.bait).toBe(false);
    expect(w2.trig.elite.r).toBe(12);
    expect(w2.trig.boss.r).toBe(14);
  });
});

describe('loader: skill-logic keys', () => {
  it('the shipped content validates', () => {
    expect(errorsOf(realContent)).toEqual([]);
  });

  it('accepts trigger, role, vigil and every payload key', () => {
    const errs = realWith('blaze_familiars', (s) => {
      s.role = 'orbiter';
      s.trigger = { any: ['pinned', 'hurt', 'danger'], patience: 6, n: 7, hp: 0.55, minHp: 0.5 };
      s.vigil = { evasion: 0.04, resist: { physical: -0.15 } };
      Object.assign(s.params, {
        veil: 3, taunt: 6, shield: 11, burst: 4, power: 100, drain: 1, mirror: 4, steady: 1, party: 14, nova: 3.5, novaDamage: 1,
        cost: 12, mark: 3, pulse: 1.5, stack: 2, extend: 0.3, refund: 0.1, purge: 6, missing: 2, leech: 25,
      });
    });
    expect(errs).toEqual([]);
  });

  it('rejects bad trigger specs', () => {
    expect(realWith('nightshroud', (s) => (s.trigger = { any: [] }))).toEqual([expect.stringContaining('trigger.any')]);
    expect(realWith('nightshroud', (s) => (s.trigger = { any: ['panic' as never] }))).toEqual([expect.stringContaining("trigger kind 'panic'")]);
    expect(realWith('nightshroud', (s) => (s.trigger = { any: ['pinned', 'pinned'] }))).toEqual([expect.stringContaining('listed twice')]);
    expect(realWith('nightshroud', (s) => (s.trigger = { any: ['pinned'], patience: -1 }))).toEqual([expect.stringContaining('patience')]);
    expect(realWith('nightshroud', (s) => (s.trigger = { any: ['pinned'], n: 2.5 }))).toEqual([expect.stringContaining('trigger.n')]);
    expect(realWith('nightshroud', (s) => (s.trigger = { any: ['danger'], hp: 0 }))).toEqual([expect.stringContaining('trigger.hp')]);
    expect(realWith('nightshroud', (s) => (s.trigger = { any: ['danger'], minHp: 1 }))).toEqual([expect.stringContaining('trigger.minHp')]);
    expect(realWith('nightshroud', (s) => (s.trigger = { any: ['pinned'], extra: 1 } as never))).toEqual([expect.stringContaining('trigger.extra')]);
  });

  it('rejects a trigger on a basic attack or a permanent aura', () => {
    const basic = realContent.skills.find((s) => s.kind === 'basic');
    expect(basic).toBeDefined();
    expect(realWith(basic!.id, (s) => (s.trigger = { any: ['engaged'] }))).toEqual([expect.stringContaining('basic attack')]);
    const aura = realContent.skills.find((s) => s.behavior === 'persistentAura' && s.kind !== 'basic');
    expect(aura).toBeDefined();
    expect(realWith(aura!.id, (s) => (s.trigger = { any: ['engaged'] }))).toEqual([expect.stringContaining('permanent aura')]);
  });

  it('rejects unknown roles and roles outside summon', () => {
    expect(realWith('blaze_familiars', (s) => (s.role = 'swarm' as never))).toEqual([expect.stringContaining("role 'swarm'")]);
    expect(realWith('nightshroud', (s) => (s.role = 'orbiter'))).toEqual([expect.stringContaining("needs behavior 'summon'")]);
  });

  it('rejects bad payload numbers and a bad vigil', () => {
    expect(realWith('nightshroud', (s) => (s.params.veil = -1))).toEqual([expect.stringContaining('params.veil')]);
    expect(realWith('nightshroud', (s) => (s.params.shield = Number.NaN))).toEqual([expect.stringContaining('params.shield')]);
    expect(realWith('nightshroud', (s) => (s.params.mark = 2.5))).toEqual([expect.stringContaining('params.mark')]);
    expect(realWith('nightshroud', (s) => (s.params.drain = 2))).toEqual([expect.stringContaining('params.drain')]);
    expect(realWith('nightshroud', (s) => (s.vigil = { evasion: 'x' as never }))).toEqual([expect.stringContaining('vigil')]);
    expect(realWith('nightshroud', (s) => (s.vigil = { bogus: 1 } as never))).toEqual([expect.stringContaining("unknown StatMods key 'bogus'")]);
  });

  it('allows negative resist inside a buff / vigil', () => {
    const errs = realWith('nightshroud', (s) => {
      s.params.buff = { resist: { fire: -0.15, ice: -0.15 } };
      s.vigil = { resist: { physical: -0.1 } };
    });
    expect(errs).toEqual([]);
  });

  it('validates balance.triggers', () => {
    const bal = (fn: (b: ContentDB['balance']) => void): string[] => realWith('nightshroud', () => undefined, fn);
    expect(bal((b) => (b.triggers = { pinned: { n: 6, r: 4.5 }, bait: false, patienceMul: 1.2 }))).toEqual([]);
    expect(bal((b) => (b.triggers = { bogus: 1 } as never))).toEqual([expect.stringContaining("unknown key 'bogus'")]);
    expect(bal((b) => (b.triggers = { pinned: { q: 1 } } as never))).toEqual([expect.stringContaining("unknown key 'pinned.q'")]);
    expect(bal((b) => (b.triggers = { bait: 1 } as never))).toEqual([expect.stringContaining('bait must be a boolean')]);
    expect(bal((b) => (b.triggers = { hurt: { frac: 0 } }))).toEqual([expect.stringContaining('hurt.frac')]);
    expect(bal((b) => (b.triggers = { refundCap: 1.5 }))).toEqual([expect.stringContaining('refundCap')]);
    expect(bal((b) => (b.triggers = { elite: { r: -2 } }))).toEqual([expect.stringContaining('elite.r')]);
    expect(bal((b) => (b.triggers = { pinned: 4 } as never))).toEqual([expect.stringContaining('pinned must be an object')]);
  });
});

describe('params: payload keys', () => {
  function paramsFor(patch: (s: SkillDef) => void, id = 'will_to_live') {
    const w = makeWorld({ content: (c) => patch(c.skills.find((s) => s.id === id) as SkillDef) });
    dropSkills(w);
    const s = giveSkill(w, id);
    return { w, s, p: player(w), fp: () => resolveParams(player(w), s, newFinalParams()) };
  }

  it('a skill that declares none of the new keys resolves them all to 0 (nova / novaDamage as before)', () => {
    const { fp } = paramsFor(() => undefined);
    const r = fp();
    for (const k of ['veil', 'taunt', 'shield', 'shieldFlat', 'burst', 'power', 'drain', 'mirror', 'steady', 'party', 'cost', 'mark', 'pulse', 'stack', 'extend', 'refund', 'purge', 'missing', 'leech', 'nova'] as const) {
      expect(r[k], k).toBe(0);
    }
    expect(r.novaDamage).toBe(0.6);
  });

  it('percent-like keys become fractions; plain keys pass through', () => {
    const r = paramsFor((s) => Object.assign(s.params, { power: 150, cost: 12, stack: 2, leech: 25, party: 14, mirror: 4, taunt: 7, extend: 0.3, refund: 0.1, pulse: 1.5, purge: 6, missing: 2, mark: 3, drain: 1, steady: 1 })).fp();
    expect(r.power).toBeCloseTo(1.5, 9);
    expect(r.cost).toBeCloseTo(0.12, 9);
    expect(r.stack).toBeCloseTo(0.02, 9);
    expect(r.leech).toBeCloseTo(0.25, 9);
    expect([r.party, r.mirror, r.taunt, r.extend, r.refund, r.pulse, r.purge, r.missing, r.mark, r.drain, r.steady]).toEqual([14, 4, 7, 0.3, 0.1, 1.5, 6, 2, 3, 1, 1]);
  });

  it('nova and burst scale with the area multipliers; the awakening nova stays unscaled and the larger one wins', () => {
    const t = paramsFor((s) => {
      Object.assign(s.params, { nova: 4, burst: 3, novaDamage: 1 });
      s.awaken.params = { nova: 6, novaDamage: 0.8 };
    });
    t.p.fixed.push({ area: 0.5 });
    refreshStats(t.p, t.w.content, t.w.ix);
    const base = t.fp();
    expect(base.nova).toBeCloseTo(4 * 1.5, 6);
    expect(base.burst).toBeCloseTo(3 * 1.5, 6);
    expect(base.novaDamage).toBe(1);
    t.s.rank = MAX_SKILL_RANK;
    const awake = t.fp();
    expect(awake.nova).toBeCloseTo(Math.max(4 * 1.5, 6), 6); // the base nova (6) ties the awakening nova (6)
    expect(awake.novaDamage).toBe(0.8);
    t.p.fixed.length = 0;
    refreshStats(t.p, t.w.content, t.w.ix);
    expect(t.fp().nova).toBe(6);
  });

  it('veil scales with duration / base duration', () => {
    const t = paramsFor((s) => {
      s.params.veil = 3;
      s.params.duration = 5;
    });
    expect(t.fp().veil).toBeCloseTo(3, 9);
    applySkillLine(t.s, { stat: 'duration', mode: 'pct', value: 0.2 });
    expect(t.fp().duration).toBeCloseTo(6, 9);
    expect(t.fp().veil).toBeCloseTo(3.6, 9);
  });

  it('shield: fraction of the holder max HP x (1 + heal pct) plus the flat heal lines and healAdd; no instant heal without a base heal', () => {
    const t = paramsFor((s) => {
      s.params.shield = 10;
      delete s.params.heal;
      s.awaken.params = { healAdd: 4 };
    });
    expect(t.fp().shield).toBeCloseTo(0.1, 9);
    expect(t.fp().heal).toBe(0);
    applySkillLine(t.s, { stat: 'heal', mode: 'pct', value: 0.5 });
    applySkillLine(t.s, { stat: 'heal', mode: 'flat', value: 3 });
    const r = t.fp();
    expect(r.shield).toBeCloseTo(0.15, 9);
    expect(r.shieldFlat).toBeCloseTo(3, 9);
    expect(r.heal).toBe(0); // the heal lines grow the ward, they do not heal
    expect(wardAmount(r, 200)).toBeCloseTo(0.15 * 200 + 3, 9);
    t.s.rank = MAX_SKILL_RANK;
    expect(t.fp().shieldFlat).toBeCloseTo(7, 9);
    expect(wardAmount(newFinalParams(), 200)).toBe(0);
  });

  it('a skill with both a base heal and a shield keeps its instant heal', () => {
    const t = paramsFor((s) => {
      s.params.shield = 12;
      s.params.heal = 20;
    });
    expect(t.fp().heal).toBeCloseTo(20, 9);
    expect(t.fp().shield).toBeCloseTo(0.12, 9);
  });
});

describe('stores', () => {
  it('PlayerState starts with every shell field idle', () => {
    const p = new PlayerState();
    expect([p.ward, p.wardMax, p.wardT, p.wardAbsorbed, p.veilT, p.dodgeN, p.dodgeT, p.steadyT, p.mirrorT, p.mirrorR, p.dmgRecent, p.hurtN, p.trailN]).toEqual(new Array(13).fill(0));
    expect([p.wardSlot, p.wardOwner, p.lethalSlot]).toEqual([-1, -1, -1]);
    expect(p.hurtT.length).toBe(HURT_RING);
    expect(p.trail.length).toBe(TRAIL_LEN * 3);
    expect(p.ctx.tick).toBe(-1);
  });

  it('hurt ring keeps the last HURT_RING blows and sums a window', () => {
    const p = new PlayerState();
    expect(p.hurtSum(10, 2)).toBe(0);
    p.pushHurt(1, 5);
    p.pushHurt(2, 7);
    p.pushHurt(9.5, 3);
    expect(p.hurtSum(10, 2)).toBe(3);
    expect(p.hurtSum(10, 8.5)).toBe(10);
    expect(p.hurtSum(10, 20)).toBe(15);
    for (let i = 0; i < HURT_RING + 12; i++) p.pushHurt(20 + i, 1);
    expect(p.hurtN).toBe(HURT_RING + 15);
    expect(p.hurtSum(80, 100)).toBe(HURT_RING); // old entries were overwritten
  });

  it('trail ring returns the newest entry and clamps to the oldest', () => {
    const p = new PlayerState();
    expect(p.trailOffset(0)).toBe(-1);
    for (let i = 0; i < 5; i++) p.pushTrail(i, -i, i * 0.1);
    let o = p.trailOffset(0);
    expect([p.trail[o], p.trail[o + 1]]).toEqual([4, -4]);
    o = p.trailOffset(2);
    expect(p.trail[o]).toBe(2);
    o = p.trailOffset(99);
    expect(p.trail[o]).toBe(0); // clamped to the oldest recorded
    for (let i = 5; i < 200; i++) p.pushTrail(i, 0, 0);
    expect(p.trail[p.trailOffset(0)]).toBe(199);
    expect(p.trail[p.trailOffset(TRAIL_LEN - 1)]).toBe(199 - (TRAIL_LEN - 1));
    expect(p.trail[p.trailOffset(1000)]).toBe(199 - (TRAIL_LEN - 1)); // clamped to the oldest still stored
  });

  it('new store columns are zeroed on alloc and survive swap-remove', () => {
    const P = new ProjectileStore(8);
    const a = P.alloc();
    P.role[a] = CompanionRole.Orbiter;
    P.anchor[a] = 2;
    P.aux3[a] = 1.5;
    P.kind[a] = ProjKind.Marker;
    const b = P.alloc();
    expect([P.role[b], P.anchor[b], P.aux3[b]]).toEqual([0, 0, 0]);
    P.free(a);
    expect([P.role[0], P.anchor[0], P.aux3[0], P.kind[0]]).toEqual([0, 0, 0, 0]); // the last row (b) moved into row 0
    const Z = new ZoneStore(4);
    const z = Z.alloc();
    expect(Z.mul[z]).toBe(0);
    const E = new EnemyStore(4);
    const e = E.alloc();
    E.purgedUntil[e] = 12;
    E.free(e);
    expect(E.purgedUntil[E.alloc()]).toBe(0);
  });

  it('addSkill initialises the new instance fields', () => {
    const w = makeWorld();
    dropSkills(w);
    const s = giveSkill(w, 'will_to_live');
    expect([s.armedT, s.refunded, s.pets]).toEqual([0, 0, []]);
    const t = giveSkill(w, 'sword_arc');
    expect(t.pets).not.toBe(s.pets);
  });

  it('ProjKind.Marker rows are inert in the projectile step (they only expire with their life)', () => {
    const w = makeWorld();
    const P = w.projectiles;
    const r = P.alloc();
    P.kind[r] = ProjKind.Marker;
    P.anchor[r] = 255; // stationary: anchor 0 would follow hero 0 (WP2 markerStep)
    P.life[r] = 0.2;
    P.x[r] = 3;
    runTicks(w, 5);
    expect(P.count).toBe(1);
    expect(P.x[0]).toBe(3);
    runTicks(w, 20);
    expect(P.count).toBe(0);
  });
});

describe('world lists', () => {
  it('qaForceTriggers is off by default', () => {
    expect(makeWorld().qaForceTriggers).toBe(false);
  });

  it('BaitList: add order, in-place refresh by key, expiry keeps order, capacity, nearest', () => {
    const b = new BaitList();
    expect(b.add(0, 0, 5, 1, 11)).toBe(true);
    expect(b.add(10, 0, 5, 2, 22)).toBe(true);
    expect(b.add(0, 10, 5, 3, 0)).toBe(true);
    expect(b.add(0, 11, 5, 3, 0)).toBe(true); // key 0 never refreshes
    expect(b.count).toBe(4);
    expect(b.add(1, 1, 6, 5, 11)).toBe(true); // refresh
    expect(b.count).toBe(4);
    expect([b.x[0], b.r[0], b.left[0]]).toEqual([1, 6, 5]);
    b.tick(1.5);
    expect(b.count).toBe(4); // nothing expired yet
    b.tick(0.6); // 22 had 2 s: gone
    expect(b.count).toBe(3);
    expect([b.key[0], b.key[1], b.key[2]]).toEqual([11, 0, 0]);
    expect(b.nearest(1.5, 1.5)).toBe(0);
    expect(b.nearest(40, 40)).toBe(-1);
    expect(b.nearest(1 + 5, 1, 0.5)).toBe(-1); // half radius: 3 m reach, the point is 5 m away
    for (let i = 0; i < MAX_BAITS + 4; i++) b.add(i, i, 1, 9, 100 + i);
    expect(b.count).toBe(MAX_BAITS);
    expect(b.add(0, 0, 1, 1, 999)).toBe(false);
    expect(b.add(0, 0, 1, 1, 100)).toBe(true); // an existing key still refreshes when full
  });

  it('world.addBait obeys the kill switch and expires inside step()', () => {
    const w = makeWorld();
    expect(w.addBait(5, 5, 6, 0.1, 7)).toBe(true);
    expect(w.baits.count).toBe(1);
    runTicks(w, 3);
    expect(w.baits.count).toBe(1);
    runTicks(w, 10);
    expect(w.baits.count).toBe(0);
    const off = makeWorld({ content: (c) => (c.balance.triggers = { bait: false }) });
    expect(off.addBait(5, 5, 6, 1, 7)).toBe(false);
    expect(off.baits.count).toBe(0);
  });

  it('CorpseRing keeps the 16 newest kills, newest first', () => {
    const c = new CorpseRing();
    for (let i = 0; i < 5; i++) c.push(i, -i, i * 0.5, i % 2);
    expect(c.count).toBe(5);
    expect(c.x[c.at(0)]).toBe(4);
    expect(c.x[c.at(4)]).toBe(0);
    for (let i = 5; i < 40; i++) c.push(i, 0, i, 0);
    expect(c.count).toBe(CORPSE_RING);
    expect(c.x[c.at(0)]).toBe(39);
    expect(c.x[c.at(CORPSE_RING - 1)]).toBe(39 - (CORPSE_RING - 1));
    expect(c.t[c.at(2)]).toBe(37);
    c.clear();
    expect(c.count).toBe(0);
  });

  it('world.addCorpse stamps the sim time and killer', () => {
    const w = makeWorld();
    runTicks(w, 30);
    w.addCorpse(3, 4, 1);
    const i = w.corpses.at(0);
    expect([w.corpses.x[i], w.corpses.z[i], w.corpses.owner[i]]).toEqual([3, 4, 1]);
    expect(w.corpses.t[i]).toBeCloseTo(w.time, 9);
  });
});

describe('companions.ts entry points on a skill without a role', () => {
  it('a plain skill has no role brain: roleCast says "not handled", nothing queues, nothing throws', () => {
    const w = makeWorld();
    dropSkills(w);
    const p = player(w);
    const s = giveSkill(w, 'soul_crash');
    const fp = newFinalParams();
    expect(() => endMarker(w, 0)).not.toThrow();
    expect(() => endMarker(w, 12345)).not.toThrow();
    expect(roleCast(w, p, s, fp)).toBeNull();
    expect(() => roleUpdate(w, p, s, fp)).not.toThrow();
    queueMimic(w, p, s, fp, 0, 1);
    expect(w.sched.count).toBe(0);
    expect(() => dispatchMimic(w, { kind: SchedKind.Mimic, owner: 0, slot: s.slot, n: 0, x: 0, z: 0, dx: 0, dz: 1, f: 0 })).not.toThrow();
  });

  it('spawnMarker returns a stable handle for a row that follows its holder (WP2)', () => {
    const w = makeWorld();
    dropSkills(w);
    const p = player(w);
    const s = giveSkill(w, 'soul_crash');
    s.cd = 1e9;
    const before = w.projectiles.count;
    const h = spawnMarker(w, p, s.slot, 'sk.gen.veil_ring', 1, 3, true);
    expect(h).not.toBe(0);
    expect(w.projectiles.count).toBe(before + 1);
    expect(w.projectiles.find(h)).toBeGreaterThanOrEqual(0);
  });

  it('a stray Mimic schedule entry is ignored by the dispatcher', () => {
    const w = makeWorld();
    dropSkills(w);
    const s = giveSkill(w, 'sword_arc');
    expect(w.sched.add(w.time, SchedKind.Mimic, 0, s.slot, 0, 0, 0, 0, 1, 0)).toBe(true);
    expect(() => runTicks(w, 2)).not.toThrow();
    expect(w.sched.count).toBe(0);
  });

  it('roleTag maps content roles to row tags (planted: knight when it has a taunt radius)', () => {
    const fp = newFinalParams();
    expect(roleTag(undefined, fp)).toBe(CompanionRole.Chaser);
    expect(roleTag('orbiter', fp)).toBe(CompanionRole.Orbiter);
    expect(roleTag('coil', fp)).toBe(CompanionRole.Coil);
    expect(roleTag('hunter', fp)).toBe(CompanionRole.Hunter);
    expect(roleTag('mimic', fp)).toBe(CompanionRole.Mimic);
    expect(roleTag('planted', fp)).toBe(CompanionRole.Pylon);
    expect(roleTag('planted', { ...fp, taunt: 7 })).toBe(CompanionRole.Knight);
  });
});

describe('fixture content is untouched by the contract', () => {
  it('the fixture database has no trigger, role, vigil or payload key', () => {
    const keys = new Set(['veil', 'taunt', 'shield', 'burst', 'power', 'drain', 'mirror', 'steady', 'party', 'nova', 'novaDamage', 'cost', 'mark', 'pulse', 'stack', 'extend', 'refund', 'purge', 'missing', 'leech']);
    for (const s of cloneContent().skills) {
      expect(s.trigger, s.id).toBeUndefined();
      expect(s.role, s.id).toBeUndefined();
      expect(s.vigil, s.id).toBeUndefined();
      for (const k of Object.keys(s.params)) expect(keys.has(k), `${s.id}.${k}`).toBe(false);
    }
  });
});
