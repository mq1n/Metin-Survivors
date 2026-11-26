// zealot: gaunt hunched zealot - shaved head with a screaming mouth and big ears, a pointed dark mantle over the hunched shoulders, a heavy
// big-bead bandolier slung from the shoulder across chest and back, a saffron robe whose skirt and bell sleeves end in a few big clean points
// over a darker pointed under-robe, bare gaunt forearms with wrist bandages and long curved claws. Attacks with a two-handed rake.
import { beadSash, bellSleeves, clawHands, pointMantle, ropeBelt, wristWraps, zigSkirt } from '../../archetypes/esoteric/zealot_pieces.ts';
import { zealotStyle } from '../../archetypes/esoteric/zealot_style.ts';
import { crowdFocus } from '../../archetypes/esoteric/focus.ts';
import { monkHead } from '../../archetypes/esoteric/head.ts';
import type { EsoParams } from '../../archetypes/esoteric/index.ts';
import { monkPaint } from '../../archetypes/esoteric/paint.ts';
import { type HumanoidParams, computeAnatomy } from '../../archetypes/humanoid/index.ts';
import type { FocusRegion } from '../../core/mesh/simplify.ts';
import { orcClips } from '../../archetypes/orc/anim.ts';

export function zealot(): EsoParams {
  const hp: HumanoidParams = {
    id: 'zealot', kind: 'creature', seed: 'zealot', sex: 'm', bodyHeight: 1.82,
    build: { shoulder: 0.96, chest: 0.86, waist: 0.8, hips: 0.86, arms: 0.86, forearms: 0.95, legs: 0.84, calves: 0.8, neck: 0.9, hands: 1.5, feet: 1.15, head: 1.06, legLength: 1.0, armLength: 1.14, muscle: 0.25, lean: 0.42, headForward: 0.06, stance: 1.1, armSpread: 0.42 },
    skin: { base: '#c9ab8c', shade: '#8a6a52', lip: '#7a4a42', eye: '#e0d8b0', brow: '#2a2018', mark: '#5a2a22' },
    hair: { style: 'none', color: '#2a2018', highlight: '#4a4034' },
    outfit: [
      { id: 'tunic', mat: 'cloth2', o: { hem: 0.1, collar: 'v', trim: 'none' } },
      { id: 'underRobe', mat: 'cloth', build: zigSkirt, o: { notch: 0.42, depth: 0.22, count: 5, phase: 0.5, flare: 1.0, grow: -0.008, trim: 'none' } },
      { id: 'robeSkirt', mat: 'cloth2', build: zigSkirt, o: { notch: 0.64, depth: 0.3, count: 5, phase: 0, flare: 1.0, trim: 'none' } },
      { id: 'bellSleeves', mat: 'cloth2', build: bellSleeves, o: { loose: 0.9, flare: 1.5, end: 0.68, depth: 0.18, trim: 'none' } },
      { id: 'mantle', mat: 'sash', build: pointMantle, o: { ext: 0.028, notch: 0.09, depth: 0.22, count: 6, phase: 0.5, hump: 1, trim: 'none' } },
      { id: 'ropeBelt', mat: 'leather', build: ropeBelt, o: { r: 0.016, trim: 'none' } },
      { id: 'wristWraps', mat: 'paper', build: wristWraps, o: { from: 0.76, trim: 'none' } },
      { id: 'beadSash', mat: 'bone', build: beadSash, o: { tilt: 50, y: 0.3, bead: 0.048, beads: 10, cord: 0.016, clear: 0.006, trim: 'none' } },
    ],
    palette: { leather: '#3a2a1e', leather2: '#5a3a26', cloth: '#5a1a16', cloth2: '#d08a1e', sash: '#7a1e18', bone: '#ece4cc', gold: '#c0a050', paper: '#d8ccb0', ink: '#1c1410', hair: '#2a2018' },
    style: 'claw',
    rig: { skirt: true },
    // normals from a wider SDF stencil: the 6 mm default picks up cloth noise at the sparse robe vertices -> dark blocky facets
    mesh: { voxel: 0.008, tris: 4700, normalStep: 0.02 }, texture: 1024, liteHands: true,
    hooks: {
      head: monkHead({ brow: 1.3, jaw: 0.95, cheeks: 1.0, gaunt: 0.75, nose: 1.1, mouth: 'scream', eyes: 1.3, slant: 0.35, ears: 1.35 }),
      afterBody: clawHands({ len: 1.5, curl: 0.55, thick: 1.4 }),
      paint: monkPaint({ hollow: 0.9 }),
      clips: (_c, a, sk) => orcClips(a, sk, zealotStyle()),
    },
  };
  // the bandolier rides the chest and the hunched back: extra density there so the big beads survive decimation
  const a = computeAnatomy(hp);
  const back: FocusRegion = { c: [0, a.neck[1] - 0.18 * a.s, a.neck[2] - 0.14 * a.s], r: 0.28 * a.s, gain: 2 };
  hp.mesh = { ...hp.mesh, focus: crowdFocus(hp, { head: 8.5, headR: 0.26, hands: 2.4, chest: 2.2, extra: [back] }) };
  return { lite: true, radius: 0.36, hp };
}
