// Wiring of the GENERATED creeping_venom family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.creeping_venom

import { GEN } from '../_gen/creeping_venom.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './creeping_venom.patch';

registerPatchedFamily('creeping_venom', GEN, PATCH, { live: true });
