// Materials of the yurt: pressed felt shell with sewn seams, painted trim bands, sooty crown and wind-blown snow patches; a painted crown
// ring; and the lacquered, hand-painted door set (two leaves, jambs, lintel). Everything shades from model-space position (the shell is
// a lathe), so the trim closes round the tent and the arcs the shell is cut into (see `revolveArcs`) show no seams.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import type { Mat, Texel } from '../../mesh.ts';
import { type Rgb, sampleTex } from '../../texlib.ts';
import { edgeWear, fbm01, groundDirt, lacquer, lum, mixc, mulc, pickTex, rainStreaks, rgb } from '../../mats.ts';
import { triTex } from '../PropsOrc/tiles.ts';
import { TAU, cov, diamond, fract, hash3, sdCircle, sdFlower, sdMeander, sdRing, sdZigzag } from './sdf.ts';

export interface FeltOpts {
  /** mean radius of the wall (m) used to size the trim patterns so they close round the tent */
  wallR: number;
  /** wall trim band (red with a blue key-fret): height range */
  band: [number, number];
  /** felt panels round the wall */
  panels?: number;
  /** share of the roof under wind-blown snow (0..1) */
  snow?: number;
}

const goldc = rgb('#d9a532'), red = rgb('#a5281d'), blue = rgb('#1f4f93'), white = rgb('#efe6d0');

/**
 * Felt shell: pressed felt (fibre tile, panel-to-panel tone, grime near the ground, soot streaks round the crown, damp streaks),
 * sewn panel seams with stitches on the wall and radial seams plus overlapping courses on the roof, snow patches on the dome, a red
 * key-fret band on the wall, a red zig-zag band along the roof edge and a dark scalloped skirt at the foot.
 */
