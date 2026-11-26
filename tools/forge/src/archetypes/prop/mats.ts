// Material library for prop bakes. A Mat is `shade(texel) -> linear RGB`; everything combines (a) Imagegen tileables sampled through the
// tile-space uv, (b) procedural painting (patterns, stains, wear) and (c) the baked occlusion/edge channels of the texel.
import { clamp01, mix, smoothstep } from '../../core/math.ts';
import { rgb } from '../../core/paint/painter.ts';
import type { Mat, Texel } from './mesh.ts';
import { type Rgb, type Tex, hasTex, loadTex, sampleTex } from './texlib.ts';

export { rgb };

export const mixc = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulc = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
export const addc = (a: Rgb, b: Rgb, k = 1): Rgb => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mulcc = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

/** first available texture id of the list (lets models name the ideal Imagegen texture plus fallbacks) */
export function pickTex(...ids: string[]): Tex | null {
  for (const id of ids) {
    if (hasTex(id)) {
      const t = loadTex(id);
      if (t) return t;
    }
  }
  return null;
}

/** noise helpers in world space */
export const fbm3 = (t: Texel, f: number, oct = 3, o = 0): number => t.noise.fbm(t.p[0] * f + o, t.p[1] * f + o * 0.7, t.p[2] * f - o, { octaves: oct });
/** 0..1 */
export const fbm01 = (t: Texel, f: number, oct = 3, o = 0): number => 0.5 + 0.5 * fbm3(t, f, oct, o);

/** darken / mud the base of a structure (rain splash + soil) */
export function groundDirt(c: Rgb, t: Texel, height = 0.5, amount = 0.55, soil: Rgb = rgb('#4b3a28')): Rgb {
  const edge = height * (0.55 + 0.9 * fbm01(t, 5, 3, 3.1));
  const k = (1 - smoothstep(0, edge, t.p[1])) * amount;
  return k > 0 ? mixc(c, mulcc(soil, mulc(c, 1.2)), k) : c;
}

/** moss / lichen on up-facing surfaces and in crevices */
export function mossOn(c: Rgb, t: Texel, amount: number, moss: Rgb = rgb('#5d7a2b'), scale = 3): Rgb {
  const upness = clamp01(t.n[1] * 0.9 + 0.1);
  const crev = 1 - t.ao;
  const n = fbm01(t, scale, 4, 11.3);
  const k = clamp01(smoothstep(0.52 - amount * 0.5, 0.78 - amount * 0.35, n * 0.7 + upness * 0.25 + crev * 0.6 - 0.35)) * clamp01(amount * 1.6);
  return k > 0 ? mixc(c, mulc(moss, 0.55 + 0.9 * fbm01(t, 18, 2, 5)), k) : c;
}

/** snow on up-facing surfaces */
export function snowOn(c: Rgb, t: Texel, amount: number, snow: Rgb = rgb('#eef4fa')): Rgb {
  const up = t.n[1];
  const n = fbm01(t, 6, 3, 21.7);
  const k = smoothstep(0.35 - amount * 0.4, 0.8 - amount * 0.3, up * 0.8 + (n - 0.5) * 0.5 + amount * 0.25) * clamp01(amount * 1.4);
  return k > 0 ? mixc(c, mulc(snow, 0.88 + 0.12 * t.ao), k) : c;
}

/** convex-edge highlight and chip wear */
export function edgeWear(c: Rgb, t: Texel, color: Rgb, amount: number): Rgb {
  const k = t.edge * amount * (0.6 + 0.8 * fbm01(t, 40, 2, 4.4));
  return k > 0 ? mixc(c, color, clamp01(k)) : c;
}

/** vertical rain streaks (darker, desaturated) */
export function rainStreaks(c: Rgb, t: Texel, amount: number): Rgb {
  const s = t.noise.fbm(t.p[0] * 22 + t.p[2] * 22, t.p[1] * 1.6, t.p[2] * 9, { octaves: 3 }) * 0.5 + 0.5;
  const k = smoothstep(0.55, 0.9, s) * amount * (1 - t.n[1] * t.n[1]);
  return mulc(c, 1 - 0.38 * k);
}

/** smooth min distance-based line mask: 1 on the line, 0 off it (aa from texel footprint) */
export const line = (d: number, w: number, aa: number): number => 1 - smoothstep(w - aa, w + aa, Math.abs(d));
export const fract = (x: number): number => x - Math.floor(x);

