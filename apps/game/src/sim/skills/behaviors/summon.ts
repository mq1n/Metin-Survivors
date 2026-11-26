// summon — `count` spirit familiars that chase enemies and strike them every `tick` for `duration` seconds.
// A skill with a content `role` (orbiter / coil / hunter / planted / mimic) delegates to its companion brain in
// skills/companions.ts; the chaser below is the default role and the fallback of a role without a brain.

import { ProjKind } from '../../stores';
import { aimOrManual, finishCast, spawnProjectile } from '../common';
import { roleCast, roleUpdate } from '../companions';
import type { Behavior } from '../types';

const TAU = Math.PI * 2;

export const summon: Behavior = {
  cast(w, p, s, fp) {
    if (s.def.role) {
      const done = roleCast(w, p, s, fp);
      if (done !== null) return done;
    }
    const range = fp.range > 0 ? fp.range : 9;
    if (!aimOrManual(w, p, range + 4)) return false;
    const store = w.projectiles;
    for (let i = store.count - 1; i >= 0; i--) {
      if (store.kind[i] === ProjKind.Familiar && store.skill[i] === s.slot) store.free(i);
    }
    const life = Math.max(3, fp.duration);
    const speed = fp.speed > 0 ? fp.speed : 6.5;
    const strikeR = fp.area > 0 ? fp.area : 1.3;
    const tick = fp.tick > 0 ? fp.tick : 0.7;
    for (let i = 0; i < fp.count; i++) {
      const a = (i / fp.count) * TAU + p.rot;
      const r = spawnProjectile(w, {
        kind: ProjKind.Familiar,
        x: p.x + Math.sin(a) * 1.4,
        z: p.z + Math.cos(a) * 1.4,
        vx: 0,
        vz: 0,
        radius: 0.5,
        life,
        damage: fp.damage,
        element: fp.element,
        owner: p.index,
        skill: s.slot,
        pierce: 255,
        preset: s.def.vfx,
        knock: fp.knockback,
        h: 0.9,
      });
      if (r >= 0) {
        store.aux[r] = speed;
        store.aux2[r] = tick * (0.4 + 0.2 * i); // first strike soon, staggered
        store.orbitA[r] = strikeR;
        store.orbitR[r] = tick;
        store.orbitW[r] = range;
      }
    }
    w.bus.vfx(s.def.vfx, p.x, p.z, 0, 1, 2.5, 0.6, fp.element);
    finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
    return true;
  },
  update(w, p, s, fp) {
    if (s.def.role) roleUpdate(w, p, s, fp);
  },
};
