// Skill-logic class moments B (skills/yacha/moments.ts, skills/shaman/moments.ts): the looks the redesigned yacha and shaman skills emit. Pins (1) the contract each
// kind of emit path needs (marker = tracked summon, event = selfBuff / skyStrike part, line = chain, breath = homingProjectile), (2) the hero rule (additive only,
// no occlude, clamped stacks, procedural roles only: no art key, no change of any run's art scope), (3) that the READ-ABLE loops and the thunder arc are built to
// stay continuous, (4) the shell conversions of umbral_plate / obsidian_bulwark (no alpha element left on the casts), and (5) that every yacha / shaman moment id

import { describe, expect, it } from 'vitest';
import { botInput } from '../../sim/__tests__/bot';
import { drainModals } from '../../sim/__tests__/helpers';
import { PARTNER, only, realWorld } from '../../sim/__tests__/skillLab';
import { ProjKind } from '../../sim/stores';
import { PRESETS } from '../presets';
import { SKILL_SPECS } from '../skills';
import { ensureAllSkillVfx } from '../skills/loader';
import { SHAMAN_MOMENT_IDS, SHAMAN_MOMENT_SPECS } from '../skills/shaman/moments';
import { YACHA_MOMENT_IDS, YACHA_MOMENT_SPECS } from '../skills/yacha/moments';
import { BEHAVIOR_CONTRACTS } from '../spec/preset';
import { MAX_ELEMENTS, type ElementSpec, type FxSpec } from '../spec/types';

await ensureAllSkillVfx();

const ALL: readonly FxSpec[] = [...YACHA_MOMENT_SPECS, ...SHAMAN_MOMENT_SPECS];
const ALL_IDS: readonly string[] = [...YACHA_MOMENT_IDS, ...SHAMAN_MOMENT_IDS];
const spec = (id: string): FxSpec => ALL.find((s) => s.id === id) as FxSpec;
const lists = (s: FxSpec): ElementSpec[] => [...s.elements, ...(s.impact ?? [])];

const MARKERS = ['sk.umbral_plate.loop', 'sk.obsidian_bulwark.loop', 'sk.mirror_shell.loop', 'sk.radiant_favor.loop', 'sk.stormglass_shell.loop'];
const EVENTS = [
  'sk.umbral_plate.burst',
  'sk.obsidian_bulwark.burst',
  'sk.cursed_legion.rise',
  'sk.dark_covenant.pay',
  'sk.unbinding_sigil.purge',
  'sk.mirror_shell.burst',
  'sk.mirror_shell.turn',
  'sk.stormglass_shell.pulse',
  'sk.thunder_guardians.plant',
  'sk.sovereigns_ire.descent',
  'sk.stormglass_shell.nova',
  'sk.surging_arms.nova',
  'sk.tailwind.nova',
];
const PARTS = ['sk.blaze_familiars.cast', 'sk.blaze_familiars.explode'];
const LINES = ['sk.thunder_guardians.arc', 'sk.thunder_guardians.blink'];
const BREATH = 'sk.wyrm_retinue.breath';

