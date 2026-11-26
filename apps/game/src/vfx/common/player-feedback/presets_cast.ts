// Player-side feedback: buff.aura, summon.*, burst.dragon_head (common VFX target `player-feedback`; owner: the player-feedback
// builder). r1 (2026-10-19): every id keeps its PresetDef slot (ids + order are the contract, ../README.md) but plays an FxSpec on
// shipped sprites (./specs_self.ts): the rune-circle stamp, the hard-capped light cylinders, the flat flame cards and the
// chevron-arrow "dragon head" are gone.
import type { PresetDef } from '../../presets/types';
import { specPreset } from '../../spec/preset';
import type { FxSpec } from '../../spec/types';
import { BUFF_AURA, DRAGON_HEAD, SUMMON_CIRCLE, SUMMON_DRAGON, SUMMON_GHOST, SUMMON_WOLF } from './specs_self';

type Over = Partial<PresetDef>;

/** a spec as a classic one-shot preset with the legacy flags of the id (size / base / variants / dur / palette) */
function selfPreset(spec: FxSpec, over: Over): PresetDef {
  return { ...specPreset(spec), loop: false, ...over };
}

/** the dragon head faces the screen side its heading points to: the upright profile sprite is mirrored with SpawnOpts.b */
function dragonHead(): PresetDef {
  const base = selfPreset(DRAGON_HEAD, { cat: 'summon', size: 'mult', base: 1.6, variants: true, palette: 'shamanGold', demo: { dir: 0 } });
  return {
    ...base,
    fire(fx, c) {
      c.b = c.dx < 0 ? -1 : 1;
      base.fire(fx, c);
    },
  };
}

export const presets: PresetDef[] = [
  dragonHead(),
  selfPreset(BUFF_AURA, { cat: 'buff', size: 'radius', base: 1.6, variants: true, palette: 'holy', dur: 1.0, demo: {} }),
  selfPreset(SUMMON_CIRCLE, { cat: 'summon', size: 'radius', base: 2.2, variants: true, palette: 'yachaDark', dur: 1.6, demo: {} }),
  selfPreset(SUMMON_DRAGON, { cat: 'summon', size: 'mult', base: 2.4, palette: 'shamanGold', dur: 0, demo: {} }),
  selfPreset(SUMMON_GHOST, { cat: 'summon', size: 'mult', base: 1.4, variants: true, palette: 'yachaFlame', dur: 0, demo: {} }),
  selfPreset(SUMMON_WOLF, { cat: 'summon', size: 'mult', base: 1.6, variants: true, palette: 'wolfmanIndigo', dur: 0, demo: {} }),
];
