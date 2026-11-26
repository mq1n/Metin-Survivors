
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).

// 1.1-1.16x its added light; the old hand spec was a thin white column at 0.09-0.13x. The hard star rays of the 1.0-1.2 s glow are
// the sprite structure (judge class C10): not patched here, written in the notes for the sprite owner.
//


// dome round the body: the two floor fans (and the 12 m upright red rays burst gyeokgongjang#3, cut to x0.33) are replaced by / scaled to `sb_dome` - four upright wing planes (splashArch cards turned 0 / 45 / 90 / 135 deg, ~4 m
// across, alpha <= 0.5, red-orange) standing round the body at 1.4 s; (2) the 0.4-1.2 s charge sphere (flare orb ringcore, gyeokgongjang#2) was invisible at zoom 22: x1.45
// of the generated light (relative; under the 1.5 luma-up warning) and a bigger sprite.
import { READABLE, sizeBy, tintMul, type ElementPatch, type SkillPatch } from '../../spec/patch';
import type { ParticleSpec, SurfaceSpec } from '../../spec/types';
import type { GEN_KEYS } from '../_gen/graniteform.gen';

/** one upright red-orange wing plane of the shell dome: a splashArch card (an arch band with a bright rim), `yaw` deg round the body, rising 0.1 s before the full shell */
const wing = (i: number, yaw: number): SurfaceSpec => ({
  kind: 'surface',
  key: `sb_dome#${i}`,
  note: `dome wing ${i + 1}: an upright splashArch card turned ${yaw} deg (4 m across, 2 m tall at the cast scale 2.2) - one lobe of the red-orange shell`,
  t0: 1.4,
  life: 0.55,
  shape: { kind: 'card', w: 1.8, h: 0.95 },
  at: [0, 0.05, 0],
  rot: [yaw, 0, 0],
  scale: [[0, 0.35, 0.3, 1, 1, 1.08], [0, 0.4, 0.3, 1, 1, 1.05], [0, 1, 1, 1]],
  color: [0, 0xff9a50, 0, 0.18, 0xff7a30, 0.5, 0.65, 0xe85a20, 0.35, 1, 0xc03a10, 0],
  blend: 'add',
  tex: 'splashArch',
  bright: 1.2,
  clamp: 0.9,
  soft: 0.6,
  space: 'linear',
});

/** the charge orb: x1.45 of the generated light and a 1.4 x sprite (relative) so it reads at zoom 22 */
const orb = (gen: ParticleSpec): ElementPatch<'particle'> => ({ ...sizeBy({ k: 1.4 })(gen), ...tintMul(1.45)(gen) }) as ElementPatch<'particle'>;

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'S4 warrior: READABLE; the persistent blue ring moved to the tracked sk.graniteform.loop (skill-logic); the 12 m floor fan became a 4 m four-lobed dome; the charge orb lifted',
  specs: {
    'sk.graniteform': {
      set: READABLE,
      // skill-logic (2026-10-27): the AFFECT loop (gyeokgongjang_loop#0..3) is a TRACKED part now, `sk.graniteform.loop` (warrior/moments.ts, the same
      // numbers, art keys and lifted tints), so it lives exactly as long as the stone ward; the cast keeps the one-shot burst only
      el: {
        'gyeokgongjang_loop#0': null,
        'gyeokgongjang_loop#1': null,
        'gyeokgongjang_loop#2': null,
        'gyeokgongjang_loop#3': null,
        // the flat 12 m floor fan of the red shell (rank 7 band and the base): replaced by the dome below
        'gyeokgongjang#5': null,
        'cheongeun_4#7': null,
        // the 12 m fan itself: the upright 2-face rays burst of the red shell (gyeokgongjang#3: P half 1.2 x scale up to 9 = 10.8 m of red rays) -> x0.33 = the 4 m dome
        'gyeokgongjang#3': sizeBy({ k: 0.33 }),
        'gyeokgongjang#2': orb,
      },
      add: [wing(0, 0), wing(1, 45), wing(2, 90), wing(3, 135)],
    },
  },
};
