import type { JobSpec, PostOp } from '../types';
import { PAINTERLY, TILEABLE_AVOID, ZONE_PALETTE } from './style';

const UI_TILE_CONSTRAINTS =
  'perfectly seamless tileable texture whose content continues across all four edges; flat orthographic front view, even lighting with no baked directional gradient, no vignette; ' +
  'uniform detail density across the entire image, no focal objects; no text, no border, no frame, no watermark';

function tileJob(id: string, subject: string, materials: string, palette: string, extra: { flatten?: number; q?: number } = {}): JobSpec {
  return {
    id,
    group: 'ui',
    kind: 'ui',
    aspect: 'square',
    size: 512,
    tiling: true,
    post: [
      { op: 'flatten', strength: extra.flatten ?? 0.5 },
      { op: 'tile' },
      { op: 'resize', w: 512 },
      { op: 'webp', quality: extra.q ?? 86 },
    ],
    prompt: {
      useCase: 'stylized-concept',
      assetType: 'seamless tileable UI surface texture (CSS background) for a dark East-Asian fantasy game interface',
      subject,
      style: PAINTERLY + '; subtle surface texture that stays quiet behind text and icons',
      composition: 'flat orthographic close-up of the material filling the whole frame',
      lighting: 'soft even light, gentle sheen, no strong highlights',
      palette,
      materials,
      constraints: UI_TILE_CONSTRAINTS,
      avoid: TILEABLE_AVOID,
    },
  };
}

const CUTOUT_AVOID = 'drop shadow, glow, background scenery, perspective tilt, photorealism, text, letters, watermark';

const keyed = (more: PostOp[]): PostOp[] => [{ op: 'alpha', key: '#ff00ff', t0: 60, t1: 130, erode: 1, feather: 0.7 }, ...more];

const ZONES: { id: string; subject: string; palette: string }[] = [
  {
    id: 'art_zone_yeonmu',
    subject:
      'Yeonmu Plains: a sunlit green plains valley with a weathered stone gate arch in Korean-Chinese pagoda style with red banners, a small river, a pack of wolves on a rock and a wild boar in the grass; ' +
      'a dark rune-carved metin stone has crashed into the meadow glowing green; pink blossom tree, waterfalls in distant cliffs',
    palette: ZONE_PALETTE.yeonmu,
  },
  {
    id: 'art_zone_suryeon',
    subject:
      'Suryeon Valley: a dry ochre canyon valley with a crude orc war camp of hide tents, spiked palisades and tattered banners, a hulking orc chieftain silhouette beside a bonfire; ' +
      'a dark rune-carved metin stone embedded in the valley floor glowing orange; red cliff walls, dust haze, vultures',
    palette: ZONE_PALETTE.suryeon,
  },
  {
    id: 'art_zone_seori',
    subject:
      'Seori Mountain: a frozen mountain pass with jagged snowy peaks, a snow-laden pagoda shrine with glowing lanterns, a frozen waterfall, a hulking yeti on a ridge in a snowstorm; ' +
      'a dark rune-carved metin stone half-buried in the snow glowing icy blue; cold blue-lavender light',
    palette: ZONE_PALETTE.seori,
  },
  {
    id: 'art_zone_daeryeol',
    subject:
      'Daeryeol: a volcanic hellscape of black basalt and rivers of lava under an ember-filled red sky, the ruins of a scorched fortress pagoda, flame spirits and a giant red dragon silhouette circling above; ' +
      'a dark rune-carved metin stone cracking open with crimson light in the foreground',
    palette: ZONE_PALETTE.daeryeol,
  },
];

