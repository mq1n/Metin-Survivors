// orc_scout: lean, hunched, big-eared skirmisher - fur-trimmed leather, short hatchet.
import { orcBody } from '../../archetypes/orc/body.ts';
import type { OrcParams } from '../../archetypes/orc/index.ts';
import { weaponFrame } from '../../archetypes/orc/kit.ts';
import { orcPaint } from '../../archetypes/orc/paint.ts';
import { furKilt, harness, trophies } from '../../archetypes/orc/pieces.ts';
import { hatchet, propTags } from '../../archetypes/orc/props.ts';
import { furMantle, goblinHead } from '../../archetypes/orc/raider.ts';
import { hatchetStyle } from '../../archetypes/orc/styles.ts';

export function orcScout(): OrcParams {
  return {
    lite: true,
    style: hatchetStyle(),
    focus: { head: 7, headR: 0.3 },
    hp: {
      id: 'orc_scout', kind: 'creature', seed: 'orc_scout', sex: 'm', bodyHeight: 1.88,
      build: { shoulder: 1.02, chest: 1.0, waist: 0.92, hips: 0.95, arms: 1.1, forearms: 1.2, legs: 1.05, calves: 1.0, neck: 1.0, hands: 1.55, feet: 1.45, head: 1.15, legLength: 0.95, armLength: 1.36, muscle: 0.85, lean: 0.52, headForward: 0.12, stance: 1.1, armSpread: 0.3 },
      skin: { base: '#7c9a58', shade: '#425e30', lip: '#7a403a', eye: '#f0d040', brow: '#2c3a20', mark: '#3a2a22' },
      hair: { style: 'spiky', color: '#2a2218', highlight: '#4a4034' },
      glow: { color: '#ffe050', tags: ['glow'] },
      outfit: [
        { id: 'furKilt', mat: 'leather', build: furKilt, o: { count: 9, len: 0.2, trim: 'none', fur: true } },
        { id: 'wraps', mat: 'cloth2', o: { where: 'shin', rings: 4, trim: 'none' } },
        { id: 'harness', mat: 'leather', build: harness, o: { trim: 'none', back: false } },
        { id: 'furMantle', mat: 'fur', build: furMantle, o: { rows: 2, tufts: 18, len: 0.9, wid: 0.95, shell: 0.7, drop: 0.7, trim: 'none' } },
        { id: 'trophies', mat: 'bone', build: trophies, o: { trim: 'none', neck: false } },
      ],
      palette: { leather: '#6a4a2a', leather2: '#7a5a34', cloth2: '#8a7a50', plate: '#6e7074', fur: '#8a7a58', bone: '#e2d8bc', cloth: '#7a2a20' },
      style: 'club',
      rig: { skirt: true, earBones: true },
      mesh: { voxel: 0.008, tris: 4800 }, texture: 512, liteHands: true,
      hooks: {
        head: goblinHead({ brow: 0.75, jaw: 0.85, snout: 0.9, tusk: 1.1, cheeks: 0.7, cranium: 1.0, glow: true }, { len: 1.3, wid: 1.2, roll: 0.5 }),
        afterBody: orcBody({ hump: 0.7, claws: 1.3, toeClaws: 1.2, ridge: 1.1 }),
        afterOutfit: (ctx) => {
          const t = propTags(ctx, { metal: 'plate', haft: 'leather2', wrap: 'leather' });
          hatchet(ctx, weaponFrame(ctx.a, 'r'), t, { size: 1 });
        },
        paint: orcPaint({ back: '#4a6a30' }),
      },
    },
  };
}
