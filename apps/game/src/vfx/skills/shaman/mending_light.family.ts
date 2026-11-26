// Wiring of the GENERATED cure family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.mending_light

import { GEN } from '../_gen/mending_light.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './mending_light.patch';

registerPatchedFamily('mending_light', GEN, PATCH, { live: true });
