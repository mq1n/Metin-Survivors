// Small composition helpers shared by the wolfman wave patches (S4; a copy of the yacha one so the wolfman chunk imports nothing of another class): spec/patch.ts gives one function-form edit per element key, so a size change
// AND a relative recolour of the same element (the usual impact / burst case) need ONE composed edit. Everything here is relative to the
// GENERATED value (sizeBy / tintMul / retint of spec/patch.ts): no absolute display colour, no sprite change.
import { fadeColorCurve, retint, scaleCurve, sizeBy, tintMul, type ElementPatch } from '../../spec/patch';
import type { ElementSpec } from '../../spec/types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function mergeDeep(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = isObj(v) && isObj(cur) ? mergeDeep(cur, v) : v;
  }
  return out;
}

export interface ShapeOpts {
  /** size x k (every grade band too), see sizeBy */
  size?: number;
  /** size capped at this many metres / scale units */
  max?: number;
  /** P band only: the size the g3 band draws (its own half / scale, else the base one) x k; the other grades keep the generated size (wolfman wave addition) */
  size3?: number;
  /** hue of this colour at the GENERATED luma, see retint (applied first) */
  hue?: number;
  /** every colour key x k (<= 1.5 stays under the luma-up warning), see tintMul (use `fade` for alpha-blended veils: a darker veil colour darkens) */
  tint?: number;
  /** every colour alpha x k (alpha-blended elements: a fainter veil, never a darker one) */
  fade?: number;
  /** limit the colour edits to these bands */
  only?: ('base' | 'g1' | 'g2' | 'g3')[];
}

type Colored = { color?: readonly number[]; grade?: Record<string, { color?: readonly number[] } | undefined> };

/** alpha x k on the base colour and on every band that carries its own colour */
function fadePatch(el: Colored, k: number, only?: string[]): Obj {
  const out: Obj = {};
  if (el.color && (!only || only.includes('base'))) out.color = fadeColorCurve(el.color, k, false);
  const grade: Obj = {};
  for (const b of ['g1', 'g2', 'g3']) {
    const band = el.grade?.[b];
    if (band?.color && (!only || only.includes(b))) grade[b] = { color: fadeColorCurve(band.color, k, false) };
  }
  if (Object.keys(grade).length) out.grade = grade;
  return out;
}

type Sized = { kind: string; half?: unknown; scale?: unknown; grade?: Record<string, Record<string, unknown> | undefined> };

/** the g3 band's size field x k (particle `half`, surface `scale`): only rank 7 changes */
function g3SizePatch(el: Sized, k: number): Obj {
  const field = el.kind === 'particle' ? 'half' : el.kind === 'surface' ? 'scale' : undefined;
  if (!field) return {};
  const cur = (el.grade?.g3?.[field] ?? el[field]) as readonly number[] | readonly (readonly number[])[] | undefined;
  if (cur === undefined) return field === 'scale' ? { grade: { g3: { scale: scaleCurve([0, 1], k) } } } : {};
  const v = Array.isArray(cur[0]) ? (cur as readonly (readonly number[])[]).map((c) => scaleCurve(c, k)) : scaleCurve(cur as readonly number[], k);
  return { grade: { g3: { [field]: v } } };
}

/** one function-form element edit: size (and / or cap), then relative hue, then relative brightness or alpha */
export function shape(o: ShapeOpts): <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']> {
  const only = o.only ? { only: o.only } : {};
  return ((gen: ElementSpec) => {
    let out: Obj = {};
    let cur = gen as unknown as Obj;
    const apply = (p: Obj): void => {
      out = mergeDeep(out, p);
      cur = mergeDeep(cur, p);
    };
    if (o.size !== undefined || o.max !== undefined) apply((sizeBy({ k: o.size, max: o.max })(gen) as unknown) as Obj);
    if (o.size3 !== undefined) apply(g3SizePatch(gen as unknown as Sized, o.size3));
    if (o.hue !== undefined) apply((retint(o.hue, only)(cur as unknown as ElementSpec) as unknown) as Obj);
    if (o.tint !== undefined) apply((tintMul(o.tint, only)(cur as unknown as ElementSpec) as unknown) as Obj);
    if (o.fade !== undefined) apply(fadePatch(cur as unknown as Colored, o.fade, o.only));
    return out;
  }) as unknown as <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']>;
}
