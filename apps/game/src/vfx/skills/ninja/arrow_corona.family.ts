// Wiring of the GENERATED arrow_corona family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.arrow_corona

import { GEN } from '../_gen/arrow_corona.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './arrow_corona.patch';

registerPatchedFamily('arrow_corona', GEN, PATCH, { live: true });
