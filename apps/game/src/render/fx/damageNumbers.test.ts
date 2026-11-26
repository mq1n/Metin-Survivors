import { describe, expect, it } from 'vitest';
import {
  BURST_LIFE,
  DEALT_FILL,
  DamageNumberField,
  GLYPH_CHARS,
  GlyphTable,
  HDR_FILL_MAX,
  HDR_FILL_MIN,
  HOLLOW_LETTERS,
  TAKEN_FILL,
  WORD_COLORS,
  acesDisplay,
  arcOffset,
  boxBlur,
  burstCapFor,
  burstEnvelope,
  BURST_COLORS,
  BURST_SPRITE,
  damageText,
  driftOffset,
  elementColor,
  endShrink,
  fadeAlpha,
  formatAmount,
  hdrFill,
  hexToLinear,
  layoutText,
  packShelves,
  popScale,
  textWidth,
  wordText,
  MAX_GLYPHS,
  NUMBER_MERGE_WINDOW,
  critCapFor,
  keylineAmount,
  plainCapFor,
  rankScale,
} from './damageNumbers';

const CHARS = GLYPH_CHARS;

/** synthetic metrics: every glyph is 60 px advance, 50 px ink, '.' and ',' narrower */
function table(): GlyphTable {
  const t = new GlyphTable(CHARS);
  for (let i = 0; i < CHARS.length; i++) {
    const narrow = CHARS[i] === '.' || CHARS[i] === ',';
    const ink = narrow ? 14 : 50;
    t.adv[i] = narrow ? 24 : 60;
    t.inkX0[i] = 4;
    t.inkX1[i] = 4 + ink;
    t.cx[i] = 4 + ink / 2;
    t.w[i] = ink + 40;
    t.h[i] = 100;
  }
  return t;
}

function field(over: Partial<ConstructorParameters<typeof DamageNumberField>[0]> = {}): DamageNumberField {
  let seed = 1;
  return new DamageNumberField({
    glyphCap: 200,
    table: table(),
    rng: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
    ...over,
  });
}

