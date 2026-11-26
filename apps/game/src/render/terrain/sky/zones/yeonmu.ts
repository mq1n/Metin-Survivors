// Yeonmu sky + backdrop look (zone builder file; render/terrain/sky/styles.ts registers it). Colours that come from the
// biome (sky gradient, fog, sun) are not repeated here: they are zones.json data, overridden per zone via look.biome.

import type { SkyStyle } from '../styles';

export const YEONMU_SKY: SkyStyle = {
  cloud: 0,
  cloudLit: '#ffffff',
  cloudShade: '#a9bad6',
  glow: '#fff0d2',
  profile: 'rolling',
  // three ridge layers, each hazier and bluer than the one before it (aerial perspective)
  rings: [
    { radius: 240, amp: 70, freq: 7, base: 2, tint: '#5d7c86', haze: 0.4 },
    { radius: 266, amp: 108, freq: 5, base: 0, tint: '#7894ae', haze: 0.56 },
    { radius: 292, amp: 150, freq: 4, base: -2, tint: '#9db0cb', haze: 0.72 },
  ],
  snowLine: 0,
  strata: false,
  cones: [],
  shadow: '#4a5f7e',
};
