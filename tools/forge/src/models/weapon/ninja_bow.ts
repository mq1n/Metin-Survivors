// Ninja recurve bows, tiers 0..3 (1.2 m). Ships in the hero's left-hand frame.
import type { BowSpec } from '../../archetypes/weapon/bow.ts';
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const palT0 = makePal({ wood: '#6a4426', woodDark: '#2a180c', wrap: '#3a2a1e', wrapDark: '#150e0a', wrapAccent: '#6a8a3a', bone: '#d8c9a4' });
const palT1 = makePal({ wood: '#5a3a22', woodDark: '#22140a', wrap: '#1f4a34', wrapDark: '#0a1c12', wrapAccent: '#7ad08a', bone: '#ddd0aa', gold: '#a88028', goldLight: '#f0cc70', goldDark: '#3a2406' });
const palT2 = makePal({ wood: '#2a1c18', woodDark: '#0c0706', lacquer: '#143a28', wrap: '#173f2c', wrapDark: '#08170f', wrapAccent: '#9af0a8', bone: '#e6dab8', gold: '#c19230', goldLight: '#ffe08a', goldDark: '#40260a', gem: '#38d86a', gemGlow: '#b8ffc4', rune: '#90ff80' });
const palT3 = makePal({ wood: '#1c1214', woodDark: '#070405', lacquer: '#0f3524', wrap: '#12382a', wrapDark: '#061410', wrapAccent: '#c0ffb0', bone: '#efe4c4', gold: '#dca830', goldLight: '#fff0a0', goldDark: '#4a2c0a', gem: '#7cff3a', gemGlow: '#d8ffb0', rune: '#9bff6a', silk: '#2a7a4a', silkDark: '#0a2a18' });

export const ninjaBows: BowSpec[] = [
  {
    id: 'ninja_bow_t0', tier: 0, seed: 5101, pal: palT0, half: 0.6, brace: 0.15,
    limb: { d0: 0.012, d1: 0.0065, w0: 0.016, w1: 0.008 }, limbZone: Z.wood, bellyZone: 0, gripZone: Z.wrap, tip: 'nock', tipZone: Z.bone,
    fittings: false, gem: false, fins: 0, runes: false, stringZone: Z.bone, tex: 512,
  },
  {
    id: 'ninja_bow_t1', tier: 1, seed: 5102, pal: palT1, half: 0.6, brace: 0.16,
    limb: { d0: 0.014, d1: 0.0075, w0: 0.019, w1: 0.0095 }, limbZone: Z.wood, bellyZone: Z.bone, gripZone: Z.wrap, tip: 'bone', tipZone: Z.bone,
    fittings: true, gem: false, fins: 0, runes: false, stringZone: Z.bone, tex: 512,
  },
  {
    id: 'ninja_bow_t2', tier: 2, seed: 5103, pal: palT2, half: 0.6, brace: 0.17,
    limb: { d0: 0.015, d1: 0.0085, w0: 0.02, w1: 0.011 }, limbZone: Z.lacquer, bellyZone: Z.bone, gripZone: Z.wrap, tip: 'leaf', tipZone: Z.gold,
    fittings: true, gem: true, fins: 3, runes: false, stringZone: Z.bone, tex: 1024, emissive: 256, paint: { goldEngrave: 0.6 },
  },
  {
    id: 'ninja_bow_t3', tier: 3, seed: 5104, pal: palT3, half: 0.62, brace: 0.18,
    limb: { d0: 0.017, d1: 0.0095, w0: 0.022, w1: 0.012 }, limbZone: Z.lacquer, bellyZone: Z.bone, gripZone: Z.lacquer, tip: 'wing', tipZone: Z.gold,
    fittings: true, gem: true, fins: 0, runes: true, stringZone: Z.silk, tex: 1024, emissive: 512, paint: { goldEngrave: 0.8 },
  },
];
