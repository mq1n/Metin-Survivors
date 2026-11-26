// PLAYREV-1: one throw from the sim tick / VFX / audio / render used to end the rAF chain for good (the loop stayed `running`,
// start() was a no-op, the whole page froze without an error screen). FixedLoop now books the next frame first and reports
// every throwing frame (with the count of frames in a row) so the app can end a run whose frames keep failing.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FATAL_BAD_FRAMES, FixedLoop, SIM_DT } from './loop';

const FRAME_MS = 1000 / 60;

interface Raf {
  pending: Map<number, FrameRequestCallback>;
  now: number;
  /** run one animation frame: every callback that was pending when the frame starts */
  frame(): number;
}

let raf: Raf;
let saved: { r: unknown; c: unknown };

beforeEach(() => {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  raf = {
    pending,
    now: 0,
    frame() {
      this.now += FRAME_MS;
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb(this.now);
      return cbs.length;
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  saved = { r: g.requestAnimationFrame, c: g.cancelAnimationFrame };
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    pending.set(++id, cb);
    return id;
  };
  g.cancelAnimationFrame = (h: number) => {
    pending.delete(h);
  };
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.requestAnimationFrame = saved.r;
  g.cancelAnimationFrame = saved.c;
});

describe('FixedLoop survives a throwing frame', () => {
  it('a single throw at tick 30: the sim keeps counting ticks, the loop keeps running, the error callback fires once', () => {
    let ticks = 0;
    let thrown = 0;
    const errors: { err: unknown; n: number }[] = [];
    const loop = new FixedLoop({
      step: () => {
        ticks++;
        if (ticks === 30 && thrown === 0) {
          thrown++;
          throw new Error('sim blew up once');
        }
      },
      render: () => {},
      error: (err, n) => errors.push({ err, n }),
    });
    loop.start();
    for (let i = 0; i < 240; i++) raf.frame();
    expect(thrown).toBe(1);
    expect(errors.length).toBe(1);
    expect(errors[0]?.n).toBe(1);
    expect((errors[0]?.err as Error).message).toBe('sim blew up once');
    // 240 frames of 1/60 s = 240 ticks, give or take the one retried tick (the throwing tick is re-run, not lost)
    expect(ticks).toBeGreaterThan(235);
    expect(loop.isRunning).toBe(true);
    expect(raf.pending.size).toBe(1);
    expect(loop.stats.frameErrors).toBe(1);
  });

  it('a throw in render() does not end the chain either (the sim already advanced that frame)', () => {
    let renders = 0;
    let ticks = 0;
    const loop = new FixedLoop({
      step: () => void ticks++,
      render: () => {
        renders++;
        if (renders === 5) throw new Error('render blew up once');
      },
    });
    loop.start();
    for (let i = 0; i < 60; i++) raf.frame();
    expect(renders).toBeGreaterThan(50);
    expect(ticks).toBeGreaterThan(55);
    expect(raf.pending.size).toBe(1);
  });

  it('a throw on every frame reports 1, 2, 3 ... consecutive frames and the loop keeps scheduling until stopped', () => {
    const seen: number[] = [];
    const loop = new FixedLoop({
      step: () => {
        throw new Error('always');
      },
      render: () => {},
      error: (_e, n) => seen.push(n),
    });
    loop.start();
    for (let i = 0; i < 8; i++) raf.frame(); // (the first frame has no elapsed time yet and runs no tick)
    expect(seen.slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(FATAL_BAD_FRAMES).toBeLessThanOrEqual(6);
    expect(raf.pending.size).toBe(1);
    loop.stop();
    expect(raf.pending.size).toBe(0);
    expect(loop.isRunning).toBe(false);
  });

  it('a good frame resets the consecutive count', () => {
    let failNow = false;
    const seen: number[] = [];
    const loop = new FixedLoop({
      step: () => {
        if (failNow) throw new Error('flaky');
      },
      render: () => {},
      error: (_e, n) => seen.push(n),
    });
    loop.start();
    raf.frame(); // warm-up: the first frame has no elapsed time
    for (const bad of [true, true, false, true, false, true, true, true]) {
      failNow = bad;
      raf.frame();
    }
    expect(seen).toEqual([1, 2, 1, 1, 2, 3]);
  });

  it('an error callback that throws cannot break the chain; one that stops the loop ends it cleanly', () => {
    let calls = 0;
    const loop = new FixedLoop({
      step: () => {
        throw new Error('boom');
      },
      render: () => {},
      error: (_e, n) => {
        calls++;
        if (n >= 4) loop.stop();
        throw new Error('handler boom');
      },
    });
    const log = console.error;
    console.error = () => {};
    try {
      loop.start();
      for (let i = 0; i < 10; i++) raf.frame();
    } finally {
      console.error = log;
    }
    expect(calls).toBe(4);
    expect(loop.isRunning).toBe(false);
    expect(raf.pending.size).toBe(0);
  });

  it('start() after a failed run works again (a new run restarts ticking)', () => {
    let ticks = 0;
    let fail = true;
    const loop = new FixedLoop({
      step: () => {
        if (fail) throw new Error('boom');
        ticks++;
      },
      render: () => {},
    });
    loop.start();
    for (let i = 0; i < 5; i++) raf.frame();
    fail = false;
    for (let i = 0; i < 30; i++) raf.frame();
    expect(ticks).toBeGreaterThan(25);
    expect(SIM_DT).toBeGreaterThan(0);
  });
});

describe('runCrashMessage', () => {
  it('has wording in both languages and carries the cleaned cause', async () => {
    const { runCrashMessage } = await import('../app/loadFailure');
    const { dictionaries } = await import('../i18n/i18n');
    for (const l of ['en', 'tr'] as const) expect(dictionaries[l]['boot.runCrashedMsg'], l).toContain('{reason}');
    const msg = runCrashMessage(new TypeError("Cannot read properties of undefined (reading 'x') at assets/models/orc.4f1c2a9e.glb"));
    expect(msg).not.toContain('boot.runCrashedMsg');
    expect(msg).toContain('Cannot read properties of undefined');
    expect(msg).not.toContain('4f1c2a9e');
  }, 60_000);
});
