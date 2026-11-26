// Wiring of the GENERATED spiral_of_knives family (spec/README.md "Generated families + patches"): found by the class entry ninja/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.spiral_of_knives

import { GEN } from '../_gen/spiral_of_knives.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './spiral_of_knives.patch';

registerPatchedFamily('spiral_of_knives', GEN, PATCH, { live: true });
