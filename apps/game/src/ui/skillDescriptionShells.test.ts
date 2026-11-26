// skillDescription for the shells, stealth, war oath and feather walk (skill-logic content builder 2): the decimals of the new
// radii / windows print as the design writes them (3.5 m, 4.5 m, 80 s), the percent units sit with their numbers, and the cards say
// what the sim does. \s matches the no-break space the renderer puts between a number and its unit.

import { afterEach, describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import type { SkillDef } from '../data/schema';
import { setLang } from '../i18n/i18n';
import { skillDescription } from './content';

const def = (id: string): SkillDef => content.skills.find((s) => s.id === id) as SkillDef;

afterEach(() => setLang('en'));

describe('skillDescription: shells, stealth, oath, feather walk', () => {
  it('EN', () => {
    setLang('en');
    expect(skillDescription(def('nightshroud'))).toMatch(new RegExp(`for ${def('nightshroud').params.veil}\\s+s creatures lose you`));
    expect(skillDescription(def('nightshroud'))).toContain('bursts for 30 damage');
    expect(skillDescription(def('graniteform'))).toContain(`worth ${def('graniteform').params.shield}% of max HP`);
    expect(skillDescription(def('graniteform'))).toMatch(/shatters across 4\s+m/);
    expect(skillDescription(def('umbral_plate'))).toMatch(/back across 3\.5\s+m \(14 damage and more\)/);
    expect(skillDescription(def('obsidian_bulwark'))).toMatch(/across 4\.5\s+m \(12 damage and more\)/);
    expect(skillDescription(def('mirror_shell'))).toMatch(/every ally within 7\s+m/);
    expect(skillDescription(def('stormglass_shell'))).toMatch(/returns at most 12\s+s after it was raised/);
    expect(skillDescription(def('radiant_favor'))).toMatch(new RegExp(`everyone recovers ${def('radiant_favor').params.heal} HP and carries a holy shield worth ${def('radiant_favor').params.shield}% of max HP for 8\\s+s`));
    expect(skillDescription(def('war_oath'))).toMatch(/rise to 30% of max HP plus 20/);
    expect(skillDescription(def('war_oath'))).toMatch(/Once every 80\s+s\./);
    expect(skillDescription(def('swallows_gait'))).toMatch(/within 3\s+m away/);
    expect(skillDescription(def('swallows_gait'))).toContain('slip the first 2 blows');
  });

  it('TR', () => {
    setLang('tr');
    expect(skillDescription(def('nightshroud'))).toMatch(new RegExp(`${def('nightshroud').params.veil}\\s+sn boyunca yaratıklar seni kaybeder`));
    expect(skillDescription(def('graniteform'))).toContain(`%${def('graniteform').params.shield} azami can değerinde taş bir kabuk`);
    expect(skillDescription(def('umbral_plate'))).toMatch(/3,5\s+m'ye geri saçar \(14 hasar ve fazlası\)/);
    expect(skillDescription(def('obsidian_bulwark'))).toMatch(/4,5\s+m'ye karanlık bir dalga/);
    expect(skillDescription(def('stormglass_shell'))).toMatch(/en geç 12\s+sn sonra yeniden belirir/);
    expect(skillDescription(def('war_oath'))).toMatch(/80\s+sn'de bir\./);
    expect(skillDescription(def('swallows_gait'))).toMatch(/ilk 2 darbeden sıyrılırsın/);
  });
});
