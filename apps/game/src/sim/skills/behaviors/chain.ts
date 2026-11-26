// chain — lightning that jumps to the nearest unhit enemy within `area`, `count` hits in total, 12% weaker per jump.

import { hitEnemy } from '../../combat';
import { aim, aimOut, beginHit, explodeAt, facingX, facingZ, finishCast } from '../common';
import type { Behavior } from '../types';

const FALLOFF = 0.88;
const visited = new Uint32Array(32);

export const chain: Behavior = {
  cast(w, p, s, fp) {
    const range = fp.range > 0 ? fp.range : 10;
    const e = w.enemies;
    let row = -1;
    let dx = facingX(p);
    let dz = facingZ(p);
    if (p.manualAim) {
      dx = p.hasAim ? p.aimX : facingX(p);
      dz = p.hasAim ? p.aimZ : facingZ(p);
      // Pick the first enemy in a forward cone along the player's cursor aim (never behind the player).
      const n = w.hash.queryCircle(e, p.x, p.z, range, w.qa);
      let bestScore = Infinity;
      for (let i = 0; i < n; i++) {
        const r = w.qa[i] as number;
        const vx = (e.x[r] as number) - p.x;
        const vz = (e.z[r] as number) - p.z;
        const d = Math.hypot(vx, vz);
        if (d < 1e-4) continue;
        const dot = (vx * dx + vz * dz) / d;
        if (dot < 0.45) continue;
        const score = d * (1.4 - dot);
        if (score < bestScore) {
          bestScore = score;
          row = r;
        }
      }
      if (row < 0) {
        const endX = p.x + dx * Math.min(range * 0.75, 7);
        const endZ = p.z + dz * Math.min(range * 0.75, 7);
        w.bus.vfxLine(s.def.vfx, p.x, p.z, endX, endZ, 1, 0.22, fp.element);
        finishCast(w, p, s, fp, p.x, p.z, dx, dz);
        return true;
      }
    } else {
      row = aim(w, p, range);
      if (row < 0) return false;
      dx = aimOut.dx;
      dz = aimOut.dz;
    }
    const hops = Math.min(visited.length, fp.count);
    const jump = Math.max(2, fp.area);
    let fromX = p.x;
    let fromZ = p.z;
    let dmg = fp.damage;
    let used = 0;
    while (row >= 0 && used < hops) {
      const tx = e.x[row] as number;
      const tz = e.z[row] as number;
      visited[used++] = e.id[row] as number;
      w.bus.vfxLine(s.def.vfx, fromX, fromZ, tx, tz, 1, 0.22, fp.element);
      const c = beginHit(p, s, fp, fromX, fromZ);
      hitEnemy(w, row, dmg, c);
      fromX = tx;
      fromZ = tz;
      dmg *= FALLOFF;
      // nearest enemy not yet hit
      const n = w.hash.queryCircle(e, tx, tz, jump, w.qa);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const r = w.qa[i] as number;
        const id = e.id[r] as number;
        let seen = false;
        for (let k = 0; k < used; k++) {
          if (visited[k] === id) {
            seen = true;
            break;
          }
        }
        if (seen) continue;
        const d = ((e.x[r] as number) - tx) ** 2 + ((e.z[r] as number) - tz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
      row = best;
    }
    explodeAt(w, p, s, fp, fromX, fromZ);
    finishCast(w, p, s, fp, p.x, p.z, dx, dz);
    return true;
  },
};
