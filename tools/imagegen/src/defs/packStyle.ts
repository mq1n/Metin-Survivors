// PACK mode text (docs/ART.md s9): ONE generated 2 x 2 sheet that carries FOUR DIFFERENT icon ids of the same collection and
// form. Not to be confused with the grade-sheet (hint `grades`, iconStyle.tileGridGoal): there the four cells are one symbol at

// py/pack.py cuts the sheet into one raw per id and the existing per-id post chain (tile or cut-out) runs on each raw.

/** Cells in reading order (the order of the ids of a pack). */
export const PACK_CELLS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type PackCellName = (typeof PACK_CELLS)[number];
export const PACK_SIZE = PACK_CELLS.length;
/** Side of the generated sheet the job declares (cells ~ a quarter each; the real size is whatever the engine returns). */
export const PACK_SHEET_SIZE = 1024;
/** References attached per cell by default, and the ceiling for the whole sheet (codex -i takes several values; Gemini documents
 *  up to 14 inline images, ChatGPT image input up to 16 - we stay well below, primary reference of each id first). */
export const PACK_REFS_PER_CELL = 2;
export const PACK_MAX_REFS = 8;
export const PACK_MAX_REFS_CEILING = 12;

export const cellLabel = (i: number): string => `cell ${i + 1} (${PACK_CELLS[i]!.toUpperCase()})`;
export const cellUpper = (i: number): string => PACK_CELLS[i]!.toUpperCase();

/** What one cell of a pack is, whatever the form. */
export interface PackCellText {
  name: string;
  /** one sentence: what the icon is (the hint's subject, without the leading name); may be empty */
  subject: string;
  /** tiles: the pictogram concept; cut-outs: the pose / silhouette rule */
  draw: string;
  /** cut-outs: local colours */
  colour?: string;
}

const EMPTY_TILE = 'EMPTY: leave this cell completely black, draw nothing in it';
const EMPTY_CUTOUT = 'EMPTY: leave this cell completely transparent, draw nothing in it';

/** Goal text of a TILE pack: four different white stencil pictograms on black, one per cell. */
export function tilePackGoal(cells: readonly (PackCellText | null)[]): string {
  const lines = cells.map((c, i) => `${cellLabel(i)} = ${c ? `"${c.name}"${c.subject ? ` (${c.subject})` : ''}. Draw: ${c.draw}.` : `${EMPTY_TILE}.`}`);
  return (
    'a 2 x 2 SHEET of FOUR DIFFERENT pictograms: four separate icons of one set for classic ARPG skill-bar tiles, each with its own unrelated ' +
    'symbol (NOT four grades or four variants of one symbol, never the same symbol twice). Four cells of equal size separated by wide pure black ' +
    'gutters (nothing crosses a gutter, nothing touches the sheet border), reading order left to right, top row then bottom row. ' +
    `${lines.join(' ')} ` +
    'Each cell uses ONLY its own text and its own reference images (see the image list); never mix the symbols of two cells. ' +
    'Expectation: bold, flat WHITE stencil pictograms on a pure black background: solid white shapes with crisp clean edges, inner details cut out as ' +
    'black gaps, every stroke at least 1/30 of the sheet wide, each pictogram ONE compact connected silhouette filling about 70 % of its cell, centred in its ' +
    'cell, at the SAME size as the other cells, nothing near the cell borders; each must still read as its own symbol at 32 px. No tile, no frame, no stone ' +
    'ground, no shading, no gradient, no glow, no outline colour, no cell borders, no dividing lines, no text, no letters or letter-like marks, no numbers.'
  );
}

/** Goal text of a CUT-OUT pack: four different inventory objects on a transparent sheet, one per cell. */
export function cutoutPackGoal(cells: readonly (PackCellText | null)[], rendering: string): string {
  const lines = cells.map((c, i) => `${cellLabel(i)} = ${c ? `"${c.name}"${c.subject ? `: ${c.subject}` : ''}. Composition: ${c.draw}. Colours: ${c.colour ?? 'one saturated local hue that tells what it is'}.` : `${EMPTY_CUTOUT}.`}`);
  return (
    'a 2 x 2 SHEET of FOUR DIFFERENT inventory icons: four separate items of one set for a classic ARPG item grid (NOT four views or variants of one item). ' +
    'Four cells of equal size separated by wide, fully transparent gutters, reading order left to right, top row then bottom row; ONE object per cell, centred in its ' +
    'cell, long axis about 75 % of the cell, at least 10 % of the cell empty on every side; nothing crosses a gutter, no two objects touch, nothing touches the sheet ' +
    'border, no cast shadow or ground shared between cells. ' +
    `${lines.join(' ')} ` +
    'Each cell uses ONLY its own text and its own reference images (see the image list); never mix the shapes or colours of two cells. ' +
    `Rendering, the same for every cell: ${rendering}`
  );
}

/** The shared rendering block of a cut-out pack (the per-item part of cutoutGoal's expectation, said once). */
export const CUTOUT_PACK_RENDERING =
  'ONE compact solid object per cell, hand-painted like a classic MMORPG item icon at high resolution: crisp hard-edged cel shading with 3-4 value steps ' +
  'per material, light from the upper left with a bright specular on the top-left facets, darker bottom-right facets, a near-black outline, strong value ' +
  'contrast so every object reads at 32 px, on a genuinely transparent background. No glow cloud, no haze, no smoke, no sparkles, no cast ground, no frame, ' +
  'no cell borders, no text.';

/** The hint's subject without its leading item/skill name ("Bronze Jian, a plain sword" -> "a plain sword"; a bare name -> ""). */
export function subjectOnly(name: string, subject: string): string {
  const s = subject.trim();
  return s.toLowerCase().startsWith(name.toLowerCase()) ? s.slice(name.length).replace(/^[\s:,.\-]+/, '').trim() : s;
}

/** Role sentence of a reference attached for one or more cells: the explicit "Image n = reference for the X cell" mapping. */
export function packRefRole(cells: { index: number; name: string }[], role: string): string {
  const who = cells.map((c) => `the ${cellUpper(c.index)} cell ("${c.name}")`).join(' and ');
  return `reference for ${who} only: ${role.replace(/[.\s]+$/, '')}`;
}
