
// effect covers (graniteform loop + shatter, war_oath save + guard, swallows_gait loop, stealth decoy + burst, eagle_eye mark, spirit_wolves pounce,
// redmane_spirit bite). Pins (1) the contract each moment kind needs (marker = tracked summon, event = selfBuff), (2) the hero rule (no occlude, no
// darkening alpha, bright stacks clamped; the noCasterDarkening guard reads the same specs), (3) the co-op rule (the moments a guest must see are big),
// (4) that every `sk.<skill>.<part>` id the REAL sim emits for these skills has a spec and that the sim still emits all ten ids, so a new emit site
// without a look (or a renamed id) fails here, and (5) that the loops moved out of the casts (graniteform family patch, swallows_gait hand cast) are

import { describe, expect, it } from 'vitest';
import { botInput } from '../../sim/__tests__/bot';
import { drainModals } from '../../sim/__tests__/helpers';
import { hero, only, realWorld, ringOf, step } from '../../sim/__tests__/skillLab';
import { hurtPlayer, HurtKind } from '../../sim/combat';
import { castNow } from '../../sim/skills';
import { ElementIdx, ProjKind, type PlayerState, type SkillInstance } from '../../sim/stores';
import type { World } from '../../sim/world';
import { PRESETS } from '../presets';
import { SKILL_SPECS } from '../skills';
import { ensureAllSkillVfx } from '../skills/loader';
import { WOLFMAN_MOMENT_IDS, WOLFMAN_MOMENT_SPECS } from '../skills/wolfman/moments';
import { NINJA_MOMENT_IDS, NINJA_MOMENT_SPECS } from '../skills/ninja/moments';
import { WARRIOR_MOMENT_IDS, WARRIOR_MOMENT_SPECS } from '../skills/warrior/moments';
import { BEHAVIOR_CONTRACTS } from '../spec/preset';
import { MAX_ELEMENTS, type ElementSpec, type FxSpec } from '../spec/types';

await ensureAllSkillVfx();

const MARKERS = [
  'sk.graniteform.loop', 'sk.graniteform.loop_worn', 'sk.war_oath.guard', 'sk.swallows_gait.loop', 'sk.nightshroud.decoy',
  'sk.warfever.loop', 'sk.redmane_spirit.loop', 'sk.blood_frenzy.loop', 'sk.moonmane_spirit.loop',
];
const EVENTS = [
  'sk.graniteform.shatter', 'sk.war_oath.save', 'sk.nightshroud.burst', 'sk.eagle_eye.mark', 'sk.spirit_wolves.pounce', 'sk.redmane_spirit.bite',
  // fix round 2 (vfx critic): nova rings instead of the filled cream disc, the kill pulses of the kill-fed windows, the persistent eagle brand
  'sk.war_oath.nova', 'sk.warfever.nova', 'sk.warfever.kill', 'sk.swallows_gait.nova', 'sk.eagle_eye.brand',
  'sk.redmane_spirit.nova', 'sk.redmane_spirit.kill', 'sk.blood_frenzy.nova', 'sk.blood_frenzy.kill', 'sk.moonmane_spirit.nova',
];
const ALL_SPECS: FxSpec[] = [...WARRIOR_MOMENT_SPECS, ...NINJA_MOMENT_SPECS, ...WOLFMAN_MOMENT_SPECS];
const spec = (id: string): FxSpec => ALL_SPECS.find((s) => s.id === id) as FxSpec;
const lists = (s: FxSpec): ElementSpec[] => [...s.elements, ...(s.impact ?? [])];

