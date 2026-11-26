// Golem paint stacks (albedo baked per texel, shade = per-vertex AO/cavity multiplier, emissive = black-initial glow layers).
// Ice: strata + snow caps + fracture veins; the cyan core, eyes and cracks near the core glow. Fire: cracked basalt with a
// lava seam network; lava parts, scorched rims and ember cracks glow.
import { clamp01, smoothstep } from '../../core/math.ts';
import { bakeAo, cavity, custom, fill, grain, hemi, rimTint } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, mixRgb, rgb } from '../../core/paint/painter.ts';

export interface GolemPaint {
  albedo: PaintLayer[];
  shade: PaintLayer[];
  emissive: PaintLayer[];
}

/** 0..1 mask of the cell-boundary network of a 3-D voronoi (fracture lines); `width` in cell units */
function cells(v: PaintVertex, freq: number, width: number, seedOffset = 0): number {
  const c = v.noise.voronoi(v.p[0] * freq + seedOffset, v.p[1] * freq * 1.15 + seedOffset * 0.6, v.p[2] * freq - seedOffset * 0.4, 1);
  return 1 - smoothstep(0.0, width, c.f2 - c.f1);
}

export function icePaint(): GolemPaint {
  const deep = rgb('#2c6aa3'), mid = rgb('#74b2dc'), pale = rgb('#c3e4f5'), snow = rgb('#eef8ff'), crevice = rgb('#1b4a82');
  const glow = rgb('#7ff0ff'), vein = rgb('#e6fbff'), glowBody = rgb('#2aa4d0');
  // baked light direction of the unlit glow (upper front-left), normalised
  const LN = Math.hypot(-0.35, 0.65, 0.68);
  const LX = -0.35 / LN, LY = 0.65 / LN, LZ = 0.68 / LN;
  return {
    albedo: [
      fill(mid),
      custom('strata', (v) => {
        const t = v.p[1] * 6.5 + 1.8 * v.noise.fbm(v.p[0] * 1.6, v.p[1] * 0.8, v.p[2] * 1.6, { octaves: 2 });
        const band = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
        v.color = mixRgb(v.color, band > 0.5 ? pale : deep, 0.34 * Math.abs(band - 0.5) * 2);
      }),
      custom('mottle', (v) => {
        const n = v.noise.fbm(v.p[0] * 4.2, v.p[1] * 4.2, v.p[2] * 4.2, { octaves: 3 });
        v.color = mixRgb(v.color, n > 0 ? pale : deep, Math.abs(n) * 0.7);
      }),
      custom('snow', (v) => {
        const up = smoothstep(0.35, 0.8, v.n[1]);
        const n = 0.55 + 0.45 * v.noise.fbm(v.p[0] * 7, v.p[1] * 7, v.p[2] * 7, { octaves: 2 });
        v.color = mixRgb(v.color, snow, clamp01(up * n) * 0.85);
      }),
      custom('fractures', (v) => {
        // crack density varies across the body (dense webs around joints and the core, big clean facets elsewhere) and thins out on snow-capped tops
        const dens = smoothstep(-0.35, 0.45, v.noise.fbm(v.p[0] * 1.4 + 5, v.p[1] * 1.4, v.p[2] * 1.4 - 3, { octaves: 2 }));
        const up = smoothstep(0.35, 0.85, v.n[1]);
        const c = cells(v, 3.0, 0.06) * (0.3 + 0.7 * dens) * (1 - 0.6 * up);
        if (c > 0) v.color = mixRgb(v.color, crevice, c * 0.6);
        const w = cells(v, 1.9, 0.03, 11) * smoothstep(0.1, 0.5, v.noise.fbm(v.p[0] * 3, v.p[1] * 3, v.p[2] * 3, { octaves: 2 }) + 0.3) * (0.35 + 0.65 * dens);
        if (w > 0) v.color = mixRgb(v.color, vein, w * 0.8);
      }),
      custom('face', (v) => {
        const m = v.region('face', 0.03);
        if (m > 0) v.color = mixRgb(v.color, deep, m * 0.75);
      }),
      grain(0.08, 90),
      custom('core', (v) => {
        const m = v.region('core', 0.004);
        if (m > 0) v.color = mixRgb(v.color, glowBody, m);
      }),
    ],
    shade: [cavity(0.4, 0.14), bakeAo(0.62, [0.45, 0.55, 0.72], 1.2), hemi(rgb('#f2fbff'), rgb('#7d93a8'), 0.5), rimTint(rgb('#d8f4ff'), { strength: 0.1 })],
    emissive: [
      custom('core-glow', (v) => {
        const m = v.region('core', 0.004);
        const halo = v.region('core', 0.05);
        // the glow is unlit, so bake facets into it: light from the upper front-left, a darker body and thin bright fractures inside
        const facet = clamp01(v.n[0] * LX + v.n[1] * LY + v.n[2] * LZ);
        const body = 0.4 + 0.6 * facet;
        const flaw = cells(v, 9, 0.05, 7) * m;
        const bleed = halo * halo * 0.22 * (1 - m);
        const k = m * body + bleed;
        let r = glow[0] * k + vein[0] * flaw * 0.4, g = glow[1] * k + vein[1] * flaw * 0.4, b = glow[2] * k + vein[2] * flaw * 0.4;
        // cracks running out of the core into the ice
        const near = v.region('core', 0.55);
        const cr = cells(v, 3.4, 0.06) * near * (1 - m);
        r += glow[0] * cr * 0.8; g += glow[1] * cr * 0.8; b += glow[2] * cr * 0.8;
        v.color = [r, g, b];
      }),
    ],
  };
}

