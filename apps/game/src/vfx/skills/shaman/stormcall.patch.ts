

// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/stormcall.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.stormcall': {
      set: READABLE,
      el: {
        'byeorak#3': dimTo(0.35, 0.06),
        'byeorak#0': dimTo(0.5, 0.15),
        'byeorak_3#1': dimTo(0.5, 0.15),
        'byeorak#1': dimTo(0.5, 0.15),
        'byeorak#2': dimTo(0.5, 0.15),
        'byeorak_3#4': dimTo(0.5, 0.15),
        'byeorak#4': dimTo(0.5, 0.15),
        'byeorak#5': dimTo(0.5, 0.15),
        'byeorak#6': dimTo(0.5, 0.15),
        'byeorak#7': dimTo(0.5, 0.15),
        'byeorak#8': dimTo(0.5, 0.15),
        'byeorak#9': dimTo(0.5, 0.15),
        'byeorak#10': dimTo(0.5, 0.15),
        'byeorak_2#9': dimTo(0.5, 0.15),
        'byeorak_4#12': dimTo(0.5, 0.15),
        'byeorak_2#10': dimTo(0.5, 0.15),
      },
    },
  },
};
