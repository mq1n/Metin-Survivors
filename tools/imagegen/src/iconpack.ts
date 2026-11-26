// PACK mode planning (docs/ART.md s9): group icon ids into packs of four, compose ONE sheet prompt per pack and map every

//   bun tools/imagegen/src/cli.ts icons --collection talents --gen --ids a,b,c,d --pack [--variants N] [--dry]
// One pack = one generated image = FOUR DIFFERENT ids (cells top-left, top-right, bottom-left, bottom-right, in `--ids` order).
// Skills with `grades` keep their own 2x2 GRADE sheet (iconjobs.ts, untouched): a pack is for talents, passives, stones, trinkets, gear.
import { createHash } from 'node:crypto';
import { COLLECTION_FORM, CUTOUT_TEMPLATES, cutoutTemplateFor, type IconCollection, type IconForm } from './defs/iconStyle';
import {
  CUTOUT_PACK_RENDERING,
  PACK_CELLS,
  PACK_MAX_REFS,
  PACK_MAX_REFS_CEILING,
  PACK_REFS_PER_CELL,
  PACK_SHEET_SIZE,
  PACK_SIZE,
  cutoutPackGoal,
  packRefRole,
  subjectOnly,
  tilePackGoal,
  type PackCellName,
  type PackCellText,
} from './defs/packStyle';
import { clean, iconJobV2, loadHints, paletteText, readCollectionDefs, templateSubject, type IconDef, type IconHint } from './iconjobs';
import { refRoleSentence } from './prompt';
import { normalizeRefs, resolveRefPath } from './refs';
import type { JobSpec, RefSpec } from './types';

export type Remainder = 'pad' | 'single';

export interface PackGroups {
  /** full packs of 4, plus (remainder 'pad') one padded pack of 2-3 */
  packs: string[][];
  /** ids that are generated as ordinary single jobs (a remainder of 1, or every remainder with `single`) */
  singles: string[];
}

/** Group ids in order into packs of 4. A remainder of 2-3 becomes ONE padded pack (the same 2 x 2 geometry, the unused cells
 *  are explicitly empty) so every pack sheet has identical cell geometry; a remainder of 1 (or any remainder with
 *  `remainder: 'single'`) is generated as a single job. */
export function groupPacks(ids: readonly string[], remainder: Remainder = 'pad'): PackGroups {
  const unique = [...new Set(ids)];
  const packs: string[][] = [];
  let i = 0;
  for (; i + PACK_SIZE <= unique.length; i += PACK_SIZE) packs.push(unique.slice(i, i + PACK_SIZE));
  const rest = unique.slice(i);
  if (rest.length >= 2 && remainder === 'pad') return { packs: [...packs, rest], singles: [] };
  return { packs, singles: rest };
}

/** Deterministic pack id (a valid job id): the same ids in the same order always land in the same gen/<packId>/ directory. */
export function packIdFor(c: IconCollection, ids: readonly string[]): string {
  return `pack_${c}_${createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 8)}`;
}

export interface PackCell {
  /** 0-based position in the pack (reading order) */
  index: number;
  cell: PackCellName;
  id: string;
  name: string;
  /** the id's own single-icon job exactly as `icons --gen` would run it, minus `grades` (post chain: tile or cut-out) */
  job: JobSpec;
  text: PackCellText;
  /** every ref of the single job, roles as in the single job */
  refs: RefSpec[];
  /** the refs attached to the sheet for this cell (cap per cell), as indexes into PackPlan.refs */
  images: number[];
}

export interface PackRef {
  /** 1-based "Image n" of the sheet message */
  n: number;
  /** path as given in the hint / refmap (repo-relative or absolute) */
  path: string;
  src: string;
  /** the full role sentence of the sheet message, naming the cell(s) it belongs to */
  role: string;
  /** 0-based cells that use this image */
  cells: number[];
}

export interface PackPlan {
  packId: string;
  collection: IconCollection;
  form: IconForm;
  ids: string[];
  /** used cells (1-4); the rest of the sheet is explicitly empty */
  n: number;
  cells: PackCell[];
  /** the sheet job: goal (all cells + the shared style once), refs with the cell mapping, post [] (nothing is built from the sheet) */
  job: JobSpec;
  refs: PackRef[];
  /** per-cell refs dropped by the cap (path, cell) */
  dropped: { id: string; path: string }[];
  perCell: number;
}

