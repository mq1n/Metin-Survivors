// Regression tests for UI-08: Portrait HUD layout keeps Auto/Manual toggle, Pause button, Coins, and 7..10 skill seats
// completely disjoint and on-screen across 360x800, 390x844, and 430x932 in both EN and TR, with and without safe-area insets.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import balance from '../../data/content/balance.json';
import en from '../../i18n/en.json';
import tr from '../../i18n/tr.json';
import type { HudSkillSlot } from '../../sim/types';
import { computeRem, computeTier, tapPx } from '../layout';
import { skillBar, splitSkills } from '../skillSlots';
import { portraitTaskbarRects, type PortraitRect } from './Taskbar';

function intersects(a: PortraitRect, b: PortraitRect, eps = 1e-6): boolean {
  return a.left < b.right - eps && a.right > b.left + eps && a.top < b.bottom - eps && a.bottom > b.top + eps;
}

/** Conservative upper-bound pixel width for an uppercase bold tracked label (12px font, 0.08em tracking). */
function conservativeLabelPx(text: string): number {
  const fontPx = 12;
  const charAdvance = fontPx * 0.78 + fontPx * 0.08;
  return Math.ceil(text.length * charAdvance);
}

describe('UI-08: portrait HUD taskbar geometry (Auto/Manual vs Pause vs Skill seats)', () => {
  const viewports = [
    [360, 800],
    [390, 844],
    [430, 932],
  ] as const;

  const labels = [
    ['en:on', en['hud.autoCast.labelOn']],
    ['en:off', en['hud.autoCast.labelOff']],
    ['tr:on', tr['hud.autoCast.labelOn']],
    ['tr:off', tr['hud.autoCast.labelOff']],
  ] as const;

  const insets = [
    { name: 'none', safeL: 0, safeR: 0, safeB: 0 },
    { name: 'ios-safe', safeL: 16, safeR: 16, safeB: 34 },
  ] as const;

  it('hud.css positions .ms-tb-auto out of the skill flex row in portrait and budgets .ms-tb-skills against Pause', () => {
    const css = readFileSync(resolve(__dirname, 'hud.css'), 'utf8');
    expect(css).toContain('.ms-portrait .ms-tb-center');
    expect(css).toContain('.ms-portrait .ms-tb-auto');
    expect(css).toContain('--sk-budget: calc(100vw - var(--safe-l) - var(--safe-r) - var(--btn-s) - 2.15rem)');
    expect(css).toContain('bottom: calc(var(--tb-h) + 0.55rem + var(--safe-b))');
  });

  it('standard 7-seat bar (basic + 6 active skills) and expanded ultimate bars (8..10 seats) stay disjoint and on-screen at 360, 390, and 430px', () => {
    const basic: HudSkillSlot = { id: 'basic', icon: 'basic', rank: 0, cooldown: 0, cdLeft: 0, basic: true, awakened: false };
    const standardBar = skillBar(splitSkills([basic], () => 'active'), balance.maxActiveSkills);
    expect(standardBar.length).toBe(7);

    for (const [w, h] of viewports) {
      expect(computeTier(w, h)).toBe('phone-p');
      const rem = computeRem(w, h);
      const tap = tapPx(rem);

      for (const ins of insets) {
        for (const [tag, text] of labels) {
          for (const seats of [6, 7, 8, 9, 10]) {
            const rects = portraitTaskbarRects({
              w,
              h,
              rem,
              tap,
              seats,
              autoTextPx: conservativeLabelPx(text),
              safeL: ins.safeL,
              safeR: ins.safeR,
              safeB: ins.safeB,
            });
            const ctx = `${w}x${h} ${ins.name} ${tag} seats=${seats}`;

            // Every interactive box stays completely inside the safe viewport
            for (const [name, r] of [
              ['auto', rects.auto],
              ['pause', rects.pause],
              ['skills', rects.skills],
              ['skillsBezel', rects.skillsBezel],
            ] as const) {
              expect(r.left, `${ctx} ${name}.left`).toBeGreaterThanOrEqual(ins.safeL - 0.01);
              expect(r.right, `${ctx} ${name}.right`).toBeLessThanOrEqual(w - ins.safeR + 0.01);
              expect(r.top, `${ctx} ${name}.top`).toBeGreaterThanOrEqual(0);
              expect(r.bottom, `${ctx} ${name}.bottom`).toBeLessThanOrEqual(h - ins.safeB + 0.01);
            }

            // Disjoint hit & visual regions: Auto NEVER overlaps Pause, skills, or coins; skills NEVER overlap Pause
            expect(intersects(rects.auto, rects.pause), `${ctx} auto vs pause`).toBe(false);
            expect(intersects(rects.auto, rects.skillsBezel), `${ctx} auto vs skills`).toBe(false);
            expect(intersects(rects.auto, rects.coins), `${ctx} auto vs coins`).toBe(false);
            expect(intersects(rects.skillsBezel, rects.pause), `${ctx} skills vs pause`).toBe(false);

            // Touch target height comfort for both Auto/Manual and Pause
            expect(rects.pause.height, `${ctx} pause height`).toBeGreaterThanOrEqual(tap - 0.01);
            expect(rects.auto.height, `${ctx} auto height`).toBeGreaterThanOrEqual(tap - 0.01);
            expect(rects.slotPx, `${ctx} slot size positive`).toBeGreaterThan(20);
          }
        }
      }
    }
  });
});
