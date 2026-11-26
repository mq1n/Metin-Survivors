// Wiring of the GENERATED swiftness family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.tailwind

import { GEN } from '../_gen/tailwind.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './tailwind.patch';

registerPatchedFamily('tailwind', GEN, PATCH, { live: true });
