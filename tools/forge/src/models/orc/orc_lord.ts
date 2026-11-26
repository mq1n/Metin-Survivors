// orc_lord: the Chief Orc boss - 3.4 m warlord with a bare muscular chest, dark plate, a dark iron mask with glowing slits and tusks under a spiked
// crown, huge layered pauldrons, a two-hand great axe with a crescent double bit carried over the shoulder and a trophy back-banner.
import { type HumanoidParams, computeAnatomy } from '../../archetypes/humanoid/index.ts';
import { orcBody } from '../../archetypes/orc/body.ts';
import { orcHead } from '../../archetypes/orc/head.ts';
import type { OrcParams } from '../../archetypes/orc/index.ts';
import { weaponFrame } from '../../archetypes/orc/kit.ts';
import { greatAxeStyle, lordBanner, lordBelt, lordBeltIron, lordCrown, lordMantle, lordMask, lordPauldron, lordPole, lordPoleIron, lordStrap, lordTrophies, lordTusks } from '../../archetypes/orc/lord.ts';
import { orcPaint } from '../../archetypes/orc/paint.ts';
import { greatAxe, propTags } from '../../archetypes/orc/props.ts';

export function orcLord(): OrcParams {
  const hp: HumanoidParams = {
    id: 'orc_lord', kind: 'boss', seed: 'orc_lord', sex: 'm', bodyHeight: 3.02,
    build: { shoulder: 1.6, chest: 1.5, waist: 1.1, hips: 1.0, arms: 1.7, forearms: 1.7, legs: 1.25, calves: 1.2, neck: 1.4, hands: 1.6, feet: 1.4, head: 1.45, legLength: 1.1, armLength: 1.15, muscle: 1.4, lean: 0.14, headForward: 0.05, stance: 1.6, armSpread: 0.45 },
    skin: { base: '#5c7448', shade: '#2e4026', lip: '#6e3a38', eye: '#ff8a28', brow: '#1a2414', mark: '#2a1e1a' },
    hair: { style: 'none', color: '#1c1a18', highlight: '#3a3632' },
    glow: { color: '#ff7a28', tags: ['glow'] },
    outfit: [
      { id: 'boots', mat: 'leather2', o: { start: 0.35, trim: 'none' } },
      { id: 'greaves', mat: 'plate', o: { cop: 1.5, copSpike: 1.1 } },
      { id: 'cuisse', mat: 'plate', o: { from: 0.1, to: 0.8, ext: 0.02 } },
      { id: 'tassets', mat: 'plate', o: { len: 0.24, count: 10, flare: 0.16 } },
      { id: 'lordStrap', mat: 'leather2', build: lordStrap, o: { trim: 'none' } },
      { id: 'lordBelt', mat: 'leather', build: lordBelt, o: { trim: 'none' } },
      { id: 'lordBeltIron', mat: 'plate', build: lordBeltIron },
      { id: 'vambrace', mat: 'plate', o: { cop: true, flare: 1.4 } },
      { id: 'lordPauldron', mat: 'plate', build: lordPauldron, o: { size: 1.4, lames: 2 } },
      { id: 'lordMantle', mat: 'fur', build: lordMantle, o: { trim: 'none' } },
      { id: 'lordMask', mat: 'plate', build: lordMask },
      { id: 'lordCrown', mat: 'gold', build: lordCrown },
      { id: 'lordTusks', mat: 'bone', build: lordTusks, o: { trim: 'none' } },
      { id: 'lordPole', mat: 'leather2', build: lordPole, o: { trim: 'none' } },
      { id: 'lordPoleIron', mat: 'plate', build: lordPoleIron },
      { id: 'lordTrophies', mat: 'bone', build: lordTrophies, o: { trim: 'none' } },
      { id: 'lordBanner', mat: 'cloth', build: lordBanner, o: { trim: 'none' } },
    ],
    palette: { cloth: '#8e2320', cloth2: '#2c2630', leather: '#4e3426', leather2: '#6a4a30', plate: '#4c4f58', plate2: '#8a8e98', plateHi: '#b4b8c0', fur: '#8a7a62', bone: '#e0d6b8', gold: '#a87a2c' },
    style: 'club',
    rig: { skirt: true, capeBones: 3, earBones: true },
    mesh: { voxel: 0.011, tris: 14000 }, texture: 1024,
    hooks: {
      head: orcHead({ brow: 1.2, jaw: 1.25, snout: 1.1, tusk: 0, ears: 0.95, droop: 0.2, cheeks: 1.1, cranium: 0.95, glow: true }),
      afterBody: orcBody({ hump: 1.0, claws: 1.3, toeClaws: 1.2, neckMass: 1.25 }),
      afterOutfit: (ctx) => {
        const t = propTags(ctx, { metal: 'plate2', haft: 'leather2', wrap: 'leather', bone: 'bone', cloth: 'cloth', glow: 'gold' });
        greatAxe(ctx, weaponFrame(ctx.a, 'r'), t);
      },
      paint: orcPaint({ back: '#3d5a2c', mottle: 0.6 }),
    },
  };
  const a = computeAnatomy(hp);
  const palm = a.side(-1).palm;
  return {
    style: greatAxeStyle(a.s),
    focus: { head: 4, headR: 0.4, hands: 1.8, extra: [{ c: [palm[0], palm[1], palm[2] + 0.8 * a.s], r: 0.7 * a.s, gain: 2.2 }] },
    hp,
  };
}
