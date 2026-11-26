// More materials for the village / orc props: straw, felt, glazed clay, paper lantern, charred embers, weathered boards.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import type { Mat, Texel } from '../../mesh.ts';
import { type Rgb, sampleTex } from '../../texlib.ts';
import { edgeWear, fbm01, groundDirt, lum, mixc, mulc, pickTex, rgb, snowOn } from '../../mats.ts';
import { fract } from './paint.ts';
import { triTex } from './tiles.ts';

const mulcc = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const nz = (t: Texel, a: number, b: number, c: number): number => t.noise.noise(a, b, c);

/** straw / thatch with long strands running along uv v (slope of a stack), bundle courses and a dirty foot. uv from mapCylY (u around, v down) */
export function straw(name: string, o: { courses?: number; dirt?: number; snow?: number } = {}): Mat {
  const dark = rgb('#6a4a1d'), mid = rgb('#b98d3c'), light = rgb('#e4cb83'), ochre = rgb('#8e6628');
  const T = pickTex('tex_thatch_straw');
  const course = o.courses ?? 0.36;
  return {
    name,
    shade(t) {
      const sc = 1 / Math.max(0.05, t.tpm);
      const a = t.uv[0] * sc, b = t.uv[1] * sc;
      const wob = 0.05 * nz(t, a * 1.7, b * 1.1, 2.2);
      const s = 0.5 + 0.5 * (0.55 * nz(t, a * 52, (b + wob) * 2.4, 1.7) + 0.3 * nz(t, a * 120, b * 5, 5.3) + 0.15 * nz(t, a * 260, b * 9, 9.1));
      let c = mixc(dark, mid, smoothstep(0.22, 0.62, s));
      c = mixc(c, light, smoothstep(0.6, 0.94, s) * 0.85);
      c = mixc(c, ochre, 0.35 * smoothstep(0.55, 0.9, 0.5 + 0.5 * nz(t, a * 3, b * 3, 8.8)));
      if (T) c = mixc(c, mulc(t.tex(T, 1), 1.25), 0.72);
      // bundle courses: shadow under each course edge and a dark seam
      const f = fract((b + wob) / course);
      c = mulc(c, 0.72 + 0.4 * smoothstep(0.0, 0.7, f));
      c = mulc(c, 1 - 0.35 * smoothstep(0.93, 1.0, f));
      c = groundDirt(c, t, 0.55, o.dirt ?? 0.55, rgb('#3e2d18'));
      c = mulc(c, 0.85 + 0.15 * t.ao);
      if (o.snow) c = snowOn(c, t, o.snow);
      return c;
    },
  };
}

/** pressed white felt: fibre noise, grime near the ground, soot near the crown, optional snow; decorative bands by world height */
export function felt(name: string, o: { snow?: number; bands?: { y0: number; y1: number; r: number; theta?: boolean }[]; soot?: [number, number]; color?: string } = {}): Mat {
  const base = rgb(o.color ?? '#d9d2c0'), grime = rgb('#6a5d48'), soot = rgb('#2b2218');
  const red = rgb('#9c2a1e'), blue = rgb('#254f8c'), gold = rgb('#d4a438'), white = rgb('#efe8d6');
  const T = pickTex('tex_felt_white');
  return {
    name,
    shade(t) {
      let c = mulc(base, 0.86 + 0.18 * (0.5 + 0.5 * nz(t, t.p[0] * 40, t.p[1] * 40, t.p[2] * 40)));
      if (T) c = mixc(c, mulc(triTex(t, T, 1.3), 1.05 * lum(base) / 0.52), 0.7);
      c = mulc(c, 0.9 + 0.14 * fbm01(t, 2.2, 3, 3.7));
      // pressed felt panel seams (stitched, running vertically)
      const th = Math.atan2(t.p[0], t.p[2]);
      const seam = Math.abs(fract(th / (Math.PI / 6) + 0.5) - 0.5) * (Math.PI / 6) * Math.hypot(t.p[0], t.p[2]);
      c = mixc(c, grime, 0.35 * (1 - smoothstep(0.004, 0.012, seam)) * clamp01(1.2 - t.n[1]));
      for (const b of o.bands ?? []) {
        if (t.p[1] < b.y0 - 0.02 || t.p[1] > b.y1 + 0.02) continue;
        const R = Math.max(0.5, Math.hypot(t.p[0], t.p[2]));
        const u = th * R, v = (t.p[1] - b.y0) / (b.y1 - b.y0);
        const inb = smoothstep(0, 0.02, v) * (1 - smoothstep(0.98, 1.0, v));
        if (inb <= 0) continue;
        // geometric woven band: red field, blue diamonds, gold dots, white edge lines
        const cell = 0.34;
        const du = Math.abs(fract(u / cell) - 0.5) * 2, dv = Math.abs(v - 0.5) * 2;
        const dia = du + dv * 1.3;
        let bc = red;
        bc = mixc(bc, blue, 1 - smoothstep(0.55, 0.6, dia));
        bc = mixc(bc, white, (1 - smoothstep(0.0, 0.05, Math.abs(dia - 0.62))) * 0.9);
        bc = mixc(bc, gold, 1 - smoothstep(0.12, 0.16, Math.hypot(du * 0.9, dv * 1.2)));
        bc = mixc(bc, white, (1 - smoothstep(0.0, 0.06, Math.min(v, 1 - v))) * 0.85);
        bc = mulc(bc, 0.85 + 0.25 * nz(t, u * 60, v * 20, 1.1));
        c = mixc(c, bc, inb * 0.95);
      }
      c = groundDirt(c, t, 0.6, 0.6, grime);
      if (o.soot) c = mixc(c, soot, 0.8 * smoothstep(o.soot[0], o.soot[1], t.p[1]) * (0.5 + 0.5 * (0.5 + 0.5 * nz(t, t.p[0] * 5, t.p[1] * 1.5, 9.1))));
      c = mulc(c, 0.8 + 0.2 * t.ao);
      c = edgeWear(c, t, mulc(base, 1.1), 0.15);
      if (o.snow) c = snowOn(c, t, o.snow);
      return c;
    },
  };
}

