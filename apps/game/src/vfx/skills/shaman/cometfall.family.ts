// Wiring of the GENERATED meteor family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.cometfall

import { GEN } from '../_gen/cometfall.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './cometfall.patch';

registerPatchedFamily('cometfall', GEN, PATCH, { live: true });
