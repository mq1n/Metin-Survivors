// shaman skill effects (FxSpec, ids `sk.<skillId>`): one file per skill family in ./{talisman,dragon,spirit,thunder}.ts.
// Authoring guide, converter and comparison workflow: ../../spec/README.md.
import { classPack } from '../families';
import type { FxSpec } from '../../spec/types';
import { SHAMAN_DRAGON_SPECS } from './dragon';
import { SHAMAN_MOMENT_SPECS } from './moments';
import { SHAMAN_SPIRIT_SPECS } from './spirit';
import { SHAMAN_THUNDER_SPECS } from './thunder';
import { DRIFTING_CHARMS, DRIFTING_CHARMS_EXPLODE } from './talisman';

// the skill-logic moments (./moments.ts, `moment: true`) go LAST: a live generated family drops every hand spec of its skill except these
export const SHAMAN_SPECS: FxSpec[] = [DRIFTING_CHARMS, DRIFTING_CHARMS_EXPLODE, ...SHAMAN_DRAGON_SPECS, ...SHAMAN_SPIRIT_SPECS, ...SHAMAN_THUNDER_SPECS, ...SHAMAN_MOMENT_SPECS];

// LAZY CLASS CHUNK (vfx-lazy-families.txt, spec/README.md "Lazy class chunks"): skills/loader.ts ensureSkillVfx() imports this module before a
// run whose party has a shaman hero (and the gallery / tools / tests through ensureAllSkillVfx()); nothing else imports it, so the bundler keeps it
// out of the eager vfx chunk. The one-line wiring files of THIS directory (`<skillId>.family.ts`) register their generated family when
// this module is evaluated; a live family replaces the hand specs of its skill in the pack below. Vite / Vitest expand import.meta.glob; a
// plain bun / node script gets the hand specs only.
let wiring: Record<string, unknown> = {};
try {
  wiring = import.meta.glob('./*.family.ts', { eager: true });
} catch {
  // no Vite: hand specs only
}

export default classPack('shaman', SHAMAN_SPECS, wiring);
