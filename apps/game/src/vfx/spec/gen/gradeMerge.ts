
// Pure data in, pure data out; tooling only (the game bundle never imports it).
//

// same ids and (mostly) the same element structure. The runtime has per-element grade variants (types.ts Grades: `grade: { g1, g2,
// g3 }`, cumulative, a band replaces the fields it names) and rank gates (`minRank` / `maxRank`), so one merged family plays every
// rank from one set of specs. The merge, per spec id and per list (`elements`, `impact`):
//   - g0 (or the lowest grade that has the spec) is the base; its element keys are the keys of the merged family
//   - the elements of grade g are ALIGNED with the effective elements of g-1 (order-preserving, weighted by structural
//     similarity: kind, billboard, shape kind, sockets, timing, position): a matched pair becomes a base element whose band `gN`
//     holds the fields that changed against the grade below (fields that vanished are written as `undefined`, which the runtime's
//     shallow band assign turns into "removed")
//   - an element of g-1 without a partner at g stops at the band below (`maxRank`); an element without a partner in g-1 starts at
//     the band (`minRank`: M1 = 3, G1 = 5, P = 7), keyed by its own key (suffix `~gN` when that key is taken)
// Spec-level scalars come from the lowest grade (`dur` is the longest); a scalar that differs between grades is reported.
import { MAX_ELEMENTS } from '../patch';
import type { ElementSpec, FxSpec } from '../types';

/** first / last skill rank of grade band g0..g3 (rank 0..7 = 1,2,3,M1,M2,G1,G2,P) */
export const BAND_START = [0, 3, 5, 7] as const;
export const BAND_END = [2, 4, 6, 7] as const;

type Obj = Record<string, unknown>;
const BANDS = ['g1', 'g2', 'g3'] as const;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON with sorted keys: structural equality that ignores key order */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

// ------------------------------------------------------------------------------------------------ alignment

function near(a: unknown, b: unknown, tol: number): boolean {
  return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
}

function nearVec(a: unknown, b: unknown, tol: number): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  return a.length === b.length && a.every((v, i) => near(v, b[i], tol));
}

const texId = (t: unknown): string => (typeof t === 'string' ? t : isObj(t) ? canon(t.art) : '');
const shapeKind = (e: Obj): unknown => (isObj(e.shape) ? e.shape.kind : undefined);

/**
 * How likely `a` and `b` are the same element of two grade files: 0 = never (another kind of element: kind, billboard or shape kind
 * differ), else 1 + up to 1 for the soft evidence (sockets, place, blend, texture, timing, position). Timing and position are only
 * soft evidence: grade files move the bursts of one design around (Bash g0 -> g3 shifts a burst 0.7 m and 0.03 s).
 */
export function similarity(a: ElementSpec, b: ElementSpec): number {
  if (a.kind !== b.kind) return 0;
  const x = a as unknown as Obj;
  const y = b as unknown as Obj;
  if (x.billboard !== y.billboard || shapeKind(x) !== shapeKind(y)) return 0;
  let got = 0;
  let all = 0;
  const w = (ok: boolean, weight: number): void => {
    all += weight;
    if (ok) got += weight;
  };
  w(x.attach === y.attach && x.from === y.from, 3);
  w(x.place === y.place, 1);
  w(x.blend === y.blend, 1);
  w(texId(x.tex) === texId(y.tex), 1);
  w(near(x.t0 ?? 0, y.t0 ?? 0, 0.12), 2);
  w(nearVec(x.at ?? [0, 0, 0], y.at ?? [0, 0, 0], 1.0), 2);
  return 1 + got / all;
}

