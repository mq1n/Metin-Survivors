// Scorpion paint: desert-bronze chitin with a sun-bleached back, dark purple seams and joints, etched + banded tergites with painted
// highlights, ringed amber tail ending in a glossy telson / rust stinger tip, pale belly, banded spined legs, glossy eyes.
// Albedo is baked per texel from analytic anatomy (plate stations, tail segments, finger paths) + AO/cavity, so every contour line
// sits exactly on the geometry. Hand-painted style: bold value contrast, outlines at edges, soft highlights, no noise spots.
import type { PaintSpec } from '../../core/build.ts';
import { clamp, clamp01, smoothstep, vdot, vnorm } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, furClumps, grain, hemi, layer, region, rimTint } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { ScorpionAnatomy } from './anatomy.ts';

/** closest point on a polyline: segment index, param along the segment (0..1), distance */
function onPath(path: readonly Vec3[], p: Vec3): { k: number; u: number; d: number } {
  let best = { k: 0, u: 0, d: Infinity };
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]!, b = path[k + 1]!;
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const l2 = abx * abx + aby * aby + abz * abz || 1;
    const u = clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / l2, 0, 1);
    const d = Math.hypot(p[0] - a[0] - abx * u, p[1] - a[1] - aby * u, p[2] - a[2] - abz * u);
    if (d < best.d) best = { k, u, d };
  }
  return best;
}

const bandLine = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));

