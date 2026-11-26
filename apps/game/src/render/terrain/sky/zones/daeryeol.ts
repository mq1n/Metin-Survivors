// Daeryeol sky + backdrop look (zone builder file; render/terrain/sky/styles.ts registers it). Flame sky: zenith #1f0000, horizon #87381f,
// nadir #ff8700, clouds #af3813 (map_n_flame_01 msenv); the ridge rings are rust-lit basalt so the horizon glows instead of a black curtain. Colours that come from
// the biome (sky gradient, fog, sun) are not repeated here: they are zones.json data, overridden per zone via look.biome.
import type { SkyStyle } from '../styles';

export const DAERYEOL_SKY: SkyStyle = {
  cloud: 3,
  cloudLit: '#af3813',
  cloudShade: '#1a0808',
  glow: '#ff8700',
  profile: 'volcano',
  rings: [
    { radius: 240, amp: 76, freq: 6, base: 2, tint: '#5a382e', haze: 0.34 },
    { radius: 266, amp: 92, freq: 5, base: 0, tint: '#6a392b', haze: 0.5 },
    { radius: 292, amp: 126, freq: 4, base: -2, tint: '#8a4328', haze: 0.68 },
  ],
  snowLine: 0,
  strata: false,
  cones: [0.55, 2.35, 4.2],
  shadow: '#2a1210',
};
