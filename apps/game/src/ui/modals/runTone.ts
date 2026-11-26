// Which banner the run-end report carries. Pure (no UI imports) so the rule is unit-tested in node.
import type { RunResult } from '../../sim/run';

export type Tone = 'victory' | 'defeat' | 'ended';

/**
 * Victory, defeat, or a run the player cut short ('ended': pause → "Abandon run", or the co-op host left). A defeat is
 * the whole party down — the sim only starts the defeat outro when `allDead()`, and `players[].alive` (also carried over
 * the co-op wire) is false for everybody then — so a run that was not won while a hero still stands was abandoned, at any
 * length. (The old rule "not won and shorter than 60 s" headed a 62 s abandon "DEFEAT — You fell …" and a real death at
 * 40 s "RUN ENDED".) A result without a party list keeps the old length rule.
 */
export function runTone(r: Pick<RunResult, 'victory' | 'time' | 'players'>): Tone {
  if (r.victory) return 'victory';
  if (r.players.length > 0) return r.players.some((p) => p.alive) ? 'ended' : 'defeat';
  return r.time < 60 ? 'ended' : 'defeat';
}
