// Wolfman claw gauntlets, tiers 0..3: iron talons on a leather fist -> steel talons with fangs -> crimson-lit talons with fur ruff ->
// five wolf-fang talons with gold wolf plate and blood-glow veins. One model for both hands (X-symmetric).
import type { ClawSpec } from '../../archetypes/weapon/claw.ts';
import { makePal } from '../../archetypes/weapon/paintkit.ts';
import { Z } from '../../archetypes/weapon/zones.ts';

const dark = { steel: '#76808c', steelDark: '#1a1f28', steelLight: '#d4dde8', edge: '#f2f7fb', iron: '#2c2a30', ironLight: '#6a6670', bone: '#e0d2ae' };
const palT0 = makePal({ ...dark, steel: '#6a737e', wrap: '#4a3224', wrapDark: '#1a100a', wrapAccent: '#8a2a22', fur: '#7a6a58', gold: '#8a6a30', goldLight: '#d8b468', goldDark: '#2e1c08' });
const palT1 = makePal({ ...dark, wrap: '#5a2a22', wrapDark: '#220c0a', wrapAccent: '#c42a30', fur: '#6a5a4c', gold: '#b08a2c', goldLight: '#f0cc70', goldDark: '#3a2406', rune: '#ff5a3a' });
const palT2 = makePal({ ...dark, steel: '#7e8896', wrap: '#4a1a1e', wrapDark: '#1c0608', wrapAccent: '#e03a3a', fur: '#cfc6b8', gold: '#c99a30', goldLight: '#ffe08a', goldDark: '#40260a', rune: '#ff4a3a', gem: '#ff3a3a', gemGlow: '#ffb0a0', lacquer: '#6a1018' });
const palT3 = makePal({ ...dark, steel: '#8a95a4', steelLight: '#ffffff', wrap: '#3a0e16', wrapDark: '#14040a', wrapAccent: '#ff4a4a', fur: '#e6e0d6', gold: '#e0a82e', goldLight: '#fff0a0', goldDark: '#5a3408', rune: '#ff3a30', gem: '#ff2a2a', gemGlow: '#ffc0a8', lacquer: '#5a0c16' });

export const wolfmanClaws: ClawSpec[] = [
  { id: 'wolfman_claw_t0', tier: 0, seed: 8101, pal: palT0, lengths: [0.25, 0.22], gap: 0.036, splay: 0.02, w: 0.0165, h: 0.0052, curl: 0.2, hex: false, plateZone: Z.iron, gripZone: Z.wrap, cuffZone: Z.iron, spurs: false, fangs: false, fur: 6, gem: false, vein: false, tex: 512, paint: { wear: 0.5 } },
  { id: 'wolfman_claw_t1', tier: 1, seed: 8102, pal: palT1, lengths: [0.28, 0.25, 0.2], gap: 0.032, splay: 0.025, w: 0.0175, h: 0.0056, curl: 0.24, hex: true, plateZone: Z.iron, gripZone: Z.wrap, cuffZone: Z.gold, spurs: true, fangs: false, fur: 6, gem: false, vein: false, tex: 512, paint: { wear: 0.3, goldEngrave: 0.4 } },
  { id: 'wolfman_claw_t2', tier: 2, seed: 8103, pal: palT2, lengths: [0.3, 0.27, 0.22], gap: 0.032, splay: 0.03, w: 0.0185, h: 0.0058, curl: 0.28, hex: true, plateZone: Z.gold, gripZone: Z.lacquer, cuffZone: Z.gold, spurs: true, fangs: true, fur: 9, gem: true, vein: true, tex: 1024, emissive: 256, paint: { wear: 0.15, goldEngrave: 0.6 } },
  { id: 'wolfman_claw_t3', tier: 3, seed: 8104, pal: palT3, lengths: [0.34, 0.3, 0.25], gap: 0.03, splay: 0.04, w: 0.0195, h: 0.006, curl: 0.32, hex: true, plateZone: Z.gold, gripZone: Z.lacquer, cuffZone: Z.gold, spurs: true, fangs: true, fur: 9, gem: true, vein: true, tex: 1024, emissive: 512, paint: { wear: 0.05, goldEngrave: 0.8 } },
];
