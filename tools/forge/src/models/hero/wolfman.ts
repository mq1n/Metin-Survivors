// Wolfman heroes (humanoid_beast): wolf-blooded brawlers, hunched, clawed, with lupine head, ears and tail.
import type { PieceSpec } from '../../archetypes/humanoid/index.ts';
import { makeHero } from './common.ts';

const BUILD = { shoulder: 1.18, chest: 1.12, waist: 0.9, arms: 1.15, forearms: 1.2, legs: 1.0, calves: 1.04, neck: 1.2, hands: 1.28, feet: 1.12, muscle: 1.1, stance: 1.12, lean: 0.3, headForward: 0.04, armLength: 1.12, head: 1.0 };
const PAL = { cloth: '#3b3430', cloth2: '#2c2623', leather: '#5a4130', leather2: '#34261c', plate: '#7e868e', plate2: '#4a5058', fur: '#8c8274', fur2: '#5f574d', gold: '#c49a40', trim: '#c49a40', bone: '#d8cfb8', hair: '#8c8274' };

function outfit(tier: number): PieceSpec[] {
  const tail: PieceSpec = { id: 'tail', mat: 'fur' };
  const trousers: PieceSpec = { id: 'trousers', mat: 'leather2', o: { baggy: 0.35, end: 0.78 } };
  switch (tier) {
    case 0:
      return [trousers, { id: 'wraps', mat: 'bone', o: { where: 'forearm', rings: 4 } }, { id: 'belt', mat: 'leather' }, tail];
    case 1:
      return [trousers, { id: 'wraps', mat: 'bone', o: { where: 'both', rings: 4 } }, { id: 'belt', mat: 'leather' }, { id: 'mantle', mat: 'fur', o: { rings: 2 } }, tail];
    case 2:
      return [trousers, { id: 'wraps', mat: 'leather2', o: { where: 'both', rings: 4 } }, { id: 'cuirass', mat: 'leather', o: { style: 'leather', ridge: false, straps: true, strapMat: 'leather2', neck: 0.9 } }, { id: 'pauldron', mat: 'leather', o: { lames: 2, size: 0.9, side: 'r' } }, { id: 'belt', mat: 'leather2' }, { id: 'mantle', mat: 'fur', o: { rings: 3 } }, tail];
    default:
      return [trousers, { id: 'cuirass', mat: 'plate', o: { style: 'plate', ridge: true, bands: 2, neck: 0.9 } }, { id: 'pauldron', mat: 'plate', o: { lames: 3, size: 1.1, spike: 0.5 } }, { id: 'vambrace', mat: 'plate', o: { from: 0.55, flare: 0.8 } }, { id: 'greaves', mat: 'plate', o: { cop: 1, copSpike: 0.4 } }, { id: 'belt', mat: 'leather2' }, { id: 'mantle', mat: 'fur', o: { rings: 3, spread: 1.2 } }, { id: 'collar', mat: 'plate' }, tail];
  }
}

export function wolfmanParams() {
  return [0, 1, 2, 3].map((tier) => makeHero({
    cls: 'wolfman', sex: 'm', tier, build: BUILD, head: 'wolf',
    face: { jaw: 0.8, brow: 0.7, nose: 0.6, lips: 0.4, eyes: 1, cheeks: 0.5, slant: 0.25 },
    skin: { base: '#8c8274', shade: '#5f574d', lip: '#5a3a36', eye: '#e0b030', brow: '#3a342e' },
    hair: { style: 'wolf', color: '#8c8274', highlight: '#c9c0b0' },
    outfit: outfit(tier), palette: PAL, style: 'claw', rig: { skirt: false, tailBones: 3, earBones: true },
  }));
}