describe('class moments B: registration and contracts', () => {
  it('exactly the designed ids, unique, registered in the loaded registry as moments with a preset each', () => {
    expect([...ALL_IDS].sort()).toEqual([...MARKERS, ...EVENTS, ...PARTS, ...LINES, BREATH].sort());
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
    const registered = new Set(SKILL_SPECS.filter((s) => s.moment === true).map((s) => s.id));
    const presets = new Set(PRESETS.map((p) => p.id));
    for (const id of ALL_IDS) {
      expect(registered.has(id), `${id} not registered as a moment (class index.ts spread line missing?)`).toBe(true);
      expect(presets.has(id), `${id} has no preset`).toBe(true);
    }
    for (const id of YACHA_MOMENT_IDS) expect(id.startsWith('sk.') && !id.startsWith('sk.gen.')).toBe(true);
  });

  it.each(MARKERS)('%s is a marker look: tracked summon, loop, size mult, base 1 m (k = the row radius), a fast fade, no tint', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('summon');
    expect(BEHAVIOR_CONTRACTS[s.behavior].path).toBe('track');
    expect(s.size).toBe('mult');
    expect(s.base).toBe(1);
    expect(s.fadeOut as number).toBeLessThanOrEqual(0.35);
    expect(s.tint, 'a marker row carries no element on the wire: fixed colours').not.toBe(true);
    expect(s.impact).toBeUndefined();
  });

  it.each(EVENTS)('%s is an event look: selfBuff, radius, base 1 (k = the sim scale in metres), nothing tracked', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('selfBuff');
    expect(s.size).toBe('radius');
    expect(s.base).toBe(1);
    expect(s.impact).toBeUndefined();
  });

  it('the moments a co-op guest must see are big (the spec length is the sim duration: rise 1.0 s, plant 1.0 s, descent 1.0 s)', () => {
    for (const id of ['sk.cursed_legion.rise', 'sk.thunder_guardians.plant', 'sk.sovereigns_ire.descent']) expect(spec(id).dur, id).toBeGreaterThanOrEqual(1);
    for (const id of ['sk.umbral_plate.burst', 'sk.obsidian_bulwark.burst', 'sk.mirror_shell.burst', 'sk.stormglass_shell.pulse']) expect(spec(id).dur, id).toBeGreaterThanOrEqual(0.6);
  });

  it.each(PARTS)('%s is a skill part: skyStrike (event) at the shipped area (1.5 m), hand sockets or one-shot elements only', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('skyStrike');
    expect(s.size).toBe('radius');
    expect(s.base).toBe(1.5);
    expect(s.impact).toBeUndefined();
  });

  it.each(LINES)('%s is a line look: chain, mult, base 1, needs a target, at least one element on the segment', (id) => {
    const s = spec(id);
    expect(s.behavior).toBe('chain');
    expect(s.size).toBe('mult');
    expect(s.base).toBe(1);
    expect(BEHAVIOR_CONTRACTS[s.behavior].needsTarget).toBe(true);
    expect(lists(s).some((e) => { const x = e as { place?: string; travel?: unknown }; return x.place === 'along' || x.place === 'target' || x.travel !== undefined; })).toBe(true);
  });

  it('the thunder arc reads CONTINUOUS: a 1.0 s line whose strands re-strike back-to-back (loop surfaces), so the next emit overlaps the last strand', () => {
    const a = spec('sk.thunder_guardians.arc');
    expect(a.dur).toBe(1);
    const strands = a.elements.filter((e) => e.kind === 'surface' && e.loop === true && e.place === 'along' && (e.shape.kind === 'bolt'));
    expect(strands.length).toBeGreaterThanOrEqual(2);
    for (const e of strands) {
      if (e.kind !== 'surface') continue;
      // a strand never fades to nothing inside its own life (no blink at the loop seam or at the 1.0 s boundary)
      const alphas = e.color.filter((_, i) => i % 3 === 2);
      expect(Math.min(...alphas), 'a strand that fades to 0 blinks at every re-strike').toBeGreaterThan(0.1);
    }
  });

  it('the dragon breath is a tracked homing look (base 0.45 = the row radius) with an end burst', () => {
    const s = spec(BREATH);
    expect(s.behavior).toBe('homingProjectile');
    expect(BEHAVIOR_CONTRACTS[s.behavior].path).toBe('track');
    expect(s.size).toBe('mult');
    expect(s.base).toBe(0.45);
    expect((s.impact ?? []).length).toBeGreaterThan(0);
  });

  it('the damage-free turn event that carries an element is a tint template (white / pale keys), every other look keeps its authored colours', () => {
    expect(spec('sk.mirror_shell.turn').tint).toBe(true);
    for (const s of ALL.filter((x) => x.id !== 'sk.mirror_shell.turn')) expect(s.tint, s.id).not.toBe(true);
    for (const e of lists(spec('sk.mirror_shell.turn'))) {
      for (let i = 0; i + 2 < e.color.length; i += 3) {
        const hex = e.color[i + 1] as number;
        expect(Math.min((hex >> 16) & 255, (hex >> 8) & 255, hex & 255), `key 0x${hex.toString(16)} is not pale enough to be tinted`).toBeGreaterThanOrEqual(0xa0);
      }
    }
  });

  it('every spec is well-formed and within the element limit', () => {
    for (const s of ALL) {
      expect(typeof s.desc, s.id).toBe('string');
      expect(s.elements.length, s.id).toBeGreaterThan(0);
      expect(s.elements.length, s.id).toBeLessThanOrEqual(MAX_ELEMENTS);
      expect((s.impact ?? []).length, s.id).toBeLessThanOrEqual(MAX_ELEMENTS);
    }
  });
});

