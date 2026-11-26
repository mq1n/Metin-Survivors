// Skill behaviors: all 16 BehaviorKinds on the fixture skills (generic contract + per-behavior geometry/timing).
// Controlled lab world: schedules frozen, hero at (0,0) facing +Z, no crits, only the skill under test, immobile
// high-hp "anchor" dummies (no attacks, no speed, huge mass) so damage/geometry can be asserted exactly.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { BehaviorKind, ContentDB, EnemyDef, SkillParams, StatMods } from '../../data/schema';
import { DT } from '../constants';
import type { SimEvent, SimEventType } from '../events';
import type { RunConfig } from '../run';
import { applySkillLine, castNow, cooldownFrac } from '../skills';
import { hurtPlayer } from '../combat';
import { newFinalParams, resolveParams, type FinalParams } from '../skills/params';
import { refreshStats } from '../stats';
import { EnemyState, ProjKind, StatusBit, StatusIdx, ZoneKind, type PlayerInput, type SkillInstance } from '../stores';
import { createWorld, type World } from '../world';
import { NO_INPUT, clearEnemies, dropSkills, findNonFinite, freezeSchedules, giveSkill, makeWorld, player, spawn } from './helpers';

// ---------------------------------------------------------------------------
// lab helpers

function addDummies(c: ContentDB): void {
  const wolf = c.enemies.find((e) => e.id === 'wolf');
  if (!wolf) throw new Error('fixture wolf missing');
  const base: EnemyDef = { ...wolf, attacks: [], speed: 0, hp: 1e7, damage: 0 };
  c.enemies.push({ ...base, id: 'anchor', mass: 1e6 }, { ...base, id: 'puppet', mass: 1 }, { ...base, id: 'heavy', mass: 3 });
}

interface LabOpts {
  seed?: number;
  config?: Partial<RunConfig>;
  content?: (c: ContentDB) => void;
}

/** world with only the hero (no skills, no crit), schedules frozen */
function lab(opts: LabOpts = {}): World {
  const w = makeWorld({
    config: { seed: opts.seed ?? 11, ...opts.config },
    content: (c) => {
      addDummies(c);
      opts.content?.(c);
    },
  });
  freezeSchedules(w);
  dropSkills(w);
  const p = player(w);
  p.fixed.push({ critChance: -1 });
  refreshStats(p, w.content, w.ix);
  return w;
}

interface Rec {
  tick: number;
  time: number;
  ev: SimEvent;
}
interface Tagged<T extends SimEventType> {
  tick: number;
  time: number;
  ev: Extract<SimEvent, { t: T }>;
}

/** step n ticks, recording copies of every event (events are pooled); `each` runs after every step */
function run(w: World, ticks: number, input: PlayerInput = NO_INPUT, each?: (k: number) => void): Rec[] {
  const out: Rec[] = [];
  for (let k = 0; k < ticks; k++) {
    w.step([input]);
    if (w.modals.length > 0) throw new Error('unexpected modal in lab world');
    for (const e of w.events) out.push({ tick: w.tick, time: w.time, ev: { ...e } });
    each?.(k);
  }
  return out;
}

function of<T extends SimEventType>(recs: readonly Rec[], t: T): Tagged<T>[] {
  return recs.filter((r) => r.ev.t === t) as unknown as Tagged<T>[];
}

/** direct (non-DoT) skill damage events of `s` */
function hitsOf(recs: readonly Rec[], s: SkillInstance, targetId?: number): Tagged<'damage'>[] {
  return of(recs, 'damage').filter((r) => r.ev.skill === s.slot && !r.ev.dot && (targetId === undefined || r.ev.targetId === targetId));
}

function castsOf(recs: readonly Rec[], s: SkillInstance): Tagged<'skillCast'>[] {
  return of(recs, 'skillCast').filter((r) => r.ev.skill === s.slot);
}

const eid = (w: World, row: number): number => w.enemies.id[row] as number;

/** spawn an enemy of `def` and return its stable id */
function put(w: World, def: string, x: number, z: number): number {
  return eid(w, spawn(w, def, x, z));
}
const anchor = (w: World, x: number, z: number): number => put(w, 'anchor', x, z);

function rowOf(w: World, id: number): number {
  const r = w.enemies.find(id);
  if (r < 0) throw new Error('enemy is gone');
  return r;
}
function posOf(w: World, id: number): { x: number; z: number } {
  const r = rowOf(w, id);
  return { x: w.enemies.x[r] as number, z: w.enemies.z[r] as number };
}
function setPos(w: World, id: number, x: number, z: number): void {
  const r = rowOf(w, id);
  w.enemies.x[r] = x;
  w.enemies.z[r] = z;
}

/** polar helper: bearing `theta` rad from +Z, distance d from the hero */
const polar = (d: number, theta: number): [number, number] => [d * Math.sin(theta), d * Math.cos(theta)];

/** step until `pred` is true (checked after every step); returns the ticks stepped, or -1 on timeout */
function until(w: World, pred: () => boolean, max: number): number {
  for (let k = 1; k <= max; k++) {
    w.step([NO_INPUT]);
    if (w.modals.length > 0) throw new Error('unexpected modal in lab world');
    if (pred()) return k;
  }
  return -1;
}

/** per-tick hook: once `s` has cast, park its cooldown so the test sees a single cast */
function oneShot(w: World, s: SkillInstance): () => void {
  return () => {
    if (w.events.some((e) => e.t === 'skillCast' && e.skill === s.slot)) s.cd = 1e9;
  };
}

/** the skill's resolved parameters right now */
function fpOf(w: World, s: SkillInstance): FinalParams {
  return resolveParams(player(w), s, newFinalParams());
}

function projectilesOf(w: World, kind: ProjKind, s?: SkillInstance): number[] {
  const P = w.projectiles;
  const out: number[] = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === kind && (!s || P.skill[i] === s.slot)) out.push(i);
  return out;
}
function zonesOf(w: World, kind: ZoneKind, s?: SkillInstance): number[] {
  const Z = w.zones;
  const out: number[] = [];
  for (let i = 0; i < Z.count; i++) if (Z.kind[i] === kind && (!s || Z.skill[i] === s.slot)) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// generic contract: every fixture skill (2 basics + 16 actives = all 16 BehaviorKinds)

interface Case {
  id: string;
  behavior: BehaviorKind;
  /** where the target dummy stands (hero at the origin) */
  at: [number, number];
  /** does the skill hurt the dummy */
  damages: boolean;
}

const CASES: Case[] = [
  { id: 'sword_arc', behavior: 'meleeArc', at: [0, 2], damages: true },
  { id: 'lightning_trio', behavior: 'meleeArc', at: [0, 2], damages: true },
  { id: 'bladewheel', behavior: 'spinAura', at: [0, 2], damages: true },
  { id: 'fury_aura', behavior: 'persistentAura', at: [0, 2], damages: true },
  { id: 'lunge', behavior: 'dash', at: [0, 2], damages: true },
  { id: 'spirit_bolt', behavior: 'projectile', at: [0, 6], damages: true },
  { id: 'aura_sword', behavior: 'projectile', at: [0, 6], damages: true },
  { id: 'war_leap', behavior: 'leap', at: [0, 6], damages: true },
  { id: 'soul_crash', behavior: 'homingProjectile', at: [0, 6], damages: true },
  { id: 'sky_blades', behavior: 'skyStrike', at: [0, 6], damages: true },
  { id: 'chain_lightning', behavior: 'chain', at: [0, 5], damages: true },
  { id: 'sword_circle', behavior: 'orbit', at: [0, 2], damages: true },
  { id: 'frost_cleave', behavior: 'cone', at: [0, 3], damages: true },
  { id: 'phantom_blades', behavior: 'summon', at: [0, 5], damages: true },
  { id: 'soul_beam', behavior: 'beam', at: [0, 5], damages: true },
  { id: 'arc_of_might', behavior: 'shockwave', at: [0, 2], damages: true },
  { id: 'will_to_live', behavior: 'selfBuff', at: [0, 5], damages: false },
  { id: 'venom_pool', behavior: 'groundZone', at: [0, 5], damages: true },
];

describe('fixture coverage', () => {
  it('the cases cover every BehaviorKind', () => {
    const kinds = new Set(CASES.map((c) => c.behavior));
    expect(kinds.size).toBe(16);
    const w = lab();
    for (const c of CASES) expect(w.ix.skills.get(c.id)?.behavior).toBe(c.behavior);
  });
});

describe.each(CASES)('$id ($behavior): generic contract', (c) => {
  it('with a target in range it fires within its first cooldown, damages, emits cast/sfx/vfx and goes on cooldown', () => {
    const w = lab();
    const p = player(w);
    p.hp = 100; // so selfBuff's heal is observable
    const s = giveSkill(w, c.id);
    const def = s.def;
    const target = anchor(w, c.at[0], c.at[1]);
    const seen = new Set<string>();
    let castTick = -1;
    let cdAtCast = NaN;
    const recs = run(w, 360, NO_INPUT, () => {
      for (let i = 0; i < w.zones.count; i++) seen.add(w.strings.name(w.zones.preset[i] as number));
      for (let i = 0; i < w.projectiles.count; i++) seen.add(w.strings.name(w.projectiles.style[i] as number));
      if (castTick < 0 && w.events.some((e) => e.t === 'skillCast' && e.skill === s.slot)) {
        castTick = w.tick;
        cdAtCast = s.cd;
      }
    });
    for (const r of recs) if (r.ev.t === 'vfx') seen.add(r.ev.preset);

    if (c.behavior === 'persistentAura') {
      // passive: the aura is created on the first tick, no cooldown involved
      expect(castTick).toBe(1);
    } else {
      // fires within its first (initial) cooldown: 0.25 s for the first skill
      expect(castTick).toBeGreaterThanOrEqual(14);
      expect(castTick).toBeLessThanOrEqual(20);
    }

    // skillCast carries identity, owner and presentation hints
    const cast = castsOf(recs, s)[0]!.ev;
    expect(cast.player).toBe(0);
    expect(cast.skillId).toBe(def.id);
    expect(cast.behavior).toBe(def.behavior);
    expect(cast.heroClip).toBe(def.heroClip ?? '');
    expect(cast.awakened).toBe(false);
    expect(cast.area).toBeGreaterThan(0);
    expect(Number.isFinite(cast.x) && Number.isFinite(cast.z) && Number.isFinite(cast.dirX) && Number.isFinite(cast.dirZ)).toBe(true);
    expect(Math.hypot(cast.dirX, cast.dirZ)).toBeCloseTo(1, 3);

    // an sfx event with the skill's sound is emitted together with the cast (not for the always-on aura)
    if (c.behavior !== 'persistentAura') {
      const sfx = of(recs, 'sfx').filter((r) => r.ev.id === def.sfx);
      expect(sfx.length).toBeGreaterThan(0);
      expect(sfx[0]!.tick).toBe(castTick);
      expect(sfx[0]!.ev.vol).toBeGreaterThan(0);
    }

    // vfx presentation: an event, a zone row or a projectile row references the skill's preset
    expect(seen.has(def.vfx)).toBe(true);

    if (c.damages) {
      const hits = hitsOf(recs, s, target);
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.ev.amount).toBeGreaterThan(0);
        expect(h.ev.player).toBe(0);
        expect(h.ev.crit).toBe(false);
        expect(h.ev.targetId).toBe(target);
        expect(h.tick).toBeGreaterThanOrEqual(castTick);
      }
      // nothing but this skill ever damaged the dummy
      expect(of(recs, 'damage').every((r) => r.ev.skill === s.slot)).toBe(true);
      // damage is credited to the skill (damage meter)
      expect(s.damage).toBeGreaterThan(0);
    } else {
      expect(of(recs, 'damage').length).toBe(0);
      // 3 = a skill heal on an ally / a cone leech, 5 = HealSource.CastSelf: the caster's own cast heal of a self buff (the heal route draws no holy.heal for it)
      const heals = of(recs, 'heal').filter((r) => r.ev.source === 3 || r.ev.source === 5);
      expect(heals.length).toBeGreaterThan(0);
    }

    if (c.behavior === 'persistentAura') {
      // permanent: never on a cooldown
      expect(cooldownFrac(s)).toBe(0);
    } else {
      // the cooldown starts at the cast tick with the resolved cooldown
      expect(cdAtCast).toBeCloseTo(s.fp.cooldown, 6);
      expect(cooldownFrac(s)).toBeGreaterThanOrEqual(0);
      expect(cooldownFrac(s)).toBeLessThanOrEqual(1);
    }
  });

  it('with no target in range it does not fire and keeps its cooldown ready', () => {
    const w = lab();
    const s = giveSkill(w, c.id);
    const far = anchor(w, 0, 40);
    const recs = run(w, 200);
    if (c.behavior === 'persistentAura') {
      // the aura needs no target: exactly one cast event (its creation) and no damage to a far dummy
      expect(castsOf(recs, s).length).toBe(1);
      expect(hitsOf(recs, s, far).length).toBe(0);
      return;
    }
    expect(castsOf(recs, s).length).toBe(0);
    expect(of(recs, 'sfx').length).toBe(0);
    expect(of(recs, 'damage').length).toBe(0);
    expect(w.zones.count).toBe(0);
    expect(w.projectiles.count).toBe(0);
    // no target → the cooldown was never consumed: it sits at 0 ...
    expect(s.cd).toBe(0);
    // ... so as soon as a target appears the skill fires on the very next tick
    const near = anchor(w, c.at[0], c.at[1]);
    expect(near).not.toBe(far);
    const first = run(w, 1);
    expect(castsOf(first, s).length).toBe(1);
    expect(s.cd).toBeGreaterThan(0);
  });

  it('with no enemy at all it stays silent', () => {
    const w = lab();
    const s = giveSkill(w, c.id);
    const recs = run(w, 120);
    expect(of(recs, 'damage').length).toBe(0);
    if (c.behavior === 'persistentAura') return;
    expect(castsOf(recs, s).length).toBe(0);
    expect(s.cd).toBe(0);
  });
});

