
// horse dust. Owner: FxCommon. All one-shots (`selfBuff` contract: event spawn on the ground at the character's feet,

// Legacy barrel since the C0 ownership split: the specs live in vfx/common/levelup-heal, vfx/common/ambient. FEEDBACK_SPECS keeps the original ids and order
// for skills/common.ts (COMMON_SPECS), tests and tools.
import { AMBIENT } from '../../common/ambient';
import { LEVELUP_HEAL } from '../../common/levelup-heal';
import { pickSpecs } from '../../common/registry';
import type { FxSpec } from '../../spec/types';

export const FEEDBACK_SPECS: FxSpec[] = pickSpecs(
  [
    'sk.gen.level_up',
    'sk.gen.skillup',
    'sk.gen.potion_red',
    'sk.gen.potion_blue',
    'sk.gen.potion_green',
    'sk.gen.potion_purple',
    'sk.gen.potion_auto_red',
    'sk.gen.potion_auto_blue',
    'sk.gen.dust',
    'sk.gen.running_dust',
  ],
  LEVELUP_HEAL.specs, AMBIENT.specs,
);
