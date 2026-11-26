// Shared types for the vegetation sub-systems (trees, rocks, ground cover) and the per-tier tuning table.
import type { Object3D, PerspectiveCamera, Vector3 } from 'three';
import type { CoverSpec, RockPlacement, TreePlacement } from '../../world/layoutTypes';
import type { QualityProfile, QualityTier } from '../quality';

export interface VegPart {
  readonly group: Object3D;
  readonly ready: Promise<void>;
  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void;
  setQuality(q: VegQuality): void;
  dispose(): void;
}

/** Optional overrides of the layout lists (gallery sheet mode); everything else comes from `ctx.field.layout`. */
export interface VegetationOptions {
  trees?: TreePlacement[];
  rocks?: RockPlacement[];
  cover?: CoverSpec[];
}

export interface VegQuality {
  tier: QualityTier;
  /** tree/rock draw range from the camera (m), further clamped by the fog far plane */
  treeRange: number;
  /** max tree instance slots per species (LOD0 + LOD1 copies count separately) */
  treeSlots: number;
  /** LOD0 -> LOD1 fade window (m from camera) */
  lodNear: number;
  lodFar: number;
  rockRange: number;
  rockSlots: number;
  /** cover density multiplier */
  coverDensity: number;
  /** cover radius around the focus (m) */
  coverRadius: number;
  /** cards per tuft (2 or 3 crossed quads) */
  coverCards: 2 | 3;
  /** cover v2 (C4): most cards a splayed-fan tuft may use on this tier (a zone / spec asking for more is capped) */
  coverFanMax: number;
  /** flowers / shrubs allowed */
  coverExtras: boolean;
  /** far (coarse) cover ring enabled */
  coverFar: boolean;
}

const TABLE: Record<QualityTier, VegQuality> = {
  low: { tier: 'low', treeRange: 100, treeSlots: 160, lodNear: 30, lodFar: 38, rockRange: 90, rockSlots: 160, coverDensity: 0.3, coverRadius: 20, coverCards: 2, coverFanMax: 3, coverExtras: false, coverFar: false },
  medium: { tier: 'medium', treeRange: 150, treeSlots: 320, lodNear: 44, lodFar: 54, rockRange: 130, rockSlots: 260, coverDensity: 0.6, coverRadius: 24, coverCards: 2, coverFanMax: 4, coverExtras: true, coverFar: true },
  high: { tier: 'high', treeRange: 210, treeSlots: 640, lodNear: 54, lodFar: 64, rockRange: 180, rockSlots: 420, coverDensity: 1, coverRadius: 28, coverCards: 3, coverFanMax: 6, coverExtras: true, coverFar: true },
  ultra: { tier: 'ultra', treeRange: 260, treeSlots: 1100, lodNear: 64, lodFar: 76, rockRange: 230, rockSlots: 640, coverDensity: 1.4, coverRadius: 32, coverCards: 3, coverFanMax: 8, coverExtras: true, coverFar: true },
};

export function vegQuality(p: QualityProfile): VegQuality {
  return TABLE[p.tier];
}
