// Wiring of the GENERATED berserk family (spec/README.md "Generated families + patches"): found by the class entry warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.warfever

import { GEN } from '../_gen/warfever.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './warfever.patch';

registerPatchedFamily('warfever', GEN, PATCH, { live: true });
