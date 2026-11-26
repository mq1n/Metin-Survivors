import type { JobSpec } from '../types';
import { PAINTERLY, TILEABLE_AVOID } from './style';

const RUNE_COMMON =
  'pure white luminous glyph strokes with a soft bloom glow on a perfectly pure black (#000000) background, strictly monochrome white and pale-grey light only (no colour), ' +
  'invented original rune glyphs: angular, brush-carved, East-Asian-inspired but NOT any real alphabet, NOT Chinese/Korean/Japanese characters, NOT existing game runes; ' +
  'every glyph clearly separate with thick enough strokes to read at small size; no text, no letters, no numbers, no watermark, no border, no frame';

interface RuneDef {
  id: string;
  subject: string;
  /** crop (fractions) applied before resizing, for designs that only fill part of the square */
  crop?: { x: number; y: number; w: number; h: number };
}

const RUNES: RuneDef[] = [
  {
    id: 'tex_rune_a',
    subject: 'a tall vertical inscription: one column of eight stacked invented glyphs, each inside a thin angular cartouche, connected by a thin glowing spine line, centred in the frame',
    crop: { x: 0.34, y: 0, w: 0.32, h: 1 },
  },
  {
    id: 'tex_rune_b',
    subject: 'a circular ritual seal: concentric thin rings with a ring of twelve invented glyphs between two of the rings, radiating angular spokes, and a central diamond sigil; perfectly centred and symmetric',
  },
  {
    id: 'tex_rune_c',
    subject: 'a network of jagged glowing fissure cracks spreading from the centre across the frame like shattered stone, with small invented glyph marks dotted along the cracks',
  },
];

export const metinJobs: JobSpec[] = [
  {
    id: 'tex_metin_obsidian',
    group: 'metin',
    kind: 'rock',
    aspect: 'square',
    size: 512,
    tiling: true,
    post: [
      { op: 'flatten', strength: 0.5 },
      { op: 'tile' },
      { op: 'resize', w: 512 },
      { op: 'normal', strength: 3.4, blur: 0.9 },
      { op: 'webp', quality: 86, normalQuality: 88 },
    ],
    prompt: {
      useCase: 'stylized-concept',
      assetType: 'seamless tileable surface texture (albedo) for monolithic dark stone obelisks in a 3D game',
      subject: 'dark obsidian-like black stone surface with glossy conchoidal fracture facets, fine pale violet-grey mineral veins running through it, and small chips and scratches; no glow, no light emission',
      style: PAINTERLY + '; stylized hand-painted stone with clear faceted relief, not photorealistic',
      composition: 'flat orthographic close-up of the stone surface filling the entire frame',
      lighting: 'soft neutral even light, subtle glossy highlights on facet edges, no directional shadows',
      palette: 'near-black charcoal, cool dark grey-violet, thin pale lavender-grey veins, faint warm brown tint in the chipped edges',
      materials: 'polished volcanic glass and rough chipped stone, fine veins',
      constraints:
        'perfectly seamless tileable texture whose content continues across all four edges; even lighting; uniform detail density across the entire image; no large focal feature; no text; no border; no watermark',
      avoid: TILEABLE_AVOID,
    },
  },
  ...RUNES.map(
    (r): JobSpec => ({
      id: r.id,
      group: 'metin',
      kind: 'rune',
      aspect: 'square',
      size: 512,
      post: r.crop
        ? [{ op: 'crop', ...r.crop }, { op: 'resize', w: 640, mode: 'fit' }, { op: 'grade', saturation: 0.05, contrast: 1.12 }, { op: 'webp', quality: 88 }]
        : [{ op: 'resize', w: 512 }, { op: 'grade', saturation: 0.05, contrast: 1.12 }, { op: 'webp', quality: 88 }],
      prompt: {
        useCase: 'stylized-concept',
        assetType: 'emissive rune texture mapped on dark stone monoliths in a 3D game (tinted by the engine at runtime)',
        subject: r.subject,
        style: 'luminous calligraphic rune engraving, crisp glowing lines, painterly but clean',
        composition: 'flat orthographic front view, centred, generous black margin around the design',
        lighting: 'self-illuminated glow only, strong white core with a soft falloff bloom, nothing else lit',
        palette: 'white and pale grey on pure black',
        constraints: RUNE_COMMON,
        avoid: 'colour, gradients in the background, textures in the black, stone surface, 3D objects, smoke, perspective',
      },
    }),
  ),
];

