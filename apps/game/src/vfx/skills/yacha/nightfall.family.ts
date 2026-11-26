// Wiring of the GENERATED nightfall family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.nightfall

import { GEN } from '../_gen/nightfall.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './nightfall.patch';

registerPatchedFamily('nightfall', GEN, PATCH, { live: true });
