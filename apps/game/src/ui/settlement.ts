// Run settlement for the UI: delegates to the shared idempotent settlement service in app/settlement.ts so crash
// recovery, normal quit, run-end modal, and the results screen all share one exactly-once commit cache.
import { clearSettlements, runKey, settleRunOnce, type Settlement } from '../app/settlement';
import type { RunResult } from '../sim/run';
import { deps } from './env';
import { runTone } from './modals/runTone';

export { clearSettlements, runKey, type Settlement };

/**
 * Settles `result` on the first call and returns the cached outcome afterwards.
 * Returns null (and logs) when settlement throws, so the screens can still show the raw run stats.
 */
export function settleOnce(result: RunResult): Settlement | null {
  const { meta, store } = deps();
  const sel = store.runSelection.value;
  // an abandoned run (pause > Abandon, the co-op host left: runTone 'ended') is banked locally like any other, but it is not a finished run:
  // it is neither registered online nor ranked on the public board (the board is for finished runs; QA EXPLORER-2)
  return settleRunOnce(meta, result, { empire: sel.empire, sex: sel.sex, submit: runTone(result) !== 'ended' });
}
