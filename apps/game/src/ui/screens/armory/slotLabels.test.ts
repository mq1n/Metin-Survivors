// Armory > Collection: the slot column heads are one cell wide (62 px at 1280x720), so they use short names (gear.slotShort.*) and carry the
// full name as the title (QA CAMPAIGN-5: HELMET / BRACELET / NECKLACE / EARRINGS were cut to "HELM...", "BRACE...").
import { describe, expect, it } from 'vitest';
import { GEAR_SLOTS } from '../../../data/schema';
import { dictionaries } from '../../../i18n/i18n';
import collection from './Collection.tsx?raw';

/** the longest short name that fits one 62 px cell at the head's size and tracking (measured: 'Bilezik' 7 and 'Kalkan' 6 letters fit, 'Bracelet' 8 does not) */
const MAX_CHARS = 7;

describe('collection slot heads', () => {
  it('every gear slot has a short name in English and Turkish, short enough for one cell', () => {
    for (const lang of ['en', 'tr'] as const) {
      for (const slot of GEAR_SLOTS) {
        const short = dictionaries[lang][`gear.slotShort.${slot}`];
        expect(short, `${lang} gear.slotShort.${slot}`).toBeTruthy();
        expect([...(short ?? '')].length, `${lang} ${slot}: ${short}`).toBeLessThanOrEqual(MAX_CHARS);
      }
    }
  });

  it('the head shows the short name and keeps the full slot name as its title', () => {
    expect(collection).toContain('gear.slotShort.${c.slot}');
    expect(collection).toMatch(/class="ms-col-sh"[^>]*title=\{t\(`gear\.slot\.\$\{c\.slot\}`\)\}/);
  });
});
