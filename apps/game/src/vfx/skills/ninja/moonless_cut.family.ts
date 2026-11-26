// Wiring of the GENERATED ambush family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.moonless_cut

import { GEN } from '../_gen/moonless_cut.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './moonless_cut.patch';

registerPatchedFamily('moonless_cut', GEN, PATCH, { live: true });