describe('cooldown pacing', () => {
  const pacing = CASES.filter((c) => c.behavior !== 'persistentAura');
  it.each(pacing)('$id recasts exactly one resolved cooldown after the previous cast', (c) => {
    const w = lab();
    const s = giveSkill(w, c.id);
    anchor(w, c.at[0], c.at[1]);
    const cd = s.def.params.cooldown;
    const ticks = Math.ceil(cd / DT) * 2 + 60;
    const casts = castsOf(run(w, ticks), s).map((r) => r.tick);
    expect(casts.length).toBeGreaterThanOrEqual(2);
    const gap = casts[1]! - casts[0]!;
    // cd is re-armed with the resolved cooldown (= base here), counted down one DT per tick
    expect(gap).toBeGreaterThanOrEqual(Math.floor(cd / DT));
    expect(gap).toBeLessThanOrEqual(Math.ceil(cd / DT) + 2);
  });
});

// ---------------------------------------------------------------------------
// meleeArc

describe('meleeArc', () => {
  it('hits everything inside the arc in front of the hero and nothing beside / behind / out of reach', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_arc'); // area 2.6 (reach), angle 2.0 rad (±1.0), dmg 14
    const front = anchor(w, 0, 1.9); // nearest → aim = +Z
    const right = anchor(w, ...polar(2.0, 0.9)); // inside ±1.0
    const left = anchor(w, ...polar(2.0, -1.15)); // outside ±1.0
    const side = anchor(w, 2.0, 0); // 90°
    const behind = anchor(w, 0, -2.1);
    const far = anchor(w, 0, 3.5); // reach 2.6 + body ≈ 3.15
    const recs = run(w, 24);
    const hit = (id: number): number => hitsOf(recs, s, id).length;
    expect([hit(front), hit(right)]).toEqual([1, 1]);
    expect([hit(left), hit(side), hit(behind), hit(far)]).toEqual([0, 0, 0, 0]);
    for (const h of hitsOf(recs, s)) expect(h.ev.amount).toBeCloseTo(14, 6);
  });

  it('the arc points at the nearest target, not at the hero facing', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_arc');
    const near = anchor(w, -2.0, 0); // facing is +Z; the arc must swing toward -X
    const opposite = anchor(w, 2.2, 0);
    const recs = run(w, 24);
    expect(hitsOf(recs, s, near).length).toBe(1);
    expect(hitsOf(recs, s, opposite).length).toBe(0);
    const cast = castsOf(recs, s)[0]!.ev;
    expect(cast.dirX).toBeCloseTo(-1, 3);
    expect(cast.dirZ).toBeCloseTo(0, 3);
  });

  it('arc width and reach come from the skill params (angle 2.2 / reach 3.0 vs 2.0 / 2.6)', () => {
    const place = (w: World): { wide: number; deep: number; front: number } => ({
      front: anchor(w, 0, 1.9),
      wide: anchor(w, ...polar(2.0, 1.05)), // 60.2°: outside ±57.3°, inside ±63.0°
      deep: anchor(w, 0, 3.4), // beyond 2.6 + body, inside 3.0 + body
    });
    const w1 = lab();
    const arc = giveSkill(w1, 'sword_arc');
    const a = place(w1);
    const r1 = run(w1, 24);
    expect(hitsOf(r1, arc, a.wide).length).toBe(0);
    expect(hitsOf(r1, arc, a.deep).length).toBe(0);
    expect(hitsOf(r1, arc, a.front).length).toBe(1);

    const w2 = lab();
    const cut = giveSkill(w2, 'lightning_trio', 0);
    const b = place(w2);
    const r2 = run(w2, 24);
    expect(hitsOf(r2, cut, b.wide).length).toBeGreaterThan(0);
    expect(hitsOf(r2, cut, b.deep).length).toBeGreaterThan(0);
  });

  it('combo: `count` swings are scheduled 0.14 s apart, alternate handedness and re-aim at a moved target', () => {
    const w = lab();
    const s = giveSkill(w, 'lightning_trio'); // count 2
    applySkillLine(s, { stat: 'count', mode: 'flat', value: 1 }); // → 3 swings
    const t = anchor(w, 0, 2);
    const k = until(w, () => w.events.some((e) => e.t === 'skillCast'), 60);
    expect(k).toBeGreaterThan(0);
    // two follow-up swings queued for the cast tick
    expect(w.sched.count).toBe(2);
    const castTime = w.time;
    setPos(w, t, -2, 0); // the target moves: the next swings must follow it
    const recs = run(w, 40);
    const hits = hitsOf(recs, s, t);
    // swing 1 already happened on the cast tick (before the move); two more land on the moved target
    expect(hits.length).toBe(2);
    expect(hits[0]!.time - castTime).toBeCloseTo(0.14, 1);
    expect(hits[1]!.time - castTime).toBeCloseTo(0.28, 1);
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(24, 6);
    // vfx handedness alternates: + (cast swing, not recorded), then - and +
    const vfx = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_lightning_trio');
    expect(vfx.length).toBe(2);
    expect(Math.sign(vfx[0]!.ev.scale)).toBe(-1);
    expect(Math.sign(vfx[1]!.ev.scale)).toBe(1);
    expect(w.sched.count).toBe(0);
  });

  it('a two-swing combo deals exactly two hits to a stationary target', () => {
    const w = lab();
    const s = giveSkill(w, 'lightning_trio');
    const t = anchor(w, 0, 2);
    const recs = run(w, 40);
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(2);
    expect((hits[1]!.tick - hits[0]!.tick) * DT).toBeCloseTo(0.14, 1);
    // only the first swing emits a skillCast
    expect(castsOf(recs, s).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// spinAura

describe('spinAura', () => {
  it('spawns a Spin zone that follows the hero, with the skill radius/tick/damage, and expires after `duration`', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'bladewheel'); // r 3.0, dur 2.5, tick 0.3, dmg 16
    anchor(w, 0, 2);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = zonesOf(w, ZoneKind.Spin, s);
    expect(rows.length).toBe(1);
    const Z = w.zones;
    const z = rows[0]!;
    expect(Z.team[z]).toBe(0);
    expect(Z.follow[z]).toBe(1);
    expect(Z.radius[z]).toBeCloseTo(3.0, 5);
    expect(Z.tick[z]).toBeCloseTo(0.3, 5);
    expect(Z.damage[z]).toBeCloseTo(16, 5);
    expect(Z.dur[z]).toBeCloseTo(2.5, 5);
    expect(Z.id[z]).toBe(s.h1);
    // follows the hero while it walks
    for (let k = 0; k < 60; k++) {
      w.step([{ moveX: 1, moveZ: 0 }]);
      const row = w.zones.find(s.h1);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(w.zones.x[row]).toBeCloseTo(p.x, 4);
      expect(w.zones.z[row]).toBeCloseTo(p.z, 4);
    }
    expect(p.x).toBeGreaterThan(3);
    // ends after the duration
    run(w, 120);
    expect(w.zones.find(s.h1)).toBe(-1);
    expect(zonesOf(w, ZoneKind.Spin).length).toBe(0);
  });

  it('ticks every `tick` seconds for the whole spin, only inside the ring', () => {
    const w = lab();
    const s = giveSkill(w, 'bladewheel');
    const inside = anchor(w, 0, 3.3); // 3.0 + body radius ≈ 3.55
    const outside = anchor(w, 0, -4.0);
    const recs = run(w, 200);
    const hits = hitsOf(recs, s, inside);
    // first tick after ~0.08 s then every 0.3 s while the spin lasts (2.5 s) → 9 hits
    expect(hits.length).toBeGreaterThanOrEqual(8);
    expect(hits.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < hits.length; i++) {
      const gap = hits[i]!.time - hits[i - 1]!.time;
      expect(gap).toBeGreaterThanOrEqual(0.27);
      expect(gap).toBeLessThanOrEqual(0.34);
    }
    expect(hits[hits.length - 1]!.time - hits[0]!.time).toBeLessThan(2.5);
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(16, 6);
    expect(hitsOf(recs, s, outside).length).toBe(0);
  });

  it('a recast while the ring is alive refreshes it instead of stacking a second zone', () => {
    const w = lab();
    const s = giveSkill(w, 'bladewheel');
    anchor(w, 0, 2);
    run(w, 20);
    expect(zonesOf(w, ZoneKind.Spin, s).length).toBe(1);
    const id = s.h1;
    run(w, 60); // zone age ≈ 1 s
    const row = w.zones.find(id);
    expect(w.zones.t[row]).toBeGreaterThan(0.9);
    s.cd = 0; // force a recast attempt
    run(w, 1);
    expect(zonesOf(w, ZoneKind.Spin, s).length).toBe(1);
    expect(s.h1).toBe(id);
    expect(w.zones.t[w.zones.find(id)]).toBeLessThan(0.05);
  });

  it('upgrade lines shorten the tick (-10% → 0.27 s) and widen the ring', () => {
    const w = lab();
    const s = giveSkill(w, 'bladewheel');
    applySkillLine(s, { stat: 'tick', mode: 'pct', value: 0.1 });
    applySkillLine(s, { stat: 'area', mode: 'pct', value: 0.5 });
    anchor(w, 0, 2);
    run(w, 20);
    const z = zonesOf(w, ZoneKind.Spin, s)[0]!;
    expect(w.zones.tick[z]).toBeCloseTo(0.27, 5);
    expect(w.zones.radius[z]).toBeCloseTo(4.5, 5);
  });
});

// ---------------------------------------------------------------------------
// persistentAura

describe('persistentAura', () => {
  it('exists permanently from the first tick (no target needed), follows the hero and is cast once', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'fury_aura'); // r 3.4, tick 0.5, dmg 12
    w.step([NO_INPUT]);
    const rows = zonesOf(w, ZoneKind.Aura, s);
    expect(rows.length).toBe(1);
    const id = s.h1;
    expect(id).not.toBe(0);
    const Z = w.zones;
    expect(Z.follow[rows[0]!]).toBe(1);
    expect(Z.team[rows[0]!]).toBe(0);
    expect(Z.radius[rows[0]!]).toBeCloseTo(3.4, 5);
    expect(Z.tick[rows[0]!]).toBeCloseTo(0.5, 5);
    expect(Z.damage[rows[0]!]).toBeCloseTo(12, 5);
    expect(Z.dur[rows[0]!]).toBeGreaterThan(1e6);
    const recs = run(w, 3000, { moveX: 0.6, moveZ: -0.8 });
    expect(castsOf(recs, s).length).toBe(0); // the single cast event happened on tick 1
    const row = w.zones.find(id);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(w.zones.x[row]).toBeCloseTo(p.x, 4);
    expect(w.zones.z[row]).toBeCloseTo(p.z, 4);
    expect(zonesOf(w, ZoneKind.Aura).length).toBe(1);
  });

  it('ticks damage every `tick` seconds inside the radius only and applies its slow', () => {
    const w = lab();
    const s = giveSkill(w, 'fury_aura');
    const inside = anchor(w, 3.2, 0); // 3.4 + body ≈ 3.95
    const outside = anchor(w, -4.3, 0);
    const recs = run(w, 300);
    const hits = hitsOf(recs, s, inside);
    expect(hits.length).toBeGreaterThanOrEqual(9);
    expect(hits.length).toBeLessThanOrEqual(10);
    expect(hits[0]!.time).toBeGreaterThanOrEqual(0.49);
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.time - hits[i - 1]!.time).toBeCloseTo(0.5, 1);
    for (const h of hits) {
      expect(h.ev.amount).toBeCloseTo(12, 6);
      expect(h.ev.element).toBe(4); // dark
    }
    expect(hitsOf(recs, s, outside).length).toBe(0);
    // slow status (power 0.25) on the enemy inside, none outside
    const e = w.enemies;
    expect((e.status[rowOf(w, inside)]! & StatusBit.Slow) !== 0).toBe(true);
    expect(e.statP[rowOf(w, inside) * 8 + StatusIdx.Slow]).toBeCloseTo(0.25, 5);
    expect(e.status[rowOf(w, outside)]).toBe(0);
  });

  it('tracks live parameter changes (upgrade lines, player stats, awakening) on the existing zone', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'fury_aura');
    run(w, 5);
    const id = s.h1;
    const read = (): { r: number; tick: number; dmg: number } => {
      const row = w.zones.find(id);
      expect(row).toBeGreaterThanOrEqual(0);
      return { r: w.zones.radius[row] as number, tick: w.zones.tick[row] as number, dmg: w.zones.damage[row] as number };
    };
    expect(read()).toEqual({ r: expect.closeTo(3.4, 5), tick: expect.closeTo(0.5, 5), dmg: expect.closeTo(12, 5) });

    applySkillLine(s, { stat: 'area', mode: 'pct', value: 0.5 });
    applySkillLine(s, { stat: 'damage', mode: 'pct', value: 0.18 });
    applySkillLine(s, { stat: 'tick', mode: 'pct', value: 0.08 });
    run(w, 1);
    expect(read()).toEqual({ r: expect.closeTo(5.1, 5), tick: expect.closeTo(0.46, 5), dmg: expect.closeTo(14.16, 5) });
    expect(s.h1).toBe(id); // same zone, updated in place

    p.fixed.push({ area: 0.2, damage: 0.5 });
    refreshStats(p, w.content, w.ix);
    run(w, 1);
    expect(read()).toEqual({ r: expect.closeTo(5.1 * 1.2, 4), tick: expect.closeTo(0.46, 5), dmg: expect.closeTo(14.16 * 1.5, 4) });

    s.rank = 7; // awakening: damage ×1.3, area ×1.3
    run(w, 1);
    expect(read()).toEqual({ r: expect.closeTo(5.1 * 1.2 * 1.3, 4), tick: expect.closeTo(0.46, 5), dmg: expect.closeTo(14.16 * 1.5 * 1.3, 4) });
  });

  it('is rebuilt if its zone row is lost', () => {
    const w = lab();
    const s = giveSkill(w, 'fury_aura');
    run(w, 5);
    const old = s.h1;
    w.zones.clear();
    run(w, 1);
    expect(zonesOf(w, ZoneKind.Aura, s).length).toBe(1);
    expect(s.h1).not.toBe(old);
  });
});

// ---------------------------------------------------------------------------
// dash

