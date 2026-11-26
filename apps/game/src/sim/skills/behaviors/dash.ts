// dash — burst of forced movement with i-frames; everything touched along the path is hit once.

import { hitEnemy } from '../../combat';
import type { PlayerState, SkillInstance } from '../../stores';
import type { World } from '../../world';
import { aimOrManual, aimOut, beginHit, finishCast, stampHit } from '../common';
import type { FinalParams } from '../params';
import type { Behavior } from '../types';

export const dash: Behavior = {
  cast(w, p, s, fp) {
    const dist = Math.max(2, fp.range);
    // dash when something threatening is close enough to matter (or manually triggered)
    if (!aimOrManual(w, p, dist + 4)) return false;
    let dx = p.moveX;
    let dz = p.moveZ;
    const m = Math.hypot(dx, dz);
    if (m > 0.1) {
      dx /= m;
      dz /= m;
    } else {
      dx = aimOut.dx;
      dz = aimOut.dz;
    }
    const speed = Math.max(8, fp.speed);
    const t = dist / speed;
    p.dashT = t;
    p.dashVx = dx * speed;
    p.dashVz = dz * speed;
    p.dashSlot = s.slot;
    p.iframes = Math.max(p.iframes, t + 0.12);
    p.clip = 'dash';
    p.clipT = 0;
    w.bus.vfxLine(s.def.vfx, p.x, p.z, p.x + dx * dist, p.z + dz * dist, fp.area, t + 0.2, fp.element);
    finishCast(w, p, s, fp, p.x, p.z, dx, dz);
    return true;
  },
  update(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams) {
    if (p.dashT <= 0 || p.dashSlot !== s.slot) return;
    const e = w.enemies;
    const n = w.hash.queryCircle(e, p.x, p.z, Math.max(0.8, fp.area), w.qa);
    if (n === 0) return;
    const c = beginHit(p, s, fp, p.x - p.dashVx * 0.05, p.z - p.dashVz * 0.05);
    for (let i = 0; i < n; i++) {
      const row = w.qa[i] as number;
      if (stampHit(w, row, s.slot, 0.3)) hitEnemy(w, row, fp.damage, c);
    }
  },
};