describe('formatAmount / damageText', () => {
  it('formats plain and compact amounts', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(0.2)).toBe('1');
    expect(formatAmount(7.4)).toBe('7');
    expect(formatAmount(842.6)).toBe('843');
    expect(formatAmount(9999)).toBe('9999');
    expect(formatAmount(12_345)).toBe('12.3K');
    expect(formatAmount(12_000)).toBe('12K');
    expect(formatAmount(123_456)).toBe('123K');
    expect(formatAmount(999_999)).toBe('1M');
    expect(formatAmount(1_250_000)).toBe('1.3M');
    expect(formatAmount(4_500_000_000)).toBe('4.5B');
  });
  it('adds prefixes and crit suffix', () => {
    expect(damageText(55, 'heal', false, true)).toBe('+55');
    expect(damageText(55, 'xp', false, true)).toBe('+55');
    expect(damageText(55, 'normal', true, true)).toBe('55!');
    expect(damageText(55, 'normal', true, false)).toBe('55');
    expect(damageText(55, 'player', false, true)).toBe('55');
  });
  it('maps every element to a hex colour', () => {
    for (const el of ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'] as const) {
      expect(elementColor(el)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('hexToLinear', () => {
  it('converts sRGB to linear', () => {
    const w = hexToLinear('#ffffff');
    expect([w[0], w[1], w[2]]).toEqual([1, 1, 1]);
    const k = hexToLinear('#000000');
    expect(k[0]).toBe(0);
    const g = hexToLinear('#808080');
    expect(g[0]).toBeCloseTo(0.2158, 3);
  });
});

describe('layoutText', () => {
  it('centres the ink extents on x=0', () => {
    const t = table();
    const glyphs = new Uint8Array(MAX_GLYPHS);
    const gx = new Float32Array(MAX_GLYPHS);
    const n = layoutText(t, '123', glyphs, gx);
    expect(n).toBe(3);
    expect(Array.from(glyphs.slice(0, 3))).toEqual([1, 2, 3]);
    // ink spans [pen0+4, pen2+54] = [4, 174] → mid 89
    expect(gx[0]).toBeCloseTo(4 + 25 - 89, 5);
    expect(gx[2]).toBeCloseTo(120 + 4 + 25 - 89, 5);
    expect((gx[0] as number) + (gx[2] as number)).toBeCloseTo(0, 5);
  });
  it('skips unknown characters and caps at the output size', () => {
    const t = table();
    const glyphs = new Uint8Array(4);
    const gx = new Float32Array(4);
    expect(layoutText(t, '1?2', glyphs, gx)).toBe(2);
    expect(layoutText(t, '123456789', glyphs, gx)).toBe(4);
    expect(layoutText(t, '???', glyphs, gx)).toBe(0);
  });
});

describe('packShelves', () => {
  it('packs without overlap inside the width', () => {
    const sizes = Array.from({ length: 23 }, (_, i) => ({ w: 90 + (i % 5) * 9, h: 100 + (i % 3) * 8 }));
    const p = packShelves(sizes, 1024, 4);
    expect(p.height).toBeGreaterThan(0);
    for (let i = 0; i < sizes.length; i++) {
      const a = sizes[i]!;
      expect(p.x[i]! + a.w).toBeLessThanOrEqual(1024);
      expect(p.y[i]! + a.h).toBeLessThanOrEqual(p.height);
      for (let j = i + 1; j < sizes.length; j++) {
        const b = sizes[j]!;
        const sep = p.x[i]! + a.w <= p.x[j]! || p.x[j]! + b.w <= p.x[i]! || p.y[i]! + a.h <= p.y[j]! || p.y[j]! + b.h <= p.y[i]!;
        expect(sep).toBe(true);
      }
    }
  });
});

describe('boxBlur', () => {
  it('preserves mass away from the border and stays symmetric', () => {
    const w = 41;
    const h = 41;
    const a = new Float32Array(w * h);
    a[20 * w + 20] = 1;
    boxBlur(a, w, h, 3, 3, new Float32Array(w * h));
    let sum = 0;
    for (const v of a) sum += v;
    expect(sum).toBeCloseTo(1, 4);
    expect(a[20 * w + 17]).toBeCloseTo(a[20 * w + 23] as number, 6);
    expect(a[17 * w + 20]).toBeCloseTo(a[23 * w + 20] as number, 6);
    expect(a[20 * w + 20]).toBeGreaterThan(a[20 * w + 26] as number);
  });
});

describe('pop / fade curves', () => {
  it('pops past 1 and settles', () => {
    expect(popScale(0.06, false)).toBeGreaterThan(1.2);
    expect(popScale(0.6, false)).toBeCloseTo(1, 2);
    expect(popScale(0.05, true)).toBeGreaterThan(1.1);
    expect(popScale(0.05, true)).toBeLessThan(1.22);
    expect(popScale(0.9, true)).toBeCloseTo(1, 1);
    expect(popScale(0, true)).toBeLessThan(0.5);
  });
  it('fades over the last 40 % of life (a crit from half its life) and is gone at the end', () => {
    expect(fadeAlpha(0.45, 0.9)).toBe(1);
    expect(fadeAlpha(0.8, 0.9)).toBeLessThan(0.45);
    expect(fadeAlpha(0.9, 0.9)).toBe(0);
    expect(fadeAlpha(0.005, 0.9)).toBeLessThan(0.3);
    expect(fadeAlpha(0.55, 0.8, 0.6)).toBeLessThan(0.6);
    expect(fadeAlpha(0.55, 0.8, 0.6)).toBeGreaterThan(0);
  });
});

describe('DamageNumberField', () => {
  it('merges hits on the same target inside the window and sums them', () => {
    const f = field();
    expect(f.spawn(0, 2, 0, 100, 'normal', false, undefined, 7)).toBe(true);
    f.update(0.03);
    f.spawn(0, 2, 0, 50, 'normal', false, undefined, 7);
    f.update(0.03);
    f.spawn(0, 2, 0, 25, 'normal', false, undefined, 7);
    expect(f.count).toBe(1);
    expect(f.slots[0]!.amount).toBe(175);
    expect(f.slots[0]!.text).toBe('175');
    expect(f.glyphsInUse).toBe(3);
    expect(f.stats.merged).toBe(2);
  });
  it('does not merge after the window, for other targets, other kinds, or untargeted hits', () => {
    const f = field();
    f.spawn(0, 2, 0, 10, 'normal', false, undefined, 7);
    f.update(0.3);
    f.spawn(0, 2, 0, 10, 'normal', false, undefined, 7);
    expect(f.count).toBe(2);
    f.spawn(0, 2, 0, 10, 'normal', false, undefined, 8);
    f.spawn(0, 2, 0, 10, 'heal', false, undefined, 8);
    f.spawn(0, 2, 0, 10, 'normal', false, undefined, 0);
    f.spawn(0, 2, 0, 10, 'normal', false, undefined, 0);
    expect(f.count).toBe(6);
  });
  it('upgrades a merged number to a crit and keeps glyph accounting exact', () => {
    const f = field();
    f.spawn(0, 2, 0, 90, 'normal', false, '#ff0000', 3);
    f.spawn(0, 2, 0, 20, 'normal', true, '#00ff00', 3);
    const s = f.slots[0]!;
    expect(f.count).toBe(1);
    expect(s.crit).toBe(true);
    expect(s.text).toBe('110!');
    expect(f.glyphsInUse).toBe(s.len);
    expect(s.len).toBe(4);
  });
  it('grows the text when a merge adds digits', () => {
    const f = field();
    f.spawn(0, 2, 0, 90, 'normal', false, undefined, 3);
    f.spawn(0, 2, 0, 900, 'normal', false, undefined, 3);
    expect(f.slots[0]!.text).toBe('990');
    expect(f.glyphsInUse).toBe(3);
  });
  it('expires numbers and releases glyphs', () => {
    const f = field();
    f.spawn(0, 2, 0, 1234, 'normal', false);
    f.spawn(0, 2, 0, 99, 'normal', true);
    expect(f.glyphsInUse).toBe(4 + 3);
    f.update(0.65); // normal (0.74) alive, crit (0.92) alive
    expect(f.count).toBe(2);
    f.update(0.1); // the plain hit is gone, the crit (it must not leave first) is still up
    expect(f.count).toBe(1);
    f.update(0.2); // and now the crit is gone too
    expect(f.count).toBe(0);
    expect(f.glyphsInUse).toBe(0);
    f.spawn(0, 2, 0, 99, 'normal', true);
    f.spawn(0, 2, 0, 1234, 'normal', false, undefined, 9);
    f.update(0.95);
    expect(f.count).toBe(0);
    f.update(0.3);
    expect(f.count).toBe(0);
    expect(f.glyphsInUse).toBe(0);
  });
  it('enforces the per-frame budget for low-value numbers but not for crits / player hits', () => {
    const f = field({ budget: 5 });
    let spawned = 0;
    for (let i = 0; i < 20; i++) if (f.spawn(0, 2, 0, 10 + i, 'normal', false)) spawned++;
    expect(spawned).toBe(5);
    expect(f.stats.dropped).toBe(15);
    expect(f.spawn(0, 2, 0, 500, 'normal', true)).toBe(true);
    expect(f.spawn(0, 2, 0, 5, 'player', false)).toBe(true);
    f.update(0.016);
    expect(f.spawn(0, 2, 0, 10, 'normal', false)).toBe(true);
  });
  it('caps live low-priority numbers (lowCap) across frames, never crits / player hits', () => {
    const f = field({ budget: 999, lowCap: 4 });
    for (let frame = 0; frame < 3; frame++) {
      for (let i = 0; i < 3; i++) f.spawn(0, 2, 0, 10 + i, 'normal', false);
      f.update(0.016);
    }
    expect(f.count).toBe(4);
    expect(f.spawn(0, 2, 0, 99, 'normal', true)).toBe(true);
    expect(f.spawn(0, 2, 0, 7, 'player', false)).toBe(true);
  });
  it('stacks player hits on one counter over a longer window than enemy hits', () => {
    const f = field();
    f.spawn(0, 2, 0, 5, 'player', false, undefined, 1_000_000);
    f.update(0.3);
    f.spawn(0, 2, 0, 7, 'player', false, undefined, 1_000_000);
    expect(f.count).toBe(1);
    expect(f.slots[0]!.amount).toBe(12);
  });
  it('never exceeds the glyph cap, evicting oldest low-priority numbers first', () => {
    const f = field({ glyphCap: 12, budget: 999 });
    for (let i = 0; i < 6; i++) f.spawn(i, 2, 0, 10 + i, 'normal', false); // 6×2 = 12 glyphs
    expect(f.glyphsInUse).toBe(12);
    f.spawn(0, 2, 0, 777, 'normal', true); // "777!" = 4 glyphs → evicts two oldest
    expect(f.glyphsInUse).toBeLessThanOrEqual(12);
    expect(f.slots[f.count - 1]!.text).toBe('777!');
    expect(f.slots[0]!.amount).toBe(12);
    let total = 0;
    for (let i = 0; i < f.count; i++) total += f.slots[i]!.len;
    expect(total).toBe(f.glyphsInUse);
  });
  it('drops (never crashes) when everything alive outranks the new number', () => {
    const f = field({ glyphCap: 6, budget: 999 });
    f.spawn(0, 2, 0, 11, 'normal', true); // "11!" priority 4
    f.spawn(0, 2, 0, 22, 'normal', true);
    expect(f.glyphsInUse).toBe(6);
    expect(f.spawn(0, 2, 0, 33, 'normal', false)).toBe(false);
    expect(f.count).toBe(2);
    expect(f.glyphsInUse).toBe(6);
  });
  it('shrinks to a new cap and survives clear()', () => {
    const f = field({ glyphCap: 100, budget: 999 });
    for (let i = 0; i < 20; i++) f.spawn(i, 2, 0, 100 + i, 'normal', false);
    expect(f.glyphsInUse).toBe(60);
    f.setGlyphCap(30);
    expect(f.glyphsInUse).toBeLessThanOrEqual(30);
    f.clear();
    expect(f.count).toBe(0);
    expect(f.glyphsInUse).toBe(0);
    expect(f.spawn(0, 2, 0, 5, 'normal', false, undefined, 9)).toBe(true);
  });
  it('rejects non-positive and NaN amounts', () => {
    const f = field();
    expect(f.spawn(0, 2, 0, 0, 'normal', false)).toBe(false);
    expect(f.spawn(0, 2, 0, -5, 'normal', false)).toBe(false);
    expect(f.spawn(0, 2, 0, NaN, 'normal', false)).toBe(false);
  });
  it('keeps spawn order and stays consistent under churn', () => {
    const f = field({ glyphCap: 80, budget: 999 });
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let step = 0; step < 400; step++) {
      const n = Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) f.spawn(0, 2, 0, 1 + rnd() * 5000, rnd() < 0.2 ? 'player' : 'normal', rnd() < 0.15, undefined, rnd() < 0.5 ? 1 + Math.floor(rnd() * 20) : 0);
      f.update(0.016);
      let total = 0;
      for (let i = 0; i < f.count; i++) total += f.slots[i]!.len;
      expect(total).toBe(f.glyphsInUse);
      expect(f.glyphsInUse).toBeLessThanOrEqual(80);
    }
  });
});

describe('words, xp text and blanks', () => {
  it('draws a word kind as hollow mixed-case letters and an xp number with its suffix', () => {
    const t = table();
    expect(damageText(1, 'word', false, true, 'Miss')).toHaveLength(4);
    // every letter of the word resolves to an atlas glyph (the hollow alias), none to a filled capital
    for (const ch of damageText(1, 'word', false, true, 'Miss')) expect(t.indexOf(ch)).toBeGreaterThanOrEqual(0);
    expect(damageText(1, 'word', false, true, 'Miss')).not.toBe('MISS');
    expect(damageText(42, 'xp', false, true, 'xp')).toBe('+42 XP');
    expect(damageText(42, 'xp', false, true)).toBe('+42');
  });
  it('keeps the mixed case of localised words and flattens accents onto the hollow letters', () => {
    expect(wordText('Miss', 'evade')).toBe('Miss');
    expect(wordText('Iska', 'evade')).toBe('Iska');
    expect(wordText('Blok', 'block')).toBe('Blok');
    expect(wordText('Işka', 'evade')).toBe('Iska'.replace('s', 's'));
    expect(wordText('???', 'block')).toBe('Block');
    expect(wordText('', 'evade')).toBe('Miss');
    for (const ch of wordText('Block', 'block')) expect(HOLLOW_LETTERS).toContain(ch);
  });
  it('lays a blank out as a gap, never at the start', () => {
    const t = table();
    const glyphs = new Uint8Array(MAX_GLYPHS);
    const gx = new Float32Array(MAX_GLYPHS);
    expect(layoutText(t, '4 X', glyphs, gx)).toBe(2);
    const gap = (gx[1] as number) - (gx[0] as number);
    expect(gap).toBeGreaterThan(60); // one advance plus the blank
    expect(layoutText(t, ' 4', glyphs, gx)).toBe(1);
    expect(textWidth(t, glyphs, gx, 1)).toBe(50);
    expect(textWidth(t, glyphs, gx, 0)).toBe(0);
  });
  it('spawns a word number, merges repeats inside its window and never an empty word', () => {
    const f = field();
    expect(f.spawn(0, 2, 0, 1, 'word', false, WORD_COLORS.evade, 5, 0, 'Miss')).toBe(true);
    const text = f.slots[0]!.text;
    expect(text).toHaveLength(4);
    expect(f.slots[0]!.top).toBe(true);
    f.update(0.1);
    f.spawn(0, 2, 0, 1, 'word', false, WORD_COLORS.evade, 5, 0, 'Miss');
    expect(f.count).toBe(1);
    expect(f.slots[0]!.text).toBe(text);
    expect(f.spawn(0, 2, 0, 1, 'word', false, undefined, 6, 0, '')).toBe(false);
  });
  it('merges xp pickups into one counter over a second and grows its text', () => {
    const f = field();
    f.spawn(0, 2, 0, 5, 'xp', false, undefined, 77, 0, 'XP');
    f.update(0.6);
    f.spawn(0, 2, 0, 7, 'xp', false, undefined, 77, 0, 'XP');
    expect(f.count).toBe(1);
    expect(f.slots[0]!.text).toBe('+12 XP');
    f.update(0.5); // 1.1 s old: past the window (and past its life)
    f.spawn(0, 2, 0, 3, 'xp', false, undefined, 77, 0, 'XP');
    expect(f.count).toBe(1);
    expect(f.slots[0]!.text).toBe('+3 XP');
  });
});

describe('arc, shrink and the crit starburst', () => {
  it('is a parabola: rises to the apex, then FALLS visibly (r2 rose and hovered), past the spawn height by the end', () => {
    for (const crit of [false, true]) {
      let peak = 0;
      let peakAt = 0;
      let end = 0;
      for (let i = 0; i <= 100; i++) {
        const y = arcOffset(i / 100, crit, 80);
        if (y > peak) {
          peak = y;
          peakAt = i / 100;
        }
        end = y;
      }
      expect(arcOffset(0, crit, 80)).toBe(0);
      expect(peak).toBeCloseTo(80, 0);
      expect(peakAt).toBeGreaterThan(0.3);
      expect(peakAt).toBeLessThan(0.5);
      expect(end).toBeLessThan(-40); // it ends well BELOW where it started: a toast would end at its peak
      expect(end).toBeGreaterThan(-100);
      // the fall is already visible 0.2 of the life after the apex (r2: 2-3 px by 0.5 s)
      const apex = crit ? 0.4 : 0.42;
      expect(80 - arcOffset(apex + 0.2, crit, 80)).toBeGreaterThan(8);
    }
    let last = Infinity;
    for (let i = 50; i <= 100; i++) {
      const y = arcOffset(i / 100, false, 80);
      expect(y).toBeLessThanOrEqual(last + 1e-9);
      last = y;
    }
  });
  it('throws one way: the sideways offset is monotone with ONE sign for a number (no zig-zag)', () => {
    for (const drift of [38, -38]) {
      let last = 0;
      for (let i = 1; i <= 100; i++) {
        const x = driftOffset(i / 100, drift);
        expect(Math.sign(x)).toBe(Math.sign(drift));
        expect(Math.abs(x)).toBeGreaterThan(Math.abs(last) - 1e-9);
        last = x;
      }
      expect(driftOffset(1, drift)).toBeCloseTo(drift, 6);
      expect(Math.abs(driftOffset(0, drift))).toBe(0);
    }
  });
  it('shrinks only in the second half of life (a crit later and less: it must not leave first)', () => {
    expect(endShrink(0.3)).toBe(1);
    expect(endShrink(0.5)).toBe(1);
    expect(endShrink(1)).toBeCloseTo(0.6, 2);
    expect(endShrink(0.8)).toBeLessThan(1);
    expect(endShrink(0.55, true)).toBe(1);
    expect(endShrink(1, true)).toBeCloseTo(0.72, 2);
    expect(endShrink(0.75, true)).toBeGreaterThan(endShrink(0.75, false));
  });
  it('plays the starburst for about half a second: grows, holds, fades to nothing', () => {
    expect(BURST_LIFE).toBeCloseTo(0.5, 5);
    const a = burstEnvelope(0.01);
    const b = burstEnvelope(0.12);
    const c = burstEnvelope(0.4);
    expect(a.scale).toBeLessThan(b.scale);
    expect(b.scale).toBeGreaterThan(0.8);
    expect(a.scale).toBeLessThan(0.6);
    expect(b.alpha).toBeGreaterThan(0.9);
    expect(c.alpha).toBeLessThan(b.alpha);
    expect(burstEnvelope(0.5).alpha).toBe(0);
    expect(burstEnvelope(0.5).scale).toBe(0);
    expect(burstEnvelope(-0.1).alpha).toBe(0);
  });
  it('caps the live starbursts per quality tier', () => {
    expect(burstCapFor(160)).toBe(12);
    expect(burstCapFor(900)).toBeGreaterThan(burstCapFor(320));
    expect(burstCapFor(100000)).toBe(48);
  });
});

describe('palette and tone-map compensation', () => {
  const ELS = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'] as const;
  const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const shown = (hex: string): number[] => {
    const f = hdrFill(hex);
    const o = [0, 0, 0];
    acesDisplay(f[0] as number, f[1] as number, f[2] as number, o);
    return o.map((v) => Math.round(toSrgb(v) * 255));
  };
  const want = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const sat = (c: number[]): number => (Math.max(...c) - Math.min(...c)) / Math.max(...c, 1);

  it('keeps every compensated fill inside the HDR band (under the bloom knee)', () => {
    for (const hex of [DEALT_FILL, TAKEN_FILL, '#3fd16e', '#58a8ff', '#ffb21c']) {
      for (const v of hdrFill(hex)) {
        expect(v).toBeLessThanOrEqual(HDR_FILL_MAX + 1e-6);
        expect(v).toBeGreaterThanOrEqual(HDR_FILL_MIN - 1e-6);
      }
    }
  });
  it('lands the composite on the authored colour (the post ACES no longer washes the fill)', () => {
    for (const hex of [TAKEN_FILL, '#3fd16e', '#ffb21c', '#58a8ff']) {
      const got = shown(hex);
      const w = want(hex);
      for (let i = 0; i < 3; i++) expect(Math.abs((got[i] as number) - (w[i] as number))).toBeLessThanOrEqual(34);
    }
  });
  it('keeps its own hue while it fades: the fill without its negative channels still reads as the fill (no blue -> red ghost)', () => {
    const arg = (c: number[]): number => c.indexOf(Math.max(...c));
    for (const hex of [DEALT_FILL, TAKEN_FILL, '#3fd16e', '#58a8ff', '#ffb21c']) {
      const f = hdrFill(hex);
      const o = [0, 0, 0];
      acesDisplay(Math.max(0, f[0] as number), Math.max(0, f[1] as number), Math.max(0, f[2] as number), o);
      const got = o.map((v) => toSrgb(v) * 255);
      const w = want(hex);
      expect(arg(got)).toBe(arg(w));
      for (let i = 0; i < 3; i++) expect(Math.abs((got[i] as number) - (w[i] as number))).toBeLessThanOrEqual(110);
    }
    // the xp blue was once solved as (0.47, -0.22, -0.35): all its light is red once the negative channels go
    const xp = hdrFill('#58a8ff');
    expect(xp[2]).toBeGreaterThan(xp[0] as number);
    expect(xp[2]).toBeGreaterThan(0.5);
  });
  it('damage we deal is ONE saturated lemon yellow (not butter-gold), damage we take a saturated red', () => {
    const y = shown(DEALT_FILL);
    expect(y[0]).toBeGreaterThan(220);
    expect(y[1]).toBeGreaterThan(215);
    expect(y[2]).toBeLessThan(40);
    expect(sat(y)).toBeGreaterThan(0.85);
    const r = shown(TAKEN_FILL);
    expect(r[0]).toBeGreaterThan(235);
    expect(r[1]).toBeLessThan(50);
    expect(r[2]).toBeLessThan(60);
  });
  it('fills every element\'s hit with the same lemon, the element only tints (physical: no tint)', () => {
    const f = field({ budget: 99 });
    let id = 1;
    for (const el of ELS) f.spawn(0, 2, 0, 100, 'normal', false, elementColor(el), id++);
    const first = f.slots[0]!;
    for (let i = 0; i < f.count; i++) {
      const s = f.slots[i]!;
      expect([s.r, s.g, s.b]).toEqual([first.r, first.g, first.b]);
    }
    expect(first.tint).toBe(0); // physical
    for (let i = 1; i < f.count; i++) expect(f.slots[i]!.tint).toBe(1);
    // the hues themselves still differ (outline / starburst tints)
    const hues = new Set(ELS.map((e) => elementColor(e)));
    expect(hues.size).toBe(ELS.length);
    // DoT ticks are damage we deal too
    f.spawn(0, 2, 0, 9, 'status', false, elementColor('poison'), id++);
    expect(f.slots[f.count - 1]!.r).toBe(first.r);
    // numbers we take / heals keep their own fills
    f.spawn(0, 2, 0, 9, 'player', false, undefined, id++);
    expect(f.slots[f.count - 1]!.r).not.toBe(first.r);
  });
});

describe('fan-out and minor sizes', () => {
  it('throws consecutive numbers to alternating sides so a cluster spreads (no screen anchor: the plain fan)', () => {
    const f = field({ budget: 99 });
    for (let i = 0; i < 6; i++) f.spawn(0, 2, 0, 10 + i, 'normal', false);
    const signs = Array.from({ length: 6 }, (_, i) => Math.sign(f.slots[i]!.drift));
    for (let i = 1; i < 6; i++) expect(signs[i]).toBe(-(signs[i - 1] as number));
  });
  it('draws every kind at 0.95 of a plain hit or more (no 20 px blobs)', () => {
    const f = field({ budget: 99 });
    for (const kind of ['xp', 'yeop', 'status', 'heal'] as const) {
      f.spawn(0, 2, 0, 5, kind, false, undefined, 0, 0);
      const s = f.slots[f.count - 1]!;
      expect(s.size).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('spacing (numbers must not fuse into one string)', () => {
  /** number of pairs of live numbers whose boxes overlap at `age` seconds after a simultaneous spawn */
  const overlaps = (f: DamageNumberField, age: number): number => {
    const box = (s: (typeof f.slots)[number]): number[] => {
      const tau = age / s.life;
      const sc = s.size * endShrink(tau, s.crit);
      const cx = s.ax + s.sx0 + driftOffset(tau, s.drift);
      const cy = s.ay + s.sy0 + arcOffset(tau, s.crit, s.rise);
      return [cx, cy, 0.5 * s.width * 0.4 * sc, 0.5 * 0.82 * 0.4 * 104 * sc];
    };
    let n = 0;
    for (let i = 0; i < f.count; i++) {
      for (let j = i + 1; j < f.count; j++) {
        const a = box(f.slots[i]!);
        const b = box(f.slots[j]!);
        if (Math.abs((a[0] as number) - (b[0] as number)) < (a[2] as number) + (b[2] as number) && Math.abs((a[1] as number) - (b[1] as number)) < (a[3] as number) + (b[3] as number)) n++;
      }
    }
    return n;
  };
  const cluster = (anchored: boolean): DamageNumberField => {
    const f = field({ budget: 99, lowCap: 99 });
    for (let i = 0; i < 7; i++) {
      // a row of crits 80 px apart, all wider than that: without spacing they pile into one string
      if (anchored) f.spawn(0, 2, 0, 4521 + i * 311, 'normal', true, undefined, i + 1, 0, '', i * 80, 0);
      else f.spawn(0, 2, 0, 4521 + i * 311, 'normal', true, undefined, i + 1);
    }
    return f;
  };
  it('throws a cluster apart: far fewer overlapping pairs than the plain fan, at every age', () => {
    const plain = cluster(false);
    const spaced = cluster(true);
    // the plain fan has no anchors: give it the same ones so the boxes are comparable
    for (let i = 0; i < plain.count; i++) {
      plain.slots[i]!.ax = i * 80;
      plain.slots[i]!.ay = 0;
    }
    for (const age of [0.1, 0.3, 0.5]) {
      expect(overlaps(plain, age)).toBeGreaterThan(overlaps(spaced, age));
    }
    expect(overlaps(spaced, 0.3)).toBeLessThanOrEqual(2);
  });
  it('leaves an isolated number untouched and never moves one that has no anchor', () => {
    const f = field({ budget: 99 });
    f.spawn(0, 2, 0, 123, 'normal', false, undefined, 1, 0, '', 0, 0);
    const lone = f.slots[0]!;
    const g = field({ budget: 99 });
    g.spawn(0, 2, 0, 123, 'normal', false, undefined, 1);
    expect(lone.sy0).toBeCloseTo(g.slots[0]!.sy0, 6);
    expect(lone.sx0).toBeCloseTo(g.slots[0]!.sx0, 6);
  });
  it('keeps a hero-side number on its side (only lifts it)', () => {
    const f = field({ budget: 99 });
    f.spawn(0, 2, 0, 5000, 'normal', true, undefined, 1, 0, '', 0, 0);
    f.spawn(0, 2, 0, 5001, 'normal', true, undefined, 2, -1, '', 0, 0);
    const s = f.slots[1]!;
    expect(s.drift).toBeLessThan(0);
  });
});

describe('round 2: a crit row stays apart while it pops, and the burst is crimson red', () => {
  it('a row of crits at 1.15x their own width has no overlapping neighbours during the spawn pop', () => {
    const f = field({ budget: 99, lowCap: 99 });
    // synthetic table: a 4-digit crit is 4 x 60 = 240 atlas px wide
    const pxPerAtlas = f.pxPerAtlas;
    for (let i = 0; i < 8; i++) {
      const probe = 4521 + i * 311;
      // pitch = 1.15 x the crit's resting width: roomy at rest, tight only because of the pop overshoot
      f.spawn(0, 2, 0, probe, 'normal', true, undefined, i + 1, 0, '', i * 1.15 * 240 * pxPerAtlas * 1.25, 0);
    }
    for (const age of [0.04, 0.08, 0.12, 0.2]) {
      let hits = 0;
      for (let i = 0; i < f.count; i++) {
        for (let j = i + 1; j < f.count; j++) {
          const a = f.slots[i]!;
          const b = f.slots[j]!;
          const box = (s: typeof a): number[] => {
            const tau = age / s.life;
            const sc = s.size * popScale(age, s.crit) * endShrink(tau, s.crit);
            return [s.ax + s.sx0 + driftOffset(tau, s.drift), s.ay + s.sy0 + arcOffset(tau, s.crit, s.rise), 0.5 * s.width * pxPerAtlas * sc, 0.5 * 0.82 * pxPerAtlas * 104 * sc];
          };
          const A = box(a);
          const B = box(b);
          if (Math.abs((A[0] as number) - (B[0] as number)) < (A[2] as number) + (B[2] as number) && Math.abs((A[1] as number) - (B[1] as number)) < (A[3] as number) + (B[3] as number)) hits++;
        }
      }
      expect(hits).toBeLessThanOrEqual(1);
    }
  });
  it('crits and plain hits are gone before one second, and a crit never leaves before a plain hit', () => {
    const f = field();
    f.spawn(0, 2, 0, 4521, 'normal', true);
    f.spawn(0, 2, 0, 842, 'normal', false, undefined, 2);
    expect(f.slots[0]!.life).toBeLessThanOrEqual(1);
    expect(f.slots[1]!.life).toBeLessThanOrEqual(0.8);
    expect(f.slots[0]!.life).toBeGreaterThanOrEqual(f.slots[1]!.life);
    // ...and at the moment a plain hit is at half its life, a crit is still fully opaque (r2: the crit washed out first)
    expect(fadeAlpha(0.5, f.slots[0]!.life, 0.25)).toBe(1);
  });
  it('a cleared field throws its numbers the same way again (the fan state is reset: captures are repeatable)', () => {
    const run = (f: DamageNumberField): number[] => {
      for (let i = 0; i < 5; i++) f.spawn(0, 2, 0, 20 + i, 'normal', false, undefined, i + 1);
      return Array.from({ length: f.count }, (_, i) => Math.sign(f.slots[i]!.drift));
    };
    const f = field({ budget: 99 });
    const a = run(f);
    f.clear();
    const b = run(f);
    expect(b).toEqual(a);
  });
  it('a crowded field draws new numbers smaller (down to 0.7x); crits by the square root, hero-side numbers never', () => {
    const f = field({ budget: 99, lowCap: 99 });
    f.spawn(0, 2, 0, 500, 'normal', false, undefined, 1);
    const alone = f.slots[0]!.size;
    for (let i = 0; i < 40; i++) f.spawn(0, 2, 0, 500, 'normal', false, undefined, 10 + i);
    const crowded = f.slots[f.count - 1]!.size;
    expect(crowded).toBeLessThan(alone * 0.75);
    expect(crowded).toBeGreaterThan(alone * 0.69);
    f.spawn(0, 2, 0, 500, 'normal', true, undefined, 99);
    const crit = f.slots[f.count - 1]!;
    expect(crit.crowd).toBeCloseTo(Math.sqrt(0.7), 3);
    f.spawn(0, 2, 0, 35, 'player', false, undefined, 98);
    expect(f.slots[f.count - 1]!.crowd).toBe(1);
  });
  it('the burst colours are red-orange (red channel leads, blue is the weakest) and the sprite id is the generated one', () => {
    for (const hex of Object.values(BURST_COLORS)) {
      const c = hexToLinear(hex);
      expect(c[0]).toBeGreaterThan(c[2] as number);
      expect(c[0]).toBeGreaterThanOrEqual(c[1] as number);
    }
    expect(BURST_SPRITE).toBe('vfx_damage_numbers_crit_burst');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// DMG-01 (second attempt): a hierarchy in big fights. Merge into one rising number, crit / chip / rank sizes, caps that keep the
// biggest hits and never cut a number off at full strength, co-op precedence, and a keyline on a bright ground.

/** a screen anchor model: the number sits at screen x = 40 * world x (px), y = 0 */
function spawnAt(f: DamageNumberField, x: number, amount: number, o: { kind?: 'normal' | 'status'; crit?: boolean; target?: number; mine?: boolean; side?: number } = {}): boolean {
  return f.spawn(x, 2, 0, amount, o.kind ?? 'normal', o.crit ?? false, undefined, o.target ?? 0, o.side ?? 0, '', 40 * x, 0, o.mine ?? true);
}
const smoothT = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** where the renderer draws a slot's centre (px, y up) */
function pos(s: DamageNumberField['slots'][number]): [number, number] {
  const tau = s.age / s.life;
  const g = s.ga < 0.12 ? 1 - smoothT(s.ga / 0.12) : 0;
  return [s.ax + s.sx0 + driftOffset(tau, s.drift) + s.glx * g, s.ay + s.sy0 + arcOffset(tau, s.crit, s.rise) + s.gly * g];
}
const live = (f: DamageNumberField): Array<DamageNumberField['slots'][number]> => f.slots.slice(0, f.count);
const plainSlots = (f: DamageNumberField): number[] => live(f).filter((s) => s.priority === 1 && s.out === 1).map((s) => s.amount).sort((a, b) => b - a);

describe('DMG-01 merge: one rising total shown at the last hit', () => {
  it('folds hits that follow each other within the window into one number, however long the chain', () => {
    expect(NUMBER_MERGE_WINDOW).toBe(0.25);
    const f = field();
    spawnAt(f, 0, 10, { target: 5 });
    for (let i = 0; i < 4; i++) {
      f.update(0.2); // 0.2 s between hits: inside the window of the LAST hit (the old window ran from the first hit only)
      spawnAt(f, 0, 10, { target: 5 });
    }
    expect(f.count).toBe(1);
    expect(f.slots[0]!.amount).toBe(50);
    f.update(0.3); // a pause longer than the window: the next hit is a new number
    spawnAt(f, 0, 10, { target: 5 });
    expect(f.count).toBe(2);
  });
  it('ends a chain after 1.2 s and never merges into a number that has started to fade', () => {
    const f = field();
    spawnAt(f, 0, 10, { target: 5 });
    let merged = 0;
    for (let i = 0; i < 40; i++) {
      f.update(0.1);
      const m0 = f.stats.merged;
      spawnAt(f, 0, 10, { target: 5 });
      if (f.stats.merged > m0) merged++;
    }
    expect(merged).toBeGreaterThan(10);
    expect(f.stats.spawned).toBeGreaterThanOrEqual(3); // a 4 s stream of hits is a few numbers, not one counter that never ends
    expect(f.stats.spawned).toBeLessThanOrEqual(5);
    const g = field();
    spawnAt(g, 0, 10, { target: 5 });
    g.update(0.6); // tau 0.81: fading
    const s = g.slots[0]!;
    spawnAt(g, 0, 10, { target: 5 });
    expect(g.count).toBe(2);
    expect(s.amount).toBe(10);
  });
  it('holds the total readable: set back to the top of the arc, with more than half a second left after the last hit', () => {
    const f = field();
    spawnAt(f, 0, 10, { target: 5 });
    f.update(0.2);
    spawnAt(f, 0, 10, { target: 5 });
    f.update(0.2);
    const s = f.slots[0]!;
    expect(s.age / s.life).toBeGreaterThan(0.5);
    spawnAt(f, 0, 10, { target: 5 });
    expect(s.age / s.life).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(s.life - s.age).toBeGreaterThanOrEqual(0.5);
    // a young number is not set forward
    const g = field();
    spawnAt(g, 0, 10, { target: 5 });
    g.update(0.1);
    spawnAt(g, 0, 10, { target: 5 });
    expect(g.slots[0]!.age).toBeCloseTo(0.1, 9);
  });
  it('a crit upgrade of a merged number keeps one number and its class counts', () => {
    const f = field({ lowCap: 4, critCap: 2 });
    spawnAt(f, 0, 10, { target: 5 });
    spawnAt(f, 0, 90, { target: 5, crit: true });
    expect(f.count).toBe(1);
    expect(f.slots[0]!.priority).toBe(4);
    f.update(0.016);
    expect((f as any).critAlive).toBe(1);
    expect((f as any).plainAlive).toBe(0);
  });
  it('moves to the last hit with a glide: the drawn position never jumps, then settles on the new anchor', () => {
    const f = field();
    spawnAt(f, 0, 10, { target: 5 });
    f.update(0.2);
    spawnAt(f, 0, 10, { target: 5 });
    f.update(0.2); // past the set-back point: the merge moves the arc phase too
    const s = f.slots[0]!;
    const before = pos(s);
    spawnAt(f, 3, 10, { target: 5 }); // the enemy moved 120 px
    const after = pos(s);
    expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeLessThan(1);
    expect(s.ax).toBe(120);
    let prev = after;
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      f.update(1 / 60);
      const q = pos(s);
      worst = Math.max(worst, Math.hypot(q[0] - prev[0], q[1] - prev[1]));
      prev = q;
    }
    expect(worst).toBeLessThan(40); // the number's own arc speed plus a smooth share of the 120 px: never a jump
    expect(worst).toBeGreaterThan(3); // ... and it does move
    f.update(0.2);
    expect(s.ga).toBeGreaterThan(0.12);
    // after the glide the number is where its own arc puts it from the NEW anchor
    const tau = s.age / s.life;
    expect(pos(s)[0]).toBeCloseTo(s.ax + s.sx0 + driftOffset(tau, s.drift), 6);
  });
  it('does not move across the hero (side changed), without a screen anchor, or for a far teleport', () => {
    const f = field();
    spawnAt(f, 0, 10, { target: 5, side: -1 });
    const s = f.slots[0]!;
    spawnAt(f, 3, 10, { target: 5, side: 1 });
    expect(s.ax).toBe(0);
    f.spawn(9, 2, 0, 10, 'normal', false, undefined, 5); // no anchor
    expect(s.ax).toBe(0);
    spawnAt(f, 20, 10, { target: 5, side: -1 }); // 800 px away: a recycled id, not a hit on the same enemy
    expect(s.ax).toBe(0);
    expect(f.slots[0]!.amount).toBe(40);
  });
  it('a moved merge never leaves two live numbers fused: it is placed again for the rest of its life', () => {
    const f = field();
    spawnAt(f, 3, 55555, { target: 9 }); // a neighbour waits where the merge will land
    spawnAt(f, 0, 10, { target: 5 });
    f.update(0.1);
    const s = live(f).find((x) => x.targetId === 5)!;
    const o = live(f).find((x) => x.targetId === 9)!;
    spawnAt(f, 3, 10, { target: 5 }); // lands on the neighbour
    for (const dt of [0.2, 0.1, 0.1]) {
      f.update(dt);
      const a = pos(s);
      const b = pos(o);
      const ox = 0.5 * (s.width + o.width) * 0.4 * 0.5 - Math.abs(a[0] - b[0]);
      expect(ox > 0 && 14 - Math.abs(a[1] - b[1]) > 0).toBe(false);
    }
  });
  it('draws no random number for a merge, a move, a retirement or a drop (HASH-EQ: only a new number draws, three)', () => {
    let calls = 0;
    const rng = (): number => (calls++, 0.5);
    const f = field({ rng, lowCap: 2 });
    spawnAt(f, 0, 10, { target: 5 });
    expect(calls).toBe(3);
    spawnAt(f, 1, 10, { target: 5 });
    spawnAt(f, 2, 10, { target: 5 });
    expect(calls).toBe(3);
    spawnAt(f, 4, 10, { target: 6 });
    expect(calls).toBe(6);
    f.update(0.4);
    spawnAt(f, 6, 300, { target: 7 }); // replaces one (a new number: 3 draws)
    expect(calls).toBe(9);
    spawnAt(f, 7, 1, { target: 8 }); // dropped
    expect(calls).toBe(9);
  });
});

describe('DMG-01 sizes: crit 1.35x, chips, rank against the recent median', () => {
  it('draws a crit 1.35x a plain hit of the same amount', () => {
    const f = field();
    spawnAt(f, 0, 100);
    spawnAt(f, 20, 100, { crit: true });
    expect(f.slots[1]!.size / f.slots[0]!.size).toBeCloseTo(1.35, 6);
  });
  it('ranks a total against the median (rankScale): 1 up to twice it, +15 % at eight times', () => {
    expect(rankScale(1)).toBe(1);
    expect(rankScale(2)).toBe(1);
    expect(rankScale(8)).toBeCloseTo(1.15, 9);
    expect(rankScale(100)).toBeCloseTo(1.15, 9);
    expect(rankScale(4)).toBeGreaterThan(1.05);
    expect(rankScale(4)).toBeLessThan(1.1);
  });
  it('a hit below 15 % of the recent median is a chip: 0.8x, a shorter life, a faster fade (and not before 8 hits are known)', () => {
    const f = field({ lowCap: 99, budget: 999 });
    spawnAt(f, 0, 100);
    spawnAt(f, 1, 5); // too early to rank
    expect(f.slots[1]!.chip).toBe(false);
    for (let i = 0; i < 12; i++) spawnAt(f, i + 2, 100);
    spawnAt(f, 30, 10);
    spawnAt(f, 31, 20);
    spawnAt(f, 32, 100);
    const chip = live(f).find((s) => s.amount === 10)!;
    const mid = live(f).find((s) => s.amount === 20)!;
    const ref = live(f).filter((s) => s.amount === 100).pop()!;
    expect(chip.chip).toBe(true);
    expect(mid.chip).toBe(false);
    expect(chip.life).toBeLessThan(ref.life);
    expect(chip.size / mid.size).toBeLessThan(0.9);
  });
  it('crits and DoT ticks never enter the median: a crit build does not turn its ordinary hits into chips', () => {
    const f = field({ lowCap: 99, critCap: 99, budget: 999 });
    for (let i = 0; i < 16; i++) spawnAt(f, i, 5000, { crit: true });
    for (let i = 0; i < 16; i++) spawnAt(f, 20 + i, 100);
    spawnAt(f, 60, 40);
    expect(live(f).find((x) => x.amount === 40)!.chip).toBe(false); // median 100 (plain hits only): 40 is 40 %
    for (let i = 0; i < 16; i++) spawnAt(f, 70 + i, 9, { kind: 'status' });
    spawnAt(f, 100, 40);
    expect(live(f).filter((x) => x.amount === 40).every((x) => !x.chip)).toBe(true);
  });
  it('a total well above the median steps up and is not shrunk by the crowd it was born into', () => {
    const f = field({ lowCap: 99, budget: 999 });
    for (let i = 0; i < 40; i++) spawnAt(f, i, 20);
    spawnAt(f, 50, 20);
    spawnAt(f, 51, 400);
    const small = live(f).filter((s) => s.amount === 20).pop()!;
    const big = live(f).find((s) => s.amount === 400)!;
    expect(big.size).toBeGreaterThan(small.size * 1.4);
  });
});

describe('DMG-01 caps: the biggest stay, nothing is cut off at full strength', () => {
  it('per tier: calmer caps, growing with the glyph cap', () => {
    expect([160, 320, 600, 900].map(plainCapFor)).toEqual([6, 8, 10, 14]);
    expect([160, 320, 600, 900].map(critCapFor)).toEqual([3, 4, 5, 7]);
  });
  it('an AoE frame keeps its biggest hits: a bigger hit replaces the weakest number nobody has seen yet', () => {
    const f = field({ lowCap: 4, budget: 99 });
    for (const a of [10, 10, 10, 10, 50, 40]) spawnAt(f, f.count + a / 100, a);
    expect(plainSlots(f)).toEqual([50, 40, 10, 10]);
    expect(f.glyphsInUse).toBe(8);
  });
  it('a same-size or smaller hit does not displace a number: it is dropped before it is ever drawn', () => {
    const f = field({ lowCap: 3, budget: 99 });
    for (const a of [20, 20, 20]) spawnAt(f, f.count, a);
    f.update(0.2); // three fresh numbers: the feedback floor is met
    expect(spawnAt(f, 9, 20)).toBe(false);
    expect(spawnAt(f, 9, 5)).toBe(false);
    expect(plainSlots(f)).toEqual([20, 20, 20]);
  });
  it('a clearly bigger hit retires the weakest drawn number: it fades out over ~0.12 s instead of vanishing', () => {
    const f = field({ lowCap: 3, budget: 99 });
    for (const a of [20, 22, 24]) spawnAt(f, f.count, a);
    f.update(0.2);
    expect(spawnAt(f, 9, 300)).toBe(true);
    const gone = live(f).find((s) => s.out < 1)!;
    expect(gone.amount).toBe(20);
    expect(f.count).toBe(4); // still on screen, fading
    f.update(0.05);
    expect(gone.out).toBeGreaterThan(0.4);
    expect(gone.out).toBeLessThan(0.7);
    f.update(0.1);
    expect(f.count).toBe(3);
    expect(plainSlots(f)).toEqual([300, 24, 22]);
    expect(f.glyphsInUse).toBe(2 + 2 + 3);
  });
  it('a readable number is replaced by a slightly bigger hit, a popping one only by a clearly bigger one', () => {
    const f = field({ lowCap: 3, budget: 99 });
    spawnAt(f, 0, 100);
    f.update(0.1); // popping: only a hit twice its size takes the place
    spawnAt(f, 1, 1000);
    spawnAt(f, 2, 1000); // two fresh numbers: the feedback floor is met
    expect(spawnAt(f, 5, 115)).toBe(false);
    expect(spawnAt(f, 5, 190)).toBe(false);
    expect(spawnAt(f, 5, 210)).toBe(true);
    const g = field({ lowCap: 3, budget: 99 });
    spawnAt(g, 0, 100);
    g.update(0.35); // readable, 0.39 s left
    spawnAt(g, 1, 1000);
    spawnAt(g, 2, 1000);
    expect(spawnAt(g, 6, 115)).toBe(false);
    expect(spawnAt(g, 6, 125)).toBe(true);
  });
  it('a number with 0.25 s or less to live gives its place to ANY hit, a smaller one too; before that only to a clearly bigger one', () => {
    const f = field({ lowCap: 3, budget: 99 });
    spawnAt(f, 0, 100);
    f.update(0.45); // 0.29 s left
    spawnAt(f, 1, 5000);
    spawnAt(f, 2, 5000); // two fresh numbers: the feedback floor is met
    expect(spawnAt(f, 5, 50)).toBe(false);
    expect(spawnAt(f, 5, 119)).toBe(false);
    f.update(0.05); // 0.24 s left
    expect(spawnAt(f, 5, 50)).toBe(true);
    expect(live(f).filter((s) => s.out < 1).map((s) => s.amount)).toEqual([100]);
    expect(plainSlots(f)).toEqual([5000, 5000, 50]);
  });
  it('a feedback floor: with fewer than two fresh numbers a hit takes the weakest number that has been read, but never a total worth more than 4x the hit', () => {
    const f = field({ lowCap: 3, budget: 99 });
    for (const a of [40, 40, 400]) spawnAt(f, f.count, a);
    f.update(0.35);
    expect(spawnAt(f, 9, 20)).toBe(true); // 20 > 40 / 4: takes a 40, not the 400
    expect(spawnAt(f, 9, 20)).toBe(true);
    expect(spawnAt(f, 9, 20)).toBe(false); // two fresh numbers now: the floor is met
    expect(plainSlots(f)).toEqual([400, 20, 20]);
    const g = field({ lowCap: 2, budget: 99 });
    spawnAt(g, 0, 400);
    spawnAt(g, 1, 400);
    g.update(0.35);
    expect(spawnAt(g, 9, 90)).toBe(false); // a chip never moves a big total
    expect(spawnAt(g, 9, 110)).toBe(true);
  });
  it('a burst that expires together leaves no gap: the hits that land in its last quarter second are shown (arena replay still)', () => {
    const f = field({ lowCap: 8, budget: 99, glyphCap: 400 });
    for (let i = 0; i < 10; i++) spawnAt(f, i * 0.4, 38); // an AoE: ten 38s, eight of them fit
    expect(plainSlots(f)).toEqual([38, 38, 38, 38, 38, 38, 38, 38]);
    f.update(0.5); // 0.24 s left on all of them
    expect([14, 14, 14].map((a) => spawnAt(f, 9 + a * 0.01, a))).toEqual([true, true, true]);
    f.update(0.3); // the burst is gone, the three hits are on screen
    expect(plainSlots(f)).toEqual([14, 14, 14]);
    // ... and a volley 0.26 s before the end (the arena replay still): the feedback floor tells two of the three
    const g = field({ lowCap: 8, budget: 99, glyphCap: 400 });
    for (let i = 0; i < 10; i++) spawnAt(g, i * 0.4, 38);
    g.update(0.48);
    expect([14, 14, 14].map((a) => spawnAt(g, 9 + a * 0.01, a))).toEqual([true, true, false]);
    g.update(0.3);
    expect(plainSlots(g)).toEqual([14, 14]);
  });
  it('removes a drawn number only through its own fade or end of life: no cut in a saturated random fight', () => {
    const f = field({ lowCap: 6, critCap: 2, budget: 99, glyphCap: 400 });
    const cuts: string[] = [];
    const orig = (f as any).removeAt.bind(f);
    (f as any).removeAt = (i: number) => {
      const s = f.slots[i]!;
      if (s.age > 0) cuts.push(`${s.amount}@${s.age.toFixed(2)} out ${s.out.toFixed(2)}`);
      orig(i);
    };
    let seed = 3;
    const r = (): number => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let step = 0; step < 900; step++) {
      for (let i = 0, n = Math.floor(r() * 8); i < n; i++) spawnAt(f, r() * 8, 1 + Math.floor(r() * r() * 400), { crit: r() < 0.15, kind: r() < 0.2 ? 'status' : 'normal', target: r() < 0.5 ? 1 + Math.floor(r() * 30) : 0 });
      f.update(1 / 60);
      let total = 0;
      for (let i = 0; i < f.count; i++) total += f.slots[i]!.len;
      expect(total).toBe(f.glyphsInUse);
      expect((f as any).plainAlive).toBeLessThanOrEqual(6);
      expect((f as any).critAlive).toBeLessThanOrEqual(2);
    }
    expect(cuts).toEqual([]);
  });
  it('crits keep a cap of their own and the biggest stay; a crit with no room is told as a plain number, never hidden', () => {
    const f = field({ lowCap: 4, critCap: 2, budget: 99 });
    for (const a of [50, 60, 40]) spawnAt(f, f.count + 1, a, { crit: true });
    const crits = live(f).filter((s) => s.crit).map((s) => s.amount).sort((a, b) => b - a);
    expect(crits).toEqual([60, 50]);
    expect(live(f).find((s) => s.amount === 40 && !s.crit)).toBeDefined(); // demoted, still shown
  });
  it('the glyph cap evicts the weakest number (chips and numbers about to go first), not the oldest, and never for a smaller one', () => {
    const f = field({ glyphCap: 8, budget: 99 });
    for (const a of [90, 11, 95, 12]) spawnAt(f, f.count, a); // 2 + 2 + 2 + 2 glyphs
    expect(spawnAt(f, 9, 80)).toBe(true); // evicts the 11, not the oldest 90
    expect(plainSlots(f)).toEqual([95, 90, 80, 12]);
    expect(spawnAt(f, 9, 5)).toBe(false); // smaller than everything alive: dropped
    expect(f.glyphsInUse).toBe(8);
  });
  it('a pickup counter ranks above a plain hit: a plain hit never evicts it, and a new counter takes a plain hit\'s place', () => {
    const f = field({ glyphCap: 5, budget: 99 });
    f.spawn(0, 2, 0, 5, 'xp', false, undefined, 1_000_900, 0, 'XP'); // "+5 XP" = 4 glyphs
    expect(f.glyphsInUse).toBe(4);
    expect(spawnAt(f, 2, 77)).toBe(false); // would need the counter's glyphs
    expect(f.slots[0]!.kind).toBe('xp');
    const g = field({ glyphCap: 8, budget: 99 });
    spawnAt(g, 0, 12);
    spawnAt(g, 1, 13);
    spawnAt(g, 2, 14);
    g.spawn(0, 2, 0, 5, 'xp', false, undefined, 1_000_900, 0, 'XP');
    expect(live(g).some((s) => s.kind === 'xp')).toBe(true);
    expect(g.glyphsInUse).toBeLessThanOrEqual(8);
  });
  it('a shrinking glyph cap evicts the weakest first and counts it', () => {
    const f = field({ glyphCap: 100, budget: 999 });
    for (let i = 0; i < 6; i++) spawnAt(f, i, 100 + i * 10);
    f.setGlyphCap(9);
    expect(f.glyphsInUse).toBeLessThanOrEqual(9);
    expect(plainSlots(f)[0]).toBe(150);
    expect(f.stats.evicted).toBe(3);
  });
  it('clear() (a new run) and update(0) (a pause) leave the caps and counts exact', () => {
    const f = field({ lowCap: 3, budget: 99 });
    for (let i = 0; i < 5; i++) spawnAt(f, i, 10 + i);
    for (let i = 0; i < 100; i++) f.update(0);
    expect(f.count).toBe(3);
    f.clear();
    expect((f as any).plainAlive).toBe(0);
    for (let i = 0; i < 3; i++) expect(spawnAt(f, i, 10)).toBe(true);
    expect(f.count).toBe(3);
  });
});

describe('DMG-01 co-op: the local hero keeps its numbers next to a stronger partner', () => {
  it('a partner at 3x never takes the local hero below its share of the plain cap, and takes only its own share', () => {
    const f = field({ lowCap: 8, budget: 99, glyphCap: 400 });
    let seed = 5;
    const r = (): number => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    let minMine = 99;
    let maxTheirs = 0;
    for (let step = 0; step < 600; step++) {
      if (step % 3 === 0) for (let i = 0; i < 2; i++) spawnAt(f, r() * 8, 10, { mine: true });
      if (step % 3 === 1) for (let i = 0; i < 2; i++) spawnAt(f, r() * 8, 30, { mine: false });
      f.update(1 / 60);
      if (step > 120) {
        const l = live(f).filter((s) => s.priority === 1 && s.out === 1);
        minMine = Math.min(minMine, l.filter((s) => s.mine).length);
        maxTheirs = Math.max(maxTheirs, l.filter((s) => !s.mine).length);
      }
    }
    expect(maxTheirs).toBeLessThanOrEqual(2);
    expect(minMine).toBeGreaterThanOrEqual(4);
  });
  it('the local hero takes a partner number first, once it has been up for 0.4 s, and never the last partner place', () => {
    const f = field({ lowCap: 8, budget: 99, glyphCap: 400 });
    for (let i = 0; i < 2; i++) spawnAt(f, i, 100, { mine: false });
    for (let i = 0; i < 6; i++) spawnAt(f, 2 + i, 5000, { mine: true });
    f.update(0.2);
    expect(spawnAt(f, 9, 300, { mine: true })).toBe(false); // the partner's numbers are held; the hero's own are far bigger
    f.update(0.22);
    expect(spawnAt(f, 9, 31, { mine: true })).toBe(true); // a partner counts a quarter: 31 > 100 x 1.2 x 0.25
    expect(live(f).filter((s) => !s.mine && s.out === 1).length).toBe(1);
    expect(spawnAt(f, 9, 20, { mine: true })).toBe(false); // ... but the last partner place stays
    expect(live(f).filter((s) => !s.mine && s.out === 1).length).toBe(1);
  });
  it('a partner never takes the hero places, except one floor place for a number that has been read', () => {
    const f = field({ lowCap: 4, budget: 99 });
    for (const a of [100, 100, 100, 100]) spawnAt(f, f.count, a, { mine: true });
    expect(spawnAt(f, 9, 5000, { mine: false })).toBe(false); // the class is full of the hero's numbers, none of them read yet
    f.update(0.35);
    expect(spawnAt(f, 9, 5, { mine: false })).toBe(true); // the floor: a partner at any strength keeps one number on screen
    expect(live(f).filter((s) => !s.mine && s.out === 1).length).toBe(1);
    expect(live(f).filter((s) => s.mine && s.out === 1).length).toBe(3);
    f.update(0.1);
    expect(spawnAt(f, 9, 6, { mine: false })).toBe(false); // the floor number is popping: it keeps its place (no strobe)
    expect(spawnAt(f, 9, 9, { mine: false })).toBe(false);
    expect(live(f).filter((s) => !s.mine && s.out === 1).length).toBe(1);
  });
  it('a stronger partner (1x and 3x) leaves the hero most of the readable numbers, keeps one of its own, and its numbers are not strobed', () => {
    for (const theirs of [30, 90]) {
      const f = field({ lowCap: 8, budget: 99, glyphCap: 600 });
      const ages: number[] = [];
      const orig = (f as any).retire.bind(f);
      (f as any).retire = (i: number) => {
        const s = f.slots[i]!;
        if (!s.mine && s.age > 0) ages.push(s.age);
        orig(i);
      };
      let mineSeen = 0;
      let theirsSeen = 0;
      let frames = 0;
      for (let step = 0; step < 720; step++) {
        for (let e = 0; e < 12; e++) {
          if ((step + e * 5) % 36 === 0) spawnAt(f, e, 30, { mine: true, target: 700 + e });
          if ((step + e * 5 + 2) % 36 === 0) spawnAt(f, 12 + e, theirs, { mine: false, target: 800 + e });
        }
        f.update(1 / 60);
        if (step > 120) {
          frames++;
          for (const s of live(f)) if (s.out === 1 && s.age >= 0.1) (s.mine ? (mineSeen += 1) : (theirsSeen += 1));
        }
      }
      expect(mineSeen / (mineSeen + theirsSeen)).toBeGreaterThan(0.7); // the old field gave the hero 31 % against a 3x partner
      expect(theirsSeen / frames).toBeGreaterThan(0.8); // the partner is never hidden
      expect(ages.length).toBeGreaterThan(0);
      expect(Math.min(...ages)).toBeGreaterThanOrEqual(0.4); // a partner number is up for 0.4 s at least before anything retires it
    }
  });
  it('without a player (the default) every hit is the local hero\'s: one pack, as before', () => {
    const f = field({ lowCap: 4, budget: 99 });
    for (let i = 0; i < 4; i++) f.spawn(i, 2, 0, 10, 'normal', false);
    expect(live(f).every((s) => s.mine)).toBe(true);
  });
});

describe('DMG-01 keyline: +0.5 px only over a bright ground', () => {
  it('grows with the brightness proxy: none on the dark lava zone, full on the golden zones', () => {
    expect(keylineAmount(0.08)).toBe(0);
    expect(keylineAmount(0.12)).toBe(0);
    expect(keylineAmount(0.3)).toBeGreaterThan(0.5);
    expect(keylineAmount(0.52)).toBe(1);
    expect(keylineAmount(0.25)).toBeLessThan(keylineAmount(0.35));
  });
});

describe('DMG-01 redo r2: the glide under a moving camera, crits-only mode, size by amount', () => {
  /** a camera that slides along x: a world point is at screen x = 40 * (wx - camX), y = 0 (the renderer's projector, simplified) */
  const hitVia = (f: DamageNumberField, camX: number, wx: number, amount: number, target: number): boolean =>
    f.spawn(wx, 2, 0, amount, 'normal', false, undefined, target, 0, '', 40 * (wx - camX), 0, true);
  /** where the renderer draws a slot's centre x: its WORLD anchor through the CURRENT camera, plus the field's offsets and the glide */
  const drawnX = (s: DamageNumberField['slots'][number], camX: number): number => {
    const tau = s.age / s.life;
    return 40 * (s.x - camX) + s.sx0 + driftOffset(tau, s.drift) + s.glx * (s.ga < 0.12 ? 1 - smoothT(s.ga / 0.12) : 0);
  };
  it('the merge glides from where the number is drawn NOW: no jump while the camera follows a running hero (3 m/s and 6 m/s)', () => {
    for (const speed of [0, 3, 6]) {
      const worst: number[] = [];
      for (const live2 of [true, false]) {
        const f = field();
        let camX = 0;
        if (live2) {
          f.projector = (x, _y, _z, out) => {
            out[0] = 40 * (x - camX);
            out[1] = 0;
          };
        }
        let w = 0;
        hitVia(f, camX, 2, 10, 5);
        for (let i = 1; i <= 5; i++) {
          for (let k = 0; k < 12; k++) {
            camX += speed / 60; // 0.2 s between hits
            f.update(1 / 60);
          }
          const s = f.slots[0]!;
          const before = drawnX(s, camX);
          hitVia(f, camX, 2 + 0.1 * i, 10, 5); // the enemy walks on
          w = Math.max(w, Math.abs(drawnX(s, camX) - before));
        }
        expect(f.count).toBe(1);
        worst.push(w);
      }
      expect(worst[0]).toBeLessThan(2);
      // before the fix (no projector: the anchors stay where the hits were born) the number jumped by the camera's travel
      if (speed > 0) expect(worst[1]).toBeGreaterThan(speed * 4);
    }
  });
  it('takes the live anchors again once per frame, at the first spawn that has an anchor, and never without a projector', () => {
    const f = field();
    let calls = 0;
    f.projector = (x, _y, _z, out) => {
      calls++;
      out[0] = 40 * x;
      out[1] = 0;
    };
    for (const a of [10, 11, 12]) spawnAt(f, a / 10, a);
    expect(calls).toBe(0); // frame 0: nothing was alive when the first hit asked, and the new numbers are fresh
    f.update(0.016);
    spawnAt(f, 4, 13);
    spawnAt(f, 5, 14);
    expect(calls).toBe(3);
    f.spawn(0, 2, 0, 15, 'normal', false); // no anchor: nothing to refresh
    f.update(0.016);
    spawnAt(f, 6, 16);
    expect(calls).toBe(3 + 5);
    f.projector = null;
    f.update(0.016);
    expect(() => spawnAt(f, 7, 17)).not.toThrow();
  });
  it('"crits only": a crit with no room is dropped, never told as a plain number', () => {
    const f = field({ lowCap: 4, critCap: 2, budget: 99 });
    f.critOnly = true;
    expect([50, 60, 40].map((a) => spawnAt(f, f.count + 1, a, { crit: true }))).toEqual([true, true, false]);
    expect(live(f).every((s) => s.crit)).toBe(true);
    expect(f.stats.dropped).toBe(1);
    const g = field({ lowCap: 4, critCap: 2, budget: 99 });
    for (const a of [50, 60, 40]) spawnAt(g, g.count + 1, a, { crit: true });
    expect(live(g).filter((s) => !s.crit).length).toBe(1); // the default still tells it
  });
  it('a total is never drawn smaller than a live crit worth less than half of it (the bigger number must not look smaller)', () => {
    const f = field({ critCap: 3, budget: 99 });
    spawnAt(f, 0, 10, { crit: true });
    const crit = live(f)[0]!;
    spawnAt(f, 5, 25);
    spawnAt(f, 9, 15);
    const big = live(f).find((s) => s.amount === 25)!;
    const near = live(f).find((s) => s.amount === 15)!;
    expect(big.size).toBeGreaterThanOrEqual(crit.size);
    expect(near.size).toBeLessThan(crit.size); // 15 is not twice the crit's 10
    // a total that grows past twice the crit is lifted at its merge
    spawnAt(f, 12, 6, { target: 3 });
    const grow = live(f).find((s) => s.targetId === 3)!;
    expect(grow.size).toBeLessThan(crit.size);
    f.update(0.1);
    spawnAt(f, 12, 16, { target: 3 });
    expect(grow.amount).toBe(22);
    expect(grow.size).toBeGreaterThanOrEqual(crit.size);
    // ... and a plain hit with no crit alive is untouched
    const h = field({ budget: 99 });
    spawnAt(h, 0, 25);
    expect(live(h)[0]!.size).toBeLessThan(crit.size);
  });
});