/** glazed / burnt clay: terracotta with a dark glaze on the upper body, cream painted wave bands, drips, cracks, chips */
export function clay(name: string, o: { body?: string; glaze?: string; bands?: [number, number][]; glazeFrom?: number; wear?: number } = {}): Mat {
  const body = rgb(o.body ?? '#a45a32'), body2 = rgb('#7c3d22'), glaze = rgb(o.glaze ?? '#2c1a10'), cream = rgb('#e2cfa0'), crack = rgb('#2a1710');
  return {
    name,
    shade(t) {
      let c = mixc(body, body2, 0.55 * (0.5 + 0.5 * nz(t, t.p[0] * 5, t.p[1] * 6, t.p[2] * 5)) + 0.25 * (1 - t.ao));
      c = mulc(c, 0.88 + 0.22 * (0.5 + 0.5 * nz(t, t.p[0] * 30, t.p[1] * 30, t.p[2] * 30)));
      // glaze over the upper body with drips
      const gy = o.glazeFrom ?? 0.55;
      const th = Math.atan2(t.p[0], t.p[2]);
      const drip = 0.07 * Math.sin(th * 9 + 1.3) + 0.05 * Math.sin(th * 17) + 0.03 * nz(t, th * 6, 0, 3.3);
      const g = smoothstep(gy + drip - 0.02, gy + drip + 0.02, t.p[1]);
      c = mixc(c, mulc(glaze, 0.8 + 0.5 * nz(t, t.p[0] * 12, t.p[1] * 12, t.p[2] * 12) * 0.5 + 0.25), g * 0.92);
      for (const [y0, y1] of o.bands ?? []) {
        const wave = 0.018 * Math.sin(th * 14);
        const k = smoothstep(y0 + wave - 0.006, y0 + wave + 0.006, t.p[1]) * (1 - smoothstep(y1 + wave - 0.006, y1 + wave + 0.006, t.p[1]));
        c = mixc(c, mulc(cream, 0.88 + 0.2 * nz(t, th * 20, t.p[1] * 40, 2.2)), k * 0.9);
      }
      // hairline cracks and chipped rims
      const cr = Math.abs(t.noise.noise(t.p[0] * 9, t.p[1] * 9 + 3, t.p[2] * 9));
      c = mixc(c, crack, (1 - smoothstep(0.0, 0.025, cr)) * 0.5 * (o.wear ?? 0.7));
      c = mixc(c, mulc(body, 1.3), clamp01(t.edge * 1.2) * 0.6 * (o.wear ?? 0.7));
      c = groundDirt(c, t, 0.25, 0.45, rgb('#3e2d18'));
      return mulc(c, 0.75 + 0.25 * t.ao);
    },
  };
}

