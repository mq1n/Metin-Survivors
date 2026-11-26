import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachBootSink, BOOT_FRACTION, BOOT_UI_MOUNTED, bootState, reportBoot, resetBootProgress, type SplashApi } from './bootProgress';
import { dictionaries } from '../i18n/i18n';

describe('boot progress', () => {
  const calls: Array<{ p: number; text?: string; pct?: string }> = [];
  const splash: SplashApi = { set: (p, text, pct) => void calls.push({ p, text, pct }), done: () => undefined };

  beforeEach(() => {
    calls.length = 0;
    resetBootProgress();
    (globalThis as { window?: unknown }).window = { __msSplash: splash };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('the stages run forward and end at the full gauge', () => {
    const order = ['assets', 'content', 'save', 'ui', 'ready'] as const;
    const f = order.map((s) => BOOT_FRACTION[s]);
    expect([...f].sort((a, b) => a - b)).toEqual(f);
    expect(BOOT_FRACTION.ready).toBe(1);
    expect(BOOT_FRACTION.ui).toBeLessThan(BOOT_UI_MOUNTED);
    expect(BOOT_UI_MOUNTED).toBeLessThan(1);
    // the inline splash creeps to ~33 % by CSS (index.html): the first real value must not walk the gauge back
    expect(BOOT_FRACTION.assets).toBeGreaterThanOrEqual(0.33);
  });

  it('every stage has a caption in both languages', () => {
    for (const s of Object.keys(BOOT_FRACTION)) {
      expect(dictionaries.en[`boot.stage.${s}`], `en ${s}`).toBeTruthy();
      expect(dictionaries.tr[`boot.stage.${s}`], `tr ${s}`).toBeTruthy();
    }
  });

  it('drives the splash with a caption and a percent, and the store once attached', () => {
    reportBoot('assets');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.p).toBeCloseTo(BOOT_FRACTION.assets);
    expect(calls[0]?.text).toMatch(/…$/);
    expect(calls[0]?.pct).toMatch(/36/);
    const seen: Array<{ fraction: number; label: string }> = [];
    attachBootSink({ setLoading: (l) => void seen.push(l) });
    expect(seen).toEqual([{ fraction: BOOT_FRACTION.assets, label: 'assets' }]); // catches up with what was already reported
    reportBoot('content');
    expect(seen.at(-1)).toEqual({ fraction: BOOT_FRACTION.content, label: 'content' });
  });

  it('never walks the gauge back', () => {
    reportBoot('ui', BOOT_UI_MOUNTED);
    reportBoot('save');
    expect(bootState().fraction).toBe(BOOT_UI_MOUNTED);
    expect(calls.at(-1)?.p).toBe(BOOT_UI_MOUNTED);
  });

  it('clamps nonsense and survives a missing splash (gallery, tests, a blocked script)', () => {
    reportBoot('ready', Number.NaN);
    expect(bootState().fraction).toBe(0);
    reportBoot('ready', 7);
    expect(bootState().fraction).toBe(1);
    delete (globalThis as { window?: unknown }).window;
    expect(() => reportBoot('ready')).not.toThrow();
  });
});
