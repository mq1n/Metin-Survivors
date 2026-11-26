// Materials for the orc camp / village props. Hand-painted look: faceted hewn timber, stitched patchwork hides with crude ochre
// motifs, twisted rope, cracked ivory bone, torn painted cloth. Every material shades a texel from its tile uv (tube / sheet uvs)
// or from its model-space position and also feeds on the baked occlusion / edge channels.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import { type Mat, type Texel } from '../../mesh.ts';
import { type Rgb, sampleTex } from '../../texlib.ts';
import { edgeWear, fbm01, groundDirt, lum, mixc, mulc, pickTex, rgb, snowOn } from '../../mats.ts';
import { triTex } from './tiles.ts';
import { MOTIFS, type MotifKind, cov, fract, hash3, motifCov, sdRoundBox, sdSeg } from './paint.ts';

const mulcc = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** signed noise in [-1, 1] at (a, b) with a fixed third coordinate `c` */
const nz = (t: Texel, a: number, b: number, c: number): number => t.noise.noise(a, b, c);
const fbm2 = (t: Texel, a: number, b: number, c: number, oct = 3): number => t.noise.fbm(a, b, c, { octaves: oct });
/** anti-aliasing half width in metres */
const AA = (t: Texel, k = 1.1): number => Math.max(0.0015, t.mpt * k);

// ---------------------------------------------------------------------------------------------------------------------------------
// timber

export interface TimberOpts {
  dark: string;
  mid: string;
  light: string;
  /** sun-bleached silver on exposed up-facing wood */
  grey?: string;
  /** bark remnants 0..1 */
  bark?: number;
  /** hewn facet strength 0..1 */
  facets?: number;
  /** knots per metre-ish */
  knots?: number;
  dirt?: number;
  moss?: number;
  snow?: number;
  /** which uv axis the grain runs along (tubes: 'u', boards with mapBoard-like uv: 'v') */
  grain?: 'u' | 'v';
  /** metres per uv unit */
  scale?: number;
  /** red ochre / black paint bands by height [y0, y1, colour] */
  bands?: [number, number, string][];
  /** shipped grain tile (null = fully procedural); its grain runs along the log */
  tile?: string[] | null;
  /** metres per tile repeat */
  tileM?: number;
  /** tile luminance range mapped onto dark..light (default fits the dark beam tile) */
  tileRange?: [number, number];
  /** direction of the grain inside the tile image: the dark beam tile runs along v, the plank tile along u */
  tileGrain?: 'u' | 'v';
}

