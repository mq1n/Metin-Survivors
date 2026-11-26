// Small helpers shared by the shaman patches (S4 shaman wave). Function-form element edits that change the SIZE and the LIGHT of one element in one go;
// sizeBy and tintMul both write `grade`, so their bands are merged here (a plain object spread would keep only the second).
import type { ElementSpec } from '../../spec/types';
import { scaleCurve, sizeBy, tintMul, type ElementPatch } from '../../spec/patch';

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

type K4 = number | readonly [number, number, number, number];
type Obj = Record<string, unknown>;
const kAt = (k: K4, g: number): number => (typeof k === 'number' ? k : (k[g] as number));
const SIZE_FIELD: Record<string, string> = { particle: 'half', surface: 'scale', trail: 'width' };

/**
 * Per-GRADE size and light of one element: `sizeK` / `lightK` are one factor or `[g0, g1, g2, g3]` (the grade bands g1 / g2 / g3 = ranks M1 / G1 / P). The
 * factors apply to the EFFECTIVE element of every grade (base + the bands up to it), so a family whose g0 is 4x too bright and whose P is 1.5x too bright
 * gets two different remedies in one edit. Writes `half` / `scale` / `width` and `color` only where a factor differs from 1 (or from the band below).
 * Hue is kept (tintMul), alphas and times stay.
 */
export function bandScale(sizeK: K4, lightK: K4 = 1, countK: K4 = 1) {
  return <E extends ElementSpec>(gen: E): ElementPatch<E['kind']> => {
    const base = gen as unknown as Obj;
    const bands = (base.grade ?? {}) as Record<string, Obj>;
    const field = SIZE_FIELD[base.kind as string] ?? 'half';
    let eff: Obj = { ...base };
    delete eff.grade;
    const out: Obj = {};
    const grade: Record<string, Obj> = {};
    for (let g = 0; g < 4; g++) {
      const band = g > 0 ? (bands[`g${g}`] ?? {}) : {};
      if (g > 0) eff = { ...eff, ...band };
      const ks = kAt(sizeK, g);
      const kl = kAt(lightK, g);
      const part: Obj = {};
      const sizeChanged = g === 0 ? ks !== 1 : band[field] !== undefined || ks !== kAt(sizeK, g - 1);
      const colorChanged = g === 0 ? kl !== 1 : band.color !== undefined || kl !== kAt(lightK, g - 1);
      const kc = kAt(countK, g);
      const countChanged = g === 0 ? kc !== 1 : band.rate !== undefined || band.max !== undefined || kc !== kAt(countK, g - 1);
      if (countChanged && Array.isArray(eff.rate)) part.rate = scaleCurve(eff.rate as number[], kc);
      if (countChanged && typeof eff.max === 'number') part.max = Math.max(1, Math.round(eff.max * kc));
      if (sizeChanged) Object.assign(part, sizeBy({ k: ks })(eff as unknown as ElementSpec) as unknown as Obj);
      if (colorChanged) Object.assign(part, tintMul(kl)(eff as unknown as ElementSpec) as unknown as Obj);
      if (g === 0) Object.assign(out, part);
      else if (Object.keys(part).length > 0) grade[`g${g}`] = part;
    }
    if (Object.keys(grade).length > 0) out.grade = grade;
    return out as unknown as ElementPatch<E['kind']>;
  };
}

/**
 * Dim one element so that its share of the effect's light goes to `f0` (grade 0) / `f3` (P) times the generated: size x f^(1/4), colour x f^(1/2) (light ~ size^2 x
 * colour), the grades in between geometrically. f = 1 leaves the grade alone. `c0` / `c3` (optional) also thin the EMISSION (rate and max count x c): a stack of
 * 20-30 overlapping puffs saturates to white even when every puff is dim. The remedy of the in-game white-out gate and of the 0.7-1.4x added-light band.
 */
export function dimTo(f0: number, f3: number, c0 = 1, c3 = 1) {
  const f = (g: number): number => f0 ** (1 - g / 3) * f3 ** (g / 3);
  const sk = [0, 1, 2, 3].map((g) => f(g) ** 0.25) as unknown as [number, number, number, number];
  const lk = [0, 1, 2, 3].map((g) => f(g) ** 0.5) as unknown as [number, number, number, number];
  const ck = [0, 1, 2, 3].map((g) => c0 ** (1 - g / 3) * c3 ** (g / 3)) as unknown as [number, number, number, number];
  return bandScale(sk, lk, ck);
}
