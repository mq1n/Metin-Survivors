// N-legged rig helper: planted-foot two-bone IK for every leg (2- or 3-bone legs), step curves, alternating-tetrapod / tripod gaits,
// and FK fold poses (death / spawn). Feet are solved in ground space after the body bones have been posed.
import type { PoseCtx } from '../../core/anim/clip.ts';
import { aimQuat, localFromWorld, twoBoneIK } from '../../core/anim/ik.ts';
import { type Vec3, qaxis, qmul, qrotate, qx, vcross, vdist, vlen, vnorm, vsub } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { LegSpec } from './anatomy.ts';

export interface FootOff {
  dx?: number;
  dy?: number;
  dz?: number;
  /** tarsus pitch about X (3-bone legs); positive = toes backward */
  pitch?: number;
}

interface LegRest {
  spec: LegSpec;
  p0: Vec3;
  p1: Vec3;
  /** IK end point at rest (ankle for 3-bone legs, tip for 2-bone legs) */
  p2: Vec3;
  l1: number;
  l2: number;
  /** rest bend-plane normal = (upper dir) x (lower dir) */
  n0: Vec3;
  ui: number;
  li: number;
  fi: number;
  pi: number;
  pole: Vec3;
}

export interface LegGait {
  /** fraction of the cycle a foot is on the ground */
  duty: number;
  /** phase offset (0..1) of touchdown per leg */
  phase: (l: LegSpec) => number;
  /** total foot travel while planted (m) */
  sweep: (l: LegSpec) => number;
  /** swing lift (m) */
  lift: number;
  /** extra sideways swing-out during the lift (m) */
  out?: number;
  /** toe pitch while carried (3-bone legs) */
  pitch?: number;
}

const ease = (s: number): number => s * s * (3 - 2 * s);

export class LegRig {
  readonly legs: LegRest[];
  constructor(readonly skel: Skeleton, specs: LegSpec[]) {
    this.legs = specs.map((spec) => {
      const p0 = spec.hip, p1 = spec.knee;
      const p2 = spec.foot ? spec.ankle : spec.tip;
      const n0 = vnorm(vcross(vsub(p1, p0), vsub(p2, p1)));
      return {
        spec, p0, p1, p2,
        l1: vdist(p0, p1), l2: vdist(p1, p2), n0,
        ui: skel.idx(spec.upper), li: skel.idx(spec.lower), fi: spec.foot ? skel.idx(spec.foot) : -1, pi: skel.idx(spec.parent),
        pole: [spec.side * 0.3, 1, 0] as Vec3,
      };
    });
  }

  /** solve one leg so that its end reaches rest + offset (ground space) */
  plant(ctx: PoseCtx, L: LegRest, off: FootOff = {}): void {
    const w = this.skel.fk(ctx.pose);
    const pr = w.rot[L.pi]!;
    const P0 = w.pos[L.ui]!;
    const target: Vec3 = [L.p2[0] + (off.dx ?? 0), L.p2[1] + (off.dy ?? 0), L.p2[2] + (off.dz ?? 0)];
    const { mid, end } = twoBoneIK(P0, target, L.l1, L.l2, L.pole);
    const u1 = vsub(mid, P0), l1 = vsub(end, mid);
    let n1 = vcross(u1, l1);
    if (vlen(n1) < 1e-6) n1 = qrotate(pr, L.n0);
    n1 = vnorm(n1);
    const rUpper = aimQuat(vsub(L.p1, L.p0), L.n0, u1, n1);
    const rLower = aimQuat(vsub(L.p2, L.p1), L.n0, l1, n1);
    ctx.pose.rot[L.ui] = localFromWorld(pr, rUpper);
    ctx.pose.rot[L.li] = localFromWorld(rUpper, rLower);
    if (L.fi >= 0) ctx.pose.rot[L.fi] = localFromWorld(rLower, qx(off.pitch ?? 0));
  }

  /** plant every leg; `fn` may give per-leg offsets */
  plantAll(ctx: PoseCtx, fn?: (l: LegSpec) => FootOff | undefined): void {
    for (const L of this.legs) this.plant(ctx, L, fn?.(L.spec) ?? {});
  }

  /** evaluate a gait at normalised time u */
  gait(ctx: PoseCtx, g: LegGait, u: number, extra?: (l: LegSpec) => FootOff | undefined): void {
    for (const L of this.legs) {
      const f = footStep(u + g.phase(L.spec), g.duty, g.sweep(L.spec), g.lift);
      const e = extra?.(L.spec);
      this.plant(ctx, L, {
        dx: L.spec.side * (g.out ?? 0) * f.swing + (e?.dx ?? 0),
        dy: f.dy + (e?.dy ?? 0),
        dz: f.dz + (e?.dz ?? 0),
        pitch: (g.pitch ?? 0) * f.swing + (e?.pitch ?? 0),
      });
    }
  }

  /**
   * FK fold: lift the knee and curl the leg toward the belly. amt 0 = rest, 1 = fully tucked. `spread` swings the leg about
   * the vertical (positive = forward for the front rows), `twitch` adds an extra bend wobble.
   */
  fold(ctx: PoseCtx, L: LegRest, amt: number, spread = 0, twitch = 0): void {
    const yaw = qaxis([0, 1, 0], spread);
    ctx.pose.rot[L.ui] = qmul(yaw, qaxis(L.n0, -0.95 * amt + 0.3 * twitch));
    ctx.pose.rot[L.li] = qaxis(L.n0, 1.75 * amt + 0.5 * twitch);
    if (L.fi >= 0) ctx.pose.rot[L.fi] = qaxis(L.n0, 0.7 * amt);
  }

  foldAll(ctx: PoseCtx, fn: (l: LegSpec) => { amt: number; spread?: number; twitch?: number }): void {
    for (const L of this.legs) {
      const v = fn(L.spec);
      this.fold(ctx, L, v.amt, v.spread ?? 0, v.twitch ?? 0);
    }
  }
}

/** one foot's trajectory: planted stance at constant speed (front -> back), then a swing arc */
export function footStep(u0: number, duty: number, sweep: number, lift: number): { dz: number; dy: number; swing: number } {
  const u = u0 - Math.floor(u0);
  if (u < duty) {
    const s = u / duty;
    return { dz: sweep * (0.5 - s), dy: 0, swing: 0 };
  }
  const s = (u - duty) / (1 - duty);
  const e = ease(0.65 * s + 0.35 * ease(s));
  const arc = Math.pow(Math.sin(Math.PI * s), 0.75);
  return { dz: sweep * (-0.5 + e), dy: lift * arc, swing: arc };
}
