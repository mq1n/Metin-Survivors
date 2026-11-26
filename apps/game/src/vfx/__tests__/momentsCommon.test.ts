// Skill-logic shared moments (skills/common/moments.ts, momentKit.ts): the `sk.gen.*` looks of the redesigned shells, the veil, the lure, the dodge and
// the party link. Pins (1) the contract each kind of emit path needs (marker = tracked summon, event = selfBuff, line = chain), (2) the hero rule
// (additive only, no occlude, clamped stacks), (3) that every `sk.gen.*` id the REAL sim emits has a spec, so a new emit site without a look fails here,
// and (4) that the marker fallback of the feed exists. The class moments (skills/<class>/moments.ts) follow the same contracts, see

import { describe, expect, it } from 'vitest';
import { botInput } from '../../sim/__tests__/bot';
import { drainModals } from '../../sim/__tests__/helpers';
import { PARTNER, only, realWorld, refresh, ringOf } from '../../sim/__tests__/skillLab';
import { castNow } from '../../sim/skills';
import { ProjKind, type PlayerState, type SkillInstance } from '../../sim/stores';
import { PRESETS } from '../presets';
import { COMMON_MOMENT_IDS, COMMON_MOMENT_SPECS } from '../skills/common/moments';
import { SKILL_SPECS } from '../skills';
import { ensureAllSkillVfx } from '../skills/loader';
import { BEHAVIOR_CONTRACTS } from '../spec/preset';
import { MAX_ELEMENTS, type ElementSpec, type FxSpec } from '../spec/types';

await ensureAllSkillVfx();

const MARKERS = ['sk.gen.veil_ring', 'sk.gen.veil_ring_smoke', 'sk.gen.shell_ring', 'sk.gen.bait_ring'];
const EVENTS = ['sk.gen.ward_hit', 'sk.gen.ward_break', 'sk.gen.ward_ring', 'sk.gen.dodge_hop'];
const LINES = ['sk.gen.party_link'];
const spec = (id: string): FxSpec => COMMON_MOMENT_SPECS.find((s) => s.id === id) as FxSpec;
const lists = (s: FxSpec): ElementSpec[] => [...s.elements, ...(s.impact ?? [])];

describe('shared moments: registration and contracts', () => {
  it('exactly the nine shared ids, unique, registered in the eager registry as moments', () => {
    expect([...COMMON_MOMENT_IDS].sort()).toEqual([...MARKERS, ...EVENTS, ...LINES].sort());
    expect(new Set(COMMON_MOMENT_IDS).size).toBe(COMMON_MOMENT_IDS.length);
    const registered = new Set(SKILL_SPECS.filter((s) => s.moment === true).map((s) => s.id));
    const presets = new Set(PRESETS.map((p) => p.id));
    for (const id of COMMON_MOMENT_IDS) {
      expect(registered.has(id), `${id} not registered as a moment`).toBe(true);
      expect(presets.has(id), `${id} has no preset`).toBe(true);
      expect(id.startsWith('sk.gen.')).toBe(true);
    }
  });

  it.each(MARKERS)('%s is a marker look: tracked summon, loop, size mult, base 1 m (k = the row radius), a fast fade', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('summon');
    expect(BEHAVIOR_CONTRACTS[s.behavior].path).toBe('track');
    expect(s.size).toBe('mult');
    expect(s.base).toBe(1);
    expect(s.fadeOut as number).toBeLessThanOrEqual(0.35);
    expect(s.tint, 'a marker row carries no element on the wire: fixed colours').not.toBe(true);
    expect(s.impact, 'a marker never plays an impact').toBeUndefined();
  });

  it.each(EVENTS)('%s is an event look: selfBuff, radius, base 1 (k = the sim scale in metres)', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('selfBuff');
    expect(s.size).toBe('radius');
    expect(s.base).toBe(1);
    expect(s.impact).toBeUndefined();
  });

  it.each(LINES)('%s is a line look: chain, mult, base 1, needs a target, at least one element on the segment', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('chain');
    expect(BEHAVIOR_CONTRACTS[s.behavior].needsTarget).toBe(true);
    expect(s.size).toBe('mult');
    expect(s.base).toBe(1);
    expect(lists(s).some((e) => e.kind !== 'trail' && (e.place === 'along' || e.place === 'target'))).toBe(true);
  });

  it('the damage-free events that carry an element are tint templates (white / pale keys), the others keep their authored colours', () => {
    for (const id of ['sk.gen.ward_hit', 'sk.gen.ward_break', 'sk.gen.party_link']) expect(spec(id).tint, id).toBe(true);
    expect(spec('sk.gen.dodge_hop').tint).not.toBe(true);
    expect(spec('sk.gen.ward_ring').tint).not.toBe(true); // the alpha twin keeps fixed colours
  });

  it('every spec is well-formed and within the element limit', () => {
    for (const s of COMMON_MOMENT_SPECS) {
      expect(typeof s.desc, s.id).toBe('string');
      expect(s.elements.length, s.id).toBeGreaterThan(0);
      expect(s.elements.length, s.id).toBeLessThanOrEqual(MAX_ELEMENTS);
    }
  });
});

