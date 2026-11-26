// Hand layer over a GENERATED skill family (README "Generated families + patches").
//

// (`skills/<class>/<id>.patch.ts`) that stays separate from the generated code, so the family can be regenerated whenever the
// converter improves. `applyPatch(GEN, PATCH)` is pure and deterministic: it never mutates its inputs (the result shares the
// untouched subtrees with them, treat both as immutable) and the same inputs always give the same JSON.
//
// What a patch can do, per spec id of the family (`sk.<id>`, `sk.<id>.cast`, `sk.<id>.aura`):
//   set        scalar FxSpec fields (base, dur, lift, fadeOut, follow, occlude, clamp, space, castGap, explode, gradeScale …),
//              deep-merged (`ref`, `demo`); `undefined` removes a field. occlude / clamp / space here are the spec-wide
//              DEFAULTS of every element that does not set its own (runtime rule), i.e. the readability rules
//   each       readability fields (occlude / clamp / space / minTier) FORCED onto every generated element and impact element
//   el         per element by its stable `key` (ElementCommon.key, written by the converter): a deep partial, merged over the
//              generated element (objects merge, curves / arrays replace, `undefined` removes a field, `grade: { g3: … }`
//              merges into that band), a function (generated element → partial: size clamps, curve maths), or `null` = drop it
//   add        hand-made elements appended to `elements`, `impactAdd` to `impact` (parts ported from a HAND spec)
//   replace    a whole spec for a part the converter cannot express (the id must match; nothing else may be set for it)
// and at skill level `addSpecs` (new specs: `sk.<id>.explode` companions …) and `dropSpecs`.
//
// Typing: `SkillPatch<typeof GEN_KEYS>` (GEN_KEYS is exported by every gen file: spec id → element key → kind) makes a wrong
// spec id, a wrong element key or a field that does not exist on that kind of element fail tsc. `checkPatch` is the runtime
// twin (stale keys after a regeneration, clashes, > MAX_ELEMENTS) and the vitest gate over every patch in the repo.
import { MAX_ELEMENTS, type ColorCurve, type Curve, type ElementCommon, type ElementSpec, type FxSpec } from './types';

/** the host compiles at most this many elements per list (types.ts, the ONE definition host.ts reads too; it warns on a longer list) */
export { MAX_ELEMENTS };

/** checkPatch warns ('luma-up') when a patched element's peak luma at any grade exceeds this multiple of the generated element's */
export const LUMA_UP_RATIO = 1.5;
/** generated elements whose peak luma is below this (practically invisible) are not compared by the 'luma-up' check */
const LUMA_FLOOR = 0.02;

export type ElementKind = ElementSpec['kind'];

/** element keys of a generated family: spec id → element key → kind (the `GEN_KEYS` export of a gen file) */
export type KeyTable = { readonly [specId: string]: { readonly [key: string]: ElementKind } };

/** partial of T whose nested objects are partial too; arrays (curves, vectors) are values and replace as a whole */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { [P in keyof T]?: DeepPartial<T[P]> | undefined }
      : T;

type ElementOf<K extends ElementKind> = Extract<ElementSpec, { kind: K }>;

/** fields of one kind of element a patch may set (`kind` and `key` identify the element and stay) */
export type ElementPatch<K extends ElementKind = ElementKind> = K extends unknown ? DeepPartial<Omit<ElementOf<K>, 'kind' | 'key'>> : never;

/** an edit of one generated element: a deep partial, a function of the generated element, or `null` (drop it) */
export type ElementEdit<K extends ElementKind = ElementKind> = K extends unknown ? ElementPatch<K> | ((gen: ElementOf<K>) => ElementPatch<K>) | null : never;

/** readability / budget fields `each` forces onto every generated element */
export type ElementTone = Pick<ElementCommon, 'occlude' | 'clamp' | 'space' | 'minTier'>;

/** every FxSpec field a patch may change (the identity `id` and the element lists have their own operations) */
export type SpecScalars = DeepPartial<Omit<FxSpec, 'id' | 'elements' | 'impact'>>;

export interface SpecPatch<E extends { readonly [key: string]: ElementKind } = { readonly [key: string]: ElementKind }> {
  set?: SpecScalars;
  each?: { readonly [P in keyof ElementTone]?: ElementTone[P] | undefined };
  el?: { readonly [K in keyof E & string]?: ElementEdit<E[K]> };
  add?: readonly ElementSpec[];
  impactAdd?: readonly ElementSpec[];
  replace?: FxSpec;
}

