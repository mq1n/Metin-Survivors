// Enemy deaths and spawns: death.*, spawn.* (owner: VfxDeath).
// Every death shares one skeleton (hot pop flash + spiky burst + ground glow/ring + dust) and adds a race-flavoured body.
// Sizes: `c.scale` is the enemy scale (≈0.85–1.5 for normal enemies, 2.2–3.4 for bosses); lifetimes stay ≤ ~1 s for normal kills.
// Legacy barrel since the C0 ownership split: [death.*, spawn.*] → vfx/common/death-spawn. DEATH_PRESETS keeps the original ids and
// order for presets/index.ts, tests and tools.

import { DEATH_SPAWN } from '../common/death-spawn';
import { pickPresets } from '../common/registry';
import type { PresetDef } from './types';

export const DEATH_PRESETS: PresetDef[] = pickPresets(
  [
    'death.dust',
    'death.animal',
    'death.orc',
    'death.undead',
    'death.ice',
    'death.fire',
    'death.desert',
    'death.devil',
    'death.insect',
    'death.dragon',
    'death.human',
    'death.metin',
    'death.elite',
    'death.boss',
    'spawn.elite',
    'spawn.corrupt',
    'spawn.summon',
  ],
  DEATH_SPAWN.presets,
);
