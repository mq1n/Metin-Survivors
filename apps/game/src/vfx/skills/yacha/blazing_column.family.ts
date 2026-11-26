// Wiring of the GENERATED blazing_column family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.blazing_column

import { GEN } from '../_gen/blazing_column.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './blazing_column.patch';

registerPatchedFamily('blazing_column', GEN, PATCH, { live: true });
