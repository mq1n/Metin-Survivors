// persistentAura — permanent damaging ring that follows the hero; kept in sync with the skill's live parameters.

import { ZoneKind } from '../../stores';
import { spawnZone } from '../common';
import type { Behavior } from '../types';

const FOREVER = 1e9;

export const persistentAura: Behavior = {
  passive: true,
  cast() {
    return false;
  },
  update(w, p, s, fp) {
    const tick = fp.tick > 0 ? fp.tick : 0.5;
    let row = s.h1 === 0 ? -1 : w.zones.find(s.h1);
    if (row < 0) {
      row = spawnZone(w, {
        kind: ZoneKind.Aura,
        team: 0,
        x: p.x,
        z: p.z,
        radius: fp.area,
        dur: FOREVER,
        tick,
        damage: fp.damage,
        knock: fp.knockback,
        follow: p.index + 1,
        preset: s.def.vfx,
        element: fp.element,
        owner: p.index,
        skill: s.slot,
        firstTick: tick,
      });
      s.h1 = row >= 0 ? (w.zones.id[row] as number) : 0;
      if (row >= 0) w.bus.skillCast(p.index, s.slot, s.def.id, s.def.behavior, p.x, p.z, 0, 1, fp.area, fp.awakened, s.def.heroClip ?? '');
    }
    if (row >= 0) {
      w.zones.radius[row] = fp.area;
      w.zones.tick[row] = tick;
      w.zones.damage[row] = fp.damage;
      w.zones.knock[row] = fp.knockback;
    }
  },
};
