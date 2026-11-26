import { describe, expect, it } from 'vitest';
import { tintOfZone, ZONE_TINT } from './zoneContinentPaint';
import { layoutContinent, placeRegion, polyArea, rectEdgeToward, rectFits, rectsHit, refineGates, type Rect } from './zoneContinent';

const SIZES: [number, number][] = [
  [820, 800],
  [540, 450],
  [345, 385],
  [330, 225],
];

describe('layoutContinent', () => {
  it('is deterministic and gives one region per zone, n - 1 gates between consecutive zones', () => {
    for (const [w, h] of SIZES) {
      const a = layoutContinent({ w, h, n: 4, seed: 7 });
      const b = layoutContinent({ w, h, n: 4, seed: 7 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.regions).toHaveLength(4);
      expect(a.gates).toHaveLength(3);
    }
  });

  it('the regions tile the landmass: no gap and no overlap (areas add up to the coast polygon)', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const c = layoutContinent({ w: 700, h: 640, n, seed: 3 });
      const sum = c.regions.reduce((s, r) => s + Math.abs(polyArea(r.poly)), 0);
      expect(sum).toBeCloseTo(Math.abs(polyArea(c.coast)), 0);
    }
  });

  it('keeps the land inside the box and every gate on the shared border of its two regions', () => {
    for (const [w, h] of SIZES) {
      const c = layoutContinent({ w, h, n: 4, seed: 11, compact: w < 420 });
      for (const p of c.coast) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(w);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(h);
      }
      for (const g of c.gates) {
        const a = c.regions[g.a];
        const b = c.regions[g.b];
        expect(a && b).toBeTruthy();
        const near = (poly: { x: number; y: number }[]): number => Math.min(...poly.map((p) => Math.hypot(p.x - g.at.x, p.y - g.at.y)));
        expect(near(a?.poly ?? [])).toBeLessThan(Math.max(w, h) * 0.08);
        expect(near(b?.poly ?? [])).toBeLessThan(Math.max(w, h) * 0.08);
      }
    }
  });
});

describe('placeRegion', () => {
  const cases: { w: number; h: number; plateW: number; plateH: number; bannerH: number; gutter: number }[] = [
    { w: 820, h: 800, plateW: 272, plateH: 70, bannerH: 134, gutter: 12 },
    { w: 540, h: 450, plateW: 230, plateH: 62, bannerH: 106, gutter: 10 },
    { w: 345, h: 385, plateW: 128, plateH: 46, bannerH: 70, gutter: 6 },
    { w: 345, h: 330, plateW: 128, plateH: 46, bannerH: 66, gutter: 6 },
    { w: 380, h: 235, plateW: 150, plateH: 42, bannerH: 62, gutter: 5 },
  ];
  it('the pin (banner + plate) is one fixed anchor: the whole unit lies inside its region with the gutter, at desktop, laptop and phone sizes', () => {
    for (const k of cases) {
      const c = layoutContinent({ w: k.w, h: k.h, n: 4, seed: 5, compact: k.w < 420 });
      for (const reg of c.regions) {
        const pl = placeRegion(reg, { plateW: k.plateW, plateH: k.plateH, bannerW: k.bannerH * 0.444, bannerH: k.bannerH, gutter: k.gutter });
        expect(rectFits(reg.poly, pl.unit, k.gutter * 0.9)).toBe(true);
        for (const r of [pl.plate, pl.banner]) {
          expect(r.x).toBeGreaterThanOrEqual(pl.unit.x - 0.01);
          expect(r.y).toBeGreaterThanOrEqual(pl.unit.y - 0.01);
          expect(r.x + r.w).toBeLessThanOrEqual(pl.unit.x + pl.unit.w + 0.01);
          expect(r.y + r.h).toBeLessThanOrEqual(pl.unit.y + pl.unit.h + 0.01);
        }
        expect(pl.plate.h).toBe(k.plateH);
        expect(pl.plate.w).toBeGreaterThanOrEqual(Math.min(k.plateW, 96) - 0.01);
      }
    }
  });

  it('units of different regions never touch, and the plates cover less than half of every region', () => {
    for (const k of cases) {
      const c = layoutContinent({ w: k.w, h: k.h, n: 4, seed: 5, compact: k.w < 420 });
      const units: Rect[] = [];
      for (const reg of c.regions) {
        const pl = placeRegion(reg, { plateW: k.plateW, plateH: k.plateH, bannerW: k.bannerH * 0.444, bannerH: k.bannerH, gutter: k.gutter });
        units.push(pl.unit);
        expect((pl.plate.w * pl.plate.h + pl.banner.w * pl.banner.h) / Math.abs(polyArea(reg.poly))).toBeLessThan(0.5);
      }
      for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) expect(rectsHit(units[i] as Rect, units[j] as Rect, k.gutter * 0.5)).toBe(false);
      }
    }
  });
});

