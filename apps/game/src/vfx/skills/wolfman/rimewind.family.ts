// Wiring of the GENERATED rimewind family (spec/README.md "Generated families + patches"): found by the class entry wolfman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.rimewind (blind critic S4: family won; in-game rank-7 gate

import { GEN } from '../_gen/rimewind.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './rimewind.patch';

registerPatchedFamily('rimewind', GEN, PATCH, { live: true });
