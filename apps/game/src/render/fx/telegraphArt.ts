// Telegraph art helpers (owner: the telegraphs builder). Everything here is CPU-side, deterministic and allocation-light:
//  - makeGlyphAtlas: our OWN invented calligraphic rune set (64 glyphs, 6 stroke families, tapered brush strokes) baked into an R8

//    procedural bezier brush marks with a fixed design language (stem + hook + flick + bowl + dot ...).
//  - makeGrainData: one RGBA grain texture (fbm / fine grain / Voronoi crack seams / large mottling), tileable.
//  - tint tables: element + owner colours of the warning, and the metin rune lookup (the vfx route fills it from the def's rune).
import { Color } from 'three';

// ---------------------------------------------------------------------------------------------------------------------
// Glyph atlas

/** glyphs per atlas row / column (GLYPH_GRID² glyphs) */
export const GLYPH_GRID = 8;
/** texels per glyph cell side */
export const GLYPH_CELL = 64;
export const GLYPH_COUNT = GLYPH_GRID * GLYPH_GRID;
export const GLYPH_ATLAS_SIZE = GLYPH_GRID * GLYPH_CELL;

type Pt = readonly [number, number];
interface Stroke {
  /** polyline in the unit cell (y up), 14 samples */
  pts: Pt[];
  /** half width at the start / middle / end (brush taper) */
  w0: number;
  w1: number;
  w2: number;
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** quadratic bezier sampled to `n` points */
function bez(a: Pt, c: Pt, b: Pt, n = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

function line(a: Pt, b: Pt, n = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function ringPts(cx: number, cy: number, r: number, n = 18): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** the strokes of glyph `id`: a family (id % 6) fixes the composition, the id fixes every number */
export function glyphStrokes(id: number): Stroke[] {
  const R = rng(id * 7919 + 13);
  const j = (a: number): number => (R() - 0.5) * 2 * a;
  const fam = id % 6;
  const S: Stroke[] = [];
  const bw = 0.045 + R() * 0.012;
  const brush = (pts: Pt[], k = 1): Stroke => ({ pts, w0: bw * 0.55 * k, w1: bw * k, w2: bw * 0.4 * k });
  const lean = j(0.08);
  if (fam === 0) {
    // stem with a hooked head, a flick and a dot
    const x = 0.5 + j(0.06);
    S.push(brush(bez([x + lean, 0.9], [x + j(0.1), 0.5], [x - lean, 0.1])));
    S.push(brush(bez([x + lean, 0.9], [x + 0.28, 0.92], [x + 0.3, 0.68])));
    S.push(brush(line([x - 0.26, 0.42 + j(0.05)], [x + 0.06, 0.34 + j(0.05)]), 0.85));
    S.push({ pts: ringPts(0.74 + j(0.05), 0.2 + j(0.04), 0.035, 8), w0: 0.03, w1: 0.03, w2: 0.03 });
  } else if (fam === 1) {
    // a bowl over two bars
    const y = 0.55 + j(0.06);
    S.push(brush(bez([0.2, y], [0.5, y - 0.52 + j(0.05)], [0.8, y])));
    S.push(brush(line([0.14 + j(0.03), 0.78], [0.86 + j(0.03), 0.82]), 0.9));
    S.push(brush(line([0.3, 0.14 + j(0.03)], [0.7, 0.12 + j(0.03)]), 0.8));
    S.push(brush(line([0.5, 0.82], [0.5 + j(0.05), 0.5]), 0.7));
  } else if (fam === 2) {
    // twin opposed arcs and a spine
    S.push(brush(bez([0.24, 0.9], [0.06 + j(0.05), 0.55], [0.3, 0.12])));
    S.push(brush(bez([0.76, 0.88], [0.94 + j(0.05), 0.46], [0.7, 0.1])));
    S.push(brush(line([0.5, 0.94], [0.5 + j(0.04), 0.06]), 0.7));
    S.push(brush(line([0.3, 0.5], [0.7, 0.52 + j(0.05)]), 0.7));
  } else if (fam === 3) {
    // zigzag of three bold segments with a closing hook
    const a: Pt = [0.2 + j(0.04), 0.88];
    const b: Pt = [0.74 + j(0.05), 0.64];
    const c: Pt = [0.26 + j(0.05), 0.4];
    const d: Pt = [0.78 + j(0.04), 0.14];
    S.push(brush(line(a, b)));
    S.push(brush(line(b, c)));
    S.push(brush(line(c, d)));
    S.push(brush(bez(d, [0.9, 0.3], [0.62, 0.34]), 0.8));
  } else if (fam === 4) {
    // crossed strokes with a flick and an eye
    S.push(brush(bez([0.18, 0.9], [0.5 + j(0.08), 0.5], [0.82, 0.1])));
    S.push(brush(bez([0.82, 0.9], [0.5 + j(0.08), 0.5], [0.2, 0.1])));
    S.push(brush(line([0.14, 0.5 + j(0.05)], [0.86, 0.5 + j(0.05)]), 0.7));
    S.push({ pts: ringPts(0.5, 0.82, 0.055, 10), w0: 0.028, w1: 0.028, w2: 0.028 });
  } else {
    // spiral hook (one long curl) and a tail
    const cx = 0.5 + j(0.05);
    S.push(brush(bez([cx - 0.3, 0.2], [cx - 0.36, 0.95], [cx + 0.18, 0.84])));
    S.push(brush(bez([cx + 0.18, 0.84], [cx + 0.46, 0.7], [cx + 0.1, 0.46])));
    S.push(brush(bez([cx + 0.1, 0.46], [cx - 0.1, 0.4], [cx - 0.02, 0.62]), 0.8));
    S.push(brush(line([cx + 0.2, 0.2], [cx + 0.34 + j(0.04), 0.06]), 0.85));
  }
  return S;
}

/** the 64 glyphs (8 x 8 cells of 64 px) as R8 coverage, y down in memory (row 0 = top of the atlas); deterministic */
export function makeGlyphAtlas(): Uint8Array {
  const N = GLYPH_ATLAS_SIZE;
  const out = new Uint8Array(N * N);
  for (let g = 0; g < GLYPH_COUNT; g++) {
    const strokes = glyphStrokes(g);
    const gx = g % GLYPH_GRID;
    const gy = Math.floor(g / GLYPH_GRID);
    for (let py = 0; py < GLYPH_CELL; py++) {
      const v = 1 - (py + 0.5) / GLYPH_CELL;
      for (let px = 0; px < GLYPH_CELL; px++) {
        const u = (px + 0.5) / GLYPH_CELL;
        let best = 1e9;
        for (const s of strokes) {
          const pts = s.pts;
          const n = pts.length - 1;
          for (let k = 0; k < n; k++) {
            const a = pts[k] as Pt;
            const b = pts[k + 1] as Pt;
            const ex = b[0] - a[0];
            const ey = b[1] - a[1];
            const l2 = ex * ex + ey * ey;
            let t = l2 > 1e-9 ? ((u - a[0]) * ex + (v - a[1]) * ey) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = u - (a[0] + ex * t);
            const dy = v - (a[1] + ey * t);
            const tt = (k + t) / n;
            // brush profile: thin start, full belly, tapered end
            const w = tt < 0.5 ? s.w0 + (s.w1 - s.w0) * (tt * 2) : s.w1 + (s.w2 - s.w1) * ((tt - 0.5) * 2);
            const d = Math.sqrt(dx * dx + dy * dy) - w;
            if (d < best) best = d;
          }
        }
        // soft edge ~1.4 px wide, a faint glow skirt so the shader can bloom it
        const edge = 1.3 / GLYPH_CELL;
        const core = 1 - smooth(-edge, edge, best);
        const skirt = Math.exp(-Math.max(best, 0) / 0.035) * 0.22;
        const val = Math.min(1, core + skirt * (1 - core));
        out[(gy * GLYPH_CELL + py) * N + gx * GLYPH_CELL + px] = Math.round(val * 255);
      }
    }
  }
  return out;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------------------------------
// Grain texture (RGBA8, tileable)

export const GRAIN_SIZE = 256;

/** tileable fractal value noise 0..1 */
function fbm(size: number, cells: number, octaves: number, seed: number): Float32Array {
  const acc = new Float32Array(size * size);
  const R = rng(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = R();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * c;
      const iy = Math.floor(gy);
      const fy = gy - iy;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (iy % c) * c;
      const r1 = ((iy + 1) % c) * c;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * c;
        const ix = Math.floor(gx);
        const fx = gx - ix;
        const sx = fx * fx * (3 - 2 * fx);
        const x0 = ix % c;
        const x1 = (ix + 1) % c;
        const a = (lat[r0 + x0] as number) + ((lat[r0 + x1] as number) - (lat[r0 + x0] as number)) * sx;
        const b = (lat[r1 + x0] as number) + ((lat[r1 + x1] as number) - (lat[r1 + x0] as number)) * sx;
        acc[y * size + x] = (acc[y * size + x] as number) + amp * (a + (b - a) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < acc.length; i++) acc[i] = (acc[i] as number) / total;
  return acc;
}

/** tileable Worley seams: 0 on the cell borders, rising to 1 within `width` (in cells) of them */
function seams(size: number, cells: number, seed: number, width: number): Float32Array {
  const R = rng(seed);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < px.length; i++) {
    px[i] = R();
    py[i] = R();
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const cy = Math.floor(fy);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const cx = Math.floor(fx);
      let d1 = 9;
      let d2 = 9;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const wx = (((cx + i) % cells) + cells) % cells;
          const wy = (((cy + j) % cells) + cells) % cells;
          const sx = cx + i + (px[wy * cells + wx] as number);
          const sy = cy + j + (py[wy * cells + wx] as number);
          const dd = Math.hypot(fx - sx, fy - sy);
          if (dd < d1) {
            d2 = d1;
            d1 = dd;
          } else if (dd < d2) d2 = dd;
        }
      }
      out[y * size + x] = Math.min(1, (d2 - d1) / width);
    }
  }
  return out;
}








export function makeGrainData(): Uint8Array {
  const N = GRAIN_SIZE;
  const r = fbm(N, 6, 4, 11);
  const g = fbm(N, 72, 2, 29);
  const b = seams(N, 9, 5, 0.16);
  const a = fbm(N, 3, 3, 71);
  const out = new Uint8Array(N * N * 4);
  const stretch = (v: number): number => Math.min(1, Math.max(0, (v - 0.5) * 1.8 + 0.5));
  for (let i = 0; i < N * N; i++) {
    out[i * 4] = Math.round(stretch(r[i] as number) * 255);
    out[i * 4 + 1] = Math.round(stretch(g[i] as number) * 255);
    out[i * 4 + 2] = Math.round((b[i] as number) * 255);
    out[i * 4 + 3] = Math.round(stretch(a[i] as number) * 255);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tints

/** ElementIdx order: physical, fire, ice, lightning, dark, poison, holy, wind */
export const ELEMENT_HEX: readonly number[] = [0xff5a14, 0xff8a1a, 0x46c8ff, 0x8ea6ff, 0xa24dff, 0x5fe040, 0xffd24e, 0x3de6c4];
/** boss warnings run darker and more saturated than the trash ones (same hue family) */
const BOSS_HEX: readonly number[] = [0xf03616, 0xff6a0c, 0x2aa8ff, 0x7088ff, 0x9030f0, 0x44cc2c, 0xffb830, 0x20d4b0];

export const METIN_FALLBACK_HEX = 0xff7a2a;

const tmpC = new Color();
const tintCache = new Map<number, Float32Array>();

/** linear rgb of a hex colour (cached by hex) */
export function linearRgb(hex: number): Float32Array {
  let v = tintCache.get(hex);
  if (v === undefined) {
    tmpC.setHex(hex);
    v = new Float32Array([tmpC.r, tmpC.g, tmpC.b]);
    tintCache.set(hex, v);
  }
  return v;
}

const metinTints = new Map<number, number>();

/** remember the rune colour of metin `id` (the vfx route calls this on every `metinWarn` event) */
export function setMetinWarnTint(id: number, hex: number): void {
  if (metinTints.size > 48) metinTints.clear();
  metinTints.set(id, hex);
}

export function getMetinWarnTint(id: number): number | undefined {
  return metinTints.get(id);
}

/** warning colour (hex) of an owner / element / metin id */
export function warnHex(owner: number, element: number, aux: number): number {
  if (owner === 2) return metinTints.get(aux) ?? METIN_FALLBACK_HEX;
  const e = element >= 0 && element < ELEMENT_HEX.length ? element : 0;
  return owner === 1 ? (BOSS_HEX[e] as number) : (ELEMENT_HEX[e] as number);
}

export function clearTelegraphArtCaches(): void {
  tintCache.clear();
  metinTints.clear();
}
