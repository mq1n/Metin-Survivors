// Wiring of the GENERATED kindled_shaft family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.kindled_shaft

import { GEN } from '../_gen/kindled_shaft.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './kindled_shaft.patch';

registerPatchedFamily('kindled_shaft', GEN, PATCH, { live: true });
