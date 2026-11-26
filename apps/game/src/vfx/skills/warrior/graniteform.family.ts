// Wiring of the GENERATED graniteform family (spec/README.md "Generated families + patches"): found by the class entry warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.graniteform

import { GEN } from '../_gen/graniteform.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './graniteform.patch';

registerPatchedFamily('graniteform', GEN, PATCH, { live: true });