// --- Sigil sheet (request from Metins): 16 distinct medallions generated one by one, composed 4×4 into 2048².
const SIGILS: { n: string; subject: string }[] = [
  { n: 'sorrow', subject: 'a weeping-motif medallion: a thick outer ring, inside it a downward-curving crescent with three falling droplet strokes and a split vertical axis' },
  { n: 'battle', subject: 'a clashing-motif medallion: a thick outer ring, inside it two crossed angular blade strokes forming a star and a short bar above' },
  { n: 'war', subject: 'a war medallion: a thick outer ring broken by four notches, inside a bold angular horned crown shape above three stacked chevrons' },
  { n: 'greed', subject: 'a greed medallion: a double ring, inside a coin-like circle with a square hole crossed by a spiral hook stroke, with four small dots' },
  { n: 'black', subject: 'an eclipse medallion: a thick ring, inside a disc with a thin offset crescent rim and radiating short angular rays only on one side' },
  { n: 'shadow', subject: 'a shadow medallion: a thick ring, inside a mirrored pair of tall flame-like strokes with a thin horizontal line between them, as if reflected in water' },
  { n: 'devil', subject: 'a demon medallion: a pointed-arch ring with two curved horn strokes rising from the top, inside a fanged angular mouth-like zigzag' },
  { n: 'death', subject: 'a death medallion: a ring with a skull-like geometric face made of three angular strokes, below it a ladder of five short bars' },
  { n: 'killer', subject: 'a killer medallion: a thick ring, inside a single long diagonal fang stroke crossed by three short slashes and a dot' },
  { n: 'great', subject: 'a great medallion: three concentric rings with eight outward spikes like a sun, inside a bold diamond holding a smaller diamond and a vertical axis line' },
  { n: 'storm', subject: 'a storm medallion: a ring, inside three nested spiral hooks like a gale and two jagged lightning strokes' },
  { n: 'frost', subject: 'a frost medallion: a hexagonal outer ring, inside a six-armed angular snowflake sigil with small barbs' },
  { n: 'flame', subject: 'a flame medallion: a ring, inside a tall angular flame composed of five sharp strokes above a triple horizontal base line' },
  { n: 'serpent', subject: 'a serpent medallion: a ring, inside an S-shaped coiled angular serpent stroke with a small diamond head and a tail spiral' },
  { n: 'tiger', subject: 'a beast medallion: a ring, inside four claw-mark diagonal strokes crossed by a short horizontal bar and two dot eyes above' },
  { n: 'dragon', subject: 'a dragon medallion: a double ring, inside a long angular dragon-scroll glyph with a curling tail and two small horns' },
];

const sigilPart = (s: { n: string; subject: string }): JobSpec => ({
  id: `part_sigil_${s.n}`,
  group: 'metin_parts',
  kind: 'rune',
  partOnly: true,
  aspect: 'square',
  size: 512,
  post: [],
  prompt: {
    useCase: 'stylized-concept',
    assetType: 'one emissive rune medallion sigil (part of a 4×4 sheet) for dark stone monoliths in a 3D game',
    subject: `${s.subject}; a single hand-carved medallion with strokes about 12 px wide when the image is 512 px, centred and filling about 80% of the frame`,
    style: 'luminous angular brush-carved rune engraving, crisp glowing lines',
    composition: 'flat orthographic front view, one medallion, perfectly centred, about 10% black margin all around',
    lighting: 'self-illuminated glow only, strong white core with a soft falloff bloom, nothing else lit',
    palette: 'white and pale grey on pure black',
    constraints: RUNE_COMMON,
    avoid: 'colour, background texture, multiple medallions, stone surface, 3D objects, smoke, perspective, thin hairline strokes',
  },
});

export const sigilJobs: JobSpec[] = [
  ...SIGILS.map(sigilPart),
  {
    id: 'tex_rune_sigils',
    group: 'metin',
    kind: 'rune',
    aspect: 'square',
    size: 2048,
    compose: { cols: 4, rows: 4, cell: 512, parts: SIGILS.map((s) => `part_sigil_${s.n}`) },
    post: [{ op: 'grade', saturation: 0.05, contrast: 1.12 }, { op: 'webp', quality: 90 }],
    prompt: 'composed from part_sigil_* jobs',
  },
  {
    id: 'tex_rune_bands',
    group: 'metin',
    kind: 'rune',
    aspect: 'wide',
    size: { w: 2048, h: 512 },
    post: [{ op: 'crop', x: 0, y: 0.285, w: 1, h: 0.43 }, { op: 'resize', w: 2048, h: 512, mode: 'exact' }, { op: 'grade', saturation: 0.05, contrast: 1.12 }, { op: 'webp', quality: 90 }],
    prompt: {
      useCase: 'stylized-concept',
      assetType: 'emissive rune inscription band for dark stone monoliths in a 3D game (tinted by the engine at runtime)',
      subject:
        'a single horizontal row of ten small distinct invented rune glyphs, each inside its own thin angular rectangular cartouche, evenly spaced and connected by a thin glowing line along the middle, centred vertically in the frame',
      style: 'luminous angular brush-carved rune engraving, crisp glowing lines',
      composition: 'flat orthographic front view; the row spans nearly the full width and sits in the vertical middle third; the rest of the frame is empty black',
      lighting: 'self-illuminated glow only, strong white core with a soft falloff bloom, nothing else lit',
      palette: 'white and pale grey on pure black',
      constraints: RUNE_COMMON,
      avoid: 'colour, background texture, stone surface, 3D objects, smoke, perspective, a second row, glyphs touching the edges',
    },
  },
];
