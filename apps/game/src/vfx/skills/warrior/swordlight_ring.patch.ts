
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).

// its added light (peak 0.69-0.75x); the old hand spec was a cyan disc at 0.26-0.37x. Only readability on the bright floor is added. The long blade flame


import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/swordlight_ring.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.swordlight_ring': { set: READABLE },
    'sk.swordlight_ring.cast': { set: READABLE },
  },
};
