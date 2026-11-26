// Wiring of the GENERATED dash family (spec/README.md "Generated families + patches"): found by the class entry warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.spearhead

import { GEN } from '../_gen/spearhead.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './spearhead.patch';

registerPatchedFamily('spearhead', GEN, PATCH, { live: true });
