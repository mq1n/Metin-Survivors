
// Every entry is an override keyed by the generated element keys (a stale key fails tsc here and skillFamilies.test.ts).

// at 1.05-1.1) at 1.23-1.38x its added light, but the blast's peak frame is 1.27-1.61x (close / game); the old hand spec was a white column at 0.15-0.33x.
// Only the blast (comet bundles #6 / #7 / #8 and the starburst #0) is lowered, x0.8 of the GENERATED colour (relative); the pillar, the disc and the cast
// part are untouched.
//
// SKILL-LOGIC (2026-10-27, DESIGN section 5 "Yasama Istegi", WP "second_wind cone switch"): second_wind is a CONE now (skills.json behavior 'cone', range 8,
// angle 1.1; regen rewrote the family as behavior cone, base 8 m = the cone length, k = 1 at the shipped range). The sim damages the fan THE MOMENT the

// stays, and the forward blast (every element of the 0.761 s strike group) lands at 0.25 s instead of 0.761 s: gather, then strike, inside a quarter

// core also darkens the caster, and the pillar stands on the hero): readability is `clamp` only.
import { sizeBy, tintMul, type ElementPatch, type SkillPatch } from '../../spec/patch';
import type { ElementSpec, ParticleSpec, SurfaceSpec } from '../../spec/types';
import type { GEN_KEYS } from '../_gen/second_wind.gen';


const STRIKE_T0 = 0.25;
/**
 * Fix round 2 (vfx critic): "gather-then-strike was out of order": the lightning column (gihyeol_spark#0 / #2, gihyeol_3_spark#3: 2 cycles of 0.5 s = 1.0 s) and the cyan ground
 * disc (#1, 2 cycles) kept gathering until +1.1 s, long after the fan fired at 0.25 s, and the white-gold column core sat over the head (hero-crop white 25 %). Every gather element
 * now runs ONE 0.25 s cycle (it ends exactly at the strike) with clamp 0.7 (no bright core); the disc is also cut to 0.6 x.
 */
const gather = { cycle: 0.25, loops: 1, clamp: 0.7 } as const;
const gatherDisc = <E extends ElementSpec>(gen: E): ElementPatch<E['kind']> => ({ ...sizeBy({ k: 0.6 })(gen), ...gather }) as ElementPatch<E['kind']>;
const strike = { t0: STRIKE_T0 };
/** the blast elements: the strike time plus the S4 x0.8 of the generated colour (relative) */
const strikeDim = <E extends ElementSpec>(gen: E): ElementPatch<E['kind']> => ({ ...tintMul(0.6)(gen), ...strike }) as ElementPatch<E['kind']>;
/** the big ground splash / ray fan of the strike (half 3 x k, white at P) lit the whole screen white (11.8 % white-out at +0.3 s): x0.55 of the generated light on top of the strike time */
const strikeSplash = <E extends ElementSpec>(gen: E): ElementPatch<E['kind']> => ({ ...tintMul(0.55)(gen), ...strike }) as ElementPatch<E['kind']>;







const FAN: ElementSpec[] = [
  {
    kind: 'surface',
    key: 'lf_fan#0',
    note: 'the wedge footprint: a gold-white sector of the cone (63 deg, 8 m) sweeping out from the hero and fading',
    t0: STRIKE_T0,
    life: 0.32,
    shape: { kind: 'arc', r0: 0.5, r1: 8, span: 63, a0: -31.5 },
    at: [0, 0.08, 0],
    scale: [0, 0.25, 0.4, 1, 1, 1],
    color: [0, 0xfff6d8, 0.32, 0.35, 0xffe8a0, 0.18, 1, 0xffd060, 0],
    blend: 'add',
    tex: 'glowStrip',
    soft: 0.9,
    softU: 0.3,
    clamp: 1,
  } satisfies SurfaceSpec,
  {
    kind: 'particle',
    key: 'lf_fan#1',
    note: 'streakHard (stretch): white-blue light needles fanning out along the wedge at 40 m/s',
    t0: STRIKE_T0,
    cycle: 0.1,
    max: 16,
    rate: [0, 1000],
    life: [0, 0.2],
    at: [0, 1.0, 0.5],
    dir: { z: [0, 100] },
    jitter: [0.12, 0.01, 0],
    vel: [0, 0.4],
    half: [[0, 0.045], [0, 0.8]],
    scale: [0, 1, 0.7, 1, 1, 0.4],
    color: [0, 0xffffff, 1, 0.5, 0xd0ffe0, 0.9, 1, 0x60e0a0, 0],
    billboard: 'stretch',
    blend: 'add',
    tex: 'streakHard',
    clamp: 1,
  } satisfies ParticleSpec,
  {
    kind: 'particle',
    key: 'lf_fan#3',
    note: '',
    t0: STRIKE_T0,
    cycle: 0.3,
    max: 1,
    rate: [0, 1000],
    life: [0, 0.3],
    at: [0, 0.12, 1.6],
    half: [0, 2.4],
    scale: [0, 0.5, 0.5, 1.1, 1, 1.3],
    color: [0, 0xffffff, 0.5, 0.5, 0xe8fff0, 0.3, 1, 0xa0f0c8, 0],
    billboard: 'ground',
    blend: 'add',
    tex: 'slashArc',
    clamp: 0.7,
  } satisfies ParticleSpec,
  {
    kind: 'particle',
    key: 'lf_fan#2',
    note: 'a second, thinner spray of pink needles a beat later (g3 has green and pink sparks)',
    t0: STRIKE_T0 + 0.05,
    cycle: 0.1,
    max: 10,
    rate: [0, 1000],
    life: [0, 0.2],
    at: [0, 0.8, 0.5],
    dir: { z: [0, 100] },
    jitter: [0.1, 0.01, 0],
    vel: [0, 0.34],
    half: [[0, 0.03], [0, 0.6]],
    scale: [0, 1, 0.7, 1, 1, 0.4],
    color: [0, 0xffffff, 1, 0.5, 0xffc0e0, 0.85, 1, 0xff60b0, 0],
    billboard: 'stretch',
    blend: 'add',
    tex: 'streakHard',
    clamp: 1,
    minTier: 1,
  } satisfies ParticleSpec,
];

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: 'skill-logic: cone contract; clamp only (no occlude); the 0.761 s strike group lands at 0.25 s; blast x0.8',
  specs: {
    'sk.second_wind': {
      set: { clamp: 1 },
      add: FAN,
      el: {
        'gihyeol_spark#0': gather,
        'gihyeol_spark#1': gatherDisc,
        'gihyeol_spark#2': gather,
        'gihyeol_3_spark#3': gather,
        'gihyeol#0': strikeDim,
        // the splash dome (splash_dome_top, ground half 3 x k, white at P) is the 'jellyfish' that lit 10.6 % of the screen white at +0.3 s: dropped (the wedge sector + needles + crescent carry the fan)
        'gihyeol#1': null,
        'gihyeol#2': strikeSplash,
        'gihyeol#3': strikeSplash,
        'gihyeol#4': strike,
        'gihyeol#5': strike,
        'gihyeol#6': strike,
        'gihyeol_2#6': strikeDim,
        'gihyeol_2#7': strikeDim,
        'gihyeol_2#8': strikeDim,
      },
    },
    'sk.second_wind.cast': { set: { clamp: 1 } },
  },
};
