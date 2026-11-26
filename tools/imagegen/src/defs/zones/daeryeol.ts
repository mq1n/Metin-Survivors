
// reference (`cli.ts gen`, docs/ART.md section 9). The reference PNGs are converted from the client data under

//
// Shipped through `cli.ts gen` + `pick` (job files tools/imagegen/jobs/gen/<id>.json, the exact spec + post chain of every pick):
//   tex_daeryeol_cobble  (ref tile01 + arena shot, core round v9, kind terrain)  flat angular squarish setts on a diagonal, ~15 per tile side (9.5 m per tile = 0.6 m setts)
//   tex_daeryeol_earth   (ref valcano_05 + arena shot, round 3 v5, terrain)    soft dark cracked earth / mud fields (13 m per tile)
//   tex_daeryeol_scorch  (ref valcano_03 + valcano_04, round 3 v1, terrain)    scorched reddish clinker: pit cores, trench lip, crater bowl, cliff-foot scree
//   tex_daeryeol_basalt  (ref valcano_rock, round 1 v3, kind rock)             cracked black-purple basalt: trench banks, walls, rim ledges, every loose rock
//   tex_daeryeol_magma   (ref valcano_magma_01 / _02, img-stage2 v14, terrain) flat molten magma: the emissive skin of every lava edge and the lava-falls
//   tex_daeryeol_sandstone (ref flame dais, img-stage2 v23, terrain)           pale carved slabs; shipped, no layer uses it (a 1 m paint texel cannot draw a kerb)
//   tex_daeryeol_dais_medallion (zones core A4)                                the plaza-centre picture
// Nothing is pending: the old pending magma spec was shipped by the stage-2 zone texture jobs.
import type { JobSpec } from '../../types';

export const M2TEX = '.research/rebuild/zones/doyyumhwan/m2tex';

export const tile = (id: string, ref: string, goal: string, kind: 'terrain' | 'rock' = 'terrain'): JobSpec => ({
  id,
  group: 'terrain',
  kind,
  goal,
  refs: [`${M2TEX}/${ref}`],
  size: 1024,
  tiling: true,
  post: [{ op: 'flatten', strength: 0.35 }, { op: 'tile' }, { op: 'resize', w: 1024 }],
  note: '',
});

/** every tile of this zone is shipped (see the list above); a new spec goes here before its `cli.ts gen` run */
export const jobs: JobSpec[] = [];
