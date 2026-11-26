// Cast / carved relief motifs for the PropsElem2 props (metre coordinates, u across, v up): thunder-spiral (leiwen) bands, a
// taotie beast mask for bronze vessels, skull medallions and carved glyph columns. Same Motif contract as PropsElem/motifs.ts
// (lit = relief light factor, ink = 0..1 groove darkening, glow = 0..1 heat) plus a Relief height channel for metals:
// h = 0..1 raised casting (polished), area = 1 inside the decorated field (its sunken ground collects corrosion).
import { clamp01, smoothstep } from '../../../../core/math.ts';
import { type Motif, NO_MOTIF, reliefOf } from '../PropsElem/motifs.ts';
import { sdSeg } from '../PropsElem/paint.ts';

export interface Relief extends Motif {
  h: number;
  area: number;
}
export const NO_RELIEF: Relief = { ...NO_MOTIF, h: 0, area: 0 };

const fr = (x: number): number => x - Math.floor(x);

// square spiral in a unit cell (-0.5..0.5), wound outward from the centre
const SPIRAL: [number, number][] = [[0, 0.04], [0.12, 0.04], [0.12, -0.16], [-0.18, -0.16], [-0.18, 0.24], [0.3, 0.24], [0.3, -0.36], [-0.4, -0.36]];

function spiralD(x: number, y: number, flip: boolean): number {
  const xx = flip ? -x : x, yy = flip ? -y : y;
  let d = 1e9;
  for (let i = 0; i + 1 < SPIRAL.length; i++) d = Math.min(d, sdSeg(xx, yy, SPIRAL[i]![0], SPIRAL[i]![1], SPIRAL[i + 1]![0], SPIRAL[i + 1]![1]));
  return d;
}

/** band of raised square thunder spirals (alternately mirrored) on a sunken ground, framed by two raised fillets */
export function leiwenBand(u: number, v: number, o: { cy: number; h: number; line?: number }): Relief {
  const y = v - o.cy;
  const half = o.h / 2;
  if (Math.abs(y) > half + 0.02) return NO_RELIEF;
  const s = o.h * 0.78;
  const w = o.line ?? 0.07;
  const h = (uu: number, yy: number): number => {
    if (Math.abs(yy) > half) return 0.5;
    const cell = Math.floor(uu / s);
    const d = spiralD(fr(uu / s) - 0.5, yy / s, (cell & 1) === 1);
    const fillet = 1 - smoothstep(0.01, 0.022, Math.abs(Math.abs(yy) - half + 0.012));
    return Math.max(1 - smoothstep(w * 0.6, w, d), fillet);
  };
  const hv = h(u, y);
  return { lit: reliefOf(h, u, y, 0.006, 2.4), ink: clamp01((1 - hv) * 0.55), glow: 0, h: hv, area: Math.abs(y) < half ? 1 : 0 };
}

/** taotie beast mask (lu across, lv up, centred; `size` = half width in metres): eye bosses, horn curls, a nose ridge */
export function taotie(lu: number, lv: number, size: number): Relief {
  const x = lu / size, y = lv / size;
  if (Math.abs(x) > 1.08 || Math.abs(y) > 0.75) return NO_RELIEF;
  const h = (xx: number, yy: number): number => {
    const ax = Math.abs(xx);
    // eye bosses with a pupil groove
    const de = Math.hypot(ax - 0.38, yy - 0.05);
    let v = smoothstep(0.17, 0.13, de) * (1 - 0.6 * smoothstep(0.06, 0.03, de));
    // brow / horn curl: an arc over each eye turning out and down
    const dc = Math.abs(Math.hypot(ax - 0.62, yy + 0.02) - 0.34);
    const arc = yy > -0.1 || ax > 0.8 ? 1 - smoothstep(0.035, 0.065, dc) : 0;
    v = Math.max(v, arc * 0.8);
    // nose ridge and upper lip bar
    v = Math.max(v, (1 - smoothstep(0.04, 0.07, ax)) * smoothstep(0.5, 0.42, Math.abs(yy + 0.02)) * 0.85);
    v = Math.max(v, (1 - smoothstep(0.03, 0.055, Math.abs(yy + 0.38))) * (1 - smoothstep(0.42, 0.5, ax)) * 0.7);
    // fangs
    const fx = Math.abs(ax - 0.3);
    v = Math.max(v, yy < -0.38 && yy > -0.62 ? (1 - smoothstep(0.03 * (1 + (yy + 0.38) * 3.5), 0.05 * (1 + (yy + 0.38) * 3.5), fx)) * 0.7 : 0);
    return v;
  };
  const hv = h(x, y);
  return { lit: reliefOf(h, x, y, 0.02, 1.6), ink: clamp01((0.3 - hv) * 0.6), glow: 0, h: hv, area: smoothstep(1.0, 0.8, Math.hypot(x / 1.05, y / 0.72)) };
}

/** stylised skull relief (lu across, lv up, `size` = half width): cranium dome, deep eye sockets, nose hole, teeth row */
export function skullRelief(lu: number, lv: number, size: number): Relief & { socket: number } {
  const x = lu / size, y = lv / size;
  if (Math.abs(x) > 1.15 || y > 1.25 || y < -1.1) return { ...NO_RELIEF, socket: 0 };
  const sock = (xx: number, yy: number): number => {
    const de = Math.hypot((Math.abs(xx) - 0.38) * 1.1, yy - 0.05);
    return smoothstep(0.26, 0.18, de);
  };
  const h = (xx: number, yy: number): number => {
    const ax = Math.abs(xx);
    // cranium: ellipse, jaw: narrower rounded box
    const cr = Math.hypot(xx / 0.95, (yy - 0.25) / 0.9);
    let v = smoothstep(1.02, 0.94, cr);
    const jaw = Math.max(ax - 0.55, Math.abs(yy + 0.55) - 0.3);
    v = Math.max(v, smoothstep(0.04, -0.02, jaw) * 0.9);
    v -= sock(xx, yy) * 0.9;
    const nose = Math.max(Math.abs(xx) * 1.4 + (yy + 0.28) * 0.6, -(yy + 0.36));
    v -= smoothstep(0.14, 0.09, nose) * 0.7;
    // teeth: vertical grooves across the jaw
    if (yy < -0.45 && yy > -0.72 && ax < 0.45) v -= (1 - smoothstep(0.015, 0.035, Math.abs(fr(xx / 0.15) - 0.5) * 0.15)) * 0.4;
    return clamp01(v);
  };
  const hv = h(x, y);
  const s = sock(x, y);
  return { lit: reliefOf(h, x, y, 0.025, 1.8), ink: clamp01((1 - hv) * 0.25 + s * 0.6), glow: 0, socket: s, h: hv, area: hv > 0.05 ? 1 : 0 };
}
