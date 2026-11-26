// Shaman heroes (humanoid_robed): spirit priests in layered robes with talisman strips and bell/fan; tier 3 = gold-trimmed ceremonial vestments.
import type { PieceSpec } from '../../archetypes/humanoid/index.ts';
import { type Sex, makeHero } from './common.ts';

const MALE = { shoulder: 0.96, chest: 0.96, waist: 0.95, arms: 0.92, forearms: 0.94, legs: 0.98, calves: 0.96, neck: 0.95, muscle: 0.4, stance: 0.95, head: 1.06 };
const FEMALE = { shoulder: 0.92, chest: 0.92, waist: 0.88, hips: 1.02, arms: 0.88, forearms: 0.9, legs: 0.98, calves: 0.94, muscle: 0.3, bust: 0.55, stance: 0.95, head: 1.06 };
const PAL = { cloth: '#e6dcc4', cloth2: '#2f6a80', cloth3: '#c8372d', sash: '#c8372d', leather: '#5a3f2a', leather2: '#3a2a1e', plate: '#c9a24a', lacquer: '#2f6a80', lacquer2: '#173a4a', gold: '#d9ae45', trim: '#d9ae45', paper: '#efe3c4', ink: '#7a1818', bone: '#e6dcc4' };

function outfit(tier: number): PieceSpec[] {
  const under: PieceSpec = { id: 'robe', mat: 'cloth', o: { hem: 0.16, flare: 1.0, open: 0, collar: 'crew', sleeve: 1, wide: 0.1 } };
  const outer: PieceSpec = { id: 'robe', mat: tier >= 3 ? 'lacquer' : 'cloth2', o: { hem: 0.12, flare: 1.1, open: 0.6, collar: 'v', sleeve: 1, wide: tier >= 2 ? 0.5 : 0.35, ext: 0.02 } };
  const sash: PieceSpec = { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.32, y: -0.03 } };
  switch (tier) {
    case 0:
      return [under, sash, { id: 'sandals', mat: 'leather2' }, { id: 'beads', mat: 'bone', o: { count: 18 } }];
    case 1:
      return [under, outer, sash, { id: 'sandals', mat: 'leather2' }, { id: 'beads', mat: 'leather', o: { count: 20 } }, { id: 'talismans', mat: 'paper', o: { count: 4 } }];
    case 2:
      return [under, outer, sash, { id: 'collar', mat: 'cloth3', o: { height: 0.08 } }, { id: 'sandals', mat: 'leather2' }, { id: 'beads', mat: 'gold', o: { count: 22 } }, { id: 'talismans', mat: 'paper', o: { count: 6 } }, { id: 'helm', mat: 'gold', o: { style: 'crown', spikes: 5 } }];
    default:
      return [under, outer, sash, { id: 'collar', mat: 'lacquer2', o: { height: 0.1 } }, { id: 'pauldron', mat: 'gold', o: { lames: 2, size: 0.8 } }, { id: 'sandals', mat: 'leather2' }, { id: 'beads', mat: 'gold', o: { count: 24 } }, { id: 'talismans', mat: 'paper', o: { count: 8 } }, { id: 'helm', mat: 'gold', o: { style: 'crown', spikes: 9, tall: 1.4 } }, { id: 'cape', mat: 'cloth3' }];
  }
}

export function shamanParams() {
  const out = [];
  for (const sex of ['m', 'f'] as Sex[]) for (const tier of [0, 1, 2, 3]) {
    out.push(makeHero({
      cls: 'shaman', sex, tier, build: sex === 'm' ? MALE : FEMALE, crown: tier >= 2 ? 0.02 : 0,
      hair: { style: 'bun', color: '#1a1618', highlight: '#3a3438' },
      outfit: outfit(tier), palette: PAL, style: 'fan', styleB: 'bell', rig: { skirt: true, hairBones: 0, ...(tier >= 3 ? { capeBones: 3 } : {}) },
    }));
  }
  return out;
}
