// Wiring of the GENERATED stormcall family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.stormcall

import { GEN } from '../_gen/stormcall.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './stormcall.patch';

registerPatchedFamily('stormcall', GEN, PATCH, { live: true });
