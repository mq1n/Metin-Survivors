
// status loops. Owner: FxCommon slice "FxCommonCombat". Authoring guide: ../../spec/README.md.
//

// y). Callers spawn on the ground (SpawnOpts.y undefined) for a normal-sized enemy; for bigger / smaller bodies pass
// `y = ground + (s - 1) × lift` with s = enemy radius / 0.45 (statusFeed.ts does this for the loops).
// Legacy barrel since the C0 ownership split: the specs live in vfx/common/hits, vfx/common/death-spawn, vfx/common/status. COMBAT_SPECS keeps the original ids and order
// for skills/common.ts (COMMON_SPECS), tests and tools.
import { DEATH_SPAWN } from '../../common/death-spawn';
import { HITS } from '../../common/hits';
import { pickSpecs } from '../../common/registry';
import { STATUS } from '../../common/status';
import type { FxSpec } from '../../spec/types';

export const COMBAT_SPECS: FxSpec[] = pickSpecs(
  [
    'sk.gen.hit',
    'sk.gen.critical',
    'sk.gen.penetrate',
    'sk.gen.monster_appear',
    'sk.gen.monster_die',
    'sk.gen.stun',
    'sk.gen.stun_loop',
    'sk.gen.slow_loop',
    'sk.gen.poison_loop',
    'sk.gen.fire_loop',
  ],
  HITS.specs, DEATH_SPAWN.specs, STATUS.specs,
);
