
// S4 ninja wave (2026-10-27): READABLE, and ONE placement fix: the converter writes the archer's charge effect (gwangyeoksul_energy*: the gold swirl disc at the

// the rest of the cast (strips: an orange spiral at the target 1.3-2.0 s, none at the archer). The nine energy elements are dropped from the body and
// re-added (same keys and numbers, x0.6 light, copied from the generated spec at load time) to the cast part, which is fired at the caster. They start
// 0.19 s late there (the cast part fires at the arrowenergy event 0.37 s, the energy event is at 0.18 s): a converter classification item for its owner.
import type { ElementSpec } from '../../spec/types';
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import { shrinkDim } from './patchTools';
import { GEN } from '../_gen/arrowfall.gen';
import type { GEN_KEYS } from '../_gen/arrowfall.gen';

const ENERGY = /^gwangyeoksul(_\d)?_energy#/;

function dim(el: ElementSpec): ElementSpec {
  const t = tintMul(0.6)(el) as { color?: unknown; grade?: Record<string, object> };
  const grade: Record<string, object> = { ...((el as { grade?: Record<string, object> }).grade ?? {}) };
  for (const [band, v] of Object.entries(t.grade ?? {})) grade[band] = { ...(grade[band] ?? {}), ...v };
  return { ...el, ...t, ...(Object.keys(grade).length > 0 ? { grade } : {}) } as ElementSpec;
}
const energy: ElementSpec[] = (GEN.find((s) => s.id === 'sk.arrowfall')?.elements ?? []).filter((e) => ENERGY.test(e.key ?? '')).map(dim);

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'READABLE; the archer charge swirl (gwangyeoksul_energy*) moved from the target-fired body to the caster-fired cast part',
  specs: {
    'sk.arrowfall': {
      set: READABLE,
      el: {
        // in game the hot haze puff and the diamond halo of the impact were 12 % white pixels at the hit (yeonmu stone): 0.7x size, 0.6x light
        'gwan_yeonsa_blow#2': shrinkDim(0.7, 0.6),
        'gwan_yeonsa_blow#3': shrinkDim(0.7, 0.6),
        'gwangyeoksul_energy#0': null,
        'gwangyeoksul_energy#0.1': null,
        'gwangyeoksul_energy#1': null,
        'gwangyeoksul_energy#2': null,
        'gwangyeoksul_2_energy#3': null,
        'gwangyeoksul_2_energy#4': null,
        'gwangyeoksul_3_energy#5': null,
        'gwangyeoksul_3_energy#5.1': null,
        'gwangyeoksul_4_energy#6': null,
      },
    },
    'sk.arrowfall.cast': { set: READABLE, add: energy },
  },
};
