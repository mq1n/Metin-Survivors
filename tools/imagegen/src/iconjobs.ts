// Icon pipeline v2 (docs/ART.md s5): per-collection hint files -> icon jobs. Skills/talents/passives are octagon TILES (the
// generator draws one white stencil pictogram on black; py/iconkit.py composes the tile + rank-band variants), stones/
// trinkets/gear are transparent CUT-OUTS (alpha -> matte -> fit -> outline -> shadow at 256 px).
//   bun src/cli.ts icons --collection skills [--dry] [--check] [--legacy]
// Hint files: tools/imagegen/hints/<collection>.json  { "<icon id>": "subject" | IconHint }   (keys starting with $ or _
// are comments). Precedence: hints/<collection>.json > icon_hints.json (legacy, plain strings) > generated template.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BANNED_WORDS,
  CLASS_GEAR_COLOUR,
  COLLECTION_FORM,
  CUTOUT_TEMPLATES,
  ICON_COLLECTIONS,
  RANK_BANDS,
  REF_ROLE_GRADE,
  REF_ROLE_ITEM,
  REF_ROLE_ITEM_STYLE,
  REF_ROLE_MEANING,
  REF_ROLE_SKILL,
  REF_ROLE_SKILL_STYLE,
  REF_ROLE_TALENT,
  TIER_MATERIAL,
  TILE_GEOMETRY,
  cutoutGoal,
  cutoutTemplateFor,
  doctrineFamily,
  talentRowBand,
  tileGoal,
  tileGridGoal,
  type IconCollection,
  type IconForm,
  type RankBand,
  type TileFamily,
} from './defs/iconStyle';
import { CONTENT_DIR, JOBS_DIR, ROOT, TOOL } from './paths';
import { resolveRefPath } from './refs';
import type { JobSpec, PostOp, RefSpec } from './types';

export const HINTS_DIR = join(TOOL, 'hints');
export const REFMAP = join(ROOT, '.research', 'prep', 'icons', 'refmap.json');

/** One hint. Every field is optional; a plain string hint = { subject }. */
export interface IconHint {
  /** what the icon shows, in a few words (skills: the technique; items: the object) */
  subject?: string;
  /** tiles: the pictogram concept the generator draws as a white stencil (e.g. "four curved blades around a ring hub") */
  glyph?: string;
  /** cut-outs: pose / shape rule replacing the family template */
  silhouette?: string;
  /** cut-outs: local colours (hex or words) */
  palette?: string[] | string;
  
  refs?: (string | RefSpec)[];
  /** tiles: colour family override (default: skills/talents by doctrine a warm / b cool, passives guild) */
  family?: TileFamily;
  /** override the collection's default form */
  form?: IconForm;
  /** tiles: long side of the glyph in the well (default 0.8); cut-outs: long side of the object on the canvas */
  fill?: number;
  /** tiles: bands rendered; the first is the base id, the rest ship as <id>__<band> (default skills n,m,g,p; others one) */
  bands?: RankBand[];
  /** skill tiles (4 bands): how the SYMBOL ITSELF grows per grade, as exactly 3 steps [grade 2 (m), grade 3 (g), grade 4 (p)], each
   *  "what is added to the previous grade" (e.g. "two more parallel slashes"). The job becomes ONE 2x2 sheet (cell 1 = `glyph`,
   *  cells 2-4 = the steps) and the post chain cuts it (`octile grid: 2`): every rank band gets its own drawing, no shards. */
  grades?: string[];
  /** ids allowed to look alike in the duplicate gate */
  pairOk?: string[];
  /** allow the word "fist" (banned archetype stamp) */
  allowFist?: boolean;
  note?: string;
}
export type HintValue = string | IconHint;

interface L10n {
  en?: string;
  tr?: string;
}
export interface IconDef {
  id: string;
  icon?: string;
  name?: L10n;
  desc?: L10n;
  element?: string;
  classId?: string;
  doctrine?: string;
  kind?: string;
  slot?: string;
  tier?: number;
  behavior?: string;
  classes?: string[];
  row?: number;
  col?: number;
  /** talents: tree id (warrior_a ...) */
  tree?: string;
}

