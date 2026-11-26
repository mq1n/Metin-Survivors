import type { PlayerState, SkillInstance } from '../stores';
import type { World } from '../world';
import type { FinalParams } from './params';

export interface Behavior {
  /**
   * Try to activate. Return true when the skill fired (cooldown starts), false when there was nothing to do
   * (no target in range etc.; the sim retries next tick without consuming the cooldown).
   */
  cast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean;
  /** per-tick maintenance, runs every tick whether or not the cooldown is ready (persistent auras, dash path damage) */
  update?(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): void;
  /** follow-up pulse of a multi-swing cast (scheduled); `n` = pulse index (1-based) */
  pulse?(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, dx: number, dz: number, n: number): void;
  /** true = never cast through the cooldown path (kept alive by `update`) */
  passive?: boolean;
}
