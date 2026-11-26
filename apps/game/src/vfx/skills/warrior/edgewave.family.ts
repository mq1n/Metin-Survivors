// Wiring of the GENERATED edgewave family (spec/README.md "Generated families + patches"): found by the class entry warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.edgewave

import { GEN } from '../_gen/edgewave.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './edgewave.patch';

registerPatchedFamily('edgewave', GEN, PATCH, { live: true });
