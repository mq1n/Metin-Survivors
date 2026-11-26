// Ember paint helpers: obsidian / basalt plates with a lava crack network, hot-core glow regions and flame gradients.
// Every helper returns PaintLayers: the same recipe feeds the albedo stack (so the painter's `--guide albedo` keeps the seams where
// they are) and the emissive stack (black initial, additive glow that the game's bloom picks up).
import { clamp01, smoothstep } from '../../core/math.ts';
import { custom } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, type Rgb, mixRgb, rgb } from '../../core/paint/painter.ts';

export const FIRE = {
  white: rgb('#fff1c4'),
  yellow: rgb('#ffc030'),
  orange: rgb('#ff6a10'),
  red: rgb('#c8280a'),
  ember: rgb('#7c1606'),
  crust: rgb('#1a1315'),
};

/** lava heat ramp: 0 = dull ember red .. 1 = white-yellow core */
export function heatColor(h: number): Rgb {
  const t = clamp01(h);
  if (t < 0.4) return mixRgb(FIRE.ember, FIRE.red, t / 0.4);
  if (t < 0.7) return mixRgb(FIRE.red, FIRE.orange, (t - 0.4) / 0.3);
  if (t < 0.9) return mixRgb(FIRE.orange, FIRE.yellow, (t - 0.7) / 0.2);
  return mixRgb(FIRE.yellow, FIRE.white, (t - 0.9) / 0.1);
}

export interface CrackOpts {
  /** voronoi cells per metre (plate size ~ 1/freq) */
  freq: number;
  /** crack half-width in cell units (0.05 = thin vein, 0.12 = wide river) */
  width: number;
  /** domain warp strength (cell units) that makes the cracks meander */
  warp?: number;
  /** multiplies the mask (0..1) per vertex */
  mask?: (v: PaintVertex) => number;
  /** secondary fine network (ratio of frequency; 0 = none) */
  fine?: number;
}

export interface Crack {
  /** 1 in the crack core .. 0 on the plate */
  c: number;
  /** soft halo around the crack (heat bleeding into the crust) */
  halo: number;
  /** stable plate id 0..1 (per-plate tone variation) */
  id: number;
}

/** crack network at a point: wobbly 3-D voronoi borders */
export function crackAt(v: PaintVertex, o: CrackOpts): Crack {
  const p = v.p;
  const wf = o.warp ?? 0.28;
  const n = v.noise;
  const x = p[0] * o.freq, y = p[1] * o.freq, z = p[2] * o.freq;
  const wx = n.noise(x * 0.9 + 3.1, y * 0.9, z * 0.9) * wf, wy = n.noise(x * 0.9, y * 0.9 + 7.7, z * 0.9) * wf, wz = n.noise(x * 0.9, y * 0.9, z * 0.9 + 11.3) * wf;
  const c = n.voronoi(x + wx, y + wy, z + wz);
  const d = c.f2 - c.f1;
  let core = 1 - smoothstep(o.width * 0.55, o.width, d);
  const halo = 1 - smoothstep(o.width * 0.9, o.width * 2.4, d);
  if (o.fine) {
    const f2 = n.voronoi(x * o.fine + 5.3 + wx, y * o.fine + 1.7 + wy, z * o.fine + 9.1 + wz);
    const d2 = f2.f2 - f2.f1;
    core = Math.max(core, (1 - smoothstep(o.width * 0.22, o.width * 0.45, d2)) * 0.5);
  }
  const m = o.mask ? o.mask(v) : 1;
  return { c: core * m, halo: halo * m, id: c.id };
}

