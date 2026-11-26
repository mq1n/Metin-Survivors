// Painterly pass for the HUD minimap (pure pixels, no DOM): turns the ZoneMap raster (crisp vector-ish ground, tree dots, roofs)

// crowns, roofs keep their shape but lose pixel noise), world-space mottling for the ground, a faint contour darkening along
// edges, dapple on the dark crowns, and a warm, slightly desaturated grade. Deterministic (hash noise, no clock).
//
//   const out = paintMinimap(rgba, w, h);          // Uint8ClampedArray (opaque) the same size as the input
//
// Runs in minimapPaint.worker.ts (~0.3 s at 1024 px) with a main-thread fallback (minimapPaintLoader.ts).

export interface PaintOptions {
  /** Kuwahara quadrant radius in px (1..5); default 3 */
  radius?: number;
  /** mottling strength multiplier (default 1) */
  mottle?: number;
  /** contour darkening strength (default 1) */
  contour?: number;
}

// ------------------------------------------------------------------------------------------------------------ noise

function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** smooth value noise in -1..1 */
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

function fbm2(x: number, y: number, s: number): number {
  return vnoise(x, y, s) * 0.55 + vnoise(x * 2.03, y * 2.03, s + 7) * 0.3 + vnoise(x * 4.1, y * 4.1, s + 13) * 0.15;
}

// ----------------------------------------------------------------------------------------------------------- kuwahara

/** Kuwahara filter by integral images: each pixel takes the mean of the quadrant (of its four) with the least luma variance. */
function kuwahara(src: Uint8ClampedArray, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const sr = new Float64Array(W * (h + 1));
  const sg = new Float64Array(W * (h + 1));
  const sb = new Float64Array(W * (h + 1));
  const sl = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let ar = 0;
    let ag = 0;
    let ab = 0;
    let al = 0;
    let aq = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const R = src[i] as number;
      const G = src[i + 1] as number;
      const B = src[i + 2] as number;
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      ar += R;
      ag += G;
      ab += B;
      al += L;
      aq += L * L;
      const o = (y + 1) * W + x + 1;
      const up = y * W + x + 1;
      sr[o] = (sr[up] as number) + ar;
      sg[o] = (sg[up] as number) + ag;
      sb[o] = (sb[up] as number) + ab;
      sl[o] = (sl[up] as number) + al;
      sq[o] = (sq[up] as number) + aq;
    }
  }
  const out = new Float32Array(w * h * 3);
  const box = (a: Float64Array, x0: number, y0: number, x1: number, y1: number): number => (a[y1 * W + x1] as number) - (a[y0 * W + x1] as number) - (a[y1 * W + x0] as number) + (a[y0 * W + x0] as number);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      let br = 0;
      let bg = 0;
      let bb = 0;
      for (let q = 0; q < 4; q++) {
        // quadrants: 0 up-left, 1 up-right, 2 down-left, 3 down-right (each (r+1) x (r+1), sharing the centre pixel)
        const xa = q & 1 ? x : x - r;
        const xb = q & 1 ? x + r + 1 : x + 1;
        const ya = q & 2 ? y : y - r;
        const yb = q & 2 ? y + r + 1 : y + 1;
        const x0 = xa < 0 ? 0 : xa;
        const y0 = ya < 0 ? 0 : ya;
        const x1 = xb > w ? w : xb;
        const y1 = yb > h ? h : yb;
        const n = (x1 - x0) * (y1 - y0);
        if (n <= 0) continue;
        const ml = box(sl, x0, y0, x1, y1) / n;
        const v = box(sq, x0, y0, x1, y1) / n - ml * ml;
        if (v < best) {
          best = v;
          br = box(sr, x0, y0, x1, y1) / n;
          bg = box(sg, x0, y0, x1, y1) / n;
          bb = box(sb, x0, y0, x1, y1) / n;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = br;
      out[o + 1] = bg;
      out[o + 2] = bb;
    }
  }
  return out;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------------------------------------------------ paint

export function paintMinimap(rgba: Uint8ClampedArray, w: number, h: number, opts: PaintOptions = {}): Uint8ClampedArray {
  const radius = Math.max(1, Math.min(5, Math.round(opts.radius ?? 3)));
  const mottle = opts.mottle ?? 1;
  const contourK = opts.contour ?? 1;
  const base = kuwahara(rgba, w, h, radius);
  const n = w * h;

  // luma of the brushed image, for the contour pass
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * (base[i * 3] as number) + 0.587 * (base[i * 3 + 1] as number) + 0.114 * (base[i * 3 + 2] as number);

  const out = new Uint8ClampedArray(n * 4);
  // noise lattice scale: constants are in "px at 1024"; scale them so a 512 or 1536 raster paints the same map
  const sc = 1024 / w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let r = base[p * 3] as number;
      let g = base[p * 3 + 1] as number;
      let b = base[p * 3 + 2] as number;
      const L = lum[p] as number;

      // contour: gradient of the brushed luma (Sobel-lite over 2 px) darkens the border between two patches a little
      let gm = 0;
      if (x > 1 && y > 1 && x < w - 2 && y < h - 2) {
        const gx = (lum[p + 2] as number) - (lum[p - 2] as number);
        const gy = (lum[p + 2 * w] as number) - (lum[p - 2 * w] as number);
        gm = Math.hypot(gx, gy);
      }
      const edge = smooth(10, 46, gm) * 0.17 * contourK;

      // ground mottling in world space: broad cloud patches + mid blotches + paint grain, strongest on mid-tone ground
      const fx = x * sc;
      const fy = y * sc;
      const cloud = fbm2(fx / 70, fy / 70, 3);
      const blot = fbm2(fx / 13, fy / 13, 5);
      const grain = vnoise(fx / 2.2, fy / 2.2, 9);
      const mid = smooth(22, 70, L) * (1 - smooth(190, 235, L));
      const m = (cloud * 0.075 + blot * 0.095 + grain * 0.075) * mid * mottle;
      const hue = fbm2(fx / 46, fy / 46, 21) * mid * mottle;
      let k = 1 + m - edge;
      r = r * k + hue * 7;
      g = g * k + hue * 2;
      b = b * k - hue * 6;

      // dapple on the dark crowns (light through the leaves): sparse bright specks where the brush left dark green
      if (L < 78 && g > r * 0.9) {
        const s = hash2(x, y, 31);
        if (s > 0.9) {
          const lift = (s - 0.9) * 10 * 22 * (1 - L / 90);
          r += lift * 0.7;
          g += lift;
          b += lift * 0.45;
        }
      }

      
      const l2 = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = 0.96;
      r = l2 + (r - l2) * sat;
      g = l2 + (g - l2) * sat;
      b = l2 + (b - l2) * sat;
      r = (r - 128) * 1.13 + 128 - 3;
      g = (g - 128) * 1.13 + 128 - 3;
      b = (b - 128) * 1.13 + 128 - 5;
      const o = p * 4;
      out[o] = clamp255(r * 1.025);
      out[o + 1] = clamp255(g);
      out[o + 2] = clamp255(b * 0.955);
      out[o + 3] = 255;
    }
  }
  return out;
}
