// projectile / homingProjectile — fan of bolts aimed at the nearest enemy.

import { ProjKind, type PlayerState, type SkillInstance } from '../../stores';
import type { World } from '../../world';
import { aimOrManual, aimOut, finishCast, spawnProjectile } from '../common';
import type { FinalParams } from '../params';
import type { Behavior } from '../types';

const DEFAULT_SPREAD = 0.18;
const DEFAULT_RANGE = 14;

export function fireBolts(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, kind: ProjKind): boolean {
  const range = fp.range > 0 ? fp.range : DEFAULT_RANGE;
  if (!aimOrManual(w, p, range)) return false;
  const base = Math.atan2(aimOut.dx, aimOut.dz);
  const n = fp.count;
  const spread = fp.angle > 0 ? fp.angle : DEFAULT_SPREAD;
  const speed = Math.max(3, fp.speed);
  const life = range / speed + 0.15;
  const radius = Math.max(0.25, fp.area);
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * spread;
    const vx = Math.sin(a) * speed;
    const vz = Math.cos(a) * speed;
    const r = spawnProjectile(w, {
      kind,
      x: p.x + Math.sin(a) * 0.8,
      z: p.z + Math.cos(a) * 0.8,
      vx,
      vz,
      radius,
      life,
      damage: fp.damage,
      element: fp.element,
      owner: p.index,
      skill: s.slot,
      pierce: fp.pierce,
      preset: s.def.vfx,
      knock: fp.knockback,
    });
    if (r >= 0 && kind === ProjKind.Homing) {
      // spread homing bolts over distinct targets when possible
      const target = w.hash.nearest(w.enemies, p.x + Math.sin(a) * 4, p.z + Math.cos(a) * 4, range);
      w.projectiles.target[r] = target >= 0 ? (w.enemies.id[target] as number) : 0;
    }
  }
  finishCast(w, p, s, fp, p.x, p.z, aimOut.dx, aimOut.dz);
  return true;
}

export const projectile: Behavior = {
  cast: (w, p, s, fp) => fireBolts(w, p, s, fp, ProjKind.Bolt),
};
