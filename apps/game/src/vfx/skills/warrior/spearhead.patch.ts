
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).
// S4 warrior wave: the family as generated (violet starburst at the start 0.1, blue-green aura dome + double ring 0.3-0.6, grey ring fading by 0.9) is

// So only readability on the bright floor is added; nothing is recoloured or resized.
import { READABLE, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/spearhead.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.spearhead': { set: READABLE },
  },
};
