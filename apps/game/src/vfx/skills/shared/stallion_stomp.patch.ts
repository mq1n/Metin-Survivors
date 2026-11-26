

// HAND spec is a 5x brighter flat lavender disc. RAW is 1.25-1.5x the added light: READABLE + the heavy ground bodies (ray fan, tufts crown, dome) x0.8.
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/stallion_stomp.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 wolfman: READABLE + ray fan / tufts crown / dome x0.8 brightness',
  specs: {
    'sk.stallion_stomp': {
      set: READABLE,
      el: {
        'phantom_gallop#6': tintMul(0.8),
        'phantom_gallop#7': tintMul(0.8),
        'phantom_gallop#5': tintMul(0.8),
      },
    },
  },
};
