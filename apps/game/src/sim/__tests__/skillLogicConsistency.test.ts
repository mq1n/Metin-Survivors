// Skill-logic WP3 consistency pass over the 31 skills of the design (DESIGN section 0): every payload key sits on a behavior that
// reads it, every key a role brain reads exists, every {placeholder} of a card / awakening text resolves, the two languages say
// the same numbers, and an awakening text names what its keys do. Real content (data/content/skills.json), no world.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { SKILL_PAYLOAD_KEYS, type SkillDef } from '../../data/schema';

/** the 31 skills the skill-logic design touches (30 candidates + smoke_bomb) */
const DESIGNED = [
  'nightshroud', 'smoke_bomb', 'blaze_familiars', 'shadow_clone', 'spirit_wolves', 'wyrm_retinue', 'thunder_guardians', 'cursed_legion',
  'graniteform', 'umbral_plate', 'obsidian_bulwark', 'mirror_shell', 'stormglass_shell', 'radiant_favor', 'war_oath', 'second_wind', 'mending_light',
  'warfever', 'redmane_spirit', 'blood_frenzy', 'surging_arms', 'sovereigns_ire', 'eagle_eye', 'dark_covenant', 'swallows_gait',
  'tailwind', 'moonmane_spirit', 'chilling_dread', 'unbinding_sigil', 'swordlight_ring', 'haunted_steel',
];

const skills: SkillDef[] = DESIGNED.map((id) => {
  const d = content.skills.find((s) => s.id === id);
  if (!d) throw new Error(`no skill ${id}`);
  return d;
});

type P = Record<string, unknown>;
const params = (d: SkillDef): P => d.params as unknown as P;

describe('the 31 designed skills exist exactly once', () => {
  it('31 distinct ids, all in skills.json, none basic', () => {
    expect(new Set(DESIGNED).size).toBe(31);
    for (const d of skills) expect(d.kind, d.id).not.toBe('basic');
  });
});

/** which skills may carry a payload key (the behavior / role that reads it); a key anywhere else would be dead data */
const READERS: Record<string, (d: SkillDef) => boolean> = {
  veil: () => true, // finishCast: any behavior
  taunt: (d) => d.behavior === 'selfBuff' || d.role === 'planted',
  shield: (d) => d.behavior === 'selfBuff',
  burst: (d) => d.behavior === 'selfBuff',
  power: (d) => d.behavior === 'selfBuff' || d.behavior === 'summon',
  drain: (d) => d.behavior === 'selfBuff',
  mirror: (d) => d.behavior === 'selfBuff',
  steady: (d) => d.behavior === 'selfBuff',
  party: (d) => d.behavior === 'selfBuff' || d.role === 'coil',
  nova: () => true, // finishCast
  novaDamage: () => true,
  cost: (d) => d.behavior === 'selfBuff',
  mark: (d) => d.behavior === 'selfBuff',
  pulse: (d) => d.behavior === 'selfBuff',
  stack: (d) => d.behavior === 'selfBuff',
  extend: (d) => d.behavior === 'selfBuff',
  refund: (d) => d.behavior === 'selfBuff',
  purge: (d) => d.behavior === 'groundZone',
  missing: (d) => d.behavior === 'cone',
  leech: (d) => d.behavior === 'cone',
};

