// Aquatic SDF body: orca torso slices on a rising spine, a blunt gaping head (rostrum + hinged mandible, fangs, tongue, ice horn),
// paddle pectorals that touch the ground, pelvic stubs, falcate dorsal fin, notched flukes, a crest of faceted ice crystals and
// clustered barnacle crust. Hand-sculpted from primitives; every part knows its bone and paint tags.
import { type Quat, type Vec3, qeuler, qfromTo, qmul, qx, qz, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';
import { Rng } from '../../core/rng.ts';
import { Body } from '../../core/sdf/body.ts';
import { fbmField } from '../../core/sdf/fields.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { SmoothIntersect, Xform, rotate } from '../../core/sdf/ops.ts';
import { Ellipsoid, HalfSpace, RoundCone, Sphere, spindle } from '../../core/sdf/primitives.ts';
import { flatCone, pathPoint, profileAt, tubeSegments } from '../../core/sdf/shapes.ts';
import type { Anatomy } from './anatomy.ts';
import { Crystal, type CrystalOpts } from './ice.ts';

const ID: Quat = [0, 0, 0, 1];

export function makeBody(a: Anatomy): Body {
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
  const ell = (c: Vec3, r: Vec3, q: Quat = ID): Ellipsoid => new Ellipsoid(c, r, q);
  const jit = (n: number, lo = 0.86, hi = 1.06): number[] => Array.from({ length: n }, () => rng.range(lo, hi));

  /** faceted crystal (late part: never displaced, tiny blend so facets stay sharp) */
  const crystal = (name: string, base: Vec3, dir: Vec3, h: number, r: number, bone: string, tags: string[], o: CrystalOpts = {}, w = 0.008): void => {
    body.addLate(name, new Crystal(base, dir, h * s, r * s, { jitter: jit(o.sides ?? 6), twist: rng.range(0, 6.28), ...o }), { bone, w: w * s, tags: ['crystal', ...tags], grip: 2 });
  };

  // ------------------------------------------------------------------ torso slices
  a.stations.forEach((st, i) => {
    body.add(`torso_${i}`, ell([0, st.cy, st.z], [st.hw, st.hh, st.hl], qx(-st.pitch)), { bone: st.bone, w: R(0.08), tags: ['torso'] });
  });
  // throat mass joining the mandible to the chest (the back wall of the open mouth)
  body.add('throat', ell(V(0, 0.44, 0.74), [R(0.24), R(0.15), R(0.22)]), { bone: 'neck', w: R(0.08), tags: ['torso', 'belly'] });

  // ------------------------------------------------------------------ head (upper skull / rostrum on `head`, mandible on `jaw`)
  const mY = a.mouthY;
  const plane = (up: boolean): HalfSpace => new HalfSpace([0, mY, 0], [0, up ? -1 : 1, 0]);
  const skullC = V(0, 0.8, 0.92), skullR: Vec3 = [R(0.31), R(0.25), R(0.36)];
  body.add('skull', ell(skullC, skullR), { bone: 'head', w: R(0.06), tags: ['head', 'upper'], grip: 2 });
  body.add('melon', ell(V(0, 0.93, 1.03), [R(0.205), R(0.13), R(0.29)], qx(-0.12)), { bone: 'head', w: R(0.07), tags: ['head', 'upper'], grip: 2 });
  body.add('rostrum', new SmoothIntersect([ell(V(0, 0.65, 1.08), [R(0.285), R(0.2), R(0.315)]), plane(true)], 0.004 * s), { bone: 'head', w: R(0.05), tags: ['head', 'upper', 'rostrum'], grip: 2 });
  for (const [sd, sx] of sides) {
    body.add(`cheek_${sd}`, ell(V(sx * 0.2, 0.7, 0.93), [R(0.13), R(0.14), R(0.28)]), { bone: 'head', w: R(0.06), tags: ['head', 'upper'], grip: 2 });
    // heavy angry brow slanting down toward the bridge
    body.add(`brow_${sd}`, ell(V(sx * 0.165, 0.95, 0.99), [R(0.105), R(0.042), R(0.13)], qeuler(0.08, sx * -0.16, sx * 0.42)), { bone: 'head', w: R(0.03), tags: ['head', 'brow'], grip: 2 });
  }

  // lower jaw: modelled closed (flat top at the mouth line), then hinged open by `gape` about the jaw pivot
  const J = (sdf: Sdf): Sdf => rotate(sdf, qx(p.gape), a.hinge);
  body.add('mandible', J(new SmoothIntersect([ell(V(0, 0.53, 1.02), [R(0.272), R(0.16), R(0.35)]), plane(false)], 0.004 * s)), { bone: 'jaw', w: R(0.05), tags: ['head', 'lower', 'jaw'], grip: 2.2 });
  body.add('chin', J(ell(V(0, 0.46, 1.3), [R(0.15), R(0.085), R(0.11)])), { bone: 'jaw', w: R(0.05), tags: ['head', 'lower', 'jaw'], grip: 2.2 });
  for (const [sd, sx] of sides) body.add(`jawside_${sd}`, J(ell(V(sx * 0.19, 0.5, 0.86), [R(0.1), R(0.1), R(0.17)])), { bone: 'jaw', w: R(0.05), tags: ['head', 'lower', 'jaw'], grip: 2.2 });
  // mouth interior: no carving (thin walls collapse in the decimator) - the flat faces of the open jaws are painted red via marks
  body.mark('mouth_floor', J(ell(V(0, 0.585, 1.0), [R(0.215), R(0.03), R(0.3)])), ['mouth_lo']);
  body.mark('mouth_roof', ell(V(0, 0.585, 1.06), [R(0.225), R(0.03), R(0.3)]), ['mouth_up']);
  body.mark('throat_dark', ell(V(0, 0.6, 0.86), [R(0.17), R(0.1), R(0.14)]), ['throat']);
  body.addLate('tongue', J(ell(V(0, 0.585, 1.0), [R(0.13), R(0.055), R(0.27)], qx(0.05))), { bone: 'jaw', w: 0.012 * s, tags: ['tongue'], grip: 2.5 });

  // gum ridges along both rims (a lip the fangs grow from)
  const zc = 1.05, rxT = 0.235, rzT = 0.3;
  const ringPt = (phi: number, y: number, k = 1): Vec3 => V(Math.sin(phi) * rxT * k, y, zc + Math.cos(phi) * rzT * k);
  // teeth: bold conical fangs (the mouth has to read from 20 m): 7 upper, 6 lower, longest at the front corners
  for (const up of [true, false]) {
    const n = up ? 7 : 6;
    for (let i = 0; i < n; i++) {
      const k = (up ? -90 : -75) + i * 30;
      const phi = (k * Math.PI) / 180;
      const ak = Math.abs(k);
      let len = ak < 20 ? 0.15 : ak < 50 ? 0.2 : ak < 80 ? 0.16 : 0.12;
      let rad = ak < 20 ? 0.036 : ak < 50 ? 0.042 : ak < 80 ? 0.036 : 0.028;
      if (!up) { len *= 0.92; rad *= 0.95; }
      len *= rng.range(0.94, 1.06);
      const base = ringPt(phi, up ? 0.6 : 0.56, 0.985);
      const inw = vnorm([-Math.sin(phi) * rxT, 0, -Math.cos(phi) * rzT]);
      const dir = vnorm([inw[0] * 0.3, up ? -1 : 1, inw[2] * 0.3]);
      const tip = vadd(base, vscale(dir, len * s));
      const sdf = new RoundCone(base, tip, R(rad), R(0.0025));
      body.addLate(`tooth_${up ? 'u' : 'l'}${i}`, up ? sdf : J(sdf), { bone: up ? 'head' : 'jaw', w: 0.006 * s, tags: ['tooth'], grip: 3 });
    }
  }
  // chin icicles
  for (const [i, [x, z, h]] of ([[0, 1.24, 0.15], [0.09, 1.1, 0.12], [-0.09, 1.1, 0.12], [0.16, 0.95, 0.09], [-0.16, 0.95, 0.09]] as [number, number, number][]).entries()) {
    const base = V(x, 0.425, z);
    const dir = vnorm([x * 1.5, -1, 0.5]);
    const c = new Crystal(base, dir, h * s, R(0.026), { jitter: jit(6), tip: 0.5, taper: 0.7, twist: i });
    // rotate with the jaw: wrap in the hinge transform
    body.addLate(`chin_ice_${i}`, J(c), { bone: 'jaw', w: 0.008 * s, tags: ['crystal', 'chin_ice'], grip: 2.2 });
  }

  // eyes: small, deep-set, slanted; white post-ocular patch behind
  for (const [sd, sx] of sides) {
    const n0 = vnorm([sx * 0.9, 0.3, 0.24]);
    const ep: Vec3 = [skullC[0] + skullR[0] * n0[0], skullC[1] + skullR[1] * n0[1], skullC[2] + skullR[2] * n0[2]];
    const nOut = vnorm([n0[0] / 0.31, n0[1] / 0.25, n0[2] / 0.36]);
    const q = qmul(qfromTo([1, 0, 0], nOut), qx(sx * 0.45));
    body.cut(`eye_socket_${sd}`, ell(vadd(ep, vscale(nOut, R(0.008))), [R(0.045), R(0.029), R(0.052)], q), { bone: 'head', w: 0.01 * s, tags: [] });
    body.addLate(`eye_${sd}`, ell(vadd(ep, vscale(nOut, -R(0.004))), [R(0.034), R(0.02), R(0.042)], q), { bone: 'head', w: 0.003 * s, tags: ['eye'], grip: 3 });
    body.mark(`pupil_${sd}`, ell(vadd(ep, vscale(nOut, R(0.029))), [R(0.01), R(0.016), R(0.0055)], q), ['pupil']);
    body.mark(`patch_${sd}`, ell([sx * R(0.292), R(0.865), R(0.86)], [R(0.034), R(0.034), R(0.09)], qeuler(0, sx * -0.1, sx * 0.25)), ['eye_patch']);
    // blowhole slit
    body.cut(`blow_${sd}`, ell([sx * R(0.035), R(1.045), R(0.75)], [R(0.03), R(0.008), R(0.012)], qeuler(0, sx * 0.5, 0)), { bone: 'head', w: 0.004 * s, tags: ['blowhole'] });
  }

  // ice horns on the forehead + cheek tusks + brow spikes
  const hn = p.horn;
  crystal('horn_main', V(0, 0.98, 1.04), [0, 1, -0.3], 0.46 * hn, 0.085, 'head', ['horn'], { tip: 0.4, taper: 0.78 });
  for (const [sd, sx] of sides) {
    crystal(`horn_side_${sd}`, V(sx * 0.12, 0.97, 0.97), [sx * 0.38, 1, -0.32], 0.29 * hn, 0.056, 'head', ['horn'], { tip: 0.4 });
    crystal(`horn_aft_${sd}`, V(sx * 0.07, 0.99, 0.84), [sx * 0.18, 1, -0.7], 0.19 * hn, 0.042, 'head', ['horn'], { tip: 0.42 });
    crystal(`tusk_${sd}`, V(sx * 0.25, 0.7, 0.9), [sx * 0.55, 1, -0.12], 0.3, 0.04, 'head', ['tusk'], { tip: 0.5, taper: 0.75 });
    crystal(`brow_spike_${sd}`, V(sx * 0.2, 0.99, 1.05), [sx * 0.7, 0.9, 0.3], 0.13, 0.026, 'head', ['horn'], { tip: 0.5 });
  }

  // ------------------------------------------------------------------ pectoral paddles (two big fin-arms that touch the ground)
  for (const [sd, sx] of sides) {
    const f = a.pec;
    const S_ = mk(sx, f.S), E_ = mk(sx, f.E), W_ = mk(sx, f.W), T_ = mk(sx, f.T);
    body.add(`shoulder_${sd}`, ell(vadd(S_, V(-sx * 0.04, 0.01, -0.02)), [R(0.15), R(0.16), R(0.21)], qeuler(0, 0, sx * 0.3)), { bone: `pec_${sd}`, w: R(0.08), tags: ['torso', 'fin_root'] });
    body.add(`arm_${sd}`, new RoundCone(S_, E_, R(0.125), R(0.082)), { bone: `pec_${sd}`, w: R(0.06), tags: ['fin', 'fin_arm'] });
    body.add(`elbow_${sd}`, new Sphere(E_, R(0.085)), { bone: `pec2_${sd}`, w: R(0.05), tags: ['fin', 'fin_arm'] });
    body.add(`forearm_${sd}`, new RoundCone(E_, W_, R(0.086), R(0.055)), { bone: `pec2_${sd}`, w: R(0.045), tags: ['fin', 'fin_arm'] });
    // broad leaf paddle, lying flat on the ground and sweeping back
    const pa = vlerp(E_, W_, 0.35), pb = vadd(T_, vscale(vsub(T_, W_), 0.3));
    const axis = vsub(pb, pa);
    body.add(`paddle_${sd}`, spindle(pa, pb, [R(0.21), R(0.044)], [-axis[2], 0, axis[0]]), { bone: `pec3_${sd}`, w: R(0.035), tags: ['fin', 'paddle'], grip: 1.5 });
    body.add(`paddle_root_${sd}`, spindle(vlerp(E_, W_, 0.1), vlerp(W_, T_, 0.5), [R(0.14), R(0.05)], [-axis[2], 0, axis[0]]), { bone: `pec2_${sd}`, w: R(0.04), tags: ['fin', 'paddle'], grip: 1.5 });
    // claw tines: ember-tipped ice talons fanning from the paddle tip
    const out = vnorm([sx, 0, -0.25]);
    for (const [k, ang] of [[-1, -0.55], [0, 0], [1, 0.5]] as [number, number][]) {
      const d = vnorm([out[0] * Math.cos(ang) - out[2] * Math.sin(ang), 0.06, out[0] * Math.sin(ang) + out[2] * Math.cos(ang)]);
      const base = vadd(T_, V(sx * -0.02, 0.012, 0.02 * k));
      body.addLate(`claw_${sd}${k}`, new RoundCone(base, vadd(base, vscale(d, R(0.2 - 0.03 * Math.abs(k)))), R(0.026 - 0.004 * Math.abs(k)), R(0.002)), { bone: `pec3_${sd}`, w: 0.004 * s, tags: ['claw'], grip: 2 });
    }
    // frost shards along the arm / shoulder crest
    const shardAt = (t: number, h: number, r: number, lean: Vec3): void => {
      const c = vlerp(S_, E_, t);
      crystal(`finice_${sd}_${t}`, vadd(c, V(0, 0.06, 0)), lean, h, r, `pec_${sd}`, ['fin_ice'], { tip: 0.45 });
    };
    shardAt(0.2, 0.17, 0.035, [sx * 0.4, 1, -0.5]);
    shardAt(0.55, 0.13, 0.03, [sx * 0.55, 1, -0.55]);
    shardAt(0.9, 0.1, 0.026, [sx * 0.7, 1, -0.6]);
  }
  // pelvic stubs
  for (const [sd, sx] of sides) {
    const P0 = mk(sx, a.pel.P0), P1 = mk(sx, a.pel.P1);
    body.add(`pelvic_root_${sd}`, new Sphere(P0, R(0.075)), { bone: `pel_${sd}`, w: R(0.06), tags: ['fin', 'pelvic'] });
    body.add(`pelvic_${sd}`, flatCone(P0, P1, R(0.075), R(0.014), 0.26, [0, 1, 0]), { bone: `pel_${sd}`, w: R(0.04), tags: ['fin', 'pelvic'], grip: 1.5 });
    crystal(`pelvic_ice_${sd}`, vadd(P1, V(-sx * 0.02, 0.01, 0)), [sx * 0.9, 0.1, -0.5], 0.1, 0.02, `pel_${sd}`, ['claw'], { tip: 0.55 });
  }

  // ------------------------------------------------------------------ dorsal fin (falcate, two bones so it whips)
  {
    const d = a.dorsal;
    const path: Vec3[] = [vadd(d.d1, V(0, -0.03, 0.14)), V(0, 1.24, -0.3), d.tip];
    const segs = tubeSegments(path, [[0, R(0.255)], [0.45, R(0.17)], [1, R(0.012)]], { segments: 9 });
    segs.forEach((sg, i) => {
      const sdf = new Xform(sg.sdf, [0, 0, 0], ID, [0.19, 1, 1]);
      body.add(`dorsal_${i}`, sdf, { bone: sg.t0 < 0.42 ? 'dorsal1' : 'dorsal2', w: R(sg.t0 < 0.3 ? 0.05 : 0.02), tags: ['dorsal', 'fin'] });
    });
    // serrated trailing edge + frost shards along the leading edge, both placed from the fin's own spine curve
    const prof: [number, number][] = [[0, R(0.255)], [0.45, R(0.17)], [1, R(0.012)]];
    const edgeAt = (t: number): { c: Vec3; dir: Vec3; lead: Vec3; r: number } => {
      const c = pathPoint(path, t);
      const dir = vnorm(vsub(pathPoint(path, Math.min(1, t + 0.02)), c));
      let lead: Vec3 = vnorm([0, -dir[2], dir[1]]);
      if (lead[2] < 0) lead = vscale(lead, -1);
      return { c, dir, lead, r: profileAt(prof, t) };
    };
    for (let i = 0; i < 3; i++) {
      const e = edgeAt(0.3 + i * 0.2);
      body.cut(`dorsal_notch_${i}`, ell(vsub(e.c, vscale(e.lead, e.r * 0.95)), [R(0.05), R(0.032), R(0.03)]), { bone: 'dorsal2', w: 0.012 * s, tags: ['dorsal'] });
    }
    for (let i = 0; i < 4; i++) {
      const e = edgeAt(0.12 + i * 0.2);
      const dirS = vadd(vscale(e.lead, 0.55), vscale(e.dir, 0.85));
      crystal(`dorsal_ice_${i}`, vadd(e.c, vscale(e.lead, e.r * 0.82)), dirS, 0.13 - 0.014 * i, 0.03 - 0.003 * i, i < 2 ? 'dorsal1' : 'dorsal2', ['dorsal_ice'], { tip: 0.5 });
    }
    crystal('dorsal_tip_ice', vadd(d.tip, V(0, -0.05, 0.02)), [0, 1, -0.3], 0.17, 0.028, 'dorsal2', ['dorsal_ice'], { tip: 0.6 });
  }

  // ------------------------------------------------------------------ tail: flukes (two lobes, notched trailing edge) + stock shards
  for (const [sd, sx] of sides) {
    const L0 = mk(sx, a.lobe.L0), L1 = mk(sx, a.lobe.L1);
    body.add(`fluke_${sd}`, flatCone(L0, L1, R(0.21), R(0.03), 0.13, [0, 1, 0]), { bone: `fluke_${sd}`, w: R(0.06), tags: ['fluke', 'fin'], grip: 1.3 });
    body.cut(`fluke_notch_${sd}`, ell(vadd(vlerp(L0, L1, 0.62), V(-sx * 0.02, 0, -0.17)), [R(0.07), R(0.05), R(0.06)], qeuler(0, sx * 0.5, 0)), { bone: `fluke_${sd}`, w: 0.015 * s, tags: ['fluke'] });
    const tipDir = vnorm(vsub(L1, L0));
    crystal(`fluke_tip_${sd}`, vadd(L1, V(-sx * 0.05, 0, 0.04)), vnorm([tipDir[0], 0.25, tipDir[2]]), 0.2, 0.026, `fluke_${sd}`, ['fluke_ice'], { tip: 0.55 });
    for (const [i, t] of [0.42, 0.7].entries()) {
      const c = vadd(vlerp(L0, L1, t), V(0, 0.015, -0.05 * (1 - t)));
      crystal(`fluke_edge_${sd}${i}`, c, [sx * 0.5, 0.8, -1], 0.1 - 0.02 * i, 0.021, `fluke_${sd}`, ['fluke_ice'], { tip: 0.55 });
    }
  }
  for (const [i, [z, h]] of ([[-1.2, 0.16], [-1.34, 0.14], [-1.47, 0.12]] as [number, number][]).entries()) {
    const q = a.at(z * s);
    crystal(`stock_ice_${i}`, [0, q.cy + q.hh - R(0.02), z * s], [0, 1, -0.8], h, 0.032 - 0.004 * i, a.boneAt(z * s), ['stock_ice'], { tip: 0.5 });
  }

  // ------------------------------------------------------------------ back crest: staggered ice crystals (seven big, two satellite pairs)
  const crestAt: [number, number, number][] = [
    [0.68, 0.21, 0.055], [0.52, 0.29, 0.065], [0.36, 0.34, 0.075], [0.2, 0.28, 0.065],
    [-0.72, 0.22, 0.058], [-0.9, 0.19, 0.052], [-1.07, 0.16, 0.044],
  ];
  crestAt.forEach(([z, h, r], i) => {
    const q = a.at(z * s);
    const x = (i % 2 === 0 ? 1 : -1) * R(0.03);
    const base: Vec3 = [x, q.cy + q.hh - R(0.035), z * s];
    const bone = a.boneAt(z * s);
    crystal(`crest_${i}`, base, [x * 2, 1, -0.5], h * p.crest, r * (0.7 + 0.3 * p.crest), bone, ['crest'], { tip: 0.38, taper: 0.8 });
    if (i === 1 || i === 2) {
      for (const sx of [-1, 1]) {
        crystal(`crest_${i}_s${sx}`, [base[0] + sx * R(0.1), base[1] - R(0.05), base[2] - R(0.05)], [sx * 0.7, 1, -0.45], h * p.crest * 0.55, r * 0.7, bone, ['crest'], { tip: 0.42 });
      }
    }
  });

  // ------------------------------------------------------------------ barnacle crust: three hand-placed clusters of frost slabs per side + head knuckles
  {
    const slab = (name: string, c: Vec3, nrm: Vec3, rr: number, hh: number, bone: string): void => {
      body.addLate(name, new Crystal(vsub(c, vscale(nrm, R(0.014))), nrm, hh * s, rr * s, { sides: rng.pick([5, 6, 6, 7]), tip: 0.45, taper: 0.9, apex: rng.range(0.4, 0.7), jitter: jit(7, 0.82, 1.1), twist: rng.range(0, 6.28), bevel: 0.008 * s }), { bone, w: 0.014 * s, tags: ['crust', 'barnacle'], grip: 1.5 });
    };
    // [z, theta (deg from +x, 90 = top), radius, height]
    const cl: [number, number, number, number][] = [
      [0.5, 48, 0.105, 0.04], [0.38, 62, 0.085, 0.036], [0.6, 74, 0.07, 0.034],
      [0.1, 40, 0.11, 0.045], [-0.05, 56, 0.09, 0.038], [0.2, 26, 0.08, 0.034],
      [-0.62, 52, 0.09, 0.038], [-0.8, 62, 0.07, 0.034],
    ];
    cl.forEach(([z, th0, rr, hh], i) => {
      for (const [sd, sx] of sides) {
        const th = ((sx === 1 ? th0 : 180 - th0) + rng.range(-6, 6)) * (Math.PI / 180);
        const zz = (z + rng.range(-0.03, 0.03)) * s;
        const q = a.at(zz);
        const dz = 0.03 * s;
        const q1 = a.at(zz + dz), q0 = a.at(zz - dz);
        const cth = Math.cos(th), sth = Math.sin(th);
        const rp = ((q1.hw - q0.hw) / (2 * dz)) * cth * cth + ((q1.hh - q0.hh) / (2 * dz)) * sth * sth;
        const nrm = vnorm([cth / q.hw, sth / q.hh, -rp]);
        const c: Vec3 = [cth * q.hw, q.cy + sth * q.hh, zz];
        const taper = Math.max(0.5, Math.min(1, q.hh / (0.4 * s)));
        slab(`crust_${i}${sd}`, c, nrm, rr * taper * rng.range(0.9, 1.1), hh * taper * rng.range(0.9, 1.15), a.boneAt(zz));
      }
    });
    // head crust: knuckles over the brow ridges and the crown
    const hk: [number, number, number, number, number][] = [[0.55, 0.78, 0.12, 0.045, 0.035], [0.35, 0.9, -0.15, 0.04, 0.032], [0.7, 0.62, 0.25, 0.04, 0.03]];
    hk.forEach(([x, y, z, rr, hh], i) => {
      for (const [sd, sx] of sides) {
        const d = vnorm([sx * x, y, z]);
        const c: Vec3 = [skullC[0] + skullR[0] * d[0], skullC[1] + skullR[1] * d[1], skullC[2] + skullR[2] * d[2]];
        const nrm = vnorm([d[0] / 0.31, d[1] / 0.25, d[2] / 0.36]);
        slab(`headcrust_${i}${sd}`, c, nrm, rr, hh, 'head');
      }
    });
  }

  // ------------------------------------------------------------------ gentle hide swell (low frequency: the silhouette stays clean)
  body.displace(fbmField(noise, 3.2 / s, { octaves: 2 }), R(0.006));
  return body;
}

