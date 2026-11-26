// Sim → render/audio/UI event stream (ARCHITECTURE §6).
//
// `world.events` is cleared at the START of every `world.step()`; event objects are POOLED and recycled, so
// consumers MUST read them synchronously after step() and must not retain references (copy what you need).
// All numeric ids: `enemy`/`pickup`/… are stable store handles, `element` is an ElementIdx, `player` an index.

export interface DamageEvent {
  t: 'damage';
  x: number;
  z: number;
  amount: number;
  crit: boolean;
  /** ElementIdx */
  element: number;
  /** target enemy stable id (EnemyStore.id) */
  targetId: number;
  player: number;
  /** global skill slot, -1 = none (dot/thorns/trinket) */
  skill: number;
  killed: boolean;
  /** damage over time tick */
  dot: boolean;
  /** hit a boss/king */
  boss: boolean;
}

export interface EnemyDeathEvent {
  t: 'enemyDeath';
  /** dead enemy's stable id */
  id: number;
  type: number;
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** 0 normal, 1 elite, 2 boss */
  tier: number;
  /** killing player, -1 = environment/despawn */
  killer: number;
  skill: number;
  /** killing blow was a crit */
  crit: boolean;
}

export interface EnemySpawnEvent {
  t: 'enemySpawn';
  enemy: number;
  type: number;
  x: number;
  z: number;
  tier: number;
  /** 0 band, 1 pack, 2 metin swarm, 3 boss/final, 4 summon, 5 elite */
  source: number;
}

