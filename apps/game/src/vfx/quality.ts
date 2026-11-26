// Quality profiles for the VFX package. Hard budget: ≤ 20k live particles (add + alpha), ≤ 8 draw calls.
import type { VfxQuality } from './types';

export interface VfxProfile {
  tier: VfxQuality;
  /** multiplies particle counts (stochastic rounding) */
  density: number;
  /** 0..3: presets add optional layers when `detail >= n` */
  detail: number;
  /** ring-buffer capacities */
  maxAdd: number;
  maxAlpha: number;
  maxShapes: number;
  maxRibbonChunks: number;
  maxDebris: number;
  /** hard ceiling of particles spawned in a single frame (burst control) */
  spawnPerFrame: number;
  /** lightning / trail segment multiplier */
  segments: number;
  /** soft particles (needs a depth texture) */
  soft: boolean;
}

export const VFX_PROFILES: Record<VfxQuality, VfxProfile> = {
  low: { tier: 'low', density: 0.5, detail: 0, maxAdd: 4000, maxAlpha: 2000, maxShapes: 256, maxRibbonChunks: 64, maxDebris: 256, spawnPerFrame: 900, segments: 0.6, soft: false },
  medium: { tier: 'medium', density: 0.75, detail: 1, maxAdd: 8000, maxAlpha: 4500, maxShapes: 512, maxRibbonChunks: 128, maxDebris: 600, spawnPerFrame: 1800, segments: 0.8, soft: false },
  high: { tier: 'high', density: 1, detail: 2, maxAdd: 11000, maxAlpha: 6000, maxShapes: 768, maxRibbonChunks: 192, maxDebris: 1200, spawnPerFrame: 3200, segments: 1, soft: true },
  ultra: { tier: 'ultra', density: 1.3, detail: 3, maxAdd: 12000, maxAlpha: 8000, maxShapes: 1024, maxRibbonChunks: 256, maxDebris: 1600, spawnPerFrame: 4800, segments: 1.25, soft: true },
};

/** Absolute allocation sizes (buffers are allocated once for the largest tier; profiles limit the live range). */
export const MAX_CAP = {
  add: VFX_PROFILES.ultra.maxAdd,
  alpha: VFX_PROFILES.ultra.maxAlpha,
  shapes: VFX_PROFILES.ultra.maxShapes,
  ribbonChunks: VFX_PROFILES.ultra.maxRibbonChunks,
  debris: VFX_PROFILES.ultra.maxDebris,
};
