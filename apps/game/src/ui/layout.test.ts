import { describe, expect, it } from 'vitest';
import { computeRem, computeTier, tapPx, TAP_PX } from './layout';

describe('layout tiers (C8)', () => {
  it('maps the reference viewports to their composition tier', () => {
    const cases: [number, number, string][] = [
      [390, 844, 'phone-p'],
      [430, 932, 'phone-p'],
      [360, 800, 'phone-p'],
      [844, 390, 'phone-l'],
      [932, 430, 'phone-l'],
      [667, 375, 'phone-l'],
      [768, 1024, 'tablet'],
      [1024, 768, 'tablet'],
      [1180, 820, 'tablet'],
      [1366, 1024, 'tablet'],
      [1280, 720, 'laptop'],
      [1366, 768, 'laptop'],
      [1536, 864, 'laptop'],
      [1920, 1080, 'desktop'],
      [1920, 969, 'desktop'],
      [2560, 1440, 'desktop'],
      [3840, 2160, 'desktop'],
      [2560, 1080, 'ultra'],
      [3440, 1440, 'ultra'],
    ];
    for (const [w, h, tier] of cases) expect(`${w}x${h} ${computeTier(w, h)}`).toBe(`${w}x${h} ${tier}`);
  });

  it('phone tiers are exactly the compact layouts of the rem scale', () => {
    for (let w = 300; w <= 2600; w += 37) {
      for (let h = 300; h <= 1500; h += 29) {
        const compact = w < h ? w < 600 : h < 560;
        const tier = computeTier(w, h);
        expect(tier === 'phone-p' || tier === 'phone-l').toBe(compact);
      }
    }
  });

  it('keeps computeRem unchanged (phone landscape 13 px/rem, portrait 15, 1080p 16)', () => {
    expect(computeRem(844, 390)).toBeCloseTo(13, 5);
    expect(computeRem(390, 844)).toBeCloseTo(15, 5);
    expect(computeRem(1920, 1080)).toBeCloseTo(16, 5);
  });

  it('touch target edge never drops below 44 CSS px', () => {
    expect(tapPx(computeRem(844, 390))).toBe(TAP_PX);
    expect(tapPx(computeRem(390, 844))).toBe(TAP_PX);
    expect(tapPx(16)).toBe(44);
    expect(tapPx(32)).toBe(88);
  });
});
