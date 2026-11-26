// Every stat line a card can show has a label in BOTH languages. The UI labels a card line with t(`stat.<line.stat>`)
// (ui/content.ts formatStatLine), so a stat the sim emits without a dictionary entry renders as a raw key on the card —
// the e2e audit's B-1: spirit stones with race / element bonuses showed "+21% stat.vsRace:ice" in the essence modal.
// Covers the real content: stone / passive / skill-upgrade lines, plus offers rolled from a real-content world.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { RARITIES, RARITY_MULT, type Element, type RaceTag } from '../../data/schema';
import { dictionaries } from '../../i18n/i18n';
import { buildEssenceOffer, buildOffer, modsToLines } from '../cards';
import { UPGRADE_STATS } from '../stores';
import type { Card } from '../types';
import { createWorld } from '../world';

const RACES: readonly RaceTag[] = ['animal', 'orc', 'esoteric', 'undead', 'devil', 'insect', 'desert', 'ice', 'fire', 'dragon', 'human', 'metin'];
const ELEMENTS: readonly Element[] = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'];

/** `stat.<stat>` keys missing from EN or TR */
function missingLabels(stats: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const s of stats) {
    const key = `stat.${s}`;
    if (!(key in dictionaries.en)) out.add(`${key} (en)`);
    if (!(key in dictionaries.tr)) out.add(`${key} (tr)`);
  }
  return [...out].sort();
}

/** stats of the lines the UI renders through formatStatLine (trinket cards use their own effect lines) */
function labelledStats(cards: readonly Card[]): string[] {
  const out: string[] = [];
  for (const c of cards) if (c.kind !== 'trinket' && c.kind !== 'trinketUp') for (const l of c.lines) out.push(l.stat);
  return out;
}

describe('card line labels (EN + TR)', () => {
  it('every spirit stone line at every level has a label', () => {
    const stats: string[] = [];
    for (const def of content.stones) for (let level = 1; level <= def.maxLevel; level++) for (const l of modsToLines(def.perLevel, level)) stats.push(l.stat);
    expect(stats).toContain('vsRace:ice');
    expect(stats).toContain('resist:poison');
    expect(missingLabels(stats)).toEqual([]);
  });

  it('every passive line at every rarity has a label', () => {
    const stats: string[] = [];
    for (const def of content.passives) for (const r of RARITIES) for (const l of modsToLines(def.perRank, RARITY_MULT[r])) stats.push(l.stat);
    expect(stats.length).toBeGreaterThan(0);
    expect(missingLabels(stats)).toEqual([]);
  });

  it('every skill upgrade stat has a label', () => {
    expect(missingLabels(UPGRADE_STATS)).toEqual([]);
  });

  it('race / element composite stats have their own label for every race and element (not the raw key)', () => {
    const composite = [...RACES.map((r) => `vsRace:${r}`), ...ELEMENTS.map((e) => `resist:${e}`)];
    expect(missingLabels(composite)).toEqual([]);
    for (const lang of ['en', 'tr'] as const) {
      for (const s of composite) {
        const label = dictionaries[lang][`stat.${s}`] ?? '';
        expect(label, `${lang} stat.${s}`).not.toMatch(/[{}:]|^stat\./);
      }
    }
    expect(dictionaries.en['stat.vsRace:ice']).toBe('damage to frost creatures');
    expect(dictionaries.tr['stat.vsRace:animal']).toBe('hayvanlara hasar');
    expect(dictionaries.en['stat.resist:poison']).toBe('poison resistance');
    expect(dictionaries.tr['stat.resist:fire']).toBe('ateş direnci');
  });

  it('offers rolled in a real-content run only carry labelled lines', () => {
    const w = createWorld({ zone: 'yeonmu', difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 11, meta: { stats: {} } }, content);
    const p = w.players[0];
    if (!p) throw new Error('no hero');
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const s of labelledStats(buildEssenceOffer(w, p, i % 3 === 0))) seen.add(s);
      for (const s of labelledStats(buildOffer(w, p, { count: w.balance.cardsPerLevel }))) seen.add(s);
    }
    // the rolls did reach the race / element stones
    expect([...seen].some((s) => s.startsWith('vsRace:'))).toBe(true);
    expect([...seen].some((s) => s.startsWith('resist:'))).toBe(true);
    expect(missingLabels(seen)).toEqual([]);
  });
});
