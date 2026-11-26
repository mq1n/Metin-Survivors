// Skill-logic WP5 (DESIGN section 9, payloads.test.ts) on the SHIPPED buffs: the payload keys of skills.json do what the card says with the
// real numbers - base-kit nova, resist price, kill-fed extend / refund / stack with their caps and the "stack cap in <= 8 s at 4 kills/s"
// target, pulse bites, mark top-3, cost floor, party reach in a 2-player world, cure on an ally, Vigil on every skill that declares it.
// Fixture-content mechanics (cap arithmetic, order independence, RNG) are in selfBuffPayloads.test.ts.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { hitEnemy, newHitCtx } from '../combat';
import { castNow } from '../skills';
import { StatusBit, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { def, hero, only, realWorld, ringOf, step, PARTNER } from './skillLab';

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

/** a quiet-field kill: a fresh far-away dog dies */
function killOne(w: World, i = 0, killer = 0): void {
  kill(w, ringOf(w, 'wild_dog', 1, 30 + (i % 7), killer)[0] as number, killer);
}

describe('berserk: roar, price, kill feed', () => {
  it('the base-kit nova hits the creatures inside 3.5 m for damage x novaDamage, not those outside', () => {
    const w = realWorld({ classId: 'warrior', doctrine: 'a' });
    const [s] = only(w, ['warfever']);
    const p = hero(w);
    const [near] = ringOf(w, 'bear', 1, 2.5);
    const [far] = ringOf(w, 'bear', 1, 6);
    for (const r of [near, far]) {
      w.enemies.hp[r as number] = 1e4;
      w.enemies.hpMax[r as number] = 1e4;
    }
    expect(cast(w, p, s!)).toBe(true);
    expect(w.enemies.hp[near as number] as number, 'inside the nova').toBeLessThan(1e4);
    expect(w.enemies.hp[far as number] as number, 'outside').toBe(1e4);
  });

  it('the rage window costs 15 % resist on all eight elements and gives it back when it ends', () => {
    const w = realWorld({ classId: 'warrior', doctrine: 'a' });
    const [s] = only(w, ['warfever']);
    const p = hero(w);
    step(w, 2);
    const before = Array.from(p.stats.resist);
    expect(before.length).toBeGreaterThanOrEqual(8);
    expect(cast(w, p, s!)).toBe(true);
    step(w, 2);
    for (let e = 0; e < 8; e++) expect(p.stats.resist[e], `element ${e}`).toBeCloseTo((before[e] as number) - 0.15, 5);
    step(w, 9 * 60);
    for (let e = 0; e < 8; e++) expect(p.stats.resist[e], `element ${e} restored`).toBeCloseTo(before[e] as number, 5);
  });

  it('the kill feed saturates at its caps: extend +50 % of 8 s, refund trig.refundCap of the cooldown', () => {
    const w = realWorld({ classId: 'warrior', doctrine: 'a' });
    const [s] = only(w, ['warfever']);
    const p = hero(w);
    cast(w, p, s!);
    const cd0 = s!.cd;
    const left0 = p.buffs.find((b) => b.skillSlot === s!.slot)?.left as number;
    for (let i = 0; i < 300; i++) killOne(w, i);
    const b = p.buffs.find((x) => x.skillSlot === s!.slot);
    expect(b?.ext, 'extend capped at extendCap x duration').toBeCloseTo(0.5 * 8, 5);
    expect(b?.left).toBeCloseTo(left0 + 4, 5);
    expect(cd0 - s!.cd, 'refund capped at refundCap x cooldown').toBeCloseTo(w.trig.refundCap * cd0, 4);
  });
});

describe('blood frenzy: stack', () => {
  it('at 4 kills per second the stack cap (+60 %) is reached in 8 s or less, and the stats follow the scale', () => {
    const w = realWorld({ classId: 'wolfman', doctrine: 'a' });
    const [s] = only(w, ['blood_frenzy']);
    const p = hero(w);
    cast(w, p, s!);
    step(w, 2);
    const base = p.stats.damage;
    let t = 0;
    let capAt = -1;
    for (let k = 0; k < 120 && capAt < 0; k++) {
      killOne(w, k);
      if (k % 4 === 3) {
        step(w, 60);
        t += 1;
      }
      const b = p.buffs.find((x) => x.skillSlot === s!.slot);
      if ((b?.scale ?? 1) >= 1.6 - 1e-6) capAt = t;
    }
    expect(capAt, 'cap reached').toBeGreaterThan(0);
    expect(capAt, 'seconds at 4 kills/s').toBeLessThanOrEqual(8);
    step(w, 2);
    expect(p.stats.damage, 'the buff block grew with the scale (damage .1 x 1.6)').toBeCloseTo(base + 0.1 * 0.6, 4);
  });
});

describe('crimson wolf soul: pulse', () => {
  it('a spectral bite every 1.5 s on the nearest foe while the window runs, none after it', () => {
    const w = realWorld({ classId: 'wolfman', doctrine: 'a' });
    const [s] = only(w, ['redmane_spirit']);
    const p = hero(w);
    p.stats.damage = 1;
    const row = ringOf(w, 'bear', 1, 5)[0] as number;
    w.enemies.hp[row] = 1e5;
    w.enemies.hpMax[row] = 1e5;
    w.enemies.speed[row] = 0;
    cast(w, p, s!);
    // sample the skill's own damage meter over the 8 s window (the nova at the cast is the first jump)
    let bites = 0;
    let last = s!.damage;
    for (let i = 0; i < 8 * 60; i++) {
      step(w, 1);
      if (s!.damage > last + 1e-6) bites++;
      last = s!.damage;
    }
    expect(last, 'the wolf bit').toBeGreaterThan(0);
    expect(bites, 'about one bite per 1.5 s over 8 s (+ the bleed ticks)').toBeGreaterThanOrEqual(4);
    // let the bleed run out, then nothing more is booked on the skill
    step(w, 6 * 60);
    const settled = s!.damage;
    step(w, 4 * 60);
    expect(s!.damage, 'no bite after the window').toBe(settled);
  });
});

describe('eagle eye: mark', () => {
  it('brands the three toughest foes inside 14 m with the weaken status, nobody else', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'b' });
    const [s] = only(w, ['eagle_eye']);
    const p = hero(w);
    const tiers = [0, 0, 1, 2, 0, 0];
    const rows = tiers.map((tier, i) => ringOf(w, 'wild_dog', 1, 4 + i, 0, { tier })[0] as number);
    const outsider = ringOf(w, 'wild_dog', 1, 20, 0, { tier: 3 })[0] as number;
    expect(cast(w, p, s!)).toBe(true);
    const weak = (r: number): boolean => ((w.enemies.status[r] as number) & StatusBit.Weaken) !== 0;
    const marked = rows.filter(weak);
    expect(marked).toHaveLength(3);
    // the two elites are among them, and exactly one tier-0 creature (the highest HP / lowest row)
    expect(weak(rows[2] as number)).toBe(true);
    expect(weak(rows[3] as number)).toBe(true);
    expect(weak(outsider), 'beyond 14 m').toBe(false);
    expect(p.buffs.some((b) => b.skillSlot === s!.slot)).toBe(true);
  });
});

