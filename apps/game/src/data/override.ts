// QA content override (DEV / QA builds, the soak and the gate only; never part of a plain production build, see app/content.ts).
// Systems that ship switched off in content (run events, affixes, trials, ...) stay playable and measurable through a JSON
// patch that is merged into the content before the first run:
//
//   {"zones":[{"id":"yeonmu","metins":{"firstAt":20}}], "balance":{"chestCost":{"perOpen":200}}}
//
// Merge rules (deterministic, documented in tools/qa/README.md "Content overrides and query switches (QA only)"):
//   - objects merge recursively; a key that is absent from the content is added (that is how an optional system is switched on)
//   - an array whose items all carry a string `id` (and so does the content's array) merges BY id: an item with a known id is
//     merged into it, an unknown id is appended; every other array (numbers, pairs, items without an id, an empty array)
//     REPLACES the content's array
//   - `null` deletes a key; scalars replace; the kind of an existing value (array / object / string / number / boolean) cannot change
//   - top-level keys must be keys of the content database (classes, skills, ..., balance); keys named __proto__ / constructor /
//     prototype are refused
// The patch is merged into a clone first, the clone is checked with validateContent (an override may not add a content error that
// the content did not already have), and only then the same merge runs on the live database, IN PLACE (objects other modules
// already hold keep their identity). A rejected override throws a ContentOverrideError with named errors and leaves the live
// database untouched.
import { validateContent, type ValidateOptions } from './loader';
import type { ContentDB } from './schema';

type Rec = Record<string, unknown>;

/** Thrown for an override that is malformed or would make the content invalid; `errors` are the named problems. */
export class ContentOverrideError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    const head = errors.slice(0, 25).join('\n  ');
    super(`content override rejected (${errors.length} error${errors.length === 1 ? '' : 's'}):\n  ${head}${errors.length > 25 ? `\n  ... ${errors.length - 25} more` : ''}`);
    this.name = 'ContentOverrideError';
    this.errors = errors;
  }
}

/** What an applied override changed. `paths` lists every change in patch order; `added` / `deleted` are the subsets that created / removed a key or an id item. */
export interface OverrideResult {
  paths: string[];
  added: string[];
  deleted: string[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasId = (v: unknown): v is Rec & { id: string } => isObj(v) && typeof v.id === 'string';
const idArray = (v: unknown): v is (Rec & { id: string })[] => Array.isArray(v) && v.length > 0 && v.every(hasId);

function kindOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// the patch must be plain JSON data

function checkPatchValue(v: unknown, path: string, errs: string[]): void {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) errs.push(`${path}: not a finite number`);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => checkPatchValue(x, `${path}[${i}]`, errs));
    return;
  }
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.has(k)) errs.push(`${path}.${k}: the key '${k}' is not allowed`);
      else checkPatchValue(x, `${path}.${k}`, errs);
    }
    return;
  }
  errs.push(`${path}: ${typeof v} is not JSON data`);
}

// ---------------------------------------------------------------------------------------------------------------------
// merge (mutates `target`; run on a clone first, then on the live database)

interface Ctx {
  paths: string[];
  added: string[];
  deleted: string[];
  errors: string[];
}

function setKey(target: Rec, k: string, value: unknown, path: string, ctx: Ctx): void {
  const had = Object.hasOwn(target, k);
  target[k] = structuredClone(value);
  ctx.paths.push(path);
  if (!had) ctx.added.push(path);
}

function mergeById(target: (Rec & { id: string })[], patch: (Rec & { id: string })[], path: string, ctx: Ctx): void {
  for (const item of patch) {
    const p = `${path}[id=${item.id}]`;
    const at = target.find((t) => t.id === item.id);
    if (at) mergeObject(at, item, p, ctx);
    else {
      target.push(structuredClone(item));
      ctx.paths.push(p);
      ctx.added.push(p);
    }
  }
}

function mergeObject(target: Rec, patch: Rec, path: string, ctx: Ctx): void {
  for (const [k, pv] of Object.entries(patch)) {
    const p = path === '' ? k : `${path}.${k}`;
    const own = Object.hasOwn(target, k);
    const tv = own ? target[k] : undefined;
    if (pv === null) {
      if (own) {
        delete target[k];
        ctx.paths.push(p);
        ctx.deleted.push(p);
      }
      continue;
    }
    if (tv !== undefined && tv !== null && kindOf(tv) !== kindOf(pv)) {
      ctx.errors.push(`${p}: cannot change a ${kindOf(tv)} into a ${kindOf(pv)}`);
      continue;
    }
    if (isObj(pv)) {
      if (isObj(tv)) mergeObject(tv, pv, p, ctx);
      else setKey(target, k, pv, p, ctx);
    } else if (Array.isArray(pv)) {
      if (idArray(pv) && idArray(tv)) mergeById(tv, pv, p, ctx);
      else if (!deepEqual(tv, pv)) setKey(target, k, pv, p, ctx);
    } else if (!own || !Object.is(tv, pv)) {
      setKey(target, k, pv, p, ctx);
    }
  }
}

function runMerge(target: Rec, patch: Rec): Ctx {
  const ctx: Ctx = { paths: [], added: [], deleted: [], errors: [] };
  mergeObject(target, patch, '', ctx);
  return ctx;
}

