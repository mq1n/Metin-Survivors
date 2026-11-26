// Boss routes (C0 split of the old EventAdapter.onBossSpawn / Phase / Death) with the C1 fixes and the round-1 additions:
//  - spawn / phase / enrage / death play at the boss's LIVE position (render world) with the element and size of the boss (look.ts);
//  - the enrage burst is de-duped against the `vfx_boss_enrage` alias;
//  - an enraged boss carries a TRACKED aura: the sim has no aura event, so the route re-spawns the short loop `boss.enrage` at the live boss

//    speed + heading, so the aura's smoke is born on the walking body and carries its velocity;
//  - a charging boss leaves its trail: the sim has no charge event either, so the route measures the boss's speed from the live position and
//    spawns short `boss.charge.trail` loops along the run while it is faster than CHARGE_SPEED (walking bosses move 3-6 m/s, charges 16-22 m/s).
import { route, type EventRoute, type RouteCtx } from '../route';
import { bossLook, bossScale } from './look';

/** seconds within which bossPhase(enrage) and the `vfx_boss_enrage` alias count as one burst */
export const ENRAGE_DEDUPE = 0.25;
/** the aura loop is re-spawned this often (s) and lives AURA_LIFE (s): consecutive loops overlap, the glow breathes */
export const AURA_EVERY = 0.45;
export const AURA_LIFE = 0.52;
/** a boss faster than this (m/s) for CHARGE_HOLD seconds is charging */
export const CHARGE_SPEED = 10;
export const CHARGE_HOLD = 0.1;
/** trail segments: a new short loop every TRAIL_EVERY s, each lives TRAIL_LIFE s */
export const TRAIL_EVERY = 0.2;
export const TRAIL_LIFE = 0.26;
/** a tracked boss that the render world no longer reports for this long (s) is dropped */
const LOST_AFTER = 3;
/** key of the tracker found by polling the world when no boss event registered one (a VFX reset dropped the keyed ones) */
const AMBIENT = -1;

interface Tracked {
  id: string;
  /** live position (updated every VFX frame while the render world reports the boss) */
  x: number;
  z: number;
  /** the point cached at bossSpawn: where an event plays when the render world has no live position (the core's fallback contract) */
  sx: number;
  sz: number;
  el: number;
  r: number;
  enraged: boolean;
  /** time to the next aura loop / trail segment */
  auraT: number;
  trailT: number;
  /** speed (m/s, smoothed) and heading of the live body */
  speed: number;
  hx: number;
  hz: number;
  fastT: number;
  lost: number;
}