export function clean(s: string | undefined): string {
  return (s ?? '').replace(/\{[a-zA-Z]+\}/g, '').replace(/\s+/g, ' ').trim();
}

export function readCollectionDefs(name: IconCollection): IconDef[] {
  const p = join(CONTENT_DIR, `${name}.json`);
  if (!existsSync(p)) return [];
  const data: unknown = JSON.parse(readFileSync(p, 'utf8'));
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && 'items' in data && Array.isArray(data.items) ? data.items : [];
  if (name === 'talents') {
    return (list as { id: string; classId: string; nodes?: IconDef[] }[]).flatMap((t) =>
      (t.nodes ?? []).map((n) => ({ ...n, classId: t.classId, tree: t.id, doctrine: t.id.endsWith('_b') ? 'b' : 'a' })),
    );
  }
  return list as IconDef[];
}

export function hintsPath(c: IconCollection): string {
  return join(HINTS_DIR, `${c}.json`);
}

/** Hints of a collection: hints/<c>.json over the legacy icon_hints.json (strings). */
export function loadHints(c: IconCollection): Record<string, IconHint> {
  const out: Record<string, IconHint> = {};
  const legacy = join(TOOL, 'icon_hints.json');
  const read = (p: string): Record<string, HintValue> => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, HintValue>) : {});
  for (const src of [read(legacy), read(hintsPath(c))]) {
    for (const [k, v] of Object.entries(src)) {
      if (k.startsWith('$') || k.startsWith('_')) continue;
      out[k] = typeof v === 'string' ? { subject: v } : v;
    }
  }
  return out;
}




export interface RefMapEntry {
  refs: string[];
  kind?: string;
  match?: string;
  why?: string;
  grades?: string[];
}
let refmapCache: Record<string, RefMapEntry> | null | undefined;
export function refmap(): Record<string, RefMapEntry> {
  if (refmapCache === undefined) refmapCache = existsSync(REFMAP) ? (JSON.parse(readFileSync(REFMAP, 'utf8')) as Record<string, RefMapEntry>) : null;
  return refmapCache ?? {};
}


function m2Role(form: IconForm, c: IconCollection, match: string | undefined, i: number): string {
  if (form === 'cutout') return match === 'counterpart' && i === 0 ? REF_ROLE_ITEM : REF_ROLE_ITEM_STYLE;
  if (c === 'talents') return i === 0 ? REF_ROLE_TALENT : REF_ROLE_MEANING;
  if (match === 'counterpart' && i === 0) return REF_ROLE_SKILL;
  return c === 'passives' && i > 0 ? REF_ROLE_MEANING : REF_ROLE_SKILL_STYLE;
}

/** Role sentence for a hint ref given as a plain path. */
function defaultRole(path: string, form: IconForm, c: IconCollection, i: number): string {
  const p = path.replaceAll('\\', '/');
  if (p.includes('/prep/icons/')) return m2Role(form, c, 'counterpart', i);
  return 'style';
}


export function iconRefs(c: IconCollection, iconId: string, hint: IconHint | undefined, form: IconForm): RefSpec[] {
  if (hint?.refs?.length) {
    return hint.refs.map((r, i) => (typeof r === 'string' ? { path: r, role: defaultRole(r, form, c, i) } : { path: r.path, role: r.role ?? defaultRole(r.path, form, c, i) }));
  }
  const e = refmap()[iconId];
  return (e?.refs ?? []).slice(0, 2).map((p, i) => ({ path: p, role: m2Role(form, c, e?.match, i) }));
}


export function gradeRefs(iconId: string): RefSpec[] {
  const e = refmap()[iconId];
  return (e?.grades ?? []).slice(0, 3).map((p, i) => ({ path: p, role: REF_ROLE_GRADE(i + 1, e?.match === 'counterpart') }));
}

export function templateSubject(c: IconCollection, d: IconDef, name: string): string {
  const desc = clean(d.desc?.en);
  return desc ? `${name}: ${desc}` : name;
}

