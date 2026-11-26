// leap — hero jumps onto the densest cluster in range (untouchable in the air) and slams on landing.

import { SchedKind } from '../../scheduler';
import type { PlayerState, SkillInstance } from '../../stores';
import type { World } from '../../world';
import { aoeHit, explodeAt, facingX, facingZ, finishCast, pickClusterTarget } from '../common';
import type { FinalParams } from '../params';
import type { Behavior } from '../types';

export function leapLand(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, x: number, z: number): void {
  aoeHit(w, p, s, fp, x, z, Math.max(1.5, fp.area), fp.damage, Math.max(fp.knockback, 1.2));
  explodeAt(w, p, s, fp, x, z);
  w.bus.vfx(s.def.vfx, x, z, 0, 1, Math.max(1.5, fp.area), 0.5, fp.element);
  w.bus.shake(0.4, 0.3);
}

export const leap: Behavior = {
  cast(w, p, s, fp) {
    const range = fp.range > 0 ? fp.range : 9;
    if (p.manualAim) {
      const dx = p.hasAim ? p.aimX : facingX(p);
      const dz = p.hasAim ? p.aimZ : facingZ(p);
      return finishLeap(w, p, s, fp, dx, dz, Math.min(range * 0.72, 6));
    }
    const target = pickClusterTarget(w, p.x, p.z, range);
    if (target < 0) return false;
    const e = w.enemies;
    const dx = (e.x[target] as number) - p.x;
    const dz = (e.z[target] as number) - p.z;
    const full = Math.hypot(dx, dz);
    if (full < 1e-3) return false;
    return finishLeap(w, p, s, fp, dx, dz, Math.min(range, full));
  },
};

function finishLeap(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, dx: number, dz: number, dist: number): boolean {
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const speed = fp.speed > 0 ? fp.speed : 16;
  const t = Math.max(0.28, dist / speed);
  p.dashT = t;
  p.dashVx = (ux * dist) / t;
  p.dashVz = (uz * dist) / t;
  p.dashSlot = -1;
  p.iframes = Math.max(p.iframes, t + 0.15);
  p.clip = 'dash';
  p.clipT = 0;
  const lx = p.x + ux * dist;
  const lz = p.z + uz * dist;
  w.sched.add(w.time + t, SchedKind.LeapLand, p.index, s.slot, 0, lx, lz, ux, uz, 0);
  finishCast(w, p, s, fp, p.x, p.z, ux, uz);
  return true;
}
