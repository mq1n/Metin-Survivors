
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/scorch_palm.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.scorch_palm': {
      set: READABLE,
      el: {
        'swaeryeong#0': shape({ tint: 0.6 }),
        'swaeryeong#1': shape({ size: 0.85, tint: 0.6 }),
        'swaeryeong#2': shape({ tint: 0.6 }),
        'swaeryeong#3': shape({ size: 0.85, tint: 0.6 }),
        'swaeryeong#4': shape({ tint: 0.6 }),
        'swaeryeong_3#5': shape({ size: 0.8, tint: 0.6 }),
        'swaeryeong_3#6': shape({ tint: 0.6 }),
        'swaeryeong_3#7': shape({ size: 0.85, tint: 0.6 }),
      },
    },
  },
};
