// black_orc: hulking black-hide brute - slab shoulders, chained belt, giant spiked mace.
import { blackHead, chainBelt, loinCloth, mace, maceStyle, pauldronStraps, slabPauldron, slabSpikes } from '../../archetypes/orc/black.ts';
import { orcBody } from '../../archetypes/orc/body.ts';
import type { OrcParams } from '../../archetypes/orc/index.ts';
import { weaponFrame } from '../../archetypes/orc/kit.ts';
import { orcPaint } from '../../archetypes/orc/paint.ts';
import { furKilt, spikedBracers, trophies } from '../../archetypes/orc/pieces.ts';
import { propTags } from '../../archetypes/orc/props.ts';

export function blackOrc(): OrcParams {
  return {
    lite: true,
    style: maceStyle(),
    focus: { head: 5.5, headR: 0.34 },
    hp: {
      id: 'black_orc', kind: 'creature', seed: 'black_orc', sex: 'm', bodyHeight: 2.6,
      build: { shoulder: 1.5, chest: 1.45, waist: 1.1, hips: 1.1, arms: 1.55, forearms: 1.75, legs: 1.3, calves: 1.3, neck: 1.1, hands: 1.75, feet: 1.55, head: 0.9, legLength: 0.86, armLength: 1.18, muscle: 1.4, lean: 0.28, headForward: 0.1, stance: 1.4, armSpread: 0.45 },
      skin: { base: '#645e66', shade: '#3e3a44', lip: '#6a4048', eye: '#ff3a28', brow: '#2a2830', mark: '#7a3a34' },
      hair: { style: 'none', color: '#101010', highlight: '#2a2a2a' },
      glow: { color: '#ff3a28', tags: ['glow'] },
      outfit: [
        { id: 'furKilt', mat: 'leather', build: furKilt, o: { count: 12, len: 0.34, rows: 2, trim: 'none' } },
        { id: 'loinCloth', mat: 'cloth', build: loinCloth, o: { trim: 'none' } },
        { id: 'chainBelt', mat: 'plate2', build: chainBelt, o: { trim: 'none' } },
        { id: 'wraps', mat: 'leather2', o: { where: 'shin', rings: 5, trim: 'none' } },
        { id: 'slabPauldron', mat: 'plate', build: slabPauldron, o: { size: 1, trim: 'none' } },
        { id: 'slabSpikes', mat: 'bone', build: slabSpikes, o: { size: 1, trim: 'none' } },
        { id: 'pauldronStraps', mat: 'leather2', build: pauldronStraps, o: { size: 1, trim: 'none' } },
        { id: 'bracers', mat: 'plate', build: spikedBracers, o: { spikes: 3, trim: 'none' } },
        { id: 'trophies', mat: 'bone', build: trophies, o: { trim: 'none', neck: false } },
      ],
      palette: { leather: '#5a4636', leather2: '#6a5240', plate: '#8a8d98', plate2: '#7c7f8a', plateHi: '#cfd3dc', bone: '#d8cfb4', cloth: '#b03024' },
      style: 'club',
      rig: { skirt: true, earBones: true },
      mesh: { voxel: 0.0095, tris: 4950 }, texture: 512, liteHands: true,
      hooks: {
        head: blackHead({ brow: 1.25, jaw: 1.2, snout: 1.1, tusk: 2.1, curl: 1.5, ears: 0.8, droop: 0.4, cheeks: 1.1, cranium: 0.9, glow: true, crest: 1 }),
        afterBody: orcBody({ hump: 0.9, claws: 1.2, toeClaws: 1.1, ridge: 1.7 }),
        afterOutfit: (ctx) => {
          const t = propTags(ctx, { metal: 'plate', haft: 'leather2', wrap: 'leather', bone: 'bone', cloth: 'cloth' });
          mace(ctx, weaponFrame(ctx.a, 'r'), t, { size: 1.25 });
        },
        paint: orcPaint({ back: '#5a5a66', mottle: 0.5 }),
      },
    },
  };
}