/** relaxed similarity for PACKING (slot reuse): any two elements of one kind may share a slot, sockets / blend / texture / timing only rank them */
function packSimilarity(a: ElementSpec, b: ElementSpec): number {
  if (a.kind !== b.kind) return 0;
  const x = a as unknown as Obj;
  const y = b as unknown as Obj;
  let v = 1;
  if (x.billboard === y.billboard) v += 1;
  if (shapeKind(x) === shapeKind(y)) v += 0.5;
  if (x.attach === y.attach && x.from === y.from) v += 0.5;
  if (x.blend === y.blend) v += 0.25;
  if (texId(x.tex) === texId(y.tex)) v += 0.25;
  if (near(x.t0 ?? 0, y.t0 ?? 0, 0.12)) v += 0.25;
  return v;
}

/** weight of "same position in the list" next to the structural evidence: breaks the ties of periodic effects (three equal bursts) */
const POSITION_WEIGHT = 0.5;

/** order-preserving best alignment of two element lists: pairs [i in prev, j in next] maximising the summed similarity */
export function alignElements(prev: readonly ElementSpec[], next: readonly ElementSpec[], pack = false): [number, number][] {
  const n = prev.length;
  const m = next.length;
  const s: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      const v = similarity(prev[i] as ElementSpec, next[j] as ElementSpec);
      row.push(v > 0 ? v + POSITION_WEIGHT / (1 + Math.abs(i - j)) : 0);
    }
    s.push(row);
  }
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sc = (s[i - 1] as number[])[j - 1] as number;
      const diag = sc > 0 ? ((best[i - 1] as number[])[j - 1] as number) + sc : -1;
      (best[i] as number[])[j] = Math.max((best[i - 1] as number[])[j] as number, (best[i] as number[])[j - 1] as number, diag);
    }
  }
  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const sc = (s[i - 1] as number[])[j - 1] as number;
    const cur = (best[i] as number[])[j] as number;
    if (sc > 0 && Math.abs(cur - (((best[i - 1] as number[])[j - 1] as number) + sc)) < 1e-9) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (Math.abs(cur - ((best[i - 1] as number[])[j] as number)) < 1e-9) i--;
    else j--;
  }
  pairs.reverse();
  if (pack) {
    // slot reuse: leftover elements of the same kind share a slot whatever their order (the host compiles a fixed number per list)
    const usedA = new Set(pairs.map(([a]) => a));
    const usedB = new Set(pairs.map(([, b]) => b));
    const cand: [number, number, number][] = [];
    for (let a = 0; a < n; a++) {
      if (usedA.has(a)) continue;
      for (let b = 0; b < m; b++) {
        if (usedB.has(b)) continue;
        const v = packSimilarity(prev[a] as ElementSpec, next[b] as ElementSpec);
        if (v > 0) cand.push([v + POSITION_WEIGHT / (1 + Math.abs(a - b)), a, b]);
      }
    }
    cand.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
    for (const [, a, b] of cand) {
      if (usedA.has(a) || usedB.has(b)) continue;
      usedA.add(a);
      usedB.add(b);
      pairs.push([a, b]);
    }
    pairs.sort((p, q) => p[1] - q[1]);
  }
  return pairs;
}

// ------------------------------------------------------------------------------------------------ element merge

/** fields never compared between grades: identity and the free-text note of the grade file */
const SKIP_DIFF: ReadonlySet<string> = new Set(['kind', 'key', 'note', 'minRank', 'maxRank', 'grade']);

/** fields of `next` that differ from `prev` (and `undefined` for the ones only `prev` has) */
export function diffFields(prev: Obj, next: Obj): Obj {
  const out: Obj = {};
  for (const k of Object.keys(next)) {
    if (SKIP_DIFF.has(k) || next[k] === undefined) continue;
    if (canon(prev[k]) !== canon(next[k])) out[k] = clone(next[k]);
  }
  for (const k of Object.keys(prev)) {
    if (SKIP_DIFF.has(k) || prev[k] === undefined) continue;
    if (next[k] === undefined) out[k] = undefined;
  }
  return out;
}

interface Merged {
  base: Obj;
  eff: Obj;
  bands: Partial<Record<(typeof BANDS)[number], Obj>>;
  minRank?: number;
  maxRank?: number;
  open: boolean;
}