export function paletteText(c: IconCollection, d: IconDef, hint: IconHint | undefined): string {
  if (hint?.palette) return `local colours ${Array.isArray(hint.palette) ? hint.palette.join(', ') : hint.palette}`;
  if (c === 'gear') {
    const cls = d.classes?.length === 1 ? CLASS_GEAR_COLOUR[d.classes[0]!] : undefined;
    const tier = TIER_MATERIAL[Math.max(0, Math.min(3, (d.tier ?? 1) - 1))]!;
    return `materials ${tier}${cls ? `, class colours ${cls}` : ''}`;
  }
  return 'ONE saturated local hue that tells what it is';
}

/** v2 icon job for one content def (null when the def has no valid icon id). */
export function iconJobV2(c: IconCollection, d: IconDef, hint: IconHint | undefined): JobSpec | null {
  const id = d.icon;
  if (!id || !/^[a-z0-9_]+$/.test(id)) return null;
  const name = clean(d.name?.en) || d.id;
  const form: IconForm = hint?.form ?? COLLECTION_FORM[c];
  const subject = hint?.subject ?? templateSubject(c, d, name);
  const refs = iconRefs(c, id, hint, form);
  const base = { id, group: c === 'talents' ? 'icons_talent' : 'icons', kind: 'icon' as const, aspect: 'square' as const, size: TILE_GEOMETRY.size };
  if (form === 'tile') {
    const family: TileFamily = hint?.family ?? (c === 'passives' ? 'guild' : doctrineFamily(d.doctrine));
    const bands: RankBand[] = hint?.bands ?? (c === 'skills' ? [...RANK_BANDS] : [c === 'talents' ? talentRowBand(d.row) : 'n']);
    const glyph = hint?.glyph ?? `one simple bold symbol that clearly expresses "${name}"`;
    const grid = hint?.grades?.length === 3 && bands.length === 4;
    const post: PostOp[] = [
      { op: 'glyph', ...(grid ? { minIsland: 30 } : {}) },
      { op: 'octile', family, fill: hint?.fill ?? TILE_GEOMETRY.glyphFill, bands, seed: id, size: TILE_GEOMETRY.size, ...(grid ? { grid: 2 } : {}) },
      { op: 'webp', quality: 92, lossless: 'auto' },
    ];
    const goal = grid ? tileGridGoal(name, subject, glyph, hint!.grades!) : tileGoal(name, subject, glyph);
    const gr = grid && !hint?.refs?.length ? gradeRefs(id) : [];
    const jobRefs = gr.length ? gr : refs;
    return { ...base, goal, ...(jobRefs.length ? { refs: jobRefs } : {}), background: 'black', post, note: `icon v2 tile ${family} ${bands.join(',')}${grid ? ' grade-growth grid' : ''}` };
  }
  const tkey = cutoutTemplateFor(c, d.slot, d.classes, d.id);
  const t = CUTOUT_TEMPLATES[tkey]!;
  const post: PostOp[] = [
    { op: 'alpha', key: 'auto', onlyIfOpaque: true },
    { op: 'matte' },
    // fill = the final footprint (object + 4 px contour + shadow); the object itself gets 0.06 less and a 9 % margin
    { op: 'fit', size: TILE_GEOMETRY.size, fill: (hint?.fill ?? t.fill) - 0.06, margin: 0.09, offset: [-0.015, -0.02] },
    { op: 'outline', width: 4, color: '#1a1210' },
    { op: 'shadow' },
    { op: 'bleed' },
    { op: 'webp', quality: 92, lossless: 'auto' },
  ];
  return {
    ...base,
    goal: cutoutGoal(name, subject, hint?.silhouette ?? t.pose, paletteText(c, d, hint)),
    ...(refs.length ? { refs } : {}),
    background: 'transparent',
    post,
    note: `icon v2 cutout ${tkey}`,
  };
}

/** All v2 jobs of a collection (first def per icon id wins). */
export function collectionJobs(c: IconCollection): JobSpec[] {
  const hints = loadHints(c);
  const jobs = new Map<string, JobSpec>();
  for (const d of readCollectionDefs(c)) {
    const j = iconJobV2(c, d, d.icon ? hints[d.icon] : undefined);
    if (j && !jobs.has(j.id)) jobs.set(j.id, j);
  }
  return [...jobs.values()];
}

