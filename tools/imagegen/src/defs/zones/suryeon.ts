


// Core round 1 added tex_suryeon_earth (the ground / road tile; tex_suryeon_road is no longer requested).
// Round 3 added tex_suryeon_cliff_pale (the cliff + rim-top layers) and tex_suryeon_granite (all loose rock); the r2 rimtop / boulder / cliff_face tiles are no longer requested.
// Round 2 added tex_suryeon_rim / _boulder / _plaza_b and, in the second pass, _rimtop (the r1 sandstone and plaza tiles and the r2 rim tile are no longer requested by the recipe).

// picked variants are in the manifest and the per-id job files tools/imagegen/jobs/gen/<id>.json). The dark lawn and the beach reuse the
// grass / road tiles under another tint and scale (no extra bytes). Still wanted (image cap of the round reached): the beach tile, the

import type { JobSpec } from '../../types';

const M2TEX = '.research/rebuild/zones/seungryong/m2tex';

const tile = (id: string, refs: string[], goal: string, kind: 'terrain' | 'rock' = 'terrain'): JobSpec => ({
  id,
  group: 'terrain',
  kind,
  goal,
  refs: refs.map((r) => `${M2TEX}/${r}`),
  size: 1024,
  tiling: true,
  post: [{ op: 'flatten', strength: 0.5 }, { op: 'tile' }, { op: 'resize', w: 1024 }],
  note: '',
});

