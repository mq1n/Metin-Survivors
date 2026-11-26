import type { Vec3 } from '../math.ts';
import { smoothstep } from '../math.ts';
import type { FbmOpts, Noise } from '../noise.ts';
import type { Field } from './ops.ts';
import { Displace } from './ops.ts';
import type { Sdf } from './node.ts';

/** Perlin-gradient fbm field, ~[-1,1]. Anisotropic scaling streaks the pattern (fur flow, grain). */
export function fbmField(noise: Noise, freq: number, opts: FbmOpts & { stretch?: Vec3; offset?: Vec3 } = {}): Field {
  const [sx, sy, sz] = opts.stretch ?? [1, 1, 1];
  const [ox, oy, oz] = opts.offset ?? [0, 0, 0];
  const oct = opts.octaves ?? 3, gain = opts.gain ?? 0.5, lac = opts.lacunarity ?? 2;
  let lipSum = 0, a = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    lipSum += a * Math.pow(lac, i);
    norm += a;
    a *= gain;
  }
  const smax_ = Math.max(sx, sy, sz);
  return {
    eval: (x, y, z) => noise.fbm((x + ox) * freq * sx, (y + oy) * freq * sy, (z + oz) * freq * sz, opts),
    lip: (2.2 * freq * smax_ * lipSum) / norm,
  };
}

/** Ridged multifractal field in ~[0,1] (centered to ~[-0.5,0.5]) - muscle seams, bark, rock strata. */
export function ridgedField(noise: Noise, freq: number, opts: FbmOpts & { stretch?: Vec3 } = {}): Field {
  const [sx, sy, sz] = opts.stretch ?? [1, 1, 1];
  const oct = opts.octaves ?? 3, gain = opts.gain ?? 0.5, lac = opts.lacunarity ?? 2;
  let lipSum = 0, a = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    lipSum += a * Math.pow(lac, i);
    norm += a;
    a *= gain;
  }
  return {
    eval: (x, y, z) => noise.ridged(x * freq * sx, y * freq * sy, z * freq * sz, opts) - 0.5,
    lip: (5 * freq * Math.max(sx, sy, sz) * lipSum) / norm,
  };
}

export type VoronoiMode =
  /** rounded cells (scales, pebbles, fur clumps): +1 at cell centres, 0 at borders */
  | 'dome'
  /** thin raised walls at cell borders (cracks, plates, hide folds) */
  | 'edge'
  /** flat random plateau per cell (patchwork, feather rows) */
  | 'cells';

export function voronoiField(noise: Noise, freq: number, mode: VoronoiMode = 'dome', stretch: Vec3 = [1, 1, 1]): Field {
  const [sx, sy, sz] = stretch;
  return {
    eval: (x, y, z) => {
      const v = noise.voronoi(x * freq * sx, y * freq * sy, z * freq * sz);
      if (mode === 'dome') return 1 - Math.min(v.f1 * 1.6, 1) ** 1.5 * 2; // ~[-1,1]
      if (mode === 'edge') return Math.max(0, 1 - (v.f2 - v.f1) * 4) * 2 - 1;
      return v.id * 2 - 1;
    },
    lip: 4 * freq * Math.max(sx, sy, sz),
  };
}

/** Multiply a field by a spatial mask in [0,1] (e.g. only displace the mane). */
export function maskedField(f: Field, mask: (x: number, y: number, z: number) => number): Field {
  return { eval: (x, y, z) => f.eval(x, y, z) * mask(x, y, z), lip: f.lip + 1 };
}

export function sumFields(...fs: { f: Field; k: number }[]): Field {
  return {
    eval: (x, y, z) => {
      let s = 0;
      for (const { f, k } of fs) s += k * f.eval(x, y, z);
      return s;
    },
    lip: fs.reduce((a, { f, k }) => a + Math.abs(k) * f.lip, 0),
  };
}

/** Soft spherical mask: 1 inside radius r0 of `c`, 0 beyond r1. */
export function ballMask(c: Vec3, r0: number, r1: number): (x: number, y: number, z: number) => number {
  return (x, y, z) => 1 - smoothstep(r0, r1, Math.hypot(x - c[0], y - c[1], z - c[2]));
}

/** Soft slab mask along an axis (0=x,1=y,2=z): ramps 0->1 from t0 to t1 (works either direction). */
export function rampMask(axis: 0 | 1 | 2, t0: number, t1: number): (x: number, y: number, z: number) => number {
  return (x, y, z) => smoothstep(t0, t1, axis === 0 ? x : axis === 1 ? y : z);
}

export const displaceBy = (s: Sdf, f: Field, amp: number): Sdf => new Displace(s, f, amp);
