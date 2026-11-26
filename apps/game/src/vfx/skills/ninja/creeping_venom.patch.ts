

// Everything is keyed by the generated element keys (a stale key fails tsc and skillFamilies.test.ts); colours are only ever edited relative to the generated value.
import type { ElementSpec } from '../../spec/types';
import { READABLE, retint, sizeBy, type ElementPatch, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/creeping_venom.gen';


const smallPink =
  (k: number) =>
  <E extends ElementSpec>(gen: E): ElementPatch<E['kind']> => {
    const a = sizeBy({ k })(gen) as unknown as { grade?: Record<string, object> };
    const b = retint(0xff5ccf, { only: ['g3'] })(gen) as unknown as { grade?: Record<string, object> };
    const grade: Record<string, object> = { ...(a.grade ?? {}) };
    for (const [band, v] of Object.entries(b.grade ?? {})) grade[band] = { ...(grade[band] ?? {}), ...v };
    return { ...a, ...b, grade } as unknown as ElementPatch<E['kind']>;
  };

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.creeping_venom': {
      set: READABLE,
      el: {
        
        'seomjeom_start#1': smallPink(0.55),
        'seomjeom_start#0': smallPink(0.7),
      },
    },
    'sk.creeping_venom.cast': { set: READABLE },
  },
};
