// Wiring of the GENERATED stormglass_shell family (spec/README.md "Generated families + patches"): found by the class entry shaman/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.stormglass_shell

import { GEN } from '../_gen/stormglass_shell.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './stormglass_shell.patch';

registerPatchedFamily('stormglass_shell', GEN, PATCH, { live: true });
