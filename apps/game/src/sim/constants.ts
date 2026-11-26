// Sim-wide constants. Units: meters, seconds, radians. Sim plane = XZ.

/** terrain surface ids returned by WorldEnv.surfaceAt (same values as world/terrainField SURFACE) */
export const enum Surface {
  Ground = 0,
  Lava = 1,
  Shallow = 2,
  Ice = 3,
  Miasma = 4,
  Deep = 5,
}

/** fixed sim step */
export const DT = 1 / 60;
export const TICK_RATE = 60;

/** spatial hash cell size (m) */
export const CELL = 4;

/** Hard store capacities (rows). Spawner throttles `ENEMY_SOFT_CAP` *alive* enemies; dying rows + forced spawns use the rest. */
export const CAP = {
  enemies: 768,
  projectiles: 1500,
  pickups: 1200,
  zones: 192,
  telegraphs: 128,
} as const;

/** live-enemy cap enforced by the spawner (ARCHITECTURE §6) */
export const ENEMY_SOFT_CAP = 600;

/** default half-size of the playable arena (m); TerrainField may override via WorldEnv */
export const DEFAULT_ARENA_RADIUS = 150;

export const PLAYER_RADIUS = 0.55;
export const PLAYER_BASE_PICKUP = 3.2;
export const PLAYER_IFRAMES = 0.55;
/** brief i-frames after ground-hazard ticks */
export const HAZARD_IFRAMES = 0.25;

/** seconds of spawn-in animation during which an enemy is harmless/untargetable */
export const SPAWN_TIME = 0.45;

export const KNOCK_DECAY = 9;

export const MAX_SKILL_SLOTS = 64;
/** per-enemy "can be hit again" stamps are indexed by global skill slot */
export const MAX_ATTACKS = 3;
export const MAX_PLAYERS = 4;

/** spawn ring around the (nearest) player, meters */
export const SPAWN_RING_MIN = 31;
export const SPAWN_RING_MAX = 38;
/** enemies farther than this from every player are relocated to the ring */
export const RELOCATE_DIST = 58;

export const VICTORY_DELAY = 3.2;
export const DEFEAT_DELAY = 1.6;
