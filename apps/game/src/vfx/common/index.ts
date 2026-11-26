// Common (non-skill) VFX: one folder per target (vfx/common/<target>/), each owned by one builder. Guide: ./README.md.
// Registration: presets/index.ts and skills/common.ts keep the legacy arrays (original ids + order) and append every
// target entry no legacy barrel lists, so a builder's new id is live as soon as its folder exports it.
import type { PresetDef } from '../presets/types';
import type { FxSpec } from '../spec/types';
import { AMBIENT } from './ambient';
import { BOSS } from './boss';
import { DEATH_SPAWN } from './death-spawn';
import { ENEMY_PROJECTILES } from './enemy-projectiles';
import { HITS } from './hits';
import { KIT_ART_SPEC } from './kitArt';
import { LEVELUP_HEAL } from './levelup-heal';
import { METIN } from './metin';
import { PICKUPS } from './pickups';
import { PLAYER_FEEDBACK } from './player-feedback';
import { STATUS } from './status';
import { TELEGRAPHS } from './telegraphs';
import type { CommonTarget } from './types';

export { COMMON_TARGET_IDS, type CommonTarget, type CommonTargetId } from './types';

export const COMMON_TARGETS: readonly CommonTarget[] = [
  HITS,
  STATUS,
  DEATH_SPAWN,
  PICKUPS,
  LEVELUP_HEAL,
  METIN,
  BOSS,
  ENEMY_PROJECTILES,
  AMBIENT,
  PLAYER_FEEDBACK,
  TELEGRAPHS,
];

/** every classic preset of every target (presets/index.ts appends the ones no legacy barrel lists) */
export const COMMON_TARGET_PRESETS: readonly PresetDef[] = COMMON_TARGETS.flatMap((t) => t.presets);
/** every FxSpec of every target (skills/common.ts appends the ones no legacy barrel lists) */
/** (+ the legacy kit's art-scope carrier `sk.gen.kit_art`, vfx/common/kitArt.ts) */
export const COMMON_TARGET_SPECS: readonly FxSpec[] = [...COMMON_TARGETS.flatMap((t) => t.specs), KIT_ART_SPEC];
