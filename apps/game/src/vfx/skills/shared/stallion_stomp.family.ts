// Wiring of the GENERATED stallion_stomp family (COMMON skill, classId common): found by the shared entry shared/index.ts through
// import.meta.glob('./*.family.ts') and loaded for EVERY run next to the party's class chunks. live: true = this family replaces the hand spec sk.stallion_stomp

import { GEN } from '../_gen/stallion_stomp.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './stallion_stomp.patch';

registerPatchedFamily('stallion_stomp', GEN, PATCH, { live: true });
