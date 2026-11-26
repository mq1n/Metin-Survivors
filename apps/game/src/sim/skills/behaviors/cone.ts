// cone — instant wedge of damage of length `range` (area fallback) and angle `angle`; `count` pulses.

import { healPlayer, hitEnemy } from '../../combat';
import { HealSource } from '../../events';
import { SchedKind } from '../../scheduler';
import type { PlayerState, SkillInstance } from '../../stores';
import type { World } from '../../world';
import { aim, aimOrManual, aimOut, beginHit, finishCast, inEcho } from '../common';
import type { FinalParams } from '../params';
import type { Behavior } from '../types';

const DEFAULT_ANGLE = 1.1;

function pulseOnce(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, dx: number, dz: number): void {
  const length = fp.range > 0 ? fp.range : fp.area;
  const half = (fp.angle > 0 ? fp.angle : DEFAULT_ANGLE) / 2;
  const cosHalf = Math.cos(half);
  const e = w.enemies;
  const n = w.hash.queryCircle(e, p.x, p.z, length, w.qa);
  const c = beginHit(p, s, fp, p.x, p.z);
  // Second Wind: the wounded hit harder (damage x (1 + missing x missing-HP fraction)) and heal by hitting (leech)
  const dmg = fp.missing > 0 && p.hpMax > 0 ? fp.damage * (1 + fp.missing * Math.max(0, 1 - p.hp / p.hpMax)) : fp.damage;
  let dealt = 0;
  for (let i = 0; i < n; i++) {
    const row = w.qa[i] as number;
    const vx = (e.x[row] as number) - p.x;
    const vz = (e.z[row] as number) - p.z;
    const d = Math.hypot(vx, vz);
    if (d > (e.radius[row] as number) + 0.45 && (vx * dx + vz * dz) / d < cosHalf) continue;
    dealt += hitEnemy(w, row, dmg, c);
  }
  if (fp.leech > 0 && dealt > 0) healPlayer(w, p, Math.min(dealt * fp.leech, p.hpMax * 0.15 + fp.heal), HealSource.Skill);
  w.bus.vfx(s.def.vfx, p.x, p.z, dx, dz, length, 0.4, fp.element);
}

export const cone: Behavior = {
  cast(w, p, s, fp) {
    const length = fp.range > 0 ? fp.range : fp.area;
    if (!aimOrManual(w, p, length)) return false;
    const dx = aimOut.dx;
    const dz = aimOut.dz;
    pulseOnce(w, p, s, fp, dx, dz);
    if (!inEcho()) {
      for (let k = 1; k < fp.count; k++) w.sched.add(w.time + 0.18 * k, SchedKind.Swing, p.index, s.slot, k, p.x, p.z, dx, dz, 0);
    }
    finishCast(w, p, s, fp, p.x, p.z, dx, dz);
    return true;
  },
  pulse(w, p, s, fp, dx, dz) {
    if (p.manualCast) {
      pulseOnce(w, p, s, fp, p.hasAim ? p.aimX : dx, p.hasAim ? p.aimZ : dz);
      return;
    }
    const row = aim(w, p, fp.range > 0 ? fp.range : fp.area);
    pulseOnce(w, p, s, fp, row >= 0 ? aimOut.dx : dx, row >= 0 ? aimOut.dz : dz);
  },
};
