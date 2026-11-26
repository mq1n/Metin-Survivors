// Texture budget of a shipped prop GLB (ARCHITECTURE §11 payload policy: the first zone's window carries 14 prop GLBs, so
// their embedded WebP is the biggest single category). One baked atlas per prop, longest edge <= propTexMax(id).
//  - bake.ts            aims the unwrap at min(def.size, propTexMax(id)) and re-packs until the atlas fits
//  - scripts/propTex.ts re-encodes already shipped GLBs down to the same cap (geometry bytes untouched); for a landmark it
//                       also fits the file into its byte ceiling, and with --src gives it its resolution back from the
//                       pre-cap build
export const PROP_TEX_MAX = 1024;
/** longest edge a landmark atlas may have: one RGBA atlas with mips is ~22 MB of GPU memory at 2048 px (5.6 MB at 1024) */
export const LANDMARK_TEX_MAX = 2048;














export interface Landmark {
  edge: number;
  bytes: number;
}
export const LANDMARKS: Readonly<Record<string, Landmark>> = {
  // r3 ship: prop_ruined_shrine (Tripo, 1536 px albedo)
  prop_ruined_shrine: { edge: 1536, bytes: 499000 },
  // r3 ship: prop_yurt (Tripo, 1536 px albedo)
  prop_yurt: { edge: 1536, bytes: 384000 },
  // r3 ship: prop_fire_altar (Tripo, 1536 px albedo)
  prop_fire_altar: { edge: 1536, bytes: 497000 },
  prop_broken_gate: { edge: 1536, bytes: 506000 },
  prop_stone_gate: { edge: 1536, bytes: 484000 },
  prop_watchtower: { edge: 1536, bytes: 448000 },
  prop_orc_tent: { edge: 1536, bytes: 441000 },
  // suryeon (1 placement, the 62 m Suryeon tower): the only landmark that grows a window (+~0.4 MB there); 2010 px source
  prop_giant_pagoda: { edge: 2048, bytes: 1_000_000 },
  // yeonmu (3 halls around the plaza): the 1024 file was 422 160 B; 1864 px source
  prop_hall_tiled: { edge: 1536, bytes: 598000 },
  // yeonmu (3), suryeon (1): the 1024 file was 426 028 B; 1526 px source
  prop_pagoda_gate: { edge: 1536, bytes: 549000 },
  // daeryeol (the ring of 14 around the spawn + 8 on the rim): the 1024 file was 655 768 B; 1481 px source (albedo + emissive)
  prop_lava_pillar: { edge: 2048, bytes: 586000 },
};

/** longest-edge cap (px) of a prop atlas, by manifest id (`prop_<name>`) */
export const propTexMax = (id: string): number => (LANDMARKS[id] ? LANDMARK_TEX_MAX : PROP_TEX_MAX);
/** WebP quality of the baked albedo / emissive atlas (encodeWebp), shared by the bake and the re-encode */
export const PROP_ALBEDO_QUALITY = 92;
export const PROP_EMISSIVE_QUALITY = 90;