export interface SkillPatch<K extends KeyTable = KeyTable> {
  /** why this patch exists (free text for the next reader; not part of the output) */
  note?: string;
  specs?: { readonly [S in keyof K & string]?: SpecPatch<K[S]> };
  addSpecs?: readonly FxSpec[];
  dropSpecs?: readonly (keyof K & string)[];
}

// ------------------------------------------------------------------------------------------------ checks

export type PatchIssueCode =
  | 'unknown-spec' // the patch names a spec id the family does not have (stale after a regeneration)
  | 'unknown-key' // the patch names an element key the generated spec does not have (stale after a regeneration)
  | 'unkeyed' // a generated element carries no key (converter older than the key rule): it cannot be patched
  | 'duplicate-key' // two elements of one spec share a key
  | 'replace-conflict' // `replace` together with other operations on the same spec, or an id that differs
  | 'spec-clash' // addSpecs id already in the family
  | 'too-many-elements' // a result list is longer than MAX_ELEMENTS (the host would drop the rest)
  | 'band-shadow' // (warning) a patched base field is overridden by a grade band: patch `grade.gN` as well
  | 'luma-up'; // (warning) a patched element's peak luma exceeds LUMA_UP_RATIO x the generated one at some grade: use retint / tintMul

export interface PatchIssue {
  code: PatchIssueCode;
  level: 'error' | 'warn';
  spec?: string;
  key?: string;
  message: string;
}