describe('dark covenant: cost', () => {
  it('pays 12 % of max HP at the cast and never takes the hero below 1 HP', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'b' });
    const [s] = only(w, ['dark_covenant']);
    const p = hero(w);
    p.stats.revives = 0;
    const hp0 = p.hp;
    cast(w, p, s!);
    // 12 % paid, 10 healed back
    expect(p.hp).toBeCloseTo(Math.min(p.hpMax, hp0 - 0.12 * p.hpMax + 10), 2);
    const w2 = realWorld({ classId: 'yacha', doctrine: 'b' });
    const [s2] = only(w2, ['dark_covenant']);
    const p2 = hero(w2);
    p2.hp = 3;
    castNow(w2, p2, s2!);
    expect(p2.hp, 'the pact cannot kill').toBeGreaterThanOrEqual(1);
    expect(p2.alive).toBe(true);
  });
});

describe('party reach in a 2-player world', () => {
  function pair(ids: string[], dist: number): { w: World; a: PlayerState; b: PlayerState; s: SkillInstance } {
    const w = realWorld({ classId: 'shaman', doctrine: 'b', coop: [PARTNER] });
    const [s] = only(w, ids);
    const a = hero(w, 0);
    const b = hero(w, 1);
    a.x = a.px = 0;
    a.z = a.pz = 0;
    b.x = b.px = dist;
    b.z = b.pz = 0;
    return { w, a, b, s: s! };
  }

  it('attack up (party 10 m): an ally in reach gets the damage window under the CASTER slot, one beyond 10 m gets nothing', () => {
    const near = pair(['surging_arms'], 8);
    expect(cast(near.w, near.a, near.s)).toBe(true);
    expect(near.b.buffs.some((x) => x.skillSlot === near.s.slot)).toBe(true);
    expect(near.a.buffs.some((x) => x.skillSlot === near.s.slot)).toBe(true);
    const far = pair(['surging_arms'], 14);
    expect(cast(far.w, far.a, far.s)).toBe(true);
    expect(far.b.buffs.some((x) => x.skillSlot === far.s.slot)).toBe(false);
  });

  it('cure: an ally under 55 % HP inside 10 m calls the pillar by itself, and the ally is healed (not only the caster)', () => {
    const { w, a, b } = pair(['mending_light'], 6);
    b.hp = b.hpMax * 0.4;
    const hp0 = b.hp;
    a.hp = a.hpMax;
    step(w, 6);
    expect(b.hp, 'the ally was healed by the pillar').toBeGreaterThan(hp0 + 20);
  });

  it('cure stays quiet at full health for everybody', () => {
    const { w, s } = pair(['mending_light'], 6);
    step(w, 120);
    expect(s.cd, 'no cast: nobody needs it').toBe(0);
  });

  it("dragon god's wrath: a 6 m golden wave and the window for an ally within 12 m", () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'a', coop: [PARTNER] });
    const [s] = only(w, ['sovereigns_ire']);
    const a = hero(w, 0);
    const b = hero(w, 1);
    a.x = a.px = 0;
    b.x = b.px = 10;
    const inside = ringOf(w, 'bear', 1, 5)[0] as number;
    const outside = ringOf(w, 'bear', 1, 8)[0] as number;
    for (const r of [inside, outside]) {
      w.enemies.hp[r] = 1e4;
      w.enemies.hpMax[r] = 1e4;
    }
    expect(cast(w, a, s!)).toBe(true);
    expect(b.buffs.some((x) => x.skillSlot === s!.slot), 'ally at 10 m').toBe(true);
    expect(w.enemies.hp[inside] as number, 'inside the 6 m wave').toBeLessThan(1e4);
    expect(w.enemies.hp[outside] as number, 'outside the wave').toBe(1e4);
  });
});

