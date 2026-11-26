// Player-side feedback: hit, evade, shield, aura ring, dash, summons: legacy presets of this target, one file per legacy source (C0 split).
import type { PresetDef } from '../../presets/types';
import { presets as fromFeedback } from './presets_feedback';
import { presets as fromCast } from './presets_cast';
import { presets as fromMelee } from './presets_melee';

export const presets: PresetDef[] = [...fromFeedback, ...fromCast, ...fromMelee];