export class PatchError extends Error {
  constructor(readonly issues: readonly PatchIssue[]) {
    super(`vfx patch: ${issues.length} problem(s): ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'PatchError';
  }
}

export interface ApplyOptions {
  /** throw a PatchError when checkPatch finds an error (default false: stale entries are skipped; the vitest gate fails instead) */
  strict?: boolean;
}

// ------------------------------------------------------------------------------------------------ helpers

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** the stable key of a generated element (undefined when the converter did not write one) */
export function keyOf(el: ElementSpec): string | undefined {
  return (el as { key?: string }).key;
}

/** deep copy of plain data (arrays, objects, scalars) */
function cloneValue<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneValue) as unknown as T;
  if (isObj(v)) {
    const o: Obj = {};
    for (const k of Object.keys(v)) o[k] = cloneValue(v[k]);
    return o as T;
  }
  return v;
}

/**
 * `patch` over `base`: plain objects merge recursively, everything else (scalars, curves, vectors, lists) replaces; a patch value
 * of `undefined` removes the field. Key order of `base` is kept, new keys follow in patch order. `skip` names top-level keys the
 * patch may not touch. Neither input is mutated.
 */
function mergeObj(base: Obj, patch: Obj, skip?: ReadonlySet<string>): Obj {
  const out: Obj = { ...base };
  for (const k of Object.keys(patch)) {
    if (skip?.has(k)) continue;
    const v = patch[k];
    if (v === undefined) {
      delete out[k];
      continue;
    }
    const b = out[k];
    out[k] = isObj(b) && isObj(v) ? mergeObj(b, v) : cloneValue(v);
  }
  return out;
}

const ELEMENT_FIXED: ReadonlySet<string> = new Set(['kind', 'key']);
const BANDS = ['g1', 'g2', 'g3'] as const;

/**
 * patch of an element: top-level fields change the BASE element; `grade` merges per band, a nested object of a band is merged
 * with the value the band inherits (the runtime replaces a band's fields shallowly, so `grade: { g3: { shape: { radius: 2 } } }`
 * must not turn the g3 shape into `{ radius: 2 }` alone).
 */
function patchElement(el: ElementSpec, patch: Obj): ElementSpec {
  const { grade: gradePatch, ...flat } = patch;
  let out = mergeObj(el as unknown as Obj, flat, ELEMENT_FIXED);
  if (isObj(gradePatch)) {
    const grades: Obj = isObj(out.grade) ? { ...out.grade } : {};
    let eff: Obj = out; // what the band below inherits: base, then base + g1, …
    for (const b of BANDS) {
      const cur = grades[b];
      const bp = gradePatch[b];
      if (bp === undefined && !(b in gradePatch)) {
        if (isObj(cur)) eff = { ...eff, ...cur };
        continue;
      }
      if (bp === undefined) {
        delete grades[b]; // `g3: undefined` removes the band
        continue;
      }
      if (!isObj(bp)) continue;
      const band: Obj = isObj(cur) ? { ...cur } : {};
      for (const f of Object.keys(bp)) {
        const v = bp[f];
        if (v === undefined) {
          band[f] = undefined; // explicit removal of an inherited field
          continue;
        }
        const inherited = f in band ? band[f] : eff[f];
        band[f] = isObj(inherited) && isObj(v) ? mergeObj(inherited, v) : cloneValue(v);
      }
      grades[b] = band;
      eff = { ...eff, ...band };
    }
    out = { ...out };
    if (Object.keys(grades).length > 0) out.grade = grades;
    else delete out.grade;
  }
  return out as unknown as ElementSpec;
}

/** `each`: the tone fields forced onto an element, in its grade bands that carry the same field too */
function stampTone(el: ElementSpec, tone: Obj): ElementSpec {
  const out: Obj = { ...(el as unknown as Obj) };
  const grade = isObj(out.grade) ? out.grade : undefined;
  const bands: Obj | undefined = grade ? { ...grade } : undefined;
  for (const k of Object.keys(tone)) {
    const v = tone[k];
    if (v === undefined) delete out[k];
    else out[k] = v;
    if (bands) {
      for (const b of BANDS) {
        const band = bands[b];
        if (isObj(band) && k in band) bands[b] = v === undefined ? omit(band, k) : { ...band, [k]: v };
      }
    }
  }
  if (bands) out.grade = bands;
  return out as unknown as ElementSpec;
}

function omit(o: Obj, k: string): Obj {
  const { [k]: _gone, ...rest } = o;
  return rest;
}

// ------------------------------------------------------------------------------------------------ apply

type LooseEdit = Obj | ((gen: ElementSpec) => Obj) | null | undefined;
interface LooseSpecPatch {
  set?: Obj;
  each?: Obj;
  el?: Record<string, LooseEdit>;
  add?: readonly ElementSpec[];
  impactAdd?: readonly ElementSpec[];
  replace?: FxSpec;
}
interface LoosePatch {
  specs?: Record<string, LooseSpecPatch | undefined>;
  addSpecs?: readonly FxSpec[];
  dropSpecs?: readonly string[];
}

function editList(list: readonly ElementSpec[], sp: LooseSpecPatch): ElementSpec[] {
  const out: ElementSpec[] = [];
  for (const gen of list) {
    let cur = gen;
    if (sp.each) cur = stampTone(cur, sp.each);
    const key = keyOf(gen);
    const edit = key !== undefined ? sp.el?.[key] : undefined;
    if (edit === null) continue;
    if (edit !== undefined) {
      const part = typeof edit === 'function' ? edit(cur) : edit;
      cur = patchElement(cur, part as Obj);
    }
    out.push(cur);
  }
  return out;
}

function patchSpec(spec: FxSpec, sp: LooseSpecPatch): FxSpec {
  if (sp.replace) return sp.replace;
  const { elements, impact, ...rest } = spec;
  const head: Obj = sp.set ? mergeObj(rest as unknown as Obj, sp.set, new Set(['id', 'elements', 'impact'])) : (rest as unknown as Obj);
  const out: Obj = { ...head, elements: [...editList(elements, sp), ...(sp.add ?? [])] };
  if (impact !== undefined || (sp.impactAdd?.length ?? 0) > 0) out.impact = [...editList(impact ?? [], sp), ...(sp.impactAdd ?? [])];
  return out as unknown as FxSpec;
}






function seedSpace(spec: FxSpec): FxSpec {
  if (spec.space !== undefined) return spec;
  const { elements, impact, ...rest } = spec; // `space` goes before the element lists, like every other scalar
  return { ...rest, space: 'display', elements, ...(impact !== undefined ? { impact } : {}) };
}

/**
 * The family with the patch applied: specs in family order (dropped ones removed), then `addSpecs`. Pure and deterministic.
 * Every generated spec without a `space` defaults to 'display' (seedSpace); `replace` / `addSpecs` specs are hand-made and keep theirs.
 * Stale entries (unknown spec ids / element keys) are skipped; `strict` throws instead, `checkPatch` lists them.
 */
export function applyPatch<K extends KeyTable>(family: readonly FxSpec[], patch: SkillPatch<K>, opts: ApplyOptions = {}): FxSpec[] {
  if (opts.strict) {
    const errors = checkPatch(family, patch).filter((i) => i.level === 'error');
    if (errors.length > 0) throw new PatchError(errors);
  }
  const p = patch as unknown as LoosePatch;
  const drop = new Set(p.dropSpecs ?? []);
  const out: FxSpec[] = [];
  for (const spec of family) {
    if (drop.has(spec.id)) continue;
    const sp = p.specs?.[spec.id];
    out.push(sp ? patchSpec(sp.replace ? spec : seedSpace(spec), sp) : seedSpace(spec));
  }
  for (const s of p.addSpecs ?? []) out.push(s);
  return out;
}

// ------------------------------------------------------------------------------------------------ check

/** element key → kind of every spec of a family (what a gen file exports as GEN_KEYS) */
export function familyKeys(family: readonly FxSpec[]): Record<string, Record<string, ElementKind>> {
  const out: Record<string, Record<string, ElementKind>> = {};
  for (const spec of family) {
    const keys: Record<string, ElementKind> = {};
    for (const el of [...spec.elements, ...(spec.impact ?? [])]) {
      const k = keyOf(el);
      if (k !== undefined) keys[k] = el.kind;
    }
    out[spec.id] = keys;
  }
  return out;
}

/** top-level fields of an element patch (function edits are run on the element) */
function editFields(edit: LooseEdit, gen: ElementSpec): Obj | null {
  if (edit === null || edit === undefined) return null;
  return typeof edit === 'function' ? edit(gen) : edit;
}

/**
 * Every problem of a patch against its generated family: stale spec ids / element keys (the family was regenerated and an
 * element moved or vanished), unkeyed or duplicate keys, clashes of added ids / keys, `replace` mixed with other operations,
 * result lists over MAX_ELEMENTS, and (warning) base fields a grade band shadows. [] = the patch applies cleanly.
 */
export function checkPatch<K extends KeyTable>(family: readonly FxSpec[], patch: SkillPatch<K>): PatchIssue[] {
  const p = patch as unknown as LoosePatch;
  const issues: PatchIssue[] = [];
  const err = (code: PatchIssueCode, message: string, spec?: string, key?: string): void => {
    issues.push({ code, level: 'error', message, ...(spec !== undefined ? { spec } : {}), ...(key !== undefined ? { key } : {}) });
  };
  const ids = new Set(family.map((s) => s.id));
  for (const id of p.dropSpecs ?? []) if (!ids.has(id)) err('unknown-spec', `dropSpecs: no spec ${id} in the family`, id);
  for (const id of Object.keys(p.specs ?? {})) if (!ids.has(id)) err('unknown-spec', `no spec ${id} in the family`, id);
  const dropped = new Set(p.dropSpecs ?? []);
  const seenAdd = new Set<string>();
  for (const s of p.addSpecs ?? []) {
    if (ids.has(s.id) && !dropped.has(s.id)) err('spec-clash', `addSpecs: ${s.id} is already in the family (use replace)`, s.id);
    if (seenAdd.has(s.id)) err('spec-clash', `addSpecs: ${s.id} twice`, s.id);
    seenAdd.add(s.id);
  }
  for (const spec of family) {
    const sp = p.specs?.[spec.id];
    const gens = [...spec.elements, ...(spec.impact ?? [])];
    const byKey = new Map<string, ElementSpec>();
    for (const el of gens) {
      const k = keyOf(el);
      if (k === undefined) {
        if (sp?.el !== undefined || sp?.each !== undefined) err('unkeyed', `${spec.id}: a generated ${el.kind} element has no key`, spec.id);
        continue;
      }
      if (byKey.has(k)) err('duplicate-key', `${spec.id}: key ${k} is used twice`, spec.id, k);
      byKey.set(k, el);
    }
    if (!sp) continue;
    if (sp.replace) {
      if (sp.replace.id !== spec.id) err('replace-conflict', `${spec.id}: replace has id ${sp.replace.id}`, spec.id);
      if (sp.set || sp.each || sp.el || sp.add || sp.impactAdd) err('replace-conflict', `${spec.id}: replace excludes set / each / el / add / impactAdd`, spec.id);
      continue;
    }
    for (const k of Object.keys(sp.el ?? {})) {
      const gen = byKey.get(k);
      if (gen === undefined) {
        err('unknown-key', `${spec.id}: no element with key ${k} (regenerated? keys: ${[...byKey.keys()].slice(0, 6).join(', ')}${byKey.size > 6 ? ', …' : ''})`, spec.id, k);
        continue;
      }
      const fields = editFields(sp.el?.[k], gen);
      const grade = (gen as { grade?: Obj }).grade;
      if (fields && grade) {
        for (const f of Object.keys(fields)) {
          if (f === 'grade') continue;
          const patched = isObj(fields.grade) ? fields.grade : {};
          const shadow = BANDS.filter((b) => isObj(grade[b]) && f in (grade[b] as Obj) && !(isObj(patched[b]) && f in (patched[b] as Obj)));
          if (shadow.length > 0) {
            issues.push({ code: 'band-shadow', level: 'warn', spec: spec.id, key: k, message: `${spec.id} ${k}: base field ${f} is overridden by band ${shadow.join(', ')}; patch grade.${shadow[0]}.${f} too` });
          }
        }
      }
    }
    const added = [...(sp.add ?? []), ...(sp.impactAdd ?? [])];
    for (const el of added) {
      const k = keyOf(el);
      if (k !== undefined && byKey.has(k)) err('duplicate-key', `${spec.id}: added element key ${k} clashes with a generated one`, spec.id, k);
    }
    const addedKeys = new Set<string>();
    for (const el of added) {
      const k = keyOf(el);
      if (k === undefined) continue;
      if (addedKeys.has(k)) err('duplicate-key', `${spec.id}: added element key ${k} twice`, spec.id, k);
      addedKeys.add(k);
    }
  }
  // result limits, on the real result (drops and adds counted)
  const result = applyPatch(family, patch);
  for (const spec of result) {
    if (spec.elements.length > MAX_ELEMENTS) err('too-many-elements', `${spec.id}: ${spec.elements.length} elements (the host compiles ${MAX_ELEMENTS})`, spec.id);
    if ((spec.impact?.length ?? 0) > MAX_ELEMENTS) err('too-many-elements', `${spec.id}: ${spec.impact?.length} impact elements (the host compiles ${MAX_ELEMENTS})`, spec.id);
  }
  // luma-up (warning): a patched element brighter than LUMA_UP_RATIO x the generated one at some grade
  const genById = new Map(family.map((s) => [s.id, s] as const));
  for (const spec of result) {
    const gen = genById.get(spec.id);
    if (gen === undefined || p.specs?.[spec.id]?.replace) continue;
    const genEls = new Map<string, ElementSpec>();
    for (const el of [...gen.elements, ...(gen.impact ?? [])]) {
      const k = keyOf(el);
      if (k !== undefined) genEls.set(k, el);
    }
    // the elements that come from the family (edited or not), in order: the ones `add` / `impactAdd` append have no generated twin
    const sp = p.specs?.[spec.id];
    const fromGen = [...spec.elements.slice(0, spec.elements.length - (sp?.add?.length ?? 0)), ...(spec.impact ?? []).slice(0, (spec.impact?.length ?? 0) - (sp?.impactAdd?.length ?? 0))];
    for (const el of fromGen) {
      const k = keyOf(el);
      const before = k !== undefined ? genEls.get(k) : undefined;
      if (k === undefined || before === undefined || before === el) continue;
      let worst: { g: number; was: number; now: number } | null = null;
      for (let g = 0; g < 4; g++) {
        const was = peakLuma(before, g as 0 | 1 | 2 | 3);
        const now = peakLuma(el, g as 0 | 1 | 2 | 3);
        if (was >= LUMA_FLOOR && now > was * LUMA_UP_RATIO && (worst === null || now / was > worst.now / worst.was)) worst = { g, was, now };
      }
      if (worst !== null) {
        issues.push({
          code: 'luma-up',
          level: 'warn',
          spec: spec.id,
          key: k,
          message: `${spec.id} ${k}: peak luma at g${worst.g} is ${worst.now.toFixed(2)} = ${(worst.now / worst.was).toFixed(1)}x the generated ${worst.was.toFixed(2)} (limit ${LUMA_UP_RATIO}x): recolour with retint(hex) / tintMul(k), which keep the generated brightness`,
        });
      }
    }
  }
  return issues;
}

// ------------------------------------------------------------------------------------------------ patch helpers

/** every value of a `[t, v, …]` curve times k */
export function scaleCurve(c: Curve, k: number): number[] {
  return c.map((v, i) => (i % 2 === 1 ? v * k : v));
}

/** every value of a `[t, v, …]` curve at most `max` (size clamps) */
export function capCurve(c: Curve, max: number): number[] {
  return c.map((v, i) => (i % 2 === 1 ? Math.min(v, max) : v));
}

/** a colour curve `[t, 0xRRGGBB, alpha, …]` with every colour replaced by `rgb` (times and alphas stay): a pale / other tint */
export function recolorCurve(c: ColorCurve, rgb: number): number[] {
  return c.map((v, i) => (i % 3 === 1 ? rgb : v));
}


export function lumaOf(rgb: number): number {
  return (0.2126 * ((rgb >> 16) & 255) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255)) / 255;
}

/** the element as the runtime draws it at grade g: base merged with the bands g1..g (cumulative, like host.ts gradeElement) */
function gradedElement(el: ElementSpec, g: 0 | 1 | 2 | 3): Obj {
  const o = el as unknown as Obj;
  const gr = o.grade;
  if (!isObj(gr) || g === 0) return o;
  let eff: Obj = o;
  for (let i = 0; i < g; i++) {
    const band = gr[BANDS[i] as string];
    if (isObj(band)) eff = { ...eff, ...band };
  }
  return eff;
}

/**
 * Peak light of an element at grade g: `bright` x the highest luma(colour) x alpha over its colour keys (what the blend adds per
 * texel before the sprite: the quantity the 'luma-up' check compares between the generated element and the patched one).
 */
export function peakLuma(el: ElementSpec, g: 0 | 1 | 2 | 3 = 0): number {
  const eff = gradedElement(el, g);
  const c = eff.color as ColorCurve | undefined;
  if (c === undefined) return 0;
  let peak = 0;
  for (let i = 0; i + 2 < c.length; i += 3) peak = Math.max(peak, lumaOf(c[i + 1] as number) * Math.max(0, Math.min(1, c[i + 2] as number)));
  return peak * ((eff.bright as number | undefined) ?? 1);
}

/** `rgb` re-lit to display luma `y`: the same hue scaled, desaturated toward white only where a channel would pass 255 (luma kept) */
function relit(rgb: number, y: number): number {
  const ly = lumaOf(rgb);
  const h = ly > 1e-6 ? [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255] : [1, 1, 1];
  const hl = ly > 1e-6 ? ly : 1;
  const yy = Math.max(0, Math.min(1, y));
  const s = yy / hl;
  const m = Math.max(h[0] as number, h[1] as number, h[2] as number) * s;
  let out = h.map((v) => v * s);
  if (m > 1) {
    // brightest saturated version of the hue has luma y1 < y: mix white in until the luma is y again
    const y1 = hl / Math.max(...h);
    const t = y1 >= 1 ? 0 : (yy - y1) / (1 - y1);
    out = h.map((v) => v / Math.max(...h) * (1 - t) + t);
  }
  const b = out.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  return ((b[0] as number) << 16) | ((b[1] as number) << 8) | (b[2] as number);
}






export function retintCurve(c: ColorCurve, rgb: number): number[] {
  return c.map((v, i) => (i % 3 === 1 ? relit(rgb, lumaOf(v)) : v));
}

/** RELATIVE recolour: every colour key of `c` times k per channel (display values, clamped to 255; k < 1 dims, k > 1 brightens); alphas stay */
export function tintMulCurve(c: ColorCurve, k: number): number[] {
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return c.map((v, i) => (i % 3 === 1 ? (ch((v >> 16) & 255) << 16) | (ch((v >> 8) & 255) << 8) | ch(v & 255) : v));
}

/** which colour curves a colour helper edits: the base element and/or grade bands (default: the base and every band that carries a colour) */
export interface TintOptions {
  only?: readonly ('base' | 'g1' | 'g2' | 'g3')[];
}

function mapColors(gen: ElementSpec, fn: (c: ColorCurve) => number[], only?: TintOptions['only']): Obj {
  const o = gen as unknown as Obj;
  const g = o.grade;
  const out: Obj = {};
  const grade: Obj = {};
  const base = o.color as ColorCurve;
  if (only === undefined || only.includes('base')) out.color = fn(base);
  let inherited = base; // the colour the band below hands up: base, then base + g1, ...
  for (const b of BANDS) {
    const band = isObj(g) ? g[b] : undefined;
    const own = isObj(band) ? (band.color as ColorCurve | undefined) : undefined;
    // a band that carries a colour is always edited (default) or when asked for; a band without one only when asked for by name
    if (only === undefined ? own !== undefined : only.includes(b)) grade[b] = { color: fn(own ?? inherited) };
    if (own !== undefined) inherited = own;
  }
  if (Object.keys(grade).length > 0) out.grade = grade;
  return out;
}

/**
 * Function-form element edit: RELATIVE recolour to the hue of `rgb`, keeping the luma the converter generated for every colour key
 * (see retintCurve). By default the base colour and every grade band that carries one; `{ only: ['g3'] }` limits it to the P band (a band
 * without a colour of its own takes the one it inherits). Example (bash P discs): `el: { 'gyeoksantau_triple#10': retint(0xa8e4ff, { only: ['g3'] }) }`.
 */
export function retint(rgb: number, opt: TintOptions = {}): <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']> {
  return ((gen: ElementSpec) => mapColors(gen, (c) => retintCurve(c, rgb), opt.only)) as unknown as <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']>;
}

/** Function-form element edit: every colour key times k (see tintMulCurve); same targets as `retint` (`{ only: ['g3'] }` = the P band). */
export function tintMul(k: number, opt: TintOptions = {}): <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']> {
  return ((gen: ElementSpec) => mapColors(gen, (c) => tintMulCurve(c, k), opt.only)) as unknown as <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']>;
}

/** a colour curve with every alpha times k (capped at 1 unless `cap` is false) */
export function fadeColorCurve(c: ColorCurve, k: number, cap = true): number[] {
  return c.map((v, i) => (i % 3 === 2 ? (cap ? Math.min(1, v * k) : v * k) : v));
}

/** a size field: one curve, or an `[x, y]` / `[x, y, z]` pair of curves */
type SizeField = Curve | readonly Curve[];

function mapSize(f: SizeField, fn: (c: Curve) => number[]): SizeField {
  return Array.isArray(f[0]) ? (f as readonly Curve[]).map(fn) : fn(f as Curve);
}

/** the fields that carry an element's size over time: particle `half`, surface `scale`, trail `width` (scalar) */
function sizeFields(el: ElementSpec | Obj): ('half' | 'scale' | 'width')[] {
  return (el as { kind: string }).kind === 'particle' ? ['half'] : (el as { kind: string }).kind === 'surface' ? ['scale'] : ['width'];
}

/**
 * Function-form element edit: the size of the element (and of every grade band that overrides it) by `k`, or capped at `max`
 * (`{ k }` / `{ max }`; curves per the field: particle `half` m, surface `scale` multiplier, trail `width` m).
 * Example: `el: { 'gyeoksan_4#3': sizeBy({ k: 0.65 }), 'gyeoksan_4#7': sizeBy({ max: 1.2 }) }`.
 */
export function sizeBy(opt: { k?: number; max?: number }): <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']> {
  const k = opt.k ?? 1;
  const max = opt.max ?? Number.POSITIVE_INFINITY;
  const f = (c: Curve): number[] => capCurve(scaleCurve(c, k), max);
  return ((gen: ElementSpec) => {
    const out: Obj = {};
    const grade: Obj = {};
    const g = (gen as { grade?: Obj }).grade;
    for (const field of sizeFields(gen)) {
      const base = (gen as unknown as Obj)[field];
      if (field === 'width') {
        const w = base as number | undefined;
        if (w !== undefined) out.width = Math.min(w * k, max);
      } else if (base !== undefined) {
        out[field] = mapSize(base as SizeField, f);
      } else if (field === 'scale') {
        out.scale = f([0, 1]); // an unset surface / particle scale is 1
      }
      for (const b of BANDS) {
        const band = g?.[b];
        if (isObj(band) && band[field] !== undefined) {
          grade[b] = { ...(isObj(grade[b]) ? (grade[b] as Obj) : {}), [field]: field === 'width' ? Math.min((band[field] as number) * k, max) : mapSize(band[field] as SizeField, f) };
        }
      }
    }
    if (Object.keys(grade).length > 0) out.grade = grade;
    return out;
  }) as unknown as <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']>;
}

/** readability preset for bright floors (README "Readability on bright floors"): `set: READABLE` on a spec patch */
export const READABLE: { occlude: number; clamp: number } = { occlude: 0.5, clamp: 1 };
