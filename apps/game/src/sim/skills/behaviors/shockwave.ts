// shockwave — expanding ring from the hero; every enemy the front passes is hit once and shoved outward.

import { ZoneKind } from '../../stores';
import { aimOrManual, finishCast, spawnZone } from '../common';
import type { Behavior } from '../types';

export const shockwave: Behavior = {
  cast(w, p, s, fp) {
    const trigger = Math.max(fp.range, fp.area * 0.6);
    if (!aimOrManual(w, p, trigger)) return false;
    const dur = fp.duration > 0 ? fp.duration : 0.55;
    spawnZone(w, {
      kind: ZoneKind.Shock,
      team: 0,
      x: p.x,
      z: p.z,
      radius: fp.area,
      dur: dur + 0.25,
      tick: 0,
      damage: fp.damage,
      knock: fp.knockback,
      preset: s.def.vfx,
      element: fp.element,
      owner: p.index,
      skill: s.slot,
      aux: dur,
      aux2: 0,
    });
    w.bus.shake(0.25, 0.25);
    finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
    return true;
  },
};
