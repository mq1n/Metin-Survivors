// HD-02: the hero select recommends the Shaman only while the profile has no run (and never points at a class the content lacks).
import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { dictionaries } from '../../i18n/i18n';
import { fixtureContent } from '../../meta/__fixtures__/content';
import { NOW, freshSave, makeRun } from '../../meta/__fixtures__/testkit';
import { seededRng } from '../../meta/rng';
import { normalizeSave } from '../../meta/save';
import { settleRun } from '../../meta/settle';
import { FIRST_RUN_HERO, firstRunHero } from './heroFirstRun';

describe('firstRunHero', () => {
  it('recommends the Shaman on a fresh profile', () => {
    const save = freshSave();
    expect(save.stats.runs).toBe(0);
    expect(FIRST_RUN_HERO).toBe('shaman');
    expect(firstRunHero(save, content.classes)).toBe('shaman');
  });

  it('the shipped content has the class and its card text (both languages)', () => {
    expect(content.classes.some((c) => c.id === FIRST_RUN_HERO)).toBe(true);
    for (const dict of [dictionaries.en, dictionaries.tr]) {
      for (const k of ['hero.reco.badge', 'hero.reco.tip', 'hero.reco.cap']) expect(dict[k], k).toBeTruthy();
      expect(dict['hero.reco.cap']).toContain('{hero}');
    }
  });

  it('stops after the first settled run, whichever hero played it', () => {
    for (const classId of ['warrior', 'shaman'] as const) {
      const played = settleRun(freshSave(), fixtureContent, makeRun({ classId, victory: false }), seededRng(2), NOW + 1).save;
      expect(played.stats.runs).toBe(1);
      expect(firstRunHero(played, content.classes)).toBeNull();
    }
  });

  it('a profile that lost its total but kept a class record is not fresh (imports, cloud merges)', () => {
    const save = freshSave();
    save.stats.classes.ninja.runs = 2;
    expect(firstRunHero(save, content.classes)).toBeNull();
  });

  it('survives a save that went through the normaliser (a reload)', () => {
    const fresh = normalizeSave(JSON.parse(JSON.stringify(freshSave())), fixtureContent);
    expect(firstRunHero(fresh, content.classes)).toBe('shaman');
    const played = settleRun(freshSave(), fixtureContent, makeRun(), seededRng(2), NOW + 1).save;
    expect(firstRunHero(normalizeSave(JSON.parse(JSON.stringify(played)), fixtureContent), content.classes)).toBeNull();
  });

  it('points at nothing when the content has no Shaman', () => {
    expect(firstRunHero(freshSave(), content.classes.filter((c) => c.id !== 'shaman'))).toBeNull();
    expect(firstRunHero(freshSave(), [])).toBeNull();
  });
});
