// Texel painter for metin stones: dark fractured volcanic stone (Imagegen `tex_metin_obsidian`, triplanar) graded through a palette,
// chiselled edge wear, glowing fracture seams and carved rune decals (Imagegen `tex_rune_*` sheets) written to an emissive mask.
//   albedo   : stone colour; carved grooves are darker under every glowing stroke
//   emissive : grayscale rune / seam / vein mask; the renderer multiplies it by `material.emissive` (= the metin's rune colour)
import { type Img, loadTexture, sample } from '../../core/ext/metins/img.ts';
import { CLS } from '../../core/ext/metins/poly.ts';
import type { ShadeCtx, ShadeOut } from '../../core/ext/metins/solid.ts';
import type { Vec3 } from '../../core/math.ts';
import { vcross, vnorm } from '../../core/math.ts';
import { Noise } from '../../core/noise.ts';

export interface Palette {
  shadow: Vec3;
  mid: Vec3;
  light: Vec3;
  /** worn edge / chipped facet colour */
  edge: Vec3;
  /** albedo of exposed fracture faces and glow cores */
  ember: Vec3;
  /** albedo of luminous crystals (floating shards, cores) */
  glow?: Vec3;
}

export interface Decal {
  /** hull plane id the decal lives on (outer faces with that plane id) */
  plane: number;
  /** restrict to one painter group (part) */
  part?: number;
  /** point on the plane at the decal centre */
  o: Vec3;
  right: Vec3;
  up: Vec3;
  w: number;
  h: number;
  img: Img;
  /** channel of img holding the stroke mask */
  ch?: number;
  gain?: number;
  /** groove depth 0..1 (darkens albedo around strokes) */
  carve?: number;
  /** soft halo strength */
  halo?: number;
  /** crop of the source image in 0..1 (u0, v0, u1, v1) */
  crop?: [number, number, number, number];
  /** glyph-independent medallion: darkened recessed disc of radius r (1 = half the decal width) with a lit rim, so the same
   *  albedo works under every glyph variant (only the emissive mask changes between per-type textures) */
  plate?: { r: number; depth: number };
}

