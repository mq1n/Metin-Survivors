// Icon pipeline v2 style constants — the machine-readable half of docs/ART.md s5 (icons). Numbers come from

// the colours below are our own re-drawn values, reminiscent of the original grammar, never copied pixels.
// Mirrored in tools/imagegen/py/iconkit.py (FAMILIES, RIM, RIM_P) — keep the two in sync.

/** Collections of icon ids (one hint file + one job file each). */
export const ICON_COLLECTIONS = ['skills', 'passives', 'stones', 'trinkets', 'gear', 'talents'] as const;
export type IconCollection = (typeof ICON_COLLECTIONS)[number];

/** tile = octagon skill tile composed in post (glyph generated, ground/rim procedural); cutout = transparent object. */
export type IconForm = 'tile' | 'cutout';




export type TileFamily = 'warm' | 'cool' | 'guild' | 'bright';

/** Rank bands: n = ranks 1-3 (the base id), m = M1-M2, g = G1-G2, p = P (gilded rim). */
export type RankBand = 'n' | 'm' | 'g' | 'p';
export const RANK_BANDS: readonly RankBand[] = ['n', 'm', 'g', 'p'];
/** SKILL_RANKS index 0..7 (1,2,3,M1,M2,G1,G2,P) -> band. */
export const RANK_TO_BAND: readonly RankBand[] = ['n', 'n', 'n', 'm', 'm', 'g', 'g', 'p'];
/** Variant icon id of a band (the base id is band n). The manifest entry of the base id lists them in style.variants. */
export const variantId = (id: string, band: RankBand): string => (band === 'n' ? id : `${id}__${band}`);

export const TILE_FAMILIES: Record<TileFamily, { ground: Record<RankBand, string>; glyph: string | Record<RankBand, string> }> = {
  warm: { ground: { n: '#6e5a24', m: '#7c430f', g: '#5c1a12', p: '#4a1410' }, glyph: '#fff0cf' },
  cool: { ground: { n: '#b4d6cc', m: '#bac3f0', g: '#d6c0f0', p: '#c9b0ea' }, glyph: { n: '#20403c', m: '#121a4a', g: '#26103a', p: '#1e0a30' } },
  guild: { ground: { n: '#36302a', m: '#36302a', g: '#36302a', p: '#36302a' }, glyph: '#e6dccb' },
  bright: { ground: { n: '#efdf92', m: '#f6c39c', g: '#f2a7ae', p: '#f09aa4' }, glyph: { n: '#4a3f0a', m: '#40120a', g: '#3e0a0c', p: '#360810' } },
};




export const TILE_GEOMETRY = { size: 256, chamfer: 0.125, line: 0.012, band: 0.04, inner: 0.012, glyphFill: 0.8 } as const;

/** Our skill doctrines -> tile family (doctrine a warm, doctrine b cool; class-less skills warm). A hint may override. */
export function doctrineFamily(doctrine: string | undefined): TileFamily {
  return doctrine === 'b' ? 'cool' : 'warm';
}

/** Talent node row (0..4) -> the band its tile is shown in (rows I-II n, III-IV m, V g: deeper rows look further ranked). */
export function talentRowBand(row: number | undefined): RankBand {
  const r = row ?? 0;
  return r >= 4 ? 'g' : r >= 2 ? 'm' : 'n';
}

/** Default form per collection. */
export const COLLECTION_FORM: Record<IconCollection, IconForm> = {
  skills: 'tile',
  talents: 'tile',
  passives: 'tile',
  stones: 'cutout',
  trinkets: 'cutout',
  gear: 'cutout',
};