describe('class moments B: the hero is never darkened and no raster is added', () => {
  it('every element is additive, nothing uses occlude, bright stacks are clamped, procedural roles only', () => {
    const bad: string[] = [];
    for (const s of ALL) {
      if ((s.occlude ?? 0) > 0) bad.push(`${s.id}: spec occlude`);
      lists(s).forEach((e, i) => {
        // fix round 2 (vfx critic X3): alpha TWINS of ground rings are allowed when they can never darken (no tint template, every drawn key luma >= 0.44, pull 0)
        if ((e.blend ?? 'add') !== 'add') {
          if (s.tint === true) bad.push(`${s.id}[${i}]: alpha blend in a tint template`);
          const col = (e as { color: readonly number[] }).color;
          for (let k = 0; k < col.length; k += 3) {
            const c = col[k + 1] as number;
            const luma = (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
            if ((col[k + 2] as number) >= 0.1 && luma < 0.44) bad.push(`${s.id}[${i}]: alpha element darker than luma 0.44 (${luma.toFixed(2)})`);
          }
        }
        if (((e as { occlude?: number }).occlude ?? 0) > 0) bad.push(`${s.id}[${i}]: occlude`);
        if (e.clamp === undefined && s.clamp === undefined && (e.bright ?? 1) > 1) bad.push(`${s.id}[${i}]: bright > 1 without clamp`);
        if (typeof e.tex !== 'string') bad.push(`${s.id}[${i}]: generated art (the class moments use procedural roles only: no change of any run's art scope)`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('the converted casts of umbral_plate and obsidian_bulwark have no alpha element left and no standing loop (the markers carry the loops)', () => {
    for (const id of ['sk.umbral_plate', 'sk.obsidian_bulwark']) {
      const s = SKILL_SPECS.find((x) => x.id === id) as FxSpec;
      expect(s, id).toBeDefined();
      expect(s.occlude ?? 0, id).toBe(0);
      s.elements.forEach((e, i) => {
        expect(e.blend ?? 'add', `${id}[${i}] must be additive light`).toBe('add');
        expect((e as { loop?: boolean }).loop, `${id}[${i}]: the loop ring is the marker ${id}.loop`).not.toBe(true);
        expect(e.kind === 'particle' ? e.loops ?? 1 : 1, `${id}[${i}]: a loops 0 element would repeat for the whole buff (the marker draws that)`).not.toBe(0);
      });
    }
  });

  it('the flame spirit body is tracked (summon, base 0.5 = the row radius), additive, with no impact list and no Bezier orbit path', () => {
    const s = SKILL_SPECS.find((x) => x.id === 'sk.blaze_familiars') as FxSpec;
    expect(s.behavior).toBe('summon');
    expect(s.base).toBe(0.5);
    expect(s.impact, 'the twin burst is sk.blaze_familiars.explode').toBeUndefined();
    s.elements.forEach((e, i) => {
      expect(e.blend ?? 'add', `body[${i}]`).toBe('add');
      if (e.kind !== 'particle') return;
      const { path } = e;
      // the only path allowed is the +-0.3 m / 0.4 s sine wobble of the ember tail: lateral only, never the 1.2 m x 1.9 m tilted ring
      if (path !== undefined) {
        expect(path.y, `body[${i}] must not carry a hardcoded orbit height path`).toBeUndefined();
        expect(path.z, `body[${i}] must not carry a hardcoded orbit depth path`).toBeUndefined();
        const xs = (path.x ?? []).filter((_, k) => k % 2 === 1);
        expect(Math.max(...xs.map(Math.abs)), `body[${i}] wobble`).toBeLessThanOrEqual(0.31);
      }
    });
  });
});

describe('class moments B: every yacha / shaman moment id the real sim emits has a spec', () => {
  const MINE = /^sk\.(umbral_plate|obsidian_bulwark|cursed_legion|dark_covenant|blaze_familiars|unbinding_sigil|mirror_shell|radiant_favor|stormglass_shell|thunder_guardians|wyrm_retinue|sovereigns_ire|tailwind|mending_light|surging_arms)\./;

  it('a 30 s yacha run and a 40 s shaman co-op run with every shell, companion and pay of the design emit only ids that resolve, and emit the designed ones', () => {
    const have = new Set(PRESETS.map((p) => p.id));
    const emitted = new Set<string>();
    const note = (w: ReturnType<typeof realWorld>): void => {
      for (const e of w.events) if (e.t === 'vfx') emitted.add(e.preset);
      const P = w.projectiles;
      for (let i = 0; i < P.count; i++) {
        const k = P.kind[i];
        if (k === ProjKind.Marker || k === ProjKind.Familiar || k === ProjKind.Homing) emitted.add(w.strings.name(P.style[i] as number));
      }
    };
    {
      const w = realWorld({ classId: 'yacha', doctrine: 'a', live: true, seed: 12, stats: { armor: 90, regen: 8, maxHpPct: 3 } });
      only(w, ['umbral_plate', 'cursed_legion', 'unbinding_sigil', 'blaze_familiars'], 3, 0);
      w.qaForceTriggers = true;
      for (let tick = 0; tick < 30 * 60 && !w.over; tick++) {
        drainModals(w);
        w.step([botInput(w, tick)]);
        note(w);
      }
    }
    {
      const w = realWorld({ classId: 'yacha', doctrine: 'b', live: true, seed: 5, stats: { armor: 90, regen: 8, maxHpPct: 3 } });
      only(w, ['obsidian_bulwark', 'dark_covenant', 'blaze_familiars'], 3, 0);
      w.qaForceTriggers = true;
      for (let tick = 0; tick < 30 * 60 && !w.over; tick++) {
        drainModals(w);
        w.step([botInput(w, tick)]);
        note(w);
      }
    }
    // one ward skill per world: a ward never stacks (a bigger foreign ward stays and the skill waits), so reflect / blessing / stormglass_shell each get their own run
    for (const [ids, seed] of [[['mirror_shell'], 14], [['radiant_favor'], 15], [['stormglass_shell', 'thunder_guardians'], 16]] as const) {
      const w = realWorld({ classId: 'shaman', doctrine: 'b', coop: [PARTNER], live: true, seed, stats: { armor: 80, regen: 6, maxHpPct: 3 } });
      only(w, [...ids], 3, 0);
      w.qaForceTriggers = true;
      for (let tick = 0; tick < 40 * 60 && !w.over; tick++) {
        drainModals(w);
        w.step([botInput(w, tick), { moveX: Math.cos(tick * 0.02), moveZ: Math.sin(tick * 0.02) }]);
        note(w);
      }
    }
    const mine = [...emitted].filter((id) => MINE.test(id));
    // the designed moments the sim really produces in these runs (a rename or a removed emit site fails here, so the look list and the sim stay in step)
    for (const id of ['sk.umbral_plate.loop', 'sk.obsidian_bulwark.loop', 'sk.cursed_legion.rise', 'sk.dark_covenant.pay', 'sk.mirror_shell.loop', 'sk.radiant_favor.loop', 'sk.stormglass_shell.loop', 'sk.thunder_guardians.plant', 'sk.thunder_guardians.arc']) {
      expect(mine, `the sim no longer emits ${id}: update the class moments / this list`).toContain(id);
    }
    expect(mine.filter((id) => !have.has(id)), 'a yacha / shaman moment id the sim emits has no spec').toEqual([]);
  }, 120_000);
});
