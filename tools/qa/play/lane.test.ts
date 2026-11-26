import { describe, expect, test } from 'bun:test';
import type { Page } from 'playwright-core';
import { DEFAULT_THRESHOLDS, Lane, WallTimeoutError, withWallTimeout, type LaneOpts } from './lane';
import { playRun, type RunCfg } from './runner';

function makeOpts(unresponsiveS = 0.04): LaneOpts {
  return {
    name: 'test-lane',
    out: '.',
    origin: 'http://127.0.0.1:1',
    apiOffline: true,
    width: 1280,
    height: 720,
    dpr: 1,
    touch: false,
    quality: 'high',
    lang: 'en',
    thresholds: { ...DEFAULT_THRESHOLDS, unresponsiveS },
    hook: true,
  };
}

function makeHungPage() {
  let evalCalls = 0;
  let screenshotCalls = 0;
  const fakeLocator = {
    filter: () => fakeLocator,
    first: () => fakeLocator,
    last: () => fakeLocator,
    nth: () => fakeLocator,
    click: async () => {
      throw new Error('click timed out');
    },
    boundingBox: async () => null,
    count: async () => 0,
    isVisible: async () => false,
    getAttribute: async () => null,
    innerText: async () => '',
  };
  const page = {
    locator: () => fakeLocator,
    evaluate: () => {
      evalCalls++;
      return new Promise<never>(() => {
        /* deliberately never settles to simulate a hung main thread */
      });
    },
    screenshot: async () => {
      screenshotCalls++;
      return new Promise<never>(() => {
        /* never settles */
      });
    },
    keyboard: {
      press: async () => undefined,
      down: async () => undefined,
      up: async () => undefined,
    },
  } as unknown as Page;
  return {
    page,
    get evalCalls() {
      return evalCalls;
    },
    get screenshotCalls() {
      return screenshotCalls;
    },
  };
}

describe('TOOL-UI-01 bounded Lane evaluations & wall-clock deadline', () => {
  test('clickLadder routes fallback through Lane.ev, settles within deadline, and records pageUnresponsive', async () => {
    const mock = makeHungPage();
    const lane = Lane.fromPage(makeOpts(0.04), mock.page);
    lane.lastSnap = { hook: true, wall: 1, url: '/', screen: 'menu' };

    const t0 = Date.now();
    const res = await lane.clickLadder('.ms-menu-nav .ms-menu-play', { timeout: 10 });
    const elapsed = Date.now() - t0;

    expect(res).toBe('none');
    expect(elapsed).toBeLessThan(500);
    expect(lane.hung).toBe(true);
    expect(mock.evalCalls).toBe(1);
    const viols = lane.list();
    expect(viols.some((v) => v.detector === 'pageUnresponsive' && v.severity === 'blocker')).toBe(true);

    // Follow-up diagnose() on an already hung lane MUST be immediately non-blocking (no extra eval/screenshot)
    const evalsBefore = mock.evalCalls;
    const tDiag = Date.now();
    const diag = await lane.diagnose('play');
    expect(Date.now() - tDiag).toBeLessThan(50);
    expect(mock.evalCalls).toBe(evalsBefore);
    expect(mock.screenshotCalls).toBe(0);
    expect(diag).toContain('"hung":true');
  });

  test('diagnose on an unflagged hung page bounds evaluation, records pageUnresponsive, and skips screenshot', async () => {
    const mock = makeHungPage();
    const lane = Lane.fromPage(makeOpts(0.04), mock.page);
    lane.lastSnap = { hook: true, wall: 2, url: '/', screen: 'zoneSelect' };

    const t0 = Date.now();
    const diag = await lane.diagnose('enter');
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(500);
    expect(lane.hung).toBe(true);
    expect(mock.evalCalls).toBe(1);
    expect(mock.screenshotCalls).toBe(0);
    expect(diag).toContain('evaluate failed');
    expect(lane.list().some((v) => v.detector === 'pageUnresponsive' && v.severity === 'blocker')).toBe(true);
  });

  test('withWallTimeout and playRun hardWallS abort a stalled helper and return a failing report', async () => {
    await expect(
      withWallTimeout(40, 'stalled-step', () => new Promise<never>(() => {})),
    ).rejects.toBeInstanceOf(WallTimeoutError);

    // Simulate a helper that stalls inside playRun (page.locator().isVisible never resolves)
    const stallingPage = {
      locator: () => ({
        first: () => ({
          isVisible: () => new Promise<never>(() => {}),
        }),
      }),
      evaluate: async (fn: () => unknown) => {
        if (String(fn).includes('drain')) return null;
        if (String(fn).includes('indexedDB')) return null;
        return { hook: true, wall: 1, url: '/', screen: 'menu' };
      },
    } as unknown as Page;

    const lane = Lane.fromPage(makeOpts(0.05), stallingPage);
    const cfg: RunCfg = {
      label: 'stall-test',
      zone: 'yongan',
      classId: 'warrior',
      doctrine: 'a',
      difficulty: 'normal',
      god: true,
      bot: 'play',
      timeScale: 1,
      maxWallS: 0.05,
      hardWallS: 0.08,
      shots: false,
    };

    const t0 = Date.now();
    const rep = await playRun(lane, cfg);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(1000);
    expect(rep.end).toBe('timeout');
    expect(lane.list().some((v) => v.detector === 'runHardTimeout' && v.severity === 'blocker')).toBe(true);
  });
});