export interface EnemyAttackEvent {
  t: 'enemyAttack';
  enemy: number;
  type: number;
  /** AttackKind index: melee0 ranged1 charge2 leap3 explode4 aura5 breath6 */
  kind: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

export interface PlayerHitEvent {
  t: 'playerHit';
  player: number;
  amount: number;
  /** 0 hit, 1 evaded, 2 absorbed by shield */
  result: number;
  x: number;
  z: number;
  /** attacker position */
  srcX: number;
  srcZ: number;
  element: number;
  hp: number;
}

export interface PlayerDeathEvent {
  t: 'playerDeath';
  player: number;
  x: number;
  z: number;
}

export interface PlayerReviveEvent {
  t: 'playerRevive';
  player: number;
  x: number;
  z: number;
  left: number;
}

export const enum HealSource {
  Regen = 0,
  Lifesteal = 1,
  Pickup = 2,
  Skill = 3,
  Card = 4,
  /** the caster's OWN cast heal of a self buff (selfBuff.cast, q === p): the cast plays its own look, so the heal route draws no holy.heal on top of it (recheck B2); numbers still show */
  CastSelf = 5,
}
export interface HealEvent {
  t: 'heal';
  player: number;
  amount: number;
  source: number;
}

export interface LevelUpEvent {
  t: 'levelUp';
  player: number;
  level: number;
}

export interface PickupEvent {
  t: 'pickup';
  player: number;
  /** PickupKind */
  kind: number;
  value: number;
  x: number;
  z: number;
  tier: number;
}

export interface SkillCastEvent {
  t: 'skillCast';
  player: number;
  /** global skill slot */
  skill: number;
  skillId: string;
  behavior: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** final area (radius/width) of this cast */
  area: number;
  awakened: boolean;
  /** SkillDef.heroClip or '' */
  heroClip: string;
  /** explicit hero-animation suppression (e.g. shadow clone mimic casts) */
  noHeroAnim: boolean;
}

/** a card/essence was picked (feedback for UI/audio) */
export interface CardPickEvent {
  t: 'cardPick';
  player: number;
  /** CardKind */
  kind: string;
  id: string;
  rarity: string;
  rank: number;
  awakening: boolean;
}

/** generic VFX request: render maps `preset` to a vfx/presets entry */
export interface VfxEvent {
  t: 'vfx';
  preset: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  scale: number;
  duration: number;
  /** 0xRRGGBB or -1 = preset default */
  color: number;
  /** optional second point for lines/chains/beams (valid when hasTarget) */
  tx: number;
  tz: number;
  hasTarget: boolean;
  /** ElementIdx hint for tinting */
  element: number;
  /** explicit caster player index when bound to a hero (-1 = unbound / infer) */
  player: number;
}

export interface SfxEvent {
  t: 'sfx';
  id: string;
  x: number;
  z: number;
  /** 0..1 */
  vol: number;
}

export interface TelegraphEvent {
  t: 'telegraph';
  /** TelegraphStore handle (render decals read the store; this event is for audio/UI warnings) */
  id: number;
  shape: number;
  x: number;
  z: number;
  rot: number;
  a: number;
  b: number;
  c: number;
  dur: number;
  /** 0 enemy, 1 boss, 2 metin, 3 hazard */
  source: number;
}

export interface MetinWarnEvent {
  t: 'metinWarn';
  /** MetinState.id */
  metin: number;
  def: string;
  x: number;
  z: number;
  /** seconds until impact */
  dur: number;
  great: boolean;
}

export interface MetinImpactEvent {
  t: 'metinImpact';
  metin: number;
  def: string;
  x: number;
  z: number;
  radius: number;
  great: boolean;
}

export interface MetinAwakenEvent {
  t: 'metinAwaken';
  metin: number;
  def: string;
  x: number;
  z: number;
}

export interface MetinBreakEvent {
  t: 'metinBreak';
  metin: number;
  def: string;
  x: number;
  z: number;
  great: boolean;
  awakened: boolean;
}

export interface BossSpawnEvent {
  t: 'bossSpawn';
  boss: number;
  enemy: number;
  bossId: string;
  x: number;
  z: number;
  final: boolean;
}

export interface BossPhaseEvent {
  t: 'bossPhase';
  boss: number;
  bossId: string;
  phase: number;
  hpFrac: number;
  enrage: boolean;
}

export interface BossDeathEvent {
  t: 'bossDeath';
  boss: number;
  bossId: string;
  x: number;
  z: number;
  final: boolean;
}

export interface ChestOpenEvent {
  t: 'chestOpen';
  player: number;
  x: number;
  z: number;
  boss: boolean;
  cost: number;
}

/** player walked on a chest but cannot afford it */
export interface ChestLockedEvent {
  t: 'chestLocked';
  player: number;
  cost: number;
  yeop: number;
}

export interface StoryEvent {
  t: 'story';
  /** 'zoneIntro' | 'bossIntro' | 'victory' | 'defeat' | 'metin' */
  kind: string;
  /** boss id / metin id / zone id */
  ref: string;
}

export interface ShakeEvent {
  t: 'shake';
  amount: number;
  duration: number;
}

export interface RunEndEvent {
  t: 'runEnd';
  victory: boolean;
}

/**
 * A run event (sim/runEvents.ts, RS-02a): one set piece per run. `startAt` = the sim second it becomes active, `endAt` = the end of
 * its active phase (the real moment in the 'end' phase): ABSOLUTE sim times, so a co-op guest derives the timer from its
 * mirrored clock. Emitted on every phase change, re-emitted every 5 s while the event is up (late joiners) and sooner when the event
 * moves: a consumer keys on `id` and treats a repeated phase as a refresh. Phases: 'announce' (5 s before the start), 'active',
 * 'end' (`p` = 1 the event ran its course or was won, 0 it failed), 'channel' (the Sky Sovereign's shrine: hero `player` has
 * channelled `p` 0..1, EV-02a).
 */
export interface RunEventEvent {
  t: 'runEvent';
  /** runEvents.json kind id */
  kind: string;
  phase: 'announce' | 'active' | 'end' | 'channel';
  /** unique within the run */
  id: number;
  x: number;
  z: number;
  startAt: number;
  endAt: number;
  /** 'channel': the channelling hero, else -1 */
  player: number;
  /** 'channel': progress 0..1; 'end': 1 ok / 0 failed; else 0 */
  p: number;
}

export type SimEvent =
  | DamageEvent
  | EnemyDeathEvent
  | EnemySpawnEvent
  | EnemyAttackEvent
  | PlayerHitEvent
  | PlayerDeathEvent
  | PlayerReviveEvent
  | HealEvent
  | LevelUpEvent
  | PickupEvent
  | SkillCastEvent
  | CardPickEvent
  | VfxEvent
  | SfxEvent
  | TelegraphEvent
  | MetinWarnEvent
  | MetinImpactEvent
  | MetinAwakenEvent
  | MetinBreakEvent
  | BossSpawnEvent
  | BossPhaseEvent
  | BossDeathEvent
  | ChestOpenEvent
  | ChestLockedEvent
  | StoryEvent
  | ShakeEvent
  | RunEndEvent
  | RunEventEvent;

export type SimEventType = SimEvent['t'];

class Pool<T> {
  private readonly items: T[] = [];
  private n = 0;
  constructor(private readonly make: () => T) {}
  take(): T {
    if (this.n === this.items.length) this.items.push(this.make());
    return this.items[this.n++] as T;
  }
  reset(): void {
    this.n = 0;
  }
}

/** Hard ceiling of events per tick; low-priority (vfx/sfx/damage) events beyond it are dropped. */
const MAX_EVENTS = 6000;

/**
 * Pooled event emitter. `emit.*` methods fill every field of a recycled object and append it to `list`.
 */
export class EventBus {
  /** this tick's events, in emission order. Cleared by `clear()` at the start of each step. */
  readonly list: SimEvent[] = [];

