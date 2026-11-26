

// Everything is keyed by the generated element keys (a stale key fails tsc and skillFamilies.test.ts); colours are only ever edited relative to the generated value.
import { READABLE, sizeBy, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/noxious_pall.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.noxious_pall': {
      set: READABLE,
      el: {
        'beam_blow#0': sizeBy({ k: 0.25 }),
        'beam_3_blow#1': sizeBy({ k: 0.25 }),
        'beam_blow#3': sizeBy({ k: 0.65 }),
      },
    },
    'sk.noxious_pall.cast': { set: READABLE },
  },
};