/** hewn / weathered timber: streaky painted grain, facets, knots, bark patches, silver weathering */
export function timber(name: string, o: TimberOpts): Mat {
  const dark = rgb(o.dark), mid = rgb(o.mid), light = rgb(o.light), grey = rgb(o.grey ?? '#8a8372'), barkC = rgb('#3a2d22'), barkL = rgb('#5b4a3a');
  const bands = (o.bands ?? []).map(([a, b, c]) => [a, b, rgb(c)] as [number, number, Rgb]);
  const sc = o.scale ?? 1;
  const alongU = (o.grain ?? 'u') === 'u';
  const T = o.tile === null ? null : pickTex(...(o.tile ?? ['tex_wood_beam_dark']));
  const tm = o.tileM ?? 0.85;
  const [tLo, tHi] = o.tileRange ?? [0.006, 0.091];
  const tileU = o.tileGrain === 'u';
  return {
    name,
    shade(t) {
      const a0 = (alongU ? t.uv[0] : t.uv[1]) * sc; // along the grain (m)
      const c0 = (alongU ? t.uv[1] : t.uv[0]) * sc; // across the grain (m)
      const g1 = nz(t, a0 * 0.9, c0 * 7, 1.3);
      let c: Rgb;
      let g: number;
      if (T) {
        // painted bark/grain tile (grain runs along tile v), graded into this model's wood colours
        const s = tileU ? sampleTex(T, a0 / tm, c0 / tm, (t.fp * sc) / tm) : sampleTex(T, c0 / tm, a0 / tm, (t.fp * sc) / tm);
        g = clamp01((lum(s) - tLo) / (tHi - tLo));
        c = mixc(dark, mid, smoothstep(0.06, 0.5, g));
        c = mixc(c, light, smoothstep(0.45, 0.95, g) * 0.85);
        c = mixc(c, mulc(s, 3.2), 0.18);
      } else {
        // streaky grain
        const g2 = nz(t, a0 * 2.6, c0 * 19, 4.1), g3 = nz(t, a0 * 6, c0 * 55, 9.7);
        g = 0.5 + 0.5 * (0.52 * g1 + 0.3 * g2 + 0.18 * g3);
        c = mixc(dark, mid, smoothstep(0.18, 0.62, g));
        c = mixc(c, light, smoothstep(0.58, 0.95, g) * 0.8);
        // darker growth lines
        const ring = Math.abs(fract(c0 * 5.5 + g1 * 0.9) - 0.5);
        c = mulc(c, 1 - 0.16 * smoothstep(0.34, 0.5, ring));
      }
      // hewn facets: voronoi cells stretched along the grain
      if (o.facets) {
        const v = t.noise.voronoi(a0 * 1.15, c0 * 3.4, 5.2);
        const border = 1 - smoothstep(0.015, 0.075, v.f2 - v.f1);
        c = mulc(c, 1 + (v.id - 0.5) * 0.34 * o.facets);
        c = mulc(c, 1 - (T ? 0.4 : 0.55) * border * o.facets);
      }
      // knots
      if (o.knots && !T) {
        const v = t.noise.voronoi(a0 * 0.8, c0 * 2.1, 8.4);
        if (v.id > 1 - 0.28 * o.knots) {
          const r = v.f1;
          const k = 1 - smoothstep(0.1, 0.34, r);
          const rr = Math.abs(fract(r * 9) - 0.5);
          c = mixc(c, mixc(dark, light, 0.25 + 0.5 * smoothstep(0.2, 0.5, rr)), k * 0.85);
          c = mulc(c, 1 - 0.55 * (1 - smoothstep(0.0, 0.1, r)));
        }
      }
      // bark remnants
      if (o.bark && !T) {
        const b = 0.5 + 0.5 * fbm2(t, a0 * 1.1 + 3.3, c0 * 2.7 + 1.1, 6.6, 3);
        const m = smoothstep(0.72 - o.bark * 0.35, 0.8 - o.bark * 0.3, b);
        if (m > 0) {
          const f = 0.5 + 0.5 * t.noise.ridged(a0 * 3.2, c0 * 22, 2.2, { octaves: 2 });
          c = mixc(c, mixc(barkC, barkL, f * 0.7), m * 0.95);
        }
      }
      // weathering silver on exposed top surfaces and ends
      const exposed = clamp01(t.n[1] * 0.6 + 0.2) * clamp01((t.aoL - 0.45) * 2);
      c = mixc(c, mulcc(grey, mulc(c, 2.2)), clamp01(exposed * 0.5 * (0.4 + 0.8 * fbm01(t, 4, 2, 2.1))));
      for (const [y0, y1, col] of bands) {
        const m = smoothstep(y0 - 0.012, y0 + 0.012, t.p[1]) * (1 - smoothstep(y1 - 0.012, y1 + 0.012, t.p[1]));
        if (m > 0) c = mixc(c, mulcc(col, mulc(c, 2.0)), m * (0.78 + 0.22 * g));
      }
      if (o.dirt) c = groundDirt(c, t, 0.4, o.dirt);
      c = edgeWear(c, t, mulc(light, 1.25), 0.4);
      if (o.snow) c = snowOn(c, t, o.snow);
      return c;
    },
  };
}

