

// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/wyrm_retinue.gen';
import { bandScale } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.wyrm_retinue': {
      set: READABLE,
      el: {
        '6gicheon_making#0': bandScale(2.5, 1.2),
        '6gicheon_making#1': bandScale(2.5, 1.2),
        '6gicheon_blow#1': bandScale(2.5, 1.2),
        '6gicheon_blow#2': bandScale(2.5, 1.2),
        '6gicheon_blow#3': bandScale(2.5, 1.2),
        '6gicheon_blow#4': bandScale(2.5, 1.2),
        '6gicheon_blow#5': bandScale(2.5, 1.2),
      },
    },
    'sk.wyrm_retinue.aura': { set: READABLE },
  },
};
