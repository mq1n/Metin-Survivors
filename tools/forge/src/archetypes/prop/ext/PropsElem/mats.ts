// Materials for the PropsElem models (faceted rock, sandstone, basalt, obsidian, ice, patinated metals, ...).
// Hull-based parts (hull.ts) must use materials that read the edge-distance uv through hullEdge() and sample in world space.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import type { Mat, Texel } from '../../mesh.ts';
import { fbm01, groundDirt, lum, mixc, mossOn, mulc, pickTex, rgb, snowOn } from '../../mats.ts';
import type { Rgb } from '../../texlib.ts';
import { hullEdge } from './hull.ts';
import { type Glow, type Stop, cracks, facetHash, noiseBump, ramp, triSample, veins } from './paint.ts';

export interface RockMatOpts {
  /** optional tileable (luminance only) blended into the procedural stone */
  tex?: string[];
  texAmt?: number;
  /** texture repeats per metre */
  k?: number;
  dark: string;
  light: string;
  /** facet tint pair (warm / cool) mixed in per facet */
  warm?: string;
  cool?: string;
  /** 0..1 strength of the per-facet value/tint variation */
  facet?: number;
  /** strata band contrast (0 = none) */
  strata?: number;
  moss?: number;
  lichen?: number;
  snow?: number;
  dirt?: number;
  /** painted dark crack lines 0..1 */
  cracks?: number;
  /** chipped-edge highlight colour + width (m) + strength */
  edge?: string;
  edgeW?: number;
  edgeAmt?: number;
  /** vertical drip stains 0..1 */
  stain?: number;
  /** speckle (mica / grain) strength */
  grain?: number;
  /** baked micro relief strength (0 = none, ~0.5 = pronounced) */
  bump?: number;
  /** damp green-black staining that climbs from the ground (0..1) */
  damp?: number;
  /** architecture parts (revolve / prism with tile uv): chipped edges come from the baked convexity instead of the hull edge uv */
  arch?: boolean;
}

/** faceted rock: procedural strata + grain (+ optional texture luminance), per-facet painting, cracks, chipped edges, moss / lichen / snow */
export function rockMat(name: string, o: RockMatOpts): Mat {
  const T = o.tex ? pickTex(...o.tex) : null;
  const dark = rgb(o.dark), light = rgb(o.light);
  const warm = rgb(o.warm ?? '#8a7a66'), cool = rgb(o.cool ?? '#6c7480');
  const edgeCol = rgb(o.edge ?? '#cfc7b6');
  const k = o.k ?? 0.8;
  const fa = o.facet ?? 0.6;
  const st = o.strata ?? 0.5;
  return {
    name,
    shade(t) {
      // --- value field: strata + blotches + grain
      const p = t.p;
      const tilt = p[1] + 0.35 * p[0] - 0.2 * p[2];
      const band = t.noise.fbm(p[0] * 0.9, tilt * 6.5, p[2] * 0.9, { octaves: 3 });
      const blot = t.noise.fbm(p[0] * 2.6, p[1] * 2.6, p[2] * 2.6, { octaves: 4 });
      const mid = t.noise.fbm(p[0] * 9, p[1] * 9, p[2] * 9, { octaves: 3 });
      let l = 0.5 + 0.3 * blot + st * 0.22 * band + 0.13 * mid;
      if (T) l = mixc([l, l, l], [clamp01((lum(triSample(t, T, k)) - 0.03) / 0.35), 0, 0], o.texAmt ?? 0.4)[0]!;
      if (o.grain) l += o.grain * 0.16 * t.noise.noise(p[0] * 70, p[1] * 70, p[2] * 70) + o.grain * 0.08 * t.noise.noise(p[0] * 150 + 3, p[1] * 150, p[2] * 150);
      let c = mixc(dark, light, clamp01(l));
      const f1 = facetHash(t), f2 = facetHash(t, 3);
      c = mulc(c, 1 + (f1 - 0.5) * 0.55 * fa);
      c = mixc(c, f2 > 0.5 ? warm : cool, Math.abs(f2 - 0.5) * 0.8 * fa);
      c = mulc(c, 0.88 + 0.18 * (t.nf[1] * 0.5 + 0.5));
      if (o.dirt) c = groundDirt(c, t, 0.3, o.dirt);
      if (o.stain) {
        const s = t.noise.fbm(p[0] * 9 + p[2] * 9, p[1] * 1.3, p[2] * 4, { octaves: 3 }) * 0.5 + 0.5;
        c = mulc(c, 1 - o.stain * 0.38 * smoothstep(0.55, 0.85, s) * (1 - t.nf[1] * t.nf[1]));
      }
      if (o.cracks) {
        const vn = veins(t, 2.3, 0.006, 1, 0.55) + 0.6 * veins(t, 5.5, 0.0035, 4, 0.45);
        c = mulc(c, 1 - o.cracks * 0.55 * clamp01(vn));
      }
      if (o.lichen) {
        const n = fbm01(t, 6.5, 3, 4.4);
        const patch = smoothstep(0.68 - o.lichen * 0.15, 0.78, n) * (0.35 + 0.65 * clamp01(t.nf[1] * 0.7 + 0.5));
        const lc = mixc(rgb('#a8ad8c'), rgb('#cfc07a'), fbm01(t, 11, 2, 9.1));
        c = mixc(c, lc, clamp01(patch) * 0.7);
      }
      if (o.moss) c = mossOn(c, t, o.moss, rgb('#5d7a2b'), 3.4);
      if (o.damp) {
        const reach = 0.5 + 0.9 * fbm01(t, 4, 3, 2.4) + 0.35 * t.noise.noise(p[0] * 14, p[1] * 2, p[2] * 14);
        const k = (1 - smoothstep(0.1, reach, t.hy)) * o.damp;
        c = mixc(c, mulc(rgb('#3f4a2c'), 0.7 + 0.5 * fbm01(t, 20, 2, 8)), clamp01(k) * 0.75);
      }
      const w = (o.edgeW ?? 0.03) * (0.5 + 1.0 * fbm01(t, 26, 2, 2.2));
      const chip = smoothstep(0.38, 0.62, 0.5 + 0.5 * t.noise.noise(p[0] * 22, p[1] * 22, p[2] * 22));
      const near = o.arch ? smoothstep(0.04, 0.35, t.edge) : 1 - smoothstep(0, w, hullEdge(t.uv).d);
      const ek = near * (o.edgeAmt ?? 0.5) * (0.35 + 0.65 * clamp01(t.nf[1] * 0.8 + 0.45)) * (0.4 + 0.6 * chip);
      if (ek > 0) c = mixc(c, edgeCol, clamp01(ek));
      if (o.snow) c = snowOn(c, t, o.snow);
      if (o.bump) c = mulc(c, noiseBump(t, 7, o.bump, 3, 1) * noiseBump(t, 34, o.bump * 0.7, 2, 2));
      return c;
    },
  };
}


