// Telegraphs and ambient zone particles: telegraph.*, ambient.* (owner: VfxWarn).
// Legacy barrel since the C0 ownership split: [telegraph.*] → vfx/common/telegraphs, [ambient.*] → vfx/common/ambient. WARN_PRESETS keeps the original ids and
// order for presets/index.ts, tests and tools.

import { AMBIENT } from '../common/ambient';
import { pickPresets } from '../common/registry';
import { TELEGRAPHS } from '../common/telegraphs';
import type { PresetDef } from './types';

export const WARN_PRESETS: PresetDef[] = pickPresets(
  [
    'telegraph.circle',
    'telegraph.cone',
    'telegraph.lane',
    'telegraph.ring',
    'telegraph.meteor',
    'ambient.leaves',
    'ambient.dust',
    'ambient.snow',
    'ambient.embers',
    'ambient.ash',
    'ambient.sparks',
  ],
  TELEGRAPHS.presets, AMBIENT.presets,
);
