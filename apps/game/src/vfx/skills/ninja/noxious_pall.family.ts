// Wiring of the GENERATED noxious_pall family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.noxious_pall

import { GEN } from '../_gen/noxious_pall.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './noxious_pall.patch';

registerPatchedFamily('noxious_pall', GEN, PATCH, { live: true });
