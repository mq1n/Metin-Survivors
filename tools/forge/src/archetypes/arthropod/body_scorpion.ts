// Scorpion SDF body: carapace with ocular tubercle + lateral eyes, 7 overlapping mesosoma tergites (keel, skirt, dorsal spine),
// 5-segment arched metasoma (barrel segments, keels, teeth) ending in a bulbous telson + hooked stinger, two pedipalp claws
// (arm / forearm / palm / fixed finger / hinged moving finger with teeth), chelicerae and 8 spined legs.
// Proportions are deliberately chunky: the crowd mesh has ~4.8k triangles, thin tubes would collapse in simplification.
import { type Quat, type Vec3, qeuler, vadd, vdot, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { Ellipsoid, RoundCone, RoundedBox, Sphere } from '../../core/sdf/primitives.ts';
import { flatCone, tubeSegments } from '../../core/sdf/shapes.ts';
import type { ScorpionAnatomy } from './anatomy.ts';
import { crystal, prism } from './crystal.ts';
import { addLeg } from './legs.ts';

const ID: Quat = [0, 0, 0, 1];
const ell = (c: Vec3, r: Vec3, q: Quat = ID): Ellipsoid => new Ellipsoid(c, r, q);
const rc = (a: Vec3, b: Vec3, ra: number, rb: number): RoundCone => new RoundCone(a, b, ra, rb);

export function scorpionBody(a: ScorpionAnatomy): Body {
  const p = a.p;
  const s = a.s;
  const st = p.stance;
  const bw = p.bodyWidth;
  const sp = p.spines;
  const rng = new Rng(p.seed);
  const body = new Body();
  body.blend = 0.014 * s;
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * st * s, z * s];
  const R = (r: number): number => r * s;

  // ------------------------------------------------------------------ prosoma (carapace)
  const pr = a.prosoma;
  body.add('carapace', new RoundedBox(pr.c, pr.r, pr.r[1] * 0.88), { bone: 'chest', w: R(0.024), tags: ['plate', 'prosoma'], grip: 1.3 });
  body.add('carapace_front', new RoundedBox(pr.frontC, pr.frontR, pr.frontR[1] * 0.85), { bone: 'chest', w: R(0.024), tags: ['plate', 'prosoma'], grip: 1.3 });
  for (const sx of [1, -1]) {
    // raised lateral rims + the lyre-shaped dorsal carinae
    body.add(`carapace_rim_${sx}`, ell(V(sx * 0.21 * bw, 0.31, 0.15), V(0.07 * bw, 0.052, 0.22), qeuler(0, sx * -0.1, sx * 0.22)), { bone: 'chest', w: R(0.016), tags: ['plate', 'prosoma'], grip: 1.3 });
    body.add(`lyre_${sx}`, rc(V(sx * 0.07, 0.4, 0.29), V(sx * 0.17, 0.385, -0.02), R(0.02), R(0.014)), { bone: 'chest', w: R(0.012), tags: ['keel', 'prosoma'], grip: 1.3 });
    body.cut(`face_groove_${sx}`, ell(V(sx * 0.12, 0.375, 0.235), V(0.009, 0.045, 0.1), qeuler(0, sx * 0.5, 0)), { bone: 'chest', w: R(0.006), tags: ['groove'] });
  }
  body.add('tubercle', ell(V(0, 0.415, 0.255), V(0.072, 0.05, 0.076)), { bone: 'chest', w: R(0.014), tags: ['plate', 'tubercle'], grip: 1.3 });
  body.cut('front_notch', ell(V(0, 0.3, 0.5), V(0.04, 0.07, 0.045)), { bone: 'chest', w: R(0.014), tags: [] });
  for (const sx of [1, -1]) {
    body.addLate(`eye_med_${sx}`, new Sphere(V(sx * 0.034, 0.448, 0.268), R(0.03)), { bone: 'chest', w: R(0.006), tags: ['eye'], grip: 2 });
    for (let i = 0; i < 3; i++) {
      body.addLate(`eye_lat_${sx}_${i}`, new Sphere(V(sx * (0.15 - 0.01 * i), 0.34, 0.385 - 0.036 * i), R(0.017 - 0.002 * i)), { bone: 'chest', w: R(0.005), tags: ['eye'], grip: 2 });
    }
    // chelicerae: blocky jaws with tiny pincers
    body.add(`chelicera_${sx}`, ell(V(sx * 0.082, 0.25, 0.5), V(0.062, 0.05, 0.07)), { bone: 'chest', w: R(0.014), tags: ['chelicera'], grip: 1.3 });
    body.addLate(`cheli_f1_${sx}`, rc(V(sx * 0.066, 0.24, 0.55), V(sx * 0.04, 0.21, 0.635), R(0.027), R(0.006)), { bone: 'chest', w: R(0.006), tags: ['chelicera', 'claw'], grip: 1.3 });
    body.addLate(`cheli_f2_${sx}`, rc(V(sx * 0.098, 0.24, 0.55), V(sx * 0.125, 0.21, 0.63), R(0.025), R(0.006)), { bone: 'chest', w: R(0.006), tags: ['chelicera', 'claw'], grip: 1.3 });
  }
  // shoulder thorns along the carapace flanks (silhouette breakers)
  if (sp > 0.05) {
    for (const sx of [1, -1]) {
      [[0.262, 0.31, 0.17], [0.252, 0.05, 0.16]].forEach(([x, z, len], i) => {
        const base = V(sx * x! * bw, 0.35, z!);
        body.addLate(`shoulder_thorn_${sx}_${i}`, crystal(vsub(base, [sx * R(0.025), 0, 0]), vnorm([sx * 0.85, 0.5, 0.3 - 0.25 * i]), R(len! * sp) + R(0.03), R(0.04), { sides: 5, tipFrac: 0.8, topFrac: 0.85, jitter: 0.06, rng }), { bone: 'chest', w: R(0.008), tags: ['spine', 'prosoma'], grip: 1.3 });
      });
    }
  }
  body.add('sternum', ell(V(0, 0.215, 0.12), V(0.17 * bw, 0.055, 0.24)), { bone: 'chest', w: R(0.018), tags: ['belly'], grip: 1.3 });

  // ------------------------------------------------------------------ mesosoma: 7 overlapping tergites
  a.plates.forEach((pl, k) => {
    body.add(`plate_${k}`, new RoundedBox([0, pl.y, pl.z], [pl.hw, pl.ry, pl.rz], Math.min(pl.ry, pl.rz) * 0.86), { bone: 'back', w: R(0.006), tags: ['plate', 'meso'], grip: 1.3 });
    body.add(`keel_${k}`, rc([0, pl.y + pl.ry * 0.9, pl.z + pl.rz * 0.5], [0, pl.y + pl.ry * 0.88, pl.z - pl.rz * 0.55], R(0.02), R(0.015)), { bone: 'back', w: R(0.008), tags: ['keel', 'meso'], grip: 1.3 });
    // seam groove between plates (deepens the crease so every tergite edge is visible)
    if (k > 0) body.cut(`seam_${k}`, ell([0, pl.y + pl.ry * 0.3, pl.z + pl.rz * 0.97], [pl.hw * 0.9, pl.ry * 0.9, R(0.007)]), { bone: 'back', w: R(0.004), tags: ['groove'] });
    if (sp > 0.05 && k % 2 === 1) {
      const h = (0.085 + 0.006 * k) * sp;
      body.addLate(`dspine_${k}`, crystal([0, pl.y + pl.ry * 0.7, pl.z - pl.rz * 0.25], [0, 1, -0.5], R(h) + pl.ry * 0.5, R(0.03), { sides: 5, tipFrac: 0.8, topFrac: 0.85, jitter: 0.05, rng }), { bone: 'back', w: R(0.005), tags: ['spine', 'meso'], grip: 1.3 });
    }
  });
  body.add('belly', ell(V(0, 0.215, -0.31), V(0.2 * bw, 0.05, 0.38)), { bone: 'back', w: R(0.018), tags: ['belly'], grip: 1.3 });
  // pectines (comb organs) under the belly
  for (const sx of [1, -1]) body.add(`pectine_${sx}`, flatCone(V(sx * 0.04, 0.2, -0.02), V(sx * 0.09, 0.16, -0.13), R(0.034), R(0.008), 0.3, [0, 0, 1]), { bone: 'back', w: R(0.008), tags: ['belly', 'spine'], grip: 1.3 });

  // ------------------------------------------------------------------ metasoma (tail): barrel segments, keels, teeth
  const tail = a.tail;
  const tr = a.tailR;
  for (let k = 0; k < 5; k++) {
    const A = tail[k]!, B = tail[k + 1]!;
    const d = vnorm(vsub(B, A));
    const mid = vlerp(A, B, 0.5);
    const bone = `tail${k + 1}`;
    const tg = ['tail', 'tailseg'];
    // each segment = an 8-sided chamfered barrel (the chamfers cut the ring grooves between segments); joint ball fills the arch wedge
    body.add(`tail${k}`, prism(A, B, tr[k]! * 0.98, tr[k + 1]! * 0.98, { sides: 8, side: [1, 0, 0], bevelA: 0.3, bevelB: 0.3 }), { bone, w: R(0.01), tags: tg, grip: 1.4 });
    if (k > 0) body.add(`tail_ball_${k}`, new Sphere(A, tr[k]! * 0.84), { bone, w: R(0.01), tags: tg, grip: 1.4 });
    // outward (dorsal) direction: away from the arch centre, perpendicular to the segment
    const ra = vsub(mid, a.arch);
    const out = vnorm(vsub(ra, vscale(d, vdot(ra, d))));
    const k0 = vadd(A, vscale(out, tr[k]! * 0.97)), k1 = vadd(B, vscale(out, tr[k + 1]! * 0.97));
    body.add(`tail_keel_${k}`, prism(vadd(k0, vscale(d, R(0.03))), vsub(k1, vscale(d, R(0.03))), R(0.024), R(0.02), { sides: 4, side: [1, 0, 0], bevelA: 0.4, bevelB: 0.4 }), { bone, w: R(0.008), tags: ['keel', 'tail'], grip: 1.4 });
    if (sp > 0.05) {
      const base = vadd(vsub(B, vscale(d, R(0.05))), vscale(out, tr[k + 1]! * 0.8));
      body.addLate(`tail_tooth_${k}`, crystal(base, vadd(out, vscale(d, 0.25)), R(0.06) * sp + tr[k + 1]! * 0.2, R(0.022), { sides: 4, tipFrac: 0.8, topFrac: 0.85, jitter: 0.04, rng }), { bone, w: R(0.005), tags: ['spine', 'tail'], grip: 1.4 });
    }
  }

  // telson: bulb + curved stinger + sub-aculear tooth
  const T = a.telson;
  body.add('telson', ell(T.c, [T.r * 0.92, T.r * 0.98, T.r * 1.2], qeuler(0.1, 0, 0)), { bone: 'tail5', w: R(0.014), tags: ['telson'], grip: 1.5 });
  const sting = tubeSegments(T.sting, (t) => T.stingR[0]! + (T.stingR[4]! - T.stingR[0]!) * Math.pow(t, 0.8), { segments: 5 });
  sting.forEach((sg, i) => body.add(`sting_${i}`, sg.sdf, { bone: 'tail5', w: R(0.012), tags: ['sting'], grip: 1.5 }));
  body.add('sting_tooth', rc(vadd(T.c, [0, -T.r * 0.72, R(0.05)]), vadd(T.c, [0, -T.r * 0.72 - R(0.036), R(0.07)]), R(0.016), R(0.004)), { bone: 'tail5', w: R(0.007), tags: ['sting'], grip: 1.5 });

  // ------------------------------------------------------------------ pedipalps (pincers)
  const cs = p.clawSize;
  for (const pl of a.palps) {
    const sd = pl.side === 1 ? 'l' : 'r';
    const arm = `arm_${sd}`, fore = `forearm_${sd}`, hand = `hand_${sd}`, fing = `finger_${sd}`;
    const side: Vec3 = pl.side === 1 ? [pl.hand[2], 0, -pl.hand[0]] : [-pl.hand[2], 0, pl.hand[0]];
    const sdUp: Vec3 = [0, 1, 0];
    const hinge = (c: Vec3, r: number, nm: string, bn: string): void => {
      body.add(nm, prism(vadd(c, [0, -r * 1.05, 0]), vadd(c, [0, r * 1.05, 0]), r, r * 0.9, { sides: 6, side: side, bevelA: 0.3, bevelB: 0.3 }), { bone: bn, w: R(0.012), tags: ['palp', 'joint'], grip: 1.4 });
    };
    body.add(`troch_${sd}`, new Sphere(pl.shoulder, R(0.088 * cs)), { bone: arm, w: R(0.018), tags: ['palp', 'joint'], grip: 1.4 });
    body.add(`arm_${sd}`, prism(pl.shoulder, pl.elbow, R(0.078 * cs), R(0.064 * cs), { sides: 6, side: sdUp, bevelA: 0.1, bevelB: 0.2 }), { bone: arm, w: R(0.018), tags: ['palp', 'arm'], grip: 1.4 });
    hinge(pl.elbow, R(0.076 * cs), `elbow_${sd}`, fore);
    body.add(`forearm_${sd}`, prism(pl.elbow, pl.wrist, R(0.07 * cs), R(0.086 * cs), { sides: 6, side: sdUp, bevelA: 0.15, bevelB: 0.25 }), { bone: fore, w: R(0.016), tags: ['palp', 'forearm'], grip: 1.4 });
    hinge(pl.wrist, R(0.084 * cs), `wrist_${sd}`, hand);
    // palm: chunky faceted block (flattened vertically), the hinge for the moving finger sits at its front
    const pa = vadd(pl.palm, vscale(pl.hand, -pl.palmR[2] * 0.95)), pb = vadd(pl.palm, vscale(pl.hand, pl.palmR[2] * 0.95));
    body.add(`palm_${sd}`, prism(pa, pb, pl.palmR[0], pl.palmR[0] * 0.92, { sides: 6, flat: pl.palmR[1] / pl.palmR[0], side, bevelA: 0.3, bevelB: 0.35 }), { bone: hand, w: R(0.016), tags: ['palp', 'palm'], grip: 1.4 });
    // forearm: 2 spines on the outer edge
    const along = vnorm(vsub(pl.wrist, pl.elbow));
    if (sp > 0.05) {
      for (let i = 0; i < 2; i++) {
        const t = 0.3 + 0.38 * i;
        const o = vnorm(vadd([0, 1, 0], vscale(side, 0.8)));
        const base = vadd(vlerp(pl.elbow, pl.wrist, t), vscale(o, R(0.07 * cs)));
        body.addLate(`forearm_spine_${sd}${i}`, crystal(vsub(base, vscale(o, R(0.02))), vadd(o, vscale(along, 0.3)), R(0.07) * sp, R(0.026), { sides: 4, tipFrac: 0.8, topFrac: 0.85, jitter: 0.04, rng }), { bone: fore, w: R(0.006), tags: ['spine', 'palp'], grip: 1.4 });
      }
    }
    const ft = [0.066, 0.06, 0.05, 0.033, 0.008].map((r) => R(r * cs));
    const mt = [0.058, 0.056, 0.046, 0.03, 0.008].map((r) => R(r * cs));
    for (let i = 0; i < 4; i++) {
      body.add(`fixed_${sd}${i}`, prism(pl.fixed[i]!, pl.fixed[i + 1]!, ft[i]!, ft[i + 1]!, { sides: 6, flat: 0.6, side: sdUp, bevelA: 0.15, bevelB: i === 3 ? 0.0 : 0.15 }), { bone: hand, w: R(0.01), tags: ['palp', 'finger', 'fixed'], grip: 1.4 });
      body.add(`moving_${sd}${i}`, prism(pl.moving[i]!, pl.moving[i + 1]!, mt[i]!, mt[i + 1]!, { sides: 6, flat: 0.6, side: sdUp, bevelA: 0.15, bevelB: i === 3 ? 0.0 : 0.15 }), { bone: fing, w: R(0.01), tags: ['palp', 'finger', 'moving'], grip: 2 });
    }
    // teeth along the inner edges (crystal-cut thorns pointing across the gap)
    for (let i = 1; i <= 2; i++) {
      const t = 0.3 + 0.25 * i;
      const idx = Math.min(3, Math.floor(t * 4));
      const f = vlerp(pl.fixed[idx]!, pl.fixed[idx + 1]!, t * 4 - idx);
      const m = vlerp(pl.moving[idx]!, pl.moving[idx + 1]!, t * 4 - idx);
      body.addLate(`tooth_f_${sd}${i}`, crystal(vadd(f, vscale(side, -R(0.03 * cs))), vscale(side, -1), R(0.05 * cs), R(0.016 * cs), { sides: 4, tipFrac: 0.8, topFrac: 0.8, jitter: 0, rng }), { bone: hand, w: R(0.005), tags: ['finger', 'tooth'], grip: 1.5 });
      body.addLate(`tooth_m_${sd}${i}`, crystal(vadd(m, vscale(side, R(0.027 * cs))), side, R(0.05 * cs), R(0.016 * cs), { sides: 4, tipFrac: 0.8, topFrac: 0.8, jitter: 0, rng }), { bone: fing, w: R(0.005), tags: ['finger', 'tooth'], grip: 2 });
    }
  }

  // ------------------------------------------------------------------ legs
  const lt = p.legThick;
  for (const l of a.legs) {
    addLeg(body, l, { s, femur: [0.062 * lt, 0.051 * lt], tibia: [0.05 * lt, 0.027 * lt], tarsus: [0.028 * lt, 0.015 * lt], knee: 0.06 * lt, coxa: 0.08, spines: [1, 2], spineLen: 0.075 * sp, spineR: 0.026, rng });
  }
  return body;
}
