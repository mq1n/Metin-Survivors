// Composite shape helpers built from the primitives: swept tubes (limbs, necks, tails), tufts, leaves.
import { type Vec3, basisFromDirSide, clamp01, qfromBasis, vadd, vcross, vdist, vlerp, vnorm, vscale, vsub } from '../math.ts';
import type { Sdf } from './node.ts';
import { RoundCone, spindle } from './primitives.ts';
import { Xform, smoothUnion } from './ops.ts';

/** Catmull-Rom through control points (clamped ends), t in [0,1] over the whole path. */
export function pathPoint(pts: readonly Vec3[], t: number): Vec3 {
  const n = pts.length - 1;
  if (n < 1) return pts[0]!;
  const f = clamp01(t) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = pts[Math.max(i - 1, 0)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(i + 2, n)]!;
  const u2 = u * u, u3 = u2 * u;
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = 0.5 * (2 * p1[k]! + (-p0[k]! + p2[k]!) * u + (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * u2 + (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * u3);
  }
  return out;
}

/** Piecewise smooth scalar profile through [t, value] control points (monotone-ish cosine easing). */
export function profileAt(profile: readonly (readonly [number, number])[], t: number): number {
  if (t <= profile[0]![0]) return profile[0]![1];
  const last = profile[profile.length - 1]!;
  if (t >= last[0]) return last[1];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]!, b = profile[i + 1]!;
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0] || 1);
      const s = u * u * (3 - 2 * u);
      return a[1] + (b[1] - a[1]) * (0.35 * u + 0.65 * s);
    }
  }
  return last[1];
}

export interface TubeSeg {
  sdf: RoundCone;
  /** path parameter range covered by this segment */
  t0: number;
  t1: number;
  a: Vec3;
  b: Vec3;
}

export interface TubeOpts {
  /** number of round-cone segments (default: one per ~3.5 cm of arc) */
  segments?: number;
}

/**
 * Sweep a variable-radius tube along a Catmull-Rom path. `radius` is either [t, r] control points (t in 0..1 along the
 * path) or a function. Returns the individual round-cone segments so callers can assign bones per segment.
 */
export function tubeSegments(path: readonly Vec3[], radius: readonly (readonly [number, number])[] | ((t: number) => number), opts: TubeOpts = {}): TubeSeg[] {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += vdist(path[i - 1]!, path[i]!);
  const n = opts.segments ?? Math.max(2, Math.ceil(len / 0.035));
  const rf = typeof radius === 'function' ? radius : (t: number) => profileAt(radius, t);
  const segs: TubeSeg[] = [];
  let prev = pathPoint(path, 0);
  for (let i = 1; i <= n; i++) {
    const t0 = (i - 1) / n, t1 = i / n;
    const p = pathPoint(path, t1);
    segs.push({ sdf: new RoundCone(prev, p, Math.max(rf(t0), 1e-4), Math.max(rf(t1), 1e-4)), t0, t1, a: prev, b: p });
    prev = p;
  }
  return segs;
}

/** Smooth-unioned tube (single Sdf). `w` blends consecutive segments (a fraction of the local radius works well). */
export function tube(path: readonly Vec3[], radius: readonly (readonly [number, number])[] | ((t: number) => number), opts: TubeOpts & { w?: number } = {}): Sdf {
  const segs = tubeSegments(path, radius, opts);
  return smoothUnion(segs.map((s) => s.sdf), opts.w ?? 0.02);
}

/** straight two-point tube with radius profile along its length */
export function limb(a: Vec3, b: Vec3, radius: readonly (readonly [number, number])[], opts: TubeOpts & { w?: number } = {}): Sdf {
  return tube([a, b], radius, { segments: opts.segments ?? Math.max(2, Math.ceil(vdist(a, b) / 0.05)), ...opts });
}

/**
 * A fur tuft / spike / claw / horn: tapered, optionally curved round cone from base to tip.
 * `curve` bends the tip sideways along `bendDir` by that many metres (quadratic).
 */
export function tuft(base: Vec3, tip: Vec3, baseR: number, tipR = 0.002, bend: { dir: Vec3; amount: number } | null = null): Sdf {
  if (!bend || bend.amount === 0) return new RoundCone(base, tip, baseR, tipR);
  const mid = vadd(vlerp(base, tip, 0.5), vscale(vnorm(bend.dir), bend.amount));
  return tube([base, mid, tip], (t) => baseR + (tipR - baseR) * t, { segments: 3, w: baseR * 0.4 });
}

/** Flat leaf/ear/feather blade from `a` (base) to `b` (tip): spindle with radii (width/2, thickness/2). */
export function blade(a: Vec3, b: Vec3, halfWidth: number, halfThick: number, side: Vec3 = [1, 0, 0]): Sdf {
  return spindle(a, b, [halfWidth, halfThick], side);
}

/** perpendicular helper: any unit vector orthogonal to v */
export function anyPerp(v: Vec3): Vec3 {
  const ax: Vec3 = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return vnorm(vcross(v, ax));
}

/**
 * Flattened tapered cone (ear, fin, horn plate, leaf, blade): a round cone from `base` to `tip` squashed along `facing`
 * (the flat face normal) to `flat` * radius. The classic triangular, rounded-tip ear.
 */
export function flatCone(base: Vec3, tip: Vec3, rBase: number, rTip: number, flat = 0.25, facing: Vec3 = [0, 0, 1]): Sdf {
  const dir = vsub(tip, base);
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  // local axes: y along the cone, z = flat-face normal, x = y × z
  const { x, y, z } = basisFromDirSide(dir, vcross(facing, dir));
  const q = qfromBasis(x, y, z);
  return new Xform(new RoundCone([0, 0, 0], [0, len, 0], rBase, rTip), base, q, [1, 1, flat]);
}