describe('life force (the gihyeol cone: gather every last drop, loose it forward, the wounded hit harder and heal by hitting)', () => {
  /** a warrior at `frac` of max HP with one tough bear 4 m away (the cone aims at the nearest creature), the skill fired by hand */
  function fire(frac: number): { w: World; p: PlayerState; s: SkillInstance; row: number; lost: number; healed: number; hpAfter: number } {
    const w = realWorld({ classId: 'warrior', doctrine: 'a', seed: 21 });
    const [s] = only(w, ['second_wind']);
    const p = hero(w);
    const row = ringOf(w, 'bear', 1, 4)[0] as number;
    w.enemies.hp[row] = 1e5;
    w.enemies.hpMax[row] = 1e5;
    p.hp = p.hpMax * frac;
    const hp0 = p.hp;
    expect(cast(w, p, s!)).toBe(true);
    return { w, p, s: s!, row, lost: 1e5 - (w.enemies.hp[row] as number), healed: p.hp - hp0, hpAfter: p.hp };
  }

  it('is a cone of range 8 m that fires on a hurt warrior and hits the creature in front', () => {
    const d = def('second_wind');
    expect(d.behavior).toBe('cone');
    expect(d.params.range).toBe(8);
    const f = fire(0.5);
    expect(f.lost, 'the fan hit the bear').toBeGreaterThan(0);
    expect(f.s.cd, 'the lockout started').toBeGreaterThan(0);
  });

  it('hits harder the more wounded the hero is: x(1 + 2 x missing HP), so about double at half HP', () => {
    const full = fire(1);
    const half = fire(0.5);
    expect(half.lost / full.lost).toBeGreaterThan(1.8);
    expect(half.lost / full.lost).toBeLessThan(2.2);
  });

  it('returns 25 % of the damage dealt as health, capped at 15 % of max HP + the heal lines', () => {
    const f = fire(0.3);
    expect(f.healed, 'leech heals').toBeGreaterThan(0);
    expect(f.healed).toBeLessThanOrEqual(f.p.hpMax * 0.15 + 1e-6);
    expect(f.healed).toBeLessThanOrEqual(f.lost * 0.25 + 1e-6);
  });

  it('fires by itself when the hero is hurt (danger: HP <= 55 %) and a creature stands in the fan', () => {
    const w = realWorld({ classId: 'warrior', doctrine: 'a', seed: 21 });
    const [s] = only(w, ['second_wind']);
    const p = hero(w);
    ringOf(w, 'bear', 1, 4);
    p.hp = p.hpMax * 0.5;
    step(w, 4);
    expect(s!.cd, 'danger opened the gate').toBeGreaterThan(0);
  });
});

