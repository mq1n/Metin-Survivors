// Frost-beetle paint: "translucent" ice shell painted as value/hue structure (deep core blue -> cyan body -> frosted white rim,
// dark vein network under the shell, bright rib highlights), faceted crystals with per-facet brightness steps and near-white tips,
// glowing cyan compound eyes, white frost at the joints, navy mandibles with ice-white tips. Albedo is baked per texel.
import type { PaintSpec } from '../../core/build.ts';
import { clamp, clamp01, smoothstep, vdot, vnorm } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, grain, hemi, layer, region, rimTint } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { BeetleAnatomy } from './anatomy.ts';

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

const hash3 = (a: number, b: number, c: number): number => {
  const h = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

export function beetlePaint(a: BeetleAnatomy, textureSize = 1024): PaintSpec {
  const pal = a.p.palette;
  const s = a.s;
  const key = vnorm([-0.35, 0.85, 0.4]);
  const view = vnorm([0.35, 0.75, 0.55]);
  const half = vnorm([key[0] + view[0], key[1] + view[1], key[2] + view[2]]);
  const frost = pal.frost;
  const sum = (v: PaintVertex, names: string[]): number => {
    let w = 0;
    for (const n of names) w += v.bone(n);
    return w;
  };
  const legB = a.legs.flatMap((l) => [l.upper, l.lower, ...(l.foot ? [l.foot] : [])]);
  const legLow = a.legs.flatMap((l) => [l.lower, ...(l.foot ? [l.foot] : [])]);

  const mandLen = a.mandible.path;

  const facet = (n: Vec3): number => hash3(Math.round(n[0] * 2.4), Math.round(n[1] * 2.4), Math.round(n[2] * 2.4)) - 0.5;
  const crestBase = 0.38 * s;
  const crestTop = 0.95 * s;

  const out: PaintLayer[] = [fill(pal.shell)];

  // ---- global structure: deep core in the lower/inner body, brighter cyan up on the shell
  out.push(custom('body', (v) => {
    const top = smoothstep(0.0, 0.95, v.n[1]);
    const h = smoothstep(0.1 * s, 0.5 * s, v.p[1]);
    let c = mixRgb(pal.deep, pal.shell, 0.35 + 0.65 * h);
    c = mixRgb(c, pal.cyan, top * h * 0.5);
    v.color = c;
  }));

  // ---- elytra + pronotum: lacquered ice-violet shell: clean cyan striae + bright ridge lines, glassy highlight, frosted rim
  out.push(custom('shell', (v) => {
    const w = sum(v, ['elytra_l', 'elytra_r']);
    const wp = v.region('pronotum', 0.01);
    if (w < 0.3 && wp < 0.3) return;
    const x = v.p[0] / s, z = v.p[2] / s;
    const top = smoothstep(0.1, 0.9, v.n[1]);
    let c = mixRgb(pal.shell, pal.cyan, top * 0.42);
    // crisp longitudinal striae (hard-edged lines following the dome)
    const st = Math.sin(Math.abs(x) * 52 + z * 3);
    c = mixRgb(c, pal.deep, smoothstep(0.55, 0.85, st) * 0.45 * (0.4 + 0.6 * top));
    // chevron plates across the pronotum
    const chev = Math.sin(z * 40 + Math.abs(x) * 14);
    c = mixRgb(c, pal.cyan, wp * smoothstep(0.8, 0.95, chev) * 0.5);
    // glassy highlight where the surface faces the light, frosted toward the silhouette
    c = mixRgb(c, frost, Math.pow(clamp01(vdot(v.n, half)), 7) * 0.6);
    const edge = 1 - clamp01(Math.abs(vdot(v.n, view)) * 1.25);
    c = mixRgb(c, frost, clamp01(edge * 1.3 - 0.2) * 0.5);
    v.color = c;
  }));
  out.push(region('rim', mixRgb(pal.cyan, frost, 0.7), 0.85, 0.004));
  out.push(region('rib', mixRgb(pal.cyan, frost, 0.55), 0.8, 0.003));
  out.push(region('groove', pal.vein, 0.9, 0.004));
  out.push(layer('abdomen', mixRgb(pal.belly, pal.deep, 0.5), (v) => v.region('abdomen', 0.01) * 0.85));
  out.push(layer('abdSeg', pal.cyan, (v) => v.region('abdomen', 0.004) * (0.5 + 0.5 * Math.sin((v.p[2] / s) * 70)) * 0.22));

  // ---- head: deep navy with a cyan wash, brow frost
  out.push(layer('head', mixRgb(pal.deep, pal.shell, 0.55), (v) => v.region('head', 0.01) * 0.85));
  out.push(layer('headTop', pal.cyan, (v) => v.region('head', 0.01) * smoothstep(0.3, 0.95, v.n[1]) * 0.35));

  // ---- crystals: base-deep -> body cyan -> near-white tips, per-facet brightness steps, frosted edges
  out.push(custom('crystals', (v) => {
    const cw = v.region('crystal', 0.004);
    if (cw < 0.05) return;
    const h = clamp01((v.p[1] - crestBase) / (crestTop - crestBase));
    const f = facet(v.n);
    let c = mixRgb(pal.deep, pal.crystal, smoothstep(0.0, 0.55, h) * 0.9 + 0.1);
    c = mixRgb(c, pal.crystalTip, smoothstep(0.55, 1.0, h) * 0.85);
    c = c.map((q, i) => clamp01(q * (1 + f * 0.7) + (i === 2 ? f * 0.05 : 0))) as [number, number, number];
    // facet light/dark side
    const l = clamp01(vdot(v.n, key));
    c = mixRgb(c, frost, l * 0.45);
    // inner core: the lower body of the crystal stays deeper (reads as depth)
    c = mixRgb(c, pal.deep, (1 - smoothstep(0.0, 0.5, h)) * 0.4);
    v.color = mixRgb(v.color, c, cw);
  }));
  out.push(custom('crystalEdges', (v) => {
    const cw = v.region('crystal', 0.004);
    if (cw < 0.05) return;
    const e = smoothstep(0.05, 0.4, v.cavity);
    v.color = mixRgb(v.color, mixRgb(frost, [1, 1, 1], 0.4), e * 0.8 * cw);
  }));
  out.push(custom('hornPaint', (v) => {
    const w = v.region('horn', 0.004);
    if (w < 0.05) return;
    const t = clamp01((v.p[2] / s - 0.5) / 0.65);
    let c = mixRgb(pal.shell, pal.crystal, smoothstep(0.0, 0.55, t));
    c = mixRgb(c, pal.crystalTip, smoothstep(0.5, 0.95, t));
    c = mixRgb(c, frost, clamp01(vdot(v.n, key)) * 0.4);
    v.color = mixRgb(v.color, c, w);
  }));

  // ---- eyes: glowing amber with a bright core and a dark socket ring
  out.push(custom('eyes', (v) => {
    const e = v.region('eye', 0.003);
    const ring = v.region('eye', 0.014);
    if (ring < 0.02) return;
    const core = Math.pow(clamp01(vdot(v.n, vnorm([Math.sign(v.p[0]) * 0.5, 0.55, 0.65]))), 4);
    let c = mixRgb(pal.eye, [1, 0.95, 0.7], core);
    c = mixRgb(c, pal.accent, (1 - core) * 0.45);
    v.color = mixRgb(mixRgb(v.color, pal.vein, 0.8 * ring), c, e);
  }));

  // ---- mandibles: ivory fangs, orange toward the base; teeth ivory; antennae: deep stalk, amber glowing club
  out.push(custom('mandibles', (v) => {
    const w = v.region('mandible', 0.004);
    if (w < 0.05) return;
    const o = onPath(mandLen, [Math.abs(v.p[0]), v.p[1], v.p[2]]);
    const t = (o.k + o.u) / 3;
    let c = mixRgb(pal.accent, pal.claw, smoothstep(0.1, 0.8, t));
    c = mixRgb(c, pal.vein, (1 - smoothstep(0.0, 0.2, t)) * 0.5);
    c = mixRgb(c, [1, 1, 1], clamp01(vdot(v.n, key)) * 0.25);
    v.color = mixRgb(v.color, c, w);
  }));
  out.push(layer('teeth', pal.claw, (v) => v.region('tooth', 0.003) * 0.95));
  out.push(layer('mouth', pal.vein, (v) => v.region('clypeus', 0.01) * smoothstep(-0.2, -0.9, v.n[1]) * 0.8));
  out.push(layer('antenna', mixRgb(pal.deep, pal.shell, 0.5), (v) => v.region('antenna', 0.004) * 0.9));
  out.push(layer('antClub', mixRgb(pal.eye, pal.accent, 0.3), (v) => v.region('club', 0.006) * 0.9));

  // ---- legs: deep blue femur with cyan facets, frosted joints, ice-white tarsus + claws
  out.push(custom('legs', (v) => {
    const w = sum(v, legB);
    if (w < 0.3) return;
    const f = facet(v.n);
    const low = clamp01(sum(v, legLow) * 1.4 - 0.2);
    let c = mixRgb(pal.leg, pal.cyan, 0.25 + 0.4 * clamp01(vdot(v.n, key)));
    const warm = mixRgb(pal.accent, [1, 0.86, 0.5], 0.4 * clamp01(vdot(v.n, key)));
    c = mixRgb(c, warm, low);
    c = c.map((q) => clamp01(q * (1 + f * 0.5))) as [number, number, number];
    c = mixRgb(c, pal.deep, smoothstep(0.35, 0.0, v.p[1] / s) * 0.4);
    v.color = mixRgb(v.color, c, 0.92);
  }));
  out.push(layer('joint', mixRgb(frost, pal.cyan, 0.3), (v) => v.region('joint', 0.003) * 0.9));
  out.push(layer('tarsus', mixRgb(pal.claw, pal.cyan, 0.3), (v) => v.region('tarsus', 0.004) * 0.7));
  out.push(layer('claw', pal.claw, (v) => v.region('claw', 0.003) * 0.95));
  out.push(layer('spine', pal.crystalTip, (v) => v.region('spine', 0.003) * smoothstep(0.4, 0.85, v.ao) * 0.85));
  out.push(layer('under', pal.belly, (v) => v.region('belly', 0.012) * 0.9));


  // ---- frost rim + breakup + crevice depth
  out.push(rimTint(mixRgb(frost, pal.cyan, 0.25), { strength: 0.32, power: 2.4 }));
  out.push(grain(0.035, 120 / s));
  out.push(custom('gloss', (v) => {
    const gl = Math.pow(clamp01(vdot(v.n, half)), 24);
    v.color = mixRgb(v.color, [1, 1, 1], clamp01(gl * 0.6) * (0.4 + 0.6 * v.ao));
  }));
  out.push(cavity(0.4, 0.14));
  out.push(bakeAo(0.7, [0.22, 0.3, 0.5], 1.0));

  const shade: PaintLayer[] = [
    cavity(0.18, 0.1),
    bakeAo(0.42, [0.62, 0.7, 0.9]),
    hemi(rgb('#eefaff'), rgb('#7f98c0'), 0.45),
    rimTint(rgb('#d8f6ff'), { strength: 0.12 }),
  ];
  return { albedo: out, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 90 } } : {}) };
}