export function bossRoutes(): readonly EventRoute[] {
  let bx = 0;
  let bz = 0;
  const live = { x: 0, y: 0, z: 0 };
  const tracked = new Map<number, Tracked>();
  /** look of the latest boss seen in an event (the ambient tracker has no id of its own) */
  let lastId = '';
  let poll = 0;

  const get = (boss: number, id: string, x: number, z: number): Tracked => {
    let t = tracked.get(boss);
    if (t === undefined) {
      const look = bossLook(id);
      t = { id, x, z, sx: x, sz: z, el: look.el, r: look.r, enraged: false, auraT: 0, trailT: 0, speed: 0, hx: 0, hz: 1, fastT: 0, lost: 0 };
      tracked.set(boss, t);
    }
    return t;
  };
  /** the boss position now: the live render position when the world reports one (searched from the last known point `x, z`), else the point cached at bossSpawn `fx, fz` */
  const pos = (ctx: RouteCtx, x: number, z: number, fx: number, fz: number): { x: number; z: number } => {
    if (ctx.bossPos(x, z, live)) return { x: live.x, z: live.z };
    return { x: fx, z: fz };
  };
  const o = (ctx: RouteCtx, x: number, z: number, r: number, el: number, scale = bossScale(r)) => {
    const q = ctx.o(x, z, scale);
    q.element = el;
    return q;
  };

  return [
    route(['bossSpawn'], (e, ctx) => {
      bx = e.x;
      bz = e.z;
      lastId = e.bossId;
      const t = get(e.boss, e.bossId, e.x, e.z);
      t.x = e.x;
      t.z = e.z;
      t.sx = e.x;
      t.sz = e.z;
      t.enraged = false;
      ctx.fire(e.final ? 'boss.spawn.final' : 'boss.spawn', o(ctx, e.x, e.z, t.r, t.el));
    }),
    route(['bossPhase'], (e, ctx) => {
      const t = get(e.boss, e.bossId, bx, bz);
      const p = pos(ctx, t.x, t.z, t.sx, t.sz);
      t.x = p.x;
      t.z = p.z;
      if (!e.enrage) {
        ctx.fire('boss.phase', o(ctx, p.x, p.z, t.r, t.el));
        return;
      }
      t.enraged = true;
      t.auraT = 0.15;
      if (ctx.once('boss.enrage.burst', ENRAGE_DEDUPE)) ctx.fire('boss.enrage.burst', o(ctx, p.x, p.z, t.r, t.el));
    }),
    route(
      ['bossDeath'],
      (e, ctx) => {
        const t = tracked.get(e.boss);
        const look = bossLook(e.bossId);
        tracked.delete(e.boss);
        ctx.fire(e.final ? 'boss.death.final' : 'boss.death', o(ctx, e.x, e.z, look.r, t?.el ?? look.el));
      },
      {
        // the tracked auras and trails: one tick per VFX frame, before the frame's events
        update(dt, ctx) {
          if (dt < 1e-4) return;
          // a keyed tracker supersedes the ambient one; with none, adopt the boss nearest to the hero (if the world has one)
          if (tracked.size > 1) tracked.delete(AMBIENT);
          if (tracked.size === 0) {
            // discovery is a scan of the whole crowd: 4 times a second is plenty
            if ((poll -= dt) > 0) return;
            poll = 0.25;
            if (!ctx.bossPos(ctx.players[0] as number, ctx.players[2] as number, live)) return;
            get(AMBIENT, lastId, live.x, live.z);
          }
          for (const [key, t] of tracked) {
            if (ctx.bossPos(t.x, t.z, live)) {
              const dx = live.x - t.x;
              const dz = live.z - t.z;
              const v = Math.hypot(dx, dz) / dt;
              // a teleport / spawn jump is not a run: ignore single-frame jumps above 60 m/s
              if (v < 60) {
                t.speed += (v - t.speed) * Math.min(1, dt * 14);
                if (v > 0.5) {
                  const l = Math.hypot(dx, dz);
                  t.hx = dx / l;
                  t.hz = dz / l;
                }
              }
              t.x = live.x;
              t.z = live.z;
              t.lost = 0;
            } else if ((t.lost += dt) > LOST_AFTER) {
              tracked.delete(key);
              continue;
            }
            if (t.enraged && (t.auraT -= dt) <= 0) {
              t.auraT += AURA_EVERY;
              // r3: the loop gets the body's speed and heading (like the charge trail): its smoke is born on the moving body and carries its velocity, so the aura
              // hugs a walking boss instead of trailing a body-width behind it (the blind critic of round 2, enragetrack t1.50 / t3.00)
              const walking = t.speed > 0.5;
              const q = walking ? ctx.o(t.x, t.z, bossScale(t.r), t.hx, t.hz) : ctx.o(t.x, t.z, bossScale(t.r));
              q.element = t.el;
              q.a = walking ? t.speed : 0;
              q.duration = AURA_LIFE;
              ctx.fire('boss.enrage', q);
            }
            if (t.speed > CHARGE_SPEED) {
              t.fastT += dt;
              if (t.fastT >= CHARGE_HOLD && (t.trailT -= dt) <= 0) {
                t.trailT += TRAIL_EVERY;
                const q = ctx.o(t.x, t.z, bossScale(t.r) * 1.1, t.hx, t.hz);
                q.element = t.el;
                q.duration = TRAIL_LIFE;
                q.a = t.speed;
                ctx.fire('boss.charge.trail', q);
              }
            } else {
              t.fastT = 0;
              t.trailT = 0;
            }
          }
        },
        reset() {
          tracked.clear();
        },
      },
    ),
  ];
}
