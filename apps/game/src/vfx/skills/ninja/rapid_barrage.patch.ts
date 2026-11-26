

// Everything is keyed by the generated element keys (a stale key fails tsc and skillFamilies.test.ts); colours are only ever edited relative to the generated value.
import { READABLE, sizeBy, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/rapid_barrage.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.rapid_barrage': {
      set: READABLE,
      el: {
        'blow_1_low_center#0': sizeBy({ k: 0.4 }),
        'blow_1_low_center#1': sizeBy({ k: 0.4 }),
        'yeonsa_3_blow#4': sizeBy({ k: 0.4 }),
        'blow_1_low_center#2': tintMul(0.75),
        'blow_1_low_center#3': tintMul(0.75),
      },
    },
    'sk.rapid_barrage.cast': {
      set: READABLE,
      // in game the charge floor discs (milk-glow + strands) were 5.3 % white pixels at 0.9 s (yeonmu stone): 0.7x light
      el: {
        'gwangyeoksul_energy#1': tintMul(0.45),
        'gwangyeoksul_energy#2': tintMul(0.55),
        'gwangyeoksul_arrowenergy#0': tintMul(0.7),
      },
    },
  },
};
