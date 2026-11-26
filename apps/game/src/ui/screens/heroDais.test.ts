// Hero-select dais geometry (round 2) + the class gem octagon.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { octPoints } from './heroArt';
import { BASE, DAIS_FEET, DAIS_H, DAIS_W, RING, TEX_DAIS_FEET, TEX_DAIS_H, TEX_DAIS_W, TOP, ellipsePoint, frontAngles, motifCount, squash } from './heroDais';

describe('dais geometry', () => {
  it('stacks the tiers: each lower tier is wider and the top face sits at the feet line', () => {
    expect(TOP.rx).toBeLessThan(RING.rx);
    expect(RING.rx).toBeLessThan(BASE.rx);
    expect(BASE.cx + BASE.rx).toBeLessThanOrEqual(DAIS_W);
    expect(BASE.cx - BASE.rx).toBeGreaterThanOrEqual(0);
    expect(DAIS_FEET).toBeCloseTo(TOP.cy / DAIS_H, 6);
    expect(DAIS_FEET).toBeGreaterThan(0.3);
    expect(DAIS_FEET).toBeLessThan(0.37);
  });
  it('ellipsePoint: 0 = right, PI/2 = nearest the viewer, PI = left', () => {
    const [x0, y0] = ellipsePoint(TOP, 0);
    const [x1, y1] = ellipsePoint(TOP, Math.PI / 2);
    const [x2] = ellipsePoint(TOP, Math.PI);
    expect(x0).toBeCloseTo(TOP.cx + TOP.rx);
    expect(y0).toBeCloseTo(TOP.cy);
    expect(x1).toBeCloseTo(TOP.cx);
    expect(y1).toBeCloseTo(TOP.cy + TOP.ry);
    expect(x2).toBeCloseTo(TOP.cx - TOP.rx);
  });
  it('front motifs: an odd count puts one exactly in front and the squash turns to 0 towards the sides', () => {
    for (const w of [26, 44]) {
      const n = motifCount(RING, w);
      expect(n % 2).toBe(1);
      const a = frontAngles(n);
      expect(a).toHaveLength(n);
      expect(a[(n - 1) / 2]).toBeCloseTo(Math.PI / 2, 9);
      expect(a[0]! + a[n - 1]!).toBeCloseTo(Math.PI, 9);
      expect(squash(Math.PI / 2)).toBe(1);
      expect(squash(a[0]!)).toBeLessThan(0.3);
    }
  });
});

describe('class gem octagon', () => {
  it('has 8 points inside the 48 box and shrinks with the inset', () => {
    const pts = (i: number): number[][] => octPoints(i).split(' ').map((p) => p.split(',').map(Number));
    const outer = pts(0.6);
    const inner = pts(5);
    expect(outer).toHaveLength(8);
    expect(inner).toHaveLength(8);
    for (const [x, y] of outer) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(48);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(48);
    }
    expect(Math.max(...inner.map((p) => p[0]!))).toBeLessThan(Math.max(...outer.map((p) => p[0]!)));
  });
});

describe('painted dais (round 3)', () => {
  it('keeps the shipped 1024 x 407 box, with the feet on the top face (about 16 % down), above the drum', () => {
    expect(TEX_DAIS_W / TEX_DAIS_H).toBeCloseTo(1024 / 407, 6);
    expect(TEX_DAIS_FEET).toBeGreaterThan(0.12);
    expect(TEX_DAIS_FEET).toBeLessThan(0.22);
  });
});

// the layout contract of the full-bleed scene: every stage element is placed from the same five custom properties
// (vitest hands `?raw` CSS imports back empty, so the sheets are read from disk)
const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const sheet = read('./hero-stage.css');
/** the declaration block of the rule that starts with exactly `selector {` */
const block = (selector: string): string => {
  const at = sheet.indexOf(`
${selector} {`);
  return at < 0 ? '' : sheet.slice(at, sheet.indexOf('}', at));
};
describe('stage layout contract (hero-stage.css)', () => {
  it('reads the sheet', () => {
    expect(sheet.length).toBeGreaterThan(1000);
  });
  it('places the dais, shadow, pool, puff and hero box from --cx / --fy / --dw / --hh / --hw', () => {
    for (const sel of ['.ms-hs-dais', '.ms-hs-shadow', '.ms-hs-pool', '.ms-hs-puff', '.ms-hs-fig']) {
      expect(block(sel), sel).toContain('var(--cx)');
    }
  });
  it('defines the numbers for desktop, phone portrait and phone landscape', () => {
    for (const mode of ['w', 'p', 'l']) expect(block(`.ms-hs--${mode} .ms-hs-stage`), mode).toContain('--fy:');
  });
  it('leaves no sticker glow on the hero canvas (no blurred coloured drop-shadow, no halo layer)', () => {
    expect(sheet).not.toContain('.ms-hs-halo');
    const canvas = block('.ms-hs-3d canvas');
    expect(canvas).toContain('drop-shadow(-1px 0 0');
    expect(canvas).not.toContain('var(--cc)');
  });
});
