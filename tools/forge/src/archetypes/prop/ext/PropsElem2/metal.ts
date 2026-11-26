// Cast / wrought metal materials for the PropsElem2 braziers and altars: patinated bronze and hammered iron with crevice verdigris /
// rust, polished worn edges, fire soot and an optional heat field (glowing rims next to the coals) that writes the emissive map.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import type { Mat, Texel } from '../../mesh.ts';
import { fbm01, lum, mixc, mulc, pickTex, rgb } from '../../mats.ts';
import type { Rgb } from '../../texlib.ts';
import { type Motif, NO_MOTIF } from '../PropsElem/motifs.ts';
import { memo1, noiseBump } from '../PropsElem/paint.ts';
import { FIRE, type FirePal, heatOf } from './fire.ts';
import type { Relief } from './motifs.ts';

export interface MetalOpts {
  /** texture repeats per tile unit (uv in metres for the PropsElem2 mappers) */
  k?: number;
  /** soot amount 0..1 at a texel */
  soot?: (t: Texel) => number;
  /** heat 0..1 at a texel (emissive) */
  heat?: (t: Texel) => number;
  /** carved / cast relief in the texel's frame (a Relief adds raised-height polish and sunken-ground corrosion) */
  motif?: (t: Texel) => Motif | Relief;
  pal?: FirePal;
  /** crevice corrosion (verdigris / rust) 0..1 */
  corrode?: number;
  /** polished edge strength 0..1 */
  polish?: number;
  /** overall value multiplier */
  value?: number;
}

interface MetalLook {
  tex: string[];
  /** fallback base + dark tone (no texture) */
  base: string;
  dark: string;
  /** crevice corrosion colour */
  corr: string;
  /** polished edge colour */
  bright: string;
  /** soot colour */
  soot: string;
  /** micro hammer relief */
  bump: number;
  /** texture value contrast exponent (1 = as painted) */
  gamma: number;
  /** how much of the texture's own colour survives over the base metal tint (0..1) */
  keep: number;
}

function metal(name: string, look: MetalLook, o: MetalOpts): Mat {
  const T = pickTex(...look.tex);
  const base = rgb(look.base), dark = rgb(look.dark), corr = rgb(look.corr), bright = rgb(look.bright), soot = rgb(look.soot);
  const avgL = T ? Math.max(1e-3, lum(T.avg)) : 1;
  const baseL = lum(base);
  const k = o.k ?? 1;
  const pal = o.pal ?? FIRE;
  const motif = o.motif ? memo1(o.motif) : null;
  const heat = o.heat ? memo1(o.heat) : null;
  return {
    name,
    shade(t) {
      let c: Rgb;
      if (T) {
        const s = t.tex(T, k);
        const v = Math.pow(Math.max(0, lum(s) / avgL), look.gamma);
        c = mixc(mulc(base, v), mulc(s, baseL / avgL), look.keep);
      } else c = mixc(dark, base, fbm01(t, 9, 3));
      c = mulc(c, (o.value ?? 1) * (0.84 + 0.3 * fbm01(t, 2.5, 3, 6.6)));
      if (look.bump) c = mulc(c, noiseBump(t, 26, look.bump, 2, 4));
      const m = motif ? motif(t) : NO_MOTIF;
      const rh = 'h' in m ? (m.h as number) : 0, area = 'area' in m ? (m.area as number) : 0;
      c = mulc(c, m.lit * (1 - 0.6 * m.ink) * (1 - 0.22 * (1 - rh) * area));
      // corrosion collects in crevices, the sunken ground of reliefs and on the lower, wetter parts
      const crev = clamp01((1 - t.ao) * 1.6 + m.ink * 0.6 + (1 - rh) * area * 0.4);
      const co = smoothstep(0.35, 0.8, crev * 0.75 + fbm01(t, 7, 3, 2.2) * 0.55 - 0.1) * (o.corrode ?? 0.5);
      if (co > 0) c = mixc(c, mulc(corr, 0.75 + 0.5 * fbm01(t, 23, 2, 8.8)), co);
      // polished highlights on worn convex edges and raised relief
      const pe = clamp01(t.edge * 1.4 + Math.max(0, m.lit - 1) * 1.2 + rh * area * 0.75) * (o.polish ?? 0.6) * (0.55 + 0.6 * fbm01(t, 30, 2, 1.9));
      if (pe > 0) c = mixc(c, bright, clamp01(pe));
      if (o.soot) {
        const s = clamp01(o.soot(t) * (0.75 + 0.5 * fbm01(t, 9, 3, 3.7)));
        if (s > 0) c = mixc(c, soot, s);
      }
      if (heat) {
        const h = heat(t);
        if (h > 0.05) c = mixc(c, mulc(ramp1(pal), 0.35), smoothstep(0.1, 0.7, h));
      }
      return c;
    },
    ...(heat
      ? {
          emit(t: Texel): Rgb | null {
            const h = heat(t);
            return h < 0.02 ? null : heatOf(pal, h);
          },
        }
      : {}),
  };
}

const ramp1 = (pal: FirePal): Rgb => heatOf(pal, 0.7);

/** patinated cast bronze: warm metal under green-blue verdigris, bright worn edges */
export function bronzeMat(name: string, o: MetalOpts = {}): Mat {
  return metal(name, { tex: ['tex_bronze_patina'], base: '#7a582e', dark: '#3b2a17', corr: '#3a8a72', bright: '#e8bb64', soot: '#16110d', bump: 0.12, gamma: 0.7, keep: 0.12 }, o);
}

/** hammered wrought iron: blue-black scale, rust in the crevices, steel-grey worn edges */
export function ironMat(name: string, o: MetalOpts = {}): Mat {
  return metal(name, { tex: ['tex_iron_dark'], base: '#383536', dark: '#141212', corr: '#6e3518', bright: '#a8a39a', soot: '#0c0a09', bump: 0.3, gamma: 1.2, keep: 0.3 }, o);
}

export { NO_MOTIF };
export type { Motif };
