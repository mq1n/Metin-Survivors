import type { PaletteId } from '../palette';
import { COMMON_TARGET_PRESETS } from '../common';
import { SKILL_PRESETS } from '../skills';
import { BOSS_PRESETS } from './boss';
import { CAST_PRESETS } from './cast';
import { DEATH_PRESETS } from './death';
import { FEEDBACK_PRESETS } from './feedback';
import { HIT_PRESETS } from './hits';
import { KIT_DEMO } from './kitDemo';
import { MELEE_PRESETS } from './melee';
import { SKY_PRESETS } from './sky';
import { WARN_PRESETS } from './warn';
import { ZONE_PRESETS } from './zones';
import type { PresetDef } from './types';

export type { PresetDef } from './types';

/** a preset id resolved to a recipe + optional palette variant */
export interface Resolved {
  def: PresetDef;
  /** palette forced by the id suffix (null = recipe default / hints) */
  palette: PaletteId | null;
  element: number;
  variant: number;
}

/** the legacy arrays in their historical order (ids and order are snapshot-tested: __tests__/registryIds.test.ts) */
const LEGACY: PresetDef[] = [
  ...HIT_PRESETS,
  ...MELEE_PRESETS,
  ...ZONE_PRESETS,
  ...SKY_PRESETS,
  ...CAST_PRESETS,
  ...DEATH_PRESETS,
  ...FEEDBACK_PRESETS,
  ...BOSS_PRESETS,
  ...WARN_PRESETS,
  ...SKILL_PRESETS,
];
const LEGACY_IDS = new Set(LEGACY.map((p) => p.id));

/**
 * every preset: the legacy arrays + the vfx/common/<target> presets no legacy barrel lists (builders' new ids). The skill-class presets
 * are NOT in it at boot: skills/loader.ts adds each class pack when a run (or a tool) asks for it, see addPresets.
 */
export const PRESETS: PresetDef[] = [...LEGACY, ...COMMON_TARGET_PRESETS.filter((p) => !LEGACY_IDS.has(p.id)), KIT_DEMO];

const added = new Set<(defs: readonly PresetDef[]) => void>();

/**
 * Registers presets after boot (the lazy skill packs, skills/loader.ts): appended to PRESETS (an id that exists already is replaced in
 * place), then every live VfxSystem is told (VfxSystem.addPresets: its defs table, the cast / explode tables, the compile of the specs).
 */
export function addPresets(defs: readonly PresetDef[]): void {
  if (defs.length === 0) return;
  const at = new Map<string, number>();
  PRESETS.forEach((p, i) => at.set(p.id, i));
  for (const d of defs) {
    const i = at.get(d.id);
    if (i === undefined) {
      at.set(d.id, PRESETS.length);
      PRESETS.push(d);
    } else {
      PRESETS[i] = d;
    }
  }
  for (const fn of [...added]) fn(defs);
}

/** `fn` hears every addPresets batch; returns the unsubscribe function (VfxSystem subscribes in its constructor, dispose() leaves) */
export function onPresetsAdded(fn: (defs: readonly PresetDef[]) => void): () => void {
  added.add(fn);
  return () => {
    added.delete(fn);
  };
}

/** alternative spellings accepted by `spawn()` */
export const PRESET_ALIASES: Record<string, string> = {
  leaves: 'ambient.leaves',
  dust: 'ambient.dust',
  snow: 'ambient.snow',
  embers: 'ambient.embers',
  ash: 'ambient.ash',
  sparks: 'ambient.sparks',
  // ids hard-coded in the sim (w.bus.vfx('vfx_…')); the sim's `element` field flavours them
  vfx_explode: 'enemy.explode',
  vfx_slam: 'boss.slam',
  vfx_nova: 'shock.wave',
  vfx_breath: 'cone.breath',
  vfx_crit_burst: 'hit.crit',
  vfx_revive: 'player.revive',
  vfx_enemy_bolt: 'enemy.muzzle',
  vfx_hazard: 'zone.fire',
  vfx_meteor_impact: 'sky.meteor',
  vfx_boss_enrage: 'boss.enrage.burst',
  vfx_boss_ring: 'shock.wave',
  vfx_boss_summon: 'boss.summon',
  vfx_boss_breath: 'cone.breath',
  vfx_boss_vanish: 'boss.teleport.out',
  vfx_boss_land: 'boss.slam',
  vfx_boss_slam: 'boss.slam',
  vfx_boss_nova: 'boss.nova',
  vfx_boss_volley: 'boss.volley',
  vfx_boss_meteor: 'sky.meteor',
  vfx_boss_charge: 'boss.charge.trail',
  vfx_boss_bolt: 'proj.hostile',
};
