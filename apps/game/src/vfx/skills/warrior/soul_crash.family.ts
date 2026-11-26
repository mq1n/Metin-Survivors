// Wiring of the GENERATED soul_crash family (spec/README.md "Generated families + patches"): found by skills/warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.soul_crash (blind critic S4: family won; in-game rank-7 gate passed, white 0.55 % where the hand spec measured 5.16 %; art-budget pins of specArt.test.ts hold with it).
import { GEN } from '../_gen/soul_crash.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './soul_crash.patch';

registerPatchedFamily('soul_crash', GEN, PATCH, { live: true });
