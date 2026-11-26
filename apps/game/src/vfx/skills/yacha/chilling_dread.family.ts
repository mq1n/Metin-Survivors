// Wiring of the GENERATED fear family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.chilling_dread

import { GEN } from '../_gen/chilling_dread.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './chilling_dread.patch';

registerPatchedFamily('chilling_dread', GEN, PATCH, { live: true });
