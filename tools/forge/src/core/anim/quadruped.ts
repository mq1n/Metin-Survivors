// Quadruped rig helper: leg IK (planted feet while the body moves), foot-cycle curves, gait specs. Archetypes (canine, bear, boar,
// feline...) describe their bone names once and author clips with these tools.
import { type Quat, type Vec3, clamp01, qx, qrotate, smoothstep, vadd, vdist, vsub } from '../math.ts';
import { aimQuat, localFromWorld, twoBoneIK } from './ik.ts';
import type { PoseCtx } from './clip.ts';
import type { Skeleton } from '../skin/skeleton.ts';

export type LegKey = 'fl' | 'fr' | 'hl' | 'hr';

export interface LegBones {
  /** shoulder / hip bone */
  upper: string;
  /** elbow / stifle bone */
  lower: string;
  /** wrist / hock bone (its origin is the ankle the IK reaches for) */
  foot: string;
  /** optional digit bone below `foot` (hind paws) */
  toe?: string;
  /** bone the upper bone hangs from (chest / pelvis) */
  parent: string;
  kind: 'front' | 'hind';
}

export interface QuadrupedBones {
  root: string;
  pelvis: string;
  spine: string;
  chest: string;
  neck: string;
  head: string;
  jaw?: string;
  tail: string[];
  ears: string[];
  legs: Record<LegKey, LegBones>;
}

export interface FootOffset {
  /** along +Z (forward) in ground space */
  dz: number;
  /** along +Y */
  dy: number;
  /** lateral */
  dx?: number;
  /** foot pitch about X, radians; positive = toes down */
  pitch: number;
  toe?: number;
}

export interface GaitSpec {
  /** fraction of the cycle a foot is on the ground */
  duty: number;
  /** phase offset (0..1) of touchdown per leg */
  phases: Record<LegKey, number>;
  /** stance sweep length per leg pair (m): total foot travel while planted */
  sweep: { front: number; hind: number };
  /** swing lift height (m) */
  lift: { front: number; hind: number };
  /** paw length (m) used to keep the toes off the ground when the heel rolls */
  pawLen: number;
  /** extra toe-down curl while carrying the foot (radians) */
  curl?: number;
}

const ease = (s: number): number => s * s * (3 - 2 * s);

/**
 * One foot's trajectory: planted stance (constant ground speed, heel->toe roll) then a swing arc.
 * Returned dz is relative to the rest foot position; stance starts forward (+sweep/2) and ends behind (-sweep/2).
 */
export function footCycle(u0: number, duty: number, sweep: number, lift: number, pawLen: number, curl = 0.55): FootOffset {
  const u = u0 - Math.floor(u0);
  if (u < duty) {
    const s = u / duty;
    const roll = s < 0.15 ? -0.12 * (1 - s / 0.15) : s > 0.6 ? 0.55 * smoothstep(0.6, 1, s) : 0;
    const dy = pawLen * Math.sin(Math.max(roll, 0)) * 0.9;
    return { dz: sweep * (0.5 - s), dy, pitch: roll };
  }
  const s = (u - duty) / (1 - duty);
  const e = ease(ease(s) * 0.4 + s * 0.6);
  const arc = Math.sin(Math.PI * Math.pow(s, 0.8));
  const roll = 0.55 * (1 - s) + curl * arc * (1 - 0.5 * s) - 0.12 * s * s;
  return { dz: sweep * (-0.5 + e), dy: lift * arc + pawLen * Math.sin(Math.max(roll, 0)) * 0.55 * (1 - s), pitch: roll };
}

interface LegRest {
  bones: LegBones;
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  l1: number;
  l2: number;
  idx: { upper: number; lower: number; foot: number; toe: number; parent: number };
  pole: Vec3;
}