// ---------------------------------------------------------------------------------------------------------------------

/** Errors of `after` that `before` did not have (counted, so an override cannot add a second copy of an existing error either). */
function newErrors(before: string[], after: string[]): string[] {
  const left = new Map<string, number>();
  for (const e of before) left.set(e, (left.get(e) ?? 0) + 1);
  const out: string[] = [];
  for (const e of after) {
    const n = left.get(e) ?? 0;
    if (n > 0) left.set(e, n - 1);
    else out.push(e);
  }
  return out;
}

/** validateContent assumes a well-formed database and throws on a broken shape (a deleted section, an incomplete new item): reported as one named error, with the override's changes for context. */
function validateSafely(db: ContentDB, options: ValidateOptions, applied: OverrideResult | null): string[] {
  try {
    return validateContent(db, options).errors;
  } catch (e) {
    return [`content: validation threw (${String((e as Error).message ?? e)})${applied ? ` after the override (${describeOverride(applied)})` : ''}`];
  }
}

/**
 * Merges `patch` into `db` (see the rules at the top of this file), validates the result and returns what changed. Throws a
 * ContentOverrideError, with `db` untouched, when the patch is malformed or the merged content would not validate.
 */
export function applyContentOverrideDetailed(db: ContentDB, patch: unknown, options: ValidateOptions = {}): OverrideResult {
  const errors: string[] = [];
  if (!isObj(patch)) throw new ContentOverrideError([`override: the patch must be a JSON object (got ${kindOf(patch)})`]);
  const live = db as unknown as Rec;
  const known = Object.keys(live);
  for (const k of Object.keys(patch)) {
    if (!known.includes(k)) errors.push(`override.${k}: unknown top-level key (known: ${known.join(', ')})`);
    else if (patch[k] === null) errors.push(`override.${k}: a top-level collection cannot be deleted`);
  }
  for (const [k, v] of Object.entries(patch)) checkPatchValue(v, k, errors);
  if (errors.length > 0) throw new ContentOverrideError(errors);

  const clone = structuredClone(live);
  const trial = runMerge(clone, patch);
  if (trial.errors.length > 0) throw new ContentOverrideError(trial.errors);
  if (trial.paths.length === 0) return { paths: [], added: [], deleted: [] };

  let bad = validateSafely(clone as unknown as ContentDB, options, trial);
  if (bad.length > 0) bad = newErrors(validateSafely(db, options, null), bad);
  if (bad.length > 0) throw new ContentOverrideError(bad);

  const done = runMerge(live, patch);
  return { paths: done.paths, added: done.added, deleted: done.deleted };
}

/** `applyContentOverrideDetailed` returning only the changed paths, e.g. ['zones[id=yeonmu].metins.firstAt', 'balance.chestCost.perOpen']. */
export function applyContentOverride(db: ContentDB, patch: unknown, options: ValidateOptions = {}): string[] {
  return applyContentOverrideDetailed(db, patch, options).paths;
}

/** One line for logs and reports: the paths, with added keys / items marked (+) and deleted ones (-), so a typo shows as an addition. */
export function describeOverride(r: OverrideResult): string {
  if (r.paths.length === 0) return 'no change';
  const mark = (p: string): string => (r.added.includes(p) ? `${p} (+)` : r.deleted.includes(p) ? `${p} (-)` : p);
  return `${r.paths.length} change${r.paths.length === 1 ? '' : 's'}: ${r.paths.map(mark).join(', ')}`;
}

// ---------------------------------------------------------------------------------------------------------------------

function defaultReadText(path: string): string {
  const getBuiltin = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
  const fs = getBuiltin?.('node:fs') as { readFileSync: (p: string, enc: 'utf8') => string } | undefined;
  if (!fs) throw new ContentOverrideError([`override: '@${path}' needs a file system (use inline JSON in a browser)`]);
  return fs.readFileSync(path, 'utf8');
}

/**
 * Parses a command-line override: inline JSON (`{"balance":{...}}`) or `@<file>` (a JSON file, path relative to the working
 * directory). `readText` replaces the file reader (tests). Throws a ContentOverrideError for unreadable or invalid JSON and for
 * anything but a JSON object.
 */
export function readOverrideArg(arg: string, readText: (path: string) => string = defaultReadText): Rec {
  const text = arg.trim();
  let src = text;
  if (text.startsWith('@')) {
    const path = text.slice(1);
    if (path === '') throw new ContentOverrideError(['override: "@" needs a file path (@<file>)']);
    try {
      src = readText(path);
    } catch (e) {
      if (e instanceof ContentOverrideError) throw e;
      throw new ContentOverrideError([`override: cannot read '${path}' (${String((e as Error).message ?? e).split('\n')[0]})`]);
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(src.replace(/^﻿/, ''));
  } catch (e) {
    throw new ContentOverrideError([`override: ${text.startsWith('@') ? `'${text.slice(1)}'` : 'the argument'} is not valid JSON (${String((e as Error).message ?? e).split('\n')[0]})`]);
  }
  if (!isObj(value)) throw new ContentOverrideError([`override: the patch must be a JSON object (got ${kindOf(value)})`]);
  return value;
}
