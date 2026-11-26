// Vegetation system: procedural trees (instanced, wind, LOD), GPU-scattered ground cover and rocks, driven by
// `ctx.field.layout`. Owner: TerrainVeg. `createVegetation(ctx)` is what zoneScene calls; `opts` only exists so the
// gallery can feed a modelling sheet instead of the zone's own placements.
import { Group, type PerspectiveCamera, type Vector3 } from 'three';
import type { QualityProfile } from '../quality';
import type { ZoneContext, ZoneSystem } from '../terrain/zoneContext';
import { createCover } from './cover';
import { createRocks } from './rocks';
import { createTrees } from './trees';
import { vegQuality, type VegetationOptions, type VegPart } from './types';

export type { VegetationOptions } from './types';

export function createVegetation(ctx: ZoneContext, opts: VegetationOptions = {}): ZoneSystem & { stats(): string } {
  const group = new Group();
  group.name = 'vegetation';
  const layout = ctx.field.layout;
  const trees = createTrees({ ctx, placements: opts.trees ?? layout.trees });
  const rocks = createRocks({ ctx, placements: opts.rocks ?? layout.rocks });
  const cover = createCover(ctx, opts.cover ?? layout.cover);
  const parts: VegPart[] = [trees, rocks, cover];
  for (const p of parts) group.add(p.group);
  const ready = Promise.all(parts.map((p) => p.ready)).then(() => undefined);
  return {
    name: 'vegetation',
    group,
    ready,
    stats: () => `${trees.stats()}\n${rocks.stats()}`,
    update(dt: number, camera: PerspectiveCamera, focus: Vector3) {
      for (const p of parts) p.update(dt, camera, focus);
    },
    setQuality(p: QualityProfile) {
      const q = vegQuality(p);
      for (const part of parts) part.setQuality(q);
    },
    dispose() {
      for (const p of parts) p.dispose();
      group.clear();
    },
  };
}
