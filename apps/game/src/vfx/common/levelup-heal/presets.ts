// Self feedback: heals, revive, death, buffs, alt level-up: the classic preset ids of this target (common VFX, owner: the

// into PresetDefs of the SAME ids here, because the C0 legacy barrels list these ids as classic presets (registryIds.test.ts
// pins them) and the sim / adapter / galleries fire them by id. specPreset registers every spec with the spec host, so the
// sprites are packed in every run (no skill claims these ids: spec/artScope.ts).
import type { PresetDef } from '../../presets/types';
import { specPreset } from '../../spec/preset';
import type { FxSpec } from '../../spec/types';
import { selfSpecs } from './selfSpecs';

/**
 * The legacy fields a spec-built preset keeps (vfx/presets/README.md rows, pinned by presets.test.ts): category, follow
 * (loops), gallery loop length, the V column (these ids accept a palette / element suffix: the id resolves and plays the
 * spec as authored, a spec keeps its own colours), and `size: 'mult'` (M rows: the route / alias hands a plain multiplier).
 */
const OVERRIDES: Readonly<Record<string, Partial<PresetDef>>> = {
  'player.death': { cat: 'death', size: 'mult', base: 1 },
  'player.revive': { size: 'mult', base: 1 },
  'holy.heal': { size: 'mult', base: 1 },
  'heal.drain': { size: 'mult', base: 1 },
  levelup: { size: 'mult', base: 1 },
  'buff.haste': { follow: true, demo: { loopFor: 3.5 }, variants: true },
  'buff.shield': { follow: true, demo: { loopFor: 3.5 }, variants: true },
  'buff.stealth': { variants: true },
  'aura.heal': { variants: true },
};

function wrap(spec: FxSpec): PresetDef {
  return { ...specPreset(spec), cat: 'buff', ...OVERRIDES[spec.id] };
}

export const presets: PresetDef[] = selfSpecs.map(wrap);
