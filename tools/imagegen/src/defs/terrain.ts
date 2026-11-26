import type { JobSpec } from '../types';
import { PAINTERLY, TILEABLE_AVOID, TILEABLE_CONSTRAINTS, ZONE_PALETTE, terrainPost } from './style';

type Zone = keyof typeof ZONE_PALETTE;

interface TerrainDef {
  id: string;
  zone: Zone;
  subject: string;
  /** overrides the zone palette line */
  palette?: string;
  /** colour saturation multiplier applied after flatten (1 = unchanged) */
  saturation?: number;
  materials: string;
  kind?: 'terrain' | 'rock';
  flatten?: number;
  normal?: number;
}

const DEFS: TerrainDef[] = [
  // --- Yeonmu plains
  {
    id: 'tex_grass_a',
    zone: 'yeonmu',
    subject: 'dense lush green meadow grass, short and medium blades in many overlapping directions with a few tiny clover leaves',
    materials: 'individual grass blades with lighter yellow-green tips and darker emerald roots, subtle patches of slightly different green',
  },
  {
    id: 'tex_grass_b',
    zone: 'yeonmu',
    subject: 'taller wild grass in loose tufts, blades leaning in different directions, with darker shaded gaps and a few bent dry yellow-green stalks',
    materials: 'long thin blades, tufts of lighter olive-green, a few darker patches of tangled grass, tiny bits of brown soil showing between tufts',
  },
  {
    id: 'tex_meadow',
    zone: 'yeonmu',
    subject: 'flower meadow: green grass thickly sprinkled with many tiny white, soft yellow and pale blue wildflowers',
    materials: 'grass blades plus small simple five-petal flowers scattered evenly, none larger than a few pixels of blades',
  },
  {
    id: 'tex_dirt_path',
    zone: 'yeonmu',
    subject: 'trodden warm brown dirt path surface with small pebbles, faint footprints and wheel scuffs, a few tiny sprigs of grass',
    materials: 'packed earth, fine gravel, light dusty patches and darker damp patches',
    flatten: 0.6,
  },
  {
    id: 'tex_rock_mossy',
    zone: 'yeonmu',
    subject: 'weathered grey-green stone ground surface of flat rock slabs with thin cracks, covered with patches of green moss and lichen',
    materials: 'rough carved-looking stone, chipped edges, moss in the cracks, subtle warm grey tones',
    kind: 'rock',
    normal: 3.0,
  },
  // --- Suryeon valley
  {
    id: 'tex_dry_grass',
    zone: 'suryeon',
    subject: 'dry straw-coloured grass, sun-bleached yellow and tan blades, sparse and matted, with olive-green survivors and bare dusty soil in between',
    materials: 'brittle dry blades in many directions, tan, wheat-gold and dusty olive tones',
  },
  {
    id: 'tex_ochre_dirt',
    zone: 'suryeon',
    subject: 'dry ochre-orange cracked earth ground with small stones, fine dust, and shallow hairline cracks',
    materials: 'sun-baked clay soil, orange-ochre and sienna tones, scattered small pebbles',
    saturation: 0.85,
    flatten: 0.6,
  },
  {
    id: 'tex_mud',
    zone: 'suryeon',
    subject: 'trampled dark brown mud with hoof and boot prints, shallow puddles with a wet sheen, scattered straw bits and small stones',
    materials: 'wet churned mud, glossy puddle highlights, rich dark brown and umber',
    normal: 3.0,
  },
  {
    id: 'tex_rock_canyon',
    zone: 'suryeon',
    subject: 'red-orange canyon rock ground: layered sandstone slabs with horizontal strata, fractured edges and loose gravel',
    materials: 'rust-red, burnt orange and tan layered rock, rough weathered texture',
    saturation: 0.88,
    kind: 'rock',
    normal: 3.2,
  },
  // --- Seori mountain
  {
    id: 'tex_snow_fresh',
    zone: 'seori',
    subject: 'fresh undisturbed snow: soft wind-sculpted drifts and gentle ripples with tiny sparkling ice crystals; only snow, nothing else',
    materials: 'powdery white snow with cool blue-lavender shadows in the soft hollows, very subtle low-contrast detail; absolutely no rocks, no stones, no dirt, no footprints, no debris, no dark spots',
    flatten: 0.4,
    normal: 1.4,
  },
  {
    id: 'tex_snow_packed',
    zone: 'seori',
    subject: 'packed trampled snow with boot prints, grey-blue compacted patches, thin ice crust and small clumps of dirty snow',
    materials: 'compressed snow, crusted ice glaze, a few dark grit specks, cool white and grey-blue tones',
    normal: 2.4,
  },
  {
    id: 'tex_ice_blue',
    zone: 'seori',
    subject: 'deep blue glacial ice surface with a network of cracks, frozen air bubbles, and translucent depth layers',
    materials: 'glassy ice, cyan and deep blue, white fracture lines, subtle glossy highlights',
    normal: 2.6,
  },
  {
    id: 'tex_rock_frozen',
    zone: 'seori',
    subject: 'dark slate grey-blue rock ground with frost, thin snow lodged in the cracks and small ice glaze patches',
    materials: 'rough angular stone, frost crystals, cold blue-grey tones with white snow in crevices',
    kind: 'rock',
    normal: 3.2,
  },
  // --- Daeryeol volcanic
  {
    id: 'tex_ash',
    zone: 'daeryeol',
    subject: 'dark volcanic ash and cinder ground: fine charcoal-grey ash drifts with small cinder stones and a few faint dull-red ember specks',
    materials: 'soft powdery ash, dark grey and black tones, tiny scattered embers glowing dull red-orange',
    flatten: 0.5,
  },
  {
    id: 'tex_basalt',
    zone: 'daeryeol',
    subject: 'black basalt rock ground: fractured dark slabs with thin hexagon-like cracks and a rough pitted surface; completely cold and unlit',
    materials: 'near-black and dark charcoal-grey volcanic stone with pale grey wear on the edges and faint brown-grey weathering; absolutely no glow, no lava, no orange or red colour, no embers',
    kind: 'rock',
    normal: 3.2,
  },
  {
    id: 'tex_lava_crust',
    zone: 'daeryeol',
    subject: 'cooled lava crust: black cracked plates of hardened lava with bright glowing orange-yellow molten cracks between the plates',
    materials: 'dark charred crust plates with rough texture, bright molten orange-yellow veins glowing in the cracks',
    normal: 3.0,
    flatten: 0.3,
  },
  {
    id: 'tex_scorched',
    zone: 'daeryeol',
    subject: 'scorched cracked earth ground: burnt dry soil with deep cracks, charcoal and soot patches, and a few dull red-brown ember glints',
    materials: 'charred soil, black soot smears, dark red-brown cracks, a few gravel stones',
  },
  // --- Structures & props (requested by the terrain agent): plaza, cobbles, planks, roof tiles, basalt columns
  {
    id: 'tex_plaza_tile',
    zone: 'yeonmu',
    palette: 'warm grey-beige stone, subtle red-brown joint lines, faint moss-green in a few joints, pale cream highlights',
    subject: 'worn grey-beige stone flagstone plaza paving: irregular rectangular flagstones laid with thin red-brown mortar joints, slightly chipped corners and gentle surface wear',
    materials: 'smooth weathered limestone flags, fine cracks, tiny pits, soft wear polish, thin dark joints',
    kind: 'rock',
    normal: 3.0,
    flatten: 0.6,
  },
  {
    id: 'tex_cobble_dark',
    zone: 'daeryeol',
    palette: 'dark volcanic warm grey-brown cobbles, charcoal joints, a few thin dull orange ember cracks between stones',
    subject: 'dark volcanic cobblestone paving: rounded dark grey-brown cobbles tightly set with charcoal joints and a few thin glowing ember cracks between some stones',
    materials: 'rounded basalt cobbles, soot-stained, rough surface, a few dull orange glowing hairline cracks in the joints only',
    kind: 'rock',
    normal: 3.2,
  },
  {
    id: 'tex_wood_plank',
    zone: 'suryeon',
    palette: 'weathered warm brown and grey-brown wood, dark nail heads, pale silvered grain, dark gaps between planks',
    subject: 'weathered wooden planks laid side by side with horizontal grain, dark gaps between planks, old nail heads and knots, used for bridges and palisades',
    materials: 'rough weathered timber, deep grain lines, splinters, knots, silvery wear, iron nail heads',
    normal: 3.0,
    flatten: 0.6,
  },
  {
    id: 'tex_roof_tile',
    zone: 'suryeon',
    palette: 'red-brown terracotta clay, darker brown shadow lines, hints of dark moss and lichen on a few tiles',
    subject: 'rows of red-brown curved clay roof tiles (traditional East-Asian giwa style) in neat overlapping rows, slightly weathered with moss patches',
    materials: 'curved terracotta tiles with raised ridges and shadowed valleys, weathered glaze, lichen specks',
    normal: 3.4,
    flatten: 0.6,
  },
  {
    id: 'tex_rock_basalt_cols',
    zone: 'daeryeol',
    palette: 'near-black charcoal basalt, cool dark grey highlights, faint brown weathering',
    subject: 'top view of dark basalt columns: tightly packed irregular hexagonal column tops with narrow dark gaps, rough weathered surfaces',
    materials: 'hexagonal basalt column heads, dark stone, tiny chips, subtle pale wear on edges; completely cold and unlit, no glow, no lava',
    kind: 'rock',
    normal: 3.4,
  },
];

export const terrainJobs: JobSpec[] = DEFS.map((d) => ({
  id: d.id,
  group: 'terrain',
  kind: d.kind ?? 'terrain',
  aspect: 'square',
  size: 1024,
  tiling: true,
  post: terrainPost({ flatten: d.flatten, normal: d.normal, saturation: d.saturation }),
  prompt: {
    useCase: 'stylized-concept',
    assetType: 'seamless tileable ground texture (albedo) for a 3D action game, seen by a 55 degree top-down camera',
    subject: d.subject,
    style: PAINTERLY + '; stylized ground texture with clear but soft detail, not photorealistic',
    composition: 'flat top-down orthographic view of the ground, the whole image is ground surface, edge to edge',
    lighting: 'soft neutral overcast light, even across the whole image',
    palette: d.palette ?? ZONE_PALETTE[d.zone],
    materials: d.materials,
    constraints: TILEABLE_CONSTRAINTS,
    avoid: TILEABLE_AVOID,
  },
}));