export function scorpionPaint(a: ScorpionAnatomy, textureSize = 1024): PaintSpec {
  const pal = a.p.palette;
  const s = a.s;
  const key = vnorm([-0.35, 0.85, 0.4]);
  const view = vnorm([0.35, 0.75, 0.55]);
  const half = vnorm([key[0] + view[0], key[1] + view[1], key[2] + view[2]]);
  const plates = a.plates;
  const pitch = Math.abs(plates[1]!.z - plates[0]!.z);
  const zFront = plates[0]!.z + plates[0]!.rz;
  const zRear = plates[6]!.z - plates[6]!.rz;
  const pr = a.prosoma;
  const femurBones = a.legs.map((l) => l.upper);
  const tibiaBones = a.legs.map((l) => l.lower);
  const sum = (v: PaintVertex, names: string[]): number => {
    let w = 0;
    for (const n of names) w += v.bone(n);
    return w;
  };
  const lit = (v: PaintVertex): number => clamp01(vdot(v.n, key));
  const light = adjust(pal.light, 0.05, 1.05);
  const warm = rgb('#ffe9b0');
  const deep = mixRgb(pal.dark, pal.edge, 0.5);

  const out: PaintLayer[] = [fill(pal.chitin)];

  // ---- soft value structure: shadowed flanks -> bleached top; gentle warm/cool drift (no spots)
  out.push(custom('value', (v) => {
    const top = smoothstep(0.0, 0.9, v.n[1]);
    const h = smoothstep(0.1 * s, 0.4 * s, v.p[1]);
    let c = mixRgb(v.color, pal.dark, (1 - top) * 0.45 * (0.4 + 0.6 * h));
    c = mixRgb(c, light, top * h * 0.38);
    const drift = v.noise.fbm(v.p[0] * 5 / s, v.p[1] * 5 / s, v.p[2] * 5 / s, { octaves: 2 });
    c = mixRgb(c, pal.joint, clamp01(drift * 0.5) * 0.18);
    c = mixRgb(c, light, clamp01(-drift * 0.5) * 0.18);
    v.color = c;
  }));

  // ---- carapace: dark rim + etched contour lines, bright dome, radial ridges from the tubercle
  out.push(custom('carapace', (v) => {
    const w = v.bone('chest');
    if (w < 0.3 || v.p[1] < 0.27 * s) return;
    const x = Math.abs(v.p[0]) / pr.r[0];
    const z = (v.p[2] - pr.c[2]) / pr.r[2];
    const m = Math.max(x, Math.abs(z * 0.9)); // box-ish parameter, matches the rounded slab
    const e = Math.hypot(x, z * 0.95);
    const top = smoothstep(0.35, 0.9, v.n[1]);
    let c = v.color;
    c = mixRgb(c, light, (1 - smoothstep(0.0, 0.85, e)) * top * 0.42);
    c = mixRgb(c, pal.dark, smoothstep(0.78, 1.0, m) * 0.5);
    c = mixRgb(c, pal.edge, bandLine(m, 0.74, 0.025) * 0.55 * top); // etched contour
    c = mixRgb(c, pal.edge, bandLine(e, 0.45, 0.02) * 0.35 * top);
    const ang = Math.atan2(v.p[0] / s, (v.p[2] - 0.255 * s) / s);
    c = mixRgb(c, pal.dark, 0.16 * (0.5 + 0.5 * Math.sin(ang * 16)) * smoothstep(0.25, 0.7, e) * top);
    v.color = c;
  }));

  // ---- tergites: each plate = rounded slab with dark outline, etched inner line, bright front-left highlight, seam shadow
  out.push(custom('tergites', (v) => {
    const w = v.bone('back');
    if (w < 0.3 || v.p[1] < 0.2 * s || v.p[2] > zFront || v.p[2] < zRear - 0.02 * s) return;
    const f = (plates[0]!.z - v.p[2]) / pitch;
    const k = clamp(Math.round(f), 0, 6);
    const pl = plates[k]!;
    const u = Math.abs(v.p[0]) / pl.hw;
    const q = (v.p[2] - pl.z) / pl.rz; // +1 front edge .. -1 rear edge
    const m = Math.max(u, Math.abs(q));
    const top = smoothstep(0.25, 0.85, v.n[1]);
    let c = v.color;
    c = mixRgb(c, k % 2 === 0 ? light : pal.chitin, 0.12 * top);
    c = mixRgb(c, light, bandLine(q, 0.2, 0.55) * (1 - smoothstep(0.2, 0.9, u)) * top * 0.5);
    c = mixRgb(c, pal.edge, bandLine(m, 0.74, 0.04) * 0.5 * top);
    c = mixRgb(c, pal.dark, smoothstep(0.8, 1.0, m) * 0.55);
    // rear edge sinks under the next plate: deep violet shadow
    c = mixRgb(c, deep, smoothstep(-0.55, -1.0, q) * 0.8);
    v.color = c;
  }));

  // ---- keels (bright ridges) and spines (bone-pale tips on a dark base)
  out.push(region('keel', mixRgb(light, warm, 0.35), 0.7, 0.003));
  out.push(layer('spines', mixRgb(pal.dark, pal.joint, 0.4), (v) => v.region('spine', 0.003) * 0.9));
  out.push(layer('spineTip', rgb('#f0d9a0'), (v) => v.region('spine', 0.003) * smoothstep(0.55, 0.9, v.ao) * 0.95));

  // ---- legs: banded bronze femur, darker tibia, black tarsus + claw hook; purple knee joints
  out.push(custom('legs', (v) => {
    const wf = sum(v, femurBones);
    const wt = sum(v, tibiaBones);
    if (wf < 0.3 && wt < 0.3) return;
    const band = 0.5 + 0.5 * Math.sin((v.p[2] / s) * 70 + (v.p[0] / s) * 20);
    const top = smoothstep(0.1, 0.9, v.n[1]);
    if (wf >= wt) {
      let c = mixRgb(v.color, light, 0.12 + 0.22 * top);
      c = mixRgb(c, pal.dark, 0.18 * band);
      v.color = c;
    } else {
      let c = mixRgb(v.color, pal.dark, 0.4);
      c = mixRgb(c, light, 0.18 * top);
      c = mixRgb(c, pal.edge, smoothstep(0.1 * s, 0.01 * s, v.p[1]) * 0.7);
      v.color = c;
    }
  }));
  out.push(region('tarsus', mixRgb(pal.dark, pal.edge, 0.4), 0.8, 0.004));
  out.push(region('claw', pal.claw, 0.95, 0.003));
  out.push(layer('joint', (v) => mixRgb(pal.joint, pal.edge, 0.2 + 0.45 * (1 - v.ao)), (v) => v.region('joint', 0.003) * 0.9));
  out.push(layer('jointHl', mixRgb(pal.joint, light, 0.55), (v) => v.region('joint', 0.003) * smoothstep(0.55, 0.9, vdot(v.n, key)) * 0.5));

  // ---- belly
  out.push(layer('belly', pal.belly, (v) => Math.max(v.region('belly', 0.012), smoothstep(-0.05, -0.55, v.n[1]) * smoothstep(0.34 * s, 0.16 * s, v.p[1])) * 0.92));
  out.push(layer('bellyBands', mixRgb(pal.belly, pal.dark, 0.5), (v) => v.region('belly', 0.004) * (0.5 + 0.5 * Math.sin((v.p[2] / s) * 60)) * 0.28));

  // ---- tail: ringed segments, brighter toward the tip
  const tailPath = a.tail;
  out.push(custom('tail', (v) => {
    const w = sum(v, ['tail1', 'tail2', 'tail3', 'tail4', 'tail5']);
    if (w < 0.35) return;
    const o = onPath(tailPath, v.p);
    const t = (o.k + o.u) / 5;
    const base = mixRgb(pal.tail, pal.sting, smoothstep(0.3, 1.0, t) * 0.5);
    let c = mixRgb(v.color, base, 0.85);
    const ring = smoothstep(0.22, 0.0, o.u) + smoothstep(0.78, 1.0, o.u);
    const barrel = Math.sin(Math.PI * o.u);
    c = mixRgb(c, light, smoothstep(0.15, 0.95, lit(v)) * (0.18 + 0.3 * barrel));
    c = mixRgb(c, pal.edge, clamp01(ring) * 0.85);
    c = mixRgb(c, warm, bandLine(o.u, 0.3, 0.07) * 0.18); // etched band
    const ra = vnorm([0, v.p[1] - a.arch[1], v.p[2] - a.arch[2]]);
    const inner = smoothstep(0.1, -0.7, v.n[1] * ra[1] + v.n[2] * ra[2]);
    c = mixRgb(c, mixRgb(pal.belly, pal.tail, 0.55), inner * 0.5);
    v.color = c;
  }));
  out.push(region('keel', mixRgb(light, warm, 0.4), 0.6, 0.003));

  // ---- telson bulb + stinger: amber glossy bulb, rust-dark tip
  const stingPath = a.telson.sting;
  out.push(custom('telson', (v) => {
    const bulb = v.region('telson', 0.01);
    const sting = v.region('sting', 0.004);
    if (bulb < 0.05 && sting < 0.05) return;
    const o = onPath(stingPath, v.p);
    const t = (o.k + o.u) / 4;
    const amber = mixRgb(pal.sting, light, 0.3 * lit(v));
    let c = mixRgb(v.color, amber, clamp01(bulb) * 0.95);
    const tip = mixRgb(pal.sting, pal.stingTip, smoothstep(0.3, 0.88, t));
    c = mixRgb(c, tip, clamp01(sting) * 0.97);
    c = mixRgb(c, pal.stingTip, bulb * smoothstep(0.2, -0.6, v.n[1]) * 0.45);
    v.color = c;
  }));

  // ---- pedipalps: bronze arms, pale ridged palm, fingers fade ochre -> dark tip with ivory teeth
  out.push(custom('palps', (v) => {
    const wa = sum(v, ['arm_l', 'arm_r', 'forearm_l', 'forearm_r']);
    const wh = sum(v, ['hand_l', 'hand_r', 'finger_l', 'finger_r']);
    if (wa < 0.3 && wh < 0.3) return;
    const top = smoothstep(0.2, 0.95, v.n[1]);
    let c = v.color;
    c = mixRgb(c, light, top * 0.32);
    c = mixRgb(c, pal.dark, smoothstep(0.1, -0.7, v.n[1]) * 0.35);
    if (wh > 0.5) c = mixRgb(c, pal.edge, bandLine(0.5 + 0.5 * Math.sin((v.p[2] / s) * 45 + (v.p[0] / s) * 28), 1.0, 0.1) * 0.12);
    v.color = c;
  }));
  out.push(custom('fingers', (v) => {
    const fx = v.region('finger', 0.004);
    if (fx < 0.05) return;
    let best = Infinity, bu = 0;
    for (const pl of a.palps) {
      for (const path of [pl.fixed, pl.moving]) {
        const o = onPath(path, v.p);
        if (o.d < best) { best = o.d; bu = (o.k + o.u) / 4; }
      }
    }
    let c = mixRgb(v.color, mixRgb(pal.chitin, light, 0.35), fx * 0.55);
    c = mixRgb(c, pal.dark, fx * smoothstep(0.5, 0.95, bu) * 0.9);
    v.color = c;
  }));
  out.push(region('tooth', rgb('#e6d8ae'), 0.95, 0.002));
  out.push(layer('chelicera', mixRgb(pal.chitin, pal.dark, 0.5), (v) => v.region('chelicera', 0.004) * 0.6));
  out.push(region('groove', pal.edge, 0.75, 0.003));

  // ---- eyes: black glossy bulbs with a painted catch-light
  out.push(custom('eyes', (v) => {
    const e = v.region('eye', 0.003);
    if (e < 0.02) return;
    const ring = v.region('eye', 0.012);
    let c = mixRgb(v.color, pal.edge, 0.7 * ring);
    c = mixRgb(c, pal.eye, e);
    c = mixRgb(c, [1, 0.95, 0.8], e * Math.pow(clamp01(vdot(v.n, half)), 14) * 0.9);
    v.color = c;
  }));

  // ---- surface breakup + painted gloss + crevice outlines
  out.push(furClumps({ freq: 48 / s, amount: 0.1, stretch: [1, 1, 1] }));
  out.push(grain(0.04, 150 / s));
  out.push(custom('gloss', (v) => {
    const gl = Math.pow(clamp01(vdot(v.n, half)), 22);
    const w = 0.35 + 0.55 * clamp01(v.region('plate', 0.01) + v.region('palp', 0.01) + v.region('tail', 0.01)) - 0.3 * clamp01(v.region('leg', 0.005));
    v.color = mixRgb(v.color, warm, clamp01(gl * w * 0.6) * (0.5 + 0.5 * v.ao));
  }));
  out.push(cavity(0.5, 0.2));
  out.push(bakeAo(0.85, [0.34, 0.24, 0.4], 1.0));

  const shade: PaintLayer[] = [
    cavity(0.2, 0.08),
    bakeAo(0.45, [0.6, 0.5, 0.65]),
    hemi(rgb('#fff2d8'), rgb('#a38068'), 0.45),
    rimTint(rgb('#ffe2b0'), { strength: 0.1 }),
  ];
  return { albedo: out, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 90 } } : {}) };
}
