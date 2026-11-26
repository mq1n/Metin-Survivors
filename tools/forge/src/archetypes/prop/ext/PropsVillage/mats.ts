// Materials for the village props (lamp post, well, yurt): glowing glyph paper lantern, painted lacquer door panels.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import type { Mat } from '../../mesh.ts';
import type { Rgb } from '../../texlib.ts';
import { fbm01, mixc, mulc, rgb } from '../../mats.ts';
import { GLYPHS, type GlyphName, glyphCov } from './glyph.ts';
import { cov, fract, sdCircle, sdFlower, sdRing } from './sdf.ts';

const TAU = Math.PI * 2;

export interface LanternOpts {
  /** lantern axis (xz) and the height range of the paper zone */
  cx: number;
  cz: number;
  y0: number;
  y1: number;
  /** panels round the body; panel 0 is centred on +Z */
  panels?: number;
  glyph?: GlyphName;
  glow?: number;
}

/**
 * Hanging paper lantern: warm yellow paper in `panels` flat faces, dark bamboo ribs at the panel edges and two hoops, red border bands
 * top and bottom, a brush glyph in a ring on every even face and a lotus medallion on the odd ones. Emission follows the paper and is
 * damped under the ink, brightest at the candle (low in the body), black on the ribs.
 */
export function paperLantern(name: string, o: LanternOpts): Mat {
  const n = o.panels ?? 8;
  const paper = rgb('#ffbf2e'), warm = rgb('#f2820f'), rib = rgb('#4a1e10'), red = rgb('#b3261e'), goldc = rgb('#f3c04a');
  const glow = o.glow ?? 1;
  const cell = (t: { p: [number, number, number] }): { k: number; local: number; rho: number } => {
    const dx = t.p[0] - o.cx, dz = t.p[2] - o.cz;
    const ang = Math.atan2(dx, dz);
    const k = Math.round((ang / TAU) * n);
    return { k, local: ang - (k / n) * TAU, rho: Math.hypot(dx, dz) };
  };
  const paint = (t: Parameters<Mat['shade']>[0]): { c: Rgb; ink: number; ribK: number } => {
    const { k, local, rho } = cell(t);
    const aa = Math.max(0.0016, t.mpt * 1.1);
    const sx = rho * Math.sin(local);
    const half = rho * Math.sin(Math.PI / n);
    const h = o.y1 - o.y0;
    const yn = (t.p[1] - o.y0) / h;
    let c = mixc(paper, warm, 0.25 * fbm01(t, 22, 3, 1.3) + 0.3 * Math.abs(sx) / half * 0.4);
    // darker toward the panel edges (paper folds over the rib)
    c = mulc(c, 1 - 0.16 * smoothstep(0.55, 1, Math.abs(sx) / half));
    let ink = 0;
    // red borders top and bottom with a gold hairline
    const bord = Math.max(cov(Math.abs(yn - 0.07) - 0.07, aa / h), cov(Math.abs(yn - 0.93) - 0.07, aa / h));
    ink = Math.max(ink, bord);
    c = mixc(c, mulc(red, 0.85 + 0.2 * fbm01(t, 30, 2, 2.1)), bord);
    const gl = Math.max(cov(Math.abs(yn - 0.15) - 0.008, aa / h), cov(Math.abs(yn - 0.85) - 0.008, aa / h));
    c = mixc(c, goldc, gl * 0.9);
    // glyph ring / lotus medallion
    const cy = o.y0 + h * 0.5;
    const gx = sx, gy = t.p[1] - cy;
    if (k % 2 === 0 || n % 2 === 1) {
      const ringC = cov(sdRing(gx, gy, half * 0.74, 0.004), aa);
      c = mixc(c, red, ringC);
      ink = Math.max(ink, ringC);
      const g = glyphCov(GLYPHS[o.glyph ?? 'luck'], gx, gy, half * 1.25, 0.058, aa * 1.1, 0.4);
      c = mixc(c, mulc(red, 0.9), g);
      ink = Math.max(ink, g);
    } else {
      const fl = sdFlower(gx, gy, half * 0.62, 8, 0.34, 0.2);
      const f = cov(fl, aa);
      c = mixc(c, mulc(red, 0.9), f);
      c = mixc(c, mulc(paper, 0.95), cov(sdFlower(gx, gy, half * 0.38, 8, 0.34, 0.9), aa));
      c = mixc(c, red, cov(sdCircle(gx, gy, half * 0.12), aa));
      ink = Math.max(ink, f * 0.9);
    }
    // bamboo ribs and two hoops
    const ribEdge = smoothstep(half - 0.011, half - 0.002, Math.abs(sx));
    const hoops = Math.max(cov(Math.abs(yn - 0.33) * h - 0.005, aa), cov(Math.abs(yn - 0.67) * h - 0.005, aa));
    return { c, ink, ribK: clamp01(Math.max(ribEdge, hoops)) };
  };
  return {
    name,
    ao: 0.12,
    shade(t) {
      const { c, ribK } = paint(t);
      return mixc(c, mulc(rib, 0.9 + 0.2 * fbm01(t, 40, 2, 3.1)), ribK * 0.92);
    },
    emit(t) {
      const { c, ink, ribK } = paint(t);
      const yn = clamp01((t.p[1] - o.y0) / (o.y1 - o.y0));
      const flame = 0.8 + 0.4 * Math.exp(-((yn - 0.3) ** 2) / 0.12);
      const e = mixc(mulc(c, 0.95), warm, 0.3);
      return mulc(e, glow * flame * (1 - 0.72 * ink) * (1 - ribK * 0.95));
    },
  };
}

export { fract };
