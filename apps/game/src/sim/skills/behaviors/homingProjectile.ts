// homingProjectile — like projectile, but each bolt steers toward its target (see skills/projectiles.ts).

import { ProjKind } from '../../stores';
import type { Behavior } from '../types';
import { fireBolts } from './projectile';

export const homingProjectile: Behavior = {
  cast: (w, p, s, fp) => fireBolts(w, p, s, fp, ProjKind.Homing),
};
