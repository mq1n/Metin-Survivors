// Common (non-skill) VFX targets: the ownership contract of vfx/common/<target>/ (C0 split). Builder guide: ./README.md.
import type { PresetDef } from '../presets/types';
import type { FxSpec } from '../spec/types';
import type { RouteFactory } from './route';

/** one folder per target under vfx/common/, each owned by exactly one builder */
export const COMMON_TARGET_IDS = [
  'hits',
  'status',
  'death-spawn',
  'pickups',
  'levelup-heal',
  'metin',
  'boss',
  'enemy-projectiles',
  'ambient',
  'player-feedback',
  'telegraphs',
] as const;
export type CommonTargetId = (typeof COMMON_TARGET_IDS)[number];

/** what a target folder exports from its index.ts */
export interface CommonTarget {
  readonly id: CommonTargetId;
  /** classic presets (`PresetDef`: fire/tick/end over the Fx batches), registered in presets/index.ts PRESETS */
  readonly presets: readonly PresetDef[];
  /** FxSpec presets (`sk.gen.*`), registered through skills/common.ts → specPreset (same runtime as skill VFX) */
  readonly specs: readonly FxSpec[];
  /** sim event routes of this target (vfx/common/<target>/route.ts), created once per EventAdapter */
  readonly routes?: RouteFactory;
}
