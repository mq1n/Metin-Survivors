// Pickups specs: only the art-scope carrier. A run packs just the art of the specs it can spawn; the classic presets of this
// target draw their sprites through the kit (`.art(KitArt)`), so this never-spawned spec references them all and keeps them in every
// run's scope (same trick as sk.gen.kit_art, vfx/common/kitArt.ts). Nothing here ever emits.
import type { FxSpec, ParticleSpec } from '../../spec/types';
import { PICKUP_ART_IDS, PK_ART_GRID } from './art';

function carrier(id: string): ParticleSpec {
  const g = PK_ART_GRID[id];
  return {
    kind: 'particle',
    note: `pickups art carrier: keeps ${id} in the run's art scope (never drawn)`,
    cycle: 1,
    max: 1,
    rate: [0, 0],
    life: [0, 1],
    half: [0, 0.1],
    color: [0, 0xffffff, 0, 1, 0xffffff, 0],
    billboard: 'screen',
    blend: 'add',
    tex: g ? { art: id, fallback: 'glow', grid: [g[0], g[1]] } : { art: id, fallback: 'glow' },
  };
}

export const PICKUP_ART_SPEC: FxSpec = {
  id: 'sk.gen.pickup_art',
  desc: 'art-scope carrier for the pickup / chest sprites (cross glint, starburst, monround ring, vortex, spray); never spawned',
  behavior: 'selfBuff',
  ref: { family: 'pickups art carrier', notes: 'see vfx/common/pickups/art.ts' },
  size: 'radius',
  base: 1,
  dur: 0.1,
  elements: PICKUP_ART_IDS.map(carrier),
};

export const specs: FxSpec[] = [PICKUP_ART_SPEC];
