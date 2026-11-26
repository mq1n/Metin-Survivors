import { afterEach, describe, expect, it } from 'vitest';
import { layout } from '../layout';
import { buildInBar, BUILD_BTN_REM, equipInBar, EQUIP_IN_BAR_REM, fmtCd, mapInBar, MAP_BTN_REM, remWidth } from './hooks';

const base = layout.value;

/** a desktop layout `rem` px per rem wide `w` px */
function at(w: number, rem: number, compact = false): void {
  layout.value = { ...base, w, rem, compact, h: 1080 };
}

afterEach(() => {
  layout.value = base;
});

describe('taskbar width tiers', () => {
  it('1920 x 1080 (120 rem) carries the sockets and every button', () => {
    at(1920, 16);
    expect(remWidth()).toBeCloseTo(120);
    expect(equipInBar()).toBe(true);
    expect(mapInBar()).toBe(true);
    expect(buildInBar()).toBe(true);
  });

  it('1600 x 900 (~105 rem) keeps the map button but folds the sockets under the buff row', () => {
    at(1600, 15.217);
    expect(remWidth()).toBeGreaterThan(MAP_BTN_REM);
    expect(remWidth()).toBeLessThan(EQUIP_IN_BAR_REM);
    expect(equipInBar()).toBe(false);
    expect(mapInBar()).toBe(true);
    expect(buildInBar()).toBe(true);
  });

  it('1366 x 768 (~93 rem) keeps map + build + menu but no sockets', () => {
    at(1366, 14.643);
    expect(equipInBar()).toBe(false);
    expect(mapInBar()).toBe(true);
    expect(buildInBar()).toBe(true);
  });

  it('1280 x 720 (~89 rem) drops the map button, keeps build + menu', () => {
    at(1280, 14.435);
    expect(mapInBar()).toBe(false);
    expect(buildInBar()).toBe(true);
  });

  it('a 1024 x 768 tablet (~70 rem) drops the build button too', () => {
    at(1024, 14.643);
    expect(remWidth()).toBeLessThan(BUILD_BTN_REM);
    expect(buildInBar()).toBe(false);
  });

  it('phones never use the bar extras', () => {
    at(1920, 16, true);
    expect(equipInBar()).toBe(false);
    expect(mapInBar()).toBe(false);
    expect(buildInBar()).toBe(false);
  });
});

describe('cooldown number', () => {
  it('formats whole seconds from 10 and tenths below', () => {
    expect(fmtCd(12.2)).toBe('13');
    expect(fmtCd(4.24)).toBe('4.2');
  });
});
