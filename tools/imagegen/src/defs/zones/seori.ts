
// (`cli.ts gen`, docs/ART.md section 9). The reference PNGs are converted from the client data under

//
// Round 1 (codex usage limit lifted 08:53) shipped through `cli.ts gen` + `pick` (job files tools/imagegen/jobs/gen/<id>.json):
//   tex_seori_snow_a  (ref snow01, v1)   main calm snow, also serves the brighter patches / mire by tint (round 2: re-built with a sharper post chain)
//   tex_seori_gravel  (ref field01, v2)  superseded in round 2 by tex_seori_gravel_b (no longer referenced by the zone)
//   tex_seori_slate   (ref stone01, v1, kind rock)  slate ridge-corridor and rim walls with snow-dusted ledges
// Round 2 shipped (gen + pick):
//   tex_seori_gravel_b   (ref field01, v1)   fine even grey frozen gravel: tracks, camp, boss pads, scoured aprons (calmer than round 1's blotchy tile)
//   tex_seori_ice        (ref ice_quest, v1) pale blue-white frost crust with grey grit: ice patches, ponds, the frozen mere bed
//   tex_fol_seori_spruce (refs spruce_ref + frost_ref, style tex_fol_pine_snow, v1)  blue-grey frosted spruce spray card
//   tex_fol_seori_beech  (ref beech_ref, style tex_fol_pine_snow, v1)                white winter-beech twig canopy card
// Core1 round (2026-10-22, gen + pick through `cli.ts gen`, job file tools/imagegen/jobs/gen/tex_seori_trail_b.json):

//                        (replaces tex_seori_gravel_b as the trail / earth tile; gravel_b stays shipped, unreferenced)
// The spec below is what is still pending (6-image cap per round); emit.ts registers `defs/zones/*.ts` when the core owner wires it.
import type { JobSpec } from '../../types';

const M2TEX = '.research/rebuild/zones/sohan/m2tex';

const tile = (id: string, ref: string, goal: string, kind: 'terrain' | 'rock' = 'terrain'): JobSpec => ({
  id,
  group: 'terrain',
  kind,
  goal,
  refs: [`${M2TEX}/${ref}`],
  size: 1024,
  tiling: true,
  post: [{ op: 'flatten', strength: 0.5 }, { op: 'tile' }, { op: 'resize', w: 1024 }],
  note: '',
});

export const jobs: JobSpec[] = [
  tile('tex_seori_cliff', 'stone01.png', 'Dark slate cliff face of the Seori ridge corridors, seen side-on: seamless tile of cold blue-grey slate with hairline cracks, a few snow-filled ledges and a lighter weathered crest band. Calm, low contrast, no black voids, mean about #6f7684. A new original painting, not a copy.', 'rock'),
];
