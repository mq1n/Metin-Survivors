// yacha skill effects (FxSpec, ids `sk.<skillId>`). Owner: the yacha skill-VFX agent assigned by Main (one owner per file);
// authoring guide, converter and comparison workflow: ../../spec/README.md. Split by doctrine: ./weaponry.ts (a),
// ./magic.ts (b).
import { classPack } from '../families';
import type { FxSpec } from '../../spec/types';
import { YACHA_MAGIC_SPECS } from './magic';
import { YACHA_MOMENT_SPECS } from './moments';
import { YACHA_WEAPONRY_SPECS } from './weaponry';

// the skill-logic moments (./moments.ts, `moment: true`) go LAST: a live generated family drops every hand spec of its skill except these
export const YACHA_SPECS: FxSpec[] = [...YACHA_WEAPONRY_SPECS, ...YACHA_MAGIC_SPECS, ...YACHA_MOMENT_SPECS];

// LAZY CLASS CHUNK (vfx-lazy-families.txt, spec/README.md "Lazy class chunks"): skills/loader.ts ensureSkillVfx() imports this module before a
// run whose party has a yacha hero (and the gallery / tools / tests through ensureAllSkillVfx()); nothing else imports it, so the bundler keeps it
// out of the eager vfx chunk. The one-line wiring files of THIS directory (`<skillId>.family.ts`) register their generated family when
// this module is evaluated; a live family replaces the hand specs of its skill in the pack below. Vite / Vitest expand import.meta.glob; a
// plain bun / node script gets the hand specs only.
let wiring: Record<string, unknown> = {};
try {
  wiring = import.meta.glob('./*.family.ts', { eager: true });
} catch {
  // no Vite: hand specs only
}

export default classPack('yacha', YACHA_SPECS, wiring);
