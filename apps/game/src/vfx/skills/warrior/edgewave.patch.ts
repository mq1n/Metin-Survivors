
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).


// So only the impact bursts are clamped: smaller and dimmer, relative to the generated colour (patch v1 also dimmed the white-hot core #4: light fell to

import { READABLE, sizeBy, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/edgewave.gen';
import { both } from './patchKit';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 warrior: READABLE + impact burst clamped (size x0.75-0.85, light x0.8-0.85 of the generated colour, core only smaller)',
  specs: {
    'sk.edgewave': {
      set: READABLE,
      el: {
        'geompung_blow#0': both(sizeBy({ k: 0.75 }), tintMul(0.8)), // the 10 m ray ring
        'geompung_blow#1': tintMul(0.85), // star cross halo
        'geompung_blow#3': tintMul(0.8), // lumpy puffs
        'geompung_blow#4': sizeBy({ k: 0.85 }), 
      },
    },
    'sk.edgewave.cast': { set: READABLE },
  },
};
