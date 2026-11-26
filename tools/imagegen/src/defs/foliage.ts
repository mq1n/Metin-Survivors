import type { JobSpec, PostOp } from '../types';
import { PAINTERLY, TILEABLE_AVOID, TILEABLE_CONSTRAINTS } from './style';

const CARD_POST: PostOp[] = [
  { op: 'alpha', key: '#ff00ff', t0: 60, t1: 130, erode: 1, feather: 0.8 },
  { op: 'trim', pad: 4 },
  { op: 'resize', w: 512, mode: 'fit' },
  { op: 'bleed' },
  { op: 'webp', quality: 90 },
];

interface CardDef {
  id: string;
  subject: string;
  materials: string;
  palette: string;
  composition?: string;
}

const CARDS: CardDef[] = [
  {
    id: 'tex_fol_pine_branch',
    subject: 'a bushy cluster of several dark green pine branches with dense radial sprays of long needles, one irregular conifer foliage clump',
    materials: 'needle sprays painted as soft overlapping fans, lighter yellow-green tips, deep blue-green shadowed interior, tiny brown twigs',
    palette: 'deep conifer green, blue-green shadows, yellow-green highlights, small warm brown twigs',
  },
  {
    id: 'tex_fol_broadleaf',
    subject: 'a leafy clump of broad rounded green leaves on thin twigs, like oak or maple foliage, leaves overlapping at many angles',
    materials: 'each leaf with a visible central vein, lighter top surface and darker underside, soft painted shading',
    palette: 'fresh mid-green and yellow-green leaves, dark green shadows, thin brown twigs',
  },
  {
    id: 'tex_fol_autumn',
    subject: 'a leafy clump of broad maple-like leaves in autumn colours on thin twigs, leaves overlapping at many angles',
    materials: 'each leaf with a visible central vein, lighter top and darker underside, soft painted shading',
    palette: 'crimson red, vermilion orange, amber gold, a few russet brown leaves, thin dark brown twigs',
  },
  {
    id: 'tex_fol_pine_snow',
    subject: 'a bushy cluster of pine branches with dense needle sprays, thick fluffy snow resting on top of the branches, green needles visible beneath',
    materials: 'soft white snow caps with blue shadow side, dark green needle sprays below, tiny icicles',
    palette: 'white and pale blue snow, deep cold green needles, slate-blue shadows',
  },
  {
    id: 'tex_fol_dead_branch',
    subject: 'a cluster of gnarled leafless dead branches and twigs, forking irregularly, with a few shrivelled dry curled brown leaves still hanging',
    materials: 'rough grey-brown weathered wood, thin dry twigs, cracked bark texture, sparse dead leaves',
    palette: 'ashen grey-brown, dark umber, a few dry ochre leaves',
  },
  {
    id: 'tex_fol_grass_1',
    subject: 'a single medium tuft of lush green grass, many curved blades radiating upward and outward from one base point at the bottom centre',
    materials: 'individual blades with lighter tips and darker roots, soft painted shading',
    palette: 'fresh green and yellow-green, dark green roots',
    composition: 'tuft base at the bottom centre of the frame, front-on side view',
  },
  {
    id: 'tex_fol_grass_2',
    subject: 'a tall slender tuft of wild grass with long thin arching blades and a few feathery seed heads on thin stalks, from one base at the bottom centre',
    materials: 'thin arching blades, pale golden seed heads, painted with soft shading',
    palette: 'olive green blades, pale gold seed heads, darker green base',
    composition: 'tuft base at the bottom centre of the frame, front-on side view',
  },
  {
    id: 'tex_fol_grass_3',
    subject: 'a short dense clump of grass with a mix of green and dry yellow-tan blades, rounded bushy shape, base at the bottom',
    materials: 'many short stiff blades radiating from the base, some bent and dry, painted shading',
    palette: 'yellow-tan and olive green, brown base',
    composition: 'clump base at the bottom centre of the frame, front-on side view',
  },
  {
    id: 'tex_fol_flowers_1',
    subject: 'a clump of wildflowers: white and yellow daisies on slender green stems with small green leaves, growing from one base at the bottom centre',
    materials: 'simple painted petals with soft shading, slender stems, small lance-shaped leaves',
    palette: 'white petals, golden yellow centres, fresh green stems and leaves',
    composition: 'clump base at the bottom centre of the frame, front-on view',
  },
  {
    id: 'tex_fol_flowers_2',
    subject: 'a clump of red spider lilies (higanbana) and a few small orange poppies, with thin green stems and grassy leaves, growing from one base at the bottom centre',
    materials: 'delicate curling crimson petals and long thin stamens, slender stems, painted soft shading',
    palette: 'crimson red, vermilion, warm orange, fresh green stems',
    composition: 'clump base at the bottom centre of the frame, front-on view',
  },
  {
    id: 'tex_fol_bush',
    subject: 'a rounded leafy green shrub with many small glossy leaves, dense and bushy, a few short woody stems visible at the base',
    materials: 'overlapping small leaves with lighter tips and deep green shadows, soft painted shading, a few tiny berries',
    palette: 'mid green, dark green shadows, yellow-green highlights, tiny red berries',
    composition: 'shrub base at the bottom centre of the frame, front-on view',
  },
  {
    id: 'tex_fol_pine_dark',
    subject: 'a bushy cluster of very dark pine branches with dense needle sprays, nearly black-green, a few needles scorched brown at the tips, one irregular conifer foliage clump',
    materials: 'needle sprays painted as soft overlapping fans, dark blue-black green interior, dull olive-brown scorched tips, thin dark twigs',
    palette: 'near-black green, dark blue-green shadows, dull olive and brown tips',
  },
  {
    id: 'tex_fol_reeds',
    subject: 'a clump of water-edge reeds with tall slender blades and several brown cattail seed heads on straight stalks, growing from one base at the bottom centre',
    materials: 'long thin arching green-yellow blades, velvety brown cattail spikes, painted soft shading',
    palette: 'olive and yellow-green blades, warm brown cattails, darker green base',
    composition: 'clump base at the bottom centre of the frame, front-on view',
  },
  {
    id: 'tex_fol_lily',
    subject: 'a cluster of round floating water lily pads with two white lotus blossoms, seen from above at a slight angle, pads overlapping',
    materials: 'glossy round green pads with a radial notch and veins, white petals with pale yellow centres, painted soft shading',
    palette: 'deep green pads, lighter green highlights, white and cream blossoms, pale yellow centres',
    composition: 'cluster seen from above, fills about 85% of the frame, centred',
  },
  {
    id: 'tex_fol_snow_tuft',
    subject: 'a small frosted grass tuft: short pale blue-green blades dusted with snow and frost, from one base at the bottom centre',
    materials: 'short stiff blades with white frost on the tips, a little snow at the base, painted soft shading',
    palette: 'pale blue-green, frosty white, grey-blue shadows',
    composition: 'tuft base at the bottom centre of the frame, front-on side view',
  },
];

