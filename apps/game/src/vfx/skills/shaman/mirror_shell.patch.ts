

// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/mirror_shell.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.mirror_shell': {
      set: READABLE,
      // fix round 2 (vfx critic X7): the AFFECT loop folded into the cast (every `boho_loop` element, all grades) is a TRACKED marker now (`sk.mirror_shell.loop`, shaman/moments.ts):
      // the cast family drew it a second time for its whole spec life, and after the ward had broken (the gold / blue disc under the hero contradicted the break)
      el: {
        'boho_loop#0': null,
        'boho_loop#0~g3': null,
        'boho_loop#0~g1': null,
        'boho_loop#1': null,
        'boho_loop#2': null,
        'boho_loop#3': null,
        'boho_4#1': dimTo(1, 0.4),
        'boho#1': dimTo(1, 0.5),
      },
    },
  },
};
