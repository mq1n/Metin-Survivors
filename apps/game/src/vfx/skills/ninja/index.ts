// ninja skill effects (FxSpec, ids `sk.<skillId>`). Owner: FxNinja; authoring guide, converter and comparison workflow:
// ../../spec/README.md. noxious_pall lives here; the other 21 skills live in ./{shadow,blade,archery}.ts (see

import { classPack } from '../families';
import type { FxSpec } from '../../spec/types';
import { ARCHERY_SPECS } from './archery';
import { BLADE_SPECS } from './blade';
import { NINJA_MOMENT_SPECS } from './moments';
import { SHADOW_SPECS } from './shadow';





const NOXIOUS_PALL: FxSpec = {
  id: 'sk.noxious_pall',
  desc: '',
  behavior: 'groundZone',
  ref: {},
  size: 'radius',
  base: 3,
  dur: 5,
  elements: [
    {
      kind: 'particle',
      note: '',
      t0: 0,
      cycle: 0.14,
      max: 2,
      rate: [0, 30],
      life: [0, 0.06],
      path: { y: [0, 1.4, 0.07, 1.9, 0.14, 1.0], z: [0, -4, 0.14, 0] },
      half: [0, 0.35],
      scale: [0, 1],
      color: [0, 0xe0ffd0, 1, 1, 0x80ff60, 0.8],
      billboard: 'screen',
      blend: 'add',
      tex: 'glowCore',
    },
    {
      kind: 'particle',
      note: '',
      t0: 0,
      cycle: 0.14,
      max: 12,
      rate: [0, 90],
      life: [0, 0.16],
      path: { y: [0, 1.4, 0.07, 1.9, 0.14, 1.0], z: [0, -4, 0.14, 0] },
      half: [0, 0.2],
      scale: [0, 1, 1, 0.5],
      color: [0, 0xc0ff9a, 0.9, 1, 0x50c040, 0],
      billboard: 'screen',
      rotation: { start: [40, 50] },
      blend: 'add',
      tex: 'fanLines',
    },
    {
      kind: 'particle',
      note: 'beam_blow: yellow-white starburst of rays (~2 m)',
      t0: 0.14,
      cycle: 0.1,
      max: 1,
      rate: [0, 50],
      life: [0, 0.16],
      at: [0, 1.0, 0],
      half: [0, 1.4],
      scale: [0, 0.4, 0.3, 1, 1, 1.1],
      color: [0, 0xffffff, 0.9, 0.4, 0xfff040, 0.7, 1, 0xffa020, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'rays',
    },
    {
      kind: 'particle',
      note: 'beam_blow core flash',
      t0: 0.14,
      cycle: 0.1,
      max: 1,
      rate: [0, 50],
      life: [0, 0.18],
      at: [0, 1.0, 0],
      half: [0, 0.7],
      scale: [0, 0.5, 0.2, 1.1, 1, 0.6],
      color: [0, 0xffffff, 1, 0.5, 0xfff6a0, 0.8, 1, 0xffc040, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'glowCore',
    },
    {
      kind: 'particle',
      note: 'beam_blow: cyan-blue light shaft shooting up (~3 m), soft',
      t0: 0.14,
      cycle: 0.1,
      max: 1,
      rate: [0, 50],
      life: [0, 0.2],
      at: [0, 1.2, 0],
      dir: { y: [0, 40] },
      vel: [0, 0.15],
      half: [0, 0.3],
      scale: [0, 0.8, 0.3, 1.2, 1, 1],
      color: [0, 0xe0f8ff, 0.9, 0.4, 0x60c0ff, 0.7, 1, 0x3060ff, 0],
      billboard: 'stretch',
      blend: 'add',
      tex: 'glow',
    },
    {
      kind: 'particle',
      note: '',
      t0: 0.16,
      cycle: 1,
      loops: 0,
      max: 14,
      rate: [0, 10],
      life: [0, 1.4],
      shape: { kind: 'sphere', radius: 1.3 },
      at: [0, 1.0, 0],
      dir: { y: [0, 6] },
      vel: [0, 0.04],
      half: [0, 0.95],
      scale: [0, 0.7, 0.5, 1.3, 1, 1.6],
      color: [0, 0xb0b040, 0, 0.15, 0x90c040, 0.3, 0.5, 0x50c040, 0.26, 1, 0x40a030, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 15, randomDir: true },
      blend: 'add',
      tex: 'cloud',
      bright: 2.4,
    },
    {
      kind: 'particle',
      note: '',
      t0: 0.16,
      cycle: 1,
      loops: 0,
      max: 6,
      rate: [0, 4],
      life: [0, 1.2],
      shape: { kind: 'sphere', radius: 1.2 },
      at: [0, 1.0, 0],
      dir: { y: [0, 6] },
      vel: [0, 0.04],
      half: [0, 0.8],
      scale: [0, 0.7, 1, 1.4],
      color: [0, 0xff6030, 0, 0.2, 0xff6030, 0.2, 0.6, 0xff70a0, 0.14, 1, 0x8a60ff, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 15, randomDir: true },
      blend: 'add',
      tex: 'cloud',
      bright: 2.2,
    },
    {
      kind: 'particle',
      note: '',
      t0: 0.2,
      cycle: 1,
      loops: 0,
      max: 6,
      rate: [0, 6],
      life: [0, 0.4],
      shape: { kind: 'sphere', radius: 1.4 },
      at: [0, 1.0, 0],
      half: [0, 0.12],
      scale: [0, 0.5, 0.3, 1, 1, 0.4],
      color: [0, 0xffffff, 0.9, 0.5, 0xc0ff90, 0.7, 1, 0x60d040, 0],
      billboard: 'screen',
      blend: 'add',
      tex: 'sparkle',
      minTier: 1,
    },
  ],
  demo: { loopFor: 4 },
};

// the skill-logic moments (moments.ts, `moment: true`) come last: a live generated family keeps them (families.ts resolveSkillSpecs)
export const NINJA_SPECS: FxSpec[] = [NOXIOUS_PALL, ...SHADOW_SPECS, ...BLADE_SPECS, ...ARCHERY_SPECS, ...NINJA_MOMENT_SPECS];

// LAZY CLASS CHUNK (vfx-lazy-families.txt, spec/README.md "Lazy class chunks"): skills/loader.ts ensureSkillVfx() imports this module before a
// run whose party has a ninja hero (and the gallery / tools / tests through ensureAllSkillVfx()); nothing else imports it, so the bundler keeps it
// out of the eager vfx chunk. The one-line wiring files of THIS directory (`<skillId>.family.ts`) register their generated family when
// this module is evaluated; a live family replaces the hand specs of its skill in the pack below. Vite / Vitest expand import.meta.glob; a
// plain bun / node script gets the hand specs only.
let wiring: Record<string, unknown> = {};
try {
  wiring = import.meta.glob('./*.family.ts', { eager: true });
} catch {
  // no Vite: hand specs only
}

export default classPack('ninja', NINJA_SPECS, wiring);
