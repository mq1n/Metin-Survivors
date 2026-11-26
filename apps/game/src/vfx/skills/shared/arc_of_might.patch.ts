

// HAND spec shows the dome and a constant bolt from 1.7 s. RAW is 1.6-2.2x the added light (the 6 m hazy ground ring is the bulk): READABLE + ring x0.6, bolts / fan x0.8.
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/arc_of_might.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 wolfman: READABLE + hazy ground ring (noegeomdorae#3) x0.6, bolts / fan x0.8',
  specs: {
    'sk.arc_of_might': {
      set: READABLE,
      el: {
        'noegeomdorae#3': tintMul(0.6),
        'noegeomdorae#0': tintMul(0.8),
        'noegeomdorae#2': tintMul(0.8),
        'noegeomdorae#5': tintMul(0.8),
      },
    },
  },
};
