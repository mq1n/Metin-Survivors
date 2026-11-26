
// sockets, glowing pinpoint eyes and a gaping toothy jaw, a paper talisman hanging from the hood, a torn-open chest showing ribs
// and spine knobs, skeletal arms with long clawed fingers (one reaching, one dragging), and a shroud that disintegrates into
// ragged cloth strips instead of legs. No legs: it floats / shambles on its own mist.
import { type Vec3, qeuler, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { fbmField, maskedField, ridgedField } from '../../core/sdf/fields.ts';
import { Body } from '../../core/sdf/body.ts';
import { Noise } from '../../core/noise.ts';
import { SmoothSubtract, SmoothUnion } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tubeSegments } from '../../core/sdf/shapes.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';

export interface CorpseAnatomy {
  s: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  jaw: Vec3;
  l: { sh: Vec3; el: Vec3; wr: Vec3; fi: Vec3 };
  r: { sh: Vec3; el: Vec3; wr: Vec3; fi: Vec3 };
  /** hem strip bone groups: name -> [x, z] direction on the ring */
  strips: { name: string; dir: [number, number] }[];
}

export function corpseAnatomy(s: number): CorpseAnatomy {
  return {
    s,
    pelvis: [0, 0.74, -0.04],
    spine: [0, 0.88, 0.0],
    chest: [0, 1.0, 0.07],
    neck: [0, 1.12, 0.2],
    head: [0, 1.2, 0.31],
    jaw: [0, 1.15, 0.31],
    // left arm reaches up and forward, right arm hangs low and drags
    l: { sh: [0.2, 1.08, 0.1], el: [0.33, 0.9, 0.3], wr: [0.26, 1.02, 0.56], fi: [0.26, 1.0, 0.63] },
    r: { sh: [-0.2, 1.08, 0.1], el: [-0.32, 0.82, 0.14], wr: [-0.27, 0.55, 0.32], fi: [-0.27, 0.5, 0.37] },
    strips: [
      { name: 'f', dir: [0, 1] },
      { name: 'b', dir: [0, -1] },
      { name: 'l', dir: [1, 0] },
      { name: 'r', dir: [-1, 0] },
    ],
  };
}

export const CORPSE_SOCKETS = { head: 'head', muzzle: 'jaw', chest: 'chest', back: 'spine', hand_l: 'hand_l', hand_r: 'hand_r' } as const;

export function corpseSkeleton(a: CorpseAnatomy): Skeleton {
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
    { name: 'tali', parent: 'head', pos: W([0, 1.32, 0.41]) },
    { name: 'hood_tail', parent: 'neck', pos: W([0, 1.2, 0.17]) },
  ];
  for (const side of ['l', 'r'] as const) {
    const j = a[side];
    bones.push(
      { name: `arm_${side}`, parent: 'chest', pos: W(j.sh) },
      { name: `forearm_${side}`, parent: `arm_${side}`, pos: W(j.el) },
      { name: `hand_${side}`, parent: `forearm_${side}`, pos: W(j.wr) },
      { name: `finger_${side}`, parent: `hand_${side}`, pos: W(j.fi) },
      { name: `sleeve_${side}`, parent: `forearm_${side}`, pos: W(vlerp(j.el, j.wr, 0.3)) },
    );
  }
  for (const st of a.strips) {
    const x = st.dir[0] * 0.1, z = st.dir[1] * 0.1 + a.pelvis[2];
    bones.push(
      { name: `strip_${st.name}1`, parent: 'pelvis', pos: W([x, 0.66, z]) },
      { name: `strip_${st.name}2`, parent: `strip_${st.name}1`, pos: W([x * 1.6, 0.46, z + st.dir[1] * 0.04]) },
    );
  }
  return new Skeleton(bones);
}

