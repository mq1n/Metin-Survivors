// Wiring of the GENERATED moonmane_spirit family (spec/README.md "Generated families + patches"): found by the class entry wolfman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.moonmane_spirit

import { GEN } from '../_gen/moonmane_spirit.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './moonmane_spirit.patch';

registerPatchedFamily('moonmane_spirit', GEN, PATCH, { live: true });
