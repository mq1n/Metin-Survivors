
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).


// disc #4, ray fan #5, upright dome #6, the lumpy clouds loop#4 / #1) are lowered x0.75 of the GENERATED colour, the two big ones also x0.85 in size.
// The pillar, bolts and blade sparks are untouched.
import { READABLE, tintMul, sizeBy, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/blade_orbit.gen';
import { both } from './patchKit';

const DIM = tintMul(0.75);
const BIG = both(sizeBy({ k: 0.85 }), tintMul(0.75));

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 warrior: READABLE + discharge burst layers x0.75 light (big ones x0.85 size)',
  specs: {
    'sk.blade_orbit': {
      set: READABLE,
      el: {
        'noegeomdorae#4': BIG,
        'noegeomdorae#6': BIG,
        'noegeomdorae#5': DIM,
        'noegeomdorae#1': DIM,
        'noegeomdorae_loop#4': DIM,
      },
    },
  },
};
