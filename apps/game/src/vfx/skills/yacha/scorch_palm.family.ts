// Wiring of the GENERATED scorch_palm family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.scorch_palm

import { GEN } from '../_gen/scorch_palm.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './scorch_palm.patch';

registerPatchedFamily('scorch_palm', GEN, PATCH, { live: true });
