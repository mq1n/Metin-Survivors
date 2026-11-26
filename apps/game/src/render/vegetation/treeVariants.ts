// Generates the variant geometries (LOD0 + LOD1, bark + foliage) of one tree species. Geometry index = variant * 2 + lod.
import type { BufferGeometry } from 'three';
import type { TreeSpecies } from '../../world/layoutTypes';
import { TREE_DIMS } from '../../world/trees';
import { MeshBuilder } from './geom';
import { buildBare, buildCharred } from './treeBare';
import { buildBroadleaf } from './treeBroadleaf';
import type { TreeGenInput, TreeParts, TreeStyle } from './treeCommon';
import { buildPine } from './treePine';

export const TREE_VARIANTS = 5;

export interface TreeVariantSet {
  species: TreeSpecies;
  bark: BufferGeometry[];
  foliage: BufferGeometry[];
  /** triangles per variant for LOD0 / LOD1 (bark + foliage) — diagnostics */
  tris: Array<[number, number]>;
}

const BUILDERS: Record<TreeSpecies, (inp: TreeGenInput) => TreeParts> = {
  pine: buildPine,
  snowpine: buildPine,
  broadleaf: buildBroadleaf,
  autumn: buildBroadleaf,
  bare: buildBare,
  charred: buildCharred,
};

const SPECIES_SALT: Record<TreeSpecies, number> = { pine: 1, broadleaf: 2, autumn: 3, snowpine: 4, bare: 5, charred: 6 };

/** BatchedMesh needs every geometry to own at least one triangle */
function nonEmpty(b: MeshBuilder): MeshBuilder {
  if (b.vertexCount === 0) {
    const n: [number, number, number] = [0, 1, 0];
    for (let i = 0; i < 3; i++) b.vertex([0, -50, 0], n, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    b.tri(0, 1, 2);
  }
  return b;
}

export function generateTreeVariants(species: TreeSpecies, style: TreeStyle): TreeVariantSet {
  const build = BUILDERS[species];
  const dims = TREE_DIMS[species];
  const out: TreeVariantSet = { species, bark: [], foliage: [], tris: [] };
  for (let v = 0; v < TREE_VARIANTS; v++) {
    const seed = 1000 + v * 7919 + SPECIES_SALT[species] * 131;
    const tris: [number, number] = [0, 0];
    for (const lod of [0, 1] as const) {
      const parts = build({ species, dims, seed, lod, style });
      parts.bark.setLod(lod);
      parts.foliage.setLod(lod);
      tris[lod] = parts.bark.triangleCount + parts.foliage.triangleCount;
      out.bark.push(nonEmpty(parts.bark).toGeometry());
      out.foliage.push(nonEmpty(parts.foliage).toGeometry());
    }
    out.tris.push(tris);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared, reference-counted variant sets (zones core B1). The tree system (render) and the baked crown shadows (terrain light
// bake) draw the same five variants per species, so a zone generates each species once; the set is dropped when the last
// user releases it.

const shared = new Map<string, { set: TreeVariantSet; refs: number }>();

const sharedKey = (species: TreeSpecies, style: TreeStyle): string => `${species}:${style.snowy ? 1 : 0}`;

/** The variant set of `species` for `style` (generated on first use, then shared). Pair every call with `releaseTreeVariants`. */
export function acquireTreeVariants(species: TreeSpecies, style: TreeStyle): TreeVariantSet {
  const k = sharedKey(species, style);
  let e = shared.get(k);
  if (!e) {
    e = { set: generateTreeVariants(species, style), refs: 0 };
    shared.set(k, e);
  }
  e.refs++;
  return e.set;
}

export function releaseTreeVariants(species: TreeSpecies, style: TreeStyle): void {
  const k = sharedKey(species, style);
  const e = shared.get(k);
  if (!e) return;
  if (--e.refs <= 0) shared.delete(k);
}
