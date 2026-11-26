

// against the REAL sim: every skill of data/content/skills.json is cast in a lab world and the radius / scale the behaviour put on
// the bus (vfx / vfxLine events), the zone rows and the projectile rows is compared with the formula, fed with the final params
// the behaviour resolved (so rank upgrades / talents / player stats never move the test, only a behaviour edit does).
import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { BehaviorKind } from '../../data/schema';
import { NO_INPUT, clearEnemies, dropSkills, freezeSchedules, makeWorld, player, spawn } from '../../sim/__tests__/helpers';
import { addSkill } from '../../sim/skills';
import { BEHAVIOR_CONTRACTS, castScale, shippedScale, summonScales } from '../spec/preset';
import type { SkillBehavior } from '../spec/types';

describe('shippedScale: the judge numbers (skills.json params, rank 1)', () => {
  const skill = (id: string) => {
    const s = content.skills.find((x) => x.id === id);
    if (!s) throw new Error(`no skill ${id}`);
    return s;
  };
  const scale = (id: string) => shippedScale(skill(id).behavior, skill(id).params);

  it('rimewind: the cone length (range 6), not the area', () => {
    expect(scale('rimewind')).toBe(6);
  });
  it('ambush 1.4, nightfall 2, graniteform max(2, 2.2), bladewheel zone radius, bash reach', () => {
    expect(scale('moonless_cut')).toBeCloseTo(1.4, 6);
    expect(scale('nightfall')).toBeCloseTo(2, 6);
    expect(scale('graniteform')).toBeCloseTo(2.2, 6);
    expect(scale('bladewheel')).toBeCloseTo(skill('bladewheel').params.area, 6);
    expect(scale('crushing_blow')).toBeCloseTo(Math.max(0.8, skill('crushing_blow').params.area), 6);
  });
  it('mult presets: projectile radius (edgewave 0.8, drifting_charms 0.5), chain 1', () => {
    expect(scale('edgewave')).toBeCloseTo(0.8, 6);
    expect(scale('drifting_charms')).toBeCloseTo(0.5, 6);
    expect(scale('arcing_bolt')).toBe(1);
  });
  it('every behaviour of the contract table has a rule, finite and positive for every skill', () => {
    for (const b of Object.keys(BEHAVIOR_CONTRACTS) as SkillBehavior[]) {
      expect(shippedScale(b, { area: 0, range: 0 })).toBeGreaterThan(0);
    }
    for (const s of content.skills) expect(shippedScale(s.behavior, s.params)).toBeGreaterThan(0);
  });
  it('awakening multiplies area / range into the scale (rank P strips)', () => {
    expect(shippedScale('cone', { range: 6 }, { rangeMul: 1.5 })).toBe(9);
    expect(shippedScale('spinAura', { area: 3 }, { areaMul: 1.25 })).toBeCloseTo(3.75, 6);
  });
});

/** casts `id` in a lab world with the pack at `dists` m along the hero's aim; returns the first sight of each kind of row (the scale
 *  the sim put on it) and the final params the cast resolved */
function cast(id: string, dists: readonly number[]): { rows: Map<string, number>; fp: { area: number; range: number } } {
  const def = content.skills.find((s) => s.id === id);
  if (!def) throw new Error(`no skill ${id}`);
  const w = makeWorld({ config: { seed: 5 } });
  // context-gated skills (skill logic) still cast on their plain cooldown in this lab
  w.qaForceTriggers = true;
  freezeSchedules(w);
  dropSkills(w);
  clearEnemies(w);
  const p = player(w);
  p.fixed.push({ critChance: -1 });
  for (const d of dists) spawn(w, 'wolf', 0.4 * (d % 3), d);
  const s = addSkill(w, p, def, 0);
  const pid = w.strings.id(def.vfx ?? '');
  const rows = new Map<string, number>();
  let fp = { area: 0, range: 0 };
  const note = (kind: string, value: number): void => {
    if (rows.has(kind)) return;
    rows.set(kind, value);
    // the params the cast used: a buff the cast applies (blessing +area) only changes them for the NEXT cast
    if (rows.size === 1) fp = { area: s.fp.area, range: s.fp.range };
  };
  for (let tick = 0; tick < 150; tick++) {
    w.step([NO_INPUT]);
    for (const e of w.events) {
      if (e.t === 'skillCast' && e.skillId === def.id) note('cast', e.area);
      if (e.t === 'vfx' && e.preset === def.vfx) note(e.hasTarget ? 'line' : def.behavior === 'summon' && Math.abs(e.scale) === 2.5 ? 'summonCast' : 'event', Math.abs(e.scale));
    }
    const z = w.zones;
    for (let i = 0; i < z.count; i++) if (z.preset[i] === pid) note('zone', z.radius[i] as number);
    const pr = w.projectiles;
    for (let i = 0; i < pr.count; i++) if (pr.style[i] === pid) note('proj', pr.radius[i] as number);
    // keep the pack alive (the lab dummies must outlive the cast window)
    for (let i = 0; i < w.enemies.count; i++) w.enemies.hp[i] = 1e7;
  }
  return { rows, fp };
}

