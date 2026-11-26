// Shaman bell staffs, tiers 0..3: wooden staff + bronze bell -> lacquered staff with gold bands and tassels -> jade crown with side bells
// -> dragon-fin arch, ridged great bell and glowing rune band.
import type { BellSpec } from '../../archetypes/weapon/bell.ts';
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const palT0 = makePal({ wood: '#7a5430', woodDark: '#2e1c0e', gold: '#8a6a30', goldLight: '#d8b468', goldDark: '#2e1c08', silk: '#a8322a', silkDark: '#4a0e0c' });
const palT1 = makePal({ wood: '#5a2a22', woodDark: '#220c0a', lacquer: '#7a1c1c', gold: '#b88a2c', goldLight: '#ffd878', goldDark: '#4a2c08', silk: '#c42a30', silkDark: '#560c10', wrap: '#6a1a22', wrapDark: '#240608', wrapAccent: '#e8b84a' });
const palT2 = makePal({ wood: '#2a2a3a', woodDark: '#0c0c14', lacquer: '#16394a', gold: '#c99a30', goldLight: '#ffe890', goldDark: '#40260a', silk: '#2aa089', silkDark: '#0a3a30', jade: '#47c9a0', gem: '#4ae0c0', gemGlow: '#c0fff0', rune: '#7af0d8', wrap: '#1c4a54', wrapDark: '#081c22', wrapAccent: '#8ee0d0' });
const palT3 = makePal({ wood: '#2a1020', woodDark: '#0c0408', lacquer: '#5a1030', gold: '#e0a82e', goldLight: '#fff0a0', goldDark: '#5a3408', silk: '#d83a28', silkDark: '#701208', gem: '#ff7a1a', gemGlow: '#ffe090', rune: '#ffd060', wrap: '#4a1030', wrapDark: '#1a0410', wrapAccent: '#ffd870', jade: '#47c9a0' });

export const shamanBells: BellSpec[] = [
  { id: 'shaman_bell_t0', tier: 0, seed: 7101, pal: palT0, R: 0.062, H: 0.1, shaftZone: Z.wood, archZone: Z.iron, bellZone: Z.gold, sideBells: 0, orb: 'none', fins: false, tassels: 1, tasselZone: Z.silk, glow: false, tex: 512 },
  { id: 'shaman_bell_t1', tier: 1, seed: 7102, pal: palT1, R: 0.07, H: 0.115, shaftZone: Z.lacquer, archZone: Z.gold, bellZone: Z.gold, sideBells: 0, orb: 'none', fins: false, tassels: 2, tasselZone: Z.silk, glow: false, tex: 512, paint: { goldEngrave: 0.4 } },
  { id: 'shaman_bell_t2', tier: 2, seed: 7103, pal: palT2, R: 0.074, H: 0.12, shaftZone: Z.lacquer, archZone: Z.gold, bellZone: Z.gold, sideBells: 2, orb: 'jade', fins: false, tassels: 3, tasselZone: Z.silk, glow: false, tex: 1024, emissive: 256, paint: { goldEngrave: 0.6 } },
  { id: 'shaman_bell_t3', tier: 3, seed: 7104, pal: palT3, R: 0.08, H: 0.13, shaftZone: Z.lacquer, archZone: Z.gold, bellZone: Z.gold, sideBells: 2, orb: 'gem', fins: true, tassels: 3, tasselZone: Z.silk, glow: true, tex: 1024, emissive: 512, paint: { goldEngrave: 0.8 } },
];