export function yurtFelt(name: string, o: FeltOpts): Mat {
  const T = pickTex('tex_felt_white');
  const wallC = rgb('#d3c7aa'), roofC = rgb('#c3b79b'), grime = rgb('#574b39'), soot = rgb('#241c14'), skirt = rgb('#7d6850'), snowC = rgb('#f1f6fb'), seamC = rgb('#6d604a');
  const panels = o.panels ?? 10;
  const NB = Math.round((TAU * o.wallR) / 0.2);
  const NR = 72, PR = (TAU * 3.0) / NR;
  const [b0, b1] = o.band;
  const bh = b1 - b0, byc = (b0 + b1) / 2;
  const snow = o.snow ?? 0;
  return {
    name,
    shade(t: Texel) {
      const [x, y, z] = t.p;
      const rho = Math.hypot(x, z), th = Math.atan2(x, z);
      const aa = Math.max(0.0025, t.mpt * 1.2);
      const roof = t.n[1] > 0.3 && y > 1.0, under = t.n[1] < -0.3;
      const base = roof ? roofC : wallC;
      let c = mulc(base, 0.88 + 0.16 * (0.5 + 0.5 * t.noise.noise(x * 38, y * 38, z * 38)));
      if (T) c = mixc(c, mulc(triTex(t, T, 1.3), (1.05 * lum(base)) / 0.52), 0.65);
      c = mulc(c, 0.86 + 0.22 * fbm01(t, 1.8, 3, 3.7));
      // every felt panel has its own age
      const nP = roof ? 16 : panels;
      const uP = (th / TAU) * nP + 0.5;
      c = mulc(c, 0.9 + 0.17 * hash3(((Math.floor(uP) % nP) + nP) % nP, roof ? 5 : 2, 7));
      if (under) c = mulc(c, 0.88);
      if (!under) {
        if (!roof) {
          // wall: sewn panel seams with stitches
          const d = Math.min(fract(uP), 1 - fract(uP)) * (TAU / nP) * rho;
          const k = cov(d - 0.006, aa);
          c = mixc(c, seamC, k * 0.45);
          c = mulc(c, 1 - 0.18 * cov(d - 0.03, 0.02) * (1 - k));
          if (fract(y / 0.075) < 0.5) c = mixc(c, mulc(seamC, 0.7), cov(d - 0.012, aa) * (1 - k) * 0.5);
        } else {
          // roof: radial seams; overlapping courses with a lit lip and a shadow under it
          const d = Math.min(fract(uP), 1 - fract(uP)) * (TAU / nP) * rho;
          c = mixc(c, seamC, cov(d - 0.006, aa) * 0.45);
          const course = fract((rho - 0.5) / 0.62);
          c = mulc(c, (0.82 + 0.2 * smoothstep(0.0, 0.5, course)) * (1 - 0.3 * smoothstep(0.92, 1.0, course)));
        }
      }
      let snowK = 0;
      if (roof && snow > 0) {
        // wind-blown patches: solid on the shallow crown, breaking up down the steeper dome, bare at the eave
        const v = fbm01(t, 2.6, 4, 21.7) + 0.5 * (smoothstep(0.8, 0.95, t.n[1]) - 0.5) + (snow - 0.5) * 0.6;
        snowK = smoothstep(0.46, 0.54, v);
        const sn = mulc(snowC, 0.94 + 0.1 * fbm01(t, 30, 2, 2.3));
        c = mixc(c, sn, snowK * 0.96);
      }
      if (!roof && !under) {
        // wall trim: red band with white rails, a blue key-fret and gilt dots
        if (Math.abs(y - byc) < bh / 2 + 0.01) {
          const s = th * o.wallR, p = (TAU * o.wallR) / NB, yl = y - byc;
          let bc = mulc(red, 0.9 + 0.2 * fbm01(t, 30, 2, 1.3));
          bc = mixc(bc, white, cov(Math.abs(Math.abs(yl) - (bh / 2 - 0.02)) - 0.006, aa));
          bc = mixc(bc, white, cov(sdMeander(s, yl, p, p / 1.9) - 0.0125, aa));
          bc = mixc(bc, goldc, cov(sdCircle((fract(s / p) - 0.5) * p + p * 0.43, yl + bh * 0.34, 0.006), aa) * 0.9);
          c = mixc(c, mulc(bc, 0.9 + 0.2 * fbm01(t, 55, 2, 2.2)), cov(Math.abs(yl) - bh / 2, aa));
        }
        // dark felt skirt with a scalloped top edge and a pale stitched seam above it
        const sk = 0.31 + 0.035 * Math.abs(Math.sin(th * 30));
        const skK = 1 - smoothstep(sk - 0.01, sk + 0.01, y);
        let sc = mulc(skirt, 0.85 + 0.3 * fbm01(t, 18, 3, 6.2));
        if (T) sc = mixc(sc, mulc(triTex(t, T, 1.1), (1.1 * lum(skirt)) / 0.52), 0.5);
        const stitch = cov(Math.abs(y - (sk - 0.05)) - 0.003, aa) * (fract((th * o.wallR) / 0.045) < 0.55 ? 1 : 0);
        c = mixc(c, mixc(sc, mulc(white, 0.85), stitch * 0.9), skK * 0.95);
        c = mixc(c, white, cov(Math.abs(y - (sk + 0.03)) - 0.005, aa) * 0.8 * (1 - skK));
      }
      if (roof && rho > 2.5) {
        // roof edge trim: red band, white rails, white zig-zag (metres along the slope)
        const rc = (rho - 3.0) * 1.27;
        if (Math.abs(rc) < 0.29) {
          let bc = mulc(red, 0.9 + 0.2 * fbm01(t, 40, 2, 1.4));
          bc = mixc(bc, white, cov(sdZigzag((th / TAU) * NR * PR, rc, PR, 0.12) - 0.011, aa));
          bc = mixc(bc, white, cov(Math.abs(Math.abs(rc) - 0.245) - 0.006, aa));
          bc = mixc(bc, blue, cov(Math.abs(Math.abs(rc) - 0.215) - 0.004, aa));
          c = mixc(c, bc, 1 - smoothstep(0.27, 0.29, Math.abs(rc)));
        }
      }
      if (roof) {
        // smoke soot round the crown, running down in streaks
        const streak = 0.55 + 0.45 * fbm01(t, 4, 3, 9.1);
        c = mixc(c, soot, 0.75 * smoothstep(1.7, 0.85, rho) * streak * (1 - 0.45 * snowK));
        c = mixc(c, mulc(soot, 1.5), 0.5 * smoothstep(0.95, 0.76, rho));
      }
      c = rainStreaks(c, t, 0.5);
      c = groundDirt(c, t, 0.6, 0.7, grime);
      return edgeWear(c, t, mulc(wallC, 1.1), 0.15);
    },
  };
}

/** crown ring: red lacquer, gilt rules and a gilt dot on each facet */
export function crownMat(name: string, y0: number): Mat {
  const base = lacquer(name, { color: '#9a2619', wear: 0.7, dirt: 0.5 });
  return {
    name,
    shade(t) {
      const [x, y, z] = t.p;
      const aa = Math.max(0.002, t.mpt * 1.2);
      const rho = Math.hypot(x, z), th = Math.atan2(x, z);
      let c = base.shade(t);
      const rules = Math.max(cov(Math.abs(y - (y0 + 0.08)) - 0.007, aa), cov(Math.abs(y - (y0 + 0.285)) - 0.007, aa));
      c = mixc(c, mulc(goldc, 0.9 + 0.2 * fbm01(t, 50, 2, 2)), rules);
      const fx = (fract(((th - Math.PI / 2) / TAU) * 16) - 0.5) * ((TAU * rho) / 16);
      c = mixc(c, mulc(goldc, 0.95), cov(sdCircle(fx, y - (y0 + 0.18), 0.034), aa) * (t.n[1] < 0.5 ? 1 : 0));
      return c;
    },
  };
}