// ----------------------------------------------------------------------------------------------------------------------------
// stone

export interface StoneOpts {
  /** tileable id(s), first available wins */
  tex?: string[];
  /** tile repeats per tile-unit (uv multiplier) */
  k?: number;
  dark: string;
  light: string;
  moss?: number;
  dirt?: number;
  wear?: number;
  snow?: number;
  /** saturation of the sampled texture before grading (0 = pure luminance ramp) */
  keep?: number;
}

export function stone(name: string, o: StoneOpts): Mat {
  const T = pickTex(...(o.tex ?? ['tex_rock_mossy']));
  const dark = rgb(o.dark), light = rgb(o.light);
  const keep = o.keep ?? (T?.id === 'tex_stone_block_wall' ? 0.75 : 0);
  return {
    name,
    shade(t) {
      let c: Rgb;
      if (T) {
        const s = t.tex(T, o.k ?? 1);
        const l = clamp01((lum(s) - 0.03) / 0.35);
        c = mixc(dark, light, 0.18 + 0.62 * smoothstep(0.05, 1.0, l));
        if (keep > 0) c = mixc(c, mulc(s, 1.3), keep);
      } else {
        c = mixc(dark, light, 0.5 + 0.5 * fbm3(t, 5, 4));
      }
      c = mulc(c, 0.86 + 0.28 * fbm01(t, 2.2, 3, 8.5));
      if (o.dirt) c = groundDirt(c, t, 0.6, o.dirt);
      if (o.moss) c = mossOn(c, t, o.moss);
      c = edgeWear(c, t, mulc(light, 1.15), o.wear ?? 0.5);
      if (o.snow) c = snowOn(c, t, o.snow);
      return c;
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------------------
// wood

export interface WoodOpts {
  tex?: string[];
  k?: number;
  /** grain runs along tile-uv `v` when true (vertical posts), along `u` otherwise (planks) */
  vertical?: boolean;
  dark: string;
  light: string;
  dirt?: number;
  moss?: number;
  snow?: number;
  wear?: number;
}

export function wood(name: string, o: WoodOpts): Mat {
  const T = pickTex(...(o.tex ?? ['tex_wood_plank']));
  const dark = rgb(o.dark), light = rgb(o.light);
  return {
    name,
    shade(t) {
      let l: number;
      if (T) {
        const s = o.vertical ? sampleTex(T, t.uv[1] * (o.k ?? 1), t.uv[0] * (o.k ?? 1), t.fp * (o.k ?? 1)) : t.tex(T, o.k ?? 1);
        l = clamp01((lum(s) - 0.02) / 0.22);
      } else {
        l = 0.5 + 0.5 * t.noise.fbm(t.uv[0] * 3, t.uv[1] * 20, 1, { octaves: 3 });
      }
      let c = mixc(dark, light, smoothstep(0.05, 0.95, l));
      if (o.dirt) c = groundDirt(c, t, 0.45, o.dirt);
      if (o.moss) c = mossOn(c, t, o.moss);
      c = rainStreaks(c, t, 0.5);
      c = edgeWear(c, t, mulc(light, 1.25), o.wear ?? 0.35);
      if (o.snow) c = snowOn(c, t, o.snow);
      return c;
    },
  };
}

export interface LacquerOpts {
  /** lacquer colour */
  color?: string;
  /** colour showing through chips */
  under?: string;
  tex?: string[];
  vertical?: boolean;
  wear?: number;
  dirt?: number;
  k?: number;
}

/** red lacquered timber: glossy-looking saturated colour, grain visible, chips along edges, grime at the foot */
export function lacquer(name: string, o: LacquerOpts = {}): Mat {
  const T = pickTex(...(o.tex ?? ['tex_wood_lacquer_red', 'tex_wood_plank']));
  const isRedTex = T?.id === 'tex_wood_lacquer_red';
  const col = rgb(o.color ?? '#a3231c'), under = rgb(o.under ?? '#3c2416');
  return {
    name,
    shade(t) {
      let l = 0.5;
      let c: Rgb;
      const k = o.k ?? 1;
      if (T) {
        const s = o.vertical ? sampleTex(T, t.uv[1] * k, t.uv[0] * k, t.fp * k) : t.tex(T, k);
        if (isRedTex) {
          // the shipped lacquer is ~#b0261c: the colour option re-tints it (faded / darker / browner variants)
          const ref = rgb('#b0261c');
          c = mulcc(s, [Math.min(1.5, col[0] / ref[0]), Math.min(1.8, col[1] / ref[1]), Math.min(1.8, col[2] / ref[2])]);
          l = lum(s) * 3;
        } else {
          l = clamp01((lum(s) - 0.02) / 0.22);
          c = mulcc(col, [0.75 + 0.55 * l, 0.6 + 0.6 * l, 0.6 + 0.6 * l]);
        }
      } else {
        c = mulc(col, 0.85 + 0.3 * t.noise.fbm(t.uv[0] * 4, t.uv[1] * 30, 0, { octaves: 2 }));
      }
      const chip = smoothstep(0.55, 0.85, t.edge * 1.4 * (0.5 + fbm01(t, 55, 2, 2.2))) * (o.wear ?? 0.7) + smoothstep(0.78, 0.92, fbm01(t, 9, 3, 7.7)) * 0.25 * (o.wear ?? 0.7);
      c = mixc(c, under, clamp01(chip));
      if (o.dirt !== 0) c = groundDirt(c, t, 0.5, o.dirt ?? 0.5);
      return c;
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------------------
// plaster / roof

export function plaster(name: string, o: { color?: string; dirt?: number; stain?: number } = {}): Mat {
  const T = pickTex('tex_plaster_white');
  const base = rgb(o.color ?? '#e9dfc9');
  return {
    name,
    shade(t) {
      let c: Rgb;
      if (T) c = mulcc(mixc([1, 1, 1], mulc(base, 1 / 0.8), 0.35), mulc(t.tex(T, 1), 1.12));
      else c = mulc(base, 0.93 + 0.1 * fbm3(t, 9, 3));
      c = mulc(c, 0.9 + 0.12 * fbm01(t, 1.6, 3, 2.5));
      c = rainStreaks(c, t, 0.7);
      c = groundDirt(c, t, 0.7, o.dirt ?? 0.55, rgb('#6b5a44'));
      // damp under the eaves: top of the wall darker when occluded
      c = mulc(c, 0.9 + 0.1 * t.aoL);
      return c;
    },
  };
}

export interface RoofOpts {
  tex?: string[];
  /** multiply the sampled tile colour */
  tint?: string;
  moss?: number;
  snow?: number;
  wear?: number;
  dark?: boolean;
  /** paint hip/ridge caps where u is a multiple of this many tile units (roofs sized so edges span whole multiples) */
  hip?: number;
}

/** curved roof tiles. uv convention: u along the eave, v down the slope (tile ridges run along v) */
export function roofTile(name: string, o: RoofOpts = {}): Mat {
  const T = pickTex(...(o.tex ?? ['tex_roof_tile']));
  const tint = rgb(o.tint ?? '#ffffff');
  const fallback = rgb('#8a3a24');
  return {
    name,
    shade(t) {
      let c: Rgb = T ? mulcc(t.tex(T, 1), tint) : mulcc(fallback, tint);
      // per-tile weathering variation (very low frequency so rows do not look cloned)
      c = mulc(c, 0.82 + 0.34 * fbm01(t, 2.1, 3, 6.6));
      // broad patches: sun-bleached / rain-darkened / greened stretches so tiers do not look cloned
      c = mixc(c, mulcc(c, [0.72, 0.8, 0.78]), 0.7 * smoothstep(0.45, 0.8, fbm01(t, 0.22, 3, 12.3)));
      c = mulc(c, 0.78 + 0.42 * fbm01(t, 0.35, 2, 3.1));
      if (o.moss) c = mossOn(c, t, o.moss, rgb('#55702a'), 4);
      c = edgeWear(c, t, mulc(c, 1.35), o.wear ?? 0.3);
      if (o.dark) c = mulc(c, 0.75);
      if (o.hip) {
        // hip ridge: raised cap strip with a lit crown line, where u crosses a corner of the polygon
        const d = Math.abs(fract(t.uv[0] / o.hip + 0.5) - 0.5) * o.hip;
        const aa = Math.max(0.01, t.fp * 1.2);
        const capK = 1 - smoothstep(0.12 - aa, 0.12 + aa, d);
        const cc = mulc(mixc(c, rgb('#5a3b2c'), 0.55), 0.8 + 0.3 * fbm01(t, 30, 2, 8.8));
        c = mixc(c, cc, capK);
        c = mixc(c, mulc(cc, 1.6), line(d, 0.012, aa) * capK);
        c = mixc(c, mulc(cc, 0.4), line(d - 0.115, 0.012, aa) * capK);
      }
      if (o.snow) c = snowOn(c, t, o.snow);
      return c;
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------------------
// metals and trim

export function gold(name: string, o: { color?: string } = {}): Mat {
  const T = pickTex('tex_gold_ornament');
  const base = rgb(o.color ?? '#d9a532');
  return {
    name,
    shade(t) {
      let c: Rgb;
      if (T) c = mulc(mixc(t.tex(T, 1), mulcc(base, t.tex(T, 1)), 0.25), 1.15);
      else c = mulc(base, 0.82 + 0.3 * fbm01(t, 30, 2, 1.2));
      c = mixc(c, mulc(base, 1.5), t.edge * 0.8);
      return mulc(c, 0.75 + 0.25 * t.ao);
    },
  };
}

export function iron(name: string, o: { color?: string; rust?: number } = {}): Mat {
  const T = pickTex('tex_iron_dark');
  const base = rgb(o.color ?? '#2c2a2c');
  const rust = rgb('#7a3b1d');
  return {
    name,
    shade(t) {
      let c: Rgb = T ? mulc(t.tex(T, 1), 1.25) : mulc(base, 0.8 + 0.4 * fbm01(t, 25, 3));
      const r = smoothstep(0.55, 0.85, fbm01(t, 7, 4, 3.3) + (1 - t.ao) * 0.35) * (o.rust ?? 0.5);
      c = mixc(c, rust, r);
      c = mixc(c, mulc(base, 3), t.edge * 0.5);
      return c;
    },
  };
}

export function bronze(name: string, o: { color?: string; patina?: number } = {}): Mat {
  const T = pickTex('tex_bronze_patina');
  const base = rgb(o.color ?? '#8c6a35');
  const verd = rgb('#3d8c74');
  return {
    name,
    shade(t) {
      let c: Rgb;
      if (T) c = mulc(t.tex(T, 1), 1.0);
      else c = mixc(mulc(base, 0.8 + 0.4 * fbm01(t, 20, 3)), verd, smoothstep(0.55, 0.8, fbm01(t, 6, 4, 9.9) + (1 - t.ao) * 0.4 + t.n[1] * 0.15) * (o.patina ?? 0.6));
      c = mixc(c, mulc(base, 1.6), t.edge * 0.6);
      return c;
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------------------
// painted eave trim (dancheong-style): crisp geometric bands. uv.u runs along the beam, uv.v across it (0..1 = one band set).

export function dancheong(name: string, o: { base?: string } = {}): Mat {
  const T = pickTex('tex_dancheong');
  const bg = rgb(o.base ?? '#17604e');
  const red = rgb('#b3261e'), blue = rgb('#1d5aa6'), white = rgb('#efe6cf'), goldc = rgb('#d6a43a'), green = rgb('#1f8a5e'), black = rgb('#18120f');
  return {
    name,
    shade(t) {
      // uv: u in band-heights along the beam, v 0..1 across; the shipped texture holds 5 stacked bands per tile -> show one band
      if (T) return mulc(sampleTex(T, t.uv[0] * 0.19, t.uv[1] * 0.19 + 0.25, t.fp * 0.19), 1.0);
      const aa = Math.max(0.01, t.fp * 1.2);
      const u = fract(t.uv[0] * 0.5), v = fract(t.uv[1]);
      let c = bg;
      // outer rails
      c = mixc(c, white, line(v - 0.08, 0.03, aa) + line(v - 0.92, 0.03, aa) > 0 ? clamp01(line(v - 0.08, 0.03, aa) + line(v - 0.92, 0.03, aa)) : 0);
      c = mixc(c, goldc, clamp01(line(v - 0.16, 0.012, aa) + line(v - 0.84, 0.012, aa)));
      // lozenges along the beam
      const du = Math.abs(u - 0.5) * 2, dv = Math.abs(v - 0.5) * 2;
      const dia = du * 0.9 + dv * 1.35;
      c = mixc(c, red, 1 - smoothstep(0.62 - aa, 0.62 + aa, dia));
      c = mixc(c, white, clamp01(line(dia - 0.62, 0.05, aa * 1.5)));
      c = mixc(c, blue, 1 - smoothstep(0.38 - aa, 0.38 + aa, dia));
      c = mixc(c, goldc, 1 - smoothstep(0.12 - aa, 0.12 + aa, Math.hypot(du * 0.9, dv * 1.1)));
      // half lozenges between
      const u2 = Math.abs(fract(u + 0.5) - 0.5) * 2;
      const dia2 = u2 * 0.9 + dv * 1.35;
      c = mixc(c, green, (1 - smoothstep(0.4 - aa, 0.4 + aa, dia2)) * 0.9 * (1 - smoothstep(0.55, 0.62, dia)));
      c = mixc(c, black, 0.12 * (1 - t.ao));
      return c;
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------------------
// misc natural / orc / elemental

export function hide(name: string, o: { tint?: string; marks?: boolean } = {}): Mat {
  const T = pickTex('tex_hide_patch');
  const tint = rgb(o.tint ?? '#ffffff');
  const palette: Rgb[] = [rgb('#8a6a46'), rgb('#6e5236'), rgb('#a98a5e'), rgb('#4f3c2a'), rgb('#7a5a3b')];
  const mark = rgb('#a02a1a');
  return {
    name,
    shade(t) {
      if (T) return mulcc(mulc(t.tex(T, 1), 1.0), tint);
      // patchwork: voronoi cells in tile space (cells ~ 0.6 tile), seams darkened and stitched
      const v = t.noise.voronoi(t.uv[0] * 2.4, t.uv[1] * 2.4, 3.1);
      let c = mulcc(palette[Math.floor(v.id * palette.length) % palette.length]!, tint);
      c = mulc(c, 0.85 + 0.3 * fbm01(t, 14, 3, 1.1));
      const seam = 1 - smoothstep(0.02, 0.07, v.f2 - v.f1);
      c = mixc(c, rgb('#241810'), seam * 0.75);
      // stitches: dashes straddling the seam
      const dash = fract((t.uv[0] + t.uv[1]) * 18) < 0.45 ? 1 : 0;
      c = mixc(c, rgb('#d8c9a0'), (1 - smoothstep(0.035, 0.07, v.f2 - v.f1)) * seam * 0 + dash * (1 - smoothstep(0.06, 0.1, v.f2 - v.f1)) * smoothstep(0.03, 0.05, v.f2 - v.f1) * 0.85);
      if (o.marks) {
        const m = line(fract(t.uv[0] * 1.3) - 0.5 + 0.35 * Math.abs(fract(t.uv[1] * 1.3) - 0.5), 0.05, 0.02) * smoothstep(0.7, 0.85, v.id);
        c = mixc(c, mark, m * 0.9);
      }
      return groundDirt(c, t, 0.35, 0.5, rgb('#4b3a28'));
    },
  };
}

export function bone(name: string): Mat {
  const T = pickTex('tex_bone_ivory');
  const base = rgb('#d8ceb0'), shade = rgb('#8e7f5c');
  return {
    name,
    shade(t) {
      if (T) return mulc(t.tex(T, 1), 1.0);
      let c = mixc(base, shade, 0.35 * fbm01(t, 8, 3, 4.1));
      c = mixc(c, rgb('#4a3d28'), smoothstep(0.78, 0.86, 1 - Math.abs(t.noise.ridged(t.p[0] * 16, t.p[1] * 16, t.p[2] * 16, { octaves: 2 }))) * 0.5);
      return mulc(c, 0.7 + 0.3 * t.ao);
    },
  };
}

export function thatch(name: string, o: { color?: string; dark?: string } = {}): Mat {
  const T = pickTex('tex_thatch_straw');
  const a = rgb(o.color ?? '#c4a455'), b = rgb(o.dark ?? '#6a5326');
  return {
    name,
    shade(t) {
      if (T) return t.tex(T, 1);
      const s = t.noise.fbm(t.uv[0] * 38, t.uv[1] * 3.5, 0, { octaves: 3 }) * 0.5 + 0.5;
      let c = mixc(b, a, smoothstep(0.2, 0.85, s));
      c = mulc(c, 0.85 + 0.3 * fbm01(t, 3, 2, 1.7));
      return groundDirt(c, t, 0.3, 0.4, rgb('#4b3a28'));
    },
  };
}

export function felt(name: string, o: { color?: string; snow?: number } = {}): Mat {
  const T = pickTex('tex_felt_white');
  const base = rgb(o.color ?? '#d8d1c0');
  return {
    name,
    shade(t) {
      let c = T ? mulcc(t.tex(T, 1), mulc(base, 1.1)) : mulc(base, 0.88 + 0.2 * fbm01(t, 35, 3, 2.3));
      c = rainStreaks(c, t, 0.5);
      c = groundDirt(c, t, 0.6, 0.55, rgb('#6b5a44'));
      if (o.snow) c = snowOn(c, t, o.snow);
      return c;
    },
  };
}


/** roof fascia: row of round eave-tile heads on a dark board. uv: u along the eave (tile = roof tile size), v 0..1 across the board */
export function roofEdge(name: string, o: { head?: string; board?: string; period?: number; tile?: number } = {}): Mat {
  const head = rgb(o.head ?? '#9a4a2c'), board = rgb(o.board ?? '#2b1d17'), dot = rgb('#d9a532');
  const P = (o.period ?? 0.16) / (o.tile ?? 1.6);
  return {
    name,
    shade(t) {
      const aa = Math.max(0.02, t.fp / P * 1.3);
      const cx = fract(t.uv[0] / P) - 0.5, cy = t.uv[1] - 0.5;
      const d = Math.hypot(cx, cy);
      let c = mulc(board, 0.9 + 0.25 * fbm01(t, 25, 2, 1.3));
      const disc = 1 - smoothstep(0.42 - aa, 0.42 + aa, d);
      c = mixc(c, mulc(head, 0.85 + 0.3 * fbm01(t, 30, 2, 5.1)), disc);
      c = mixc(c, mulc(head, 0.5), line(d - 0.3, 0.035, aa) * disc);
      c = mixc(c, dot, (1 - smoothstep(0.1 - aa, 0.1 + aa, d)) * disc);
      return c;
    },
  };
}

/** inscription board: dark lacquer, gold frame, pseudo-glyph strokes (hash-driven) in `cols` cells along u. uv: u 0..1 across the board, v 0..1 down */
export function plaque(name: string, o: { cols?: number; board?: string; vertical?: boolean } = {}): Mat {
  const cols = o.cols ?? 3;
  const vertical = o.vertical ?? false;
  const board = rgb(o.board ?? '#1d1612'), goldc = rgb('#e0ae3c');
  return {
    name,
    shade(t) {
      const aa = Math.max(0.004, t.fp * 1.3);
      const u = t.uv[0], v = t.uv[1];
      let c = mulc(board, 0.9 + 0.3 * fbm01(t, 30, 2, 0.3));
      const bx = Math.min(u, 1 - u), by = Math.min(v, 1 - v) * (vertical ? 5 : 1);
      const frame = Math.max(line(Math.min(bx, by) - 0.045, 0.02, aa), line(Math.min(bx, by) - 0.11, 0.006, aa));
      c = mixc(c, goldc, frame);
      // horizontal board: `cols` glyph cells along u; vertical couplet: `cols` glyph cells stacked down v
      const gu = vertical ? (u - 0.2) / 0.6 : (u - 0.14) / 0.72 * cols;
      const gv = vertical ? (v - 0.08) / 0.84 * cols : (v - 0.2) / 0.6;
      const lim = vertical ? [1, cols] : [cols, 1];
      if (gu >= 0 && gu < lim[0]! && gv >= 0 && gv < lim[1]!) {
        const cell = vertical ? Math.floor(gv) : Math.floor(gu);
        const fx = fract(gu), fy = fract(gv);
        let ink = 0;
        // 4 hash-chosen strokes per glyph
        for (let k = 0; k < 5; k++) {
          const h1 = fract(Math.sin((cell * 7 + k * 13 + 1.7) * 12.9898) * 43758.5453);
          const h2 = fract(Math.sin((cell * 5 + k * 17 + 3.1) * 78.233) * 12345.678);
          const h3 = fract(Math.sin((cell * 3 + k * 11 + 5.9) * 39.346) * 9876.54);
          const x0 = 0.12 + 0.6 * h1, y0 = 0.1 + 0.7 * h2, len = 0.25 + 0.5 * h3;
          const mode = Math.floor(h1 * 3 + h2 * 2 + k) % 3;
          const w = 0.045;
          if (mode === 0) ink = Math.max(ink, line(fy - y0, w, aa * 3) * (fx > x0 && fx < x0 + len ? 1 : 0));
          else if (mode === 1) ink = Math.max(ink, line(fx - x0, w, aa * 3) * (fy > y0 - 0.1 && fy < y0 - 0.1 + len ? 1 : 0));
          else ink = Math.max(ink, line(fx - x0 - (fy - y0) * 0.6, w, aa * 3) * (fy > y0 - 0.1 && fy < y0 - 0.1 + len * 0.9 ? 1 : 0));
        }
        c = mixc(c, goldc, ink * 0.95);
      }
      return c;
    },
  };
}


/** plaster wall with a timber frame grid painted on (vertical studs every `studs` tile units, rails every `rails`) */
export function timberPlaster(name: string, o: { studs?: number; rails?: number; color?: string; frame?: string } = {}): Mat {
  const base = plaster(name, { ...(o.color ? { color: o.color } : {}) });
  const wood0 = rgb(o.frame ?? '#3a2218');
  const ks = 1 / (o.studs ?? 0.5), kr = 1 / (o.rails ?? 0.7);
  return {
    name,
    shade(t) {
      let c = base.shade(t);
      const aa = Math.max(0.01, t.fp * ks * 1.3);
      const stud = line(fract(t.uv[0] * ks) - 0.5, 0.5 - (o.studs ?? 0.5) * 0, 0) * 0;
      void stud;
      const sx = 1 - smoothstep(0.045 - aa, 0.045 + aa, Math.abs(fract(t.uv[0] * ks + 0.5) - 0.5) / ks);
      const rx = 1 - smoothstep(0.05 - aa, 0.05 + aa, Math.abs(fract(t.uv[1] * kr + 0.5) - 0.5) / kr);
      c = mixc(c, mulc(wood0, 0.85 + 0.3 * fbm01(t, 22, 2, 3.3)), Math.max(sx, rx));
      return c;
    },
  };
}

/** window / door lattice: dark bars over warm paper; `cell` = bar spacing in tile units */
export function lattice(name: string, o: { cell?: number; bar?: number; paper?: string; frame?: string; diamond?: boolean } = {}): Mat {
  const cell = o.cell ?? 0.12, bar = o.bar ?? 0.012;
  const paper = rgb(o.paper ?? '#d8c8a2'), frame = rgb(o.frame ?? '#2a1810');
  return {
    name,
    shade(t) {
      const aa = Math.max(0.003, t.fp * 1.2);
      let u = t.uv[0], v = t.uv[1];
      if (o.diamond) { const a = u + v, b = u - v; u = a * 0.7071; v = b * 0.7071; }
      const du = Math.abs(fract(u / cell + 0.5) - 0.5) * cell, dv = Math.abs(fract(v / cell + 0.5) - 0.5) * cell;
      const g = Math.max(1 - smoothstep(bar - aa, bar + aa, du), 1 - smoothstep(bar - aa, bar + aa, dv));
      const rim = Math.min(Math.min(t.uv[0], 1 - t.uv[0]), Math.min(t.uv[1], 1 - t.uv[1]));
      let c = mixc(mulc(paper, 0.9 + 0.2 * fbm01(t, 20, 2, 0.9)), frame, g);
      c = mixc(c, frame, 1 - smoothstep(0.03 - aa, 0.03 + aa, rim) > 0 && t.uv[0] >= 0 && t.uv[0] <= 1 && t.uv[1] >= 0 && t.uv[1] <= 1 ? 1 : 0);
      return c;
    },
  };
}

export function flat(name: string, color: string, o: { ao?: number; grain?: number } = {}): Mat {
  const c0 = rgb(color);
  return {
    name,
    ao: o.ao ?? 1,
    shade(t) {
      return mulc(c0, 1 - (o.grain ?? 0.12) + (o.grain ?? 0.12) * 2 * fbm01(t, 20, 2, 0.5));
    },
  };
}

export { mix };
