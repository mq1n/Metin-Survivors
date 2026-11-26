// meleeArc — sword swing in front of the hero: hits everything inside `area` within ±angle/2 of the aim.

import { hitEnemy } from '../../combat';
import { SchedKind } from '../../scheduler';
import type { PlayerState, SkillInstance } from '../../stores';
import type { World } from '../../world';
import { aim, aimOrManual, aimOut, beginHit, finishCast, inEcho } from '../common';
import type { FinalParams } from '../params';
import type { Behavior } from '../types';

const DEFAULT_ARC = 2.0;

function swing(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, dx: number, dz: number, mirror: number): void {
  const reach = Math.max(0.8, fp.area);
  const half = (fp.angle > 0 ? fp.angle : DEFAULT_ARC) / 2;
  const cosHalf = Math.cos(half);
  const e = w.enemies;
  const n = w.hash.queryCircle(e, p.x, p.z, reach, w.qa);
  const c = beginHit(p, s, fp, p.x, p.z);
  for (let i = 0; i < n; i++) {
    const row = w.qa[i] as number;
    const vx = (e.x[row] as number) - p.x;
    const vz = (e.z[row] as number) - p.z;
    const d = Math.hypot(vx, vz);
    const body = e.radius[row] as number;
    // enemies hugging the hero are always inside the arc
    if (d > body + 0.45 && (vx * dx + vz * dz) / d < cosHalf) continue;
    hitEnemy(w, row, fp.damage, c);
  }
  // mirror = ±1 flips the visual swing direction for combos (vfx reads the sign of `scale` as handedness)
  w.bus.vfx(s.def.vfx, p.x, p.z, dx, dz, reach * mirror, 0.28, fp.element);
}

export const meleeArc: Behavior = {
  cast(w, p, s, fp) {
    const trigger = Math.max(fp.range, fp.area);
    if (!aimOrManual(w, p, trigger)) return false;
    const dx = aimOut.dx;
    const dz = aimOut.dz;
    swing(w, p, s, fp, dx, dz, 1);
    if (!inEcho()) {
      for (let k = 1; k < fp.count; k++) {
        w.sched.add(w.time + 0.14 * k, SchedKind.Swing, p.index, s.slot, k, p.x, p.z, dx, dz, 0);
      }
    }
    finishCast(w, p, s, fp, p.x, p.z, dx, dz);
    return true;
  },
  pulse(w, p, s, fp, dx, dz, n) {
    // In manual mode keep player cursor/cast aim; in auto mode re-aim at nearest enemy so combos track moving targets.
    if (p.manualCast) {
      const ax = p.hasAim ? p.aimX : dx;
      const az = p.hasAim ? p.aimZ : dz;
      swing(w, p, s, fp, ax, az, n % 2 === 0 ? 1 : -1);
      return;
    }
    const row = aim(w, p, Math.max(fp.range, fp.area));
    const ax = row >= 0 ? aimOut.dx : dx;
    const az = row >= 0 ? aimOut.dz : dz;
    swing(w, p, s, fp, ax, az, n % 2 === 0 ? 1 : -1);
  },
};