describe('every payload key is read by the behavior that carries it', () => {
  it('the reader table covers all 20 payload keys', () => {
    expect(Object.keys(READERS).sort()).toEqual([...SKILL_PAYLOAD_KEYS].sort());
  });

  it('no designed skill carries a payload key its behavior ignores, and every value is a sane number', () => {
    const bad: string[] = [];
    for (const d of skills) {
      for (const key of SKILL_PAYLOAD_KEYS) {
        const v = params(d)[key];
        if (v === undefined) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) bad.push(`${d.id}.${key} = ${String(v)}`);
        else if (!(READERS[key] as (x: SkillDef) => boolean)(d)) bad.push(`${d.id}.${key}: ${d.behavior}${d.role ? '/' + d.role : ''} does not read it`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('shell keys come together: burst / power / steady / mirror / drain need a ward; a ward needs a window and a base heal of 0 or a stated one', () => {
    const bad: string[] = [];
    for (const d of skills) {
      const p = params(d) as Record<string, number | undefined>;
      const ward = (p.shield ?? 0) > 0;
      if (!ward) {
        // war oath's `power` is the HP floor and the stealth decoy burst reads `damage` / `area`: neither is a ward key
        for (const k of ['burst', 'steady', 'mirror', 'drain']) if ((p[k] ?? 0) > 0) bad.push(`${d.id}.${k} without a ward`);
      } else {
        if ((p.duration ?? 0) <= 0) bad.push(`${d.id}: ward without a duration`);
        if (d.behavior !== 'selfBuff') bad.push(`${d.id}: ward on a ${d.behavior}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a gated selfBuff keeps a buff block (the loader needs it) and a summon with a role reads its keys', () => {
    const need: Record<string, string[]> = {
      orbiter: ['count', 'range', 'speed', 'area', 'damage', 'cooldown'],
      hunter: ['count', 'area', 'tick', 'range', 'speed', 'power'],
      planted: ['area', 'tick', 'range', 'power'],
      coil: ['party', 'tick', 'range', 'speed', 'area'],
      mimic: ['power', 'tick', 'speed'],
    };
    const bad: string[] = [];
    for (const d of skills) {
      if (d.behavior === 'selfBuff' && !d.params.buff) bad.push(`${d.id}: selfBuff without buff`);
      if (d.role) {
        for (const k of need[d.role] as string[]) {
          const v = params(d)[k];
          // the knight (planted + taunt) swings at `pierce` targets and does not read `power`
          if (d.role === 'planted' && (params(d).taunt as number | undefined) && k === 'power') continue;
          if (typeof v !== 'number' || v <= 0) bad.push(`${d.id} (${d.role}): ${k} = ${String(v)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('triggers: known kinds, lethal only on war oath, minHp only where HP is paid, a patience only with a gate', () => {
    const lethal = skills.filter((d) => d.trigger?.any.includes('lethal')).map((d) => d.id);
    expect(lethal).toEqual(['war_oath']);
    for (const d of skills) {
      if (!d.trigger) continue;
      expect(d.behavior === 'selfBuff' || d.behavior === 'summon' || d.behavior === 'shockwave' || d.behavior === 'cone', `${d.id}: gated ${d.behavior}`).toBe(true);
      if (d.trigger.minHp !== undefined) expect(params(d).cost, `${d.id}: minHp guards the blood price`).toBeGreaterThan(0);
      if (d.trigger.any.includes('ally')) expect(params(d).party ?? 0, `${d.id}: an ally trigger reads the party reach`).toBeGreaterThan(0);
    }
  });
});

// ----------------------------------------------------------------------------------------------------------------- texts
const keysIn = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
/** the literal numbers of a text with the placeholders removed (decimal comma = point) */
const numbersIn = (text: string): string[] =>
  [...text.replace(/\{\w+\}/g, ' ').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => (m[0] as string).replace(',', '.')).sort();

describe('card and awakening texts', () => {
  it('every {placeholder} is a numeric param of the skill, in all four texts', () => {
    const bad: string[] = [];
    for (const d of skills) {
      for (const [where, t] of [['desc', d.desc], ['awaken', d.awaken.desc]] as const) {
        for (const lang of ['tr', 'en'] as const) {
          for (const k of keysIn(t[lang])) if (typeof params(d)[k] !== 'number') bad.push(`${d.id}.${where}.${lang}: {${k}}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('TR and EN use the same placeholders and the same literal numbers', () => {
    const bad: string[] = [];
    for (const d of skills) {
      for (const [where, t] of [['desc', d.desc], ['awaken', d.awaken.desc]] as const) {
        const k1 = keysIn(t.tr).join(',');
        const k2 = keysIn(t.en).join(',');
        if (k1 !== k2) bad.push(`${d.id}.${where}: placeholders tr[${k1}] en[${k2}]`);
        const n1 = numbersIn(t.tr).join(' ');
        const n2 = numbersIn(t.en).join(' ');
        if (n1 !== n2) bad.push(`${d.id}.${where}: numbers tr[${n1}] en[${n2}]`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('awakening texts name what their keys do (duration / cooldown percentages, added HP, nova radius, extra count)', () => {
    const bad: string[] = [];
    const pct = (x: number): string => String(Math.round(x * 100));
    for (const d of skills) {
      const aw = d.awaken.params;
      for (const lang of ['tr', 'en'] as const) {
        const text = d.awaken.desc[lang];
        const nums = new Set(numbersIn(text).map((n) => String(Math.round(Number(n)))));
        const twice = /twice|two times|iki kat|double/i.test(text);
        const need = (what: string, ok: boolean): void => {
          if (!ok) bad.push(`${d.id}.${lang}: ${what} not in "${text}"`);
        };
        if (aw.durationMul !== undefined && aw.durationMul !== 1) need(`durationMul ${aw.durationMul}`, nums.has(pct(aw.durationMul - 1)) || (aw.durationMul === 2 && twice));
        if (aw.cooldownMul !== undefined && aw.cooldownMul !== 1) need(`cooldownMul ${aw.cooldownMul}`, nums.has(pct(1 - aw.cooldownMul)));
        if (aw.areaMul !== undefined && aw.areaMul !== 1) need(`areaMul ${aw.areaMul}`, nums.has(pct(aw.areaMul - 1)));
        if (aw.damageMul !== undefined && aw.damageMul !== 1) need(`damageMul ${aw.damageMul}`, nums.has(pct(aw.damageMul - 1)));
        if (aw.healAdd !== undefined && aw.healAdd > 0) need(`healAdd ${aw.healAdd}`, nums.has(String(Math.round(aw.healAdd))));
        if (aw.nova !== undefined && aw.nova > 0) need(`nova ${aw.nova}`, nums.has(String(Math.round(aw.nova))));
      }
    }
    expect(bad).toEqual([]);
  });

  it('no designed skill text still describes a removed mechanic (a timer plateau, flat evasion on stealth, the 12 m cast guard)', () => {
    const stale: [string, RegExp][] = [
      ['nightshroud', /evasion|kaçınma/i], // the old stat block
      ['war_oath', /heal at once|anında iyileş/i],
      ['stormglass_shell', /thorns|resist|hurled back/i],
    ];
    for (const [id, re] of stale) {
      const d = skills.find((s) => s.id === id) as SkillDef;
      expect(re.test(d.desc.en) || re.test(d.desc.tr), `${id} card text`).toBe(false);
    }
  });
});
