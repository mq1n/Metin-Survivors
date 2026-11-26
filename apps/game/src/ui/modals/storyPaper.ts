// Pure drawing helpers of the story sheet (owner: B9 story): the paper painted from noise (no tile, so nothing repeats) and the
// dark-bronze filigree that grows out of the frame corner, built as filled, tapered strokes. No DOM: unit-tested in storyPaper.test.ts.
import { rng } from './storyArt';

// ---------------------------------------------------------------------------------------------------------------
// Paper

export type Rgb = readonly [number, number, number];

export interface PaperTone {
  /** base paper colour (a pale, desaturated tan) */
  rgb: Rgb;
  /** strength of the large mottling and the darker blotches (1 = normal) */
  stain: number;
}

export const PAPER_TONES = {
  plain: { rgb: [222, 203, 154], stain: 1 },
  warm: { rgb: [228, 204, 148], stain: 0.9 },
  ash: { rgb: [176, 165, 146], stain: 1.15 },
  blood: { rgb: [224, 198, 160], stain: 1 },
} as const satisfies Record<string, PaperTone>;

/** The metin page: the plain paper with a little of the rune colour mixed in. */
export function runePaper(hex: string | null | undefined): PaperTone {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return PAPER_TONES.plain;
  const n = parseInt(m[1] as string, 16);
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * 0.13);
  const p = PAPER_TONES.plain.rgb;
  return { rgb: [mix(p[0], (n >> 16) & 255), mix(p[1], (n >> 8) & 255), mix(p[2], n & 255)], stain: 1 };
}

function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}

/** Smooth value noise in [-1, 1]. */
export function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = lattice(x0, y0, seed);
  const b = lattice(x0 + 1, y0, seed);
  const c = lattice(x0, y0 + 1, seed);
  const d = lattice(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise, normalised to about [-1, 1]. */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x * f, y * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * RGBA pixels of one paper sheet: low-frequency mottling, a few darker blotches, fine diagonal fibres and grain. The same seed gives
 * the same sheet; nothing repeats across it. Feature sizes are in pixels of an 800-wide sheet and scale with `w`.
 */
export function paperPixels(w: number, h: number, seed: number, tone: PaperTone = PAPER_TONES.plain): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const rand = rng(seed ^ 0x5bd1e995);
  const k = 800 / Math.max(1, w);
  // fibres: short faint strokes at about 40 degrees, light and dark (accumulated as a luminance offset)
  const fib = new Float32Array(w * h);
  const nFib = Math.round((w * h) / 150);
  for (let i = 0; i < nFib; i++) {
    let x = rand() * w;
    let y = rand() * h;
    const ang = ((38 + (rand() - 0.5) * 50) * Math.PI) / 180;
    const len = (5 + rand() * 11) / k;
    const amp = (rand() < 0.5 ? -1 : 1) * (0.012 + rand() * 0.03);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let s = 0; s < len; s++) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix >= 0 && iy >= 0 && ix < w && iy < h) fib[iy * w + ix] = (fib[iy * w + ix] as number) + amp;
      x += dx;
      y += dy;
    }
  }
  const [br, bg, bb] = tone.rgb;
  const st = tone.stain;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x * k;
      const py = y * k;
      const mott = fbm(px / 170, py / 140, seed, 3);
      const fine = fbm(px / 34, py / 30, seed + 17, 2);
      const blot = smooth(0.12, 0.5, fbm(px / 105, py / 85, seed + 41, 4));
      const grain = (rand() - 0.5) * 0.05;
      const lum = 1 + mott * 0.05 * st + fine * 0.022 - blot * 0.075 * st + (fib[y * w + x] as number) + grain;
      const i = (y * w + x) * 4;
      // blotches go slightly browner (less blue) than the paper around them
      const brown = blot * 0.05 * st;
      out[i] = br * lum;
      out[i + 1] = bg * lum * (1 - brown * 0.35);
      out[i + 2] = bb * lum * (1 - brown * 1.1);
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Weave: the fine diagonal thread texture of the quest sheet, painted as one seamless overlay tile

/** Edge of the weave tile in pixels; the thread pitch is WEAVE_PITCH pixels across the diagonal (the tile is drawn at 2x, shown at half size). */
export const WEAVE_SIZE = 80;
export const WEAVE_PITCH = 8;

/**
 * RGBA pixels of a tileable plain-weave overlay: two thread families running at +-45 degrees, each thread a little cylinder
 * (bright in the middle, dark at the gaps), the top thread alternating at every crossing, every thread with its own tone.
 * Light pixels are warm white, dark ones tobacco brown, both semi-transparent, so laid over any tan paper they read as woven
 * stock. The thread index is taken modulo the tile, so the tile repeats without a seam in either direction.
 */
