

// flash at the wind-up and was 71 % white in game at +0.3 s). RAW is 1.1-1.4x the added light; in game the five 2.5 s green crescent rings were 8.7 / 7.2 / 6.7 %

// hollow rings of the starburst.
import { READABLE, type SkillPatch } from '../../spec/patch';
import { shape } from './patchKit';
import type { GEN_KEYS } from '../_gen/lupine_lunge.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 wolfman: READABLE + the five crescent rings x0.35 brightness / 0.55 size, the 7 m soft ring 0.65x, the hollow starburst rings x0.8 (family worst 3.0 % at +1.2 s; the 8.5 % at +0.3 s is the game around it: 9.7 % with the whole family dropped)',
  specs: {
    'sk.lupine_lunge': {
      set: READABLE,
      el: {
        'skill_wildattack_03#0': shape({ size: 0.55, tint: 0.35 }),
        'skill_wildattack_03#0~g2': shape({ size: 0.55, tint: 0.35 }),
        'skill_wildattack_03#0@2': shape({ size: 0.55, tint: 0.35 }),
        'skill_wildattack_03#0@3': shape({ size: 0.55, tint: 0.35 }),
        'skill_wildattack_03#0@4': shape({ size: 0.55, tint: 0.35 }),
        'skill_wildattack_04#1': shape({ size: 0.65, tint: 0.7 }),
        // s4-flip R4: the landing starburst was 8.1 % white at 1.0 s in game (family alone 0.9 %): light 0.8 -> 0.5
        'swaeryeong_3#3': shape({ tint: 0.5 }),
        'swaeryeong#3': shape({ tint: 0.5 }),
        'swaeryeong_3#7': shape({ tint: 0.5 }),
      },
    },
  },
};
