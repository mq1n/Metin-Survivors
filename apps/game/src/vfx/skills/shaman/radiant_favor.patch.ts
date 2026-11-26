
// RAW P light x1.9 / 2.4: the burst floor ring 3hosin_4#1 (5 m, 89 % of the P weight) is dimmed and smaller; the M1 twin 3hosin#1 likewise. g0 is x0.7-1.0 and untouched.
// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/radiant_favor.gen';
import { dimTo } from './patchTools';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'RAW P light x1.9 / 2.4: the burst floor ring 3hosin_4#1 (5 m, 89 % of the P weight) is dimmed and smaller; the M1 twin 3hosin#1 likewise. g0 is x0.7-1',
  specs: {
    'sk.radiant_favor': {
      set: READABLE,
      // fix round 2 (vfx critic X7): the AFFECT loop folded into the cast (every `3hosin_loop` element, all grades) is a TRACKED marker now (`sk.radiant_favor.loop`, shaman/moments.ts):
      // the cast family drew it a second time for its whole spec life, and after the ward had broken (the gold / blue disc under the hero contradicted the break)
      el: {
        '3hosin_loop#0': null,
        '3hosin_loop#0~g3': null,
        '3hosin_loop#0~g1': null,
        '3hosin_loop#1': null,
        '3hosin_loop#2': null,
        '3hosin_loop#3': null,
        '3hosin_4#1': dimTo(1, 0.4),
        '3hosin#1': dimTo(1, 0.5),
      },
    },
  },
};
