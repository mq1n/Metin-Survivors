// COMMON-FAMILY CHUNK: the generated families of the common skills (classId `common` in skills.json: stallion_stomp, arc_of_might, ...). Every
// hero can cast them, so skills/loader.ts ensureSkillVfx() loads this entry for EVERY run, next to the party's class chunks (it is never
// part of a class chunk and never of the eager vfx chunk: the vite `vfx` group test leaves skills/shared out, see apps/game/vite.config.ts).
//
// To give a common skill a generated family: `skills/_gen/<id>.gen.ts` (regen.ts), `skills/shared/<id>.patch.ts`, and the one-line wiring
// `skills/shared/<id>.family.ts` (registerPatchedFamily('<id>', GEN, PATCH, { live: true })). `touch skills/shared/index.ts` for a running dev
// server. The hand specs of the common skills stay in skills/common.ts (COMMON_SPECS, eager): when a family goes live, delete the hand
// spec of that skill in the same change (an id in both places is replaced by the family at install time, but a leftover hand companion
// such as `.cast` would stay, and the spec host keeps the hand spec's art keys for the id).
import { classPack } from '../families';

let wiring: Record<string, unknown> = {};
try {
  wiring = import.meta.glob('./*.family.ts', { eager: true });
} catch {
  // no Vite: hand specs only
}

export default classPack('common', [], wiring);
