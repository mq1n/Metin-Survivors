// Count-aware UI strings (QA CAMPAIGN-3 / CAMPAIGN-4): "1 codex entry", "1 run · 0 wins" read as English, not "1 entries" / "1 runs".
import { afterEach, describe, expect, it } from 'vitest';
import { setLang, tn } from '../i18n/i18n';
import { heroRecord } from './screens/heroRecord';

afterEach(() => setLang('en'));

describe('run report: codex unlock chip (CAMPAIGN-3)', () => {
  it('English: one entry is singular, every other count plural', () => {
    setLang('en');
    expect(tn('runEnd.unlockCodex', 1)).toBe('1 codex entry');
    expect(tn('runEnd.unlockCodex', 2)).toBe('2 codex entries');
    expect(tn('runEnd.unlockCodex', 50)).toBe('50 codex entries');
  });

  it('Turkish keeps one form for every count', () => {
    setLang('tr');
    expect(tn('runEnd.unlockCodex', 1)).toBe('1 kodeks kaydı');
    expect(tn('runEnd.unlockCodex', 50)).toBe('50 kodeks kaydı');
  });
});

describe('hero select: doctrine record line (CAMPAIGN-4)', () => {
  it('English: 1 run / 1 win singular, 0 and many plural', () => {
    setLang('en');
    expect(heroRecord(1, 0)).toBe('1 run · 0 wins');
    expect(heroRecord(1, 1)).toBe('1 run · 1 win');
    expect(heroRecord(2, 0)).toBe('2 runs · 0 wins');
    expect(heroRecord(12, 3)).toBe('12 runs · 3 wins');
  });

  it('Turkish: sefer / zafer for every count', () => {
    setLang('tr');
    expect(heroRecord(1, 1)).toBe('1 sefer · 1 zafer');
    expect(heroRecord(12, 3)).toBe('12 sefer · 3 zafer');
  });
});
