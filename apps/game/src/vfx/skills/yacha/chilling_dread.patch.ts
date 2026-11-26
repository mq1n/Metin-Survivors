
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/chilling_dread.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.chilling_dread': {
      set: READABLE,
      el: {
        'fear_making#0': shape({ size: 0.7 }),
        'fear_making#1': shape({ size: 0.7 }),
        'fear_making#2': shape({ size: 0.7 }),
        'fear_3_making#6': shape({ size: 0.7, tint: 0.7 }),
        'fear_3_making#7': shape({ size: 0.7, tint: 0.7 }),
        'fear_3_making#8': shape({ size: 0.7, tint: 0.7 }),
        'fear_4_making#10': shape({ size: 0.7, tint: 0.7 }),
        'fear_4_making#11': shape({ size: 0.7, fade: 0.7 }),
      },
    },
    'sk.chilling_dread.aura': { set: READABLE },
  },
};