describe('Vigil: the standing bonus of every skill that declares one', () => {
  const VIGIL = content.skills.filter((s) => s.vigil !== undefined);
  it('the design has 13 vigil carriers', () => {
    expect(VIGIL.length).toBeGreaterThanOrEqual(10);
  });
  for (const d of VIGIL) {
    it(`${d.id}: owning it raises ${Object.keys(d.vigil ?? {}).join(' / ')} at once, and dropping it takes the bonus away`, () => {
      const base = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      only(base, []);
      step(base, 2);
      const w = realWorld({ classId: d.classId, doctrine: d.doctrine ?? 'a' });
      only(w, [d.id]);
      step(w, 2);
      const p0 = hero(base);
      const p1 = hero(w);
      const stat = p1.stats as unknown as Record<string, number>;
      const stat0 = p0.stats as unknown as Record<string, number>;
      let checked = 0;
      for (const [k, v] of Object.entries(d.vigil ?? {})) {
        if (typeof v !== 'number' || v <= 0) continue;
        if (k === 'maxHpPct') {
          expect(p1.hpMax, `${d.id} ${k}`).toBeGreaterThan(p0.hpMax);
          checked++;
        } else if (typeof stat[k] === 'number') {
          expect(stat[k] as number, `${d.id} ${k}`).toBeGreaterThan(stat0[k] as number);
          checked++;
        }
      }
      expect(checked, `${d.id}: at least one vigil key is visible in the stats`).toBeGreaterThan(0);
      // dropping the skill drops the bonus
      p1.skills.splice(p1.skills.findIndex((s) => s.def.id === d.id), 1);
      p1.statsDirty = true;
      step(w, 2);
      for (const [k, v] of Object.entries(d.vigil ?? {})) {
        if (typeof v !== 'number' || v <= 0 || k === 'maxHpPct' || typeof stat[k] !== 'number') continue;
        expect(stat[k] as number, `${d.id} ${k} after dropping`).toBeCloseTo(stat0[k] as number, 5);
      }
    });
  }
});

describe('Swordlight Ring stays unchanged (KEEP)', () => {
  it('its definition is the pre-redesign one: a permanent aura with no trigger, role, vigil or payload key', () => {
    const d = def('swordlight_ring');
    expect(d.behavior).toBe('persistentAura');
    expect(d.trigger).toBeUndefined();
    expect(d.role).toBeUndefined();
    expect(d.vigil).toBeUndefined();
    expect(d.params).toEqual({
      damage: 5, cooldown: 1, area: 3.2, count: 1, duration: 0, speed: 0, pierce: 0, knockback: 0.15, tick: 0.5, range: 0,
      status: { kind: 'weaken', chance: 0.35, duration: 1.5, power: 0.15 },
    });
    expect(d.upgrades.map((u) => `${u.stat}:${u.mode}:${u.base}`)).toEqual(['damage:pct:0.18', 'area:pct:0.12', 'tick:pct:0.08', 'statusChance:flat:0.07', 'statusPower:pct:0.2']);
  });
});

void def;
