// Ambient zone particles, foot dust, enemy charge / leap dust: legacy presets of this target, one file per legacy source (C0 split).
import type { PresetDef } from '../../presets/types';
import { presets as fromFeedback } from './presets_feedback';
import { presets as fromWarn } from './presets_warn';

export const presets: PresetDef[] = [...fromFeedback, ...fromWarn];
