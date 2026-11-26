// Dragon SDF body: barrel torso, serpentine neck, horned head with an openable jaw, digitigrade hind legs, clawed forelegs,
// long spined tail ending in a blade, and membrane wings stretched between finger bones. Every part knows its bone and paint tags.
import { type Quat, type Vec3, qeuler, qfromBasis, qx, smoothstep, vadd, vcross, vdot, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';
import { Body } from '../../core/sdf/body.ts';
import { fbmField, maskedField } from '../../core/sdf/fields.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Xform } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, Sphere, spindle } from '../../core/sdf/primitives.ts';
import { flatCone, pathPoint, tube, tubeSegments } from '../../core/sdf/shapes.ts';
import type { Anatomy } from './anatomy.ts';
import { type Membrane, MembraneSet, MembraneWeightField, ThickTriangle, buildMembrane } from './membrane.ts';

export interface DragonBody {
  body: DragonBodyImpl;
  membranes: Membrane[];
}

/** Body whose skin sources include the analytic membrane weight fields (see membrane.ts). */
export class DragonBodyImpl extends Body {
  private fields: [string, MembraneWeightField][] = [];
  attachMembraneWeights(set: MembraneSet, tau: number): void {
    this.fields = set.bones().map((b) => [b, new MembraneWeightField(set, b, tau, 0.09)]);
  }
  override boneSources(): Map<string, { sdf: Sdf; grip: number }[]> {
    const m = new Map<string, { sdf: Sdf; grip: number }[]>();
    for (const p of this.parts) {
      // Keep membrane ThickTriangles as geometry/paint parts, but exclude their arbitrary
      // first-corner bone assignments so analytic MembraneWeightField controls wing membrane skinning.
      if (p.stage === 'cut' || p.stage === 'mark' || p.tags?.includes('membrane')) continue;
      const arr = m.get(p.bone) ?? [];
      arr.push({ sdf: p.sdf, grip: p.grip ?? 1 });
      m.set(p.bone, arr);
    }
    for (const [bone, f] of this.fields) {
      const arr = m.get(bone) ?? [];
      arr.push({ sdf: f, grip: 1 });
      m.set(bone, arr);
    }
    return m;
  }
}

export const SKIN_TAU = 0.1;

const ID: Quat = [0, 0, 0, 1];

export function makeBody(a: Anatomy): DragonBody {
  const s = a.s;
  const body = new DragonBodyImpl();
  body.blend = 0.08 * s;
  const noise = new Noise(a.p.seed);
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  const R = (r: number): number => r * s;
  const mir = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  const sides: [string, 1 | -1][] = [['l', 1], ['r', -1]];
  const mk = (sx: number, v: Vec3): Vec3 => (sx === 1 ? v : mir(v));
  const ell = (c: Vec3, r: Vec3, q: Quat = ID): Ellipsoid => new Ellipsoid(c, r, q);
  const cone = (p0: Vec3, p1: Vec3, r0: number, r1: number): RoundCone => new RoundCone(p0, p1, r0, r1);
  const up: Vec3 = [0, 1, 0];

  // ------------------------------------------------------------------ torso
  for (const st of a.stations) {
    body.add(`torso_${st.name}`, ell([0, st.y, st.z], [st.hw, st.hh, st.hl]), { bone: st.bone, w: R(0.2), tags: ['torso'] });
  }
  const topY = (z: number): number => {
    const st = a.stations;
    if (z >= st[st.length - 1]!.z) return st[st.length - 1]!.y + st[st.length - 1]!.hh;
    if (z <= st[0]!.z) return st[0]!.y + st[0]!.hh;
    for (let i = 0; i < st.length - 1; i++) {
      const lo = st[i]!, hi = st[i + 1]!;
      if (z >= lo.z && z <= hi.z) {
        const t = (z - lo.z) / (hi.z - lo.z);
        return lo.y + lo.hh + (hi.y + hi.hh - lo.y - lo.hh) * t;
      }
    }
    return st[3]!.y + st[3]!.hh;
  };
  const chestSt = a.stations[5]!;
  for (const [sd, sx] of sides) {
    const sh = mk(sx, a.front.shoulder);
    // shoulder mass + scapula, haunch
    body.add(`shoulder_${sd}`, ell(vadd(sh, V(sx * -0.1, 0.35, -0.15)), V(0.5, 0.74, 0.64), qeuler(-0.2, 0, sx * 0.15)), { bone: 'chest', w: R(0.14), tags: ['torso'] });
    const hp = mk(sx, a.hind.hip);
    body.add(`haunch_${sd}`, ell(vadd(hp, V(sx * -0.12, -0.3, 0.05)), V(0.62, 0.92, 0.8), qeuler(0.15, 0, sx * 0.1)), { bone: `thigh_${sd}`, w: R(0.15), tags: ['torso', 'haunch'] });
    // wing root muscle
    body.add(`wingroot_${sd}`, ell(mk(sx, a.wing.S), V(0.55, 0.45, 0.7), qeuler(0, sx * -0.2, sx * 0.3)), { bone: `wing_arm_${sd}`, w: R(0.15), tags: ['torso'] });
    // pauldron + hip spikes (read from above), creases that separate thigh / shoulder from the barrel
    body.add(`pauldron_${sd}`, cone(vadd(sh, V(sx * 0.35, 0.85, -0.05)), vadd(sh, V(sx * 1.0, 1.55, -0.95)), R(0.22), R(0.02)), { bone: 'chest', w: R(0.08), tags: ['spike'] });
    body.add(`hipspike_${sd}`, cone(vadd(hp, V(sx * 0.25, 0.85, -0.2)), vadd(hp, V(sx * 0.8, 1.5, -0.95)), R(0.18), R(0.02)), { bone: 'pelvis', w: R(0.08), tags: ['spike'] });
    body.cut(`thigh_crease_${sd}`, ell(vadd(hp, V(sx * 0.0, -0.15, 1.05)), V(0.22, 0.75, 0.12), qeuler(0, 0, sx * 0.15)), { bone: 'pelvis', w: R(0.07), tags: ['crease'] });
  }
  // chest keel / brisket mass
  body.add('keel', ell(V(0, chestSt.y - chestSt.hh * 0.55, chestSt.z + 0.35), V(0.55, 0.62, 0.95), qeuler(0.3, 0, 0)), { bone: 'chest', w: R(0.2), tags: ['torso', 'keel'] });

  // ------------------------------------------------------------------ neck (S-curve) + throat
  const np = a.neckPath;
  const neckBones = ['chest', 'neck1', 'neck2', 'neck3', 'neck4'];
  const nSegs = tubeSegments(np.pts, (t) => {
    const f = Math.min(t, 0.999) * (np.r.length - 1);
    const i = Math.floor(f);
    const u = f - i;
    return np.r[i]! * (1 - u) + np.r[i + 1]! * u;
  }, { segments: 22 });
  nSegs.forEach((sg, i) => {
    const bone = neckBones[Math.min(4, Math.floor(((sg.t0 + sg.t1) / 2) * 5))]!;
    body.add(`neck_${i}`, sg.sdf, { bone, w: R(0.2), tags: ['neck'] });
  });
  // gullet: underside band along the neck (where the fire swells)
  const gullet = tubeSegments(np.pts.slice(1), (t) => R(0.5 - 0.17 * t), { segments: 16 });
  gullet.forEach((sg, i) => {
    const bone = neckBones[Math.min(4, Math.floor(((sg.t0 + sg.t1) / 2) * 4) + 1)]!;
    const off: Vec3 = [0, -R(0.2), R(0.12)];
    body.add(`gullet_${i}`, cone(vadd(sg.a, off), vadd(sg.b, off), sg.sdf.ra * 0.62, sg.sdf.rb * 0.62), { bone, w: R(0.14), tags: ['neck', 'throat'] });
  });

  // ------------------------------------------------------------------ head (head-local, +z forward)
  const H = (sdf: Sdf): Sdf => new Xform(sdf, a.head, qx(a.headPitch), [s * a.hs, s * a.hs, s * a.hs]);
  const hv = (x: number, y: number, z: number): Vec3 => [x, y, z];
  const hmir = (v: Vec3, sx: number): Vec3 => [v[0] * sx, v[1], v[2]];
  const squash = (c: Vec3, sdf: Sdf, sy: number): Sdf => new Xform(new Xform(sdf, vscale(c, -1)), c, ID, [1, sy, 1]);
  const hb = { bone: 'head', grip: 2 };
  body.add('skull', H(ell(hv(0, 0.02, 0.42), hv(0.4, 0.38, 0.52))), { ...hb, w: R(0.1), tags: ['head'] });
  body.add('skull_back', H(ell(hv(0, 0.0, 0.05), hv(0.36, 0.34, 0.34))), { ...hb, w: R(0.12), tags: ['head'] });
  body.add('snout', H(squash(hv(0, -0.05, 1.18), cone(hv(0, 0.03, 0.7), hv(0, -0.05, 1.6), 0.3, 0.19), 0.8)), { ...hb, w: R(0.08), tags: ['head', 'muzzle'] });
  body.add('nose', H(ell(hv(0, -0.02, 1.62), hv(0.22, 0.14, 0.16))), { ...hb, w: R(0.05), tags: ['head', 'muzzle', 'nose'] });
  body.add('bridge', H(ell(hv(0, 0.17, 0.95), hv(0.12, 0.09, 0.5), qeuler(0.08, 0, 0))), { ...hb, w: R(0.06), tags: ['head', 'muzzle', 'bridge'] });
  body.add('jaw', H(squash(hv(0, -0.23, 0.9), cone(hv(0, -0.17, 0.36), hv(0, -0.26, 1.5), 0.23, 0.14), 0.75)), { bone: 'jaw', w: R(0.06), tags: ['head', 'jaw', 'muzzle'], grip: 2.5 });
  body.add('chin', H(ell(hv(0, -0.28, 1.5), hv(0.14, 0.1, 0.14))), { bone: 'jaw', w: R(0.04), tags: ['head', 'jaw', 'muzzle'], grip: 2.5 });
  for (const [sd, sx] of sides) {
    body.add(`brow_${sd}`, H(ell(hv(sx * 0.25, 0.32, 0.66), hv(0.23, 0.16, 0.46), qeuler(0, sx * -0.15, sx * 0.45))), { ...hb, w: R(0.05), tags: ['head', 'brow'] });
    body.add(`cheek_${sd}`, H(ell(hv(sx * 0.33, -0.1, 0.4), hv(0.14, 0.2, 0.34))), { ...hb, w: R(0.06), tags: ['head', 'cheek'] });
    body.add(`jowl_${sd}`, H(ell(hv(sx * 0.2, -0.12, 1.0), hv(0.1, 0.1, 0.5))), { ...hb, w: R(0.05), tags: ['head', 'muzzle'] });
    body.add(`nostril_flare_${sd}`, H(ell(hv(sx * 0.13, 0.02, 1.7), hv(0.085, 0.085, 0.1))), { ...hb, w: R(0.03), tags: ['head', 'nose'] });
    // eye: socket cut + glowing ball + brow overhang
    const ec = hv(sx * 0.28, 0.17, 0.8);
    const eq = qeuler(0, sx * 0.55, sx * -0.4);
    body.cut(`eye_socket_${sd}`, H(ell(ec, hv(0.11, 0.08, 0.12), eq)), { ...hb, w: R(0.03), tags: [] });
    body.addLate(`eye_${sd}`, H(ell(hv(ec[0] - sx * 0.012, ec[1], ec[2] - 0.01), hv(0.082, 0.055, 0.085), eq)), { bone: 'head', w: R(0.012), tags: ['eye'], grip: 3 });
    {
      const dd = vnorm(hv(sx * 0.8, 0.12, 0.55));
      const hx = vnorm(vcross([0, 1, 0], dd));
      const hy = vcross(dd, hx);
      const pc = vadd(hv(ec[0] - sx * 0.012, ec[1], ec[2] - 0.01), vscale(dd, 0.07));
      body.mark(`pupil_${sd}`, H(ell(pc, hv(0.012, 0.047, 0.03), qfromBasis(hx, hy, dd))), ['pupil']);
    }
    body.cut(`nostril_${sd}`, H(new Sphere(hv(sx * 0.12, 0.0, 1.78), 0.045)), { ...hb, w: R(0.015), tags: ['nostril'] });
    // teeth: upper fangs, a few smaller teeth, lower fangs (late: unaffected by displacement)
    body.addLate(`fang_up_${sd}`, H(cone(hv(sx * 0.15, -0.08, 1.3), hv(sx * 0.16, -0.6, 1.26), 0.09, 0.012)), { ...hb, w: R(0.01), tags: ['tooth'], grip: 3 });
    body.addLate(`fang_lo_${sd}`, H(cone(hv(sx * 0.13, -0.2, 1.38), hv(sx * 0.14, 0.2, 1.4), 0.08, 0.012)), { bone: 'jaw', w: R(0.01), tags: ['tooth'], grip: 3 });
    for (let i = 0; i < 4; i++) {
      const z = 0.55 + i * 0.17;
      body.addLate(`tooth_up_${sd}${i}`, H(cone(hv(sx * (0.27 - 0.02 * i), -0.08, z), hv(sx * (0.27 - 0.02 * i), -0.3 - 0.02 * (i % 2), z + 0.03), 0.058, 0.012)), { ...hb, w: R(0.008), tags: ['tooth'], grip: 3 });
      body.addLate(`tooth_lo_${sd}${i}`, H(cone(hv(sx * (0.24 - 0.02 * i), -0.22, z + 0.07), hv(sx * (0.24 - 0.02 * i), -0.04, z + 0.08), 0.046, 0.012)), { bone: 'jaw', w: R(0.008), tags: ['tooth'], grip: 3 });
    }
    // horns: main swept antler with a branch tine, brow spike; long drifting whiskers from the muzzle
    body.addLate(`whisker_${sd}`, H(tube([hv(sx * 0.14, 0.0, 1.3), hv(sx * 0.5, 0.12, 0.95), hv(sx * 0.95, 0.0, 0.35), hv(sx * 1.5, -0.3, -0.3), hv(sx * 2.0, -0.2, -1.0)], (t) => 0.06 - 0.05 * t, { segments: 14, w: 0.03 })), { ...hb, w: R(0.03), tags: ['whisker'] });
    const horn = tube([hmir(hv(0.26, 0.3, 0.12), sx), hmir(hv(0.42, 0.52, -0.3), sx), hmir(hv(0.6, 0.7, -0.95), sx), hmir(hv(0.72, 0.86, -1.65), sx), hmir(hv(0.6, 1.05, -2.3), sx)], (t) => 0.14 - 0.125 * t ** 0.7, { segments: 14, w: 0.05 });
    body.addLate(`horn_${sd}`, H(horn), { ...hb, w: R(0.05), tags: ['horn'] });
    body.addLate(`horn_tine_${sd}`, H(tube([hmir(hv(0.55, 0.62, -0.7), sx), hmir(hv(0.85, 0.86, -0.95), sx), hmir(hv(1.0, 1.2, -1.0), sx)], (t) => 0.07 - 0.058 * t, { segments: 6, w: 0.03 })), { ...hb, w: R(0.04), tags: ['horn'] });
    body.addLate(`brow_spike_${sd}`, H(cone(hv(sx * 0.2, 0.36, 0.7), hv(sx * 0.3, 0.62, 0.5), 0.07, 0.01)), { ...hb, w: R(0.03), tags: ['horn'] });
    // cheek frill: three backswept fins fanning behind the jaw hinge
    const fins: [Vec3, number][] = [[hv(sx * 0.9, 0.3, -0.6), 0.16], [hv(sx * 0.95, -0.12, -0.65), 0.17]];
    fins.forEach(([tip, rb], i) => {
      const base = hv(sx * 0.34, -0.02 - 0.05 * i, 0.12 - 0.04 * i);
      body.add(`frill_${sd}${i}`, H(flatCone(base, tip, rb, 0.04, 0.5, vnorm([sx * 0.5, 0.4, 0.45]))), { ...hb, w: R(0.06), tags: ['frill'] });
    });
  }
  // snout horn + chin beard
  body.addLate('nose_horn', H(cone(hv(0, 0.08, 1.55), hv(0, 0.42, 1.46), 0.07, 0.01)), { ...hb, w: R(0.03), tags: ['horn'] });
  for (let i = 0; i < 4; i++) {
    const z = 0.45 + i * 0.24;
    body.addLate(`beard_${i}`, H(cone(hv(0, -0.3, z), hv(0, -0.68 + 0.04 * i, z - 0.2), 0.065 - 0.008 * i, 0.01)), { bone: 'jaw', w: R(0.03), tags: ['horn', 'beard'], grip: 2.5 });
  }
  // mouth: shallow lip cut + deep throat cut
  body.cut('mouth_lip', H(ell(hv(0, -0.118, 0.97), hv(0.32, 0.034, 0.7))), { ...hb, w: R(0.02), tags: ['lipline'] });
  body.cut('mouth_in', H(ell(hv(0, -0.1, 0.92), hv(0.2, 0.13, 0.52))), { ...hb, w: R(0.05), tags: ['mouthin'] });

  // ------------------------------------------------------------------ dorsal plates (flat triangular blades, tilted toward the tail)
  const plate = (name: string, base: Vec3, dir: Vec3, h: number, rb: number, bone: string, tags: string[] = []): void => {
    const d = vnorm(dir);
    const tip = vadd(base, vscale(d, h));
    body.add(name, flatCone(vadd(base, vscale(d, -rb * 0.6)), tip, rb, 0.02 * s, 0.55, [1, 0, 0]), { bone, w: R(0.05), tags: ['plate', ...tags] });
  };
  // trunk: z from the withers to the rump
  let pi = 0;
  for (let z = 2.1; z >= -3.15; z -= 0.46) {
    const k = 1 - Math.abs(z - 0.2) / 3.3;
    const h = R(0.55 + 0.6 * Math.max(0, k));
    const bone = z > 0.4 ? 'chest' : z > -1.5 ? 'spine' : 'pelvis';
    plate(`plate_${pi++}`, [0, topY(z * s) - R(0.1), z * s], [0, 1, -0.38], h, R(0.27), bone);
  }
  // neck: smaller plates riding the upper surface
  for (let i = 0; i < 9; i++) {
    const t = 0.12 + i * 0.095;
    const c = pathPoint(np.pts, t);
    const c2 = pathPoint(np.pts, Math.min(1, t + 0.02));
    const tg = vnorm(vsub(c2, c));
    const upv = vnorm(vsub(up, vscale(tg, vdot(up, tg))));
    const r = np.r[Math.min(np.r.length - 1, Math.round(t * (np.r.length - 1)))]!;
    plate(`nplate_${i}`, vadd(c, vscale(upv, r * 0.82)), vadd(vscale(upv, 1), vscale(tg, -0.42)), R(0.5 - 0.024 * i), R(0.19), neckBones[Math.min(4, Math.floor(t * 5))]!);
  }

  // ------------------------------------------------------------------ legs
  for (const [sd, sx] of sides) {
    // fore leg: upper arm, elbow, forearm, wrist, palm, three toes with claws
    const sh = mk(sx, a.front.shoulder), el = mk(sx, a.front.elbow), wr = mk(sx, a.front.wrist), fb = mk(sx, a.front.ball);
    body.add(`arm_${sd}`, cone(sh, el, R(0.58), R(0.44)), { bone: `arm_${sd}`, w: R(0.2), tags: ['leg', 'leg_f'] });
    body.add(`elbow_${sd}`, new Sphere(el, R(0.4)), { bone: `forearm_${sd}`, w: R(0.16), tags: ['leg', 'leg_f'] });
    body.add(`forearm_${sd}`, cone(el, wr, R(0.44), R(0.33)), { bone: `forearm_${sd}`, w: R(0.12), tags: ['leg', 'leg_f'] });
    body.add(`forearm_mass_${sd}`, ell(vlerp(el, wr, 0.32), V(0.36, 0.5, 0.4), qeuler(0.2, 0, sx * 0.1)), { bone: `forearm_${sd}`, w: R(0.1), tags: ['leg', 'leg_f'] });
    body.add(`wrist_${sd}`, new Sphere(wr, R(0.3)), { bone: `hand_${sd}`, w: R(0.1), tags: ['leg', 'leg_f'] });
    body.add(`elbow_spike_${sd}`, cone(vadd(el, V(sx * 0.2, 0, -0.25)), vadd(el, V(sx * 0.5, 0.2, -0.75)), R(0.16), R(0.015)), { bone: `forearm_${sd}`, w: R(0.06), tags: ['spike'] });
    const palm: Vec3 = vadd(fb, V(0, 0.0, 0.18));
    body.add(`palm_${sd}`, ell(palm, V(0.36, 0.2, 0.52), qeuler(-0.12, 0, 0)), { bone: `hand_${sd}`, w: R(0.1), tags: ['paw'], grip: 1.6 });
    body.add(`pastern_${sd}`, cone(wr, vadd(fb, V(0, 0.12, 0.0)), R(0.3), R(0.26)), { bone: `hand_${sd}`, w: R(0.08), tags: ['leg', 'leg_f'], grip: 1.6 });
    for (const tk of [-1, 0, 1]) {
      const tx = fb[0] + sx * 0 + tk * R(0.24);
      const base: Vec3 = [tx, R(0.2), fb[2] + R(0.5)];
      const tip: Vec3 = [tx + tk * R(0.07), R(0.12), fb[2] + R(1.0 + (tk === 0 ? 0.08 : 0))];
      body.add(`toe_f_${sd}${tk}`, cone(base, tip, R(0.13), R(0.1)), { bone: `hand_${sd}`, w: R(0.05), tags: ['paw', 'toe'], grip: 1.6 });
      const cb = vadd(tip, V(0, 0.02, 0.03));
      const ct = vadd(tip, V(tk * 0.1, -0.1, 0.52));
      body.addLate(`claw_f_${sd}${tk}`, tube([cb, vlerp(cb, ct, 0.5).map((q, i) => (i === 1 ? q + 0.06 * s : q)) as Vec3, ct], (t) => R(0.085) * (1 - t) + R(0.012) * t, { segments: 4, w: 0.02 }), { bone: `hand_${sd}`, w: R(0.015), tags: ['claw'], grip: 1.6 });
    }
    // hind leg: thigh, shin, hock, metatarsus, foot, toes + claws + hock spur
    const hip = mk(sx, a.hind.hip), st = mk(sx, a.hind.stifle), hk = mk(sx, a.hind.hock), hb2 = mk(sx, a.hind.ball);
    body.add(`thigh_${sd}`, cone(hip, st, R(0.66), R(0.46)), { bone: `thigh_${sd}`, w: R(0.14), tags: ['leg', 'leg_h'] });
    body.add(`knee_${sd}`, new Sphere(st, R(0.46)), { bone: `shin_${sd}`, w: R(0.12), tags: ['leg', 'leg_h'] });
    body.add(`shin_${sd}`, cone(st, hk, R(0.46), R(0.3)), { bone: `shin_${sd}`, w: R(0.1), tags: ['leg', 'leg_h'] });
    body.add(`shin_mass_${sd}`, ell(vlerp(st, hk, 0.3), V(0.32, 0.5, 0.4), qeuler(-0.3, 0, 0)), { bone: `shin_${sd}`, w: R(0.1), tags: ['leg', 'leg_h'] });
    body.add(`hock_${sd}`, new Sphere(hk, R(0.38)), { bone: `foot_${sd}`, w: R(0.08), tags: ['leg', 'leg_h'] });
    body.add(`meta_${sd}`, cone(hk, hb2, R(0.34), R(0.28)), { bone: `foot_${sd}`, w: R(0.08), tags: ['leg', 'leg_h'] });
    body.add(`hock_spur_${sd}`, cone(vadd(hk, V(0, 0.05, -0.2)), vadd(hk, V(sx * 0.1, -0.1, -0.78)), R(0.13), R(0.012)), { bone: `foot_${sd}`, w: R(0.05), tags: ['spike'] });
    body.add(`knee_spike_${sd}`, cone(vadd(st, V(sx * 0.3, 0.1, -0.1)), vadd(st, V(sx * 0.7, 0.25, -0.4)), R(0.14), R(0.012)), { bone: `shin_${sd}`, w: R(0.05), tags: ['spike'] });
    const hfoot: Vec3 = vadd(hb2, V(0, 0.0, 0.3));
    body.add(`foot_${sd}`, ell(hfoot, V(0.4, 0.2, 0.62), qeuler(-0.1, 0, 0)), { bone: `toe_${sd}`, w: R(0.1), tags: ['paw'], grip: 1.6 });
    for (const tk of [-1, 0, 1]) {
      const tx = hb2[0] + tk * R(0.27);
      const base: Vec3 = [tx, R(0.2), hb2[2] + R(0.6)];
      const tip: Vec3 = [tx + tk * R(0.08), R(0.12), hb2[2] + R(1.15 + (tk === 0 ? 0.1 : 0))];
      body.add(`toe_h_${sd}${tk}`, cone(base, tip, R(0.15), R(0.11)), { bone: `toe_${sd}`, w: R(0.05), tags: ['paw', 'toe'], grip: 1.6 });
      const cb = vadd(tip, V(0, 0.02, 0.03));
      const ct = vadd(tip, V(tk * 0.12, -0.11, 0.6));
      body.addLate(`claw_h_${sd}${tk}`, tube([cb, vlerp(cb, ct, 0.5).map((q, i) => (i === 1 ? q + 0.07 * s : q)) as Vec3, ct], (t) => R(0.1) * (1 - t) + R(0.012) * t, { segments: 4, w: 0.02 }), { bone: `toe_${sd}`, w: R(0.015), tags: ['claw'], grip: 1.6 });
    }
  }

  // ------------------------------------------------------------------ tail: tube + dorsal plates + side barbs + blade tip
  const tp = a.tailPath;
  const tailBones = ['pelvis', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'];
  const tSegs = tubeSegments(tp.pts, (t) => {
    const f = Math.min(t, 0.999) * (tp.r.length - 1);
    const i = Math.floor(f);
    const u = f - i;
    return tp.r[i]! * (1 - u) + tp.r[i + 1]! * u;
  }, { segments: 28 });
  tSegs.forEach((sg, i) => body.add(`tail_${i}`, sg.sdf, { bone: tailBones[Math.min(6, Math.floor(((sg.t0 + sg.t1) / 2) * 7))]!, w: R(0.14), tags: ['tail'] }));
  for (let i = 0; i < 13; i++) {
    const t = 0.1 + i * 0.066;
    const c = pathPoint(tp.pts, t);
    const c2 = pathPoint(tp.pts, Math.min(1, t + 0.02));
    const tg = vnorm(vsub(c2, c));
    const upv = vnorm(vsub(up, vscale(tg, vdot(up, tg))));
    const r = tp.r[Math.min(tp.r.length - 1, Math.round(t * (tp.r.length - 1)))]!;
    plate(`tplate_${i}`, vadd(c, vscale(upv, r * 0.85)), vadd(vscale(upv, 1), vscale(tg, 0.4)), R(0.58 - 0.038 * i), R(0.19 - 0.008 * i), tailBones[Math.min(6, Math.floor(t * 7))]!);
  }
  // paired barbs along the last third of the tail
  for (let i = 0; i < 4; i++) {
    const t = 0.6 + i * 0.09;
    const c = pathPoint(tp.pts, t);
    const c2 = pathPoint(tp.pts, Math.min(1, t + 0.02));
    const tg = vnorm(vsub(c2, c));
    const side = vnorm(vcross(up, tg));
    const r = tp.r[Math.min(tp.r.length - 1, Math.round(t * (tp.r.length - 1)))]!;
    for (const sx of [-1, 1]) {
      const base = vadd(c, vscale(side, sx * r * 0.7));
      body.add(`barb_${i}_${sx}`, cone(base, vadd(base, vadd(vscale(side, sx * R(0.46)), vscale(tg, R(0.3)))), R(0.09), R(0.012)), { bone: tailBones[Math.min(6, Math.floor(t * 7))]!, w: R(0.04), tags: ['spike'] });
    }
  }
  {
    const t6 = a.tail[5]!, tip = a.tailTip;
    const d = vnorm(vsub(tip, t6));
    const side: Vec3 = vnorm(vcross(up, d));
    body.add('tail_blade', spindle(vadd(t6, vscale(d, R(0.2))), vadd(tip, vscale(d, R(1.15))), [R(0.4), R(0.05)], side), { bone: 'tail6', w: R(0.06), tags: ['tail', 'tailfin'] });
    body.add('tail_blade_ridge', cone(vadd(t6, vscale(d, R(0.2))), vadd(tip, vscale(d, R(1.55))), R(0.1), R(0.02)), { bone: 'tail6', w: R(0.05), tags: ['tail', 'tailfin'] });
    for (const sx of [-1, 1]) {
      const b0 = vadd(vadd(t6, vscale(d, R(0.45))), vscale(side, sx * R(0.18)));
      body.add(`tail_barb_${sx}`, cone(b0, vadd(vadd(b0, vscale(side, sx * R(0.62))), vscale(d, R(0.5))), R(0.11), R(0.012)), { bone: 'tail6', w: R(0.04), tags: ['tail', 'spike'] });
    }
  }

  // ------------------------------------------------------------------ wings: bones + claws + membrane
  const membranes: Membrane[] = [];
  const wp = a.wing;
  for (const [sd, sx] of sides) {
    const S = mk(sx, wp.S), E = mk(sx, wp.E), W = mk(sx, wp.W), K1 = mk(sx, wp.K1), T1 = mk(sx, wp.T1), K2 = mk(sx, wp.K2), T2 = mk(sx, wp.T2), T3 = mk(sx, wp.T3), T4 = mk(sx, wp.T4);
    body.add(`wing_humerus_${sd}`, cone(S, E, R(0.29), R(0.21)), { bone: `wing_arm_${sd}`, w: R(0.1), tags: ['wingbone'] });
    body.add(`wing_elbow_${sd}`, new Sphere(E, R(0.25)), { bone: `wing_fore_${sd}`, w: R(0.08), tags: ['wingbone'] });
    body.add(`wing_radius_${sd}`, cone(E, W, R(0.19), R(0.145)), { bone: `wing_fore_${sd}`, w: R(0.08), tags: ['wingbone'] });
    body.add(`wing_wrist_${sd}`, new Sphere(W, R(0.22)), { bone: `wing_fore_${sd}`, w: R(0.06), tags: ['wingbone'] });
    body.add(`wing_f1a_${sd}`, cone(W, K1, R(0.15), R(0.11)), { bone: `wing_f1a_${sd}`, w: R(0.06), tags: ['wingbone', 'finger'] });
    body.add(`wing_k1_${sd}`, new Sphere(K1, R(0.15)), { bone: `wing_f1b_${sd}`, w: R(0.05), tags: ['wingbone', 'finger'] });
    body.add(`wing_f1b_${sd}`, cone(K1, T1, R(0.1), R(0.04)), { bone: `wing_f1b_${sd}`, w: R(0.05), tags: ['wingbone', 'finger'] });
    body.add(`wing_f2a_${sd}`, cone(W, K2, R(0.14), R(0.105)), { bone: `wing_f2a_${sd}`, w: R(0.06), tags: ['wingbone', 'finger'] });
    body.add(`wing_k2_${sd}`, new Sphere(K2, R(0.135)), { bone: `wing_f2b_${sd}`, w: R(0.05), tags: ['wingbone', 'finger'] });
    body.add(`wing_f2b_${sd}`, cone(K2, T2, R(0.095), R(0.04)), { bone: `wing_f2b_${sd}`, w: R(0.05), tags: ['wingbone', 'finger'] });
    body.add(`wing_f3_${sd}`, cone(W, T3, R(0.115), R(0.04)), { bone: `wing_f3_${sd}`, w: R(0.05), tags: ['wingbone', 'finger'] });
    body.add(`wing_f4_${sd}`, cone(W, T4, R(0.105), R(0.04)), { bone: `wing_f4_${sd}`, w: R(0.05), tags: ['wingbone', 'finger'] });
    // spurs along the leading edge of the arm and finger 1 (read from above), elbow spur, thumb claw at the wrist, fingertip hooks
    for (const [nm, p0, p1, bone, k] of [['h', S, E, `wing_arm_${sd}`, 0.55], ['r', E, W, `wing_fore_${sd}`, 0.4], ['r2', E, W, `wing_fore_${sd}`, 0.75], ['f1', W, K1, `wing_f1a_${sd}`, 0.6]] as const) {
      const b = vlerp(p0, p1, k);
      body.add(`wing_spur_${nm}_${sd}`, cone(vadd(b, V(0, 0.05, 0)), vadd(b, V(sx * 0.12, 0.62, -0.28)), R(0.1), R(0.012)), { bone, w: R(0.04), tags: ['spike'] });
    }
    body.add(`wing_elbow_spike_${sd}`, cone(vadd(E, V(sx * 0.1, 0.1, -0.1)), vadd(E, V(sx * 0.15, 0.95, -0.7)), R(0.2), R(0.02)), { bone: `wing_fore_${sd}`, w: R(0.06), tags: ['spike'] });
    body.addLate(`wing_thumb_${sd}`, tube([W, vadd(W, V(sx * 0.1, 0.4, 0.3)), vadd(W, V(sx * 0.1, 0.7, 0.95))], (t) => R(0.15) * (1 - t) + R(0.015) * t, { segments: 4, w: 0.03 }), { bone: `wing_fore_${sd}`, w: R(0.03), tags: ['claw'] });
    for (const [nm, k, t, bone] of [['1', K1, T1, `wing_f1b_${sd}`], ['2', K2, T2, `wing_f2b_${sd}`], ['3', W, T3, `wing_f3_${sd}`], ['4', W, T4, `wing_f4_${sd}`]] as const) {
      const d = vnorm(vsub(t, k));
      body.addLate(`wing_hook${nm}_${sd}`, cone(t, vadd(t, vscale(d, R(0.42))), R(0.07), R(0.01)), { bone, w: R(0.02), tags: ['claw'] });
    }

    const mem = buildMembrane(a, sx);
    membranes.push(mem);
    mem.tris.forEach((t, i) => {
      const boneName = t.a.w[0]![0];
      body.add(`membrane_${sd}_${i}`, new ThickTriangle(t.a.p, t.b.p, t.c.p, mem.thickness / 2), { bone: boneName, w: R(0.015), tags: ['membrane'] });
    });
  }

  // ------------------------------------------------------------------ surface lumpiness (muscle/hide), kept off the thin wings
  const wingFree = (x: number, y: number): number => 1 - smoothstep(1.35 * s, 1.9 * s, Math.abs(x)) * smoothstep(3.4 * s, 3.9 * s, y);
  body.displace(maskedField(fbmField(noise, 1.8 / s, { octaves: 3 }), (x, y) => wingFree(x, y)), R(0.05));
  body.attachMembraneWeights(new MembraneSet(membranes), SKIN_TAU * s);
  return { body, membranes };
}
