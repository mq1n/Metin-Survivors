// Wiring of the GENERATED crackling_stream family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.crackling_stream

import { GEN } from '../_gen/crackling_stream.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './crackling_stream.patch';

registerPatchedFamily('crackling_stream', GEN, PATCH, { live: true });
