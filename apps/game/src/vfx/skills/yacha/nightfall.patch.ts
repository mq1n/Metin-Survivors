
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/nightfall.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.nightfall': {
      set: READABLE,
      el: {
        'maryeong_blow#2': shape({ size: 0.5, tint: 0.5 }),
        'maryeong_blow#1': shape({ tint: 0.7 }),
        'maryeong_throw#1': shape({ tint: 0.7 }),
        'maryeong_throw#3': shape({ size: 0.8, tint: 0.55 }),
      },
    },
    'sk.nightfall.cast': { set: READABLE },
  },
};
