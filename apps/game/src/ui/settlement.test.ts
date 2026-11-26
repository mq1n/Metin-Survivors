// Run settlement (QA EXPLORER-2): an abandoned run is banked locally but never submitted (no anonymous registration, no ranked row);
// finished runs (victory or a dead party) are still submitted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../sim/run';
import { setDeps } from './env';
import { clearSettlements, settleOnce } from './settlement';

const hero = (alive: boolean) => ({ index: 0, level: 3, kills: 12, yeop: 40, alive });
const run = (over: Partial<RunResult>): RunResult =>
  ({ seed: 7, zone: 'yeonmu', classId: 'warrior', doctrine: 'a', difficulty: 'normal', time: 1.5, kills: 0, victory: false, players: [hero(true)], ...over }) as unknown as RunResult;

describe('settleOnce submit gate', () => {
  const settle = vi.fn((_r: RunResult, _o: { submit?: boolean }) => ({ summary: {}, submit: Promise.resolve({ kind: 'skipped', reason: 'disabled' }) }));

  beforeEach(() => {
    settle.mockClear();
    clearSettlements();
    const sel = { value: { empire: 'saehwa', sex: 'm' } };
    setDeps({ meta: { settle }, store: { selection: sel, runSelection: sel } } as unknown as Parameters<typeof setDeps>[0]);
  });
  afterEach(() => {
    setDeps(null);
    clearSettlements();
  });

  it('an abandoned run (pause > Abandon: not won, a hero still alive) is settled with submit: false, also at 0 s / 0 kills', () => {
    settleOnce(run({ time: 0.4, kills: 0 }));
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]?.[1].submit).toBe(false);
  });

  it('a run abandoned late in a long session is not submitted either', () => {
    settleOnce(run({ time: 612, kills: 2400, players: [hero(true)] }));
    expect(settle.mock.calls[0]?.[1].submit).toBe(false);
  });

  it('a victory is submitted', () => {
    settleOnce(run({ victory: true, time: 900, kills: 5000 }));
    expect(settle.mock.calls[0]?.[1].submit).toBe(true);
  });

  it('a defeat (the whole party down) is submitted', () => {
    settleOnce(run({ time: 240, kills: 800, players: [hero(false)] }));
    expect(settle.mock.calls[0]?.[1].submit).toBe(true);
  });

  it('the empire and sex still travel with the settlement', () => {
    settleOnce(run({}));
    expect(settle.mock.calls[0]?.[1]).toMatchObject({ empire: 'saehwa', sex: 'm' });
  });
});