export function firePaint(): GolemPaint {
  const basalt = rgb('#52413f'), dark = rgb('#2a1f20'), light = rgb('#7a6462'), scorch = rgb('#7a2a10');
  const lava = rgb('#ff6a14'), hot = rgb('#ffc24a'), ember = rgb('#ff4a0a');
  return {
    albedo: [
      fill(basalt),
      custom('mottle', (v) => {
        const n = v.noise.fbm(v.p[0] * 5, v.p[1] * 5, v.p[2] * 5, { octaves: 3 });
        v.color = mixRgb(v.color, n > 0 ? light : dark, Math.abs(n) * 0.9);
      }),
      custom('columns', (v) => {
        const r = v.noise.ridged(v.p[0] * 11, v.p[1] * 1.6, v.p[2] * 11, { octaves: 2 });
        v.color = mixRgb(v.color, dark, smoothstep(0.55, 0.95, r) * 0.45);
      }),
      custom('edges', (v) => {
        if (v.cavity > 0) v.color = mixRgb(v.color, light, clamp01(v.cavity) * 0.5);
      }),
      custom('scorch', (v) => {
        const m = v.region('lava', 0.14);
        if (m > 0) v.color = mixRgb(v.color, scorch, m * m * 0.85);
        const c = cells(v, 3.0, 0.07, 5) * smoothstep(-0.2, 0.3, v.noise.fbm(v.p[0] * 2.4, v.p[1] * 2.4, v.p[2] * 2.4, { octaves: 2 }));
        if (c > 0) v.color = mixRgb(v.color, scorch, c * 0.9);
      }),
      grain(0.1, 80),
      custom('lava', (v) => {
        const m = v.region('lava', 0.004);
        if (m > 0) v.color = mixRgb(v.color, lava, m);
      }),
    ],
    shade: [cavity(0.45, 0.12), bakeAo(0.7, [0.4, 0.34, 0.34], 1.25), hemi(rgb('#ffe8d8'), rgb('#6a4a40'), 0.45), rimTint(rgb('#ff9a5a'), { strength: 0.06 })],
    emissive: [
      custom('lava-glow', (v) => {
        const m = v.region('lava', 0.004);
        const bloom = v.region('lava', 0.06);
        // molten surface: bright flowing lava broken by a darker cooling crust (cell edges) so large glowing masses are not flat
        const crust = cells(v, 9.0, 0.1, 21);
        const flow = 0.62 + 0.38 * smoothstep(-0.5, 0.5, v.noise.fbm(v.p[0] * 7, v.p[1] * 7, v.p[2] * 7, { octaves: 3 }));
        const flick = flow * (1 - 0.5 * crust);
        let r = lava[0] * m * flick, g = lava[1] * m * flick, b = lava[2] * m * flick;
        const h = m * m * m * 0.3 * (1 - crust) * flow;
        r += hot[0] * h; g += hot[1] * h; b += hot[2] * h;
        // scorched rim bleeding into the plates around lava
        const rim = bloom * bloom * (1 - m) * 0.55;
        r += ember[0] * rim; g += ember[1] * rim; b += ember[2] * rim;
        // ember cracks across the basalt, strongest near the seams
        const near = v.region('lava', 0.5);
        const cr = cells(v, 3.0, 0.05, 5) * (0.15 + 0.85 * near) * smoothstep(-0.2, 0.3, v.noise.fbm(v.p[0] * 2.4, v.p[1] * 2.4, v.p[2] * 2.4, { octaves: 2 })) * (1 - m);
        r += ember[0] * cr * 0.9; g += ember[1] * cr * 0.9; b += ember[2] * cr * 0.9;
        v.color = [r, g, b];
      }),
    ],
  };
}
