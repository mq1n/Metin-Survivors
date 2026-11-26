

// its added light, draws a sharp oversized crescent at 0.8 s and was 20 % white in game (rank 7, yeonmu, +1.2 s; the judge's pilot RAW 33-45 %). READABLE +
// relative cuts (size x k / brightness x k) on the crescent, the wide band ring, the cone flash / haze and the cone bodies; the whirl (palbang_spin,
// death_tornado: the 0.3-0.5 s identity of the skill) keeps its generated light.

import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/rimewind.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 wolfman: READABLE + crescent 0.35x, wide band ring 0.5x, cone flash / haze / bodies x0.45-0.65 brightness (white-out gate: 20.4 % -> 2.9 %)',
  specs: {
    'sk.rimewind': {
      set: READABLE,
      el: {
        'wind_death_02#0': shape({ size: 0.35, tint: 0.45 }),
        'wind_death_01#2': shape({ size: 0.5, tint: 0.45 }),
        'wind_death_01#1': shape({ size: 0.7, tint: 0.45 }),
        'wind_death_01#0': shape({ tint: 0.45 }),
        'wind_death_06#0': shape({ tint: 0.5 }),
        'wind_death_05_3#0': shape({ tint: 0.5 }),
        'wind_death_03#0': shape({ tint: 0.5 }),
        'palbang_3_spin#2': shape({ tint: 0.65 }),
        'palbang_4_spin#4': shape({ tint: 0.65 }),
        'palbang_4_spin#5': shape({ tint: 0.65 }),
      },
    },
  },
};
