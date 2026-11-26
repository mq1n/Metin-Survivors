// Enemy death + spawn feedback (common VFX, owner: the death-spawn builder). `sk.gen.monster_die` / `sk.gen.monster_appear` are the two

// ./art.ts); the classic ids death.* / spawn.* play variants of the same two looks (./presets.ts). Spec format + workflow:
// ../../spec/README.md; ids are the contract (../README.md).
import type { FxSpec } from '../../spec/types';
import { appearSpec, dieSpec } from './elements';


export const MONSTER_DIE: FxSpec = dieSpec(
  'sk.gen.monster_die',
  'Monster death: a small burst of translucent dark magenta-maroon smoke puffs thrown up from the hip, billowing and thinning out in half a second; no flash, no ring, the corpse stays readable',
);


export const MONSTER_APPEAR: FxSpec = appearSpec(
  'sk.gen.monster_appear',
  'Monster appear: a translucent dark spiral of broken arcs (t0.1) thickening into a near-black violet smoky mass with feathered edges, a lit violet ring appearing INSIDE it (t0.3) and growing out past its edge while the mass fades (t0.5), a few red specks',
);

/** the band-spawn whisper (`spawn.ring` hook, route.ts): a thin ground swirl, 4 particles, so a stream of spawns never turns into noise */
export const SPAWN_WHISPER: FxSpec = appearSpec(
  'sk.gen.spawn_ring',
  'Band / pack spawn: the monster_appear vortex at a fraction of the cost: the translucent spiral, a small dark mass and the lit ring, no specks',
  { half: 0.85, puffs: 0, specks: 0, alpha: 0.9, rimAlpha: 0.55, lite: true },
  0.6,
);

export const specs: FxSpec[] = [MONSTER_APPEAR, MONSTER_DIE, SPAWN_WHISPER];
