import { afterEach, describe, expect, it, vi } from 'vitest';
import { startUiPrewarm } from '../app';
import { clearRunMarker, markRunStart, takeInterruptedRun } from '../runMarker';
import { clearSettlements, isFinishedRun, settleRunOnce } from '../settlement';
import { GameStore } from '../store';
import { runPrewarm, type PrewarmIo } from '../../ui/prewarm';
import type { MetaService, SettleOutcome } from '../../meta/service';
import type { RunResult } from '../../sim/run';

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    victory: false,
    zone: 'yeonmu',
    difficulty: 'normal',
    classId: 'warrior',
    doctrine: 'a',
    seed: 4242,
    time: 95,
    level: 8,
    kills: 120,
    elites: 2,
    bosses: 0,
    metins: 1,
    metinsAwakened: 0,
    yeop: 150,
    shards: 3,
    revivesUsed: 0,
    damageTaken: 100,
    damageDealt: 9000,
    rewardMul: 1,
    skills: [],
    passives: [],
    stones: [],
    trinkets: [],
    players: [{ index: 0, level: 8, kills: 120, yeop: 150, alive: true }],
    bossTimeline: [],
    ...overrides,
  } as RunResult;
}

afterEach(() => {
  clearSettlements();
  clearRunMarker();
  vi.restoreAllMocks();
});

describe('SIM-01: bounded UI prewarm', () => {
  it('finishes within joinMs + cleanupMs even when prewarmRunUi never resolves', async () => {
    let aborted = false;
    const job = startUiPrewarm({
      joinMs: 10,
      cleanupMs: 15,
      load: async () => ({
        prewarmRunUi: ({ signal } = {}) =>
          new Promise(() => {
            signal?.addEventListener('abort', () => {
              aborted = true;
            });
          }),
      }),
    });

    const t0 = Date.now();
    await job.finish();
    const elapsed = Date.now() - t0;
    expect(aborted).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });

  it('finishes within joinMs + cleanupMs even when the dynamic chunk import stalls', async () => {
    const job = startUiPrewarm({
      joinMs: 10,
      cleanupMs: 15,
      load: () => new Promise(() => {}),
    });

    const t0 = Date.now();
    await job.finish();
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('aborts runPrewarm when decode never settles', async () => {
    const ctl = new AbortController();
    const io: PrewarmIo = {
      now: () => Date.now(),
      textureUrl: (id) => `/${id}.webp`,
      decode: () => new Promise(() => {}),
      loadFont: () => new Promise(() => {}),
      paint: async () => [],
    };
    setTimeout(() => ctl.abort(), 15);
    const report = await runPrewarm(io, { textures: ['tex_a'], fonts: ['12px Test'], groups: [] }, ctl.signal);
    expect(report.aborted).toBe(true);
    expect(report.complete).toBe(false);
  });
});

describe('SIM-02: shared idempotent run settlement and marker preservation', () => {
  it('commits rewards once across crash recovery and results views and clears the run marker', () => {
    const store = new Map<string, string>();
    const ss = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    vi.stubGlobal('sessionStorage', ss);

    markRunStart({ zone: 'yeonmu', classId: 'warrior', difficulty: 'normal', startedAt: Date.now(), coop: false });
    expect(store.size).toBe(1);

    const settleSpy = vi.fn((): SettleOutcome => ({ summary: {} as SettleOutcome['summary'], submit: Promise.resolve({ kind: 'queued' }) }));
    const flushSpy = vi.fn(async () => {});
    const fakeMeta = { settle: settleSpy, flush: flushSpy } as unknown as MetaService;
    const res = makeResult();

    const first = settleRunOnce(fakeMeta, res, { empire: 'saehwa', sex: 'm', submit: false, flush: true });
    const second = settleRunOnce(fakeMeta, res, { empire: 'saehwa', sex: 'm', submit: true });

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(settleSpy).toHaveBeenCalledWith(res, { empire: 'saehwa', sex: 'm', submit: false });
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(takeInterruptedRun()).toBeNull();
  });

  it('preserves the interrupted-run marker when settlement throws', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    markRunStart({ zone: 'yeonmu', classId: 'warrior', difficulty: 'normal', startedAt: Date.now(), coop: false });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fakeMeta = {
      settle: () => {
        throw new Error('storage full');
      },
    } as unknown as MetaService;

    const outcome = settleRunOnce(fakeMeta, makeResult(), { empire: 'saehwa', sex: 'm', submit: false });
    expect(outcome).toBeNull();
    const marker = takeInterruptedRun();
    expect(marker).not.toBeNull();
    expect(marker?.zone).toBe('yeonmu');
    expect(errSpy).toHaveBeenCalled();
  });

  it('classifies abandoned/crashed runs with surviving heroes as unfinished', () => {
    expect(isFinishedRun(makeResult({ victory: false, players: [{ index: 0, level: 8, kills: 120, yeop: 150, alive: true }] }))).toBe(false);
    expect(isFinishedRun(makeResult({ victory: true }))).toBe(true);
    expect(isFinishedRun(makeResult({ victory: false, players: [{ index: 0, level: 8, kills: 120, yeop: 150, alive: false }] }))).toBe(true);
  });
});

describe('UI-01: GameStore activeRun separation from menu selection', () => {
  it('exposes activeRun via runSelection without overwriting solo selection', () => {
    const store = new GameStore();
    store.select({ zone: 'yeonmu', difficulty: 'normal' });
    expect(store.runSelection.value.zone).toBe('yeonmu');

    store.setActiveRun({
      ...store.selection.value,
      zone: 'sohan',
      difficulty: 'hard',
    });
    expect(store.selection.value.zone).toBe('yeonmu');
    expect(store.selection.value.difficulty).toBe('normal');
    expect(store.runSelection.value.zone).toBe('sohan');
    expect(store.runSelection.value.difficulty).toBe('hard');

    store.setActiveRun(null);
    expect(store.runSelection.value.zone).toBe('yeonmu');
    expect(store.runSelection.value.difficulty).toBe('normal');
  });
});
