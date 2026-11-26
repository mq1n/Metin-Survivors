// Wiring of the GENERATED lupine_lunge family (spec/README.md "Generated families + patches"): found by the class entry wolfman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.lupine_lunge

import { GEN } from '../_gen/lupine_lunge.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './lupine_lunge.patch';

registerPatchedFamily('lupine_lunge', GEN, PATCH, { live: true });
