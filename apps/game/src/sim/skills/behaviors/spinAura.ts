// spinAura — timed ring of blades around the hero (a Spin zone that follows the player).

import { ZoneKind } from '../../stores';
import { aimOrManual, finishCast, spawnZone } from '../common';
import type { Behavior } from '../types';

export const spinAura: Behavior = {
  cast(w, p, s, fp) {
    if (!aimOrManual(w, p, Math.max(fp.range, fp.area + 1.5))) return false;
    const dur = Math.max(1, fp.duration);
    const row = s.h1 === 0 ? -1 : w.zones.find(s.h1);
    if (row >= 0) {
      w.zones.t[row] = 0;
      w.zones.dur[row] = dur;
      w.zones.radius[row] = fp.area;
      w.zones.tick[row] = fp.tick > 0 ? fp.tick : 0.3;
      w.zones.damage[row] = fp.damage;
      w.zones.knock[row] = fp.knockback;
    } else {
      const r = spawnZone(w, {
        kind: ZoneKind.Spin,
        team: 0,
        x: p.x,
        z: p.z,
        radius: fp.area,
        dur,
        tick: fp.tick > 0 ? fp.tick : 0.3,
        damage: fp.damage,
        knock: fp.knockback,
        follow: p.index + 1,
        preset: s.def.vfx,
        element: fp.element,
        owner: p.index,
        skill: s.slot,
      });
      s.h1 = r >= 0 ? (w.zones.id[r] as number) : 0;
    }
    finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
    return true;
  },
};
