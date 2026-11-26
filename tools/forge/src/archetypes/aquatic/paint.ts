// Aquatic paint: orca two-tone hide (slate-blue back, white-cyan belly), frosty barnacle crust with painted relief, faceted ice
// crystals (value from facet normals + AO), ember-red accents on fin edges / claws / mouth. Baked per texel; AO/cavity shade -> COLOR_0.
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep, vnorm } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, furClumps, grain, hemi, rimTint, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy } from './anatomy.ts';

export function makePaint(a: Anatomy, textureSize = 1024): PaintSpec {
  const pal = a.p.palette;
  const s = a.s;
  const L = vnorm([0.4, 0.85, 0.5]);
  const mix = mixRgb;
  const bodyMask = (v: PaintVertex): number => Math.max(v.region('torso', 0.03), v.region('head', 0.02), v.region('fin', 0.02));
  const out: PaintLayer[] = [fill(pal.back)];

  // ---- two-tone hide: back/flank slate, belly white-cyan, wavy demarcation, grey saddle behind the dorsal fin
  out.push(custom('hide', (v) => {
    const z = v.p[2];
    const q = a.at(z);
    const rel = (v.p[1] - q.cy) / q.hh;
    const warp = v.noise.fbm((v.p[0] * 4) / s, (v.p[1] * 4) / s, (z * 2.6) / s, { octaves: 2 }) * 0.24;
    // the white belly lobe climbs the flank behind the pelvic fins (orca genital patch)
    const lobe = Math.exp(-Math.pow((z + 0.62 * s) / (0.2 * s), 2)) * 0.34;
    const r = rel + warp - lobe;
    const flankCol = mix(pal.flank, pal.back, smoothstep(0.05, 0.75, r));
    let col = mix(pal.belly, flankCol, smoothstep(-0.34, -0.12, r));
    // chin-to-chest throat stays white
    // saddle patch
    const sad = Math.exp(-Math.pow((z + 0.52 * s) / (0.22 * s), 2)) * smoothstep(0.1, 0.5, rel + warp * 0.6);
    col = mix(col, adjust(pal.flank, 0.12, 0.7), sad * 0.75);
    // tail darkens toward the stock, belly stays pale
    col = mix(col, pal.back, smoothstep(-1.15 * s, -1.6 * s, z) * smoothstep(-0.2, 0.3, r) * 0.0);
    const m = Math.max(v.region('torso', 0.03), v.region('belly', 0.03));
    v.color = mix(v.color, col, m);
  }));

  // ---- head: slate rostrum with a frosted crown helmet, white lower jaw + chin, white post-ocular patch, dark brow
  out.push(custom('head', (v) => {
    const up = v.region('upper', 0.02);
    const lo = v.region('lower', 0.02);
    const warp = v.noise.fbm((v.p[0] * 6) / s, (v.p[1] * 6) / s, (v.p[2] * 6) / s, { octaves: 2 }) * 0.05 * s;
    if (up > 0) {
      const base = mix(pal.back, pal.flank, 0.45 * (1 - smoothstep(0.7 * s, 1.0 * s, v.p[1] + warp)));
      // frost helmet: pale blue crust over the crown / bridge, ragged edge, dark around the eyes
      const crown = smoothstep(0.86 * s, 1.0 * s, v.p[1] + warp * 1.5) * smoothstep(0.55 * s, 1.0 * s, v.p[2]);
      v.color = mix(v.color, mix(base, mix(pal.crust, pal.crustHi, 0.35), crown * 0.8), up);
    }
    if (lo > 0) {
      const sh = smoothstep(0.52 * s, 0.34 * s, v.p[1] + warp);
      v.color = mix(v.color, mix(mix(pal.belly, pal.flank, 0.4), pal.belly, 0.55 + 0.45 * sh), lo);
    }
    const brow = v.region('brow', 0.012);
    if (brow > 0) v.color = mix(v.color, adjust(pal.back, -0.08, 0.8), brow * 0.75);
    const patch = v.region('eye_patch', 0.012);
    if (patch > 0) v.color = mix(v.color, mix(pal.belly, [1, 1, 1], 0.5), patch * 0.97);
  }));

  // ---- frost: sparse hairline cracks + dusting on upward faces (crust spreading across the hide), scrapes on the shoulder
  out.push(custom('frost', (v) => {
    const m = bodyMask(v) * (1 - v.region('lower', 0.02) * 0.6);
    if (m <= 0) return;
    const up = smoothstep(-0.1, 0.9, v.n[1]);
    const patchy = smoothstep(0.0, 0.5, v.noise.fbm((v.p[0] * 3.5) / s, (v.p[1] * 3.5) / s, (v.p[2] * 3.5) / s, { octaves: 2 }));
    const c = v.noise.voronoi((v.p[0] * 9) / s, (v.p[1] * 9) / s, (v.p[2] * 9) / s);
    const edge = smoothstep(0.045, 0.0, c.f2 - c.f1);
    const dust = smoothstep(0.1, 0.65, v.noise.fbm((v.p[0] * 6) / s, (v.p[1] * 6) / s, (v.p[2] * 4) / s, { octaves: 3 }));
    v.color = mix(v.color, pal.crust, clamp01(dust * up * 0.5 * m));
    v.color = mix(v.color, pal.crustHi, clamp01(edge * patchy * up * 0.4 * m));
    v.color = mix(v.color, pal.crustLo, clamp01(edge * patchy * (1 - up) * 0.18 * m));
    const sc = smoothstep(0.78, 0.9, v.noise.fbm((v.p[0] * 11) / s, (v.p[1] * 30) / s, (v.p[2] * 3) / s, { octaves: 2 }));
    v.color = mix(v.color, mix(pal.belly, pal.crust, 0.5), sc * 0.5 * m * (1 - smoothstep(0.1, 0.5, v.n[1])));
  }));

  // ---- painted barnacle colonies: pale cone rings with dark mouths in noise-selected patches on shoulders, flanks and tail root
  out.push(custom('colonies', (v) => {
    const m = v.region('torso', 0.03) * (1 - v.region('lower', 0.02)) * (1 - v.region('belly', 0.03) * 0.7);
    if (m <= 0) return;
    const q = a.at(v.p[2]);
    const rel = (v.p[1] - q.cy) / q.hh;
    const patch = smoothstep(0.12, 0.42, v.noise.fbm((v.p[0] * 4.2) / s + 5, (v.p[1] * 4.2) / s, (v.p[2] * 3.6) / s - 3, { octaves: 2 }));
    const side = smoothstep(-0.3, 0.1, rel) * smoothstep(1.05 * s, 0.6 * s, v.p[2]) * smoothstep(-1.4 * s, -0.5 * s, v.p[2]);
    const k = patch * side * m;
    if (k <= 0.02) return;
    const c = v.noise.voronoi((v.p[0] * 24) / s, (v.p[1] * 24) / s, (v.p[2] * 24) / s);
    const ring = smoothstep(0.1, 0.24, c.f1) * smoothstep(0.52, 0.34, c.f1);
    const mouth = smoothstep(0.13, 0.04, c.f1);
    const cone = mix(pal.crustLo, mix(pal.crust, pal.crustHi, c.id * 0.6), 0.55 + 0.45 * ring);
    let col = mix(v.color, cone, ring * 0.85 * k);
    col = mix(col, [0.02, 0.03, 0.05], mouth * 0.8 * k);
    v.color = mix(v.color, col, clamp01(k * 2));
  }));

  // ---- scars + belly pleats: long pale rake lines along the flank, parallel throat/belly grooves
  out.push(custom('scars', (v) => {
    const q = a.at(v.p[2]);
    const rel = (v.p[1] - q.cy) / q.hh;
    const m = v.region('torso', 0.03);
    if (m <= 0) return;
    const n = v.noise.fbm((v.p[0] * 1.6) / s, (v.p[1] * 7) / s + 3, (v.p[2] * 2.2) / s, { octaves: 2 });
    const line = smoothstep(0.035, 0.0, Math.abs(n));
    const flank = smoothstep(-0.2, 0.2, rel) * smoothstep(0.85, 0.4, rel) * smoothstep(-1.2 * s, -0.2 * s, v.p[2]) * smoothstep(0.9 * s, 0.4 * s, v.p[2]);
    v.color = mix(v.color, mix(pal.belly, pal.crust, 0.4), line * flank * 0.6 * m);
    const belly = smoothstep(-0.35, -0.7, rel);
    const warp = v.noise.fbm((v.p[2] * 3) / s, (v.p[0] * 3) / s, 0, { octaves: 1 }) * 0.02 * s;
    const pleat = smoothstep(0.88, 0.99, Math.cos(((v.p[0] + warp) / (0.035 * s)) * Math.PI * 2));
    v.color = mix(v.color, mix(pal.crustLo, pal.belly, 0.4), pleat * belly * 0.35 * m * smoothstep(-1.3 * s, -0.6 * s, v.p[2]));
  }));

  // ---- barnacle slabs: painted relief (convex edges bright, crevices cool-dark, flat tops frosty)
  out.push(custom('barnacle', (v) => {
    const m = v.region('barnacle', 0.005);
    if (m <= 0) return;
    const conv = smoothstep(-0.35, 0.25, v.cavity);
    let col = mix(pal.crustLo, pal.crust, 0.35 + 0.65 * conv);
    col = mix(col, pal.crustHi, smoothstep(0.55, 1, v.n[1]) * 0.55 + smoothstep(0.25, 0.7, v.cavity) * 0.45);
    const speck = v.noise.noise((v.p[0] * 90) / s, (v.p[1] * 90) / s, (v.p[2] * 90) / s);
    col = mix(col, pal.crustHi, clamp01(speck - 0.35) * 0.5);
    v.color = mix(v.color, col, clamp01(m));
  }));

  // ---- fins: slate arms, paler undersides, ember paddle tips, ember trailing edges
  const finDir: Vec3 = vnorm([a.pec.T[0] - a.pec.W[0], 0, a.pec.T[2] - a.pec.W[2]]);
  const finLen = Math.hypot(a.pec.T[0] - a.pec.W[0], a.pec.T[2] - a.pec.W[2]);
  out.push(custom('fins', (v) => {
    const fm = v.region('fin', 0.02);
    if (fm <= 0) return;
    // pectoral paddle: gradient along the arm toward the tip
    if (v.region('fin_arm', 0.03) + v.region('paddle', 0.03) > 0) {
      const sx = v.p[0] < 0 ? -1 : 1;
      const t = ((Math.abs(v.p[0]) - a.pec.W[0]) * finDir[0] + (v.p[2] - a.pec.W[2]) * sx * 0 + (v.p[2] - a.pec.W[2]) * finDir[2]) / finLen;
      const tip = smoothstep(0.25, 1.1, t);
      const under = smoothstep(0.1, -0.5, v.n[1]);
      let col = mix(v.color, mix(pal.flank, pal.belly, 0.5), under * 0.55);
      col = mix(col, pal.ember, tip * 0.8);
      col = mix(col, mix(pal.ember, pal.iceHi, 0.4), smoothstep(0.85, 1.35, t) * 0.5);
      v.color = mix(v.color, col, fm);
    }
    // dorsal fin: ember trailing edge, frosted leading edge
    const dm = v.region('dorsal', 0.015);
    if (dm > 0) {
      const t = clamp01((v.p[1] - 0.97 * s) / (0.53 * s));
      const zc = (-0.06 - 0.6 * Math.pow(t, 1.15)) * s;
      const rad = (0.255 * (1 - t) + 0.012 * t) * s * (t < 0.45 ? 1 - 0.33 * (t / 0.45) * 0 : 1);
      const k = (zc - v.p[2]) / Math.max(rad, 0.02 * s);
      let col = mix(v.color, pal.back, 0.4);
      col = mix(col, pal.ember, smoothstep(0.35, 0.95, k) * 0.85);
      col = mix(col, pal.crustHi, smoothstep(-0.55, -1.0, k) * 0.5);
      v.color = mix(v.color, col, dm);
    }
    // flukes + pelvic fins
    const fl = v.region('fluke', 0.015);
    if (fl > 0) {
      const sx = v.p[0] < 0 ? -1 : 1;
      const L0 = a.lobe.L0, L1 = a.lobe.L1;
      const dx = L1[0] - L0[0], dz = L1[2] - L0[2];
      const len = Math.hypot(dx, dz);
      const t = clamp01(((Math.abs(v.p[0]) - L0[0]) * dx + (v.p[2] - L0[2]) * dz) / (len * len));
      const axisZ = L0[2] + dz * t;
      const rad = (0.115 * (1 - t) + 0.016 * t) * s;
      const k = (axisZ - v.p[2]) / Math.max(rad, 0.02 * s) + sx * 0;
      let col = mix(v.color, pal.flank, 0.2);
      col = mix(col, mix(pal.belly, pal.flank, 0.55), smoothstep(0.1, -0.5, v.n[1]) * 0.5);
      col = mix(col, pal.ember, smoothstep(0.4, 0.95, k) * 0.8 + smoothstep(0.55, 1.0, t) * 0.4);
      v.color = mix(v.color, col, fl);
    }
    const pv = v.region('pelvic', 0.015);
    if (pv > 0) v.color = mix(v.color, mix(mix(pal.flank, pal.belly, 0.4), pal.ember, smoothstep(0.35, 0.8, Math.abs(v.p[0]) / (a.pel.P1[0]))), pv * 0.8);
  }));

  // ---- crystals: facet value from normals, deep base, bright tips; horns bluer, tusks ivory-ice
  out.push(custom('ice', (v) => {
    const m = v.region('crystal', 0.004);
    if (m <= 0) return;
    const lam = v.n[0] * L[0] + v.n[1] * L[1] + v.n[2] * L[2];
    const facet = smoothstep(-0.5, 0.95, lam);
    let col = mix(pal.iceLo, pal.iceMid, facet);
    col = mix(col, pal.iceHi, smoothstep(0.62, 1.0, facet) * 0.85);
    col = mix(mix(pal.iceLo, pal.crustLo, 0.5), col, smoothstep(0.3, 0.85, v.ao));
    const vein = smoothstep(0.55, 0.9, v.noise.fbm((v.p[0] * 60) / s, (v.p[1] * 25) / s, (v.p[2] * 60) / s, { octaves: 2 }));
    col = mix(col, pal.iceHi, vein * 0.35);
    const tk = v.region('tusk', 0.004);
    if (tk > 0) col = mix(col, mix(pal.tooth, pal.iceHi, 0.4 + 0.4 * facet), tk * 0.85);
    v.color = mix(v.color, col, clamp01(m));
  }));

  // ---- mouth: palate, tray, throat, gums, tongue, teeth
  out.push(custom('mouth', (v) => {
    const mu = Math.max(v.region('mouth_up', 0.01), v.region('mouth_lo', 0.01));
    if (mu > 0) {
      const vein = smoothstep(0.5, 0.85, v.noise.fbm((v.p[0] * 40) / s, (v.p[1] * 40) / s, (v.p[2] * 14) / s, { octaves: 2 }));
      v.color = mix(v.color, mix(pal.mouth, adjust(pal.mouth, 0.1, 1.1), vein * 0.5), mu);
    }
    const th = v.region('throat', 0.03);
    if (th > 0 && v.p[1] < 0.66 * s) v.color = mix(v.color, mix(pal.mouth, [0.01, 0, 0.005], 0.75), th * 0.9);
    const gm = v.region('gum', 0.006);
    if (gm > 0) v.color = mix(v.color, mix(pal.gum, adjust(pal.gum, 0.08, 1.1), smoothstep(-0.2, 0.4, v.cavity)), gm);
    const tg = v.region('tongue', 0.006);
    if (tg > 0) {
      const mid = smoothstep(0.03 * s, 0.0, Math.abs(v.p[0]));
      v.color = mix(v.color, mix(pal.tongue, adjust(pal.tongue, -0.1, 1.0), mid * 0.6), tg);
    }
    const tt = v.region('tooth', 0.003);
    if (tt > 0) {
      const lam = clamp01(v.n[0] * L[0] + v.n[1] * L[1] + v.n[2] * L[2]);
      v.color = mix(v.color, mix(mix(pal.tooth, pal.gum, 0.35), mix(pal.tooth, pal.iceHi, 0.25), smoothstep(0.25, 0.8, v.ao) * (0.6 + 0.4 * lam)), tt);
    }
  }));

  // ---- eyes + claws + chin icicles
  out.push(custom('eyes', (v) => {
    const ring = v.region('eye', 0.012);
    if (ring > 0) v.color = mix(v.color, [0.01, 0.01, 0.015], 0.8 * ring);
    const e = v.region('eye', 0.0018);
    if (e > 0) v.color = mix(v.color, pal.eye, e);
    const pu = v.region('pupil', 0.0012);
    if (pu > 0) v.color = mix(v.color, [0.005, 0.004, 0.006], pu);
    const cl = v.region('claw', 0.004);
    if (cl > 0) v.color = mix(v.color, mix(pal.ember, pal.tooth, smoothstep(0.35, 0.95, v.ao) * 0.55), cl);
  }));

  // ---- hide texture: streaks along the flow, pebbling, grain
  const flow = (): Vec3 => [0, 0.05, -1];
  out.push(strands({ flow, freq: 55 / s, stretch: 7, amount: 0.14, octaves: 2, mask: (v) => bodyMask(v) * (1 - v.region('crust', 0.01)) }));
  out.push(furClumps({ freq: 26 / s, amount: 0.07, stretch: [1, 1, 0.6] }));
  out.push(grain(0.05, 150 / s));

  const shade: PaintLayer[] = [
    cavity(0.18, 0.08),
    bakeAo(0.6, [0.42, 0.48, 0.7]),
    hemi(rgb('#f4faff'), rgb('#9fb2cc'), 0.55),
    rimTint(rgb('#d8f2ff'), { strength: 0.12 }),
  ];
  return { albedo: out, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 90 } } : {}) };
}
