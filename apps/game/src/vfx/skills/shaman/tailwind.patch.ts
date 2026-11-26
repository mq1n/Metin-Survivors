

// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/tailwind.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.tailwind': {
      set: READABLE,
      el: {
        '10kwaesok#1': dimTo(0.5, 0.4),
        '10kwaesok_loop#2': dimTo(0.7, 0.6),
        '10kwaesok_loop#1': dimTo(1, 0.6),
        '10kwaesok#2': dimTo(0.6, 0.6),
      },
    },
  },
};