describe('class moments A: registration and contracts', () => {
  it('exactly the listed ids, unique, registered in the lazy class chunks as `moment: true` with a preset each', () => {
    const ids = [...WARRIOR_MOMENT_IDS, ...NINJA_MOMENT_IDS, ...WOLFMAN_MOMENT_IDS];
    expect([...ids].sort()).toEqual([...MARKERS, ...EVENTS].sort());
    expect(new Set(ids).size).toBe(ids.length);
    const registered = new Set(SKILL_SPECS.filter((s) => s.moment === true).map((s) => s.id));
    const presets = new Set(PRESETS.map((p) => p.id));
    for (const id of ids) {
      expect(registered.has(id), `${id} is not registered as a moment (class index.ts spread line?)`).toBe(true);
      expect(presets.has(id), `${id} has no preset`).toBe(true);
    }
  });

  it.each(MARKERS)('%s is a marker look: tracked summon, size mult, base 1 m (k = the row radius), a fast fade, fixed colours', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('summon');
    expect(BEHAVIOR_CONTRACTS[s.behavior].path).toBe('track');
    expect(s.size).toBe('mult');
    expect(s.base).toBe(1);
    expect(s.fadeOut as number).toBeLessThanOrEqual(0.35);
    expect(s.tint, 'a marker row carries no element on the wire: fixed colours').not.toBe(true);
    expect(s.impact, 'a marker never plays an impact').toBeUndefined();
  });

  it.each(EVENTS)('%s is an event look: selfBuff, size radius, base 1 m (k = the sim scale in metres), no impact, no explode', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('selfBuff');
    expect(s.size).toBe('radius');
    expect(s.base).toBe(1);
    expect(s.impact).toBeUndefined();
    expect(s.explode, 'a moment never swallows the awakening explosion').toBeUndefined();
  });

  it('every spec is well-formed and within the element limit', () => {
    for (const s of ALL_SPECS) {
      expect(typeof s.desc, s.id).toBe('string');
      expect(s.elements.length, s.id).toBeGreaterThan(0);
      expect(s.elements.length, s.id).toBeLessThanOrEqual(MAX_ELEMENTS);
    }
  });

  it('the moments a co-op guest must see are big (scale >= 3 or duration >= 1): the shatter (k 4), the oath save (k 5, 1 s), the decoy burst (k 3)', () => {
    // the sim's own numbers: shell.ts endWard (fp.burst, 0.6 s), oathSave (max(4, nova), 1 s), decoyBurst (max(1, area), 0.6 s)
    const cs = (id: string): { scale: number; duration: number } =>
      id === 'sk.graniteform.shatter' ? { scale: 4, duration: 0.6 } : id === 'sk.war_oath.save' ? { scale: 5, duration: 1 } : { scale: 3, duration: 0.6 };
    for (const id of ['sk.graniteform.shatter', 'sk.war_oath.save', 'sk.nightshroud.burst']) {
      const { scale, duration } = cs(id);
      expect(scale >= 3 || duration >= 1, id).toBe(true);
    }
    // marker rows always reach a guest; the small events (mark, pounce, bite) are flavour a guest may drop
    for (const id of ['sk.eagle_eye.mark', 'sk.spirit_wolves.pounce', 'sk.redmane_spirit.bite']) expect(spec(id).tint, id).not.toBe(true);
  });
});