/** Cut-out family templates: composition rule + long-side fill (fraction of the 256 px canvas). */
export interface CutoutTemplate {
  pose: string;
  fill: number;
}
export const CUTOUT_TEMPLATES: Record<string, CutoutTemplate> = {
  stone: { pose: 'an angular faceted crystal shard lying on the diagonal (long axis from lower left to upper right) with hard planar facets', fill: 0.8 },
  sword: { pose: 'a single one-handed sword on the diagonal: blade tip at the upper right, hilt and pommel at the lower left, a thick blade that stays wide at 32 px', fill: 0.9 },
  twohand: { pose: 'a single heavy two-handed blade on the diagonal: tip at the upper right, long grip at the lower left, a broad chunky blade', fill: 0.92 },
  dagger: { pose: 'a single dagger on the diagonal: tip at the upper right, hilt at the lower left, short broad blade', fill: 0.8 },
  bow: { pose: 'a single bow standing upright as a tall arc with its string, slightly turned', fill: 0.9 },
  bell: { pose: 'a single ritual bell upright in 3/4 view with its handle on top', fill: 0.84 },
  fan: { pose: 'a single folding war-fan, opened, upright in 3/4 view', fill: 0.86 },
  claw: { pose: 'a single claw gauntlet in 3/4 view with three or four long curved talons pointing to the upper right', fill: 0.88 },
  armor: { pose: 'a body armour seen from the front, taller than wide, sleeves and the skirt plates hanging down, like it hangs on an invisible mannequin', fill: 0.9 },
  helmet: { pose: 'a helmet in 3/4 view facing left', fill: 0.84 },
  shield: { pose: 'a shield seen from the front, slightly turned', fill: 0.84 },
  shoes: { pose: 'a pair of boots in 3/4 side view, one slightly behind the other', fill: 0.86 },
  bracelet: { pose: 'a single bracelet seen from the side as a band with one to three raised gems', fill: 0.82 },
  necklace: { pose: 'a necklace whose chain forms a closed loop fully inside the canvas with one pendant hanging at the bottom', fill: 0.84 },
  earrings: { pose: 'a pair of earrings: two faceted drop gems hanging from small hooks, side by side', fill: 0.8 },
  trinket: { pose: 'a single compact piece of jewellery in 3/4 view', fill: 0.82 },
};

/** Gear slot / weapon kind -> cut-out template key (weapon kind from the content id: *_weapon_<kind>_t<n>). */
export function cutoutTemplateFor(collection: IconCollection, slot: string | undefined, classes: string[] | undefined, defId = ''): string {
  if (collection === 'stones') return 'stone';
  if (collection === 'trinkets') return slot === 'earring' ? 'earrings' : slot === 'bracelet' || slot === 'necklace' || slot === 'earrings' ? slot : 'trinket';
  if (slot === 'weapon') {
    const kind = /_weapon_([a-z]+)/.exec(defId)?.[1];
    if (kind && CUTOUT_TEMPLATES[kind]) return kind;
    const c = classes?.length === 1 ? classes[0] : undefined;
    return c === 'ninja' ? 'dagger' : c === 'shaman' ? 'bell' : c === 'wolfman' ? 'claw' : 'sword';
  }
  return slot && CUTOUT_TEMPLATES[slot] ? slot : 'trinket';
}


export const CLASS_GEAR_COLOUR: Record<string, string> = {
  warrior: 'steel-white and brass with crimson cloth',
  ninja: 'dark leather, jade green and violet cloth',
  yacha: 'black iron with violet and ember-orange trim',
  shaman: 'ivory, storm blue and gold',
  wolfman: 'crimson-brown hide, indigo and bone',
};
export const TIER_MATERIAL: readonly string[] = [
  'plain iron, leather and cloth with dull brass',
  'polished steel with bronze trim',
  'red-lacquered and jade-inlaid panels',
  'gilded dragon-gold with ONE glowing gem',
];

/** Words a hint subject/glyph may not use (archetype stamps the audit rejected). allowFist ids may use "fist". */
export const BANNED_WORDS: Record<IconCollection | 'all', string[]> = {
  all: ['smoke', 'haze', 'glow cloud', 'abstract emblem', 'sparkles', 'dust motes', 'vignette'],
  skills: ['clenched fist', 'medallion'],
  talents: ['clenched fist', 'medallion', 'swirl', 'pinwheel'],
  passives: ['clenched fist'],
  stones: ['medallion', 'claw setting'],
  trinkets: ['medallion'],
  gear: ['medallion'],
};


export const REF_ROLE_SKILL =
  "the original game's icon for this skill (a 32 px tile, upscaled): borrow the idea and the drawing grammar of its pictogram " +
  '(one bold flat symbol, few strong strokes), but design a new original pictogram; draw only the pictogram, never its tile, frame or stone ground';
export const REF_ROLE_SKILL_STYLE =
  "an original-game skill icon of the same class (a 32 px tile, upscaled), for the drawing grammar only (stroke weight, flat bold symbol); " +
  'do not copy its symbol and never paint its tile, frame or ground';
export const REF_ROLE_TALENT =
  "the original game's icon of the skill or doctrine this talent belongs to (a 32 px tile, upscaled): keep its drawing grammar and " +
  'let the new pictogram echo its idea, but design a new original pictogram; draw only the pictogram, never its tile, frame or ground';
