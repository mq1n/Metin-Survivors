// Painted carving motifs in metre coordinates (u across, v up): rune panels, fret bands, scale bands, ruyi cloud heads.
// Each returns a Motif: lit = brightness factor from baked relief, ink = 0..1 groove/ink amount (darken), glow = 0..1 molten heat.
import { clamp01, smoothstep } from '../../../../core/math.ts';
import { runeSdf, sdBox, sdCircle, sdSeg } from './paint.ts';

export interface Motif {
  lit: number;
  ink: number;
  glow: number;
}
export const NO_MOTIF: Motif = { lit: 1, ink: 0, glow: 0 };

const fr = (x: number): number => x - Math.floor(x);

/** relief light factor from a 0..1 height field, light from the upper left (v up) */
export function reliefOf(h: (x: number, y: number) => number, x: number, y: number, e: number, k = 2.6): number {
  return Math.min(1.45, Math.max(0.55, 1 + k * (h(x + e, y - e) - h(x - e, y + e))));
}

/** framed recessed panel with one glowing rune inside */
export function runePanel(u: number, v: number, o: { cy: number; hw: number; hh: number; seed: number; stroke?: number; frame?: number; glow?: number }): Motif {
  const x = u, y = v - o.cy;
  const frame = o.frame ?? 0.045;
  if (Math.abs(x) > o.hw + 0.05 || Math.abs(y) > o.hh + 0.05) return NO_MOTIF;
  const h = (xx: number, yy: number): number =>
    smoothstep(0.012, -0.006, sdBox(xx, yy, o.hw, o.hh)) - 0.6 * smoothstep(0.012, -0.006, sdBox(xx, yy, o.hw - frame, o.hh - frame));
  const lit = reliefOf(h, x, y, 0.011);
  const inner = sdBox(x, y, o.hw - frame, o.hh - frame);
  const S = Math.min(o.hw, o.hh) * 1.5;
  const gd = runeSdf(x / S, y / S, o.seed) * S;
  const w = o.stroke ?? 0.028;
  const inside = inner < -0.01 ? 1 : 0;
  const core = inside * (1 - smoothstep(w * 0.55, w, gd));
  const groove = inside * (1 - smoothstep(w, w * 1.8, gd));
  // dark recessed field inside the frame, framed by a thin raised border
  const field = smoothstep(0.004, -0.012, inner) * 0.18;
  return { lit: lit * (1 - 0.25 * groove), ink: clamp01(groove * 0.75 + field), glow: core * (o.glow ?? 0.8) };
}

/** continuous Chinese key-fret (meander) band along u; one cell is `cell` m wide and tall, centred on cy */
export function fretBand(u: number, v: number, o: { cy: number; cell: number; line?: number; glow?: number }): Motif {
  const half = o.cell * 0.5;
  const y = v - o.cy;
  if (Math.abs(y) > half + 0.04) return NO_MOTIF;
  const cu = fr(u / o.cell) * o.cell, cv = y + half;
  const s = o.cell;
  // key: baseline + hook
  const segs: [number, number, number, number][] = [
    [0, 0.14, 1, 0.14],
    [0.78, 0.14, 0.78, 0.86],
    [0.78, 0.86, 0.22, 0.86],
    [0.22, 0.86, 0.22, 0.46],
    [0.22, 0.46, 0.55, 0.46],
  ];
  let d = 1e9;
  for (const [ax, ay, bx, by] of segs) d = Math.min(d, sdSeg(cu / s, cv / s, ax, ay, bx, by));
  d *= s;
  const w = o.line ?? s * 0.075;
  const h = (xx: number, yy: number): number => {
    const cx = fr(xx / s) * s, cy2 = yy - o.cy + half;
    let dd = 1e9;
    for (const [ax, ay, bx, by] of segs) dd = Math.min(dd, sdSeg(cx / s, cy2 / s, ax, ay, bx, by));
    return smoothstep(w * 1.3, w * 0.7, dd * s);
  };
  const line = 1 - smoothstep(w * 0.7, w * 1.3, d);
  const edge = smoothstep(half * 0.97, half * 0.8, Math.abs(y));
  return { lit: reliefOf(h, u, v, 0.008, 2.2), ink: line * 0.22, glow: (o.glow ?? 0) * line * edge };
}

