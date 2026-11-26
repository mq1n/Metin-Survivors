

// Everything is keyed by the generated element keys (a stale key fails tsc and skillFamilies.test.ts); colours are only ever edited relative to the generated value.
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/spiral_of_knives.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.spiral_of_knives': {
      set: READABLE,
      
      el: {
        'charyunsal#0': tintMul(1.3),
        'charyunsal_2#5': tintMul(1.3),
        'charyunsal_3#6': tintMul(1.3),
      },
    },
    'sk.spiral_of_knives.cast': { set: READABLE },
  },
};
