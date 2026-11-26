// Signed-distance motifs for crude tribal paint (sun, handprint, claws, tribal eye, zigzag, spiral, skull, fang rows ...).
// Every motif is a function (x, y) -> signed distance in motif units (negative = inside paint), centred at the origin and spanning
// roughly [-1, 1]. Callers scale by the motif size: d_metres = sd(x / size, y / size) * size, coverage = cov(d_metres, aa).
import { smoothstep } from '../../../../core/math.ts';

export const TAU = Math.PI * 2;
export type Sd = (x: number, y: number) => number;

export const cov = (d: number, aa: number): number => 1 - smoothstep(-aa, aa, d);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const fract = (x: number): number => x - Math.floor(x);
/** deterministic hash -> [0,1) of up to three integers */
export function hash3(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const sdSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h);
};
export const sdBox = (x: number, y: number, hx: number, hy: number): number => {
  const dx = Math.abs(x) - hx, dy = Math.abs(y) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};
export const sdRoundBox = (x: number, y: number, hx: number, hy: number, r: number): number => sdBox(x, y, hx - r, hy - r) - r;
export const sdCircle = (x: number, y: number, r: number): number => Math.hypot(x, y) - r;
/** equilateral-ish triangle pointing +y: base half-width w at y = -h, tip at y = +h */
export function sdTri(x: number, y: number, w: number, h: number): number {
  // distance to the three edges (exact enough for painting)
  const ax = -w, ay = -h, bx = w, by = -h, cx = 0, cy = h;
  const e = (x0: number, y0: number, x1: number, y1: number): number => {
    const ex = x1 - x0, ey = y1 - y0, l = Math.hypot(ex, ey) || 1;
    return ((x - x0) * ey - (y - y0) * ex) / l;
  };
  return Math.max(e(ax, ay, bx, by), e(bx, by, cx, cy), e(cx, cy, ax, ay));
}

// ---- motifs ---------------------------------------------------------------------------------------------------------------------

/** sun disc with ring and 12 alternating rays */
export const sdSun: Sd = (x, y) => {
  const r = Math.hypot(x, y);
  const d0 = Math.min(Math.abs(r - 0.34) - 0.065, r - 0.15);
  const k = Math.round(Math.atan2(y, x) / (TAU / 12));
  const a = k * (TAU / 12);
  const c = Math.cos(a), s = Math.sin(a);
  const len = (k & 1) === 0 ? 0.96 : 0.74;
  return Math.min(d0, sdSeg(x, y, c * 0.5, s * 0.5, c * len, s * len) - 0.055);
};

/** open hand print: palm, four fingers, thumb */
export const sdHand: Sd = (x, y) => {
  let d = sdRoundBox(x, y + 0.3, 0.3, 0.28, 0.1);
  d = Math.min(d, sdSeg(x, y, -0.24, -0.1, -0.31, 0.42) - 0.082);
  d = Math.min(d, sdSeg(x, y, -0.08, -0.05, -0.1, 0.66) - 0.084);
  d = Math.min(d, sdSeg(x, y, 0.1, -0.05, 0.12, 0.7) - 0.084);
  d = Math.min(d, sdSeg(x, y, 0.26, -0.1, 0.33, 0.5) - 0.08);
  d = Math.min(d, sdSeg(x, y, 0.27, -0.42, 0.66, -0.06) - 0.095);
  return d;
};

/** zigzag band */
export const sdZig: Sd = (x, y) => {
  let d = 9;
  const n = 6, amp = 0.3;
  for (let i = 0; i < n; i++) {
    const x0 = -1 + (2 * i) / n, x1 = -1 + (2 * (i + 1)) / n;
    const y0 = i % 2 === 0 ? -amp : amp;
    d = Math.min(d, sdSeg(x, y, x0, y0, x1, -y0));
  }
  return d - 0.07;
};

/** three claw slashes */
export const sdClaw: Sd = (x, y) => {
  let d = 9;
  for (let i = -1; i <= 1; i++) {
    const ox = i * 0.36;
    d = Math.min(d, sdSeg(x, y, ox - 0.26, 0.92, ox - 0.06, 0.25) , sdSeg(x, y, ox - 0.06, 0.25, ox + 0.08, -0.4), sdSeg(x, y, ox + 0.08, -0.4, ox + 0.3, -0.92));
  }
  return d - 0.065;
};

