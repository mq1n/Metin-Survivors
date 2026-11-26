// Hero select (B3): colour mix helper of the flag art, and the G4 material-discipline greps over the screen's own sheets.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flagCellStyle, mixHex } from './heroArt';

// (vitest hands `?raw` CSS imports back empty, so the greps read the sheets from disk - round 3 fix: they were vacuous before)
const sheets: Record<string, string> = Object.fromEntries(['./hero.css', './hero-stage.css'].map((f) => [f, readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')]));

describe('mixHex', () => {
  it('returns the colour at 0 and the target at 1', () => {
    expect(mixHex('#c8281e', '#000000', 0)).toBe('#c8281e');
    expect(mixHex('#c8281e', '#000000', 1)).toBe('#000000');
  });
  it('blends channel-wise and expands 3-digit hex', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#fff', '#000', 0)).toBe('#ffffff');
  });
});

describe('flagCellStyle (painted banner sheet)', () => {
  it('scales the 1536 px sheet so each ~480 px cell fills the box, and offsets to the cell origin', () => {
    const a = flagCellStyle('saehwa', 'x.webp');
    const b = flagCellStyle('jihae', 'x.webp');
    expect(a.backgroundSize).toBe('317.36% auto'); // 1536 / 484
    expect(a.backgroundPosition.startsWith('0.570%')).toBe(true); // 6 / (1536 - 484)
    expect(b.backgroundPosition.startsWith('99.43')).toBe(true); // right-most cell: 1047 / (1536 - 483)
  });
  it('falls back to the first cell for an unknown empire', () => {
    expect(flagCellStyle('nope', 'x.webp').aspectRatio).toBe(flagCellStyle('saehwa', 'x.webp').aspectRatio);
  });
});

describe('hero sheets keep the kit discipline (G4)', () => {
  const entries = Object.entries(sheets);
  it('finds both sheets, with content', () => {
    expect(entries.length).toBe(2);
    for (const [, css] of entries) expect(css.length).toBeGreaterThan(5000);
  });
  for (const [file, css] of entries) {
    it(`${file}: no repeating-gradient hatches, no frame override, no decorative face, no tiny raw font sizes`, () => {
      expect(css).not.toMatch(/repeating-(linear|radial|conic)-gradient/);
      expect(css).not.toMatch(/--frame\s*:/);
      expect(css).not.toMatch(/Cinzel Decorative/i);
      const raw = [...css.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).filter((n) => n < 0.75);
      expect(raw).toEqual([]);
    });
  }
});