export const REF_ROLE_MEANING =
  "an original-game icon with the same meaning (a 32 px tile, upscaled), for the idea only: do not copy its symbol, tile or ground";
/** Grade-growth jobs (hint `grades`): the original icon (or a similar one) at grade 1, 2 and 3, attached as three refs. */
export const REF_ROLE_GRADE = (n: number, counterpart: boolean): string =>
  `the original game's icon of ${counterpart ? 'this very skill' : 'a similar skill'} at grade ${n} of 3 (a 32 px tile, upscaled): study how its pictogram GROWS ` +
  'with the grade - it keeps the drawing and adds more strokes, blades, rays or chevrons of the same kind - and use only that growth grammar for the ' +
  'new original symbol; never copy its symbol, and draw no tile, frame or ground';
export const REF_ROLE_ITEM_STYLE =
  "an original-game inventory icon of a similar material and colour (32 px, upscaled): match its rendering grammar (compact solid " +
  'object, hard top-left light, crisp dark outline, strong value contrast) but not its shape';
export const REF_ROLE_ITEM =
  "the original game's inventory icon of a similar item (32 px, upscaled): match its rendering grammar (compact solid object, " +
  'hard top-left light, crisp dark outline, strong value contrast, one saturated local hue) and its pose, but paint a new original object at high resolution';

/** Goal text of a tile (glyph) job: the generator only draws the pictogram; the tile is composed in post. */
export function tileGoal(name: string, subject: string, glyph: string): string {
  return (
    `the pictogram of the skill icon "${name}" (${subject}) for a classic ARPG skill bar. Draw: ${glyph}. ` +
    'Expectation: ONE bold, flat WHITE stencil pictogram on a pure black background: solid white shapes with crisp clean edges, ' +
    'inner details cut out as black gaps, every stroke at least 1/22 of the canvas wide, one compact symmetric-ish silhouette filling ' +
    'about 70 % of the canvas, centred, nothing near the border; it must still read as the same symbol at 32 px. ' +
    'No tile, no frame, no stone ground, no shading, no gradient, no glow, no outline colour, no text, no letters or letter-like marks.'
  );
}





export function tileGridGoal(name: string, subject: string, glyph: string, grades: readonly string[]): string {
  return (
    `a 2 x 2 SHEET of the pictogram of the skill icon "${name}" (${subject}) for a classic ARPG skill bar, showing how the ONE symbol ` +
    'grows with the skill grade. Four cells of equal size separated by wide black gutters (nothing crosses the gutters), reading order ' +
    `left to right, top row then bottom row: cell 1 = grade 1, the base pictogram: ${glyph}. ` +
    `Cell 2 = grade 2 = cell 1 plus: ${grades[0]}. Cell 3 = grade 3 = cell 2 plus: ${grades[1]}. Cell 4 = grade 4 = cell 3 plus: ${grades[2]}. ` +
    'Rules: the SAME symbol at the SAME size and the SAME position in every cell, centred in its cell; each grade keeps the previous ' +
    "drawing and grows its OWN strokes (more slashes, blades, rays or chevrons, thicker parts) - never loose shards, sparks, dots or debris scattered " +
    'around it. Expectation: bold, flat WHITE stencil pictograms on a pure black background: solid white shapes with crisp clean edges, inner ' +
    'details cut out as black gaps, every stroke at least 1/30 of the sheet wide, each pictogram filling about 70 % of its cell, centred, ' +
    'nothing near the cell borders; each must still read as the same symbol at 32 px. No tile, no frame, no stone ground, no shading, no ' +
    'gradient, no glow, no outline colour, no cell borders, no text, no letters or letter-like marks, no numbers.'
  );
}

/** Goal text of a cut-out item job. */
export function cutoutGoal(name: string, subject: string, pose: string, colour: string): string {
  return (
    `the inventory icon of "${name}" for a classic ARPG item grid: ${subject}. Composition: ${pose}. ` +
    `Expectation: ONE compact solid object, hand-painted like a classic MMORPG item icon at high resolution: crisp hard-edged cel shading ` +
    `with 3-4 value steps per material, light from the upper left with a bright specular on the top-left facets, darker bottom-right ` +
    `facets, a near-black outline, strong value contrast so it reads at 32 px, ${colour}; the object fills about 85 % of the canvas on ` +
    'its long axis, nothing cropped, on a genuinely transparent background. No glow cloud, no haze, no smoke, no sparkles, no cast ' +
    'ground, no frame, no text.'
  );
}
