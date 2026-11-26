// Wiring of the GENERATED specter_beam family (spec/README.md "Generated families + patches"): found by the class entry yacha/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.specter_beam

import { GEN } from '../_gen/specter_beam.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './specter_beam.patch';

registerPatchedFamily('specter_beam', GEN, PATCH, { live: true });
