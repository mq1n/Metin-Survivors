// Wiring of the GENERATED swordlight_ring family (spec/README.md "Generated families + patches"): found by the class entry warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.swordlight_ring

import { GEN } from '../_gen/swordlight_ring.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './swordlight_ring.patch';

registerPatchedFamily('swordlight_ring', GEN, PATCH, { live: true });