export interface ListStats {
  perGrade: number[];
  merged: number;
  gated: number;
  banded: number;
  /** the list was packed (slot reuse) because the plain merge exceeded `limit` */
  packed?: boolean;
}

/** merge the element lists of one spec over the grades (index = grade, undefined = the spec does not exist at that grade) */
export function mergeLists(lists: readonly (readonly ElementSpec[] | undefined)[], pack = false): { elements: ElementSpec[]; stats: ListStats } {
  const order: Merged[] = [];
  for (let g = 0; g < 4; g++) {
    const list = lists[g] ?? [];
    const alive = order.filter((m) => m.open);
    const pairs = alignElements(
      alive.map((m) => m.eff as unknown as ElementSpec),
      list,
      pack,
    );
    const partner = new Map<number, number>(pairs.map(([i, j]) => [j, i]));
    const matchedAlive = new Set(pairs.map(([i]) => i));
    alive.forEach((m, i) => {
      if (!matchedAlive.has(i)) {
        m.open = false;
        if (g > 0) m.maxRank = BAND_END[g - 1];
      }
    });
    let pos = 0; // insertion point in `order` for elements that are new at this grade
    list.forEach((el, j) => {
      const i = partner.get(j);
      const e = el as unknown as Obj;
      if (i !== undefined) {
        const m = alive[i] as Merged;
        if (g > 0) {
          const d = diffFields(m.eff, e);
          if (Object.keys(d).length > 0) (m.bands as Record<string, Obj>)[BANDS[g - 1] as string] = d;
        }
        m.eff = clone(e);
        pos = order.indexOf(m) + 1;
        return;
      }
      const m: Merged = { base: clone(e), eff: clone(e), bands: {}, open: true };
      if (g > 0) m.minRank = BAND_START[g];
      order.splice(pos, 0, m);
      pos++;
    });
  }
  const elements = order.map((m) => {
    const o: Obj = {};
    const base = m.base;
    o.kind = base.kind;
    if (base.key !== undefined) o.key = base.key;
    if (base.note !== undefined) o.note = base.note;
    if (m.minRank !== undefined) o.minRank = m.minRank;
    if (m.maxRank !== undefined) o.maxRank = m.maxRank;
    for (const k of Object.keys(base)) if (!(k in o)) o[k] = base[k];
    const bands: Obj = {};
    for (const b of BANDS) if (m.bands[b]) bands[b] = m.bands[b];
    if (Object.keys(bands).length > 0) o.grade = bands;
    return o as unknown as ElementSpec;
  });
  return {
    elements,
    stats: {
      perGrade: [0, 1, 2, 3].map((g) => lists[g]?.length ?? 0),
      merged: elements.length,
      gated: order.filter((m) => m.minRank !== undefined || m.maxRank !== undefined).length,
      banded: order.filter((m) => Object.keys(m.bands).length > 0).length,
    },
  };
}

// ------------------------------------------------------------------------------------------------ family merge

export interface SpecMergeStats {
  elements: ListStats;
  impact?: ListStats;
}

export interface MergeResult {
  specs: FxSpec[];
  warnings: string[];
  stats: Record<string, SpecMergeStats>;
}

const SCALAR_SKIP: ReadonlySet<string> = new Set(['id', 'elements', 'impact', 'dur', 'ref', 'desc']);

/** make the keys of one spec's elements + impact unique (the converter does it per grade; a merge can still collide) */
function uniqueKeys(spec: Obj, warnings: string[]): void {
  const seen = new Set<string>();
  for (const list of ['elements', 'impact'] as const) {
    const els = spec[list] as Obj[] | undefined;
    if (!els) continue;
    for (const el of els) {
      const k = el.key;
      if (typeof k !== 'string') continue;
      let cand = k;
      if (seen.has(cand)) {
        const g = typeof el.minRank === 'number' ? Math.max(1, BAND_START.indexOf(el.minRank as 3 | 5 | 7)) : 0;
        cand = `${k}~g${g}`;
        let n = 2;
        while (seen.has(cand)) cand = `${k}~g${g}.${n++}`;
        warnings.push(`${String(spec.id)}: key ${k} taken, a later element is keyed ${cand}`);
        el.key = cand;
      }
      seen.add(cand);
    }
  }
}

