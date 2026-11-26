// Brush-painted hanja-style glyphs for signboards, lanterns and plaques. Each glyph is a list of strokes; a stroke is a polyline in a
// 10 x 10 grid (x right, y DOWN, like the page). Strokes taper from a heavy brush start to a lighter tail and are anti-aliased with
// the texel footprint, so a 12 cm glyph stays legible at ~3 mm per texel.
import { clamp01, cov } from './sdf.ts';

type Pt = [number, number];
export interface Glyph {
  strokes: { pts: Pt[]; len: number }[];
}

const def = (...strokes: Pt[][]): Glyph => ({
  strokes: strokes.map((pts) => {
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
    return { pts, len: len || 1 };
  }),
});

export const GLYPHS = {
  mountain: def([[5, 1], [5, 8.2]], [[2, 4], [2, 8.2]], [[8, 4], [8, 8.2]], [[0.8, 8.2], [9.2, 8.2]]),
  river: def([[2.2, 1.5], [1.8, 8.8]], [[5, 1], [5, 9]], [[7.8, 1.5], [8.2, 8.8]]),
  three: def([[2, 2], [8, 2]], [[3, 5], [7, 5]], [[1, 8.2], [9, 8.2]]),
  king: def([[2, 2], [8, 2]], [[3, 5], [7, 5]], [[1, 8.2], [9, 8.2]], [[5, 2], [5, 8.2]]),
  ten: def([[1, 5], [9, 5]], [[5, 1], [5, 9]]),
  big: def([[1, 3.6], [9, 3.6]], [[5.2, 1], [4.6, 3.6], [1.8, 9]], [[4.8, 4.8], [6.5, 6.8], [8.8, 9]]),
  person: def([[5.2, 1.2], [4.4, 5], [1.8, 9]], [[4.6, 4.6], [6.5, 6.8], [8.8, 9]]),
  tree: def([[1, 4], [9, 4]], [[5, 1], [5, 9.2]], [[4.8, 4.4], [3.4, 6.8], [1.4, 8.6]], [[5.2, 4.4], [6.6, 6.8], [8.6, 8.6]]),
  water: def([[5, 1.2], [5, 8], [4, 9.2]], [[1.2, 5.2], [3.8, 4.4]], [[4.4, 2.6], [3.2, 6], [1.2, 8.6]], [[5.6, 3.6], [7, 6.2], [8.8, 8.4]], [[7, 2], [8.2, 3]]),
  mouth: def([[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]),
  sun: def([[2.5, 1.2], [7.5, 1.2], [7.5, 8.8], [2.5, 8.8], [2.5, 1.2]], [[2.5, 5], [7.5, 5]]),
  field: def([[1.5, 1.5], [8.5, 1.5], [8.5, 8.5], [1.5, 8.5], [1.5, 1.5]], [[5, 1.5], [5, 8.5]], [[1.5, 5], [8.5, 5]]),
  middle: def([[1.5, 3], [8.5, 3], [8.5, 7], [1.5, 7], [1.5, 3]], [[5, 0.8], [5, 9.2]]),
  luck: def([[3, 1.5], [7, 1.5]], [[5, 0.6], [5, 4.6]], [[1.5, 3.6], [8.5, 3.6]], [[2.5, 5.6], [7.5, 5.6], [7.5, 9], [2.5, 9], [2.5, 5.6]]),
  village: def([[0.5, 4], [4.5, 4]], [[2.5, 1], [2.5, 9.2]], [[2.4, 4.4], [1.4, 6.8], [0.4, 8.4]], [[2.6, 4.4], [3.4, 6.8], [4.5, 8.4]], [[5.5, 3.8], [9.5, 3.8]], [[7.6, 1.8], [7.6, 9], [6.8, 9.4]], [[8.6, 5.8], [9, 6.6]]),
  mile: def([[2, 1], [8, 1], [8, 5.2], [2, 5.2], [2, 1]], [[5, 1], [5, 5.2]], [[2, 3.1], [8, 3.1]], [[5, 5.2], [5, 9]], [[3, 7], [7, 7]], [[1.5, 9], [8.5, 9]]),
} satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;

/**
 * Coverage of a glyph centred at the origin: (x, y) in metres with y UP, `size` the glyph box edge (m), `wt` the brush half width as a
 * fraction of the box (0.055 reads as a bold brush), `aa` the anti-aliasing half width (m). A deterministic dry-brush fade
 * (`dry` 0..1, noise supplied by the caller) thins the strokes toward their tails.
 */
export function glyphCov(g: Glyph, x: number, y: number, size: number, wt: number, aa: number, dry = 0): number {
  if (Math.abs(x) > size * 0.62 || Math.abs(y) > size * 0.62) return 0;
  const gx = (x / size + 0.5) * 10, gy = (0.5 - y / size) * 10;
  const k = size / 10;
  let best = 1e9;
  for (const s of g.strokes) {
    let acc = 0;
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const [ax, ay] = s.pts[i]!, [bx, by] = s.pts[i + 1]!;
      const dx = bx - ax, dy = by - ay;
      const l = Math.hypot(dx, dy) || 1e-6;
      const h = clamp01(((gx - ax) * dx + (gy - ay) * dy) / (l * l));
      const d = Math.hypot(gx - ax - dx * h, gy - ay - dy * h);
      const t = (acc + h * l) / s.len;
      const hw = (wt * 10) * (1.12 - 0.5 * t - dry * 0.35 * t * t);
      best = Math.min(best, (d - hw) * k);
      acc += l;
    }
  }
  return cov(best, aa);
}