/** overlapping fish-scale rows (dragon scales) with a hot core on some rows */
export function scaleBand(u: number, v: number, o: { cy: number; cell: number; rows: number; glow?: number }): Motif {
  const s = o.cell;
  const half = (o.rows * s * 0.5) * 0.5;
  const y = v - o.cy;
  if (Math.abs(y) > half + 0.03) return NO_MOTIF;
  // rows of discs; each row offset by half a cell, rows spaced s/2
  const rowH = s * 0.5;
  const ry = (y + half) / rowH;
  const row = Math.floor(ry);
  let best = 1e9, which = 0;
  for (let r = Math.max(0, row - 1); r <= row + 1; r++) {
    const off = r & 1 ? 0.5 : 0;
    const cx = (Math.floor(u / s - off) + 0.5 + off) * s;
    const cy = -half + r * rowH + s * 0.5 * 0.95;
    const dd = Math.hypot(u - cx, y - cy) - s * 0.5;
    if (dd < best) { best = dd; which = r; }
  }
  const rim = 1 - smoothstep(0, s * 0.07, Math.abs(best));
  const hot = (which % 3 === 0 ? 1 : 0) * (1 - smoothstep(0, s * 0.1, Math.abs(best + s * 0.14)));
  return { lit: 1 + 0.35 * rim * (y > 0 ? -1 : 1) * 0.5 - 0.1 * clamp01(best / (s * 0.5)), ink: rim * 0.45, glow: (o.glow ?? 0) * hot };
}

/** ruyi cloud head (trefoil of discs) on a plate: x along the plate, mirrored; returns signed distance to the outline (<0 inside) */
export interface Disc {
  x: number;
  y: number;
  r: number;
}
export const RUYI: Disc[] = [
  { x: 1.38, y: 0, r: 0.6 },
  { x: 1.9, y: 0, r: 0.5 },
  { x: 1.68, y: 0.64, r: 0.43 },
  { x: 1.68, y: -0.64, r: 0.43 },
];

export const sdRuyi = (x: number, y: number): number => {
  const ax = Math.abs(x);
  let d = 1e9;
  for (const c of RUYI) d = Math.min(d, sdCircle(ax - c.x, y - c.y, c.r));
  return d;
};

/** nested outline grooves, a raised rim and glowing jewels in the lobes of a ruyi head */
export function ruyiPlate(u: number, v: number, o: { glow?: number } = {}): Motif {
  const d = sdRuyi(u, v);
  const ax = Math.abs(u);
  if (ax < 0.85) {
    // waist: a fine double line
    return NO_MOTIF;
  }
  const g1 = 1 - smoothstep(0.012, 0.03, Math.abs(d + 0.085));
  const g2 = 1 - smoothstep(0.008, 0.022, Math.abs(d + 0.19));
  const rim = 1 - smoothstep(0.0, 0.03, Math.abs(d + 0.02));
  const jewel = Math.hypot(ax - RUYI[1]!.x, v - RUYI[1]!.y) - RUYI[1]!.r * 0.3;
  const j = 1 - smoothstep(-0.01, 0.03, jewel);
  const h = (xx: number, yy: number): number => smoothstep(0.02, -0.02, sdRuyi(xx, yy)) * 0.4 + smoothstep(0.012, 0.0, Math.abs(sdRuyi(xx, yy) + 0.085)) * -0.5;
  return { lit: reliefOf(h, u, v, 0.012, 2.0) * (1 - 0.1 * rim), ink: clamp01(g1 * 0.5 + g2 * 0.4), glow: (o.glow ?? 0.7) * j };
}

/** lotus petal rows around a revolve: angle phase p in 0..1 per petal, height fraction q 0..1; returns outline + vein */
export function lotusPetal(p: number, q: number, o: { tipY?: number } = {}): Motif {
  const x = (fr(p) - 0.5) * 2; // -1..1 across the petal
  const tip = o.tipY ?? 0.92;
  const edge = Math.abs(x) - (1 - 0.65 * Math.pow(smoothstep(0, tip, q), 1.4)) ; // petal taper toward the tip
  const rim = 1 - smoothstep(0.0, 0.06, Math.abs(edge));
  const vein = 1 - smoothstep(0.0, 0.05, Math.abs(x));
  return { lit: 1 - 0.18 * smoothstep(0.0, 0.5, edge), ink: clamp01(rim * 0.55 + vein * 0.25 * smoothstep(0.15, 0.6, q)), glow: 0 };
}
