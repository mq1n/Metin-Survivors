
// RAW light x1.5 / 2.1 (P) and x1.2 / 1.9 (g0): the burst ring 2jeongeop#2 and its partners dimmed.
// dimTo(f0, f3) = this element's light x f0 at g0 / x f3 at P (size f^(1/4), colour f^(1/2), hue kept: patchTools.ts); every colour edit is relative to the generated value.
import { READABLE, tintMul, type ElementPatch, type SkillPatch } from '../../spec/patch';
import type { ParticleSpec } from '../../spec/types';
import type { GEN_KEYS } from '../_gen/mending_light.gen';
import { dimTo } from './patchTools';

/**
 * Fix round 2 (vfx critic): "the glow pool is a white blob that bleaches legs and torso (hero-crop 21 %) for the pillar's life, exactly when the player is at <= 55 % HP".
 * The two ground glow pools (2jeongeop#0 / #3, glow_orb_smooth half 1.5) and the cream pillar (#6) are x0.6 of the generated light with clamp 0.6 (relative, hue kept).
 */
const softer = (gen: ParticleSpec): ElementPatch<'particle'> => ({ ...tintMul(0.6)(gen), clamp: 0.6 }) as ElementPatch<'particle'>;

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'RAW light x1.5 / 2.1 (P) and x1.2 / 1.9 (g0): the burst ring 2jeongeop#2 and its partners dimmed.',
  specs: {
    'sk.mending_light': {
      set: READABLE,
      el: {
        '2jeongeop#2': dimTo(0.65, 0.55),
        '2jeongeop#3': null,
        // the two glow_orb pools are DROPPED (fix round 2: x0.6 + clamp did not get the hero-crop white under 18 %; the rings #1 / #2 / #5 keep the ground read: a ring, not a disc)
        '2jeongeop#0': null,
        '2jeongeop#6': softer,
        // the rank-7 / base hot cores that sat ON the body (glow_pip_core x2, the ornate screen ring half 1.5, the wide streak band): the same x0.6 + clamp
        '2jeongeop#7': softer,
        '2jeongeop#8': softer,
        '2jeongeop_4#10': softer,
        '2jeongeop_4#11': softer,
      },
    },
  },
};
