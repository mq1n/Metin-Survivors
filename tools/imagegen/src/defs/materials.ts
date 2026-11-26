// Seamless material albedo tiles requested by the 3D agents (Weapons: hard-surface bake; Props: architecture/prop bake).
import type { JobSpec } from '../types';
import { PAINTERLY, TILEABLE_AVOID, TILEABLE_CONSTRAINTS } from './style';

interface MaterialDef {
  id: string;
  subject: string;
  materials: string;
  palette: string;
  /** derive a normal map as well */
  normal?: number;
  flatten?: number;
}

function materialJob(group: string, m: MaterialDef): JobSpec {
  return {
    id: m.id,
    group,
    kind: 'rock',
    aspect: 'square',
    size: 1024,
    tiling: true,
    post: [
      { op: 'flatten', strength: m.flatten ?? 0.5 },
      { op: 'tile' },
      { op: 'resize', w: 1024 },
      ...(m.normal ? ([{ op: 'normal', strength: m.normal }] as const) : []),
      { op: 'webp', quality: 86, normalQuality: 88 },
    ],
    prompt: {
      useCase: 'stylized-concept',
      assetType:
        group === 'weapon'
          ? 'seamless tileable material albedo texture for hard-surface weapon models (UV / triplanar baking) in a 3D game'
          : 'seamless tileable material albedo texture for architecture and prop models (UV baking) in a 3D game',
      subject: m.subject,
      style: PAINTERLY + '; stylized hand-painted material swatch with clear readable brushwork, saturated medium-contrast, not photorealistic',
      composition: 'flat orthographic close-up of the material filling the entire frame',
      lighting: 'flat even light, no baked shadows, no ambient occlusion, no vignette, no directional gradient',
      palette: m.palette,
      materials: m.materials,
      constraints: TILEABLE_CONSTRAINTS.replace('viewed straight down from above (orthographic, no perspective, no horizon)', 'flat front-on orthographic view'),
      avoid: TILEABLE_AVOID.replace('trees, ', ''),
    },
  };
}

const WEAPON: MaterialDef[] = [
  {
    id: 'tex_wp_steel',
    subject: 'forged blue-grey steel surface with fine brushed streaks all running in ONE direction (horizontal), tiny hammer pits and a few lighter wear scratches',
    materials: 'brushed forged steel, subtle hammer-dimple pits, fine light scratches, no rust',
    palette: 'cool blue-grey steel, slightly lighter streak highlights, darker pit shadows',
  },
  {
    id: 'tex_wp_iron_dark',
    subject: 'blackened dark iron / gunmetal surface with scale-forged pitting and mottling',
    materials: 'rough forge-scale texture, fine pitting, subtle oil sheen, no rust, no glow',
    palette: 'warm brown-black with a slight blue cast, lighter charcoal wear patches',
  },
  {
    id: 'tex_wp_gold',
    subject: 'worn polished gold leaf / brass surface with warm streaky highlights and a fine engraved scroll relief pattern',
    materials: 'burnished gold leaf, tiny engraved dragon-scroll relief, worn edges, slight patina in the recesses',
    palette: 'warm gold, bright yellow highlights, bronze-brown shadows',
  },
  {
    id: 'tex_wp_wood',
    subject: 'dark lacquered hardwood surface with fine grain running in ONE direction (horizontal)',
    materials: 'polished dark lacquered hardwood, fine straight grain, subtle figure and pores, glossy sheen',
    palette: 'deep brown-red wood, darker grain lines, warm reddish highlights',
  },
  {
    id: 'tex_wp_leather',
    subject: 'dark brown leather grip wrap: tight uniform diagonal binding of leather strips and cord with faint stitch hints',
    materials: 'wrapped leather strips, fine cord edges, worn creases, slight sheen',
    palette: 'dark chocolate brown, warm tan highlights on the strip edges, near-black gaps',
  },
  {
    id: 'tex_wp_silk',
    subject: 'crimson silk brocade surface with a subtle tone-on-tone dragon-scroll and cloud pattern and a fine woven texture',
    materials: 'woven silk brocade, soft sheen, raised pattern in the same red, delicate thread texture',
    palette: 'deep crimson red, slightly lighter red pattern, dark red shadows',
  },
  {
    id: 'tex_wp_jade',
    subject: 'green nephrite jade surface with soft cloudy veins and translucent depth',
    materials: 'polished jade, cloudy pale veins, subtle translucency, a few fine cracks',
    palette: 'mid green with milky pale green clouds and a few darker green veins',
  },
  {
    id: 'tex_wp_bone',
    subject: 'aged ivory / bone-horn surface with fine cracks, growth lines and light staining',
    materials: 'polished aged bone, hairline cracks, subtle growth lines, warm staining',
    palette: 'warm cream, pale ivory highlights, light brown stains in the cracks',
  },
];