/** merge a list; when the plain merge is longer than the host compiles, retry with slot reuse and keep the shorter result */
function mergeLimited(lists: readonly (readonly ElementSpec[] | undefined)[], id: string, what: string, warnings: string[]): ReturnType<typeof mergeLists> {
  const plain = mergeLists(lists);
  if (plain.elements.length <= MAX_ELEMENTS) return plain;
  const packed = mergeLists(lists, true);
  if (packed.elements.length < plain.elements.length) {
    packed.stats.packed = true;
    warnings.push(`${id}: ${what} merge has ${plain.elements.length} elements, packed (slot reuse across grades) to ${packed.elements.length}${packed.elements.length > MAX_ELEMENTS ? ` (still over the host's ${MAX_ELEMENTS})` : ''}`);
    return packed;
  }
  return plain;
}

/** the four grade families (index = grade; undefined = that grade failed / has no family) → one family with grade variants */
export function mergeGradeFamilies(perGrade: readonly (readonly FxSpec[] | undefined)[]): MergeResult {
  const warnings: string[] = [];
  const stats: Record<string, SpecMergeStats> = {};
  const ids: string[] = [];
  for (let g = 0; g < 4; g++) for (const s of perGrade[g] ?? []) if (!ids.includes(s.id)) ids.push(s.id);
  const specs: FxSpec[] = [];
  for (const id of ids) {
    const at = [0, 1, 2, 3].map((g) => perGrade[g]?.find((s) => s.id === id));
    const first = at.findIndex((s) => s !== undefined);
    const base = at[first] as FxSpec;
    const spec: Obj = {};
    const b = base as unknown as Obj;
    // ref: the first grade's, with the union of every grade's effect files
    const ref = clone(base.ref) as Obj;
    if (typeof ref.notes === 'string') ref.notes = `${ref.notes}; grades g${at.map((s, g) => (s ? g : -1)).filter((g) => g >= 0).join(' g')} merged by regen.ts (bands: M1 = rank 3, G1 = 5, P = 7)`;
    for (const k of Object.keys(b)) {
      if (k === 'elements' || k === 'impact') continue;
      spec[k] = k === 'dur' ? Math.max(...at.map((s) => s?.dur ?? 0)) : k === 'ref' ? ref : clone(b[k]);
    }
    for (const k of Object.keys(spec)) {
      if (SCALAR_SKIP.has(k)) continue;
      for (let g = first + 1; g < 4; g++) {
        const s = at[g] as unknown as Obj | undefined;
        if (s && canon(s[k]) !== canon(spec[k])) warnings.push(`${id}: ${k} differs at g${g} (${canon(s[k])} vs ${canon(spec[k])} at g${first}): kept g${first}`);
      }
    }
    for (let g = first + 1; g < 4; g++) {
      const s = at[g] as unknown as Obj | undefined;
      if (!s) continue;
      for (const k of Object.keys(s)) if (!SCALAR_SKIP.has(k) && !(k in spec)) warnings.push(`${id}: field ${k} exists only from g${g}: dropped`);
    }
    const els = mergeLimited(at.map((s) => s?.elements), id, 'elements', warnings);
    spec.elements = els.elements;
    const st: SpecMergeStats = { elements: els.stats };
    if (at.some((s) => s?.impact !== undefined)) {
      const imp = mergeLimited(at.map((s) => s?.impact), id, 'impact', warnings);
      spec.impact = imp.elements;
      st.impact = imp.stats;
    }
    uniqueKeys(spec, warnings);
    stats[id] = st;
    specs.push(spec as unknown as FxSpec);
  }
  return { specs, warnings, stats };
}
