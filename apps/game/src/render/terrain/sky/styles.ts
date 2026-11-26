// Per-zone sky + backdrop look. Colours that come from the biome (sky gradient, fog, sun) are not repeated here.
// The values live in ./zones/<zone>.ts (one file per zone builder); this file keeps the types, the registry and styleFor.
import { DAERYEOL_SKY } from './zones/daeryeol';
import { SURYEON_SKY } from './zones/suryeon';
import { SEORI_SKY } from './zones/seori';
import { YEONMU_SKY } from './zones/yeonmu';

/** 0 soft cumulus · 1 streaked teal haze with warm underlight · 2 overcast cirrus + aurora · 3 dark ember smoke */
export type CloudStyle = 0 | 1 | 2 | 3;

/** silhouette character of the distant ranges */
export type RangeProfile = 'rolling' | 'mesa' | 'alpine' | 'volcano';

export interface RingSpec {
  /** horizontal distance (m) of the ring from the camera */
  radius: number;
  /** peak height above the foot (m) */
  amp: number;
  /** ridge cycles around the full circle */
  freq: number;
  /** foot height relative to the camera's eye (m); the rings are camera-centred, so this is the horizon lift */
  base: number;
  /** tint (sRGB hex) before the aerial-perspective mix */
  tint: string;
  /** 0..1 share of aerial perspective: 0 = the tint untouched, 1 = pure sky colour */
  haze: number;
}

export interface SkyStyle {
  cloud: CloudStyle;
  /** sunlit / shaded cloud colours (sRGB hex) */
  cloudLit: string;
  cloudShade: string;
  /** colour of the glow under the clouds / on the horizon (sRGB hex), HDR-scaled in the shader */
  glow: string;
  profile: RangeProfile;
  rings: [RingSpec, RingSpec, RingSpec];
  /** snow line (m above the ring foot) for alpine peaks; 0 = no snow */
  snowLine: number;
  /** horizontal strata banding on the mesas */
  strata: boolean;
  /** volcano bearings (radians, 0 = -Z, clockwise) for cones, crater glow and the smoke plumes in the dome */
  cones: number[];
  /** shadow-side ambient colour for the ranges (sRGB hex) */
  shadow: string;
}

/** one file per zone in ./zones (zone builder files); unknown zones get Yeonmu's */
export const SKY_STYLES: Record<string, SkyStyle> = {
  yeonmu: YEONMU_SKY,
  suryeon: SURYEON_SKY,
  seori: SEORI_SKY,
  daeryeol: DAERYEOL_SKY,
};

export function styleFor(zoneId: string): SkyStyle {
  return SKY_STYLES[zoneId] ?? (SKY_STYLES.yeonmu as SkyStyle);
}
