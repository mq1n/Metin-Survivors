// Suryeon sky + backdrop look (zone builder file; render/terrain/sky/styles.ts registers it). Colours that come from
// the biome (sky gradient, fog, sun) live in look/suryeon.ts (look.biome), not here.
// threeway: teal-green dusk grading, pale sandstone ridges in green-grey haze (fog #5c6e64), a cloud layer at the horizon.
import type { SkyStyle } from '../styles';

export const SURYEON_SKY: SkyStyle = {
  cloud: 1,
  cloudLit: '#d6e4de',
  cloudShade: '#5a7878',
  glow: '#f0d8b0',
  profile: 'mesa',
  // three depth planes: pale sandstone buttes close in, hazier plateaus further out (aerial perspective into the green-grey fog)
  rings: [
    { radius: 240, amp: 104, freq: 9, base: 2, tint: '#a8977a', haze: 0.42 },
    { radius: 266, amp: 134, freq: 6, base: 0, tint: '#9a9a82', haze: 0.56 },
    { radius: 292, amp: 160, freq: 4, base: -2, tint: '#8b9b8e', haze: 0.7 },
  ],
  snowLine: 0,
  strata: true,
  cones: [],
  shadow: '#4a5250',
};