describe('dash', () => {
  it('dashes ~range toward the target with i-frames and hits everything on the path exactly once', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'lunge'); // range 6, speed 24, area 1.4, dmg 30
    const a = anchor(w, 0, 2);
    const b = anchor(w, 0.4, 4.4);
    const off = anchor(w, 3.4, 3); // lateral 3.4 > 1.4 + body
    const behind = anchor(w, 0, -2.5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    expect(p.dashT).toBeCloseTo(6 / 24, 5);
    expect(p.dashSlot).toBe(s.slot);
    expect(p.iframes).toBeGreaterThan(p.dashT);
    // no damage can get through while dashing
    expect(hurtPlayer(w, 0, 50, 0, 5, 0, 0)).toBe(false);
    const hp = p.hp;
    const recs: Rec[] = [];
    const iframes: boolean[] = [];
    for (let k = 0; k < 14; k++) {
      recs.push(...run(w, 1));
      iframes.push(p.iframes > 0);
    }
    expect(iframes.every(Boolean)).toBe(true);
    recs.push(...run(w, 30));
    expect(p.hp).toBe(hp);
    expect(p.dashT).toBe(0);
    // travelled ≈ range along +Z
    expect(p.z).toBeGreaterThan(5.9);
    expect(p.z).toBeLessThan(6.5);
    expect(Math.abs(p.x)).toBeLessThan(0.05);
    // i-frames are over shortly after the dash; the hero is vulnerable again
    expect(p.iframes).toBeLessThanOrEqual(0);
    for (const id of [a, b]) {
      const hits = hitsOf(recs, s, id);
      expect(hits.length).toBe(1);
      expect(hits[0]!.ev.amount).toBeCloseTo(30, 6);
    }
    expect(hitsOf(recs, s, off).length).toBe(0);
    expect(hitsOf(recs, s, behind).length).toBe(0);
    // the first hero-vulnerable hit now goes through
    expect(hurtPlayer(w, 0, 20, 0, 5, 0, 0)).toBe(true);
    expect(p.hp).toBeLessThan(hp);
  });

  it('dashes along the move input when the hero is steering, along the aim otherwise', () => {
    // idle hero: aim direction (the target is straight ahead on +Z)
    const idle = lab();
    const pi = player(idle);
    giveSkill(idle, 'lunge');
    anchor(idle, 0, 3);
    expect(until(idle, () => idle.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    expect(pi.dashVz).toBeCloseTo(24, 3);
    expect(pi.dashVx).toBeCloseTo(0, 3);

    // steering hero: the dash goes along the input (+X) even though the target is on +Z
    const w = lab();
    const p = player(w);
    giveSkill(w, 'lunge');
    anchor(w, 0, 3);
    const steer: PlayerInput = { moveX: 1, moveZ: 0 };
    let x0 = NaN;
    let cast = false;
    for (let k = 0; k < 60 && !cast; k++) {
      w.step([steer]);
      cast = w.events.some((e) => e.t === 'skillCast');
      if (cast) x0 = p.x;
    }
    expect(cast).toBe(true);
    expect(p.dashVx).toBeCloseTo(24, 3);
    expect(p.dashVz).toBeCloseTo(0, 3);
    run(w, 16, steer);
    expect(p.dashT).toBe(0);
    expect(p.x - x0).toBeGreaterThan(5.9);
    expect(p.z).toBeCloseTo(0, 2);
  });

  it('upgrade lines extend the range and the dash distance follows', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'lunge');
    applySkillLine(s, { stat: 'range', mode: 'pct', value: 0.5 }); // 6 → 9
    anchor(w, 0, 2);
    run(w, 60);
    expect(p.z).toBeGreaterThan(8.9);
    expect(p.z).toBeLessThan(9.6);
  });
});

// ---------------------------------------------------------------------------
// projectile

/** heading (rad from +Z) of projectile row i */
const heading = (w: World, i: number): number => Math.atan2(w.projectiles.vx[i] as number, w.projectiles.vz[i] as number);

describe('projectile', () => {
  it('fires `count` bolts fanned by `angle` around the aim with the resolved speed/pierce/damage/radius', () => {
    const w = lab();
    const s = giveSkill(w, 'aura_sword'); // count 2, angle 0.2, speed 17, pierce 1, area 0.45, dmg 20
    anchor(w, ...polar(12, 0.5)); // far enough that the bolts do not touch it in the first ticks
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const P = w.projectiles;
    const rows = projectilesOf(w, ProjKind.Bolt, s);
    expect(rows.length).toBe(2);
    const angles = rows.map((r) => heading(w, r)).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(0.4, 5);
    expect(angles[1]).toBeCloseTo(0.6, 5);
    for (const r of rows) {
      expect(Math.hypot(P.vx[r] as number, P.vz[r] as number)).toBeCloseTo(17, 4);
      expect(P.pierce[r]).toBe(1);
      expect(P.radius[r]).toBeCloseTo(0.45, 5);
      expect(P.damage[r]).toBeCloseTo(20, 5);
      expect(P.owner[r]).toBe(0);
      expect(P.hostile[r]).toBe(0);
      expect(P.element[r]).toBe(7); // wind
      expect(P.lifeMax[r]).toBeCloseTo(14 / 17 + 0.15, 5);
    }
  });

  it('count upgrades and the +projectiles stat widen the fan (spacing = angle)', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'aura_sword');
    applySkillLine(s, { stat: 'count', mode: 'flat', value: 1 }); // 3
    p.fixed.push({ projectiles: 2 }); // +2 → 5
    refreshStats(p, w.content, w.ix);
    anchor(w, 0, 13.5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = projectilesOf(w, ProjKind.Bolt, s);
    expect(rows.length).toBe(5);
    const angles = rows.map((r) => heading(w, r)).sort((a, b) => a - b);
    angles.forEach((a, i) => expect(a).toBeCloseTo((i - 2) * 0.2, 5));
  });

  it('bolts live for ~range/speed and then vanish without hitting anything', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'spirit_bolt'); // range 14, speed 16
    const t = anchor(w, 0, 12); // inside the 14 m trigger
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    s.cd = 1e9; // single cast
    setPos(w, t, 0, -30); // the target steps out of the way: the bolt flies on to the end of its range
    let far = 0;
    let ticks = 0;
    const recs: Rec[] = [];
    while (projectilesOf(w, ProjKind.Bolt, s).length > 0 && ticks < 200) {
      for (const r of projectilesOf(w, ProjKind.Bolt, s)) {
        far = Math.max(far, Math.hypot((w.projectiles.x[r] as number) - p.x, (w.projectiles.z[r] as number) - p.z));
      }
      recs.push(...run(w, 1));
      ticks++;
    }
    expect(hitsOf(recs, s).length).toBe(0);
    // lifetime = range/speed + a 0.15 s grace (one tick already elapsed on the cast tick)
    expect(ticks * DT).toBeGreaterThan(14 / 16);
    expect(ticks * DT).toBeLessThan(14 / 16 + 0.15 + 0.1);
    // and it travelled about `range` (+ the muzzle offset and the grace)
    expect(far).toBeGreaterThan(14);
    expect(far).toBeLessThan(14 + 0.15 * 16 + 1.5);
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [5, 3],
  ])('pierce %i passes through %i of three aligned enemies and hits each at most once', (pierce, expectedHits) => {
    const w = lab();
    const s = giveSkill(w, 'spirit_bolt'); // pierce 0, dmg 12, count 1
    if (pierce > 0) applySkillLine(s, { stat: 'pierce', mode: 'flat', value: pierce });
    const ids = [anchor(w, 0, 3), anchor(w, 0, 6.5), anchor(w, 0, 10)];
    const recs = run(w, 100, NO_INPUT, oneShot(w, s));
    const hits = ids.map((id) => hitsOf(recs, s, id));
    // hit memory: the bolt overlaps each body for several ticks but damages it once
    hits.forEach((h, i) => expect(h.length).toBe(i < expectedHits ? 1 : 0));
    for (const h of hits.flat()) expect(h.ev.amount).toBeCloseTo(12, 6);
    expect(projectilesOf(w, ProjKind.Bolt, s).length).toBe(0);
  });

  it('player stats propagate: +projectiles, +pierce, +projSpeed, +damage, +area', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'spirit_bolt'); // 1 bolt, pierce 0, speed 16, area 0.4, dmg 12
    p.fixed.push({ projectiles: 2, pierce: 1, projSpeed: 0.5, damage: 0.5, area: 0.5 });
    refreshStats(p, w.content, w.ix);
    anchor(w, 0, 13.5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = projectilesOf(w, ProjKind.Bolt, s);
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(Math.hypot(w.projectiles.vx[r] as number, w.projectiles.vz[r] as number)).toBeCloseTo(24, 3);
      expect(w.projectiles.pierce[r]).toBe(1);
      expect(w.projectiles.damage[r]).toBeCloseTo(18, 4);
      expect(w.projectiles.radius[r]).toBeCloseTo(0.6, 4);
    }
  });

  it('awakened bolts explode on impact (r 1.8, 70% damage) and hit 25% harder', () => {
    const w = lab();
    const s = giveSkill(w, 'spirit_bolt', 7); // explode 1.8, damageMul 1.25
    const a = anchor(w, 0, 6);
    const b = anchor(w, 1.5, 6.0); // not on the bolt line (lateral 1.5 > 0.4 + body), inside the blast
    const c = anchor(w, -4, 6.0); // outside the blast
    const recs = run(w, 60);
    const direct = hitsOf(recs, s, a).map((h) => h.ev.amount);
    expect(direct.length).toBe(2); // bolt (15) + blast (10.5)
    expect(direct[0]).toBeCloseTo(12 * 1.25, 5);
    expect(direct[1]).toBeCloseTo(12 * 1.25 * 0.7, 5);
    const splash = hitsOf(recs, s, b);
    expect(splash.length).toBe(1);
    expect(splash[0]!.ev.amount).toBeCloseTo(12 * 1.25 * 0.7, 5);
    expect(hitsOf(recs, s, c).length).toBe(0);
    const boom = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_explode');
    expect(boom.length).toBe(1);
    expect(boom[0]!.ev.scale).toBeCloseTo(1.8, 5);
  });
});

// ---------------------------------------------------------------------------
// homingProjectile

