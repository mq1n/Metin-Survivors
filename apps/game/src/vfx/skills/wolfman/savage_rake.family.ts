// Wiring of the GENERATED shred family (spec/README.md "Generated families + patches"): found by the class entry wolfman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.savage_rake

import { GEN } from '../_gen/savage_rake.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './savage_rake.patch';

registerPatchedFamily('savage_rake', GEN, PATCH, { live: true });
