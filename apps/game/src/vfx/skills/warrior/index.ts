// warrior skill effects (FxSpec, ids `sk.<skillId>`). Owner: FxWarrior (one owner per file); authoring guide, converter and
// comparison workflow: ../../spec/README.md. `lightning_trio` = FxAtlas's kit proof (only that const lives here); the other 21

import { classPack } from '../families';
import type { FxSpec } from '../../spec/types';
import { BODY_SPECS } from './body';
import { MENTAL_SPECS } from './mental';
import { WARRIOR_MOMENT_SPECS } from './moments';
import { ORIGINAL_SPECS } from './originals';






const LIGHTNING_TRIO: FxSpec = {
  id: 'sk.lightning_trio',
  desc: '',
  behavior: 'meleeArc',
  ref: {},
  size: 'radius',
  base: 3,
  dur: 0.3,
  elements: [
    {
      kind: 'particle',
      note: '',
      cycle: 0.05,
      max: 10,
      rate: [0, 1000],
      life: [0, 0.0515],
      shape: { kind: 'sphere', radius: 0.3 },
      at: [1, 0.8, 0.8],
      dir: { y: [0, -1.546], z: [0, 70] },
      jitter: [0.08, 0, 0],
      vel: [0, 0.4],
      half: [[0.008, 1.1], [0, 1.1]],
      scale: [[0.04, 0, 0.4, 0.1443], [0.183, 0, 0.331, 0.3505]],
      color: [0, 0xffa040, 0, 0.3, 0xff9a3a, 0.95, 1, 0xfa6447, 0],
      air: [0, 0, 1, 0.2474],
      billboard: 'stretch',
      blend: 'add',
      tex: 'flare',
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.1,
      max: 1,
      rate: [0, 154.6],
      life: [0.001, 0.1546],
      at: [1, 0.8, 0.8],
      dir: { z: [0, 50] },
      vel: [0, 0.4],
      half: [0, 3.4],
      scale: [[0, 0.3505, 0.469, 1.5], [0, 0.1443, 0.211, 0.7113]],
      color: [0, 0xb0d4ff, 0.55, 0.3, 0x9fd8ff, 0.42, 0.6, 0x9fd8ff, 0.08, 1, 0x9fd8ff, 0],
      billboard: 'ground',
      rotation: { start: [180, 180] },
      attach: true,
      blend: 'add',
      tex: 'splashArch',
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.1,
      max: 2,
      rate: [0, 1000],
      life: [0, 0.1],
      at: [1, 0.8, 0.8],
      dir: { z: [0, 50] },
      vel: [0, 0.03093],
      half: [0, 5],
      scale: [[0, 0.1443], [0, 1]],
      color: [0, 0xd25224, 0.4, 1, 0xd25224, 0],
      billboard: 'ground',
      rotation: { start: [30, 140] },
      attach: true,
      blend: 'add',
      bright: 2,
      tex: 'fanLines',
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.1,
      max: 4,
      rate: [0, 61.86],
      life: [0.001, 0.1031],
      at: [1, 0.8, 0.8],
      dir: { z: [0, 18.04] },
      vel: [0, 0.2165],
      half: [0, 4],
      scale: [[0, 0, 0.417, 1], [0, 0, 0.583, 1]],
      color: [0, 0x5fa0f7, 0.14, 0.49, 0x037dba, 0, 1, 0x037dba, 0],
      billboard: 'ground',
      rotation: { start: [200, 160] },
      attach: true,
      blend: 'add',
      bright: 2,
      tex: 'tufts',
    },
  ],
};

// the skill-logic moments (moments.ts, `moment: true`) come last: a live generated family keeps them (families.ts resolveSkillSpecs)
export const WARRIOR_SPECS: FxSpec[] = [LIGHTNING_TRIO, ...BODY_SPECS, ...MENTAL_SPECS, ...ORIGINAL_SPECS, ...WARRIOR_MOMENT_SPECS];

// LAZY CLASS CHUNK (vfx-lazy-families.txt, spec/README.md "Lazy class chunks"): skills/loader.ts ensureSkillVfx() imports this module before a
// run whose party has a warrior hero (and the gallery / tools / tests through ensureAllSkillVfx()); nothing else imports it, so the bundler keeps it
// out of the eager vfx chunk. The one-line wiring files of THIS directory (`<skillId>.family.ts`) register their generated family when
// this module is evaluated; a live family replaces the hand specs of its skill in the pack below. Vite / Vitest expand import.meta.glob; a
// plain bun / node script gets the hand specs only.
let wiring: Record<string, unknown> = {};
try {
  wiring = import.meta.glob('./*.family.ts', { eager: true });
} catch {
  // no Vite: hand specs only
}

export default classPack('warrior', WARRIOR_SPECS, wiring);
