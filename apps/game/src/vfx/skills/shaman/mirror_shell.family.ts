// Wiring of the GENERATED reflect family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.mirror_shell

import { GEN } from '../_gen/mirror_shell.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './mirror_shell.patch';

registerPatchedFamily('mirror_shell', GEN, PATCH, { live: true });
