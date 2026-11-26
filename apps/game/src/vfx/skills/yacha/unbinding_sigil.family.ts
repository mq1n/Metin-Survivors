// Wiring of the GENERATED dispel family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.unbinding_sigil

import { GEN } from '../_gen/unbinding_sigil.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './unbinding_sigil.patch';

registerPatchedFamily('unbinding_sigil', GEN, PATCH, { live: true });
