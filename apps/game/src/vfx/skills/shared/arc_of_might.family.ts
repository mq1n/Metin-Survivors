// Wiring of the GENERATED arc_of_might family (COMMON skill, classId common): found by the shared entry shared/index.ts through
// import.meta.glob('./*.family.ts') and loaded for EVERY run next to the party's class chunks. live: true = this family replaces the hand spec sk.arc_of_might

import { GEN } from '../_gen/arc_of_might.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './arc_of_might.patch';

registerPatchedFamily('arc_of_might', GEN, PATCH, { live: true });
