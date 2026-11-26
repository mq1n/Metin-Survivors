// Flame ghost: a slender burning woman (lava-skinned sculpted body: ribcage, bust, waist, hips, fingered claw hands; swept flame mane,
// thighs fused into a tapering torch tail, a fan of long flame-skirt tongues). Flames are curved flat teardrop blades (flatCone chains)
// so the silhouette is made of licking tongues; roots/tips carry paint marks so the heat gradient runs along each tongue.
import { type Vec3, qeuler, vadd, vcross, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { Ellipsoid, RoundCone, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone, tubeSegments } from '../../core/sdf/shapes.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import { crystal } from './crystal.ts';

export interface FireAnatomy {
  s: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  jaw: Vec3;
  l: { sh: Vec3; el: Vec3; wr: Vec3 };
  r: { sh: Vec3; el: Vec3; wr: Vec3 };
  tail: Vec3[];
}

export function fireAnatomy(s: number): FireAnatomy {
  return {
    s,
    pelvis: [0, 0.92, 0],
    spine: [0, 1.06, 0.01],
    chest: [0, 1.2, 0.02],
    neck: [0, 1.36, 0.04],
    head: [0, 1.47, 0.07],
    jaw: [0, 1.43, 0.08],
    // reaching pose: left hand lunges forward-up (about to throw), right hand trails low and back
    l: { sh: [0.2, 1.3, 0.0], el: [0.4, 1.2, 0.1], wr: [0.56, 1.3, 0.38] },
    r: { sh: [-0.2, 1.3, 0.0], el: [-0.4, 1.12, -0.02], wr: [-0.56, 0.96, -0.12] },
    // torch tail: S-curve
    tail: [[0, 0.9, 0.0], [0, 0.7, -0.07], [0, 0.5, -0.02], [0, 0.34, 0.08], [0, 0.2, 0.12]],
  };
}

export const FIRE_SOCKETS = { head: 'head', muzzle: 'jaw', chest: 'chest', back: 'spine', hand_l: 'hand_l', hand_r: 'hand_r' } as const;

export function fireSkeleton(a: FireAnatomy): Skeleton {
  const s = a.s;
  const W = (v: Vec3): Vec3 => vscale(v, s);
  const bones: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: W(a.pelvis) },
    { name: 'spine', parent: 'pelvis', pos: W(a.spine) },
    { name: 'chest', parent: 'spine', pos: W(a.chest) },
    { name: 'neck', parent: 'chest', pos: W(a.neck) },
    { name: 'head', parent: 'neck', pos: W(a.head) },
    { name: 'jaw', parent: 'head', pos: W(a.jaw) },
    { name: 'hair_c1', parent: 'head', pos: W([0, 1.56, 0.0]) },
    { name: 'hair_c2', parent: 'hair_c1', pos: W([0, 1.72, -0.12]) },
    { name: 'hair_l1', parent: 'head', pos: W([0.07, 1.55, 0.0]) },
    { name: 'hair_l2', parent: 'hair_l1', pos: W([0.15, 1.66, -0.1]) },
    { name: 'hair_r1', parent: 'head', pos: W([-0.07, 1.55, 0.0]) },
    { name: 'hair_r2', parent: 'hair_r1', pos: W([-0.15, 1.66, -0.1]) },
    { name: 'sflame_l', parent: 'chest', pos: W([0.2, 1.36, -0.02]) },
    { name: 'sflame_r', parent: 'chest', pos: W([-0.2, 1.36, -0.02]) },
    { name: 'wisp_l', parent: 'pelvis', pos: W([0.12, 0.92, -0.03]) },
    { name: 'wisp_r', parent: 'pelvis', pos: W([-0.12, 0.92, -0.03]) },
    { name: 'ember_a', parent: 'root', pos: W([0, 0.9, 0]) },
    { name: 'ember_b', parent: 'root', pos: W([0, 0.9, 0]) },
  ];
  const tp = a.tail;
  bones.push(
    { name: 'tail1', parent: 'pelvis', pos: W(tp[0]!) },
    { name: 'tail2', parent: 'tail1', pos: W(tp[1]!) },
    { name: 'tail3', parent: 'tail2', pos: W(tp[2]!) },
    { name: 'tail4', parent: 'tail3', pos: W(tp[3]!) },
    { name: 'tail5', parent: 'tail4', pos: W(tp[4]!) },
  );
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

