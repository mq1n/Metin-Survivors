// The run-end banner: an abandoned run must not read "DEFEAT — You fell …" (prod2 finding: a 62 s abandon did).
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../../i18n/i18n';
import { runTone } from './runTone';

const hero = (alive: boolean, index = 0) => ({ index, level: 12, kills: 300, yeop: 900, alive });

describe('runTone', () => {
  it('a win is a victory whatever the party looks like', () => {
    expect(runTone({ victory: true, time: 1000, players: [hero(true)] })).toBe('victory');
    expect(runTone({ victory: true, time: 3, players: [] })).toBe('victory');
  });

  it('a run left with a hero still standing is abandoned, at any length (the pause → Abandon path)', () => {
    for (const time of [5, 59.9, 60, 61.7, 62, 400, 899]) {
      expect(runTone({ victory: false, time, players: [hero(true)] }), `${time}s`).toBe('ended');
    }
  });

  it('a dead party is a defeat, at any length (a death at 40 s is not "run ended")', () => {
    for (const time of [8, 40, 59, 60, 61.7, 400]) {
      expect(runTone({ victory: false, time, players: [hero(false)] }), `${time}s`).toBe('defeat');
    }
  });

  it('co-op: a defeat needs everybody down; one teammate still alive means the run was cut short', () => {
    expect(runTone({ victory: false, time: 300, players: [hero(false, 0), hero(false, 1), hero(false, 2)] })).toBe('defeat');
    expect(runTone({ victory: false, time: 300, players: [hero(false, 0), hero(true, 1)] })).toBe('ended');
  });

  it('without a party list the old length rule applies (fixtures, malformed wire results)', () => {
    expect(runTone({ victory: false, time: 38, players: [] })).toBe('ended');
    expect(runTone({ victory: false, time: 402, players: [] })).toBe('defeat');
  });
});

describe('abandon copy', () => {
  it('has its own heading and subline in both languages, distinct from the defeat copy', () => {
    for (const lang of ['en', 'tr'] as const) {
      const d = dictionaries[lang];
      const title = d['runEnd.abandonedTitle'];
      const sub = d['runEnd.abandonedSub'];
      expect(title, lang).toBeTruthy();
      expect(sub, lang).toBeTruthy();
      expect(title).not.toBe(d['runEnd.defeat']);
      expect(sub).not.toBe(d['runEnd.defeatSub']);
      expect(sub?.toLowerCase()).not.toContain('fell');
    }
    expect(dictionaries.en['runEnd.abandonedTitle']).toBe('RUN ABANDONED');
    expect(dictionaries.tr['runEnd.abandonedTitle']).toBe('KOŞU BIRAKILDI');
  });
});
