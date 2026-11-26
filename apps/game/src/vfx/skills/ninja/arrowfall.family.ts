// Wiring of the GENERATED arrowfall family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.arrowfall

import { GEN } from '../_gen/arrowfall.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './arrowfall.patch';

registerPatchedFamily('arrowfall', GEN, PATCH, { live: true });