export function fireBody(a: FireAnatomy, seed: number): Body {
  const s = a.s;
  const body = new Body();
  body.blend = 0.02 * s;
  const rng = new Rng(seed);
  const V = (v: Vec3): Vec3 => vscale(v, s);
  const R = (r: number): number => r * s;
  const sides: [string, number][] = [['l', 1], ['r', -1]];
  let n = 0;

  /**
   * A flame tongue: curved flat teardrop from `base` to `tip` (design space). `bend` offsets the middle sideways; `facing` is
   * the broad-face normal. Three flatCone segments; paint marks at the root and tip drive the heat gradient.
   */
  const flame = (base: Vec3, tip: Vec3, width: number, bend: Vec3, facing: Vec3, bone: string, tags: string[] = [], thick = 0.36): void => {
    // cubic S-curve: the lower half bows one way, the upper half whips the other (licking, not straight blades)
    const c1 = vadd(vlerp(base, tip, 0.33), vscale(bend, 1.5));
    const c2 = vadd(vlerp(base, tip, 0.66), vscale(bend, -0.9));
    const pt = (t: number): Vec3 => {
      const u = 1 - t;
      const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
      return [k0 * base[0] + k1 * c1[0] + k2 * c2[0] + k3 * tip[0], k0 * base[1] + k1 * c1[1] + k2 * c2[1] + k3 * tip[1], k0 * base[2] + k1 * c1[2] + k2 * c2[2] + k3 * tip[2]];
    };
    const rad = [0.6 * width, width, 0.72 * width, 0.34 * width, 0.04 * width];
    const id = n++;
    for (let i = 0; i < 4; i++) {
      const a0 = pt(i / 4), b0 = pt((i + 1) / 4);
      body.add(`flame_${id}_${i}`, flatCone(V(a0), V(b0), R(rad[i]!), R(Math.max(rad[i + 1]!, 0.004)), thick, vnorm(facing)), { bone, w: R(0.012), tags: ['flame', ...tags] });
    }
    body.mark(`froot_${id}`, new Sphere(V(base), R(0.045)), ['froot']);
    body.mark(`ftip_${id}`, new Sphere(V(tip), R(0.05)), ['ftip']);
  };

  // ---------------------------------------------------------------- head: a narrow lava-skinned face (brow, nose, cheekbones, chin, swept ears) with slit ember eyes
  const hd = V(a.head);
  body.add('skull', new Ellipsoid(hd, [R(0.078), R(0.092), R(0.09)], qeuler(0.1, 0, 0)), { bone: 'head', w: R(0.03), tags: ['head', 'face'], grip: 2.5 });
  body.add('cheeks', new Ellipsoid(V([0, 1.43, 0.09]), [R(0.058), R(0.052), R(0.058)]), { bone: 'head', w: R(0.03), tags: ['head', 'face'], grip: 2.5 });
  body.add('jaw', new RoundCone(V([0, 1.425, 0.06]), V([0, 1.372, 0.138]), R(0.04), R(0.02)), { bone: 'jaw', w: R(0.015), tags: ['head', 'jaw', 'face'], grip: 3 });
  body.add('nose', new RoundCone(V([0, 1.49, 0.14]), V([0, 1.447, 0.19]), R(0.013), R(0.008)), { bone: 'head', w: R(0.01), tags: ['head', 'face'], grip: 3 });
  for (const [sd, sx] of sides) {
    body.add(`brow_${sd}`, new Ellipsoid(V([0.038 * sx, 1.508, 0.132]), [R(0.04), R(0.013), R(0.03)], qeuler(0.15, 0, sx * 0.32)), { bone: 'head', w: R(0.012), tags: ['head', 'face', 'brow'], grip: 3 });
    body.add(`cheekbone_${sd}`, new Ellipsoid(V([0.058 * sx, 1.46, 0.118]), [R(0.02), R(0.014), R(0.022)], qeuler(0, 0, 0.4 * sx)), { bone: 'head', w: R(0.01), tags: ['head', 'face'], grip: 2.5 });
    body.add(`ear_${sd}`, new RoundCone(V([0.074 * sx, 1.485, 0.06]), V([0.2 * sx, 1.55, -0.015]), R(0.02), R(0.004)), { bone: 'head', w: R(0.008), tags: ['head', 'ear'], grip: 3 });
    body.cut(`socket_${sd}`, new Ellipsoid(V([0.036 * sx, 1.487, 0.158]), [R(0.022), R(0.009), R(0.02)], qeuler(0.1, sx * -0.3, sx * -0.5)), { bone: 'head', w: R(0.005), tags: ['socket'] });
    body.addLate(`ember_eye_${sd}`, new Ellipsoid(V([0.036 * sx, 1.487, 0.148]), [R(0.017), R(0.0065), R(0.01)], qeuler(0.1, 0, -0.5 * sx)), { bone: 'head', w: R(0.002), tags: ['glint'], grip: 3 });
  }
  body.cut('mouth', new Ellipsoid(V([0, 1.4, 0.158]), [R(0.017), R(0.005), R(0.03)], qeuler(-0.1, 0, 0)), { bone: 'jaw', w: R(0.004), tags: ['mouth'] });
  body.mark('glyph', new Sphere(V([0, 1.538, 0.122]), R(0.018)), ['glyph']);

  // ---------------------------------------------------------------- neck, torso (ribcage, bust, narrow waist, hips), thighs fused into a tapering flame tail
  body.add('neck', new RoundCone(V([0, 1.33, 0.03]), V([0, 1.43, 0.06]), R(0.04), R(0.034)), { bone: 'neck', w: R(0.025), tags: ['torso'] });
  body.add('collar', new Ellipsoid(V([0, 1.31, -0.005]), [R(0.15), R(0.034), R(0.07)]), { bone: 'chest', w: R(0.03), tags: ['torso'] });
  body.add('ribs', new Ellipsoid(V([0, 1.215, 0.012]), [R(0.122), R(0.13), R(0.088)], qeuler(0.06, 0, 0)), { bone: 'chest', w: R(0.04), tags: ['torso'] });
  for (const [sd, sx] of sides) {
    body.add(`pec_${sd}`, new Ellipsoid(V([0.056 * sx, 1.245, 0.072]), [R(0.06), R(0.045), R(0.05)], qeuler(0.2, 0, sx * -0.15)), { bone: 'chest', w: R(0.02), tags: ['torso', 'pec'], grip: 2 });
    body.add(`clavicle_${sd}`, new RoundCone(V([0.02 * sx, 1.305, 0.05]), V([0.16 * sx, 1.312, 0.015]), R(0.014), R(0.012)), { bone: 'chest', w: R(0.01), tags: ['torso'], grip: 3 });
  }
  body.add('waist', new RoundCone(V([0, 1.13, 0.0]), V([0, 0.99, 0.0]), R(0.086), R(0.066)), { bone: 'spine', w: R(0.04), tags: ['torso'] });
  body.add('hips', new Ellipsoid(V([0, 0.93, 0.0]), [R(0.115), R(0.07), R(0.085)]), { bone: 'pelvis', w: R(0.03), tags: ['torso'] });
  // abdominal plates and iliac crests: defined torso planes (small blend keeps the creases)
  for (const [sd, sx] of sides) {
    for (let k = 0; k < 3; k++) {
      body.add(`abs_${sd}${k}`, new Ellipsoid(V([0.027 * sx, 1.12 - 0.043 * k, 0.073 - 0.004 * k]), [R(0.027 - 0.002 * k), R(0.019), R(0.022)]), { bone: 'spine', w: R(0.008), tags: ['torso', 'abs'], grip: 2.5 });
    }
    body.add(`iliac_${sd}`, new RoundCone(V([0.085 * sx, 1.0, 0.045]), V([0.03 * sx, 0.93, 0.082]), R(0.016), R(0.012)), { bone: 'pelvis', w: R(0.008), tags: ['torso', 'abs'], grip: 2.5 });
  }
  for (const [sd, sx] of sides) {
    body.add(`thigh_${sd}`, new RoundCone(V([0.055 * sx, 0.92, 0.01]), V([0.028 * sx, 0.64, 0.035]), R(0.075), R(0.055)), { bone: 'tail1', w: R(0.03), tags: ['tail', 'torso', 'leg'] });
  }
  for (const [sd, sx] of sides) {
    const j = a[sd === 'l' ? 'l' : 'r'];
    body.add(`shoulder_${sd}`, new Sphere(V(j.sh), R(0.054)), { bone: `arm_${sd}`, w: R(0.025), tags: ['arm'] });
    body.add(`upper_${sd}`, new RoundCone(V(j.sh), V(j.el), R(0.046), R(0.034)), { bone: `arm_${sd}`, w: R(0.02), tags: ['arm'] });
    body.add(`biceps_${sd}`, new Ellipsoid(V(vlerp(j.sh, j.el, 0.4)), [R(0.043), R(0.043), R(0.075)], qeuler(0, 0, 0)), { bone: `arm_${sd}`, w: R(0.02), tags: ['arm'] });
    body.add(`elbow_${sd}`, new Sphere(V(j.el), R(0.034)), { bone: `forearm_${sd}`, w: R(0.015), tags: ['arm'] });
    const fm = vlerp(j.el, j.wr, 0.42);
    body.add(`fore_${sd}`, new RoundCone(V(j.el), V(fm), R(0.043), R(0.031)), { bone: `forearm_${sd}`, w: R(0.015), tags: ['arm'] });
    body.add(`fore2_${sd}`, new RoundCone(V(fm), V(j.wr), R(0.031), R(0.02)), { bone: `forearm_${sd}`, w: R(0.015), tags: ['arm'] });
    body.add(`bracer_${sd}`, new RoundCone(V(vlerp(j.el, j.wr, 0.88)), V(vadd(j.wr, vscale(vnorm(vsub(j.wr, j.el)), 0.012))), R(0.027), R(0.026)), { bone: `forearm_${sd}`, w: R(0.006), tags: ['arm', 'bracer'], grip: 3 });
    // hand: flat palm, four taper-curled claw fingers (two segments each) and a thumb
    const fd = vnorm(vsub(j.wr, j.el));
    const sdv = vnorm(vcross(fd, [0, 1, 0]));
    const pn = vnorm(vcross(sdv, fd));
    const palmEnd = vadd(j.wr, vscale(fd, 0.095));
    body.add(`palm_${sd}`, flatCone(V(j.wr), V(palmEnd), R(0.034), R(0.04), 0.45, pn), { bone: `hand_${sd}`, w: R(0.012), tags: ['arm', 'hand'], grip: 2 });
    for (let k = 0; k < 4; k++) {
      const kk = k - 1.5;
      const base = vadd(palmEnd, vscale(sdv, kk * 0.025));
      const d0 = vnorm(vadd(vadd(fd, vscale(sdv, kk * 0.22)), vscale(pn, -0.1)));
      const p1 = vadd(base, vscale(d0, 0.052 - 0.004 * Math.abs(kk)));
      const d1 = vnorm(vadd(d0, vscale(pn, -0.6)));
      const p2 = vadd(p1, vscale(d1, 0.047 - 0.004 * Math.abs(kk)));
      body.add(`fing_${sd}${k}a`, new RoundCone(V(base), V(p1), R(0.0125), R(0.01)), { bone: `hand_${sd}`, w: R(0.004), tags: ['arm', 'hand', 'finger'], grip: 3 });
      body.add(`fing_${sd}${k}b`, new RoundCone(V(p1), V(p2), R(0.01), R(0.0035)), { bone: `hand_${sd}`, w: R(0.003), tags: ['arm', 'hand', 'finger'], grip: 3 });
    }
    const tb = vadd(j.wr, vadd(vscale(fd, 0.04), vscale(sdv, 0.032 * sx)));
    const t1 = vadd(tb, vadd(vscale(fd, 0.04), vscale(sdv, 0.04 * sx)));
    const t2 = vadd(t1, vadd(vscale(fd, 0.036), vscale(pn, -0.02)));
    body.add(`thumb_${sd}a`, new RoundCone(V(tb), V(t1), R(0.0145), R(0.011)), { bone: `hand_${sd}`, w: R(0.004), tags: ['arm', 'hand', 'finger'], grip: 3 });
    body.add(`thumb_${sd}b`, new RoundCone(V(t1), V(t2), R(0.011), R(0.0045)), { bone: `hand_${sd}`, w: R(0.003), tags: ['arm', 'hand', 'finger'], grip: 3 });
    // one long forearm ribbon streaming back from the wrist, one shoulder tongue
    const fb = vlerp(j.el, j.wr, 0.55);
    flame(fb, vadd(fb, [0.1 * sx, -0.22, -0.42]), 0.07, [0.03 * sx, 0.12, -0.02], [sx, 0.15, 0], `forearm_${sd}`, ['cuff'], 0.4);
  }

  // ---------------------------------------------------------------- flame crown (hair): a swept-back mane
  flame([0, 1.54, 0.0], [0, 1.95, -0.2], 0.075, [0, 0.0, -0.08], [1, 0, 0], 'hair_c2', ['hair']);
  flame([0, 1.53, 0.03], [0, 1.76, 0.1], 0.045, [0, 0.02, 0.07], [1, 0, 0], 'hair_c1', ['hair']);
  for (const [sd, sx] of sides) {
    const bl = `hair_${sd}2`;
    flame([0.05 * sx, 1.54, -0.02], [0.22 * sx, 1.86, -0.24], 0.065, [0.06 * sx, 0.0, -0.06], [0.3, 0, 1], bl, ['hair']);
    flame([0.08 * sx, 1.5, -0.04], [0.3 * sx, 1.6, -0.4], 0.056, [0.07 * sx, 0.05, -0.1], [0, 1, 0.2], bl, ['hair']);
  }

  // ---------------------------------------------------------------- tail: thighs fuse to the knee, then split into S-curved flame ribbons
  const tp = a.tail.slice(0, 3).map((p) => V(p));
  const segs = tubeSegments(tp, [[0, R(0.1)], [0.5, R(0.076)], [1, R(0.052)]], { segments: 8 });
  segs.forEach((sg, i) => {
    const bone = sg.t0 < 0.5 ? 'tail1' : 'tail2';
    body.add(`tail_${i}`, sg.sdf, { bone, w: R(0.03), tags: ['tail', 'torso'] });
  });
  flame([0, 0.56, 0.0], [0.02, 0.06, 0.2], 0.11, [0.12, 0, 0], [0, 0, 1], 'tail4', ['tailflame'], 0.5);
  flame([0.035, 0.58, 0.02], [0.24, 0.2, -0.12], 0.085, [0, 0, -0.1], [0.7, 0, 0.7], 'tail3', ['tailflame'], 0.5);
  flame([-0.035, 0.58, 0.02], [-0.22, 0.14, -0.14], 0.085, [0, 0, -0.1], [0.7, 0, -0.7], 'tail3', ['tailflame'], 0.5);
  flame([0, 0.6, -0.05], [0.0, 0.18, -0.34], 0.075, [0.08, 0, 0], [0, 0, 1], 'tail5', ['tailflame'], 0.5);
  // flame skirt: eight tongues of different length fanning from the hips (long at the sides/back, short in front), alternating drooping and rising
  const skirt: [number, number, number, number][] = [ // angle (0 = +z front), pitch deg, length, width
    [1.5, -15, 0.34, 0.07],
    [2.4, 35, 0.36, 0.07],
    [3.14, -10, 0.4, 0.075],
    [-2.4, 35, 0.36, 0.07],
    [-1.5, -15, 0.34, 0.07],
  ];
  skirt.forEach(([ang, pitchDeg, len, w], i) => {
    const rad: Vec3 = [Math.sin(ang), 0, Math.cos(ang)];
    const ph = (pitchDeg * Math.PI) / 180;
    const base = vadd([0, 0.92, 0], [rad[0] * 0.1, 0, rad[2] * 0.09]);
    const dir = vnorm([rad[0] * Math.cos(ph), Math.sin(ph), rad[2] * Math.cos(ph)]);
    const tip = vadd(base, vscale(dir, len));
    const bone = Math.sin(ang) > 0.4 ? 'wisp_l' : Math.sin(ang) < -0.4 ? 'wisp_r' : 'tail1';
    flame(base, tip, w, vscale([rad[2], 0.1, -rad[0]], 0.1 * (i % 2 ? 1 : -1)), vnorm(rad), bone, ['wisp'], 0.4);
  });

  // ---------------------------------------------------------------- embers: faceted cinders drifting around the body
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * Math.PI * 2 + 0.5;
    const rad = 0.5 + 0.1 * rng.next();
    const y = 0.5 + 0.2 * i + 0.1 * rng.next();
    const c: Vec3 = [Math.sin(th) * rad, y, Math.cos(th) * rad];
    const d = vnorm([rng.range(-0.5, 0.5), 1, rng.range(-0.5, 0.5)]);
    const L = 0.1 + 0.05 * rng.next();
    body.add(`ember_${i}`, crystal(V(vsub(c, vscale(d, L * 0.5))), V(vadd(c, vscale(d, L * 0.5))), R(0.03), { sides: 4, shoulder: 0.5, base: 'point', baseShoulder: 0.5, twist: i, edge: 0.003 * s }), { bone: i % 2 === 0 ? 'ember_a' : 'ember_b', w: R(0.003), tags: ['ember'], grip: 3 });
  }

  return body;
}
