
// S4 ninja wave (2026-10-27): READABLE; the hazy impact ring (half 10) is 0.7x, the rank 0-4 needle copies 0.4x
// Everything is keyed by the generated element keys (a stale key fails tsc and skillFamilies.test.ts); colours are only ever edited relative to the generated value.
import { READABLE, sizeBy, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/serpent_shafts.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'READABLE; the hazy impact ring (half 10) is 0.7x, the rank 0-4 needle copies 0.4x',
  specs: {
    'sk.serpent_shafts': {
      set: READABLE,
      el: {
        'beam_blow#3': sizeBy({ k: 0.7 }),
        
        'beam_blow#1': sizeBy({ k: 0.4 }),
        'beam_2_blow#1': sizeBy({ k: 0.4 }),
      },
    },
    'sk.serpent_shafts.cast': { set: READABLE },
  },
};