/** tribal eye: lens outline with a pupil */
export const sdEye: Sd = (x, y) => {
  const lens = Math.max(Math.hypot(x, y - 0.4) - 0.7, Math.hypot(x, y + 0.4) - 0.7);
  return Math.min(Math.abs(lens) - 0.06, Math.hypot(x, y) - 0.17, sdSeg(x, y, -0.78, 0, -0.98, 0) - 0.05, sdSeg(x, y, 0.78, 0, 0.98, 0) - 0.05);
};

/** spiral, three turns */
export const sdSpiral: Sd = (x, y) => {
  const r = Math.hypot(x, y);
  const a = Math.atan2(y, x) + Math.PI;
  let d = 9;
  for (let k = 0; k < 3; k++) {
    const rr = 0.1 + 0.2 * (a / TAU + k);
    d = Math.min(d, Math.abs(r - rr));
  }
  return d - 0.045;
};

/** grinning skull glyph */
export const sdSkullGlyph: Sd = (x, y) => {
  let d = Math.min(Math.hypot(x, y - 0.2) - 0.62, sdBox(x, y + 0.5, 0.36, 0.26));
  const holes = Math.min(Math.hypot(x + 0.27, y - 0.14) - 0.19, Math.hypot(x - 0.27, y - 0.14) - 0.19, sdTri(x, y + 0.18, 0.1, 0.12));
  d = Math.max(d, -holes);
  if (y < -0.4 && y > -0.74) {
    const gx = Math.abs(fract((x + 0.36) / 0.144) - 0.5) * 0.144;
    d = Math.max(d, 0.02 - gx);
  }
  return d;
};

/** crossed bones (X) */
export const sdCrossBones: Sd = (x, y) => Math.min(sdSeg(x, y, -0.8, -0.8, 0.8, 0.8), sdSeg(x, y, -0.8, 0.8, 0.8, -0.8)) - 0.075;

/** chevrons stacked (war paint) */
export const sdChevron: Sd = (x, y) => {
  let d = 9;
  for (let i = 0; i < 3; i++) {
    const oy = 0.5 - i * 0.5;
    d = Math.min(d, sdSeg(x, y, -0.8, oy - 0.3, 0, oy + 0.1), sdSeg(x, y, 0, oy + 0.1, 0.8, oy - 0.3));
  }
  return d - 0.065;
};

/** row of fangs (triangles pointing down) across x in [-1, 1] */
export const sdFangs: Sd = (x, y) => {
  const n = 5;
  const cell = Math.floor(((x + 1) / 2) * n);
  const cx = -1 + (cell + 0.5) * (2 / n);
  if (cell < 0 || cell >= n) return 1;
  return sdTri(x - cx, -y, 0.17, 0.5);
};

export type MotifKind = 'sun' | 'hand' | 'zig' | 'claw' | 'eye' | 'spiral' | 'skull' | 'cross' | 'chevron' | 'fangs';
export const MOTIFS: Record<MotifKind, Sd> = {
  sun: sdSun, hand: sdHand, zig: sdZig, claw: sdClaw, eye: sdEye, spiral: sdSpiral, skull: sdSkullGlyph, cross: sdCrossBones, chevron: sdChevron, fangs: sdFangs,
};

/** rotate a point about the origin by `a` */
export const rot2 = (x: number, y: number, a: number): [number, number] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + y * s, -x * s + y * c];
};

/** coverage 0..1 of a motif of `size` metres centred at (cu, cv) rotated by `rot`; (u, v) in metres */
export function motifCov(kind: MotifKind, u: number, v: number, cu: number, cv: number, size: number, aa: number, rot = 0): number {
  let x = (u - cu) / size, y = (v - cv) / size;
  if (x * x + y * y > 1.8) return 0;
  if (rot !== 0) [x, y] = rot2(x, y, rot);
  return cov(MOTIFS[kind](x, y) * size, aa);
}