/** jobs/icons_<collection>.jsonl — only this collection's file is ever written. */
export function writeCollectionJobs(c: IconCollection, dry: boolean): { file: string; jobs: JobSpec[] } {
  const jobs = collectionJobs(c);
  const file = join(JOBS_DIR, `icons_${c}.jsonl`);
  if (!dry) writeFileSync(file, jobs.map((j) => JSON.stringify(j)).join('\n') + '\n');
  return { file, jobs };
}

export interface HintProblem {
  id: string;
  problem: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** `icons --check`: every id has a hint (tiles: a glyph), no two hints share a subject or glyph, no banned archetype
 *  words, refs exist, known family/form/bands. */
export function checkHints(c: IconCollection): HintProblem[] {
  const hints = loadHints(c);
  const own = existsSync(hintsPath(c)) ? (JSON.parse(readFileSync(hintsPath(c), 'utf8')) as Record<string, HintValue>) : {};
  const problems: HintProblem[] = [];
  const seenSubject = new Map<string, string>();
  const seenGlyph = new Map<string, string>();
  const ids = new Set<string>();
  for (const d of readCollectionDefs(c)) {
    const id = d.icon;
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const h = hints[id];
    const form: IconForm = h?.form ?? COLLECTION_FORM[c];
    if (!h || !(id in own)) {
      problems.push({ id, problem: `no hint in hints/${c}.json` });
      if (!h) continue;
    }
    if (!h.subject) problems.push({ id, problem: 'hint has no subject' });
    if (form === 'tile' && !h.glyph) problems.push({ id, problem: 'tile hint has no glyph concept' });
    const words = [...BANNED_WORDS.all, ...BANNED_WORDS[c]].filter((w) => !(h.allowFist && w.includes('fist')));
    if (h.grades) {
      if (form !== 'tile') problems.push({ id, problem: '`grades` only makes sense for tiles' });
      else if (h.grades.length !== 3 || h.grades.some((g) => !g || g.length < 12)) problems.push({ id, problem: '`grades` needs exactly 3 growth steps [grade 2, grade 3, grade 4], each a real sentence' });
      else if ((h.bands ?? (c === 'skills' ? RANK_BANDS : [])).length !== 4) problems.push({ id, problem: '`grades` needs the 4 bands n,m,g,p' });
    }
    const text = `${h.subject ?? ''} ${h.glyph ?? ''} ${h.silhouette ?? ''} ${(h.grades ?? []).join(' ')}`.toLowerCase();
    for (const w of words) if (text.includes(w)) problems.push({ id, problem: `banned archetype word "${w}"` });
    for (const [key, map] of [
      [h.subject, seenSubject],
      [h.glyph, seenGlyph],
    ] as const) {
      if (!key) continue;
      const k = norm(key);
      const other = map.get(k);
      if (other && !(h.pairOk ?? []).includes(other)) problems.push({ id, problem: `same ${map === seenSubject ? 'subject' : 'glyph'} as ${other}` });
      else map.set(k, id);
    }
    if (h.family && !['warm', 'cool', 'guild', 'bright'].includes(h.family)) problems.push({ id, problem: `unknown family ${h.family}` });
    if (h.form && !['tile', 'cutout'].includes(h.form)) problems.push({ id, problem: `unknown form ${h.form}` });
    for (const b of h.bands ?? []) if (!RANK_BANDS.includes(b)) problems.push({ id, problem: `unknown band ${b}` });
    for (const r of h.refs ?? []) {
      const p = typeof r === 'string' ? r : r.path;
      if (!existsSync(resolveRefPath(p, ROOT))) problems.push({ id, problem: `reference not found: ${p}` });
    }
  }
  for (const k of Object.keys(own)) if (!k.startsWith('$') && !k.startsWith('_') && !ids.has(k)) problems.push({ id: k, problem: `hint for an id that is not in content/${c}.json` });
  return problems;
}

export function isCollection(s: string | undefined): s is IconCollection {
  return !!s && (ICON_COLLECTIONS as readonly string[]).includes(s);
}
