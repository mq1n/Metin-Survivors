


// Measured by bisection (elements dropped in game, one cast per session: 0.68 % without blue_possession_02#4 + 04#0, 76 % without everything else): the whole-view
// sheet is the rank 5+ blue haze blue_possession_02#4 (dust_speckle_haze_a, 20 additive particles of 2.5 m on a 3 m ring). It is cut hard (size / brightness,
// relative); the 22.5 m burst star and the ground rings only get a mild P cut (a 5x cut of them changed the white-out by 0.7 points).
import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/moonmane_spirit.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 wolfman: READABLE + the blue haze 02#4 to 0.7x size / 0.3 brightness (the in-game white sheet), P burst star / rings x0.8',
  specs: {
    'sk.moonmane_spirit': {
      set: READABLE,
      el: {
        'blue_possession_02#4': shape({ size: 0.7, tint: 0.3 }),
        'blue_possession_01#1': shape({ size3: 0.8, tint: 0.8, only: ['g3'] }),
        'blue_possession_02#1': shape({ size3: 0.8, tint: 0.8, only: ['g3'] }),
        // s4-flip R4 (2026-10-27): the family alone drew 20-29 % white pixels at 0.34-0.46 s (rank 7, yeonmu); ablation: 0.00 % without these four additive ground rings /
        // bolt (01#2, 02#2, 02#3, 03#0), the stars and surfaces are not it. P light x0.4 (relative tintMul, hue kept), rings x0.7 P size.
        'blue_possession_01#2': shape({ size3: 0.7, tint: 0.4, only: ['g3'] }),
        'blue_possession_02#2': shape({ size3: 0.7, tint: 0.4, only: ['g3'] }),
        'blue_possession_02#3': shape({ size3: 0.7, tint: 0.4, only: ['g3'] }),
        'blue_possession_03#0': shape({ tint: 0.5, only: ['g3'] }),
      },
    },
  },
};