// ---------------------------------------------------------------------------------------------------------------------------------
// sandstone / basalt painters + ember crack glow (shared by the volcanic props)

export interface SandOpts {
  tex?: string[];
  /** texture repeats per metre of uv */
  k?: number;
  /** colour ramp dark -> light */
  ramp: Stop[];
  /** keep this fraction of the texture's own hue */
  keep?: number;
  /** 0..1 baked micro relief */
  bump?: number;
  /** horizontal strata line strength */
  strata?: number;
  /** soot / ash toward the ground (0..1) */
  soot?: number;
  /** soot colour */
  sootColor?: string;
  /** reads uv as metres (true) or world-space triplanar (false: hull parts) */
  uvMetres?: boolean;
}

/** painter returning albedo for carved sandstone / basalt blocks */
export function sandPainter(o: SandOpts): (t: Texel) => Rgb {
  const T = pickTex(...(o.tex ?? ['tex_rock_canyon']));
  const k = o.k ?? 0.5;
  const soot = rgb(o.sootColor ?? '#1b1412');
  const metres = o.uvMetres !== false;
  return (t) => {
    let c: Rgb;
    let l: number;
    if (T) {
      const s = metres ? t.tex(T, k) : triSample(t, T, k);
      l = clamp01((lum(s) - 0.04) / 0.32);
      c = ramp(o.ramp, l);
      if (o.keep) c = mixc(c, mulc(s, 1.15), o.keep);
    } else {
      l = 0.5 + 0.5 * (fbm01(t, 3, 4) - 0.5) * 2;
      c = ramp(o.ramp, l);
    }
    c = mulc(c, 0.8 + 0.34 * fbm01(t, 1.5, 3, 4.2));
    if (o.strata) {
      const band = t.noise.fbm(t.p[0] * 0.7, t.p[1] * 11, t.p[2] * 0.7, { octaves: 2 });
      c = mulc(c, 1 - o.strata * 0.22 * smoothstep(0.1, 0.5, band));
    }
    if (o.soot) c = groundDirt(c, t, 1.3, o.soot, soot);
    if (o.bump) c = mulc(c, noiseBump(t, 8, o.bump, 3, 3) * noiseBump(t, 36, o.bump * 0.6, 2, 5));
    return c;
  };
}

