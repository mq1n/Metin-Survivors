// Glacier golem body: "stacked glacier slabs with a glowing blue core". ONE connected mass of overlapping faceted ice boulders:
// pelvis, belly, chest and a back hump stacked with glowing seam rings where they meet, overhanging shoulder boulders welded into club
// arms (upper arm, forearm, fist overlap into one tapering mass), short thick legs on slab feet, a V cleft in the chest holding a big
// core diamond, and a tall crystal-crested head with glowing eyes standing clear above the shoulders. Every part is ONE rigid hull
// (grip > 1) skinned to one bone and overlaps its neighbours by >= 10 cm (no gaps); glowing parts and the head are late-stage so the
// chest cleft never carves them.
import { type Vec3 } from '../../core/math.ts';
import type { Body } from '../../core/sdf/body.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { RoundCone } from '../../core/sdf/primitives.ts';
import type { GolemShape } from './anatomy.ts';
import { Hull, SIDES, block, chunk, crystal, flagstone, flagstoneSide, mirrorRot, mirrorX } from './kit.ts';

export function buildIceBody(body: Body, _sh: GolemShape): void {
  const slab = (name: string, sdf: Sdf, bone: string, ...tags: string[]): void => {
    body.add(name, sdf, { bone, tags: ['ice', ...tags], grip: 5, w: 0.03 });
  };
  const late = (name: string, sdf: Sdf, bone: string, ...tags: string[]): void => {
    body.addLate(name, sdf, { bone, tags: ['ice', ...tags], grip: 5, w: 0.02 });
  };
  const core = (name: string, sdf: Sdf, bone: string): void => {
    body.addLate(name, sdf, { bone, tags: ['core'], grip: 3, w: 0.012 });
  };

  // ------------------------------------------------------------------ inner glowing column (shows in the seam rings and the cleft)
  core('col_pelvis', new RoundCone([0, 1.1, 0.04], [0, 1.6, 0.1], 0.18, 0.17), 'pelvis');
  core('col_spine', new RoundCone([0, 1.52, 0.1], [0, 2.02, 0.22], 0.17, 0.17), 'spine');
  core('col_chest', new RoundCone([0, 1.94, 0.22], [0, 2.46, 0.36], 0.17, 0.15), 'chest');
  core('neck', new RoundCone([0, 2.34, 0.44], [0, 2.56, 0.72], 0.14, 0.13), 'neck');
  // glowing seam rings where the boulders meet
  core('seam_waist', flagstone(1.55, 1.59, 0.03, 0.1, 0.5, 0.44, { sides: 10, jit: 0.015, seed: 'sw' }), 'spine');
  core('seam_chest', flagstone(1.98, 2.02, 0.02, 0.22, 0.6, 0.5, { sides: 10, jit: 0.015, seed: 'sc' }), 'chest');

  // ------------------------------------------------------------------ torso: overlapping faceted boulders shifting forward up the stack (hunch)
  slab('pelvis', chunk([0, 1.28, 0.02], [0.68, 0.36, 0.48], { n: 12, flatBottom: 0.6, rot: [0, 18, 0], seed: 'pv', jitter: 0.1, w: 0.012 }), 'pelvis');
  slab('belly', chunk([0, 1.7, 0.16], [0.62, 0.38, 0.52], { n: 12, rot: [0, -14, 0], seed: 'bl', jitter: 0.1, w: 0.012 }), 'spine');
  slab('chest', chunk([0, 2.12, 0.32], [0.86, 0.46, 0.66], { n: 14, flatTop: 0.5, rot: [0, 10, 0], seed: 'ct', jitter: 0.1, w: 0.012 }), 'chest');
  slab('hump', chunk([0, 2.46, -0.3], [0.66, 0.44, 0.48], { n: 11, rot: [-10, 0, 0], seed: 'hm', jitter: 0.12, w: 0.012 }), 'chest');
  // big angular slabs welded over the boulders: the "stacked glacier slab" read
  slab('slab_chest', flagstone(1.8, 2.3, 0.0, 0.7, 0.58, 0.26, { rot: [20, -8], sides: 5, taper: 0.92, tilt: [-8, 0], chips: 3, seed: 'sl1' }), 'chest');
  slab('slab_belly', flagstone(1.36, 1.86, 0.04, 0.58, 0.46, 0.22, { rot: [-18, 12], sides: 5, taper: 0.92, tilt: [-5, 0], chips: 2, seed: 'sl2' }), 'spine');
  slab('slab_back', flagstone(1.7, 2.5, 0.0, -0.58, 0.54, 0.22, { rot: [10, -12], sides: 5, taper: 0.92, tilt: [8, 0], chips: 3, seed: 'sl3' }), 'chest');

  // ------------------------------------------------------------------ head: a tall faceted crystal cone (the crest) with a flat face plate, brow and side horns
  late('head', crystal([0, 2.38, 0.66], [0, 3.06, 0.82], 0.38, { sides: 7, shoulder: 0.42, taper: 0.74, seed: 'hd', jitter: 0.06, w: 0.012 }), 'head', 'head');
  late('face', Hull.fromPoints([
    [0.3, 2.42, 0.62], [-0.3, 2.42, 0.62], [0.32, 2.42, 1.04], [-0.32, 2.42, 1.04],
    [0.24, 2.86, 0.68], [-0.24, 2.86, 0.68], [0.22, 2.84, 0.98], [-0.22, 2.84, 0.98],
  ], 0.014, { chips: 2, chipDepth: [0.02, 0.05], seed: 'face' }), 'head', 'head', 'face');
  late('brow', block([0, 2.74, 1.02], [0.32, 0.055, 0.1], { rot: [-16, 0, 0], seed: 'brow', w: 0.01 }), 'head', 'head');
  late('crown_l', crystal([0.28, 2.76, 0.64], [0.56, 3.0, 0.56], 0.11, { seed: 'cl', shoulder: 0.45 }), 'head', 'crystal');
  late('crown_r', crystal([-0.28, 2.76, 0.64], [-0.56, 3.0, 0.56], 0.11, { seed: 'cr', shoulder: 0.45 }), 'head', 'crystal');

  // ------------------------------------------------------------------ chest core: a big diamond in a V cleft of the chest slabs
  core('core_crystal', crystal([0, 1.8, 0.74], [0, 2.4, 0.86], 0.25, { sides: 4, shoulder: 0.5, taper: 1, seed: 'core', jitter: 0 }), 'core');
  body.cut('cleft', Hull.fromPoints([
    [0.07, 1.86, 0.64], [-0.07, 1.86, 0.64], [0.12, 2.26, 0.64], [-0.12, 2.26, 0.64],
    [0.34, 1.82, 1.5], [-0.34, 1.82, 1.5], [0.48, 2.42, 1.5], [-0.48, 2.42, 1.5],
  ], 0.012), { bone: 'chest', w: 0.012 });

  // ------------------------------------------------------------------ back ridge: icicle spikes on the hump (clear of the crest)
  const ridge: [Vec3, Vec3, number][] = [
    [[0, 2.5, -0.5], [0, 2.84, -1.0], 0.16],
    [[0.36, 2.44, -0.46], [0.54, 2.7, -0.94], 0.12],
    [[-0.36, 2.44, -0.46], [-0.54, 2.7, -0.94], 0.12],
    [[0, 2.06, -0.56], [0, 2.16, -1.0], 0.14],
  ];
  ridge.forEach(([b, t, r], i) => slab(`ridge${i}`, crystal(b, t, r, { seed: `rg${i}`, shoulder: 0.4 }), 'ridge', 'crystal'));

  for (const sx of SIDES) {
    const n = sx === 1 ? 'l' : 'r';
    const jt = (v: Vec3): Vec3 => mirrorX(v, sx);
    const r = (v: Vec3): Vec3 => mirrorRot(v, sx);
    const seed = (s: string): string => `${s}${n}`;

    // ---------------------------------------------------------------- shoulders: overhanging boulders on the clavicle, welded to the chest and the arm
    slab(`boulder_${n}`, chunk(jt([0.98, 2.34, 0.3]), [0.56, 0.38, 0.52], { n: 11, rot: r([6, 10, -8]), flatBottom: 0.5, seed: seed('bo'), jitter: 0.12, w: 0.012 }), `clavicle_${n}`);
    slab(`sp0_${n}`, crystal(jt([0.88, 2.64, 0.26]), jt([0.82, 2.96, 0.12]), 0.15, { seed: seed('s0'), shoulder: 0.45 }), `clavicle_${n}`, 'crystal');
    slab(`sp1_${n}`, crystal(jt([1.34, 2.38, 0.1]), jt([1.72, 2.62, -0.08]), 0.12, { seed: seed('s1'), shoulder: 0.45 }), `clavicle_${n}`, 'crystal');

    // ---------------------------------------------------------------- arms: club arms (upper arm, forearm, fist overlap into one tapering mass)
    slab(`uarm_${n}`, chunk(jt([1.04, 1.84, 0.4]), [0.35, 0.44, 0.35], { n: 11, rot: r([0, 14, -6]), seed: seed('ua'), jitter: 0.1, w: 0.012 }), `upper_arm_${n}`);
    slab(`elbowc_${n}`, crystal(jt([1.1, 1.56, 0.3]), jt([1.4, 1.64, -0.06]), 0.12, { seed: seed('ec'), shoulder: 0.4 }), `forearm_${n}`, 'crystal');
    slab(`farm_${n}`, chunk(jt([1.12, 1.26, 0.66]), [0.37, 0.44, 0.37], { n: 11, rot: r([-6, -10, 6]), seed: seed('fa'), jitter: 0.1, w: 0.012 }), `forearm_${n}`);
    const fp = (x: number, y: number, z: number): Vec3 => jt([1.14 + x * 1.1, 0.74 + y * 1.1, 0.86 + z * 1.1]);
    slab(`fist_${n}`, Hull.fromPoints([
      fp(-0.3, 0.32, -0.18), fp(0.3, 0.32, -0.18), fp(-0.32, 0.32, 0.2), fp(0.32, 0.32, 0.2),
      fp(-0.46, 0.04, -0.28), fp(0.46, 0.04, -0.28), fp(-0.46, 0.04, 0.34), fp(0.46, 0.04, 0.34),
      fp(-0.4, -0.32, -0.2), fp(0.4, -0.32, -0.2), fp(-0.4, -0.32, 0.4), fp(0.4, -0.32, 0.4),
      fp(-0.36, -0.2, 0.52), fp(0.36, -0.2, 0.52),
    ], 0.014, { chips: 4, chipDepth: [0.05, 0.1], seed: seed('fi') }), `wrist_${n}`);
    // glowing rings at elbow and wrist
    core(`ring_elbow_${n}`, flagstoneSide(sx, 1.5, 1.54, 1.07, 0.5, 0.37, 0.37, { sides: 10, jit: 0.015, seed: 're' }), `forearm_${n}`);
    core(`ring_wrist_${n}`, flagstoneSide(sx, 1.0, 1.04, 1.12, 0.78, 0.38, 0.38, { sides: 10, jit: 0.015, seed: 'rw' }), `wrist_${n}`);

    // ---------------------------------------------------------------- legs: short thick boulder pillars on big slab feet
    slab(`thigh_${n}`, chunk(jt([0.42, 0.9, 0.04]), [0.37, 0.38, 0.37], { n: 11, rot: r([0, -12, 0]), seed: seed('th'), jitter: 0.1, w: 0.012 }), `thigh_${n}`);
    slab(`shin_${n}`, chunk(jt([0.42, 0.5, 0.08]), [0.33, 0.34, 0.33], { n: 10, rot: r([0, 8, 0]), seed: seed('sn'), jitter: 0.1, w: 0.012 }), `shin_${n}`);
    slab(`kneecap_${n}`, crystal(jt([0.42, 0.62, 0.3]), jt([0.42, 0.72, 0.68]), 0.14, { seed: seed('kc'), shoulder: 0.4, flat: 0.8 }), `shin_${n}`, 'crystal');
    slab(`foot_${n}`, chunk(jt([0.42, 0.17, 0.16]), [0.4, 0.2, 0.58], { n: 10, flatBottom: 0.85, seed: seed('ft'), jitter: 0.1, w: 0.012 }), `foot_${n}`);
    slab(`toe_${n}`, block(jt([0.42, 0.1, 0.72]), [0.32, 0.1, 0.17], { top: [0.8, 0.6], rot: r([-6, 0, 0]), chips: 1, seed: seed('to') }), `toe_${n}`);
    core(`ring_knee_${n}`, flagstoneSide(sx, 0.58, 0.62, 0.42, 0.07, 0.34, 0.34, { sides: 10, jit: 0.015, seed: 'rk' }), `shin_${n}`);
    core(`ring_ankle_${n}`, flagstoneSide(sx, 0.34, 0.38, 0.42, 0.04, 0.34, 0.34, { sides: 10, jit: 0.015, seed: 'ra' }), `foot_${n}`);

    // ---------------------------------------------------------------- eyes: big glowing slits proud of the face
    core(`eyeglow_${n}`, block(jt([0.16, 2.66, 1.02]), [0.1, 0.028, 0.035], { rot: r([0, 0, -12]), w: 0.005 }), 'head');
  }
}
