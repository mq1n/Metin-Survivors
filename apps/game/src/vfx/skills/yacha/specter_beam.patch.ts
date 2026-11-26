
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/specter_beam.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.specter_beam': {
      set: READABLE,
      el: {
        'tusok_blow#1': shape({ size: 0.75, tint: 0.75 }),
        'tusok_blow#2': shape({ size: 0.75, tint: 0.75 }),
        'tusok_blow_4#4': shape({ size: 0.75, tint: 0.75 }),
        'tusok_blow#3': shape({ tint: 0.7 }),
        'tusok_throw#1': shape({ tint: 0.8 }),
      },
    },
    'sk.specter_beam.cast': {
      set: READABLE,
      el: {
        'tusok_making#1': shape({ hue: 0xb02030, tint: 0.6, only: ["g3"] }),
        'tusok_3_making#3': shape({ hue: 0xb02030, tint: 0.6, only: ["g3"] }),
        'tusok_making#2': shape({ tint: 0.7 }),
      },
    },
  },
};
