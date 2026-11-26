
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/pyrefall.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.pyrefall': {
      set: READABLE,
      el: {
        'akgi_1_blow#0': shape({ size: 0.8, tint: 0.85 }),
        'akgi_3_blow#1': shape({ size: 0.8 }),
        'akgi_1_blow#1': shape({ size: 0.85 }),
        'akgi_2_blow#2': shape({ size: 0.8 }),
        'akgi_1_blow#3': shape({ size: 0.8, tint: 0.85 }),
        'akgi_3_blow#6': shape({ size: 0.8 }),
        'akgi_4_blow#7': shape({ size: 0.8 }),
        'akgi_3_blow#7': shape({ size: 0.8, tint: 0.85 }),
        'akgi_4_blow#9': shape({ size: 0.8, tint: 0.85 }),
      },
    },
    'sk.pyrefall.cast': { set: READABLE },
  },
};
