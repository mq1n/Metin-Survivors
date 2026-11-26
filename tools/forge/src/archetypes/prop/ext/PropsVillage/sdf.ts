// Signed-distance shapes for painted ornament on the village props (urn bands, lantern medallions, door lattices, felt borders).
// Every function returns a signed distance in the units of its arguments (negative = inside); callers pass metres and turn the
// distance into coverage with `cov(d, aa)`. The primitives shared with the orc props (cov, sdSeg, sdBox ...) are re-exported.
import { TAU, clamp01, cov, fract, hash3, sdBox, sdCircle, sdRoundBox, sdSeg } from '../PropsOrc/paint.ts';

export { TAU, clamp01, cov, fract, hash3, sdBox, sdCircle, sdRoundBox, sdSeg };

/** ring of radius r and half thickness w */
export const sdRing = (x: number, y: number, r: number, w: number): number => Math.abs(Math.hypot(x, y) - r) - w;

/** pointed lotus petal: base centred on the origin (width w), tip at (0, h) */
export function sdPetal(x: number, y: number, w: number, h: number): number {
  const hw = w / 2;
  const c = (hw * hw - h * h) / (2 * hw);
  const R = hw - c;
  return Math.max(Math.hypot(x - c, y) - R, Math.hypot(x + c, y) - R, -y);
}

/** vesica / leaf lying along +x from the origin, length l, width w */
export const sdLeaf = (x: number, y: number, l: number, w: number): number => sdPetal(y, x, w, l);

/** rounded arch (ruyi / bell-arch head): width w, straight sides up to y = h - w/2, semicircle top */
export function sdArch(x: number, y: number, w: number, h: number): number {
  const r = w / 2;
  if (y > h - r) return Math.hypot(x, y - (h - r)) - r;
  return Math.max(Math.abs(x) - r, -y);
}

/** scalloped flower: `lobes` petals, base radius r */
export function sdFlower(x: number, y: number, r: number, lobes: number, depth = 0.28, phase = 0): number {
  const a = Math.atan2(y, x);
  const rb = r * (1 - depth + depth * Math.abs(Math.cos((lobes * (a + phase)) / 2)) ** 0.75);
  return Math.hypot(x, y) - rb;
}

/** greek-key / meander running along x with period p and band half height h (distance to the key line) */
export function sdMeander(x: number, y: number, p: number, h: number): number {
  const u = (fract(x / p) - 0.5) * p;
  const q = h / 2;
  const seg = (ax: number, ay: number, bx: number, by: number): number => sdSeg(u, y, ax * q, ay * q, bx * q, by * q);
  return Math.min(seg(-1.9, -1.0, -1.9, 1.0), seg(-1.9, 1.0, 0.6, 1.0), seg(0.6, 1.0, 0.6, -0.4), seg(0.6, -0.4, -0.7, -0.4), seg(-0.7, -0.4, -0.7, 0.3), seg(1.9, -1.0, 1.9, 1.0));
}

/** distance to a zig-zag line along x (period p, amplitude a) */
export function sdZigzag(x: number, y: number, p: number, a: number): number {
  const u = fract(x / p);
  return Math.abs(y - ((u < 0.5 ? u * 2 : 2 - u * 2) * 2 - 1) * a);
}

/** diamond lattice cell metric: 0 at a cell centre, 1 on the diamond edge (cell size p) */
export function diamond(x: number, y: number, p: number): number {
  return Math.abs((fract(x / p) - 0.5) * 2) + Math.abs((fract(y / p) - 0.5) * 2);
}
