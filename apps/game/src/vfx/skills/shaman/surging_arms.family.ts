// Wiring of the GENERATED surging_arms family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.surging_arms

import { GEN } from '../_gen/surging_arms.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './surging_arms.patch';

registerPatchedFamily('surging_arms', GEN, PATCH, { live: true });
