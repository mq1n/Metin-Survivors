// groundZone — lingering damaging ground placed on the densest enemy cluster within `range`.

import { ZoneKind } from '../../stores';
import { facingX, facingZ, finishCast, pickClusterTarget, spawnZone } from '../common';
import type { Behavior } from '../types';

export const groundZone: Behavior = {
  cast(w, p, s, fp) {
    const range = fp.range > 0 ? fp.range : 10;
    let cx: number;
    let cz: number;
    let castDx = Math.sin(p.rot);
    let castDz = Math.cos(p.rot);
    if (p.manualAim) {
      castDx = p.hasAim ? p.aimX : facingX(p);
      castDz = p.hasAim ? p.aimZ : facingZ(p);
      const dist = Math.min(range * 0.6, 5.5);
      cx = p.x + castDx * dist;
      cz = p.z + castDz * dist;
    } else {
      // Dispel (purge > 0) sits on the densest metin-CORRUPTED cluster when there is one
      const target = pickClusterTarget(w, p.x, p.z, range, fp.purge > 0);
      if (target < 0) return false;
      const e = w.enemies;
      cx = e.x[target] as number;
      cz = e.z[target] as number;
    }
    const rng = w.rng.combat;
    const tick = fp.tick > 0 ? fp.tick : 0.5;
    const dur = Math.max(1, fp.duration);
    for (let i = 0; i < fp.count; i++) {
      const a = rng.angle();
      const off = i === 0 ? 0 : fp.area * (0.9 + rng.next() * 0.6);
      spawnZone(w, {
        kind: ZoneKind.Circle,
        team: 0,
        x: cx + Math.sin(a) * off,
        z: cz + Math.cos(a) * off,
        radius: fp.area,
        dur,
        tick,
        damage: fp.damage,
        knock: fp.knockback,
        preset: s.def.vfx,
        element: fp.element,
        owner: p.index,
        skill: s.slot,
        firstTick: 0.15,
        // facing = caster → cluster, so zone effects know where the cast came from (sk.noxious_pall's incoming bolt)
        rot: Math.atan2(cx - p.x, cz - p.z),
      });
    }
    finishCast(w, p, s, fp, cx, cz, castDx, castDz);
    return true;
  },
};
