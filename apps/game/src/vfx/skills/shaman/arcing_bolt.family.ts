// Wiring of the GENERATED arcing_bolt family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.arcing_bolt

import { GEN } from '../_gen/arcing_bolt.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './arcing_bolt.patch';

registerPatchedFamily('arcing_bolt', GEN, PATCH, { live: true });