const PROPS: MaterialDef[] = [
  {
    id: 'tex_plaster_white',
    subject: 'aged warm off-white lime plaster wall (East-Asian timber-frame infill) with hairline cracks and faint rain stains and grime streaks running downward',
    materials: 'rough lime plaster, hairline cracks, soft grey-brown rain-stain streaks, tiny chips',
    palette: 'warm off-white, cream, pale grey-brown stains',
    flatten: 0.6,
  },
  {
    id: 'tex_wood_lacquer_red',
    subject: 'vermilion / crimson red lacquered timber surface with fine vertical grain and subtle wear and small chips showing darker brown wood underneath',
    materials: 'glossy red lacquer over fine vertical grain, worn edges, tiny chips revealing dark wood',
    palette: 'vermilion red, deep crimson, dark brown showing in the chips',
    flatten: 0.6,
  },
  {
    id: 'tex_wood_beam_dark',
    subject: 'dark weathered brown-black timber beam surface with long vertical grain, checks and cracks',
    materials: 'old weathered hardwood, long vertical grain, deep drying cracks, grey weathering patches',
    palette: 'dark brown, near-black, grey-brown weathering',
    normal: 3.0,
    flatten: 0.6,
  },
  {
    id: 'tex_stone_block_wall',
    subject: 'grey granite ashlar block courses (temple platform / wall): neat rows of rectangular stone blocks with thin mossy joints and chipped edges',
    materials: 'dressed granite blocks, thin dark joints with green moss, chipped edges, weathering stains',
    palette: 'cool grey granite, slightly warm grey variation between blocks, green moss in the joints',
    normal: 3.2,
    flatten: 0.6,
  },
  {
    id: 'tex_dancheong',
    subject:
      'East-Asian painted-eave pattern (dancheong): horizontal decorative bands in dark teal, green, blue, red and white with crisp geometric stripes and repeating lotus and diamond motifs; the pattern repeats seamlessly horizontally and vertically (the vertical period is exactly one complete set of bands)',
    materials: 'painted timber with crisp opaque mineral-paint edges, slight wear, tiny hairline cracks',
    palette: 'dark teal, jade green, deep blue, vermilion red, cream white, thin gold-yellow lines',
    flatten: 0.2,
  },
  {
    id: 'tex_hide_patch',
    subject: 'crudely stitched patchwork animal hide (orc tent cloth): patches of brown, tan and dark grey leather joined with visible leather lacing and hairy edges, with a few crude painted tribal marks',
    materials: 'rough hide patches, thick leather lacing stitches, hair fringe at edges, smeared crude paint marks',
    palette: 'browns, tans, dark grey, a few dull red and bone-white tribal marks',
    normal: 3.0,
    flatten: 0.5,
  },
  {
    id: 'tex_thatch_straw',
    subject: 'golden and grey straw thatch roofing surface with long vertical straw streaks in layered bundles',
    materials: 'dense layered straw bundles, vertical streaks, weathered grey patches, dark gaps',
    palette: 'golden straw, pale grey weathered straw, dark brown shadows',
    normal: 3.0,
    flatten: 0.6,
  },
  {
    id: 'tex_bone_ivory',
    subject: 'yellowed aged bone surface with cracks and pitting and light staining',
    materials: 'aged bone, hairline cracks, pitted surface, brown staining in the cracks',
    palette: 'yellowed ivory, warm cream, light brown stains',
    normal: 2.6,
    flatten: 0.6,
  },
  {
    id: 'tex_felt_white',
    subject: 'dirty off-white wool felt (yurt covering) with a woven and pressed fibre texture and faint grey grime',
    materials: 'pressed wool felt fibres, soft woven texture, subtle grey-brown dirt smudges',
    palette: 'dirty off-white, warm grey, light brown smudges',
    flatten: 0.6,
  },
  {
    id: 'tex_gold_ornament',
    subject: 'hammered gold / brass sheet with an engraved scroll pattern (trim and finials): hammer facets with fine engraved dragon-scroll lines',
    materials: 'hammered gold, engraved scroll relief, bright specular highlights on facets, darker recesses',
    palette: 'warm gold, bright yellow highlights, bronze-brown recesses',
    normal: 3.0,
    flatten: 0.5,
  },
  {
    id: 'tex_iron_dark',
    subject: 'dark worn forged iron surface with hammer marks and orange-brown rust bloom concentrated around the edges and pits',
    materials: 'dark forged iron, hammer marks, pitting, rust blooms',
    palette: 'near-black iron, grey-brown wear, orange-brown rust',
    normal: 3.0,
    flatten: 0.6,
  },
  {
    id: 'tex_bronze_patina',
    subject: 'dark bronze surface with green-blue verdigris patina streaks running down from raised areas (braziers, urns)',
    materials: 'cast bronze, verdigris streaks and crust, worn brown metal showing through',
    palette: 'dark bronze brown, turquoise-green verdigris, pale green crust',
    normal: 3.0,
    flatten: 0.6,
  },
];

export const weaponJobs: JobSpec[] = WEAPON.map((m) => materialJob('weapon', m));
export const propJobs: JobSpec[] = PROPS.map((m) => materialJob('props', m));
