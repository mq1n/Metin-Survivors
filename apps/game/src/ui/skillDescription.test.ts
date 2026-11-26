// skillDescription (ui/content.ts): the decimal placeholders of the skill-logic cards (3.5 m, 1.5 s, 1.6 m) print their decimal, every
// card text of the shipped content resolves all its placeholders in both languages, and the unit sits with its number (no-break space).

import { afterEach, describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import type { SkillDef } from '../data/schema';
import { setLang } from '../i18n/i18n';
import { skillDescription } from './content';

const def = (id: string): SkillDef => content.skills.find((s) => s.id === id) as SkillDef;

afterEach(() => setLang('en'));

describe('skillDescription', () => {
  it('prints one decimal for nova / veil / pulse / area / cooldown, whole numbers stay whole', () => {
    setLang('en');
    expect(skillDescription(def('warfever'))).toContain('a 3.5 m roar');
    expect(skillDescription(def('smoke_bomb'))).toContain('for 1.5 s the smoke hides you');
    expect(skillDescription(def('redmane_spirit'))).toContain('every 1.5 s a spectral wolf');
    const fsCd = def('blaze_familiars').params.cooldown;
    expect(skillDescription(def('blaze_familiars'))).toMatch(new RegExp('Every ' + fsCd + '\\s+s each spirit'));
    expect(skillDescription(def('blaze_familiars'))).toContain('across 1.5 m');
    expect(skillDescription(def('surging_arms'))).toContain('everyone within 10 m');
    setLang('tr');
    expect(skillDescription(def('warfever'))).toContain("3,5 m'lik bir kükreme");
    expect(skillDescription(def('blaze_familiars'))).toMatch(new RegExp('Her ' + String(fsCd).replace('.', ',') + "\\s+sn'de"));
  });

  it('every shipped skill text resolves every placeholder in EN and TR', () => {
    const bad: string[] = [];
    for (const lang of ['en', 'tr'] as const) {
      setLang(lang);
      for (const d of content.skills) if (/\{\w+\}/.test(skillDescription(d))) bad.push(`${lang} ${d.id}`);
    }
    expect(bad).toEqual([]);
  });
});
