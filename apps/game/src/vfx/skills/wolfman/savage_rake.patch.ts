



// (shape = size x k / brightness x k, P band only); no absolute colour. g0 stays as generated (RAW 0.7-1.1x).

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/savage_rake.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 wolfman: READABLE + the P finisher (daejingak) rings / haze, the split_slash flashes (the in-game white source, found by bisection), crescent rings and the spin swirls cut (size3 / brightness, P band only); in game 35 % -> 5.1 % at +1.5 s',
  specs: {
    'sk.savage_rake': {
      set: READABLE,
      el: {
        
        'skill_wildattack_01_1#0': shape({ size3: 0.35, tint: 0.45, only: ['g3'] }),
        'skill_wildattack_01_1#0@2': shape({ size3: 0.35, tint: 0.45, only: ['g3'] }),
        'skill_wildattack_02#0': shape({ size3: 0.35, tint: 0.45, only: ['g3'] }),
        'skill_wildattack_02#0~g3': shape({ size3: 0.35, tint: 0.45, only: ['g3'] }),
        'skill_wildattack_03#0@2': shape({ size3: 0.35, tint: 0.45, only: ['g3'] }),
        // the 12 m donut + halo flashes of the first and last slash
        // (bisection in game: dropping the split_slash group took the 1.5 s white-out from 7.6 % to 0.4 %, the daejingak and crescent groups did not move it)
        'split_slash1#1': shape({ size3: 0.35, tint: 0.25, only: ['g3'] }),
        'split_slash1#0': shape({ tint: 0.5, only: ['g3'] }),
        'split_slash3#2': shape({ size3: 0.35, tint: 0.2, only: ['g3'] }),
        'split_slash3#0': shape({ size3: 0.4, tint: 0.2, only: ['g3'] }),
        'split_slash3#1': shape({ size3: 0.5, tint: 0.2, only: ['g3'] }),
        'split_slash5#0': shape({ size3: 0.6, tint: 0.2, only: ['g3'] }),
        'split_slash5#1': shape({ size3: 0.4, tint: 0.2, only: ['g3'] }),
        // the spin swirls (t0 0.94 s)
        'palbang_spin#0': shape({ tint: 0.5, only: ['g3'] }),
        'palbang_spin#1': shape({ tint: 0.5, only: ['g3'] }),
        'palbang_3_spin#2': shape({ tint: 0.5, only: ['g3'] }),
        'palbang_3_spin#3': shape({ tint: 0.5, only: ['g3'] }),
        'palbang_4_spin#4': shape({ tint: 0.5, only: ['g3'] }),
        'palbang_4_spin#5': shape({ tint: 0.5, only: ['g3'] }),
        
        'daejingak_4#0': shape({ size3: 0.3, tint: 0.4, only: ['g3'] }),
        'daejingak#2': shape({ size3: 0.3, tint: 0.4, only: ['g3'] }),
        'daejingak#3': shape({ size3: 0.3, tint: 0.4, only: ['g3'] }),
        'daejingak_3#4': shape({ size3: 0.3, tint: 0.4, only: ['g3'] }),
        'daejingak_3#5': shape({ size3: 0.3, tint: 0.4, only: ['g3'] }),
        'daejingak_4#6': shape({ size3: 0.35, tint: 0.4, only: ['g3'] }),
      },
    },
  },
};
