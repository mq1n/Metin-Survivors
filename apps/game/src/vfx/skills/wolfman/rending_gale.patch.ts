


// READABLE on both specs (body + .cast) + relative cuts (size / brightness x k, every grade: the stacking is the same at every rank) on the blast bodies.
import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/rending_gale.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.rending_gale': {
      set: READABLE,
      el: {
        'pungwoo_blow#0': shape({ size: 0.35, tint: 0.15 }),
        'pungwoo_blow#1': shape({ size: 0.35, tint: 0.15 }),
        'pungwoo_2_blow#2': shape({ size: 0.4, tint: 0.2 }),
        'pungwoo_blow#2': shape({ size: 0.4, tint: 0.3 }),
        // s4-flip R4: still 23 % white at 0.3 s in game (16 % of it the game around the family): body flecks 0.4 -> 0.25, cast glints 0.5 / 0.5 / 0.45 -> 0.3
        'pungwoo_blow#3': shape({ tint: 0.25 }),
        'pungwoo_3_blow#5': shape({ fade: 0.6 }),
      },
    },
    'sk.rending_gale.cast': {
      set: READABLE,
      el: {
        'pungwoo_3#2': shape({ size: 0.45, tint: 0.15 }),
        'pungwoo_1#0': shape({ tint: 0.6 }),
        'pungwoo_2#1': shape({ tint: 0.6 }),
        'pungwoo_4#4': shape({ tint: 0.3 }),
        'pungwoo_4#5': shape({ tint: 0.3 }),
        'pungwoo_4#6': shape({ tint: 0.3 }),
        'pungwoo_1#1': shape({ fade: 0.6 }),
      },
    },
  },
};
