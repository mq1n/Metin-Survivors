// Skill effect registry. EAGER part: the common skills' FxSpecs (COMMON_SPECS: sk.gen.* hits / deaths / status loops, metin and pickup effects,
// the common-class skills) become `sk.<id>` presets (spread into presets/index.ts PRESETS) at boot.
//
// The five hero classes are NOT here: each has a LAZY pack (skills/<class>/index.ts: its hand specs + the generated families of its
// `*.family.ts` wiring files, see families.ts classPack) that skills/loader.ts loads for the runs that need it:
//   ensureSkillVfx(['warrior', ...])   a run (RunSession.load awaits it first), the hero-select prefetch
//   ensureAllSkillVfx()                galleries, QA tools, tests (`await` it before reading SKILL_SPECS / PRESETS / SPEC_REGISTRY)
// SKILL_SPECS / SKILL_PRESETS below are the live registry: they start with the common specs, loader.ts installSkillPack appends each pack
// (in pack order). Do not push into them anywhere else.
import type { PresetDef } from '../presets/types';
import { specPreset } from '../spec/preset';
import type { FxSpec } from '../spec/types';
import { COMMON_SPECS } from './common';

export const SKILL_SPECS: FxSpec[] = [...COMMON_SPECS];

export const SKILL_PRESETS: PresetDef[] = SKILL_SPECS.map(specPreset);
