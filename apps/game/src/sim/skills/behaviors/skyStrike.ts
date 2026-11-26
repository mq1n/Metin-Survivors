// skyStrike — `count` delayed blasts dropped on random enemies within range (Strike zones render the falling mark).

import { ZoneKind } from '../../stores';
import { facingX, facingZ, finishCast, spawnZone } from '../common';
import type { Behavior } from '../types';

const BASE_DELAY = 0.42;

export const skyStrike: Behavior = {
  cast(w, p, s, fp) {
    const range = fp.range > 0 ? fp.range : 12;
    if (p.manualAim) {
      const dx = p.hasAim ? p.aimX : facingX(p);
      const dz = p.hasAim ? p.aimZ : facingZ(p);
      const dist = Math.min(range * 0.6, 5.5);
      const stagger = fp.tick > 0 ? fp.tick : 0.12;
      const rng = w.rng.combat;
      for (let i = 0; i < fp.count; i++) {
        const delay = BASE_DELAY + i * stagger;
        const j = i === 0 ? 0 : 1.1;
        spawnZone(w, {
          kind: ZoneKind.Strike,
          team: 0,
          x: p.x + dx * dist + (j ? rng.range(-j, j) : 0),
          z: p.z + dz * dist + (j ? rng.range(-j, j) : 0),
          radius: fp.area,
          dur: delay + 0.35,
          delay,
          tick: 0,
          damage: fp.damage,
          knock: fp.knockback,
          preset: s.def.vfx,
          element: fp.element,
          owner: p.index,
          skill: s.slot,
        });
      }
      finishCast(w, p, s, fp, p.x, p.z, dx, dz);
      return true;
    }
    const n = w.hash.queryCircle(w.enemies, p.x, p.z, range, w.qa);
    if (n === 0) return false;
    const e = w.enemies;
    const rng = w.rng.combat;
    const stagger = fp.tick > 0 ? fp.tick : 0.12;
    const picks = Math.min(fp.count, n);
    // partial Fisher–Yates over the candidate list: distinct targets first, repeats only when there are fewer enemies
    for (let i = 0; i < fp.count; i++) {
      let row: number;
      if (i < picks) {
        const j = i + rng.int(n - i);
        const t = w.qa[i] as number;
        w.qa[i] = w.qa[j] as number;
        w.qa[j] = t;
        row = w.qa[i] as number;
      } else {
        row = w.qa[rng.int(n)] as number;
      }
      const jitter = i >= picks ? 1.2 : 0;
      const x = (e.x[row] as number) + (jitter ? rng.range(-jitter, jitter) : 0);
      const z = (e.z[row] as number) + (jitter ? rng.range(-jitter, jitter) : 0);
      const delay = BASE_DELAY + i * stagger;
      spawnZone(w, {
        kind: ZoneKind.Strike,
        team: 0,
        x,
        z,
        radius: fp.area,
        dur: delay + 0.35,
        delay,
        tick: 0,
        damage: fp.damage,
        knock: fp.knockback,
        preset: s.def.vfx,
        element: fp.element,
        owner: p.index,
        skill: s.slot,
      });
    }
    finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
    return true;
  },
};