  private readonly pDamage = new Pool<DamageEvent>(() => ({ t: 'damage', x: 0, z: 0, amount: 0, crit: false, element: 0, targetId: 0, player: 0, skill: -1, killed: false, dot: false, boss: false }));
  private readonly pDeath = new Pool<EnemyDeathEvent>(() => ({ t: 'enemyDeath', id: 0, type: 0, x: 0, z: 0, rot: 0, scale: 1, tier: 0, killer: -1, skill: -1, crit: false }));
  private readonly pSpawn = new Pool<EnemySpawnEvent>(() => ({ t: 'enemySpawn', enemy: 0, type: 0, x: 0, z: 0, tier: 0, source: 0 }));
  private readonly pAttack = new Pool<EnemyAttackEvent>(() => ({ t: 'enemyAttack', enemy: 0, type: 0, kind: 0, x: 0, z: 0, dirX: 0, dirZ: 1 }));
  private readonly pPlayerHit = new Pool<PlayerHitEvent>(() => ({ t: 'playerHit', player: 0, amount: 0, result: 0, x: 0, z: 0, srcX: 0, srcZ: 0, element: 0, hp: 0 }));
  private readonly pPlayerDeath = new Pool<PlayerDeathEvent>(() => ({ t: 'playerDeath', player: 0, x: 0, z: 0 }));
  private readonly pRevive = new Pool<PlayerReviveEvent>(() => ({ t: 'playerRevive', player: 0, x: 0, z: 0, left: 0 }));
  private readonly pHeal = new Pool<HealEvent>(() => ({ t: 'heal', player: 0, amount: 0, source: 0 }));
  private readonly pLevel = new Pool<LevelUpEvent>(() => ({ t: 'levelUp', player: 0, level: 0 }));
  private readonly pPickup = new Pool<PickupEvent>(() => ({ t: 'pickup', player: 0, kind: 0, value: 0, x: 0, z: 0, tier: 0 }));
  private readonly pCast = new Pool<SkillCastEvent>(() => ({ t: 'skillCast', player: 0, skill: 0, skillId: '', behavior: '', x: 0, z: 0, dirX: 0, dirZ: 1, area: 0, awakened: false, heroClip: '', noHeroAnim: false }));
  private readonly pCard = new Pool<CardPickEvent>(() => ({ t: 'cardPick', player: 0, kind: '', id: '', rarity: 'common', rank: 0, awakening: false }));
  private readonly pVfx = new Pool<VfxEvent>(() => ({ t: 'vfx', preset: '', x: 0, z: 0, dirX: 0, dirZ: 1, scale: 1, duration: 0, color: -1, tx: 0, tz: 0, hasTarget: false, element: 0, player: -1 }));
  private readonly pSfx = new Pool<SfxEvent>(() => ({ t: 'sfx', id: '', x: 0, z: 0, vol: 1 }));
  private readonly pTele = new Pool<TelegraphEvent>(() => ({ t: 'telegraph', id: 0, shape: 0, x: 0, z: 0, rot: 0, a: 0, b: 0, c: 0, dur: 0, source: 0 }));
  private readonly pMetinWarn = new Pool<MetinWarnEvent>(() => ({ t: 'metinWarn', metin: 0, def: '', x: 0, z: 0, dur: 0, great: false }));
  private readonly pMetinImpact = new Pool<MetinImpactEvent>(() => ({ t: 'metinImpact', metin: 0, def: '', x: 0, z: 0, radius: 0, great: false }));
  private readonly pMetinAwaken = new Pool<MetinAwakenEvent>(() => ({ t: 'metinAwaken', metin: 0, def: '', x: 0, z: 0 }));
  private readonly pMetinBreak = new Pool<MetinBreakEvent>(() => ({ t: 'metinBreak', metin: 0, def: '', x: 0, z: 0, great: false, awakened: false }));
  private readonly pBossSpawn = new Pool<BossSpawnEvent>(() => ({ t: 'bossSpawn', boss: 0, enemy: 0, bossId: '', x: 0, z: 0, final: false }));
  private readonly pBossPhase = new Pool<BossPhaseEvent>(() => ({ t: 'bossPhase', boss: 0, bossId: '', phase: 0, hpFrac: 1, enrage: false }));
  private readonly pBossDeath = new Pool<BossDeathEvent>(() => ({ t: 'bossDeath', boss: 0, bossId: '', x: 0, z: 0, final: false }));
  private readonly pChest = new Pool<ChestOpenEvent>(() => ({ t: 'chestOpen', player: 0, x: 0, z: 0, boss: false, cost: 0 }));
  private readonly pChestLocked = new Pool<ChestLockedEvent>(() => ({ t: 'chestLocked', player: 0, cost: 0, yeop: 0 }));
  private readonly pStory = new Pool<StoryEvent>(() => ({ t: 'story', kind: '', ref: '' }));
  private readonly pShake = new Pool<ShakeEvent>(() => ({ t: 'shake', amount: 0, duration: 0 }));
  private readonly pRunEnd = new Pool<RunEndEvent>(() => ({ t: 'runEnd', victory: false }));
  private readonly pRunEvent = new Pool<RunEventEvent>(() => ({ t: 'runEvent', kind: '', phase: 'announce', id: 0, x: 0, z: 0, startAt: 0, endAt: 0, player: -1, p: 0 }));

