
// _blow), all driven here without a sim edit:
//   MAKING   `enemyAttack` kind 1 (ranged, fired by the sim at the START of the wind-up) -> the charge at the enemy's hand
//            (`sk.gen.ep_making_<look>`, element from the attack's projectile name, sized by the enemy)
//   THROW    the projectile body is drawn by render/fx/projectiles.ts; that renderer also sees every hostile projectile appear
//            and vanish in the feed and queues them (render/fx/projectileEvents.ts)
//   RELEASE  a queued Launch -> `sk.gen.ep_release_<look>` at the projectile head, at the REAL launch moment (the old muzzle fired
//            0.5 s early as two red rods at the start of the wind-up: nothing happened when the ball actually left)
//   BLOW     a queued Blow -> `sk.gen.ep_blow_<look>` under the vanishing projectile (a hit on the hero, full size; a fizzle
//            elsewhere, small)
// `enemy.muzzle` (the legacy id the alias `vfx_enemy_bolt` points at) stays a registered preset (presets_feedback.ts, rebuilt as
// a soft flash) and is used by the dev tools; the route no longer fires it at the wind-up start.
import enemiesJson from '../../../data/content/enemies.json';
import bossesJson from '../../../data/content/bosses.json';
import { drainProjEvents, clearProjEvents, ProjEventKind, type ProjEvent } from '../../../render/fx/projectileEvents';
import { route, type EventRoute, type RouteCtx } from '../route';
import { epLookOf, epLookOfName, type EpLook } from './looks';
import { BLOW_ID, MAKING_ID, RELEASE_ID } from './specs';

/** sim `AttackKind` index of a ranged attack */
const KIND_RANGED = 1;

interface RangedInfo {
  look: EpLook;
  windup: number;
  /** enemy size factor (def.scale) */
  scale: number;
}
interface TypeDef {
  scale?: number;
  attacks?: Array<{ kind: string; windup?: number; projectile?: { vfx?: string } }>;
}

/**
 * Per sim enemy `type` index (world.typeDefs = [...enemies, ...bosses], sim/content.ts) the look / wind-up / size of its ranged
 * attack. Built from the same content JSON the loader imports (one module instance, no extra bytes). Types without a ranged
 * attack are `undefined`.
 */
export function buildRangedTable(enemies: readonly TypeDef[], bosses: readonly TypeDef[]): Array<RangedInfo | undefined> {
  const out: Array<RangedInfo | undefined> = [];
  for (const d of [...enemies, ...bosses]) {
    const a = d.attacks?.find((x) => x.kind === 'ranged');
    out.push(a ? { look: epLookOfName(a.projectile?.vfx ?? ''), windup: a.windup ?? 0.5, scale: d.scale ?? 1 } : undefined);
  }
  return out;
}

let table: Array<RangedInfo | undefined> | null = null;
function rangedTable(): Array<RangedInfo | undefined> {
  if (table === null) table = buildRangedTable(enemiesJson as unknown as TypeDef[], bossesJson as unknown as TypeDef[]);
  return table;
}

/** budgets per VFX frame (scaled by the quality density): a boss ring launches / expires 20+ projectiles in one tick */
const MAX_RELEASE = 3;
const MAX_BLOW_HIT = 4;
const MAX_BLOW_FIZZLE = 3;
/** hit blows: a burst of 5, then 9 per second; fizzles: 3, then 6 per second (the bucket only thins a crowd, a single caster never notices it) */
const HIT_TOKENS = 5;
const HIT_REFILL = 9;
const FIZZLE_TOKENS = 3;
const FIZZLE_REFILL = 6;
/** events farther than this from every player are dropped (not on screen) */
const FAR2 = 34 * 34;

export function enemyProjectileRoutes(): readonly EventRoute[] {
  // token buckets over time: a volley that lands on the hero in one second (12-40 casters) must not stack 12 full additive blows into a
  // white-pastel mush; the first blows play at full size, the rest are thinned (and shrink while the bucket is low)
  let hitTok = HIT_TOKENS;
  let fizTok = FIZZLE_TOKENS;
  // charges started in the last second (decays): 30+ casters winding up at once get smaller glowing spheres so they stay countable, not a wall
  let makingRecent = 0;
  const onEvent = (e: ProjEvent, ctx: RouteCtx, used: { r: number; h: number; f: number }): void => {
    // not near any player: not on screen, skip (also avoids a blow storm when a run ends and the feed empties)
    let near = false;
    const p = ctx.players;
    for (let i = 0; i < 4; i++) {
      const dx = (p[i * 3] as number) - e.x;
      const dz = (p[i * 3 + 2] as number) - e.z;
      if (dx * dx + dz * dz < FAR2) {
        near = true;
        break;
      }
    }
    if (!near) return;
    const look = epLookOf(e.look);
    const dens = Math.max(0.5, ctx.density);
    if (e.kind === ProjEventKind.Launch) {
      if (used.r >= Math.ceil(MAX_RELEASE * dens)) return;
      used.r++;
      const o = ctx.o(e.x, e.z, Math.min(1.5, Math.max(0.7, e.radius / 0.35)), e.dirX, e.dirZ);
      o.y = e.y;
      ctx.fire(RELEASE_ID(look), o);
    } else {
      const hit = e.hit;
      if (hit ? used.h >= Math.ceil(MAX_BLOW_HIT * dens) : used.f >= Math.ceil(MAX_BLOW_FIZZLE * dens)) return;
      if (hit ? hitTok < 1 : fizTok < 1) return;
      // the fewer tokens are left, the smaller the blow (a volley of 12 casters lands as 12 readable small blows, not one fused cloud)
      const thin = hit ? Math.min(1, 0.62 + 0.38 * Math.min(1, hitTok / 3)) : 1;
      if (hit) {
        used.h++;
        hitTok -= 1;
      } else {
        used.f++;
        fizTok -= 1;
      }
      // the blow lands on the ground under the projectile; its elements carry the 0.9 m body height
      const o = ctx.o(e.x, e.z, (hit ? 1.0 : 0.5) * thin * Math.min(1.5, Math.max(0.75, e.radius / 0.35)), e.dirX, e.dirZ);
      ctx.fire(BLOW_ID(look), o);
    }
  };

  return [
    route(
      ['enemyAttack'],
      (e, ctx) => {
        // 0 melee, 1 ranged, 2 charge, 3 leap, 4 explode, 5 aura, 6 breath
        if (e.kind !== KIND_RANGED) return;
        const info = rangedTable()[e.type];
        // an unknown type (a dev tool, a mod): the legacy soft muzzle at the enemy, as before
        if (info === undefined) {
          ctx.fire('enemy.muzzle', ctx.o(e.x, e.z, 1, e.dirX, e.dirZ));
          return;
        }
        const crowd = 1 - 0.42 * Math.min(1, Math.max(0, (makingRecent - 5) / 24));
        makingRecent += 1;
        const s = Math.min(1.8, Math.max(0.8, info.scale)) * crowd;
        const o = ctx.o(e.x, e.z, s, e.dirX, e.dirZ);
        ctx.fire(MAKING_ID(info.look), o);
      },
      {
        update: (dt, ctx) => {
          makingRecent = Math.max(0, makingRecent - 14 * dt);
          hitTok = Math.min(HIT_TOKENS, hitTok + HIT_REFILL * dt);
          fizTok = Math.min(FIZZLE_TOKENS, fizTok + FIZZLE_REFILL * dt);
          const used = { r: 0, h: 0, f: 0 };
          drainProjEvents((e) => onEvent(e, ctx, used));
        },
        reset: () => clearProjEvents(),
      },
    ),
  ];
}
