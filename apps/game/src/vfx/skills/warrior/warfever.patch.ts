
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).

// its added light (peak 0.82-1.10x); the old hand spec was an orange flame at 0.28-0.31x.

// the 2 s streaks were gold where g3 is blue-green. The two big ground rings (jeongwi_2#6 bloomline, jeongwi_3#7 thick soft ring, half 2 / 2.2 x k = the awakening
// scale) are cut to 0.42 x (a ~2 m ring round the feet), the pink body scatter (jeongwi#0 / #1) to 0.8 x (a ~1.5 m sphere at chest height), and the rising streaks
// (jeongwi#2, jeongwi_2#7) turn the g3 blue-green (#40c0a0, hue only: the generated luma is kept). The window of the skill is now `sk.warfever.loop` (moments.ts),
// the roar ring is `sk.warfever.nova` (the shared filled cream disc is gone).
import { READABLE, retint, sizeBy, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/warfever.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'skill-logic: READABLE; ground rings x0.42, pink body x0.8, streaks blue-green (g3); window = sk.warfever.loop',
  specs: {
    'sk.warfever': {
      set: READABLE,
      el: {
        'jeongwi#0': sizeBy({ k: 0.8 }),
        'jeongwi#1': sizeBy({ k: 0.8 }),
        'jeongwi_2#6': sizeBy({ k: 0.42 }),
        'jeongwi_3#7': sizeBy({ k: 0.42 }),
        'jeongwi#2': retint(0x40c0a0),
        'jeongwi_2#7': retint(0x40c0a0),
      },
    },
  },
};
