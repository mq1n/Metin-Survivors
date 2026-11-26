// prop_urn — large glazed storage urn (1.2 m): cobalt glaze with ivory painted bands (upright lotus petals, a floral scroll round the belly,
// pendant ruyi lappets on the shoulder, a key-fret neck), iron-brown lip, unglazed foot ring, strap ear handles and a domed lid with a
// gilded bud knob. Chipped rim, crazing, soil at the foot. Front = +Z.
import type { Vec3 } from '../../core/math.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapCylY } from '../../archetypes/prop/mesh.ts';
import { revolve } from '../../archetypes/prop/kit.ts';
import { fbm01, groundDirt, line, mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import { tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { TAU, cov, fract, sdCircle, sdFlower, sdLeaf, sdMeander, sdPetal } from '../../archetypes/prop/ext/PropsVillage/sdf.ts';

const GLAZE = 0, HANDLE = 1;
const SEG = 20;

/** [radius, height] bottom -> top: foot ring, undercut waist, swelling belly, shoulder, neck, flared lip */
const BODY: [number, number][] = [
  [0.285, 0.0], [0.31, 0.045], [0.3, 0.08], [0.4, 0.17], [0.49, 0.32], [0.5, 0.45], [0.47, 0.6], [0.39, 0.73], [0.3, 0.83], [0.262, 0.89], [0.255, 0.945], [0.3, 1.0], [0.315, 1.04],
];
/** domed lid with a rolled rim and a bud knob */
const LID: [number, number][] = [[0.322, 1.03], [0.33, 1.055], [0.28, 1.09], [0.17, 1.135], [0.06, 1.16], [0.065, 1.185], [0.0, 1.2]];
const LID_Y = 1.029;

/** bands of the painted decoration (heights in metres) */
const LOTUS = { y0: 0.09, h: 0.165, n: 12, w: 0.19 };
const BELLY = { y0: 0.3, y1: 0.62, n: 6 };
const LAPPET = { top: 0.845, h: 0.16, n: 12, w: 0.18 };
const NECK = { y0: 0.885, y1: 0.945 };

function glaze(): Mat {
  const cobalt = rgb('#1a3780'), deep = rgb('#0c2158'), lite = rgb('#3a64b6');
  const cream = rgb('#efe3c2'), cream2 = rgb('#d3c49f'), gold = rgb('#d6a43c'), teal = rgb('#74b8aa'), lip = rgb('#38220f'), biscuit = rgb('#b88c5c'), crack = rgb('#241710');
  return {
    name: 'urn-glaze',
    shade(t) {
      const [x, y, z] = t.p;
      const th = Math.atan2(x, z), rho = Math.hypot(x, z);
      const aa = Math.max(0.0016, t.mpt * 1.1);
      const nz = (f: number, o: number): number => t.noise.noise(x * f + o, y * f - o, z * f + o * 0.5);
      // ---- glaze ground: deeper where it pools low and in the recesses, thinner (paler) over the swell
      const pool = clamp01(1 - y / 0.9) * 0.4 + (1 - t.ao) * 0.9;
      let c = mixc(cobalt, lite, 0.28 + 0.32 * fbm01(t, 5, 3, 1.7) - 0.3 * pool);
      c = mixc(c, deep, clamp01(pool * 0.6));
      c = mulc(c, 0.93 + 0.14 * nz(46, 3.1));
      let ink = 0;
      let paint = cream;
      /** metres along the circumference of a band of reference radius `rr`, cell-centred, `n` repeats */
      const cell = (n: number, rr: number, shift = 0): number => (fract((th / TAU) * n + shift) - 0.5) * ((TAU * rr) / n);
      if (y >= LID_Y) {
        // ---- lid: radial lotus petals round the knob, cream lines at the rim, gilded bud
        const xl = cell(8, Math.max(rho, 0.06));
        if (y > 1.168) {
          ink = 1;
          paint = mixc(gold, rgb('#fff0a8'), 0.35 * t.edge + 0.12);
        } else if (rho > 0.07) {
          const d = sdPetal(xl, rho - 0.075, 0.115, 0.17);
          const fill = cov(d, aa);
          ink = fill;
          paint = mixc(cream, lite, cov(sdPetal(xl, rho - 0.088, 0.062, 0.1), aa) * 0.8);
          paint = mixc(paint, deep, line(d + 0.009, 0.003, aa) * fill * 0.9);
          const rim = Math.max(line(y - 1.047, 0.0032, aa), line(y - 1.062, 0.0022, aa));
          if (rim > ink && rho > 0.26) { ink = rim; paint = mixc(cream, gold, 0.5); }
        }
      } else if (y <= 0.085) {
        // ---- unglazed foot ring: buff clay, soot and soil
        ink = 1 - smoothstep(0.075, 0.09, y);
        paint = mixc(biscuit, rgb('#6d4a2d'), 0.45 * fbm01(t, 12, 3, 5.5) + 0.25 * (1 - t.ao));
      } else if (y < BELLY.y0 - 0.01) {
        // ---- upright lotus petals above the foot
        const xl = cell(LOTUS.n, 0.4);
        const d = sdPetal(xl, y - LOTUS.y0, LOTUS.w, LOTUS.h);
        const fill = cov(d, aa);
        const inner = cov(sdPetal(xl, y - LOTUS.y0 - 0.012, LOTUS.w * 0.58, LOTUS.h * 0.7), aa);
        ink = fill;
        paint = mixc(cream, cream2, (0.3 * (y - LOTUS.y0)) / LOTUS.h);
        paint = mixc(paint, lite, inner * 0.8);
        paint = mixc(paint, deep, line(d + 0.011, 0.0038, aa) * fill * 0.95);
        paint = mixc(paint, gold, cov(sdCircle(xl, y - LOTUS.y0 - 0.095, 0.011), aa) * inner);
        const l1 = Math.max(line(y - 0.272, 0.0035, aa), line(y - 0.286, 0.0022, aa));
        if (l1 > ink) { ink = l1; paint = mixc(cream, gold, 0.55); }
      } else if (y <= BELLY.y1 + 0.025) {
        // ---- floral scroll: flowers on an S vine with paired leaves between them
        const P = (TAU * 0.49) / BELLY.n;
        const xl = cell(BELLY.n, 0.49, 0.25);
        const yl = y - (BELLY.y0 + BELLY.y1) / 2;
        const vine = 0.052 * Math.sin((TAU * xl) / P);
        ink = cov(Math.abs(yl - vine) - 0.0042, aa);
        paint = cream2;
        const fl = sdFlower(xl, yl, 0.098, 10, 0.3, 0.4);
        const flowerCov = cov(fl, aa);
        if (flowerCov > 0) {
          ink = Math.max(ink, flowerCov);
          paint = mixc(cream, lite, cov(sdFlower(xl, yl, 0.062, 8, 0.32, 0.9), aa) * 0.9);
          paint = mixc(paint, cream, cov(sdFlower(xl, yl, 0.04, 6, 0.3, 0.2), aa));
          paint = mixc(paint, gold, cov(sdCircle(xl, yl, 0.017), aa));
          paint = mixc(paint, deep, line(fl + 0.009, 0.0032, aa) * flowerCov * 0.7);
        }
        // alternate leaf fans on the crest (up) and the trough (down) of the vine
        for (const [cx, sgn] of [[P / 4, 1], [-P / 4, -1]] as const) {
          const ox = xl - cx, oy = yl - sgn * 0.052;
          for (const da of [-0.66, 0.66]) {
            const a = sgn * (Math.PI / 2 + da);
            const ca = Math.cos(a), sa = Math.sin(a);
            const lx = ox * ca + oy * sa, ly = -ox * sa + oy * ca;
            const lf = cov(sdLeaf(lx, ly, 0.105, 0.056), aa);
            if (lf > 0) {
              ink = Math.max(ink, lf);
              paint = mixc(paint, teal, lf);
              paint = mixc(paint, cream, line(ly, 0.0026, aa) * lf * 0.9);
            }
          }
        }
        const dots = Math.max(cov(sdCircle(xl - P / 4, yl + 0.1, 0.0075), aa), cov(sdCircle(xl + P / 4, yl - 0.1, 0.0075), aa), cov(sdCircle(xl - P / 2, yl, 0.0075), aa));
        if (dots > ink) { ink = dots; paint = gold; }
      } else if (y < LAPPET.top + 0.005) {
        // ---- pendant ruyi lappets on the shoulder (points down)
        const xl = cell(LAPPET.n, 0.4, 0.5);
        const yd = LAPPET.top - y;
        const d = sdPetal(xl, yd, LAPPET.w, LAPPET.h);
        const fill = cov(d, aa);
        ink = fill;
        paint = mixc(cream, cream2, (0.5 * yd) / LAPPET.h);
        paint = mixc(paint, lite, cov(sdPetal(xl, yd - 0.016, LAPPET.w * 0.6, LAPPET.h * 0.62), aa) * 0.9);
        paint = mixc(paint, gold, cov(sdCircle(xl, yd - 0.05, 0.0105), aa));
        paint = mixc(paint, deep, line(d + 0.011, 0.0034, aa) * fill * 0.9);
        const gap = cov(sdCircle(Math.abs(xl) - LAPPET.w * 0.5, yd - 0.02, 0.0085), aa);
        if (gap > ink) { ink = gap; paint = cream; }
        const l2 = Math.max(line(y - (BELLY.y1 + 0.005), 0.0035, aa), line(y - (BELLY.y1 + 0.02), 0.0022, aa));
        if (l2 > ink) { ink = l2; paint = mixc(cream, gold, 0.55); }
      } else if (y >= NECK.y0 && y <= NECK.y1) {
        // ---- key-fret neck between fine lines
        const d = sdMeander(th * 0.262, y - (NECK.y0 + NECK.y1) / 2, 0.052, 0.036) - 0.0036;
        ink = cov(d, aa);
        paint = cream;
        const l3 = Math.max(line(y - (NECK.y0 + 0.004), 0.0034, aa), line(y - (NECK.y1 - 0.003), 0.0034, aa));
        if (l3 > ink) { ink = l3; paint = mixc(cream, gold, 0.6); }
      } else if (y > NECK.y1) {
        // ---- lip: dark iron-brown dressing
        ink = smoothstep(0.972, 0.99, y);
        paint = mixc(lip, rgb('#4a2d1a'), 0.5 * fbm01(t, 30, 2, 3.3));
      }
      if (ink > 0) c = mixc(c, mulc(paint, 0.94 + 0.12 * nz(60, 8.2)), ink);
      // ---- glaze crazing: hairline cracks, paler on the cobalt, darker on the cream
      const crz = 1 - smoothstep(0.0, 0.028, Math.abs(t.noise.noise(x * 11 + 3, y * 11, z * 11 - 2)));
      c = mixc(c, mulc(c, ink > 0.5 ? 0.78 : 1.35), crz * 0.22);
      // ---- chips on the lid edge and foot: the clay body shows through (sparse)
      const dEdge = Math.min(Math.hypot(rho - 0.33, y - 1.055), Math.hypot(rho - 0.322, y - 1.03), Math.hypot(rho - 0.29, y - 0.004), Math.hypot(rho - 0.315, y - 0.05) * 1.2);
      const chip = (1 - smoothstep(0.004, 0.016, dEdge)) * smoothstep(0.3, 0.42, nz(26, 6.1));
      c = mixc(c, mixc(biscuit, crack, 0.2 * smoothstep(0.1, 0.6, nz(120, 2.2) + 0.4)), chip);
      // ---- pits where the glaze crawled, and algae creeping up from the ground
      const pit = smoothstep(0.52, 0.6, nz(60, 9.7)) * (y > 0.12 ? 1 : 0);
      c = mixc(c, mulc(biscuit, 0.8), pit * 0.6);
      c = mixc(c, mulc(rgb('#4d6a2a'), 0.7 + 0.6 * fbm01(t, 20, 2, 4.4)), (1 - smoothstep(0.02, 0.2 + 0.1 * nz(8, 1.1), y)) * 0.38 * smoothstep(-0.2, 0.3, nz(9, 5.1)));
      return groundDirt(c, t, 0.2, 0.55, rgb('#4b3a28'));
    },
  };
}

/** ear handles: ivory glaze with cobalt ribbon bands across the strap */
function handleMat(): Mat {
  const cream = rgb('#e9deba'), blue = rgb('#1c3b86');
  return {
    name: 'urn-handle',
    shade(t) {
      let c = mulc(cream, 0.9 + 0.14 * fbm01(t, 40, 2, 2.2));
      const aa = Math.max(0.004, t.mpt * 1.2);
      const band = cov(Math.abs(fract(t.uv[0] / 0.11 + 0.3) - 0.5) * 0.11 - 0.014, aa);
      c = mixc(c, mulc(blue, 0.9 + 0.2 * fbm01(t, 30, 2, 1.4)), 0.9 * band);
      c = mixc(c, rgb('#4a3322'), clamp01(t.edge * 1.2) * 0.4);
      return groundDirt(c, t, 0.15, 0.3);
    },
  };
}

export const prop: PropDef = {
  id: 'prop_urn',
  size: 1024,
  aoLong: 1.4,
  crease: 38,
  material: { roughness: 0.42, metallic: 0 },
  mats: [glaze(), handleMat()],
  build(m: PropMesh) {
    const map = mapCylY(0, 0, 0.45, 0.5);
    m.add(revolve(BODY, SEG), GLAZE, map);
    m.add(revolve(LID, SEG), GLAZE, map);
    // strap ear handles arching from the shoulder up to the neck (flat rectangular strap, smooth 9-point arc)
    for (const sx of [-1, 1]) {
      const pts: Vec3[] = [[0.355, 0.742], [0.46, 0.76], [0.545, 0.82], [0.567, 0.895], [0.51, 0.952], [0.4, 0.972], [0.25, 0.94]].map(([r, y]) => [sx * r!, y!, 0] as Vec3);
      tube(m, { path: pts, radii: [0.05, 0.054, 0.055, 0.054, 0.051, 0.047, 0.04], sides: 4, phase: Math.PI / 4, mat: HANDLE, s: 1, squash: 0.62, caps: 'none', seed: `urn-handle${sx}`, jitter: 0.015 });
    }
  },
};
