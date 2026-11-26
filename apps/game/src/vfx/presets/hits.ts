// Hit sparks by element, crit burst, damage-over-time ticks, player hit feedback.
// Legacy barrel since the C0 ownership split: [hit.*] → vfx/common/hits, [hit.*] → vfx/common/status. HIT_PRESETS keeps the original ids and
// order for presets/index.ts, tests and tools.

import { HITS } from '../common/hits';
import { pickPresets } from '../common/registry';
import { STATUS } from '../common/status';
import type { PresetDef } from './types';

export const HIT_PRESETS: PresetDef[] = pickPresets(
  [
    'hit.physical',
    'hit.fire',
    'hit.ice',
    'hit.lightning',
    'hit.dark',
    'hit.poison',
    'hit.holy',
    'hit.wind',
    'hit.crit',
    'hit.dot.burn',
    'hit.dot.poison',
    'hit.dot.bleed',
  ],
  HITS.presets, STATUS.presets,
);