  private readonly pools: Pool<SimEvent>[];

  constructor() {
    this.pools = [
      this.pDamage, this.pDeath, this.pSpawn, this.pAttack, this.pPlayerHit, this.pPlayerDeath, this.pRevive, this.pHeal,
      this.pLevel, this.pPickup, this.pCast, this.pCard, this.pVfx, this.pSfx, this.pTele, this.pMetinWarn, this.pMetinImpact,
      this.pMetinAwaken, this.pMetinBreak, this.pBossSpawn, this.pBossPhase, this.pBossDeath, this.pChest, this.pChestLocked,
      this.pStory, this.pShake, this.pRunEnd, this.pRunEvent,
    ] as Pool<SimEvent>[];
  }

  clear(): void {
    this.list.length = 0;
    for (let i = 0; i < this.pools.length; i++) (this.pools[i] as Pool<SimEvent>).reset();
  }

  /** Replays snapshot copies of out-of-step events (e.g. `chooseCard` between ticks) into fresh pool slots. */
  replay(events: readonly SimEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const src = events[i] as SimEvent;
      switch (src.t) {
        case 'cardPick':
          this.cardPick(src.player, src.kind, src.id, src.rarity, src.rank, src.awakening);
          break;
        case 'sfx':
          this.sfx(src.id, src.x, src.z, src.vol);
          break;
        case 'heal':
          this.heal(src.player, src.amount, src.source);
          break;
        case 'vfx':
          if (src.hasTarget) this.vfxLine(src.preset, src.x, src.z, src.tx, src.tz, src.scale, src.duration, src.element, src.color, src.player);
          else this.vfx(src.preset, src.x, src.z, src.dirX, src.dirZ, src.scale, src.duration, src.element, src.color, src.player);
          break;
        case 'story':
          this.story(src.kind, src.ref);
          break;
        default:
          this.list.push(src);
          break;
      }
    }
  }

  get full(): boolean {
    return this.list.length >= MAX_EVENTS;
  }

  damage(x: number, z: number, amount: number, crit: boolean, element: number, targetId: number, player: number, skill: number, killed: boolean, dot: boolean, boss: boolean): void {
    if (this.list.length >= MAX_EVENTS) return;
    const e = this.pDamage.take();
    e.x = x; e.z = z; e.amount = amount; e.crit = crit; e.element = element; e.targetId = targetId; e.player = player;
    e.skill = skill; e.killed = killed; e.dot = dot; e.boss = boss;
    this.list.push(e);
  }

