
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/blaze_familiars.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.blaze_familiars': {
      set: READABLE,
      el: {
        'muyeong_make#2': shape({ size: 1.4, tint: 0.6 }),
        'muyeong_make#7': shape({ size: 1.4, tint: 0.6 }),
        'muyeong_make#8': shape({ size: 1.4, tint: 0.6 }),
        'muyeong_make#5': shape({ size: 1.2 }),
        'muyeong_make#6': shape({ size: 1.4 }),
      },
    },
    'sk.blaze_familiars.aura': {
      set: READABLE,
      el: {
        'muyeong_loop#0': shape({ size: 1.6 }),
        'muyeong_loop#1': shape({ size: 1.6 }),
        'muyeong_loop#2': shape({ size: 1.6 }),
        'muyeong_loop#3': shape({ size: 1.6 }),
      },
    },
  },
};
