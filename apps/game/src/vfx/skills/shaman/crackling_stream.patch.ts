
// RAW light x1.5 / 1.6 (P) and x1.2 / 1.3 (g0): the impact flash and fans (pokroe_c#3 / #4 / #5 / #2, pokroe_b#0) dimmed; the stretch-fan streaks along the flight (C12-DIR) are left as generated.
// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/crackling_stream.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'RAW light x1.5 / 1.6 (P) and x1.2 / 1.3 (g0): the impact flash and fans (pokroe_c#3 / #4 / #5 / #2, pokroe_b#0) dimmed; the stretch-fan streaks along ',
  specs: {
    'sk.crackling_stream': {
      set: READABLE,
      el: {
        'pokroe_c#3': dimTo(0.8, 0.65),
        'pokroe_c#4': dimTo(0.8, 0.65),
        'pokroe_c#5': dimTo(0.8, 0.65),
        'pokroe_c#2': dimTo(0.8, 0.65),
        'pokroe_b#0': dimTo(0.8, 0.65),
      },
    },
    'sk.crackling_stream.cast': { set: READABLE },
  },
};
