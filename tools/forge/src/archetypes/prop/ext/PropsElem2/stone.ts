// Stone painter for the PropsElem2 props: a tileable's luminance normalised by its own average (so dark textures like basalt still
// spread over the whole ramp), mapped through a colour ramp, with large-scale blotches, strata and baked micro relief.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import type { Texel } from '../../mesh.ts';
import { fbm01, lum, mixc, mulc, pickTex } from '../../mats.ts';
import type { Rgb } from '../../texlib.ts';
import { noiseBump, ramp, triSample, type Stop } from '../PropsElem/paint.ts';

export interface StonePaintOpts {
  tex: string[];
  /** texture repeats per tile unit (metres with the PropsElem2 mappers) */
  k: number;
  ramp: Stop[];
  /** texture value contrast around the ramp centre (1 = +-0.5 for +-100% of the average) */
  contrast?: number;
  /** keep this fraction of the texture's own hue */
  keep?: number;
  /** baked micro relief */
  bump?: number;
  /** horizontal strata strength */
  strata?: number;
  /** large blotch value variation */
  blotch?: number;
  /** sample with the triangle's tile uv (true) or world triplanar (false, for hull parts) */
  uvMetres?: boolean;
}

export function stonePainter(o: StonePaintOpts): (t: Texel) => Rgb {
  const T = pickTex(...o.tex);
  const avgL = T ? Math.max(1e-3, lum(T.avg)) : 1;
  const metres = o.uvMetres !== false;
  const con = o.contrast ?? 1;
  return (t) => {
    let l: number;
    let s: Rgb | null = null;
    if (T) {
      s = metres ? t.tex(T, o.k) : triSample(t, T, o.k);
      l = 0.5 + (lum(s) / avgL - 1) * 0.5 * con;
    } else l = fbm01(t, 4, 4);
    l += ((o.blotch ?? 0.25) * (fbm01(t, 1.3, 3, 4.2) - 0.5)) * 1.6;
    let c = ramp(o.ramp, clamp01(l));
    if (s && o.keep) c = mixc(c, mulc(s, lum(c) / Math.max(1e-3, lum(s))), o.keep);
    if (o.strata) {
      const band = t.noise.fbm(t.p[0] * 0.7, t.p[1] * 9, t.p[2] * 0.7, { octaves: 2 });
      c = mulc(c, 1 - o.strata * 0.2 * smoothstep(0.1, 0.5, band));
    }
    if (o.bump) c = mulc(c, noiseBump(t, 8, o.bump, 3, 3) * noiseBump(t, 34, o.bump * 0.6, 2, 5));
    return c;
  };
}