/** glowing paper lantern: yellow paper with dark ribs and bands; emits warm light */
export function lantern(name: string, o: { color?: string; glow?: number } = {}): Mat {
  const paper = rgb(o.color ?? '#ffcb4f'), rib = rgb('#7a3a14'), hot = rgb('#ff8a2a');
  const glow = o.glow ?? 0.9;
  const paint = (t: Texel): { c: Rgb; k: number } => {
    const th = Math.atan2(t.p[0], t.p[2]);
    const ribs = 1 - smoothstep(0.012, 0.03, Math.abs(fract(th / (Math.PI / 8) + 0.5) - 0.5) * (Math.PI / 8) * 0.4);
    const k = 0.78 + 0.22 * (0.5 + 0.5 * nz(t, t.p[0] * 25, t.p[1] * 25, t.p[2] * 25));
    return { c: mulc(paper, k), k: ribs };
  };
  return {
    name,
    ao: 0.15,
    shade(t) {
      const { c, k } = paint(t);
      return mixc(c, rib, k * 0.55);
    },
    emit(t) {
      const { c, k } = paint(t);
      return mulc(mixc(mixc(c, hot, 0.35), mulcc(rib, hot), k * 0.6), glow);
    },
  };
}

/**
 * charred timber: elongated char blocks (cells run along the log) with glowing fissures in hot patches, hottest low and toward the
 * middle of the fire; the shipped charred-bark tile adds the micro relief. Tube uv: u along the log, v around.
 */
export function charred(name: string, o: { glow?: number; core?: [number, number] } = {}): Mat {
  const T = pickTex('tex_bark_charred');
  const glow = o.glow ?? 1.0;
  const coal = rgb('#15100e'), ash = rgb('#6c645c'), ember = rgb('#ff5a14'), hotc = rgb('#ffbe5a');
  const core = o.core ?? [0.0, 0.7];
  const sample = (t: Texel): { c: Rgb; r: number } => {
    const a = t.uv[0], b = t.uv[1];
    const v = t.noise.voronoi(a * 6, b * 20, 2.1, 0.9);
    const border = 1 - smoothstep(0.012, 0.085, v.f2 - v.f1);
    let c = mixc(coal, ash, 0.1 + 0.22 * v.id + 0.14 * (0.5 + 0.5 * nz(t, a * 30, b * 30, 1.7)));
    if (T) c = mulc(c, 0.45 + 2.6 * lum(sampleTex(T, b * 1.6, a * 1.6, t.fp * 1.6)));
    // char blocks glow dull red at the rim, ash dusts the top faces
    const dust = smoothstep(0.55, 0.95, t.n[1]) * 0.35;
    c = mixc(c, mulc(ash, 1.1), dust);
    const hot = smoothstep(0.52, 0.82, 0.5 + 0.5 * nz(t, a * 1.2, b * 2.4, 3.3));
    const hy = 1 - smoothstep(0.15, 1.2, t.p[1]);
    return { c, r: border * hot * (0.25 + 0.75 * hy) };
  };
  return {
    name,
    shade(t) {
      const { c, r } = sample(t);
      const near = 1 - smoothstep(core[0], core[1], Math.hypot(t.p[0], t.p[2]));
      const k = Math.min(1, r * (0.5 + 0.6 * near));
      let out = mixc(c, mixc(rgb('#c4300e'), ember, 0.4 + 0.5 * near), k);
      out = mulc(out, 0.85 + 0.15 * t.ao);
      return out;
    },
    emit(t) {
      const { r } = sample(t);
      const near = 1 - smoothstep(core[0], core[1], Math.hypot(t.p[0], t.p[2]));
      const k = Math.min(1, r * (0.5 + 0.6 * near)) * glow;
      return k > 0.02 ? mulc(mixc(rgb('#e8420e'), hotc, 0.12 + 0.3 * near), k * 1.05) : null;
    },
  };
}

/** glowing ash bed with embers (the floor inside the stone ring) */
export function emberBed(name: string, o: { glow?: number } = {}): Mat {
  const ash = rgb('#3a352f'), dark = rgb('#17130f'), ember = rgb('#ff5a14');
  const glow = o.glow ?? 1;
  const mask = (t: Texel): number => {
    const v = t.noise.voronoi(t.p[0] * 14, t.p[2] * 14, 1.1, 0.9);
    return (1 - smoothstep(0.12, 0.3, v.f1)) * smoothstep(0.35, 0.7, 0.5 + 0.5 * nz(t, t.p[0] * 5, t.p[2] * 5, 4.4)) * (1 - smoothstep(0.55, 0.95, Math.hypot(t.p[0], t.p[2])));
  };
  return {
    name,
    ao: 0.4,
    shade(t) {
      const f = 0.5 + 0.5 * nz(t, t.p[0] * 12, t.p[2] * 12, 2.1);
      let c = mixc(dark, ash, f * 0.7);
      c = mixc(c, mulc(ember, 1.3), mask(t));
      return c;
    },
    emit(t) {
      const k = mask(t) * glow;
      return k > 0.02 ? mulc(mixc(ember, rgb('#ffb04a'), 0.3), k * 1.8) : null;
    },
  };
}

export { pickTex, groundDirt };
