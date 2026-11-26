// Frost beetle SDF body: pronotum hood + domed elytra pair (suture groove, ribs, rim) over a dark abdomen, wedge head with
// compound eyes, sickle mandibles, club antennae, a pair of faceted crystal horns, a fan of tall faceted ice spikes along the
// back (convex-polytope crystals = crisp planar facets) and six spined legs with hooked tarsi.
import { type Quat, type Vec3, qeuler, vadd, vlerp, vnorm } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { SmoothIntersect } from '../../core/sdf/ops.ts';

import { Ellipsoid, RoundCone, RoundedBox, Sphere } from '../../core/sdf/primitives.ts';
import { tubeSegments } from '../../core/sdf/shapes.ts';
import type { BeetleAnatomy } from './anatomy.ts';
import { crystal, crystalHorn } from './crystal.ts';
import { addLeg } from './legs.ts';

const ID: Quat = [0, 0, 0, 1];
const ell = (c: Vec3, r: Vec3, q: Quat = ID): Ellipsoid => new Ellipsoid(c, r, q);
const rc = (a: Vec3, b: Vec3, ra: number, rb: number): RoundCone => new RoundCone(a, b, ra, rb);

export function beetleBody(a: BeetleAnatomy): Body {
  const p = a.p;
  const s = a.s;
  const rng = new Rng(p.seed);
  const body = new Body();
  body.blend = 0.014 * s;
  const R = (r: number): number => r * s;
  const mx = (v: Vec3, sx: number): Vec3 => [v[0] * sx, v[1], v[2]];

  // ------------------------------------------------------------------ thorax: pronotum shield
  body.add('pronotum', new RoundedBox(a.pronotum.c, a.pronotum.r, a.pronotum.r[1] * 0.85), { bone: 'chest', w: R(0.02), tags: ['shell', 'pronotum'], grip: 1.3 });
  for (const sx of [1, -1]) {
    // pronotum shoulder points (edge spikes) and a raised rim
    const pc = a.pronotum.c, pr = a.pronotum.r;
    body.add(`pron_rim_${sx}`, rc([sx * pr[0] * 0.78, pc[1] - pr[1] * 0.1, pc[2] + pr[2] * 0.35], [sx * pr[0] * 0.96, pc[1] - pr[1] * 0.25, pc[2] - pr[2] * 0.4], R(0.035), R(0.03)), { bone: 'chest', w: R(0.014), tags: ['shell', 'rim'], grip: 1.3 });
    body.addLate(`pron_spike_${sx}`, crystal([sx * pr[0] * 0.8, pc[1] - pr[1] * 0.15, pc[2] + pr[2] * 0.2], vnorm([sx * 0.9, 0.25, 0.55]), R(0.17), R(0.045), { sides: 5, tipFrac: 0.45, jitter: 0.1, rng, side: [0, 1, 0] }), { bone: 'chest', w: R(0.012), tags: ['crystal', 'spike'], grip: 1.3 });
  }
  body.add('thorax_under', ell(mx(a.chest, 1), [R(0.2 * p.bodyWidth), R(0.11), R(0.2)]), { bone: 'chest', w: R(0.02), tags: ['belly'], grip: 1.3 });

  // ------------------------------------------------------------------ abdomen (dark, visible when the elytra part)
  const ab = a.abdomen;
  body.add('abdomen', ell(ab.c, ab.r), { bone: 'back', w: R(0.02), tags: ['abdomen'], grip: 1.3 });
  body.add('abdomen_tip', ell(vadd(ab.c, [0, -0.01 * s, -ab.r[2] * 0.75]), [ab.r[0] * 0.6, ab.r[1] * 0.75, ab.r[2] * 0.45]), { bone: 'back', w: R(0.016), tags: ['abdomen'], grip: 1.3 });

  // ------------------------------------------------------------------ elytra: two domed wing cases with rim + ribs
  for (const sx of [1, -1]) {
    const nm = sx === 1 ? 'l' : 'r';
    const bone = `elytra_${nm}`;
    const ec = a.elytra.c, er = a.elytra.r;
    const c: Vec3 = [sx * ec[0], ec[1], ec[2]];
    const rot = qeuler(0, 0, sx * -0.12);
    const elyShape = new SmoothIntersect([new RoundedBox(c, er, Math.min(er[0], er[1]) * 0.7, rot), new Ellipsoid(c, [er[0] * 1.22, er[1] * 1.12, er[2] * 1.16], rot)], R(0.04));
    body.add(`elytron_${nm}`, elyShape, { bone, w: R(0.014), tags: ['shell', 'elytra'], grip: 1.6 });
    body.add(`elytron_tip_${nm}`, ell([sx * ec[0] * 0.85, ec[1] - er[1] * 0.18, ec[2] - er[2] * 0.62], [er[0] * 0.78, er[1] * 0.72, er[2] * 0.5]), { bone, w: R(0.014), tags: ['shell', 'elytra'], grip: 1.6 });
    // outer rim ridge
    const rimPts: Vec3[] = [0, 1, 2, 3, 4].map((i) => {
      const t = i / 4;
      const z = ec[2] + er[2] * (0.7 - 1.45 * t);
      const k = Math.sqrt(Math.max(0.02, 1 - ((z - ec[2]) / er[2]) ** 2));
      return [sx * (ec[0] + er[0] * 0.88 * k), ec[1] - er[1] * 0.42 * (0.5 + 0.5 * k), z];
    });
    tubeSegments(rimPts, [[0, R(0.034)], [0.5, R(0.03)], [1, R(0.012)]], { segments: 4 }).forEach((sg, i) => body.add(`elytra_rim_${nm}${i}`, sg.sdf, { bone, w: R(0.01), tags: ['shell', 'rim'], grip: 1.6 }));
    // longitudinal ribs following the dome
    for (let r = 0; r < 2; r++) {
      const off = 0.34 + 0.34 * r;
      const pts: Vec3[] = [0, 1, 2, 3, 4].map((i) => {
        const z = ec[2] + er[2] * (0.62 - 1.2 * (i / 4));
        const dx = er[0] * off * (1 - 0.25 * (i / 4));
        const k = Math.sqrt(Math.max(0.03, 1 - (dx / er[0]) ** 2 - ((z - ec[2]) / er[2]) ** 2));
        return [sx * (ec[0] + dx), ec[1] + er[1] * k * 0.98, z];
      });
      tubeSegments(pts, [[0, R(0.02)], [0.6, R(0.018)], [1, R(0.008)]], { segments: 4 }).forEach((sg, i) => body.add(`elytra_rib_${nm}${r}${i}`, sg.sdf, { bone, w: R(0.008), tags: ['shell', 'rib'], grip: 1.6 }));
    }
  }
  body.cut('suture', ell([0, a.elytra.c[1] + a.elytra.r[1] * 0.78, a.elytra.c[2]], [R(0.007), R(0.1), a.elytra.r[2] * 0.97]), { bone: 'back', w: R(0.005), tags: ['groove'] });

  // ------------------------------------------------------------------ head
  const sk = a.skull;
  body.add('skull', ell(sk.c, sk.r, qeuler(0.2, 0, 0)), { bone: 'head', w: R(0.02), tags: ['head'], grip: 1.5 });
  body.add('clypeus', ell(vadd(sk.c, [0, -0.035 * s, 0.1 * s]), [R(0.115), R(0.052), R(0.072)], qeuler(0.3, 0, 0)), { bone: 'head', w: R(0.014), tags: ['head', 'clypeus'], grip: 1.5 });
  // upper teeth row along the muzzle edge (ivory fangs, the focal "grin")
  for (let i = 0; i < 5; i++) {
    const u = (i - 2) / 2;
    const tx = u * 0.085 * s;
    const tz = sk.c[2] + (0.152 - 0.03 * u * u) * s;
    body.addLate(`tooth_${i}`, crystal([tx, sk.c[1] - 0.052 * s, tz], vnorm([u * 0.25, -1, 0.35]), R(0.06 - 0.012 * Math.abs(u)), R(0.015), { sides: 4, tipFrac: 0.6, jitter: 0.05, rng }), { bone: 'head', w: R(0.004), tags: ['head', 'tooth'], grip: 2 });
  }
  for (const sx of [1, -1]) {
    const e = a.eye;
    body.add(`eye_${sx}`, ell([sx * e.c[0], e.c[1], e.c[2]], e.r, qeuler(0, sx * 0.4, sx * -0.3)), { bone: 'head', w: R(0.01), tags: ['eye'], grip: 2 });
    // brow ridge over each eye
    body.add(`brow_${sx}`, rc([sx * 0.05 * s, sk.c[1] + sk.r[1] * 0.8, sk.c[2] + sk.r[2] * 0.7], [sx * 0.125 * s, sk.c[1] + sk.r[1] * 0.55, sk.c[2] - sk.r[2] * 0.1], R(0.026), R(0.02)), { bone: 'head', w: R(0.01), tags: ['head', 'rim'], grip: 1.5 });
  }

  // mandibles: faceted ivory fangs (curved crystal horns) with an inner tooth, each on its own bone; short club antennae
  for (const sx of [1, -1]) {
    const nm = sx === 1 ? 'l' : 'r';
    const path = a.mandible.path.map((v) => mx(v, sx));
    body.addLate(`mand_${nm}`, crystalHorn(path, a.mandible.r, { sides: 5, jitter: 0.06, rng, w: R(0.006), side: [0, 1, 0] }), { bone: `mand_${nm}`, w: R(0.008), tags: ['mandible'], grip: 2 });
    const mid = vlerp(path[1]!, path[2]!, 0.45);
    body.addLate(`mand_tooth_${nm}`, crystal(vadd(mid, [sx * -0.012 * s, 0.006 * s, 0]), vnorm([sx * -0.6, 0.1, 0.8]), R(0.07), R(0.02), { sides: 4, tipFrac: 0.6, jitter: 0.05, rng }), { bone: `mand_${nm}`, w: R(0.005), tags: ['mandible', 'tooth'], grip: 2 });
    const ap = a.antenna.map((v) => mx(v, sx));
    tubeSegments(ap, [[0, R(0.022)], [0.8, R(0.014)], [1, R(0.012)]], { segments: 4 }).forEach((sg, i) => body.add(`ant_${nm}${i}`, sg.sdf, { bone: `ant_${nm}`, w: R(0.008), tags: ['antenna'], grip: 2 }));
    body.add(`ant_club_${nm}`, ell(ap[4]!, [R(0.03), R(0.024), R(0.048)], qeuler(0, sx * -0.4, 0)), { bone: `ant_${nm}`, w: R(0.008), tags: ['antenna', 'club'], grip: 2 });
  }

  // ------------------------------------------------------------------ crystals (late stage: not displaced, crisp facets)
  for (const sx of [1, -1]) {
    const hp = a.horn.path.map((v) => mx(v, sx));
    body.addLate(`horn_${sx}`, crystalHorn(hp, a.horn.r, { sides: 4, jitter: 0.07, rng, w: R(0.008), side: [0, 1, 0] }), { bone: 'head', w: R(0.014), tags: ['crystal', 'horn'], grip: 1.6 });
    // two side prongs on the horn's inner edge (antler)
    for (let i = 1; i <= 2; i++) {
      const b = vlerp(hp[i]!, hp[i + 1]!, 0.4);
      body.addLate(`horn_barb_${sx}${i}`, crystal(b, vnorm([sx * -0.55, 0.45, 0.55]), R(0.13 + 0.03 * i), R(0.028), { sides: 4, tipFrac: 0.55, jitter: 0.1, rng }), { bone: 'head', w: R(0.008), tags: ['crystal', 'horn'], grip: 1.6 });
    }
  }
  a.crystals.forEach((c, i) => {
    body.addLate(`crystal_${i}`, crystal(c.base, c.dir, c.len, c.r, { sides: 6, tipFrac: c.kind === 'main' ? 0.3 : 0.38, topFrac: 0.7, jitter: 0.12, rng, tipRot: 0.0, side: [1, 0, 0], twist: 0.2 * i }), { bone: c.bone, w: R(0.014), tags: ['crystal', c.kind === 'main' ? 'crest' : 'crest_side'], grip: 1.6 });
  });

  // ------------------------------------------------------------------ legs
  const lt = p.legThick;
  for (const l of a.legs) {
    addLeg(body, l, { s, femur: [0.058 * lt, 0.048 * lt], tibia: [0.046 * lt, 0.03 * lt], tarsus: [0.03 * lt, 0.018 * lt], knee: 0.056 * lt, coxa: 0.075, spines: [1, 2], spineLen: 0.05, spineR: 0.017, rng });
  }

  return body;
}