/** albedo: dark crust plates (per-plate tone) with glowing cracks */
export function crackAlbedo(o: CrackOpts & { crust?: Rgb; crustHi?: Rgb; heatBias?: number }): PaintLayer {
  const crust = o.crust ?? FIRE.crust;
  const hi = o.crustHi ?? mixRgb(crust, rgb('#5a4a52'), 0.55);
  return custom('crackAlbedo', (v) => {
    const k = crackAt(v, o);
    // plate tone: per-plate variation, lighter on upward faces (glassy sheen), darker toward cracks
    const tone = 0.25 + 0.75 * k.id;
    const up = clamp01(v.n[1] * 0.5 + 0.5);
    let plate = mixRgb(crust, hi, 0.25 * tone + 0.35 * Math.pow(up, 3) * (0.5 + 0.5 * v.cavity));
    plate = mixRgb(plate, FIRE.ember, 0.35 * k.halo);
    v.color = mixRgb(v.color, plate, 1 - k.c);
    if (k.c > 0) {
      // unlit albedo stays a dull ember: the brightness comes from the emissive map
      const heat = clamp01(k.c * (0.5 + 0.5 * v.noise.noise(v.p[0] * 23, v.p[1] * 23, v.p[2] * 23)) + (o.heatBias ?? 0));
      v.color = mixRgb(v.color, heatColor(0.1 + 0.42 * heat), clamp01(k.c * 1.5));
    }
  });
}

/** emissive: lava in the cracks + a faint heat bleed into the plates; `gain` scales the whole thing */
export function crackEmissive(o: CrackOpts & { gain?: number; bleed?: number }): PaintLayer {
  const gain = o.gain ?? 1;
  const bleed = o.bleed ?? 0.1;
  return custom('crackEmissive', (v) => {
    const k = crackAt(v, o);
    if (k.c <= 0 && k.halo <= 0) return;
    const flicker = 0.75 + 0.25 * v.noise.noise(v.p[0] * 19 + 4, v.p[1] * 19, v.p[2] * 19);
    const heat = clamp01(k.c * flicker);
    const col = heatColor(0.3 + 0.55 * heat);
    const a = clamp01(k.c * 1.2) * gain + k.halo * (1 - k.c) * bleed * gain;
    v.color = [v.color[0] + col[0] * a, v.color[1] + col[1] * a, v.color[2] + col[2] * a];
  });
}

/** albedo + emissive pair for a tagged region (eyes, core, trim, mouth...). `heat` may vary over the surface (flame gradients). */
export function glowRegion(tag: string, o: { soft?: number; heat?: number | ((v: PaintVertex) => number); gain?: number; albedo?: number }): { albedo: PaintLayer; emissive: PaintLayer } {
  const soft = o.soft ?? 0.004;
  const heatOf = (v: PaintVertex): number => (typeof o.heat === 'function' ? o.heat(v) : o.heat ?? 0.8);
  return {
    albedo: custom(`glowA:${tag}`, (v) => {
      const m = v.region(tag, soft);
      if (m > 0) v.color = mixRgb(v.color, heatColor(heatOf(v)), m * (o.albedo ?? 0.95));
    }),
    emissive: custom(`glowE:${tag}`, (v) => {
      const m = v.region(tag, soft);
      if (m <= 0) return;
      const col = heatColor(0.3 + 0.7 * heatOf(v));
      const a = m * (o.gain ?? 1);
      v.color = [v.color[0] + col[0] * a, v.color[1] + col[1] * a, v.color[2] + col[2] * a];
    }),
  };
}

/** vertical flame gradient for tall tagged shards: heat rises with world height between y0 (dull) and y1 (white-hot tips) */
export const flameHeat = (y0: number, y1: number, lo = 0.25, hi = 1): ((v: PaintVertex) => number) => (v) => lo + (hi - lo) * smoothstep(y0, y1, v.p[1]);

/** blade-style gradient along an axis: heat rises from `t0` (hilt side) to `t1` (tip) along world axis `axis` */
export const axisHeat = (axis: 0 | 1 | 2, t0: number, t1: number, lo = 0.3, hi = 1): ((v: PaintVertex) => number) => (v) => lo + (hi - lo) * smoothstep(t0, t1, v.p[axis]);
