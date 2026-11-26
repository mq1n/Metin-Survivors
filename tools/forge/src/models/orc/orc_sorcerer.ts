// orc_sorcerer: hunched orc shaman - bone totem staff crowned with a huge horned skull and a glowing orb, full feathered mantle and headdress, glowing eyes.
import { type Ctx, type HumanoidParams, computeAnatomy } from '../../archetypes/humanoid/index.ts';
import { orcBody } from '../../archetypes/orc/body.ts';
import { orcHead } from '../../archetypes/orc/head.ts';
import type { OrcParams } from '../../archetypes/orc/index.ts';
import { weaponFrame } from '../../archetypes/orc/kit.ts';
import { orcPaint } from '../../archetypes/orc/paint.ts';
import { featherCrest, featherMantle, furKilt, trophies } from '../../archetypes/orc/pieces.ts';
import { propTags, totemStaff } from '../../archetypes/orc/props.ts';
import { staffStyle } from '../../archetypes/orc/styles.ts';
import { Sphere } from '../../core/sdf/primitives.ts';

/** big glowing eyes: bulging orbs recessed in the sockets (tags `eye` + `glow` feed the emissive map) */
function glowEyes(ctx: Ctx): void {
  const a = ctx.a;
  const k = a.s * a.hs;
  const sk = a.skull;
  for (const sx of [1, -1] as const) {
    ctx.late(`glowEye_${sx === 1 ? 'l' : 'r'}`, new Sphere([sk[0] + sx * 0.036 * k, sk[1], sk[2] + 0.0775 * k], 0.0142 * k), 'head', { tags: ['eye', 'glow'], w: 0.002 });
  }
}

export function orcSorcerer(): OrcParams {
  const hp: HumanoidParams = {
    id: 'orc_sorcerer', kind: 'creature', seed: 'orc_sorcerer', sex: 'm', bodyHeight: 1.74,
    build: { shoulder: 1.15, chest: 1.0, waist: 0.9, hips: 0.95, arms: 0.95, forearms: 1.0, legs: 0.95, calves: 0.9, neck: 1.0, hands: 1.5, feet: 1.35, head: 1.25, legLength: 0.95, armLength: 1.2, muscle: 0.7, lean: 0.42, headForward: 0.1, stance: 1.05, armSpread: 0.3 },
    skin: { base: '#6e8c66', shade: '#3a5240', lip: '#6a3a40', eye: '#8dffd0', brow: '#22301e', mark: '#2a3a44' },
    hair: { style: 'none', color: '#1c1a18', highlight: '#3a3632' },
    glow: { color: '#7dffc8', tags: ['glow'] },
    outfit: [
      { id: 'furKilt', mat: 'cloth', build: furKilt, o: { count: 12, len: 0.5, flare: 0.18, rows: 2, trim: 'none' } },
      { id: 'wraps', mat: 'cloth2', o: { where: 'forearm', rings: 4, trim: 'none' } },
      { id: 'featherMantle', mat: 'cloth3', build: featherMantle, o: { rows: 3, count: 13, len: 1.35, wide: 1.25, ruff: 9, trim: 'none' } },
      { id: 'trophies', mat: 'bone', build: trophies, o: { trim: 'none', count: 11 } },
      { id: 'featherCrest', mat: 'cloth2', build: featherCrest, o: { count: 9, len: 0.8, trim: 'none' } },
    ],
    palette: { cloth: '#3a2f52', cloth2: '#c0452a', cloth3: '#2e8a86', leather: '#5a3b24', leather2: '#6e4a2a', plate: '#6e7074', bone: '#e2d8bc', wood: '#5a4030', rune: '#7dffc8' },
    style: 'club',
    rig: { skirt: true, earBones: true },
    mesh: { voxel: 0.008, tris: 4900 }, texture: 512, liteHands: true,
    hooks: {
      head: (ctx) => {
        orcHead({ brow: 0.8, jaw: 0.8, snout: 0.9, tusk: 0.7, ears: 1.5, droop: 0.15, cheeks: 0.7, glow: true })(ctx);
        glowEyes(ctx);
      },
      afterBody: orcBody({ hump: 0.8, claws: 1.2, toeClaws: 1 }),
      afterOutfit: (ctx) => {
        const t = propTags(ctx, { metal: 'plate', haft: 'wood', wrap: 'leather', bone: 'bone', cloth: 'cloth2', glow: 'rune' });
        totemStaff(ctx, weaponFrame(ctx.a, 'r'), t, { size: 1 });
      },
      paint: orcPaint({ back: '#3f5a46' }),
    },
  };
  // the staff skull is the focal prop: keep triangle density there (bind pose: the staff points forward from the right hand)
  const a = computeAnatomy(hp);
  const skull = weaponFrame(a, 'r').p(0, 1.05 * a.s, 0.1 * a.s);
  return {
    lite: true,
    style: staffStyle(),
    focus: { head: 4.2, headR: 0.32, extra: [{ c: skull, r: 0.55 * a.s, gain: 3.4 }] },
    hp,
  };
}
