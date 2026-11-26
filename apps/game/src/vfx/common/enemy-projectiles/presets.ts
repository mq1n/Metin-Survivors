// Enemy projectiles + muzzle flashes: legacy presets of this target, one file per legacy source (C0 split).
import type { PresetDef } from '../../presets/types';
import { presets as fromFeedback } from './presets_feedback';
import { presets as fromCast } from './presets_cast';

export const presets: PresetDef[] = [...fromFeedback, ...fromCast];
