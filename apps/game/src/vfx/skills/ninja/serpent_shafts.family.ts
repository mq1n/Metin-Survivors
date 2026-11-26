// Wiring of the GENERATED serpent_shafts family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.serpent_shafts

import { GEN } from '../_gen/serpent_shafts.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './serpent_shafts.patch';

registerPatchedFamily('serpent_shafts', GEN, PATCH, { live: true });
