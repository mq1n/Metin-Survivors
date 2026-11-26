// Shaman fans, tiers 0..3: bamboo + paper -> red silk + gold ribs -> crane-feather fan with jade -> peacock fan with glowing
// talismans (t3 silk in the icy turquoise/deep-blue family of the t3 robe, HEROES.md §4.4; a red t3 fan clashed with it).
import type { FanSpec } from '../../archetypes/weapon/fan.ts';
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const palT0 = makePal({ wood: '#9a7a46', woodDark: '#4a3418', silk: '#d9cba0', silkDark: '#9a8a60', wrap: '#4a3a24', wrapDark: '#1a120a', wrapAccent: '#8a6a3a', gold: '#9a7430', goldLight: '#e8c670', goldDark: '#3a2406' });
const palT1 = makePal({ wood: '#6a3a22', woodDark: '#2a140a', silk: '#b8262e', silkDark: '#5a0e16', wrap: '#6a1a22', wrapDark: '#240608', wrapAccent: '#e8b84a', gold: '#c0902c', goldLight: '#ffdc82', goldDark: '#4a2c08', lacquer: '#8e1a1f' });
const palT2 = makePal({ wood: '#2a2a3a', woodDark: '#0c0c14', silk: '#e8eef2', silkDark: '#9fb4c8', wrap: '#1c4a54', wrapDark: '#081c22', wrapAccent: '#8ee0d0', gold: '#c99a30', goldLight: '#ffe890', goldDark: '#40260a', lacquer: '#143a48', jade: '#47c9a0', gem: '#4ae0c0', gemGlow: '#c0fff0', rune: '#7af0d8' });
const palT3 = makePal({ wood: '#1a2a3a', woodDark: '#06101a', silk: '#2a9cb8', silkDark: '#0e3a5a', wrap: '#123448', wrapDark: '#06141e', wrapAccent: '#e8f4f8', gold: '#d8b45a', goldLight: '#fff2c0', goldDark: '#4a3410', lacquer: '#123a52', gem: '#6ad8ff', gemGlow: '#d8f8ff', rune: '#9ae8ff', jade: '#47c9d0' });

export const shamanFans: FanSpec[] = [
  { id: 'shaman_fan_t0', tier: 0, seed: 6101, pal: palT0, R: 0.36, spread: 62, ribs: 7, panel: 'scallop', panelZone: Z.silk, ribZone: Z.wood, guardZone: Z.wood, handleZone: Z.wood, gem: false, tassel: 0, glow: false, ring: false, tex: 512 },
  { id: 'shaman_fan_t1', tier: 1, seed: 6102, pal: palT1, R: 0.38, spread: 66, ribs: 9, panel: 'scallop', panelZone: Z.silk, ribZone: Z.gold, guardZone: Z.lacquer, handleZone: Z.lacquer, gem: true, tassel: Z.silk, glow: false, ring: true, tex: 512, paint: { goldEngrave: 0.4 } },
  { id: 'shaman_fan_t2', tier: 2, seed: 6103, pal: palT2, R: 0.4, spread: 74, ribs: 8, panel: 'feather', panelZone: Z.silk, ribZone: Z.gold, guardZone: Z.gold, handleZone: Z.lacquer, gem: true, tassel: Z.jade, glow: false, ring: false, tex: 1024, emissive: 256, paint: { goldEngrave: 0.6 } },
  { id: 'shaman_fan_t3', tier: 3, seed: 6104, pal: palT3, R: 0.42, spread: 78, ribs: 8, panel: 'spike', panelZone: Z.silk, ribZone: Z.gold, guardZone: Z.gold, handleZone: Z.lacquer, gem: true, tassel: Z.silk, glow: true, ring: true, tex: 1024, emissive: 512, paint: { goldEngrave: 0.8 } },
];
