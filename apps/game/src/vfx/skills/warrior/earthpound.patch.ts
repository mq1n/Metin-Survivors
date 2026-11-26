
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).

// pink rim 1.5, fade 1.6) at 1.0x its added light (peak 0.87-1.04x, strips g3 close / game); the old hand spec is 0.2x. Two clamps on top of READABLE:

//    only (the grade bands, i.e. the P look, keep the generated light);
//  - P in game: 16.5 % of the yeonmu frame went white at +0.3 s (gate 5 %: the yellow-green star ring of 1.5 s is a bright yellow on the stone floor), so the ring
//    layers (rayring_hazy daejingak#0 / _4#0, rayring_wisp #3, wisp_tangle _4#6) are lowered of the GENERATED colour at P (relative, no absolute colour);
//  - with the extended cast times the +0.2 s frame (the blue-violet ring BURST of 1.4 s, two broad vfx_disc_glow_even_w discs, daejingak#2 and _3#1) was
//    58.8 % white (the hand spec 0.7 % at the same time). Final values (3 in-game iterations, 16.5 -> 58.8 -> 0.01 -> 4.12 %): discs x0.5, rings x0.65-0.7, so the

import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/earthpound.gen';
import { both } from './patchKit';

const G0 = tintMul(1.5, { only: ['base'] });

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 warrior: READABLE + g0 base look x1.5 + P ring layers x0.65-0.7 + P broad discs x0.5 of the generated colour',
  specs: {
    'sk.earthpound': {
      set: READABLE,
      el: {
        'daejingak#0': both(G0, tintMul(0.7, { only: ['g3'] })),
        'daejingak#1': G0,
        'daejingak#2': both(G0, tintMul(0.5, { only: ['g3'] })),
        'daejingak#3': both(G0, tintMul(0.65, { only: ['g3'] })),
        'daejingak_4#0': tintMul(0.7),
        'daejingak_4#6': tintMul(0.65),
        'daejingak_3#1': tintMul(0.5),
      },
    },
  },
};