describe('homingProjectile', () => {
  it('spawns `count` homing bolts (kind Homing) with the skill stats', () => {
    const w = lab();
    const s = giveSkill(w, 'soul_crash'); // count 2, speed 11, dmg 22, angle 0.25
    anchor(w, 0, 13);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = projectilesOf(w, ProjKind.Homing, s);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(w.projectiles.damage[r]).toBeCloseTo(22, 5);
      expect(Math.hypot(w.projectiles.vx[r] as number, w.projectiles.vz[r] as number)).toBeCloseTo(11, 4);
      expect(w.projectiles.target[r]).not.toBe(0);
    }
    expect(projectilesOf(w, ProjKind.Bolt).length).toBe(0);
  });

  it('steers toward a target that moved (turn rate ≤ 7 rad/s) and hits it; a straight bolt misses', () => {
    const homing = lab();
    const hs = giveSkill(homing, 'soul_crash');
    const ht = anchor(homing, 0, 8);
    expect(until(homing, () => homing.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    hs.cd = 1e9;
    const ids = projectilesOf(homing, ProjKind.Homing, hs).map((r) => homing.projectiles.id[r] as number);
    setPos(homing, ht, 5, 5); // bearing ≈ 55° off the launch direction
    let prev = ids.map((id) => heading(homing, homing.projectiles.find(id)));
    let maxTurn = 0;
    let turned = 0;
    const recs: Rec[] = [];
    for (let k = 0; k < 90; k++) {
      recs.push(...run(homing, 1));
      ids.forEach((id, n) => {
        const row = homing.projectiles.find(id);
        if (row < 0) return;
        const h = heading(homing, row);
        const d = Math.abs(h - (prev[n] as number));
        maxTurn = Math.max(maxTurn, d);
        turned += h - (prev[n] as number);
        prev[n] = h;
      });
    }
    expect(hitsOf(recs, hs, ht).length).toBeGreaterThan(0);
    expect(turned).toBeGreaterThan(0.5); // net bend toward +X
    expect(maxTurn).toBeLessThanOrEqual(7 * DT + 1e-3);

    const straight = lab();
    const ss = giveSkill(straight, 'spirit_bolt');
    const st = anchor(straight, 0, 8);
    expect(until(straight, () => straight.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    ss.cd = 1e9;
    setPos(straight, st, 5, 5);
    const srecs = run(straight, 90);
    expect(hitsOf(srecs, ss, st).length).toBe(0);
  });

  it('both bolts of a volley land on their target (1 hit each, 22 damage)', () => {
    const w = lab();
    const s = giveSkill(w, 'soul_crash');
    const t = anchor(w, 0, 7);
    const recs = run(w, 120);
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(2);
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(22, 6);
    expect(projectilesOf(w, ProjKind.Homing).length).toBe(0);
  });

  it('awakening adds two orbs and +20% damage', () => {
    const w = lab();
    const s = giveSkill(w, 'soul_crash', 7); // countAdd 2 → 4, damageMul 1.2
    const t = anchor(w, 0, 7);
    const recs = run(w, 120);
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(4);
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(22 * 1.2, 5);
  });
});

// ---------------------------------------------------------------------------
// skyStrike

describe('skyStrike', () => {
  it('queues `count` delayed Strike zones on distinct enemies, staggered by `tick`, then each blast hits its target once', () => {
    const w = lab();
    const s = giveSkill(w, 'sky_blades'); // count 4, area 2.0, tick 0.12, dmg 28
    const targets = [anchor(w, 0, 6), anchor(w, 7.5, 6), anchor(w, -7.5, 6), anchor(w, 0, 12)];
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const castTick = w.tick;
    const rows = zonesOf(w, ZoneKind.Strike, s);
    expect(rows.length).toBe(4);
    const Z = w.zones;
    const delays = rows.map((r) => Z.delay[r] as number).sort((a, b) => a - b);
    delays.forEach((d, i) => expect(d).toBeCloseTo(0.42 + i * 0.12, 5));
    // one strike per distinct enemy position, with the skill radius/damage
    const spots = rows.map((r) => `${(Z.x[r] as number).toFixed(2)},${(Z.z[r] as number).toFixed(2)}`).sort();
    expect(new Set(spots).size).toBe(4);
    for (const r of rows) {
      expect(Z.team[r]).toBe(0);
      expect(Z.radius[r]).toBeCloseTo(2.0, 5);
      expect(Z.damage[r]).toBeCloseTo(28, 5);
      expect(Z.dur[r]).toBeCloseTo((Z.delay[r] as number) + 0.35, 5);
      const match = targets.some((id) => {
        const q = posOf(w, id);
        return Math.hypot(q.x - (Z.x[r] as number), q.z - (Z.z[r] as number)) < 1e-3;
      });
      expect(match).toBe(true);
    }
    const recs = run(w, 80);
    // nothing lands before the first delay (0.42 s)
    const all = hitsOf(recs, s);
    expect(all.length).toBe(4);
    const times = all.map((h) => (h.tick - castTick) * DT).sort((a, b) => a - b);
    expect(times[0]).toBeGreaterThanOrEqual(0.41);
    expect(times[0]).toBeLessThanOrEqual(0.46);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeCloseTo(0.12, 1);
    for (const id of targets) {
      const h = hitsOf(recs, s, id);
      expect(h.length).toBe(1);
      expect(h[0]!.ev.amount).toBeCloseTo(28, 6);
    }
    // the vfx marks the impact
    expect(of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_sky_blades').length).toBe(4);
    // zones are gone once the strike has landed
    run(w, 30);
    expect(zonesOf(w, ZoneKind.Strike).length).toBe(0);
  });

  it('with fewer enemies than strikes the extra blasts repeat on the same enemy (jittered ≤ 1.2 m)', () => {
    const w = lab();
    const s = giveSkill(w, 'sky_blades');
    const t = anchor(w, 0, 6);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = zonesOf(w, ZoneKind.Strike, s);
    expect(rows.length).toBe(4);
    const dists = rows.map((r) => Math.hypot((w.zones.x[r] as number) - 0, (w.zones.z[r] as number) - 6)).sort((a, b) => a - b);
    expect(dists[0]).toBeLessThan(1e-3); // the first one is exactly on the enemy
    for (const d of dists) expect(d).toBeLessThanOrEqual(1.2 * Math.SQRT2 + 1e-3);
    const recs = run(w, 80);
    expect(hitsOf(recs, s, t).length).toBe(4);
  });

  it('only enemies within `range` are picked as targets, and a blast hurts exactly the bodies inside its radius', () => {
    const w = lab({
      content: (c) => {
        const def = c.skills.find((d) => d.id === 'sky_blades');
        if (def) def.params.count = 1; // a single blade, so the blast position is unambiguous
      },
    });
    const s = giveSkill(w, 'sky_blades'); // range 14, blast radius 2.0
    const target = anchor(w, 0, 13.5); // the only candidate (≤ 14 + body)
    const inner = anchor(w, 0, 15.8); // out of range as a target, 2.3 m from the blast centre: inside 2.0 + body
    const outer = anchor(w, 0, 16.7); // 3.2 m from the blast centre: outside
    const recs = run(w, 60);
    expect(hitsOf(recs, s, target).length).toBe(1);
    expect(hitsOf(recs, s, inner).length).toBe(1);
    expect(hitsOf(recs, s, outer).length).toBe(0);
    expect(castsOf(recs, s).length).toBe(1);

    // nobody in range → the skill holds fire even though enemies exist
    const w2 = lab();
    const s2 = giveSkill(w2, 'sky_blades');
    anchor(w2, 0, 15.5);
    expect(castsOf(run(w2, 90), s2).length).toBe(0);
  });

  it('awakening: two extra blades and an explosion (r 3.5, 70% damage) where each blade lands', () => {
    const w = lab();
    const s = giveSkill(w, 'sky_blades', 7); // countAdd 2 → 6, explode 3.5
    const t = anchor(w, 0, 6);
    const recs = run(w, 120);
    const hits = hitsOf(recs, s, t).map((h) => h.ev.amount);
    expect(hits.filter((a) => Math.abs(a - 28) < 1e-3).length).toBe(6);
    expect(hits.filter((a) => Math.abs(a - 28 * 0.7) < 1e-3).length).toBe(6);
    const boom = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_explode');
    expect(boom.length).toBe(6);
    for (const b of boom) expect(b.ev.scale).toBeCloseTo(3.5, 5);
  });
});

// ---------------------------------------------------------------------------
// chain

describe('chain', () => {
  const row7 = (w: World): number[] => [4, 7, 10, 13, 16, 19, 22].map((z) => anchor(w, 0, z));

  it('jumps `count` times along nearest-unvisited targets with 12% less damage per hop', () => {
    const w = lab();
    const s = giveSkill(w, 'chain_lightning'); // count 5, dmg 20, jump radius 5.5
    const ids = row7(w);
    const recs = run(w, 24);
    const hits = hitsOf(recs, s);
    expect(hits.length).toBe(5);
    expect(hits.map((h) => h.ev.targetId)).toEqual(ids.slice(0, 5));
    hits.forEach((h, i) => expect(h.ev.amount).toBeCloseTo(20 * 0.88 ** i, 5));
    expect(new Set(hits.map((h) => h.tick)).size).toBe(1); // all on the cast tick
    for (const id of ids.slice(5)) expect(hitsOf(recs, s, id).length).toBe(0);
    for (const h of hits) expect(h.ev.element).toBe(3); // lightning
  });

  it('draws one lightning line per hop, hero → first target → next …', () => {
    const w = lab();
    const s = giveSkill(w, 'chain_lightning');
    const ids = row7(w);
    const recs = run(w, 24);
    expect(castsOf(recs, s).length).toBe(1);
    const lines = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_chain_lightning' && r.ev.hasTarget);
    expect(lines.length).toBe(5);
    expect([lines[0]!.ev.x, lines[0]!.ev.z]).toEqual([0, 0]);
    ids.slice(0, 5).forEach((id, i) => {
      const q = posOf(w, id);
      expect(lines[i]!.ev.tx).toBeCloseTo(q.x, 4);
      expect(lines[i]!.ev.tz).toBeCloseTo(q.z, 4);
      if (i > 0) {
        expect(lines[i]!.ev.x).toBeCloseTo(lines[i - 1]!.ev.tx, 4);
        expect(lines[i]!.ev.z).toBeCloseTo(lines[i - 1]!.ev.tz, 4);
      }
    });
  });

  it('the jump radius (area) bounds each hop; widening it reaches farther', () => {
    const place = (w: World): number[] => [anchor(w, 0, 5), anchor(w, 0, 10), anchor(w, 0, 17)];
    const w = lab();
    const s = giveSkill(w, 'chain_lightning'); // jump 5.5 (+ body ≈ 6.05)
    const [a, b, c] = place(w) as [number, number, number];
    const recs = run(w, 24);
    expect([a, b, c].map((id) => hitsOf(recs, s, id).length)).toEqual([1, 1, 0]); // 7 m gap is out of reach

    const w2 = lab();
    const s2 = giveSkill(w2, 'chain_lightning');
    applySkillLine(s2, { stat: 'area', mode: 'pct', value: 0.5 }); // 8.25
    const [a2, b2, c2] = place(w2) as [number, number, number];
    const recs2 = run(w2, 24);
    expect([a2, b2, c2].map((id) => hitsOf(recs2, s2, id).length)).toEqual([1, 1, 1]);
  });

  it('never hits the same enemy twice (two enemies, five hops → two hits) and the first target must be within `range`', () => {
    const w = lab();
    const s = giveSkill(w, 'chain_lightning');
    const a = anchor(w, 0, 5);
    const b = anchor(w, 0, 8);
    const recs = run(w, 24);
    expect(hitsOf(recs, s, a).length).toBe(1);
    expect(hitsOf(recs, s, b).length).toBe(1);
    expect(hitsOf(recs, s).length).toBe(2);

    const w2 = lab();
    const s2 = giveSkill(w2, 'chain_lightning'); // first-target range 10 (+ body)
    anchor(w2, 0, 11.5);
    anchor(w2, 0, 14);
    expect(castsOf(run(w2, 60), s2).length).toBe(0);
  });

  it('count upgrade (+1) and awakening (+3) add hops; awakening also raises the stun chance', () => {
    const w = lab();
    const s = giveSkill(w, 'chain_lightning');
    applySkillLine(s, { stat: 'count', mode: 'flat', value: 1 });
    row7(w);
    expect(hitsOf(run(w, 24), s).length).toBe(6);

    const w2 = lab();
    const s2 = giveSkill(w2, 'chain_lightning', 7);
    row7(w2);
    expect(hitsOf(run(w2, 24), s2).length).toBe(7); // 5 + 3 hops but only 7 enemies
    expect(fpOf(w2, s2).count).toBe(8);
    expect(fpOf(w2, s2).statusChance).toBeCloseTo(0.25, 6);
  });

  it('the skill status rides on every hop (stun chance forced to 100%)', () => {
    const w = lab();
    const s = giveSkill(w, 'chain_lightning');
    applySkillLine(s, { stat: 'statusChance', mode: 'flat', value: 1 });
    const ids = row7(w);
    run(w, 17);
    ids.slice(0, 5).forEach((id) => {
      const r = rowOf(w, id);
      expect((w.enemies.status[r]! & StatusBit.Stun) !== 0).toBe(true);
      expect(w.enemies.state[r]).toBe(EnemyState.Stunned);
    });
    ids.slice(5).forEach((id) => expect(w.enemies.status[rowOf(w, id)]).toBe(0));
  });
});

// ---------------------------------------------------------------------------
// groundZone

describe('groundZone', () => {
  it('drops a zone of the skill radius/duration on the densest enemy cluster, not on the nearest enemy', () => {
    const w = lab();
    const s = giveSkill(w, 'venom_pool'); // r 3.2, dur 4.5, tick 0.5
    const cluster = [anchor(w, 4, 7), anchor(w, 5.2, 7.5), anchor(w, 4.3, 5.8)];
    anchor(w, 0, 2.5); // nearest, but alone
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = zonesOf(w, ZoneKind.Circle, s);
    expect(rows.length).toBe(1);
    const Z = w.zones;
    const z = rows[0]!;
    expect(Z.team[z]).toBe(0);
    expect(Z.radius[z]).toBeCloseTo(3.2, 5);
    expect(Z.dur[z]).toBeCloseTo(4.5, 5);
    expect(Z.tick[z]).toBeCloseTo(0.5, 5);
    expect(Z.damage[z]).toBeCloseTo(14, 5);
    expect(Z.follow[z]).toBe(0);
    const onCluster = cluster.some((id) => {
      const q = posOf(w, id);
      return Math.hypot(q.x - (Z.x[z] as number), q.z - (Z.z[z] as number)) < 1e-3;
    });
    expect(onCluster).toBe(true);
  });

  it('ticks every `tick` while the enemy stands inside, for `duration`, and then stops', () => {
    const w = lab();
    const s = giveSkill(w, 'venom_pool');
    const t = anchor(w, 0, 5);
    anchor(w, 0.8, 5.3); // makes {t, buddy} the densest cluster, so the pool lands on one of them
    const outside = anchor(w, 9, 5);
    const recs = run(w, 420, NO_INPUT, oneShot(w, s));
    const hits = hitsOf(recs, s, t);
    // first tick 0.15 s after placement, then every 0.5 s until 4.5 s → 9 hits
    expect(hits.length).toBeGreaterThanOrEqual(8);
    expect(hits.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.time - hits[i - 1]!.time).toBeCloseTo(0.5, 1);
    for (const h of hits) {
      expect(h.ev.amount).toBeCloseTo(14, 6);
      expect(h.ev.element).toBe(5);
    }
    expect(hitsOf(recs, s, outside).length).toBe(0);
    expect(zonesOf(w, ZoneKind.Circle).length).toBe(0); // expired
    const lastHit = hits[hits.length - 1]!.time;
    const castTime = castsOf(recs, s)[0]!.time;
    expect(lastHit - castTime).toBeLessThan(4.5);
  });

  it('applies its poison: status bit, dps = power × hit damage, DoT events every 0.5 s', () => {
    const w = lab();
    const s = giveSkill(w, 'venom_pool'); // poison 100%, power 0.35, 3 s
    const t = anchor(w, 0, 5);
    const recs = run(w, 150, NO_INPUT, oneShot(w, s));
    const r = rowOf(w, t);
    expect((w.enemies.status[r]! & StatusBit.Poison) !== 0).toBe(true);
    expect(w.enemies.statP[r * 8 + StatusIdx.Poison]).toBeCloseTo(14 * 0.35, 5);
    const dots = of(recs, 'damage').filter((d) => d.ev.dot && d.ev.targetId === t);
    expect(dots.length).toBeGreaterThanOrEqual(3);
    for (const d of dots) {
      expect(d.ev.skill).toBe(s.slot);
      expect(d.ev.element).toBe(5);
      expect(d.ev.amount).toBeGreaterThan(14 * 0.35 * 0.5 - 0.05);
      expect(d.ev.amount).toBeLessThan(14 * 0.35 * 0.55);
    }
    for (let i = 1; i < dots.length; i++) expect(dots[i]!.time - dots[i - 1]!.time).toBeCloseTo(0.5, 1);
    // poison keeps ticking after the pool is gone, then wears off (≤ 3 s)
    run(w, 600);
    expect(w.enemies.status[rowOf(w, t)]).toBe(0);
  });

  it('count upgrades place extra pools offset by 0.9–1.5 radii from the first', () => {
    const w = lab();
    const s = giveSkill(w, 'venom_pool');
    applySkillLine(s, { stat: 'count', mode: 'flat', value: 1 });
    anchor(w, 0, 5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = zonesOf(w, ZoneKind.Circle, s);
    expect(rows.length).toBe(2);
    const d = Math.hypot((w.zones.x[rows[0]!] as number) - (w.zones.x[rows[1]!] as number), (w.zones.z[rows[0]!] as number) - (w.zones.z[rows[1]!] as number));
    expect(d).toBeGreaterThanOrEqual(3.2 * 0.9 - 1e-3);
    expect(d).toBeLessThanOrEqual(3.2 * 1.5 + 1e-3);
  });

  it('awakening: the pool lasts 50% longer and bursts (r 4.5, 70% damage) when it fades', () => {
    const w = lab();
    const s = giveSkill(w, 'venom_pool', 7);
    const t = anchor(w, 0, 5);
    anchor(w, 0, 6.3); // {t, buddy} is the densest cluster → the pool lands on one of them
    const near = anchor(w, 3.9, 5); // outside the pool radius 3.2 + body, inside the burst 4.5 + body
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    s.cd = 1e9;
    const castTime = w.time;
    const z = zonesOf(w, ZoneKind.Circle, s)[0]!;
    expect(w.zones.dur[z]).toBeCloseTo(4.5 * 1.5, 5);
    const recs = run(w, 500);
    expect(zonesOf(w, ZoneKind.Circle).length).toBe(0);
    const bursts = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_explode');
    expect(bursts.length).toBe(1);
    expect(bursts[0]!.ev.scale).toBeCloseTo(4.5, 5);
    const burstHits = hitsOf(recs, s, near);
    expect(burstHits.length).toBe(1);
    expect(burstHits[0]!.ev.amount).toBeCloseTo(14 * 0.7, 5);
    // the last hit on the centre target is the burst
    const last = hitsOf(recs, s, t).pop()!;
    expect(last.ev.amount).toBeCloseTo(14 * 0.7, 5);
    expect(last.time).toBeGreaterThan(castTime + 6.7);
  });
});

// ---------------------------------------------------------------------------
// orbit

describe('orbit', () => {
  const orbitals = (w: World, s: SkillInstance): number[] => projectilesOf(w, ProjKind.Orbit, s);

  it('circles `count` orbitals at the orbit radius around the hero, evenly spaced, at `speed` rad/s, following the hero', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'sword_circle'); // count 3, range (orbit radius) 2.8, speed 3.2 rad/s, hit radius 0.7
    anchor(w, 0, 10);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    s.cd = 1e9;
    const P = w.projectiles;
    let rows = orbitals(w, s);
    expect(rows.length).toBe(3);
    const ids = rows.map((r) => P.id[r] as number);
    const angle0 = ids.map((id) => P.orbitA[P.find(id)] as number);
    for (const r of rows) {
      expect(P.radius[r]).toBeCloseTo(0.7, 5);
      expect(P.orbitR[r]).toBeCloseTo(2.8, 5);
      expect(P.orbitW[r]).toBeCloseTo(3.2, 5);
      expect(P.damage[r]).toBeCloseTo(16, 5);
      expect(P.lifeMax[r]).toBeCloseTo(8, 5);
    }
    expect(angle0[1]! - angle0[0]!).toBeCloseTo((2 * Math.PI) / 3, 5);
    expect(angle0[2]! - angle0[1]!).toBeCloseTo((2 * Math.PI) / 3, 5);
    for (let k = 0; k < 30; k++) {
      w.step([{ moveX: 1, moveZ: 0 }]);
      rows = ids.map((id) => P.find(id));
      for (const r of rows) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(Math.hypot((P.x[r] as number) - p.x, (P.z[r] as number) - p.z)).toBeCloseTo(2.8, 3);
      }
    }
    ids.forEach((id, i) => expect((P.orbitA[P.find(id)] as number) - (angle0[i] as number)).toBeCloseTo(3.2 * 30 * DT, 4));
  });

  it('orbitals vanish after `duration` and the set is not re-summoned while it is still alive', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_circle'); // duration 8 s, cooldown 10 s
    anchor(w, 0, 10);
    const recs = run(w, 60 * 13);
    const casts = castsOf(recs, s);
    expect(casts.length).toBe(2);
    expect(casts[1]!.time - casts[0]!.time).toBeCloseTo(10, 1);
    // nothing in the gap between expiry (8 s) and the recast (10 s)
    const w2 = lab();
    const s2 = giveSkill(w2, 'sword_circle');
    anchor(w2, 0, 10);
    expect(until(w2, () => w2.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    run(w2, 60 * 8 - 20);
    expect(orbitals(w2, s2).length).toBe(3);
    run(w2, 40);
    expect(orbitals(w2, s2).length).toBe(0);

    // forcing a cast attempt while the set is alive neither stacks nor burns the cooldown
    const w3 = lab();
    const s3 = giveSkill(w3, 'sword_circle');
    anchor(w3, 0, 10);
    expect(until(w3, () => w3.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const first = orbitals(w3, s3).map((r) => w3.projectiles.id[r] as number);
    run(w3, 60);
    s3.cd = 0;
    const again = run(w3, 1);
    expect(castsOf(again, s3).length).toBe(0);
    expect(s3.cd).toBe(0);
    expect(orbitals(w3, s3).map((r) => w3.projectiles.id[r] as number)).toEqual(first);
  });

  it('with a short cooldown the set is renewed just before it expires (no gap, no duplicates)', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_circle');
    applySkillLine(s, { stat: 'cooldown', mode: 'pct', value: 0.75 }); // 10 s → 2.5 s, shorter than the 8 s life
    anchor(w, 0, 10);
    let maxCount = 0;
    let minCount = 99;
    const recs = run(w, 60 * 14, NO_INPUT, () => {
      const n = orbitals(w, s).length;
      if (w.time > 1) minCount = Math.min(minCount, n);
      maxCount = Math.max(maxCount, n);
    });
    expect(maxCount).toBe(3);
    expect(minCount).toBe(3);
    const casts = castsOf(recs, s);
    expect(casts.length).toBe(2);
    expect(casts[1]!.time - casts[0]!.time).toBeCloseTo(8 - 0.2, 1);
  });

  it('hits are gated per enemy by `tick`: a lone enemy on the ring is hit once per orbital pass, never faster than 0.45 s', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_circle'); // 3 orbitals → a pass every 0.654 s
    const t = anchor(w, 0, 2.8);
    const recs = run(w, 60 * 8, NO_INPUT, oneShot(w, s));
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBeGreaterThanOrEqual(11);
    expect(hits.length).toBeLessThanOrEqual(13);
    for (let i = 1; i < hits.length; i++) {
      const gap = hits[i]!.time - hits[i - 1]!.time;
      // first gap: from the middle of the first pass to the edge of the next one; then one pass every 0.654 s
      expect(gap).toBeGreaterThanOrEqual(0.49);
      expect(gap).toBeLessThanOrEqual(0.69);
    }
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(16, 6);
  });

  it('with many orbitals the per-enemy re-hit gate (0.45 s) caps the rate', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_circle');
    applySkillLine(s, { stat: 'count', mode: 'flat', value: 5 }); // 8 orbitals: a pass every 0.245 s
    const t = anchor(w, 0, 2.8);
    const recs = run(w, 60 * 8, NO_INPUT, oneShot(w, s));
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBeGreaterThanOrEqual(15);
    expect(hits.length).toBeLessThanOrEqual(19);
    for (let i = 1; i < hits.length; i++) {
      const gap = hits[i]!.time - hits[i - 1]!.time;
      expect(gap).toBeGreaterThanOrEqual(0.44);
      expect(gap).toBeLessThanOrEqual(0.5);
    }
  });

  it('orbit radius falls back to 2.5 × area when `range` is 0; upgrades/awakening resize the ring', () => {
    const w = lab({
      content: (c) => {
        const def = c.skills.find((d) => d.id === 'sword_circle');
        if (def) def.params.range = 0;
      },
    });
    const s = giveSkill(w, 'sword_circle');
    anchor(w, 0, 10);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    for (const r of orbitals(w, s)) {
      expect(w.projectiles.orbitR[r]).toBeCloseTo(0.7 * 2.5, 5);
      expect(w.projectiles.radius[r]).toBeCloseTo(0.7, 5);
    }

    const w2 = lab();
    const s2 = giveSkill(w2, 'sword_circle', 7); // countAdd 2 → 5, rangeMul 1.3 → 3.64
    applySkillLine(s2, { stat: 'speed', mode: 'pct', value: 0.5 });
    anchor(w2, 0, 10);
    expect(until(w2, () => w2.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = orbitals(w2, s2);
    expect(rows.length).toBe(5);
    for (const r of rows) {
      expect(w2.projectiles.orbitR[r]).toBeCloseTo(2.8 * 1.3, 5);
      expect(w2.projectiles.orbitW[r]).toBeCloseTo(3.2 * 1.5, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// cone

describe('cone', () => {
  it('hits the wedge (length 6, angle 1.2 rad) and nothing outside it', () => {
    const w = lab();
    const s = giveSkill(w, 'frost_cleave'); // dmg 30
    const front = anchor(w, 0, 3);
    const deep = anchor(w, 0, 6.2); // inside length + body (≈ 6.55)
    const inside = anchor(w, ...polar(4, 0.5)); // ±0.6 rad wedge
    const outside = anchor(w, ...polar(4, 0.8));
    const tooFar = anchor(w, 0, 6.9);
    const behind = anchor(w, 0, -3);
    const recs = run(w, 24);
    const hit = (id: number): number => hitsOf(recs, s, id).length;
    expect([hit(front), hit(deep), hit(inside)]).toEqual([1, 1, 1]);
    expect([hit(outside), hit(tooFar), hit(behind)]).toEqual([0, 0, 0]);
    for (const h of hitsOf(recs, s)) {
      expect(h.ev.amount).toBeCloseTo(30, 6);
      expect(h.ev.element).toBe(2); // ice
    }
    const vfx = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_frost_cleave');
    expect(vfx.length).toBe(1);
    expect(vfx[0]!.ev.scale).toBeCloseTo(6, 5);
  });

  it('the wedge is aimed at the nearest target', () => {
    const w = lab();
    const s = giveSkill(w, 'frost_cleave');
    const side = anchor(w, 3, 0);
    const ahead = anchor(w, 0, 3.4); // in front of the hero's facing but farther than `side`
    const recs = run(w, 24);
    expect(hitsOf(recs, s, side).length).toBe(1);
    expect(hitsOf(recs, s, ahead).length).toBe(0);
    expect(castsOf(recs, s)[0]!.ev.dirX).toBeCloseTo(1, 3);
  });

  it('count = pulses (0.18 s apart); a forced freeze makes the next pulse hit 20% harder', () => {
    const w = lab();
    const s = giveSkill(w, 'frost_cleave');
    applySkillLine(s, { stat: 'statusChance', mode: 'flat', value: 1 });
    // pulses come from `count`, which has no upgrade line on this skill: patch the card line stat directly
    applySkillLine(s, { stat: 'count', mode: 'flat', value: 1 });
    const t = anchor(w, 0, 3);
    const recs = run(w, 40, NO_INPUT, oneShot(w, s));
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(2);
    expect(hits[1]!.time - hits[0]!.time).toBeCloseTo(0.18, 1);
    expect(hits[0]!.ev.amount).toBeCloseTo(30, 6);
    expect(hits[1]!.ev.amount).toBeCloseTo(30 * 1.2, 5); // frozen target takes ×1.2
    expect((w.enemies.status[rowOf(w, t)]! & StatusBit.Freeze) !== 0).toBe(true);
    expect(w.enemies.state[rowOf(w, t)]).toBe(EnemyState.Stunned);
  });

  it('length falls back to `area` when range is 0; awakening lengthens the cone by 40%', () => {
    const w = lab({
      content: (c) => {
        const def = c.skills.find((d) => d.id === 'frost_cleave');
        if (def) {
          def.params.range = 0;
          def.params.area = 4;
        }
      },
    });
    const s = giveSkill(w, 'frost_cleave');
    const near = anchor(w, 0, 3);
    const far = anchor(w, 0, 5);
    const recs = run(w, 24);
    expect(hitsOf(recs, s, near).length).toBe(1);
    expect(hitsOf(recs, s, far).length).toBe(0);

    const base = lab();
    const bs = giveSkill(base, 'frost_cleave');
    anchor(base, 0, 3);
    const bFar = anchor(base, 0, 8);
    expect(hitsOf(run(base, 24), bs, bFar).length).toBe(0);
    const awk = lab();
    const as = giveSkill(awk, 'frost_cleave', 7); // range 6 × 1.4 = 8.4
    anchor(awk, 0, 3);
    const aFar = anchor(awk, 0, 8);
    expect(hitsOf(run(awk, 24), as, aFar).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// shockwave

describe('shockwave', () => {
  it('spawns a Shock zone that expands to `area` over `duration`', () => {
    const w = lab();
    const s = giveSkill(w, 'arc_of_might'); // area 7, duration 0.55, dmg 26, kb 3.5
    anchor(w, 0, 2);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    expect(w.events.some((e) => e.t === 'shake')).toBe(true); // the wave shakes the camera on the cast tick
    const rows = zonesOf(w, ZoneKind.Shock, s);
    expect(rows.length).toBe(1);
    const Z = w.zones;
    expect(Z.radius[rows[0]!]).toBeCloseTo(7, 5);
    expect(Z.aux[rows[0]!]).toBeCloseTo(0.55, 5);
    expect(Z.damage[rows[0]!]).toBeCloseTo(26, 5);
    expect(Z.knock[rows[0]!]).toBeCloseTo(3.5, 5);
    expect(Z.follow[rows[0]!]).toBe(0);
    expect(Z.dur[rows[0]!]).toBeCloseTo(0.55 + 0.25, 5); // expansion + a short tail
    expect(w.zones.t[rows[0]!]).toBeLessThan(0.05);
    run(w, 60);
    expect(zonesOf(w, ZoneKind.Shock).length).toBe(0);
  });

  it('the front reaches each enemy at (distance − body) / area × duration and hits it exactly once', () => {
    const w = lab();
    const s = giveSkill(w, 'arc_of_might');
    const ids = [anchor(w, 0, 2), anchor(w, -4, 0), anchor(w, 0, -6), anchor(w, 7.3, 0)];
    const outside = anchor(w, 0, 8.2); // 7 + body ≈ 7.55 < 8.2
    const dists = [2, 4, 6, 7.3];
    let castTick = -1;
    const recs = run(w, 90, NO_INPUT, () => {
      if (castTick < 0 && w.events.some((e) => e.t === 'skillCast')) castTick = w.tick;
    });
    const times: number[] = [];
    ids.forEach((id, i) => {
      const h = hitsOf(recs, s, id);
      expect(h.length).toBe(1);
      expect(h[0]!.ev.amount).toBeCloseTo(26, 6);
      const body = w.enemies.radius[rowOf(w, id)] as number;
      const expected = ((dists[i]! - body) / 7) * 0.55;
      const got = (h[0]!.tick - castTick) * DT;
      expect(Math.abs(got - expected)).toBeLessThanOrEqual(2.5 * DT);
      times.push(got);
    });
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!);
    expect(hitsOf(recs, s, outside).length).toBe(0);
  });

  it('knocks enemies radially outward by impulse / mass metres (heavier enemies move less)', () => {
    const w = lab();
    giveSkill(w, 'arc_of_might'); // knockback 3.5
    const light = put(w, 'puppet', 0, 2);
    const heavy = put(w, 'heavy', 0, -2.2);
    run(w, 90);
    const l = posOf(w, light);
    const h = posOf(w, heavy);
    // total displacement of a decaying impulse ≈ 1.077 × impulse/mass
    expect(l.z - 2).toBeGreaterThan(3.2);
    expect(l.z - 2).toBeLessThan(4.2);
    expect(Math.abs(l.x)).toBeLessThan(0.05);
    expect(-2.2 - h.z).toBeGreaterThan(1.0);
    expect(-2.2 - h.z).toBeLessThan(1.5);
    expect((l.z - 2) / (-2.2 - h.z)).toBeGreaterThan(2.6);
    expect((l.z - 2) / (-2.2 - h.z)).toBeLessThan(3.4);
  });

  it('upgrade lines scale damage / radius / knockback', () => {
    const w = lab();
    const s = giveSkill(w, 'arc_of_might');
    applySkillLine(s, { stat: 'damage', mode: 'pct', value: 0.5 });
    applySkillLine(s, { stat: 'area', mode: 'pct', value: 0.5 });
    applySkillLine(s, { stat: 'knockback', mode: 'pct', value: 1 });
    anchor(w, 0, 2);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const z = zonesOf(w, ZoneKind.Shock, s)[0]!;
    expect(w.zones.damage[z]).toBeCloseTo(39, 5);
    expect(w.zones.radius[z]).toBeCloseTo(10.5, 5);
    expect(w.zones.knock[z]).toBeCloseTo(7, 5);
  });

  it('awakened echo repeats the wave 0.5 s later and it hits the enemy it already hit (a new wave, a new hit)', () => {
    const w = lab();
    const s = giveSkill(w, 'arc_of_might', 7);
    const t = anchor(w, 0, 2);
    const recs = run(w, 90, NO_INPUT, oneShot(w, s));
    const casts = castsOf(recs, s);
    expect(casts.length).toBe(2);
    expect(casts[1]!.time - casts[0]!.time).toBeCloseTo(0.5, 1);
    expect(casts.every((c) => c.ev.awakened)).toBe(true);
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(2);
    expect(hits[1]!.time - hits[0]!.time).toBeCloseTo(0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// selfBuff

describe('selfBuff', () => {
  it('applies the buff stats for `duration`, heals on cast, and expires cleanly', () => {
    const w = lab();
    const p = player(w);
    p.hp = 100;
    const s = giveSkill(w, 'will_to_live'); // dur 7, heal 25, buff dmg+0.25 move+0.15 armor+6
    anchor(w, 0, 5);
    const hp0 = p.hp;
    const recs = run(w, 20, NO_INPUT, oneShot(w, s));
    expect(castsOf(recs, s).length).toBe(1);
    const heals = of(recs, 'heal').filter((r) => r.ev.source === 5); // CastSelf: the caster's own cast heal
    expect(heals.length).toBe(1);
    expect(of(recs, 'heal').filter((r) => r.ev.source === 3).length).toBe(0);
    expect(heals[0]!.ev.amount).toBeCloseTo(25, 5);
    expect(p.hp).toBeCloseTo(hp0 + 25, 5);
    expect(p.buffs.length).toBe(1);
    expect(p.buffs[0]!.skillSlot).toBe(s.slot);
    expect(p.buffs[0]!.total).toBeCloseTo(7, 5);
    expect(p.buffs[0]!.left).toBeGreaterThan(6.8);
    expect(p.buffs[0]!.mods).toEqual({ damage: 0.25, moveSpeed: 0.15, armor: 6 });
    // stats follow
    run(w, 1);
    expect(p.stats.damage).toBeCloseTo(1.25, 6);
    expect(p.stats.moveSpeed).toBeCloseTo(5.6 * 1.15, 4);
    expect(p.stats.armor).toBeCloseTo(8 + 6, 6);
    // ~7 s after the cast: still active just before, gone just after
    const castTime = castsOf(recs, s)[0]!.time;
    run(w, Math.round((castTime + 6.9 - w.time) / DT));
    expect(p.buffs.length).toBe(1);
    expect(p.stats.damage).toBeCloseTo(1.25, 6);
    run(w, Math.round(0.3 / DT));
    expect(p.buffs.length).toBe(0);
    run(w, 1);
    expect(p.stats.damage).toBeCloseTo(1, 6);
    expect(p.stats.armor).toBeCloseTo(8, 6);
    expect(p.stats.moveSpeed).toBeCloseTo(5.6, 4);
  });

  it('does not stack while active; once it ends a ready skill re-applies exactly one buff', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'will_to_live');
    anchor(w, 0, 5);
    const first = run(w, 20, NO_INPUT, oneShot(w, s));
    const castTime = castsOf(first, s)[0]!.time;
    expect(p.buffs.length).toBe(1);
    run(w, 120);
    const left = p.buffs[0]!.left;
    s.cd = 0; // ready while the buff is still running
    const mid = run(w, 1);
    expect(castsOf(mid, s).length).toBe(0);
    expect(of(mid, 'heal').length).toBe(0);
    expect(p.buffs.length).toBe(1);
    expect(p.buffs[0]!.left).toBeLessThan(left); // not refreshed
    expect(s.cd).toBe(0); // the failed attempt did not burn the cooldown
    // ... so the instant the buff ends it is re-applied: one cast, one buff, damage ×1.25 (not ×1.5)
    let maxBuffs = 0;
    const rest = run(w, 60 * 6, NO_INPUT, () => {
      maxBuffs = Math.max(maxBuffs, p.buffs.length);
    });
    expect(maxBuffs).toBe(1);
    const again = castsOf(rest, s);
    expect(again.length).toBe(1);
    expect(again[0]!.time - castTime).toBeGreaterThan(6.95);
    expect(again[0]!.time - castTime).toBeLessThan(7.2);
    expect(p.buffs.length).toBe(1);
    expect(p.buffs[0]!.left).toBeGreaterThan(5);
    expect(p.stats.damage).toBeCloseTo(1.25, 6);
  });

  it('heal is capped by max hp (event reports what was gained) and upgrades add flat + percent heal', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'will_to_live');
    anchor(w, 0, 5);
    p.hp = p.hpMax - 10;
    const recs = run(w, 20, NO_INPUT, oneShot(w, s));
    expect(p.hp).toBeCloseTo(p.hpMax, 5);
    const heals = of(recs, 'heal').filter((r) => r.ev.source === 5);
    expect(heals.length).toBe(1);
    expect(heals[0]!.ev.amount).toBeCloseTo(10, 4);

    applySkillLine(s, { stat: 'heal', mode: 'flat', value: 10 });
    applySkillLine(s, { stat: 'heal', mode: 'pct', value: 0.2 });
    expect(fpOf(w, s).heal).toBeCloseTo(25 + 10 + 25 * 0.2, 6);
  });

  it('the buff boosts other skills of the hero while it lasts (damage ×1.25) and they return to normal afterwards', () => {
    const w = lab();
    const arc = giveSkill(w, 'sword_arc'); // first skill: casts first, dmg 14
    const buff = giveSkill(w, 'will_to_live');
    const t = anchor(w, 0, 2);
    const recs = run(w, 60 * 9, NO_INPUT, oneShot(w, buff));
    const buffStart = castsOf(recs, buff)[0]!.time;
    const hits = hitsOf(recs, arc, t);
    expect(hits.length).toBeGreaterThan(8);
    for (const h of hits) {
      const inside = h.time > buffStart + 0.05 && h.time < buffStart + 7;
      const outside = h.time < buffStart || h.time > buffStart + 7.1;
      if (inside) expect(h.ev.amount).toBeCloseTo(14 * 1.25, 5);
      else if (outside) expect(h.ev.amount).toBeCloseTo(14, 5);
    }
    expect(hits.some((h) => Math.abs(h.ev.amount - 17.5) < 1e-3)).toBe(true);
    expect(hits.some((h) => Math.abs(h.ev.amount - 14) < 1e-3)).toBe(true);
  });

  it('awakening heals 15 more, lasts 50% longer and cools down 20% faster', () => {
    const w = lab();
    const s = giveSkill(w, 'will_to_live', 7);
    const fp = fpOf(w, s);
    expect(fp.heal).toBeCloseTo(40, 6);
    expect(fp.duration).toBeCloseTo(10.5, 6);
    expect(fp.cooldown).toBeCloseTo(14.4, 6);
  });
});

// ---------------------------------------------------------------------------
// summon

describe('summon', () => {
  const familiars = (w: World, s: SkillInstance): number[] => projectilesOf(w, ProjKind.Familiar, s);

  it('spawns `count` familiars next to the hero with the skill stats', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'phantom_blades'); // count 2, dmg 14, speed 6.5, tick 0.7, area 1.3, range 9, dur 10
    anchor(w, 0, 7);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = familiars(w, s);
    expect(rows.length).toBe(2);
    const P = w.projectiles;
    for (const r of rows) {
      expect(Math.hypot((P.x[r] as number) - p.x, (P.z[r] as number) - p.z)).toBeGreaterThan(1.2);
      expect(Math.hypot((P.x[r] as number) - p.x, (P.z[r] as number) - p.z)).toBeLessThan(1.7);
      expect(P.damage[r]).toBeCloseTo(14, 5);
      expect(P.element[r]).toBe(4);
      expect(P.aux[r]).toBeCloseTo(6.5, 5);
      expect(P.orbitA[r]).toBeCloseTo(1.3, 5);
      expect(P.orbitR[r]).toBeCloseTo(0.7, 5);
      expect(P.orbitW[r]).toBeCloseTo(9, 5);
      expect(P.lifeMax[r]).toBeCloseTo(10, 5);
      expect(P.owner[r]).toBe(0);
    }
  });

  it('chase the nearest enemy (faster than their idle drift) and strike it every `tick`, at most once per interval each', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'phantom_blades');
    const t = anchor(w, 0, 8);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const castTime = w.time;
    const P = w.projectiles;
    const distToTarget = (r: number): number => Math.hypot((P.x[r] as number) - 0, (P.z[r] as number) - 8);
    const start = familiars(w, s).map(distToTarget);
    expect(start.every((d) => d > 5.5)).toBe(true);
    const recs = run(w, 60 * 5);
    // they arrived: within strike distance of the target (strikeR × 0.6 + body ≈ 1.33)
    const end = familiars(w, s).map(distToTarget);
    expect(end.length).toBe(2);
    for (const d of end) {
      expect(d).toBeGreaterThan(0.8);
      expect(d).toBeLessThan(1.7);
    }
    expect(p.x).toBeCloseTo(0, 5); // the hero did not move
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBeGreaterThanOrEqual(11);
    expect(hits.length).toBeLessThanOrEqual(16);
    for (const h of hits) {
      expect(h.ev.amount).toBeCloseTo(14, 6);
      expect(h.ev.element).toBe(4);
    }
    // two familiars × one strike per 0.7 s: any three consecutive hits span at least one interval
    for (let i = 2; i < hits.length; i++) expect(hits[i]!.time - hits[i - 2]!.time).toBeGreaterThanOrEqual(0.68);
    // the first strike needs the trip (≥ 5.5 m at 9.1 m/s)
    expect(hits[0]!.time - castTime).toBeGreaterThan(0.4);
  });

  it('live for `duration`, hover around the hero when nothing is left to hunt, and a recast replaces the old set', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'phantom_blades');
    const t = anchor(w, 0, 6);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const castTick = w.tick;
    const first = familiars(w, s).map((r) => w.projectiles.id[r] as number);
    // enemy disappears → idle hover within ~2 m of the hero
    clearEnemies(w);
    run(w, 120);
    expect(t).not.toBe(0);
    for (const r of familiars(w, s)) {
      const d = Math.hypot((w.projectiles.x[r] as number) - p.x, (w.projectiles.z[r] as number) - p.z);
      expect(d).toBeGreaterThan(1.4);
      expect(d).toBeLessThan(2.6);
    }
    // a forced recast replaces (never stacks) the set
    anchor(w, 0, 6);
    s.cd = 0;
    run(w, 1);
    const second = familiars(w, s).map((r) => w.projectiles.id[r] as number);
    expect(second.length).toBe(2);
    expect(second.some((id) => first.includes(id))).toBe(false);
    // lifetime counts from the (re)cast
    run(w, 60 * 10 - 30);
    expect(familiars(w, s).length).toBe(2);
    run(w, 60);
    expect(familiars(w, s).length).toBe(0);
    expect(w.tick - castTick).toBeGreaterThan(60 * 10);
  });

  it('count upgrade, +projectiles stat and awakening add familiars; tick upgrade speeds up their strikes', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'phantom_blades');
    applySkillLine(s, { stat: 'count', mode: 'flat', value: 1 });
    p.fixed.push({ projectiles: 1 });
    refreshStats(p, w.content, w.ix);
    anchor(w, 0, 7);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    expect(familiars(w, s).length).toBe(4);

    const w2 = lab();
    const s2 = giveSkill(w2, 'phantom_blades', 7); // countAdd 2 → 4, tickMul 0.7 → 0.49
    anchor(w2, 0, 7);
    expect(until(w2, () => w2.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = familiars(w2, s2);
    expect(rows.length).toBe(4);
    for (const r of rows) expect(w2.projectiles.orbitR[r]).toBeCloseTo(0.49, 5);
  });
});

// ---------------------------------------------------------------------------
// leap

describe('leap', () => {
  it('jumps onto the enemy cluster (untouchable in the air) and slams on landing: AoE damage + knockback, once', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'war_leap'); // dmg 55, r 3.4, speed 18, range 9, kb 2.5
    const a = anchor(w, 0, 6);
    const bStart = { x: 2.4, z: 6 };
    const b = put(w, 'puppet', bStart.x, bStart.z); // movable: shows the knockback
    const c = anchor(w, 0, 12.5); // out of reach of the jump and of the slam
    const aPos = posOf(w, a);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const castTick = w.tick;
    expect(p.dashT).toBeGreaterThan(0.3);
    expect(p.dashSlot).toBe(-1); // a leap deals no damage along the path
    expect(p.iframes).toBeGreaterThan(p.dashT);
    expect(hurtPlayer(w, 0, 50, 0, 5, 0, 0)).toBe(false); // untouchable in the air
    const hp = p.hp;
    const recs = run(w, 60);
    expect(p.hp).toBe(hp);
    // lands on one of the two cluster members
    const landedOnA = Math.hypot(p.x - aPos.x, p.z - aPos.z) < 0.5;
    const landedOnB = Math.hypot(p.x - bStart.x, p.z - bStart.z) < 0.5;
    expect(landedOnA || landedOnB).toBe(true);
    const slam = hitsOf(recs, s);
    expect(hitsOf(recs, s, a).length).toBe(1);
    expect(hitsOf(recs, s, b).length).toBe(1);
    expect(hitsOf(recs, s, c).length).toBe(0);
    expect(slam.length).toBe(2);
    for (const h of slam) {
      expect(h.ev.amount).toBeCloseTo(55, 6);
      expect(h.ev.element).toBe(1); // fire
      // landing happens after the flight time, never before
      expect(h.tick - castTick).toBeGreaterThanOrEqual(19);
      expect(h.tick - castTick).toBeLessThanOrEqual(23);
    }
    expect(slam[0]!.tick).toBe(slam[1]!.tick);
    // the puppet is shoved ≈ impulse/mass metres
    const q = posOf(w, b);
    const shoved = Math.hypot(q.x - bStart.x, q.z - bStart.z);
    expect(shoved).toBeGreaterThan(2.0);
    expect(shoved).toBeLessThan(3.4);
    // slam presentation at the landing spot
    const vfx = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_war_leap');
    expect(vfx.length).toBe(1);
    expect(vfx[0]!.ev.scale).toBeCloseTo(3.4, 5);
    expect(of(recs, 'shake').length).toBeGreaterThan(0);
    // i-frames outlast the landing a little, then the hero is vulnerable again
    expect(p.iframes).toBeLessThanOrEqual(0);
    expect(hurtPlayer(w, 0, 10, 0, 5, 0, 0)).toBe(true);
  });

  it('lands at most `range` away (partial jump toward a farther target) and ignores enemies beyond it', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'war_leap');
    const t = anchor(w, 0, 9.4); // inside range + body (9.55), but beyond the 9 m jump
    const recs = run(w, 60, NO_INPUT, oneShot(w, s));
    expect(castsOf(recs, s).length).toBe(1);
    expect(p.z).toBeGreaterThan(8.7);
    expect(p.z).toBeLessThan(9.45);
    expect(hitsOf(recs, s, t).length).toBe(1); // 0.4 m from the impact point

    const w2 = lab();
    const s2 = giveSkill(w2, 'war_leap');
    anchor(w2, 0, 10.2);
    expect(castsOf(run(w2, 90), s2).length).toBe(0);
  });

  it('awakening: 30% shorter cooldown and a 25% wider slam', () => {
    const w = lab();
    const s = giveSkill(w, 'war_leap', 7);
    expect(fpOf(w, s).cooldown).toBeCloseTo(7 * 0.7, 6);
    expect(fpOf(w, s).area).toBeCloseTo(3.4 * 1.25, 6);
    const target = anchor(w, 0, 6);
    const wide = anchor(w, 0, 6 + 4.5); // 4.5 m from the landing: outside 3.4 + body, inside 4.25 + body
    const recs = run(w, 60, NO_INPUT, oneShot(w, s));
    expect(hitsOf(recs, s, target).length).toBe(1);
    expect(hitsOf(recs, s, wide).length).toBe(1);
    const base = lab();
    const bs = giveSkill(base, 'war_leap');
    anchor(base, 0, 6);
    const bWide = anchor(base, 0, 6 + 4.5);
    expect(hitsOf(run(base, 60, NO_INPUT, oneShot(base, bs)), bs, bWide).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// beam

describe('beam', () => {
  it('spawns a Beam zone (length = range, width = area) that follows the hero and ends after `duration`', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'soul_beam'); // range 9, width 1.2, dur 2.5, tick 0.15, turn 3.5 rad/s, dmg 12
    anchor(w, 0, 5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = zonesOf(w, ZoneKind.Beam, s);
    expect(rows.length).toBe(1);
    const Z = w.zones;
    const z = rows[0]!;
    expect(Z.length[z]).toBeCloseTo(9, 5);
    expect(Z.radius[z]).toBeCloseTo(1.2, 5);
    expect(Z.dur[z]).toBeCloseTo(2.5, 5);
    expect(Z.tick[z]).toBeCloseTo(0.15, 5);
    expect(Z.aux[z]).toBeCloseTo(3.5, 5);
    expect(Z.follow[z]).toBe(1);
    expect(Z.rot[z]).toBeCloseTo(0, 5); // target straight ahead
    expect(Z.id[z]).toBe(s.h1);
    for (let k = 0; k < 40; k++) {
      w.step([{ moveX: -1, moveZ: 0 }]);
      const row = w.zones.find(s.h1);
      expect(w.zones.x[row]).toBeCloseTo(p.x, 4);
      expect(w.zones.z[row]).toBeCloseTo(p.z, 4);
    }
    run(w, 120);
    expect(w.zones.find(s.h1)).toBe(-1);
  });

  it('damages every enemy inside its rectangle (length × width) every `tick`, and nobody outside it', () => {
    const w = lab();
    const s = giveSkill(w, 'soul_beam');
    const lead = anchor(w, 0, 4); // nearest: sets the aim straight ahead
    const inside = anchor(w, 0.9, 6.5); // lateral 0.9 ≤ 0.6 + body
    const wide = anchor(w, 2.3, 6); // lateral 2.3 > 0.6 + body
    const past = anchor(w, 0, 10.4); // beyond 9 + body
    const behind = anchor(w, 0, -5.5); // farther than `lead`, so it does not steer the beam
    const recs = run(w, 200, NO_INPUT, oneShot(w, s));
    for (const id of [lead, inside]) {
      const hits = hitsOf(recs, s, id);
      expect(hits.length).toBeGreaterThanOrEqual(16);
      expect(hits.length).toBeLessThanOrEqual(17);
      for (let i = 1; i < hits.length; i++) {
        const gap = hits[i]!.tick - hits[i - 1]!.tick;
        expect(gap).toBeGreaterThanOrEqual(8);
        expect(gap).toBeLessThanOrEqual(10);
      }
      for (const h of hits) {
        expect(h.ev.amount).toBeCloseTo(12, 6);
        expect(h.ev.element).toBe(6); // holy
      }
    }
    for (const id of [wide, past, behind]) expect(hitsOf(recs, s, id).length).toBe(0);
  });

  it('turns toward the target at most `speed` rad/s: a target that moved 90° is caught after ~0.45 s', () => {
    const w = lab();
    const s = giveSkill(w, 'soul_beam');
    const t = anchor(w, 0, 5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    s.cd = 1e9;
    const z = (): number => w.zones.find(s.h1);
    expect(w.zones.rot[z()]).toBeCloseTo(0, 5);
    setPos(w, t, 5, 0); // now at bearing +90° (π/2 rad)
    const recs: Rec[] = [];
    const rotAt: number[] = [];
    for (let k = 1; k <= 45; k++) {
      recs.push(...run(w, 1));
      rotAt.push(w.zones.rot[z()] as number);
    }
    // rate-limited: after k ticks the beam has turned min(k × 3.5/60, π/2)
    for (const k of [5, 15, 25]) expect(rotAt[k - 1]).toBeCloseTo(k * (3.5 / 60), 3);
    expect(rotAt[44]).toBeCloseTo(Math.PI / 2, 4);
    // it only starts to hurt once the sweep reaches the target
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.tick - (w.tick - 45)).toBeGreaterThan(20);
  });

  it('a recast while the beam is alive refreshes it; awakening lengthens it (+40%), speeds up ticks and hits harder', () => {
    const w = lab();
    const s = giveSkill(w, 'soul_beam');
    anchor(w, 0, 5);
    run(w, 20);
    const id = s.h1;
    run(w, 60);
    expect(w.zones.t[w.zones.find(id)]).toBeGreaterThan(1);
    s.cd = 0;
    run(w, 1);
    expect(s.h1).toBe(id);
    expect(zonesOf(w, ZoneKind.Beam).length).toBe(1);
    expect(w.zones.t[w.zones.find(id)]).toBeLessThan(0.05);

    const w2 = lab();
    const s2 = giveSkill(w2, 'soul_beam', 7);
    anchor(w2, 0, 5);
    expect(until(w2, () => w2.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const z = w2.zones.find(s2.h1);
    expect(w2.zones.dur[z]).toBeCloseTo(2.5 * 1.4, 5);
    expect(w2.zones.tick[z]).toBeCloseTo(0.15 * 0.75, 5);
    const recs = run(w2, 30);
    for (const h of hitsOf(recs, s2)) expect(h.ev.amount).toBeCloseTo(12 * 1.2, 5);
  });
});

// ---------------------------------------------------------------------------
// awakening (rank 7): echo / nova (explode is covered in the projectile, skyStrike and groundZone blocks)

describe('awakening effects', () => {
  it('echo: sword_arc repeats the cast 0.25 s later (once, never an echo of the echo) and hits 35% harder', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_arc', 7); // echo 0.25, damageMul 1.35
    const t = anchor(w, 0, 2);
    const recs = run(w, 40);
    const casts = castsOf(recs, s);
    expect(casts.length).toBe(2);
    expect(casts[1]!.time - casts[0]!.time).toBeCloseTo(0.25, 1);
    expect(casts.every((c) => c.ev.awakened)).toBe(true);
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(2);
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(14 * 1.35, 6);
    // the echo is free: the cooldown was armed once, by the first cast, so the next cycle starts 0.8 s after it
    const later = castsOf(run(w, 30), s);
    expect(later.length).toBe(1);
    expect(later[0]!.time - casts[0]!.time).toBeCloseTo(0.8, 1);
  });

  it('echo repeats a single swing even when the original cast was a combo', () => {
    const w = lab({
      content: (c) => {
        const def = c.skills.find((d) => d.id === 'lightning_trio');
        if (def) def.awaken.params = { echo: 0.4 };
      },
    });
    const s = giveSkill(w, 'lightning_trio', 7); // count 2 → swings at +0, +0.14, echo at +0.4 (1 swing)
    const t = anchor(w, 0, 2);
    const recs = run(w, 60);
    expect(castsOf(recs, s).length).toBe(2);
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(3);
    expect(hits[2]!.time - hits[0]!.time).toBeCloseTo(0.4, 1);
  });

  it('echo: lunge dashes again 0.35 s later', () => {
    const w = lab();
    const p = player(w);
    const s = giveSkill(w, 'lunge', 7); // echo 0.35, damageMul 1.2
    anchor(w, 0, 2);
    const recs = run(w, 80, NO_INPUT, oneShot(w, s));
    const casts = castsOf(recs, s);
    expect(casts.length).toBe(2);
    expect(casts[1]!.time - casts[0]!.time).toBeCloseTo(0.35, 1);
    // out and back: the second dash heads for the target the first one overshot
    expect(Math.abs(p.z)).toBeLessThan(1.2);
    const hits = hitsOf(recs, s);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(30 * 1.2, 6);
  });

  it('echo: the repeated lunge cuts through the same enemy again (+20% damage on both passes)', () => {
    const w = lab();
    const s = giveSkill(w, 'lunge', 7);
    const t = anchor(w, 0, 2);
    const recs = run(w, 80, NO_INPUT, oneShot(w, s));
    const hits = hitsOf(recs, s, t);
    expect(hits.length).toBe(2); // out (first dash) and back (echo)
    for (const h of hits) expect(h.ev.amount).toBeCloseTo(30 * 1.2, 6);
  });

  it('nova: every cast of an awakened lightning_trio also blasts everything within 3.5 m for 60% damage (not the extra swings)', () => {
    const w = lab();
    const s = giveSkill(w, 'lightning_trio', 7); // countAdd 1 → 3 swings, nova 3.5 × 0.6
    const front = anchor(w, 0, 2);
    const back = anchor(w, 0, -3.3); // behind (no swing reaches it), inside nova 3.5 + body
    const out = anchor(w, 0, -4.8); // outside nova
    const recs = run(w, 60, NO_INPUT, oneShot(w, s));
    const frontHits = hitsOf(recs, s, front).map((h) => h.ev.amount);
    expect(frontHits.filter((a) => Math.abs(a - 24) < 1e-3).length).toBe(3);
    expect(frontHits.filter((a) => Math.abs(a - 24 * 0.6) < 1e-3).length).toBe(1);
    const backHits = hitsOf(recs, s, back);
    expect(backHits.length).toBe(1);
    expect(backHits[0]!.ev.amount).toBeCloseTo(24 * 0.6, 6);
    expect(hitsOf(recs, s, out).length).toBe(0);
    const nova = of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_nova');
    expect(nova.length).toBe(1);
    expect(nova[0]!.ev.scale).toBeCloseTo(3.5, 5);
    expect(nova[0]!.tick).toBe(castsOf(recs, s)[0]!.tick);
  });

  it('nova happens once per cast: the awakened cast of the first skill is not re-triggered by its own echo', () => {
    const w = lab({
      content: (c) => {
        const def = c.skills.find((d) => d.id === 'sword_arc');
        if (def) def.awaken.params = { echo: 0.25, nova: 3, novaDamage: 0.5 };
      },
    });
    const s = giveSkill(w, 'sword_arc', 7);
    const near = anchor(w, 0, 2);
    const recs = run(w, 40);
    expect(castsOf(recs, s).length).toBe(2);
    expect(of(recs, 'vfx').filter((r) => r.ev.preset === 'vfx_nova').length).toBe(1);
    const hits = hitsOf(recs, s, near).map((h) => h.ev.amount);
    expect(hits.length).toBe(3); // swing, nova, echo swing
    expect(hits.filter((a) => Math.abs(a - 7) < 1e-3).length).toBe(1);
  });

  it('an unawakened skill (rank 6) has none of the awakening effects', () => {
    const w = lab();
    const s = giveSkill(w, 'sword_arc', 6);
    const t = anchor(w, 0, 2);
    const recs = run(w, 40);
    expect(castsOf(recs, s).length).toBe(1);
    expect(castsOf(recs, s)[0]!.ev.awakened).toBe(false);
    expect(hitsOf(recs, s, t)[0]!.ev.amount).toBeCloseTo(14, 6);
  });
});

// ---------------------------------------------------------------------------
// everything at once

describe('all behaviors at once', () => {
  const allSkills = CASES.map((c) => c.id);

  function crowdedWorld(seed: number): { w: World; skills: SkillInstance[] } {
    const w = lab({ seed });
    const p = player(w);
    p.fixed.push({ maxHp: 20000 });
    refreshStats(p, w.content, w.ix);
    p.hp = p.hpMax;
    p.xpNext = 1e12; // no level-up modals
    const skills = allSkills.map((id) => giveSkill(w, id));
    // a ring of real wolves plus a few dummies
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const d = 5 + (i % 4) * 1.8;
      spawn(w, i % 7 === 0 ? 'anchor' : 'wolf', Math.sin(a) * d, Math.cos(a) * d);
    }
    return { w, skills };
  }

  function digest(w: World): string {
    const e = w.enemies;
    let h = 0;
    for (let i = 0; i < e.count; i++) h += (e.x[i] as number) * 3.1 + (e.z[i] as number) * 7.7 + (e.hp[i] as number);
    const p = player(w);
    return [w.tick, w.tally.kills, w.tally.damageDealt.toFixed(4), p.hp.toFixed(4), p.x.toFixed(4), p.z.toFixed(4), h.toFixed(3), w.projectiles.count, w.zones.count].join('|');
  }

  it('runs 16 s with every skill firing: finite state, every damaging skill dealt damage, meter matches the damage events', () => {
    const { w, skills } = crowdedWorld(5);
    const dealt = new Map<number, number>();
    const casts = new Set<number>();
    for (let k = 0; k < 960; k++) {
      w.step([{ moveX: Math.sin(k / 90), moveZ: Math.cos(k / 70) }]);
      for (const e of w.events) {
        if (e.t === 'damage' && e.skill >= 0) dealt.set(e.skill, (dealt.get(e.skill) ?? 0) + e.amount);
        if (e.t === 'skillCast') casts.add(e.skill);
      }
      if (k % 120 === 0) expect(findNonFinite(w)).toBeNull();
    }
    expect(findNonFinite(w)).toBeNull();
    expect(w.modals.length).toBe(0);
    expect(player(w).alive).toBe(true);
    for (const s of skills) {
      expect(casts.has(s.slot)).toBe(true);
      if (s.def.behavior === 'selfBuff') continue;
      expect(dealt.get(s.slot) ?? 0).toBeGreaterThan(0);
      expect(s.damage).toBeCloseTo(dealt.get(s.slot) ?? 0, 2);
    }
  });

  it('is deterministic for a seed (two identical runs end in the identical state)', () => {
    const a = crowdedWorld(9).w;
    const b = crowdedWorld(9).w;
    const c = crowdedWorld(10).w;
    for (let k = 0; k < 600; k++) {
      const input = { moveX: Math.cos(k / 50), moveZ: Math.sin(k / 80) };
      a.step([input]);
      b.step([input]);
      c.step([input]);
    }
    expect(digest(a)).toBe(digest(b));
    expect(digest(c)).not.toBe(digest(a));
  });
});

// ---------------------------------------------------------------------------
// player stats change what skills actually do

describe('player stat modifiers in play', () => {
  const withStats = (mods: StatMods, build: (w: World) => void): World => {
    const w = lab();
    const p = player(w);
    p.fixed.push(mods);
    refreshStats(p, w.content, w.ix);
    build(w);
    return w;
  };

  it('+damage scales every hit; stats and upgrade lines multiply', () => {
    const w = withStats({ damage: 0.5 }, (x) => {
      const s = giveSkill(x, 'sword_arc');
      applySkillLine(s, { stat: 'damage', mode: 'pct', value: 0.15 });
      anchor(x, 0, 2);
    });
    const recs = run(w, 24);
    const hits = of(recs, 'damage');
    expect(hits.length).toBe(1);
    expect(hits[0]!.ev.amount).toBeCloseTo(14 * 1.15 * 1.5, 5);
  });

  it('+cooldown shortens the real casting interval (0.8 s → 0.64 s); attackSpeed divides it', () => {
    const gap = (mods: StatMods): number => {
      const w = withStats(mods, (x) => {
        giveSkill(x, 'sword_arc');
        anchor(x, 0, 2);
      });
      const casts = of(run(w, 200), 'skillCast');
      expect(casts.length).toBeGreaterThanOrEqual(3);
      return casts[2]!.time - casts[1]!.time;
    };
    expect(gap({})).toBeCloseTo(0.8, 1);
    expect(gap({ cooldown: 0.2 })).toBeCloseTo(0.64, 1);
    expect(gap({ attackSpeed: 0.25 })).toBeCloseTo(0.64, 1);
    expect(gap({ cooldown: 0.9 })).toBeCloseTo(0.4, 1); // capped at −50% by BalanceConfig.caps.cooldown
  });

  it('+area / +duration resize the spin ring and keep it alive longer', () => {
    const w = withStats({ area: 0.5, duration: 0.5 }, (x) => {
      giveSkill(x, 'bladewheel');
      anchor(x, 0, 2);
    });
    run(w, 20);
    const z = zonesOf(w, ZoneKind.Spin)[0]!;
    expect(w.zones.radius[z]).toBeCloseTo(3 * 1.5, 5);
    expect(w.zones.dur[z]).toBeCloseTo(2.5 * 1.5, 5);
  });

  it('+projectiles feeds orbit / summon / skyStrike / chain / homing counts but not combos or pools', () => {
    const w = withStats({ projectiles: 1 }, (x) => {
      giveSkill(x, 'sword_circle'); // 3 → 4 orbitals
      anchor(x, 0, 6);
    });
    run(w, 20);
    expect(projectilesOf(w, ProjKind.Orbit).length).toBe(4);

    const w2 = withStats({ projectiles: 2 }, (x) => {
      giveSkill(x, 'lightning_trio'); // meleeArc: unaffected, still 2 swings
      anchor(x, 0, 2);
    });
    const recs = run(w2, 40);
    expect(of(recs, 'damage').length).toBe(2);

    const w3 = withStats({ projectiles: 2 }, (x) => {
      giveSkill(x, 'venom_pool'); // groundZone: unaffected, still one pool
      anchor(x, 0, 5);
    });
    run(w3, 20);
    expect(zonesOf(w3, ZoneKind.Circle).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// defaults documented in skills/params.ts for omitted / zero parameters

describe('documented parameter defaults', () => {
  const tweak =
    (id: string, edit: (p: SkillParams) => void) =>
    (c: ContentDB): void => {
      const def = c.skills.find((d) => d.id === id);
      if (!def) throw new Error(`skill ${id} missing`);
      edit(def.params);
    };

  it('projectile: bolts fan 0.18 rad apart when no angle is given', () => {
    const w = lab({
      content: tweak('spirit_bolt', (p) => {
        delete p.angle;
        p.count = 3;
      }),
    });
    const s = giveSkill(w, 'spirit_bolt');
    anchor(w, 0, 13.5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const rows = projectilesOf(w, ProjKind.Bolt, s);
    expect(rows.length).toBe(3);
    const angles = rows.map((r) => heading(w, r)).sort((a, b) => a - b);
    [-0.18, 0, 0.18].forEach((a, i) => expect(angles[i]).toBeCloseTo(a, 5));
  });

  it('skyStrike: strikes are staggered 0.12 s when no tick is given', () => {
    const w = lab({ content: tweak('sky_blades', (p) => (p.tick = 0)) });
    const s = giveSkill(w, 'sky_blades');
    for (const x of [-9, -3, 3, 9]) anchor(w, x, 6);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    const delays = zonesOf(w, ZoneKind.Strike, s)
      .map((r) => w.zones.delay[r] as number)
      .sort((a, b) => a - b);
    expect(delays.length).toBe(4);
    delays.forEach((d, i) => expect(d).toBeCloseTo(0.42 + i * 0.12, 5));
  });

  it('shockwave: expands over 0.55 s when no duration is given', () => {
    const w = lab({ content: tweak('arc_of_might', (p) => (p.duration = 0)) });
    const s = giveSkill(w, 'arc_of_might');
    anchor(w, 0, 2);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    expect(w.zones.aux[zonesOf(w, ZoneKind.Shock, s)[0]!]).toBeCloseTo(0.55, 5);
  });

  it('beam: turns at 3.5 rad/s when no speed is given', () => {
    const w = lab({ content: tweak('soul_beam', (p) => (p.speed = 0)) });
    const s = giveSkill(w, 'soul_beam');
    anchor(w, 0, 5);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    expect(w.zones.aux[zonesOf(w, ZoneKind.Beam, s)[0]!]).toBeCloseTo(3.5, 5);
  });

  it('orbit: re-hit interval 0.45 s when no tick is given', () => {
    const w = lab({ content: tweak('sword_circle', (p) => (p.tick = 0)) });
    const s = giveSkill(w, 'sword_circle');
    anchor(w, 0, 10);
    expect(until(w, () => w.events.some((e) => e.t === 'skillCast'), 60)).toBeGreaterThan(0);
    for (const r of projectilesOf(w, ProjKind.Orbit, s)) expect(w.projectiles.aux[r]).toBeCloseTo(0.45, 5);
  });

  it('spinAura / persistentAura / groundZone tick defaults (0.3 / 0.5 / 0.5 s)', () => {
    const spin = lab({ content: tweak('bladewheel', (p) => (p.tick = 0)) });
    const ss = giveSkill(spin, 'bladewheel');
    anchor(spin, 0, 2);
    run(spin, 20);
    expect(spin.zones.tick[zonesOf(spin, ZoneKind.Spin, ss)[0]!]).toBeCloseTo(0.3, 5);

    const aura = lab({ content: tweak('fury_aura', (p) => (p.tick = 0)) });
    const as = giveSkill(aura, 'fury_aura');
    run(aura, 2);
    expect(aura.zones.tick[zonesOf(aura, ZoneKind.Aura, as)[0]!]).toBeCloseTo(0.5, 5);

    const pool = lab({ content: tweak('venom_pool', (p) => (p.tick = 0)) });
    const ps = giveSkill(pool, 'venom_pool');
    anchor(pool, 0, 5);
    run(pool, 20);
    expect(pool.zones.tick[zonesOf(pool, ZoneKind.Circle, ps)[0]!]).toBeCloseTo(0.5, 5);
  });

  it('meleeArc swings a 2.0 rad arc and cone fans 1.1 rad when no angle is given', () => {
    const arcWorld = lab({ content: tweak('sword_arc', (p) => delete p.angle) });
    const arc = giveSkill(arcWorld, 'sword_arc');
    anchor(arcWorld, 0, 1.9);
    const inside = anchor(arcWorld, ...polar(2.0, 0.9)); // within ±1.0
    const outside = anchor(arcWorld, ...polar(2.0, -1.15));
    const arcRecs = run(arcWorld, 24);
    expect(hitsOf(arcRecs, arc, inside).length).toBe(1);
    expect(hitsOf(arcRecs, arc, outside).length).toBe(0);

    const coneWorld = lab({ content: tweak('frost_cleave', (p) => delete p.angle) });
    const cone = giveSkill(coneWorld, 'frost_cleave');
    anchor(coneWorld, 0, 3);
    const cin = anchor(coneWorld, ...polar(4, 0.5)); // within ±0.55
    const cout = anchor(coneWorld, ...polar(4, 0.7));
    const coneRecs = run(coneWorld, 24);
    expect(hitsOf(coneRecs, cone, cin).length).toBe(1);
    expect(hitsOf(coneRecs, cone, cout).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SIM-04: piercing projectile hit history (no double-hits on high pierce)

describe('SIM-04: piercing projectile hit history', () => {
  it('wyrmstrike (pierce 8, area 1.6) through 10 overlapping targets hits each at most once and reaches 9 distinct enemies', () => {
    const db = structuredClone(content);
    const dog = db.enemies.find((e) => e.id === 'wild_dog');
    if (!dog) throw new Error('wild_dog missing from shipped content');
    db.enemies.push({ ...dog, id: 'anchor', attacks: [], speed: 0, hp: 1e7, damage: 0, mass: 1e6 });

    const w = createWorld(
      {
        zone: 'yeonmu',
        difficulty: 'normal',
        classId: 'warrior',
        doctrine: 'b',
        sex: 'm',
        empire: 'saehwa',
        seed: 11,
        meta: { stats: {} },
      },
      db,
    );
    freezeSchedules(w);
    clearEnemies(w);
    dropSkills(w);
    const p = player(w);
    p.fixed.push({ critChance: -1 });
    refreshStats(p, w.content, w.ix);

    const s = giveSkill(w, 'wyrmstrike', 0);
    s.cd = 0;

    // 10 tightly overlapping targets stacked along the +Z flight path (z = 2.0 .. 5.6)
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(anchor(w, 0, 2.0 + i * 0.4));
    w.hash.rebuild(w.enemies);
    expect(castNow(w, p, s)).toBe(true);
    s.cd = 1e9;

    const recs = run(w, 60);
    const hitCounts = ids.map((id) => hitsOf(recs, s, id).length);
    for (const c of hitCounts) expect(c).toBeLessThanOrEqual(1);
    expect(hitCounts.filter((c) => c === 1)).toHaveLength(9); // pierce 8 => 9 distinct hits
  });

  it('upgraded high-pierce projectile (pierce 15) through 18 overlapping targets hits 16 distinct targets once each', () => {
    const w = lab({
      content: (c) => {
        const def = c.skills.find((d) => d.id === 'spirit_bolt');
        if (def) {
          def.params.count = 1;
          def.params.pierce = 15;
          def.params.area = 1.6;
          def.params.speed = 20;
          def.params.range = 18;
          def.params.knockback = 0;
        }
      },
    });
    const s = giveSkill(w, 'spirit_bolt');
    s.cd = 0;
    const ids: number[] = [];
    for (let i = 0; i < 18; i++) ids.push(anchor(w, 0, 2.0 + i * 0.35));
    w.hash.rebuild(w.enemies);
    expect(castNow(w, player(w), s)).toBe(true);
    s.cd = 1e9;
    const recs = run(w, 90);
    const hitCounts = ids.map((id) => hitsOf(recs, s, id).length);
    for (const c of hitCounts) expect(c).toBeLessThanOrEqual(1);
    expect(hitCounts.filter((c) => c === 1)).toHaveLength(16); // pierce 15 => 16 distinct hits
  });

  it('piercing homing projectile (pierce 8) through 7 clustered targets hits each target at most once', () => {
    const w = lab({
      content: (c) => {
        const def = c.skills.find((d) => d.id === 'soul_crash');
        if (def) {
          def.params.count = 1;
          def.params.pierce = 8;
          def.params.area = 1.4;
          def.params.speed = 16;
          def.params.range = 18;
          def.params.knockback = 0;
        }
      },
    });
    const s = giveSkill(w, 'soul_crash');
    s.cd = 0;
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) ids.push(anchor(w, i % 2 === 0 ? -0.25 : 0.25, 2.2 + i * 0.45));
    w.hash.rebuild(w.enemies);
    expect(castNow(w, player(w), s)).toBe(true);
    s.cd = 1e9;
    const recs = run(w, 90);
    const hitCounts = ids.map((id) => hitsOf(recs, s, id).length);
    for (const c of hitCounts) expect(c).toBeLessThanOrEqual(1);
    expect(hitCounts.filter((c) => c === 1)).toHaveLength(7);
  });
});
