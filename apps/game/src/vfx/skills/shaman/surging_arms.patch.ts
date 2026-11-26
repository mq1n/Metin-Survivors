
// RAW light x2.0 / 2.8 (P) and x1.7 / 2.5 (g0): the burst ring jeungryeok#1 (84-88 % of the weight) dimmed.
// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/surging_arms.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'RAW light x2.0 / 2.8 (P) and x1.7 / 2.5 (g0): the burst ring jeungryeok#1 (84-88 % of the weight) dimmed.',
  specs: {
    'sk.surging_arms': {
      set: READABLE,
      el: {
        'jeungryeok#1': dimTo(0.55, 0.45),
        'jeungryeok#0': dimTo(1, 0.7),
      },
    },
  },
};
