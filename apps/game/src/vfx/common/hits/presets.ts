// Hit feedback classic ids `hit.<element>` + `hit.crit` (common VFX target `hits`; owner: the hits builder).
// r1 rebuild (2026-10-13): every id keeps its PresetDef slot in the registry (ids + order are the contract) but now plays
// an FxSpec on generated sprites (./elements.ts, ./specs.ts): the old hitCore + decoration template, the hairline
// halo / ground rings, paper shards, leaf drops and the white-out crit disc are gone.
import type { Inst } from '../../system';
import { specPreset } from '../../spec/preset';
import type { FxSpec } from '../../spec/types';
import type { PresetDef } from '../../presets/types';
import { ELEMENT_HIT_SPECS } from './elements';
import { CRIT_BURST_CORE, CRIT_BURST_RING } from './specs';

/** an element hit spec as a classic `hit` preset (size mult, body-height spawn by the caller) */
function hitPreset(spec: FxSpec): PresetDef {
  return { ...specPreset(spec), cat: 'hit', size: 'mult', base: 0.8, demo: { ground: false } };
}

/** largest body scale of the crit-burst core */
export const CRIT_BURST_CORE_MAX = 1.35;
/** largest scale of the crit-burst ground band (r3: it used to follow the whole burst radius and ballooned past three enemy lengths;
 *  1.5 = a band about 2.5 m across, one ring on screen) */
export const CRIT_BURST_RING_MAX = 1.5;

function critBurst(): PresetDef {
  return {
    id: 'hit.crit',
    cat: 'hit',
    desc: 'Critical burst proc (vfx_crit_burst): ONE golden swirl band sweeping out along the ground (size-capped) + a gold haze column, hot core and flame flicks at the centre.',
    size: 'mult',
    base: 1,
    palette: 'warriorGold',
    dur: 0,
    loop: false,
    fire(fx, c) {
      const sp = fx.spec;
      if (!sp) return;
      const s = c.scale;
      c.scale = Math.min(s, CRIT_BURST_RING_MAX);
      sp.play(CRIT_BURST_RING, c, false, c as Inst);
      c.scale = Math.min(s, CRIT_BURST_CORE_MAX);
      sp.play(CRIT_BURST_CORE, c, false, c as Inst);
      c.scale = s;
    },
  };
}

export const presets: PresetDef[] = [...ELEMENT_HIT_SPECS.map(hitPreset), critBurst()];
