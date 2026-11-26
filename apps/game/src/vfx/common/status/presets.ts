// Status / DoT feedback classic ids `hit.dot.burn|poison|bleed` (common VFX target `status`; owner: the status builder).
// r1 rebuild (2026-10-19): every id keeps its PresetDef slot (ids + order are the contract) but now plays an FxSpec on shipped sprites
// (./specs.ts DOT_SPECS): the old ember puff / two wire rings / two sub-pixel sparks are gone (they were invisible at the game camera).
import { specPreset } from '../../spec/preset';
import type { FxSpec } from '../../spec/types';
import type { PresetDef } from '../../presets/types';
import { DOT_SPECS } from './specs';

/** a DoT tick spec as a classic `hit` preset (size mult: the route spawns it at body height, scale 1 = a humanoid) */
function dotPreset(spec: FxSpec): PresetDef {
  return { ...specPreset(spec), cat: 'hit', size: 'mult', base: 1, demo: { ground: false } };
}

export const presets: PresetDef[] = DOT_SPECS.map(dotPreset);
