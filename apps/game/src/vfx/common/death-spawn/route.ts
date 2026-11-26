// Death + spawn routes (C0 split of the old EventAdapter.onDeath / onSpawn; rebuilt r1 2026-10-19).

//   `setCreatureRadii`), throttled so a mass kill never becomes a fog bank (the corpses still show).
// - enemySpawn: monster_appear vortex for summons, spawn.elite / spawn.corrupt by source, and a cheap whisper for band / pack spawns.
import { route, type EventRoute, type RouteCtx } from '../route';

/** C1 #7: hook id for ring / band spawns (source 0). When the core registers a preset with this id it wins; until then the route plays
 *  the whisper `sk.gen.spawn_ring` (registering a new classic id needs a README row, a core file). */
export const SPAWN_RING = 'spawn.ring';
export const SPAWN_WHISPER_ID = 'sk.gen.spawn_ring';

/** per enemy type: collision radius ÷ model scale (m), pushed by simFeed.configureVfxEvents; empty = every creature is a 0.45 m one */
let radiusPerScale: ArrayLike<number> = [];
const DEFAULT_R = 0.45;

export function setCreatureRadii(table: ArrayLike<number>): void {
  radiusPerScale = table;
}

/** radius of a creature (m): type table x the event's scale (it already holds the tier / variance scale) */
export function creatureRadius(type: number, scale: number): number {
  const per = radiusPerScale[type];
  return (per !== undefined && per > 0 ? per : DEFAULT_R) * (scale > 0 ? scale : 1);
}

/** puff scale k of the death specs (authored for a 0.45 m creature at k = 1: peak puff ~1.5 m) from the creature's radius */
export function puffScale(radius: number): number {
  return Math.min(2.6, Math.max(0.85, 0.72 + 0.8 * radius));
}

/** vortex scale k of the appear specs (authored for a 0.45 m creature) */
export function vortexScale(radius: number): number {
  return Math.min(2.2, Math.max(0.8, 0.62 + 0.85 * radius));
}

// leaky counters: tier-0 deaths in the recent past (drains 28 / s), spawn token buckets
const DEATH_DRAIN = 28;
const DEATH_SHRINK_AT = 12;
const DEATH_DROP_AT = 22;

/** summons within this distance (m) of a player appear smaller (the vortex must not bury the hero's selection ring) */
const NEAR_PLAYER = 2.8;
/** vortices drawn recently: from this many on (drains 5 / s) further plain summons play the whisper, so a swarm of summons is not a field of whirlpools */
const APPEAR_FULL_AT = 1;
const APPEAR_DRAIN = 5;

/** 1 far from every player, down to 0.55 right on top of one (render positions [x, y, z] x 4; an all-zero table = no player fed) */
export function playerCrowding(players: ArrayLike<number>, x: number, z: number): number {
  let m = 1;
  for (let i = 0; i < 4; i++) {
    const px = players[i * 3] as number;
    const pz = players[i * 3 + 2] as number;
    if (px === 0 && pz === 0) continue;
    const d = Math.hypot(px - x, pz - z);
    if (d < NEAR_PLAYER) m = Math.min(m, 0.55 + 0.45 * (d / NEAR_PLAYER));
  }
  return m;
}

export function deathSpawnRoutes(): readonly EventRoute[] {
  let load = 0;
  let whisper = 6;
  let corrupt = 4;
  let appears = 0;
  const bucket = (n: number, cap: number, dt: number, rate: number, ctx: RouteCtx): number => Math.min(cap * ctx.density, n + dt * rate * ctx.density);
  return [
    route(
      ['enemyDeath'],
      (e, ctx) => {
        const r = creatureRadius(e.type, e.scale);
        let k = puffScale(r);
        let id: string;
        if (e.tier >= 2) {
          id = 'death.boss';
          k = Math.min(2, Math.max(1.2, 0.5 + 0.55 * r));
        }
        else if (e.tier === 1) id = 'death.elite';
        else {
          id = ctx.deathPreset(e.type) ?? 'sk.gen.monster_die';
          // a mass kill: smaller puffs first, then every other death goes without (its corpse still lies there)
          const lim = ctx.density;
          if (load > DEATH_DROP_AT * lim) return;
          if (load > DEATH_SHRINK_AT * lim) k *= 0.8;
          load += 1;
        }
        ctx.fire(id, ctx.o(e.x, e.z, k, Math.sin(e.rot), Math.cos(e.rot)));
      },
      {
        update: (dt) => void (load = Math.max(0, load - dt * DEATH_DRAIN)),
        reset: () => void (load = 0),
      },
    ),
    route(
      ['enemySpawn'],
      (e, ctx) => {
        // source: 0 band, 1 pack, 2 metin swarm, 3 boss/final, 4 summon, 5 elite
        const r = creatureRadius(e.type, e.tier >= 1 ? 1.22 : 1);
        const k = vortexScale(r) * playerCrowding(ctx.players, e.x, e.z);
        if (e.tier >= 1 && e.source !== 3) {
          appears += 1;
          ctx.fire('spawn.elite', ctx.o(e.x, e.z, k));
        } else if (e.source === 2) {
          if (corrupt < 1) return;
          corrupt -= 1;
          ctx.fire('spawn.corrupt', ctx.o(e.x, e.z, k));
        } else if (e.source === 4) {
          // summons: the first couple get the full vortex, a swarm of them the cheap whisper (stress: 7 whirlpools round the hero)
          const full = appears < APPEAR_FULL_AT * ctx.density;
          appears += 1;
          ctx.fire(full ? 'sk.gen.monster_appear' : SPAWN_WHISPER_ID, ctx.o(e.x, e.z, full ? k : k * 0.9));
        } else if (e.source === 0 || e.source === 1) {
          if (whisper < 1) return;
          whisper -= 1;
          const id = ctx.resolve(SPAWN_RING) !== null ? SPAWN_RING : SPAWN_WHISPER_ID;
          ctx.fire(id, ctx.o(e.x, e.z, k));
        }
      },
      {
        update: (dt, ctx) => {
          whisper = bucket(whisper, 6, dt, 12, ctx);
          corrupt = bucket(corrupt, 4, dt, 10, ctx);
          appears = Math.max(0, appears - dt * APPEAR_DRAIN);
        },
        reset: () => {
          whisper = 6;
          corrupt = 4;
          appears = 0;
        },
      },
    ),
  ];
}