/**
 * Door set, painted by world x/y (the leaves sit on the +Z side): red lacquer leaves with a gilt border, a lotus medallion over a blue
 * diamond lattice with gilt studs, brass pull rings; dark red jambs with a gilt line; a teal lintel with a gilt key-fret.
 */
export function yurtDoor(name: string): Mat {
  const Tr = pickTex('tex_wood_lacquer_red');
  const redD = rgb('#a3231c'), under = rgb('#2f1a12'), gold = rgb('#e0ae3c'), blueD = rgb('#1d4f9a'), teal = rgb('#17604e'), cream = rgb('#efe3c2');
  return {
    name,
    shade(t) {
      const [x, y] = t.p;
      const aa = Math.max(0.0025, t.mpt * 1.2);
      const front = t.n[2] > 0.55;
      const lintel = y >= 1.43;
      const leaf = !lintel && Math.abs(x) < 0.525;
      let c: Rgb = Tr ? mulc(sampleTex(Tr, x / 0.8, y / 0.8, t.mpt / 0.8), 0.95) : redD;
      if (!leaf && !lintel) c = mulc(mixc(c, rgb('#5a1a14'), 0.5), 0.95);
      if (lintel) c = mixc(teal, rgb('#0e3d31'), 0.4 * fbm01(t, 20, 2, 3.3));
      if (front) {
        if (leaf) {
          const lx = Math.abs(x), cx = 0.265;
          const bd = Math.min(lx - 0.012, 0.52 - lx, y - 0.1, 1.4 - y);
          c = mixc(c, gold, Math.max(cov(Math.abs(bd - 0.03) - 0.006, aa), cov(Math.abs(bd - 0.05) - 0.0025, aa)));
          // rail between the two panels
          const rail = smoothstep(0.045, 0.055, lx);
          c = mixc(c, mulc(redD, 0.65), cov(Math.abs(y - 0.74) - 0.03, aa) * rail);
          c = mixc(c, gold, cov(Math.abs(Math.abs(y - 0.74) - 0.03) - 0.0035, aa) * rail * 0.9);
          if (y > 0.78 && y < 1.36 && bd > 0.06) {
            // lotus medallion: gilt petals, blue ring, red heart, gilt eye, blue dots above and below
            const fx = lx - cx, fy = y - 1.07;
            c = mixc(c, mulc(gold, 0.92 + 0.14 * fbm01(t, 60, 2, 1.2)), cov(sdFlower(fx, fy, 0.185, 12, 0.3, 0.2), aa));
            c = mixc(c, blueD, cov(sdRing(fx, fy, 0.105, 0.016), aa));
            c = mixc(c, redD, cov(sdCircle(fx, fy, 0.06), aa));
            c = mixc(c, gold, cov(sdCircle(fx, fy, 0.022), aa));
            c = mixc(c, blueD, Math.max(cov(sdCircle(fx, fy - 0.235, 0.014), aa), cov(sdCircle(fx, fy + 0.235, 0.014), aa)));
          } else if (y > 0.1 && y < 0.7 && bd > 0.06) {
            // cream diamond lattice with a gilt stud in every diamond
            c = mixc(c, mulc(cream, 0.92), cov(Math.abs(diamond(lx - cx, y - 0.4, 0.16) - 1.0) * 0.08 - 0.0042, aa) * 0.9);
            const cellx = (fract((lx - cx) / 0.16) - 0.5) * 0.16, celly = (fract((y - 0.4) / 0.16) - 0.5) * 0.16;
            c = mixc(c, gold, cov(sdCircle(cellx, celly, 0.012), aa));
          }
          // centre seam and brass pull rings
          c = mixc(c, mulc(under, 1.2), cov(lx - 0.004, aa) * 0.9);
          c = mixc(c, gold, cov(Math.hypot(lx - 0.09, y - 0.75) - 0.035, aa) * 0.9);
          c = mixc(c, mulc(under, 1.1), cov(sdRing(lx - 0.09, y - 0.75, 0.024, 0.0045), aa));
        } else if (lintel) {
          const ly = y - 1.51;
          c = mixc(c, gold, cov(sdMeander(x + 0.07, ly, 0.14, 0.14 / 1.9) - 0.0065, aa));
          c = mixc(c, cream, cov(Math.abs(Math.abs(ly) - 0.068) - 0.0035, aa));
        } else {
          c = mixc(c, gold, cov(Math.abs(Math.abs(x) - 0.595) - 0.006, aa) * 0.85);
        }
      }
      // chipped lacquer on the edges, damp and dirt toward the ground
      c = mixc(c, mulc(under, 1.4), clamp01(smoothstep(0.4, 0.85, t.edge * 1.5 * (0.4 + fbm01(t, 45, 2, 5.3)))) * 0.7);
      c = rainStreaks(c, t, 0.4);
      return groundDirt(c, t, 0.5, 0.45, rgb('#4b3a28'));
    },
  };
}