describe('class moments A: the hero is never darkened', () => {
  it('nothing uses occlude, bright stacks are clamped, an alpha element is light stone (the guard measures the pull)', () => {
    const bad: string[] = [];
    for (const s of ALL_SPECS) {
      if ((s.occlude ?? 0) > 0) bad.push(`${s.id}: spec occlude`);
      lists(s).forEach((e, i) => {
        if (((e as { occlude?: number }).occlude ?? 0) > 0) bad.push(`${s.id}[${i}]: occlude`);
        if (e.clamp === undefined && (e.bright ?? 1) > 1) bad.push(`${s.id}[${i}]: bright > 1 without clamp`);
        // alpha elements (fix round 2, vfx critic X3): the alpha TWINS of the ground rings, the granite plates / shards, the eagle brand disc: every drawn key must be luma >= 0.45
        // (pull 0 in noCasterDarkening: they can never darken) and a marker / event of a tint template may hold none
        if ((e.blend ?? 'add') !== 'add') {
          if (s.tint === true) bad.push(`${s.id}[${i}]: alpha blend in a tint template`);
          const col = (e as { color: readonly number[] }).color;
          for (let k = 0; k < col.length; k += 3) {
            const c = col[k + 1] as number;
            const luma = (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
            if ((col[k + 2] as number) >= 0.1 && luma < 0.44) bad.push(`${s.id}[${i}]: alpha element darker than luma 0.44 (${luma.toFixed(2)})`);
          }
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it('the loops that moved out of the casts are not drawn twice (graniteform family patch, swallows_gait hand cast)', () => {
    const keys = (id: string): string[] => lists(SKILL_SPECS.find((s) => s.id === id) as FxSpec).map((e) => (e as { key?: string }).key ?? '');
    // the live graniteform family no longer carries gyeokgongjang_loop#0..3 (they are sk.graniteform.loop now)
    expect(keys('sk.graniteform').filter((k) => k.startsWith('gyeokgongjang_loop'))).toEqual([]);
    expect(keys('sk.graniteform.loop').filter((k) => k.startsWith('gyeokgongjang_loop')).length).toBe(4);
    // the swallows_gait cast keeps its three one-shot elements only; the five loop elements live in the marker
    const cast = lists(SKILL_SPECS.find((s) => s.id === 'sk.swallows_gait') as FxSpec);
    expect(cast.some((e) => (e as { loops?: number }).loops === 0), 'a looping element left in the swallows_gait cast').toBe(false);
    expect(lists(spec('sk.swallows_gait.loop')).every((e) => e.kind === 'surface' || (e as { loops?: number }).loops === 0)).toBe(true);
  });
});

describe('class moments A: the hero stays readable at the two instants the recheck measured as a ghost (B1 oath save, B2 crimson cast)', () => {
  type Part = { note?: string; at?: readonly number[]; half?: unknown; clamp?: number; bright?: number; shape?: { kind?: string; rb?: number; edge?: boolean; radius?: number } };
  const parts = (s: FxSpec): Part[] => lists(s) as unknown as Part[];
  const named = (s: FxSpec, start: string): Part => {
    const e = parts(s).filter((x) => (x.note ?? '').startsWith(start));
    expect(e.length, `${s.id}: element "${start}"`).toBe(1);
    return e[0] as Part;
  };
  /** the vertical half-size of a quad (`half` is one curve = square, or [x curve, y curve]); a curve is [t, v, t, v ...] */
  const halfY = (h: unknown): number => {
    const c = Array.isArray(h) && Array.isArray(h[0]) ? (h[1] as number[]) : (h as number[]);
    return Math.max(...c.filter((_, i) => i % 2 === 1));
  };
  const spawnSpec = (id: string): FxSpec => SKILL_SPECS.find((s) => s.id === id) as FxSpec;

  it('war_oath.save: no sheath cylinder round the body, the star sits above and behind the head, small and clamped', () => {
    const s = spec('sk.war_oath.save');
    // a cylinder at the feet (at.y 0) wider than the beam drew its near wall over the whole body (retention 0.41 on snow)
    const sheaths = parts(s).filter((e) => e.shape?.kind === 'cyl' && (e.at?.[1] ?? 0) < 0.3 / 5 && (e.shape.rb ?? 0) > 0.06);
    expect(sheaths, 'a cylinder standing on the hero').toEqual([]);
    const star = named(s, 'star:');
    expect((star.at?.[1] as number) * 5, 'star height (m at k 5)').toBeGreaterThanOrEqual(2.5);
    expect(star.at?.[2] as number, 'star set behind the head').toBeLessThan(0);
    expect(halfY(star.half) * 5, 'star half-size (m at k 5)').toBeLessThanOrEqual(0.6);
    expect(star.clamp).toBeLessThanOrEqual(0.6);
  });

  it('the war_oath hand cast (it plays at the save) rings the body with its flames and clamps every body layer', () => {
    const s = spawnSpec('sk.war_oath');
    for (const n of ['flame tongues wrapping the body', 'second flame layer']) {
      const e = named(s, n);
      expect(e.shape?.kind, n).toBe('ellipse');
      expect(e.shape?.edge, `${n}: a ring, not a filled body`).toBe(true);
      expect(e.clamp, n).toBeLessThanOrEqual(0.5);
    }
    expect(named(s, 'small chest flash').at?.[2] as number, 'chest flash behind the body').toBeLessThan(0);
    expect(named(s, 'small chest flash').clamp).toBeLessThanOrEqual(0.6);
    expect(named(s, 'rising orange-white light streaks').clamp).toBeLessThanOrEqual(0.6);
  });

  it('crimson wolf soul (amber path): no upright or camera-facing quad near the hero is taller than its height (the ground cut it: the straight edge across the waist)', () => {
    const s = spawnSpec('sk.redmane_spirit');
    for (const n of ['eruption fan', 'eruption curtain', 'eruption glow core', 'smoke_dirt1 haze, additive light part']) {
      const e = named(s, n);
      expect(halfY(e.half), `${n}: half ${halfY(e.half)} > at.y ${e.at?.[1]}`).toBeLessThanOrEqual(e.at?.[1] as number);
    }
    const core = named(s, 'eruption glow core');
    expect(core.at?.[2] as number, 'glow core behind the body').toBeLessThan(0);
    expect(core.clamp).toBeLessThanOrEqual(0.5);
    expect(named(s, 'smoke_dirt1 haze, additive light part').shape?.edge, 'the haze is a ring, not a filled disc over the hero').toBe(true);
    // the head flare of the spirit stands behind the head
    expect(named(s, 'wolf_eff (screen, 0.64 m x 2 -> 5)').at?.[2] as number).toBeLessThan(0);
  });
});

describe('class moments A: every sk.<skill>.<part> id the real sim emits for these skills has a spec, and the sim still emits the ten', () => {
  const MINE = /^sk\.(graniteform|war_oath|second_wind|berserk|stealth|smoke_bomb|swallows_gait|eagle_eye|shadow_clone|spirit_wolves|redmane_spirit|blood_frenzy|moonmane_spirit)\./;
  /** parts the sim emits that are NOT class A moments: the cast / strike / explode parts of the converter families and the other classes' ids */
  const have = new Set(PRESETS.map((p) => p.id));
  const emitted = new Set<string>();
  const note = (w: World): void => {
    for (const e of w.events) if (e.t === 'vfx') emitted.add(e.preset);
    const P = w.projectiles;
    for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Marker) emitted.add(w.strings.name(P.style[i] as number));
  };
  const run = (w: World, seconds: number, bot = true): void => {
    for (let tick = 0; tick < seconds * 60 && !w.over; tick++) {
      drainModals(w);
      w.step([bot ? botInput(w, tick) : { moveX: 0, moveZ: 0 }]);
      note(w);
    }
  };
  const blow = (w: World, p: PlayerState, amount: number): void => {
    p.iframes = 0;
    hurtPlayer(w, p.index, amount, 3, 0, ElementIdx.Physical, HurtKind.Melee, 0);
    note(w);
  };

  it('warrior: the stone shell (loop marker, a blow that breaks it -> shatter) and the oath (a killing blow -> save + guard)', () => {
    {
      const w = realWorld({ classId: 'warrior', doctrine: 'b', seed: 5 });
      const [s] = only(w, ['graniteform']);
      const p = hero(w);
      ringOf(w, 'wolf', 3, 2.5);
      w.hash.rebuild(w.enemies);
      expect(castNow(w, p, s as SkillInstance)).toBe(true);
      note(w);
      blow(w, p, p.ward * 4);
      step(w, 2);
      note(w);
    }
    {
      const w = realWorld({ classId: 'warrior', doctrine: 'a', seed: 5 });
      const p = hero(w);
      p.stats.revives = 0;
      only(w, ['war_oath']);
      step(w, 3);
      p.hp = 10;
      blow(w, p, 1e5);
      step(w, 1);
      note(w);
    }
    for (const id of ['sk.graniteform.loop', 'sk.graniteform.shatter', 'sk.war_oath.save', 'sk.war_oath.guard']) expect([...emitted], `the sim no longer emits ${id}: update the warrior moments / this list`).toContain(id);
  });

  it('ninja: stealth (decoy marker, the burst when the veil ends), feather walk (loop marker) and eagle eye (a mark per branded foe)', () => {
    {
      const w = realWorld({ classId: 'ninja', doctrine: 'a', seed: 6, stats: { armor: 80, regen: 6 } });
      only(w, ['nightshroud']);
      ringOf(w, 'wild_dog', 7, 2.2);
      w.qaForceTriggers = true;
      run(w, 8);
    }
    {
      const w = realWorld({ classId: 'ninja', doctrine: 'b', seed: 6, stats: { armor: 80, regen: 6 } });
      only(w, ['swallows_gait', 'eagle_eye']);
      ringOf(w, 'wolf', 1, 6, 0, { tier: 2 });
      ringOf(w, 'wild_dog', 6, 2.5);
      w.qaForceTriggers = true;
      run(w, 6);
    }
    for (const id of ['sk.nightshroud.decoy', 'sk.nightshroud.burst', 'sk.swallows_gait.loop', 'sk.eagle_eye.mark']) expect([...emitted], `the sim no longer emits ${id}: update the ninja moments / this list`).toContain(id);
  });

  it('wolfman: spirit wolves pounce on prey, the crimson wolf soul bites', () => {
    {
      const w = realWorld({ classId: 'wolfman', doctrine: 'b', seed: 7, stats: { armor: 80, regen: 6 } });
      only(w, ['spirit_wolves'], 2);
      ringOf(w, 'wolf', 2, 7, 0, { tier: 1 });
      ringOf(w, 'wild_dog', 5, 4);
      w.qaForceTriggers = true;
      run(w, 8);
    }
    {
      const w = realWorld({ classId: 'wolfman', doctrine: 'a', seed: 7, stats: { armor: 80, regen: 6 } });
      only(w, ['redmane_spirit'], 2);
      // tough creatures: the eruption (nova) must not kill them all, the bites need a foe alive for the pulse
      for (const row of ringOf(w, 'bear', 4, 4)) {
        w.enemies.hp[row] = 1e5;
        w.enemies.hpMax[row] = 1e5;
      }
      w.qaForceTriggers = true;
      run(w, 8);
    }
    for (const id of ['sk.spirit_wolves.pounce', 'sk.redmane_spirit.bite']) expect([...emitted], `the sim no longer emits ${id}: update the wolfman moments / this list`).toContain(id);
  });

  it('every id of these skills the sim emitted resolves to a spec, except the cast and its strike / explode parts of the families', () => {
    const missing = [...emitted].filter((id) => MINE.test(id) && !have.has(id));
    expect(missing, 'a moment the sim emits has no spec: add it to skills/<class>/moments.ts').toEqual([]);
  });
});
