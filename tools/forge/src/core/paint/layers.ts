import { clamp01, smoothstep, vdot, vnorm } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { type PaintLayer, type PaintVertex, type Rgb, mixRgb } from './painter.ts';

export type Mask = (v: PaintVertex) => number;
export type Mode = 'mix' | 'multiply' | 'screen' | 'add';

function combine(base: Rgb, c: Rgb, a: number, mode: Mode): Rgb {
  switch (mode) {
    case 'multiply': return mixRgb(base, [base[0] * c[0], base[1] * c[1], base[2] * c[2]], a);
    case 'screen': return mixRgb(base, [1 - (1 - base[0]) * (1 - c[0]), 1 - (1 - base[1]) * (1 - c[1]), 1 - (1 - base[2]) * (1 - c[2])], a);
    case 'add': return [base[0] + c[0] * a, base[1] + c[1] * a, base[2] + c[2] * a];
    default: return mixRgb(base, c, a);
  }
}

/** Generic layer: paint `color` with per-vertex amount. */
export function layer(name: string, color: Rgb | ((v: PaintVertex) => Rgb), amount: (v: PaintVertex) => number, mode: Mode = 'mix'): PaintLayer {
  return {
    name,
    apply(v) {
      const a = clamp01(amount(v));
      if (a <= 0) return;
      v.color = combine(v.color, typeof color === 'function' ? color(v) : color, a, mode);
    },
  };
}

export const fill = (color: Rgb): PaintLayer => ({ name: 'fill', apply: (v) => { v.color = [...color] as Rgb; } });

/** Colour ramp along a world direction: t = dot(p, dir) mapped t0..t1 -> stops. */
export function gradient(dir: Vec3, t0: number, t1: number, stops: [number, Rgb][], opts: { mask?: Mask; strength?: number; mode?: Mode; warp?: { freq: number; amp: number } } = {}): PaintLayer {
  const d = vnorm(dir);
  return {
    name: 'gradient',
    apply(v) {
      let t = (vdot(v.p, d) - t0) / (t1 - t0);
      if (opts.warp) t += opts.warp.amp * v.noise.noise(v.p[0] * opts.warp.freq, v.p[1] * opts.warp.freq, v.p[2] * opts.warp.freq);
      t = clamp01(t);
      let c = stops[stops.length - 1]![1];
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i]!, b = stops[i + 1]!;
        if (t <= b[0]) {
          c = mixRgb(a[1], b[1], smoothstep(a[0], b[0], t));
          break;
        }
        if (i === 0 && t < a[0]) c = a[1];
      }
      const m = (opts.strength ?? 1) * (opts.mask ? opts.mask(v) : 1);
      v.color = combine(v.color, c, clamp01(m), opts.mode ?? 'mix');
    },
  };
}

/** tint where tagged body parts are */
export function region(tag: string, color: Rgb, strength = 1, soft = 0.02, mode: Mode = 'mix'): PaintLayer {
  return { name: `region:${tag}`, apply: (v) => { const a = v.region(tag, soft) * strength; if (a > 0) v.color = combine(v.color, color, clamp01(a), mode); } };
}

/** tint by skin weight of bones (sum of the named bones' weights) */
export function bones(names: string[], color: Rgb, strength = 1, edge: [number, number] = [0.15, 0.85], mode: Mode = 'mix'): PaintLayer {
  return {
    name: `bones:${names.join(',')}`,
    apply(v) {
      let w = 0;
      for (const n of names) w += v.bone(n);
      const a = smoothstep(edge[0], edge[1], w) * strength;
      if (a > 0) v.color = combine(v.color, color, clamp01(a), mode);
    },
  };
}

/** Noise-thresholded blotches (spots, patches, mottling). threshold in noise units ~[-1,1]. */
export function blotches(color: Rgb, o: { freq: number; threshold: number; softness?: number; strength?: number; octaves?: number; stretch?: Vec3; seedOffset?: number; mask?: Mask; mode?: Mode }): PaintLayer {
  const st = o.stretch ?? [1, 1, 1];
  const off = o.seedOffset ?? 0;
  return {
    name: 'blotches',
    apply(v) {
      const n = v.noise.fbm(v.p[0] * o.freq * st[0] + off, v.p[1] * o.freq * st[1] + off * 0.7, v.p[2] * o.freq * st[2] - off, { octaves: o.octaves ?? 2 });
      const a = smoothstep(o.threshold - (o.softness ?? 0.08), o.threshold + (o.softness ?? 0.08), n) * (o.strength ?? 1) * (o.mask ? o.mask(v) : 1);
      if (a > 0) v.color = combine(v.color, color, clamp01(a), o.mode ?? 'mix');
    },
  };
}

/**
 * Warped stripes. `axis` is the world direction the stripes repeat along (e.g. +Z for bands across a tiger's body, +Y
 * for vertical flank stripes). `duty` = painted fraction of a period.
 */
export function stripes(color: Rgb, o: { axis: Vec3; period: number; duty: number; warpFreq?: number; warpAmp?: number; softness?: number; strength?: number; phase?: number; mask?: Mask; mode?: Mode; taper?: (v: PaintVertex) => number }): PaintLayer {
  const ax = vnorm(o.axis);
  return {
    name: 'stripes',
    apply(v) {
      let t = vdot(v.p, ax) / o.period + (o.phase ?? 0);
      if (o.warpAmp) t += o.warpAmp * v.noise.fbm(v.p[0] * (o.warpFreq ?? 4), v.p[1] * (o.warpFreq ?? 4), v.p[2] * (o.warpFreq ?? 4), { octaves: 2 });
      const f = t - Math.floor(t);
      const duty = o.duty * (o.taper ? o.taper(v) : 1);
      const s = o.softness ?? 0.06;
      const a = (smoothstep(0, s, f) - smoothstep(duty, duty + s, f)) * (o.strength ?? 1) * (o.mask ? o.mask(v) : 1);
      if (a > 0) v.color = combine(v.color, color, clamp01(a), o.mode ?? 'mix');
    },
  };
}

