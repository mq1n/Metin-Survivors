// Read-only views the renderer consumes each frame. They are deliberately structural: the sim's SoA stores
// (sim/stores.ts) satisfy them directly where the field names match; app/simFeed.ts adapts the rest.
// Rules: arrays are dense, valid for indices [0, count); render never writes to them; render never retains
// them across frames except by id.
//
// Coordinates: x/z world metres (ground plane), `rot` = yaw about +Y (0 faces +Z), y comes from ctx.heightAt.

/** Animation clip index used in `animClip` columns. Order is the contract (sim writes the index). */
export const CLIP_NAMES = [
  'idle',
  'walk',
  'run',
  'attack',
  'attack2',
  'hit',
  'death',
  'spawn',
  'special1',
  'special2',
  'special3',
] as const;
export type ClipName = (typeof CLIP_NAMES)[number];
export const CLIP_COUNT = CLIP_NAMES.length;

/** Status bits in `status` columns (bit i = StatusKind order below). */
export const STATUS_BITS = {
  slow: 1,
  poison: 2,
  burn: 4,
  stun: 8,
  freeze: 16,
  bleed: 32,
  fear: 64,
  weaken: 128,
} as const;

/** `eliteTier`: 0 normal, 1 elite, 2 champion (knight/elite leader), 3 boss/king. */
export type EliteTier = 0 | 1 | 2 | 3;

export interface EnemyFeed {
  /** number of live rows */
  readonly count: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** previous-tick position (for interpolation) */
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly rot: Float32Array;
  /** final world scale (def.scale × variance × elite factor) */
  readonly scale: Float32Array;
  /** index into the crowd type table (RenderCatalog.enemyTypes) */
  readonly type: ArrayLike<number>;
  /** index into CLIP_NAMES */
  readonly animClip: ArrayLike<number>;
  /** seconds into the clip (sim advances it; render wraps looping clips) */
  readonly animT: Float32Array;
  /** 0..1 hit flash */
  readonly flash: Float32Array;
  readonly eliteTier: ArrayLike<number>;
  /** 0..1 corruption (Metin aura) */
  readonly corrupted: ArrayLike<number>;
  /** STATUS_BITS mask */
  readonly status: ArrayLike<number>;
  /** stable id (changes when a row is reused); used for damage-number aggregation only */
  readonly id: ArrayLike<number>;
  /** EnemyFlag bits; rows with bit 8 (Metin) are not creatures and are skipped by the crowd */
  readonly flags: ArrayLike<number>;
}

export interface ProjectileFeed {
  readonly count: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  /** height above ground in metres */
  readonly h: Float32Array;
  /** yaw, used when the projectile barely moves */
  readonly rot: Float32Array;
  /** world radius of the visual (hit radius or larger) */
  readonly radius: Float32Array;
  /** index into the projectile style table (RenderCatalog.projectileStyles) */
  readonly style: ArrayLike<number>;
  /** 1 = fired by an enemy (drawn hostile-red outline) */
  readonly hostile: ArrayLike<number>;
  /** seconds since spawn */
  readonly age: Float32Array;
}

export type PickupKind = 0 | 1 | 2 | 3 | 4;
/** 0 xp gem, 1 yeop coin, 2 health potion, 3 chest, 4 magnet/vacuum */
export const PICKUP_XP = 0;
export const PICKUP_YEOP = 1;
export const PICKUP_POTION = 2;
export const PICKUP_CHEST = 3;
export const PICKUP_MAGNET = 4;

export interface PickupFeed {
  readonly count: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** PickupKind */
  readonly kind: ArrayLike<number>;
  /** xp gem tier 0..4 (blue, green, yellow, orange, red); yeop stack size class 0..2; chest tier 0..2 */
  readonly tier: ArrayLike<number>;
  /** seconds since the pickup appeared (spawn pop animation) */
  readonly age: Float32Array;
  /** 1 while being magnetised toward the player (render adds a trail/sparkle) */
  readonly magnet: ArrayLike<number>;
  /** hop height above ground (m) during the spawn pop (added to the terrain height) */
  readonly h: Float32Array;
  /** previous-tick position (optional): pickups interpolate by alpha when present */
  readonly px?: Float32Array;
  readonly pz?: Float32Array;
}

export type TelegraphShape = 0 | 1 | 2 | 3;
/** 0 circle, 1 cone (sector), 2 line (rectangle), 3 ring (annulus) */
export const TG_CIRCLE = 0;
export const TG_CONE = 1;
export const TG_LINE = 2;
export const TG_RING = 3;

/** 0 enemy attack, 1 boss attack, 2 metin (fall / aura pulse) */
export type TelegraphOwner = 0 | 1 | 2;

export interface TelegraphFeed {
  readonly count: number;
  /** TelegraphShape */
  readonly shape: ArrayLike<number>;
  /** TelegraphOwner */
  readonly owner: ArrayLike<number>;
  /** origin on the ground */
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** facing for cone/line (yaw, 0 = +Z) */
  readonly rot: Float32Array;
  /** circle/cone radius, ring outer radius */
  readonly radius: Float32Array;
  /** ring inner radius; line length; (cone: unused) */
  readonly length: Float32Array;
  /** cone full angle (rad) / line width (m) */
  readonly width: Float32Array;
  /** 0..1 how far the wind-up has progressed (fill) */
  readonly progress: Float32Array;
}

