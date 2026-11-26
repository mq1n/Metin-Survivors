// Self feedback FxSpecs `sk.gen.level_up / skillup / potion_* / potion_auto_*` (common VFX target `levelup-heal`; owner: the

// on generated sprites (./art.ts). The elements live in levelSpecs.ts (level / skill up) and potionSpecs.ts (potions); the
// self-feedback ids that were classic presets (holy.heal, player.revive, ...) are specs wrapped into presets by ./presets.ts.
// Spec format + workflow: ../../spec/README.md; ids are the contract (../README.md).
import type { FxSpec } from '../../spec/types';
import { levelSpecs } from './levelSpecs';
import { potionSpecs } from './potionSpecs';

export const specs: FxSpec[] = [...levelSpecs, ...potionSpecs];
