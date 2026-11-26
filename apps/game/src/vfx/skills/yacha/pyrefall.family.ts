// Wiring of the GENERATED pyrefall family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.pyrefall

import { GEN } from '../_gen/pyrefall.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './pyrefall.patch';

registerPatchedFamily('pyrefall', GEN, PATCH, { live: true });
