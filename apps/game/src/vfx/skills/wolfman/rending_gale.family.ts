// Wiring of the GENERATED rending_gale family (spec/README.md "Generated families + patches"): found by the class entry wolfman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.rending_gale

import { GEN } from '../_gen/rending_gale.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './rending_gale.patch';

registerPatchedFamily('rending_gale', GEN, PATCH, { live: true });