export interface ShadeSpec {
  seed: number | string;
  palette: Palette;
  /** model height (m): drives the vertical value gradient */
  height: number;
  decals: Decal[];
  /** lightning vein strength 0..1 (Imagegen `tex_rune_c` cracks) */
  veins?: number;
  /** stone texture tile size (m) */
  tile?: number;
  /** extra brightness of the stone (1 = default) */
  value?: number;
  /** strength of the glowing fracture seams (default 1) */
  seams?: number;
  /** painter groups (parts) that are glowing crystal rather than stone (floating rune shards, cores) */
  glowParts?: number[];
  /** painter groups whose pieces glow toward their tips (crystal spikes) */
  tipParts?: number[];
  tipGain?: number;
  /** highest point of every bone (filled in by the builder) */
  boneTop?: number[];
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const sm = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mixv = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const hash1 = (n: number): number => {
  let h = Math.imul(n | 0, 374761393) ^ 0x2545f491;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** frame (right, up) for a decal on a plane with normal `n`; `upHint` is projected onto the plane */
export function planeFrame(n: Vec3, upHint: Vec3 = [0, 1, 0]): { right: Vec3; up: Vec3 } {
  const d = n[0] * upHint[0] + n[1] * upHint[1] + n[2] * upHint[2];
  const up = vnorm([upHint[0] - n[0] * d, upHint[1] - n[1] * d, upHint[2] - n[2] * d]);
  return { right: vcross(up, n), up };
}

export function obsidian(): Img {
  return loadTexture('tex_metin_obsidian');
}

type Sampled = [number, number, number];

function triplanar(img: Img, p: Vec3, n: Vec3, k: number, out: Sampled): Sampled {
  const ax = Math.abs(n[0]) ** 4, ay = Math.abs(n[1]) ** 4, az = Math.abs(n[2]) ** 4;
  const s = ax + ay + az;
  out[0] = out[1] = out[2] = 0;
  const acc = (w: number, u: number, v: number): void => {
    if (w < 0.01) return;
    for (let c = 0; c < 3; c++) out[c]! += (sample(img, u, v, c, true)) * w;
  };
  acc(ax / s, p[2] * k + 0.31, p[1] * k);
  acc(ay / s, p[0] * k, p[2] * k + 0.57);
  acc(az / s, p[0] * k + 0.13, p[1] * k);
  return out;
}

export function makeShade(spec: ShadeSpec): { shade: (c: ShadeCtx) => ShadeOut; bandPaint: (u: number, v: number, kind: 0 | 1) => ShadeOut } {
  const stone = obsidian();
  const veinImg = spec.veins ? loadTexture('tex_rune_c') : null;
  const noise = new Noise(spec.seed);
  const pal = spec.palette;
  const tile = 1 / (spec.tile ?? 1.3);
  const val = spec.value ?? 1;
  const seams = spec.seams ?? 1;
  const tmp: Sampled = [0, 0, 0];
  const tmp2: Sampled = [0, 0, 0];

  const yRange = new Map<number, [number, number]>();
  const LIGHT: Vec3 = vnorm([0.35, 0.85, 0.5]);

  const shade = (c: ShadeCtx): ShadeOut => {
    const { p, n, face, faceId } = c;
    const fh = hash1(faceId);
    if (spec.glowParts?.includes(face.part)) {
      // luminous crystal: saturated core colour, facet-wise variation, hot rims
      const f = 0.4 + 0.45 * fh;
      const rim = sm(0.03, 0.0, c.edgeAny);
      const e = clamp01(0.3 + 0.34 * f + 0.4 * rim + 0.1 * clamp01(n[1]));
      const gc = pal.glow ?? pal.light;
      return { rgb: mixv([gc[0] * f, gc[1] * f, gc[2] * f], pal.edge, 0.3 * rim), emissive: e };
    }
    const y01 = clamp01(p[1] / spec.height);
    triplanar(stone, p, n, tile, tmp);
    const lum = 0.3 * tmp[0] + 0.59 * tmp[1] + 0.11 * tmp[2];
    let lm = clamp01((lum - 0.04) / 0.32);
    lm += 0.12 * noise.fbm(p[0] * 2.1, p[1] * 0.9, p[2] * 2.1, { octaves: 3 }) + 0.12 * (fh - 0.5);
    // painterly vertical streaks
    lm += 0.06 * noise.noise(p[0] * 9 + p[2] * 9, p[1] * 1.7, 3.1);
    // sun-facing tops are already the brightest surfaces under the key light: paint them from the darker half of the stone
    lm = clamp01(lm) * (1 - 0.5 * sm(0.4, 0.85, n[1]));
    let base: Vec3 = lm < 0.5 ? mixv(pal.shadow, pal.mid, lm * 2) : mixv(pal.mid, pal.light, (lm - 0.5) * 2);
    // keep a little of the real stone's violet chroma
    base = mixv(base, [tmp[0] * 0.8, tmp[1] * 0.76, tmp[2] * 0.95], 0.16);
    // hand-painted lighting: each facet is lighter toward its upper edge, facets turned to the key light are brighter,
    // soot gathers at the base
    let yr = yRange.get(faceId);
    if (!yr) {
      let lo = Infinity, hi = -Infinity;
      for (const q of face.pts) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }
      yr = [lo, hi];
      yRange.set(faceId, yr);
    }
    const grad = yr[1] - yr[0] > 0.05 ? clamp01((p[1] - yr[0]) / (yr[1] - yr[0])) : 0.5;
    const lit = clamp01(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    const ground = mix(0.5, 1.0, sm(0, 0.4, y01 + 0.1 * (fh - 0.5)));
    let k = ground * val * Math.min(1.12, 0.74 + 0.4 * lit + 0.24 * (grad - 0.5) * (1 - Math.abs(n[1])) + (clamp01(n[1]) > 0.4 ? 0.08 * noise.noise(p[0] * 5, p[2] * 5, 7) : 0));
    // up-facing facets catch the key light hardest: keep them from blowing out into pale holes against the dark mass
    k *= 1 - 0.5 * sm(0.45, 0.9, n[1]);
    let rgb: Vec3 = [base[0] * k, base[1] * k, base[2] * k];
    let em = 0;

    const dOuter = c.edge[0], dCrack = c.edge[1], dCham = c.edge[2];
    const lively = fh > 0.42;
    if (face.cls === CLS.CHAMFER) {
      // chipped bevel: fresh-cut stone with fine glints; a hot sliver where it meets a fracture seam
      const sparkle = noise.noise(p[0] * 60, p[1] * 60, p[2] * 60) > 0.55 ? 0.35 : 0;
      rgb = mixv(rgb, pal.edge, 0.32 + 0.2 * fh + sparkle);
      const g = lively ? sm(0.012, 0.0, dCrack) * seams : 0;
      em += 0.7 * g;
      rgb = mixv(rgb, pal.ember, g * 0.4);
    } else {
      if (Number.isFinite(dOuter) && dOuter < 0.03) rgb = mixv(rgb, pal.edge, 0.3 * sm(0.03, 0.002, dOuter));
      if (Number.isFinite(dCham) && dCham < 0.02) rgb = mixv(rgb, pal.edge, 0.12 * sm(0.02, 0.0, dCham));
      const line = lively ? sm(0.006, 0.0015, dCrack) * seams : 0;
      em += 0.8 * line;
      rgb = mixv(rgb, [0.015, 0.012, 0.02], 0.65 * sm(0.04, 0.004, dCrack));
    }

    // decals: carved rune strokes
    let carve = 0;
    for (const d of spec.decals) {
      if (face.plane !== d.plane || face.cls !== CLS.OUTER) continue;
      if (d.part !== undefined && face.part !== d.part) continue;
      const rx = p[0] - d.o[0], ry = p[1] - d.o[1], rz = p[2] - d.o[2];
      const u = (rx * d.right[0] + ry * d.right[1] + rz * d.right[2]) / d.w + 0.5;
      const v = 0.5 - (rx * d.up[0] + ry * d.up[1] + rz * d.up[2]) / d.h;
      if (u < -0.15 || u > 1.15 || v < -0.15 || v > 1.15) continue;
      if (d.plate) {
        const dd = Math.hypot(u - 0.5, (v - 0.5) * (d.h / d.w)) * 2;
        const inside = 1 - sm(d.plate.r - 0.02, d.plate.r + 0.02, dd);
        const rim = sm(0.035, 0.0, Math.abs(dd - d.plate.r));
        rgb = mixv(rgb, [rgb[0] * 0.45, rgb[1] * 0.43, rgb[2] * 0.5], inside * d.plate.depth);
        rgb = mixv(rgb, pal.edge, rim * 0.3);
      }
      const cr = d.crop ?? [0, 0, 1, 1];
      const su = cr[0] + (cr[2] - cr[0]) * u, sv = cr[1] + (cr[3] - cr[1]) * v;
      const ch = d.ch ?? 0;
      const px = 1 / (d.img.w * (cr[2] - cr[0])) * 1.0; // one source texel in decal-uv
      const stroke = sample(d.img, su, sv, ch, false) * (u >= 0 && u <= 1 && v >= 0 && v <= 1 ? 1 : 0);
      if (stroke <= 0.003 && !d.halo && !d.carve) continue;
      const g = d.gain ?? 1;
      em = Math.max(em, clamp01(stroke * 1.25) * g);
      // halo: wide soft bleed from 4 taps; carve: slightly dilated stroke
      if (d.halo) {
        const r = px * 7 * (cr[2] - cr[0]);
        const hsum = sample(d.img, su + r, sv, ch, false) + sample(d.img, su - r, sv, ch, false) + sample(d.img, su, sv + r, ch, false) + sample(d.img, su, sv - r, ch, false);
        em = Math.max(em, (hsum / 4) * d.halo * g);
      }
      if (d.carve) {
        const r = px * 2.2 * (cr[2] - cr[0]);
        const csum = sample(d.img, su + r, sv, ch, false) + sample(d.img, su - r, sv, ch, false) + sample(d.img, su, sv + r, ch, false) + sample(d.img, su, sv - r, ch, false);
        carve = Math.max(carve, clamp01(Math.max(stroke, csum / 3) * 1.4) * d.carve);
      }
    }
    if (carve > 0) {
      rgb = mixv(rgb, [rgb[0] * 0.25, rgb[1] * 0.24, rgb[2] * 0.28], carve);
      rgb = mixv(rgb, pal.ember, clamp01(em) * 0.55);
    }

    // crystal tips: the upper part of a spike glows from within
    if (spec.tipParts?.includes(face.part) && face.cls === CLS.OUTER && spec.boneTop) {
      const top = spec.boneTop[face.bone] ?? 0;
      const tip = sm(top - 0.55, top - 0.03, p[1]) * (spec.tipGain ?? 0.8);
      if (tip > 0) {
        em = Math.max(em, tip * (0.75 + 0.25 * fh));
        rgb = mixv(rgb, [rgb[0] * 0.45 + pal.ember[0] * 0.2, rgb[1] * 0.45 + pal.ember[1] * 0.2, rgb[2] * 0.5 + pal.ember[2] * 0.25], tip * 0.7);
      }
    }
    // lightning veins (accent) on outer faces, patchy
    if (veinImg && spec.veins && face.cls === CLS.OUTER) {
      triplanar(veinImg, p, n, 1 / 2.2, tmp2);
      const patch = sm(0.05, 0.45, noise.fbm(p[0] * 0.9 + 4, p[1] * 0.7, p[2] * 0.9, { octaves: 2 }));
      const vv = sm(0.35, 0.85, tmp2[0]) * patch * spec.veins;
      em = Math.max(em, vv * 0.95);
      rgb = mixv(rgb, [rgb[0] * 0.35, rgb[1] * 0.3, rgb[2] * 0.35], vv);
    }
    return { rgb, emissive: clamp01(em) };
  };

  const bandPaint = (u: number, v: number, kind: 0 | 1): ShadeOut => {
    if (kind === 1) {
      // chamfer strip: fresh-cut pale stone, a different brightness per column
      const k = 0.5 + 0.5 * hash1(Math.floor(u * 64) + 977);
      const c0 = mixv(pal.light, pal.edge, 0.25);
      return { rgb: [c0[0] * k, c0[1] * k, c0[2] * k], emissive: 0 };
    }
    // fracture face: molten core (v = 0 at the face centre) fading to a dark rim (v = 1)
    const f = 0.85 + 0.15 * hash1(Math.floor(u * 40));
    const core = 1 - sm(0.0, 0.95, v);
    return { rgb: [pal.ember[0] * f * (0.3 + 0.7 * core), pal.ember[1] * f * (0.3 + 0.7 * core), pal.ember[2] * f * (0.3 + 0.7 * core)], emissive: clamp01((0.08 + 0.92 * core * core) * f) };
  };
  return { shade, bandPaint };
}
