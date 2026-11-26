
// RAW light x1.4 / 1.6 (P) and x2.0 / 2.1 (g0) in the strips (p1 dimmed the cast flash and the blow rings: x1.1-1.4); in game at rank 7 the 4 m lime smoke haze of the cast (chunwoon_1_making#0, life 1.0 s) made 17 % white pixels at 0.5 s (hand 3.6 %): p2 (haze f 0.12) was 27 % at 0.5 s (20-30 overlapping puffs saturate even when each is dim), p4 / p5 also thinned the haze emission (still 25-27 %: the cloud in the frame is the P-only green / cyan smoke lump chunwoon_4_blow#0, 20 puffs, half 1.5, which plays from 0.87 s of the effect and so is already up at the 0.5 s shot), p6 dims that element (f 0.08, emission x 0.3).
// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/stormglass_shell.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'RAW light x1.4 / 1.6 (P) and x2.0 / 2.1 (g0) in the strips (p1 dimmed the cast flash and the blow rings: x1.1-1.4); in game at rank 7 the 4 m lime smo',
  specs: {
    'sk.stormglass_shell': {
      set: READABLE,
      el: {
        'chunwoon_4_blow#0': dimTo(1, 0.08, 1, 0.3),
        'chunwoon_1_making#0': dimTo(0.4, 0.15, 0.5, 0.25),
        'chunwoon_1_making#1': dimTo(0.55, 0.3),
        'chunwoon_1_blow#2': dimTo(0.55, 0.7),
        'chunwoon_1_blow#4': dimTo(0.6, 0.8),
        'chunwoon_3_blow#2': dimTo(0.6, 0.65),
        'chunwoon_4_blow#9': dimTo(0.8, 0.7),
      },
    },
  },
};
