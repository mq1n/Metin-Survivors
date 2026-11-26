
// RAW light x1.0 / 1.1 (P) and x1.4 / 1.7 (g0): the impact crackle and flash (noejeon_blow#0 / #4 / #2) dimmed at g0; in game the P charge sphere at the hand was 7.2 % white pixels at 0.3 s (hand 10.6 %), so p2 dims the charge wisps / rays / ring at P. The hollow-ring charge core and the pinker burst are sprite / colour items of the converter (C10 / C7), not patched.
// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/arcing_bolt.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'RAW light x1.0 / 1.1 (P) and x1.4 / 1.7 (g0): the impact crackle and flash (noejeon_blow#0 / #4 / #2) dimmed at g0; in game the P charge sphere at the',
  specs: {
    'sk.arcing_bolt': {
      set: READABLE,
      el: {
        // leftovers L6: the rank-7 impact flash is still 5.2 % white at 0.3 s (cloud on the hit dummy): P light 0.95 -> 0.6 (the s4-flip R4 patch, 5.21 -> 3.66 %)
        'noejeon_blow#0': dimTo(0.7, 0.6),
        'noejeon_blow#4': dimTo(0.7, 0.6),
        'noejeon_blow#2': dimTo(0.7, 0.6),
      },
    },
    'sk.arcing_bolt.cast': {
      set: READABLE,
      el: {
        'noejeon_3_making#2': dimTo(1, 0.4),
        'noejeon_making#5': dimTo(1, 0.4),
        'noejeon_making#4': dimTo(1, 0.5),
        'noejeon_making#1': dimTo(1, 0.5),
      },
    },
  },
};
