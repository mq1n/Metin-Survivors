// Small helpers shared by the ninja patches (S4 ninja wave). Function-form element edits that change the SIZE and the LIGHT of one element in one go;
// sizeBy and tintMul both write `grade`, so their bands are merged here (a plain object spread would keep only the second).
import type { ElementSpec } from '../../spec/types';
import { sizeBy, tintMul, type ElementPatch } from '../../spec/patch';

type Grade = Record<string, object>;

/** size x k AND every colour key x m (hue kept, bands merged): the white-out remedy for a burst that is too big and too bright */
export function shrinkDim(k: number, m: number) {
  return <E extends ElementSpec>(gen: E): ElementPatch<E['kind']> => {
    const a = sizeBy({ k })(gen) as unknown as { grade?: Grade };
    const b = tintMul(m)(gen) as unknown as { grade?: Grade };
    const grade: Grade = { ...(a.grade ?? {}) };
    for (const [band, v] of Object.entries(b.grade ?? {})) grade[band] = { ...(grade[band] ?? {}), ...v };
    return { ...a, ...b, ...(Object.keys(grade).length > 0 ? { grade } : {}) } as unknown as ElementPatch<E['kind']>;
  };
}
