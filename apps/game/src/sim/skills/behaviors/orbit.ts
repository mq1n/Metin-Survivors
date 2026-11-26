// orbit — `count` orbitals circle the hero for `duration`; contact hits are gated per enemy by `tick`.

import { ProjKind } from '../../stores';
import { aimOrManual, finishCast, spawnProjectile } from '../common';
import type { Behavior } from '../types';

const TAU = Math.PI * 2;

export const orbit: Behavior = {
  cast(w, p, s, fp) {
    // only re-summon when the previous set is gone/expiring and enemies are around
    if (s.aux > w.time + 0.2) return false;
    if (!aimOrManual(w, p, 18)) return false;
    const store = w.projectiles;
    for (let i = store.count - 1; i >= 0; i--) {
      if (store.kind[i] === ProjKind.Orbit && store.skill[i] === s.slot) store.free(i);
    }
    const orbitR = fp.range > 0 ? fp.range : fp.area * 2.5;
    const hitR = fp.range > 0 ? Math.max(0.4, fp.area) : 0.7;
    const life = Math.max(2, fp.duration);
    const omega = fp.speed > 0 ? fp.speed : 3.2;
    for (let i = 0; i < fp.count; i++) {
      const a = (i / fp.count) * TAU;
      const r = spawnProjectile(w, {
        kind: ProjKind.Orbit,
        x: p.x + Math.sin(a) * orbitR,
        z: p.z + Math.cos(a) * orbitR,
        vx: 0,
        vz: 0,
        radius: hitR,
        life,
        damage: fp.damage,
        element: fp.element,
        owner: p.index,
        skill: s.slot,
        pierce: 255,
        preset: s.def.vfx,
        knock: fp.knockback,
        h: 1.1,
      });
      if (r >= 0) {
        store.orbitA[r] = a;
        store.orbitR[r] = orbitR;
        store.orbitW[r] = omega;
        store.aux[r] = fp.tick > 0 ? fp.tick : 0.45;
      }
    }
    s.aux = w.time + life;
    finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
    return true;
  },
};
