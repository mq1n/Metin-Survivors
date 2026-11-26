// Player-side feedback: hit.player, player.evade, player.shield (common VFX target `player-feedback`; owner: the player-feedback
// builder). r1 (2026-10-19): every id keeps its PresetDef slot (ids + order are the contract, ../README.md) but plays an FxSpec on
// shipped sprites (./specs.ts): the old white-red blob with its thin ellipse rings, the long white whiff poles and the glass bubble
// with its hex cells are gone.
import type { PresetDef } from '../../presets/types';
import { specPreset } from '../../spec/preset';
import type { FxSpec } from '../../spec/types';
import { EVADE, HIT_PLAYER, SHIELD } from './specs';

/** a spec as a classic one-shot `hit` preset: size mult, spawned at body height by the route (dir = blow direction) */
function feedbackPreset(spec: FxSpec): PresetDef {
  return { ...specPreset(spec), cat: 'hit', size: 'mult', base: 1, demo: { dir: 0 } };
}

export const presets: PresetDef[] = [feedbackPreset(HIT_PLAYER), feedbackPreset(EVADE), feedbackPreset(SHIELD)];