export const jobs: JobSpec[] = [
  tile(
    'tex_suryeon_grass',
    ['grass01.png'],
    'Main meadow tile of the Seungryong islands, about half of the walkable ground: a seamless top-down short dense OLIVE-GREEN lawn, darker and less yellow than the reference, mean colour about #3b4a1a, shadows near #2c3614, tips near #5f7228. Calm and LOW contrast (narrow value range, halve the reference contrast) but never smooth: the whole tile is covered edge to edge by the same fine blade-scale grain at one pixel scale, no airbrushed or blurry areas. No flowers, no clumps, no bare earth, no large single blades, no cream or grey tint, no focal features, so large areas read as one soft tonal field once tiled. A new original painting, not a copy.',
  ),
  tile(
    'tex_suryeon_road',
    ['field01.png', 'beach03.png'],
    'Wide wandering tracks, trampled yards and bare earth of the Suryeon islands: a seamless top-down tile of beaten brown earth in the speckled look of the references, warm RUST-TAN, mean colour about #8a6c4c, rust-brown flecks near #6b4f36, pale tan flecks near #b09a78, a few tiny olive-grey specks. Carries real fine grit grain edge to edge at the same pixel scale as a grass lawn, low overall contrast, no stones, no pebbles, no cracks, no wheel ruts, no puddles, no straw strands, no large features. A new original painting, not a copy.',
  ),
  tile(
    'tex_suryeon_sandstone',
    ['stone01.png', 'stone02.png'],
    'Pale sandstone cliff wall and rim rock framing every Suryeon island, mapped on near-vertical faces from three directions: a seamless tile of weathered pale warm-tan rock, broad flat planes split by fine hairline fractures, a few faint horizontal ledges and bright chipped facets, isotropic (no horizontal or vertical streaking, no wavy flow lines), no moss. LIGHT and warm, never black and never red: mean colour about #b49f84, bright facets near #dccbb0, cracks no darker than #7e6c58. A new original painting, not a copy.',
    'rock',
  ),
  tile(
    'tex_suryeon_plaza',
    ['tile01.png'],
    'Paving of the Great Metin court and the pagoda ring plaza of Suryeon: a seamless top-down tile of worn carved stone slabs in a regular square-weave pattern like the reference (square blocks framed by thin joints, about 0.8 m per block), warm grey-brown, mean colour about #857b66, calm and LOW contrast, relief carved ornament faint, thin darker joints, no moss, no bright spots. A new original painting, not a copy.',
  ),
  
  tile(
    'tex_suryeon_rim',
    ['stone02.png', 'beach03.png'],
    'Pale sandstone RIM and CLIFF-FACE tile for the Seungryong islands, used top-down on the broad rim ledges and from the side on steep faces: a seamless tile of weathered, eroded pale warm-tan sandstone, mean colour about #b7a285, lighter pits near #d9c8ac, darker pits and hairline fissures no darker than #8a7860. Mottled and granular like the first reference (fine grain and soft erosion blotches everywhere) with only a few thin irregular hairline fissures and one or two faint horizontal strata bands; NO large polygonal blocks, NO flagstone or brick cells, NO slab bigger than one eighth of the tile, no repeated cell pattern, no moss, no red, no grey cast, no streaking along one direction. Calm and LOW contrast, isotropic. A new original painting, not a copy.',
    'rock',
  ),
  tile(
    'tex_suryeon_boulder',
    ['stone01.png', 'stone02.png'],
    'Loose boulders and standing stones of the Seungryong islands: a seamless tile of weathered pale grey-white granite-like stone, mean colour about #b4b0a2, mottled with darker grey-olive lichen-like patches near #7f7d6d and bright chipped facets near #e0dccd, angular fractured planes with fine hairline cracks at two or three scales, rough granular grain; isotropic, no horizontal bands, no moss clumps, no red or orange, never black (darkest no darker than #5f5d52). Calm medium contrast so small rocks read as rough angular stone. A new original painting, not a copy.',
    'rock',
  ),
  tile(
    'tex_suryeon_plaza_b',
    ['stone02.png'],
    'Paving of the Great Metin court and the ring plaza round the pagoda of Suryeon: a seamless top-down tile of closely fitted IRREGULAR polygonal flagstones (crazy paving), 4-6 sided slabs of varied size about 0.5 to 1.2 m across (roughly 25 to 35 stones per tile), each slab a slightly different grey-brown tone, thin dark hairline joints, worn rounded edges, fine stone grain on every slab; warm grey-brown, mean colour about #857b6a, joints near #5c5446, slab tones from #7a705f to #988e7a. Calm and LOW contrast, no carved ornament, no squares, no grid, no brick or running-bond pattern, no moss, no puddles, no bright spots. A new original painting, not a copy.',
  ),
  // ---- round 2b (codex run of 2026-10-21): the rim-top tile, the walkable pale shelf round every island (refs: stone01 + beach03, v3 picked) ----
  tile(
    'tex_suryeon_rimtop',
    ['stone01.png', 'beach03.png'],
    'Pale sandstone RIM-TOP tile for the shelves round the Seungryong islands, seen from a high camera: a seamless tile of weathered flat sandstone bedrock, broad softly lumpy surface with a few irregular shallow cracks and fissures spaced 30 to 80 centimetres apart that run in all directions, small flaked chips and tiny embedded pebbles, soft erosion hollows. Warm pale grey-tan, LOW saturation: mean colour about #bba98c, bright weathered patches near #dccfb6, hollows and thin crack lines no darker than #8c7c64. NOT yellow, NOT orange, no straw or grass-like strands, no fine pixel-scale noise grain, no sand ripples, no polygonal flagstone or brick cells, no repeated cell pattern, no moss, no streaking in one direction. Calm and LOW contrast, isotropic, readable as rock from far away. A new original painting, not a copy.',
    'rock',
  ),
  
  tile(
    'tex_suryeon_cliff_pale',
    ['stone01.png', 'stone02.png'],
    'Cliff-face tile for the steep multi-tier pale sandstone cliffs that drop from every Seungryong island straight to the water, mapped on near-vertical faces and seen from a high camera: a seamless tile of weathered pale warm-tan sandstone in chunky irregular lumpy blocks stacked in rough horizontal courses (blocks about 0.5 to 1.5 m, each with its own bulging rounded chipped face, no two alike), separated by narrow deep DARK crevices and shadowed joints (dark umber #3e3126 to #5a4a3a) so the relief reads strongly, sunlit block faces near #e5d3b7, mid tone near #bea689, mean colour about #aa957a, warm grey-tan, low saturation, no orange, no red. Strong large-scale light and dark contrast between block faces and crevices, but calm fine detail: no pixel-scale noise grain, no repeated cell pattern, not masonry or brickwork, no moss, no streaking in one direction, never black. A new original painting, not a copy.',
    'rock',
  ),
  tile(
    'tex_suryeon_granite',
    ['stone02.png', 'stone01.png'],
    'Pale speckled granite for the loose boulders, outcrops and standing stones of the Seungryong islands, mapped on rounded rocks and seen from a high camera: a seamless tile of weathered pale grey-white granite, mean colour about #b9b6aa, finely speckled with small dark grey-olive flecks and several large soft lichen patches (pale green-grey #9a9d86 and bright cream-white #e6e2d4), irregular dark hairline cracks (#4f4d44) running in all directions about 20 to 60 cm apart, a few shallow pits; mottled like real weathered granite, isotropic, no horizontal bands, no angular polygon cells, no brick or masonry, no red or orange, never black. Medium contrast so even a small rock reads as speckled pale stone. A new original painting, not a copy.',
    'rock',
  ),
  
  
  
  tile(
    'tex_suryeon_earth',
    ['field01.png', 'beach03.png'],
    'Wide wandering tracks, trampled yards and bare earth of the Seungryong islands, seen from a high game camera: a seamless top-down tile of dry packed earth strewn with fine leaf litter and grit, in the speckled look of the references but with STRONG fine contrast so that it never reads as a smooth fill: warm ORANGE-BROWN earth (hue about 33 degrees, mean colour about #6f5638), many small flecks of dark umber (#3f2f20), pale grey-tan grit and tiny pebbles (#a89d86), tiny dry rust-orange leaf bits (#9a5a2c) and a few olive-grey specks, scattered irregularly at three scales (pixel grit, 1 to 3 cm chips, 5 to 10 cm leaf bits), plus a few soft darker and lighter earth patches 30 to 60 cm across. Orange-brown, NOT red, NOT chocolate, NOT pink. No stones bigger than 5 cm, no cracks, no straw strands, no wheel ruts, no puddles, no large features, no single focal spot. A new original painting, not a copy.',
  ),
  // (tex_suryeon_cliff_face / _sand / _grass_b were generated in the prod pass of 2026-10-20: job files in tools/imagegen/jobs/gen/)
];
