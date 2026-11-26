
// S4 ninja wave (2026-10-27): READABLE; the blast floor disc / ring / wisps dimmed and the floor disc shrunk (in-game white-out gate)
// Everything is keyed by the generated element keys (a stale key fails tsc and skillFamilies.test.ts); colours are only ever edited relative to the generated value.
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import { shrinkDim } from './patchTools';
import type { GEN_KEYS } from '../_gen/kindled_shaft.gen';

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.kindled_shaft': {
      set: READABLE,
      el: {
        // in game (yeonmu stone, rank 7) the white milk-glow floor disc (half 14 m) and the hazy ring (half 10 m) of the blast were 18 % white pixels at the hit: 0.7x size, 0.6x / 0.7x light
        'hwajopa_blow#2': shrinkDim(0.4, 0.5),
        'hwajopa_blow#3': shrinkDim(0.5, 0.5),
        'hwajopa_blow#0': shrinkDim(0.8, 0.4),
        'hwajopa_blow#5': shrinkDim(0.8, 0.4),
        'hwajopa_blow#6': shrinkDim(0.8, 0.4),
        'hwajopa_blow#1': shrinkDim(0.7, 0.5),
        'hwajopa_blow#4': shrinkDim(0.7, 0.5),
        'hwajopa_blow#7': shrinkDim(0.7, 0.5),
        // the arrow's flame shells (the P ones are big) and the charge floor discs at the hero add to the same pale cloud
        'hwajopa#0': tintMul(0.7),
        'hwajopa_3#1': tintMul(0.7),
        'hwajopa_3#2': tintMul(0.7),
      },
    },
    'sk.kindled_shaft.cast': {
      set: READABLE,
      el: {
        'hwajopa_energy#1': tintMul(0.6),
        'hwajopa_energy#2': tintMul(0.7),
        'hwajopa_3_energy#3': tintMul(0.7),
      },
    },
  },
};
