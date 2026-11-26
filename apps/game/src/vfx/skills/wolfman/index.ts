// wolfman skill effects (FxSpec, ids `sk.<skillId>`). Owner: the wolfman skill-VFX agent assigned by Main (one owner per file);
// authoring guide, converter and comparison workflow: ../../spec/README.md.
//  - crimson.ts: doctrine a (crimson wolf: Shred, Lupine Lunge, Redmane Spirit, Rending Gale + originals) and the
//    Moonmane Spirit twin of Redmane Spirit (same possession builder);
//  - indigo.ts: doctrine b (indigo wolf: Rimewind, Moonsteel Claws + originals).
import { classPack } from '../families';
import type { FxSpec } from '../../spec/types';
import { WOLFMAN_CRIMSON_SPECS } from './crimson';
import { WOLFMAN_INDIGO_SPECS } from './indigo';
import { WOLFMAN_MOMENT_SPECS } from './moments';

// the skill-logic moments (moments.ts, `moment: true`) come last: a live generated family keeps them (families.ts resolveSkillSpecs)
export const WOLFMAN_SPECS: FxSpec[] = [...WOLFMAN_CRIMSON_SPECS, ...WOLFMAN_INDIGO_SPECS, ...WOLFMAN_MOMENT_SPECS];

// LAZY CLASS CHUNK (vfx-lazy-families.txt, spec/README.md "Lazy class chunks"): skills/loader.ts ensureSkillVfx() imports this module before a
// run whose party has a wolfman hero (and the gallery / tools / tests through ensureAllSkillVfx()); nothing else imports it, so the bundler keeps it
// out of the eager vfx chunk. The one-line wiring files of THIS directory (`<skillId>.family.ts`) register their generated family when
// this module is evaluated; a live family replaces the hand specs of its skill in the pack below. Vite / Vitest expand import.meta.glob; a
// plain bun / node script gets the hand specs only.
let wiring: Record<string, unknown> = {};
try {
  wiring = import.meta.glob('./*.family.ts', { eager: true });
} catch {
  // no Vite: hand specs only
}

export default classPack('wolfman', WOLFMAN_SPECS, wiring);
