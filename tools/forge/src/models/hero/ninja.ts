// Ninja heroes (humanoid_light): lean, agile assassins in wraps, scarf and hood; tier 3 = dark lacquered silk mail.
import type { PieceSpec } from '../../archetypes/humanoid/index.ts';
import { type Sex, makeHero } from './common.ts';

const MALE = { shoulder: 0.94, chest: 0.94, waist: 0.9, arms: 0.9, forearms: 0.92, legs: 0.98, calves: 0.96, neck: 0.9, hands: 0.96, feet: 0.98, muscle: 0.55, stance: 1.0, legLength: 1.05, head: 1.02 };
const FEMALE = { shoulder: 0.92, chest: 0.92, waist: 0.86, hips: 1.0, arms: 0.88, forearms: 0.9, legs: 0.98, calves: 0.94, neck: 0.88, muscle: 0.4, bust: 0.4, stance: 1.0, legLength: 1.05, head: 1.04 };
const PAL = { cloth: '#46506a', cloth2: '#2e3550', sash: '#c23a3e', leather: '#7a5c42', leather2: '#4a362a', plate: '#7a8494', plate2: '#4a5262', lacquer: '#34304a', lacquer2: '#232038', gold: '#d6ac52', trim: '#d6ac52', bone: '#e2dccb', cloth3: '#b8b2c4' };

function outfit(tier: number): PieceSpec[] {
  const base: PieceSpec[] = [
    { id: 'tunic', mat: 'cloth', o: { hem: 0.08, sleeve: 0.7 } },
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.12, end: 0.95 } },
  ];
  switch (tier) {
    case 0:
      return [...base, { id: 'wraps', mat: 'bone', o: { where: 'both', rings: 5 } }, { id: 'sandals', mat: 'leather2' }, { id: 'belt', mat: 'leather2' }, { id: 'headband', mat: 'sash' }];
    case 1:
      return [...base, { id: 'boots', mat: 'leather2', o: { start: 0.45 } }, { id: 'wraps', mat: 'bone', o: { where: 'forearm', rings: 5 } }, { id: 'belt', mat: 'leather', o: { pouches: 1 } }, { id: 'scarf', mat: 'sash' }, { id: 'mask', mat: 'cloth3', o: { trim: 'none' } }, { id: 'headband', mat: 'cloth2' }];
    case 2:
      return [...base, { id: 'boots', mat: 'leather2', o: { start: 0.4 } }, { id: 'vambrace', mat: 'leather', o: { from: 0.55, flare: 0.4 } }, { id: 'belt', mat: 'leather', o: { pouches: 1 } }, { id: 'tassets', mat: 'leather', o: { count: 6, len: 0.15, flare: 0.2 } }, { id: 'pauldron', mat: 'leather', o: { lames: 2, size: 0.75, side: 'l' } }, { id: 'scarf', mat: 'sash' }, { id: 'mask', mat: 'cloth3', o: { trim: 'none' } }, { id: 'hood', mat: 'cloth2', o: { trim: 'none' } }];
    default:
      return [...base, { id: 'boots', mat: 'lacquer2', o: { start: 0.4 } }, { id: 'cuirass', mat: 'lacquer', o: { style: 'leather', bands: 3, ridge: false, straps: true, strapMat: 'lacquer2', ext: 0.012 } }, { id: 'vambrace', mat: 'lacquer', o: { from: 0.5, flare: 0.5 } }, { id: 'greaves', mat: 'lacquer', o: { cop: 0.9 } }, { id: 'belt', mat: 'lacquer2', o: { pouches: 1 } }, { id: 'tassets', mat: 'lacquer', o: { count: 8, len: 0.2, flare: 0.25 } }, { id: 'pauldron', mat: 'lacquer', o: { lames: 3, size: 0.85 } }, { id: 'scarf', mat: 'sash' }, { id: 'mask', mat: 'cloth3', o: { trim: 'none' } }, { id: 'hood', mat: 'lacquer2', o: { trim: 'none' } }];
  }
}

export function ninjaParams() {
  const out = [];
  for (const sex of ['m', 'f'] as Sex[]) for (const tier of [0, 1, 2, 3]) {
    out.push(makeHero({
      cls: 'ninja', sex, tier, build: sex === 'm' ? MALE : FEMALE,
      hair: { style: 'ponytail', color: '#18151a', highlight: '#3a3440' },
      outfit: outfit(tier), palette: PAL, style: 'dagger', styleB: 'bow', rig: { skirt: tier >= 3, scarfBones: tier >= 1 ? 3 : 0, hairBones: 2 },
    }));
  }
  return out;
}
