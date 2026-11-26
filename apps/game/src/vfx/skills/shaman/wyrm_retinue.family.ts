// Wiring of the GENERATED wyrm_retinue family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.wyrm_retinue

import { GEN } from '../_gen/wyrm_retinue.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './wyrm_retinue.patch';

registerPatchedFamily('wyrm_retinue', GEN, PATCH, { live: true });
