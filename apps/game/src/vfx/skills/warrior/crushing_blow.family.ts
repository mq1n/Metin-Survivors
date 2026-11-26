// Wiring of the GENERATED Bash family (spec/README.md "Generated families + patches"): found by skills/index.ts through
// import.meta.glob('./*/*.family.ts'). live: true = this family replaces the hand spec sk.crushing_blow of mental.ts (judge strips g0 + g3:

import { GEN } from '../_gen/crushing_blow.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './crushing_blow.patch';

registerPatchedFamily('crushing_blow', GEN, PATCH, { live: true });
