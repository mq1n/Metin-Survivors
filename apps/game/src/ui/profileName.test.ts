// An unnamed profile reads "Hero" in English and "Kahraman" in Turkish; a chosen name is shown as typed (QA EXPLORER-1).
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n/i18n';
import { DEFAULT_PROFILE_NAME } from '../meta/save';
import { profileFieldValue, profileLabel } from './profileName';

afterEach(() => setLang('en'));

describe('profileLabel', () => {
  it('shows the default name in the language of the UI', () => {
    setLang('en');
    expect(profileLabel(DEFAULT_PROFILE_NAME)).toBe('Hero');
    setLang('tr');
    expect(profileLabel(DEFAULT_PROFILE_NAME)).toBe('Kahraman');
  });

  it('shows a chosen name unchanged in both languages', () => {
    for (const l of ['en', 'tr'] as const) {
      setLang(l);
      expect(profileLabel('Ejder')).toBe('Ejder');
    }
  });
});

describe('profileFieldValue', () => {
  it('leaves the name field empty for an unnamed profile so the placeholder asks for a name', () => {
    expect(profileFieldValue(DEFAULT_PROFILE_NAME)).toBe('');
    expect(profileFieldValue('Ejder')).toBe('Ejder');
  });
});