export interface CrackGlowOpts {
  /** cells per metre of the main network */
  scale: number;
  stretch?: [number, number, number];
  /** heat 0..1 of the crack cores; may depend on position */
  heat?: (t: Texel) => number;
  /** coverage 0..1 (fraction of the network kept) as a function of position */
  cover?: (t: Texel) => number;
  width?: number;
  seed?: number;
  /** also a fine secondary network */
  fine?: boolean;
}

/** molten crack network: heat in the cores, scorch halo around */
export function crackGlow(o: CrackGlowOpts): (t: Texel) => Glow {
  return (t) => {
    const cov = o.cover ? o.cover(t) : 0.5;
    const hs = o.heat ? o.heat(t) : 1;
    const main = cracks(t, { scale: o.scale, ...(o.stretch ? { stretch: o.stretch } : {}), width: (o.width ?? 0.02) * (0.6 + cov), halo: (o.width ?? 0.02) * 5, warp: 0.55, keep: clamp01(cov), seed: o.seed ?? 3 });
    let core = main.core, halo = main.halo;
    if (o.fine) {
      const f = cracks(t, { scale: o.scale * 3.1, ...(o.stretch ? { stretch: o.stretch } : {}), width: (o.width ?? 0.02) * 0.4, halo: (o.width ?? 0.02) * 2.2, warp: 0.5, keep: clamp01(cov * 0.8 - 0.1), seed: (o.seed ?? 3) + 4 });
      core = Math.max(core, f.core * 0.8);
      halo = Math.max(halo, f.halo * 0.7);
    }
    const flick = 0.72 + 0.28 * fbm01(t, 6, 2, 7.7);
    return { heat: clamp01(core * flick * hs), char: halo * clamp01(0.4 + cov) };
  };
}

export { ramp };
export type { Rgb, Texel };

// ---------------------------------------------------------------------------------------------------------------------------------
// obsidian (volcanic glass) for hull parts

export interface ObsidianOpts {
  /** colour ramp dark -> light (of the fracture texture luminance) */
  ramp?: Stop[];
  /** fake sky reflection colour */
  sky?: string;
  /** rim highlight colour */
  rim?: string;
  /** reflection strength 0..1 */
  gloss?: number;
  /** height (m) over which the glass brightens from its opaque base to its translucent tips */
  rise?: number;
}

/** volcanic glass for faceted hull parts: every facet mirrors a different slice of a cold sky or the warm lava below, razor rims */
export function obsidianPaint(o: ObsidianOpts = {}): (t: Texel) => Rgb {
  const T = pickTex('tex_metin_obsidian');
  const rampC: Stop[] = o.ramp ?? [[0, rgb('#040307')], [0.5, rgb('#0d0a19')], [1, rgb('#2a2148')]];
  const sky = rgb(o.sky ?? '#7a88de'), deep = rgb('#16112f'), teal = rgb('#4f9fae'), rim = rgb(o.rim ?? '#d9ccff'), lava = rgb('#8a2c12');
  const gloss = o.gloss ?? 0.8;
  const rise = o.rise ?? 3.5;
  return (t) => {
    let l: number;
    if (T) l = clamp01((lum(triSample(t, T, 1.1)) - 0.01) / 0.18);
    else l = 0.4 + 0.6 * fbm01(t, 6, 3);
    let c = ramp(rampC, l);
    const f1 = facetHash(t, 1), f2 = facetHash(t, 2);
    const up = clamp01(t.nf[1] * 0.5 + 0.5);
    // ~40% of the facets act as mirrors (bright, sky-coloured), the rest stay deep and dark: strong facet-to-facet value contrast
    const mirror = smoothstep(0.66, 0.92, f2);
    const env = mixc(deep, mixc(sky, teal, smoothstep(0.7, 0.95, f1) * 0.7), clamp01(0.15 + 0.85 * up) * (0.45 + 0.55 * f1));
    c = mixc(c, env, clamp01(gloss * (0.16 + 0.72 * mirror)));
    c = mulc(c, noiseBump(t, 8, 0.2, 2, 4));
    // opaque and dark at the root, translucent and bright towards the points
    c = mulc(c, 0.62 + 0.7 * smoothstep(0.1, rise, t.hy));
    // warm bounce from the lava crust at the foot
    c = mixc(c, lava, (1 - smoothstep(0, 0.6, t.hy)) * 0.22 * (0.4 + 0.6 * f2));
    const e = hullEdge(t.uv);
    c = mixc(c, rim, (1 - smoothstep(0, 0.02, e.d)) * 0.7 * (0.35 + 0.65 * f1));
    return c;
  };
}
