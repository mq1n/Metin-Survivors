// Structure set B (orc camp, small props, braziers, banners, ...). Owner: StructuresB.
import { CAMP_DEFS } from './b_camp';
import { FIRE_DEFS } from './b_fire';
import { MISC_DEFS } from './b_misc';
import { TOTEM_DEFS } from './b_totem';
import { VILLAGE_DEFS } from './b_village';
import type { StructureDef } from './types';

export const STRUCTURES_B: Record<string, StructureDef> = { ...VILLAGE_DEFS, ...CAMP_DEFS, ...TOTEM_DEFS, ...FIRE_DEFS, ...MISC_DEFS };