  enemyDeath(id: number, type: number, x: number, z: number, rot: number, scale: number, tier: number, killer: number, skill: number, crit: boolean): void {
    const e = this.pDeath.take();
    e.id = id; e.type = type; e.x = x; e.z = z; e.rot = rot; e.scale = scale; e.tier = tier; e.killer = killer; e.skill = skill; e.crit = crit;
    this.list.push(e);
  }

  enemySpawn(enemy: number, type: number, x: number, z: number, tier: number, source: number): void {
    const e = this.pSpawn.take();
    e.enemy = enemy; e.type = type; e.x = x; e.z = z; e.tier = tier; e.source = source;
    this.list.push(e);
  }

  enemyAttack(enemy: number, type: number, kind: number, x: number, z: number, dirX: number, dirZ: number): void {
    if (this.list.length >= MAX_EVENTS) return;
    const e = this.pAttack.take();
    e.enemy = enemy; e.type = type; e.kind = kind; e.x = x; e.z = z; e.dirX = dirX; e.dirZ = dirZ;
    this.list.push(e);
  }

  playerHit(player: number, amount: number, result: number, x: number, z: number, srcX: number, srcZ: number, element: number, hp: number): void {
    const e = this.pPlayerHit.take();
    e.player = player; e.amount = amount; e.result = result; e.x = x; e.z = z; e.srcX = srcX; e.srcZ = srcZ; e.element = element; e.hp = hp;
    this.list.push(e);
  }

  playerDeath(player: number, x: number, z: number): void {
    const e = this.pPlayerDeath.take();
    e.player = player; e.x = x; e.z = z;
    this.list.push(e);
  }

  playerRevive(player: number, x: number, z: number, left: number): void {
    const e = this.pRevive.take();
    e.player = player; e.x = x; e.z = z; e.left = left;
    this.list.push(e);
  }

  heal(player: number, amount: number, source: number): void {
    const e = this.pHeal.take();
    e.player = player; e.amount = amount; e.source = source;
    this.list.push(e);
  }

  levelUp(player: number, level: number): void {
    const e = this.pLevel.take();
    e.player = player; e.level = level;
    this.list.push(e);
  }

  pickup(player: number, kind: number, value: number, x: number, z: number, tier: number): void {
    if (this.list.length >= MAX_EVENTS) return;
    const e = this.pPickup.take();
    e.player = player; e.kind = kind; e.value = value; e.x = x; e.z = z; e.tier = tier;
    this.list.push(e);
  }

  skillCast(player: number, skill: number, skillId: string, behavior: string, x: number, z: number, dirX: number, dirZ: number, area: number, awakened: boolean, heroClip: string, noHeroAnim = false): void {
    const e = this.pCast.take();
    e.player = player; e.skill = skill; e.skillId = skillId; e.behavior = behavior; e.x = x; e.z = z; e.dirX = dirX; e.dirZ = dirZ;
    e.area = area; e.awakened = awakened; e.heroClip = heroClip; e.noHeroAnim = noHeroAnim;
    this.list.push(e);
  }

  cardPick(player: number, kind: string, id: string, rarity: string, rank: number, awakening: boolean): void {
    const e = this.pCard.take();
    e.player = player; e.kind = kind; e.id = id; e.rarity = rarity; e.rank = rank; e.awakening = awakening;
    this.list.push(e);
  }

  vfx(preset: string, x: number, z: number, dirX: number, dirZ: number, scale: number, duration: number, element = 0, color = -1, player = -1): void {
    if (this.list.length >= MAX_EVENTS) return;
    const e = this.pVfx.take();
    e.preset = preset; e.x = x; e.z = z; e.dirX = dirX; e.dirZ = dirZ; e.scale = scale; e.duration = duration;
    e.color = color; e.hasTarget = false; e.tx = 0; e.tz = 0; e.element = element; e.player = player;
    this.list.push(e);
  }

