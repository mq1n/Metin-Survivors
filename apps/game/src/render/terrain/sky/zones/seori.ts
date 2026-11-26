// Seori sky + backdrop look (zone builder file; render/terrain/sky/styles.ts registers it). Colours that come from the
// biome (sky gradient, fog, sun) are not repeated here: they are zones.json data, overridden per zone via look.biome.

import type { SkyStyle } from '../styles';

export const SEORI_SKY: SkyStyle = {
  cloud: 2,
  cloudLit: '#eceff4',
  cloudShade: '#9298a8',
  glow: '#dfe6f2',
  profile: 'alpine',
  rings: [
    { radius: 240, amp: 96, freq: 6, base: 2, tint: '#9a9eaa', haze: 0.4 },
    { radius: 266, amp: 136, freq: 5, base: 0, tint: '#a6aab6', haze: 0.55 },
    { radius: 292, amp: 176, freq: 4, base: -2, tint: '#b4b8c3', haze: 0.7 },
  ],
  snowLine: 44,
  strata: false,
  cones: [],
  shadow: '#5c6272',
};