/** end grain of a cut log: concentric annual rings around the cap centre (uv = metres from the centre), radial checks */
export function endGrain(name: string, o: { light?: string; dark?: string; period?: number } = {}): Mat {
  const light = rgb(o.light ?? '#c7a374'), dark = rgb(o.dark ?? '#7d5a36'), pith = rgb('#4f351f');
  const P = o.period ?? 0.013;
  return {
    name,
    shade(t) {
      const x = t.uv[0], y = t.uv[1];
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const wob = 0.0035 * Math.sin(a * 3 + 1.3) + 0.002 * nz(t, x * 30, y * 30, 3.3);
      const ring = Math.abs(fract((r + wob) / P) - 0.5) * 2;
      let c = mixc(light, dark, smoothstep(0.15, 0.95, ring) * 0.85);
      c = mixc(c, pith, 1 - smoothstep(0.0, 0.025, r));
      // radial checks
      const ch = Math.abs(fract(a / 0.6 + nz(t, a * 2, 0, 7.7) * 0.4) - 0.5);
      c = mulc(c, 1 - 0.4 * (1 - smoothstep(0.0, 0.03, ch)) * smoothstep(0.02, 0.07, r));
      c = mulc(c, 0.9 + 0.2 * fbm01(t, 40, 2, 1.7));
      return mulc(c, 0.75 + 0.25 * t.ao);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// rope

/** twisted fibre rope. `across`: 'u' when wraps stack along u (lashing bands around logs, u = along the log), 'v' for straight lines (u along the rope) */
export function rope(name: string, o: { color?: string; dark?: string; across?: 'u' | 'v'; tone?: number } = {}): Mat {
  const base = rgb(o.color ?? '#b79a68'), dark = rgb(o.dark ?? '#5e4829');
  const lash = (o.across ?? 'u') === 'u';
  return {
    name,
    shade(t) {
      const sc = 1 / Math.max(0.05, t.tpm);
      const along = (lash ? t.uv[1] : t.uv[0]) * sc;
      const cross = (lash ? t.uv[0] : t.uv[1]) * sc;
      // helical strands
      const phase = along * 46 + cross * 15;
      const strand = Math.abs(fract(phase) - 0.5) * 2;
      let c = mixc(base, dark, smoothstep(0.55, 1.0, strand) * 0.55);
      if (lash) {
        const w = fract(t.uv[0] * sc / 0.03);
        c = mulc(c, 0.62 + 0.55 * Math.sin(w * Math.PI) ** 0.7);
      }
      c = mulc(c, (o.tone ?? 1) * (0.88 + 0.24 * fbm01(t, 30, 2, 5.1)));
      return mulc(c, 0.7 + 0.3 * t.ao);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// bone / horn / skull

export function bone(name: string, o: { horn?: boolean; base?: string; tip?: string; paint?: [number, number, string][] } = {}): Mat {
  const ivory = rgb(o.base ?? '#e0d4b2'), yellow = rgb('#b99d62'), brown = rgb('#4a3722');
  const hornBase = rgb(o.base ?? '#5a4630'), hornTip = rgb(o.tip ?? '#d8c9a2');
  const T = pickTex('tex_bone_ivory');
  return {
    name,
    shade(t) {
      const sc = 1 / Math.max(0.05, t.tpm);
      const a = t.uv[0] * sc, b = t.uv[1] * sc;
      let c: Rgb;
      if (o.horn) {
        const k = smoothstep(0.0, 0.45, a % 5);
        c = mixc(hornBase, hornTip, k);
        const ringP = Math.abs(fract(a * 14 + nz(t, a * 3, b * 8, 1.3) * 0.35) - 0.5);
        c = mulc(c, 1 - 0.28 * smoothstep(0.3, 0.5, ringP));
        c = mulc(c, 0.85 + 0.3 * fbm01(t, 30, 2, 0.7));
        if (T) c = mulc(c, 0.55 + 0.9 * lum(triTex(t, T, 0.6)));
      } else {
        c = mixc(ivory, yellow, 0.55 * fbm01(t, 7, 3, 4.1) + 0.3 * (1 - t.ao));
        if (T) c = mixc(c, mulc(triTex(t, T, 0.5), 1.15), 0.5);
        const crack = 1 - smoothstep(0.0, 0.035, 0.5 - 0.5 * Math.abs(t.noise.noise(a * 24 + 3, b * 24, 3.9)) * 2 + 0.02) ;
        c = mixc(c, brown, clamp01(crack) * 0.28);
        c = mulc(c, 0.9 + 0.2 * fbm01(t, 60, 2, 8.8));
      }
      for (const [y0, y1, col] of o.paint ?? []) {
        const m = smoothstep(y0 - 0.01, y0 + 0.01, t.p[1]) * (1 - smoothstep(y1 - 0.01, y1 + 0.01, t.p[1]));
        if (m > 0) c = mixc(c, mulcc(rgb(col), mulc(c, 1.6)), m * 0.85);
      }
      c = edgeWear(c, t, mulc(ivory, 1.1), 0.4);
      return mulc(c, 0.74 + 0.26 * t.ao);
    },
  };
}

/** skull bone: uv is the skull-local front plane (units of the skull size) from geom.mapSkull; paints dark eye sockets, nose, teeth */
export function skullBone(name: string, o: { paint?: string } = {}): Mat {
  const ivory = rgb('#e0d3ae'), yellow = rgb('#b09458'), brown = rgb('#3d2c1b'), socket = rgb('#0f0a07');
  const paint = o.paint ? rgb(o.paint) : null;
  const T = pickTex('tex_bone_ivory');
  return {
    name,
    shade(t) {
      const x = t.uv[0], y = t.uv[1];
      const front = Math.abs(x) < 1.2;
      let c = mixc(ivory, yellow, 0.5 * fbm01(t, 8, 3, 2.7) + 0.35 * (1 - t.ao));
      if (T) c = mixc(c, mulc(triTex(t, T, 0.42), 1.15), 0.5);
      c = mulc(c, 0.9 + 0.2 * fbm01(t, 55, 2, 1.1));
      const crack = Math.abs(t.noise.noise(t.p[0] * 22, t.p[1] * 22, t.p[2] * 22 + 5));
      c = mixc(c, brown, (1 - smoothstep(0.0, 0.05, crack)) * 0.35);
      if (front && t.nf[1] < 0.92) {
        const aa = 0.012;
        // eye sockets: crisp dark ovals with a dim bony rim
        const ex = Math.min(Math.hypot((x - 0.245) / 0.125, (y - 0.29) / 0.085), Math.hypot((x + 0.245) / 0.125, (y - 0.29) / 0.085));
        c = mixc(c, mulc(brown, 1.1), 0.7 * (1 - smoothstep(1.0, 1.55, ex)));
        c = mixc(c, socket, 1 - smoothstep(1 - aa * 9, 1 + aa * 9, ex));
        // nasal cavity: upside-down heart
        const nose = Math.hypot((x - 0.045 * Math.sign(x)) / 0.05, (y - 0.06) / 0.075);
        c = mixc(c, socket, (1 - smoothstep(0.9, 1.1, nose)) * (y < 0.14 ? 1 : 0));
        // tooth line along the upper jaw and gaps between the teeth
        if (y < 0.0 && y > -0.1) {
          const gx = Math.abs(fract(x / 0.08 + 0.5) - 0.5) * 0.08;
          c = mixc(c, brown, (1 - smoothstep(0.004, 0.011, gx)) * 0.65 * (1 - smoothstep(0.17, 0.2, Math.abs(x))));
        }
        if (paint) {
          const stripe = Math.abs(((x + 0.5) % 0.2) - 0.1);
          c = mixc(c, mulcc(paint, mulc(c, 1.7)), smoothstep(0.05, 0.045, stripe) * smoothstep(0.38, 0.4, y) * 0.9);
        }
      }
      c = edgeWear(c, t, mulc(ivory, 1.1), 0.35);
      return mulc(c, 0.72 + 0.28 * t.ao);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// patchwork hide with stitched seams and crude tribal paint

export interface HideMotif {
  panel: number;
  kind: MotifKind;
  /** centre (m) along the panel (0 = panel centre) and up from the hem */
  u: number;
  v: number;
  size: number;
  color?: string;
  rot?: number;
}

export interface HideOpts {
  /** (panel id, u metres from the panel centre, v metres up the panel, height above the hem edge) of a texel */
  frame: (t: Texel) => [number, number, number, number];
  palette?: string[];
  /** palette of the sewn-on patches */
  patchPalette?: string[];
  motifs?: HideMotif[];
  courseH?: number;
  pieceW?: number;
  /** dark leather border height at the hem */
  hem?: number;
  /** panel top (v) where soot darkens the cloth */
  top?: number;
  dirt?: number;
  soot?: number;
  /** patches per panel */
  patches?: number;
  /** half extents (m) of the area patches are scattered in: [u, v0, v1] */
  patchArea?: [number, number, number];
  /** shipped stitched-patchwork tile replaces the procedural pieces: metres per repeat and brightness gain (false = procedural) */
  tile?: { m?: number; gain?: number } | false;
}

export function orcHide(name: string, o: HideOpts): Mat {
  const pal = (o.palette ?? ['#8a6a46', '#6e5236', '#a07c50', '#5a432e', '#7a5a3b', '#8a7f5f']).map(rgb);
  const patchPal = (o.patchPalette ?? ['#4a3626', '#7b3a24', '#b49a68', '#3a2c20']).map(rgb);
  const seamC = rgb('#24180f'), thread = rgb('#cdbf94'), leatherD = rgb('#30221a'), leatherL = rgb('#503a28');
  const bone = rgb('#e6dcc0');
  const ch = o.courseH ?? 0.72, cw = o.pieceW ?? 1.25, hem = o.hem ?? 0.3;
  const motifs = (o.motifs ?? []).map((m) => ({ ...m, rgbc: rgb(m.color ?? '#a5321c') }));
  const nPatch = o.patches ?? 3;
  const [pu, pv0, pv1] = o.patchArea ?? [1.2, 0.7, 2.6];
  const T = o.tile === false ? null : pickTex('tex_hide_patch');
  const tileM = (o.tile || undefined)?.m ?? 1.5, tileGain = (o.tile || undefined)?.gain ?? 1.7;
  /** hide from the shipped patchwork tile, then the hem band, large war-paint motifs, soot and mud on top */
  const tiledHide = (t: Texel, tile: NonNullable<typeof T>, pid: number, u0: number, v0: number, vh: number, aa: number): Rgb => {
    const off = pid * 0.37;
    let c = mulc(sampleTex(tile, u0 / tileM + off, v0 / tileM + off * 0.7, t.mpt / tileM), tileGain);
    c = mulc(c, 0.8 + 0.4 * (0.5 + 0.5 * fbm2(t, u0 * 1.4 + pid * 5, v0 * 1.4, 1.3, 3)));
    if (vh < hem + 0.1) {
      const k = 1 - smoothstep(hem - 0.012, hem + 0.012, vh);
      const flecks = nz(t, u0 * 38, v0 * 38, 3.3);
      let lb = mixc(leatherD, leatherL, 0.5 + 0.5 * flecks);
      const zz = Math.abs(fract(u0 / 0.2) - 0.5) * 2;
      const tooth = 1 - smoothstep(0.0, 0.02, vh - hem * (0.2 + 0.5 * (1 - zz)));
      lb = mixc(lb, mixc(bone, c, 0.12), tooth * 0.9 * smoothstep(0.012, 0.03, vh));
      c = mixc(c, lb, k);
      c = mixc(c, seamC, (1 - smoothstep(0.0, 0.012, Math.abs(vh - hem))) * 0.8);
    }
    for (const m of motifs) {
      if (m.panel !== pid) continue;
      const cvg = motifCov(m.kind, u0, v0, m.u, m.v, m.size, aa, m.rot ?? 0);
      if (cvg > 0) {
        const dry = 0.78 + 0.22 * nz(t, u0 * 55, v0 * 9, 4.4);
        c = mixc(c, mulcc(m.rgbc, [0.8 + 1.2 * c[0], 0.8 + 1.2 * c[1], 0.8 + 1.2 * c[2]]), cvg * clamp01(dry) * 0.97);
      }
    }
    if (o.top !== undefined && o.soot) {
      const k = smoothstep(o.top - 1.2, o.top, v0) * o.soot * (0.55 + 0.6 * (0.5 + 0.5 * nz(t, u0 * 6, v0 * 0.8, 1.9)));
      c = mulc(c, 1 - 0.7 * clamp01(k));
    }
    c = groundDirt(c, t, 0.45, o.dirt ?? 0.5, rgb('#44331f'));
    return edgeWear(c, t, mulc(pal[2]!, 1.2), 0.25);
  };
  return {
    name,
    shade(t) {
      const [pid, u0, v0, vh] = o.frame(t);
      const aa = AA(t);
      if (T) return tiledHide(t, T, pid, u0, v0, vh, aa);
      // low-frequency wobble of the seam lines
      const u = u0 + 0.11 * nz(t, v0 * 0.75, pid * 3.1, 1.1);
      const v = v0 + 0.11 * nz(t, u0 * 0.7, pid * 2.3, 2.7);
      const vr = t.noise.voronoi(u / cw, v / ch, pid + 0.5, 0.9);
      const dB = (vr.f2 - vr.f1) * 0.5 * Math.sqrt(cw * ch);
      const dRow = dB, dCol = dB;
      const rf = v / ch, cf = u / cw;
      const row = Math.floor(rf), col = Math.floor(cf);
      let c = pal[Math.floor(vr.id * pal.length) % pal.length]!;
      c = mulc(c, 0.84 + 0.3 * hash3(pid, row * 7 + col, 9));
      c = mulc(c, 0.9 + 0.22 * fract(rf) + 0.14 * (fract(cf) - 0.5) * (hash3(pid, row, col) - 0.5));
      // large soft stains + painted hair mottling
      c = mulc(c, 0.78 + 0.4 * (0.5 + 0.5 * fbm2(t, u0 * 1.4 + pid * 5, v0 * 1.4, 1.3, 3)));
      const flecks = nz(t, u0 * 38, v0 * 38, 3.3);
      c = mulc(c, 1 + 0.07 * flecks);
      // piece edges curl darker
      c = mulc(c, 0.8 + 0.2 * smoothstep(0.0, 0.16, dB));
      // seams: dark core and light stitches straddling them
      const seam = 1 - smoothstep(0.004, 0.011, dB);
      c = mixc(c, seamC, seam * 0.85);
      const stitch = (1 - smoothstep(0.014, 0.02, dB)) * (Math.abs(fract((u0 + v0) / 0.055) - 0.5) * 2 < 0.55 ? 1 : 0);
      c = mixc(c, thread, stitch * 0.7 * (1 - seam));
      // sewn-on patches with stitched borders
      for (let i = 0; i < nPatch; i++) {
        const cu = (hash3(pid, i, 41) * 2 - 1) * pu, cv = lerp(pv0, pv1, hash3(pid, i, 43));
        const hx = 0.2 + 0.28 * hash3(pid, i, 47), hy = 0.16 + 0.22 * hash3(pid, i, 53);
        const ang = (hash3(pid, i, 59) - 0.5) * 0.5;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const du = u0 - cu, dv = v0 - cv;
        const lu = du * ca + dv * sa, lv = -du * sa + dv * ca;
        const d = sdRoundBox(lu, lv, hx, hy, 0.05);
        if (d < 0.04) {
          const pc = patchPal[Math.floor(hash3(pid, i, 61) * patchPal.length) % patchPal.length]!;
          if (d < 0) {
            let pcol = mulc(pc, 0.88 + 0.24 * (0.5 + 0.5 * nz(t, u0 * 5, v0 * 5, 7.7)));
            pcol = mulc(pcol, 0.9 + 0.1 * flecks);
            const stitchD = Math.abs(d + 0.028);
            const dashOn = Math.abs(fract((lu + lv * 1.3) / 0.05) - 0.5) * 2 < 0.55;
            pcol = mixc(pcol, thread, (1 - smoothstep(0.004, 0.009, stitchD)) * (dashOn ? 0.85 : 0) * 1.0);
            c = mixc(c, pcol, smoothstep(0.0, -aa * 2, d));
          } else {
            // contact shadow around the patch
            c = mulc(c, 1 - 0.45 * (1 - d / 0.04));
          }
        }
      }
      // hem leather border with a bone zigzag
      if (vh < hem + 0.1) {
        const k = 1 - smoothstep(hem - 0.012, hem + 0.012, vh);
        let lb = mixc(leatherD, leatherL, 0.5 + 0.5 * flecks);
        const zz = Math.abs(fract(u0 / 0.2) - 0.5) * 2;
        const tooth = 1 - smoothstep(0.0, 0.02, vh - hem * (0.2 + 0.5 * (1 - zz)));
        lb = mixc(lb, mixc(bone, c, 0.12), tooth * 0.9 * smoothstep(0.012, 0.03, vh));
        c = mixc(c, lb, k);
        c = mixc(c, seamC, (1 - smoothstep(0.0, 0.012, Math.abs(vh - hem))) * 0.8);
      }
      // painted motifs
      for (const m of motifs) {
        if (m.panel !== pid) continue;
        const cvg = motifCov(m.kind, u0, v0, m.u, m.v, m.size, aa, m.rot ?? 0);
        if (cvg > 0) {
          const dry = 0.78 + 0.22 * nz(t, u0 * 55, v0 * 9, 4.4);
          c = mixc(c, mulcc(m.rgbc, [0.8 + 1.2 * c[0], 0.8 + 1.2 * c[1], 0.8 + 1.2 * c[2]]), cvg * clamp01(dry) * 0.97);
        }
      }
      // soot toward the ridge, mud at the hem
      if (o.top !== undefined && o.soot) {
        const k = smoothstep(o.top - 1.2, o.top, v0) * o.soot * (0.55 + 0.6 * (0.5 + 0.5 * nz(t, u0 * 6, v0 * 0.8, 1.9)));
        c = mulc(c, 1 - 0.7 * clamp01(k));
      }
      c = groundDirt(c, t, 0.45, o.dirt ?? 0.5, rgb('#44331f'));
      c = edgeWear(c, t, mulc(pal[2]!, 1.2), 0.25);
      return c;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// leather, iron, painted cloth

export function leather(name: string, o: { color?: string; light?: string; glow?: boolean } = {}): Mat {
  const dark = rgb(o.color ?? '#2f2218'), light = rgb(o.light ?? '#5b4330');
  return {
    name,
    shade(t) {
      const f = 0.5 + 0.5 * fbm2(t, t.p[0] * 6, t.p[1] * 6, t.p[2] * 6, 3);
      let c = mixc(dark, light, f * 0.8);
      c = mulc(c, 0.85 + 0.3 * (0.5 + 0.5 * nz(t, t.p[0] * 40, t.p[1] * 40, t.p[2] * 40)));
      c = edgeWear(c, t, mulc(light, 1.4), 0.35);
      return mulc(c, 0.8 + 0.2 * t.ao);
    },
  };
}

export interface ClothOpts {
  color: string;
  dark?: string;
  /** painted sigil centre in uv metres (u across from the left edge, v down) */
  sigil?: { kind: MotifKind; u: number; v: number; size: number; color?: string };
  /** stripe borders [v0, v1, colour][] along the length */
  borders?: [number, number, string][];
  /** darken toward the bottom / torn edge (uv.v in metres) */
  soot?: number;
  /** uv scale: metres per uv unit (default 1) */
  scale?: number;
}

/** woven painted cloth (uv in metres: u across, v down) */
export function cloth(name: string, o: ClothOpts): Mat {
  const base = rgb(o.color), dark = rgb(o.dark ?? '#4a1510');
  const sc = o.scale ?? 1;
  return {
    name,
    shade(t) {
      const u = t.uv[0] * sc, v = t.uv[1] * sc;
      const aa = AA(t);
      // weave
      const w = 0.5 + 0.5 * Math.sin(u * 340) * Math.sin(v * 300);
      let c = mixc(mulc(base, 0.92), mulc(base, 1.08), w * 0.5);
      c = mulc(c, 0.8 + 0.4 * (0.5 + 0.5 * fbm2(t, u * 2.4, v * 1.4, 1.9, 3)));
      // dye bleed: darker streaks running down the cloth
      c = mixc(c, dark, 0.45 * smoothstep(0.45, 0.85, 0.5 + 0.5 * nz(t, u * 9, v * 0.9, 4.6)));
      for (const [v0, v1, col] of o.borders ?? []) {
        const k = smoothstep(v0 - 0.004, v0 + 0.004, v) * (1 - smoothstep(v1 - 0.004, v1 + 0.004, v));
        c = mixc(c, mulc(rgb(col), 0.8 + 0.4 * w), k * 0.95);
      }
      if (o.sigil) {
        const s = o.sigil;
        const cvg = motifCov(s.kind, u, -v, s.u, -s.v, s.size, aa);
        if (cvg > 0) c = mixc(c, mulc(rgb(s.color ?? '#14100e'), 0.8 + 0.4 * w), cvg * (0.82 + 0.18 * nz(t, u * 50, v * 10, 8.1)) * 0.97);
      }
      if (o.soot) c = mulc(c, 1 - o.soot * 0.5 * smoothstep(0.4, 3.0, v) * (0.6 + 0.5 * fbm01(t, 6, 2, 3)));
      c = edgeWear(c, t, mulc(base, 1.3), 0.15);
      return c;
    },
  };
}

/** blackened hand-forged iron: bluish dark metal, hammer facets, rust blooms, bright worn edges */
export function blackIron(name: string, o: { rust?: number; tone?: string } = {}): Mat {
  const base = rgb(o.tone ?? '#34343a'), rust = rgb('#8a4220'), bright = rgb('#8e8d92');
  const T = pickTex('tex_iron_dark');
  return {
    name,
    shade(t) {
      const v = t.noise.voronoi(t.p[0] * 24, t.p[1] * 24, t.p[2] * 24, 0.9);
      let c = mulc(base, 0.78 + 0.45 * v.id);
      if (T) c = mixc(c, mulc(triTex(t, T, 0.5), 1.6), 0.45);
      c = mulc(c, 1 - 0.4 * (1 - smoothstep(0.0, 0.1, v.f2 - v.f1)));
      const r = smoothstep(0.5, 0.82, fbm01(t, 6, 4, 3.3) + (1 - t.ao) * 0.3) * (o.rust ?? 0.5);
      c = mixc(c, mulc(rust, 0.8 + 0.5 * fbm01(t, 30, 2, 1.4)), r);
      c = mixc(c, bright, clamp01(t.edge * 0.9));
      return mulc(c, 0.8 + 0.2 * t.ao);
    },
  };
}

/** flat-painted dark material (interiors, soot, shadow lining) with slight mottling */
export function darkLining(name: string, o: { color?: string } = {}): Mat {
  const base = rgb(o.color ?? '#1b130d');
  return {
    name,
    ao: 0.3,
    shade(t) {
      const c = mulc(base, 0.7 + 0.6 * fbm01(t, 5, 3, 0.8));
      // faint firelit warmth near the floor
      return mixc(c, rgb('#4a2412'), 0.55 * (1 - smoothstep(0.0, 1.1, t.p[1])));
    },
  };
}

export { cov, MOTIFS, hash3, sdSeg, fract, pickTex };
