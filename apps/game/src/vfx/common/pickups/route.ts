// Pickup + chest routes (C0 split of the old EventAdapter.onPickup / onChest) with the C1 enum fix.
import { XP_TIER_COLORS } from '../../palette';
import { route, type EventRoute } from '../route';

/** sim PickupKind (sim/stores.ts; const enum, mirrored here — pickupRoute test pins the values) */
export const PICKUP = { xp: 0, yeop: 1, heal: 2, chest: 3, magnet: 4 } as const;
/** xp / yeop collect sparkles per VFX frame at density 1 */
export const XP_BUDGET = 60;

export function pickupRoutes(): readonly EventRoute[] {
  let budget = 0;
  return [
    route(
      ['pickup'],
      (e, ctx) => {
        const o = ctx.o(e.x, e.z, 1);
        switch (e.kind) {
          case PICKUP.xp:
            if (budget-- <= 0) return;
            o.color = XP_TIER_COLORS[e.tier < 0 ? 0 : e.tier > 4 ? 4 : e.tier];
            ctx.fire('pickup.xp', o);
            break;
          case PICKUP.yeop:
            if (budget-- <= 0) return;
            ctx.fire('pickup.yeop', o);
            break;
          case PICKUP.heal:
            
            ctx.fire('sk.gen.potion_red', o);
            break;
          case PICKUP.magnet:
            // C1: the magnet used to be read as kind 3 (= chest) and drew nothing on a real magnet
            ctx.fire('pickup.magnet', o);
            break;
          case 5:
            ctx.fire('pickup.shard', o);
            break;
          default:
            // PICKUP.chest: the chestOpen event plays the chest burst (C1: it used to draw the 26 m magnet slab here)
            break;
        }
      },
      { update: (_dt, ctx) => void (budget = XP_BUDGET * ctx.density) },
    ),
    route(['chestOpen'], (e, ctx) => {
      ctx.fire(e.boss ? 'chest.open.boss' : 'chest.open', ctx.o(e.x, e.z, 1));
    }),
  ];
}
