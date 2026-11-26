
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).

// at 1.39-1.46x its added light (peak 1.11-1.24x); the dark blue dome slab at 1.1-1.2 runs ~1.3x too far. So the two domes get x0.85 size and x0.8 of the
// GENERATED colour, and the 0.8 s starbursts of the cast part x0.8 (relative recolour only). In game (rank 7, yeonmu) the first version still put 7.6 % of the central crop
// above luma 0.85 at +0.6 s (gate 5 %), so the P band (only) is lowered further: white beam needles x0.7, domes x0.64 (0.8 x 0.8); final worst of the cast times

import { READABLE, sizeBy, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/soul_crash.gen';
import { both } from './patchKit';

// (the edits of `both` all read the GENERATED element, so two tints of the same band do not multiply: the P band gets its own 0.8 x 0.8 here)
const DOME = both(sizeBy({ k: 0.85 }), tintMul(0.8, { only: ['base', 'g1', 'g2'] }), tintMul(0.64, { only: ['g3'] }));
// in-game gate (v2): 7.6 % of the central crop above luma 0.85 at +0.6 s (gate 5 %), so the white beam needles and the P dome are lowered at P only
const P_NEEDLE = tintMul(0.7, { only: ['g3'] });

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 warrior: READABLE + domes x0.85 size / x0.8 light, cast starbursts x0.8 light',
  specs: {
    'sk.soul_crash': {
      set: READABLE,
      el: {
        'gigongcham_swing#0': P_NEEDLE,
        'gigongcham_swing#1': DOME,
        'gigongcham_2_swing#2': P_NEEDLE,
        'gigongcham_3_swing#3': DOME,
      },
    },
    'sk.soul_crash.cast': {
      set: READABLE,
      el: {
        'gigongcham_making#2': tintMul(0.8),
        'gigongcham_4_making#3': tintMul(0.8),
      },
    },
  },
};
