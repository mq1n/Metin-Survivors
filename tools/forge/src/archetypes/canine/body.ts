// Canine SDF body: torso slices, neck, head (skull / brow / snout / jaw / ears / eyes / fangs), legs with digitigrade hind limbs,
// tail plume, fur blades (ruff, bib, mane, feathering). Hand-sculpted from primitives; each part knows its bone and paint tags.
import { type Quat, type Vec3, qeuler, qx, smoothstep, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { fbmField, maskedField, voronoiField } from '../../core/sdf/fields.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone, tubeSegments } from '../../core/sdf/shapes.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

export function makeBody(a: Anatomy, _skel: Skeleton): Body {
  const p = a.p;
  const s = a.s;
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

  // ------------------------------------------------------------------ torso slices
  for (const st of a.stations) {
    body.add(`torso_${st.name}`, ell([0, st.y, st.z], [st.hw, st.hh, st.hl]), { bone: st.bone, w: R(0.08), tags: ['torso'] });
  }
  const st5 = a.stations[5]!;
  if ((p.ribs ?? 0) > 0) {
    // plague: rib arches under the skin + knobbly spine
    const rb = p.ribs ?? 0;
    for (let k = 0; k < 7; k++) {
      const z = st5.z + 0.05 * s - k * 0.042 * s;
      const st = [...a.stations].reverse().find((q) => q.z <= z + 0.001) ?? a.stations[2]!;
      for (const [sd, sx] of sides) {
        body.add(`rib_${k}_${sd}`, ell([sx * st.hw * 0.9, st.y - st.hh * 0.18, z], [R(0.017) * rb + R(0.006), st.hh * 0.6, R(0.012)], qeuler(0, 0, sx * 0.14)), { bone: k < 4 ? 'chest' : 'spine', w: R(0.02), tags: ['torso', 'rib'] });
      }
    }
    for (let k = 0; k < 9; k++) {
      const z = st5.z + 0.04 * s - k * 0.05 * s;
      const st = [...a.stations].reverse().find((q) => q.z <= z + 0.001) ?? a.stations[2]!;
      body.add(`spine_knob_${k}`, new Sphere([0, st.y + st.hh * 0.85, z], R(0.012) * rb + R(0.006)), { bone: k < 4 ? 'chest' : 'spine', w: R(0.02), tags: ['torso', 'rib'] });
    }
  }
  // withers mass + shoulder blades + haunch: the wedge of a predator
  body.add('withers', ell([0, a.withersY - R(0.075), st5.z - R(0.03)], [R(0.085) * p.chestWidth, R(0.095), R(0.13)], qeuler(-0.25, 0, 0)), { bone: 'chest', w: R(0.07), tags: ['torso'] });
  for (const [sd, sx] of sides) {
    const sh = a.front.shoulder;
    body.add(`scapula_${sd}`, ell([sx * sh[0] * 0.95, sh[1] + R(0.02), sh[2] + R(0.0)], [R(0.066) * p.chestWidth, R(0.14), R(0.12)], qeuler(-0.28, 0, sx * 0.1)), { bone: 'chest', w: R(0.06), tags: ['torso'] });
    const hp = a.hind.hip;
    body.add(`haunch_${sd}`, ell([sx * hp[0] * 0.98, hp[1] - R(0.03), hp[2] - R(0.01)], [R(0.05) * p.legThick, R(0.092), R(0.095)], qeuler(0.2, 0, 0)), { bone: `thigh_${sd}`, w: R(0.06), tags: ['torso'] });
  }

  // ------------------------------------------------------------------ neck
  const hs = p.headScale * s;
  const neckA: Vec3 = [0, a.neck[1] - R(0.06), a.neck[2] - R(0.12)];
  const neckB: Vec3 = [0, a.head[1] - R(0.01), a.head[2] - 0.075 * hs];
  body.add('neck', new RoundCone(neckA, neckB, R(0.135) * p.neckThick, R(0.092) * p.neckThick), { bone: 'neck', w: R(0.07), tags: ['neck'] });
  body.add('throat', new RoundCone(vadd(neckA, V(0, -0.06, 0.04)), vadd(neckB, V(0, -0.055, 0.0)), R(0.098) * p.neckThick, R(0.064) * p.neckThick), { bone: 'neck', w: R(0.06), tags: ['neck', 'throat'] });

  // ------------------------------------------------------------------ head (modelled in head-local units, then placed)
  const headRot: Quat = qx(a.headPitch);
  const H = (sdf: Sdf): Sdf => new Xform(sdf, a.head, headRot, [hs, hs, hs]);
  const headToWorld = (v: Vec3): Vec3 => {
    const c = Math.cos(a.headPitch), sn = Math.sin(a.headPitch);
    return [a.head[0] + v[0] * hs, a.head[1] + (v[1] * c - v[2] * sn) * hs, a.head[2] + (v[1] * sn + v[2] * c) * hs];
  };
  const sw = p.skullWidth, snw = p.snoutWidth, snl = p.snoutLength;
  const noseZ = 0.1 + 0.25 * snl;
  const squash = (c: Vec3, sdf: Sdf, sy: number): Sdf => new Xform(new Xform(sdf, vscale(c, -1)), c, ID, [1, sy, 1]);

  body.add('skull', H(ell([0, 0.005, 0], [0.092 * sw, 0.088, 0.104])), { bone: 'head', w: 0.04 * hs, tags: ['head'], grip: 2 });
  for (const [sd, sx] of sides) {
    // brow ridges slanted inward: the "angry" read
    body.add(`brow_${sd}`, H(ell([sx * 0.05 * sw, 0.052, 0.066], [0.04, 0.024, 0.052], qeuler(0, sx * -0.2, sx * 0.4))), { bone: 'head', w: 0.025 * hs, tags: ['head', 'brow'], grip: 2 });
    body.add(`cheek_${sd}`, H(ell([sx * 0.068 * sw, -0.032, 0.025], [0.042, 0.056, 0.074])), { bone: 'head', w: 0.03 * hs, tags: ['cheek', 'head'], grip: 2 });
    body.add(`jowl_${sd}`, H(ell([sx * 0.04 * snw, -0.044, noseZ * 0.5], [0.024 * snw, 0.024, 0.07])), { bone: 'head', w: 0.02 * hs, tags: ['muzzle', 'head'], grip: 2 });
  }
  // muzzle: a tapered bridge (stop at the brow, narrowing to the nose pad) with hanging upper lips (flews) that define the lip line
  body.add('snout', H(squash([0, -0.02, 0.14], new RoundCone([0, 0.008, 0.06], [0, -0.022, noseZ - 0.035], 0.064 * snw, 0.03 * snw), 0.8)), { bone: 'head', w: 0.04 * hs, tags: ['muzzle', 'head'], grip: 2 });
  body.add('nose', H(ell([0, -0.016, noseZ - 0.003], [0.03 * snw, 0.022, 0.026])), { bone: 'head', w: 0.012 * hs, tags: ['nose'], grip: 2 });
  for (const [sd, sx] of sides) {
    body.add(`flew_${sd}`, H(ell([sx * 0.032 * snw, -0.04, 0.05 + (noseZ - 0.05) * 0.5], [0.019 * snw, 0.021, (noseZ - 0.05) * 0.5], qeuler(0.05, sx * -0.06, 0))), { bone: 'head', w: 0.014 * hs, tags: ['muzzle', 'head', 'flew'], grip: 2 });
  }
  // lower jaw: own bone so the mouth opens
  body.add('jaw', H(squash([0, -0.06, 0.1], new RoundCone([0, -0.052, 0.035], [0, -0.058, noseZ - 0.06], 0.042 * snw, 0.024 * snw), 0.74)), { bone: 'jaw', w: 0.025 * hs, tags: ['jaw', 'muzzle'], grip: 2.5 });
  body.add('chin', H(ell([0, -0.062, noseZ - 0.058], [0.021 * snw, 0.016, 0.02])), { bone: 'jaw', w: 0.015 * hs, tags: ['jaw', 'muzzle'], grip: 2.5 });
  const slitLen = (noseZ - 0.045) * 0.55;
  body.cut('mouth_slit', H(ell([0, -0.0405, 0.045 + slitLen], [0.08 * snw, 0.0045, slitLen])), { bone: 'head', w: 0.006 * hs, tags: ['lipline'] });
  for (const [sd, sx] of sides) {
    body.cut(`nostril_${sd}`, H(new Sphere([sx * 0.013 * snw, -0.02, noseZ + 0.017], 0.006)), { bone: 'head', w: 0.004 * hs, tags: ['nostril'] });
    const ec: Vec3 = [sx * 0.058 * sw, 0.03, 0.083];
    const eq = qeuler(0, sx * 0.5, sx * -0.42);
    body.cut(`eye_socket_${sd}`, H(ell(ec, [0.023, 0.017, 0.026], eq)), { bone: 'head', w: 0.01 * hs, tags: [] });
    body.addLate(`eye_${sd}`, H(ell([ec[0] - sx * 0.003, ec[1], ec[2] - 0.003], [0.0135, 0.0095, 0.013], eq)), { bone: 'head', w: 0.003 * hs, tags: ['eye'], grip: 3 });
    body.mark(`pupil_${sd}`, H(new Sphere([ec[0] + sx * 0.0072, ec[1] + 0.0, ec[2] + 0.0085], 0.0042)), ['pupil']);
    // fangs (upper + lower)
    body.addLate(`fang_up_${sd}`, H(new RoundCone([sx * 0.028 * snw, -0.04, noseZ - 0.055], [sx * 0.027 * snw, -0.092, noseZ - 0.05], 0.0105, 0.0012)), { bone: 'head', w: 0.002 * hs, tags: ['fang'], grip: 3 });
    body.addLate(`fang_lo_${sd}`, H(new RoundCone([sx * 0.022 * snw, -0.056, noseZ - 0.07], [sx * 0.021 * snw, -0.008, noseZ - 0.064], 0.0085, 0.0011)), { bone: 'jaw', w: 0.002 * hs, tags: ['fang'], grip: 3 });
  }
  body.addLate('tongue', H(ell([0, -0.049, 0.1 + noseZ * 0.35], [0.018 * snw, 0.007, noseZ * 0.38])), { bone: 'jaw', w: 0.004 * hs, tags: ['tongue'], grip: 3 });

  // ears: triangular flat cones, erect -> folded
  const fold = p.earFold;
  for (const [sd, sx] of sides) {
    const eb: Vec3 = [sx * 0.064 * sw, 0.07, -0.03];
    const erect = vnorm([sx * 0.42, 0.86, -0.26]);
    const folded = vnorm([sx * 0.88, -0.28, -0.1]);
    const dir = vnorm(vlerp(erect, folded, fold));
    const len = 0.112 * p.earSize * (1 - 0.25 * fold);
    const tip = vadd(eb, vscale(dir, len));
    const facing = vnorm(vlerp([sx * 0.4, -0.05, 0.9], [sx * 0.15, 0.95, 0.2], fold));
    body.add(`ear_${sd}`, H(flatCone(eb, tip, 0.058 * p.earSize, 0.021, 0.3, facing)), { bone: `ear_${sd}`, w: 0.02 * hs, tags: ['ear'], grip: 2 });
    const mid = vlerp(eb, tip, 0.48);
    body.cut(`ear_dish_${sd}`, H(ell(vadd(mid, vscale(facing, 0.03)), [0.028 * p.earSize, 0.046 * p.earSize, 0.018])), { bone: `ear_${sd}`, w: 0.012 * hs, tags: ['ear_inner'] });
  }

  // ------------------------------------------------------------------ fur: flat blades lying along the coat flow
  // blade(): base inside the body, tip sweeps along `flow` and lifts off the surface by `lift` (metres, pre-scale)
  const blade = (name: string, base: Vec3, flow: Vec3, len: number, width: number, normal: Vec3, lift: number, bone: string, tags: string[]): void => {
    const f = vnorm(flow);
    const n = vnorm(normal);
    const tip: Vec3 = [base[0] + (f[0] * len + n[0] * lift) * s, base[1] + (f[1] * len + n[1] * lift) * s, base[2] + (f[2] * len + n[2] * lift) * s];
    body.add(name, flatCone(base, tip, width * 0.5 * s, 0.0105 * s, 0.45, n), { bone, w: 0.02 * s, tags: ['fur', ...tags] });
  };

  for (const [sd, sx] of sides) {
    // cheek fluff: swept-back ellipsoids (smooth, no ragged blades on the face)
    for (let i = 0; i < Math.ceil(p.ruff * 2); i++) {
      body.add(`cheek_fluff_${sd}${i}`, H(ell([sx * (0.086 * sw + 0.006 * i), -0.04 - 0.02 * i, -0.015 - 0.03 * i], [0.024 + 0.004 * p.ruff, 0.04, 0.07], qeuler(0, sx * 0.25, 0))), { bone: 'head', w: 0.03 * hs, tags: ['ruff', 'cheek'], grip: 1.5 });
    }
  }
  const nAxis = vnorm(vsub(neckB, neckA));
  const nLen = Math.hypot(...vsub(neckB, neckA));
  const ringN = Math.max(0, Math.round(7 * Math.min(p.ruff, 1.6)));
  const rows = p.ruff > 0 ? 3 : 0;
  for (let rI = 0; rI < rows; rI++) {
    const t = 0.22 + rI * 0.27;
    const c = vadd(neckA, vscale(nAxis, nLen * t));
    const radius = (0.135 - 0.043 * t) * p.neckThick * s;
    for (let i = 0; i < ringN; i++) {
      const th = ((i + 0.5 * (rI % 2)) / ringN) * Math.PI * 2;
      const sxv = Math.cos(th), syv = Math.sin(th);
      if (syv < -0.6) continue;
      const base: Vec3 = [c[0] + sxv * radius * 0.85, c[1] + syv * radius * 0.85, c[2]];
      const len = (0.1 + 0.07 * p.ruff) * (0.8 + 0.5 * rng.next());
      blade(`ruff_${rI}_${i}`, base, [sxv * 0.22, syv * 0.1 - 0.14, -1], len, 0.14, [sxv, syv, 0.15], 0.016 + 0.01 * rng.next(), 'neck', ['ruff']);
    }
  }
  // angular fur silhouette (kept few and big so they read as tufts, not thorns): back ridge, scruff, cheek ruffs
  {
    const nR = Math.round(8 + 4 * Math.min(p.mane + 0.4, 1.4));
    for (let i = 0; i < nR; i++) {
      const k = i / (nR - 1);
      const z = st5.z + 0.03 * s - k * (st5.z - a.stations[1]!.z + 0.05 * s);
      const st = [...a.stations].reverse().find((q) => q.z <= z + 0.001) ?? a.stations[2]!;
      const len = (0.075 + 0.04 * (1 - k)) * (0.85 + 0.35 * p.mane) * (0.85 + 0.3 * rng.next());
      blade(`ridge_${i}`, [0, st.y + st.hh * 0.7, z], [0, 1.0 - 0.3 * k, -0.85], len, 0.115, [1, 0, 0], 0.012, k < 0.4 ? 'chest' : 'spine', ['mane']);
    }
    for (let i = 0; i < 4; i++) {
      const t = 0.15 + i * 0.17;
      const c = vadd(neckA, vscale(nAxis, nLen * t));
      blade(`scruff_${i}`, [c[0], c[1] + (0.12 - 0.04 * t) * p.neckThick * s * 0.6, c[2]], [0, 0.8, -1], (0.11 + 0.03 * p.ruff) * (0.9 + 0.3 * rng.next()), 0.09, [1, 0, 0], 0.014, 'neck', ['ruff']);
    }
    for (const [sd, sx] of sides) {
      for (let i = 0; i < 3; i++) {
        blade(`cheek_ruff_${sd}${i}`, headToWorld([sx * (0.082 * sw + 0.004 * i), -0.03 - 0.022 * i, -0.012 - 0.02 * i]), [sx * 0.45, -0.35 - 0.2 * i, -1], (0.085 + 0.03 * i) * (0.8 + 0.4 * p.ruff), 0.075, [sx, 0.1, 0.1], 0.012, 'head', ['ruff', 'cheek']);
      }
    }
  }
  // chest fluff (smooth, replaces blades under the chin)
  body.add('chest_fluff', ell([0, st5.y - st5.hh * 0.72, st5.z + 0.08 * s], [R(0.075) * p.chestWidth, R(0.085) * p.ruff, R(0.1)], qeuler(0.4, 0, 0)), { bone: 'chest', w: R(0.06), tags: ['ruff', 'chest'] });
  if (p.mane > 0.05) {
    // raised dorsal ridge from the withers to the hips (a swept ellipsoid chain) plus a few ragged tips for big manes
    const topAt = (z: number): number => {
      const st = [...a.stations].reverse().find((q) => q.z <= z + 0.001) ?? a.stations[3]!;
      return st.y + st.hh * 0.95;
    };
    const ridge: Vec3[] = [0, 1, 2, 3, 4].map((i) => {
      const z = st5.z + 0.02 * s - (i / 4) * (st5.z - a.stations[1]!.z + 0.02 * s);
      return [0, topAt(z), z] as Vec3;
    });
    const rsegs = tubeSegments(ridge, [[0, 0.03 * p.mane * s], [0.25, 0.042 * p.mane * s], [0.6, 0.03 * p.mane * s], [1, 0.012 * p.mane * s]], { segments: 8 });
    rsegs.forEach((sg, i) => body.add(`mane_ridge_${i}`, sg.sdf, { bone: sg.t0 < 0.5 ? 'chest' : 'spine', w: R(0.05), tags: ['mane'] }));
    if (p.mane > 0.7) {
      const n = Math.round(6 + 6 * (p.mane - 0.7));
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const z = st5.z * (1 - k) + a.stations[1]!.z * k;
        const len = (0.07 + 0.05 * p.mane * (1 - k * 0.5)) * (0.8 + 0.4 * rng.next());
        blade(`mane_${i}`, [(i % 2 === 0 ? 1 : -1) * 0.01 * s, topAt(z) - 0.01 * s, z], [0, 0.35, -1], len, 0.07, [0, 1, 0], 0.01, k < 0.45 ? 'chest' : 'spine', ['mane']);
      }
    }
  }

  // ------------------------------------------------------------------ legs
  const lt = p.legThick;
  const pawS = p.paw * 1.2;
  for (const [sd, sx] of sides) {
    const f = a.front;
    const sh = mk(sx, f.shoulder), el = mk(sx, f.elbow), wr = mk(sx, f.wrist);
    body.add(`arm_${sd}`, new RoundCone(sh, el, R(0.092) * lt, R(0.06) * lt), { bone: `arm_${sd}`, w: R(0.06), tags: ['leg', 'leg_f'] });
    body.add(`elbow_${sd}`, new Sphere(el, R(0.06) * lt), { bone: `forearm_${sd}`, w: R(0.045), tags: ['leg', 'leg_f'] });
    body.add(`forearm_${sd}`, new RoundCone(el, wr, R(0.054) * lt, R(0.03) * lt), { bone: `forearm_${sd}`, w: R(0.035), tags: ['leg', 'leg_f', 'lower_leg'] });
    body.add(`carpal_${sd}`, ell(vadd(wr, V(0, R(0.012) * 0, -0.022)), [R(0.02) * lt, R(0.03) * lt, R(0.024) * lt], qeuler(0.25, 0, 0)), { bone: `hand_${sd}`, w: R(0.02), tags: ['leg', 'leg_f', 'lower_leg'] });
    const fet: Vec3 = [wr[0], R(0.058) * pawS, wr[2] + R(0.035)];
    body.add(`pastern_${sd}`, new RoundCone(wr, fet, R(0.034) * lt, R(0.03) * lt), { bone: `hand_${sd}`, w: R(0.03), tags: ['leg', 'leg_f', 'lower_leg'] });
    const pc: Vec3 = [wr[0], R(0.027) * pawS, wr[2] + R(0.062) * pawS];
    body.add(`paw_${sd}`, ell(pc, [R(0.042) * pawS, R(0.028) * pawS, R(0.06) * pawS]), { bone: `hand_${sd}`, w: R(0.02), tags: ['paw'], grip: 1.5 });
    for (const tk of [-1, 0, 1]) {
      const tx = pc[0] + tk * R(0.022) * pawS;
      const tz = pc[2] + R(0.05) * pawS + (tk === 0 ? R(0.008) : 0);
      body.add(`toe_f_${sd}${tk}`, ell([tx, R(0.016) * pawS, tz], [R(0.0135) * pawS, R(0.015) * pawS, R(0.026) * pawS]), { bone: `hand_${sd}`, w: R(0.004), tags: ['paw', 'toe'], grip: 1.5 });
      body.addLate(`claw_f_${sd}${tk}`, new RoundCone([tx, R(0.014) * pawS, tz + R(0.02) * pawS], [tx, R(0.004) * pawS, tz + R(0.046) * pawS], R(0.0058) * pawS, R(0.0009)), { bone: `hand_${sd}`, w: R(0.002), tags: ['claw'], grip: 1.5 });
    }

    const h = a.hind;
    const hip = mk(sx, h.hip), st = mk(sx, h.stifle), hk = mk(sx, h.hock), fe = mk(sx, h.fetlock);
    body.add(`thigh_${sd}`, new RoundCone(hip, st, R(0.078) * lt, R(0.05) * lt), { bone: `thigh_${sd}`, w: R(0.06), tags: ['leg', 'leg_h'] });
    body.add(`shin_${sd}`, new RoundCone(st, hk, R(0.048) * lt, R(0.029) * lt), { bone: `shin_${sd}`, w: R(0.04), tags: ['leg', 'leg_h'] });
    body.add(`hock_${sd}`, ell(vadd(hk, V(0, R(0.012), -0.024)), [R(0.025) * lt, R(0.046) * lt, R(0.032) * lt], qeuler(-0.35, 0, 0)), { bone: `foot_${sd}`, w: R(0.03), tags: ['leg', 'leg_h'] });
    body.add(`meta_${sd}`, new RoundCone(hk, fe, R(0.028) * lt, R(0.024) * lt), { bone: `foot_${sd}`, w: R(0.03), tags: ['leg', 'leg_h', 'lower_leg'] });
    const hpc: Vec3 = [fe[0], R(0.027) * pawS, fe[2] + R(0.058) * pawS];
    body.add(`paw_h_${sd}`, ell(hpc, [R(0.04) * pawS, R(0.028) * pawS, R(0.058) * pawS]), { bone: `toe_${sd}`, w: R(0.02), tags: ['paw'], grip: 1.5 });
    for (const tk of [-1, 0, 1]) {
      const tx = hpc[0] + tk * R(0.02) * pawS;
      const tz = hpc[2] + R(0.046) * pawS + (tk === 0 ? R(0.008) : 0);
      body.add(`toe_h_${sd}${tk}`, ell([tx, R(0.015) * pawS, tz], [R(0.013) * pawS, R(0.014) * pawS, R(0.024) * pawS]), { bone: `toe_${sd}`, w: R(0.004), tags: ['paw', 'toe'], grip: 1.5 });
      body.addLate(`claw_h_${sd}${tk}`, new RoundCone([tx, R(0.013) * pawS, tz + R(0.018) * pawS], [tx, R(0.004) * pawS, tz + R(0.042) * pawS], R(0.0052) * pawS, R(0.0009)), { bone: `toe_${sd}`, w: R(0.002), tags: ['claw'], grip: 1.5 });
    }

    // feathering: blades lying along the back edge of the limbs
    const tf = p.tufts;
    if (tf > 0.05) {
      const down = (a_: Vec3, b_: Vec3): Vec3 => vnorm(vsub(b_, a_));
      const legFur = (nm: string, from: Vec3, to: Vec3, t: number, back: number, len: number, width: number, bone: string): void => {
        const axis = down(from, to);
        const base = vadd(vlerp(from, to, t), V(0, 0, -back));
        blade(`${nm}_${sd}`, base, [axis[0] * 0.9 + sx * 0.05, axis[1] * 0.9, axis[2] * 0.9 - 0.45], len * tf, width, [sx * 0.2, 0.05, -1], 0.008, bone, ['tuft', 'leg']);
      };
      // feathering as smooth masses (blades read as thorns): elbow fringe, thigh britches, hock tuft
      body.add(`elbow_fur_${sd}`, ell(vadd(vlerp(sh, el, 0.95), V(0, 0, -R(0.035))), [R(0.026) * tf, R(0.075) * tf, R(0.04) * tf], qeuler(0.35, 0, 0)), { bone: `forearm_${sd}`, w: R(0.03), tags: ['tuft', 'leg'] });
      body.add(`thigh_fur_${sd}`, ell(vadd(vlerp(hip, st, 0.5), V(0, -R(0.01), -R(0.05))), [R(0.036) * tf, R(0.085) * tf, R(0.05) * tf], qeuler(-0.3, 0, 0)), { bone: `thigh_${sd}`, w: R(0.035), tags: ['tuft', 'leg'] });
      body.add(`hock_fur_${sd}`, ell(vadd(hk, V(0, R(0.012), -R(0.03))), [R(0.018) * tf, R(0.045) * tf, R(0.028) * tf], qeuler(-0.2, 0, 0)), { bone: `foot_${sd}`, w: R(0.02), tags: ['tuft', 'leg'] });
    }
  }

  // ------------------------------------------------------------------ tail plume
  const tailPts = a.tail;
  const tr = a.tailR;
  const prof: [number, number][] = [[0, tr[0]!], [0.22, tr[1]!], [0.5, tr[2]!], [0.76, tr[3]!], [0.92, tr[4]!], [1, tr[5]!]];
  const segs = tubeSegments(tailPts, prof, { segments: 14 });
  segs.forEach((sg, i) => {
    const bone = sg.t0 < 0.25 ? 'tail1' : sg.t0 < 0.5 ? 'tail2' : sg.t0 < 0.75 ? 'tail3' : 'tail4';
    body.add(`tail_${i}`, sg.sdf, { bone, w: R(0.035), tags: ['tail', sg.t0 > 0.8 ? 'tail_tip' : 'tail_body', ...(p.palette.spirit && sg.t0 > 0.74 ? ['spirit'] : [])] });
  });
  // fan tails (Miho): bushy 2-bone tubes spread around the main tail, tips carry the spirit fire
  const fanProf: [number, number][] = [[0, 0.026], [0.25, 0.042], [0.55, 0.05], [0.82, 0.034], [0.94, 0.016], [1, 0.003]].map(([t, r]) => [t!, r! * p.tailThick * s] as [number, number]);
  a.extraTails.forEach((tl, m) => {
    tubeSegments(tl.path, fanProf, { segments: 10 }).forEach((sg, i) => {
      body.add(`tailF${m}_${i}`, sg.sdf, { bone: sg.t0 < 0.4 ? `tailF${m}_1` : `tailF${m}_2`, w: R(0.035), tags: ['tail', sg.t0 > 0.8 ? 'tail_tip' : 'tail_body', ...(p.palette.spirit && sg.t0 > 0.8 ? ['spirit'] : [])] });
    });
  });
  if (p.tufts > 0.05) {
    for (let i = 0; i < 7; i++) {
      const t = 0.08 + i * 0.11;
      const idx = Math.min(segs.length - 1, Math.floor(t * segs.length));
      const sg = segs[idx]!;
      const dirT = vnorm(vsub(sg.b, sg.a));
      for (const sx of [-1, 1]) {
        const base: Vec3 = [sx * (tr[Math.min(4, Math.floor(t * 4) + 1)]! * 0.62), (sg.a[1] + sg.b[1]) / 2, (sg.a[2] + sg.b[2]) / 2];
        blade(`tail_fur_${i}_${sx}`, base, [sx * 0.12, dirT[1], dirT[2]], (0.15 + 0.04 * (i % 2) - 0.012 * i) * p.tufts, 0.1, [sx, 0.1, 0], 0.014, t < 0.3 ? 'tail1' : t < 0.55 ? 'tail2' : t < 0.8 ? 'tail3' : 'tail4', ['tail', 'tail_body']);
      }
    }
  }

  // ------------------------------------------------------------------ surface lumpiness (hide folds, muscle asymmetry)
  body.displace(fbmField(noise, 9 / s, { octaves: 2 }), R(0.006));
  // fur clumps: scalloped bumps on the coat (kept off the face and paws so features stay clean)
  const clumps = maskedField(voronoiField(noise, 34 / s, 'dome', [1, 1, 0.6]), (x, y, z) => {
    const dh = Math.hypot(x - a.head[0], y - a.head[1], (z - a.head[2]) * 0.8);
    return smoothstep(0.17 * s, 0.3 * s, dh) * smoothstep(0.1 * s, 0.22 * s, y);
  });
  body.displace(clumps, R(0.0042));
  return body;
}
