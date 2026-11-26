
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/unbinding_sigil.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.unbinding_sigil': {
      set: READABLE,
      el: {
        'pabeopsul_blow#2': shape({ size: 0.6, tint: 0.7 }),
        'pabeopsul_blow#3': shape({ size: 0.6, tint: 0.7 }),
        'pabeopsul_4_blow#6': shape({ size: 0.6, tint: 0.7 }),
      },
    },
    'sk.unbinding_sigil.cast': { set: READABLE },
    'sk.unbinding_sigil.aura': { set: READABLE },
  },
};
