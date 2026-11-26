// Metin stones and bosses: metin.*, boss.* (owner: VfxMetin).
// Legacy barrel since the C0 ownership split: [metin.*] → vfx/common/metin, [boss.*] → vfx/common/boss. BOSS_PRESETS keeps the original ids and
// order for presets/index.ts, tests and tools.

import { BOSS } from '../common/boss';
import { METIN } from '../common/metin';
import { pickPresets } from '../common/registry';
import type { PresetDef } from './types';

export const BOSS_PRESETS: PresetDef[] = pickPresets(
  [
    'metin.fall',
    'metin.impact',
    'metin.aura',
    'metin.aura.awakened',
    'metin.awaken',
    'metin.shatter',
    'metin.pulse',
    'boss.spawn',
    'boss.spawn.final',
    'boss.phase',
    'boss.enrage',
    'boss.enrage.burst',
    'boss.death',
    'boss.death.final',
    'boss.slam',
    'boss.nova',
    'boss.volley',
    'boss.teleport.out',
    'boss.teleport.in',
    'boss.summon',
    'boss.charge.trail',
  ],
  METIN.presets, BOSS.presets,
);
