// Ambient route (C0 split of the old EventAdapter.onEnemyAttack, kinds 2 / 3): charge and leap dust kicks.
import { route, type EventRoute } from '../route';

export function ambientRoutes(): readonly EventRoute[] {
  return [
    route(['enemyAttack'], (e, ctx) => {
      if (e.kind === 2) ctx.fire('enemy.charge', ctx.o(e.x, e.z, 1, e.dirX, e.dirZ));
      else if (e.kind === 3) ctx.fire('enemy.leap', ctx.o(e.x, e.z, 1, e.dirX, e.dirZ));
    }),
  ];
}