describe('shippedScale against the sim (lab casts of every skill with an sk.* preset)', () => {
  // which row type carries the preset's scale per behaviour (path column of BEHAVIOR_CONTRACTS)
  const via: Record<BehaviorKind, string> = {
    meleeArc: 'event', cone: 'event', selfBuff: 'event', leap: 'event', skyStrike: 'zone', dash: 'line', chain: 'line',
    spinAura: 'zone', persistentAura: 'zone', groundZone: 'zone', shockwave: 'zone', beam: 'zone',
    projectile: 'proj', homingProjectile: 'proj', orbit: 'proj', summon: 'summonCast',
  } as Record<BehaviorKind, string>;
  const checked = new Map<string, number>();
  const skipped: string[] = [];

  for (const def of content.skills.filter((s) => s.vfx?.startsWith('sk.'))) {
    it(`${def.id} (${def.behavior})`, () => {
      const want = via[def.behavior as BehaviorKind] as string;
      // a near pack (melee / cone / dash triggers) and a far one (projectiles that would hit before the first poll)
      let got = cast(def.id, [2, 3, 4.5, 6, 8, 10]);
      if (!got.rows.has(want)) got = cast(def.id, [5.5, 7, 9, 11, 12.5]);
      const fp = got.fp;
      const hit = got.rows.has(want) ? { kind: want, value: got.rows.get(want) as number } : null;
      if (!hit) {
        // a lab world cannot trigger it (needs a state the lab lacks): reported, never silently green for a whole behaviour
        skipped.push(`${def.id}:${def.behavior}`);
        return;
      }
      // the `sk.<id>.cast` helper: the adapter fires it with the skillCast event's area (castScale), any behaviour
      if (got.rows.has('cast')) expect(got.rows.get('cast'), `${def.id}: skillCast area vs castScale`).toBeCloseTo(castScale(fp), 4);
      const expected = def.behavior === 'orbit' ? shippedScale('orbit', fp) : shippedScale(def.behavior, fp);
      expect(hit.value, `${def.id}: sim ${hit.kind} ${hit.value} vs shippedScale ${expected} (final params area ${fp.area}, range ${fp.range})`).toBeCloseTo(expected, 4);
      checked.set(def.behavior, (checked.get(def.behavior) ?? 0) + 1);
    });
  }

  it('every behaviour of the contract table was verified against the sim by at least one skill', () => {
    const missing = (Object.keys(BEHAVIOR_CONTRACTS) as SkillBehavior[]).filter((b) => !checked.has(b) && content.skills.some((s) => s.behavior === b && s.vfx?.startsWith('sk.')));
    // eslint-disable-next-line no-console
    if (skipped.length) console.info(`shippedScale: ${skipped.length} skills not triggered by the lab pack: ${skipped.join(', ')}; verified ${[...checked].map(([b, n]) => `${b} x${n}`).join(', ')}`);
    expect(missing, `behaviours never reached in the lab (skipped: ${skipped.join(', ')})`).toEqual([]);
  });

  it('the summon body / strike scales are the ones summon.ts spawns', () => {
    const d = summonScales({ area: 1.5 });
    expect(d).toEqual({ cast: 2.5, body: 0.5, strike: 1.5 });
  });
});
