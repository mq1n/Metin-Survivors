// Ursine SDF body: barrel torso with shoulder hump, hump/neck/hip fur locks, heavy neck + broad head (brow, snout, nose pad, open-able
// jaw with fangs, round ears), columnar front legs with muscled forearms and 5-toed paws + claws, plantigrade hind legs
// (knee, calf, heel, sole), stub tail. Each part knows its bone and paint tags.
import { type Quat, type Vec3, qeuler, qfromBasis, qx, smoothstep, vadd, vcross, vdot, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { fbmField, maskedField, voronoiField } from '../../core/sdf/fields.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';
import { HEAD_ANCHORS } from './skeleton.ts';

export function makeBody(a: Anatomy, _skel: Skeleton): Body {
  const p = a.p;
  const s = a.s;
  const body = new Body();
  body.blend = 0.06 * s;
  const rng = new Rng(p.seed);
  const noise = new Noise(p.seed);
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  const R = (r: number): number => r * s;
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const sides: [string, number][] = [['l', 1], ['r', -1]];
  const mk = (sx: number, v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
  const ID: Quat = [0, 0, 0, 1];
  const ell = (c: Vec3, r: Vec3, q: Quat = ID): Ellipsoid => new Ellipsoid(c, r, q);
  const G = p.girth;
  const lt = p.legThick;
  const pawS = p.paw;
  const furK = p.fur;
  const lift = (p.legLength - 1) * 0.35;
  const st = Object.fromEntries(a.stations.map((q) => [q.name, q])) as Record<string, Anatomy['stations'][number]>;

  // ------------------------------------------------------------------ torso barrel
  for (const q of a.stations) {
    body.add(`torso_${q.name}`, ell([0, q.y, q.z], [q.hw, q.hh, q.hl]), { bone: q.bone, w: R(0.15), tags: ['torso'] });
  }
  // shoulder hump: the highest mass, over the front legs; scapula slabs ride the clavicle bones
  const humpC: Vec3 = [0, a.humpTop - R(0.2) * (0.8 + 0.2 * p.hump), R(0.36)];
  body.add('hump', ell(humpC, [R(0.18) * G, R(0.23) * (0.8 + 0.2 * p.hump), R(0.26)], qeuler(-0.22, 0, 0)), { bone: 'chest', w: R(0.12), tags: ['torso', 'hump'] });
  for (const [sd, sx] of sides) {
    body.add(`scapula_${sd}`, ell(V(sx * 0.215 * G, 1.12 + lift, 0.4), [R(0.1), R(0.2), R(0.22)], qeuler(-0.22, 0, sx * 0.14)), { bone: `clav_${sd}`, w: R(0.08), tags: ['torso'] });
    const hp = mk(sx, a.hind.hip);
    body.add(`haunch_${sd}`, ell([hp[0] + sx * R(0.035), hp[1] - R(0.02), hp[2] - R(0.02)], [R(0.15) * lt, R(0.29), R(0.27)], qeuler(0.18, 0, sx * -0.06)), { bone: `thigh_${sd}`, w: R(0.09), tags: ['torso', 'haunch'] });
  }

  // ------------------------------------------------------------------ neck (thick, short, sloping from the hump to the head)
  const neckA: Vec3 = V(0, 1.13 + lift, 0.52);
  const headBone = a.head;
  const neckB: Vec3 = [headBone[0], headBone[1] - R(0.02), headBone[2] + R(0.07)];
  body.add('neck', new RoundCone(neckA, neckB, R(0.25) * G, R(0.19)), { bone: 'neck', w: R(0.09), tags: ['neck'] });
  body.add('throat', new RoundCone(vadd(neckA, V(0, -0.1, 0.05)), vadd(neckB, V(0, -0.07, 0.02)), R(0.2), R(0.14)), { bone: 'neck', w: R(0.08), tags: ['neck', 'throat'] });

  // ------------------------------------------------------------------ head (head-local metres, placed with pitch)
  const hs = p.headScale * s;
  const H = (sdf: Sdf): Sdf => new Xform(sdf, a.skull, qx(a.headPitch), [hs, hs, hs]);
  const snl = p.snoutLength;
  const noseZ = 0.1 + 0.245 * snl;
  const squash = (c: Vec3, sdf: Sdf, sy: number): Sdf => new Xform(new Xform(sdf, vscale(c, -1)), c, ID, [1, sy, 1]);
  const hb = { bone: 'head', grip: 2 };

  body.add('skull', H(ell([0, 0, 0], [0.165, 0.15, 0.17])), { ...hb, w: 0.05 * hs, tags: ['head'] });
  body.add('forehead', H(ell([0, 0.045, 0.035], [0.12, 0.105, 0.14])), { ...hb, w: 0.05 * hs, tags: ['head'] });
  for (const [sd, sx] of sides) {
    // brow ridges slanted inward (the glowering read), cheeks, jowls
    body.add(`brow_${sd}`, H(ell([sx * 0.074, 0.083, 0.112], [0.06, 0.032, 0.068], qeuler(0, sx * -0.15, sx * 0.34))), { ...hb, w: 0.03 * hs, tags: ['head', 'brow'] });
    body.add(`cheek_${sd}`, H(ell([sx * 0.118, -0.05, 0.035], [0.07, 0.085, 0.105])), { ...hb, w: 0.04 * hs, tags: ['cheek', 'head'] });
    body.add(`jowl_${sd}`, H(ell([sx * 0.052, -0.07, noseZ * 0.55], [0.034, 0.03, 0.09])), { ...hb, w: 0.025 * hs, tags: ['muzzle', 'head'] });
  }
  // muzzle: a stout wedge (stop at the brow, narrowing toward the nose leather) with hanging flews
  body.add('snout', H(squash([0, -0.03, 0.15], new RoundCone([0, -0.012, 0.09], [0, -0.04, noseZ - 0.05], 0.098, 0.064), 0.8)), { ...hb, w: 0.05 * hs, tags: ['muzzle', 'head'] });
  body.add('nose', H(ell([0, -0.036, noseZ - 0.012], [0.064, 0.042, 0.036])), { ...hb, w: 0.014 * hs, tags: ['nose'] });
  for (const [sd, sx] of sides) {
    body.add(`flew_${sd}`, H(ell([sx * 0.04, -0.066, 0.07 + (noseZ - 0.07) * 0.5], [0.03, 0.03, (noseZ - 0.07) * 0.5], qeuler(0.04, sx * -0.05, 0))), { ...hb, w: 0.016 * hs, tags: ['muzzle', 'head', 'flew'] });
  }
  // lower jaw (own bone: the mouth opens)
  const jb = { bone: 'jaw', grip: 2.5 };
  body.add('jaw', H(squash([0, -0.098, 0.12], new RoundCone([0, -0.092, 0.05], [0, -0.095, noseZ - 0.075], 0.06, 0.036), 0.76)), { ...jb, w: 0.03 * hs, tags: ['jaw', 'muzzle'] });
  body.add('chin', H(ell([0, -0.1, noseZ - 0.07], [0.034, 0.024, 0.03])), { ...jb, w: 0.016 * hs, tags: ['jaw', 'muzzle'] });
  const slitLen = (noseZ - 0.075) * 0.52;
  body.cut('mouth_slit', H(ell([0, -0.0745, 0.07 + slitLen], [0.1, 0.0085, slitLen])), { bone: 'head', w: 0.008 * hs, tags: ['lipline'] });
  for (const [sd, sx] of sides) {
    body.cut(`nostril_${sd}`, H(new Sphere([sx * 0.017, -0.032, noseZ + 0.018], 0.0085)), { bone: 'head', w: 0.005 * hs, tags: ['nostril'] });
    const ec: Vec3 = [sx * 0.082, 0.04, 0.122];
    const eq = qeuler(0, sx * 0.55, sx * -0.3);
    body.cut(`eye_socket_${sd}`, H(ell(ec, [0.024, 0.017, 0.026], eq)), { bone: 'head', w: 0.01 * hs, tags: [] });
    body.addLate(`eye_${sd}`, H(ell([ec[0] - sx * 0.003, ec[1], ec[2] - 0.003], [0.0135, 0.0105, 0.0135], eq)), { ...hb, w: 0.003 * hs, tags: ['eye'], grip: 3 });
    body.mark(`pupil_${sd}`, H(new Sphere([ec[0] + sx * 0.0078, ec[1], ec[2] + 0.0092], 0.0048)), ['pupil']);
    // fangs: upper canines hang over the lip line, lower ones rise inside it
    body.addLate(`fang_up_${sd}`, H(new RoundCone([sx * 0.044, -0.066, noseZ - 0.082], [sx * 0.043, -0.122, noseZ - 0.074], 0.0125, 0.0016)), { ...hb, w: 0.002 * hs, tags: ['fang'], grip: 3 });
    body.addLate(`fang_lo_${sd}`, H(new RoundCone([sx * 0.035, -0.098, noseZ - 0.1], [sx * 0.034, -0.04, noseZ - 0.092], 0.0105, 0.0014)), { ...jb, w: 0.002 * hs, tags: ['fang'], grip: 3 });
  }
  body.addLate('tongue', H(ell([0, -0.077, 0.07 + slitLen], [0.034, 0.0095, slitLen * 0.92])), { ...jb, w: 0.004 * hs, tags: ['tongue'], grip: 3 });

  // small round ears set wide and back: thick disks with an inner dish and a fur rim
  const ear = HEAD_ANCHORS.ear;
  for (const [sd, sx] of sides) {
    const dir = vnorm([sx * 0.5, 0.82, -0.26]);
    const facing = vnorm([sx * 0.62, 0.12, 0.78]);
    const c: Vec3 = vadd([sx * ear[0], ear[1], ear[2]], vscale(dir, 0.04 * p.earSize));
    const zAx = facing;
    const yAx = vnorm(vsub(dir, vscale(zAx, vdot(dir, zAx))));
    const xAx = vcross(yAx, zAx);
    const rot = qfromBasis(xAx, yAx, zAx);
    body.add(`ear_${sd}`, H(ell(c, [0.066 * p.earSize, 0.072 * p.earSize, 0.026 * p.earSize], rot)), { bone: `ear_${sd}`, w: 0.02 * hs, tags: ['ear'], grip: 2 });
    body.cut(`ear_dish_${sd}`, H(ell(vadd(c, vscale(facing, 0.03 * p.earSize)), [0.04 * p.earSize, 0.045 * p.earSize, 0.018 * p.earSize], rot)), { bone: `ear_${sd}`, w: 0.014 * hs, tags: ['ear_inner'] });
    body.add(`ear_fluff_${sd}`, H(ell([sx * (ear[0] - 0.012), ear[1] - 0.03, ear[2] - 0.005], [0.05, 0.04, 0.05])), { ...hb, w: 0.03 * hs, tags: ['head', 'ruff'] });
  }

  // ------------------------------------------------------------------ fur locks
  const surf = (q: Anatomy['stations'][number], th: number, dz = 0, push = 0.97): Vec3 => [q.hw * Math.cos(th) * push, q.y + q.hh * Math.sin(th) * push, q.z + dz];
  const outN = (q: Anatomy['stations'][number], th: number): Vec3 => vnorm([Math.cos(th) / q.hw, Math.sin(th) / q.hh, 0]);
  const rad = (d: number): number => (d * Math.PI) / 180;
  /** one fur tuft: two flat tapered cones from inside the body, leaving the surface then curling along `flow` and drooping; a bold wedge, pointed at the tip */
  const lock = (name: string, base: Vec3, flow: Vec3, len: number, width: number, normal: Vec3, liftM: number, bone: string, tags: string[], flat = 0.62): void => {
    const f = vnorm(flow);
    const n = vnorm(normal);
    const k = len * furK;
    const L = liftM * s;
    const hw0 = width * 0.5 * furK ** 0.5 * s;
    const mid: Vec3 = [base[0] + f[0] * k * 0.42 + n[0] * L * 0.8, base[1] + f[1] * k * 0.42 + n[1] * L * 0.8, base[2] + f[2] * k * 0.42 + n[2] * L * 0.8];
    const tip: Vec3 = [base[0] + f[0] * k + n[0] * L, base[1] + f[1] * k + n[1] * L - 0.14 * k, base[2] + f[2] * k + n[2] * L];
    const o = { bone, w: R(0.035), tags: ['fur', ...tags] };
    body.add(`${name}_a`, flatCone(base, mid, hw0, hw0 * 0.72, flat, n), o);
    body.add(`${name}_b`, flatCone(mid, tip, hw0 * 0.72, 0.016 * s, flat, n), o);
  };
  const jit = (): number => 0.85 + 0.35 * rng.next();

  // lower-flank fringe and hip skirt: short, thick, overlapping tufts hanging off the sides below the equator (fur skirt, not flaps)
  for (const [sd, sx] of sides) {
    const fringe: [string, [number, number][]][] = [
      ['chest', [[-32, 0.17]]], ['ribs', [[-22, 0.19], [-46, 0.18]]], ['belly', [[-30, 0.2], [-50, 0.18]]],
      ['loin', [[-24, 0.2], [-48, 0.18]]], ['hips', [[-12, 0.27], [-34, 0.25], [-56, 0.19]]], ['rump', [[-26, 0.22]]],
    ];
    for (const [nm, list] of fringe) {
      const q = st[nm]!;
      list.forEach(([deg, len], i) => {
        const th = sx > 0 ? rad(deg) : Math.PI - rad(deg);
        const hipSide = nm === 'hips' || nm === 'rump';
        const base = surf(q, th, (i % 2 === 0 ? -1 : 1) * R(0.05));
        lock(`fringe_${nm}_${sd}${i}`, base, [sx * (0.1 + 0.12 * (deg > -40 ? 1 : 0)), -1, hipSide ? -0.7 : -0.35], R(len * jit()), 0.15, outN(q, th), 0.03, q.bone, ['shag'], 0.85);
      });
    }
  }
  // dorsal crest: guard-hair wedges running back from the hump over the saddle to the rump
  {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const z = R(0.5) - k * R(0.62);
      const stz = [...a.stations].reverse().find((q) => q.z <= z + 0.001) ?? a.stations[0]!;
      const topY = z > R(0.12) ? humpC[1] + R(0.23) * (0.8 + 0.2 * p.hump) * Math.sqrt(Math.max(0.0, 1 - ((z - humpC[2]) / R(0.26)) ** 2)) : stz.y + stz.hh * 0.97;
      const xo = (i % 2 === 0 ? 1 : -1) * R(0.025);
      lock(`crest_${i}`, [xo, topY - R(0.05), z], [0, 0.1, -1], R((0.15 - 0.03 * k) * jit()), 0.1, [xo * 6, 1, 0.2], 0.012, k < 0.7 ? 'chest' : 'spine', ['mane']);
    }
  }
  // neck ruff: rings of locks sweeping back over the shoulders
  {
    const nA = neckA, nB = neckB;
    const ax = vnorm(vsub(nB, nA));
    const nLen = Math.hypot(...vsub(nB, nA));
    for (let rI = 0; rI < 2; rI++) {
      const t = 0.45 + rI * 0.35;
      const c = vadd(nA, vscale(ax, nLen * t));
      const radius = (0.27 - 0.07 * t) * G * s;
      const cnt = 8;
      for (let i = 0; i < cnt; i++) {
        const th = ((i + 0.5 * (rI % 2)) / cnt) * Math.PI * 2;
        const cx = Math.cos(th), cy = Math.sin(th);
        if (cy < -0.45) continue;
        const base: Vec3 = [c[0] + cx * radius * 0.84, c[1] + cy * radius * 0.84, c[2]];
        lock(`ruff_${rI}_${i}`, base, [cx * 0.3, cy * 0.12 - 0.2, -1], R((0.2 + 0.03 * rI) * jit()), 0.16, [cx, cy, 0.15], 0.03, 'neck', ['ruff']);
      }
    }
  }
  // cheek ruff (sweeping back/out/down) and chin beard
  for (const [sd, sx] of sides) {
    for (let i = 0; i < 3; i++) {
      const hp = a.headToWorld([sx * (0.15 + 0.004 * i), -0.04 - 0.035 * i, 0.01 - 0.045 * i]);
      lock(`cheek_ruff_${sd}${i}`, hp, [sx * 0.5, -0.3 - 0.12 * i, -1], R((0.15 + 0.03 * i) * jit()), 0.12, [sx, 0.1, 0.1], 0.025, 'head', ['ruff', 'cheek']);
    }
  }
  body.add('chin_fluff', H(ell([0, -0.125, noseZ - 0.16], [0.04, 0.03, 0.05])), { ...jb, w: 0.02 * hs, tags: ['jaw', 'ruff'] });
  // chest fluff under the throat
  body.add('chest_fluff', ell(V(0, 0.98 + lift, 0.68), [R(0.14) * G, R(0.2), R(0.15)], qeuler(0.5, 0, 0)), { bone: 'chest', w: R(0.1), tags: ['ruff', 'chest'] });

  // ------------------------------------------------------------------ legs
  for (const [sd, sx] of sides) {
    const f = a.front;
    const sh = mk(sx, f.shoulder), el = mk(sx, f.elbow), wr = mk(sx, f.wrist);
    // upper arm (a big triangle of muscle), elbow point, forearm that tapers to a narrow wrist, accessory carpal pad
    body.add(`arm_${sd}`, new RoundCone(sh, el, R(0.16) * lt, R(0.125) * lt), { bone: `arm_${sd}`, w: R(0.08), tags: ['leg', 'leg_f'] });
    body.add(`triceps_${sd}`, ell(vadd(vlerp(sh, el, 0.45), V(0, 0, -0.085)), [R(0.088) * lt, R(0.18), R(0.11)], qeuler(0.28, 0, 0)), { bone: `arm_${sd}`, w: R(0.06), tags: ['leg', 'leg_f'] });
    body.add(`elbow_${sd}`, ell(vadd(el, V(0, 0.01, -0.075)), [R(0.08) * lt, R(0.09), R(0.085)]), { bone: `forearm_${sd}`, w: R(0.04), tags: ['leg', 'leg_f'] });
    body.add(`forearm_${sd}`, new RoundCone(el, wr, R(0.125) * lt, R(0.08) * lt), { bone: `forearm_${sd}`, w: R(0.05), tags: ['leg', 'leg_f', 'lower_leg'] });
    body.add(`forearm_muscle_${sd}`, ell(vadd(vlerp(el, wr, 0.3), V(sx * 0.02, 0.0, 0.025)), [R(0.098) * lt, R(0.13), R(0.1)], qeuler(-0.12, 0, 0)), { bone: `forearm_${sd}`, w: R(0.05), tags: ['leg', 'leg_f', 'lower_leg'] });
    body.add(`carpal_${sd}`, ell(vadd(wr, V(0, -0.03, -0.05)), [R(0.056) * lt, R(0.07), R(0.07)], qeuler(0.3, 0, 0)), { bone: `hand_${sd}`, w: R(0.035), tags: ['leg', 'leg_f', 'lower_leg', 'paw'] });
    // paw: broad palm, five toe knuckles with long claws
    const pc: Vec3 = [wr[0], R(0.056) * pawS, wr[2] + R(0.105) * pawS];
    body.add(`paw_${sd}`, ell(pc, [R(0.098) * pawS, R(0.058) * pawS, R(0.15) * pawS]), { bone: `hand_${sd}`, w: R(0.035), tags: ['paw'], grip: 1.5 });
    const toeX = [-0.074, -0.037, 0, 0.037, 0.074];
    const toeZ = [-0.02, -0.003, 0.012, -0.002, -0.026];
    const clawL = [0.8, 0.98, 1.1, 1.0, 0.82];
    toeX.forEach((tx, k) => {
      const x = pc[0] + sx * tx * R(1) * pawS;
      const z = pc[2] + R(0.12 + toeZ[k]!) * pawS;
      body.add(`toe_f_${sd}${k}`, ell([x, R(0.034) * pawS, z], [R(0.0235) * pawS, R(0.034) * pawS, R(0.042) * pawS]), { bone: `hand_${sd}`, w: R(0.008), tags: ['paw', 'toe'], grip: 1.5 });
      const cl = p.claw * clawL[k]!;
      const a0: Vec3 = [x, R(0.05) * pawS, z + R(0.026) * pawS];
      const a1: Vec3 = [x, R(0.046) * pawS, z + R(0.026 + 0.045 * cl) * pawS];
      const a2: Vec3 = [x, R(0.018) * pawS, z + R(0.026 + 0.09 * cl) * pawS];
      body.addLate(`claw_f_${sd}${k}a`, new RoundCone(a0, a1, R(0.0125) * pawS, R(0.0098) * pawS), { bone: `hand_${sd}`, w: R(0.003), tags: ['claw'], grip: 1.5 });
      body.addLate(`claw_f_${sd}${k}b`, new RoundCone(a1, a2, R(0.0098) * pawS, R(0.0018)), { bone: `hand_${sd}`, w: R(0.003), tags: ['claw'], grip: 1.5 });
    });

    const h = a.hind;
    const hip = mk(sx, h.hip), stf = mk(sx, h.stifle), hk = mk(sx, h.hock), ba = mk(sx, h.ball);
    body.add(`thigh_${sd}`, new RoundCone(hip, stf, R(0.185) * lt, R(0.12) * lt), { bone: `thigh_${sd}`, w: R(0.08), tags: ['leg', 'leg_h'] });
    body.add(`knee_${sd}`, ell(vadd(stf, V(0, 0.0, 0.065)), [R(0.088) * lt, R(0.1), R(0.09)]), { bone: `shin_${sd}`, w: R(0.045), tags: ['leg', 'leg_h'] });
    body.add(`shin_${sd}`, new RoundCone(stf, hk, R(0.11) * lt, R(0.062) * lt), { bone: `shin_${sd}`, w: R(0.05), tags: ['leg', 'leg_h'] });
    body.add(`calf_${sd}`, ell(vadd(vlerp(stf, hk, 0.32), V(0, 0, -0.075)), [R(0.074) * lt, R(0.13), R(0.095)], qeuler(0.35, 0, 0)), { bone: `shin_${sd}`, w: R(0.05), tags: ['leg', 'leg_h'] });
    body.add(`heel_${sd}`, ell(vadd(hk, V(0, -0.05, -0.062)), [R(0.056) * lt, R(0.095), R(0.075)], qeuler(-0.4, 0, 0)), { bone: `foot_${sd}`, w: R(0.035), tags: ['leg', 'leg_h', 'lower_leg', 'paw'] });
    body.add(`meta_${sd}`, new RoundCone(hk, vadd(ba, V(0, 0.03, -0.04)), R(0.064) * lt, R(0.058) * lt), { bone: `foot_${sd}`, w: R(0.04), tags: ['leg', 'leg_h', 'lower_leg'] });
    const hpc: Vec3 = [ba[0], R(0.05) * pawS, ba[2] - R(0.08) * pawS];
    body.add(`sole_${sd}`, ell(hpc, [R(0.092) * pawS, R(0.052) * pawS, R(0.19) * pawS]), { bone: `foot_${sd}`, w: R(0.035), tags: ['paw'], grip: 1.5 });
    toeX.forEach((tx, k) => {
      const x = hpc[0] + sx * tx * pawS * 0.98;
      const z = ba[2] + R(0.092 + toeZ[k]! * 0.9) * pawS;
      body.add(`toe_h_${sd}${k}`, ell([x, R(0.032) * pawS, z], [R(0.0225) * pawS, R(0.032) * pawS, R(0.04) * pawS]), { bone: `toe_${sd}`, w: R(0.008), tags: ['paw', 'toe'], grip: 1.5 });
      const cl = p.claw * 0.72 * clawL[k]!;
      const a0: Vec3 = [x, R(0.046) * pawS, z + R(0.026) * pawS];
      const a1: Vec3 = [x, R(0.042) * pawS, z + R(0.026 + 0.04 * cl) * pawS];
      const a2: Vec3 = [x, R(0.016) * pawS, z + R(0.026 + 0.078 * cl) * pawS];
      body.addLate(`claw_h_${sd}${k}a`, new RoundCone(a0, a1, R(0.0115) * pawS, R(0.009) * pawS), { bone: `toe_${sd}`, w: R(0.003), tags: ['claw'], grip: 1.5 });
      body.addLate(`claw_h_${sd}${k}b`, new RoundCone(a1, a2, R(0.009) * pawS, R(0.0017)), { bone: `toe_${sd}`, w: R(0.003), tags: ['claw'], grip: 1.5 });
    });

    // leg fur: elbow fringe, forearm feathering, thigh britches, hock tuft
    const shagL = (nm: string, from: Vec3, to: Vec3, t: number, back: number, len: number, w: number, bone: string): void => {
      const ax = vnorm(vsub(to, from));
      const base = vadd(vlerp(from, to, t), V(0, 0, -back));
      lock(`${nm}_${sd}`, base, [ax[0] * 0.8 + sx * 0.08, ax[1] * 0.85, ax[2] * 0.85 - 0.5], R(len), w, [sx * 0.2, 0.05, -1], 0.018, bone, ['tuft', 'leg']);
    };
    shagL('elbow_lock', sh, el, 1.0, 0.075, 0.24, 0.16, `forearm_${sd}`);
    shagL('fore_lock0', el, wr, 0.18, 0.1, 0.22, 0.15, `forearm_${sd}`);
    shagL('fore_lock1', el, wr, 0.5, 0.085, 0.17, 0.13, `forearm_${sd}`);
    shagL('thigh_lock0', hip, stf, 0.35, 0.12, 0.26, 0.18, `thigh_${sd}`);
    shagL('thigh_lock1', hip, stf, 0.7, 0.09, 0.2, 0.15, `thigh_${sd}`);
    shagL('hock_lock', stf, hk, 0.75, 0.08, 0.17, 0.13, `foot_${sd}`);
  }

  // ------------------------------------------------------------------ stub tail
  {
    const t = a.tail;
    const tr = a.tailR;
    body.add('tail_0', new RoundCone(t[0]!, t[1]!, tr[0]!, tr[1]!), { bone: 'tail1', w: R(0.06), tags: ['tail', 'tail_body'] });
    body.add('tail_1', new RoundCone(t[1]!, t[2]!, tr[1]!, tr[2]!), { bone: 'tail2', w: R(0.05), tags: ['tail', 'tail_body'] });
    body.add('tail_tip', ell(vadd(t[2]!, V(0, -0.01, -0.01)), [R(0.055), R(0.06), R(0.075)], qeuler(0.4, 0, 0)), { bone: 'tail3', w: R(0.04), tags: ['tail', 'tail_tip'] });
  }

  // ------------------------------------------------------------------ surface lumpiness: muscle asymmetry, fur clumps, streaks along the coat
  body.displace(fbmField(noise, 6 / s, { octaves: 2 }), R(0.004));
  const clumps = maskedField(voronoiField(noise, 12 / s, 'dome', [1, 1, 0.5]), (x, y, z) => {
    const dh = Math.hypot(x - a.skull[0], y - a.skull[1], (z - a.skull[2]) * 0.8);
    return smoothstep(0.26 * s, 0.4 * s, dh) * smoothstep(0.14 * s, 0.3 * s, y);
  });
  body.displace(clumps, R(0.0035));
  return body;
}
