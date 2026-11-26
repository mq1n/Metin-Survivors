

// Everything is keyed by the generated element keys (a stale key fails tsc and skillFamilies.test.ts); colours are only ever edited relative to the generated value.
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import { shrinkDim } from './patchTools';
import type { GEN_KEYS } from '../_gen/arrow_corona.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.arrow_corona': {
      set: READABLE,
      el: {
        // in game the P-only thick smudge streaks (half 1.43 m) and the g2 streak tails of the body drew a 7 m star polygon of pale-yellow spokes around the hero:
        // 18 % white pixels at the hit (yeonmu stone, 2nd round: the impact fans below were not the source); 0.55x size / 0.6x light and 0.7x light
        'pungraepo_4#12': shrinkDim(0.55, 0.6),
        'pungraepo_4#13': shrinkDim(0.55, 0.6),
        'pungraepo_2#5': tintMul(0.7),
        'pungraepo_2#6': tintMul(0.7),
        'pungraepo_2#7': tintMul(0.7),
        'pungraepo_2#8': tintMul(0.7),
        // in game the impact fans (half 4.3 m, stretchU) drew a 6 m star polygon of white streaks: 16.5 % white pixels at the hit; 0.65x size, 0.75x light
        'yeonsa_blow#0': shrinkDim(0.65, 0.75),
        'yeonsa_blow#1': shrinkDim(0.65, 0.75),
        'yeonsa_3_blow#4': shrinkDim(0.65, 0.75),
      },
    },
    'sk.arrow_corona.cast': { set: READABLE },
  },
};