export function weavePixels(seed: number, size = WEAVE_SIZE, pitch = WEAVE_PITCH): Uint8ClampedArray {
  const n = Math.floor(size / pitch);
  const rand = rng(seed ^ 0x2c1b3c6d);
  const toneA: number[] = [];
  const toneB: number[] = [];
  for (let i = 0; i < n; i++) {
    toneA.push((rand() - 0.5) * 0.5);
    toneB.push((rand() - 0.5) * 0.5);
  }
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = (((x - y) % size) + size) % size;
      const b = (x + y) % size;
      const ia = Math.floor(a / pitch);
      const ib = Math.floor(b / pitch);
      const fa = (a % pitch) / pitch;
      const fb = (b % pitch) / pitch;
      const top = (ia + ib) % 2 === 0;
      // cylinder profile of the thread that is on top at this crossing; the other one only shows as a dark gap at its edges
      const f = top ? fa : fb;
      const prof = Math.cos((f - 0.5) * Math.PI); // 0 at the gaps, 1 in the middle
      const tone = top ? (toneA[ia] as number) : (toneB[ib] as number);
      const gap = top ? Math.abs(fb - 0.5) * 2 : Math.abs(fa - 0.5) * 2;
      const lum = (prof - 0.55) * 1.6 + tone - gap * gap * 0.35;
      const i = (y * size + x) * 4;
      if (lum >= 0) {
        out[i] = 255;
        out[i + 1] = 243;
        out[i + 2] = 208;
        out[i + 3] = Math.min(255, lum * 0.25 * 255);
      } else {
        out[i] = 88;
        out[i + 1] = 54;
        out[i + 2] = 14;
        out[i + 3] = Math.min(255, -lum * 0.26 * 255);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Flourish: filled, tapered strokes

export type Pt = [number, number];

/** Open uniform Catmull-Rom through the points (the ends are doubled), `per` samples per segment. */
export function smoothPath(pts: readonly Pt[], per = 6): Pt[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]] as Pt);
  const out: Pt[] = [];
  const at = (i: number): Pt => pts[Math.max(0, Math.min(pts.length - 1, i))] as Pt;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  const last = pts[pts.length - 1] as Pt;
  out.push([last[0], last[1]]);
  return out;
}

/** Points of a spiral about (cx, cy); angles in degrees on the screen (y down), so a rising angle runs clockwise. */
export function spiralPts(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, step = 18): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
    const r = r0 + (r1 - r0) * t;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Closed outline (SVG path data) of a centre line whose width follows `width(t)`, t = 0..1 along the line. */
export function taperedOutline(center: readonly Pt[], width: (t: number) => number): string {
  const n = center.length;
  if (n < 2) return '';
  const len: number[] = [0];
  for (let i = 1; i < n; i++) {
    const a = center[i - 1] as Pt;
    const b = center[i] as Pt;
    len.push((len[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = Math.max(1e-6, len[n - 1] as number);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)] as Pt;
    const b = center[Math.min(n - 1, i + 1)] as Pt;
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1;
    tx /= m;
    ty /= m;
    const hw = Math.max(0.15, width((len[i] as number) / total)) / 2;
    const c = center[i] as Pt;
    left.push([c[0] - ty * hw, c[1] + tx * hw]);
    right.push([c[0] + ty * hw, c[1] - tx * hw]);
  }
  const f = (p: Pt): string => `${Math.round(p[0] * 10) / 10} ${Math.round(p[1] * 10) / 10}`;
  return `M${left.map(f).join('L')}L${right.reverse().map(f).join('L')}Z`;
}

/** Size of the flourish's drawing box (the frame corner is its bottom right). */
export const SWIRL_W = 260;
export const SWIRL_H = 195;

/** thick start, thin end */
const grow =
  (w0: number, w1: number, p = 1) =>
  (t: number): number =>
    w1 + (w0 - w1) * Math.pow(1 - t, p);
/** thick start, thin end, a small bulb at the very end (the eye of a volute) */
const growBulb =
  (w0: number, w1: number, bulb: number, p = 1) =>
  (t: number): number =>
    grow(w0, w1, p)(t) + bulb * smooth(0.88, 0.99, t) * (1 - smooth(0.99, 1, t));
/** a leaf: thin start, swells at `at`, thin end */
const leaf =
  (wmax: number, at = 0.4) =>
  (t: number): number =>
    wmax * Math.sin(Math.PI * Math.pow(t, Math.log(0.5) / Math.log(at))) + 0.4;

let shapesCache: string[] | null = null;

/** The shapes of the flourish (SVG path data in the SWIRL_W x SWIRL_H box), main body first. */
export function swirlShapes(): string[] {
  if (shapesCache) return shapesCache;
  const sm = (pts: Pt[], per = 6): Pt[] => smoothPath(pts, per);
  const s: string[] = [];
  // 1. the climber: leaves the corner, rises along the right edge, thinning out
  s.push(taperedOutline(sm([[270, 196], [254, 178], [247, 152], [254, 126], [246, 100], [251, 74], [243, 50], [246, 26]], 7), grow(27, 1.4, 0.8)));
  // 2. the great volute: runs in along the bottom edge, climbs and winds into an eye
  s.push(taperedOutline(sm([[272, 190], [250, 188], [228, 184], ...spiralPts(208, 148, 40, 6, 90, 90 + 540, 20)], 5), growBulb(21, 3.6, 4.5, 0.75)));
  // 3. the low sweep: along the bottom edge to a smaller volute on the left
  s.push(taperedOutline(sm([[252, 195], [222, 193], [190, 192], [160, 190], ...spiralPts(138, 172, 17, 3.5, 90, 90 + 470, 20)], 5), growBulb(12, 2.6, 3.4, 0.9)));
  // 4. the blade: a leaf-shaped spike thrown up and to the left from the great volute
  s.push(taperedOutline(sm([[236, 118], [219, 100], [194, 90], [160, 90], [128, 100]], 7), leaf(13, 0.3)));
  // 5. a hook off the climber, curling in toward the page
  s.push(taperedOutline(sm([[251, 104], [237, 100], [226, 88], [226, 74], [236, 70], [242, 78], [236, 84]], 6), growBulb(10, 1.8, 3.2, 0.9)));
  // 6. a short sprig near the top of the climber
  s.push(taperedOutline(sm([[246, 56], [233, 49], [218, 50], [206, 58]], 6), grow(8, 1, 0.9)));
  // 7. a small leaf bud above the low volute
  s.push(taperedOutline(sm([[176, 188], [172, 172], [182, 158], [196, 156]], 6), leaf(8.5, 0.45)));
  shapesCache = s;
  return s;
}
