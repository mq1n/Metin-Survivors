
// S4 yacha wave (one round): READABLE on every spec + the minimal, RELATIVE size / brightness edits below (no absolute colour, no gen edit).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/tide_of_the_slain.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.tide_of_the_slain': {
      set: READABLE,
      el: {
        'akgi_dark_1_fear#0': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_3_fear#1': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_1_fear#1': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_2_fear#2': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_1_fear#2': shape({ size: 0.6, fade: 0.6 }),
        'akgi_dark_1_fear#3': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_3_fear#6': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_4_fear#7': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_4_throw#0': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_4_throw#1': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_4_throw#2': shape({ size: 0.6, fade: 0.6 }),
        'akgi_dark_4_throw#3': shape({ size: 0.6, fade: 0.6 }),
        'akgi_dark_4_throw#4': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_1_throw#tail0': shape({ tint: 0.5 }),
        'akgi_dark_2_throw#tail1': shape({ tint: 0.5 }),
        'akgi_dark_3_throw#tail2': shape({ tint: 0.5 }),
        'akgi_dark_3_throw#tail3': shape({ tint: 0.5 }),
        'akgi_dark_4_throw#tail4': shape({ tint: 0.5 }),
        'akgi_dark_4_throw#tail5': shape({ tint: 0.5 }),
        'akgi_dark_4_throw#tail6': shape({ tint: 0.5 }),
        'akgi_dark_4_throw#tail7': shape({ tint: 0.5 }),
        'akgi_dark_1_throw#0': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_1_throw#1': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_1_throw#2': shape({ size: 0.6, fade: 0.6 }),
        'akgi_dark_1_throw#3': shape({ size: 0.6, fade: 0.6 }),
        'akgi_dark_1_throw#4': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_1_throw#tail1': shape({ tint: 0.5 }),
        'akgi_dark_3_throw#0@2': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_3_throw#1@2': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_3_throw#2@2': shape({ size: 0.6, fade: 0.6 }),
        'akgi_dark_3_throw#3@2': shape({ size: 0.6, fade: 0.6 }),
        'akgi_dark_3_throw#4@2': shape({ size: 0.6, tint: 0.5 }),
        'akgi_dark_3_throw#tail5': shape({ tint: 0.5 }),
        'yeonsa_4_blow#0': shape({ size: 0.6, tint: 0.5 }),
        'yeonsa_4_blow#1': shape({ size: 0.6, tint: 0.5 }),
        'yeonsa_4_blow#2': shape({ size: 0.6, tint: 0.5 }),
        'yeonsa_4_blow#3': shape({ size: 0.6, tint: 0.5 }),
        'yeonsa_4_blow#4': shape({ size: 0.6, tint: 0.5 }),
      },
    },
    'sk.tide_of_the_slain.cast': { set: READABLE },
  },
};