export function corpseBody(a: CorpseAnatomy, seed: number): Body {
  const s = a.s;
  const body = new Body();
  body.blend = 0.016 * s;
  const rng = new Rng(seed);
  const noise = new Noise(seed);
  const V = (v: Vec3): Vec3 => vscale(v, s);
  const R = (r: number): number => r * s;
  const sides: [string, number][] = [['l', 1], ['r', -1]];
  let n = 0;
  const ell = (c: Vec3, r: Vec3, rot: [number, number, number] = [0, 0, 0]): Ellipsoid => new Ellipsoid(V(c), [R(r[0]), R(r[1]), R(r[2])], qeuler(rot[0], rot[1], rot[2]));

  /** ragged cloth strip: 3 flatCone pieces; the upper piece follows b1, the rest b2 */
  const cloth = (base: Vec3, tip: Vec3, width: number, bend: Vec3, facing: Vec3, b1: string, b2: string, tags: string[], thick = 0.26): void => {
    const mid = vadd(vlerp(base, tip, 0.5), bend);
    const pt = (t: number): Vec3 => {
      const u = 1 - t;
      return [u * u * base[0] + 2 * u * t * mid[0] + t * t * tip[0], u * u * base[1] + 2 * u * t * mid[1] + t * t * tip[1], u * u * base[2] + 2 * u * t * mid[2] + t * t * tip[2]];
    };
    const rad = [width, width * 0.95, width * 0.78, width * 0.2];
    const id = n++;
    for (let i = 0; i < 3; i++) {
      body.add(`cloth_${id}_${i}`, flatCone(V(pt(i / 3)), V(pt((i + 1) / 3)), R(rad[i]!), R(Math.max(rad[i + 1]!, 0.005)), thick, vnorm(facing)), { bone: i === 0 ? b1 : b2, w: R(0.01), tags: ['cloth', ...tags] });
    }
    body.mark(`ctip_${id}`, new Sphere(V(tip), R(0.05)), ['ctip']);
  };

  // ---------------------------------------------------------------- torso: emaciated ribcage under a torn shroud
  const chestC = a.chest;
  const alpha = 0.5;
  const U: Vec3 = [0, Math.cos(alpha), Math.sin(alpha)];
  const F: Vec3 = [0, -Math.sin(alpha), Math.cos(alpha)];
  body.add('thorax', ell(vadd(chestC, [0, 0, 0.0]), [0.13, 0.17, 0.115], [alpha, 0, 0]), { bone: 'chest', w: R(0.03), tags: ['torso', 'bone'] });
  body.add('belly', ell([0, 0.8, 0.0], [0.1, 0.12, 0.09], [0.3, 0, 0]), { bone: 'spine', w: R(0.03), tags: ['torso', 'bone'] });
  // ribs: curved bones wrapping the thorax (front panel is torn open so they show)
  for (let i = 0; i < 5; i++) {
    const t = -0.1 + i * 0.052;
    const c = vadd(chestC, vscale(U, t));
    const sc = 1 - 0.18 * Math.abs(t / 0.12);
    for (const [sd, sx] of sides) {
      const pts: Vec3[] = [
        [0.03 * sx, -0.09],
        [0.125 * sx * sc, -0.03],
        [0.108 * sx * sc, 0.06],
        [0.012 * sx, 0.112 * sc],
      ].map(([x, f]) => vadd(vadd(c, [x!, 0, 0]), vscale(F, f!)));
      const segs = tubeSegments(pts.map(V), [[0, R(0.013)], [0.5, R(0.015)], [1, R(0.011)]], { segments: 5 });
      segs.forEach((sg, k) => body.add(`rib_${i}${sd}${k}`, sg.sdf, { bone: 'chest', w: R(0.006), tags: ['bone', 'rib'] }));
    }
  }
  // sternum
  body.add('sternum', new RoundCone(V(vadd(chestC, [0, 0.1 * Math.cos(alpha) + 0.06 * Math.sin(alpha) * 0, 0.1])), V(vadd(chestC, [0, -0.1, 0.13])), R(0.016), R(0.012)), { bone: 'chest', w: R(0.008), tags: ['bone'] });
  // spine knobs along the back (pierce the shroud)
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const p: Vec3 = [0, 0.78 + 0.34 * t, -0.11 + 0.17 * t + (t > 0.7 ? 0.07 * (t - 0.7) / 0.3 : 0)];
    body.add(`vert_${i}`, new Sphere(V([p[0], p[1], p[2] - 0.045 - 0.015 * Math.sin(t * Math.PI)]), R(0.026 - 0.004 * t)), { bone: i < 3 ? 'spine' : 'chest', w: R(0.012), tags: ['bone', 'vert'] });
  }
  // shroud: draped mass over the back, shoulders and belly; the front is left open over the sternum
  body.add('shroud_back', ell([0, 0.96, -0.04], [0.19, 0.3, 0.1], [alpha - 0.05, 0, 0]), { bone: 'chest', w: R(0.03), tags: ['cloth', 'shroudbody'] });
  for (const [sd, sx] of sides) {
    body.add(`shroud_shoulder_${sd}`, ell([0.19 * sx, 1.1, 0.07], [0.1, 0.065, 0.1], [0.2, 0, -0.35 * sx]), { bone: 'chest', w: R(0.03), tags: ['cloth', 'shroudbody'] });
    body.add(`shroud_front_${sd}`, ell([0.12 * sx, 0.9, 0.15], [0.065, 0.2, 0.05], [0.35, 0, 0.12 * sx]), { bone: 'chest', w: R(0.02), tags: ['cloth', 'shroudbody'] });
    body.add(`shroud_flank_${sd}`, ell([0.14 * sx, 0.85, 0.04], [0.06, 0.2, 0.1], [0.2, 0, 0]), { bone: 'spine', w: R(0.03), tags: ['cloth', 'shroudbody'] });
    // layered drape panels hanging from the shoulders either side of the torn chest
    cloth([0.12 * sx, 1.1, 0.15], [0.19 * sx, 0.66, 0.24], 0.085, [0.04 * sx, 0, 0.05], [sx * 0.3, 0.2, 1], 'chest', 'spine', ['panel'], 0.3);
    cloth([0.2 * sx, 1.08, 0.1], [0.3 * sx, 0.7, 0.14], 0.07, [0.05 * sx, 0, 0.03], [sx, 0.1, 0.4], 'chest', 'spine', ['panel'], 0.3);
  }
  body.add('shroud_hip', ell([0, 0.72, -0.03], [0.15, 0.12, 0.13]), { bone: 'pelvis', w: R(0.03), tags: ['cloth', 'shroudbody'] });
  // solid tapered skirt core so the ragged hem reads as a garment, not loose shards
  body.add('skirt_core', new RoundCone(V([0, 0.7, -0.03]), V([0, 0.4, -0.12]), R(0.145), R(0.05)), { bone: 'strip_b1', w: R(0.04), tags: ['cloth', 'shroudbody'] });
  body.add('skirt_core_f', new RoundCone(V([0, 0.7, 0.04]), V([0, 0.48, 0.08]), R(0.11), R(0.045)), { bone: 'strip_f1', w: R(0.04), tags: ['cloth', 'shroudbody'] });
  body.add('sash', new Torus(V([0, 0.77, 0.0]), R(0.125), R(0.014), vnorm([0, 1, 0.3])), { bone: 'spine', w: R(0.01), tags: ['cloth', 'sash'] });
  body.add('sash_knot', ell([0.04, 0.76, 0.12], [0.03, 0.025, 0.025]), { bone: 'spine', w: R(0.01), tags: ['cloth', 'sash'] });
  // torn chest opening: reveals ribs + sternum
  body.cut('chest_tear', ell(vadd(chestC, [0, 0.01, 0.16]), [0.08, 0.17, 0.09], [alpha, 0, 0]), { bone: 'chest', w: R(0.012), tags: ['tear'] });

  // ---------------------------------------------------------------- neck + hood + head
  body.add('neck', new RoundCone(V([0, 1.06, 0.1]), V([0, 1.16, 0.27]), R(0.036), R(0.03)), { bone: 'neck', w: R(0.02), tags: ['bone', 'neck'] });
  body.add('hood', ell([0, 1.235, 0.275], [0.108, 0.125, 0.145], [0.3, 0, 0]), { bone: 'head', w: R(0.03), tags: ['cloth', 'hood'], grip: 2 });
  body.add('hood_collar', ell([0, 1.13, 0.2], [0.105, 0.075, 0.115], [0.2, 0, 0]), { bone: 'neck', w: R(0.03), tags: ['cloth', 'hood'] });
  body.add('hood_peak', new RoundCone(V([0, 1.31, 0.21]), V([0, 1.46, 0.07]), R(0.055), R(0.01)), { bone: 'head', w: R(0.03), tags: ['cloth', 'hood'], grip: 2 });
  body.cut('hood_opening', ell([0, 1.2, 0.395], [0.074, 0.098, 0.1], [0.3, 0, 0]), { bone: 'head', w: R(0.012), tags: ['hoodinner'] });
  // long cloth drape down the back from the hood
  cloth([0, 1.18, 0.13], [0, 0.72, -0.17], 0.075, [0, 0.0, -0.1], [1, 0, 0], 'hood_tail', 'hood_tail', ['hoodtail'], 0.22);

  // face: skull + brow + cheek hollows + sockets, built as ONE sdf so the opening cut of the hood never touches it
  const skullParts = [
    { node: ell([0, 1.205, 0.325], [0.072, 0.088, 0.085], [0.3, 0, 0]), w: R(0.02) },
    { node: ell([0, 1.15, 0.36], [0.058, 0.05, 0.05], [0.3, 0, 0]), w: R(0.02) },
    { node: ell([0, 1.245, 0.378], [0.068, 0.017, 0.03], [0.3, 0, 0]), w: R(0.015) },
    ...sides.map(([, sx]) => ({ node: ell([0.052 * sx, 1.175, 0.368], [0.016, 0.02, 0.02], [0, 0, 0.4 * sx]), w: R(0.012) })),
  ];
  const cuts = [
    ...sides.map(([, sx]) => ({ node: ell([0.032 * sx, 1.212, 0.382], [0.024, 0.021, 0.026], [0.1, 0, -0.3 * sx]), w: R(0.008) })),
    ...sides.map(([, sx]) => ({ node: ell([0.056 * sx, 1.145, 0.352], [0.018, 0.028, 0.03], [0, 0, 0.2 * sx]), w: R(0.01) })),
    { node: ell([0, 1.178, 0.4], [0.009, 0.019, 0.016]), w: R(0.004) },
  ];
  body.addLate('face', new SmoothSubtract(new SmoothUnion(skullParts), cuts), { bone: 'head', w: R(0.012), tags: ['face', 'bone'], grip: 3 });
  for (const [sd, sx] of sides) {
    body.mark(`socket_${sd}`, ell([0.032 * sx, 1.212, 0.382], [0.027, 0.024, 0.03], [0.1, 0, -0.3 * sx]), ['socket']);
    body.addLate(`eye_${sd}`, new Sphere(V([0.031 * sx, 1.21, 0.368]), R(0.0105)), { bone: 'head', w: R(0.002), tags: ['eye'], grip: 3 });
  }
  body.mark('nose', ell([0, 1.178, 0.4], [0.012, 0.022, 0.02]), ['socket']);
  // teeth: upper row on the skull, lower row on the jaw
  for (let i = 0; i < 7; i++) {
    const k = (i - 3) / 3;
    const x = 0.034 * k, z = 0.372 - 0.012 * k * k + 0.02 * (1 - Math.abs(k));
    const len = 0.02 - 0.006 * Math.abs(k) + 0.004 * rng.next();
    body.addLate(`tooth_u${i}`, new RoundCone(V([x, 1.147, z - 0.01]), V([x * 1.05, 1.147 - len, z]), R(0.006), R(0.0015)), { bone: 'head', w: R(0.002), tags: ['tooth'], grip: 3 });
  }
  // jaw (rest pose hangs open ~20 deg)
  const jawOpen = 0.025;
  for (const [sd, sx] of sides) {
    body.addLate(`jaw_${sd}`, new RoundCone(V([0.05 * sx, 1.15 - jawOpen * 0.2, 0.31]), V([0.026 * sx, 1.115 - jawOpen, 0.388]), R(0.012), R(0.01)), { bone: 'jaw', w: R(0.008), tags: ['bone', 'jaw'], grip: 3 });
  }
  body.addLate('chin', ell([0, 1.108 - jawOpen, 0.393], [0.028, 0.013, 0.02]), { bone: 'jaw', w: R(0.008), tags: ['bone', 'jaw'], grip: 3 });
  for (let i = 0; i < 7; i++) {
    const k = (i - 3) / 3;
    const x = 0.03 * k, z = 0.385 - 0.012 * k * k + 0.01 * (1 - Math.abs(k));
    const len = 0.016 - 0.005 * Math.abs(k) + 0.004 * rng.next();
    body.addLate(`tooth_l${i}`, new RoundCone(V([x, 1.12 - jawOpen, z - 0.006]), V([x, 1.12 - jawOpen + len, z]), R(0.0055), R(0.0013)), { bone: 'jaw', w: R(0.002), tags: ['tooth'], grip: 3 });
  }
  // talisman: paper strip hanging from the hood brim (offset so it clears the eyes)
  body.add('tali', flatCone(V([0.0, 1.335, 0.405]), V([0.0, 1.2, 0.445]), R(0.026), R(0.02), 0.22, [0, 0.35, 1]), { bone: 'tali', w: R(0.005), tags: ['tali'], grip: 3 });

  // ---------------------------------------------------------------- arms: skeletal, long clawed fingers
  for (const [sd, sx] of sides) {
    const j = a[sd === 'l' ? 'l' : 'r'];
    body.add(`sh_${sd}`, new Sphere(V(j.sh), R(0.04)), { bone: `arm_${sd}`, w: R(0.02), tags: ['arm', 'bone'] });
    body.add(`upper_${sd}`, new RoundCone(V(j.sh), V(j.el), R(0.033), R(0.026)), { bone: `arm_${sd}`, w: R(0.015), tags: ['arm', 'bone'] });
    body.add(`elbow_${sd}`, new Sphere(V(j.el), R(0.03)), { bone: `forearm_${sd}`, w: R(0.015), tags: ['arm', 'bone', 'joint'] });
    {
      const ax = vnorm(vsub(j.wr, j.el));
      const side: Vec3 = vnorm([ax[2], 0, -ax[0]]);
      for (const k of [-1, 1]) {
        const off = vscale(side, 0.014 * k);
        body.add(`fore_${sd}${k}`, new RoundCone(V(vadd(j.el, off)), V(vadd(j.wr, off)), R(0.0165 - 0.001 * k), R(0.013)), { bone: `forearm_${sd}`, w: R(0.01), tags: ['arm', 'bone'] });
      }
      body.add(`fore_web_${sd}`, new RoundCone(V(vlerp(j.el, j.wr, 0.15)), V(vlerp(j.el, j.wr, 0.85)), R(0.016), R(0.013)), { bone: `forearm_${sd}`, w: R(0.01), tags: ['arm', 'bone'] });
    }
    body.add(`wrist_${sd}`, new Sphere(V(j.wr), R(0.024)), { bone: `hand_${sd}`, w: R(0.012), tags: ['arm', 'bone', 'joint'] });
    const fd = vnorm(vsub(j.fi, j.wr));
    const sdv = vnorm([fd[1] * 0 - fd[2] * 1, 0, fd[0] * 1 - 0]); // horizontal across the hand
    const palmC = vadd(j.wr, vscale(fd, 0.035));
    body.add(`palm_${sd}`, new Ellipsoid(V(palmC), [R(0.034), R(0.014), R(0.04)], qeuler(0, 0, 0)), { bone: `hand_${sd}`, w: R(0.012), tags: ['arm', 'bone', 'hand'], grip: 2 });
    // 4 long fingers + thumb; two curved segments each
    const lens: [number, number][] = [[0.055, 0.045], [0.065, 0.05], [0.06, 0.048], [0.05, 0.04]];
    lens.forEach(([l1, l2], k) => {
      const off = (k - 1.5) * 0.019;
      const b0 = vadd(vadd(palmC, vscale(fd, 0.03)), [off * sx * 0 + off, 0, 0]);
      const d1 = vnorm(vadd(fd, [off * 1.2, -0.12 - 0.04 * k, 0]));
      const m = vadd(b0, vscale(d1, l1));
      const d2 = vnorm(vadd(fd, [off * 0.8, -0.65, 0]));
      const t = vadd(m, vscale(d2, l2));
      body.add(`finger_${sd}${k}a`, new RoundCone(V(b0), V(m), R(0.0085), R(0.0075)), { bone: `finger_${sd}`, w: R(0.006), tags: ['bone', 'finger'], grip: 2 });
      body.add(`finger_${sd}${k}b`, new RoundCone(V(m), V(t), R(0.0075), R(0.0016)), { bone: `finger_${sd}`, w: R(0.004), tags: ['bone', 'finger', 'claw'], grip: 2 });
    });
    const tb = vadd(palmC, [0.03 * sx * 0 + (sd === 'l' ? -0.03 : 0.03), 0.0, 0.0]);
    const tt = vadd(tb, vnorm(vadd(fd, [sd === 'l' ? -0.9 : 0.9, -0.2, 0.0])));
    body.add(`thumb_${sd}`, new RoundCone(V(tb), V(vadd(tb, vscale(vnorm(vsub(tt, tb)), 0.05))), R(0.0085), R(0.002)), { bone: `finger_${sd}`, w: R(0.005), tags: ['bone', 'finger', 'claw'], grip: 2 });
    void sdv;
    // sleeve tatters hanging from the forearm
    for (let k = 0; k < 3; k++) {
      const t = 0.1 + 0.3 * k;
      const base = vlerp(j.el, j.wr, t);
      cloth(base, vadd(base, [0.03 * sx * (k - 1), -0.28 - 0.05 * k, -0.04]), 0.045 - 0.006 * k, [0.02 * sx, -0.03, -0.03], [0, 0, 1], `sleeve_${sd}`, `sleeve_${sd}`, ['sleeve'], 0.22);
    }
  }

  // ---------------------------------------------------------------- hem: ragged strips replace the legs
  for (let i = 0; i < 15; i++) {
    const th = (i / 15) * Math.PI * 2 + rng.range(-0.08, 0.08);
    const dir: [number, number] = [Math.sin(th), Math.cos(th)];
    let best = a.strips[0]!, bd = -9;
    for (const st of a.strips) {
      const d = st.dir[0] * dir[0] + st.dir[1] * dir[1];
      if (d > bd) { bd = d; best = st; }
    }
    const rr = 0.13 + 0.07 * rng.next();
    const base: Vec3 = [dir[0] * rr, 0.69, dir[1] * rr + a.pelvis[2]];
    const len = 0.34 + 0.34 * rng.next();
    const out = 0.1 + 0.18 * rng.next();
    const tip = vadd(base, [dir[0] * out, -len, dir[1] * out - 0.1 - 0.06 * rng.next()]);
    const tang: Vec3 = [dir[1], 0, -dir[0]];
    cloth(base, tip, 0.075 + 0.03 * rng.next(), vscale(tang, 0.05 * (i % 2 ? 1 : -1)), vnorm([dir[0], 0.0, dir[1]]), `strip_${best.name}1`, `strip_${best.name}2`, ['strip'], 0.4);
  }

  // surface breakup: vertical cloth folds on the shroud (masked to the lower body), subtle fbm lumpiness elsewhere
  const folds = ridgedField(noise, 10, { octaves: 2, stretch: [1, 0.2, 1] });
  const faceC: Vec3 = [0, 1.2 * s, 0.38 * s];
  body.displace(maskedField(folds, (x, y, z) => Math.min(1, Math.hypot(x - faceC[0], y - faceC[1], (z - faceC[2]) * 0.8) / (0.16 * s))), R(0.016));
  body.displace(fbmField(noise, 14, { octaves: 2 }), R(0.003));
  return body;
}