export interface PackOptions {
  /** references attached per cell (primary first); lowered automatically when the sheet would exceed maxRefs */
  refsPerCell?: number;
  /** ceiling for the whole sheet (default 8, never above 12) */
  maxRefs?: number;
  /** allow skills with `grades` (their hint grades are ignored: the packed raw is a single stencil, bands get stand-in growth) */
  forcePack?: boolean;
}

/** The text of one cell + its single job; `grades` of a skill hint are dropped (a pack never makes grade sheets). */
export function packCell(c: IconCollection, d: IconDef, hint: IconHint | undefined, index: number, opts: PackOptions = {}): PackCell {
  if (hint?.grades?.length && !opts.forcePack) {
    throw new Error(`${d.icon}: the hint has \`grades\` (a 2x2 GRADE sheet, 1 image per icon already): do not pack it (or pass --force-pack to draw it as a single stencil with stand-in growth)`);
  }
  const h: IconHint | undefined = hint?.grades ? { ...hint, grades: undefined } : hint;
  const id = d.icon!;
  const job = iconJobV2(c, d, h);
  if (!job) throw new Error(`${id}: no valid icon id`);
  const name = clean(d.name?.en) || d.id;
  const form: IconForm = h?.form ?? COLLECTION_FORM[c];
  const subject = subjectOnly(name, h?.subject ?? templateSubject(c, d, name));
  let text: PackCellText;
  if (form === 'tile') {
    text = { name, subject, draw: h?.glyph ?? `one simple bold symbol that clearly expresses "${name}"` };
  } else {
    const tkey = cutoutTemplateFor(c, d.slot, d.classes, d.id);
    text = { name, subject, draw: h?.silhouette ?? CUTOUT_TEMPLATES[tkey]!.pose, colour: paletteText(c, d, h) };
  }
  return { index, cell: PACK_CELLS[index]!, id, name, job, text, refs: normalizeRefs(job.refs), images: [] };
}

interface Picked {
  perCell: number;
  /** refs per cell after the cap */
  byCell: RefSpec[][];
  unique: number;
}

/** The refs of every cell within the sheet cap: start with `perCell` per cell (the id's primary ref first), lower to 1 when the
 *  number of distinct images exceeds `maxRefs`; images shared by several cells are attached once. */
export function capRefs(cells: readonly PackCell[], perCell: number, maxRefs: number): Picked {
  const max = Math.min(Math.max(1, maxRefs), PACK_MAX_REFS_CEILING);
  for (let p = Math.max(1, perCell); p >= 1; p--) {
    const byCell = cells.map((c) => c.refs.slice(0, p));
    const unique = new Set(byCell.flat().map((r) => resolveRefPath(r.path))).size;
    if (unique <= max || p === 1) {
      if (unique > max) {
        // even one per cell is over the ceiling (maxRefs < number of cells): keep the first `max` distinct images in cell order
        const keep = new Set<string>();
        const clipped = byCell.map((rs) => rs.filter((r) => (keep.has(resolveRefPath(r.path)) ? true : keep.size < max ? (keep.add(resolveRefPath(r.path)), true) : false)));
        return { perCell: p, byCell: clipped, unique: keep.size };
      }
      return { perCell: p, byCell, unique };
    }
  }
  throw new Error('unreachable');
}

