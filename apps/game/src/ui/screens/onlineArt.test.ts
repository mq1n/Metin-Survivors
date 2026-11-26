// Online (B13): the painted textures of the leaderboard / co-op lobby ship with the sprite geometry the CSS assumes, and the
// screen's own sheets keep the kit material discipline (G4).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OL_TEX, OL_TEX_OPT } from './onlineArt';
import { thumbGeometry } from './onlineScroll';

const sheets = import.meta.glob<string>('./{online,coop}.css', { query: '?raw', import: 'default', eager: true });

type TexEntry = { id: string; url: string; w: number; h: number; alpha?: boolean };
function textureEntries(): TexEntry[] {
  const raw = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as unknown;
  if (Array.isArray(raw)) return raw as TexEntry[];
  const o = raw as Record<string, unknown>;
  const inner = (o.textures ?? o) as Record<string, TexEntry> | TexEntry[];
  return Array.isArray(inner) ? inner : Object.values(inner);
}

describe('online painted textures (uk_online_*)', () => {
  const byId = new Map(textureEntries().map((e) => [e.id, e]));

  it('all three shipped ids are in the manifest', () => {
    for (const id of Object.values(OL_TEX)) expect(byId.has(id), id).toBe(true);
  });

  it('the plate and seal sheets are three equal cells wide (the CSS uses background-size 300% 100%)', () => {
    for (const id of [OL_TEX.plates, OL_TEX.seals]) {
      const e = byId.get(id)!;
      expect(e.alpha, `${id} alpha`).toBe(true);
      // one cell is roughly square for the seals and ~1.47:1 for the plates (RankPlate's 0.68 height factor)
      const cellRatio = e.w / 3 / e.h;
      if (id === OL_TEX.plates) expect(cellRatio).toBeGreaterThan(1.35), expect(cellRatio).toBeLessThan(1.6);
      else expect(cellRatio).toBeGreaterThan(0.9), expect(cellRatio).toBeLessThan(1.15);
    }
  });

  it('the round-2 ids (octagon ring, class emblem sheet) are in the manifest with the geometry the CSS assumes', () => {
    const ring = byId.get(OL_TEX_OPT.ring)!;
    expect(ring, 'ring').toBeTruthy();
    expect(ring.alpha, 'ring alpha').toBe(true);
    // the CSS (inset -8.1 %) assumes a square sprite whose octagon fills ~86 % of it
    expect(ring.w).toBe(ring.h);
    const emb = byId.get(OL_TEX_OPT.emblems)!;
    expect(emb, 'emblems').toBeTruthy();
    expect(emb.alpha, 'emblems alpha').toBe(true);
    // five equal cells; background-size 500% auto + 45 % vertical needs a cell roughly 0.5-0.62 as wide as it is tall
    const cellRatio = emb.w / 5 / emb.h;
    expect(cellRatio).toBeGreaterThan(0.5);
    expect(cellRatio).toBeLessThan(0.62);
  });

  it('the empty seat medallion is a square sprite with alpha (the CSS insets it by -8.1 % like the ring)', () => {
    const seat = byId.get(OL_TEX_OPT.seat)!;
    expect(seat, 'seat').toBeTruthy();
    expect(seat.alpha, 'seat alpha').toBe(true);
    expect(seat.w).toBe(seat.h);
  });

  it('round 3: the empire banner sheet is a 1024 px square with alpha (the CSS crops three 655 x 282 banners at x 184, y 57 / 378 / 698)', () => {
    const f = byId.get(OL_TEX_OPT.flags)!;
    expect(f, 'flags').toBeTruthy();
    expect(f.alpha, 'flags alpha').toBe(true);
    expect(f.w).toBe(1024);
    expect(f.h).toBe(1024);
  });

  it('round 3: the lit-leather swatch is opaque and wider than tall (it is cropped with background-size: 100% auto)', () => {
    const h = byId.get(OL_TEX_OPT.hilite)!;
    expect(h, 'hilite').toBeTruthy();
    expect(h.alpha ?? false).toBe(false);
    expect(h.w).toBeGreaterThan(h.h);
  });

  it('the leather strap is opaque and wider than tall (it is cropped with background-size: cover)', () => {
    const e = byId.get(OL_TEX.leather)!;
    expect(e.alpha ?? false).toBe(false);
    expect(e.w).toBeGreaterThan(e.h);
  });
});

describe('OlScroll thumb geometry', () => {
  it('a list that fits has no thumb travel and a full-length thumb', () => {
    expect(thumbGeometry(400, 400, 0, 300)).toEqual({ scrollable: false, size: 300, top: 0 });
    expect(thumbGeometry(400.5, 400, 0, 300).scrollable).toBe(false);
  });
  it('the thumb is view / total of the channel and travels the free space', () => {
    const top = thumbGeometry(1000, 250, 0, 400);
    expect(top).toEqual({ scrollable: true, size: 100, top: 0 });
    const end = thumbGeometry(1000, 250, 750, 400);
    expect(end.top).toBeCloseTo(300, 5);
    const mid = thumbGeometry(1000, 250, 375, 400);
    expect(mid.top).toBeCloseTo(150, 5);
  });
  it('a hidden bar (channel not laid out yet) still reports an overflowing list as scrollable', () => {
    expect(thumbGeometry(1000, 250, 0, 0)).toEqual({ scrollable: true, size: 0, top: 0 });
  });
  it('a very long list keeps a grabbable thumb, and an overscrolled position is clamped', () => {
    const g = thumbGeometry(100000, 500, 99999, 300);
    expect(g.size).toBe(26);
    expect(g.top).toBeCloseTo(274, 5);
    expect(thumbGeometry(1000, 250, -40, 400).top).toBe(0);
  });
});

describe('online sheets keep the kit discipline (G4)', () => {
  const entries = Object.entries(sheets);
  it('finds both sheets', () => {
    expect(entries.map(([f]) => f).sort()).toEqual(['./coop.css', './online.css']);
  });
  for (const [file, css] of entries) {
    it(`${file}: no repeating-gradient hatches, no frame override, no decorative face, no mint, no tiny raw font sizes`, () => {
      expect(css).not.toMatch(/repeating-(linear|radial|conic)-gradient/);
      expect(css).not.toMatch(/--frame\s*:/);
      expect(css).not.toMatch(/Cinzel Decorative/i);
      expect(css).not.toMatch(/3fae83|8ff0c0|6fd1a6/i);
      const raw = [...css.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).filter((n) => n < 0.75);
      expect(raw).toEqual([]);
    });
    it(`${file}: no pill radii on chips (no radius of 1rem or more on a .ms-ol / .ms-lb / .ms-co rule)`, () => {
      const bad = [...css.matchAll(/border-radius:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).filter((n) => n >= 1);
      expect(bad).toEqual([]);
    });
  }
});
