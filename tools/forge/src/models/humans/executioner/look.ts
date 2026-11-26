// Look of the masked executioner: palette (mid-value, neutral: the game multiplies / colourises the albedo with the per-variant
// tint), skin, proportions and the outfit stack. Material families: leather (leather / leather2 / leather3), cloth (trousers +
// crimson waist ties), metal (iron chain), gold (brass studs / buckle / cleaver fittings), plate (cleaver steel).
// The paint stack lives in paint.ts and is keyed by the piece tags p<k+1> of this list (hair is p0, hook pieces p100..).
import type { HumanoidParams, PieceSpec } from '../../../archetypes/humanoid/index.ts';
import { addCleaver } from '../../../archetypes/brute/executioner-cleaver.ts';
import {
  apronBack, apronStraps, apronStuds, apronTies, beltHardware, bootGear, bracerStuds, chainSwag, hoodHardware, leatherApron, stitchedHood, strapHardware, wideBelt,
} from '../../../archetypes/brute/executioner-pieces.ts';

export const EXEC_SKIN = { base: '#a67a5c', shade: '#6a4634', lip: '#6e3d33', eye: '#e0a02a', brow: '#2b2119', mark: '#5a2e2a' };

export const EXEC_PALETTE: Record<string, string> = {
  cloth2: '#4f4b47', cloth3: '#7a2c25', leather: '#b79b73', leather2: '#6a4e38', leather3: '#352a21',
  metal: '#575c61', plate: '#8f98a2', plateHi: '#d6dce2', gold: '#b88a3a', trim: '#b88a3a', trimDark: '#2b2019', bone: '#d8cdb2',
  // paint-only colours (paint.ts)
  mask: '#a2845f', glove: '#3b2d23', ash: '#d9d2c3',
};

/** palette keys of the cleaver's three paint pieces (blade steel, leather-wrapped grip, brass fittings) */
export const EXEC_CLEAVER_MATS = { blade: 'plate', handle: 'leather3', metal: 'gold' };

/** hulking brute proportions: huge shoulders / arms / hands, short legs, head hunched forward */
export const EXEC_BUILD: NonNullable<HumanoidParams['build']> = {
  shoulder: 1.26, chest: 1.2, waist: 1.06, hips: 1.06, legs: 1.2, calves: 1.15, arms: 1.3, forearms: 1.36, neck: 1.15, hands: 1.36, feet: 1.25,
  head: 0.95, legLength: 0.92, armLength: 1.08, muscle: 1.3, lean: 0.14, headForward: 0.04, stance: 1.2,
};

export const EXEC_FACE = { jaw: 0.8, brow: 0.9, nose: 0.5, lips: 0.4, eyes: 0.9, cheeks: 0.5, slant: 0.5, ears: 0.9 };

export function execOutfit(): PieceSpec[] {
  const nt = { trim: 'none' };
  return [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.12, end: 0.95, ...nt } },
    { id: 'boots', mat: 'leather2', o: { start: 0.46, ext: 0.019, ...nt } },
    { id: 'bootGear', mat: 'leather3', build: bootGear, o: nt },
    { id: 'apron', mat: 'leather', build: leatherApron, o: { trim: 'trimDark' } },
    { id: 'apronStuds', mat: 'metal', build: apronStuds, o: nt },
    { id: 'apronBack', mat: 'leather2', build: apronBack, o: nt },
    { id: 'apronStraps', mat: 'leather3', build: apronStraps, o: nt },
    { id: 'strapHardware', mat: 'metal', build: strapHardware, o: nt },
    { id: 'belt', mat: 'leather3', build: wideBelt, o: nt },
    { id: 'apronTies', mat: 'cloth3', build: apronTies, o: nt },
    { id: 'beltHardware', mat: 'gold', build: beltHardware, o: nt },
    { id: 'chains', mat: 'metal', build: chainSwag, o: nt },
    { id: 'vambrace', mat: 'leather2', o: { from: 0.4, ext: 0.02, flare: 1.4, ...nt } },
    { id: 'bracerStuds', mat: 'gold', build: bracerStuds, o: nt },
    { id: 'hood', mat: 'leather3', build: stitchedHood, o: nt },
    { id: 'hoodHardware', mat: 'gold', build: hoodHardware, o: nt },
  ];
}

export const addExecCleaver = (ctx: Parameters<typeof addCleaver>[0], a: Parameters<typeof addCleaver>[1]): { bladeTag: string } =>
  addCleaver(ctx, a, { mats: EXEC_CLEAVER_MATS });
