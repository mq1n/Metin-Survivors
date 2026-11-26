// Geometry kit for the barbarian pieces: probing the nude body surface (so armour / fur sits on the real muscles, not on the
// torso loft), torso surface points, tufts, horns and curved spikes. Everything is WORLD rest-pose metres (+Z forward, +X = left).
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { RoundCone } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import type { Ctx } from '../humanoid/index.ts';

/** minimal distance to the nude skin parts (base stage, tag `skin`); negative inside the body */
export type Probe = (x: number, y: number, z: number) => number;

export function skinProbe(ctx: Ctx): Probe {
  const parts = ctx.body.parts.filter((p) => p.stage === 'base' && p.tags?.includes('skin'));
  return (x, y, z) => {
    let d = Infinity;
    for (const p of parts) {
      const v = p.sdf.d(x, y, z);
      if (v < d) d = v;
    }
    return d;
  };
}

/** march from `origin` (inside the body) along `dir` until the probe distance reaches `ext`; bisection-refined surface point */
export function surfaceAlong(probe: Probe, origin: Vec3, dir: Vec3, ext = 0, r1 = 0.6, step = 0.004): Vec3 {
  const d = vnorm(dir);
  const at = (r: number): Vec3 => [origin[0] + d[0] * r, origin[1] + d[1] * r, origin[2] + d[2] * r];
  let prev = 0;
  for (let r = 0; r <= r1; r += step) {
    const p = at(r);
    if (probe(p[0], p[1], p[2]) >= ext) {
      let lo = prev, hi = r;
      for (let k = 0; k < 7; k++) {
        const m = (lo + hi) / 2;
        const q = at(m);
        if (probe(q[0], q[1], q[2]) >= ext) hi = m;
        else lo = m;
      }
      return at(hi);
    }
    prev = r;
  }
  return at(r1);
}

/** outward unit normal of the probe field at p (central differences) */
export function normalAt(probe: Probe, p: Vec3, h = 0.006): Vec3 {
  const g: Vec3 = [
    probe(p[0] + h, p[1], p[2]) - probe(p[0] - h, p[1], p[2]),
    probe(p[0], p[1] + h, p[2]) - probe(p[0], p[1] - h, p[2]),
    probe(p[0], p[1], p[2] + h) - probe(p[0], p[1], p[2] - h),
  ];
  return vnorm(g);
}

/** tapered tube through control points (base radius -> tip radius); smooth-unioned round cones */
export function curve(path: Vec3[], r0: number, r1: number, segs = 4, mid = 0.6): Sdf {
  return tube(path, [[0, r0], [0.5, r0 * (1 - mid * 0.5) + r1 * mid * 0.5], [1, r1]], { segments: segs, w: Math.max(r0 * 0.35, 0.004) });
}

/** a bent tuft / spike / claw from `base` to `tip` bending by `bend` (world offset applied to the midpoint) */
export function tuftSdf(base: Vec3, tip: Vec3, r: number, rTip: number, bend: Vec3 = [0, 0, 0]): Sdf {
  const mid = vadd(vlerp(base, tip, 0.5), bend);
  return tube([base, mid, tip], [[0, r], [0.55, r * 0.62 + rTip * 0.38], [1, rTip]], { segments: 2, w: r * 0.4 });
}

/** straight spike */
export const spikeSdf = (base: Vec3, tip: Vec3, r: number, rTip = r * 0.12): Sdf => new RoundCone(base, tip, r, rTip);

/** horn / tusk: tube through `pts` with base radius r0 and a sharp tip */
export function hornSdf(pts: Vec3[], r0: number, r1: number, segs = 5): Sdf {
  return tube(pts, [[0, r0], [0.45, r0 * 0.74], [0.8, r0 * 0.38 + r1 * 0.62], [1, r1]], { segments: segs, w: r0 * 0.3 });
}

/** point on a super-ellipse cross-section at angle phi (0 = front +Z, +90deg = left +X), offset outward by ext (scales both radii) */
export function ringPoint(st: { rx: number; rz: number; cx: number; cz: number; n: number }, y: number, phi: number, ext = 0): Vec3 {
  const sn = Math.sin(phi), cs = Math.cos(phi);
  const k = 2 / st.n;
  return [st.cx + (st.rx + ext) * Math.sign(sn) * Math.abs(sn) ** k, y, st.cz + (st.rz + ext) * Math.sign(cs) * Math.abs(cs) ** k];
}

export const lerp3 = vlerp;
export { vadd, vnorm, vscale, vsub };
