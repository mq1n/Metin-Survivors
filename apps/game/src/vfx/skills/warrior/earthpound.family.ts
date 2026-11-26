// Wiring of the GENERATED stump family (spec/README.md "Generated families + patches"): found by the class entry warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.earthpound

import { GEN } from '../_gen/earthpound.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './earthpound.patch';

registerPatchedFamily('earthpound', GEN, PATCH, { live: true });