  /** vfx with a second point (chain links, beams, lines) */
  vfxLine(preset: string, x: number, z: number, tx: number, tz: number, scale: number, duration: number, element = 0, color = -1, player = -1): void {
    if (this.list.length >= MAX_EVENTS) return;
    const e = this.pVfx.take();
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz) || 1;
    e.preset = preset; e.x = x; e.z = z; e.dirX = dx / d; e.dirZ = dz / d; e.scale = scale; e.duration = duration;
    e.color = color; e.hasTarget = true; e.tx = tx; e.tz = tz; e.element = element; e.player = player;
    this.list.push(e);
  }

  sfx(id: string, x: number, z: number, vol = 1): void {
    if (this.list.length >= MAX_EVENTS || id === '') return;
    const e = this.pSfx.take();
    e.id = id; e.x = x; e.z = z; e.vol = vol;
    this.list.push(e);
  }

  telegraph(id: number, shape: number, x: number, z: number, rot: number, a: number, b: number, c: number, dur: number, source: number): void {
    const e = this.pTele.take();
    e.id = id; e.shape = shape; e.x = x; e.z = z; e.rot = rot; e.a = a; e.b = b; e.c = c; e.dur = dur; e.source = source;
    this.list.push(e);
  }

  metinWarn(metin: number, def: string, x: number, z: number, dur: number, great: boolean): void {
    const e = this.pMetinWarn.take();
    e.metin = metin; e.def = def; e.x = x; e.z = z; e.dur = dur; e.great = great;
    this.list.push(e);
  }

  metinImpact(metin: number, def: string, x: number, z: number, radius: number, great: boolean): void {
    const e = this.pMetinImpact.take();
    e.metin = metin; e.def = def; e.x = x; e.z = z; e.radius = radius; e.great = great;
    this.list.push(e);
  }

  metinAwaken(metin: number, def: string, x: number, z: number): void {
    const e = this.pMetinAwaken.take();
    e.metin = metin; e.def = def; e.x = x; e.z = z;
    this.list.push(e);
  }

  metinBreak(metin: number, def: string, x: number, z: number, great: boolean, awakened: boolean): void {
    const e = this.pMetinBreak.take();
    e.metin = metin; e.def = def; e.x = x; e.z = z; e.great = great; e.awakened = awakened;
    this.list.push(e);
  }

  bossSpawn(boss: number, enemy: number, bossId: string, x: number, z: number, final: boolean): void {
    const e = this.pBossSpawn.take();
    e.boss = boss; e.enemy = enemy; e.bossId = bossId; e.x = x; e.z = z; e.final = final;
    this.list.push(e);
  }

  bossPhase(boss: number, bossId: string, phase: number, hpFrac: number, enrage: boolean): void {
    const e = this.pBossPhase.take();
    e.boss = boss; e.bossId = bossId; e.phase = phase; e.hpFrac = hpFrac; e.enrage = enrage;
    this.list.push(e);
  }

  bossDeath(boss: number, bossId: string, x: number, z: number, final: boolean): void {
    const e = this.pBossDeath.take();
    e.boss = boss; e.bossId = bossId; e.x = x; e.z = z; e.final = final;
    this.list.push(e);
  }

  chestOpen(player: number, x: number, z: number, boss: boolean, cost: number): void {
    const e = this.pChest.take();
    e.player = player; e.x = x; e.z = z; e.boss = boss; e.cost = cost;
    this.list.push(e);
  }

  chestLocked(player: number, cost: number, yeop: number): void {
    const e = this.pChestLocked.take();
    e.player = player; e.cost = cost; e.yeop = yeop;
    this.list.push(e);
  }

  story(kind: string, ref: string): void {
    const e = this.pStory.take();
    e.kind = kind; e.ref = ref;
    this.list.push(e);
  }

  shake(amount: number, duration: number): void {
    const e = this.pShake.take();
    e.amount = amount; e.duration = duration;
    this.list.push(e);
  }

  runEnd(victory: boolean): void {
    const e = this.pRunEnd.take();
    e.victory = victory;
    this.list.push(e);
  }

  runEvent(kind: string, phase: RunEventEvent['phase'], id: number, x: number, z: number, startAt: number, endAt: number, player = -1, p = 0): void {
    const e = this.pRunEvent.take();
    e.kind = kind; e.phase = phase; e.id = id; e.x = x; e.z = z; e.startAt = startAt; e.endAt = endAt; e.player = player; e.p = p;
    this.list.push(e);
  }
}