export class QuadrupedRig {
  readonly legs: Record<LegKey, LegRest>;
  constructor(
    readonly skel: Skeleton,
    readonly b: QuadrupedBones,
  ) {
    const mk = (l: LegBones): LegRest => {
      const p0 = skel.restPos(l.upper), p1 = skel.restPos(l.lower), p2 = skel.restPos(l.foot);
      return {
        bones: l,
        p0, p1, p2,
        l1: vdist(p0, p1),
        l2: vdist(p1, p2),
        idx: { upper: skel.idx(l.upper), lower: skel.idx(l.lower), foot: skel.idx(l.foot), toe: l.toe ? skel.idx(l.toe) : -1, parent: skel.idx(l.parent) },
        pole: l.kind === 'front' ? [0, 0, -1] : [0, 0, 1],
      };
    };
    this.legs = { fl: mk(b.legs.fl), fr: mk(b.legs.fr), hl: mk(b.legs.hl), hr: mk(b.legs.hr) };
  }

  /** rest height of the ankle (ground clearance of wrist / hock) */
  ankleHeight(k: LegKey): number {
    return this.legs[k].p2[1];
  }

  /**
   * Plant the foot of leg `k` at (rest ankle + offset) in world/ground space and solve the limb. Call after the body bones
   * (root, pelvis, spine, chest) have been posed. Returns nothing; writes upper/lower/foot/toe rotations.
   */
  plant(ctx: PoseCtx, k: LegKey, off: FootOffset): void {
    const leg = this.legs[k];
    const w = this.skel.fk(ctx.pose);
    const pr = w.rot[leg.idx.parent]!;
    const P0 = w.pos[leg.idx.upper]!;
    const target: Vec3 = vadd(leg.p2, [off.dx ?? 0, off.dy, off.dz]);
    const side: Vec3 = qrotate(pr, [1, 0, 0]);
    const { mid, end } = twoBoneIK(P0, target, leg.l1, leg.l2, leg.pole);
    const rUpper = aimQuat(vsub(leg.p1, leg.p0), [1, 0, 0], vsub(mid, P0), side);
    const rLower = aimQuat(vsub(leg.p2, leg.p1), [1, 0, 0], vsub(end, mid), side);
    const rFoot: Quat = qx(off.pitch);
    ctx.pose.rot[leg.idx.upper] = localFromWorld(pr, rUpper);
    ctx.pose.rot[leg.idx.lower] = localFromWorld(rUpper, rLower);
    ctx.pose.rot[leg.idx.foot] = localFromWorld(rLower, rFoot);
    if (leg.idx.toe >= 0) ctx.pose.rot[leg.idx.toe] = qx(off.toe ?? 0);
  }

  /** plant all four feet at rest (idle, attack wind-up...) optionally with per-leg offsets */
  plantAll(ctx: PoseCtx, offs: Partial<Record<LegKey, FootOffset>> = {}): void {
    for (const k of ['fl', 'fr', 'hl', 'hr'] as LegKey[]) this.plant(ctx, k, offs[k] ?? { dz: 0, dy: 0, pitch: 0 });
  }

  /** evaluate a gait at normalised time u: all four feet */
  gait(ctx: PoseCtx, g: GaitSpec, u: number, extraY = 0): void {
    for (const k of ['fl', 'fr', 'hl', 'hr'] as LegKey[]) {
      const front = k[0] === 'f';
      const f = footCycle(u + g.phases[k], g.duty, front ? g.sweep.front : g.sweep.hind, front ? g.lift.front : g.lift.hind, g.pawLen, g.curl);
      this.plant(ctx, k, { dz: f.dz, dy: f.dy + extraY, pitch: f.pitch, toe: front ? 0 : f.pitch * 0.5 });
    }
  }
}

/** sinusoid helper: sin(2π(u*cycles + phase)) */
export const wave = (u: number, cycles = 1, phase = 0): number => Math.sin(2 * Math.PI * (u * cycles + phase));
export const cwave = (u: number, cycles = 1, phase = 0): number => Math.cos(2 * Math.PI * (u * cycles + phase));
export { clamp01, smoothstep };