describe('shared moments: the hero is never darkened and no raster is added', () => {
  it('every element is additive, nothing uses occlude, bright stacks are clamped', () => {
    const bad: string[] = [];
    for (const s of COMMON_MOMENT_SPECS) {
      if ((s.occlude ?? 0) > 0) bad.push(`${s.id}: spec occlude`);
      lists(s).forEach((e, i) => {
        // fix round 2 (vfx critic X3): an ALPHA twin of a ground ring is allowed when it can never darken: not in a tint template and every drawn key luma >= 0.45 (pull 0)
        if ((e.blend ?? 'add') !== 'add') {
          if (s.tint === true) bad.push(`${s.id}[${i}]: alpha blend in a tint template`);
          const col = (e as { color: readonly number[] }).color;
          for (let k = 0; k < col.length; k += 3) {
            const c = col[k + 1] as number;
            const luma = (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
            if ((col[k + 2] as number) >= 0.1 && luma < 0.45) bad.push(`${s.id}[${i}]: alpha element darker than luma 0.45`);
          }
        }
        if (((e as { occlude?: number }).occlude ?? 0) > 0) bad.push(`${s.id}[${i}]: occlude`);
        if (e.clamp === undefined && (e.bright ?? 1) > 1) bad.push(`${s.id}[${i}]: bright > 1 without clamp`);
        if (typeof e.tex !== 'string') bad.push(`${s.id}[${i}]: generated art (the shared moments use procedural roles only: no change of any run's art scope)`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('tint templates carry white / pale colour keys only (the element palette multiplies them)', () => {
    for (const s of COMMON_MOMENT_SPECS.filter((x) => x.tint === true)) {
      for (const e of lists(s)) {
        for (let i = 0; i + 2 < e.color.length; i += 3) {
          const hex = e.color[i + 1] as number;
          const min = Math.min((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
          expect(min, `${s.id}: key 0x${hex.toString(16)} is not pale enough to be tinted`).toBeGreaterThanOrEqual(0xa0);
        }
      }
    }
  });
});

describe('shared moments: every sk.gen.* id the real sim emits has a spec', () => {
  it('a 40 s shaman co-op run and a ninja / yacha run with every shell, veil, lure, dodge and link of the design emit only ids that resolve', () => {
    const have = new Set(PRESETS.map((p) => p.id));
    const emitted = new Set<string>();
    const note = (w: ReturnType<typeof realWorld>): void => {
      for (const e of w.events) if (e.t === 'vfx') emitted.add(e.preset);
      const P = w.projectiles;
      for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Marker) emitted.add(w.strings.name(P.style[i] as number));
    };
    {
      const w = realWorld({ classId: 'shaman', doctrine: 'b', coop: [PARTNER], live: true, seed: 14, stats: { armor: 80, regen: 6, maxHpPct: 3 } });
      only(w, ['stormglass_shell', 'wyrm_retinue', 'mirror_shell', 'radiant_favor'], 2, 0);
      only(w, ['graniteform', 'cursed_legion', 'swallows_gait', 'umbral_plate'], 2, 1);
      w.qaForceTriggers = true;
      for (let tick = 0; tick < 40 * 60 && !w.over; tick++) {
        drainModals(w);
        w.step([botInput(w, tick), { moveX: Math.cos(tick * 0.02), moveZ: Math.sin(tick * 0.02) }]);
        note(w);
      }
    }
    {
      // the dragon flies to the ally dealing the most damage (here the warrior partner 3 m away): the link caster -> host is the only emit
      const w = realWorld({ classId: 'shaman', doctrine: 'a', coop: [PARTNER], seed: 9 });
      const [dragon] = only(w, ['wyrm_retinue'], 2, 0);
      const partner = w.players[1] as PlayerState;
      partner.x = (w.players[0] as PlayerState).x + 3;
      partner.z = (w.players[0] as PlayerState).z;
      partner.dmgRecent = 1000;
      ringOf(w, 'wild_dog', 3, 5);
      refresh(w);
      expect(castNow(w, w.players[0] as PlayerState, dragon as SkillInstance)).toBe(true);
      note(w);
    }
    {
      const w = realWorld({ classId: 'ninja', doctrine: 'a', live: true, seed: 6, stats: { armor: 60, regen: 5 } });
      only(w, ['nightshroud', 'smoke_bomb', 'swallows_gait'], 2);
      w.qaForceTriggers = true;
      for (let tick = 0; tick < 30 * 60 && !w.over; tick++) {
        drainModals(w);
        w.step([botInput(w, tick)]);
        note(w);
      }
    }
    const gen = [...emitted].filter((id) => id.startsWith('sk.gen.'));
    // the sim really produces the six emitted shared ids (the seventh, shell_ring, is the feed's fallback and never emitted by name)
    for (const id of ['sk.gen.veil_ring', 'sk.gen.bait_ring', 'sk.gen.ward_hit', 'sk.gen.ward_break', 'sk.gen.dodge_hop', 'sk.gen.party_link']) {
      expect(gen, `the sim no longer emits ${id}: update the shared moments / this list`).toContain(id);
    }
    expect(gen.filter((id) => !have.has(id)), 'a sk.gen.* id the sim emits has no spec').toEqual([]);
  }, 60_000);
});
