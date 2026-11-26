// Ice wraith: a hovering faceted-crystal body (no legs), tiered hem of ice petals, hollow-faced crystal helm with a crown,
// pauldron shard clusters, icicle-clawed arms (one raised to cast), a chest gem, a floating rune ring and orbiting shards.
// Everything solid is a cut-gem polytope (crystal.ts) so the silhouette is made of straight facets and spikes, never blobs.
import { type Vec3, qeuler, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { Ellipsoid, Torus } from '../../core/sdf/primitives.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import { type CrystalOpts, crystal } from './crystal.ts';

export interface ArmJoints {
  sh: Vec3;
  el: Vec3;
  wr: Vec3;
}

export interface IceAnatomy {
  s: number;
  /** design-space -> posed design-space (forward hunch) */
  lean: (p: Vec3) => Vec3;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  l: ArmJoints;
  r: ArmJoints;
  ringC: Vec3;
  ringTilt: number;
  ringR: number;
  petalAngles: number[];
}

export function iceAnatomy(s: number): IceAnatomy {
  const lean = (p: Vec3): Vec3 => [p[0], p[1], p[2] + 0.2 * Math.max(0, p[1] - 0.85)];
  return {
    s,
    lean,
    pelvis: [0, 0.8, 0],
    spine: [0, 0.95, 0.01],
    chest: [0, 1.06, 0.02],
    neck: [0, 1.2, 0.03],
    head: [0, 1.34, 0.05],
    // left arm raised to cast, right arm trailing low
    l: { sh: [0.27, 1.13, 0], el: [0.52, 1.0, 0.1], wr: [0.5, 1.2, 0.4] },
    r: { sh: [-0.27, 1.13, 0], el: [-0.41, 0.9, 0.0], wr: [-0.36, 0.7, 0.2] },
    ringC: [0, 0.68, 0],
    ringTilt: 0.2,
    ringR: 0.4,
    petalAngles: [0, 60, 120, 180, 240, 300],
  };
}

export const ICE_SOCKETS = { head: 'head', muzzle: 'head', chest: 'chest', back: 'spine', hand_l: 'hand_l', hand_r: 'hand_r' } as const;

export function iceSkeleton(a: IceAnatomy): Skeleton {
  const s = a.s;
  const W = (v: Vec3): Vec3 => vscale(a.lean(v), s);
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: W(a.pelvis) },
    { name: 'spine', parent: 'pelvis', pos: W(a.spine) },
    { name: 'chest', parent: 'spine', pos: W(a.chest) },
    { name: 'neck', parent: 'chest', pos: W(a.neck) },
    { name: 'head', parent: 'neck', pos: W(a.head) },
    { name: 'crown_l', parent: 'head', pos: W([0.07, 1.46, -0.02]) },
    { name: 'crown_r', parent: 'head', pos: W([-0.07, 1.46, -0.02]) },
    { name: 'robe1', parent: 'pelvis', pos: W([0, 0.62, 0]) },
    { name: 'robe2', parent: 'robe1', pos: W([0, 0.48, 0]) },
    { name: 'robe3', parent: 'robe2', pos: W([0, 0.34, 0]) },
    { name: 'ring', parent: 'root', pos: W(a.ringC) },
    { name: 'orbit_a', parent: 'root', pos: W([0, 0.85, 0]) },
    { name: 'orbit_b', parent: 'root', pos: W([0, 0.85, 0]) },
  ];
  for (const ang of a.petalAngles) {
    const th = (ang * Math.PI) / 180;
    bones.push({ name: `petal_${ang}`, parent: 'pelvis', pos: W([Math.sin(th) * 0.12, 0.8, Math.cos(th) * 0.12]) });
  }
  for (const side of ['l', 'r'] as const) {
    const j = a[side];
    bones.push(
      { name: `arm_${side}`, parent: 'chest', pos: W(j.sh) },
      { name: `forearm_${side}`, parent: `arm_${side}`, pos: W(j.el) },
      { name: `hand_${side}`, parent: `forearm_${side}`, pos: W(j.wr) },
    );
  }
  return new Skeleton(bones);
}

