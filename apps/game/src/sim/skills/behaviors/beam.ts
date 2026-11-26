// beam — a sustained ray from the hero that slowly turns toward the nearest enemy and ticks damage along its length.

import { ZoneKind } from '../../stores';
import { aimOrManual, aimOut, finishCast, spawnZone } from '../common';
import type { Behavior } from '../types';

export const beam: Behavior = {
  cast(w, p, s, fp) {
    const length = fp.range > 0 ? fp.range : 9;
    if (!aimOrManual(w, p, length)) return false;
    const dur = Math.max(1, fp.duration);
    const rot = Math.atan2(aimOut.dx, aimOut.dz);
    const existing = s.h1 === 0 ? -1 : w.zones.find(s.h1);
    if (existing >= 0) {
      w.zones.t[existing] = 0;
      w.zones.dur[existing] = dur;
      w.zones.rot[existing] = rot;
      w.zones.radius[existing] = Math.max(0.4, fp.area);
      w.zones.length[existing] = length;
      w.zones.tick[existing] = fp.tick > 0 ? fp.tick : 0.2;
      w.zones.damage[existing] = fp.damage;
      w.zones.knock[existing] = fp.knockback;
      w.zones.aux[existing] = fp.speed > 0 ? fp.speed : 3.5;
    } else {
      const r = spawnZone(w, {
        kind: ZoneKind.Beam,
        team: 0,
        x: p.x,
        z: p.z,
        rot,
        radius: Math.max(0.4, fp.area),
        length,
        dur,
        tick: fp.tick > 0 ? fp.tick : 0.2,
        damage: fp.damage,
        knock: fp.knockback,
        follow: p.index + 1,
        preset: s.def.vfx,
        element: fp.element,
        owner: p.index,
        skill: s.slot,
        aux: fp.speed > 0 ? fp.speed : 3.5,
      });
      s.h1 = r >= 0 ? (w.zones.id[r] as number) : 0;
    }
    finishCast(w, p, s, fp, p.x, p.z, aimOut.dx, aimOut.dz);
    return true;
  },
};
