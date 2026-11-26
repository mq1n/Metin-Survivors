
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).


// does not have. The P wheel ribbons are a touch thin and dark, so they get x1.25 of the GENERATED colour (relative, never an absolute display
// colour); READABLE keeps the stacked wheels from blowing out the bright yeonmu floor. Nothing else is touched.
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/bladewheel.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 warrior: READABLE + P wheel ribbons x1.25 of the generated colour',
  specs: {
    'sk.bladewheel': {
      set: READABLE,
      el: {
        'palbang_3_spin#2': tintMul(1.25),
        'palbang_3_spin#3': tintMul(1.25),
        'palbang_4_spin#4': tintMul(1.25),
        'palbang_4_spin#5': tintMul(1.25),
      },
    },
    'sk.bladewheel.cast': { set: READABLE },
  },
};
