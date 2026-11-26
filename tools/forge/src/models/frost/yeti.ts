// yeti: hunched white-furred knuckle-walking ape-giant (2.6 m).
import { yetiClips, yetiKit } from '../../archetypes/frost/clips.ts';
import { yetiPaint } from '../../archetypes/frost/paint.ts';
import { yetiBody, yetiHead } from '../../archetypes/frost/yeti.ts';
import { authoredSpeeds } from '../../archetypes/giant/heavy.ts';
import type { GiantParams } from '../../archetypes/giant/pipeline.ts';
import { type HumanoidParams, computeAnatomy } from '../../archetypes/humanoid/index.ts';

export function yeti(): GiantParams {
  const hp: HumanoidParams = {
    id: 'yeti', kind: 'creature', seed: 'yeti', sex: 'm', bodyHeight: 2.85,
    build: { shoulder: 1.12, chest: 1.4, waist: 1.25, hips: 1.2, arms: 1.55, forearms: 1.7, legs: 1.3, calves: 1.25, neck: 1.25, hands: 1.25, feet: 0.95, head: 1.0, legLength: 0.62, armLength: 1.55, muscle: 1.1, lean: 0.95, headForward: -0.08, stance: 1.5, armSpread: 0.14 },
    skin: { base: '#e4eaf0', shade: '#98a9c2', lip: '#4a4a5a', eye: '#bfe8ff', brow: '#2a3040' },
    hair: { style: 'none', color: '#e8eef4' },
    outfit: [],
    palette: { fur: '#e6edf3' },
    style: 'fist',
    tris: 5000, voxel: 0.011, texture: 512, liteHands: true,
    hooks: { head: yetiHead(), afterBody: yetiBody(), paint: yetiPaint(), clips: (_c, a, sk) => yetiClips(a, sk) },
  };
  const a = computeAnatomy(hp);
  hp.speed = authoredSpeeds(a, yetiKit(a));
  // the face is the readable part of a 5k-tri beast: pull triangle budget into the skull (and the fists)
  hp.mesh = { focus: [{ c: a.skull, r: 0.27 * a.s, gain: 3.4 }, { c: a.side(1).palm, r: 0.16 * a.s, gain: 1.8 }, { c: a.side(-1).palm, r: 0.16 * a.s, gain: 1.8 }] };
  return { hp, lite: true };
}
