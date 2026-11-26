// Nominal dimensions of the procedural tree species (scale 1). Shared by scatter (blockers/spacing), the baked terrain
// shadows and the generators in render/vegetation, so all three agree.
import type { TreeSpecies } from './layoutTypes';

export interface TreeDims {
  /** total height (m) */
  height: number;
  /** crown radius at its widest (m) */
  crownRadius: number;
  /** height of the lowest foliage above ground (m) */
  crownBase: number;
  /** trunk collision radius (m) */
  trunkR: number;
  /** default spacing radius used by scatter (canopy clearance) */
  spacing: number;
}

export const TREE_DIMS: Record<TreeSpecies, TreeDims> = {
  pine: { height: 9.5, crownRadius: 2.4, crownBase: 1.8, trunkR: 0.42, spacing: 1.9 },
  broadleaf: { height: 7.5, crownRadius: 3.4, crownBase: 2.6, trunkR: 0.6, spacing: 2.8 },
  autumn: { height: 7, crownRadius: 3.2, crownBase: 2.4, trunkR: 0.6, spacing: 2.6 },
  snowpine: { height: 9, crownRadius: 2.3, crownBase: 1.5, trunkR: 0.46, spacing: 1.9 },
  bare: { height: 7, crownRadius: 2.6, crownBase: 2.2, trunkR: 0.5, spacing: 1.8 },
  charred: { height: 5.5, crownRadius: 1.9, crownBase: 1.4, trunkR: 0.45, spacing: 1.5 },
};
