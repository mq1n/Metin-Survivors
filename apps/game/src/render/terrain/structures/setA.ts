// Structure set A: East-Asian architecture and stonework (gates, halls, pagodas, lanterns, ruins, pillars, stele).
// Owner: StructuresA. Builders live in propsA/*.ts and share the geom/ toolkit + palette.ts.
import { PAGODA_GATE } from './propsA/gate';
import { HALL_TILED } from './propsA/hall';
import { HOUSE_SMALL, LAMP_POST } from './propsA/house';
import { STONE_LANTERN } from './propsA/lantern';
import { GIANT_PAGODA } from './propsA/pagoda';
import { BROKEN_GATE, RUINED_SHRINE } from './propsA/ruins';
import { FIRE_ALTAR, LAVA_PILLAR, OBELISK, RUIN_PILLAR, STELE, STONE_GATE } from './propsA/stonework';
import type { StructureDef } from './types';

export const STRUCTURES_A: Record<string, StructureDef> = {
  pagoda_gate: PAGODA_GATE,
  hall_tiled: HALL_TILED,
  house_small: HOUSE_SMALL,
  stone_lantern: STONE_LANTERN,
  lamp_post: LAMP_POST,
  giant_pagoda: GIANT_PAGODA,
  stone_gate: STONE_GATE,
  broken_gate: BROKEN_GATE,
  ruined_shrine: RUINED_SHRINE,
  ruin_pillar: RUIN_PILLAR,
  lava_pillar: LAVA_PILLAR,
  obelisk: OBELISK,
  fire_altar: FIRE_ALTAR,
  stele: STELE,
};
