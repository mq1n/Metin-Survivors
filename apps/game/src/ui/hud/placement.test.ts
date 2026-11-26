import { describe, expect, it } from 'vitest';
import { edgeInsets, placeArrows, rayToEdge, type PlaceOptions, type Rect } from './placement';

const base: PlaceOptions = { w: 1920, h: 1080, inset: 40, radius: 24, blocked: [] };
const inside = (x: number, y: number, r: Rect, d = 0): boolean => x > r.l - d && x < r.r + d && y > r.t - d && y < r.b + d;

describe('rayToEdge', () => {
  it('leaves the inset viewport on the matching edge', () => {
    const o = { w: 1920, h: 1080, ins: edgeInsets(base) };
    const right = rayToEdge(1, 0, o);
    expect(right.x).toBeCloseTo(1920 - 40);
    expect(right.y).toBeCloseTo(540);
    const up = rayToEdge(0, -1, o);
    expect(up.y).toBeCloseTo(40);
    const diag = rayToEdge(1, 1, o);
    expect(diag.y).toBeCloseTo(1080 - 40);
  });
});

describe('placeArrows', () => {
  it('keeps the heading and the request order', () => {
    const out = placeArrows(
      [
        { key: 'a', dx: 0, dy: -1 },
        { key: 'b', dx: 5, dy: 5 },
      ],
      base,
    );
    expect(out.map((a) => a.key)).toEqual(['a', 'b']);
    expect(out[0]?.angle).toBeCloseTo(-90);
    expect(out[1]?.angle).toBeCloseTo(45);
  });

  it('slides an arrow out of a reserved rectangle along the edge', () => {
    // the timer / boss plate at the top centre
    const plate: Rect = { l: 700, t: 0, r: 1220, b: 200 };
    const [a] = placeArrows([{ key: 'boss', dx: 0, dy: -1 }], { ...base, blocked: [plate] });
    expect(a).toBeDefined();
    expect(inside(a!.x, a!.y, plate, 24)).toBe(false);
    expect(a!.y).toBeCloseTo(40);
    expect(a!.x).toBeGreaterThan(0);
    expect(a!.x).toBeLessThan(1920);
  });

  it('rides under a top band that is walled off from side to side (portrait phone: vitals + minimap + timer)', () => {
    const phone: PlaceOptions = { w: 390, h: 844, inset: 33, radius: 42, blocked: [] };
    const vitals: Rect = { l: 10, t: 8, r: 300, b: 100 };
    const mini: Rect = { l: 305, t: 8, r: 390, b: 160 };
    const timer: Rect = { l: 12, t: 100, r: 300, b: 150 };
    const bossPlate: Rect = { l: 49, t: 165, r: 330, b: 250 };
    const blocked = [vitals, mini, timer, bossPlate];
    const [a] = placeArrows([{ key: 'boss', dx: 0, dy: -1 }], { ...phone, blocked });
    expect(a).toBeDefined();
    for (const r of blocked) expect(inside(a!.x, a!.y, r, 42)).toBe(false);
    expect(a!.y).toBeGreaterThan(250);
    expect(a!.y).toBeLessThan(844 / 2);
    expect(a!.angle).toBeCloseTo(-90);
  });

  it('keeps the edge line when a free spot exists on it', () => {
    const plate: Rect = { l: 100, t: 0, r: 290, b: 90 };
    const [a] = placeArrows([{ key: 'boss', dx: 0, dy: -1 }], { w: 390, h: 844, inset: 33, radius: 42, blocked: [plate] });
    expect(a!.y).toBeCloseTo(33);
  });

  it('moves the bottom edge up above a full-width taskbar', () => {
    const bar: Rect = { l: 0, t: 960, r: 1920, b: 1080 };
    const ins = edgeInsets({ ...base, blocked: [bar] });
    expect(ins.b).toBeCloseTo(120 + 24);
    expect(ins.t).toBe(40);
    const [a] = placeArrows([{ key: 'x', dx: 0, dy: 1 }], { ...base, blocked: [bar] });
    expect(a!.y).toBeCloseTo(960 - 24);
  });

  it('keeps arrows on the right edge out of the minimap column and the taskbar', () => {
    const mini: Rect = { l: 1640, t: 0, r: 1920, b: 330 };
    const bar: Rect = { l: 0, t: 960, r: 1920, b: 1080 };
    const out = placeArrows(
      [
        { key: 'm1', dx: 1, dy: -0.45 },
        { key: 'm2', dx: 1, dy: 0.9 },
      ],
      { ...base, blocked: [mini, bar] },
    );
    for (const a of out) {
      expect(inside(a.x, a.y, mini, 24)).toBe(false);
      expect(inside(a.x, a.y, bar, 24)).toBe(false);
    }
  });

  it('never stacks two arrows on the same spot', () => {
    const out = placeArrows(
      [
        { key: 'a', dx: 1, dy: 0 },
        { key: 'b', dx: 1, dy: 0.01 },
        { key: 'c', dx: 1, dy: -0.01 },
      ],
      base,
    );
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = Math.hypot(out[i]!.x - out[j]!.x, out[i]!.y - out[j]!.y);
        expect(d).toBeGreaterThanOrEqual(2 * base.radius - 0.001);
      }
    }
  });

  it('gives the higher priority the exact spot', () => {
    const out = placeArrows(
      [
        { key: 'metin', dx: 1, dy: 0, priority: 0 },
        { key: 'boss', dx: 1, dy: 0, priority: 5 },
      ],
      base,
    );
    const boss = out.find((a) => a.key === 'boss')!;
    expect(boss.y).toBeCloseTo(540);
    const metin = out.find((a) => a.key === 'metin')!;
    expect(Math.abs(metin.y - 540)).toBeGreaterThanOrEqual(2 * base.radius - 0.001);
  });
});
