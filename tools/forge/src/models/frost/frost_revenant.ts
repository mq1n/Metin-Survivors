// frost_revenant: upright frost-giant bruiser with lumpy ice armour and a club of frozen wood (2.0 m).
import { frostyClips, frostyKit } from '../../archetypes/frost/clips.ts';
import { frostyBody } from '../../archetypes/frost/frosty.ts';
import { frostyPaint } from '../../archetypes/frost/paint.ts';
import { authoredSpeeds } from '../../archetypes/giant/heavy.ts';
import type { GiantParams } from '../../archetypes/giant/pipeline.ts';
import { type HumanoidParams, computeAnatomy } from '../../archetypes/humanoid/index.ts';

export function frostRevenant(): GiantParams {
  const hp: HumanoidParams = {
    id: 'frost_revenant', kind: 'creature', seed: 'frost_revenant', sex: 'm', bodyHeight: 2.0,
    build: { shoulder: 1.4, chest: 1.35, waist: 1.12, hips: 1.1, arms: 1.4, forearms: 1.4, legs: 1.2, calves: 1.2, neck: 1.3, hands: 1.45, feet: 1.3, head: 1.05, legLength: 0.9, armLength: 1.15, muscle: 1.25, lean: 0.1, stance: 1.2, armSpread: 0.32 },
    face: { jaw: 0.95, brow: 0.7, nose: 0.4, lips: 0.4, eyes: 1.5, cheeks: 0.7, slant: 0.35, ears: 0.9 },
    skin: { base: '#3b7088', shade: '#1f4358', lip: '#2d5568', eye: '#8fe9ff', brow: '#10202c' },
    hair: { style: 'none', color: '#dfeaf2' },
    outfit: [],
    palette: {},
    rig: { skirt: true },
    style: 'club',
    tris: 5000, voxel: 0.0085, texture: 512, liteHands: true,
    hooks: { afterBody: frostyBody(), paint: frostyPaint(), clips: (_c, a, sk) => frostyClips(a, sk) },
  };
  const a = computeAnatomy(hp);
  hp.speed = authoredSpeeds(a, frostyKit(a));
  hp.mesh = { focus: [{ c: a.skull, r: 0.28 * a.s, gain: 3.6 }, { c: a.side(1).palm, r: 0.15 * a.s, gain: 1.8 }, { c: a.side(-1).palm, r: 0.15 * a.s, gain: 1.8 }] };
  return { hp, lite: true };
}
