// ascetic: lean-muscular warrior monk - shaved head with a brow band, bare torso under a diagonal shoulder drape, wide knotted sash with
// hanging cloth, gathered trousers with wrapped shins, leather bracers, bead loop, long crescent-bladed spear with a red tassel.
import { bracers, browBand, kasaya, mala, monkSash, monkTrousers, shinWraps } from '../../archetypes/esoteric/ascetic_pieces.ts';
import { monkSpear } from '../../archetypes/esoteric/ascetic_spear.ts';
import { asceticStyle } from '../../archetypes/esoteric/ascetic_style.ts';
import { crowdFocus } from '../../archetypes/esoteric/focus.ts';
import { hangChain } from '../../archetypes/esoteric/hang.ts';
import { monkHead } from '../../archetypes/esoteric/head.ts';
import type { EsoParams } from '../../archetypes/esoteric/index.ts';
import type { HumanoidParams } from '../../archetypes/humanoid/index.ts';
import { orcClips } from '../../archetypes/orc/anim.ts';
import { buildCrowd } from '../../archetypes/orc/build.ts';
import { weaponFrame } from '../../archetypes/orc/kit.ts';
import { propTags } from '../../archetypes/orc/props.ts';

export function ascetic(): EsoParams {
  const hp: HumanoidParams = {
    id: 'ascetic', kind: 'creature', seed: 'ascetic', sex: 'm', bodyHeight: 1.86,
    build: { shoulder: 1.08, chest: 1.02, waist: 0.82, hips: 0.9, arms: 1.0, forearms: 1.08, legs: 0.95, calves: 1.0, neck: 0.95, hands: 1.2, feet: 1.05, head: 1.06, legLength: 1.1, armLength: 1.06, muscle: 1.1, lean: 0.1, headForward: 0.02, stance: 1.2, armSpread: 0.4 },
    skin: { base: '#c89a72', shade: '#8a6444', lip: '#9a5a48', eye: '#2a1c10', brow: '#2a1c14', mark: '#4a2a20' },
    hair: { style: 'none', color: '#1c1814', highlight: '#3a342e' },
    outfit: [
      { id: 'monkTrousers', mat: 'cloth2', build: monkTrousers, o: { baggy: 0.8, end: 0.62, puff: 0, trim: 'none' } },
      { id: 'shinWraps', mat: 'leather2', build: shinWraps, o: { from: 0.575, trim: 'none' } },
      { id: 'sandals', mat: 'leather', o: { trim: 'none' } },
      { id: 'monkSash', mat: 'sash', build: monkSash, o: { side: 1, tail: 0.5 } },
      { id: 'kasaya', mat: 'cloth', build: kasaya, o: { side: 1, flow: 0.42, trim: 'none' } },
      { id: 'bracers', mat: 'leather2', build: bracers, o: { trim: 'none' } },
      { id: 'mala', mat: 'bone', build: mala, o: { trim: 'none' } },
      { id: 'browBand', mat: 'sash', build: browBand, o: { tails: true, plate: 0.8 } },
    ],
    palette: { leather: '#4a2e1a', leather2: '#5e3a20', plate: '#7a7468', plateHi: '#d0ccc0', cloth: '#d8892c', cloth2: '#2e3448', sash: '#a8221c', bone: '#3a2416', gold: '#c8a040', paper: '#e8e0c8', ink: '#2a1c14', hair: '#1c1814' },
    style: 'spear',
    rig: { skirt: true, capeBones: 2 },
    mesh: { voxel: 0.008, tris: 4700 }, texture: 1024, liteHands: false,
    hooks: {
      head: monkHead({ brow: 1.15, jaw: 1.1, cheeks: 1.1, gaunt: 0.1, mouth: 'set', goatee: 0.8 }),
      afterOutfit: (ctx) => {
        const t = propTags(ctx, { metal: 'plate', haft: 'leather2', wrap: 'leather', cloth: 'sash' });
        monkSpear(ctx, weaponFrame(ctx.a, 'r'), t, { size: 1 });
      },
      clips: (_c, a, sk) => orcClips(a, sk, asceticStyle()),
    },
  };
  // relax() and projectToSurface() take unclamped Newton steps: one hand vertex with a near-zero SDF gradient was thrown ~1 m onto the right
  // sandal and stretched a spike from the rear hand to the floor. Decimated vertices already sit within a voxel of the surface, so skip both.
  hp.mesh = { ...hp.mesh, relax: 0, focus: crowdFocus(hp, { head: 9, headR: 0.26, chest: 1.5 }) };
  return {
    lite: true, radius: 0.36, hp, extraPose: (_clip, c) => hangChain(c, ['cape1', 'cape2'], 0.7),
    crowd: (def, log) => buildCrowd({ ...def, mesh: { ...def.mesh, project: 0 } }, log),
  };
}