/** Fur clumps: voronoi cell brightness variation, stretched along the fur flow. */
export function furClumps(o: { freq: number; amount: number; stretch?: Vec3; tint?: Rgb }): PaintLayer {
  const st = o.stretch ?? [1, 1, 1];
  return {
    name: 'furClumps',
    apply(v) {
      const c = v.noise.voronoi(v.p[0] * o.freq * st[0], v.p[1] * o.freq * st[1], v.p[2] * o.freq * st[2]);
      const k = (c.id - 0.5) * 2 * o.amount + (0.5 - c.f1) * o.amount * 0.6;
      v.color = o.tint ? mixRgb(v.color, o.tint, clamp01(Math.max(k, 0))) : [v.color[0] * (1 + k), v.color[1] * (1 + k), v.color[2] * (1 + k)];
    },
  };
}

/** Fine speckle/grain brightness jitter. */
export function grain(amount: number, freq = 60): PaintLayer {
  return {
    name: 'grain',
    apply(v) {
      const k = 1 + amount * v.noise.noise(v.p[0] * freq, v.p[1] * freq, v.p[2] * freq);
      v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
    },
  };
}

/** Bake AO into the colour (multiply), optionally tinting shadows (e.g. warm brown) rather than going to black. */
export function bakeAo(strength = 0.7, shadowTint: Rgb = [0.5, 0.45, 0.5], power = 1.2): PaintLayer {
  return {
    name: 'ao',
    apply(v) {
      const k = clamp01(1 - v.ao) ** power * strength;
      v.color = [v.color[0] * (1 - k + k * shadowTint[0]), v.color[1] * (1 - k + k * shadowTint[1]), v.color[2] * (1 - k + k * shadowTint[2])];
    },
  };
}

/** Darken creases, lighten convex edges. */
export function cavity(darken = 0.25, lighten = 0.12): PaintLayer {
  return {
    name: 'cavity',
    apply(v) {
      const k = v.cavity < 0 ? 1 + v.cavity * darken : 1 + v.cavity * lighten;
      v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
    },
  };
}

/** Baked sky/ground bounce: surfaces facing up pick up `sky`, facing down `ground` (multiplicative, ~1 = neutral). */
export function hemi(sky: Rgb, ground: Rgb, strength = 1): PaintLayer {
  return {
    name: 'hemi',
    apply(v) {
      const t = v.n[1] * 0.5 + 0.5;
      const c = mixRgb(ground, sky, t);
      v.color = mixRgb(v.color, [v.color[0] * c[0], v.color[1] * c[1], v.color[2] * c[2]], strength);
    },
  };
}

/** Rim/edge tint toward `color` along silhouettes of a fixed view direction (3/4 camera from above-front). */
export function rimTint(color: Rgb, o: { view?: Vec3; strength?: number; power?: number } = {}): PaintLayer {
  const view = vnorm(o.view ?? [0.35, 0.75, 0.55]);
  return {
    name: 'rim',
    apply(v) {
      const f = 1 - Math.abs(vdot(v.n, view));
      const a = clamp01(f ** (o.power ?? 3)) * (o.strength ?? 0.25) * (0.4 + 0.6 * v.ao);
      v.color = mixRgb(v.color, color, a);
    },
  };
}

/** Free-form layer from a function. */
export const custom = (name: string, apply: (v: PaintVertex) => void): PaintLayer => ({ name, apply });

/**
 * Directional fur strands: noise stretched along the local flow direction, so the texture reads as combed hair.
 * `flow(v)` returns the (unit-ish) fur direction at a vertex/texel; `freq` is cycles per metre ACROSS the strands,
 * `stretch` how much longer along them (6 = long streaks).
 */
export function strands(o: { flow: (v: PaintVertex) => Vec3; freq: number; stretch?: number; amount: number; octaves?: number; tint?: Rgb; mask?: Mask }): PaintLayer {
  const st = o.stretch ?? 6;
  return {
    name: 'strands',
    apply(v) {
      const f = vnorm(o.flow(v));
      const ref: Vec3 = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const e2 = vnorm([f[1] * ref[2] - f[2] * ref[1], f[2] * ref[0] - f[0] * ref[2], f[0] * ref[1] - f[1] * ref[0]]);
      const e3: Vec3 = [f[1] * e2[2] - f[2] * e2[1], f[2] * e2[0] - f[0] * e2[2], f[0] * e2[1] - f[1] * e2[0]];
      const a = vdot(v.p, f) * (o.freq / st), b = vdot(v.p, e2) * o.freq, c = vdot(v.p, e3) * o.freq;
      const n = v.noise.fbm(a, b, c, { octaves: o.octaves ?? 2, gain: 0.55 });
      const k = n * o.amount * (o.mask ? o.mask(v) : 1);
      v.color = o.tint && k > 0 ? mixRgb(v.color, o.tint, clamp01(k)) : [v.color[0] * (1 + k), v.color[1] * (1 + k), v.color[2] * (1 + k)];
    },
  };
}