describe('rectEdgeToward', () => {
  it('leaves the rect on the side that faces the target', () => {
    const r = { x: 10, y: 10, w: 100, h: 40 };
    expect(rectEdgeToward(r, { x: 500, y: 30 }).x).toBeCloseTo(110);
    expect(rectEdgeToward(r, { x: -400, y: 30 }).x).toBeCloseTo(10);
    expect(rectEdgeToward(r, { x: 60, y: 400 }).y).toBeCloseTo(50);
    expect(rectEdgeToward(r, { x: 60, y: -400 }, 3).y).toBeCloseTo(7);
  });
});

describe('refineGates', () => {
  it('keeps every gate on its border and clear of the plates and banners of the two regions it joins', () => {
    const cases: [number, number, number, number, number][] = [
      [820, 800, 288, 75, 12],
      [380, 235, 130, 40, 5],
      [345, 368, 166, 50, 7],
    ];
    for (const [w, h, plateW, plateH, gutter] of cases) {
      const c = layoutContinent({ w, h, n: 4, seed: 5, compact: w < 420 });
      const placed = c.regions.map((reg) => placeRegion(reg, { plateW, plateH, bannerW: 40, bannerH: 90, gutter }));
      const avoid = placed.map((p) => [p.plate, p.banner]);
      const gates = refineGates(c.gates, avoid, 14 + gutter);
      expect(gates).toHaveLength(c.gates.length);
      const dist = (at: { x: number; y: number }, rects: readonly Rect[]): number => Math.min(...rects.map((r) => Math.hypot(Math.max(r.x - at.x, 0, at.x - (r.x + r.w)), Math.max(r.y - at.y, 0, at.y - (r.y + r.h)))));
      gates.forEach((g, i) => {
        const onLine = Math.min(...g.line.map((p) => Math.hypot(p.x - g.at.x, p.y - g.at.y)));
        expect(onLine).toBeLessThan(Math.max(w, h) * 0.12);
        const rects = [...(avoid[g.a] ?? []), ...(avoid[g.b] ?? [])];
        // never worse than the plain midpoint of the border
        expect(dist(g.at, rects)).toBeGreaterThanOrEqual(Math.min(dist((c.gates[i] ?? g).at, rects), 14 + gutter) - 0.5);
      });
    }
  });
});

describe('zone tints (the one landmass is tinted, not tiled)', () => {
  it('every campaign zone has its own muted hex tint, unknown ids fall back to a tint of the palette', () => {
    const ids = Object.keys(ZONE_TINT);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids.map((id) => ZONE_TINT[id]?.tint)).size).toBe(ids.length);
    for (const id of ids) expect(ZONE_TINT[id]?.tint).toMatch(/^#[0-9a-f]{6}$/);
    for (const n of [1, 2, 7, 12]) expect(tintOfZone('nowhere', n).tint).toMatch(/^#[0-9a-f]{6}$/);
    for (const id of ids) {
      const l = ZONE_TINT[id]?.lift ?? 0;
      expect(Math.abs(l)).toBeLessThanOrEqual(0.2);
    }
  });
});
