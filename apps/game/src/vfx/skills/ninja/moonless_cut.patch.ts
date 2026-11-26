
// S4 ninja wave (2026-10-27), judge r3 notes: RAW has the cyan hand orb, the 0.6 s green ring and the burst time right, but the chain of pink / orange puff

// with the sprite made from that texture, vfx_ambush_rays), and the burst is a horizontal starburst (C12-DIR: the converter's ray direction is the owner's
// open item, so the stretch fans amseup_blow#0 / #1 / amseup_2_blow#4 / amseup_3_blow#5 are neither shrunk nor recoloured here; they stay generated).

// Colours: only relative to the generated value (tintMul) or the hand part's own colours with `space: 'linear'`.
import type { ElementSpec } from '../../spec/types';
import { READABLE, tintMul, type SkillPatch } from '../../spec/patch';
import type { GEN_KEYS } from '../_gen/moonless_cut.gen';


const AMB_RAYS = { art: 'vfx_ambush_rays', fallback: 'raysSoft' } as const;
/** upward ray spray (base on the lower middle of the sprite): the soft fan / thin shaft rising from the stab */
const AMB_SPRAY = { art: 'vfx_rayfan_upspray_a', fallback: 'raysHalf' } as const;


const SPRAY: ElementSpec = {
  kind: 'particle',
  key: 'hand#spray',
  note: 'HAND ambush: amseup_blow half_ring_rainbow_line stretched up -> soft ray spray rising from the stab (upright quad, base at the stab)',
  t0: 0.443,
  cycle: 0.1,
  tEnd: 0.1,
  max: 1,
  rate: [0, 134],
  life: [0, 0.2],
  half: [0, 0.5],
  at: [0, 0.44, 0],
  scale: [[0, 0.6], [0, 4.4]],
  color: [0, 0xe6f2ff, 0.9, 0.3, 0xbcd8ff, 0.7, 1, 0x9cc4ff, 0],
  billboard: 'upright',
  from: 'hand_r',
  blend: 'add',
  space: 'linear',
  tex: AMB_SPRAY,
  grade: {
    g1: { at: [0, 0.5, 0], scale: [[0, 0.7], [0, 5]], color: [0, 0xe0eeff, 0.75, 0.3, 0xa8cdff, 0.6, 1, 0x84b5fe, 0] },
    g2: { at: [0, 0.6, 0], scale: [[0, 1.5], [0, 6]], color: [0, 0xe8dcff, 0.8, 0.3, 0xb0a0ff, 0.6, 1, 0x7c70ff, 0] },
    g3: { at: [0, 0.72, 0], scale: [[0, 2.4], [0, 7.2]], color: [0, 0xffe6d8, 0.6, 0.3, 0xffc0a0, 0.42, 1, 0xfda483, 0] },
  },
};

export const PATCH: SkillPatch<typeof GEN_KEYS> = {
  note: '',
  specs: {
    'sk.moonless_cut': { set: READABLE },
    'sk.moonless_cut.cast': {
      // the cast part fires at the first motion event (0.027 s) on the hand: the spray rises from the stab at the blow event (0.449 s)
      set: { ...READABLE, dur: 0.75 },
      add: [SPRAY],
      el: {
        
        'amseup_fallow#0': (gen) => ({ tex: AMB_RAYS, ...tintMul(1.3)(gen) }),
        'amseup_3_fallow#1': (gen) => ({ tex: AMB_RAYS, ...tintMul(1.3)(gen) }),
      },
    },
  },
};
