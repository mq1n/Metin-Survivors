// FxSpecs of the boss target. For now only the art-scope carrier: the boss presets are classic presets (vfx/presets/kit.ts helpers +
// the generated sprites of ./art.ts), so the run must pack those sprites: a run packs only the art of the specs it can spawn, and a
// spec no skill owns (`sk.gen.*`) is common, i.e. always in scope (same pattern as vfx/common/kitArt.ts `sk.gen.kit_art`).
import type { FxSpec, ParticleSpec } from '../../spec/types';
import { BOSS_ART_IDS } from './art';

/** one never-drawn element per sprite (rate 0, alpha 0): compile still collects its art key, nothing ever emits */
function carrier(id: string): ParticleSpec {
  return {
    kind: 'particle',
    note: `boss art carrier: keeps ${id} in the run's art scope for the boss presets (never drawn)`,
    cycle: 1,
    max: 1,
    rate: [0, 0],
    life: [0, 1],
    half: [0, 0.1],
    color: [0, 0xffffff, 0, 1, 0xffffff, 0],
    billboard: 'screen',
    blend: 'add',
    tex: { art: id, fallback: 'glow' },
  };
}

/** carrier specs hold at most 16 elements: the sprite ids in chunks of 12 (`sk.gen.boss_art`, `sk.gen.boss_art2`, ...) */
const CHUNK = 12;
function carrierSpecs(): FxSpec[] {
  const out: FxSpec[] = [];
  for (let i = 0; i * CHUNK < BOSS_ART_IDS.length; i++) {
    out.push({
      id: i === 0 ? 'sk.gen.boss_art' : `sk.gen.boss_art${i + 1}`,
      desc: 'art-scope carrier for the boss set pieces (smoke, rings, vortex, seal, flame, streaks); never spawned',
      behavior: 'selfBuff',
      ref: { family: 'boss art carrier', notes: 'see vfx/common/boss/art.ts' },
      size: 'radius',
      base: 1,
      dur: 0.1,
      elements: BOSS_ART_IDS.slice(i * CHUNK, (i + 1) * CHUNK).map(carrier),
    });
  }
  return out;
}

export const specs: FxSpec[] = carrierSpecs();
