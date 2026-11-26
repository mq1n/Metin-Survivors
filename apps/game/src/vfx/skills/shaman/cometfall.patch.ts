

// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/cometfall.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.cometfall': {
      set: READABLE,
      el: {
        'meteo_1_drop#7': dimTo(0.65, 0.18),
        'meteo_4_drop#4': dimTo(0.65, 0.18),
        'meteo_1_drop#3': dimTo(0.65, 0.18),
        'meteo_1_drop#1': dimTo(0.65, 0.18),
        'meteo_1_drop#2': dimTo(0.65, 0.18),
        'meteo_4_drop#8': dimTo(0.65, 0.18),
        'meteo_1_drop#5': dimTo(0.7, 0.3),
        'meteo_4_drop#9': dimTo(0.7, 0.3),
        'meteo_2_drop#1': dimTo(0.7, 0.3),
      },
    },
    'sk.cometfall.cast': {
      set: READABLE,
      el: {
        'meteo_2_making#0': dimTo(0.8, 0.4),
        'meteo_4_making#7': dimTo(0.8, 0.4),
        'meteo_2_making#1': dimTo(0.8, 0.4),
        'meteo_2_making#4': dimTo(0.8, 0.4),
      },
    },
  },
};
