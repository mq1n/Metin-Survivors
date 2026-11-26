
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/blazing_column.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.blazing_column': {
      set: READABLE,
      el: {
        'hwayeom_2#8': shape({ size: 0.7, tint: 0.55 }),
        'hwayeom#4': shape({ tint: 0.7 }),
        'hwayeom_2#9': shape({ tint: 0.75 }),
        'hwayeom_4#15': shape({ tint: 0.8 }),
        'hwayeom#3': shape({ tint: 0.60 }),
        'hwayeom#2': shape({ tint: 0.7 }),
        'hwayeom#5': shape({ tint: 0.6 }),
        'hwayeom_3#10': shape({ tint: 0.6 }),
        'hwayeom_4#3': shape({ tint: 0.6 }),
        'hwayeom_4#14': shape({ tint: 0.6 }),
        'hwayeom#0': shape({ tint: 0.75 }),
        'hwayeom#1': shape({ tint: 0.75 }),
        'hwayeom_2#3': shape({ tint: 0.75 }),
        'hwayeom_2#4': shape({ tint: 0.75 }),
        'hwayeom_4#11': shape({ tint: 0.75 }),
        'hwayeom_4#12': shape({ tint: 0.75 }),
      },
    },
  },
};
