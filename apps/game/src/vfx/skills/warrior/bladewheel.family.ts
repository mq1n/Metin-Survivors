// Wiring of the GENERATED bladewheel family (spec/README.md "Generated families + patches"): found by skills/warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.bladewheel (blind critic S4: family won; in-game rank-7 gate passed; art-budget pins of specArt.test.ts hold with it).
import { GEN } from '../_gen/bladewheel.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './bladewheel.patch';

registerPatchedFamily('bladewheel', GEN, PATCH, { live: true });
