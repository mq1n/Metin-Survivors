
// --skill bash`). Everything below is an OVERRIDE keyed by the element keys of the generated file, so the family can be regenerated
// whenever the converter improves; a key that no longer exists fails tsc here and `skillFamilies.test.ts`.
//


// C8): the old patch recoloured them with an ABSOLUTE display colour (0xa8e4ff), which became 2.0x the generated luma the day the converter baked
// its brightness calibration (white-hot discs, every key still matched). Skill phase 0 (S0c, 2026-10-27): the family is regenerated with the

// cyan, the luma the converter generated (`retintCurve`, spec/patch.ts), so a later regen can never make them hotter than the generated light
// (checkPatch 'luma-up' stays silent: skillFamilies.test.ts prints it). The P-only flame columns (gyeoksan_4#15) are generated and stay untouched.
import type { ParticleSpec } from '../../spec/types';
import { READABLE, retintCurve, scaleCurve, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/crushing_blow.gen';


const PALE_CYAN = 0xa8e4ff;

/** P band of a floor disc: `k` times the base size, the generated colour in the hue of PALE_CYAN at the generated luma (alphas kept) */
const g3Disc =
  (k: number) =>
  (gen: ParticleSpec): { grade: { g3: { half: ParticleSpec['half']; color: number[] } } } => {
    const half = Array.isArray(gen.half[0]) ? (gen.half as readonly (readonly number[])[]).map((c) => scaleCurve(c, k)) : scaleCurve(gen.half as readonly number[], k);
    return { grade: { g3: { half: half as ParticleSpec['half'], color: retintCurve(gen.grade?.g3?.color ?? gen.color, PALE_CYAN) } } };
  };

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'judge r3 C8 / S0c: pale cyan g3 floor discs at 2/3 size, recoloured relative to the generated luma (no absolute display colour); READABLE: no blow-out where the bursts stack',
  specs: {
    'sk.crushing_blow': {
      // readability rule for every element of the spec (runtime default when an element sets none): occlude 0.5, clamp 1
      set: READABLE,
      el: {
        // the three burst discs (bottom_under) and the second, flatter disc of each burst
        'gyeoksantau_triple#0': g3Disc(0.67),
        'gyeoksantau_triple#4': g3Disc(0.67),
        'gyeoksantau_triple#5': g3Disc(0.67),
        'gyeoksantau_triple#9': g3Disc(0.67),
        'gyeoksantau_triple#10': g3Disc(0.67),
        'gyeoksantau_triple#14': g3Disc(0.67),
      },
    },
  },
};
