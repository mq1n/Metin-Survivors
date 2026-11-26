// Wiring of the GENERATED blessing family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.radiant_favor

import { GEN } from '../_gen/radiant_favor.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './radiant_favor.patch';

registerPatchedFamily('radiant_favor', GEN, PATCH, { live: true });
