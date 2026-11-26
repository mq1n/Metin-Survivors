// Magma golem body: "basalt plates with lava seams". Wide, upright, plate-armoured brute: a V-shaped split breastplate over a
// glowing core column, rib chevrons, a belt with tassets, three-tier lamellar pauldrons with spike crowns, hexagonal basalt column
// limbs with glowing joint rings, a horned helm with lava eyes and mouth, jagged back plates, wide spiked boots and heavy fists
// with knuckle spikes. Every plate is ONE rigid part (grip > 1) skinned to one bone; glowing parts are late-stage so cuts never
// carve them. Lava sits in the gaps between plates (belt, pauldron tiers, joints) so the seams read.
import { type Vec3, vnorm, vsub } from '../../core/math.ts';
import type { Body } from '../../core/sdf/body.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { RoundCone, Sphere } from '../../core/sdf/primitives.ts';
import type { GolemShape } from './anatomy.ts';
import { Hull, SIDES, block, chunk, column, crystal, flagstoneSide, mirrorRot, mirrorX } from './kit.ts';

export function buildFireBody(body: Body, sh: GolemShape): void {
  const plate = (name: string, sdf: Sdf, bone: string, ...tags: string[]): void => {
    body.add(name, sdf, { bone, tags: ['rock', ...tags], grip: 5, w: 0.012 });
  };
  /** the helm is late-stage rock too (keeps its face; lava eyes / mouth sit on it as slivers) */
  const helm = (name: string, sdf: Sdf, bone: string, ...tags: string[]): void => {
    body.addLate(name, sdf, { bone, tags: ['rock', ...tags], grip: 5, w: 0.012 });
  };
  /** glowing parts: lava, late-stage so cuts never carve them */
  const lava = (name: string, sdf: Sdf, bone: string): void => {
    body.addLate(name, sdf, { bone, tags: ['lava'], grip: 3, w: 0.01 });
  };

  // ------------------------------------------------------------------ glowing core column + heart + belt seam + neck ring
  lava('col_waist', new RoundCone([0, 1.28, 0.04], [0, 1.88, 0.08], 0.17, 0.16), 'spine');
  lava('col_chest', new RoundCone([0, 1.84, 0.1], [0, 2.3, 0.14], 0.15, 0.13), 'chest');
  lava('neck_glow', new RoundCone([0, 2.28, 0.14], [0, 2.46, 0.2], 0.13, 0.11), 'neck');
  lava('core_heart', new Sphere([0, 2.04, 0.38], 0.14), 'core');
  lava('belt_seam', block([0, 1.21, 0.02], [0.46, 0.028, 0.27], { w: 0.008 }), 'pelvis');
  lava('buckle', block([0, 1.3, 0.3], [0.085, 0.085, 0.02], { rot: [0, 0, 45], w: 0.006 }), 'pelvis');

  // ------------------------------------------------------------------ pelvis: belt + tasset plates + back plate
  plate('belt', block([0, 1.34, 0.02], [0.52, 0.1, 0.34], { top: [1.04, 1.02], chips: 2, seed: 'belt', w: 0.01 }), 'pelvis');
  plate('tasset_c', block([0, 1.1, 0.29], [0.13, 0.2, 0.035], { rot: [-6, 0, 0], bot: [0.8, 1], chips: 1, seed: 'tc', w: 0.008 }), 'pelvis');
  for (const sx of SIDES) {
    const n = sx === 1 ? 'l' : 'r';
    plate(`tasset_${n}`, block(mirrorX([0.3, 1.1, 0.25], sx), [0.12, 0.18, 0.035], { rot: mirrorRot([-6, 12, -8], sx), bot: [0.8, 1], chips: 1, seed: `ts${n}`, w: 0.008 }), 'pelvis');
  }
  plate('crotch_back', block([0, 1.1, -0.26], [0.22, 0.2, 0.035], { rot: [6, 0, 0], bot: [0.7, 1], seed: 'cb', w: 0.008 }), 'pelvis');

  // ------------------------------------------------------------------ waist: rib chevrons around the glowing column
  [1.46, 1.6, 1.74].forEach((y, i) => {
    for (const sx of SIDES) {
      const n = sx === 1 ? 'l' : 'r';
      plate(`rib${i}_${n}`, block(mirrorX([0.22, y, 0.1], sx), [0.15, 0.055, 0.22], { rot: mirrorRot([0, 22, -6], sx), top: [1, 0.92], chips: 1, seed: `rb${i}${n}`, w: 0.008 }), 'spine');
    }
  });
  plate('spine_plate', block([0, 1.64, -0.24], [0.34, 0.32, 0.1], { top: [1.15, 1], chips: 2, seed: 'sp', w: 0.01 }), 'spine');

  // ------------------------------------------------------------------ chest: two V-shaped breastplate halves with a glowing cleft between, yoke, back plate
  for (const sx of SIDES) {
    const n = sx === 1 ? 'l' : 'r';
    const cp = (x: number, y: number, z: number): Vec3 => mirrorX([x, y, z], sx);
    plate(`chest_${n}`, Hull.fromPoints([
      cp(0.09, 2.36, 0.38), cp(0.82, 2.34, 0.16), cp(0.82, 2.34, -0.3), cp(0.09, 2.36, -0.34),
      cp(0.09, 1.86, 0.4), cp(0.52, 1.86, 0.24), cp(0.5, 1.86, -0.3), cp(0.09, 1.86, -0.34),
      cp(0.34, 2.14, 0.56), cp(0.14, 2.1, 0.58),
    ], 0.014, { chips: 3, chipDepth: [0.03, 0.08], seed: `ch${n}` }), 'chest');
    plate(`pec_spike_${n}`, crystal(cp(0.34, 2.2, 0.54), cp(0.4, 2.16, 0.8), 0.085, { seed: `pk${n}`, shoulder: 0.4, sides: 5 }), 'chest', 'spike');
  }
  plate('back_plate', block([0, 2.12, -0.4], [0.62, 0.3, 0.1], { top: [1.1, 1], rot: [6, 0, 0], chips: 3, seed: 'bp', w: 0.01 }), 'chest');
  plate('vent_pack', block([0, 1.96, -0.54], [0.34, 0.34, 0.14], { top: [0.9, 0.9], chips: 3, seed: 'vp', w: 0.012 }), 'chest');
  lava('vent_glow_l', block([0.14, 2.0, -0.69], [0.07, 0.24, 0.03], { w: 0.006 }), 'chest');
  lava('vent_glow_r', block([-0.14, 2.0, -0.69], [0.07, 0.24, 0.03], { w: 0.006 }), 'chest');
  plate('gorget', block([0, 2.4, 0.16], [0.28, 0.07, 0.2], { top: [1.1, 1.1], chips: 1, seed: 'gor', w: 0.008 }), 'neck');

  // ------------------------------------------------------------------ dorsal ridge: jagged plate spikes
  const ridge: [Vec3, Vec3, number][] = [
    [[0, 2.3, -0.44], [0, 2.7, -0.74], 0.11],
    [[0, 2.5, -0.4], [0, 2.8, -0.52], 0.09],
    [[0, 1.72, -0.32], [0, 1.9, -0.62], 0.085],
    [[0.24, 2.26, -0.44], [0.36, 2.58, -0.68], 0.08],
    [[-0.24, 2.26, -0.44], [-0.36, 2.58, -0.68], 0.08],
  ];
  ridge.forEach(([b, t, r], i) => plate(`ridge${i}`, crystal(b, t, r, { seed: `rg${i}`, shoulder: 0.35, sides: 5, flat: 0.7 }), 'ridge', 'spike'));

  // ------------------------------------------------------------------ head: helm skull with heavy brow, jaw, lava mouth + eyes, horns
  const hp = (x: number, y: number, z: number): Vec3 => [x * 1.45, 2.6 + y * 1.45, 0.28 + z * 1.45];
  helm('skull', Hull.fromPoints([
    hp(0.17, 0.18, -0.15), hp(-0.17, 0.18, -0.15), hp(0.17, -0.14, -0.13), hp(-0.17, -0.14, -0.13),
    hp(0.21, 0.07, 0.17), hp(-0.21, 0.07, 0.17), hp(0.2, -0.04, 0.2), hp(-0.2, -0.04, 0.2),
    hp(0.14, -0.14, 0.18), hp(-0.14, -0.14, 0.18), hp(0.11, 0.22, 0.0), hp(-0.11, 0.22, 0.0),
  ], 0.01, { chips: 2, chipDepth: [0.015, 0.04], seed: 'skull' }), 'head', 'head');
  helm('brow', block([0, 2.72, 0.58], [0.3, 0.05, 0.1], { rot: [-16, 0, 0], seed: 'bw', w: 0.008 }), 'head', 'head');
  helm('jaw', block([0, 2.46, 0.45], [0.19, 0.07, 0.14], { bot: [0.8, 0.9], seed: 'jw', w: 0.008 }), 'head', 'head');
  for (const sx of SIDES) {
    const n = sx === 1 ? 'l' : 'r';
    helm(`horn_${n}`, crystal(mirrorX([0.2, 2.76, 0.2], sx), mirrorX([0.5, 3.0, -0.06], sx), 0.095, { seed: `hr${n}`, shoulder: 0.4, sides: 5 }), 'head', 'spike');
    lava(`eyeglow_${n}`, block(mirrorX([0.13, 2.65, 0.585], sx), [0.075, 0.02, 0.022], { rot: mirrorRot([0, 0, -12], sx), w: 0.005 }), 'head');
  }
  helm('crest', crystal([0, 2.82, 0.14], [0, 2.99, -0.16], 0.1, { seed: 'crest', shoulder: 0.4, sides: 5, flat: 0.6 }), 'head', 'spike');
  lava('mouthglow', block([0, 2.46, 0.6], [0.14, 0.017, 0.022], { w: 0.005 }), 'head');

  for (const sx of SIDES) {
    const n = sx === 1 ? 'l' : 'r';
    const jt = (v: Vec3): Vec3 => mirrorX(v, sx);
    const r = (v: Vec3): Vec3 => mirrorRot(v, sx);
    const seed = (s: string): string => `${s}${n}`;
    /** unit direction (x mirrored for the right side) + length between two left-side joints */
    const down = (a: Vec3, b: Vec3): { dir: Vec3; len: number } => {
      const d = vsub(b, a);
      return { dir: vnorm([d[0] * sx, d[1], d[2]]), len: Math.hypot(d[0], d[1], d[2]) };
    };

    // ---------------------------------------------------------------- pauldrons: three lamellar tiers with lava between, spike crown
    plate(`pauldron_${n}`, chunk(jt([1.04, 2.36, 0.04]), [0.52, 0.2, 0.46], { n: 10, flatBottom: 0.4, rot: r([4, 0, -14]), seed: seed('pa'), jitter: 0.08, w: 0.012 }), `clavicle_${n}`);
    plate(`pauldron2_${n}`, chunk(jt([1.08, 2.2, 0.04]), [0.5, 0.15, 0.44], { n: 9, flatBottom: 0.4, rot: r([0, 0, -16]), seed: seed('pb'), jitter: 0.08, w: 0.012 }), `clavicle_${n}`);
    plate(`pauldron3_${n}`, chunk(jt([1.1, 2.05, 0.04]), [0.44, 0.13, 0.4], { n: 9, flatBottom: 0.4, rot: r([0, 0, -18]), seed: seed('pc'), jitter: 0.08, w: 0.012 }), `upper_arm_${n}`);
    lava(`pauldron_seam_${n}`, chunk(jt([1.09, 2.14, 0.04]), [0.4, 0.2, 0.36], { n: 8, rot: r([0, 0, -17]), jitter: 0.03, seed: seed('ps'), w: 0.01 }), `clavicle_${n}`);
    plate(`psp0_${n}`, crystal(jt([0.9, 2.46, 0.04]), jt([0.86, 2.76, -0.04]), 0.095, { seed: seed('p0'), shoulder: 0.4, sides: 5 }), `clavicle_${n}`, 'spike');
    plate(`psp1_${n}`, crystal(jt([1.16, 2.44, 0.06]), jt([1.44, 2.66, 0.0]), 0.085, { seed: seed('p1'), shoulder: 0.4, sides: 5 }), `clavicle_${n}`, 'spike');
    plate(`psp2_${n}`, crystal(jt([1.0, 2.42, 0.28]), jt([1.06, 2.62, 0.52]), 0.075, { seed: seed('p2'), shoulder: 0.4, sides: 5 }), `clavicle_${n}`, 'spike');
    lava(`shoulder_glow_${n}`, new Sphere(jt([0.66, 2.24, 0.1]), 0.1), `clavicle_${n}`);

    // ---------------------------------------------------------------- arms: thick column upper arm, flared vambrace forearm, heavy spiked fist with lava knuckles
    const ua = down(sh.shoulder, sh.elbow);
    plate(`uarm_${n}`, column(jt([1.0, 2.04, 0.04]), ua.dir, ua.len * 0.9, 0.24, { sides: 8, top: 1.04, tilt: [4, 3], seed: seed('ua'), w: 0.014 }), `upper_arm_${n}`);
    lava(`elbow_${n}`, new Sphere(jt(sh.elbow), 0.12), `forearm_${n}`);
    plate(`elbow_spike_${n}`, crystal(jt([1.12, 1.56, 0.04]), jt([1.18, 1.52, -0.3]), 0.09, { seed: seed('es'), shoulder: 0.4, sides: 5 }), `forearm_${n}`, 'spike');
    const fa = down(sh.elbow, sh.wrist);
    plate(`farm_${n}`, column(jt([1.08, 1.46, 0.1]), fa.dir, fa.len * 0.92, 0.2, { sides: 8, top: 1.45, tilt: [-3, 3], seed: seed('fa'), w: 0.014 }), `forearm_${n}`);
    lava(`wrist_${n}`, new Sphere(jt(sh.wrist), 0.11), `wrist_${n}`);
    plate(`fist_${n}`, chunk(jt([1.06, 0.68, 0.28]), [0.33, 0.33, 0.37], { n: 11, jitter: 0.1, seed: seed('fi'), w: 0.01 }), `wrist_${n}`);
    for (const [i, kx] of [-0.16, 0, 0.16].entries()) {
      plate(`knuck${i}_${n}`, crystal(jt([1.06 + kx, 0.64, 0.56]), jt([1.06 + kx * 1.3, 0.7, 0.86]), 0.08, { seed: seed(`k${i}`), shoulder: 0.4, sides: 5 }), `wrist_${n}`, 'spike');
    }
    for (const [i, kx] of [-0.16, 0, 0.16].entries()) lava(`knuckle_glow${i}_${n}`, new Sphere(jt([1.06 + kx, 0.64, 0.52]), 0.06), `wrist_${n}`);

    // ---------------------------------------------------------------- legs: thick columns, greaves, knee spikes with lava rings, wide spiked boots
    const th = down(sh.hip, sh.knee);
    plate(`thigh_${n}`, column(jt([0.36, 1.2, 0.0]), th.dir, th.len * 1.0, 0.3, { sides: 8, top: 0.92, tilt: [3, -3], seed: seed('th'), w: 0.014 }), `thigh_${n}`);
    plate(`hip_guard_${n}`, block(jt([0.54, 1.26, 0.02]), [0.075, 0.2, 0.26], { rot: r([0, 0, 10]), chips: 2, seed: seed('hg'), w: 0.01 }), `thigh_${n}`);
    lava(`hip_ring_${n}`, new Sphere(jt([0.4, 1.2, 0.0]), 0.12), `thigh_${n}`);
    lava(`knee_${n}`, new Sphere(jt(sh.knee), 0.12), `shin_${n}`);
    plate(`kneespike_${n}`, crystal(jt([0.36, 0.78, 0.2]), jt([0.36, 0.9, 0.56]), 0.1, { seed: seed('ks'), shoulder: 0.4, sides: 5, flat: 0.85 }), `shin_${n}`, 'spike');
    const sn = down(sh.knee, sh.ankle);
    plate(`shin_${n}`, column(jt([0.36, 0.7, 0.07]), sn.dir, sn.len * 0.88, 0.25, { sides: 8, top: 0.8, tilt: [-3, 3], seed: seed('sn'), w: 0.014 }), `shin_${n}`);
    plate(`greave_${n}`, block(jt([0.36, 0.46, 0.28]), [0.13, 0.19, 0.05], { rot: r([-6, 0, 0]), chips: 1, seed: seed('gr'), w: 0.008 }), `shin_${n}`);
    lava(`ankle_${n}`, new Sphere(jt(sh.ankle), 0.1), `foot_${n}`);
    plate(`boot_${n}`, block(jt([0.36, 0.14, 0.1]), [0.24, 0.14, 0.36], { top: [0.85, 0.7], chips: 2, seed: seed('bt'), w: 0.014 }), `foot_${n}`);
    plate(`toecap_${n}`, crystal(jt([0.36, 0.1, 0.4]), jt([0.36, 0.14, 0.74]), 0.11, { seed: seed('tc'), shoulder: 0.45, sides: 5, flat: 0.6 }), `toe_${n}`, 'spike');
  }
}
