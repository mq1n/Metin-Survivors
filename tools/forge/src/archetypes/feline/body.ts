// Feline SDF body: stalking-cat torso with shoulder blades and tucked waist, jointed limbs with big paws, broad cat head
// (brow, cheek ruff, whisker pads, fangs), ringed tail, adornment (mane / flames / crystals / horns / gilt regalia).
// Every part knows its bone and paint tags.
import { type Quat, type Vec3, qeuler, qfromTo, qx, smoothstep, vadd, vcross, vlerp, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { fbmField, maskedField, voronoiField } from '../../core/sdf/fields.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tubeSegments } from '../../core/sdf/shapes.ts';
import type { Anatomy } from './anatomy.ts';
import { hasMane, tailBoneNames } from './skeleton.ts';

export function makeBody(a: Anatomy): Body {
  const p = a.p;
  const s = a.s;
  const body = new Body();
  body.blend = 0.055 * s;
  const rng = new Rng(p.seed);
  const noise = new Noise(p.seed);
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  const R = (r: number): number => r * s;
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const sides: [string, number][] = [['l', 1], ['r', -1]];
  const mk = (sx: number, v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
  const ID: Quat = [0, 0, 0, 1];
  const ell = (c: Vec3, r: Vec3, q: Quat = ID): Ellipsoid => new Ellipsoid(c, r, q);
  const lt = p.legThick;
  const pawS = p.paw;
  const cw = p.chestWidth;

  // ------------------------------------------------------------------ torso
  for (const st of a.stations) {
    body.add(`torso_${st.name}`, ell([0, st.y, st.z], [st.hw, st.hh, st.hl]), { bone: st.bone, w: R(0.1), tags: ['torso'] });
  }
  const st5 = a.stations[5]!, st3 = a.stations[3]!, st1 = a.stations[1]!;
  // deep keel under the ribs, loose belly skin
  body.add('keel', ell([0, st5.y - st5.hh * 0.55, st5.z + R(0.04)], [R(0.145) * cw, R(0.15), R(0.22)], qeuler(0.22, 0, 0)), { bone: 'chest', w: R(0.08), tags: ['torso', 'belly'] });
  body.add('belly', ell([0, st3.y - st3.hh * 0.72, st3.z + R(0.04)], [R(0.12), R(0.075), R(0.25)]), { bone: 'spine', w: R(0.09), tags: ['torso', 'belly'] });
  for (const [sd, sx] of sides) {
    const sh = a.front.shoulder;
    // shoulder blade: the stalking-cat hump above the back line
    body.add(`scapula_${sd}`, ell([sx * sh[0] * 0.92, sh[1] + R(0.035 + 0.05 * p.shoulderRise), sh[2] - R(0.015)], [R(0.082) * cw, R(0.185), R(0.15)], qeuler(-0.34, 0, sx * 0.12)), { bone: 'chest', w: R(0.07), tags: ['torso', 'shoulder'] });
    const hp = a.hind.hip;
    body.add(`haunch_${sd}`, ell([sx * (hp[0] + R(0.035)), hp[1] - R(0.06), hp[2] + R(0.0)], [R(0.15) * lt, R(0.24), R(0.225)], qeuler(0.28, 0, 0)), { bone: `thigh_${sd}`, w: R(0.08), tags: ['torso', 'haunch'] });
  }

  // ------------------------------------------------------------------ neck
  const hs = p.headScale * s;
  const nt = p.neckThick;
  const neckA: Vec3 = [0, a.neck[1] - R(0.05), a.neck[2] - R(0.17)];
  const neckB: Vec3 = [0, a.head[1] - R(0.005), a.head[2] - 0.09 * hs];
  body.add('neck', new RoundCone(neckA, neckB, R(0.2) * nt, R(0.145) * nt), { bone: 'neck', w: R(0.09), tags: ['neck'] });
  body.add('throat', new RoundCone(vadd(neckA, V(0, -0.09, 0.05)), vadd(neckB, V(0, -0.06, -0.01)), R(0.14) * nt, R(0.09) * nt), { bone: 'neck', w: R(0.07), tags: ['neck', 'throat'] });
  body.add('nape', ell(vadd(vlerp(neckA, neckB, 0.35), V(0, 0.085, 0)), [R(0.1) * nt, R(0.075), R(0.15)], qeuler(-0.3, 0, 0)), { bone: 'neck', w: R(0.07), tags: ['neck'] });

  // ------------------------------------------------------------------ head (modelled in head-local units, then placed)
  const headRot: Quat = qx(a.headPitch);
  const H = (sdf: Sdf): Sdf => new Xform(sdf, a.head, headRot, [hs, hs, hs]);
  const hlw = (v: Vec3): Vec3 => {
    const c = Math.cos(a.headPitch), sn = Math.sin(a.headPitch);
    return [a.head[0] + v[0] * hs, a.head[1] + (v[1] * c - v[2] * sn) * hs, a.head[2] + (v[1] * sn + v[2] * c) * hs];
  };
  const sw = p.skullWidth, mw = p.muzzleWidth, ml = p.muzzleLength;
  const noseZ = 0.1 + 0.115 * ml;
  const squash = (c: Vec3, sdf: Sdf, sy: number): Sdf => new Xform(new Xform(sdf, vscale(c, -1)), c, ID, [1, sy, 1]);

  body.add('skull', H(ell([0, 0.012, -0.005], [0.108 * sw, 0.094, 0.118])), { bone: 'head', w: 0.045 * hs, tags: ['head'], grip: 2 });
  body.add('forehead', H(ell([0, 0.05, 0.035], [0.075 * sw, 0.055, 0.075], qx(-0.35))), { bone: 'head', w: 0.04 * hs, tags: ['head', 'forehead'], grip: 2 });
  for (const [sd, sx] of sides) {
    // heavy slanted brow: the angry cat read
    body.add(`brow_${sd}`, H(ell([sx * 0.056 * sw, 0.06, 0.082], [0.05, 0.03 * (0.7 + 0.5 * p.brow), 0.064], qeuler(0, sx * -0.18, sx * 0.45))), { bone: 'head', w: 0.026 * hs, tags: ['head', 'brow'], grip: 2 });
    body.add(`cheek_${sd}`, H(ell([sx * 0.082 * sw, -0.034, 0.015], [0.056, 0.066, 0.086], qeuler(0, sx * 0.15, 0))), { bone: 'head', w: 0.035 * hs, tags: ['cheek', 'head'], grip: 2 });
    // whisker pads: the puffy muzzle that makes a cat a cat
    body.add(`whisker_${sd}`, H(ell([sx * 0.031 * mw, -0.05, noseZ * 0.8], [0.034 * mw, 0.034, 0.058 * (0.7 + 0.3 * ml)], qeuler(0, sx * 0.1, 0))), { bone: 'head', w: 0.022 * hs, tags: ['muzzle', 'head', 'whisker'], grip: 2 });
  }
  body.add('snout', H(squash([0, -0.025, 0.14], new RoundCone([0, 0.014, 0.07], [0, -0.03, noseZ - 0.04], 0.07 * mw, 0.04 * mw), 0.8)), { bone: 'head', w: 0.045 * hs, tags: ['muzzle', 'head', 'snout'], grip: 2 });
  body.add('bridge', H(new RoundCone([0, 0.07, 0.05], [0, 0.002, noseZ - 0.02], 0.036 * mw, 0.03 * mw)), { bone: 'head', w: 0.03 * hs, tags: ['muzzle', 'head', 'bridge'], grip: 2 });
  body.add('nose', H(ell([0, -0.012, noseZ + 0.002], [0.034 * mw, 0.023, 0.021])), { bone: 'head', w: 0.014 * hs, tags: ['nose'], grip: 2 });
  body.add('jaw', H(squash([0, -0.075, 0.1], new RoundCone([0, -0.07, 0.035], [0, -0.075, noseZ - 0.055], 0.068 * mw, 0.036 * mw), 0.72)), { bone: 'jaw', w: 0.028 * hs, tags: ['jaw', 'muzzle'], grip: 2.5 });
  body.add('chin', H(ell([0, -0.082, noseZ - 0.05], [0.032 * mw, 0.022, 0.026])), { bone: 'jaw', w: 0.018 * hs, tags: ['jaw', 'muzzle', 'chin'], grip: 2.5 });
  const slitLen = (noseZ - 0.06) * 0.58;
  body.cut('mouth_slit', H(ell([0, -0.05, 0.05 + slitLen], [0.1 * mw, 0.0055, slitLen])), { bone: 'head', w: 0.007 * hs, tags: ['lipline'] });
  for (const [sd, sx] of sides) {
    body.cut(`nostril_${sd}`, H(new Sphere([sx * 0.014 * mw, -0.01, noseZ + 0.022], 0.0065)), { bone: 'head', w: 0.004 * hs, tags: ['nostril'] });
    const ec: Vec3 = [sx * 0.064 * sw, 0.03, 0.112];
    const eq = qeuler(0, sx * 0.4, sx * -0.4);
    body.cut(`eye_socket_${sd}`, H(ell(ec, [0.034, 0.0235, 0.036], eq)), { bone: 'head', w: 0.01 * hs, tags: [] });
    body.addLate(`eye_${sd}`, H(ell([ec[0] - sx * 0.003, ec[1], ec[2] - 0.004], [0.0215, 0.0135, 0.0195], eq)), { bone: 'head', w: 0.003 * hs, tags: ['eye'], grip: 3 });
    body.mark(`pupil_${sd}`, H(new Sphere([ec[0] + sx * 0.0095, ec[1], ec[2] + 0.0115], 0.0062)), ['pupil']);
    // fangs: the upper canines hang below the lip even when the mouth is shut
    const fl = 0.06 * p.fangs;
    if (p.fangs > 0.05) {
      body.addLate(`fang_up_${sd}`, H(new RoundCone([sx * 0.04 * mw, -0.045, noseZ - 0.065], [sx * 0.039 * mw, -0.05 - fl, noseZ - 0.058 - 0.01 * p.fangs], 0.0135, 0.0016)), { bone: 'head', w: 0.002 * hs, tags: ['fang'], grip: 3 });
      body.addLate(`fang_lo_${sd}`, H(new RoundCone([sx * 0.03 * mw, -0.07, noseZ - 0.09], [sx * 0.029 * mw, -0.065 + 0.04 * p.fangs, noseZ - 0.082], 0.0105, 0.0014)), { bone: 'jaw', w: 0.002 * hs, tags: ['fang'], grip: 3 });
    }
  }
  body.addLate('tongue', H(ell([0, -0.062, 0.1 + noseZ * 0.3], [0.024 * mw, 0.008, noseZ * 0.36])), { bone: 'jaw', w: 0.004 * hs, tags: ['tongue'], grip: 3 });

  // ears: broad rounded cat ears
  for (const [sd, sx] of sides) {
    const eb: Vec3 = [sx * 0.092 * sw, 0.07, -0.035];
    const dir = vnorm([sx * 0.66, 0.68, -0.3]);
    const len = 0.07 * p.earSize;
    const tip = vadd(eb, vscale(dir, len));
    const facing = vnorm([sx * 0.32, 0.12, 0.94]);
    body.add(`ear_${sd}`, H(flatCone(eb, tip, 0.062 * p.earSize, 0.04 * p.earSize, 0.4, facing)), { bone: `ear_${sd}`, w: 0.022 * hs, tags: ['ear'], grip: 2 });
    const mid = vlerp(eb, tip, 0.5);
    body.cut(`ear_dish_${sd}`, H(ell(vadd(mid, vscale(facing, 0.026)), [0.03 * p.earSize, 0.044 * p.earSize, 0.016], qeuler(0, sx * 0.3, 0))), { bone: `ear_${sd}`, w: 0.012 * hs, tags: ['ear_inner'] });
  }

  // ------------------------------------------------------------------ fur masses + helper for curved lock/flame
  /** chain of flat cones along `pts` (base first) with radii `rs`; `facing` is the flat face normal */
  const lock = (name: string, pts: Vec3[], rs: number[], flat: number, facing: Vec3, bone: string, tags: string[], w = 0.02): void => {
    for (let i = 0; i < pts.length - 1; i++) {
      body.add(`${name}_${i}`, flatCone(pts[i]!, pts[i + 1]!, rs[i]! * s, rs[i + 1]! * s, flat, facing), { bone, w: R(w), tags });
    }
  };

  for (const [sd, sx] of sides) {
    // cheek ruff: swept-back side-whiskers (three overlapping tufts)
    const n = Math.round(1 + 2 * Math.min(p.cheekRuff, 1.6));
    for (let i = 0; i < n; i++) {
      const b: Vec3 = [sx * (0.1 * sw + 0.004 * i), -0.03 - 0.025 * i, 0.005 - 0.015 * i];
      const dir = vnorm([sx * (0.45 + 0.08 * i), -0.28 - 0.18 * i, -0.78]);
      const len = (0.08 + 0.03 * p.cheekRuff) * (1 - 0.1 * i);
      const tip = vadd(b, vscale(dir, len));
      body.add(`cheek_ruff_${sd}${i}`, H(flatCone(b, tip, 0.04, 0.0055, 0.5, vnorm([sx * 0.9, 0.2, 0.2]))), { bone: 'head', w: 0.022 * hs, tags: ['ruff', 'cheek'], grip: 1.5 });
    }
  }
  // chest ruff / bib
  body.add('chest_fluff', ell([0, st5.y - st5.hh * 0.62, st5.z + R(0.1)], [R(0.1) * cw, R(0.1) * (0.8 + 0.4 * Math.min(p.mane, 1.5)), R(0.12)], qeuler(0.45, 0, 0)), { bone: 'chest', w: R(0.07), tags: ['ruff', 'chest'] });

  // ------------------------------------------------------------------ mane (lion / fire / flame)
  const nAxis = vnorm(vsub(neckB, neckA));
  const nLen = vlen(vsub(neckB, neckA));
  const perpA: Vec3 = vnorm(vcross(nAxis, [1, 0, 0]));
  if (hasMane(a)) {
    // Chunky locks in three rings (halo around the head, mid neck, shoulders). Each lock leaves the neck outward before sweeping
    // back so the ring reads as a silhouette; flame style curls the tips upward.
    const mk0 = p.mane;
    const flame = p.maneStyle === 'flame';
    const back: Vec3 = vscale(nAxis, -1);
    for (let r = 0; r < 3; r++) {
      const t = 0.86 - r * 0.34;
      const ctr = vadd(neckA, vscale(nAxis, nLen * t));
      const rad = (0.2 - 0.055 * t) * nt * s;
      const cnt = 8 + r * 2;
      for (let i = 0; i < cnt; i++) {
        const th = ((i + 0.5 * (r % 2)) / cnt) * Math.PI * 2;
        const radial: Vec3 = vadd(vscale([1, 0, 0], Math.cos(th)), vscale(perpA, Math.sin(th)));
        if (radial[1] < -0.5) continue; // nothing under the chin; the bib covers it
        const base: Vec3 = vadd(ctr, vscale(radial, rad * 0.8));
        const len = (0.2 + 0.07 * r) * mk0 * s * (0.85 + 0.35 * rng.next());
        const tangent: Vec3 = vnorm(vcross(radial, nAxis));
        const wid = (0.06 + 0.012 * r) * (0.8 + 0.2 * mk0);
        const mid = vadd(base, vscale(vnorm(vadd(vscale(radial, flame ? 0.75 : 0.8), vscale(back, (flame ? 0.55 : 0.5) + 0.15 * r))), len * 0.5));
        let tip: Vec3;
        if (flame) {
          const up: Vec3 = [0, 1, 0];
          tip = vadd(vadd(mid, vscale(vnorm(vadd(vadd(vscale(back, 0.85), vscale(radial, 0.2)), vscale(up, 0.4 + 0.35 * ((i + r) % 3) / 2))), len * 0.66)), vscale(tangent, (((i + r) % 2) * 2 - 1) * len * 0.1));
        } else {
          tip = vadd(mid, vscale(vnorm(vadd(vadd(vscale(back, 0.85), vscale(radial, 0.25)), [0, -0.22 - 0.1 * r, 0])), len * 0.6));
        }
        const isBoss = p.kind === 'boss';
        const maneBone =
          r === 2 && Math.abs(radial[0]) <= 0.55
            ? isBoss ? 'mane_b' : 'chest'
            : radial[0] > 0.25
              ? 'mane_l'
              : radial[0] < -0.25
                ? 'mane_r'
                : isBoss && r > 0
                  ? 'mane_b'
                  : r === 0
                    ? 'neck'
                    : 'chest';
        lock(`mane_${r}_${i}`, [base, mid, tip], [wid, wid * 0.82, wid * 0.14], flame ? 0.5 : 0.7, tangent, maneBone, ['mane', flame ? 'flame' : 'fur'], 0.012);
      }
    }
  }

  // ------------------------------------------------------------------ legs
  for (const [sd, sx] of sides) {
    const f = a.front;
    const sh = mk(sx, f.shoulder), el = mk(sx, f.elbow), wr = mk(sx, f.wrist), fe = mk(sx, f.fetlock);
    body.add(`arm_${sd}`, new RoundCone(sh, el, R(0.125) * lt, R(0.084) * lt), { bone: `arm_${sd}`, w: R(0.07), tags: ['leg', 'leg_f', 'upper_leg'] });
    body.add(`elbow_${sd}`, new Sphere(vadd(el, V(sx * 0.012, 0.0, -0.032)), R(0.07) * lt), { bone: `forearm_${sd}`, w: R(0.05), tags: ['leg', 'leg_f', 'upper_leg'] });
    body.add(`forearm_${sd}`, new RoundCone(el, wr, R(0.082) * lt, R(0.05) * lt), { bone: `forearm_${sd}`, w: R(0.04), tags: ['leg', 'leg_f', 'lower_leg'] });
    body.add(`wrist_${sd}`, new Sphere(vadd(wr, V(0, 0.008, -0.012)), R(0.052) * lt), { bone: `hand_${sd}`, w: R(0.025), tags: ['leg', 'leg_f', 'lower_leg'] });
    body.add(`pastern_${sd}`, new RoundCone(wr, fe, R(0.05) * lt, R(0.046) * lt), { bone: `hand_${sd}`, w: R(0.03), tags: ['leg', 'leg_f', 'lower_leg'] });
    const pc: Vec3 = [fe[0], R(0.034) * pawS, fe[2] + R(0.05) * pawS];
    body.add(`paw_${sd}`, ell(pc, [R(0.068) * pawS, R(0.04) * pawS, R(0.098) * pawS]), { bone: `hand_${sd}`, w: R(0.022), tags: ['paw'], grip: 1.5 });
    for (let k = 0; k < 4; k++) {
      const off = k - 1.5;
      const tx = pc[0] + off * R(0.032) * pawS * (sx === 1 ? 1 : 1);
      const tz = pc[2] + R(0.083) * pawS - Math.abs(off) * R(0.012) * pawS;
      body.add(`toe_f_${sd}${k}`, ell([tx, R(0.026) * pawS, tz], [R(0.0185) * pawS, R(0.025) * pawS, R(0.03) * pawS]), { bone: `hand_${sd}`, w: R(0.004), tags: ['paw', 'toe'], grip: 1.5 });
      if (p.claws > 0.05) {
        const cl = p.claws;
        body.addLate(`claw_f_${sd}${k}`, new RoundCone([tx, R(0.02) * pawS, tz + R(0.018) * pawS], [tx, R(0.004) * pawS, tz + R(0.018 + 0.036 * cl) * pawS], R(0.0075) * pawS, R(0.001)), { bone: `hand_${sd}`, w: R(0.002), tags: ['claw'], grip: 1.5 });
      }
    }
    // dewclaw
    body.add(`dew_${sd}`, ell(vadd(wr, V(sx * 0.03, -0.045, 0.0)), [R(0.014), R(0.02), R(0.014)]), { bone: `hand_${sd}`, w: R(0.01), tags: ['paw', 'toe'] });

    const h = a.hind;
    const hip = mk(sx, h.hip), st = mk(sx, h.stifle), hk = mk(sx, h.hock), hfe = mk(sx, h.fetlock);
    body.add(`thigh_${sd}`, new RoundCone(hip, st, R(0.145) * lt, R(0.092) * lt), { bone: `thigh_${sd}`, w: R(0.08), tags: ['leg', 'leg_h', 'upper_leg'] });
    body.add(`stifle_${sd}`, new Sphere(vadd(st, V(sx * 0.01, 0.0, 0.025)), R(0.068) * lt), { bone: `shin_${sd}`, w: R(0.05), tags: ['leg', 'leg_h', 'upper_leg'] });
    body.add(`shin_${sd}`, new RoundCone(st, hk, R(0.092) * lt, R(0.056) * lt), { bone: `shin_${sd}`, w: R(0.045), tags: ['leg', 'leg_h', 'upper_leg'] });
    body.add(`hock_${sd}`, new Sphere(vadd(hk, V(0, 0.01, -0.012)), R(0.054) * lt), { bone: `foot_${sd}`, w: R(0.035), tags: ['leg', 'leg_h', 'lower_leg'] });
    body.add(`calcaneus_${sd}`, new RoundCone(vadd(hk, V(0, 0.02, -0.01)), vadd(hk, V(0, 0.055, -0.055)), R(0.034) * lt, R(0.02) * lt), { bone: `foot_${sd}`, w: R(0.02), tags: ['leg', 'leg_h', 'lower_leg'] });
    body.add(`meta_${sd}`, new RoundCone(hk, hfe, R(0.052) * lt, R(0.042) * lt), { bone: `foot_${sd}`, w: R(0.03), tags: ['leg', 'leg_h', 'lower_leg'] });
    const hpc: Vec3 = [hfe[0], R(0.034) * pawS, hfe[2] + R(0.056) * pawS];
    body.add(`paw_h_${sd}`, ell(hpc, [R(0.058) * pawS, R(0.037) * pawS, R(0.098) * pawS]), { bone: `toe_${sd}`, w: R(0.02), tags: ['paw'], grip: 1.5 });
    for (let k = 0; k < 4; k++) {
      const off = k - 1.5;
      const tx = hpc[0] + off * R(0.027) * pawS;
      const tz = hpc[2] + R(0.08) * pawS - Math.abs(off) * R(0.01) * pawS;
      body.add(`toe_h_${sd}${k}`, ell([tx, R(0.024) * pawS, tz], [R(0.016) * pawS, R(0.023) * pawS, R(0.028) * pawS]), { bone: `toe_${sd}`, w: R(0.004), tags: ['paw', 'toe'], grip: 1.5 });
      if (p.claws > 0.05) {
        const cl = p.claws;
        body.addLate(`claw_h_${sd}${k}`, new RoundCone([tx, R(0.018) * pawS, tz + R(0.016) * pawS], [tx, R(0.004) * pawS, tz + R(0.016 + 0.032 * cl) * pawS], R(0.0068) * pawS, R(0.001)), { bone: `toe_${sd}`, w: R(0.002), tags: ['claw'], grip: 1.5 });
      }
    }
    // fur: elbow fringe + thigh britches + hock tuft (smooth masses, not thorns)
    body.add(`elbow_fur_${sd}`, ell(vadd(vlerp(sh, el, 0.95), V(0, 0, -0.04)), [R(0.03), R(0.07), R(0.042)], qeuler(0.35, 0, 0)), { bone: `forearm_${sd}`, w: R(0.03), tags: ['tuft', 'leg'] });
    body.add(`thigh_fur_${sd}`, ell(vadd(vlerp(hip, st, 0.45), V(0, -0.01, -0.07)), [R(0.04), R(0.1), R(0.055)], qeuler(-0.3, 0, 0)), { bone: `thigh_${sd}`, w: R(0.04), tags: ['tuft', 'leg'] });
  }

  // ------------------------------------------------------------------ tail
  const tailPts = a.tail;
  const tr = a.tailR;
  const prof: [number, number][] = tr.map((r, i) => [i / (tr.length - 1), r]);
  const segs = tubeSegments(tailPts, prof, { segments: 20 });
  const tNames = tailBoneNames(a.tailBones);
  segs.forEach((sg, i) => {
    const bone = tNames[Math.min(tNames.length - 1, Math.floor(sg.t0 * tNames.length * 0.999 + 0.0))]!;
    body.add(`tail_${i}`, sg.sdf, { bone, w: R(0.04), tags: ['tail', sg.t0 > 0.82 ? 'tail_tip' : 'tail_body'] });
  });

  // ------------------------------------------------------------------ dorsal ridge (crystals / embers / gilt spines)
  if (p.ridge !== 'none') {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const z = st5.z + R(0.0) - k * (st5.z - st1.z + R(0.06));
      const topSt = [...a.stations].reverse().find((q) => q.z <= z + 0.001) ?? a.stations[3]!;
      const y = topSt.y + topSt.hh * 0.92;
      const sizeK = (p.ridge === 'crystal' ? 1 : 0.8) * (0.55 + 0.7 * Math.sin(Math.PI * Math.min(1, k * 0.85 + 0.12)));
      const jit = p.ridge === 'ember' ? 0.75 + 0.6 * ((Math.sin(i * 12.9898 + p.seed) * 43758.5453) % 1 + 1) % 1 : 1;
      const len = (p.ridge === 'crystal' ? 0.2 : 0.15) * sizeK * jit;
      const lean = p.ridge === 'crystal' ? 0.25 : 0.55;
      const base: Vec3 = [0, y - R(0.02), z];
      const tip: Vec3 = [(i % 2 ? 1 : -1) * R(0.02), y + R(len), z - R(lean * len)];
      body.add(`ridge_${i}`, flatCone(base, tip, R(p.ridge === 'crystal' ? 0.052 : 0.04) * (0.8 + 0.5 * sizeK), R(0.006), p.ridge === 'crystal' ? 0.5 : 0.4, [1, 0.1, 0]), { bone: k < 0.45 ? 'chest' : 'spine', w: R(0.03), tags: ['ridge'] });
    }
  }

  // ------------------------------------------------------------------ horns (fire tiger)
  if (p.horns > 0.05) {
    for (const [sd, sx] of sides) {
      const hb: Vec3 = [sx * 0.07 * sw, 0.08, 0.05];
      const hp1: Vec3 = [sx * 0.11 * sw, 0.12 + 0.02 * p.horns, 0.0];
      const hp2: Vec3 = [sx * 0.135 * sw, 0.14 + 0.035 * p.horns, -0.07 - 0.02 * p.horns];
      const hp3: Vec3 = [sx * 0.125 * sw, 0.115 + 0.04 * p.horns, -0.15 - 0.03 * p.horns];
      const segsH = tubeSegments([hb, hp1, hp2, hp3], [[0, 0.034], [0.5, 0.024], [1, 0.005]], { segments: 6 });
      segsH.forEach((sg, i) => body.add(`horn_${sd}${i}`, H(sg.sdf), { bone: 'head', w: 0.012 * hs, tags: ['horn'], grip: 2 }));
    }
  }

  // ------------------------------------------------------------------ gilt regalia (tiger god)
  if (p.regalia) {
    // collar ring, bracers, crest, tail bands
    const cc = vadd(neckA, vscale(nAxis, nLen * 0.42));
    const rr = (0.2 - 0.055 * 0.42) * nt * s;
    body.add('collar', new Torus(cc, rr * 0.98, R(0.042), nAxis), { bone: 'neck', w: R(0.012), tags: ['gilt', 'collar'] });
    body.add('collar_gem', ell(vadd(cc, [0, -rr * 0.98, R(0.02)]), [R(0.07), R(0.085), R(0.05)], qeuler(0.4, 0, 0)), { bone: 'neck', w: R(0.012), tags: ['gilt', 'gem'] });
    for (const [sd, sx] of sides) {
      const f = a.front;
      const el = mk(sx, f.elbow), wr = mk(sx, f.wrist);
      const bc = vlerp(el, wr, 0.62);
      const axis = vnorm(vsub(wr, el));
      body.add(`bracer_${sd}`, new Torus(bc, R(0.066) * lt, R(0.03), axis), { bone: `forearm_${sd}`, w: R(0.008), tags: ['gilt', 'bracer'] });
      body.add(`bracer_b_${sd}`, new Torus(vlerp(el, wr, 0.78), R(0.056) * lt, R(0.022), axis), { bone: `forearm_${sd}`, w: R(0.008), tags: ['gilt', 'bracer'] });
    }
    // forehead crest: a swept flame-shaped plate with a gem (head-local points -> world)
    const crest = ([[0, 0.085, 0.1], [0, 0.125, 0.07], [0, 0.155, 0.0], [0, 0.16, -0.09]] as Vec3[]).map(hlw);
    lock('crest', crest, [0.06 * p.headScale, 0.055 * p.headScale, 0.04 * p.headScale, 0.012], 0.4, [1, 0, 0], 'head', ['gilt', 'crest'], 0.01);
    body.add('crest_gem', new Sphere(hlw([0, 0.11, 0.095]), R(0.02) * p.headScale), { bone: 'head', w: R(0.006), tags: ['gilt', 'gem'], grip: 2 });
    // lamellar pauldrons over the shoulder blades, with swept flame spikes
    const disc = (name: string, c: Vec3, n: Vec3, rx: number, ry: number, th: number, bone: string, tags: string[]): void => {
      body.add(name, new Ellipsoid(c, [R(rx), R(ry), R(th)], qfromTo([0, 0, 1], vnorm(n))), { bone, w: R(0.01), tags });
    };
    for (const [sd, sx] of sides) {
      const sh = a.front.shoulder;
      const pc: Vec3 = [sx * (sh[0] * 0.92 + R(0.11)), sh[1] + R(0.11 + 0.05 * p.shoulderRise), sh[2] - R(0.02)];
      disc(`pauldron_${sd}`, pc, [sx * 0.85, 0.55, 0.0], 0.19, 0.2, 0.034, 'chest', ['gilt', 'plate']);
      disc(`pauldron_rim_${sd}`, vadd(pc, [sx * R(0.012), R(0.012), R(-0.03)]), [sx * 0.85, 0.55, 0.0], 0.15, 0.155, 0.042, 'chest', ['gilt', 'plate']);
      for (let k = 0; k < 3; k++) {
        const b: Vec3 = vadd(pc, [sx * R(0.02), R(0.02), R(-0.05 + 0.05 * k)]);
        const tp: Vec3 = vadd(b, [sx * R(0.07 - 0.015 * k), R(0.1 + 0.03 * k), R(-0.12 - 0.04 * k)]);
        body.add(`pauldron_spike_${sd}${k}`, flatCone(b, tp, R(0.03), R(0.005), 0.5, [sx, 0.2, 0]), { bone: 'chest', w: R(0.008), tags: ['gilt', 'plate'] });
      }
    }
    // breastplate with a jade-like gem
    const bp: Vec3 = [0, st5.y - st5.hh * 0.12, st5.z + st5.hl * 0.98];
    disc('breastplate', bp, [0, -0.2, 1], 0.14 * cw, 0.17, 0.03, 'chest', ['gilt', 'plate']);
    body.add('breast_gem', ell(vadd(bp, [0, R(0.01), R(0.03)]), [R(0.045), R(0.06), R(0.03)]), { bone: 'chest', w: R(0.006), tags: ['gilt', 'gem'] });
    for (let i = 1; i <= 3; i++) {
      const ti = Math.min(tailPts.length - 1, i + 1);
      const tp = tailPts[ti - 1]!, tq = tailPts[ti]!;
      const c = vlerp(tp, tq, 0.5);
      body.add(`tail_band_${i}`, new Torus(c, tr[ti]! * 1.02, R(0.022), vsub(tq, tp)), { bone: tNames[Math.min(tNames.length - 1, ti - 1)]!, w: R(0.008), tags: ['gilt', 'band'] });
    }
  }

  // ------------------------------------------------------------------ war plates (fire tiger): shoulder + hip armour, forehead plate, bracers, bladed tail
  if (p.plates && !p.regalia) {
    const plate = (name: string, c: Vec3, n: Vec3, rx: number, ry: number, th: number, bone: string): void => {
      body.add(name, new Ellipsoid(c, [R(rx), R(ry), R(th)], qfromTo([0, 0, 1], vnorm(n))), { bone, w: R(0.01), tags: ['plate'] });
    };
    for (const [sd, sx] of sides) {
      const sh = a.front.shoulder;
      const pc: Vec3 = [sx * (sh[0] * 0.92 + R(0.13)), sh[1] + R(0.12 + 0.05 * p.shoulderRise), sh[2] - R(0.02)];
      plate(`wp_pauldron_${sd}`, pc, [sx * 0.85, 0.55, 0.0], 0.2, 0.2, 0.038, 'chest');
      plate(`wp_pauldron_rim_${sd}`, vadd(pc, [sx * R(0.014), R(0.014), R(-0.03)]), [sx * 0.85, 0.55, 0.0], 0.15, 0.155, 0.048, 'chest');
      for (let k = 0; k < 3; k++) {
        const b: Vec3 = vadd(pc, [sx * R(0.02), R(0.02), R(-0.05 + 0.05 * k)]);
        const tp: Vec3 = vadd(b, [sx * R(0.07 - 0.015 * k), R(0.11 + 0.035 * k), R(-0.13 - 0.04 * k)]);
        body.add(`wp_spike_${sd}${k}`, flatCone(b, tp, R(0.032), R(0.005), 0.5, [sx, 0.2, 0]), { bone: 'chest', w: R(0.008), tags: ['plate'] });
      }
      const hp = a.hind.hip;
      const hc: Vec3 = [sx * (hp[0] + R(0.16)), hp[1] + R(0.02), hp[2] + R(0.02)];
      plate(`wp_hip_${sd}`, hc, [sx * 0.95, 0.3, 0.0], 0.2, 0.2, 0.036, `thigh_${sd}`);
      plate(`wp_hip_rim_${sd}`, vadd(hc, [sx * R(0.014), R(0.005), R(-0.025)]), [sx * 0.95, 0.3, 0.0], 0.15, 0.15, 0.046, `thigh_${sd}`);
      for (let k = 0; k < 2; k++) {
        const b: Vec3 = vadd(hc, [sx * R(0.02), R(0.04 - 0.05 * k), R(-0.04 - 0.03 * k)]);
        const tp: Vec3 = vadd(b, [sx * R(0.06), R(0.07 + 0.03 * k), R(-0.15 - 0.04 * k)]);
        body.add(`wp_hip_spike_${sd}${k}`, flatCone(b, tp, R(0.03), R(0.005), 0.5, [sx, 0.2, 0]), { bone: `thigh_${sd}`, w: R(0.008), tags: ['plate'] });
      }
      const f = a.front;
      const el = mk(sx, f.elbow), wr = mk(sx, f.wrist);
      body.add(`wp_bracer_${sd}`, new Torus(vlerp(el, wr, 0.62), R(0.066) * lt, R(0.03), vnorm(vsub(wr, el))), { bone: `forearm_${sd}`, w: R(0.008), tags: ['plate'] });
    }
    const wcrest = ([[0, 0.09, 0.1], [0, 0.135, 0.065], [0, 0.15, -0.02]] as Vec3[]).map(hlw);
    lock('wp_crest', wcrest, [0.05 * p.headScale, 0.045 * p.headScale, 0.008], 0.4, [1, 0, 0], 'head', ['plate'], 0.01);
    // bladed tail tip: a broad leaf lying flat so it reads from above
    const tipP = tailPts[tailPts.length - 1]!, prevP = tailPts[tailPts.length - 2]!;
    const td = vnorm([0, 0.25 * vsub(tipP, prevP)[1] / Math.max(1e-4, Math.abs(vsub(tipP, prevP)[2])) * 0.2 - 0.05, -1]);
    body.add('wp_tail_blade', flatCone(vadd(tipP, vscale(td, -R(0.04))), vadd(tipP, vscale(td, R(0.34))), R(0.1), R(0.012), 0.2, [0, 1, 0]), { bone: tNames[tNames.length - 1]!, w: R(0.01), tags: ['plate', 'blade'] });
  }

  // ------------------------------------------------------------------ surface lumpiness (hide folds, muscle asymmetry) + fur clumps
  body.displace(fbmField(noise, 8 / s, { octaves: 2 }), R(0.0028));
  const clumps = maskedField(voronoiField(noise, 30 / s, 'dome', [1, 1, 0.6]), (x, y, z) => {
    const dh = Math.hypot(x - a.head[0], y - a.head[1], (z - a.head[2]) * 0.8);
    return smoothstep(0.2 * s, 0.34 * s, dh) * smoothstep(0.1 * s, 0.25 * s, y);
  });
  body.displace(clumps, R(0.0025));
  return body;
}
