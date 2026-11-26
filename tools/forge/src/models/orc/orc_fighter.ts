// orc_fighter: broad orc warrior - iron pauldrons, big cleaver, fur mantle (humanoid archetype + orc head / body / piece kit).
import { orcBody } from '../../archetypes/orc/body.ts';
import { orcHead } from '../../archetypes/orc/head.ts';
import type { OrcParams } from '../../archetypes/orc/index.ts';
import { weaponFrame } from '../../archetypes/orc/kit.ts';
import { orcPaint } from '../../archetypes/orc/paint.ts';
import { furKilt, harness, harnessStuds, spikedBracers, trophies } from '../../archetypes/orc/pieces.ts';
import { cleaver, propTags } from '../../archetypes/orc/props.ts';
import { crestHair, furMantle } from '../../archetypes/orc/raider.ts';
import { cleaverStyle } from '../../archetypes/orc/styles.ts';

export function orcFighter(): OrcParams {
  return {
    lite: true,
    style: cleaverStyle(),
    focus: { head: 7, headR: 0.3 },
    hp: {
      id: 'orc_fighter', kind: 'creature', seed: 'orc_fighter', sex: 'm', bodyHeight: 2.02,
      build: { shoulder: 1.4, chest: 1.3, waist: 1.08, hips: 1.08, arms: 1.45, forearms: 1.5, legs: 1.2, calves: 1.2, neck: 1.3, hands: 1.55, feet: 1.4, head: 1.12, legLength: 0.9, armLength: 1.18, muscle: 1.3, lean: 0.34, headForward: 0.05, stance: 1.3, armSpread: 0.38 },
      skin: { base: '#6f8f4e', shade: '#3b5530', lip: '#7a3f3a', eye: '#e0b830', brow: '#26331c', mark: '#3a2a22' },
      hair: { style: 'none', color: '#1c1a18', highlight: '#3a3632' },
      glow: { color: '#ffd040', tags: ['glow'] },
      outfit: [
        { id: 'furKilt', mat: 'leather', build: furKilt, o: { count: 12, len: 0.3, trim: 'none' } },
        { id: 'wraps', mat: 'leather2', o: { where: 'shin', rings: 5, trim: 'none' } },
        { id: 'harness', mat: 'leather', build: harness, o: { trim: 'none' } },
        { id: 'harnessStuds', mat: 'plate', build: harnessStuds, o: { trim: 'none' } },
        { id: 'pauldron', mat: 'plate', o: { spike: 1.1, lames: 3, size: 1.1, trim: 'none' } },
        { id: 'bracers', mat: 'plate', build: spikedBracers, o: { spikes: 3, trim: 'none' } },
        { id: 'furMantle', mat: 'fur', build: furMantle, o: { rows: 3, tufts: 22, len: 1.1, wid: 1.1, shell: 1, drop: 1.2, trim: 'none' } },
        { id: 'crest', mat: 'hair', build: crestHair, o: { tufts: 7, h: 0.65, tail: 1, trim: 'none' } },
        { id: 'trophies', mat: 'bone', build: trophies, o: { trim: 'none' } },
      ],
      palette: { leather: '#5a3b24', leather2: '#6e4a2a', plate: '#6e7074', plateHi: '#c0c4c8', fur: '#7a6244', bone: '#e2d8bc', cloth: '#8a2a20', gold: '#b88a2e' },
      style: 'club',
      rig: { skirt: true, earBones: true },
      mesh: { voxel: 0.008, tris: 4800 }, texture: 512, liteHands: true,
      hooks: {
        head: orcHead({ glow: true, tusk: 1.25, jaw: 1.05 }),
        afterBody: orcBody({ hump: 1, claws: 1, toeClaws: 1, neckMass: 1 }),
        afterOutfit: (ctx) => {
          const t = propTags(ctx, { metal: 'plate', haft: 'leather2', wrap: 'leather' });
          cleaver(ctx, weaponFrame(ctx.a, 'r'), t, { size: 0.8 });
        },
        paint: orcPaint({ back: '#3d5a2c' }),
      },
    },
  };
}
