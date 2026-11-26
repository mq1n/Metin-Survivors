// Per-zone gameplay-readability styling: how rank-and-file enemies are graded / rimmed so they separate from the
// zone's ground palette. Terrain looks live in render/terrain/look; this only touches figures. A zone look's
// `readability` (look/<zone>.ts, zone builder data) wins over the defaults below.
import { setCrowdZoneStyle, type CrowdZoneStyle } from './crowd/crowdMaterial';
import { findLook } from './terrain/look';

const NEUTRAL: CrowdZoneStyle = { rim: '#ffffff', rimStrength: 0, desaturate: 0, darken: 0 };

const STYLES: Record<string, CrowdZoneStyle> = {
  // Subtle edge readability without glowing translucent borders around models.
  daeryeol: { rim: '#ffd2a0', rimStrength: 0.05, desaturate: 0.15, darken: 0.25 },
  seori: { rim: '#dfe8f5', rimStrength: 0.02, desaturate: 0, darken: 0.04 },
  yeonmu: { rim: '#fff0d8', rimStrength: 0.04, desaturate: 0, darken: 0 },
  suryeon: { rim: '#f6f0e6', rimStrength: 0.06, desaturate: 0.15, darken: 0.12 },
};

/** The zone's figure style: look.readability, else the default above, else neutral. */
export function zoneReadabilityStyle(zoneId: string): CrowdZoneStyle {
  return findLook(zoneId)?.readability ?? STYLES[zoneId] ?? NEUTRAL;
}

/** Applies the zone's figure style (unknown zones fall back to neutral). */
export function applyZoneReadability(zoneId: string): void {
  setCrowdZoneStyle(zoneReadabilityStyle(zoneId));
}