export const foliageJobs: JobSpec[] = CARDS.map((c) => ({
  id: c.id,
  group: 'foliage',
  kind: 'foliage',
  aspect: 'square',
  size: 512,
  transparent: true,
  key: '#ff00ff',
  post: CARD_POST,
  prompt: {
    useCase: 'stylized-concept',
    assetType: 'RGBA foliage card texture mapped on flat quads for a 3D game (tree canopies, undergrowth)',
    subject: c.subject,
    style: PAINTERLY + '; stylized foliage with clear leaf shapes and a clean silhouette, not photorealistic',
    composition: (c.composition ?? 'front-on flat view, the cluster fills about 85% of the frame, centred') + ', cut-out sprite style',
    lighting: 'soft even light with gentle painted top-to-bottom shading, no cast shadows on the background',
    palette: c.palette,
    materials: c.materials,
    constraints: 'single isolated subject, no ground, no trunk, no sky, no text, no watermark',
    avoid: 'background scenery, drop shadow, glow, blur, photorealism, vector flat look',
  },
}));

// --- Bark tileables (trunk wrap; tile vertically along the trunk and horizontally around it)
interface BarkDef {
  id: string;
  subject: string;
  materials: string;
  palette: string;
}

const BARKS: BarkDef[] = [
  {
    id: 'tex_bark_pine',
    subject: 'pine tree bark: thick vertical plates with deep furrows between them',
    materials: 'rough scaly reddish-brown plates, dark furrows, lighter orange-brown ridges',
    palette: 'reddish brown, dark umber furrows, warm orange highlights',
  },
  {
    id: 'tex_bark_oak',
    subject: 'old oak tree bark: rugged vertical ridges and deep irregular fissures',
    materials: 'gnarly grey-brown ridged bark, mossy hints in the fissures, rough wood fibres',
    palette: 'grey-brown, dark brown fissures, olive moss hints',
  },
  {
    id: 'tex_bark_birch',
    subject: 'pale birch-like bark: smooth white-grey papery bark with dark horizontal lenticel marks and a few peeling curls',
    materials: 'thin papery layers, dark charcoal horizontal scars, subtle cream and grey variation',
    palette: 'cream white, pale grey, charcoal black marks, faint warm tan',
  },
  {
    id: 'tex_bark_charred',
    subject: 'charred burnt tree bark: black cracked blocky char plates with glowing deep-red ember cracks between them',
    materials: 'carbonised wood alligator-skin pattern, dull glowing red-orange ember in the deepest cracks, white ash flecks',
    palette: 'coal black, dark grey, deep red-orange embers, a little white ash',
  },
];

export const barkJobs: JobSpec[] = BARKS.map((b) => ({
  id: b.id,
  group: 'bark',
  kind: 'bark',
  aspect: 'square',
  size: 512,
  tiling: true,
  post: [
    { op: 'flatten', strength: 0.5 },
    { op: 'tile' },
    { op: 'resize', w: 512 },
    { op: 'normal', strength: 3.2, blur: 0.8 },
    { op: 'webp', quality: 84, normalQuality: 88 },
  ],
  prompt: {
    useCase: 'stylized-concept',
    assetType: 'seamless tileable tree bark texture (albedo) wrapped around 3D tree trunks, vertical grain',
    subject: b.subject,
    style: PAINTERLY + '; stylized bark with clear carved-looking relief, not photorealistic',
    composition: 'flat front-on close-up of the bark surface filling the entire frame, ridges running vertically',
    lighting: 'soft neutral even light, no strong directional shadows',
    palette: b.palette,
    materials: b.materials,
    constraints: TILEABLE_CONSTRAINTS.replace('viewed straight down from above (orthographic, no perspective, no horizon)', 'flat front-on orthographic view'),
    avoid: TILEABLE_AVOID.replace('trees, ', ''),
  },
}));
