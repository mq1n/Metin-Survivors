// Wiring of the GENERATED tide_of_the_slain family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.tide_of_the_slain

import { GEN } from '../_gen/tide_of_the_slain.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './tide_of_the_slain.patch';

registerPatchedFamily('tide_of_the_slain', GEN, PATCH, { live: true });
