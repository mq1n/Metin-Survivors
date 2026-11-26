// Wiring of the GENERATED rapid_barrage family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.rapid_barrage

import { GEN } from '../_gen/rapid_barrage.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './rapid_barrage.patch';

registerPatchedFamily('rapid_barrage', GEN, PATCH, { live: true });
