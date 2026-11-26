// Yacha heroes (humanoid): dark-magic swordsmen in black-and-crimson long coats with glowing rune sleeves.
import type { PieceSpec } from '../../archetypes/humanoid/index.ts';
import { type Sex, makeHero } from './common.ts';

const MALE = { shoulder: 1.0, chest: 1.0, waist: 0.95, arms: 0.98, forearms: 1.0, legs: 1.02, calves: 1.0, neck: 1.0, muscle: 0.8, stance: 1.0, head: 1.04 };
const FEMALE = { shoulder: 0.96, chest: 0.96, waist: 0.9, hips: 1.02, arms: 0.94, forearms: 0.96, legs: 1.02, calves: 0.98, muscle: 0.5, bust: 0.5, stance: 1.0, head: 1.04 };
const PAL = { cloth: '#1c1a22', cloth2: '#8c1f2a', sash: '#a82432', leather: '#3a2a2a', leather2: '#241a1c', plate: '#6a6670', plate2: '#3c3842', lacquer: '#16121a', lacquer2: '#7a1a24', gold: '#d2a443', trim: '#b8313c', bone: '#d6cfc0', ink: '#ff4a5a' };

function outfit(tier: number): PieceSpec[] {
  const core: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth', o: { baggy: 0.1, end: 0.95 } },
    { id: 'boots', mat: 'leather2', o: { start: 0.4 } },
    { id: 'robe', mat: tier >= 3 ? 'lacquer' : 'cloth', o: { hem: 0.14, flare: 1.0, open: 0.3, collar: 'crew', sleeve: 1, wide: tier >= 2 ? 0.4 : 0.15 } },
    { id: 'belt', mat: 'leather2' },
  ];
  const runes: PieceSpec = { id: 'runes', mat: 'ink', o: { arms: true, strokes: 7, chest: tier >= 1 } };
  switch (tier) {
    case 0:
      return [...core, runes, { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.3 } }];
    case 1:
      return [...core, runes, { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.3 } }, { id: 'pauldron', mat: 'plate', o: { lames: 2, size: 0.8, side: 'l' } }, { id: 'vambrace', mat: 'leather2', o: { from: 0.6, flare: 0.5 } }];
    case 2:
      return [...core, runes, { id: 'cuirass', mat: 'plate', o: { style: 'plate', ridge: true, emblem: 0.8, bands: 2 } }, { id: 'pauldron', mat: 'plate', o: { lames: 3, size: 0.9 } }, { id: 'vambrace', mat: 'plate', o: { from: 0.55, flare: 0.8 } }, { id: 'collar', mat: 'plate' }, { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.34 } }];
    default:
      return [...core, runes, { id: 'cuirass', mat: 'lacquer', o: { style: 'plate', ridge: true, emblem: 1, bands: 3, emblemMat: 'gold' } }, { id: 'pauldron', mat: 'lacquer', o: { lames: 3, size: 1.05, spike: 0.7 } }, { id: 'vambrace', mat: 'lacquer', o: { from: 0.5, flare: 1.2 } }, { id: 'collar', mat: 'lacquer' }, { id: 'helm', mat: 'lacquer', o: { style: 'crown', spikes: 7 } }, { id: 'backpiece', mat: 'lacquer', o: { size: 1, spikes: 3 } }, { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.36 } }];
  }
}

export function yachaParams() {
  const out = [];
  for (const sex of ['m', 'f'] as Sex[]) for (const tier of [0, 1, 2, 3]) {
    out.push(makeHero({
      cls: 'yacha', sex, tier, build: sex === 'm' ? MALE : FEMALE, crown: tier === 3 ? 0.02 : 0,
      hair: { style: 'swept', color: '#cfd0dc', highlight: '#f2f2f8', length: 1.1 },
      outfit: outfit(tier), palette: PAL, style: 'sword1h', rig: { skirt: true, hairBones: 2 },
      glow: { color: '#ff4a5a', tags: ['rune'] },
    }));
  }
  return out;
}
