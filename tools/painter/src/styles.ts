// Prompt construction for the repaint stage. Text style descriptions only: no reference imagery of any existing game is ever sent.
export interface StylePreset {
  /** one-paragraph description of the painting technique */
  technique: string;
  /** how light/shadow may appear (the engine adds its own lighting and an AO multiplier) */
  lighting: string;
  /** material rendering hints appended per subject kind */
  materials: Record<string, string>;
}

export const STYLES: Record<string, StylePreset> = {
  fantasy: {
    technique:
      'stylized hand-painted fantasy MMORPG texture art in the tradition of classic 2000s Korean online RPG character and monster textures: ' +
      'visible confident brush strokes, rich saturated yet earthy colour, crisp readable colour blocking, bold value contrast (deep near-black darks, bright warm lights), ' +
      'hand-drawn texture detail instead of 3D shading, stylised not photorealistic, no CGI render look, no plastic gloss, no noise filter',
    lighting:
      'paint it as an ALBEDO / diffuse colour map with only soft painted value variation: lighter on the upper surfaces and tops, darker and cooler in the underside, inside of legs, under the chin and armpits ' +
      '(hemispheric top light, consistent in every view). NO cast shadows, NO specular highlights, NO rim light, NO drop shadow on the ground, NO ambient-occlusion halo around the silhouette. ' +
      'The existing clay shading in the input is only a form guide: do not keep its grey look, do not keep its dark outline.',
    materials: {
      fur:
        'FUR: the fur must read as soft hair, never as feathers, scales, leaves or shingle-like scallops: paint thin, tapering, slightly wavy hair strands in flowing clumps, with dense directional strands following the body flow (along the back, down the flanks and legs, radiating from the face and ears, tufted at cheeks, ruff, elbows, hocks and tail tip), ' +
        'clumped guard hairs with lighter tips and darker roots, a few contrasting streaks and a clearly different colour on belly, chest, inner legs and muzzle, fine whiskers area, clean dark nose, wet glossy dark eye with a warm iris, ' +
        'inner ears and gums painted in believable pinks, bone-white fangs, dark claws and paw pads',
      scale:
        'SCALES / HIDE: paint overlapping scales or plates with a clear size gradient, darker edges between scales, lighter centres, ridge spikes and horns in bone/ivory colours, leathery wing or belly skin with veins, glowing eyes',
      cloth:
        'CLOTH AND ARMOUR: paint woven cloth with fold highlights and dark creases, stitched seams, trim in contrasting colour, lacquered plate armour and polished metal with painted reflections (bright edge highlights, dark cores), leather with scuffs, worn edges',
      skin:
        'SKIN: paint stylised skin with warm undertones and cool shadows, defined brows/eyes/lips, hair with clumped strand highlights, nails; no photographic pores',
      stone:
        'STONE AND METAL: paint chipped carved stone with cracks, moss and mineral veins, or forged metal with scratches, rivets and warm/cool edge highlights; glowing runes or gems where the form suggests them',
      wood:
        'WOOD: paint grain lines, knots, painted lacquer or peeling paint, iron bands, rope wraps',
      metal:
        'METAL AND LACQUER: paint forged steel with scratches, hammered facets and bright warm/cool edge highlights over dark cores, brass and gold trim, red or black lacquer, leather wraps with stitching, engraved ornaments, small gems',
      spirit:
        'SPIRIT / ENERGY BODY: paint a luminous translucent-looking ghostly body with soft cool inner glow, darker wispy edges, glowing eyes and runes, flowing cloth-like strands',
    },
  },
};

export interface PromptInput {
  subject: string;
  style: string;
  /** view names present in the sheet, in reading order, e.g. ["left side","right side"] */
  viewLabels: string[];
  bgName: string;
  material: string;
  /** extra free text appended by the caller (e.g. palette) */
  extra?: string;
}

export function buildPrompt(i: PromptInput): string {
  const s = STYLES[i.style];
  if (!s) throw new Error(`unknown style '${i.style}' (have: ${Object.keys(STYLES).join(', ')})`);
  const mat = i.material.split('+').map((m) => s.materials[m.trim()] ?? '').filter(Boolean).join(' ');
  return [
    `This image is a 3D-model turnaround sheet of ONE game creature/character/object: ${i.subject}.`,
    `It shows the same model from ${i.viewLabels.length} fixed orthographic camera angles (${i.viewLabels.join('; ')}) rendered as grey clay on a flat ${i.bgName} background.`,
    '',
    'TASK: repaint the model in every view as finished, production-quality painted texture art, keeping the sheet EXACTLY as laid out.',
    'HARD GEOMETRY RULES (the result is projected back onto the 3D mesh, so any drift ruins it): every view must keep its exact silhouette outline, pose, proportions, size and position on the canvas;',
    'do not move, rotate, resize, mirror, crop, reorder, add or remove any view; do not add legs, tails, ears, horns or weapons that are not in the clay; do not redraw the anatomy;',
    `leave the flat ${i.bgName} background completely untouched and flat (no ground, no shadow, no gradient, no text, no labels, no frame, no arrows).`,
    'All views are the same object: every colour, marking, scar and material must stay consistent between views and continue seamlessly across the views (the top view must match the upper sides, the front view must match the chest and face, the back view the rump and tail).',
    '',
    `PAINT STYLE: ${s.technique}.`,
    `LIGHTING: ${s.lighting}`,
    mat ? `MATERIAL: ${mat}.` : '',
    i.extra ? `DETAILS: ${i.extra}` : '',
    '',
    'Output one single image with the same canvas aspect ratio, all views present, nothing cropped.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const VIEW_LABELS: Record<string, string> = {
  left: 'left side',
  right: 'right side',
  front: 'front',
  back: 'back',
  top: 'top-down',
  bottom: 'underside',
  '3q': 'three-quarter view from above-front-left',
  '3q_back': 'three-quarter view from above-behind-right',
  '3q_r': 'three-quarter view from above-front-right',
  '3q_back_l': 'three-quarter view from above-behind-left',
};

export function bgColorName(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const name = r > 200 && b > 200 && g < 60 ? 'magenta' : g > 200 && b > 200 && r < 60 ? 'cyan' : g > 200 && r < 60 && b < 60 ? 'green' : r > 200 && g > 200 && b < 60 ? 'yellow' : 'solid';
  return `pure ${name} (${hex})`;
}