/** Compose the pack for already-resolved cells (tests pass synthetic defs; `planPack` loads the collection). */
export function planPackFrom(c: IconCollection, defs: { def: IconDef; hint: IconHint | undefined }[], opts: PackOptions = {}): PackPlan {
  if (defs.length < 1 || defs.length > PACK_SIZE) throw new Error(`a pack holds 1-${PACK_SIZE} ids, got ${defs.length}`);
  const cells = defs.map((x, i) => packCell(c, x.def, x.hint, i, opts));
  const forms = new Set(cells.map((x) => (x.job.post.some((o) => (o as { op: string }).op === 'octile') ? 'tile' : 'cutout')));
  if (forms.size > 1) throw new Error(`a pack cannot mix tile and cut-out ids (${cells.map((x) => x.id).join(', ')}): pack them separately`);
  const form: IconForm = [...forms][0]!;
  const picked = capRefs(cells, opts.refsPerCell ?? PACK_REFS_PER_CELL, opts.maxRefs ?? PACK_MAX_REFS);
  // distinct images in order of first appearance; the role names every cell that uses the image
  const refs: PackRef[] = [];
  const dropped: PackPlan['dropped'] = [];
  cells.forEach((cell, ci) => {
    const kept = picked.byCell[ci]!;
    for (const r of cell.refs) if (!kept.includes(r)) dropped.push({ id: cell.id, path: r.path });
    for (const r of kept) {
      const src = resolveRefPath(r.path);
      let pr = refs.find((x) => x.src === src);
      if (!pr) {
        pr = { n: refs.length + 1, path: r.path, src, role: refRoleSentence(r.role), cells: [] };
        refs.push(pr);
      }
      if (!pr.cells.includes(ci)) pr.cells.push(ci);
      cell.images.push(pr.n);
    }
  });
  for (const pr of refs) pr.role = packRefRole(pr.cells.map((i) => ({ index: i, name: cells[i]!.name })), pr.role);
  const slots: (PackCellText | null)[] = Array.from({ length: PACK_SIZE }, (_, i) => cells[i]?.text ?? null);
  const goal = form === 'tile' ? tilePackGoal(slots) : cutoutPackGoal(slots, CUTOUT_PACK_RENDERING);
  const ids = cells.map((x) => x.id);
  const packId = packIdFor(c, ids);
  const job: JobSpec = {
    id: packId,
    group: 'icons',
    kind: 'icon',
    aspect: 'square',
    size: PACK_SHEET_SIZE,
    goal,
    ...(refs.length ? { refs: refs.map((r) => ({ path: r.path, role: r.role })) } : {}),
    background: form === 'tile' ? 'black' : 'transparent',
    post: [],
    note: `icon pack ${c} ${form}: ${ids.map((id, i) => `${PACK_CELLS[i]}=${id}`).join(' ')}`,
  };
  return { packId, collection: c, form, ids, n: cells.length, cells, job, refs, dropped, perCell: picked.perCell };
}

/** Load the collection's defs + hints and compose the pack of `ids` (in order). */
export function planPack(c: IconCollection, ids: readonly string[], opts: PackOptions = {}): PackPlan {
  const hints = loadHints(c);
  const defs = new Map<string, IconDef>();
  for (const d of readCollectionDefs(c)) if (d.icon && !defs.has(d.icon)) defs.set(d.icon, d);
  const unknown = ids.filter((id) => !defs.has(id));
  if (unknown.length) throw new Error(`not in ${c}: ${unknown.join(', ')}`);
  return planPackFrom(c, ids.map((id) => ({ def: defs.get(id)!, hint: hints[id] })), opts);
}

/** Human-readable dry-run text: the cell -> id map, the attached images, the exact message. */
export function describePack(plan: PackPlan, message: string, prepared: { src: string; attached: string; role: string }[] = []): string {
  const out: string[] = [];
  out.push(`=== PACK ${plan.packId}  (${plan.collection}, ${plan.form}, ${plan.n} of ${PACK_SIZE} cells used, ${plan.refs.length} reference image(s), ${plan.perCell} per cell) ===`);
  if (plan.n < PACK_SIZE) out.push(`  (padded pack: cells ${plan.n + 1}-${PACK_SIZE} are explicitly empty so the 2 x 2 geometry is the same as a full pack; add ${PACK_SIZE - plan.n} more id(s) to fill it)`);
  out.push('cell -> id map:');
  for (const c of plan.cells) out.push(`  cell ${c.index + 1} ${c.cell.padEnd(12)} ${c.id}   "${c.name}"   images: ${c.images.length ? c.images.map((n) => `Image ${n}`).join(', ') : '(none)'}`);
  for (let i = plan.n; i < PACK_SIZE; i++) out.push(`  cell ${i + 1} ${PACK_CELLS[i]!.padEnd(12)} (empty)`);
  out.push('reference images (attached with -i in this order):');
  for (const r of plan.refs) out.push(`  Image ${r.n} = ${prepared[r.n - 1]?.src ?? r.src}  ->  cells ${r.cells.map((i) => i + 1).join(', ')}`);
  if (!plan.refs.length) out.push('  (none)');
  if (plan.dropped.length) out.push(`  dropped by the per-cell cap: ${plan.dropped.map((d) => `${d.id}:${d.path}`).join(', ')}`);
  out.push('message sent to the engine (codex stdin / Gemini text):', '--------------------------------', message, '--------------------------------');
  return out.join('\n');
}
