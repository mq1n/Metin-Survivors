// Wiring of the GENERATED blade_orbit family (spec/README.md "Generated families + patches"): found by the class entry warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.blade_orbit

import { GEN } from '../_gen/blade_orbit.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './blade_orbit.patch';

registerPatchedFamily('blade_orbit', GEN, PATCH, { live: true });
