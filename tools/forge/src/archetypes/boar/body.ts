// Boar SDF body: wedge torso (high heavy shoulders, deep barrel, lower rump), thick neck with nape hump, true boar head (wedge skull,
// disc snout, flews, tusks, small deep-set eyes, tapering ears), cloven hooves with dewclaws, a geometric bristle ridge and tail tassel.
// Each part knows its bone and paint tags.
import { type Quat, type Vec3, qeuler, qx, smoothstep, vadd, vcross, vlerp, vnorm, vscale } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { fbmField, maskedField, ridgedField, voronoiField } from '../../core/sdf/fields.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, HalfSpace, RoundCone, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone, tubeSegments } from '../../core/sdf/shapes.ts';
import type { Anatomy } from './anatomy.ts';

export function makeBody(a: Anatomy): Body {
  const p = a.p;
  const s = a.s;
  const hs = a.hs;
  const body = new Body();
  body.blend = 0.05 * s;
  const rng = new Rng(p.seed);
  const noise = new Noise(p.seed);
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  const R = (r: number): number => r * s;
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const sides: [string, number][] = [['l', 1], ['r', -1]];
  const mk = (sx: number, v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
  const ID: Quat = [0, 0, 0, 1];
  const ell = (c: Vec3, r: Vec3, q: Quat = ID): Ellipsoid => new Ellipsoid(c, r, q);
  const rcone = (c0: Vec3, c1: Vec3, r0: number, r1: number): RoundCone => new RoundCone(c0, c1, r0, r1);

  // ------------------------------------------------------------------ torso: stations + masses that make the wedge
  for (const st of a.stations) {
    body.add(`torso_${st.name}`, ell([0, st.y, st.z], [st.hw, st.hh, st.hl]), { bone: st.bone, w: R(0.08), tags: ['torso'] });
  }
  body.add('withers', ell(V(0, 0.672, 0.2), [R(0.12), R(0.1), R(0.17)], qeuler(-0.3, 0, 0)), { bone: 'chest', w: R(0.07), tags: ['torso'] });
  body.add('brisket', ell(V(0, 0.42, 0.3), [R(0.14), R(0.15), R(0.15)]), { bone: 'chest', w: R(0.07), tags: ['torso', 'chest'] });
  body.add('belly', ell(V(0, 0.4, -0.06), [R(0.172), R(0.075), R(0.25)]), { bone: 'spine', w: R(0.07), tags: ['torso', 'belly'] });
  for (const [sd, sx] of sides) {
    // heavy shoulder: scapula blade + thick-hided shield over the joint
    body.add(`scapula_${sd}`, ell(V(sx * 0.178, 0.605, 0.22), [R(0.068), R(0.16), R(0.13)], qeuler(-0.32, 0, sx * 0.12)), { bone: 'chest', w: R(0.06), tags: ['torso'] });
    body.add(`shield_${sd}`, ell(V(sx * 0.2, 0.5, 0.26), [R(0.075), R(0.14), R(0.12)], qeuler(-0.15, 0, sx * 0.08)), { bone: `arm_${sd}`, w: R(0.06), tags: ['torso', 'shield'] });
    // ham
    body.add(`haunch_${sd}`, ell(V(sx * 0.158, 0.47, -0.37), [R(0.088), R(0.15), R(0.15)], qeuler(0.18, 0, sx * -0.05)), { bone: `thigh_${sd}`, w: R(0.09), tags: ['torso', 'haunch'] });
  }

  // ------------------------------------------------------------------ neck: thick, with a nape hump and a dewlap
  const neckA = V(0, 0.58, 0.28);
  const neckB = V(0, 0.52, 0.5);
  body.add('neck', rcone(neckA, neckB, R(0.165), R(0.125)), { bone: 'neck', w: R(0.07), tags: ['neck'] });
  body.add('nape', ell(V(0, 0.665, 0.4), [R(0.1), R(0.085), R(0.15)], qeuler(-0.25, 0, 0)), { bone: 'neck', w: R(0.07), tags: ['neck', 'nape'] });
  body.add('dewlap', ell(V(0, 0.44, 0.46), [R(0.075), R(0.08), R(0.13)], qeuler(0.3, 0, 0)), { bone: 'neck', w: R(0.06), tags: ['neck', 'throat'] });

  // body surface probes (torso + neck only, taken before any bristle exists): where the back / flank skin really is
  const surf = body.sdf(true);
  const topAt = (z: number, x = 0): number => {
    for (let y = 0.95 * s; y > 0.3 * s; y -= 0.004 * s) if (surf.d(x, y, z) < 0) return y;
    return 0.5 * s;
  };

  // ------------------------------------------------------------------ head (modelled in head-local metres, then scaled by hs and placed)
  const headRot: Quat = qx(a.headPitch);
  const H = (sdf: Sdf): Sdf => new Xform(sdf, a.head, headRot, [hs, hs, hs]);
  const hc = Math.cos(a.headPitch), hsn = Math.sin(a.headPitch);
  const headToWorld = (v: Vec3): Vec3 => [a.head[0] + v[0] * hs, a.head[1] + (v[1] * hc - v[2] * hsn) * hs, a.head[2] + (v[1] * hsn + v[2] * hc) * hs];
  const headDir = (v: Vec3): Vec3 => [v[0], v[1] * hc - v[2] * hsn, v[1] * hsn + v[2] * hc];
  const squash = (c: Vec3, sdf: Sdf, sy: number): Sdf => new Xform(new Xform(sdf, vscale(c, -1)), c, ID, [1, sy, 1]);
  // the lower jaw (and its tusks) is modelled hung open: a permanent snarl; rotation about the jaw hinge in head-local space
  const hinge: Vec3 = [0, -0.07, 0.05];
  const jawRot = (sdf: Sdf): Sdf => new Xform(new Xform(sdf, vscale(hinge, -1)), hinge, qx(0.2));

  const headStart = body.parts.length;
  body.add('skull', H(ell([0, 0.015, -0.005], [0.105, 0.098, 0.125])), { bone: 'head', w: 0.03, tags: ['head', 'skull'], grip: 2 });
  body.add('crest', H(ell([0, 0.082, -0.035], [0.042, 0.032, 0.095])), { bone: 'head', w: 0.02, tags: ['head', 'skull'], grip: 2 });
  for (const [sd, sx] of sides) {
    // heavy brow ridge over a deep-set eye, slanted inward: the permanently angry boar frown
    body.add(`brow_${sd}`, H(ell([sx * 0.062, 0.07, 0.068], [0.04, 0.024, 0.058], qeuler(0, sx * -0.3, sx * 0.4))), { bone: 'head', w: 0.02, tags: ['head', 'brow'], grip: 2 });
    body.add(`cheek_${sd}`, H(ell([sx * 0.088, -0.03, 0.03], [0.05, 0.066, 0.095])), { bone: 'head', w: 0.02, tags: ['head', 'cheek'], grip: 2 });
    // thick upper lip (flew) hanging over the lower jaw
    body.add(`flew_${sd}`, H(ell([sx * 0.058, -0.048, 0.2], [0.036, 0.034, 0.088], qeuler(0.05, sx * -0.1, 0))), { bone: 'head', w: 0.014, tags: ['head', 'muzzle', 'flew'], grip: 2 });
  }
  // long wedge snout: stop at the brow, straight bridge to the nose
  body.add('snout', H(squash([0, -0.03, 0.17], rcone([0, 0.0, 0.07], [0, -0.034, 0.255], 0.088, 0.05), 0.84)), { bone: 'head', w: 0.03, tags: ['head', 'muzzle', 'snout'], grip: 2 });
  body.add('bridge', H(ell([0, 0.02, 0.165], [0.028, 0.022, 0.1], qeuler(-0.2, 0, 0))), { bone: 'head', w: 0.02, tags: ['head', 'muzzle', 'snout'], grip: 2 });
  // rhinarium: a crisp upright disc, wider and taller than the snout end it sits on, with a raised rim
  body.add('nose_rim', H(ell([0, -0.034, 0.29], [0.076, 0.063, 0.022], qeuler(0.12, 0, 0))), { bone: 'head', w: 0.005, tags: ['head', 'muzzle', 'nose_rim'], grip: 3 });
  body.add('nose', H(ell([0, -0.035, 0.308], [0.063, 0.05, 0.02], qeuler(0.12, 0, 0))), { bone: 'head', w: 0.004, tags: ['nose'], grip: 3 });
  // lower jaw: own bone so the mouth opens
  body.add('jaw', H(jawRot(squash([0, -0.072, 0.12], rcone([0, -0.07, 0.04], [0, -0.076, 0.185], 0.056, 0.04), 0.88))), { bone: 'jaw', w: 0.02, tags: ['jaw', 'muzzle'], grip: 2.5 });
  body.add('chin', H(jawRot(ell([0, -0.076, 0.2], [0.036, 0.026, 0.028]))), { bone: 'jaw', w: 0.012, tags: ['jaw', 'muzzle'], grip: 2.5 });
  body.addLate('tongue', H(jawRot(ell([0, -0.058, 0.15], [0.022, 0.009, 0.07]))), { bone: 'jaw', w: 0.004, tags: ['tongue'], grip: 3 });
  for (const [sd, sx] of sides) {
    body.cut(`nostril_${sd}`, H(ell([sx * 0.025, -0.041, 0.326], [0.0125, 0.016, 0.02], qeuler(0.12, 0, sx * -0.35))), { bone: 'head', w: 0.004, tags: ['nostril'] });
    // small deep-set eye: a defined socket framed by the brow, a round eyeball sitting proud of it
    const ec: Vec3 = [sx * 0.072, 0.044, 0.066];
    const eq = qeuler(0, sx * 0.5, sx * -0.4);
    body.cut(`eye_socket_${sd}`, H(ell(ec, [0.021, 0.016, 0.025], eq)), { bone: 'head', w: 0.008, tags: [] });
    body.addLate(`eye_${sd}`, H(ell([ec[0] - sx * 0.002, ec[1] - 0.001, ec[2] - 0.002], [0.0165, 0.0125, 0.0165], eq)), { bone: 'head', w: 0.003, tags: ['eye'], grip: 3 });
    body.mark(`pupil_${sd}`, H(new Sphere([ec[0] + sx * 0.0085, ec[1] + 0.001, ec[2] + 0.0095], 0.0062)), ['pupil']);
  }
  // tusks: big lower pair curving up and out of the lip corners, small upper pair behind them (tips never thinner than the mesh voxel)
  const tuskK = p.tusk;
  for (const [sd, sx] of sides) {
    // absolute head-local path (x = outward distance from the midline): out of the jaw corner, outside the snout wall (half width ~0.095 at z = 0.2), curling up and forward
    const lo = ([[0.055, -0.1, 0.12], [0.1, -0.112, 0.17], [0.138, -0.085, 0.205], [0.154, -0.03, 0.23], [0.148, 0.04, 0.255], [0.13, 0.1, 0.275]] as Vec3[]).map((r): Vec3 => [sx * r[0], -0.1 + (r[1] + 0.1) * tuskK, r[2]]);
    tubeSegments(lo, [[0, 0.034], [0.4, 0.028], [0.8, 0.017], [1, 0.0075]], { segments: 6 }).forEach((sg, i) =>
      body.addLate(`tusk_lo_${sd}${i}`, H(sg.sdf), { bone: 'jaw', w: 0.003, tags: ['tusk'], grip: 3 }),
    );
    const up = ([[0.066, -0.05, 0.2], [0.086, -0.04, 0.222], [0.098, -0.012, 0.234], [0.098, 0.034, 0.234]] as Vec3[]).map((r): Vec3 => [sx * r[0], r[1], r[2]]);
    tubeSegments(up, [[0, 0.015], [0.6, 0.0105], [1, 0.0055]], { segments: 3 }).forEach((sg, i) =>
      body.addLate(`tusk_up_${sd}${i}`, H(sg.sdf), { bone: 'head', w: 0.003, tags: ['tusk'], grip: 3 }),
    );
  }

  // ears: pointed, broad-based, erect and cocked outward; hairy inside
  for (const [sd, sx] of sides) {
    const eb: Vec3 = [sx * 0.078, 0.072, -0.042];
    const dir = vnorm([sx * 0.5, 0.8, -0.3]);
    const tip = vadd(eb, vscale(dir, 0.125));
    const facing = vnorm([sx * 0.55, 0.12, 0.82]);
    body.add(`ear_${sd}`, H(flatCone(eb, tip, 0.052, 0.014, 0.4, facing)), { bone: `ear_${sd}`, w: 0.02, tags: ['ear'], grip: 2 });
    const mid = vlerp(eb, tip, 0.45);
    body.cut(`ear_dish_${sd}`, H(ell(vadd(mid, vscale(facing, 0.024)), [0.024, 0.045, 0.016])), { bone: `ear_${sd}`, w: 0.012, tags: ['ear_inner'] });
  }
  // head blend widths above were authored in head-local metres
  for (const part of body.parts.slice(headStart)) part.w *= hs;

  // ------------------------------------------------------------------ bristles: a few chunky swept spikes (silhouette breakers that survive decimation)
  // blade(): a bristle tuft = two stubby cones (base -> bend -> tip, the upper half curling back/down); base inside the body (world, already scaled);
  // `roll` turns the flat face about the blade axis
  const blade = (name: string, base: Vec3, dir: Vec3, len: number, halfW: number, roll: number, bone: string, tags: string[], thick = 0.8, tipR = 0.011, curl = 0.45): void => {
    const f = vnorm(dir);
    const f2 = vnorm([f[0], f[1] - curl, f[2] - curl * 0.6]);
    const mid: Vec3 = [base[0] + f[0] * len * 0.5 * s, base[1] + f[1] * len * 0.5 * s, base[2] + f[2] * len * 0.5 * s];
    const tip: Vec3 = [mid[0] + f2[0] * len * 0.5 * s, mid[1] + f2[1] * len * 0.5 * s, mid[2] + f2[2] * len * 0.5 * s];
    const side: Vec3 = Math.abs(f[0]) > 0.85 ? [0, 0, 1] : [1, 0, 0];
    const perp = vnorm(vcross(f, side));
    const n = vnorm(vadd(vscale(side, Math.cos(roll)), vscale(perp, Math.sin(roll))));
    const opts = { bone, w: 0.012 * s, tags: ['bristle', ...tags] };
    body.add(name, flatCone(base, mid, halfW * s, halfW * 0.62 * s, thick, n), opts);
    body.add(`${name}_t`, flatCone(mid, tip, halfW * 0.62 * s, tipR * s, thick, n), opts);
  };
  const maneBone = (z: number): string => (z > 0.42 * s ? 'neck' : z > -0.1 * s ? 'mane_f' : 'mane_r');
  const profile = (z: number): number => Math.exp(-(((z / s - 0.15) / 0.45) ** 2));
  {
    // main crest: one row from the nape to the rump, tallest over the withers, leaning back
    const nMain = 15;
    for (let i = 0; i < nMain; i++) {
      const z = (0.46 - (0.98 * i) / (nMain - 1)) * s;
      const prof = profile(z);
      const len = (0.075 + 0.1 * prof) * p.mane * (0.9 + 0.2 * rng.next());
      const th = 0.45 + 0.5 * smoothstep(0.3, -0.5, z / s);
      const alt = i % 2 === 0 ? 1 : -1;
      blade(`ridge_${i}`, [alt * 0.007 * s, topAt(z) - 0.03 * s, z], [alt * 0.08, Math.cos(th), -Math.sin(th)], len, 0.034 + 0.008 * prof, alt * (0.3 + 0.3 * rng.next()), maneBone(z), ['mane']);
    }
  }
  // forehead crest runs on into the head
  for (let i = 0; i < 2; i++) {
    const base = headToWorld([0, 0.098 - i * 0.004, -0.07 - i * 0.05]);
    blade(`brow_crest_${i}`, base, headDir([0, 0.5, -0.85]), 0.075 - 0.012 * i, 0.022, (i % 2 === 0 ? 1 : -1) * 0.4, 'head', ['mane', 'head']);
  }
  for (const [sd, sx] of sides) {
    // cheek ruff and jaw beard: bristles that sweep back along the jawline
    for (let i = 0; i < 2; i++) {
      const bl = headToWorld([sx * (0.094 + 0.003 * i), -0.03 - 0.035 * i, 0.0 - 0.04 * i]);
      blade(`cheek_ruff_${sd}${i}`, bl, headDir([sx * 0.45, -0.3 - 0.1 * i, -0.85]), 0.085 + 0.012 * i, 0.022, sx * 0.4, 'head', ['ruff', 'cheek', 'head'], 0.8, 0.009);
    }
    blade(`beard_${sd}`, headToWorld([sx * 0.035, -0.095, 0.1]), headDir([sx * 0.2, -0.45, -0.85]), 0.09, 0.02, sx * 0.3, 'jaw', ['ruff', 'jaw', 'head'], 0.8, 0.009);
    // shoulder cape: bristles standing off the top of the shoulder shield
    for (let i = 0; i < 2; i++) {
      blade(`cape_${sd}${i}`, V(sx * (0.165 + 0.01 * i), 0.7 - 0.012 * i, 0.26 - 0.1 * i), [sx * 0.5, 0.55, -0.65], 0.09 + 0.01 * (1 - i * 0.4), 0.026, sx * 0.5, 'chest', ['mane', 'shield']);
    }
  }

  // ------------------------------------------------------------------ legs: stout upper limb, slim cannon, joints, cloven hooves
  const hoofSdf = (cx: number, cz: number): Sdf[] =>
    [-1, 1].map((k) => ell([cx + k * R(0.0275), R(0.036), cz + R(0.016)], [R(0.0215), R(0.044), R(0.052)], qeuler(-0.5, 0, k * 0.07)));
  for (const [sd, sx] of sides) {
    const bn = (n: string): string => `${n}_${sd}`;
    const f = a.front;
    const sh = mk(sx, f.shoulder), el = mk(sx, f.elbow), wr = mk(sx, f.wrist), fe = mk(sx, f.fetlock);
    body.add(`arm_${sd}`, rcone(sh, el, R(0.106), R(0.078)), { bone: bn('arm'), w: R(0.06), tags: ['leg', 'leg_f'] });
    body.add(`elbow_${sd}`, new Sphere(vadd(el, V(0, 0, -0.012)), R(0.07)), { bone: bn('forearm'), w: R(0.045), tags: ['leg', 'leg_f'] });
    body.add(`forearm_${sd}`, rcone(el, wr, R(0.074), R(0.04)), { bone: bn('forearm'), w: R(0.035), tags: ['leg', 'leg_f'] });
    body.add(`forearm_muscle_${sd}`, ell(vlerp(el, wr, 0.3), [R(0.052), R(0.085), R(0.058)], qeuler(-0.1, 0, 0)), { bone: bn('forearm'), w: R(0.03), tags: ['leg', 'leg_f'] });
    body.add(`carpus_${sd}`, new Sphere(vadd(wr, V(0, 0.004, 0)), R(0.048)), { bone: bn('hand'), w: R(0.02), tags: ['leg', 'leg_f', 'lower_leg', 'joint'] });
    body.add(`carpal_pad_${sd}`, ell(vadd(wr, V(0, 0.018, -0.032)), [R(0.022), R(0.034), R(0.026)], qeuler(0.25, 0, 0)), { bone: bn('hand'), w: R(0.02), tags: ['leg', 'leg_f', 'lower_leg'] });
    body.add(`cannon_f_${sd}`, rcone(vadd(wr, V(0, -0.02, 0.004)), vadd(fe, V(0, 0.02, 0)), R(0.036), R(0.03)), { bone: bn('hand'), w: R(0.025), tags: ['leg', 'leg_f', 'lower_leg'] });
    body.add(`fetlock_f_${sd}`, new Sphere(vadd(fe, V(0, 0.016, -0.004)), R(0.041)), { bone: bn('hand'), w: R(0.02), tags: ['leg', 'leg_f', 'lower_leg', 'joint'] });
    body.add(`pastern_f_${sd}`, rcone(vadd(fe, V(0, 0.01, 0)), vadd(fe, V(0, -0.03, 0.012)), R(0.032), R(0.028)), { bone: bn('hand'), w: R(0.02), tags: ['leg', 'leg_f', 'lower_leg'] });
    hoofSdf(fe[0], fe[2]).forEach((h, i) => body.add(`hoof_f_${sd}${i}`, h, { bone: bn('hand'), w: R(0.004), tags: ['hoof'], grip: 1.5 }));
    for (const k of [-1, 1]) body.add(`dew_f_${sd}${k}`, ell(vadd(fe, V(k * 0.0175, -0.022, -0.032)), [R(0.01), R(0.014), R(0.012)], qeuler(0.4, 0, 0)), { bone: bn('hand'), w: R(0.004), tags: ['hoof', 'dew'], grip: 1.5 });

    const h = a.hind;
    const hip = mk(sx, h.hip), st = mk(sx, h.stifle), hk = mk(sx, h.hock), hf = mk(sx, h.fetlock);
    body.add(`thigh_${sd}`, rcone(hip, st, R(0.112), R(0.07)), { bone: bn('thigh'), w: R(0.06), tags: ['leg', 'leg_h'] });
    body.add(`stifle_${sd}`, new Sphere(vadd(st, V(sx * 0.005, 0.0, 0.01)), R(0.066)), { bone: bn('thigh'), w: R(0.04), tags: ['leg', 'leg_h'] });
    body.add(`gaskin_${sd}`, rcone(st, hk, R(0.072), R(0.04)), { bone: bn('shin'), w: R(0.04), tags: ['leg', 'leg_h'] });
    body.add(`gaskin_muscle_${sd}`, ell(vlerp(st, hk, 0.32), [R(0.048), R(0.075), R(0.052)], qeuler(0.5, 0, 0)), { bone: bn('shin'), w: R(0.03), tags: ['leg', 'leg_h'] });
    body.add(`hock_${sd}`, ell(vadd(hk, V(0, 0.01, -0.028)), [R(0.028), R(0.05), R(0.035)], qeuler(-0.4, 0, 0)), { bone: bn('foot'), w: R(0.03), tags: ['leg', 'leg_h', 'joint'] });
    body.add(`hock_joint_${sd}`, new Sphere(hk, R(0.047)), { bone: bn('foot'), w: R(0.02), tags: ['leg', 'leg_h', 'lower_leg', 'joint'] });
    body.add(`cannon_h_${sd}`, rcone(vadd(hk, V(0, -0.02, 0.0)), vadd(hf, V(0, 0.022, 0)), R(0.036), R(0.03)), { bone: bn('foot'), w: R(0.025), tags: ['leg', 'leg_h', 'lower_leg'] });
    body.add(`fetlock_h_${sd}`, new Sphere(vadd(hf, V(0, 0.014, -0.004)), R(0.041)), { bone: bn('toe'), w: R(0.02), tags: ['leg', 'leg_h', 'lower_leg', 'joint'] });
    body.add(`pastern_h_${sd}`, rcone(vadd(hf, V(0, 0.01, 0)), vadd(hf, V(0, -0.028, 0.012)), R(0.032), R(0.028)), { bone: bn('toe'), w: R(0.02), tags: ['leg', 'leg_h', 'lower_leg'] });
    hoofSdf(hf[0], hf[2]).forEach((hh, i) => body.add(`hoof_h_${sd}${i}`, hh, { bone: bn('toe'), w: R(0.004), tags: ['hoof'], grip: 1.5 }));
    for (const k of [-1, 1]) body.add(`dew_h_${sd}${k}`, ell(vadd(hf, V(k * 0.0175, -0.024, -0.032)), [R(0.01), R(0.014), R(0.012)], qeuler(0.4, 0, 0)), { bone: bn('toe'), w: R(0.004), tags: ['hoof', 'dew'], grip: 1.5 });
  }
  // flat soles: nothing below the ground plane
  body.cut('ground', new HalfSpace([0, 0, 0], [0, 1, 0]), { bone: 'root', w: 0.002 * s, tags: [] });

  // ------------------------------------------------------------------ tail: thin cord with a stiff tassel
  const tprofile: [number, number][] = [[0, a.tailR[0]!], [0.3, a.tailR[1]!], [0.65, a.tailR[3]!], [1, a.tailR[4]!]];
  tubeSegments(a.tail, tprofile, { segments: 10 }).forEach((sg, i) => {
    const bone = sg.t0 < 0.25 ? 'tail1' : sg.t0 < 0.5 ? 'tail2' : sg.t0 < 0.75 ? 'tail3' : 'tail4';
    body.add(`tail_${i}`, sg.sdf, { bone, w: R(0.03), tags: ['tail', 'tail_body'] });
  });
  {
    const tipP = a.tail[4]!;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const d: Vec3 = [Math.cos(ang) * 0.42, -0.85, Math.sin(ang) * 0.3 - 0.15];
      blade(`tassel_${i}`, vadd(tipP, V(0, 0.01, 0)), d, 0.11 - 0.014 * (i % 2), 0.015, ang, 'tail4', ['tail', 'tail_tip'], 0.5, 0.005);
    }
  }

  // ------------------------------------------------------------------ surface: muscle asymmetry, coarse hide creases over the shield / neck / haunch, fur clumps
  body.displace(fbmField(noise, 7 / s, { octaves: 2 }), R(0.004));
  const foldMask = (x: number, y: number, z: number): number => {
    const dh = Math.hypot(x - a.head[0], y - a.head[1], (z - a.head[2]) * 0.8);
    const shoulder = 1 - smoothstep(0.1 * s, 0.2 * s, Math.hypot(Math.abs(x) - 0.2 * s, y - 0.52 * s, (z - 0.26 * s) * 0.8));
    const neck = (1 - smoothstep(0.08 * s, 0.22 * s, Math.hypot(x, y - 0.56 * s, z - 0.4 * s))) * smoothstep(0.1 * s, 0.2 * s, dh);
    return Math.max(shoulder, neck, 0) * smoothstep(0.17 * s, 0.3 * s, y);
  };
  body.displace(maskedField(ridgedField(noise, 15 / s, { octaves: 2, stretch: [0.55, 1.6, 0.6] }), foldMask), R(0.006));
  const clumps = maskedField(voronoiField(noise, 36 / s, 'dome', [1, 1, 0.55]), (x, y, z) => {
    const dh = Math.hypot(x - a.head[0], y - a.head[1], (z - a.head[2]) * 0.8);
    return smoothstep(0.17 * s, 0.3 * s, dh) * smoothstep(0.12 * s, 0.22 * s, y);
  });
  body.displace(clumps, R(0.0018));
  return body;
}
