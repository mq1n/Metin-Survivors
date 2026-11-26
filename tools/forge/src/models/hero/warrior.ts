// Warrior heroes (humanoid_heavy): broad, muscular fighters. Tiers 0-3: cloth -> leather -> steel -> ornate lacquered plate.
import type { PieceSpec } from '../../archetypes/humanoid/index.ts';
import { type Sex, makeHero } from './common.ts';

const MALE = { shoulder: 1.12, chest: 1.08, waist: 0.98, arms: 1.12, forearms: 1.14, legs: 1.04, calves: 1.06, neck: 1.1, hands: 1.06, feet: 1.06, muscle: 1.0, stance: 1.05, head: 1.06 };
const FEMALE = { shoulder: 1.04, chest: 1.0, waist: 0.95, hips: 1.04, arms: 1.0, forearms: 1.02, legs: 1.04, calves: 1.0, neck: 0.95, muscle: 0.7, bust: 0.5, stance: 1.0, head: 1.04 };

const PAL = { cloth: '#2b2630', cloth2: '#2e2c36', sash: '#c4443a', leather: '#6a4630', leather2: '#3f2c20', plate: '#9aa4ae', plateHi: '#d9dde2', plate2: '#5b6670', lacquer: '#9a2218', lacquer2: '#1c1a1e', gold: '#d9ae45', trim: '#d9ae45', bone: '#d8d0b8', paper: '#e8dcc0', ink: '#7a1818' };

function outfit(tier: number): PieceSpec[] {
  switch (tier) {
    case 0:
      return [
        { id: 'tunic', mat: 'cloth', o: { hem: 0.1, sleeve: 0 } },
        { id: 'trousers', mat: 'cloth2', o: { baggy: 0.3, end: 0.9 } },
        { id: 'sandals', mat: 'leather2' },
        { id: 'wraps', mat: 'bone', o: { where: 'forearm', rings: 5 } },
        { id: 'belt', mat: 'leather2' },
        { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.3, y: -0.065 } },
        { id: 'headband', mat: 'sash' },
      ];
    case 1:
      return [
        { id: 'tunic', mat: 'cloth', o: { hem: 0.1, sleeve: 0 } },
        { id: 'trousers', mat: 'cloth2', o: { baggy: 0.18, end: 0.97 } },
        { id: 'boots', mat: 'leather2', o: { start: 0.3 } },
        { id: 'cuirass', mat: 'leather', o: { style: 'leather', ext: 0.014, ridge: false, straps: true, strapMat: 'leather2', bands: 2 } },
        { id: 'belt', mat: 'leather2' },
        { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.32, y: -0.065 } },
        { id: 'tassets', mat: 'leather', o: { count: 8, len: 0.17, flare: 0.3 } },
        { id: 'pauldron', mat: 'lacquer', o: { lames: 2, size: 0.9 } },
        { id: 'vambrace', mat: 'leather2', o: { from: 0.58 } },
        { id: 'headband', mat: 'sash' },
      ];
    case 2:
      return [
        { id: 'tunic', mat: 'cloth', o: { hem: 0.1, sleeve: 0 } },
        { id: 'trousers', mat: 'cloth2', o: { baggy: 0.2, end: 0.97 } },
        { id: 'boots', mat: 'leather2', o: { start: 0.35 } },
        { id: 'cuirass', mat: 'plate', o: { style: 'plate', ridge: true, bands: 2 } },
        { id: 'belt', mat: 'leather2' },
        { id: 'tassets', mat: 'plate', o: { count: 9, len: 0.2, flare: 0.3 } },
        { id: 'pauldron', mat: 'plate', o: { lames: 3, size: 1 } },
        { id: 'vambrace', mat: 'plate', o: { from: 0.55 } },
        { id: 'greaves', mat: 'plate', o: { cop: 1 } },
        { id: 'collar', mat: 'plate' },
        { id: 'helm', mat: 'plate', o: { style: 'cap' } },
        { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.34, y: -0.07 } },
      ];
    default:
      return [
        { id: 'tunic', mat: 'cloth', o: { hem: 0.1, sleeve: 0 } },
        { id: 'trousers', mat: 'cloth2', o: { baggy: 0.15, end: 0.97 } },
        { id: 'boots', mat: 'lacquer2', o: { start: 0.35 } },
        { id: 'cuirass', mat: 'lacquer', o: { style: 'plate', ridge: true, emblem: 1, bands: 3 } },
        { id: 'belt', mat: 'lacquer2' },
        { id: 'tassets', mat: 'lacquer', o: { count: 10, len: 0.24, flare: 0.3, rows: 1 } },
        { id: 'cuisse', mat: 'lacquer' },
        { id: 'pauldron', mat: 'lacquer', o: { lames: 3, size: 1.15, spike: 0.6 } },
        { id: 'vambrace', mat: 'lacquer', o: { from: 0.5, flare: 1.3 } },
        { id: 'greaves', mat: 'lacquer', o: { cop: 1.2, copSpike: 0.5 } },
        { id: 'collar', mat: 'lacquer' },
        { id: 'backpiece', mat: 'lacquer', o: { size: 0.9, spikes: 0 } },
        { id: 'helm', mat: 'lacquer', o: { style: 'kabuto', crestSize: 1.1 } },
        { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.36, y: -0.07 } },
      ];
  }
}

export function warriorParams() {
  const out = [];
  for (const sex of ['m', 'f'] as Sex[]) for (const tier of [0, 1, 2, 3]) {
    out.push(makeHero({
      cls: 'warrior', sex, tier, build: sex === 'm' ? MALE : FEMALE, crown: tier === 3 ? 0.03 : 0,
      hair: sex === 'm' ? { style: 'topknot', color: '#1e1814', highlight: '#4a3f36' } : { style: 'ponytail', color: '#1e1814', highlight: '#4a3f36' },
      outfit: outfit(tier), palette: PAL, style: 'sword2h', styleB: 'sword1h', rig: { skirt: true, ...(sex === 'f' ? { hairBones: 2 } : {}) },
    }));
  }
  return out;
}