export const uiJobs: JobSpec[] = [
  tileJob(
    'ui_panel_wood',
    'dark lacquered wood panel surface: very dark brown-black wood with a faint red undertone, fine straight vertical grain, glossy lacquer sheen and a few tiny gold-dust flecks',
    'polished dark lacquer over fine grain, subtle wear, very low contrast detail',
    'near-black brown, deep burgundy undertone, faint warm gold flecks',
  ),
  tileJob(
    'ui_panel_stone',
    'dark carved stone panel surface: charcoal slate stone with a very faint carved repeating cloud-scroll relief pattern and fine chisel marks',
    'smooth dark granite with shallow carved relief, subtle blue-grey tones, low contrast detail',
    'charcoal, slate blue-grey, cool dark shadows, faint warm grey highlights',
    { flatten: 0.55 },
  ),
  tileJob(
    'ui_lacquer_red',
    'deep red lacquer surface: rich crimson-vermilion urushi lacquer with a smooth glossy sheen, faint brush-flow variations and a few tiny gold flecks',
    'glossy red lacquer, soft brush marks, subtle depth, very low contrast detail',
    'deep crimson, vermilion, dark red shadows, thin gold flecks',
    { flatten: 0.6 },
  ),
  tileJob(
    'ui_parchment',
    'aged parchment paper: warm tan cream paper with visible fibres, faint age stains and soft darker mottling, no writing',
    'handmade paper fibres, soft stains, very low contrast detail',
    'warm cream, tan, pale ochre, soft brown mottling',
    { flatten: 0.6 },
  ),
  {
    id: 'ui_border_gold',
    group: 'ui',
    kind: 'ui',
    aspect: 'square',
    size: 512,
    transparent: true,
    key: '#ff00ff',
    post: keyed([{ op: 'trim', pad: 0 }, { op: 'resize', w: 512, h: 512, mode: 'exact' }, { op: 'symmetrize', axis: 'xy' }, { op: 'bleed' }, { op: 'webp', quality: 90 }]),
    prompt: {
      useCase: 'ui-mockup',
      assetType: 'ornate 9-slice UI frame border (CSS border-image) for a dark East-Asian fantasy game',
      subject:
        'a square ornamental frame seen perfectly straight-on: burnished gold filigree with a thin plain beaded gold molding along the straight edges and rich corner ornaments in dragon-scroll and cloud motifs, ' +
        'perfectly symmetric left-right and top-bottom; the whole inside of the frame and the whole outside are the flat background colour',
      style: PAINTERLY + '; metallic gold leaf with fine engraved detail, crisp edges',
      composition: 'the frame fills the canvas edge to edge, straight edges exactly horizontal and vertical, corners identical, the inner area completely empty',
      lighting: 'soft even light with warm gold highlights, no shadows',
      palette: 'burnished gold, warm bronze shadows, a hint of deep red enamel in the corner ornaments',
      constraints: 'frame only, empty centre, thin straight edges that can be stretched (no ornament along the middle of each side), no text, no watermark',
      avoid: CUTOUT_AVOID + ', inner panel fill, gradient inside the frame',
    },
  },
  {
    id: 'ui_btn_red',
    group: 'ui',
    kind: 'ui',
    aspect: 'landscape',
    size: { w: 768, h: 256 },
    transparent: true,
    key: '#ff00ff',
    post: keyed([{ op: 'trim', pad: 2 }, { op: 'resize', w: 768, h: 256, mode: 'exact' }, { op: 'bleed' }, { op: 'webp', quality: 90 }]),
    prompt: {
      useCase: 'ui-mockup',
      assetType: 'wide UI button plate (CSS border-image 9-slice) for a dark East-Asian fantasy game',
      subject:
        'a wide horizontal button plate with softly rounded corners: glossy deep-red lacquer face with a thin burnished gold rim and tiny gold corner caps; ' +
        'the face is plain and calm so a text label can be placed on it',
      style: PAINTERLY + '; glossy lacquer, crisp gold edges',
      composition: 'perfectly front-on and flat, the plate fills the width of the frame (roughly 3:1 proportions) centred vertically, no perspective',
      lighting: 'soft top-lit glossy highlight band across the upper third of the face, gentle falloff',
      palette: 'deep crimson, vermilion highlight, burnished gold rim, dark red shadow at the bottom edge',
      constraints: 'one button plate only, no text, no icon, no symbol on the face, no watermark',
      avoid: CUTOUT_AVOID,
    },
  },
  {
    id: 'ui_logo',
    group: 'ui',
    kind: 'ui',
    aspect: 'wide',
    size: { w: 1024, h: 480 },
    transparent: true,
    key: '#ff00ff',
    post: keyed([{ op: 'trim', pad: 8 }, { op: 'resize', w: 1024, mode: 'fit' }, { op: 'bleed' }, { op: 'webp', quality: 92 }]),
    prompt: {
      useCase: 'logo-brand',
      assetType: 'game logo lock-up for "Metin Survivors", an East-Asian fantasy action roguelite',
      subject:
        'the title lettering "METIN" in very large bold carved capital letters over the word "SURVIVORS" in smaller wide-spaced capitals; ' +
        'letters look like burnished gold leaf inlaid on dark red lacquer with a deep crimson outline and a cracked black obsidian stone texture on the inner bevel; ' +
        'a slender ornamental dragon-scroll flourish and a small glowing crimson metin stone shard rising behind the middle letters',
      style: PAINTERLY + '; premium game title logo, crisp hard edges, strong readable silhouette',
      composition: 'centred lock-up on a wide canvas, two lines of text, ornament tightly integrated with the letters, comfortable margin around it',
      lighting: 'warm top-lit metallic highlights, no outer glow',
      palette: 'burnished gold, deep crimson, near-black obsidian, small hot-orange accents',
      text: 'METIN SURVIVORS',
      constraints: 'spell the text exactly "METIN" and "SURVIVORS", no other text, no tagline, no watermark',
      avoid: 'outer glow, halo, drop shadow, soft shadow, background scenery, extra words, misspelled letters, Latin-with-diacritics',
    },
  },
  {
    id: 'ui_keyart_menu',
    group: 'ui',
    kind: 'illustration',
    aspect: 'wide',
    size: { w: 1600, h: 900 },
    post: [{ op: 'resize', w: 1600, h: 900, mode: 'cover' }, { op: 'webp', quality: 82 }],
    prompt: {
      useCase: 'illustration-story',
      assetType: 'main menu key art (full-screen background) for "Metin Survivors", a fantasy action roguelite',
      subject:
        'glowing crimson-and-gold Metin stones (dark rune-carved stone obelisks with orange glowing glyphs) falling like meteors from a cracked, burning sky over a misty East-Asian mountain valley with multi-tier pagodas, stone bridges, waterfalls and glowing lanterns; ' +
        'a lone armoured swordsman with a red cloak seen from behind stands on a rocky ledge in the lower left',
      style: PAINTERLY + '; cinematic matte painting, dramatic volumetric light and mist',
      composition: 'wide cinematic composition, the brightest falling stone upper centre-right, the swordsman small in the lower left, calm darker area at the left and lower third where menu buttons will be overlaid',
      lighting: 'fiery red-orange light from the cracked sky, cool blue-grey mist in the valley, warm lantern glows',
      palette: 'crimson, ember orange, gold, deep charcoal rock, cool grey-blue mist',
      constraints: 'no text, no logo, no watermark, no UI',
      avoid: 'Japanese torii gates (use Korean/Chinese pagoda gates, paifang, hongsalmun instead), text, photorealism',
    },
  },
  ...ZONES.map(
    (z): JobSpec => ({
      id: z.id,
      group: 'ui',
      kind: 'illustration',
      aspect: 'portrait',
      size: { w: 640, h: 960 },
      post: [{ op: 'resize', w: 640, h: 960, mode: 'cover' }, { op: 'webp', quality: 82 }],
      prompt: {
        useCase: 'illustration-story',
        assetType: 'zone selection card illustration for "Metin Survivors"',
        subject: z.subject,
        style: PAINTERLY + '; storybook concept art with a clear focal subject and atmospheric depth',
        composition: 'portrait vertical composition, strong focal subject (the metin stone) in the middle third, layered foreground / midground / background',
        lighting: 'dramatic, strongly colour-themed zone lighting',
        palette: z.palette,
        constraints: 'no text, no logo, no frame, no border, no watermark, no UI',
        avoid: 'Japanese torii gates, text, photorealism, border',
      },
    }),
  ),
  // --- UI agent requests: RGBA cut-outs
  ...(['closed', 'open'] as const).map(
    (state): JobSpec => ({
      id: `art_chest_${state}`,
      group: 'ui',
      kind: 'illustration',
      aspect: 'square',
      size: 512,
      transparent: true,
      key: '#ff00ff',
      post: keyed([{ op: 'trim', pad: 4 }, { op: 'resize', w: 512, mode: 'contain' }, { op: 'bleed' }, { op: 'webp', quality: 90 }]),
      prompt: {
        useCase: 'stylized-concept',
        assetType: 'treasure chest sprite for the chest-reward modal of a dark East-Asian fantasy roguelite',
        subject:
          'a dark red-lacquered wooden treasure chest with burnished-gold corner fittings, bands and a dragon-scroll lock plate, seen in three-quarter front view' +
          (state === 'open'
            ? '; the lid is wide open and warm golden light spills out of the chest from inside, lighting the underside of the lid; the light stays inside the chest silhouette, nothing glows outside the chest outline'
            : '; the lid is closed and latched'),
        style: PAINTERLY + '; polished game-art chest with crisp gold highlights and glossy lacquer',
        composition: 'single centred object filling about 85% of the frame, slight top-down three-quarter view, cut-out sprite style',
        lighting: 'soft top-left key light, glossy highlights on the lacquer and gold',
        palette: 'deep crimson lacquer, burnished gold, dark brown wood shadows' + (state === 'open' ? ', warm golden interior glow' : ''),
        constraints: 'one chest only, no text, no coins spilling outside, no watermark',
        avoid: CUTOUT_AVOID,
      },
    }),
  ),
  {
    id: 'art_metin_essence',
    group: 'ui',
    kind: 'illustration',
    aspect: 'portrait',
    size: { w: 512, h: 768 },
    transparent: true,
    key: '#ff00ff',
    post: keyed([{ op: 'trim', pad: 4 }, { op: 'resize', w: 512, h: 768, mode: 'contain' }, { op: 'bleed' }, { op: 'webp', quality: 90 }]),
    prompt: {
      useCase: 'stylized-concept',
      assetType: 'metin stone hero illustration for the metin-essence reward modal (recoloured in the UI per metin type)',
      subject:
        'a tall dark obsidian metin monolith: a faceted standing stone with broken angular planes, glowing orange rune glyphs and glowing cracks across its faces, ' +
        'a thin faint haze hugging its base; invented original rune shapes, no real alphabet',
      style: PAINTERLY + '; dramatic polished game illustration, crisp facets, glossy obsidian highlights',
      composition: 'single centred monolith filling the frame vertically, straight front view with a slight low angle, cut-out sprite style',
      lighting: 'the rune glow is the main light source, soft cool rim light on the facet edges, the glow stays on the stone surface',
      palette: 'near-black obsidian, hot orange rune glow, faint warm haze',
      constraints: 'one monolith only, no ground, no text, no watermark, glow confined to the stone surface (no outer halo)',
      avoid: CUTOUT_AVOID + ', outer glow',
    },
  },
  {
    id: 'ui_divider_gold',
    group: 'ui',
    kind: 'ui',
    aspect: 'wide',
    size: { w: 1024, h: 64 },
    transparent: true,
    key: '#ff00ff',
    post: keyed([{ op: 'trim', pad: 2 }, { op: 'symmetrize', axis: 'x' }, { op: 'resize', w: 1024, mode: 'fit' }, { op: 'bleed' }, { op: 'webp', quality: 90 }]),
    prompt: {
      useCase: 'ui-mockup',
      assetType: 'thin ornamental horizontal divider line for UI panels in a dark East-Asian fantasy game',
      subject:
        'an extremely wide and thin horizontal gold divider (about 16:1 proportions): a slender burnished-gold line that tapers to fine points at both ends, with a small ornamental lotus and dragon-scroll knot in the exact centre, perfectly symmetric left to right',
      style: PAINTERLY + '; metallic gold leaf with fine engraved detail, crisp edges',
      composition: 'centred horizontally and vertically, spanning most of the canvas width, perfectly straight and horizontal, nothing else in the frame',
      lighting: 'soft even light with warm gold highlights',
      palette: 'burnished gold, warm bronze shadows, a hint of crimson in the central knot',
      constraints: 'divider only, no text, no frame, no watermark',
      avoid: CUTOUT_AVOID,
    },
  },
];
