// Small helpers shared by the warrior wave's patches (S4): chain several function-form element edits (sizeBy / tintMul / retint ...) on ONE element.
// Not a family wiring file (the class entry only globs './*.family.ts'); patches import it, nothing else does.
import type { ElementSpec } from '../../spec/types';
import type { ElementPatch } from '../../spec/patch';

type Edit = <E extends ElementSpec>(gen: E) => ElementPatch<E['kind']>;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `both(sizeBy({ k: 0.8 }), tintMul(0.7))`: every edit sees the GENERATED element; the results are merged (a `grade` band is merged band by band, fields by field) */
export function both(...edits: Edit[]): Edit {
  return (<E extends ElementSpec>(gen: E): ElementPatch<E['kind']> => {
    const out: Obj = {};
    for (const e of edits) {
      const p = e(gen) as Obj;
      for (const [k, v] of Object.entries(p)) {
        if (k === 'grade' && isObj(v)) {
          const g = (isObj(out.grade) ? out.grade : {}) as Obj;
          for (const [band, bv] of Object.entries(v)) g[band] = { ...(isObj(g[band]) ? (g[band] as Obj) : {}), ...(isObj(bv) ? bv : {}) };
          out.grade = g;
        } else out[k] = v;
      }
    }
    return out as ElementPatch<E['kind']>;
  }) as Edit;
}