export function iceBody(a: IceAnatomy, seed: number): Body {
  const s = a.s;
  const body = new Body();
  body.blend = 0.012 * s;
  const rng = new Rng(seed);
  /** design space -> world (lean + scale) */
  const W = (p: Vec3): Vec3 => vscale(a.lean(p), s);
  const R = (r: number): number => r * s;
  const sides: [string, number][] = [['l', 1], ['r', -1]];
  let n = 0;
  const shard = (name: string, p0: Vec3, p1: Vec3, r: number, bone: string, tags: string[], o: CrystalOpts = {}, w = 0.012, grip = 1): void => {
    body.add(`${name}_${n++}`, crystal(W(p0), W(p1), R(r), { edge: 0.004 * s, ...o }), { bone, w: w * s, tags: ['ice', ...tags], grip });
  };

  // ---------------------------------------------------------------- torso: chest prism over an inverted pyramid skirt
  shard('waist', [0, 0.72, 0], [0, 1.02, 0], 0.165, 'spine', ['torso'], { sides: 6, flat: 0.85, base: 'flat', shoulder: 1, taper: 1.08 });
  shard('chest', [0, 0.98, 0.01], [0, 1.24, 0.03], 0.2, 'chest', ['torso'], { sides: 6, flat: 0.78, base: 'flat', shoulder: 0.78, taper: 1.12, twist: 0.2 });
  shard('skirt', [0, 0.86, 0], [0, 0.42, 0], 0.185, 'pelvis', ['torso', 'robe'], { sides: 6, flat: 0.95, base: 'flat', shoulder: 0.3, taper: 0.85, twist: 0.52 });
  shard('tip_a', [0, 0.56, 0], [0, 0.26, 0], 0.085, 'robe2', ['robe', 'tip'], { sides: 6, base: 'blunt', shoulder: 0.25, twist: 0.1 });
  shard('tip_b', [0, 0.38, 0], [0, 0.1, 0], 0.05, 'robe3', ['robe', 'tip'], { sides: 5, base: 'blunt', shoulder: 0.2 });
  // chest gem: a cut stone set into the breastplate
  shard('gem', [0, 1.07, 0.1], [0, 1.1, 0.29], 0.07, 'chest', ['gem'], { sides: 4, flat: 0.62, side: [0, 1, 0], base: 'blunt', shoulder: 0.35, twist: 0.0, edge: 0.0025 * s }, 0.006, 2);
  for (const [sd, sx] of sides) {
    shard(`gem_wing_${sd}`, [0.03 * sx, 1.06, 0.12], [0.17 * sx, 0.98, 0.17], 0.026, 'chest', ['torso'], { sides: 4, flat: 0.5, side: [0, 1, 0], base: 'blunt', shoulder: 0.3 }, 0.01);
  }

  // ---------------------------------------------------------------- hem: two rings of ice petals (layered pagoda eaves)
  const petalBone = (deg: number): string => {
    let best = a.petalAngles[0]!, bd = 999;
    for (const pa of a.petalAngles) {
      const d = Math.abs(((deg - pa + 540) % 360) - 180);
      if (d < bd) { bd = d; best = pa; }
    }
    return `petal_${best}`;
  };
  const petal = (deg: number, y0: number, r0: number, y1: number, r1: number, width: number, thick: number, tags: string[]): void => {
    const th = (deg * Math.PI) / 180;
    const rad: Vec3 = [Math.sin(th), 0, Math.cos(th)];
    const tan: Vec3 = [Math.cos(th), 0, -Math.sin(th)];
    const p0: Vec3 = [rad[0] * r0, y0, rad[2] * r0];
    const p1: Vec3 = [rad[0] * r1, y1, rad[2] * r1];
    shard('petal', p0, p1, width, petalBone(deg), ['petal', ...tags], { sides: 4, flat: thick / width, side: tan, base: 'blunt', shoulder: 0.5, edge: 0.003 * s, twist: Math.PI / 4 }, 0.012);
  };
  for (let i = 0; i < 12; i++) {
    const L = 0.95 + rng.range(-0.18, 0.15);
    petal(i * 30 + rng.range(-4, 4), 0.82, 0.1, 0.82 - 0.44 * L, 0.1 + 0.3 * L + rng.range(-0.03, 0.04), 0.075, 0.022, ['long']);
  }
  for (let i = 0; i < 12; i++) {
    const L = 0.8 + rng.range(-0.15, 0.15);
    petal(i * 30 + 15 + rng.range(-4, 4), 0.9, 0.11, 0.9 - 0.32 * L, 0.11 + 0.32 * L, 0.055, 0.02, ['short']);
  }

  // ---------------------------------------------------------------- shoulders: pauldron shard clusters + snow caps
  for (const [sd, sx] of sides) {
    shard(`paul_main_${sd}`, [0.2 * sx, 1.08, 0], [0.42 * sx, 1.38, -0.04], 0.062, 'chest', ['pauldron'], { sides: 5, flat: 0.8, shoulder: 0.45 });
    shard(`paul_side_${sd}`, [0.3 * sx, 1.1, 0.02], [0.54 * sx, 1.22, 0.02], 0.045, 'chest', ['pauldron'], { sides: 5, shoulder: 0.45 });
    shard(`paul_back_${sd}`, [0.22 * sx, 1.14, -0.04], [0.28 * sx, 1.42, -0.17], 0.04, 'chest', ['pauldron'], { sides: 5, shoulder: 0.45 });
    shard(`paul_front_${sd}`, [0.24 * sx, 1.12, 0.05], [0.3 * sx, 1.3, 0.2], 0.035, 'chest', ['pauldron'], { sides: 5, shoulder: 0.45 });
    body.add(`snow_cap_${sd}`, new Ellipsoid(W([0.27 * sx, 1.15, 0]), [R(0.105), R(0.05), R(0.095)], qeuler(0, 0, -0.3 * sx)), { bone: 'chest', w: R(0.03), tags: ['snow'] });
  }

  // ---------------------------------------------------------------- collar ruff
  for (let i = 0; i < 9; i++) {
    const th = (i / 9) * Math.PI * 2 + 0.2;
    const rad: Vec3 = [Math.sin(th), 0, Math.cos(th)];
    if (rad[2] > 0.55) continue; // keep the face clear
    const p0: Vec3 = [rad[0] * 0.1, 1.2, 0.03 + rad[2] * 0.1];
    const p1: Vec3 = [rad[0] * 0.2, 1.34 + 0.04 * rng.next(), 0.03 + rad[2] * 0.2];
    shard('collar', p0, p1, 0.028, 'neck', ['collar'], { sides: 4, shoulder: 0.4, base: 'blunt' });
  }

  // ---------------------------------------------------------------- head: faceted helm, hollow face, crown
  shard('helm', [0, 1.2, 0.0], [0, 1.56, 0.03], 0.118, 'head', ['head', 'helm'], { sides: 6, flat: 0.88, base: 'flat', shoulder: 0.6, taper: 1.0, twist: 0.52 }, 0.012, 2);
  shard('helm_brow', [0, 1.4, 0.07], [0, 1.47, 0.17], 0.05, 'head', ['head', 'brow'], { sides: 4, flat: 1.6, shoulder: 0.5, base: 'blunt', side: [1, 0, 0] }, 0.01, 2);
  shard('chin', [0, 1.215, 0.06], [0, 1.06, 0.16], 0.034, 'head', ['head', 'chin'], { sides: 5, shoulder: 0.4, base: 'blunt' }, 0.01, 2);
  for (const [sd, sx] of sides) {
    shard(`cheek_${sd}`, [0.07 * sx, 1.27, 0.08], [0.16 * sx, 1.2, 0.2], 0.03, 'head', ['head'], { sides: 4, shoulder: 0.4, base: 'blunt' }, 0.01, 2);
    shard(`horn_a_${sd}`, [0.07 * sx, 1.46, -0.02], [0.17 * sx, 1.6, -0.12], 0.034, `crown_${sd}`, ['crown'], { sides: 5, shoulder: 0.2, base: 'blunt' }, 0.01);
    shard(`horn_b_${sd}`, [0.16 * sx, 1.58, -0.1], [0.2 * sx, 1.7, -0.3], 0.028, `crown_${sd}`, ['crown'], { sides: 5, shoulder: 0.2, base: 'blunt' }, 0.01);
    shard(`ear_${sd}`, [0.1 * sx, 1.36, -0.02], [0.21 * sx, 1.37, -0.13], 0.03, 'head', ['head'], { sides: 4, shoulder: 0.3, base: 'blunt' }, 0.01, 2);
  }
  shard('crest', [0, 1.5, 0.0], [0, 1.7, -0.08], 0.042, 'head', ['crown'], { sides: 5, flat: 0.6, shoulder: 0.2, base: 'blunt' }, 0.01);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.045;
    shard('mane', [x, 1.46, -0.07], [x * 1.8, 1.34 - 0.04 * (i % 2), -0.34 - 0.04 * (i % 2)], 0.026, 'head', ['crown', 'mane'], { sides: 4, flat: 0.6, shoulder: 0.2, base: 'blunt' }, 0.01);
  }
  // hollow face: shallow recess, two slanted glowing eye slits, a jagged mouth slit
  body.cut('face_recess', new Ellipsoid(W([0, 1.335, 0.125]), [R(0.048), R(0.072), R(0.045)], qeuler(0.1, 0, 0)), { bone: 'head', w: R(0.006), tags: ['void'] });
  for (const [sd, sx] of sides) {
    // eye slits: thin faceted lozenges floating inside the dark hollow (slanted: outer end up = angry), painted white-hot
    body.addLate(`eyeslit_${sd}`, crystal(W([0.024 * sx, 1.35, 0.152]), W([0.024 * sx, 1.35, 0.124]), R(0.022), { sides: 6, flat: 0.36, side: [sx, 0.55, 0], base: 'flat', shoulder: 1, edge: 0.0012 * s }), { bone: 'head', w: R(0.002), tags: ['eye'] });
  }
  body.addLate('mouth', crystal(W([0, 1.285, 0.15]), W([0, 1.285, 0.124]), R(0.032), { sides: 6, flat: 0.15, side: [1, 0, 0], base: 'flat', shoulder: 1, edge: 0.0012 * s }), { bone: 'head', w: R(0.002), tags: ['mouthvoid'] });

  // ---------------------------------------------------------------- arms: sleeve shards + icicle claws
  for (const [sd, sx] of sides) {
    const j = sd === 'l' ? a.l : a.r;
    shard(`arm_${sd}`, j.sh, j.el, 0.062, `arm_${sd}`, ['arm'], { sides: 5, flat: 0.85, base: 'blunt', shoulder: 0.95, taper: 0.8, side: [1, 0, 0] }, 0.015);
    shard(`fore_${sd}`, j.el, j.wr, 0.056, `forearm_${sd}`, ['arm'], { sides: 5, flat: 0.85, base: 'blunt', shoulder: 0.55, taper: 0.9, side: [1, 0, 0] }, 0.015);
    // sleeve fins hang below the forearm
    for (let k = 0; k < 2; k++) {
      const t = 0.2 + 0.4 * k;
      const base = vlerp(j.el, j.wr, t);
      const tip = vadd(base, [0.05 * sx * (1 - k * 0.5), -0.26 + 0.04 * k, -0.05]);
      shard(`sleeve_${sd}`, base, tip, 0.06 - 0.01 * k, `forearm_${sd}`, ['sleeve'], { sides: 4, flat: 0.4, base: 'blunt', shoulder: 0.4, side: [0, 0, 1], twist: Math.PI / 4 }, 0.012);
    }
    // icicle claws fan out around the forearm direction
    const fd = vnorm(vsub(j.wr, j.el));
    const up: Vec3 = Math.abs(fd[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const sdv = vnorm([fd[1] * up[2] - fd[2] * up[1], fd[2] * up[0] - fd[0] * up[2], fd[0] * up[1] - fd[1] * up[0]]);
    const upv = vnorm([sdv[1] * fd[2] - sdv[2] * fd[1], sdv[2] * fd[0] - sdv[0] * fd[2], sdv[0] * fd[1] - sdv[1] * fd[0]]);
    const fans: [number, number, number][] = [[0.0, 0.32, 0.26], [0.3 * sx, 0.1, 0.24], [-0.3 * sx, 0.0, 0.22], [0.0, -0.3, 0.17]];
    for (const [fs, fu, len] of fans) {
      const dd = vnorm(vadd(vadd(fd, vscale(sdv, fs)), vscale(upv, fu)));
      shard(`claw_${sd}`, vsub(j.wr, vscale(dd, 0.02)), vadd(j.wr, vscale(dd, len)), 0.027, `hand_${sd}`, ['claw'], { sides: 4, shoulder: 0.25, base: 'blunt' }, 0.01, 2);
    }
    shard(`palm_${sd}`, vsub(j.wr, vscale(fd, 0.02)), vadd(j.wr, vscale(fd, 0.08)), 0.048, `hand_${sd}`, ['claw'], { sides: 5, flat: 0.7, base: 'blunt', shoulder: 0.6 }, 0.012, 2);
  }

  // ---------------------------------------------------------------- floating rune ring (tilted, gyroscopic)
  const ringAxis = vnorm([Math.sin(a.ringTilt), Math.cos(a.ringTilt), 0]);
  const ringC = W(a.ringC);
  body.add('ring', new Torus(ringC, R(a.ringR), R(0.024), ringAxis), { bone: 'ring', w: R(0.004), tags: ['ring'], grip: 3 });
  body.add('ring_inner', new Torus(ringC, R(a.ringR - 0.034), R(0.01), ringAxis), { bone: 'ring', w: R(0.004), tags: ['ring'], grip: 3 });
  // ring studs: crystals standing on the band, positioned in the tilted ring plane
  const e1: Vec3 = vnorm([Math.cos(a.ringTilt), -Math.sin(a.ringTilt), 0]);
  const e2: Vec3 = [0, 0, 1];
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * Math.PI * 2;
    const rad = vadd(vscale(e1, Math.sin(th)), vscale(e2, Math.cos(th)));
    const c = vadd(vsub(a.ringC, [0, 0, 0]), vscale(rad, a.ringR));
    const upv = ringAxis;
    shard('stud', vsub(c, vscale(rad, 0.03)), vadd(vadd(c, vscale(rad, 0.07)), vscale(upv, 0.06)), 0.032, 'ring', ['ring', 'stud'], { sides: 4, shoulder: 0.5, base: 'blunt', twist: Math.PI / 4 }, 0.005, 3);
    shard('stud_dn', c, vadd(vadd(c, vscale(rad, 0.02)), vscale(upv, -0.08)), 0.024, 'ring', ['ring', 'stud'], { sides: 4, shoulder: 0.3, base: 'blunt' }, 0.005, 3);
  }

  // ---------------------------------------------------------------- orbiting shards
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * Math.PI * 2 + 0.3;
    const rad = 0.55 + 0.08 * rng.next();
    const y = 0.42 + 0.21 * i + 0.1 * rng.next();
    const c: Vec3 = [Math.sin(th) * rad, y, Math.cos(th) * rad];
    const d = vnorm([rng.range(-0.4, 0.4), 1, rng.range(-0.4, 0.4)]);
    const L = 0.17 + 0.06 * rng.next();
    shard('orbit', vsub(c, vscale(d, L * 0.5)), vadd(c, vscale(d, L * 0.5)), 0.04, i % 2 === 0 ? 'orbit_a' : 'orbit_b', ['shard'], { sides: 4, shoulder: 0.5, base: 'point', baseShoulder: 0.5, twist: i }, 0.003, 3);
  }
  return body;
}