export interface PlayerFeed {
  readonly x: number;
  readonly z: number;
  readonly px: number;
  readonly pz: number;
  /** facing yaw */
  readonly rot: number;
  /** current move speed (m/s), drives run-cycle speed */
  readonly speed: number;
  /** optional move velocity (m/s), drives locomotion facing independently of aim `rot` */
  readonly vx?: number;
  readonly vz?: number;
  readonly dead: boolean;
  /** 0..1 hit flash / invulnerability blink */
  readonly flash: number;
  /** 0..1 */
  readonly corrupted: number;
  /** sim hero clip: 'idle' | 'run' | 'cast' | 'dash' | 'attack' | 'hit' | 'death' | 'victory' (one-shots trigger animations) */
  readonly clip?: string;
}

export type MetinPhase = 0 | 1 | 2 | 3;
/** One live metin (few at a time → array of objects; sim's MetinState satisfies this). */
export interface MetinView {
  readonly id: number;
  /** index into RenderCatalog.metinTypes */
  readonly type: number;
  readonly x: number;
  readonly z: number;
  /** 0 falling (warning), 1 alive (drop clip plays in the first ~0.9 s), 2 awakened, 3 breaking */
  readonly phase: number;
  /** seconds in the current phase */
  readonly phaseT: number;
  /** 0..1 */
  readonly hpFrac: number;
  /** world scale */
  readonly scale: number;
  readonly great: boolean;
  /** corruption aura radius (m) */
  readonly auraRadius: number;
  /** seconds to impact while falling */
  readonly warnLeft: number;
}
export type MetinFeed = readonly MetinView[];

/** What the renderer needs to know about content, built once per run from the ContentDB. */
export interface CrowdTypeDef {
  /** unique key (enemy def id) */
  key: string;
  /** manifest model id */
  modelId: string;
  /** multiplied into the vertex colors (#rrggbb) */
  tint?: string;
  /** 'multiply' (default) modulates the albedo; 'colorize' keeps its luminance detail and takes hue/saturation from `tint` */
  tintMode?: 'multiply' | 'colorize';
  /** shadow blob radius (m) at scale 1 */
  radius: number;
  /** crowd instance capacity hint; default from the quality cap */
  capacity?: number;
}

export interface ProjectileStyleDef {
  /** 'orb' soft glow, 'arrow' shaft + head, 'blade' crescent, 'talisman' paper charm, 'bolt' lightning-like streak */
  shape: 'orb' | 'arrow' | 'blade' | 'talisman' | 'bolt';
  /** #rrggbb */
  color: string;
  /** secondary/core color */
  core?: string;
  /** visual length multiplier vs radius */
  length?: number;
  /** trail length in seconds of travel */
  trail?: number;
  /** drawn by the VFX layer (skill spec presets `sk.*`): the projectile renderer skips it */
  hidden?: boolean;
}

export interface MetinTypeDef {
  key: string;
  modelId: string;
  /** rune glow #rrggbb */
  rune: string;
}

/** A crowd type the run only meets later (time band, boss, metin swarm): streamed in the background ahead of `at`. */
export interface EnemyStreamDef {
  /** index into RenderCatalog.enemyTypes */
  type: number;
  /** run seconds from which the type can first be on screen */
  at: number;
}

export interface RenderCatalog {
  enemyTypes: CrowdTypeDef[];
  /** type indexes the run needs from its first seconds: loaded and baked before the run starts. Types in neither this
   *  list nor `enemyLater` are neither loaded nor baked (default: all; a feed row of such a type is fetched on demand) */
  enemyUsed?: number[];
  /** types that can only appear later in the run (app/simFeed.buildCatalog): the crowd fetches their models, bakes them in
   *  idle slices and compiles their materials in the background `at - lead` seconds of run rendering before they can
   *  spawn, instead of weighing on the blocking zone load (ARCHITECTURE §11 payload policy). Default: none */
  enemyLater?: readonly EnemyStreamDef[];
  projectileStyles: ProjectileStyleDef[];
  metinTypes: MetinTypeDef[];
  /** skill-spec preset ids (`sk.*`) this run can spawn: only their generated sprites are packed (vfx/spec/artScope.ts
   *  runSpecIds); default: every registered spec's */
  vfxSpecs?: readonly string[];
  /** `vfxSpecs` split by when a spec is first needed (vfx/spec/artTier.ts), set only where content is streamed (production,
   *  `?payload=1`): the run awaits the `now` tier's sprites, the rest streams in behind the first seconds (ARCHITECTURE §11).
   *  Absent (dev server, galleries): every sprite of `vfxSpecs` is awaited before the run starts */
  vfxTiers?: { now: readonly string[]; soon: readonly string[]; late: readonly string[] };
}

/** Everything a frame needs. Optional feeds are simply not drawn when absent. */
export interface RenderFeeds {
  enemies: EnemyFeed;
  players: PlayerFeed[];
  projectiles?: ProjectileFeed;
  pickups?: PickupFeed;
  telegraphs?: TelegraphFeed;
  metins?: MetinFeed;
}
