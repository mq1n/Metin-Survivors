// Shared arthropod leg geometry, hard-surface style: faceted tapering femur / tibia / tarsus prisms, a hinge-barrel knee, crystal-cut
// thorn spines and a pointed claw. Flat planar faces keep the silhouette crisp when the mesh is decimated to the crowd budget.
import { type Vec3, vadd, vcross, vdot, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Rng } from '../../core/rng.ts';
import type { Body } from '../../core/sdf/body.ts';
import { Sphere } from '../../core/sdf/primitives.ts';
import type { LegSpec } from './anatomy.ts';
import { crystal, prism } from './crystal.ts';

export interface LegStyle {
  s: number;
  femur: [number, number];
  tibia: [number, number];
  tarsus: [number, number];
  knee: number;
  coxa: number;
  /** spines per segment (femur, tibia) and their length / base radius */
  spines: [number, number];
  spineLen: number;
  spineR: number;
  /** facets around the limb */
  sides?: number;
  rng: Rng;
  /** extra tags for painting */
  tags?: string[];
}

/** unit vector perpendicular to `d`, pointing as much as possible along `want` */
function perpTo(d: Vec3, want: Vec3): Vec3 {
  const k = vdot(want, d);
  return vnorm(vsub(want, vscale(d, k)));
}

export function addLeg(body: Body, l: LegSpec, st: LegStyle): void {
  const { s } = st;
  const sides = st.sides ?? 6;
  const out: Vec3 = [l.side, 0, 0];
  const tags = ['leg', ...(st.tags ?? [])];
  const boneLast = l.foot ?? l.lower;
  const dirF = vnorm(vsub(l.knee, l.hip));
  const dirT = vnorm(vsub(l.ankle, l.knee));
  const axis = vnorm(vcross(dirF, dirT)); // hinge axis of the knee (normal of the bend plane)
  body.add(`coxa_${l.id}`, new Sphere(l.hip, st.coxa * s), { bone: l.parent, w: 0.016 * s, tags: [...tags, 'coxa'], grip: 1.5 });
  body.add(`femur_${l.id}`, prism(l.hip, l.knee, st.femur[0] * s, st.femur[1] * s, { sides, side: axis, bevelA: 0.1, bevelB: 0.28 }), { bone: l.upper, w: 0.012 * s, tags: [...tags, 'femur'], grip: 1.4 });
  // knee: hexagonal hinge barrel lying along the bend axis
  const kh = st.knee * 1.0 * s;
  body.add(`knee_${l.id}`, prism(vadd(l.knee, vscale(axis, -kh)), vadd(l.knee, vscale(axis, kh)), st.knee * s, st.knee * 0.92 * s, { sides, side: dirF, bevelA: 0.32, bevelB: 0.32 }), { bone: l.lower, w: 0.01 * s, tags: [...tags, 'joint'], grip: 1.3 });
  body.add(`tibia_${l.id}`, prism(l.knee, l.ankle, st.tibia[0] * s, st.tibia[1] * s, { sides, side: axis, bevelA: 0.2, bevelB: 0.25 }), { bone: l.lower, w: 0.01 * s, tags: [...tags, 'tibia'], grip: 1.4 });
  const tarsEnd = vlerp(l.ankle, l.tip, 0.7);
  if (l.foot) {
    const ah = st.tibia[1] * 1.2 * s;
    body.add(`ankle_${l.id}`, prism(vadd(l.ankle, vscale(axis, -ah)), vadd(l.ankle, vscale(axis, ah)), st.tibia[1] * 1.15 * s, st.tibia[1] * 1.05 * s, { sides, side: dirT, bevelA: 0.3, bevelB: 0.3 }), { bone: l.foot, w: 0.008 * s, tags: [...tags, 'joint'], grip: 1.3 });
  }
  const dirTar = vnorm(vsub(tarsEnd, l.ankle));
  body.add(`tarsus_${l.id}`, prism(l.ankle, tarsEnd, st.tarsus[0] * s, st.tarsus[1] * s, { sides: Math.max(4, sides - 1), side: axis, bevelA: 0.2, bevelB: 0.2 }), { bone: boneLast, w: 0.008 * s, tags: [...tags, 'tarsus'], grip: 1.4 });
  // hooked claw: a 4-sided thorn sweeping down toward the contact point
  const hook = vadd(l.tip, [-l.side * 0.012 * s, 0, 0.014 * s * Math.sign(l.tip[2] - l.hip[2] || 1)]);
  body.addLate(`claw_${l.id}`, crystal(vsub(tarsEnd, vscale(dirTar, 0.01 * s)), vsub(hook, tarsEnd), Math.hypot(...vsub(hook, tarsEnd)) * 1.05, st.tarsus[1] * 1.05 * s, { sides: 4, tipFrac: 0.8, topFrac: 0.8, jitter: 0, rng: st.rng }), { bone: boneLast, w: 0.004 * s, tags: [...tags, 'claw'], grip: 1.5 });

  const upOut = (d: Vec3): Vec3 => perpTo(d, vnorm(vadd([0, 1, 0], vscale(out, 0.45))));
  const spine = (nm: string, base: Vec3, n: Vec3, along: Vec3, len: number, r: number, bone: string): void => {
    const dir = vnorm(vadd(n, vscale(along, 0.35)));
    body.addLate(nm, crystal(vsub(base, vscale(n, r * 0.6)), dir, len + r * 0.6, r, { sides: 4, tipFrac: 0.8, topFrac: 0.85, jitter: 0.05, rng: st.rng }), { bone, w: 0.004 * s, tags: [...tags, 'spine'], grip: 1.5 });
  };
  const nF = st.spines[0], nT = st.spines[1];
  for (let i = 0; i < nF; i++) {
    const t = (i + 0.9) / (nF + 0.4);
    const pt = vlerp(l.hip, l.knee, 0.22 + 0.62 * Math.min(t, 1));
    const r = st.femur[0] + (st.femur[1] - st.femur[0]) * (0.22 + 0.62 * Math.min(t, 1));
    const n = upOut(dirF);
    spine(`spineF_${l.id}_${i}`, vadd(pt, vscale(n, r * s * 0.9)), n, dirF, st.spineLen * s * (0.9 + 0.35 * st.rng.next()), st.spineR * s, l.upper);
  }
  for (let i = 0; i < nT; i++) {
    const t = (i + 0.7) / (nT + 0.3);
    const pt = vlerp(l.knee, l.ankle, 0.2 + 0.66 * Math.min(t, 1));
    const r = st.tibia[0] + (st.tibia[1] - st.tibia[0]) * (0.2 + 0.66 * Math.min(t, 1));
    const n = upOut(dirT);
    spine(`spineT_${l.id}_${i}`, vadd(pt, vscale(n, r * s * 0.9)), n, dirT, st.spineLen * s * (0.85 + 0.35 * st.rng.next()), st.spineR * 0.9 * s, l.lower);
  }
  // knee thorn: a larger spike on top of the hinge (outer side)
  const kn = upOut(vnorm(vadd(dirF, dirT)));
  spine(`kneeSpike_${l.id}`, vadd(l.knee, vscale(kn, st.knee * s * 0.75)), kn, [0, 0, 0], st.spineLen * 1.25 * s, st.spineR * 1.25 * s, l.lower);
}
