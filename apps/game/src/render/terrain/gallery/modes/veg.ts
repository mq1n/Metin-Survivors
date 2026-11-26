// Gallery mode "veg": debug ground + the vegetation system (trees, ground cover, rocks). Owner: TerrainVeg.
//   ?mode=veg&zone=<id>                    the zone's own placements
//   ?mode=veg&sheet=1                      tree sheet: every species (rows) x 5 variants on the zone ground at the origin;
//                                          `&species=pine` narrows it to one row
//   ?mode=veg&sheet=rocks                  rock sheet: every kind (rows) x 4 variants x the zone's rock materials;
//                                          `&kind=boulder` narrows it to one row
// Both sheets frame an orbit camera on the origin; the rest of the gallery camera presets still work.
import { TREE_SPECIES, type RockKind, type RockPlacement, type TreePlacement, type TreeSpecies } from '../../../../world/layoutTypes';
import { createVegetation, type VegetationOptions } from '../../../vegetation';
import { createDebugGround } from '../debugGround';
import type { GalleryHost, GalleryMode } from '../host';

const SPACING = 12;

function frame(host: GalleryHost, rows: number): void {
  host.cam = 'orbit';
  host.orbit.yaw = 0.25;
  host.orbit.pitch = 0.5;
  host.orbit.dist = rows === 1 ? 46 : 110;
  host.orbit.target.set(0, 4, 0);
}

function treeSheet(host: GalleryHost, q: URLSearchParams): VegetationOptions {
  const only = q.get('species') as TreeSpecies | null;
  const species = only && TREE_SPECIES.includes(only) ? [only] : TREE_SPECIES;
  const trees: TreePlacement[] = [];
  species.forEach((sp, row) => {
    for (let v = 0; v < 5; v++) {
      const x = (v - 2) * SPACING;
      const z = (row - (species.length - 1) / 2) * SPACING;
      trees.push({ species: sp, x, z, y: host.field.heightAt(x, z), scale: 1, yaw: 0.3 + v * 0.7, seed: v });
    }
  });
  frame(host, species.length);
  return { trees, rocks: [], cover: [] };
}

/** nominal extents (sx, sy, sz) per kind, in the range the zone recipes use */
const ROCK_SIZE: Record<RockKind, [number, number, number]> = {
  boulder: [2.6, 2, 2.4],
  slab: [4, 1.1, 3],
  spire: [1.6, 6, 1.6],
  outcrop: [7, 6, 5.5],
  ledge: [6, 3, 3.6],
  basalt: [3, 3.4, 3],
  crystal: [2, 3.2, 2],
  pebbles: [1.4, 0.3, 1.4],
};
const ROCK_KINDS = Object.keys(ROCK_SIZE) as RockKind[];

function rockSheet(host: GalleryHost, q: URLSearchParams): VegetationOptions {
  const only = q.get('kind') as RockKind | null;
  const kinds = only && only in ROCK_SIZE ? [only] : ROCK_KINDS;
  const mats = Math.max(1, host.field.layout.rockMaterials.length);
  const rocks: RockPlacement[] = [];
  kinds.forEach((kind, row) => {
    const [sx, sy, sz] = ROCK_SIZE[kind];
    for (let v = 0; v < 4; v++) {
      const x = (v - 1.5) * SPACING;
      const z = (row - (kinds.length - 1) / 2) * SPACING;
      rocks.push({ kind, x, z, y: host.field.heightAt(x, z), sx, sy, sz, yaw: 0.5 + v * 1.3, seed: v, mat: v % mats, sink: kind === 'outcrop' || kind === 'ledge' ? 1 : 0.1 });
    }
  });
  frame(host, kinds.length);
  return { trees: [], rocks, cover: [] };
}

const mode: GalleryMode = {
  async build(host) {
    const q = new URLSearchParams(location.search);
    host.addSystem(createDebugGround(host.ctx));
    const sheet = q.get('sheet');
    const opts = sheet === 'rocks' ? rockSheet(host, q) : sheet ? treeSheet(host, q) : {};
    const veg = createVegetation(host.ctx, opts);
    host.addSystem(veg);
    await veg.ready;
    console.info(`vegetation: ${veg.stats()}`);
  },
};
export default mode;
